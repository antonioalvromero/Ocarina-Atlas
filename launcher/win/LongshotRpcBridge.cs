using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Globalization;
using System.IO;
using System.IO.Compression;
using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Windows.Forms;

namespace OcarinaAtlasLauncher
{
    /// <summary>
    /// Read-only Windows process memory JSON-RPC bridge for Longshot / hookshot.
    /// Exposes LichiiRpcClient-compatible status, read_memory, and search_memory
    /// over 127.0.0.1 using strictly PROCESS_VM_READ | PROCESS_QUERY_INFORMATION.
    /// </summary>
    internal sealed class LongshotRpcBridge : IDisposable
    {
        public const ulong GuestWindowBase = 0x100000000000UL; // A64_HOST_BASE
        public const ulong GuestWindowSize = 0x8000000000UL;   // 512 GB
        public const ulong GuestCodeBase = 0x80000000UL;

        private const ulong LongshotHeapBase = 0x1000000000UL; // HOS_HEAP_BASE
        private const ulong LongshotHeapEnd = 0x2000000000UL;
        private const ulong StandardHeapThreshold = 0x2000000000UL;
        private const ulong DirectHostMainBase = 0x7000000000UL; // OOT-PC / NX2navi main base
        private const ulong DirectHostRangeMin = 0x100000000UL;
        private const ulong DirectHostRangeMax = 0x8000000000UL;
        private const int MaxReadMemorySize = 262144;
        private const int SearchChunkSize = 1048576; // 1 MB
        private const int DefaultMaxHits = 64;
        private const int MaxAllowedHits = 1024;
        private const string OotProgramId = "0400486024DEC000";

        private const uint ProcessVmRead = 0x0010;
        private const uint ProcessQueryInformation = 0x0400;
        private const uint ProcessReadAccess = ProcessVmRead | ProcessQueryInformation; // 0x0410

        private const uint MemCommit = 0x1000;
        private const uint PageReadOnly = 0x02;
        private const uint PageReadWrite = 0x04;
        private const uint PageWriteCopy = 0x08;
        private const uint PageExecuteRead = 0x20;
        private const uint PageExecuteReadWrite = 0x40;
        private const uint PageExecuteWriteCopy = 0x80;
        private const uint PageGuard = 0x100;

        private static readonly string[] ProcessNames = new[] { "hookshot", "Longshot", "relink-game", "relink", "Triforce", "HeyListen", "ocarina", "nx2navi" };
        private static readonly char[] HexDigits = "0123456789abcdef".ToCharArray();

        [StructLayout(LayoutKind.Sequential)]
        private struct MEMORY_BASIC_INFORMATION
        {
            public UIntPtr BaseAddress;
            public UIntPtr AllocationBase;
            public uint AllocationProtect;
            public ushort PartitionId;
            public UIntPtr RegionSize;
            public uint State;
            public uint Protect;
            public uint Type;
        }

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern IntPtr OpenProcess(
            uint dwDesiredAccess,
            [MarshalAs(UnmanagedType.Bool)] bool bInheritHandle,
            int dwProcessId);

        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool ReadProcessMemory(
            IntPtr hProcess,
            UIntPtr lpBaseAddress,
            [Out] byte[] lpBuffer,
            UIntPtr nSize,
            out UIntPtr lpNumberOfBytesRead);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern UIntPtr VirtualQueryEx(
            IntPtr hProcess,
            UIntPtr lpAddress,
            out MEMORY_BASIC_INFORMATION lpBuffer,
            UIntPtr dwLength);

        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool CloseHandle(IntPtr hObject);

        private readonly Process _attachedProcess;
        private readonly int _processId;
        private readonly string _detectedUserSaveDir;
        private readonly string _emulatorKind;
        private readonly bool _isDirectHostVa;
        private readonly object _handleLock = new object();
        private readonly object _clientsLock = new object();
        private readonly List<TcpClient> _clients = new List<TcpClient>();

        private IntPtr _processHandle;
        private TcpListener _listener;
        private Thread _acceptThread;
        private int _port;
        private volatile bool _running;
        private int _disposed = 0;

        private LongshotRpcBridge(Process attachedProcess, int processId, IntPtr processHandle, string detectedUserSaveDir, string emulatorKind)
        {
            _attachedProcess = attachedProcess;
            _processId = processId;
            _processHandle = processHandle;
            _detectedUserSaveDir = detectedUserSaveDir;
            _emulatorKind = string.IsNullOrEmpty(emulatorKind) ? "longshot" : emulatorKind;
            _isDirectHostVa = string.Equals(_emulatorKind, "ootpc", StringComparison.Ordinal);
        }

        public int ProcessId
        {
            get { return _processId; }
        }

        public int Port
        {
            get { return _port; }
        }

        public string DetectedUserSaveDir
        {
            get { return _detectedUserSaveDir; }
        }

        public bool IsRunning
        {
            get { return _running && _disposed == 0; }
        }

        public bool IsProcessAlive
        {
            get
            {
                if (_disposed != 0) return false;
                try
                {
                    return _attachedProcess != null && !_attachedProcess.HasExited;
                }
                catch
                {
                    return false;
                }
            }
        }

        private static string _lastDiagnosticHint = string.Empty;

        public string EmulatorKind
        {
            get { return _emulatorKind; }
        }

        public static string GetDiagnosticHintForRunningRecomp()
        {
            return _lastDiagnosticHint ?? string.Empty;
        }

        public static LongshotRpcBridge TryFindLongshotProcess()
        {
            string diagnosticHint;
            return TryFindLongshotProcess(out diagnosticHint);
        }

