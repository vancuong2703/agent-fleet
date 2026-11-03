using System.Diagnostics;
using System.Text.Json;

namespace FleetDesktop;

internal sealed class ResourceSampler(string dataDir, Func<IReadOnlySet<int>> ownedProcesses) : IAsyncDisposable
{
    private readonly CancellationTokenSource stop = new();
    private readonly Dictionary<(int Pid, long Started), double> previous = new();
    private Task? loop;
    private long peakMemory;
    private double totalCpu;
    private long previousStamp;
    private readonly GpuSampler gpu = new();
    private static readonly JsonSerializerOptions JsonOptions = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };

    internal void Start() { loop = Task.Run(RunAsync); }

    private async Task RunAsync()
    {
        while (!stop.IsCancellationRequested)
        {
            try { await SampleAsync(); }
            catch (Exception error) when (error is not OperationCanceledException) { Debug.WriteLine(error); }
            try { await Task.Delay(4000, stop.Token); } catch (OperationCanceledException) { break; }
        }
    }

    private async Task SampleAsync()
    {
        var stamp = Stopwatch.GetTimestamp();
        var elapsedMs = previousStamp == 0 ? 0 : Stopwatch.GetElapsedTime(previousStamp, stamp).TotalMilliseconds;
        var parents = NativeMethods.Parents();
        var included = new HashSet<int> { Environment.ProcessId };
        var added = true;
        while (added)
        {
            added = false;
            foreach (var (pid, parent) in parents) if (included.Contains(parent) && included.Add(pid)) added = true;
        }
        included.UnionWith(ownedProcesses());
        long memory = 0;
        long privateMemory = 0;
        double deltaCpu = 0;
        var processes = new List<object>();
        var currentKeys = new HashSet<(int Pid, long Started)>();
        foreach (var pid in included)
        {
            try
            {
                using var process = Process.GetProcessById(pid);
                var startedAt = new DateTimeOffset(process.StartTime.ToUniversalTime()).ToUnixTimeMilliseconds();
                var cpu = process.TotalProcessorTime.TotalMilliseconds;
                var key = (pid, startedAt);
                currentKeys.Add(key);
                var hasPrevious = previous.TryGetValue(key, out var lastCpu);
                var delta = Math.Max(0, cpu - (hasPrevious ? lastCpu : 0));
                previous[key] = cpu;
                deltaCpu += delta;
                var bytes = process.WorkingSet64;
                var privateBytes = process.PrivateMemorySize64;
                memory += bytes;
                privateMemory += privateBytes;
                double? cpuPercent = elapsedMs > 0 ? Math.Clamp(delta / elapsedMs / Environment.ProcessorCount * 100, 0, 100) : null;
                processes.Add(new { pid, parentPid = parents.GetValueOrDefault(pid), name = process.ProcessName, startedAt, cpuTimeMs = cpu, cpuPercent, memoryBytes = bytes, privateMemoryBytes = privateBytes });
            }
            catch (Exception error) when (error is InvalidOperationException or System.ComponentModel.Win32Exception or ArgumentException) { }
        }
        foreach (var oldKey in previous.Keys.Where(key => !currentKeys.Contains(key)).ToArray()) previous.Remove(oldKey);
        totalCpu += deltaCpu;
        peakMemory = Math.Max(peakMemory, memory);
        var sample = new
        {
            sampledAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(), scope = "desktop-process-tree",
            cpuPercent = elapsedMs > 0 ? (double?)Math.Clamp(deltaCpu / elapsedMs / Environment.ProcessorCount * 100, 0, 100) : null,
            memoryBytes = memory, privateMemoryBytes = privateMemory, peakMemoryBytes = peakMemory, cpuTimeMs = totalCpu, processCount = processes.Count,
            gpu = gpu.Sample(included), processes
        };
        previousStamp = stamp;
        var temporary = Path.Combine(dataDir, "resources.json.tmp");
        await File.WriteAllTextAsync(temporary, JsonSerializer.Serialize(sample, JsonOptions), stop.Token);
        File.Move(temporary, Path.Combine(dataDir, "resources.json"), overwrite: true);
    }

    public async ValueTask DisposeAsync()
    {
        stop.Cancel();
        if (loop != null) { try { await loop; } catch (OperationCanceledException) { } }
        gpu.Dispose();
        stop.Dispose();
    }
}
