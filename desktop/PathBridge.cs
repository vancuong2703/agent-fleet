using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.InteropServices;
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
            // /summary does no git work, so it still answers when the worktree is gone.
            var response = await runtime.GetAsync($"/api/tasks/{Uri.EscapeDataString(taskId)}/summary");
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
        Reveal(ResolveSafePath(root, relative, fallbackToExistingParent: true));
    }

    /// <summary>Shows a file selected in Explorer, or opens a folder. Never executes a file.</summary>
    internal static void Reveal(string target)
    {
        if (Directory.Exists(target))
        {
            // Hidden/CreateNoWindow here leaves the Explorer window invisible on .NET 10.
            using var folder = Process.Start(new ProcessStartInfo(target) { UseShellExecute = true });
            return;
        }
        var hr = SelectInExplorer(target);
        if (hr == 0) return;
        var shellError = DescribeHresult(hr);
        try
        {
            var executable = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Windows), "explorer.exe");
            using var fallback = Process.Start(new ProcessStartInfo(executable) { UseShellExecute = false, Arguments = $"/select,\"{target}\"" });
        }
        catch (Exception error) when (error is Win32Exception or InvalidOperationException)
        {
            throw new InvalidOperationException($"{shellError} (dự phòng explorer.exe cũng lỗi: {error.Message})");
        }
    }

    internal static string DescribeHresult(int hr) => (uint)hr switch
    {
        0x80070002 or 0x80070003 => "Explorer báo không tìm thấy tệp hoặc thư mục này.",
        0x80070005 => "Windows từ chối quyền truy cập vị trí này.",
        0x800704C7 => "Thao tác mở vị trí đã bị huỷ.",
        0x80004005 => "Explorer không mở được vị trí này (lỗi không xác định).",
        _ => $"Explorer không mở được vị trí này (HRESULT 0x{(uint)hr:X8}).",
    };

    private static int SelectInExplorer(string path)
    {
        var parse = SHParseDisplayName(path, IntPtr.Zero, out var pidl, 0, out _);
        if (parse != 0) return parse;
        try { return SHOpenFolderAndSelectItems(pidl, 0, IntPtr.Zero, 0); }
        finally { ILFree(pidl); }
    }

    [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
    private static extern int SHParseDisplayName(string name, IntPtr bindingContext, out IntPtr pidl, uint attributesIn, out uint attributesOut);
    [DllImport("shell32.dll")]
    private static extern int SHOpenFolderAndSelectItems(IntPtr pidlFolder, uint count, IntPtr items, uint flags);
    [DllImport("shell32.dll")]
    private static extern void ILFree(IntPtr pidl);

    /// <summary>
    /// Resolves <paramref name="relative"/> inside <paramref name="root"/>. With
    /// <paramref name="fallbackToExistingParent"/>, a path that no longer exists (a file deleted in a
    /// diff) resolves to its nearest existing parent inside the root.
    /// </summary>
    internal static string ResolveSafePath(string root, string relative, bool fallbackToExistingParent = false)
    {
        if (Path.IsPathRooted(relative) || relative.Contains(':') || relative.Contains('"') || relative.Contains('\0'))
            throw new InvalidOperationException("Chỉ hỗ trợ đường dẫn tương đối trong dự án.");
        var rootPath = Path.GetFullPath(root).TrimEnd(Path.DirectorySeparatorChar);
        var target = Path.GetFullPath(Path.Combine(rootPath, relative)).TrimEnd(Path.DirectorySeparatorChar);
        if (!target.Equals(rootPath, StringComparison.OrdinalIgnoreCase) && !target.StartsWith(rootPath + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("Đường dẫn nằm ngoài dự án.");
        if (!Directory.Exists(rootPath))
            throw new FileNotFoundException("Vị trí này không còn tồn tại; worktree có thể đã được merge hoặc huỷ.");
        if (!Directory.Exists(target) && !File.Exists(target))
        {
            if (!fallbackToExistingParent)
                throw new FileNotFoundException("Vị trí này không còn tồn tại; worktree có thể đã được merge hoặc huỷ.");
            while (!target.Equals(rootPath, StringComparison.OrdinalIgnoreCase) && !Directory.Exists(target) && !File.Exists(target))
                target = Path.GetDirectoryName(target) ?? rootPath;
        }
        // Reject junction/symlink traversal inside the worktree only. Anything above the root
        // (for example a redirected profile) is outside this policy and must not block.
        for (var item = target; ; item = Path.GetDirectoryName(item)!)
        {
            if ((File.GetAttributes(item) & FileAttributes.ReparsePoint) != 0)
                throw new InvalidOperationException("Không mở đường dẫn thông qua junction hoặc symbolic link.");
            if (item.Equals(rootPath, StringComparison.OrdinalIgnoreCase)) break;
        }
        return target;
    }
}