        public static LongshotRpcBridge TryFindLongshotProcess(out string diagnosticHint)
        {
            diagnosticHint = string.Empty;
            string accessDeniedHint = null;
            string openFailedHint = null;
            string unmappedHint = null;

            for (int n = 0; n < ProcessNames.Length; n++)
            {
                Process[] procs = null;
                try
                {
                    procs = Process.GetProcessesByName(ProcessNames[n]);
                }
                catch
                {
                    procs = null;
                }

                if (procs == null || procs.Length == 0)
                {
                    continue;
                }

                for (int i = 0; i < procs.Length; i++)
                {
                    Process proc = procs[i];
                    if (proc == null) continue;

                    IntPtr handle = IntPtr.Zero;
                    bool keepProc = false;
                    try
                    {
                        if (proc.HasExited)
                        {
                            continue;
                        }

                        string procKey = ProcessNames[n];
                        int procId = proc.Id;
                        handle = OpenProcess(ProcessReadAccess, false, procId);
                        if (handle == IntPtr.Zero)
                        {
                            int win32Err = Marshal.GetLastWin32Error();
                            if (win32Err == 5)
                            {
                                if (accessDeniedHint == null)
                                {
                                    accessDeniedHint = string.Format(
                                        CultureInfo.InvariantCulture,
                                        "Detected {0} (PID {1}), but OpenProcess failed with ERROR_ACCESS_DENIED (Win32 error 5). If the game is running as Administrator, run Ocarina Atlas with the same elevation.",
                                        procKey,
                                        procId);
                                }
                            }
                            else if (openFailedHint == null)
                            {
                                openFailedHint = string.Format(
                                    CultureInfo.InvariantCulture,
                                    "Detected {0} (PID {1}), but OpenProcess(0x0410) failed (Win32 error {2}).",
                                    procKey,
                                    procId,
                                    win32Err);
                            }
                            continue;
                        }

                        string emulatorKind = procKey.StartsWith("relink", StringComparison.OrdinalIgnoreCase)
                            ? "relink"
                            : string.Equals(procKey, "Triforce", StringComparison.OrdinalIgnoreCase)
                                ? "triforce"
                                : string.Equals(procKey, "HeyListen", StringComparison.OrdinalIgnoreCase)
                                    ? "heylisten"
                                    : (string.Equals(procKey, "ocarina", StringComparison.OrdinalIgnoreCase) ||
                                       string.Equals(procKey, "nx2navi", StringComparison.OrdinalIgnoreCase))
                                        ? "ootpc"
                                        : "longshot";
                        bool isDirectHostVa = string.Equals(emulatorKind, "ootpc", StringComparison.Ordinal);

                        if (!VerifyGuestCodeMapped(handle, isDirectHostVa))
                        {
                            if (unmappedHint == null)
                            {
                                unmappedHint = string.Format(
                                    CultureInfo.InvariantCulture,
                                    "Detected {0} (PID {1}), waiting for guest code memory to be mapped (launcher or startup process before game load).",
                                    procKey,
                                    procId);
                            }
                            continue;
                        }

                        string userSaveDir = ResolveUserSaveDir(proc);
                        keepProc = true;
                        for (int k = i + 1; k < procs.Length; k++)
                        {
                            if (procs[k] != null)
                            {
                                try { procs[k].Dispose(); } catch { }
                            }
                        }
                        _lastDiagnosticHint = string.Empty;
                        return new LongshotRpcBridge(proc, procId, handle, userSaveDir, emulatorKind);
                    }
                    catch
                    {
                        // Ignore inaccessible or exiting process.
                    }
                    finally
                    {
                        if (!keepProc)
                        {
                            if (handle != IntPtr.Zero)
                            {
                                CloseHandle(handle);
                            }
                            try { proc.Dispose(); } catch { }
                        }
                    }
                }
            }

            diagnosticHint = accessDeniedHint ?? openFailedHint ?? unmappedHint ?? string.Empty;
            _lastDiagnosticHint = diagnosticHint;
            return null;
        }

        private static string ResolveAppDataLongshotSaveDir()
        {
            try
            {
                string appData = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
                if (!string.IsNullOrEmpty(appData))
                {
                    string longshotAppData = Path.Combine(appData, "Longshot");
                    if (Directory.Exists(Path.Combine(longshotAppData, "save")))
                    {
                        return longshotAppData;
                    }
                    string longshotAppDataUser = Path.Combine(longshotAppData, "user");
                    if (Directory.Exists(Path.Combine(longshotAppDataUser, "save")))
                    {
                        return longshotAppDataUser;
                    }
                }
            }
            catch
            {
                // Ignore environment path resolution failures.
            }
            return null;
        }

        public static string DetectRunningUserSaveDir()
        {
            bool sawLongshotProcess = false;

            for (int n = 0; n < ProcessNames.Length; n++)
            {
                string procKey = ProcessNames[n];
                bool isLongshotKey = string.Equals(procKey, "Longshot", StringComparison.OrdinalIgnoreCase) ||
                                     string.Equals(procKey, "hookshot", StringComparison.OrdinalIgnoreCase);

                Process[] procs = null;
                try
                {
                    procs = Process.GetProcessesByName(procKey);
                }
                catch
                {
                    procs = null;
                }

                if (procs == null) continue;
                if (procs.Length > 0 && isLongshotKey)
                {
                    sawLongshotProcess = true;
                }

                string found = null;
                for (int i = 0; i < procs.Length; i++)
                {
                    Process proc = procs[i];
                    if (proc == null) continue;
                    try
                    {
                        if (found == null && !proc.HasExited)
                        {
                            string candidate = ResolveUserSaveDir(proc);
                            if (!string.IsNullOrEmpty(candidate) && Directory.Exists(candidate))
                            {
                                found = candidate;
                            }
                        }
                    }
                    catch
                    {
                        // Ignore process inspection failure.
                    }
                    finally
                    {
                        try { proc.Dispose(); } catch { }
                    }
                }

                if (found != null)
                {
                    return found;
                }
            }

            if (sawLongshotProcess)
            {
                string appDataLongshot = ResolveAppDataLongshotSaveDir();
                if (!string.IsNullOrEmpty(appDataLongshot) && Directory.Exists(appDataLongshot))
                {
                    return appDataLongshot;
                }
            }

            return null;
        }

