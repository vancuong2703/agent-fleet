using System.Diagnostics;
using System.Text.Json;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace FleetDesktop;

internal sealed class DesktopWindow : Form
{
    private readonly string dataDir;
    private readonly bool smokeTest;
    private readonly FleetRuntime runtime;
    private readonly ResourceSampler sampler;
    private readonly DesktopPreferences preferences;
    private readonly WebView2 view = new() { Dock = DockStyle.Fill, Visible = false, DefaultBackgroundColor = Color.FromArgb(24, 26, 32) };
    private readonly Label status = new() { Dock = DockStyle.Fill, TextAlign = ContentAlignment.MiddleCenter, Text = "Đang mở Agent Fleet…", Font = new Font("Segoe UI", 14), ForeColor = Color.FromArgb(224, 229, 237), BackColor = Color.FromArgb(24, 26, 32) };
    private bool allowClose;
    private bool closing;
    private bool ready;
    private Task? startTask;
    private readonly System.Windows.Forms.Timer healthTimer = new() { Interval = 5000 };

    internal DesktopWindow(string dataDir, bool smokeTest)
    {
        this.dataDir = dataDir; this.smokeTest = smokeTest;
        runtime = new FleetRuntime(dataDir); sampler = new ResourceSampler(dataDir, runtime.OwnedProcessIds);
        preferences = new DesktopPreferences(dataDir); preferences.Load();
        Text = "Agent Fleet"; MinimumSize = new Size(960, 640); Size = new Size(1440, 940); StartPosition = FormStartPosition.CenterScreen;
        BackColor = Color.FromArgb(24, 26, 32);
        Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
        RestoreWindow();
        Controls.Add(status); Controls.Add(view);
        HandleCreated += (_, _) => ApplyNativeTheme();
        Shown += (_, _) => { startTask = StartAsync(); };
        FormClosing += OnClosingAsync;
        healthTimer.Tick += (_, _) => { if (ready && !runtime.IsAlive && !closing) { ready = false; ShowFailure(StartupDiagnostics.Describe(dataDir, "Server đã dừng. Đóng và mở lại Agent Fleet.", null)); healthTimer.Stop(); } };
    }

