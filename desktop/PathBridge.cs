using System.Diagnostics;
using System.Text.Json;

namespace FleetDesktop;

internal sealed class PathBridge(FleetRuntime runtime)
{
    internal async Task OpenAsync(JsonElement request)
    {
        var action = request.TryGetProperty("action", out var actionElement) ? actionElement.GetString() : "reveal";
        if (action is not ("open" or "reveal")) throw new InvalidOperationException("Thao tác không được hỗ trợ.");
        string root;
        if (request.TryGetProperty("taskId", out var taskIdElement) && taskIdElement.GetString() is { Length: > 0 } taskId)
        {
            var response = await runtime.GetAsync($"/api/tasks/{Uri.EscapeDataString(taskId)}");
            root = response.GetProperty("task").GetProperty("worktreePath").GetString() ?? throw new InvalidOperationException("Task không có worktree.");
        }
        else if (request.TryGetProperty("planId", out var planIdElement) && planIdElement.GetString() is { Length: > 0 } planId)
        {
            var plans = await runtime.GetAsync("/api/plans");
            root = plans.EnumerateArray().Where(plan => plan.GetProperty("id").GetString() == planId)
                .Select(plan => plan.GetProperty("repoPath").GetString()).FirstOrDefault() ?? throw new InvalidOperationException("Không tìm thấy dự án.");
        }
        else throw new InvalidOperationException("Cần chọn dự án hoặc task.");
        var relative = request.TryGetProperty("relativePath", out var relativeElement) ? relativeElement.GetString() ?? "" : "";
        var target = ResolveSafePath(root, relative);
        var executable = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Windows), "explorer.exe");
        var start = new ProcessStartInfo(executable) { UseShellExecute = false, CreateNoWindow = true, WindowStyle = ProcessWindowStyle.Hidden };
        // Files are always revealed, never executed through a file association.
        if (File.Exists(target)) start.Arguments = $"/select,\"{target}\"";
        else start.ArgumentList.Add(target);
        Process.Start(start)?.Dispose();
    }

    internal static string ResolveSafePath(string root, string relative)
    {
        if (Path.IsPathRooted(relative) || relative.Contains(':') || relative.Contains('"') || relative.Contains('\0'))
            throw new InvalidOperationException("Chỉ hỗ trợ đường dẫn tương đối trong dự án.");
        var rootPath = Path.GetFullPath(root).TrimEnd(Path.DirectorySeparatorChar);
        var target = Path.GetFullPath(Path.Combine(rootPath, relative));
        if (!target.Equals(rootPath, StringComparison.OrdinalIgnoreCase) && !target.StartsWith(rootPath + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("Đường dẫn nằm ngoài dự án.");
        if (!Directory.Exists(rootPath) || (!Directory.Exists(target) && !File.Exists(target)))
            throw new FileNotFoundException("Vị trí này không còn tồn tại; worktree có thể đã được merge hoặc huỷ.");
        // Reject junction/symlink traversal, including a redirected root.
        for (var item = target; item != null; item = Path.GetDirectoryName(item))
        {
            if ((File.GetAttributes(item) & FileAttributes.ReparsePoint) != 0)
                throw new InvalidOperationException("Không mở đường dẫn thông qua junction hoặc symbolic link.");
        }
        return target;
    }
}