        private static string ResolveUserSaveDir(Process proc)
        {
            if (proc == null) return null;
            try
            {
                ProcessModule mod = proc.MainModule;
                string exePath = mod != null ? mod.FileName : null;
                if (string.IsNullOrEmpty(exePath))
                {
                    return ResolveAppDataLongshotSaveDir();
                }

                string exeDir = Path.GetDirectoryName(exePath);
                if (string.IsNullOrEmpty(exeDir))
                {
                    return ResolveAppDataLongshotSaveDir();
                }
                exeDir = exeDir.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);

                string leaf = Path.GetFileName(exeDir);
                string gameRoot = string.Equals(leaf, "bin", StringComparison.OrdinalIgnoreCase)
                    ? Path.GetDirectoryName(exeDir)
                    : exeDir;
                if (string.IsNullOrEmpty(gameRoot))
                {
                    return ResolveAppDataLongshotSaveDir();
                }

                // 1. Direct <gameRoot>\user\save check (note: LongshotLauncher removes <gameRoot>\user\save after migrating to %APPDATA%\Longshot\save)
                string gameUserDir = Path.Combine(gameRoot, "user");
                if (Directory.Exists(Path.Combine(gameUserDir, "save")))
                {
                    return gameUserDir;
                }

                // 2. Portable LongshotLauncher-data\user (when <gameRoot> is inside <launcherRoot>\LongshotLauncher-data\builds\<track>\<version>)
                string currentParent = gameRoot;
                for (int depth = 0; depth < 3; depth++)
                {
                    currentParent = Path.GetDirectoryName(currentParent);
                    if (string.IsNullOrEmpty(currentParent))
                    {
                        break;
                    }

                    string parentUser = Path.Combine(currentParent, "user");
                    if (Directory.Exists(Path.Combine(parentUser, "save")))
                    {
                        return parentUser;
                    }
                    if (Directory.Exists(Path.Combine(currentParent, "save")))
                    {
                        return currentParent;
                    }

                    string launcherDataDir = Path.Combine(currentParent, "LongshotLauncher-data");
                    string launcherDataUser = Path.Combine(launcherDataDir, "user");
                    if (Directory.Exists(Path.Combine(launcherDataUser, "save")))
                    {
                        return launcherDataUser;
                    }
                    if (Directory.Exists(Path.Combine(launcherDataDir, "save")))
                    {
                        return launcherDataDir;
                    }
                }

                // 3. %APPDATA%\Longshot\save or %APPDATA%\Longshot\user\save
                string appDataSaveDir = ResolveAppDataLongshotSaveDir();
                if (!string.IsNullOrEmpty(appDataSaveDir))
                {
                    return appDataSaveDir;
                }

                // 4. Fallback to <gameRoot>\user if it exists
                if (Directory.Exists(gameUserDir))
                {
                    return gameUserDir;
                }

                return null;
            }
            catch
            {
                return ResolveAppDataLongshotSaveDir();
            }
        }

        private static bool VerifyGuestCodeMapped(IntPtr handle, bool isDirectHostVa)
        {
            int mbiSize = Marshal.SizeOf(typeof(MEMORY_BASIC_INFORMATION));
            if (isDirectHostVa)
            {
                ulong addr = DirectHostMainBase;
                while (addr < DirectHostRangeMax)
                {
                    MEMORY_BASIC_INFORMATION mbi;
                    UIntPtr queried = VirtualQueryEx(handle, new UIntPtr(addr), out mbi, new UIntPtr((uint)mbiSize));
                    if (queried == UIntPtr.Zero)
                    {
                        break;
                    }

                    ulong regionBase = mbi.BaseAddress.ToUInt64();
                    ulong regionSize = mbi.RegionSize.ToUInt64();
                    if (regionSize == 0)
                    {
                        break;
                    }

                    ulong regionEnd = regionBase + regionSize;
                    if (regionEnd < regionBase)
                    {
                        regionEnd = ulong.MaxValue;
                    }

                    if (mbi.State == MemCommit && IsReadableProtect(mbi.Protect))
                    {
                        ulong probeAddr = regionBase > addr ? regionBase : addr;
                        ulong probeEnd = regionEnd < DirectHostRangeMax ? regionEnd : DirectHostRangeMax;
                        if (probeEnd > probeAddr && (probeEnd - probeAddr) >= 8UL)
                        {
                            byte[] probe = new byte[8];
                            UIntPtr bytesRead;
                            if (ReadProcessMemory(handle, new UIntPtr(probeAddr), probe, new UIntPtr((uint)probe.Length), out bytesRead) &&
                                bytesRead.ToUInt64() == (ulong)probe.Length)
                            {
                                return true;
                            }
                        }
                    }

                    if (regionEnd >= DirectHostRangeMax || regionEnd <= addr)
                    {
                        break;
                    }
                    addr = regionEnd;
                }
                return false;
            }

            ulong hostCodeAddr = GuestWindowBase + GuestCodeBase;
            MEMORY_BASIC_INFORMATION stdMbi;
            UIntPtr stdQueried = VirtualQueryEx(handle, new UIntPtr(hostCodeAddr), out stdMbi, new UIntPtr((uint)mbiSize));
            if (stdQueried == UIntPtr.Zero)
            {
                return false;
            }
            if (stdMbi.State != MemCommit || !IsReadableProtect(stdMbi.Protect))
            {
                return false;
            }

            byte[] stdProbe = new byte[8];
            UIntPtr stdBytesRead;
            if (!ReadProcessMemory(handle, new UIntPtr(hostCodeAddr), stdProbe, new UIntPtr((uint)stdProbe.Length), out stdBytesRead))
            {
                return false;
            }
            return stdBytesRead.ToUInt64() == (ulong)stdProbe.Length;
        }

        private static bool IsReadableProtect(uint protect)
        {
            if ((protect & PageGuard) != 0)
            {
                return false;
            }
            uint baseProtect = protect & 0xFFu;
            return baseProtect == PageReadOnly ||
                   baseProtect == PageReadWrite ||
                   baseProtect == PageWriteCopy ||
                   baseProtect == PageExecuteRead ||
                   baseProtect == PageExecuteReadWrite ||
                   baseProtect == PageExecuteWriteCopy;
        }

        public bool Start(int port)
        {
            if (_disposed != 0 || _running) return false;
            if (port < 1 || port > 65535) return false;
            if (!IsProcessAlive) return false;

            TcpListener listener = null;
            try
            {
                listener = new TcpListener(IPAddress.Loopback, port);
                listener.Start();
            }
            catch
            {
                if (listener != null)
                {
                    try { listener.Stop(); } catch { }
                }
                return false;
            }

            _listener = listener;
            _port = port;
            _running = true;

            _acceptThread = new Thread(AcceptLoop);
            _acceptThread.IsBackground = true;
            _acceptThread.Name = "LongshotRpcBridge";
            _acceptThread.Start();
            return true;
        }

