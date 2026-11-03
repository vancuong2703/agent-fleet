using System.Runtime.InteropServices;
using System.Text.RegularExpressions;
using System.Diagnostics;
using System.Globalization;

namespace FleetDesktop;

/// <summary>Windows driver GPU counters, sampled in-process without polling a shell.</summary>
internal sealed class GpuSampler : IDisposable
{
    private IntPtr query;
    private IntPtr engineCounter;
    private IntPtr memoryCounter;
    private bool initialized;
    private DateTimeOffset nextNvidiaSample;
    private object? cachedNvidia;
    private static readonly Regex Pid = new(@"(?:^|_)pid_(\d+)_", RegexOptions.Compiled | RegexOptions.CultureInvariant);
    internal GpuSampler()
    {
        if (PdhOpenQuery(null, IntPtr.Zero, out query) != 0) { query = IntPtr.Zero; return; }
        if (PdhAddEnglishCounter(query, @"\GPU Engine(*)\Utilization Percentage", IntPtr.Zero, out engineCounter) != 0) engineCounter = IntPtr.Zero;
        if (PdhAddEnglishCounter(query, @"\GPU Process Memory(*)\Dedicated Usage", IntPtr.Zero, out memoryCounter) != 0) memoryCounter = IntPtr.Zero;
        if (engineCounter == IntPtr.Zero && memoryCounter == IntPtr.Zero) Dispose();
    }

    internal object? Sample(HashSet<int> pids)
    {
        if (query == IntPtr.Zero || PdhCollectQueryData(query) != 0) return SampleNvidia();
        if (!initialized) { initialized = true; return null; }
        var engines = Read(engineCounter);
        var memories = Read(memoryCounter);
        if (engines == null && memories == null) return SampleNvidia();
        var utilizationByEngine = new Dictionary<string, double>();
        if (engines != null)
        {
            foreach (var (name, value) in engines)
            {
                var match = Pid.Match("_" + name);
                if (!match.Success || !int.TryParse(match.Groups[1].Value, out var pid) || !pids.Contains(pid)) continue;
                var engineName = Pid.Replace("_" + name, "_");
                utilizationByEngine[engineName] = utilizationByEngine.GetValueOrDefault(engineName) + Math.Max(0, value);
            }
        }
        double memory = 0;
        if (memories != null)
        {
            foreach (var (name, value) in memories)
            {
                var match = Pid.Match("_" + name);
                if (match.Success && int.TryParse(match.Groups[1].Value, out var pid) && pids.Contains(pid)) memory += Math.Max(0, value);
            }
        }
        return new
        {
            name = "Windows GPU · busiest engine",
            scope = "desktop-process-tree",
            utilizationPercent = engines == null ? (double?)null : Math.Clamp(utilizationByEngine.Values.DefaultIfEmpty(0).Max(), 0, 100),
            memoryBytes = memories == null ? (long?)null : (long)Math.Round(memory)
        };
    }

    private object? SampleNvidia()
    {
        if (DateTimeOffset.UtcNow < nextNvidiaSample) return cachedNvidia;
        nextNvidiaSample = DateTimeOffset.UtcNow.AddSeconds(15);
        cachedNvidia = null;
        var executable = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), "nvidia-smi.exe");
        if (!File.Exists(executable)) return null;
        try
        {
            var start = new ProcessStartInfo(executable) { UseShellExecute = false, CreateNoWindow = true, WindowStyle = ProcessWindowStyle.Hidden, RedirectStandardOutput = true, RedirectStandardError = true };
            start.ArgumentList.Add("--query-gpu=name,utilization.gpu,memory.used");
            start.ArgumentList.Add("--format=csv,noheader,nounits");
            using var process = Process.Start(start);
            if (process == null) return null;
            var output = process.StandardOutput.ReadToEndAsync();
            var error = process.StandardError.ReadToEndAsync();
            if (!process.WaitForExit(1500)) { process.Kill(entireProcessTree: true); return null; }
            if (process.ExitCode != 0) return null;
            var adapters = output.GetAwaiter().GetResult().Split('\n', StringSplitOptions.RemoveEmptyEntries).Select(line => line.Split(',').Select(value => value.Trim()).ToArray()).ToArray();
            if (adapters.Length == 0 || adapters.Any(row => row.Length != 3)) return null;
            var utilization = new List<double>();
            var memories = new List<double>();
            foreach (var adapter in adapters)
            {
                if (double.TryParse(adapter[1], CultureInfo.InvariantCulture, out var usage) && usage >= 0 && usage <= 100) utilization.Add(usage);
                if (double.TryParse(adapter[2], CultureInfo.InvariantCulture, out var megabytes) && megabytes >= 0) memories.Add(megabytes * 1048576);
            }
            cachedNvidia = new
            {
                name = string.Join(" + ", adapters.Select(row => row[0])), scope = "system",
                utilizationPercent = utilization.Count > 0 ? (double?)utilization.Max() : null,
                memoryBytes = memories.Count > 0 ? (long?)Math.Round(memories.Sum()) : null
            };
        }
        catch { cachedNvidia = null; }
        return cachedNvidia;
    }

    private static List<(string Name, double Value)>? Read(IntPtr counter)
    {
        if (counter == IntPtr.Zero) return null;
        uint bytes = 0, count = 0;
        var result = PdhGetFormattedCounterArray(counter, 0x200, ref bytes, out count, IntPtr.Zero);
        if (result != 0x800007D2 || bytes == 0 || bytes > 16 * 1024 * 1024) return null;
        var buffer = Marshal.AllocHGlobal((int)bytes);
        try
        {
            if (PdhGetFormattedCounterArray(counter, 0x200, ref bytes, out count, buffer) != 0) return null;
            var values = new List<(string, double)>();
            var itemSize = Marshal.SizeOf<CounterItem>();
            for (var index = 0; index < count; index++)
            {
                var item = Marshal.PtrToStructure<CounterItem>(buffer + checked(index * itemSize));
                if (item.Value.Status > 1 || !double.IsFinite(item.Value.Number)) continue;
                var name = Marshal.PtrToStringUni(item.Name);
                if (name != null) values.Add((name, item.Value.Number));
            }
            return values;
        }
        finally { Marshal.FreeHGlobal(buffer); }
    }

    public void Dispose() { if (query != IntPtr.Zero) { PdhCloseQuery(query); query = IntPtr.Zero; } }
    [StructLayout(LayoutKind.Sequential)] private struct CounterValue { internal uint Status; internal double Number; }
    [StructLayout(LayoutKind.Sequential)] private struct CounterItem { internal IntPtr Name; internal CounterValue Value; }
    [DllImport("pdh.dll", CharSet = CharSet.Unicode)] private static extern uint PdhOpenQuery(string? source, IntPtr data, out IntPtr query);
    [DllImport("pdh.dll", CharSet = CharSet.Unicode)] private static extern uint PdhAddEnglishCounter(IntPtr query, string path, IntPtr data, out IntPtr counter);
    [DllImport("pdh.dll")] private static extern uint PdhCollectQueryData(IntPtr query);
    [DllImport("pdh.dll", EntryPoint = "PdhGetFormattedCounterArrayW")] private static extern uint PdhGetFormattedCounterArray(IntPtr counter, uint format, ref uint bytes, out uint count, IntPtr buffer);
    [DllImport("pdh.dll")] private static extern uint PdhCloseQuery(IntPtr query);
}
