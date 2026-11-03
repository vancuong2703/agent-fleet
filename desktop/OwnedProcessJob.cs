using System.ComponentModel;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;

namespace FleetDesktop;

internal sealed class OwnedProcessJob : IDisposable
{
    private readonly SafeFileHandle handle;
    internal OwnedProcessJob()
    {
        handle = CreateJobObject(IntPtr.Zero, null);
        if (handle.IsInvalid) throw new Win32Exception(Marshal.GetLastWin32Error());
        var limits = new ExtendedLimitInformation { BasicLimitInformation = new BasicLimitInformation { LimitFlags = 0x2000 } };
        if (!SetInformationJobObject(handle, 9, ref limits, (uint)Marshal.SizeOf<ExtendedLimitInformation>()))
        { var error = Marshal.GetLastWin32Error(); handle.Dispose(); throw new Win32Exception(error); }
    }
    internal void Assign(System.Diagnostics.Process process)
    {
        if (!AssignProcessToJobObject(handle, process.Handle)) throw new Win32Exception(Marshal.GetLastWin32Error(), "Không gắn được server vào Windows Job Object.");
    }
    internal IReadOnlySet<int> ProcessIds()
    {
        for (var capacity = 64; capacity <= 16384; capacity *= 2)
        {
            var bytes = checked(8 + capacity * IntPtr.Size);
            var buffer = Marshal.AllocHGlobal(bytes);
            try
            {
                if (!QueryInformationJobObject(handle, 3, buffer, (uint)bytes, IntPtr.Zero))
                { if (Marshal.GetLastWin32Error() == 234) continue; return new HashSet<int>(); }
                var count = Marshal.ReadInt32(buffer, 4);
                if (count < 0 || count > capacity) continue;
                var pids = new HashSet<int>();
                for (var index = 0; index < count; index++) pids.Add(checked((int)Marshal.ReadIntPtr(buffer, 8 + index * IntPtr.Size)));
                return pids;
            }
            finally { Marshal.FreeHGlobal(buffer); }
        }
        return new HashSet<int>();
    }
    public void Dispose() => handle.Dispose();
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern SafeFileHandle CreateJobObject(IntPtr attributes, string? name);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool SetInformationJobObject(SafeFileHandle job, int infoClass, ref ExtendedLimitInformation information, uint size);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool AssignProcessToJobObject(SafeFileHandle job, IntPtr process);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool QueryInformationJobObject(SafeFileHandle job, int infoClass, IntPtr information, uint size, IntPtr returnedLength);
    [StructLayout(LayoutKind.Sequential)] private struct BasicLimitInformation
    {
        internal long PerProcessUserTimeLimit; internal long PerJobUserTimeLimit; internal uint LimitFlags;
        internal UIntPtr MinimumWorkingSetSize; internal UIntPtr MaximumWorkingSetSize; internal uint ActiveProcessLimit;
        internal UIntPtr Affinity; internal uint PriorityClass; internal uint SchedulingClass;
    }
    [StructLayout(LayoutKind.Sequential)] private struct IoCounters
    { internal ulong ReadOperationCount, WriteOperationCount, OtherOperationCount, ReadTransferCount, WriteTransferCount, OtherTransferCount; }
    [StructLayout(LayoutKind.Sequential)] private struct ExtendedLimitInformation
    {
        internal BasicLimitInformation BasicLimitInformation; internal IoCounters IoInfo;
        internal UIntPtr ProcessMemoryLimit, JobMemoryLimit, PeakProcessMemoryUsed, PeakJobMemoryUsed;
    }
}