        public void Stop()
        {
            _running = false;

            TcpListener listener = _listener;
            _listener = null;
            if (listener != null)
            {
                try { listener.Stop(); } catch { }
            }

            List<TcpClient> clientsToClose;
            lock (_clientsLock)
            {
                clientsToClose = new List<TcpClient>(_clients);
                _clients.Clear();
            }

            for (int i = 0; i < clientsToClose.Count; i++)
            {
                try { clientsToClose[i].Close(); } catch { }
            }

            Thread acceptThread = _acceptThread;
            _acceptThread = null;
            if (acceptThread != null && Thread.CurrentThread != acceptThread)
            {
                try { acceptThread.Join(300); } catch { }
            }
        }

        public void Dispose()
        {
            if (Interlocked.Exchange(ref _disposed, 1) != 0) return;

            Stop();

            lock (_handleLock)
            {
                if (_processHandle != IntPtr.Zero)
                {
                    CloseHandle(_processHandle);
                    _processHandle = IntPtr.Zero;
                }
            }

            if (_attachedProcess != null)
            {
                try { _attachedProcess.Dispose(); } catch { }
            }
        }

        private void AcceptLoop()
        {
            while (_running)
            {
                TcpClient client = null;
                try
                {
                    TcpListener listener = _listener;
                    if (listener == null) break;
                    client = listener.AcceptTcpClient();
                }
                catch
                {
                    if (!_running) break;
                    Thread.Sleep(25);
                    continue;
                }

                if (!_running)
                {
                    try { client.Close(); } catch { }
                    break;
                }

                try
                {
                    client.NoDelay = true;
                }
                catch
                {
                    // Ignore if socket closed before configuring NoDelay.
                }

                lock (_clientsLock)
                {
                    if (!_running)
                    {
                        try { client.Close(); } catch { }
                        break;
                    }
                    _clients.Add(client);
                }

                TcpClient accepted = client;
                ThreadPool.QueueUserWorkItem(delegate
                {
                    HandleClient(accepted);
                });
            }
        }

        private void HandleClient(TcpClient client)
        {
            UTF8Encoding utf8 = new UTF8Encoding(false);
            try
            {
                using (NetworkStream stream = client.GetStream())
                using (StreamReader reader = new StreamReader(stream, utf8))
                {
                    while (_running)
                    {
                        string line = reader.ReadLine();
                        if (line == null) break;
                        if (line.Trim().Length == 0) continue;

                        string responseJson = ProcessRpcLine(line);
                        if (responseJson == null) continue;

                        byte[] bytes = utf8.GetBytes(responseJson + "\n");
                        stream.Write(bytes, 0, bytes.Length);
                        stream.Flush();
                    }
                }
            }
            catch
            {
                // Client disconnected or bridge stopped.
            }
            finally
            {
                lock (_clientsLock)
                {
                    _clients.Remove(client);
                }
                try { client.Close(); } catch { }
            }
        }

        private string ProcessRpcLine(string line)
        {
            Dictionary<string, object> req;
            try
            {
                req = SimpleJsonParser.ParseObject(line);
            }
            catch
            {
                return BuildErrorResponse("null", -32700, "Parse error");
            }

            if (req == null)
            {
                return BuildErrorResponse("null", -32600, "Invalid request");
            }

            object idObj = null;
            req.TryGetValue("id", out idObj);
            string idJson = FormatJsonId(idObj);

            string method = SimpleJsonParser.GetString(req, "method");
            if (string.IsNullOrEmpty(method))
            {
                return BuildErrorResponse(idJson, -32600, "Missing method");
            }

            object rawParams;
            Dictionary<string, object> paramsDict = req.TryGetValue("params", out rawParams)
                ? rawParams as Dictionary<string, object>
                : null;

            if (string.Equals(method, "status", StringComparison.Ordinal))
            {
                bool alive = IsProcessAlive && _running && _disposed == 0;
                if (alive)
                {
                    return string.Format(
                        CultureInfo.InvariantCulture,
                        "{{\"id\":{0},\"result\":{{\"powered_on\":true,\"program_id\":\"{1}\",\"emulator\":\"{2}\"}}}}",
                        idJson,
                        OotProgramId,
                        _emulatorKind);
                }
                return string.Format(
                    CultureInfo.InvariantCulture,
                    "{{\"id\":{0},\"result\":{{\"powered_on\":false,\"program_id\":\"\",\"emulator\":\"{1}\"}}}}",
                    idJson,
                    _emulatorKind);
            }

            if (string.Equals(method, "read_memory", StringComparison.Ordinal))
            {
                return HandleReadMemory(idJson, paramsDict);
            }

            if (string.Equals(method, "search_memory", StringComparison.Ordinal))
            {
                return HandleSearchMemory(idJson, paramsDict);
            }

            return BuildErrorResponse(idJson, -32601, "Method not found");
        }

        private string HandleReadMemory(string idJson, Dictionary<string, object> paramsDict)
        {
            if (paramsDict == null)
            {
                return BuildErrorResponse(idJson, -32602, "Missing params");
            }

            object rawAddr;
            ulong guestAddr;
            if (!paramsDict.TryGetValue("address", out rawAddr) || !TryParseGuestAddress(rawAddr, out guestAddr))
            {
                return BuildErrorResponse(idJson, -32602, "Invalid address");
            }

            int size;
            if (!TryGetBoundedInt(paramsDict, "size", 1, MaxReadMemorySize, out size))
            {
                return BuildErrorResponse(idJson, -32602, "Invalid size (expected 1..262144)");
            }

            if (_isDirectHostVa)
            {
                if (guestAddr < DirectHostRangeMin ||
                    guestAddr >= DirectHostRangeMax ||
                    (ulong)size > DirectHostRangeMax - guestAddr)
                {
                    return BuildErrorResponse(idJson, -32602, "Address out of guest window");
                }
            }
            else
            {
                if (guestAddr >= GuestWindowSize || (ulong)size > GuestWindowSize - guestAddr)
                {
                    return BuildErrorResponse(idJson, -32602, "Address out of guest window");
                }
            }

            byte[] data;
            if (!TryReadGuestMemory(guestAddr, size, out data))
            {
                return BuildErrorResponse(idJson, -32000, "ReadProcessMemory failed");
            }

            string hex = BytesToLowerHex(data);
            return string.Format(
                CultureInfo.InvariantCulture,
                "{{\"id\":{0},\"result\":{{\"hex\":\"{1}\"}}}}",
                idJson,
                hex);
        }

