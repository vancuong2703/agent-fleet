using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;
using System.ComponentModel;
using System.Text;

namespace FleetDesktop;

internal static class NativeMethods
{
    [DllImport("user32.dll")] internal static extern bool SetForegroundWindow(IntPtr window);
    [DllImport("user32.dll")] internal static extern bool ShowWindow(IntPtr window, int command);
    [DllImport("dwmapi.dll")] internal static extern int DwmSetWindowAttribute(IntPtr window, uint attribute, ref int value, uint size);
    [DllImport("iphlpapi.dll", SetLastError = true)] private static extern uint GetExtendedTcpTable(IntPtr table, ref int size, bool sort, int family, int tableClass, uint reserved);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern SafeFileHandle CreateFile(string name, uint access, uint share, IntPtr attributes, uint creation, uint flags, IntPtr template);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern uint GetFinalPathNameByHandle(SafeFileHandle handle, StringBuilder path, uint capacity, uint flags);
    [DllImport("kernel32.dll", SetLastError = true)] internal static extern SafeFileHandle CreateToolhelp32Snapshot(uint flags, uint processId);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] internal static extern bool Process32FirstW(SafeFileHandle snapshot, ref ProcessEntry entry);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] internal static extern bool Process32NextW(SafeFileHandle snapshot, ref ProcessEntry entry);
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    internal struct ProcessEntry
    {
        internal uint Size;
        internal uint Usage;
        internal uint ProcessId;
        internal UIntPtr DefaultHeap;
        internal uint ModuleId;
        internal uint Threads;
        internal uint ParentProcessId;
        internal int Priority;
        internal uint Flags;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)] internal string ExeFile;
    }

    internal static Dictionary<int, int> Parents()
    {
        var parents = new Dictionary<int, int>();
        using var snapshot = CreateToolhelp32Snapshot(2, 0);
        if (snapshot.IsInvalid) return parents;
        var entry = new ProcessEntry { Size = (uint)Marshal.SizeOf<ProcessEntry>(), ExeFile = "" };
        if (!Process32FirstW(snapshot, ref entry)) return parents;
        do { parents[(int)entry.ProcessId] = (int)entry.ParentProcessId; }
        while (Process32NextW(snapshot, ref entry));
        return parents;
    }

    internal static bool ListenerOwnedBy(int port, int pid)
    {
        int bytes = 0;
        if (GetExtendedTcpTable(IntPtr.Zero, ref bytes, false, 2, 3, 0) != 122 || bytes <= 0) return false;
        var buffer = Marshal.AllocHGlobal(bytes);
        try
        {
            if (GetExtendedTcpTable(buffer, ref bytes, false, 2, 3, 0) != 0) return false;
            var count = Marshal.ReadInt32(buffer);
            var rowSize = Marshal.SizeOf<TcpOwnerRow>();
            if (count < 0 || count > (bytes - 4) / rowSize) return false;
            for (var index = 0; index < count; index++)
            {
                var row = Marshal.PtrToStructure<TcpOwnerRow>(buffer + 4 + index * rowSize);
                var localPort = (int)(((row.LocalPort & 255) << 8) | ((row.LocalPort >> 8) & 255));
                if (row.State == 2 && row.LocalAddress == 0x0100007f && localPort == port && row.OwnerPid == pid) return true;
            }
            return false;
        }
        finally { Marshal.FreeHGlobal(buffer); }
    }

    internal static string CanonicalDirectory(string path)
    {
        using var handle = CreateFile(path, 0x80, 7, IntPtr.Zero, 3, 0x02000000, IntPtr.Zero);
        if (handle.IsInvalid) throw new Win32Exception(Marshal.GetLastWin32Error(), "Không mở được thư mục dữ liệu.");
        var name = new StringBuilder(32768);
        var size = GetFinalPathNameByHandle(handle, name, (uint)name.Capacity, 0);
        if (size == 0 || size >= name.Capacity) throw new Win32Exception(Marshal.GetLastWin32Error());
        var value = name.ToString();
        if (value.StartsWith(@"\\?\UNC\", StringComparison.OrdinalIgnoreCase)) value = @"\\" + value[8..];
        else if (value.StartsWith(@"\\?\", StringComparison.Ordinal)) value = value[4..];
        return Path.TrimEndingDirectorySeparator(value);
    }

    [StructLayout(LayoutKind.Sequential)] private struct TcpOwnerRow
    { internal uint State, LocalAddress, LocalPort, RemoteAddress, RemotePort, OwnerPid; }
}
