namespace FleetDesktop;

internal static class DesktopDataDirectory
{
    internal static string Resolve(string path)
    {
        var absolute = Path.TrimEndingDirectorySeparator(Path.GetFullPath(path));
        if (absolute.StartsWith(@"\\", StringComparison.Ordinal)) throw new InvalidOperationException("Thư mục dữ liệu phải nằm trên ổ đĩa local.");
        // Do not allow a junction alias to create a second instance for the same DB.
        for (var item = absolute; item != null; item = Path.GetDirectoryName(item))
        {
            if (Directory.Exists(item) && (File.GetAttributes(item) & FileAttributes.ReparsePoint) != 0)
                throw new InvalidOperationException("Thư mục dữ liệu không được đi qua junction hoặc symbolic link.");
        }
        Directory.CreateDirectory(absolute);
        return NativeMethods.CanonicalDirectory(absolute);
    }
}