        private string HandleSearchMemory(string idJson, Dictionary<string, object> paramsDict)
        {
            if (paramsDict == null)
            {
                return BuildErrorResponse(idJson, -32602, "Missing params");
            }

            string pattern = SimpleJsonParser.GetString(paramsDict, "pattern");
            byte[] patternBytes;
            bool[] patternMask;
            if (!ParseHexPattern(pattern, out patternBytes, out patternMask))
            {
                return BuildErrorResponse(idJson, -32602, "Invalid hex pattern");
            }

            string regions = SimpleJsonParser.GetString(paramsDict, "regions");
            bool isHeapRegion = string.Equals(regions, "heap", StringComparison.OrdinalIgnoreCase);

            object rawStart;
            bool hasStart = paramsDict.TryGetValue("start", out rawStart) && rawStart != null;
            ulong guestStart = isHeapRegion
                ? StandardHeapThreshold
                : (_isDirectHostVa ? DirectHostRangeMin : 0UL);
            if (hasStart && !TryParseGuestAddress(rawStart, out guestStart))
            {
                return BuildErrorResponse(idJson, -32602, "Invalid start address");
            }

            object rawEnd;
            bool hasEnd = paramsDict.TryGetValue("end", out rawEnd) && rawEnd != null;
            ulong guestEnd = _isDirectHostVa ? DirectHostRangeMax : GuestWindowSize;
            if (hasEnd && !TryParseGuestAddress(rawEnd, out guestEnd))
            {
                return BuildErrorResponse(idJson, -32602, "Invalid end address");
            }

            if (_isDirectHostVa)
            {
                if (guestStart < DirectHostRangeMin) guestStart = DirectHostRangeMin;
                if (guestStart > DirectHostRangeMax) guestStart = DirectHostRangeMax;
                if (guestEnd > DirectHostRangeMax) guestEnd = DirectHostRangeMax;
            }
            else
            {
                if (guestStart > GuestWindowSize) guestStart = GuestWindowSize;
                if (guestEnd > GuestWindowSize) guestEnd = GuestWindowSize;
            }

            int maxHits = DefaultMaxHits;
            int parsedMaxHits;
            if (TryGetBoundedInt(paramsDict, "max_hits", 1, MaxAllowedHits, out parsedMaxHits))
            {
                maxHits = parsedMaxHits;
            }
            else
            {
                object rawMaxHits;
                if (paramsDict.TryGetValue("max_hits", out rawMaxHits) && rawMaxHits is double)
                {
                    double dMax = (double)rawMaxHits;
                    if (!double.IsNaN(dMax) && !double.IsInfinity(dMax))
                    {
                        if (dMax < 1.0) maxHits = 1;
                        else if (dMax > MaxAllowedHits) maxHits = MaxAllowedHits;
                    }
                }
            }

            int budgetMs = 0;
            int parsedBudget;
            if (TryGetBoundedInt(paramsDict, "budget_ms", 50, 10000, out parsedBudget))
            {
                budgetMs = parsedBudget;
            }

            List<string> hits = SearchGuestMemory(
                patternBytes,
                patternMask,
                guestStart,
                guestEnd,
                isHeapRegion,
                maxHits,
                budgetMs);

            StringBuilder sb = new StringBuilder(64 + hits.Count * 16);
            sb.Append("{\"id\":");
            sb.Append(idJson);
            sb.Append(",\"result\":{\"hits\":[");
            for (int i = 0; i < hits.Count; i++)
            {
                if (i > 0) sb.Append(',');
                sb.Append('"');
                sb.Append(hits[i]);
                sb.Append('"');
            }
            sb.Append("]}}");
            return sb.ToString();
        }

        private bool TryReadGuestMemory(ulong guestAddr, int size, out byte[] buffer)
        {
            buffer = null;
            if (size < 1 || size > MaxReadMemorySize) return false;
            if (_isDirectHostVa)
            {
                if (guestAddr < DirectHostRangeMin ||
                    guestAddr >= DirectHostRangeMax ||
                    (ulong)size > DirectHostRangeMax - guestAddr)
                {
                    return false;
                }
            }
            else
            {
                if (guestAddr >= GuestWindowSize || (ulong)size > GuestWindowSize - guestAddr) return false;
            }

            ulong hostAddr = _isDirectHostVa ? guestAddr : (GuestWindowBase + guestAddr);
            byte[] data = new byte[size];

            lock (_handleLock)
            {
                if (_disposed != 0 || !_running || _processHandle == IntPtr.Zero)
                {
                    return false;
                }

                UIntPtr bytesRead;
                bool ok = ReadProcessMemory(
                    _processHandle,
                    new UIntPtr(hostAddr),
                    data,
                    new UIntPtr((uint)size),
                    out bytesRead);
                if (!ok || bytesRead.ToUInt64() != (ulong)size)
                {
                    return false;
                }
            }

            buffer = data;
            return true;
        }

        private List<string> SearchGuestMemory(
            byte[] patternBytes,
            bool[] patternMask,
            ulong guestStart,
            ulong guestEnd,
            bool isHeapRegion,
            int maxHits,
            int budgetMs)
        {
            List<string> hits = new List<string>();
            if (!IsProcessAlive || !_running || _disposed != 0) return hits;

            int anchorIdx = -1;
            for (int i = 0; i < patternMask.Length; i++)
            {
                if (patternMask[i] && patternBytes[i] != 0x00 && patternBytes[i] != 0xFF)
                {
                    anchorIdx = i;
                    break;
                }
            }
            if (anchorIdx < 0)
            {
                for (int i = 0; i < patternMask.Length; i++)
                {
                    if (patternMask[i])
                    {
                        anchorIdx = i;
                        break;
                    }
                }
            }
            bool hasAnchor = anchorIdx >= 0;

            int chunkSize = Math.Max(SearchChunkSize, patternBytes.Length);
            byte[] scanBuffer = new byte[chunkSize];
            Stopwatch sw = Stopwatch.StartNew();

            ulong hostOffset = _isDirectHostVa ? 0UL : GuestWindowBase;

            lock (_handleLock)
            {
                if (_disposed != 0 || !_running || _processHandle == IntPtr.Zero)
                {
                    return hits;
                }

                if (guestEnd > guestStart)
                {
                    SearchHostRange(
                        hostOffset + guestStart,
                        hostOffset + guestEnd,
                        patternBytes,
                        patternMask,
                        anchorIdx,
                        hasAnchor,
                        maxHits,
                        hits,
                        sw,
                        budgetMs,
                        scanBuffer,
                        hostOffset);
                }

                if (hits.Count == 0 && (isHeapRegion || guestStart >= StandardHeapThreshold))
                {
                    bool alreadyCovered = guestStart <= LongshotHeapBase && guestEnd >= LongshotHeapEnd;
                    if (!alreadyCovered)
                    {
                        sw.Restart();
                        SearchHostRange(
                            hostOffset + LongshotHeapBase,
                            hostOffset + LongshotHeapEnd,
                            patternBytes,
                            patternMask,
                            anchorIdx,
                            hasAnchor,
                            maxHits,
                            hits,
                            sw,
                            budgetMs,
                            scanBuffer,
                            hostOffset);
                    }
                }
            }

            return hits;
        }

