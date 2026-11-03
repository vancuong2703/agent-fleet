using System.Diagnostics;
using System.Net;
using System.Net.Http.Json;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace FleetDesktop;

internal sealed class FleetRuntime(string dataDir) : IAsyncDisposable
{
    private Process? server;
    private StreamWriter? log;
    private OwnedProcessJob? job;
    private bool serverStarted;
    private bool disposed;
    internal string BaseUrl { get; private set; } = "";
    internal string Token { get; private set; } = "";
    internal HttpClient Client { get; } = new() { Timeout = TimeSpan.FromSeconds(8) };
    internal bool IsAlive => serverStarted && server is { HasExited: false };
    internal IReadOnlySet<int> OwnedProcessIds() => job?.ProcessIds() ?? new HashSet<int>();

    internal async Task StartAsync()
    {
        var root = AppContext.BaseDirectory;
        var runtime = Path.Combine(root, "runtime", "node.exe");
        var application = Path.Combine(root, "app");
        if (!File.Exists(runtime) || !File.Exists(Path.Combine(application, "server", "main.js")))
            throw new FileNotFoundException("Thiếu runtime hoặc mã ứng dụng. Giải nén đầy đủ gói AgentFleet portable trước khi chạy.");
        var configPath = Path.Combine(dataDir, "fleet.config.json");
        var config = File.Exists(configPath) ? JsonNode.Parse(await File.ReadAllTextAsync(configPath))!.AsObject() : new JsonObject();
        using var portProbe = new TcpListener(IPAddress.Loopback, 0);
        portProbe.Start();
        var port = ((IPEndPoint)portProbe.LocalEndpoint).Port;
        config["port"] = port;
        await File.WriteAllTextAsync(configPath, config.ToJsonString(new JsonSerializerOptions { WriteIndented = true }));
        var tokenPath = Path.Combine(dataDir, "token");
        Token = Convert.ToHexString(RandomNumberGenerator.GetBytes(32)).ToLowerInvariant();
        await File.WriteAllTextAsync(tokenPath, Token);
        BaseUrl = $"http://127.0.0.1:{port}";
        Client.DefaultRequestHeaders.Add("x-fleet-token", Token);
        var start = new ProcessStartInfo(runtime) { WorkingDirectory = application, UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true, WindowStyle = ProcessWindowStyle.Hidden };
        start.ArgumentList.Add(Path.Combine(application, "server", "main.js"));
        start.Environment["FLEET_DATA_DIR"] = dataDir;
        start.Environment["FLEET_DESKTOP"] = "1";
        start.Environment["NODE_ENV"] = "production";
        start.Environment["PATH"] = Path.GetDirectoryName(runtime) + Path.PathSeparator + Environment.GetEnvironmentVariable("PATH");
        log = new StreamWriter(Path.Combine(dataDir, "server.log"), append: true) { AutoFlush = true };
        var writeLock = new object();
        server = new Process { StartInfo = start };
        job = new OwnedProcessJob();
        server.OutputDataReceived += (_, e) => { if (e.Data != null) lock (writeLock) log.WriteLine(e.Data); };
        server.ErrorDataReceived += (_, e) => { if (e.Data != null) lock (writeLock) log.WriteLine(e.Data); };
        portProbe.Stop();
        if (!server.Start()) throw new InvalidOperationException("Không khởi động được server.");
        serverStarted = true;
        job.Assign(server);
        server.BeginOutputReadLine(); server.BeginErrorReadLine();
        var readiness = Stopwatch.StartNew();
        while (readiness.Elapsed < TimeSpan.FromSeconds(30))
        {
            if (server.HasExited) throw new InvalidOperationException($"Server dừng với mã {server.ExitCode}. Xem {Path.Combine(dataDir, "server.log")}");
            // Never send a bearer token to a different process racing for the port.
            if (!NativeMethods.ListenerOwnedBy(port, server.Id)) { await Task.Delay(100); continue; }
            using var attemptTimeout = new CancellationTokenSource(TimeSpan.FromMilliseconds(Math.Min(500, Math.Max(1, 30_000 - readiness.ElapsedMilliseconds))));
            try
            {
                using var response = await Client.GetAsync($"{BaseUrl}/api/plans", attemptTimeout.Token);
                if (response.IsSuccessStatusCode)
                {
                    using var plans = JsonDocument.Parse(await response.Content.ReadAsStringAsync(attemptTimeout.Token));
                    if (plans.RootElement.ValueKind == JsonValueKind.Array) return;
                }
            }
            catch (HttpRequestException) { } catch (TaskCanceledException) { } catch (JsonException) { }
            await Task.Delay(250);
        }
        throw new TimeoutException("Server chưa sẵn sàng sau 30 giây. Kiểm tra server.log.");
    }

    internal async Task<int> ActiveTaskCountAsync()
    {
        using var response = await Client.GetAsync($"{BaseUrl}/api/tasks"); response.EnsureSuccessStatusCode();
        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var count = document.RootElement.EnumerateArray().Count(task => task.GetProperty("status").GetString() is "running" or "queued" or "taken_over");
        // Dashboard CLIs are interactive sessions, independent of tracked tasks.
        // Closing the host must never silently terminate one of these sessions.
        using var dashboard = await Client.GetAsync($"{BaseUrl}/api/dashboard");
        dashboard.EnsureSuccessStatusCode();
        using var snapshot = JsonDocument.Parse(await dashboard.Content.ReadAsStringAsync());
        if (snapshot.RootElement.TryGetProperty("terminalSessions", out var terminals) && terminals.ValueKind == JsonValueKind.Array) count += terminals.GetArrayLength();
        return count;
    }

    internal async Task<JsonElement> GetAsync(string route)
    {
        using var response = await Client.GetAsync(BaseUrl + route); response.EnsureSuccessStatusCode();
        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        return document.RootElement.Clone();
    }

    public async ValueTask DisposeAsync()
    {
        if (disposed) return;
        disposed = true;
        var ownedServer = server;
        if (serverStarted && ownedServer is { HasExited: false })
        {
            try { using var response = await Client.PostAsJsonAsync($"{BaseUrl}/api/shutdown", new { }); await ownedServer.WaitForExitAsync().WaitAsync(TimeSpan.FromSeconds(12)); }
            catch { try { if (!ownedServer.HasExited) ownedServer.Kill(entireProcessTree: true); } catch { } }
        }
        job?.Dispose();
        server?.Dispose();
        log?.Dispose();
        Client.Dispose();
    }
}
