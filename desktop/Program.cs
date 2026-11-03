using System.Diagnostics;
using System.Security.Cryptography;
using System.Text;

namespace FleetDesktop;

internal static class Program
{
    [STAThread]
    private static void Main(string[] args)
    {
        ApplicationConfiguration.Initialize();
        var dataArg = Array.IndexOf(args, "--data-dir");
        var dataDir = Path.GetFullPath(dataArg >= 0 && dataArg + 1 < args.Length
            ? args[dataArg + 1]
            : Environment.GetEnvironmentVariable("FLEET_DESKTOP_DATA_DIR")
                ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "AgentFleetDesktop"));
        try { dataDir = DesktopDataDirectory.Resolve(dataDir); }
        catch (Exception error) { MessageBox.Show(error.Message, "Agent Fleet", MessageBoxButtons.OK, MessageBoxIcon.Error); Environment.ExitCode = 1; return; }
        var identity = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(dataDir.ToUpperInvariant())))[..24];
        using var mutex = new Mutex(true, $"Local\\AgentFleet-{identity}", out var created);
        if (!created)
        {
            foreach (var process in Process.GetProcessesByName("AgentFleet"))
            {
                using (process)
                {
                    if (process.Id == Environment.ProcessId || process.MainWindowHandle == IntPtr.Zero) continue;
                    NativeMethods.ShowWindow(process.MainWindowHandle, 9);
                    NativeMethods.SetForegroundWindow(process.MainWindowHandle);
                }
            }
            return;
        }
        Application.ThreadException += (_, e) => ReportFailure(dataDir, e.Exception);
        AppDomain.CurrentDomain.UnhandledException += (_, e) => ReportFailure(dataDir, e.ExceptionObject as Exception ?? new Exception("Unhandled error"));
        try { Application.Run(new DesktopWindow(dataDir, args.Contains("--smoke-test"))); }
        catch (Exception error) { ReportFailure(dataDir, error); Environment.ExitCode = 1; }
    }

    internal static void ReportFailure(string dataDir, Exception error)
    {
        try { File.AppendAllText(Path.Combine(dataDir, "desktop.log"), $"{DateTimeOffset.Now:O} {error}\n"); } catch { }
        MessageBox.Show($"Không thể mở Agent Fleet.\n\n{error.Message}\n\nLog: {Path.Combine(dataDir, "desktop.log")}", "Agent Fleet", MessageBoxButtons.OK, MessageBoxIcon.Error);
    }
}