        private void SearchHostRange(
            ulong rangeStartHost,
            ulong rangeEndHost,
            byte[] patternBytes,
            bool[] patternMask,
            int anchorIdx,
            bool hasAnchor,
            int maxHits,
            List<string> hits,
            Stopwatch sw,
            int budgetMs,
            byte[] scanBuffer,
            ulong hostOffset)
        {
            ulong addr = rangeStartHost;
            int mbiSize = Marshal.SizeOf(typeof(MEMORY_BASIC_INFORMATION));

            while (addr < rangeEndHost && hits.Count < maxHits)
            {
                if (!_running || _disposed != 0) break;
                if (budgetMs > 0 && sw.ElapsedMilliseconds >= budgetMs) break;

                MEMORY_BASIC_INFORMATION mbi;
                UIntPtr queried = VirtualQueryEx(_processHandle, new UIntPtr(addr), out mbi, new UIntPtr((uint)mbiSize));
                if (queried == UIntPtr.Zero)
                {
                    break;
                }

                ulong regionBase = mbi.BaseAddress.ToUInt64();
                ulong regionSize = mbi.RegionSize.ToUInt64();
                if (regionSize == 0)
                {
                    break;
                }

                ulong regionEnd = regionBase + regionSize;
                if (regionEnd < regionBase)
                {
                    regionEnd = ulong.MaxValue;
                }

                if (mbi.State == MemCommit && IsReadableProtect(mbi.Protect))
                {
                    ulong scanStart = regionBase > addr ? regionBase : addr;
                    ulong scanEnd = regionEnd < rangeEndHost ? regionEnd : rangeEndHost;
                    if (scanEnd > scanStart)
                    {
                        ScanHostRegion(
                            scanStart,
                            scanEnd,
                            patternBytes,
                            patternMask,
                            anchorIdx,
                            hasAnchor,
                            maxHits,
                            hits,
                            sw,
                            budgetMs,
                            scanBuffer,
                            hostOffset);
                    }
                }

                if (regionEnd >= rangeEndHost || regionEnd <= addr)
                {
                    break;
                }
                addr = regionEnd;
            }
        }

        private void ScanHostRegion(
            ulong scanStart,
            ulong scanEnd,
            byte[] patternBytes,
            bool[] patternMask,
            int anchorIdx,
            bool hasAnchor,
            int maxHits,
            List<string> hits,
            Stopwatch sw,
            int budgetMs,
            byte[] scanBuffer,
            ulong hostOffset)
        {
            int patternLen = patternBytes.Length;
            ulong overlap = (ulong)(patternLen - 1);
            if (scanEnd <= scanStart || scanEnd - scanStart < (ulong)patternLen)
            {
                return;
            }

            ulong cursor = scanStart;
            while (cursor < scanEnd && hits.Count < maxHits)
            {
                if (!_running || _disposed != 0) break;
                if (budgetMs > 0 && sw.ElapsedMilliseconds >= budgetMs) break;

                ulong remaining = scanEnd - cursor;
                if (remaining < (ulong)patternLen) break;

                int toRead = remaining > (ulong)scanBuffer.Length
                    ? scanBuffer.Length
                    : (int)remaining;

                UIntPtr bytesReadPtr;
                bool ok = ReadProcessMemory(
                    _processHandle,
                    new UIntPtr(cursor),
                    scanBuffer,
                    new UIntPtr((uint)toRead),
                    out bytesReadPtr);

                ulong actualRead = ok ? bytesReadPtr.ToUInt64() : 0UL;
                if (actualRead < (ulong)patternLen)
                {
                    break;
                }

                int bufLen = (int)Math.Min(actualRead, (ulong)toRead);
                MatchBuffer(scanBuffer, bufLen, cursor, patternBytes, patternMask, anchorIdx, hasAnchor, maxHits, hits, hostOffset);

                if (cursor + (ulong)bufLen >= scanEnd || (ulong)bufLen <= overlap)
                {
                    break;
                }

                cursor += (ulong)bufLen - overlap;
            }
        }

        private static void MatchBuffer(
            byte[] buf,
            int bufLen,
            ulong baseHostAddr,
            byte[] patternBytes,
            bool[] patternMask,
            int anchorIdx,
            bool hasAnchor,
            int maxHits,
            List<string> hits,
            ulong hostOffset)
        {
            int m = patternBytes.Length;
            if (bufLen < m) return;
            int maxStart = bufLen - m;

            if (!hasAnchor)
            {
                for (int i = 0; i <= maxStart && hits.Count < maxHits; i++)
                {
                    ulong guestAddr = (baseHostAddr + (ulong)i) - hostOffset;
                    hits.Add("0x" + guestAddr.ToString("x", CultureInfo.InvariantCulture));
                }
                return;
            }

            byte anchorByte = patternBytes[anchorIdx];
            int searchPos = anchorIdx;
            int searchEnd = maxStart + anchorIdx;

            while (searchPos <= searchEnd && hits.Count < maxHits)
            {
                int foundAnchor = Array.IndexOf(buf, anchorByte, searchPos, searchEnd - searchPos + 1);
                if (foundAnchor < 0)
                {
                    break;
                }

                int start = foundAnchor - anchorIdx;
                bool matched = true;
                for (int k = 0; k < m; k++)
                {
                    if (patternMask[k] && buf[start + k] != patternBytes[k])
                    {
                        matched = false;
                        break;
                    }
                }

                if (matched)
                {
                    ulong guestAddr = (baseHostAddr + (ulong)start) - hostOffset;
                    hits.Add("0x" + guestAddr.ToString("x", CultureInfo.InvariantCulture));
                }

                searchPos = foundAnchor + 1;
            }
        }

