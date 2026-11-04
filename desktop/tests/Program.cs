using System.Text.Json;
using FleetDesktop;
using System.Net;
using System.Net.Sockets;
using System.Diagnostics;

var testRoot = Path.GetFullPath(Path.Combine(Environment.CurrentDirectory, ".tmp", "desktop-path-tests-" + Guid.NewGuid().ToString("N")));
Directory.CreateDirectory(Path.Combine(testRoot, "src"));
File.WriteAllText(Path.Combine(testRoot, "src", "main.ts"), "test");
var checkedCases = 0;
void Accept(string relative, string expected)
{
    var result = PathBridge.ResolveSafePath(testRoot, relative);
    if (result != Path.GetFullPath(Path.Combine(testRoot, expected))) throw new Exception($"Unexpected path {result}");
    checkedCases++;
}
void Reject(string relative)
{
    try { PathBridge.ResolveSafePath(testRoot, relative); }
    catch (Exception error) when (error is InvalidOperationException or FileNotFoundException) { checkedCases++; return; }
    throw new Exception($"Unsafe path accepted: {relative}");
}
Accept("", ""); Accept("src", "src"); Accept("src/main.ts", "src/main.ts");
Reject("../outside"); Reject("src/../../outside"); Reject("C:\\Windows");
Reject("\\\\localhost\\share"); Reject("src/main.ts:stream"); Reject("bad\"path"); Reject("not-present");
var canonical = DesktopDataDirectory.Resolve(testRoot);
if (DesktopDataDirectory.Resolve(testRoot + Path.DirectorySeparatorChar) != canonical) throw new Exception("Trailing separator changed directory identity");
checkedCases++;
using (var listener = new TcpListener(IPAddress.Loopback, 0))
{
    listener.Start();
    var port = ((IPEndPoint)listener.LocalEndpoint).Port;
    if (!NativeMethods.ListenerOwnedBy(port, Environment.ProcessId)) throw new Exception("Listener PID ownership check failed");
    if (NativeMethods.ListenerOwnedBy(port, Environment.ProcessId + 1000000)) throw new Exception("Foreign listener PID accepted");
    checkedCases += 2;
}
var pingPath = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), "ping.exe");
using (var child = Process.Start(new ProcessStartInfo(pingPath) { Arguments = "-n 30 127.0.0.1", UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true })!)
{
    using (var job = new OwnedProcessJob())
    {
        job.Assign(child);
        if (!job.ProcessIds().Contains(child.Id)) throw new Exception("Owned job did not enumerate child PID");
        checkedCases++;
    }
    if (!child.WaitForExit(5000)) { child.Kill(); throw new Exception("Kill-on-job-close left owned child running"); }
    checkedCases++;
}
// The cleanup target is checked before recursive removal.
var preferences = new DesktopPreferences(testRoot);
preferences.SetTheme("dark");
using (var layout = JsonDocument.Parse("{\"sidebarWidth\":350,\"inspectorWidth\":400,\"terminalHeight\":620}")) preferences.SetLayout(layout.RootElement);
var restoredPreferences = new DesktopPreferences(testRoot);
restoredPreferences.Load();
if (restoredPreferences.Theme != "dark" || restoredPreferences.Layout != new DesktopLayout(350, 400, 620)) throw new Exception("Theme/layout did not persist together");
checkedCases++;
using (var layout = JsonDocument.Parse("{\"sidebarWidth\":-3,\"inspectorWidth\":9000,\"terminalHeight\":\"invalid\"}")) restoredPreferences.SetLayout(layout.RootElement);
if (restoredPreferences.Layout != new DesktopLayout(190, 520, 380)) throw new Exception("Native layout bounds failed");
checkedCases++;
// CLI smoke framing: a previous CLI's tab, a still-connecting socket and a
// blank screen must never count as the expected agent's rendered frame.
string Frame(string label, string caption, string conn, int lines, int letters, int textLen, int hash) =>
    JsonSerializer.Serialize(new { label, caption, conn, lines, letters, textLen, hash });
var readyFrame = Frame("Qoder CLI · Workspace", "Qoder CLI · C:\\ws", "Đã kết nối", 6, 240, 1200, 99);
if (SmokeFrame.Evaluate("Qoder CLI", readyFrame).Ready != true) throw new Exception("Readable expected frame rejected");
checkedCases++;
if (SmokeFrame.Evaluate("Qoder CLI", Frame("Codex · Workspace", "Codex · C:\\ws", "Đã kết nối", 6, 240, 1200, 99)).Ready) throw new Exception("Previous CLI tab accepted as expected agent");
checkedCases++;
if (SmokeFrame.Evaluate("Qoder CLI", Frame("Qoder CLI · Workspace", "Qoder CLI · C:\\ws", "Đang kết nối", 0, 0, 0, 0)).Ready) throw new Exception("Connecting socket accepted as rendered");
checkedCases++;
if (SmokeFrame.Evaluate("Qoder CLI", Frame("Qoder CLI · Workspace", "Qoder CLI · C:\\ws", "Đã kết nối", 1, 2, 12, 7)).Ready) throw new Exception("Transient loading line accepted as frame");
checkedCases++;
if (SmokeFrame.Evaluate("Qoder CLI", "not json").Ready) throw new Exception("Malformed frame snapshot accepted");
checkedCases++;
var first = SmokeFrame.Evaluate("Qoder CLI", readyFrame);
var same = SmokeFrame.Evaluate("Qoder CLI", readyFrame);
var grown = SmokeFrame.Evaluate("Qoder CLI", Frame("Qoder CLI · Workspace", "Qoder CLI · C:\\ws", "Đã kết nối", 7, 260, 1300, 101));
if (!SmokeFrame.IsSettled(first, same)) throw new Exception("Identical frames not settled");
if (SmokeFrame.IsSettled(first, grown)) throw new Exception("Growing frame treated as settled");
checkedCases += 2;
var frameScript = SmokeFrame.SnapshotScript("Qoder CLI");
if (!frameScript.Contains("\"Qoder CLI\"") || !frameScript.Contains("aria-selected") || !frameScript.Contains("terminal-connection")) throw new Exception("Frame snapshot does not pin the expected agent and connection state");
checkedCases++;
var expectedParent = Path.GetFullPath(Path.Combine(Environment.CurrentDirectory, ".tmp"));
if (Path.GetDirectoryName(testRoot) != expectedParent || !Path.GetFileName(testRoot).StartsWith("desktop-path-tests-")) throw new Exception("Unexpected cleanup target");
Directory.Delete(testRoot, recursive: true);
Console.WriteLine($"Native path policy: {checkedCases} cases passed");

namespace FleetDesktop
{
    internal sealed class FleetRuntime
    {
        internal Task<JsonElement> GetAsync(string route) => throw new NotSupportedException();
    }
}