    private async Task StartAsync()
    {
        try
        {
            status.Text = "Đang khởi động môi trường làm việc…";
            try { await runtime.StartAsync(); }
            catch (Exception startError) { await ReportStartFailureAsync(startError); return; }
            sampler.Start();
            status.Text = "Đang mở giao diện…";
            var environment = await CoreWebView2Environment.CreateAsync(null, Path.Combine(dataDir, "WebView2"));
            await view.EnsureCoreWebView2Async(environment);
            view.CoreWebView2.Settings.AreDevToolsEnabled = false;
            view.CoreWebView2.Settings.IsStatusBarEnabled = false;
            view.CoreWebView2.Settings.AreDefaultScriptDialogsEnabled = true;
            var marker = JsonSerializer.Serialize(new { version = "2.6.0", platform = "win32", theme = preferences.Theme, layout = preferences.Layout }, new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase });
            await view.CoreWebView2.AddScriptToExecuteOnDocumentCreatedAsync($"window.__FLEET_DESKTOP__ = Object.freeze({marker}); window.dispatchEvent(new Event('fleet:desktop-ready'));");
            view.CoreWebView2.NavigationStarting += (_, e) =>
            {
                if (e.Uri == "about:blank" || IsTrusted(e.Uri)) return;
                e.Cancel = true;
                if (e.IsUserInitiated) OpenExternal(e.Uri);
            };
            view.CoreWebView2.NewWindowRequested += (_, e) => { e.Handled = true; if (e.IsUserInitiated) OpenExternal(e.Uri); };
            view.CoreWebView2.PermissionRequested += (_, e) => e.State =
                e.PermissionKind == CoreWebView2PermissionKind.ClipboardRead && e.IsUserInitiated && IsTrusted(e.Uri)
                    ? CoreWebView2PermissionState.Allow : CoreWebView2PermissionState.Deny;
            view.CoreWebView2.DownloadStarting += (_, e) =>
            {
                var source = e.DownloadOperation.Uri;
                if (!IsTrusted(source) && !source.StartsWith("blob:" + runtime.BaseUrl + "/", StringComparison.Ordinal)) { e.Cancel = true; return; }
                using var dialog = new SaveFileDialog { FileName = Path.GetFileName(e.ResultFilePath), Title = "Lưu báo cáo Agent Fleet", OverwritePrompt = true };
                if (dialog.ShowDialog(this) != DialogResult.OK) { e.Cancel = true; return; }
                e.ResultFilePath = dialog.FileName; e.Handled = true;
            };
            view.CoreWebView2.WebMessageReceived += OnMessageAsync;
            view.CoreWebView2.NavigationCompleted += async (_, e) =>
            {
                if (!e.IsSuccess) { status.Text = $"Không tải được giao diện: {e.WebErrorStatus}"; return; }
                if (!IsTrusted(view.Source?.AbsoluteUri ?? "")) return;
                ready = true; view.Visible = true; status.Visible = false; healthTimer.Start();
                if (smokeTest && !closing) await RunSmokeTestAsync();
            };
            view.CoreWebView2.Navigate($"{runtime.BaseUrl}/auth?token={Uri.EscapeDataString(runtime.Token)}");
        }
        catch (WebView2RuntimeNotFoundException error)
        {
            status.Text = "Máy chưa có Microsoft Edge WebView2 Runtime.\nCài Evergreen Runtime từ Microsoft rồi mở lại ứng dụng.";
            File.AppendAllText(Path.Combine(dataDir, "desktop.log"), error + "\n");
            if (smokeTest) { Environment.ExitCode = 1; await sampler.DisposeAsync(); await runtime.DisposeAsync(); allowClose = true; Close(); }
        }
        catch (Exception error)
        {
            status.Text = $"Không thể mở ứng dụng.\n{error.Message}";
            File.AppendAllText(Path.Combine(dataDir, "desktop.log"), error + "\n");
            if (smokeTest) { Environment.ExitCode = 1; await sampler.DisposeAsync(); await runtime.DisposeAsync(); allowClose = true; Close(); }
        }
    }

    private void ShowFailure(string text)
    {
        status.Font = new Font("Segoe UI", 10);
        status.Text = text;
        view.Visible = false; status.Visible = true;
    }

    /// <summary>Shows the cause (startup-error.json, else the redacted log tail) and offers a repair for a corrupt database.</summary>
    private async Task ReportStartFailureAsync(Exception error)
    {
        try { File.AppendAllText(Path.Combine(dataDir, "desktop.log"), error + "\n"); } catch (IOException) { }
        var text = StartupDiagnostics.Describe(dataDir, "Không thể khởi động server.", error.Message);
        ShowFailure(text);
        if (smokeTest) { Environment.ExitCode = 1; await sampler.DisposeAsync(); await runtime.DisposeAsync(); allowClose = true; Close(); return; }
        if (StartupDiagnostics.ReadStartupError(dataDir)?.Code != "db_corrupt") return;
        // Never repair without an explicit yes.
        var answer = MessageBox.Show(this, text + "\n\nSao lưu rồi sửa database?", "Agent Fleet", MessageBoxButtons.YesNo, MessageBoxIcon.Warning, MessageBoxDefaultButton.Button2);
        if (answer != DialogResult.Yes) return;
        status.Text = "Đang sao lưu và sửa database…";
        try
        {
            var (exitCode, output) = await runtime.RepairDatabaseAsync();
            MessageBox.Show(this, (exitCode == 0 ? "Đã sửa database." : $"Sửa database thất bại (mã {exitCode}).") + "\n\n" + output, "Agent Fleet", MessageBoxButtons.OK, exitCode == 0 ? MessageBoxIcon.Information : MessageBoxIcon.Error);
            if (exitCode == 0) { status.Font = new Font("Segoe UI", 14); status.Text = "Đang khởi động lại…"; await StartAsync(); return; }
        }
        catch (Exception repairError)
        {
            MessageBox.Show(this, $"Không sửa được database: {StartupDiagnostics.Redact(repairError.Message)}", "Agent Fleet", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
        ShowFailure(text);
    }

    private bool IsTrusted(string source) => Uri.TryCreate(source, UriKind.Absolute, out var uri) && uri.GetLeftPart(UriPartial.Authority) == runtime.BaseUrl;

    private async void OnMessageAsync(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        if (!IsTrusted(e.Source)) return;
        string? requestId = null;
        try
        {
            using var document = JsonDocument.Parse(e.WebMessageAsJson);
            var request = document.RootElement;
            if (!request.TryGetProperty("type", out var type)) return;
            if (type.GetString() == "fleet:set-theme")
            {
                preferences.SetTheme(request.GetProperty("theme").GetString() ?? "system");
                ApplyNativeTheme(); return;
            }
            if (type.GetString() == "fleet:set-layout")
            {
                preferences.SetLayout(request.GetProperty("layout"));
                return;
            }
            if (type.GetString() != "fleet:open-path") return;
            requestId = request.TryGetProperty("requestId", out var requestIdElement) ? requestIdElement.GetString() : null;
            if (requestId is not { Length: > 0 and <= 100 }) throw new InvalidOperationException("Request không hợp lệ.");
            await new PathBridge(runtime).OpenAsync(request);
            view.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(new { type = "fleet:native-result", requestId, ok = true }));
        }
        catch (Exception error)
        {
            view.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(new { type = "fleet:native-result", requestId, ok = false, error = error.Message }));
        }
    }

    private static void OpenExternal(string url)
    {
        if (Uri.TryCreate(url, UriKind.Absolute, out var uri) && uri.Scheme is "http" or "https")
            Process.Start(new ProcessStartInfo(uri.AbsoluteUri) { UseShellExecute = true });
    }

    private void ApplyNativeTheme()
    {
        var dark = preferences.IsDark() ? 1 : 0;
        NativeMethods.DwmSetWindowAttribute(Handle, 20, ref dark, 4);
        view.DefaultBackgroundColor = dark == 1 ? Color.FromArgb(24, 26, 32) : Color.FromArgb(248, 249, 252);
    }

    private async void OnClosingAsync(object? sender, FormClosingEventArgs e)
    {
        if (allowClose) return;
        e.Cancel = true;
        if (closing) return;
        closing = true;
        try
        {
            if (startTask != null) await startTask;
            if (runtime.IsAlive)
            {
                try
                {
                    var count = await runtime.ActiveTaskCountAsync();
                    if (count > 0 && MessageBox.Show(this, $"Có {count} task hoặc phiên CLI đang mở. Đóng ứng dụng sẽ dừng các tiến trình này.\n\nĐóng và dừng công việc?", "Agent Fleet", MessageBoxButtons.YesNo, MessageBoxIcon.Warning, MessageBoxDefaultButton.Button2) != DialogResult.Yes)
                    { closing = false; return; }
                }
                catch
                {
                    if (MessageBox.Show(this, "Không kiểm tra được task đang chạy. Đóng ứng dụng có thể dừng công việc.\n\nVẫn đóng?", "Agent Fleet", MessageBoxButtons.YesNo, MessageBoxIcon.Warning, MessageBoxDefaultButton.Button2) != DialogResult.Yes)
                    { closing = false; return; }
                }
            }
            try { SaveWindow(); } catch (Exception error) { Debug.WriteLine(error); }
            healthTimer.Stop();
            try { await sampler.DisposeAsync(); }
            finally { try { await runtime.DisposeAsync(); } finally { view.Dispose(); } }
            allowClose = true; Close();
        }
        catch (Exception error) { closing = false; Program.ReportFailure(dataDir, error); }
    }

    private async Task RunSmokeTestAsync()
    {
        if (closing) return;
        try
        {
            for (var attempt = 0; attempt < 60; attempt++)
            {
                var found = await view.CoreWebView2.ExecuteScriptAsync("!!document.querySelector('.app')");
                if (found == "true") break;
                await Task.Delay(250);
                if (attempt == 59) throw new InvalidOperationException("React root did not render.");
            }
            if (Environment.GetEnvironmentVariable("FLEET_SMOKE_CLI_TESTS") == "1") await RunCliSmokeTestsAsync();
            if (Environment.GetEnvironmentVariable("FLEET_SMOKE_CHECK_ALL") == "1") await RunCheckAllSmokeTestAsync();
            await Task.Delay(16000);
            var observation = await runtime.GetAsync("/api/observability");
            if (observation.GetProperty("resource").GetProperty("scope").GetString() != "desktop-process-tree")
                throw new InvalidOperationException("Native resource sample did not reach observability API.");
            await File.WriteAllTextAsync(Path.Combine(dataDir, "desktop-observability.json"), observation.GetRawText());
            var result = await view.CoreWebView2.ExecuteScriptAsync("JSON.stringify({title:document.title,app:!!document.querySelector('.app'),bridge:!!window.__FLEET_DESKTOP__,initialTheme:window.__FLEET_DESKTOP__?.theme,renderedTheme:document.documentElement.dataset.theme,url:location.origin})");
            await File.WriteAllTextAsync(Path.Combine(dataDir, "desktop-smoke.json"), JsonSerializer.Deserialize<string>(result));
            await view.CoreWebView2.ExecuteScriptAsync("window.chrome.webview.postMessage({type:'fleet:set-theme',theme:'dark'})");
            await Task.Delay(100);
            if (preferences.Theme != "dark") throw new InvalidOperationException("Native theme persistence failed.");
            await using var capture = File.Create(Path.Combine(dataDir, "desktop-smoke.png"));
            await view.CoreWebView2.CapturePreviewAsync(CoreWebView2CapturePreviewImageFormat.Png, capture);
        }
        catch (Exception error)
        {
            Environment.ExitCode = 1;
            await File.WriteAllTextAsync(Path.Combine(dataDir, "desktop-smoke-error.txt"), error.ToString());
            try
            {
                await using var failedCapture = File.Create(Path.Combine(dataDir, "desktop-smoke-failed.png"));
                await view.CoreWebView2.CapturePreviewAsync(CoreWebView2CapturePreviewImageFormat.Png, failedCapture);
                var dashboard = await runtime.GetAsync("/api/dashboard");
                foreach (var session in dashboard.GetProperty("terminalSessions").EnumerateArray())
                {
                    using var deleted = await runtime.Client.DeleteAsync($"{runtime.BaseUrl}/api/terminal-sessions/{session.GetProperty("id").GetString()}");
                }
            }
            catch { /* preserve the original failure */ }
        }
        finally { Close(); }
    }

    // Opt-in check of the real "Kiểm tra tất cả" button. Never runs on a normal
    // launch; requires both --smoke-test and FLEET_SMOKE_CHECK_ALL=1.
    private async Task RunCheckAllSmokeTestAsync()
    {
        var agents = new[] { "codex", "qodercli", "agy", "opencode" };
        await ClickSmokeButtonAsync("VI");
        await Task.Delay(100);
        await ClickSmokeButtonAsync("Bảng điều khiển");
        var started = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        await ClickSmokeButtonAsync("Kiểm tra tất cả");
        var pending = new HashSet<string>(agents);
        var checks = new Dictionary<string, JsonElement>();
        // Bounded at ~7.5 minutes: real status/usage probes can be slow, and a
        // hung CLI must fail the smoke test rather than wait forever.
        for (var attempt = 0; attempt < 900 && pending.Count > 0; attempt++)
        {
            var dashboard = await runtime.GetAsync("/api/dashboard");
            foreach (var tool in dashboard.GetProperty("tools").EnumerateArray())
            {
                var agent = tool.GetProperty("agent").GetString() ?? string.Empty;
                if (!pending.Contains(agent)) continue;
                var current = tool.GetProperty("lastCheck");
                if (current.ValueKind == JsonValueKind.Object && current.GetProperty("checkedAt").GetInt64() >= started)
                {
                    checks[agent] = current.Clone();
                    pending.Remove(agent);
                }
            }
            if (pending.Count > 0) await Task.Delay(500);
        }
        if (pending.Count > 0) throw new InvalidOperationException($"Check All did not complete for: {string.Join(", ", pending)}");
        foreach (var agent in agents)
        {
            // Never weaken the manual-check policy: every real CLI must report ready.
            if (checks[agent].GetProperty("status").GetString() != "ready") throw new InvalidOperationException($"CLI {agent} Check All result was not ready.");
        }
        await Task.Delay(750);
        // Keep account identifiers out of the stored evidence image; plan, quota
        // and status stay visible. This only affects the screenshot, never the checks.
        await view.CoreWebView2.ExecuteScriptAsync("document.querySelectorAll('.tool-account').forEach(el=>{el.textContent='Đã ẩn trong ảnh kiểm chứng';})");
        await using (var capture = File.Create(Path.Combine(dataDir, "desktop-check-all.png")))
            await view.CoreWebView2.CapturePreviewAsync(CoreWebView2CapturePreviewImageFormat.Png, capture);
        // Store a redacted summary only; probe output and account identifiers stay out of evidence.
        var summary = agents.Select(agent => new
        {
            agent,
            status = checks[agent].GetProperty("status").GetString(),
            checkedAt = checks[agent].GetProperty("checkedAt").GetInt64(),
            plan = checks[agent].TryGetProperty("plan", out var plan) && plan.ValueKind == JsonValueKind.Object ? plan.GetProperty("name").GetString() : null,
            tier = checks[agent].TryGetProperty("plan", out var tiered) && tiered.ValueKind == JsonValueKind.Object && tiered.TryGetProperty("tier", out var tierValue) ? tierValue.GetString() : null,
            quotaWindows = checks[agent].TryGetProperty("quotaWindows", out var windows) && windows.ValueKind == JsonValueKind.Array ? windows.GetArrayLength() : 0,
            models = checks[agent].TryGetProperty("models", out var models) && models.ValueKind == JsonValueKind.Array ? models.GetArrayLength() : 0,
            keyPools = checks[agent].TryGetProperty("keyPools", out var pools) && pools.ValueKind == JsonValueKind.Array ? pools.GetArrayLength() : 0,
        }).ToArray();
        await File.WriteAllTextAsync(Path.Combine(dataDir, "desktop-check-all.json"), JsonSerializer.Serialize(new { checkedAll = "passed", agents = summary }));
    }

    // Opt-in integration check in the real WebView2 host. Never runs on a normal
    // launch; requires both --smoke-test and FLEET_SMOKE_CLI_TESTS=1.
    private async Task RunCliSmokeTestsAsync()
    {
        var reports = new List<object>();
        await ClickSmokeButtonAsync("VI");
        await Task.Delay(100);
        foreach (var (agent, title) in new[] { ("codex", "Codex"), ("qodercli", "Qoder CLI"), ("agy", "Antigravity (AGY)"), ("opencode", "OpenCode") })
        {
            var started = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            await ClickSmokeButtonAsync("Terminal");
            await ClickSmokeButtonAsync("Mở " + title);
            var settled = await WaitForSettledFrameAsync(agent, title);
            await Task.Delay(1500);
            // Verify AGAIN at capture: a late navigation must not produce a blank image.
            var atCapture = SmokeFrame.Evaluate(title, await view.CoreWebView2.ExecuteScriptAsync(SmokeFrame.SnapshotScript(title)));
            if (!atCapture.Ready) throw new InvalidOperationException($"CLI {agent} was not readable at capture time (tab: {atCapture.TabLabel}).");
            await using (var capture = File.Create(Path.Combine(dataDir, $"native-cli-{agent}.png")))
                await view.CoreWebView2.CapturePreviewAsync(CoreWebView2CapturePreviewImageFormat.Png, capture);
            var dashboard = await runtime.GetAsync("/api/dashboard");
            var sessions = dashboard.GetProperty("terminalSessions").EnumerateArray().Where(s => s.GetProperty("agent").GetString() == agent).Select(s => s.GetProperty("id").GetString()).ToArray();
            foreach (var id in sessions)
            {
                using var deleted = await runtime.Client.DeleteAsync($"{runtime.BaseUrl}/api/terminal-sessions/{id}");
                deleted.EnsureSuccessStatusCode();
            }
            await ClickSmokeButtonAsync("Bảng điều khiển");
            // Exercise the real manual-check button and await its new result.
            await ClickSmokeButtonAsync("Kiểm tra " + title);
            JsonElement check = default;
            for (var attempt = 0; attempt < 130; attempt++)
            {
                dashboard = await runtime.GetAsync("/api/dashboard");
                var tool = dashboard.GetProperty("tools").EnumerateArray().First(t => t.GetProperty("agent").GetString() == agent);
                var current = tool.GetProperty("lastCheck");
                if (current.ValueKind == JsonValueKind.Object && current.GetProperty("checkedAt").GetInt64() >= started) { check = current.Clone(); break; }
                await Task.Delay(250);
            }
            if (check.ValueKind != JsonValueKind.Object) throw new InvalidOperationException($"CLI {agent} manual check did not complete.");
            if (check.GetProperty("status").GetString() != "ready") throw new InvalidOperationException($"CLI {agent} check was not ready.");
            if (agent == "codex" && check.GetProperty("quota").GetProperty("remaining").ValueKind != JsonValueKind.Number) throw new InvalidOperationException("Codex quota missing.");
            if (agent == "qodercli" && check.GetProperty("credits").GetProperty("remaining").ValueKind != JsonValueKind.Number) throw new InvalidOperationException("Qoder credits missing.");
            if (agent == "agy" && check.GetProperty("quotas").GetArrayLength() < 5) throw new InvalidOperationException("AGY model-group quotas missing.");
            reports.Add(new { agent, rendered = true, frameLines = atCapture.Lines, settledLines = settled.Lines, manualCheck = "passed", quota = check.GetProperty("quota"), credits = check.GetProperty("credits"), quotas = check.GetProperty("quotas") });
            await File.WriteAllTextAsync(Path.Combine(dataDir, "native-cli-results.json"), JsonSerializer.Serialize(reports));
        }
    }

    /// <summary>
    /// Wait for the EXPECTED CLI's own readable frame and require it to be stable
    /// across two samples. The tab title must match, so the previous CLI that is
    /// still visible during a React tab transition can never satisfy the check.
    /// Bounded at 40s: slow CLIs (Qoder needs ~2s) pass, a hung one fails.
    /// </summary>
    private async Task<CliFrameState> WaitForSettledFrameAsync(string agent, string title)
    {
        var deadline = DateTime.UtcNow.AddSeconds(40);
        var previous = new CliFrameState(false, 0, string.Empty, string.Empty);
        var last = previous;
        while (DateTime.UtcNow < deadline)
        {
            last = SmokeFrame.Evaluate(title, await view.CoreWebView2.ExecuteScriptAsync(SmokeFrame.SnapshotScript(title)));
            if (SmokeFrame.IsSettled(previous, last)) return last;
            previous = last;
            await Task.Delay(400);
        }
        throw new InvalidOperationException($"CLI {agent} did not render a readable, settled frame within 40s (tab: {last.TabLabel}, lines: {last.Lines}).");
    }

    private async Task ClickSmokeButtonAsync(string label)
    {
        // React's root can render before the asynchronous dashboard GET completes.
        for (var attempt = 0; attempt < 60; attempt++)
        {
            var clicked = await view.CoreWebView2.ExecuteScriptAsync($"(()=>{{const b=Array.from(document.querySelectorAll('button')).find(b=>b.getClientRects().length&&(b.getAttribute('aria-label')==={JsonSerializer.Serialize(label)}||b.textContent.trim()==={JsonSerializer.Serialize(label)}));if(!b||b.disabled)return false;b.scrollIntoView({{block:'center'}});b.click();return true}})()");
            if (clicked == "true") return;
            await Task.Delay(250);
        }
        throw new InvalidOperationException($"Smoke button not ready: {label}");
    }

    private void RestoreWindow()
    {
        try
        {
            var file = Path.Combine(dataDir, "window.json");
            if (!File.Exists(file)) return;
            using var document = JsonDocument.Parse(File.ReadAllText(file));
            var root = document.RootElement;
            var rectangle = new Rectangle(root.GetProperty("x").GetInt32(), root.GetProperty("y").GetInt32(), Math.Clamp(root.GetProperty("width").GetInt32(), 960, 7680), Math.Clamp(root.GetProperty("height").GetInt32(), 640, 4320));
            if (Screen.AllScreens.Any(screen => screen.WorkingArea.IntersectsWith(rectangle))) { StartPosition = FormStartPosition.Manual; Bounds = rectangle; }
            if (root.TryGetProperty("maximized", out var maximized) && maximized.GetBoolean()) WindowState = FormWindowState.Maximized;
        }
        catch { }
    }

    private void SaveWindow()
    {
        var bounds = WindowState == FormWindowState.Normal ? Bounds : RestoreBounds;
        File.WriteAllText(Path.Combine(dataDir, "window.json"), JsonSerializer.Serialize(new { x = bounds.X, y = bounds.Y, width = bounds.Width, height = bounds.Height, maximized = WindowState == FormWindowState.Maximized }));
    }
}