        private static bool TryParseGuestAddress(object raw, out ulong addr)
        {
            addr = 0;
            if (raw == null) return false;

            string s = raw as string;
            if (s != null)
            {
                string trimmed = s.Trim();
                if (trimmed.Length == 0) return false;
                if (trimmed.StartsWith("0x", StringComparison.OrdinalIgnoreCase))
                {
                    return ulong.TryParse(
                        trimmed.Substring(2),
                        NumberStyles.AllowHexSpecifier,
                        CultureInfo.InvariantCulture,
                        out addr);
                }
                return ulong.TryParse(
                    trimmed,
                    NumberStyles.Integer,
                    CultureInfo.InvariantCulture,
                    out addr);
            }

            if (raw is double)
            {
                double d = (double)raw;
                if (double.IsNaN(d) || double.IsInfinity(d) || d < 0 || d > ulong.MaxValue)
                {
                    return false;
                }
                addr = (ulong)Math.Round(d);
                return true;
            }

            return false;
        }

        private static bool TryGetBoundedInt(
            Dictionary<string, object> obj,
            string key,
            int minValue,
            int maxValue,
            out int result)
        {
            result = 0;
            object val;
            if (obj == null || !obj.TryGetValue(key, out val) || !(val is double))
            {
                return false;
            }

            double d = (double)val;
            if (double.IsNaN(d) || double.IsInfinity(d) || d < minValue || d > maxValue)
            {
                return false;
            }

            result = (int)Math.Round(d);
            return result >= minValue && result <= maxValue;
        }

        private static bool ParseHexPattern(string pattern, out byte[] patternBytes, out bool[] patternMask)
        {
            patternBytes = null;
            patternMask = null;
            if (string.IsNullOrEmpty(pattern)) return false;

            StringBuilder clean = new StringBuilder(pattern.Length);
            for (int i = 0; i < pattern.Length; i++)
            {
                char c = pattern[i];
                if (!char.IsWhiteSpace(c))
                {
                    clean.Append(c);
                }
            }

            if (clean.Length < 2 || (clean.Length % 2) != 0)
            {
                return false;
            }

            int byteLen = clean.Length / 2;
            patternBytes = new byte[byteLen];
            patternMask = new bool[byteLen];

            for (int i = 0; i < byteLen; i++)
            {
                char hi = clean[i * 2];
                char lo = clean[i * 2 + 1];
                if (hi == '?' && lo == '?')
                {
                    patternBytes[i] = 0;
                    patternMask[i] = false;
                }
                else
                {
                    int hVal = HexCharToNibble(hi);
                    int lVal = HexCharToNibble(lo);
                    if (hVal < 0 || lVal < 0)
                    {
                        return false;
                    }
                    patternBytes[i] = (byte)((hVal << 4) | lVal);
                    patternMask[i] = true;
                }
            }

            return true;
        }

        private static int HexCharToNibble(char c)
        {
            if (c >= '0' && c <= '9') return c - '0';
            if (c >= 'a' && c <= 'f') return c - 'a' + 10;
            if (c >= 'A' && c <= 'F') return c - 'A' + 10;
            return -1;
        }

        private static string BytesToLowerHex(byte[] data)
        {
            char[] chars = new char[data.Length * 2];
            for (int i = 0; i < data.Length; i++)
            {
                byte b = data[i];
                chars[i * 2] = HexDigits[b >> 4];
                chars[i * 2 + 1] = HexDigits[b & 0x0F];
            }
            return new string(chars);
        }

        private static string FormatJsonId(object idObj)
        {
            if (idObj == null) return "null";
            if (idObj is double)
            {
                double d = (double)idObj;
                if (!double.IsNaN(d) && !double.IsInfinity(d))
                {
                    long l = (long)Math.Round(d);
                    if (Math.Abs(d - l) < 1e-9)
                    {
                        return l.ToString(CultureInfo.InvariantCulture);
                    }
                    return d.ToString("R", CultureInfo.InvariantCulture);
                }
                return "null";
            }
            if (idObj is bool)
            {
                return (bool)idObj ? "true" : "false";
            }
            string s = idObj as string;
            if (s != null)
            {
                return "\"" + EscapeJsonString(s) + "\"";
            }
            return "null";
        }

        private static string BuildErrorResponse(string idJson, int code, string message)
        {
            return string.Format(
                CultureInfo.InvariantCulture,
                "{{\"id\":{0},\"error\":{{\"code\":{1},\"message\":\"{2}\"}}}}",
                idJson,
                code,
                EscapeJsonString(message ?? "Error"));
        }

        private static string EscapeJsonString(string input)
        {
            if (string.IsNullOrEmpty(input)) return string.Empty;
            StringBuilder sb = new StringBuilder(input.Length);
            for (int i = 0; i < input.Length; i++)
            {
                char c = input[i];
                switch (c)
                {
                    case '\\': sb.Append("\\\\"); break;
                    case '"': sb.Append("\\\""); break;
                    case '\r': sb.Append("\\r"); break;
                    case '\n': sb.Append("\\n"); break;
                    case '\t': sb.Append("\\t"); break;
                    default:
                        if (c < 0x20)
                        {
                            sb.AppendFormat(CultureInfo.InvariantCulture, "\\u{0:x4}", (int)c);
                        }
                        else
                        {
                            sb.Append(c);
                        }
                        break;
                }
            }
            return sb.ToString();
        }
    }

    internal sealed class SimpleJsonParser
    {
        private readonly string _src;
        private int _pos;

        private SimpleJsonParser(string src)
        {
            _src = src ?? string.Empty;
        }

        public static Dictionary<string, object> ParseObject(string json)
        {
            if (string.IsNullOrEmpty(json)) return null;
            SimpleJsonParser parser = new SimpleJsonParser(json);
            object val = parser.ReadValue();
            return val as Dictionary<string, object>;
        }

        public static bool GetBool(Dictionary<string, object> obj, string key)
        {
            object val;
            if (obj != null && obj.TryGetValue(key, out val) && val is bool)
            {
                return (bool)val;
            }
            return false;
        }

        public static string GetString(Dictionary<string, object> obj, string key)
        {
            object val;
            if (obj != null && obj.TryGetValue(key, out val))
            {
                return val as string;
            }
            return null;
        }

        public static int? GetInt(Dictionary<string, object> obj, string key)
        {
            object val;
            if (obj != null && obj.TryGetValue(key, out val) && val is double)
            {
                return (int)Math.Round((double)val);
            }
            return null;
        }

        public static List<object> GetArray(Dictionary<string, object> obj, string key)
        {
            object val;
            if (obj != null && obj.TryGetValue(key, out val))
            {
                return val as List<object>;
            }
            return null;
        }

        private void SkipWhitespace()
        {
            while (_pos < _src.Length && char.IsWhiteSpace(_src[_pos]))
            {
                _pos++;
            }
        }

        private object ReadValue()
        {
            SkipWhitespace();
            if (_pos >= _src.Length) return null;

            char c = _src[_pos];
            if (c == '{') return ReadObject();
            if (c == '[') return ReadArray();
            if (c == '"') return ReadString();
            if (c == 't' && MatchLiteral("true")) return true;
            if (c == 'f' && MatchLiteral("false")) return false;
            if (c == 'n' && MatchLiteral("null")) return null;
            if (c == '-' || (c >= '0' && c <= '9')) return ReadNumber();
            throw new FormatException("Unexpected JSON token at " + _pos);
        }

        private bool MatchLiteral(string literal)
        {
            if (_pos + literal.Length > _src.Length) return false;
            if (string.CompareOrdinal(_src, _pos, literal, 0, literal.Length) == 0)
            {
                _pos += literal.Length;
                return true;
            }
            return false;
        }

        private Dictionary<string, object> ReadObject()
        {
            Dictionary<string, object> map = new Dictionary<string, object>(StringComparer.Ordinal);
            _pos++; // '{'
            SkipWhitespace();
            if (_pos < _src.Length && _src[_pos] == '}')
            {
                _pos++;
                return map;
            }

            while (_pos < _src.Length)
            {
                SkipWhitespace();
                string key = ReadString();
                SkipWhitespace();
                if (_pos >= _src.Length || _src[_pos] != ':')
                {
                    throw new FormatException("Expected ':' in JSON object");
                }
                _pos++;
                object val = ReadValue();
                map[key] = val;
                SkipWhitespace();
                if (_pos < _src.Length && _src[_pos] == ',')
                {
                    _pos++;
                    continue;
                }
                if (_pos < _src.Length && _src[_pos] == '}')
                {
                    _pos++;
                    return map;
                }
                break;
            }

            throw new FormatException("Unterminated JSON object");
        }

        private List<object> ReadArray()
        {
            List<object> list = new List<object>();
            _pos++; // '['
            SkipWhitespace();
            if (_pos < _src.Length && _src[_pos] == ']')
            {
                _pos++;
                return list;
            }

            while (_pos < _src.Length)
            {
                list.Add(ReadValue());
                SkipWhitespace();
                if (_pos < _src.Length && _src[_pos] == ',')
                {
                    _pos++;
                    continue;
                }
                if (_pos < _src.Length && _src[_pos] == ']')
                {
                    _pos++;
                    return list;
                }
                break;
            }

            throw new FormatException("Unterminated JSON array");
        }

        private string ReadString()
        {
            if (_pos >= _src.Length || _src[_pos] != '"')
            {
                throw new FormatException("Expected '\"'");
            }
            _pos++;
            StringBuilder sb = new StringBuilder();
            while (_pos < _src.Length)
            {
                char c = _src[_pos++];
                if (c == '"') return sb.ToString();
                if (c == '\\')
                {
                    if (_pos >= _src.Length) break;
                    char esc = _src[_pos++];
                    switch (esc)
                    {
                        case '"': sb.Append('"'); break;
                        case '\\': sb.Append('\\'); break;
                        case '/': sb.Append('/'); break;
                        case 'b': sb.Append('\b'); break;
                        case 'f': sb.Append('\f'); break;
                        case 'n': sb.Append('\n'); break;
                        case 'r': sb.Append('\r'); break;
                        case 't': sb.Append('\t'); break;
                        case 'u':
                            if (_pos + 4 <= _src.Length)
                            {
                                string hex = _src.Substring(_pos, 4);
                                int code;
                                if (int.TryParse(hex, NumberStyles.HexNumber, CultureInfo.InvariantCulture, out code))
                                {
                                    sb.Append((char)code);
                                }
                                _pos += 4;
                            }
                            break;
                        default:
                            sb.Append(esc);
                            break;
                    }
                }
                else
                {
                    sb.Append(c);
                }
            }
            throw new FormatException("Unterminated JSON string");
        }

        private double ReadNumber()
        {
            int start = _pos;
            while (_pos < _src.Length)
            {
                char c = _src[_pos];
                if ((c >= '0' && c <= '9') || c == '-' || c == '+' || c == '.' || c == 'e' || c == 'E')
                {
                    _pos++;
                }
                else
                {
                    break;
                }
            }
            string raw = _src.Substring(start, _pos - start);
            double result;
            if (!double.TryParse(raw, NumberStyles.Float, CultureInfo.InvariantCulture, out result))
            {
                throw new FormatException("Invalid JSON number: " + raw);
            }
            return result;
        }

        public static string EscapeString(string input)
        {
            if (string.IsNullOrEmpty(input)) return string.Empty;
            StringBuilder sb = new StringBuilder(input.Length);
            for (int i = 0; i < input.Length; i++)
            {
                char c = input[i];
                switch (c)
                {
                    case '\\': sb.Append("\\\\"); break;
                    case '"': sb.Append("\\\""); break;
                    case '\r': sb.Append("\\r"); break;
                    case '\n': sb.Append("\\n"); break;
                    case '\t': sb.Append("\\t"); break;
                    default:
                        if (c < 0x20)
                        {
                            sb.AppendFormat(CultureInfo.InvariantCulture, "\\u{0:x4}", (int)c);
                        }
                        else
                        {
                            sb.Append(c);
                        }
                        break;
                }
            }
            return sb.ToString();
        }
    }
}
