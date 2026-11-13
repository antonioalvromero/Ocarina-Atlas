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
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Windows.Forms;

namespace OcarinaAtlasLauncher
{
    internal static class Program
    {
        [DllImport("user32.dll")]
        private static extern bool SetProcessDPIAware();

        [STAThread]
        private static void Main(string[] args)
        {
            try
            {
                SetProcessDPIAware();
            }
            catch
            {
                // Ignore on older environments where SetProcessDPIAware is unavailable.
            }

            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            LaunchOptions options = LaunchOptions.Parse(args);
            using (MainForm form = new MainForm(options))
            {
                Application.Run(form);
            }
        }
    }

    internal sealed class LaunchOptions
    {
        public int Port = 3000;
        public string LichiiHost = "127.0.0.1";
        public int LichiiPort = 6545;
        public bool AllowLan = true;
        public string BindHost = null;
        public bool AutoOpenBrowser = true;
        public bool StartMinimized = false;
        public bool AutoStart = false;
        public string UpdateFeedUrl = null;

        public static LaunchOptions Parse(string[] args)
        {
            LaunchOptions opts = new LaunchOptions();
            string envUpdateFeed = Environment.GetEnvironmentVariable("OCARINA_ATLAS_UPDATE_URL");
            if (!string.IsNullOrEmpty(envUpdateFeed))
            {
                opts.UpdateFeedUrl = envUpdateFeed.Trim();
            }

            if (args == null) return opts;

            for (int i = 0; i < args.Length; i++)
            {
                string arg = args[i] ?? string.Empty;
                string key = arg;
                string value = null;
                int eq = arg.IndexOf('=');
                if (eq > 0)
                {
                    key = arg.Substring(0, eq);
                    value = arg.Substring(eq + 1);
                }

                if (string.Equals(key, "--port", StringComparison.OrdinalIgnoreCase))
                {
                    string raw = value ?? (i + 1 < args.Length ? args[++i] : null);
                    int parsed;
                    if (int.TryParse(raw, out parsed) && parsed >= 1 && parsed <= 65535)
                    {
                        opts.Port = parsed;
                    }
                }
                else if (string.Equals(key, "--lichii-host", StringComparison.OrdinalIgnoreCase))
                {
                    string raw = value ?? (i + 1 < args.Length ? args[++i] : null);
                    if (!string.IsNullOrEmpty(raw))
                    {
                        opts.LichiiHost = raw.Trim();
                    }
                }
                else if (string.Equals(key, "--lichii-port", StringComparison.OrdinalIgnoreCase))
                {
                    string raw = value ?? (i + 1 < args.Length ? args[++i] : null);
                    int parsed;
                    if (int.TryParse(raw, out parsed) && parsed >= 1 && parsed <= 65535)
                    {
                        opts.LichiiPort = parsed;
                    }
                }
                else if (string.Equals(key, "--lan", StringComparison.OrdinalIgnoreCase))
                {
                    opts.AllowLan = true;
                    opts.BindHost = null;
                }
                else if (string.Equals(key, "--local-only", StringComparison.OrdinalIgnoreCase) ||
                         string.Equals(key, "--localhost", StringComparison.OrdinalIgnoreCase))
                {
                    opts.AllowLan = false;
                    opts.BindHost = "127.0.0.1";
                }
                else if (string.Equals(key, "--host", StringComparison.OrdinalIgnoreCase))
                {
                    string raw = value ?? (i + 1 < args.Length ? args[++i] : null);
                    string sanitized = LanNetworkHelper.SanitizeHost(raw, null);
                    if (!string.IsNullOrEmpty(sanitized))
                    {
                        opts.BindHost = sanitized;
                        opts.AllowLan = !LanNetworkHelper.IsLoopbackHost(sanitized);
                    }
                }
                else if (string.Equals(key, "--no-browser", StringComparison.OrdinalIgnoreCase))
                {
                    opts.AutoOpenBrowser = false;
                }
                else if (string.Equals(key, "--minimized", StringComparison.OrdinalIgnoreCase))
                {
                    opts.StartMinimized = true;
                }
                else if (string.Equals(key, "--auto-start", StringComparison.OrdinalIgnoreCase))
                {
                    opts.AutoStart = true;
                }
                else if (string.Equals(key, "--update-feed", StringComparison.OrdinalIgnoreCase))
                {
                    string raw = value ?? (i + 1 < args.Length ? args[++i] : null);
                    if (!string.IsNullOrEmpty(raw))
                    {
                        opts.UpdateFeedUrl = raw.Trim();
                    }
                }
            }

            return opts;
        }
    }

    internal sealed class LanEndpoint
    {
        public string IpAddress = string.Empty;
        public string Url = string.Empty;
        public string AdapterLabel = string.Empty;
        public bool IsPreferred = false;

        public override string ToString()
        {
            if (string.IsNullOrEmpty(AdapterLabel))
            {
                return Url;
            }
            return string.Format(CultureInfo.InvariantCulture, "{0} ({1})", Url, AdapterLabel);
        }
    }

    internal static class LanNetworkHelper
    {
        private static readonly string[] VirtualKeywords = new string[]
        {
            "vethernet", "hyper-v", "wsl", "virtualbox", "vbox",
            "vmware", "docker", "veth", "utun", "loopback", "isatap", "teredo",
            "tailscale", "zerotier", "wireguard", "nordlynx", "radmin",
            "hamachi", "openvpn", "wintun", "tap-", "npcap", "bridge"
        };

        private sealed class ScoredEndpoint
        {
            public string IpAddress;
            public string AdapterLabel;
            public int Ipv4Index;
            public int Score;
        }

        [DllImport("iphlpapi.dll", SetLastError = true)]
        private static extern int GetBestInterface(uint destAddr, out uint bestIfIndex);

        private static int GetPreferredInterfaceIndex()
        {
            try
            {
                uint bestIndex;
                // 0x01010101 = 1.1.1.1 in network byte order
                int rc = GetBestInterface(0x01010101u, out bestIndex);
                if (rc == 0)
                {
                    return (int)bestIndex;
                }
            }
            catch
            {
                // Ignore on environments where iphlpapi.dll call is unavailable.
            }
            return -1;
        }

        public static string SanitizeHost(string rawHost, string fallback)
        {
            if (string.IsNullOrEmpty(rawHost)) return fallback;
            string trimmed = rawHost.Trim();
            if (trimmed.Length == 0 || trimmed.Length > 253) return fallback;
            for (int i = 0; i < trimmed.Length; i++)
            {
                char c = trimmed[i];
                bool valid = (c >= 'a' && c <= 'z') ||
                             (c >= 'A' && c <= 'Z') ||
                             (c >= '0' && c <= '9') ||
                             c == '.' || c == '-' || c == '_' || c == ':' || c == '[' || c == ']';
                if (!valid) return fallback;
            }
            return trimmed;
        }

        public static bool IsWildcardHost(string host)
        {
            if (string.IsNullOrEmpty(host)) return false;
            string normalized = host.Trim();
            return string.Equals(normalized, "0.0.0.0", StringComparison.OrdinalIgnoreCase) ||
                   string.Equals(normalized, "::", StringComparison.OrdinalIgnoreCase) ||
                   string.Equals(normalized, "0:0:0:0:0:0:0:0", StringComparison.OrdinalIgnoreCase);
        }

        public static bool IsLoopbackHost(string host)
        {
            if (string.IsNullOrEmpty(host)) return false;
            string normalized = host.Trim();
            return string.Equals(normalized, "127.0.0.1", StringComparison.OrdinalIgnoreCase) ||
                   string.Equals(normalized, "localhost", StringComparison.OrdinalIgnoreCase) ||
                   string.Equals(normalized, "::1", StringComparison.OrdinalIgnoreCase);
        }

        public static string FormatHttpUrl(string host, int port)
        {
            string cleanHost = string.IsNullOrEmpty(host) ? "127.0.0.1" : host;
            if (cleanHost.IndexOf(':') >= 0 && !cleanHost.StartsWith("[", StringComparison.Ordinal))
            {
                cleanHost = "[" + cleanHost + "]";
            }
            return string.Format(CultureInfo.InvariantCulture, "http://{0}:{1}", cleanHost, port);
        }

        public static List<string> GetLanIpv4Addresses()
        {
            List<LanEndpoint> endpoints = GetLanEndpoints(3000);
            List<string> result = new List<string>(endpoints.Count);
            for (int i = 0; i < endpoints.Count; i++)
            {
                result.Add(endpoints[i].IpAddress);
            }
            return result;
        }

        public static List<LanEndpoint> GetLanEndpoints(int port)
        {
            Dictionary<string, ScoredEndpoint> byIp = new Dictionary<string, ScoredEndpoint>(StringComparer.OrdinalIgnoreCase);
            int bestIfIndex = GetPreferredInterfaceIndex();

            try
            {
                NetworkInterface[] nics = NetworkInterface.GetAllNetworkInterfaces();
                for (int i = 0; i < nics.Length; i++)
                {
                    NetworkInterface nic = nics[i];
                    if (nic == null || nic.OperationalStatus != OperationalStatus.Up) continue;
                    if (nic.NetworkInterfaceType == NetworkInterfaceType.Loopback ||
                        nic.NetworkInterfaceType == NetworkInterfaceType.Tunnel)
                    {
                        continue;
                    }

                    string adapterSearch = ((nic.Name ?? string.Empty) + " " + (nic.Description ?? string.Empty)).ToLowerInvariant();
                    bool isVirtual = false;
                    for (int k = 0; k < VirtualKeywords.Length; k++)
                    {
                        if (adapterSearch.IndexOf(VirtualKeywords[k], StringComparison.Ordinal) >= 0)
                        {
                            isVirtual = true;
                            break;
                        }
                    }
                    if (isVirtual) continue;

                    IPInterfaceProperties props;
                    try
                    {
                        props = nic.GetIPProperties();
                    }
                    catch
                    {
                        continue;
                    }
                    if (props == null || props.UnicastAddresses == null) continue;

                    bool hasIpv4Gateway = false;
                    if (props.GatewayAddresses != null)
                    {
                        for (int g = 0; g < props.GatewayAddresses.Count; g++)
                        {
                            GatewayIPAddressInformation gw = props.GatewayAddresses[g];
                            if (gw != null && gw.Address != null &&
                                gw.Address.AddressFamily == AddressFamily.InterNetwork &&
                                !IPAddress.Any.Equals(gw.Address))
                            {
                                hasIpv4Gateway = true;
                                break;
                            }
                        }
                    }

                    int ipv4Index = -1;
                    try
                    {
                        IPv4InterfaceProperties ipv4Props = props.GetIPv4Properties();
                        if (ipv4Props != null)
                        {
                            ipv4Index = ipv4Props.Index;
                        }
                    }
                    catch
                    {
                        ipv4Index = -1;
                    }

                    bool isBestInterface = bestIfIndex >= 0 && ipv4Index == bestIfIndex;
                    string adapterLabel = !string.IsNullOrEmpty(nic.Name)
                        ? nic.Name.Trim()
                        : (!string.IsNullOrEmpty(nic.Description) ? nic.Description.Trim() : "LAN");

                    for (int u = 0; u < props.UnicastAddresses.Count; u++)
                    {
                        UnicastIPAddressInformation ua = props.UnicastAddresses[u];
                        if (ua == null || ua.Address == null) continue;
                        if (ua.Address.AddressFamily != AddressFamily.InterNetwork) continue;

                        byte[] bytes = ua.Address.GetAddressBytes();
                        if (bytes.Length != 4) continue;
                        if (bytes[0] == 127) continue;
                        if (bytes[0] == 169 && bytes[1] == 254) continue;
                        if (bytes[0] == 100 && bytes[1] >= 64 && bytes[1] <= 127) continue;

                        string ip = ua.Address.ToString();
                        int score = 0;
                        if (isBestInterface) score += 1000;
                        if (hasIpv4Gateway) score += 200;
                        if (nic.NetworkInterfaceType == NetworkInterfaceType.Wireless80211 ||
                            nic.NetworkInterfaceType == NetworkInterfaceType.Ethernet)
                        {
                            score += 50;
                        }
                        if (bytes[0] == 192 && bytes[1] == 168) score += 40;
                        else if (bytes[0] == 10) score += 30;
                        else if (bytes[0] == 172 && bytes[1] >= 16 && bytes[1] <= 31) score += 20;
                        if (ipv4Index >= 0) score += Math.Max(0, 20 - Math.Min(20, ipv4Index));

                        ScoredEndpoint existing;
                        if (!byIp.TryGetValue(ip, out existing) || score > existing.Score)
                        {
                            ScoredEndpoint item = new ScoredEndpoint();
                            item.IpAddress = ip;
                            item.AdapterLabel = adapterLabel;
                            item.Ipv4Index = ipv4Index >= 0 ? ipv4Index : int.MaxValue;
                            item.Score = score;
                            byIp[ip] = item;
                        }
                    }
                }
            }
            catch
            {
                // Best-effort network enumeration only.
            }

            List<ScoredEndpoint> scored = new List<ScoredEndpoint>(byIp.Values);
            scored.Sort(delegate(ScoredEndpoint a, ScoredEndpoint b)
            {
                int cmp = b.Score.CompareTo(a.Score);
                if (cmp != 0) return cmp;
                cmp = a.Ipv4Index.CompareTo(b.Ipv4Index);
                if (cmp != 0) return cmp;
                return string.CompareOrdinal(a.IpAddress, b.IpAddress);
            });

            List<LanEndpoint> result = new List<LanEndpoint>(scored.Count);
            for (int i = 0; i < scored.Count; i++)
            {
                LanEndpoint ep = new LanEndpoint();
                ep.IpAddress = scored[i].IpAddress;
                ep.Url = FormatHttpUrl(scored[i].IpAddress, port);
                ep.AdapterLabel = scored[i].AdapterLabel;
                ep.IsPreferred = (i == 0);
                result.Add(ep);
            }
            return result;
        }

        public static string GetFirewallRuleName(int port)
        {
            return string.Format(CultureInfo.InvariantCulture, "Ocarina Atlas (TCP {0})", port);
        }

        public static bool IsFirewallRulePresent(int port)
        {
            if (port < 1 || port > 65535) return false;
            try
            {
                ProcessStartInfo psi = new ProcessStartInfo();
                psi.FileName = "netsh.exe";
                psi.Arguments = string.Format(
                    CultureInfo.InvariantCulture,
                    "advfirewall firewall show rule name=\"{0}\"",
                    GetFirewallRuleName(port));
                psi.CreateNoWindow = true;
                psi.UseShellExecute = false;
                psi.RedirectStandardOutput = true;
                psi.RedirectStandardError = true;

                using (Process proc = Process.Start(psi))
                {
                    if (proc == null) return false;
                    proc.OutputDataReceived += delegate { };
                    proc.ErrorDataReceived += delegate { };
                    proc.BeginOutputReadLine();
                    proc.BeginErrorReadLine();
                    if (!proc.WaitForExit(2500))
                    {
                        try { proc.Kill(); } catch { }
                        return false;
                    }
                    return proc.ExitCode == 0;
                }
            }
            catch
            {
                return false;
            }
        }

        public static bool AddPrivateLanFirewallRule(int port, out bool canceledByUser, out string errorMessage)
        {
            canceledByUser = false;
            errorMessage = null;
            if (port < 1 || port > 65535)
            {
                errorMessage = "Invalid TCP port.";
                return false;
            }

            try
            {
                ProcessStartInfo psi = new ProcessStartInfo();
                psi.FileName = "netsh.exe";
                psi.Arguments = string.Format(
                    CultureInfo.InvariantCulture,
                    "advfirewall firewall add rule name=\"{0}\" dir=in action=allow protocol=TCP localport={1} profile=private",
                    GetFirewallRuleName(port),
                    port);
                psi.Verb = "runas";
                psi.UseShellExecute = true;
                psi.WindowStyle = ProcessWindowStyle.Hidden;

                using (Process proc = Process.Start(psi))
                {
                    if (proc == null)
                    {
                        errorMessage = "Could not start netsh.exe.";
                        return false;
                    }
                    if (!proc.WaitForExit(15000))
                    {
                        errorMessage = "Timed out waiting for Windows Firewall configuration.";
                        return false;
                    }
                    if (proc.ExitCode != 0)
                    {
                        errorMessage = string.Format(CultureInfo.InvariantCulture, "netsh.exe exited with code {0}.", proc.ExitCode);
                        return false;
                    }
                    return true;
                }
            }
            catch (Win32Exception ex)
            {
                if (ex.NativeErrorCode == 1223)
                {
                    canceledByUser = true;
                    errorMessage = "Administrator permission prompt was canceled.";
                    return false;
                }
                errorMessage = ex.Message;
                return false;
            }
            catch (Exception ex)
            {
                errorMessage = ex.Message;
                return false;
            }
        }
    }

    internal static class Theme
    {
        public static readonly Color Ink950 = Color.FromArgb(0x13, 0x10, 0x0C);
        public static readonly Color Ink900 = Color.FromArgb(0x1B, 0x17, 0x12);
        public static readonly Color Ink800 = Color.FromArgb(0x25, 0x20, 0x19);
        public static readonly Color Ink700 = Color.FromArgb(0x36, 0x2E, 0x24);
        public static readonly Color Ink600 = Color.FromArgb(0x4C, 0x42, 0x33);

        public static readonly Color Parchment50 = Color.FromArgb(0xF8, 0xF1, 0xE0);
        public static readonly Color Parchment200 = Color.FromArgb(0xE6, 0xD8, 0xB8);
        public static readonly Color Parchment400 = Color.FromArgb(0xC4, 0xAD, 0x7F);
        public static readonly Color Parchment600 = Color.FromArgb(0x93, 0x80, 0x5C);

        public static readonly Color Ember = Color.FromArgb(0xD9, 0x73, 0x4A);
        public static readonly Color Moss = Color.FromArgb(0x86, 0xB6, 0x7E);
    }

    /// <summary>
    /// Windows Job Object configured with JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE so any
    /// child Node.js server process is terminated automatically if the launcher exits or crashes.
    /// </summary>
    internal sealed class JobObject : IDisposable
    {
        private const int JobObjectExtendedLimitInformationClass = 9;
        private const uint JobObjectLimitKillOnJobClose = 0x00002000;

        private IntPtr _handle;
        private bool _disposed;

        [StructLayout(LayoutKind.Sequential)]
        private struct JOBOBJECT_BASIC_LIMIT_INFORMATION
        {
            public long PerProcessUserTimeLimit;
            public long PerJobUserTimeLimit;
            public uint LimitFlags;
            public UIntPtr MinimumWorkingSetSize;
            public UIntPtr MaximumWorkingSetSize;
            public uint ActiveProcessLimit;
            public UIntPtr Affinity;
            public uint PriorityClass;
            public uint SchedulingClass;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct IO_COUNTERS
        {
            public ulong ReadOperationCount;
            public ulong WriteOperationCount;
            public ulong OtherOperationCount;
            public ulong ReadTransferCount;
            public ulong WriteTransferCount;
            public ulong OtherTransferCount;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION
        {
            public JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation;
            public IO_COUNTERS IoInfo;
            public UIntPtr ProcessMemoryLimit;
            public UIntPtr JobMemoryLimit;
            public UIntPtr PeakProcessMemoryUsed;
            public UIntPtr PeakJobMemoryUsed;
        }

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern IntPtr CreateJobObject(IntPtr lpJobAttributes, string lpName);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool SetInformationJobObject(
            IntPtr hJob,
            int infoClass,
            IntPtr lpJobObjectInfo,
            uint cbJobObjectInfoLength);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool AssignProcessToJobObject(IntPtr hJob, IntPtr hProcess);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool CloseHandle(IntPtr hObject);

        public JobObject()
        {
            _handle = CreateJobObject(IntPtr.Zero, null);
            if (_handle == IntPtr.Zero)
            {
                return;
            }

            JOBOBJECT_EXTENDED_LIMIT_INFORMATION info = new JOBOBJECT_EXTENDED_LIMIT_INFORMATION();
            info.BasicLimitInformation.LimitFlags = JobObjectLimitKillOnJobClose;

            int length = Marshal.SizeOf(typeof(JOBOBJECT_EXTENDED_LIMIT_INFORMATION));
            IntPtr infoPtr = Marshal.AllocHGlobal(length);
            try
            {
                Marshal.StructureToPtr(info, infoPtr, false);
                if (!SetInformationJobObject(_handle, JobObjectExtendedLimitInformationClass, infoPtr, (uint)length))
                {
                    CloseHandle(_handle);
                    _handle = IntPtr.Zero;
                }
            }
            finally
            {
                Marshal.FreeHGlobal(infoPtr);
            }
        }

        public bool IsValid
        {
            get { return _handle != IntPtr.Zero; }
        }

        public bool Assign(Process process, out int win32Error)
        {
            win32Error = 0;
            if (_handle == IntPtr.Zero || process == null || process.HasExited)
            {
                return false;
            }

            bool ok = AssignProcessToJobObject(_handle, process.Handle);
            if (!ok)
            {
                win32Error = Marshal.GetLastWin32Error();
            }
            return ok;
        }

        public void Dispose()
        {
            if (_disposed) return;
            _disposed = true;
            if (_handle != IntPtr.Zero)
            {
                CloseHandle(_handle);
                _handle = IntPtr.Zero;
            }
        }
    }

    internal enum RuntimeMode
    {
        Standalone,
        RepoStandalone,
        RepoDev,
        Missing
    }

    internal sealed class RuntimeResolution
    {
        public RuntimeMode Mode = RuntimeMode.Missing;
        public string ExecutablePath = string.Empty;
        public string ArgumentsTemplate = string.Empty;
        public string WorkingDirectory = string.Empty;
        public string DistDirectory = string.Empty;
        public string Summary = string.Empty;
        public string ErrorMessage = string.Empty;
    }

    internal static class RuntimeResolver
    {
        public static RuntimeResolution Resolve(int port, string bindHost)
        {
            string safeBindHost = LanNetworkHelper.SanitizeHost(bindHost, "0.0.0.0");
            string exeDir = (AppDomain.CurrentDomain.BaseDirectory ?? Environment.CurrentDirectory)
                .TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);

            // 1. Standalone Release layout beside OcarinaAtlas.exe:
            //    runtime\node.exe + app\standalone-server.mjs + app\dist\
            string bundledNode = Path.Combine(exeDir, "runtime", "node.exe");
            string bundledEntry = Path.Combine(exeDir, "app", "standalone-server.mjs");
            string bundledDist = Path.Combine(exeDir, "app", "dist");
            if (File.Exists(bundledNode) && File.Exists(bundledEntry))
            {
                RuntimeResolution res = new RuntimeResolution();
                res.Mode = RuntimeMode.Standalone;
                res.ExecutablePath = bundledNode;
                res.ArgumentsTemplate = "\"" + bundledEntry + "\"";
                res.WorkingDirectory = Path.Combine(exeDir, "app");
                res.DistDirectory = Directory.Exists(bundledDist) ? bundledDist : string.Empty;
                res.Summary = "Standalone";
                return res;
            }

            // 2. Developer Repo mode: walk exeDir and CurrentDirectory upward to locate repo root.
            string repoRoot = FindRepoRoot(exeDir) ?? FindRepoRoot(Environment.CurrentDirectory);
            if (repoRoot != null)
            {
                string nodeOnPath = FindExecutableOnPath("node.exe") ?? FindCommonNodePath();
                string repoStandaloneEntry = Path.Combine(repoRoot, "dist", "standalone-server.mjs");
                if (nodeOnPath != null && File.Exists(repoStandaloneEntry))
                {
                    RuntimeResolution res = new RuntimeResolution();
                    res.Mode = RuntimeMode.RepoStandalone;
                    res.ExecutablePath = nodeOnPath;
                    res.ArgumentsTemplate = "\"" + repoStandaloneEntry + "\"";
                    res.WorkingDirectory = repoRoot;
                    res.DistDirectory = Path.Combine(repoRoot, "dist");
                    res.Summary = "Repo Bundle";
                    return res;
                }

                string npmCmd = FindExecutableOnPath("npm.cmd") ?? FindExecutableOnPath("npm");
                if (npmCmd != null)
                {
                    RuntimeResolution res = new RuntimeResolution();
                    res.Mode = RuntimeMode.RepoDev;
                    res.ExecutablePath = "cmd.exe";
                    res.ArgumentsTemplate = "/d /s /c \"\"" + npmCmd + "\" run dev -- --port " +
                        port.ToString(CultureInfo.InvariantCulture) + " --host " + safeBindHost + "\"";
                    res.WorkingDirectory = repoRoot;
                    res.Summary = "Dev Repo";
                    return res;
                }
            }

            RuntimeResolution missing = new RuntimeResolution();
            missing.Mode = RuntimeMode.Missing;
            missing.Summary = "No Runtime";
            missing.ErrorMessage = string.Format(
                "Could not find bundled runtime ({0} + {1}) or a developer repository with Node.js/npm.",
                bundledNode,
                bundledEntry);
            return missing;
        }

        private static string FindRepoRoot(string startDir)
        {
            if (string.IsNullOrEmpty(startDir)) return null;
            DirectoryInfo dir = new DirectoryInfo(startDir);
            for (int depth = 0; dir != null && depth < 6; depth++)
            {
                string pkg = Path.Combine(dir.FullName, "package.json");
                string src = Path.Combine(dir.FullName, "src");
                if (File.Exists(pkg) && Directory.Exists(src))
                {
                    return dir.FullName;
                }
                dir = dir.Parent;
            }
            return null;
        }

        private static string FindCommonNodePath()
        {
            string programFiles = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
            string candidate = Path.Combine(programFiles, "nodejs", "node.exe");
            return File.Exists(candidate) ? candidate : null;
        }

        private static string FindExecutableOnPath(string fileName)
        {
            string pathEnv = Environment.GetEnvironmentVariable("PATH");
            if (string.IsNullOrEmpty(pathEnv)) return null;
            string[] parts = pathEnv.Split(new[] { ';' }, StringSplitOptions.RemoveEmptyEntries);
            for (int i = 0; i < parts.Length; i++)
            {
                string folder = parts[i].Trim().Trim('"');
                if (string.IsNullOrEmpty(folder)) continue;
                try
                {
                    string full = Path.Combine(folder, fileName);
                    if (File.Exists(full)) return full;
                }
                catch
                {
                    // Skip invalid PATH entries.
                }
            }
            return null;
        }
    }

    internal sealed class LichiiConfigStatus
    {
        public string FilePath = string.Empty;
        public List<string> TargetPaths = new List<string>();
        public bool FileExists = false;
        public bool IsEnabled = false;
        public string ConfiguredTarget = string.Empty;
        public string ErrorMessage = string.Empty;
    }

    internal static class LichiiConfigManager
    {
        private static readonly string[] ProfileDirNames = new[] { "fritchii", "lichii" };

        private static readonly Regex ActiveSwitchRegex = new Regex(
            @"^\s*EDEN_NX2_DEBUG_SERVER\s*=\s*(.+?)\s*$",
            RegexOptions.Compiled);

        public static string GetConfigPath()
        {
            List<string> paths = GetTargetConfigPaths();
            return paths.Count > 0 ? paths[0] : string.Empty;
        }

        public static List<string> GetTargetConfigPaths()
        {
            string appData = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
            List<string> existing = new List<string>();
            List<string> all = new List<string>();

            for (int i = 0; i < ProfileDirNames.Length; i++)
            {
                string dir = Path.Combine(appData, ProfileDirNames[i]);
                string cfg = Path.Combine(dir, "nx2_switches.txt");
                all.Add(cfg);
                if (Directory.Exists(dir))
                {
                    existing.Add(cfg);
                }
            }

            return existing.Count > 0 ? existing : all;
        }

        private static bool TryReadSwitchTarget(string configPath, out bool fileExists, out string target)
        {
            fileExists = File.Exists(configPath);
            target = string.Empty;
            if (!fileExists)
            {
                return false;
            }

            bool enabled = false;
            string[] lines = File.ReadAllLines(configPath, Encoding.UTF8);
            for (int i = 0; i < lines.Length; i++)
            {
                string line = lines[i] ?? string.Empty;
                string trimmed = line.TrimStart();
                if (trimmed.StartsWith("#", StringComparison.Ordinal))
                {
                    continue;
                }

                Match match = ActiveSwitchRegex.Match(line);
                if (match.Success)
                {
                    string val = match.Groups[1].Value.Trim();
                    if (!string.IsNullOrEmpty(val))
                    {
                        enabled = true;
                        target = val;
                    }
                }
            }

            return enabled;
        }

        public static LichiiConfigStatus Inspect()
        {
            LichiiConfigStatus status = new LichiiConfigStatus();
            List<string> targetPaths = GetTargetConfigPaths();
            status.TargetPaths.AddRange(targetPaths);
            status.FilePath = targetPaths.Count > 0 ? targetPaths[0] : string.Empty;

            try
            {
                bool anyExists = false;
                bool allEnabled = targetPaths.Count > 0;
                string lastTarget = string.Empty;

                for (int i = 0; i < targetPaths.Count; i++)
                {
                    bool exists;
                    string target;
                    bool enabled = TryReadSwitchTarget(targetPaths[i], out exists, out target);
                    if (exists)
                    {
                        anyExists = true;
                    }
                    if (!enabled)
                    {
                        allEnabled = false;
                    }
                    else if (!string.IsNullOrEmpty(target))
                    {
                        lastTarget = target;
                    }
                }

                status.FileExists = anyExists;
                status.IsEnabled = allEnabled;
                status.ConfiguredTarget = lastTarget;
            }
            catch (Exception ex)
            {
                status.ErrorMessage = ex.Message;
            }

            return status;
        }

        private static void UpdateSingleConfigFile(string configPath, string newLine)
        {
            string configDir = Path.GetDirectoryName(configPath);

            if (!string.IsNullOrEmpty(configDir) && !Directory.Exists(configDir))
            {
                Directory.CreateDirectory(configDir);
            }

            List<string> outLines = new List<string>();
            string newlineSeq = "\r\n";

            if (File.Exists(configPath))
            {
                string rawText = File.ReadAllText(configPath, new UTF8Encoding(false));
                if (rawText.Contains("\n") && !rawText.Contains("\r\n"))
                {
                    newlineSeq = "\n";
                }

                string[] existingLines = rawText.Split(new[] { "\r\n", "\n" }, StringSplitOptions.None);
                bool replaced = false;

                for (int i = 0; i < existingLines.Length; i++)
                {
                    string line = existingLines[i];
                    string trimmed = line.TrimStart();
                    if (!trimmed.StartsWith("#", StringComparison.Ordinal) && ActiveSwitchRegex.IsMatch(line))
                    {
                        if (!replaced)
                        {
                            outLines.Add(newLine);
                            replaced = true;
                        }
                        // Drop duplicate active EDEN_NX2_DEBUG_SERVER lines if any existed.
                        continue;
                    }
                    outLines.Add(line);
                }

                if (!replaced)
                {
                    // Trim trailing single empty split entry if file ended with newline, then append cleanly.
                    if (outLines.Count > 0 && outLines[outLines.Count - 1].Length == 0)
                    {
                        outLines.RemoveAt(outLines.Count - 1);
                    }
                    outLines.Add(newLine);
                }
            }
            else
            {
                outLines.Add("# Emulator NX2 switches (configured by Ocarina Atlas)");
                outLines.Add("# Restart Lichii / Fritchii after editing.");
                outLines.Add(newLine);
            }

            string finalContent = string.Join(newlineSeq, outLines.ToArray());
            if (!finalContent.EndsWith(newlineSeq, StringComparison.Ordinal))
            {
                finalContent += newlineSeq;
            }

            File.WriteAllText(configPath, finalContent, new UTF8Encoding(false));
        }

        public static LichiiConfigStatus EnableDebugServer(string host, int port)
        {
            string target = string.Format(
                CultureInfo.InvariantCulture,
                "{0}:{1}",
                string.IsNullOrEmpty(host) ? "127.0.0.1" : host.Trim(),
                port);
            string newLine = "EDEN_NX2_DEBUG_SERVER=" + target;
            List<string> targetPaths = GetTargetConfigPaths();

            for (int i = 0; i < targetPaths.Count; i++)
            {
                UpdateSingleConfigFile(targetPaths[i], newLine);
            }

            return Inspect();
        }

        public static string DetectRunningEmulator()
        {
            string[] names = new[] { "fritchii", "lichii", "eden" };
            string detected = null;

            for (int i = 0; i < names.Length; i++)
            {
                try
                {
                    Process[] procs = Process.GetProcessesByName(names[i]);
                    if (procs != null && procs.Length > 0)
                    {
                        for (int j = 0; j < procs.Length; j++)
                        {
                            Process proc = procs[j];
                            if (detected == null)
                            {
                                detected = ClassifyEmulatorProcess(proc, names[i]);
                            }
                            proc.Dispose();
                        }
                    }
                }
                catch
                {
                    // Ignore process inspection failure.
                }
            }

            return detected;
        }

        private static string ClassifyEmulatorProcess(Process proc, string fallbackName)
        {
            if (string.Equals(fallbackName, "fritchii", StringComparison.OrdinalIgnoreCase))
            {
                return "Fritchii";
            }

            try
            {
                string title = proc.MainWindowTitle ?? string.Empty;
                if (title.IndexOf("fritchii", StringComparison.OrdinalIgnoreCase) >= 0)
                {
                    return "Fritchii";
                }
                if (title.IndexOf("lichii", StringComparison.OrdinalIgnoreCase) >= 0)
                {
                    return "Lichii";
                }
            }
            catch
            {
                // Ignore window title inspection failure.
            }

            try
            {
                if (proc.MainModule != null && !string.IsNullOrEmpty(proc.MainModule.FileName))
                {
                    string exePath = proc.MainModule.FileName;
                    if (exePath.IndexOf("fritchii", StringComparison.OrdinalIgnoreCase) >= 0)
                    {
                        return "Fritchii";
                    }
                }
            }
            catch
            {
                // Ignore module path inspection failure.
            }

            if (string.Equals(fallbackName, "lichii", StringComparison.OrdinalIgnoreCase))
            {
                return "Lichii";
            }

            return "Emulator";
        }

        public static bool IsLichiiRunning()
        {
            return DetectRunningEmulator() != null;
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
    }

    internal sealed class QrCodeEncoder
    {
        // Byte-mode capacity & Reed-Solomon parameters for Versions 1-6, ECC Level M.
        private static readonly int[] MaxBytes = { 0, 14, 26, 42, 62, 84, 106 };
        private static readonly int[] DataCodewords = { 0, 16, 28, 44, 64, 86, 108 };
        private static readonly int[] EcPerBlock = { 0, 10, 16, 26, 18, 24, 16 };
        private static readonly int[] BlockCount = { 0, 1, 1, 1, 2, 2, 4 };

        private static readonly int[] GfExp = new int[512];
        private static readonly int[] GfLog = new int[256];

        static QrCodeEncoder()
        {
            int x = 1;
            for (int i = 0; i < 255; i++)
            {
                GfExp[i] = x;
                GfLog[x] = i;
                x <<= 1;
                if ((x & 0x100) != 0)
                {
                    x ^= 0x11D;
                }
            }
            for (int i = 255; i < 512; i++)
            {
                GfExp[i] = GfExp[i - 255];
            }
        }

        public static bool[,] Encode(string text)
        {
            if (string.IsNullOrEmpty(text)) return null;
            byte[] utf8 = Encoding.UTF8.GetBytes(text);
            int version = 0;
            for (int v = 1; v <= 6; v++)
            {
                if (utf8.Length <= MaxBytes[v])
                {
                    version = v;
                    break;
                }
            }
            if (version == 0) return null;

            int dataCount = DataCodewords[version];
            byte[] dataBytes = BuildDataCodewords(utf8, dataCount);
            byte[] allCodewords = BuildInterleavedCodewords(dataBytes, version);

            int size = 17 + version * 4;
            bool[,] modules = new bool[size, size];
            bool[,] isFunction = new bool[size, size];

            PlaceFunctionPatterns(modules, isFunction, size, version);
            PlaceDataBits(modules, isFunction, size, allCodewords);

            int bestMask = 0;
            int bestPenalty = int.MaxValue;
            for (int mask = 0; mask < 8; mask++)
            {
                bool[,] trial = (bool[,])modules.Clone();
                ApplyMask(trial, isFunction, size, mask);
                WriteFormatInfo(trial, size, mask);
                int penalty = ComputePenalty(trial, size);
                if (penalty < bestPenalty)
                {
                    bestPenalty = penalty;
                    bestMask = mask;
                }
            }

            ApplyMask(modules, isFunction, size, bestMask);
            WriteFormatInfo(modules, size, bestMask);
            return modules;
        }

        public static Bitmap RenderBitmap(string text, int targetSizePx)
        {
            bool[,] matrix = Encode(text);
            if (matrix == null || targetSizePx <= 0) return null;

            int modules = matrix.GetLength(0);
            int totalModules = modules + 8; // ISO/IEC 18004 requires a 4-module quiet zone on each side
            int scale = Math.Max(1, targetSizePx / totalModules);
            int qrPx = modules * scale;
            int offset = (targetSizePx - qrPx) / 2;

            const int whiteArgb = unchecked((int)0xFFFFFFFF);
            const int blackArgb = unchecked((int)0xFF000000);

            int[] pixels = new int[targetSizePx * targetSizePx];
            for (int i = 0; i < pixels.Length; i++)
            {
                pixels[i] = whiteArgb;
            }

            for (int r = 0; r < modules; r++)
            {
                int baseY = offset + r * scale;
                for (int c = 0; c < modules; c++)
                {
                    if (!matrix[r, c]) continue;
                    int baseX = offset + c * scale;
                    for (int dy = 0; dy < scale; dy++)
                    {
                        int y = baseY + dy;
                        if (y < 0 || y >= targetSizePx) continue;
                        int rowOffset = y * targetSizePx;
                        for (int dx = 0; dx < scale; dx++)
                        {
                            int x = baseX + dx;
                            if (x >= 0 && x < targetSizePx)
                            {
                                pixels[rowOffset + x] = blackArgb;
                            }
                        }
                    }
                }
            }

            Bitmap bmp = new Bitmap(targetSizePx, targetSizePx, PixelFormat.Format32bppArgb);
            BitmapData data = bmp.LockBits(
                new Rectangle(0, 0, targetSizePx, targetSizePx),
                ImageLockMode.WriteOnly,
                PixelFormat.Format32bppArgb);
            try
            {
                Marshal.Copy(pixels, 0, data.Scan0, pixels.Length);
            }
            finally
            {
                bmp.UnlockBits(data);
            }
            return bmp;
        }

        private static byte[] BuildDataCodewords(byte[] utf8, int dataCount)
        {
            byte[] result = new byte[dataCount];
            int bitPos = 0;
            int capacityBits = dataCount * 8;

            AppendBits(result, ref bitPos, 0x4, 4);
            AppendBits(result, ref bitPos, utf8.Length, 8);
            for (int i = 0; i < utf8.Length; i++)
            {
                AppendBits(result, ref bitPos, utf8[i], 8);
            }

            int terminatorBits = Math.Min(4, capacityBits - bitPos);
            if (terminatorBits > 0)
            {
                AppendBits(result, ref bitPos, 0, terminatorBits);
            }

            int padByteStart = (bitPos + 7) / 8;
            for (int i = padByteStart; i < dataCount; i++)
            {
                result[i] = ((i - padByteStart) % 2 == 0) ? (byte)0xEC : (byte)0x11;
            }
            return result;
        }

        private static void AppendBits(byte[] buffer, ref int bitPos, int value, int bitCount)
        {
            for (int i = bitCount - 1; i >= 0; i--)
            {
                if (((value >> i) & 1) != 0)
                {
                    buffer[bitPos >> 3] |= (byte)(1 << (7 - (bitPos & 7)));
                }
                bitPos++;
            }
        }

        private static byte[] BuildInterleavedCodewords(byte[] data, int version)
        {
            int numBlocks = BlockCount[version];
            int ecCount = EcPerBlock[version];
            int dataPerBlock = data.Length / numBlocks;

            byte[] gen = BuildRsGenerator(ecCount);
            byte[][] dataBlocks = new byte[numBlocks][];
            byte[][] ecBlocks = new byte[numBlocks][];

            for (int b = 0; b < numBlocks; b++)
            {
                byte[] block = new byte[dataPerBlock];
                Array.Copy(data, b * dataPerBlock, block, 0, dataPerBlock);
                dataBlocks[b] = block;
                ecBlocks[b] = ComputeRsRemainder(block, gen, ecCount);
            }

            byte[] output = new byte[data.Length + numBlocks * ecCount];
            int idx = 0;
            for (int i = 0; i < dataPerBlock; i++)
            {
                for (int b = 0; b < numBlocks; b++)
                {
                    output[idx++] = dataBlocks[b][i];
                }
            }
            for (int i = 0; i < ecCount; i++)
            {
                for (int b = 0; b < numBlocks; b++)
                {
                    output[idx++] = ecBlocks[b][i];
                }
            }
            return output;
        }

        private static int GfMul(int a, int b)
        {
            if (a == 0 || b == 0) return 0;
            return GfExp[GfLog[a] + GfLog[b]];
        }

        private static byte[] BuildRsGenerator(int degree)
        {
            byte[] gen = new byte[degree + 1];
            gen[0] = 1;
            for (int i = 0; i < degree; i++)
            {
                int root = GfExp[i];
                for (int k = i + 1; k >= 1; k--)
                {
                    gen[k] = (byte)(gen[k] ^ GfMul(gen[k - 1], root));
                }
            }
            return gen;
        }

        private static byte[] ComputeRsRemainder(byte[] data, byte[] gen, int ecCount)
        {
            byte[] rem = new byte[ecCount];
            for (int i = 0; i < data.Length; i++)
            {
                byte factor = (byte)(data[i] ^ rem[0]);
                for (int j = 0; j < ecCount - 1; j++)
                {
                    rem[j] = rem[j + 1];
                }
                rem[ecCount - 1] = 0;
                if (factor != 0)
                {
                    for (int j = 0; j < ecCount; j++)
                    {
                        rem[j] = (byte)(rem[j] ^ GfMul(gen[j + 1], factor));
                    }
                }
            }
            return rem;
        }

        private static void PlaceFunctionPatterns(bool[,] modules, bool[,] isFunction, int size, int version)
        {
            PlaceFinderPattern(modules, isFunction, size, 0, 0);
            PlaceFinderPattern(modules, isFunction, size, 0, size - 7);
            PlaceFinderPattern(modules, isFunction, size, size - 7, 0);

            for (int i = 8; i < size - 8; i++)
            {
                bool dark = (i % 2) == 0;
                modules[6, i] = dark;
                isFunction[6, i] = true;
                modules[i, 6] = dark;
                isFunction[i, 6] = true;
            }

            if (version >= 2)
            {
                int center = size - 7;
                for (int dr = -2; dr <= 2; dr++)
                {
                    for (int dc = -2; dc <= 2; dc++)
                    {
                        modules[center + dr, center + dc] = Math.Max(Math.Abs(dr), Math.Abs(dc)) != 1;
                        isFunction[center + dr, center + dc] = true;
                    }
                }
            }

            // Reserve format info areas and dark module
            for (int i = 0; i <= 8; i++)
            {
                isFunction[8, i] = true;
                isFunction[i, 8] = true;
            }
            for (int c = size - 8; c < size; c++)
            {
                isFunction[8, c] = true;
            }
            for (int r = size - 8; r < size; r++)
            {
                isFunction[r, 8] = true;
            }
            modules[size - 8, 8] = true;
        }

        private static void PlaceFinderPattern(bool[,] modules, bool[,] isFunction, int size, int top, int left)
        {
            for (int dr = -1; dr <= 7; dr++)
            {
                int r = top + dr;
                if (r < 0 || r >= size) continue;
                for (int dc = -1; dc <= 7; dc++)
                {
                    int c = left + dc;
                    if (c < 0 || c >= size) continue;
                    int dist = Math.Max(Math.Abs(dr - 3), Math.Abs(dc - 3));
                    modules[r, c] = (dist != 2 && dist != 4);
                    isFunction[r, c] = true;
                }
            }
        }

        private static void PlaceDataBits(bool[,] modules, bool[,] isFunction, int size, byte[] codewords)
        {
            int bitIdx = 0;
            int totalBits = codewords.Length * 8;
            bool upward = true;

            for (int right = size - 1; right >= 1; right -= 2)
            {
                if (right == 6) right = 5;
                for (int vert = 0; vert < size; vert++)
                {
                    int r = upward ? (size - 1 - vert) : vert;
                    for (int j = 0; j < 2; j++)
                    {
                        int c = right - j;
                        if (!isFunction[r, c])
                        {
                            bool bit = false;
                            if (bitIdx < totalBits)
                            {
                                bit = ((codewords[bitIdx >> 3] >> (7 - (bitIdx & 7))) & 1) != 0;
                                bitIdx++;
                            }
                            modules[r, c] = bit;
                        }
                    }
                }
                upward = !upward;
            }
        }

        private static void ApplyMask(bool[,] modules, bool[,] isFunction, int size, int mask)
        {
            for (int r = 0; r < size; r++)
            {
                for (int c = 0; c < size; c++)
                {
                    if (isFunction[r, c]) continue;
                    bool invert = false;
                    switch (mask)
                    {
                        case 0: invert = ((r + c) % 2) == 0; break;
                        case 1: invert = (r % 2) == 0; break;
                        case 2: invert = (c % 3) == 0; break;
                        case 3: invert = ((r + c) % 3) == 0; break;
                        case 4: invert = (((r / 2) + (c / 3)) % 2) == 0; break;
                        case 5: invert = (((r * c) % 2) + ((r * c) % 3)) == 0; break;
                        case 6: invert = ((((r * c) % 2) + ((r * c) % 3)) % 2) == 0; break;
                        case 7: invert = ((((r + c) % 2) + ((r * c) % 3)) % 2) == 0; break;
                    }
                    if (invert)
                    {
                        modules[r, c] = !modules[r, c];
                    }
                }
            }
        }

        private static void WriteFormatInfo(bool[,] modules, int size, int mask)
        {
            // ECC Level M = 00
            int data = mask & 0x7;
            int rem = data << 10;
            for (int i = 4; i >= 0; i--)
            {
                if (((rem >> (i + 10)) & 1) != 0)
                {
                    rem ^= (0x537 << i);
                }
            }
            int bits = ((data << 10) | rem) ^ 0x5412;

            for (int i = 0; i <= 5; i++)
            {
                modules[8, i] = ((bits >> (14 - i)) & 1) != 0;
            }
            modules[8, 7] = ((bits >> 8) & 1) != 0;
            modules[8, 8] = ((bits >> 7) & 1) != 0;
            modules[7, 8] = ((bits >> 6) & 1) != 0;
            for (int i = 9; i < 15; i++)
            {
                modules[14 - i, 8] = ((bits >> (14 - i)) & 1) != 0;
            }

            for (int i = 0; i < 7; i++)
            {
                modules[size - 1 - i, 8] = ((bits >> (14 - i)) & 1) != 0;
            }
            for (int i = 7; i < 15; i++)
            {
                modules[8, size - 15 + i] = ((bits >> (14 - i)) & 1) != 0;
            }
        }

        private static int ComputePenalty(bool[,] modules, int size)
        {
            int penalty = 0;

            // N1: 5+ consecutive modules in row or col
            for (int r = 0; r < size; r++)
            {
                int run = 1;
                for (int c = 1; c < size; c++)
                {
                    if (modules[r, c] == modules[r, c - 1])
                    {
                        run++;
                        if (run == 5) penalty += 3;
                        else if (run > 5) penalty += 1;
                    }
                    else
                    {
                        run = 1;
                    }
                }
            }
            for (int c = 0; c < size; c++)
            {
                int run = 1;
                for (int r = 1; r < size; r++)
                {
                    if (modules[r, c] == modules[r - 1, c])
                    {
                        run++;
                        if (run == 5) penalty += 3;
                        else if (run > 5) penalty += 1;
                    }
                    else
                    {
                        run = 1;
                    }
                }
            }

            // N2: 2x2 blocks of same color
            for (int r = 0; r < size - 1; r++)
            {
                for (int c = 0; c < size - 1; c++)
                {
                    bool v = modules[r, c];
                    if (modules[r, c + 1] == v && modules[r + 1, c] == v && modules[r + 1, c + 1] == v)
                    {
                        penalty += 3;
                    }
                }
            }

            // N3: 1:1:3:1:1 finder-like pattern preceded or followed by 4 light modules
            for (int r = 0; r < size; r++)
            {
                for (int c = 0; c <= size - 11; c++)
                {
                    if (IsFinderLikeRow(modules, r, c))
                    {
                        penalty += 40;
                    }
                }
            }
            for (int c = 0; c < size; c++)
            {
                for (int r = 0; r <= size - 11; r++)
                {
                    if (IsFinderLikeCol(modules, r, c))
                    {
                        penalty += 40;
                    }
                }
            }

            // N4: dark module ratio deviation from 50%
            int dark = 0;
            for (int r = 0; r < size; r++)
            {
                for (int c = 0; c < size; c++)
                {
                    if (modules[r, c]) dark++;
                }
            }
            int total = size * size;
            int k = Math.Abs(dark * 20 - total * 10) / total;
            penalty += k * 10;

            return penalty;
        }

        private static bool IsFinderLikeRow(bool[,] modules, int r, int c)
        {
            // 1011101 + 0000 or 0000 + 1011101
            bool forward =
                modules[r, c] && !modules[r, c + 1] && modules[r, c + 2] && modules[r, c + 3] &&
                modules[r, c + 4] && !modules[r, c + 5] && modules[r, c + 6] &&
                !modules[r, c + 7] && !modules[r, c + 8] && !modules[r, c + 9] && !modules[r, c + 10];
            bool backward =
                !modules[r, c] && !modules[r, c + 1] && !modules[r, c + 2] && !modules[r, c + 3] &&
                modules[r, c + 4] && !modules[r, c + 5] && modules[r, c + 6] && modules[r, c + 7] &&
                modules[r, c + 8] && !modules[r, c + 9] && modules[r, c + 10];
            return forward || backward;
        }

        private static bool IsFinderLikeCol(bool[,] modules, int r, int c)
        {
            bool forward =
                modules[r, c] && !modules[r + 1, c] && modules[r + 2, c] && modules[r + 3, c] &&
                modules[r + 4, c] && !modules[r + 5, c] && modules[r + 6, c] &&
                !modules[r + 7, c] && !modules[r + 8, c] && !modules[r + 9, c] && !modules[r + 10, c];
            bool backward =
                !modules[r, c] && !modules[r + 1, c] && !modules[r + 2, c] && !modules[r + 3, c] &&
                modules[r + 4, c] && !modules[r + 5, c] && modules[r + 6, c] && modules[r + 7, c] &&
                modules[r + 8, c] && !modules[r + 9, c] && modules[r + 10, c];
            return forward || backward;
        }
    }

    internal sealed class PollSnapshot
    {
        public bool ServerHttpOk;
        public bool RpcPortOpen;
        public bool Connected;
        public bool EmulatorRunning;
        public string RunningEmulator;
        public string Source;
        public string Scene;
        public string PlaceName;
        public string MapId;
        public string Age;
        public int? SkulltulaCount;
    }

    internal enum ServerLifecycle
    {
        Stopped,
        Starting,
        Running,
        Stopping
    }

    internal sealed class BorderedPanel : Panel
    {
        public Color BorderColor = Theme.Ink600;
        public Color FillColor = Theme.Ink900;
        public int CornerRadius = 8;

        public BorderedPanel()
        {
            SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw, true);
            BackColor = Theme.Ink900;
        }

        private static GraphicsPath CreateRoundedRectPath(Rectangle bounds, int radius)
        {
            GraphicsPath path = new GraphicsPath();
            int diameter = radius * 2;
            if (diameter <= 0 || diameter > bounds.Width || diameter > bounds.Height)
            {
                path.AddRectangle(bounds);
                return path;
            }

            Rectangle arc = new Rectangle(bounds.Location, new Size(diameter, diameter));
            path.AddArc(arc, 180, 90);
            arc.X = bounds.Right - diameter;
            path.AddArc(arc, 270, 90);
            arc.Y = bounds.Bottom - diameter;
            path.AddArc(arc, 0, 90);
            arc.X = bounds.Left;
            path.AddArc(arc, 90, 90);
            path.CloseFigure();
            return path;
        }

        protected override void OnPaintBackground(PaintEventArgs e)
        {
            Color parentBack = Parent != null ? Parent.BackColor : Theme.Ink950;
            using (SolidBrush outerBrush = new SolidBrush(parentBack))
            {
                e.Graphics.FillRectangle(outerBrush, ClientRectangle);
            }
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
            Rectangle rect = new Rectangle(0, 0, Math.Max(1, Width - 1), Math.Max(1, Height - 1));
            using (GraphicsPath path = CreateRoundedRectPath(rect, CornerRadius))
            using (SolidBrush fillBrush = new SolidBrush(FillColor))
            using (Pen borderPen = new Pen(BorderColor, 1f))
            {
                e.Graphics.FillPath(fillBrush, path);
                e.Graphics.DrawPath(borderPen, path);
            }
        }
    }

    internal sealed class StatusDot : Control
    {
        private Color _dotColor = Theme.Parchment600;

        public StatusDot()
        {
            SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.SupportsTransparentBackColor, true);
            Size = new Size(12, 12);
            TabStop = false;
        }

        [DesignerSerializationVisibility(DesignerSerializationVisibility.Hidden)]
        public Color DotColor
        {
            get { return _dotColor; }
            set
            {
                if (_dotColor != value)
                {
                    _dotColor = value;
                    Invalidate();
                }
            }
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            base.OnPaint(e);
            e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
            int size = Math.Min(Width, Height) - 2;
            if (size < 4) size = 4;
            int x = (Width - size) / 2;
            int y = (Height - size) / 2;
            using (SolidBrush brush = new SolidBrush(_dotColor))
            {
                e.Graphics.FillEllipse(brush, x, y, size, size);
            }
        }
    }

    internal sealed class UpdateInfo
    {
        public string DisplayTag = string.Empty;
        public string ReleaseName = string.Empty;
        public string ReleaseNotes = string.Empty;
        public string HtmlUrl = UpdateManager.DefaultReleaseFallbackUrl;
        public string ZipDownloadUrl = string.Empty;
        public Version ParsedVersion;
    }

    internal static class UpdateManager
    {
        public const string DefaultReleaseApiUrl = "https://api.github.com/repos/antonioalvromero/Ocarina-Atlas/releases/latest";
        public const string DefaultReleaseFallbackUrl = "https://github.com/antonioalvromero/Ocarina-Atlas/releases/latest";

        public static string ResolveFeedUrl(string overrideUrl)
        {
            if (!string.IsNullOrEmpty(overrideUrl) && IsAllowedUpdateUrl(overrideUrl))
            {
                return overrideUrl.Trim();
            }
            return DefaultReleaseApiUrl;
        }

        public static bool IsAllowedUpdateUrl(string rawUrl)
        {
            if (string.IsNullOrEmpty(rawUrl)) return false;
            string trimmed = rawUrl.Trim();
            Uri uri;
            if (!Uri.TryCreate(trimmed, UriKind.Absolute, out uri)) return false;

            if (string.Equals(uri.Scheme, Uri.UriSchemeHttp, StringComparison.OrdinalIgnoreCase))
            {
                return uri.IsLoopback;
            }

            if (string.Equals(uri.Scheme, Uri.UriSchemeHttps, StringComparison.OrdinalIgnoreCase))
            {
                string host = uri.Host ?? string.Empty;
                return string.Equals(host, "github.com", StringComparison.OrdinalIgnoreCase) ||
                       host.EndsWith(".github.com", StringComparison.OrdinalIgnoreCase) ||
                       host.EndsWith(".githubusercontent.com", StringComparison.OrdinalIgnoreCase);
            }

            return false;
        }

        public static Version ParseComparableVersion(string raw)
        {
            if (string.IsNullOrEmpty(raw)) return null;
            string s = raw.Trim();
            if (s.StartsWith("v", StringComparison.OrdinalIgnoreCase))
            {
                s = s.Substring(1);
            }
            int dash = s.IndexOf('-');
            if (dash >= 0)
            {
                s = s.Substring(0, dash);
            }
            int plus = s.IndexOf('+');
            if (plus >= 0)
            {
                s = s.Substring(0, plus);
            }
            Version parsed;
            if (Version.TryParse(s, out parsed))
            {
                return parsed;
            }
            return null;
        }

        public static UpdateInfo ParseReleaseJson(string json, string currentAppVersion)
        {
            Dictionary<string, object> obj = SimpleJsonParser.ParseObject(json);
            if (obj == null) return null;

            string tagName = SimpleJsonParser.GetString(obj, "tag_name");
            Version latestVer = ParseComparableVersion(tagName);
            Version currentVer = ParseComparableVersion(currentAppVersion);
            if (latestVer == null || currentVer == null || latestVer <= currentVer)
            {
                return null;
            }

            string displayTag = tagName.Trim();
            if (!displayTag.StartsWith("v", StringComparison.OrdinalIgnoreCase))
            {
                displayTag = "v" + displayTag;
            }

            string releaseName = SimpleJsonParser.GetString(obj, "name");
            if (string.IsNullOrEmpty(releaseName))
            {
                releaseName = displayTag;
            }
            else
            {
                releaseName = releaseName.Trim();
            }

            string rawBody = SimpleJsonParser.GetString(obj, "body");
            string cleanNotes = CleanReleaseNotes(rawBody);

            string htmlUrl = SimpleJsonParser.GetString(obj, "html_url");
            string targetHtmlUrl = DefaultReleaseFallbackUrl;
            if (!string.IsNullOrEmpty(htmlUrl) && IsAllowedUpdateUrl(htmlUrl))
            {
                targetHtmlUrl = htmlUrl.Trim();
            }

            string zipUrl = string.Empty;
            string fallbackZipUrl = string.Empty;
            List<object> assets = SimpleJsonParser.GetArray(obj, "assets");
            if (assets != null)
            {
                for (int i = 0; i < assets.Count; i++)
                {
                    Dictionary<string, object> asset = assets[i] as Dictionary<string, object>;
                    if (asset == null) continue;

                    string assetName = SimpleJsonParser.GetString(asset, "name");
                    string downloadUrl = SimpleJsonParser.GetString(asset, "browser_download_url");
                    if (string.IsNullOrEmpty(assetName) || string.IsNullOrEmpty(downloadUrl)) continue;
                    if (!IsAllowedUpdateUrl(downloadUrl)) continue;

                    if (string.Equals(assetName, "OcarinaAtlas-Windows-x64.zip", StringComparison.OrdinalIgnoreCase))
                    {
                        zipUrl = downloadUrl.Trim();
                        break;
                    }
                    if (string.IsNullOrEmpty(fallbackZipUrl) &&
                        assetName.EndsWith(".zip", StringComparison.OrdinalIgnoreCase))
                    {
                        fallbackZipUrl = downloadUrl.Trim();
                    }
                }
            }

            if (string.IsNullOrEmpty(zipUrl))
            {
                zipUrl = fallbackZipUrl;
            }

            UpdateInfo info = new UpdateInfo();
            info.DisplayTag = displayTag;
            info.ReleaseName = releaseName;
            info.ReleaseNotes = cleanNotes;
            info.HtmlUrl = targetHtmlUrl;
            info.ZipDownloadUrl = zipUrl;
            info.ParsedVersion = latestVer;
            return info;
        }

        public static string CleanReleaseNotes(string raw)
        {
            if (string.IsNullOrEmpty(raw))
            {
                return "No release notes provided.";
            }
            string normalized = raw.Replace("\r\n", "\n").Replace("\r", "\n").Trim();
            if (normalized.Length == 0)
            {
                return "No release notes provided.";
            }
            return normalized.Replace("\n", Environment.NewLine);
        }

        public static string GetSkippedVersionFilePath()
        {
            string localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            return Path.Combine(Path.Combine(localAppData, "OcarinaAtlas"), "skipped-version.txt");
        }

        public static string ReadSkippedVersion()
        {
            return ReadSkippedVersion(GetSkippedVersionFilePath());
        }

        public static string ReadSkippedVersion(string filePath)
        {
            try
            {
                if (string.IsNullOrEmpty(filePath) || !File.Exists(filePath)) return string.Empty;
                return (File.ReadAllText(filePath, Encoding.UTF8) ?? string.Empty).Trim();
            }
            catch
            {
                return string.Empty;
            }
        }

        public static void WriteSkippedVersion(string versionTag)
        {
            WriteSkippedVersion(versionTag, GetSkippedVersionFilePath());
        }

        public static void WriteSkippedVersion(string versionTag, string filePath)
        {
            if (string.IsNullOrEmpty(filePath)) return;
            string dir = Path.GetDirectoryName(filePath);
            if (!string.IsNullOrEmpty(dir) && !Directory.Exists(dir))
            {
                Directory.CreateDirectory(dir);
            }
            File.WriteAllText(filePath, (versionTag ?? string.Empty).Trim(), Encoding.UTF8);
        }

        public static string GetUpdateLogPath()
        {
            string localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            if (string.IsNullOrEmpty(localAppData))
            {
                localAppData = Path.GetTempPath();
            }
            return Path.Combine(Path.Combine(localAppData, "OcarinaAtlas"), "update.log");
        }

        public static void AppendUpdateLog(string message)
        {
            try
            {
                string logPath = GetUpdateLogPath();
                string dir = Path.GetDirectoryName(logPath);
                if (!string.IsNullOrEmpty(dir) && !Directory.Exists(dir))
                {
                    Directory.CreateDirectory(dir);
                }
                string line = string.Format(
                    CultureInfo.InvariantCulture,
                    "[{0:yyyy-MM-dd HH:mm:ss.fff}] {1}{2}",
                    DateTime.Now,
                    message ?? string.Empty,
                    Environment.NewLine);
                File.AppendAllText(logPath, line, Encoding.UTF8);
            }
            catch
            {
                // Never crash the launcher if diagnostics logging cannot write.
            }
        }

        public static string FindExtractedSourceRoot(string extractDir)
        {
            if (string.IsNullOrEmpty(extractDir) || !Directory.Exists(extractDir))
            {
                throw new DirectoryNotFoundException("Extracted update directory does not exist.");
            }

            // 1. Check ZIP root first (in case archive has no wrapper folder).
            if (File.Exists(Path.Combine(extractDir, "OcarinaAtlas.exe")))
            {
                return extractDir;
            }

            // 2. Check standard release wrapper folder.
            string preferredDir = Path.Combine(extractDir, "OcarinaAtlas-Windows-x64");
            if (File.Exists(Path.Combine(preferredDir, "OcarinaAtlas.exe")))
            {
                return preferredDir;
            }

            // 3. Unwrap any single top-level directory containing OcarinaAtlas.exe.
            string[] rootFiles = Directory.GetFiles(extractDir);
            string[] rootDirs = Directory.GetDirectories(extractDir);
            if (rootFiles.Length == 0 && rootDirs.Length == 1)
            {
                if (File.Exists(Path.Combine(rootDirs[0], "OcarinaAtlas.exe")))
                {
                    return rootDirs[0];
                }
            }

            // 4. Fallback recursive search.
            string[] matches = Directory.GetFiles(extractDir, "OcarinaAtlas.exe", SearchOption.AllDirectories);
            if (matches.Length > 0)
            {
                return Path.GetDirectoryName(matches[0]);
            }

            throw new InvalidOperationException("OcarinaAtlas.exe was not found inside the extracted update archive.");
        }

        private static string EscapePsSingleQuoted(string value)
        {
            return (value ?? string.Empty).Replace("'", "''");
        }

        public static string BuildUpdaterPowerShellScript(int targetPid, string sourceRoot, string targetDir, string tempDir, string exeName, string logPath)
        {
            StringBuilder sb = new StringBuilder();
            sb.AppendLine("$ErrorActionPreference = 'Stop'");
            sb.AppendLine(string.Format(CultureInfo.InvariantCulture, "$targetPid = {0}", targetPid));
            sb.AppendLine(string.Format(CultureInfo.InvariantCulture, "$src = '{0}'", EscapePsSingleQuoted(sourceRoot)));
            sb.AppendLine(string.Format(CultureInfo.InvariantCulture, "$dst = '{0}'", EscapePsSingleQuoted(targetDir)));
            sb.AppendLine(string.Format(CultureInfo.InvariantCulture, "$tmp = '{0}'", EscapePsSingleQuoted(tempDir)));
            sb.AppendLine(string.Format(CultureInfo.InvariantCulture, "$exeName = '{0}'", EscapePsSingleQuoted(exeName)));
            sb.AppendLine(string.Format(CultureInfo.InvariantCulture, "$logPath = '{0}'", EscapePsSingleQuoted(logPath)));
            sb.AppendLine("$logDir = Split-Path -Parent $logPath");
            sb.AppendLine("if ($logDir -and -not (Test-Path -LiteralPath $logDir)) {");
            sb.AppendLine("    New-Item -ItemType Directory -Path $logDir -Force | Out-Null");
            sb.AppendLine("}");
            sb.AppendLine("function Write-UpdateLog([string]$msg) {");
            sb.AppendLine("    try {");
            sb.AppendLine("        $ts = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss.fff')");
            sb.AppendLine("        Add-Content -LiteralPath $logPath -Value \"[$ts] $msg\" -Encoding UTF8 -ErrorAction SilentlyContinue");
            sb.AppendLine("    } catch {}");
            sb.AppendLine("}");
            sb.AppendLine("Write-UpdateLog \"Updater started: targetPid=$targetPid src=$src dst=$dst\"");
            sb.AppendLine("$backupDir = Join-Path $tmp 'backup'");
            sb.AppendLine("$replaced = $false");
            sb.AppendLine("try {");
            sb.AppendLine("    try {");
            sb.AppendLine("        $targetProc = Get-Process -Id $targetPid -ErrorAction SilentlyContinue");
            sb.AppendLine("        if ($targetProc) {");
            sb.AppendLine("            Write-UpdateLog \"Waiting for target PID $targetPid to exit...\"");
            sb.AppendLine("            if (-not $targetProc.WaitForExit(20000)) {");
            sb.AppendLine("                Write-UpdateLog \"Target PID $targetPid timed out; stopping process.\"");
            sb.AppendLine("                Stop-Process -Id $targetPid -Force -ErrorAction SilentlyContinue");
            sb.AppendLine("                $targetProc.WaitForExit(5000) | Out-Null");
            sb.AppendLine("            }");
            sb.AppendLine("        }");
            sb.AppendLine("    } catch {");
            sb.AppendLine("        Write-UpdateLog \"Target wait note: $($_.Exception.Message)\"");
            sb.AppendLine("    }");
            sb.AppendLine("    $dstNorm = [System.IO.Path]::GetFullPath($dst).TrimEnd('\\') + '\\'");
            sb.AppendLine("    foreach ($procName in @('OcarinaAtlas', 'node')) {");
            sb.AppendLine("        try {");
            sb.AppendLine("            $procs = Get-Process -Name $procName -ErrorAction SilentlyContinue");
            sb.AppendLine("            foreach ($p in $procs) {");
            sb.AppendLine("                try {");
            sb.AppendLine("                    $pPath = $p.MainModule.FileName");
            sb.AppendLine("                    if ($pPath -and $pPath.StartsWith($dstNorm, [System.StringComparison]::OrdinalIgnoreCase)) {");
            sb.AppendLine("                        Write-UpdateLog \"Stopping lingering $($p.ProcessName) (PID $($p.Id)) at $pPath\"");
            sb.AppendLine("                        Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue");
            sb.AppendLine("                        $p.WaitForExit(5000) | Out-Null");
            sb.AppendLine("                    }");
            sb.AppendLine("                } catch {}");
            sb.AppendLine("            }");
            sb.AppendLine("        } catch {}");
            sb.AppendLine("    }");
            sb.AppendLine("    Start-Sleep -Milliseconds 400");
            sb.AppendLine("    $srcNorm = [System.IO.Path]::GetFullPath($src).TrimEnd('\\') + '\\'");
            sb.AppendLine("    $srcFiles = [System.IO.Directory]::GetFiles($srcNorm, '*', [System.IO.SearchOption]::AllDirectories)");
            sb.AppendLine("    Write-UpdateLog \"Copying $($srcFiles.Length) files from $srcNorm to $dstNorm\"");
            sb.AppendLine("    $backedUp = New-Object 'System.Collections.Generic.List[string]'");
            sb.AppendLine("    try {");
            sb.AppendLine("        foreach ($srcFile in $srcFiles) {");
            sb.AppendLine("            $rel = $srcFile.Substring($srcNorm.Length)");
            sb.AppendLine("            $dstFile = Join-Path $dstNorm $rel");
            sb.AppendLine("            $dstParent = Split-Path -Parent $dstFile");
            sb.AppendLine("            if ($dstParent -and -not (Test-Path -LiteralPath $dstParent)) {");
            sb.AppendLine("                New-Item -ItemType Directory -Path $dstParent -Force | Out-Null");
            sb.AppendLine("            }");
            sb.AppendLine("            if (Test-Path -LiteralPath $dstFile) {");
            sb.AppendLine("                $bakFile = Join-Path $backupDir $rel");
            sb.AppendLine("                $bakParent = Split-Path -Parent $bakFile");
            sb.AppendLine("                if ($bakParent -and -not (Test-Path -LiteralPath $bakParent)) {");
            sb.AppendLine("                    New-Item -ItemType Directory -Path $bakParent -Force | Out-Null");
            sb.AppendLine("                }");
            sb.AppendLine("                [System.IO.File]::Copy($dstFile, $bakFile, $true)");
            sb.AppendLine("                $backedUp.Add($rel)");
            sb.AppendLine("            }");
            sb.AppendLine("            $fileCopied = $false");
            sb.AppendLine("            for ($attempt = 1; $attempt -le 20; $attempt++) {");
            sb.AppendLine("                try {");
            sb.AppendLine("                    if (Test-Path -LiteralPath $dstFile) {");
            sb.AppendLine("                        $attr = [System.IO.File]::GetAttributes($dstFile)");
            sb.AppendLine("                        if (($attr -band [System.IO.FileAttributes]::ReadOnly) -ne 0) {");
            sb.AppendLine("                            [System.IO.File]::SetAttributes($dstFile, ($attr -band (-bnot [System.IO.FileAttributes]::ReadOnly)))");
            sb.AppendLine("                        }");
            sb.AppendLine("                    }");
            sb.AppendLine("                    [System.IO.File]::Copy($srcFile, $dstFile, $true)");
            sb.AppendLine("                    $fileCopied = $true");
            sb.AppendLine("                    break");
            sb.AppendLine("                } catch {");
            sb.AppendLine("                    if ($attempt -eq 20) {");
            sb.AppendLine("                        throw \"Failed to replace '$rel' after 20 attempts: $($_.Exception.Message)\"");
            sb.AppendLine("                    }");
            sb.AppendLine("                    Start-Sleep -Milliseconds 500");
            sb.AppendLine("                }");
            sb.AppendLine("            }");
            sb.AppendLine("        }");
            sb.AppendLine("        $srcExe = Join-Path $srcNorm $exeName");
            sb.AppendLine("        $dstExe = Join-Path $dstNorm $exeName");
            sb.AppendLine("        if (-not (Test-Path -LiteralPath $dstExe)) {");
            sb.AppendLine("            throw \"Post-copy verification failed: '$dstExe' is missing.\"");
            sb.AppendLine("        }");
            sb.AppendLine("        $srcLen = (Get-Item -LiteralPath $srcExe).Length");
            sb.AppendLine("        $dstLen = (Get-Item -LiteralPath $dstExe).Length");
            sb.AppendLine("        if ($srcLen -ne $dstLen) {");
            sb.AppendLine("            throw \"Post-copy verification failed: '$dstExe' size ($dstLen) != source size ($srcLen).\"");
            sb.AppendLine("        }");
            sb.AppendLine("        Write-UpdateLog \"Update applied successfully ($($srcFiles.Length) files, $exeName=$dstLen bytes).\"");
            sb.AppendLine("        $replaced = $true");
            sb.AppendLine("    } catch {");
            sb.AppendLine("        Write-UpdateLog \"ERROR during file swap: $($_.Exception.Message)\"");
            sb.AppendLine("        foreach ($rel in $backedUp) {");
            sb.AppendLine("            try {");
            sb.AppendLine("                $bakFile = Join-Path $backupDir $rel");
            sb.AppendLine("                $dstFile = Join-Path $dstNorm $rel");
            sb.AppendLine("                if (Test-Path -LiteralPath $bakFile) {");
            sb.AppendLine("                    [System.IO.File]::Copy($bakFile, $dstFile, $true)");
            sb.AppendLine("                }");
            sb.AppendLine("            } catch {}");
            sb.AppendLine("        }");
            sb.AppendLine("        Write-UpdateLog \"Rolled back $($backedUp.Count) backed-up files.\"");
            sb.AppendLine("    }");
            sb.AppendLine("} catch {");
            sb.AppendLine("    Write-UpdateLog \"FATAL updater error: $($_.Exception.Message)\"");
            sb.AppendLine("} finally {");
            sb.AppendLine("    $exe = Join-Path $dst $exeName");
            sb.AppendLine("    if (Test-Path -LiteralPath $exe) {");
            sb.AppendLine("        Write-UpdateLog \"Relaunching $exe (replaced=$replaced)\"");
            sb.AppendLine("        Start-Process -FilePath $exe -WorkingDirectory $dst");
            sb.AppendLine("    } else {");
            sb.AppendLine("        Write-UpdateLog \"ERROR: Cannot relaunch missing executable $exe\"");
            sb.AppendLine("    }");
            sb.AppendLine("    try {");
            sb.AppendLine("        if (Test-Path -LiteralPath $tmp) {");
            sb.AppendLine("            Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue");
            sb.AppendLine("        }");
            sb.AppendLine("    } catch {}");
            sb.AppendLine("}");
            return sb.ToString();
        }

        public static void LaunchDetachedUpdater(int targetPid, string sourceRoot, string targetDir, string tempDir)
        {
            string exeName = Path.GetFileName(Application.ExecutablePath);
            if (string.IsNullOrEmpty(exeName))
            {
                exeName = "OcarinaAtlas.exe";
            }

            string logPath = GetUpdateLogPath();
            AppendUpdateLog(string.Format(
                CultureInfo.InvariantCulture,
                "Launching detached updater (pid={0}, src={1}, dst={2}, tmp={3})",
                targetPid,
                sourceRoot,
                targetDir,
                tempDir));

            string script = BuildUpdaterPowerShellScript(targetPid, sourceRoot, targetDir, tempDir, exeName, logPath);
            byte[] scriptBytes = Encoding.Unicode.GetBytes(script);
            string encoded = Convert.ToBase64String(scriptBytes);

            ProcessStartInfo psi = new ProcessStartInfo();
            psi.FileName = "powershell.exe";
            psi.Arguments = "-NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -EncodedCommand " + encoded;
            psi.UseShellExecute = false;
            psi.CreateNoWindow = true;
            psi.WindowStyle = ProcessWindowStyle.Hidden;
            Process started = Process.Start(psi);
            if (started == null)
            {
                throw new InvalidOperationException("Failed to start detached PowerShell updater process.");
            }
        }
    }

    internal sealed class UpdateDialog : Form
    {
        private readonly MainForm _ownerForm;
        private readonly UpdateInfo _info;
        private readonly TextBox _notesBox;
        private readonly Label _statusLabel;
        private readonly ProgressBar _progressBar;
        private readonly Button _updateNowButton;
        private readonly Button _skipButton;
        private readonly Button _closeButton;
        private bool _isUpdating;

        public UpdateDialog(MainForm ownerForm, UpdateInfo info, Icon appIcon)
        {
            _ownerForm = ownerForm;
            _info = info;

            Text = "Update Available \u2014 Ocarina Atlas";
            BackColor = Theme.Ink950;
            ForeColor = Theme.Parchment200;
            Font = new Font("Segoe UI", 9f, FontStyle.Regular);
            FormBorderStyle = FormBorderStyle.FixedDialog;
            StartPosition = FormStartPosition.CenterParent;
            MaximizeBox = false;
            MinimizeBox = false;
            ShowInTaskbar = false;
            ClientSize = new Size(520, 412);
            if (appIcon != null) Icon = appIcon;

            Label headerLabel = new Label();
            headerLabel.Text = "Update Available: " + info.DisplayTag;
            headerLabel.Font = new Font("Segoe UI", 12.5f, FontStyle.Bold);
            headerLabel.ForeColor = Theme.Parchment50;
            headerLabel.AutoSize = true;
            headerLabel.Location = new Point(20, 16);
            Controls.Add(headerLabel);

            Label versionLabel = new Label();
            versionLabel.Text = string.Format(
                CultureInfo.InvariantCulture,
                "Installed: v{0}   \u2192   Latest: {1}",
                MainForm.AppVersion,
                info.DisplayTag);
            versionLabel.Font = new Font("Segoe UI", 9f, FontStyle.Bold);
            versionLabel.ForeColor = Theme.Moss;
            versionLabel.AutoSize = true;
            versionLabel.Location = new Point(22, 46);
            Controls.Add(versionLabel);

            Label notesTitle = new Label();
            notesTitle.Text = "Release Notes";
            notesTitle.Font = new Font("Segoe UI", 8.5f, FontStyle.Bold);
            notesTitle.ForeColor = Theme.Parchment400;
            notesTitle.AutoSize = true;
            notesTitle.Location = new Point(20, 72);
            Controls.Add(notesTitle);

            _notesBox = new TextBox();
            _notesBox.Multiline = true;
            _notesBox.ReadOnly = true;
            _notesBox.ScrollBars = ScrollBars.Vertical;
            _notesBox.WordWrap = true;
            _notesBox.BorderStyle = BorderStyle.FixedSingle;
            _notesBox.BackColor = Theme.Ink900;
            _notesBox.ForeColor = Theme.Parchment200;
            _notesBox.Font = new Font("Segoe UI", 9f, FontStyle.Regular);
            _notesBox.Location = new Point(20, 94);
            _notesBox.Size = new Size(480, 212);
            _notesBox.Text = info.ReleaseNotes;
            Controls.Add(_notesBox);

            _statusLabel = new Label();
            _statusLabel.Text = string.Empty;
            _statusLabel.Font = new Font("Segoe UI", 8.5f, FontStyle.Regular);
            _statusLabel.ForeColor = Theme.Parchment400;
            _statusLabel.AutoSize = false;
            _statusLabel.Location = new Point(20, 314);
            _statusLabel.Size = new Size(480, 18);
            _statusLabel.Visible = false;
            Controls.Add(_statusLabel);

            _progressBar = new ProgressBar();
            _progressBar.Location = new Point(20, 336);
            _progressBar.Size = new Size(480, 16);
            _progressBar.Minimum = 0;
            _progressBar.Maximum = 100;
            _progressBar.Visible = false;
            Controls.Add(_progressBar);

            _updateNowButton = CreateDialogButton("Update Now", 20, 364, 148, 32, true);
            _updateNowButton.BackColor = Color.FromArgb(0x2D, 0x4A, 0x2A);
            _updateNowButton.ForeColor = Theme.Parchment50;
            _updateNowButton.FlatAppearance.BorderColor = Theme.Moss;
            _updateNowButton.FlatAppearance.MouseOverBackColor = Color.FromArgb(0x39, 0x5D, 0x35);
            _updateNowButton.Click += OnUpdateNowClick;
            Controls.Add(_updateNowButton);

            _skipButton = CreateDialogButton("Skip Version", 296, 364, 108, 32, false);
            _skipButton.Click += OnSkipVersionClick;
            Controls.Add(_skipButton);

            _closeButton = CreateDialogButton("Close", 412, 364, 88, 32, false);
            _closeButton.DialogResult = DialogResult.Cancel;
            Controls.Add(_closeButton);
            CancelButton = _closeButton;

            Shown += delegate
            {
                _notesBox.Select(0, 0);
                _updateNowButton.Focus();
            };

            FormClosing += delegate(object sender, FormClosingEventArgs e)
            {
                if (_isUpdating)
                {
                    e.Cancel = true;
                }
            };
        }

        private static Button CreateDialogButton(string text, int x, int y, int width, int height, bool bold)
        {
            Button btn = new Button();
            btn.Text = text;
            btn.Location = new Point(x, y);
            btn.Size = new Size(width, height);
            btn.FlatStyle = FlatStyle.Flat;
            btn.FlatAppearance.BorderSize = 1;
            btn.FlatAppearance.BorderColor = Theme.Ink600;
            btn.FlatAppearance.MouseOverBackColor = Theme.Ink700;
            btn.BackColor = Theme.Ink800;
            btn.ForeColor = Theme.Parchment200;
            btn.Font = new Font("Segoe UI", 9f, bold ? FontStyle.Bold : FontStyle.Regular);
            btn.Cursor = Cursors.Hand;
            btn.UseVisualStyleBackColor = false;
            return btn;
        }

        private void OnSkipVersionClick(object sender, EventArgs e)
        {
            try
            {
                UpdateManager.WriteSkippedVersion(_info.DisplayTag);
            }
            catch
            {
                // Non-fatal if %LOCALAPPDATA% is not writable.
            }
            DialogResult = DialogResult.Ignore;
            Close();
        }

        private void OnUpdateNowClick(object sender, EventArgs e)
        {
            if (string.IsNullOrEmpty(_info.ZipDownloadUrl))
            {
                if (_ownerForm != null)
                {
                    _ownerForm.OpenUrlInBrowser(_info.HtmlUrl);
                }
                Close();
                return;
            }

            _isUpdating = true;
            _updateNowButton.Enabled = false;
            _skipButton.Enabled = false;
            _closeButton.Enabled = false;

            _statusLabel.ForeColor = Theme.Parchment400;
            _statusLabel.Text = "Downloading " + _info.DisplayTag + "...";
            _statusLabel.Visible = true;
            _progressBar.Style = ProgressBarStyle.Blocks;
            _progressBar.Value = 0;
            _progressBar.Visible = true;

            string tempDir = Path.Combine(Path.GetTempPath(), "OcarinaAtlas-Update-" + Guid.NewGuid().ToString("N"));
            string zipPath = Path.Combine(tempDir, "update.zip");
            string extractDir = Path.Combine(tempDir, "extracted");

            try
            {
                Directory.CreateDirectory(tempDir);
                UpdateManager.AppendUpdateLog("Starting update to " + _info.DisplayTag + " from " + _info.ZipDownloadUrl);
                ServicePointManager.SecurityProtocol |= SecurityProtocolType.Tls12;
                WebClient client = new WebClient();
                client.Headers[HttpRequestHeader.UserAgent] = "OcarinaAtlas/" + MainForm.AppVersion;

                client.DownloadProgressChanged += delegate(object s, DownloadProgressChangedEventArgs args)
                {
                    if (IsDisposed) return;
                    if (args.TotalBytesToReceive > 0)
                    {
                        _progressBar.Style = ProgressBarStyle.Blocks;
                        int pct = Math.Max(0, Math.Min(100, args.ProgressPercentage));
                        _progressBar.Value = pct;
                        _statusLabel.Text = string.Format(
                            CultureInfo.InvariantCulture,
                            "Downloading {0}... {1}%",
                            _info.DisplayTag,
                            pct);
                    }
                    else
                    {
                        _progressBar.Style = ProgressBarStyle.Marquee;
                        double mb = args.BytesReceived / (1024.0 * 1024.0);
                        _statusLabel.Text = string.Format(
                            CultureInfo.InvariantCulture,
                            "Downloading {0}... {1:0.0} MB",
                            _info.DisplayTag,
                            mb);
                    }
                };

                client.DownloadFileCompleted += delegate(object s, AsyncCompletedEventArgs args)
                {
                    client.Dispose();
                    if (IsDisposed) return;

                    if (args.Error != null || args.Cancelled)
                    {
                        string msg = args.Error != null ? args.Error.Message : "Download cancelled.";
                        FailUpdate("Download failed: " + msg, tempDir);
                        return;
                    }

                    _progressBar.Style = ProgressBarStyle.Marquee;
                    _statusLabel.Text = "Extracting update archive...";

                    Thread extractThread = new Thread(delegate()
                    {
                        try
                        {
                            ZipFile.ExtractToDirectory(zipPath, extractDir);
                            string sourceRoot = UpdateManager.FindExtractedSourceRoot(extractDir);
                            string targetDir = AppDomain.CurrentDomain.BaseDirectory.TrimEnd(
                                Path.DirectorySeparatorChar,
                                Path.AltDirectorySeparatorChar);
                            UpdateManager.AppendUpdateLog("Extracted update to " + sourceRoot + " -> targetDir=" + targetDir);

                            if (!IsDisposed && IsHandleCreated)
                            {
                                BeginInvoke((MethodInvoker)delegate()
                                {
                                    try
                                    {
                                        _statusLabel.Text = "Applying update and restarting...";
                                        _isUpdating = false;
                                        if (_ownerForm != null)
                                        {
                                            _ownerForm.PrepareForSelfUpdate();
                                        }
                                        UpdateManager.LaunchDetachedUpdater(
                                            Process.GetCurrentProcess().Id,
                                            sourceRoot,
                                            targetDir,
                                            tempDir);
                                        DialogResult = DialogResult.OK;
                                        Close();
                                        Application.Exit();
                                    }
                                    catch (Exception applyEx)
                                    {
                                        FailUpdate("Failed to launch updater: " + applyEx.Message, tempDir);
                                    }
                                });
                            }
                        }
                        catch (Exception ex)
                        {
                            if (!IsDisposed && IsHandleCreated)
                            {
                                BeginInvoke((MethodInvoker)delegate()
                                {
                                    FailUpdate("Extraction failed: " + ex.Message, tempDir);
                                });
                            }
                        }
                    });
                    extractThread.IsBackground = true;
                    extractThread.Start();
                };

                client.DownloadFileAsync(new Uri(_info.ZipDownloadUrl), zipPath);
            }
            catch (Exception ex)
            {
                FailUpdate("Failed to start download: " + ex.Message, tempDir);
            }
        }

        private void FailUpdate(string message, string tempDir)
        {
            UpdateManager.AppendUpdateLog("Update failed: " + message);
            _isUpdating = false;
            _progressBar.Visible = false;
            _statusLabel.ForeColor = Theme.Ember;
            _statusLabel.Text = message + " (See update.log)";
            _updateNowButton.Enabled = true;
            _skipButton.Enabled = true;
            _closeButton.Enabled = true;

            try
            {
                if (!string.IsNullOrEmpty(tempDir) && Directory.Exists(tempDir))
                {
                    Directory.Delete(tempDir, true);
                }
            }
            catch
            {
                // Ignore temp cleanup failure.
            }
        }
    }

    internal sealed class MainForm : Form
    {
        public const string AppVersion = "1.1.4";

        private const int CollapsedClientHeight = 478;
        private const int ExpandedClientHeight = 700;

        private readonly LaunchOptions _options;
        private readonly object _procLock = new object();
        private readonly System.Windows.Forms.Timer _pollTimer;
        private readonly Icon _appIcon;

        private JobObject _jobObject;
        private Process _serverProcess;
        private ServerLifecycle _lifecycle = ServerLifecycle.Stopped;
        private bool _hasStartupError = false;
        private int _activePort = 3000;
        private string _activeBindHost = "0.0.0.0";
        private string _customBindHost;
        private string _activeLichiiHost = "127.0.0.1";
        private int _activeLichiiPort = 6545;
        private bool _browserOpenedForRun = false;
        private int _pollInFlight = 0;
        private int _firewallCheckInFlight = 0;
        private int _firewallCheckedPort = -1;
        private bool _firewallAllowed = false;
        private int _copyFeedbackTicks = 0;
        private string _selectedLanUrl = string.Empty;
        private string _renderedQrUrl = string.Empty;
        private UpdateInfo _pendingUpdateInfo;
        private UpdateDialog _activeUpdateDialog;
        private List<LanEndpoint> _lanEndpoints = new List<LanEndpoint>();
        private ToolTip _toolTip;

        // Layout containers
        private BorderedPanel _heroCard;
        private BorderedPanel _heroStatusPill;
        private BorderedPanel _step1Card;
        private BorderedPanel _configuredPill;
        private BorderedPanel _step2Card;
        private BorderedPanel _advancedDrawerPanel;
        private Panel _logContainer;

        // Hero controls
        private Label _versionLabel;
        private LinkLabel _updateLinkLabel;
        private StatusDot _serverDot;
        private Label _serverStatusLabel;
        private Label _heroSummaryLabel;
        private LinkLabel _serverUrlLink;
        private Button _startStopButton;
        private Button _openBrowserButton;
        private StatusDot _heroLichiiDot;
        private Label _heroLichiiLabel;

        // Step 1 controls (Lichii Live Sync)
        private Label _lichiiStepDetailLabel;
        private Button _enableRpcButton;

        // Step 2 controls (LAN / Second Screen)
        private Button _firewallButton;
        private ComboBox _lanComboBox;
        private LinkLabel _lanUrlLink;
        private Label _lanStatusLabel;
        private Button _refreshLanButton;
        private Button _copyLanUrlButton;
        private Label _lanHintLabel;
        private PictureBox _qrPictureBox;

        // Advanced drawer controls
        private Button _advancedToggleButton;
        private Label _modeBadgeLabel;
        private NumericUpDown _portInput;
        private TextBox _lichiiHostInput;
        private NumericUpDown _lichiiPortInput;
        private CheckBox _allowLanCheckBox;
        private CheckBox _autoOpenCheckBox;
        private CheckBox _trayMinimizeCheckBox;
        private Button _clearLogButton;
        private TextBox _logTextBox;

        private NotifyIcon _trayIcon;
        private ToolStripMenuItem _trayToggleServerItem;
        private ToolStripMenuItem _trayOpenBrowserItem;

        private bool _advancedExpanded = false;
        private bool _trayHintShown = false;

        public MainForm(LaunchOptions options)
        {
            _options = options ?? new LaunchOptions();
            _activePort = _options.Port;
            _customBindHost = _options.BindHost;
            _activeBindHost = _options.AllowLan
                ? LanNetworkHelper.SanitizeHost(_options.BindHost, "0.0.0.0")
                : "127.0.0.1";
            _activeLichiiHost = _options.LichiiHost;
            _activeLichiiPort = _options.LichiiPort;

            _appIcon = LoadAppIcon();
            this.Icon = _appIcon;

            Text = "Ocarina Atlas — Ocarina of Time Map Tracker";
            BackColor = Theme.Ink950;
            ForeColor = Theme.Parchment200;
            Font = new Font("Segoe UI", 9f, FontStyle.Regular);
            ClientSize = new Size(560, CollapsedClientHeight);
            MinimumSize = new Size(550, 450);
            StartPosition = FormStartPosition.CenterScreen;
            AutoScaleMode = AutoScaleMode.Font;

            BuildLayout();
            BuildTrayIcon();
            ApplyInitialOptions();
            RefreshRuntimeBadge();
            RefreshLanDisplays();
            RefreshLichiiConfigStatus();
            UpdateControlStates();
            ReflowLayout();

            _pollTimer = new System.Windows.Forms.Timer();
            _pollTimer.Interval = 1500;
            _pollTimer.Tick += OnPollTimerTick;
            _pollTimer.Start();

            Load += OnFormLoad;
            Resize += OnFormResize;
            FormClosing += OnFormClosing;
        }

        private void BuildLayout()
        {
            _toolTip = new ToolTip();

            // 1. Hero Card
            _heroCard = new BorderedPanel();
            _heroCard.Location = new Point(16, 14);
            _heroCard.Size = new Size(528, 148);
            _heroCard.Anchor = AnchorStyles.Top | AnchorStyles.Left | AnchorStyles.Right;
            Controls.Add(_heroCard);

            Label titleLabel = new Label();
            titleLabel.Text = "Ocarina Atlas";
            titleLabel.Font = new Font("Georgia", 15f, FontStyle.Bold);
            titleLabel.ForeColor = Theme.Parchment50;
            titleLabel.AutoSize = true;
            titleLabel.Location = new Point(16, 12);
            _heroCard.Controls.Add(titleLabel);

            _versionLabel = new Label();
            _versionLabel.Text = "v" + AppVersion;
            _versionLabel.Font = new Font("Segoe UI", 8.25f, FontStyle.Regular);
            _versionLabel.ForeColor = Theme.Parchment600;
            _versionLabel.AutoSize = true;
            _versionLabel.Location = new Point(titleLabel.Right + 6, 20);
            _heroCard.Controls.Add(_versionLabel);

            _updateLinkLabel = new LinkLabel();
            _updateLinkLabel.Text = string.Empty;
            _updateLinkLabel.LinkColor = Theme.Ember;
            _updateLinkLabel.ActiveLinkColor = Theme.Parchment50;
            _updateLinkLabel.VisitedLinkColor = Theme.Ember;
            _updateLinkLabel.Font = new Font("Segoe UI", 8.25f, FontStyle.Bold);
            _updateLinkLabel.AutoSize = true;
            _updateLinkLabel.Anchor = AnchorStyles.Top | AnchorStyles.Right;
            _updateLinkLabel.Visible = false;
            _updateLinkLabel.Location = new Point(250, 19);
            _updateLinkLabel.LinkClicked += OnUpdateLinkClicked;
            _heroCard.Controls.Add(_updateLinkLabel);

            _heroStatusPill = new BorderedPanel();
            _heroStatusPill.Location = new Point(406, 14);
            _heroStatusPill.Size = new Size(106, 24);
            _heroStatusPill.Anchor = AnchorStyles.Top | AnchorStyles.Right;
            _heroStatusPill.FillColor = Theme.Ink800;
            _heroStatusPill.BorderColor = Theme.Ink600;
            _heroStatusPill.CornerRadius = 11;
            _heroCard.Controls.Add(_heroStatusPill);

            _serverDot = new StatusDot();
            _serverDot.Location = new Point(10, 6);
            _serverDot.BackColor = Theme.Ink800;
            _serverDot.DotColor = Theme.Parchment600;
            _heroStatusPill.Controls.Add(_serverDot);

            _serverStatusLabel = new Label();
            _serverStatusLabel.Text = "Stopped";
            _serverStatusLabel.Font = new Font("Segoe UI", 8.25f, FontStyle.Bold);
            _serverStatusLabel.ForeColor = Theme.Parchment400;
            _serverStatusLabel.BackColor = Theme.Ink800;
            _serverStatusLabel.AutoSize = false;
            _serverStatusLabel.TextAlign = ContentAlignment.MiddleLeft;
            _serverStatusLabel.Location = new Point(26, 2);
            _serverStatusLabel.Size = new Size(74, 20);
            _heroStatusPill.Controls.Add(_serverStatusLabel);

            _heroSummaryLabel = new Label();
            _heroSummaryLabel.Text = "Click Start Map to open the interactive Hyrule map in your browser.";
            _heroSummaryLabel.Font = new Font("Segoe UI", 9f, FontStyle.Regular);
            _heroSummaryLabel.ForeColor = Theme.Parchment200;
            _heroSummaryLabel.AutoSize = false;
            _heroSummaryLabel.Location = new Point(16, 46);
            _heroSummaryLabel.Size = new Size(496, 22);
            _heroSummaryLabel.Anchor = AnchorStyles.Top | AnchorStyles.Left | AnchorStyles.Right;
            _heroCard.Controls.Add(_heroSummaryLabel);

            _serverUrlLink = new LinkLabel();
            _serverUrlLink.Text = string.Empty;
            _serverUrlLink.LinkColor = Theme.Moss;
            _serverUrlLink.ActiveLinkColor = Theme.Parchment50;
            _serverUrlLink.VisitedLinkColor = Theme.Moss;
            _serverUrlLink.Font = new Font("Segoe UI", 8.5f, FontStyle.Regular);
            _serverUrlLink.AutoSize = true;
            _serverUrlLink.Visible = false;
            _serverUrlLink.Location = new Point(16, 70);
            _serverUrlLink.LinkClicked += OnServerUrlLinkClicked;
            _heroCard.Controls.Add(_serverUrlLink);

            _startStopButton = CreateButton("Start Map", 16, 98, 152, 36, true);
            _startStopButton.Font = new Font("Segoe UI", 9.5f, FontStyle.Bold);
            _startStopButton.BackColor = Theme.Moss;
            _startStopButton.ForeColor = Theme.Ink950;
            _startStopButton.FlatAppearance.BorderColor = Theme.Moss;
            _startStopButton.Click += OnStartStopClick;
            _heroCard.Controls.Add(_startStopButton);

            _openBrowserButton = CreateButton("Open in Browser", 178, 98, 150, 36, false);
            _openBrowserButton.Click += OnOpenBrowserClick;
            _heroCard.Controls.Add(_openBrowserButton);

            _heroLichiiDot = new StatusDot();
            _heroLichiiDot.Location = new Point(348, 110);
            _heroLichiiDot.Anchor = AnchorStyles.Top | AnchorStyles.Right;
            _heroLichiiDot.BackColor = Theme.Ink900;
            _heroLichiiDot.DotColor = Theme.Parchment600;
            _heroCard.Controls.Add(_heroLichiiDot);

            _heroLichiiLabel = new Label();
            _heroLichiiLabel.Text = "Emulator: Not detected";
            _heroLichiiLabel.Font = new Font("Segoe UI", 8.25f, FontStyle.Regular);
            _heroLichiiLabel.ForeColor = Theme.Parchment400;
            _heroLichiiLabel.AutoSize = false;
            _heroLichiiLabel.TextAlign = ContentAlignment.MiddleLeft;
            _heroLichiiLabel.Location = new Point(365, 106);
            _heroLichiiLabel.Size = new Size(148, 20);
            _heroLichiiLabel.Anchor = AnchorStyles.Top | AnchorStyles.Right;
            _heroCard.Controls.Add(_heroLichiiLabel);

            // 2. Step 1 Card: Emulator Live Sync (Lichii / Fritchii)
            _step1Card = new BorderedPanel();
            _step1Card.Location = new Point(16, 172);
            _step1Card.Size = new Size(528, 86);
            _step1Card.Anchor = AnchorStyles.Top | AnchorStyles.Left | AnchorStyles.Right;
            Controls.Add(_step1Card);

            Label step1Title = new Label();
            step1Title.Text = "Step 1 \u00B7 Emulator Live Sync";
            step1Title.Font = new Font("Segoe UI", 9.5f, FontStyle.Bold);
            step1Title.ForeColor = Theme.Parchment50;
            step1Title.AutoSize = true;
            step1Title.Location = new Point(16, 12);
            _step1Card.Controls.Add(step1Title);

            _configuredPill = new BorderedPanel();
            _configuredPill.Location = new Point(414, 14);
            _configuredPill.Size = new Size(98, 24);
            _configuredPill.Anchor = AnchorStyles.Top | AnchorStyles.Right;
            _configuredPill.FillColor = Theme.Ink800;
            _configuredPill.BorderColor = Theme.Moss;
            _configuredPill.CornerRadius = 11;
            _configuredPill.Visible = false;
            _step1Card.Controls.Add(_configuredPill);

            Label configuredLabel = new Label();
            configuredLabel.Text = "Configured";
            configuredLabel.Font = new Font("Segoe UI", 8.25f, FontStyle.Bold);
            configuredLabel.ForeColor = Theme.Moss;
            configuredLabel.BackColor = Theme.Ink800;
            configuredLabel.Dock = DockStyle.Fill;
            configuredLabel.TextAlign = ContentAlignment.MiddleCenter;
            _configuredPill.Controls.Add(configuredLabel);

            _enableRpcButton = CreateButton("1-Click Setup Sync", 360, 12, 152, 30, true);
            _enableRpcButton.Anchor = AnchorStyles.Top | AnchorStyles.Right;
            _enableRpcButton.Font = new Font("Segoe UI", 8.5f, FontStyle.Bold);
            _enableRpcButton.ForeColor = Theme.Parchment50;
            _enableRpcButton.FlatAppearance.BorderColor = Theme.Parchment400;
            _enableRpcButton.Click += OnEnableRpcClick;
            _step1Card.Controls.Add(_enableRpcButton);

            _lichiiStepDetailLabel = new Label();
            _lichiiStepDetailLabel.Text = "Allows Ocarina Atlas to follow Link and mark Gold Skulltulas automatically.";
            _lichiiStepDetailLabel.Font = new Font("Segoe UI", 8.5f, FontStyle.Regular);
            _lichiiStepDetailLabel.ForeColor = Theme.Parchment400;
            _lichiiStepDetailLabel.AutoSize = false;
            _lichiiStepDetailLabel.Location = new Point(16, 38);
            _lichiiStepDetailLabel.Size = new Size(336, 36);
            _lichiiStepDetailLabel.Anchor = AnchorStyles.Top | AnchorStyles.Left | AnchorStyles.Right;
            _step1Card.Controls.Add(_lichiiStepDetailLabel);

            // 3. Step 2 Card: Play on Another Device (LAN)
            _step2Card = new BorderedPanel();
            _step2Card.Location = new Point(16, 268);
            _step2Card.Size = new Size(528, 156);
            _step2Card.Anchor = AnchorStyles.Top | AnchorStyles.Left | AnchorStyles.Right;
            Controls.Add(_step2Card);

            Label step2Title = new Label();
            step2Title.Text = "Step 2 \u00B7 Play on Another Device (Optional)";
            step2Title.Font = new Font("Segoe UI", 9.5f, FontStyle.Bold);
            step2Title.ForeColor = Theme.Parchment50;
            step2Title.AutoSize = true;
            step2Title.Location = new Point(16, 12);
            _step2Card.Controls.Add(step2Title);

            _firewallButton = CreateButton("Allow LAN Access", 372, 10, 140, 26, false);
            _firewallButton.Anchor = AnchorStyles.Top | AnchorStyles.Right;
            _firewallButton.Font = new Font("Segoe UI", 8f, FontStyle.Bold);
            _firewallButton.Click += OnAllowFirewallClick;
            _step2Card.Controls.Add(_firewallButton);
            _toolTip.SetToolTip(_firewallButton, "Adds a Windows Firewall rule on Private networks so your tablet or phone can connect.");

            _lanComboBox = new ComboBox();
            _lanComboBox.DropDownStyle = ComboBoxStyle.DropDownList;
            _lanComboBox.FlatStyle = FlatStyle.Flat;
            _lanComboBox.BackColor = Theme.Ink800;
            _lanComboBox.ForeColor = Theme.Parchment50;
            _lanComboBox.Font = new Font("Segoe UI", 8.75f, FontStyle.Regular);
            _lanComboBox.Location = new Point(16, 44);
            _lanComboBox.Size = new Size(374, 24);
            _lanComboBox.Anchor = AnchorStyles.Top | AnchorStyles.Left | AnchorStyles.Right;
            _lanComboBox.Visible = false;
            _lanComboBox.SelectedIndexChanged += OnLanComboSelectedIndexChanged;
            _step2Card.Controls.Add(_lanComboBox);

            _lanUrlLink = new LinkLabel();
            _lanUrlLink.Text = string.Empty;
            _lanUrlLink.LinkColor = Theme.Moss;
            _lanUrlLink.ActiveLinkColor = Theme.Parchment50;
            _lanUrlLink.VisitedLinkColor = Theme.Moss;
            _lanUrlLink.Font = new Font("Segoe UI", 9f, FontStyle.Bold);
            _lanUrlLink.AutoSize = true;
            _lanUrlLink.Location = new Point(16, 47);
            _lanUrlLink.Visible = false;
            _lanUrlLink.LinkClicked += OnLanUrlLinkClicked;
            _step2Card.Controls.Add(_lanUrlLink);

            _lanStatusLabel = new Label();
            _lanStatusLabel.Text = "Checking network adapters...";
            _lanStatusLabel.Font = new Font("Segoe UI", 8.75f, FontStyle.Regular);
            _lanStatusLabel.ForeColor = Theme.Parchment200;
            _lanStatusLabel.AutoSize = false;
            _lanStatusLabel.Location = new Point(16, 47);
            _lanStatusLabel.Size = new Size(374, 22);
            _lanStatusLabel.Anchor = AnchorStyles.Top | AnchorStyles.Left | AnchorStyles.Right;
            _step2Card.Controls.Add(_lanStatusLabel);

            _refreshLanButton = CreateButton("Refresh", 16, 74, 78, 26, false);
            _refreshLanButton.Anchor = AnchorStyles.Top | AnchorStyles.Left;
            _refreshLanButton.Font = new Font("Segoe UI", 8f, FontStyle.Regular);
            _refreshLanButton.Click += OnRefreshLanClick;
            _step2Card.Controls.Add(_refreshLanButton);
            _toolTip.SetToolTip(_refreshLanButton, "Re-scan active Wi-Fi and Ethernet network adapters.");

            _copyLanUrlButton = CreateButton("Copy URL", 102, 74, 96, 26, false);
            _copyLanUrlButton.Anchor = AnchorStyles.Top | AnchorStyles.Left;
            _copyLanUrlButton.Font = new Font("Segoe UI", 8f, FontStyle.Bold);
            _copyLanUrlButton.Click += OnCopyLanUrlClick;
            _step2Card.Controls.Add(_copyLanUrlButton);
            _toolTip.SetToolTip(_copyLanUrlButton, "Copy the selected LAN address to open on your tablet, iPad, or phone.");

            _lanHintLabel = new Label();
            _lanHintLabel.Text = "Open this address or scan the QR code on your tablet, iPad, or phone.";
            _lanHintLabel.Font = new Font("Segoe UI", 8.25f, FontStyle.Regular);
            _lanHintLabel.ForeColor = Theme.Parchment400;
            _lanHintLabel.AutoSize = false;
            _lanHintLabel.Location = new Point(16, 108);
            _lanHintLabel.Size = new Size(374, 30);
            _lanHintLabel.Anchor = AnchorStyles.Top | AnchorStyles.Left | AnchorStyles.Right;
            _step2Card.Controls.Add(_lanHintLabel);

            _qrPictureBox = new PictureBox();
            _qrPictureBox.Location = new Point(400, 40);
            _qrPictureBox.Size = new Size(112, 112);
            _qrPictureBox.Anchor = AnchorStyles.Top | AnchorStyles.Right;
            _qrPictureBox.BackColor = Color.White;
            _qrPictureBox.SizeMode = PictureBoxSizeMode.CenterImage;
            _qrPictureBox.Cursor = Cursors.Hand;
            _qrPictureBox.Visible = false;
            _qrPictureBox.Click += OnQrPictureBoxClick;
            _step2Card.Controls.Add(_qrPictureBox);
            _toolTip.SetToolTip(_qrPictureBox, "Click to enlarge QR — scan with your phone or tablet camera to open Ocarina Atlas on the same Wi-Fi.");

            // 4. Collapsible Advanced Settings & Logs Drawer
            _advancedToggleButton = CreateButton("\u25B8 Advanced Settings & Logs", 16, 434, 528, 30, false);
            _advancedToggleButton.Anchor = AnchorStyles.Top | AnchorStyles.Left | AnchorStyles.Right;
            _advancedToggleButton.TextAlign = ContentAlignment.MiddleLeft;
            _advancedToggleButton.Padding = new Padding(8, 0, 0, 0);
            _advancedToggleButton.Font = new Font("Segoe UI", 8.75f, FontStyle.Bold);
            _advancedToggleButton.ForeColor = Theme.Parchment400;
            _advancedToggleButton.Click += OnAdvancedToggleClick;
            Controls.Add(_advancedToggleButton);

            _advancedDrawerPanel = new BorderedPanel();
            _advancedDrawerPanel.Location = new Point(16, 470);
            _advancedDrawerPanel.Size = new Size(528, 216);
            _advancedDrawerPanel.Anchor = AnchorStyles.Top | AnchorStyles.Bottom | AnchorStyles.Left | AnchorStyles.Right;
            _advancedDrawerPanel.Visible = false;
            Controls.Add(_advancedDrawerPanel);

            Label portLabel = new Label();
            portLabel.Text = "Map Port:";
            portLabel.ForeColor = Theme.Parchment400;
            portLabel.AutoSize = true;
            portLabel.Location = new Point(14, 15);
            _advancedDrawerPanel.Controls.Add(portLabel);

            _portInput = new NumericUpDown();
            _portInput.Minimum = 1;
            _portInput.Maximum = 65535;
            _portInput.Value = 3000;
            _portInput.Location = new Point(76, 12);
            _portInput.Size = new Size(64, 23);
            _portInput.BackColor = Theme.Ink800;
            _portInput.ForeColor = Theme.Parchment50;
            _portInput.BorderStyle = BorderStyle.FixedSingle;
            _portInput.ValueChanged += OnPortInputChanged;
            _advancedDrawerPanel.Controls.Add(_portInput);

            Label lHostLabel = new Label();
            lHostLabel.Text = "RPC Host:";
            lHostLabel.ForeColor = Theme.Parchment400;
            lHostLabel.AutoSize = true;
            lHostLabel.Location = new Point(152, 15);
            _advancedDrawerPanel.Controls.Add(lHostLabel);

            _lichiiHostInput = new TextBox();
            _lichiiHostInput.Text = "127.0.0.1";
            _lichiiHostInput.Location = new Point(220, 12);
            _lichiiHostInput.Size = new Size(104, 23);
            _lichiiHostInput.BackColor = Theme.Ink800;
            _lichiiHostInput.ForeColor = Theme.Parchment50;
            _lichiiHostInput.BorderStyle = BorderStyle.FixedSingle;
            _advancedDrawerPanel.Controls.Add(_lichiiHostInput);

            Label lPortLabel = new Label();
            lPortLabel.Text = "RPC Port:";
            lPortLabel.ForeColor = Theme.Parchment400;
            lPortLabel.AutoSize = true;
            lPortLabel.Location = new Point(334, 15);
            _advancedDrawerPanel.Controls.Add(lPortLabel);

            _lichiiPortInput = new NumericUpDown();
            _lichiiPortInput.Minimum = 1;
            _lichiiPortInput.Maximum = 65535;
            _lichiiPortInput.Value = 6545;
            _lichiiPortInput.Location = new Point(394, 12);
            _lichiiPortInput.Size = new Size(64, 23);
            _lichiiPortInput.BackColor = Theme.Ink800;
            _lichiiPortInput.ForeColor = Theme.Parchment50;
            _lichiiPortInput.BorderStyle = BorderStyle.FixedSingle;
            _lichiiPortInput.ValueChanged += OnLichiiPortChanged;
            _advancedDrawerPanel.Controls.Add(_lichiiPortInput);

            Button resetLichiiBtn = CreateButton("Reset", 464, 11, 50, 25, false);
            resetLichiiBtn.Anchor = AnchorStyles.Top | AnchorStyles.Right;
            resetLichiiBtn.Font = new Font("Segoe UI", 8f, FontStyle.Regular);
            resetLichiiBtn.Click += OnResetLichiiDefaultsClick;
            _advancedDrawerPanel.Controls.Add(resetLichiiBtn);

            _allowLanCheckBox = new CheckBox();
            _allowLanCheckBox.Text = "Allow LAN access";
            _allowLanCheckBox.AutoSize = true;
            _allowLanCheckBox.Checked = true;
            _allowLanCheckBox.ForeColor = Theme.Parchment200;
            _allowLanCheckBox.BackColor = Theme.Ink900;
            _allowLanCheckBox.Location = new Point(14, 44);
            _allowLanCheckBox.CheckedChanged += OnAllowLanCheckedChanged;
            _advancedDrawerPanel.Controls.Add(_allowLanCheckBox);

            _autoOpenCheckBox = new CheckBox();
            _autoOpenCheckBox.Text = "Auto-open browser";
            _autoOpenCheckBox.AutoSize = true;
            _autoOpenCheckBox.Checked = true;
            _autoOpenCheckBox.ForeColor = Theme.Parchment200;
            _autoOpenCheckBox.BackColor = Theme.Ink900;
            _autoOpenCheckBox.Location = new Point(164, 44);
            _advancedDrawerPanel.Controls.Add(_autoOpenCheckBox);

            _trayMinimizeCheckBox = new CheckBox();
            _trayMinimizeCheckBox.Text = "Minimize to tray";
            _trayMinimizeCheckBox.AutoSize = true;
            _trayMinimizeCheckBox.Checked = false;
            _trayMinimizeCheckBox.ForeColor = Theme.Parchment200;
            _trayMinimizeCheckBox.BackColor = Theme.Ink900;
            _trayMinimizeCheckBox.Location = new Point(322, 44);
            _advancedDrawerPanel.Controls.Add(_trayMinimizeCheckBox);

            Label logTitle = new Label();
            logTitle.Text = "Activity Log";
            logTitle.Font = new Font("Segoe UI", 8.5f, FontStyle.Bold);
            logTitle.ForeColor = Theme.Parchment400;
            logTitle.AutoSize = true;
            logTitle.Location = new Point(14, 75);
            _advancedDrawerPanel.Controls.Add(logTitle);

            _modeBadgeLabel = new Label();
            _modeBadgeLabel.AutoSize = false;
            _modeBadgeLabel.Size = new Size(92, 20);
            _modeBadgeLabel.Location = new Point(352, 72);
            _modeBadgeLabel.Anchor = AnchorStyles.Top | AnchorStyles.Right;
            _modeBadgeLabel.TextAlign = ContentAlignment.MiddleCenter;
            _modeBadgeLabel.Font = new Font("Segoe UI", 7.5f, FontStyle.Bold);
            _modeBadgeLabel.BackColor = Theme.Ink800;
            _modeBadgeLabel.ForeColor = Theme.Parchment400;
            _modeBadgeLabel.BorderStyle = BorderStyle.FixedSingle;
            _advancedDrawerPanel.Controls.Add(_modeBadgeLabel);

            _clearLogButton = CreateButton("Clear", 452, 71, 62, 22, false);
            _clearLogButton.Anchor = AnchorStyles.Top | AnchorStyles.Right;
            _clearLogButton.Font = new Font("Segoe UI", 7.75f, FontStyle.Regular);
            _clearLogButton.Click += OnClearLogClick;
            _advancedDrawerPanel.Controls.Add(_clearLogButton);

            _logContainer = new Panel();
            _logContainer.Location = new Point(14, 98);
            _logContainer.Size = new Size(500, 112);
            _logContainer.Anchor = AnchorStyles.Top | AnchorStyles.Bottom | AnchorStyles.Left | AnchorStyles.Right;
            _logContainer.BackColor = Theme.Ink600;
            _logContainer.Padding = new Padding(1);
            _advancedDrawerPanel.Controls.Add(_logContainer);

            _logTextBox = new TextBox();
            _logTextBox.Multiline = true;
            _logTextBox.ReadOnly = true;
            _logTextBox.ScrollBars = ScrollBars.Vertical;
            _logTextBox.BorderStyle = BorderStyle.None;
            _logTextBox.Dock = DockStyle.Fill;
            _logTextBox.BackColor = Theme.Ink950;
            _logTextBox.ForeColor = Theme.Parchment200;
            _logTextBox.Font = new Font("Consolas", 8.25f, FontStyle.Regular);
            _logContainer.Controls.Add(_logTextBox);
        }

        private Button CreateButton(string text, int x, int y, int width, int height, bool bold)
        {
            Button btn = new Button();
            btn.Text = text;
            btn.Location = new Point(x, y);
            btn.Size = new Size(width, height);
            btn.FlatStyle = FlatStyle.Flat;
            btn.FlatAppearance.BorderSize = 1;
            btn.FlatAppearance.BorderColor = Theme.Ink600;
            btn.FlatAppearance.MouseOverBackColor = Theme.Ink700;
            btn.BackColor = Theme.Ink800;
            btn.ForeColor = Theme.Parchment200;
            btn.Font = new Font("Segoe UI", 9f, bold ? FontStyle.Bold : FontStyle.Regular);
            btn.Cursor = Cursors.Hand;
            btn.UseVisualStyleBackColor = false;
            return btn;
        }

        private void BuildTrayIcon()
        {
            ContextMenuStrip menu = new ContextMenuStrip();
            ToolStripMenuItem showItem = new ToolStripMenuItem("Show Ocarina Atlas");
            showItem.Font = new Font(showItem.Font, FontStyle.Bold);
            showItem.Click += delegate { RestoreFromTray(); };

            _trayOpenBrowserItem = new ToolStripMenuItem("Open Map in Browser");
            _trayOpenBrowserItem.Enabled = false;
            _trayOpenBrowserItem.Click += delegate { OpenMapInBrowser(); };

            _trayToggleServerItem = new ToolStripMenuItem("Start Map");
            _trayToggleServerItem.Click += delegate { OnStartStopClick(this, EventArgs.Empty); };

            ToolStripMenuItem exitItem = new ToolStripMenuItem("Exit");
            exitItem.Click += delegate
            {
                Close();
            };

            menu.Items.Add(showItem);
            menu.Items.Add(_trayOpenBrowserItem);
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add(_trayToggleServerItem);
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add(exitItem);

            _trayIcon = new NotifyIcon();
            _trayIcon.Icon = _appIcon;
            _trayIcon.Text = "Ocarina Atlas";
            _trayIcon.ContextMenuStrip = menu;
            _trayIcon.Visible = true;
            _trayIcon.DoubleClick += delegate { RestoreFromTray(); };
        }

        private void ApplyInitialOptions()
        {
            _portInput.Value = Math.Max(1, Math.Min(65535, _options.Port));
            _allowLanCheckBox.Checked = _options.AllowLan;
            _customBindHost = _options.BindHost;
            _lichiiHostInput.Text = _options.LichiiHost;
            _lichiiPortInput.Value = Math.Max(1, Math.Min(65535, _options.LichiiPort));
            _autoOpenCheckBox.Checked = _options.AutoOpenBrowser;

            if (_options.StartMinimized)
            {
                _trayMinimizeCheckBox.Checked = true;
                ShowInTaskbar = false;
                WindowState = FormWindowState.Minimized;
            }
        }

        private void ReflowLayout()
        {
            _advancedToggleButton.Text = _advancedExpanded
                ? "\u25BE Advanced Settings & Logs"
                : "\u25B8 Advanced Settings & Logs";

            int nonClientW = Size.Width - ClientSize.Width;
            int nonClientH = Size.Height - ClientSize.Height;

            if (_advancedExpanded)
            {
                _advancedDrawerPanel.Visible = true;
                MinimumSize = new Size(550 + nonClientW, 636 + nonClientH);
                if (ClientSize.Height < ExpandedClientHeight)
                {
                    ClientSize = new Size(ClientSize.Width, ExpandedClientHeight);
                }
                int drawerHeight = Math.Max(160, ClientSize.Height - _advancedDrawerPanel.Top - 14);
                _advancedDrawerPanel.Height = drawerHeight;
            }
            else
            {
                _advancedDrawerPanel.Visible = false;
                MinimumSize = new Size(550 + nonClientW, CollapsedClientHeight + nonClientH);
                ClientSize = new Size(ClientSize.Width, CollapsedClientHeight);
            }
        }

        private void OnFormLoad(object sender, EventArgs e)
        {
            AppendLog("Launcher ready. Checking runtime and Lichii status...");
            RefreshLanDisplays();
            TriggerFirewallStatusCheck();
            TriggerPollNow();
            StartUpdateCheck();

            if (_options.AutoStart)
            {
                StartServer();
            }
            if (_options.StartMinimized)
            {
                BeginInvokeSafe(delegate { HideToTray(); });
            }
        }

        private void OnFormResize(object sender, EventArgs e)
        {
            if (WindowState == FormWindowState.Minimized && _trayMinimizeCheckBox.Checked)
            {
                HideToTray();
            }
        }

        private void HideToTray()
        {
            ShowInTaskbar = false;
            Hide();
            if (!_trayHintShown && _trayIcon != null)
            {
                _trayHintShown = true;
                _trayIcon.ShowBalloonTip(
                    2500,
                    "Ocarina Atlas",
                    "Still running in the system tray. Double-click the icon to reopen.",
                    ToolTipIcon.Info);
            }
        }

        private void RestoreFromTray()
        {
            Show();
            ShowInTaskbar = true;
            WindowState = FormWindowState.Normal;
            Activate();
        }

        private void RefreshRuntimeBadge()
        {
            RuntimeResolution res = RuntimeResolver.Resolve((int)_portInput.Value, GetSelectedBindHost());
            _modeBadgeLabel.Text = res.Summary;
            if (res.Mode == RuntimeMode.Missing)
            {
                _modeBadgeLabel.ForeColor = Theme.Ember;
            }
            else if (res.Mode == RuntimeMode.Standalone)
            {
                _modeBadgeLabel.ForeColor = Theme.Moss;
            }
            else
            {
                _modeBadgeLabel.ForeColor = Theme.Parchment400;
            }
        }

        private void RefreshLichiiConfigStatus()
        {
            LichiiConfigStatus status = LichiiConfigManager.Inspect();
            if (!string.IsNullOrEmpty(status.ErrorMessage))
            {
                _configuredPill.Visible = false;
                _enableRpcButton.Visible = true;
                _lichiiStepDetailLabel.Text = "Could not read emulator config: " + status.ErrorMessage;
                _lichiiStepDetailLabel.ForeColor = Theme.Ember;
                return;
            }

            if (status.IsEnabled)
            {
                _configuredPill.Visible = true;
                _enableRpcButton.Visible = false;
                _lichiiStepDetailLabel.Text = "Allows Ocarina Atlas to follow Link and mark Gold Skulltulas automatically.";
                _lichiiStepDetailLabel.ForeColor = Theme.Parchment400;
                string pathsSummary = status.TargetPaths != null && status.TargetPaths.Count > 0
                    ? string.Join("\n", status.TargetPaths.ToArray())
                    : status.FilePath;
                _toolTip.SetToolTip(_configuredPill, "Configured: EDEN_NX2_DEBUG_SERVER=" + status.ConfiguredTarget + "\n" + pathsSummary);
            }
            else
            {
                _configuredPill.Visible = false;
                _enableRpcButton.Visible = true;
                _lichiiStepDetailLabel.Text = "Click to enable live tracking in Lichii / Fritchii so the map follows Link automatically.";
                _lichiiStepDetailLabel.ForeColor = Theme.Parchment200;
            }
        }

        private void UpdateLichiiPortLabels()
        {
            int lPort = (int)_lichiiPortInput.Value;
            _enableRpcButton.Text = lPort == 6545
                ? "1-Click Setup Sync"
                : string.Format(CultureInfo.InvariantCulture, "Setup Sync (:{0})", lPort);
        }

        private void OnLichiiPortChanged(object sender, EventArgs e)
        {
            UpdateLichiiPortLabels();
            TriggerPollNow();
        }

        private void OnResetLichiiDefaultsClick(object sender, EventArgs e)
        {
            _lichiiHostInput.Text = "127.0.0.1";
            _lichiiPortInput.Value = 6545;
            UpdateLichiiPortLabels();
            TriggerPollNow();
        }

        private void OnAdvancedToggleClick(object sender, EventArgs e)
        {
            _advancedExpanded = !_advancedExpanded;
            ReflowLayout();
        }

        private void OnClearLogClick(object sender, EventArgs e)
        {
            _logTextBox.Clear();
        }

        private void OnEnableRpcClick(object sender, EventArgs e)
        {
            string host = (_lichiiHostInput.Text ?? string.Empty).Trim();
            if (string.IsNullOrEmpty(host)) host = "127.0.0.1";
            int port = (int)_lichiiPortInput.Value;

            try
            {
                LichiiConfigStatus updated = LichiiConfigManager.EnableDebugServer(host, port);
                RefreshLichiiConfigStatus();
                string updatedPaths = updated.TargetPaths != null && updated.TargetPaths.Count > 0
                    ? string.Join("\n", updated.TargetPaths.ToArray())
                    : updated.FilePath;
                AppendLog(string.Format(
                    CultureInfo.InvariantCulture,
                    "Updated {0} with EDEN_NX2_DEBUG_SERVER={1}:{2}.",
                    updatedPaths.Replace("\n", ", "),
                    host,
                    port));

                string runningEmulator = LichiiConfigManager.DetectRunningEmulator();
                string message = runningEmulator != null
                    ? string.Format(
                        CultureInfo.InvariantCulture,
                        "Emulator live sync is now configured in:\n{0}\n\n{1} appears to be running right now. Please restart {1} for live sync to take effect.",
                        updatedPaths,
                        runningEmulator)
                    : string.Format(
                        CultureInfo.InvariantCulture,
                        "Emulator live sync is now configured in:\n{0}\n\nStart Lichii or Fritchii and load Ocarina of Time to activate live tracking.",
                        updatedPaths);

                MessageBox.Show(
                    this,
                    message,
                    "Emulator Live Sync Configured",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Information);
            }
            catch (Exception ex)
            {
                AppendLog("Failed to update nx2_switches.txt: " + ex.Message);
                MessageBox.Show(
                    this,
                    "Could not write emulator config:\n" + ex.Message,
                    "Config Error",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Error);
            }
        }

        private void OnStartStopClick(object sender, EventArgs e)
        {
            if (_lifecycle == ServerLifecycle.Stopped)
            {
                StartServer();
            }
            else if (_lifecycle == ServerLifecycle.Starting || _lifecycle == ServerLifecycle.Running)
            {
                StopServerAsync();
            }
        }

        private void OnOpenBrowserClick(object sender, EventArgs e)
        {
            OpenMapInBrowser();
        }

        private void OnServerUrlLinkClicked(object sender, LinkLabelLinkClickedEventArgs e)
        {
            OpenMapInBrowser();
        }

        private string GetSelectedBindHost()
        {
            if (!_allowLanCheckBox.Checked) return "127.0.0.1";
            if (!string.IsNullOrEmpty(_customBindHost) && !LanNetworkHelper.IsLoopbackHost(_customBindHost))
            {
                return LanNetworkHelper.SanitizeHost(_customBindHost, "0.0.0.0");
            }
            return "0.0.0.0";
        }

        private string GetEffectiveBindHost()
        {
            return _lifecycle == ServerLifecycle.Stopped ? GetSelectedBindHost() : _activeBindHost;
        }

        private int GetEffectivePort()
        {
            return _lifecycle == ServerLifecycle.Stopped ? (int)_portInput.Value : _activePort;
        }

        private void OnPortInputChanged(object sender, EventArgs e)
        {
            RefreshLanDisplays();
            RefreshRuntimeBadge();
            TriggerFirewallStatusCheck();
        }

        private void OnAllowLanCheckedChanged(object sender, EventArgs e)
        {
            if (!_allowLanCheckBox.Checked)
            {
                _customBindHost = null;
            }
            RefreshLanDisplays();
            RefreshRuntimeBadge();
            UpdateControlStates();
            TriggerFirewallStatusCheck();
        }

        private void OnRefreshLanClick(object sender, EventArgs e)
        {
            RefreshLanDisplays();
            TriggerFirewallStatusCheck();
            AppendLog("Refreshed active LAN network adapters.");
        }

        private void OnLanComboSelectedIndexChanged(object sender, EventArgs e)
        {
            LanEndpoint selected = _lanComboBox.SelectedItem as LanEndpoint;
            if (selected != null)
            {
                _selectedLanUrl = selected.Url;
                UpdateQrPreview();
            }
        }

        private void RefreshLanDisplays()
        {
            string bindHost = GetEffectiveBindHost();
            int port = GetEffectivePort();
            List<LanEndpoint> nextEndpoints = new List<LanEndpoint>();

            if (LanNetworkHelper.IsLoopbackHost(bindHost))
            {
                _selectedLanUrl = string.Empty;
            }
            else if (!LanNetworkHelper.IsWildcardHost(bindHost))
            {
                LanEndpoint ep = new LanEndpoint();
                ep.IpAddress = bindHost;
                ep.Url = LanNetworkHelper.FormatHttpUrl(bindHost, port);
                ep.AdapterLabel = "Custom";
                ep.IsPreferred = true;
                nextEndpoints.Add(ep);
                _selectedLanUrl = ep.Url;
            }
            else
            {
                nextEndpoints = LanNetworkHelper.GetLanEndpoints(port);
            }

            bool listChanged = nextEndpoints.Count != _lanEndpoints.Count;
            if (!listChanged)
            {
                for (int i = 0; i < nextEndpoints.Count; i++)
                {
                    if (!string.Equals(nextEndpoints[i].Url, _lanEndpoints[i].Url, StringComparison.Ordinal) ||
                        !string.Equals(nextEndpoints[i].AdapterLabel, _lanEndpoints[i].AdapterLabel, StringComparison.Ordinal))
                    {
                        listChanged = true;
                        break;
                    }
                }
            }

            _lanEndpoints = nextEndpoints;

            if (_lanEndpoints.Count == 0)
            {
                _selectedLanUrl = string.Empty;
            }
            else if (_lanEndpoints.Count == 1)
            {
                _selectedLanUrl = _lanEndpoints[0].Url;
            }
            else if (listChanged)
            {
                string previousSelection = _selectedLanUrl;
                int restoreIndex = 0;
                _lanComboBox.BeginUpdate();
                try
                {
                    _lanComboBox.Items.Clear();
                    for (int i = 0; i < _lanEndpoints.Count; i++)
                    {
                        _lanComboBox.Items.Add(_lanEndpoints[i]);
                        if (!string.IsNullOrEmpty(previousSelection) &&
                            string.Equals(_lanEndpoints[i].Url, previousSelection, StringComparison.Ordinal))
                        {
                            restoreIndex = i;
                        }
                    }
                    _lanComboBox.SelectedIndex = restoreIndex;
                }
                finally
                {
                    _lanComboBox.EndUpdate();
                }
                _selectedLanUrl = _lanEndpoints[restoreIndex].Url;
            }

            UpdateLanRowUi();
        }

        private void UpdateLanRowUi()
        {
            if (_lanStatusLabel == null || _lanUrlLink == null || _copyLanUrlButton == null || _lanComboBox == null) return;

            bool isRunning = _lifecycle == ServerLifecycle.Running;
            string bindHost = GetEffectiveBindHost();

            if (LanNetworkHelper.IsLoopbackHost(bindHost))
            {
                _lanComboBox.Visible = false;
                _lanUrlLink.Visible = false;
                _lanStatusLabel.Text = "Disabled (localhost only \u2014 127.0.0.1)";
                _lanStatusLabel.ForeColor = Theme.Parchment600;
                _lanStatusLabel.Visible = true;
                _copyLanUrlButton.Enabled = false;
                _lanHintLabel.Text = "Enable \"Allow LAN access\" in Advanced Settings to connect a tablet or phone.";
                UpdateQrPreview();
                return;
            }

            if (_lanEndpoints.Count == 0)
            {
                _lanComboBox.Visible = false;
                _lanUrlLink.Visible = false;
                _lanStatusLabel.Text = "No active Wi-Fi or Ethernet connection detected";
                _lanStatusLabel.ForeColor = Theme.Ember;
                _lanStatusLabel.Visible = true;
                _copyLanUrlButton.Enabled = false;
                _lanHintLabel.Text = "Connect your PC to Wi-Fi or Ethernet, then click Refresh.";
                UpdateQrPreview();
                return;
            }

            _copyLanUrlButton.Enabled = true;

            if (_lanEndpoints.Count > 1)
            {
                _lanUrlLink.Visible = false;
                _lanStatusLabel.Visible = false;
                _lanComboBox.Visible = true;
                _lanHintLabel.Text = "Multiple network adapters found \u2014 pick the one your tablet or phone uses.";
            }
            else
            {
                _lanComboBox.Visible = false;
                LanEndpoint primary = _lanEndpoints[0];
                _selectedLanUrl = primary.Url;

                if (isRunning)
                {
                    _lanStatusLabel.Visible = false;
                    _lanUrlLink.Text = primary.Url;
                    _lanUrlLink.Visible = true;
                }
                else
                {
                    _lanUrlLink.Visible = false;
                    _lanStatusLabel.Text = string.Format(
                        CultureInfo.InvariantCulture,
                        "{0} ({1})",
                        primary.Url,
                        primary.AdapterLabel);
                    _lanStatusLabel.ForeColor = Theme.Parchment200;
                    _lanStatusLabel.Visible = true;
                }

                _lanHintLabel.Text = "Open this address or scan the QR code on your tablet, iPad, or phone.";
            }

            UpdateQrPreview();
        }

        private void UpdateQrPreview()
        {
            if (_qrPictureBox == null || _qrPictureBox.IsDisposed) return;

            if (string.IsNullOrEmpty(_selectedLanUrl))
            {
                _renderedQrUrl = string.Empty;
                _qrPictureBox.Visible = false;
                Image oldEmpty = _qrPictureBox.Image;
                _qrPictureBox.Image = null;
                if (oldEmpty != null) oldEmpty.Dispose();
                return;
            }

            if (string.Equals(_renderedQrUrl, _selectedLanUrl, StringComparison.Ordinal) && _qrPictureBox.Image != null)
            {
                _qrPictureBox.Visible = true;
                return;
            }

            Bitmap bmp = QrCodeEncoder.RenderBitmap(_selectedLanUrl, _qrPictureBox.Width);
            if (bmp == null)
            {
                _qrPictureBox.Visible = false;
                return;
            }

            _renderedQrUrl = _selectedLanUrl;
            Image oldImg = _qrPictureBox.Image;
            _qrPictureBox.Image = bmp;
            _qrPictureBox.Visible = true;
            if (oldImg != null) oldImg.Dispose();
        }

        private void OnQrPictureBoxClick(object sender, EventArgs e)
        {
            if (string.IsNullOrEmpty(_selectedLanUrl)) return;

            Bitmap largeBmp = QrCodeEncoder.RenderBitmap(_selectedLanUrl, 280);
            if (largeBmp == null) return;

            using (largeBmp)
            using (Form modal = new Form())
            {
                modal.Text = "Scan QR Code \u2014 Ocarina Atlas";
                modal.BackColor = Theme.Ink950;
                modal.ForeColor = Theme.Parchment200;
                modal.Font = new Font("Segoe UI", 9f, FontStyle.Regular);
                modal.FormBorderStyle = FormBorderStyle.FixedDialog;
                modal.StartPosition = FormStartPosition.CenterParent;
                modal.MaximizeBox = false;
                modal.MinimizeBox = false;
                modal.ShowInTaskbar = false;
                modal.ClientSize = new Size(328, 376);
                if (_appIcon != null) modal.Icon = _appIcon;

                PictureBox largeBox = new PictureBox();
                largeBox.Location = new Point(24, 16);
                largeBox.Size = new Size(280, 280);
                largeBox.BackColor = Color.White;
                largeBox.SizeMode = PictureBoxSizeMode.CenterImage;
                largeBox.Image = largeBmp;
                modal.Controls.Add(largeBox);

                Label urlLabel = new Label();
                urlLabel.Text = _selectedLanUrl;
                urlLabel.Font = new Font("Segoe UI", 9.5f, FontStyle.Bold);
                urlLabel.ForeColor = Theme.Moss;
                urlLabel.TextAlign = ContentAlignment.MiddleCenter;
                urlLabel.AutoSize = false;
                urlLabel.Location = new Point(16, 304);
                urlLabel.Size = new Size(296, 24);
                modal.Controls.Add(urlLabel);

                Button closeBtn = CreateButton("Close", 114, 336, 100, 28, false);
                closeBtn.DialogResult = DialogResult.Cancel;
                modal.Controls.Add(closeBtn);
                modal.CancelButton = closeBtn;

                modal.ShowDialog(this);
            }
        }

        private void OnLanUrlLinkClicked(object sender, LinkLabelLinkClickedEventArgs e)
        {
            if (string.IsNullOrEmpty(_selectedLanUrl)) return;
            OpenUrlInBrowser(_selectedLanUrl);
        }

        private void OnCopyLanUrlClick(object sender, EventArgs e)
        {
            if (string.IsNullOrEmpty(_selectedLanUrl)) return;
            try
            {
                Clipboard.SetText(_selectedLanUrl);
                _copyLanUrlButton.Text = "Copied!";
                _copyFeedbackTicks = 2;
                AppendLog("Copied LAN URL to clipboard: " + _selectedLanUrl);
            }
            catch (Exception ex)
            {
                AppendLog("Could not copy LAN URL to clipboard: " + ex.Message);
            }
        }

        private void TriggerFirewallStatusCheck()
        {
            if (IsDisposed || !IsHandleCreated) return;
            if (LanNetworkHelper.IsLoopbackHost(GetEffectiveBindHost()))
            {
                UpdateFirewallButtonState();
                return;
            }
            if (Interlocked.CompareExchange(ref _firewallCheckInFlight, 1, 0) != 0) return;

            int port = GetEffectivePort();
            ThreadPool.QueueUserWorkItem(delegate
            {
                bool allowed = false;
                try
                {
                    allowed = LanNetworkHelper.IsFirewallRulePresent(port);
                }
                finally
                {
                    Interlocked.Exchange(ref _firewallCheckInFlight, 0);
                }

                BeginInvokeSafe(delegate
                {
                    _firewallCheckedPort = port;
                    _firewallAllowed = allowed;
                    UpdateFirewallButtonState();
                });
            });
        }

        private void UpdateFirewallButtonState()
        {
            if (_firewallButton == null) return;
            int port = GetEffectivePort();
            bool lanEnabled = !LanNetworkHelper.IsLoopbackHost(GetEffectiveBindHost());

            if (!lanEnabled)
            {
                _firewallButton.Enabled = false;
                _firewallButton.Text = "Localhost Only";
                _firewallButton.ForeColor = Theme.Parchment600;
                _firewallButton.FlatAppearance.BorderColor = Theme.Ink600;
                return;
            }

            _firewallButton.Enabled = true;
            if (_firewallCheckedPort == port && _firewallAllowed)
            {
                _firewallButton.Text = "LAN Allowed";
                _firewallButton.ForeColor = Theme.Moss;
                _firewallButton.FlatAppearance.BorderColor = Theme.Moss;
            }
            else
            {
                _firewallButton.Text = "Allow LAN Access";
                _firewallButton.ForeColor = Theme.Parchment200;
                _firewallButton.FlatAppearance.BorderColor = Theme.Ink600;
            }
        }

        private void OnAllowFirewallClick(object sender, EventArgs e)
        {
            int port = GetEffectivePort();
            if (_firewallCheckedPort == port && _firewallAllowed)
            {
                MessageBox.Show(
                    this,
                    string.Format(
                        CultureInfo.InvariantCulture,
                        "Windows Defender Firewall rule \"{0}\" is already present for Private networks.",
                        LanNetworkHelper.GetFirewallRuleName(port)),
                    "LAN Firewall Ready",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Information);
                return;
            }

            _firewallButton.Enabled = false;
            _firewallButton.Text = "Configuring...";

            bool canceled;
            string error;
            bool ok = LanNetworkHelper.AddPrivateLanFirewallRule(port, out canceled, out error);
            if (ok)
            {
                _firewallCheckedPort = port;
                _firewallAllowed = true;
                UpdateFirewallButtonState();
                AppendLog(string.Format(
                    CultureInfo.InvariantCulture,
                    "Added Windows Firewall Private LAN rule \"{0}\" for TCP port {1}.",
                    LanNetworkHelper.GetFirewallRuleName(port),
                    port));
                MessageBox.Show(
                    this,
                    string.Format(
                        CultureInfo.InvariantCulture,
                        "Windows Firewall now allows incoming LAN connections on TCP port {0} (Private networks).\n\nTip: If an iPad/tablet still cannot connect, verify your Windows Wi-Fi/Ethernet network profile is set to Private in Windows Settings.",
                        port),
                    "LAN Firewall Configured",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Information);
            }
            else if (canceled)
            {
                UpdateFirewallButtonState();
                AppendLog("Firewall configuration prompt canceled.");
            }
            else
            {
                UpdateFirewallButtonState();
                AppendLog("Failed to add Windows Firewall rule: " + (error ?? "Unknown error"));
                MessageBox.Show(
                    this,
                    string.Format(
                        CultureInfo.InvariantCulture,
                        "Could not automatically configure Windows Firewall:\n{0}\n\nYou can run this in an Administrator Command Prompt:\nnetsh advfirewall firewall add rule name=\"{1}\" dir=in action=allow protocol=TCP localport={2} profile=private",
                        error ?? "Unknown error",
                        LanNetworkHelper.GetFirewallRuleName(port),
                        port),
                    "Firewall Configuration Error",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Warning);
            }
        }

        private void OpenMapInBrowser()
        {
            OpenUrlInBrowser(GetServerUrl());
        }

        internal void OpenUrlInBrowser(string url)
        {
            try
            {
                ProcessStartInfo psi = new ProcessStartInfo(url);
                psi.UseShellExecute = true;
                Process.Start(psi);
            }
            catch (Exception ex)
            {
                AppendLog("Failed to open browser: " + ex.Message);
            }
        }

        private string GetServerUrl()
        {
            return string.Format(CultureInfo.InvariantCulture, "http://127.0.0.1:{0}", _activePort);
        }

        private void StartServer()
        {
            if (_lifecycle != ServerLifecycle.Stopped) return;

            int port = (int)_portInput.Value;
            string bindHost = GetSelectedBindHost();
            string lichiiHost = (_lichiiHostInput.Text ?? string.Empty).Trim();
            if (string.IsNullOrEmpty(lichiiHost)) lichiiHost = "127.0.0.1";
            int lichiiPort = (int)_lichiiPortInput.Value;

            if (IsLocalTcpPortInUse(port))
            {
                AppendLog(string.Format(CultureInfo.InvariantCulture, "Port {0} is already in use.", port));
                MessageBox.Show(
                    this,
                    string.Format(
                        CultureInfo.InvariantCulture,
                        "Port {0} is already in use by another application.\nChoose another port or close the existing server.",
                        port),
                    "Port In Use",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Warning);
                return;
            }

            RuntimeResolution target = RuntimeResolver.Resolve(port, bindHost);
            if (target.Mode == RuntimeMode.Missing)
            {
                AppendLog("ERROR: " + target.ErrorMessage);
                MessageBox.Show(this, target.ErrorMessage, "Runtime Missing", MessageBoxButtons.OK, MessageBoxIcon.Error);
                return;
            }

            _activePort = port;
            _activeBindHost = bindHost;
            _activeLichiiHost = lichiiHost;
            _activeLichiiPort = lichiiPort;
            _browserOpenedForRun = false;
            _hasStartupError = false;
            _lifecycle = ServerLifecycle.Starting;
            RefreshLanDisplays();
            UpdateControlStates();

            string lanNote = string.IsNullOrEmpty(_selectedLanUrl)
                ? (LanNetworkHelper.IsLoopbackHost(bindHost) ? "localhost only" : "LAN enabled")
                : "LAN " + _selectedLanUrl;

            AppendLog(string.Format(
                CultureInfo.InvariantCulture,
                "Starting {0} server on http://127.0.0.1:{1} ({2}, Lichii {3}:{4})...",
                target.Summary,
                port,
                lanNote,
                lichiiHost,
                lichiiPort));

            try
            {
                if (_jobObject == null || !_jobObject.IsValid)
                {
                    if (_jobObject != null) _jobObject.Dispose();
                    _jobObject = new JobObject();
                }

                ProcessStartInfo psi = new ProcessStartInfo();
                psi.FileName = target.ExecutablePath;
                psi.Arguments = target.ArgumentsTemplate;
                psi.WorkingDirectory = target.WorkingDirectory;
                psi.UseShellExecute = false;
                psi.CreateNoWindow = true;
                psi.RedirectStandardOutput = true;
                psi.RedirectStandardError = true;
                psi.StandardOutputEncoding = Encoding.UTF8;
                psi.StandardErrorEncoding = Encoding.UTF8;

                psi.EnvironmentVariables["HOST"] = bindHost;
                psi.EnvironmentVariables["PORT"] = port.ToString(CultureInfo.InvariantCulture);
                psi.EnvironmentVariables["LICHII_HOST"] = lichiiHost;
                psi.EnvironmentVariables["LICHII_PORT"] = lichiiPort.ToString(CultureInfo.InvariantCulture);
                if (!string.IsNullOrEmpty(target.DistDirectory))
                {
                    psi.EnvironmentVariables["APP_DIST_DIR"] = target.DistDirectory;
                }

                Process proc = new Process();
                proc.StartInfo = psi;
                proc.EnableRaisingEvents = true;
                proc.OutputDataReceived += OnServerOutputReceived;
                proc.ErrorDataReceived += OnServerErrorReceived;
                proc.Exited += OnServerExited;

                if (!proc.Start())
                {
                    throw new InvalidOperationException("Process.Start returned false.");
                }

                int jobError;
                if (_jobObject.IsValid)
                {
                    if (!_jobObject.Assign(proc, out jobError))
                    {
                        AppendLog("Warning: AssignProcessToJobObject failed (Win32 error " + jobError + "); using explicit shutdown fallback.");
                    }
                }
                else
                {
                    AppendLog("Warning: Could not initialize Windows Job Object; using explicit shutdown fallback.");
                }

                lock (_procLock)
                {
                    _serverProcess = proc;
                }

                proc.BeginOutputReadLine();
                proc.BeginErrorReadLine();
            }
            catch (Exception ex)
            {
                _hasStartupError = true;
                _lifecycle = ServerLifecycle.Stopped;
                UpdateControlStates();
                AppendLog("Failed to start server: " + ex.Message);
                MessageBox.Show(this, "Could not start the Map Server:\n" + ex.Message, "Startup Error", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }

        private void OnServerOutputReceived(object sender, DataReceivedEventArgs e)
        {
            if (string.IsNullOrEmpty(e.Data)) return;
            string line = StripAnsi(e.Data).TrimEnd();
            if (line.Length == 0) return;

            BeginInvokeSafe(delegate
            {
                AppendLog("[server] " + line);
                if (_lifecycle == ServerLifecycle.Starting &&
                    (line.IndexOf("READY http://", StringComparison.OrdinalIgnoreCase) >= 0 ||
                     line.IndexOf("Local:", StringComparison.OrdinalIgnoreCase) >= 0))
                {
                    MarkServerRunning();
                }
            });
        }

        private void OnServerErrorReceived(object sender, DataReceivedEventArgs e)
        {
            if (string.IsNullOrEmpty(e.Data)) return;
            string line = StripAnsi(e.Data).TrimEnd();
            if (line.Length == 0) return;

            BeginInvokeSafe(delegate
            {
                AppendLog("[server:err] " + line);
            });
        }

        private void OnServerExited(object sender, EventArgs e)
        {
            Process exited = sender as Process;
            int exitCode = 0;
            try
            {
                if (exited != null) exitCode = exited.ExitCode;
            }
            catch
            {
                // Ignore exit code errors.
            }

            BeginInvokeSafe(delegate
            {
                lock (_procLock)
                {
                    if (_serverProcess == exited)
                    {
                        _serverProcess = null;
                    }
                }
                if (exited != null)
                {
                    try { exited.Dispose(); } catch { }
                }

                bool wasStopping = _lifecycle == ServerLifecycle.Stopping;
                _hasStartupError = !wasStopping && exitCode != 0;
                _lifecycle = ServerLifecycle.Stopped;
                UpdateControlStates();
                AppendLog(wasStopping
                    ? "Server stopped cleanly."
                    : string.Format(CultureInfo.InvariantCulture, "Server exited unexpectedly (code {0}).", exitCode));
            });
        }

        private void MarkServerRunning()
        {
            if (_lifecycle == ServerLifecycle.Running) return;
            _lifecycle = ServerLifecycle.Running;
            UpdateControlStates();

            if (_autoOpenCheckBox.Checked && !_browserOpenedForRun)
            {
                _browserOpenedForRun = true;
                OpenMapInBrowser();
            }
        }

        private void StopServerAsync()
        {
            Process proc;
            lock (_procLock)
            {
                proc = _serverProcess;
            }
            if (proc == null)
            {
                _lifecycle = ServerLifecycle.Stopped;
                UpdateControlStates();
                return;
            }

            _lifecycle = ServerLifecycle.Stopping;
            UpdateControlStates();
            AppendLog("Stopping Map Server...");

            ThreadPool.QueueUserWorkItem(delegate
            {
                TerminateProcessTree(proc);
            });
        }

        private static void TerminateProcessTree(Process proc)
        {
            if (proc == null) return;
            try
            {
                if (proc.HasExited) return;
            }
            catch
            {
                return;
            }

            int pid = 0;
            try { pid = proc.Id; } catch { }

            if (pid > 0)
            {
                try
                {
                    ProcessStartInfo tk = new ProcessStartInfo("taskkill.exe", "/PID " + pid.ToString(CultureInfo.InvariantCulture) + " /T /F");
                    tk.CreateNoWindow = true;
                    tk.UseShellExecute = false;
                    tk.RedirectStandardOutput = true;
                    tk.RedirectStandardError = true;
                    using (Process killer = Process.Start(tk))
                    {
                        if (killer != null)
                        {
                            killer.WaitForExit(3000);
                        }
                    }
                }
                catch
                {
                    // Fallback to direct Kill below.
                }
            }

            try
            {
                if (!proc.HasExited)
                {
                    proc.Kill();
                    proc.WaitForExit(2000);
                }
            }
            catch
            {
                // Ignore if already exited.
            }
        }

        private void OnFormClosing(object sender, FormClosingEventArgs e)
        {
            // Normal close exits the application cleanly (minimize-to-tray only triggers on Minimize).
            if (_pollTimer != null)
            {
                _pollTimer.Stop();
                _pollTimer.Dispose();
            }

            Process proc;
            lock (_procLock)
            {
                proc = _serverProcess;
                _serverProcess = null;
            }

            if (proc != null)
            {
                _lifecycle = ServerLifecycle.Stopping;
                TerminateProcessTree(proc);
                try { proc.Dispose(); } catch { }
            }

            if (_jobObject != null)
            {
                _jobObject.Dispose();
                _jobObject = null;
            }

            if (_trayIcon != null)
            {
                _trayIcon.Visible = false;
                _trayIcon.Dispose();
                _trayIcon = null;
            }

            if (_appIcon != null)
            {
                _appIcon.Dispose();
            }

            if (_toolTip != null)
            {
                _toolTip.Dispose();
                _toolTip = null;
            }

            if (_qrPictureBox != null && _qrPictureBox.Image != null)
            {
                Image img = _qrPictureBox.Image;
                _qrPictureBox.Image = null;
                img.Dispose();
            }
        }

        private void UpdateControlStates()
        {
            bool isStopped = _lifecycle == ServerLifecycle.Stopped;
            bool isRunning = _lifecycle == ServerLifecycle.Running;
            bool isStopping = _lifecycle == ServerLifecycle.Stopping;

            _portInput.Enabled = isStopped;
            _allowLanCheckBox.Enabled = isStopped;
            _lichiiHostInput.Enabled = isStopped;
            _lichiiPortInput.Enabled = isStopped;

            if (isStopped)
            {
                _startStopButton.Text = "Start Map";
                _startStopButton.Enabled = true;
                _startStopButton.BackColor = Theme.Moss;
                _startStopButton.ForeColor = Theme.Ink950;
                _startStopButton.FlatAppearance.BorderColor = Theme.Moss;

                if (_hasStartupError)
                {
                    _serverDot.DotColor = Theme.Ember;
                    _serverStatusLabel.Text = "Error";
                    _serverStatusLabel.ForeColor = Theme.Ember;
                    _heroStatusPill.BorderColor = Theme.Ember;
                    _heroSummaryLabel.Text = "Could not start the map server. Check Advanced Settings & Logs for details.";
                }
                else
                {
                    _serverDot.DotColor = Theme.Parchment600;
                    _serverStatusLabel.Text = "Stopped";
                    _serverStatusLabel.ForeColor = Theme.Parchment400;
                    _heroStatusPill.BorderColor = Theme.Ink600;
                    _heroSummaryLabel.Text = "Click Start Map to open the interactive Hyrule map in your browser.";
                }
                _serverUrlLink.Visible = false;
            }
            else if (_lifecycle == ServerLifecycle.Starting)
            {
                _startStopButton.Text = "Stop Map";
                _startStopButton.Enabled = true;
                _startStopButton.BackColor = Theme.Ember;
                _startStopButton.ForeColor = Theme.Ink950;
                _startStopButton.FlatAppearance.BorderColor = Theme.Ember;

                _serverDot.DotColor = Theme.Ember;
                _serverStatusLabel.Text = "Starting...";
                _serverStatusLabel.ForeColor = Theme.Ember;
                _heroStatusPill.BorderColor = Theme.Ember;
                _heroSummaryLabel.Text = "Starting the local map server...";
                _serverUrlLink.Visible = false;
            }
            else if (isRunning)
            {
                _startStopButton.Text = "Stop Map";
                _startStopButton.Enabled = true;
                _startStopButton.BackColor = Theme.Ember;
                _startStopButton.ForeColor = Theme.Ink950;
                _startStopButton.FlatAppearance.BorderColor = Theme.Ember;

                _serverDot.DotColor = Theme.Moss;
                _serverStatusLabel.Text = "Running";
                _serverStatusLabel.ForeColor = Theme.Moss;
                _heroStatusPill.BorderColor = Theme.Moss;
                _heroSummaryLabel.Text = "Map is live and ready in your browser.";
                _serverUrlLink.Text = GetServerUrl();
                _serverUrlLink.Visible = true;
            }
            else if (isStopping)
            {
                _startStopButton.Text = "Stopping...";
                _startStopButton.Enabled = false;
                _startStopButton.BackColor = Theme.Ink700;
                _startStopButton.ForeColor = Theme.Parchment400;
                _startStopButton.FlatAppearance.BorderColor = Theme.Ink600;

                _serverDot.DotColor = Theme.Ember;
                _serverStatusLabel.Text = "Stopping...";
                _serverStatusLabel.ForeColor = Theme.Ember;
                _heroStatusPill.BorderColor = Theme.Ember;
                _heroSummaryLabel.Text = "Shutting down the map server...";
                _serverUrlLink.Visible = false;
            }

            _heroStatusPill.Invalidate();
            _openBrowserButton.Enabled = isRunning;
            UpdateLanRowUi();
            UpdateFirewallButtonState();
            if (_trayOpenBrowserItem != null) _trayOpenBrowserItem.Enabled = isRunning;
            if (_trayToggleServerItem != null)
            {
                _trayToggleServerItem.Text = isStopped ? "Start Map" : "Stop Map";
                _trayToggleServerItem.Enabled = !isStopping;
            }
            if (_trayIcon != null)
            {
                _trayIcon.Text = isRunning
                    ? "Ocarina Atlas \u2014 Running (" + GetServerUrl() + ")"
                    : "Ocarina Atlas \u2014 " + _lifecycle.ToString();
            }
        }

        private void OnPollTimerTick(object sender, EventArgs e)
        {
            if (_copyFeedbackTicks > 0)
            {
                _copyFeedbackTicks--;
                if (_copyFeedbackTicks == 0 && _copyLanUrlButton != null)
                {
                    _copyLanUrlButton.Text = "Copy URL";
                }
            }
            RefreshLanDisplays();
            TriggerPollNow();
        }

        private void TriggerPollNow()
        {
            if (IsDisposed || !IsHandleCreated) return;
            if (Interlocked.CompareExchange(ref _pollInFlight, 1, 0) != 0) return;

            bool serverActive = _lifecycle == ServerLifecycle.Starting || _lifecycle == ServerLifecycle.Running;
            int serverPort = _activePort;
            string lichiiHost = _lifecycle == ServerLifecycle.Stopped
                ? ((_lichiiHostInput.Text ?? string.Empty).Trim())
                : _activeLichiiHost;
            if (string.IsNullOrEmpty(lichiiHost)) lichiiHost = "127.0.0.1";
            int lichiiPort = _lifecycle == ServerLifecycle.Stopped
                ? (int)_lichiiPortInput.Value
                : _activeLichiiPort;

            ThreadPool.QueueUserWorkItem(delegate
            {
                try
                {
                    PollSnapshot snap = FetchStatusSnapshot(serverActive, serverPort, lichiiHost, lichiiPort);
                    BeginInvokeSafe(delegate { ApplyPollSnapshot(snap); });
                }
                finally
                {
                    Interlocked.Exchange(ref _pollInFlight, 0);
                }
            });
        }

        private static PollSnapshot FetchStatusSnapshot(bool serverActive, int serverPort, string lichiiHost, int lichiiPort)
        {
            PollSnapshot snap = new PollSnapshot();

            if (serverActive)
            {
                string url = string.Format(CultureInfo.InvariantCulture, "http://127.0.0.1:{0}/api/lichii/state", serverPort);
                try
                {
                    HttpWebRequest req = (HttpWebRequest)WebRequest.Create(url);
                    req.Method = "GET";
                    req.Timeout = 1200;
                    req.ReadWriteTimeout = 1200;
                    req.Proxy = null;
                    req.KeepAlive = false;

                    using (HttpWebResponse resp = (HttpWebResponse)req.GetResponse())
                    {
                        if (resp.StatusCode == HttpStatusCode.OK)
                        {
                            using (Stream stream = resp.GetResponseStream())
                            using (StreamReader reader = new StreamReader(stream, Encoding.UTF8))
                            {
                                string body = reader.ReadToEnd();
                                Dictionary<string, object> obj = SimpleJsonParser.ParseObject(body);
                                if (obj != null)
                                {
                                    snap.ServerHttpOk = true;
                                    snap.Connected = SimpleJsonParser.GetBool(obj, "connected");
                                    snap.EmulatorRunning = SimpleJsonParser.GetBool(obj, "emulatorRunning");
                                    snap.Source = SimpleJsonParser.GetString(obj, "source");
                                    snap.Scene = SimpleJsonParser.GetString(obj, "scene");
                                    snap.PlaceName = SimpleJsonParser.GetString(obj, "placeName");
                                    snap.MapId = SimpleJsonParser.GetString(obj, "mapId");
                                    snap.Age = SimpleJsonParser.GetString(obj, "age");
                                    snap.SkulltulaCount = SimpleJsonParser.GetInt(obj, "skulltulaCount");
                                    snap.RpcPortOpen = snap.Connected;
                                    return snap;
                                }
                            }
                        }
                    }
                }
                catch
                {
                    // Fall back to direct TCP probe below while server is starting up.
                }
            }

            snap.RpcPortOpen = ProbeTcpPort(lichiiHost, lichiiPort, 300);
            snap.RunningEmulator = LichiiConfigManager.DetectRunningEmulator();
            return snap;
        }

        private void ApplyPollSnapshot(PollSnapshot snap)
        {
            if (snap == null || IsDisposed) return;

            if (snap.ServerHttpOk && _lifecycle == ServerLifecycle.Starting)
            {
                MarkServerRunning();
            }

            string emuName = !string.IsNullOrEmpty(snap.RunningEmulator) ? snap.RunningEmulator : "Emulator";

            if (snap.ServerHttpOk && snap.Connected && snap.EmulatorRunning &&
                string.Equals(snap.Source, "memory", StringComparison.OrdinalIgnoreCase))
            {
                _heroLichiiDot.DotColor = Theme.Moss;
                _heroLichiiLabel.Text = emuName + ": Live Sync";
                _heroLichiiLabel.ForeColor = Theme.Moss;

                List<string> parts = new List<string>();
                string place = !string.IsNullOrEmpty(snap.PlaceName) ? snap.PlaceName : snap.Scene;
                if (!string.IsNullOrEmpty(place))
                {
                    string loc = place;
                    if (!string.IsNullOrEmpty(snap.MapId))
                    {
                        loc += " (" + FormatCompactFloor(snap.MapId) + ")";
                    }
                    parts.Add(loc);
                }
                if (!string.IsNullOrEmpty(snap.Age))
                {
                    parts.Add(string.Equals(snap.Age, "child", StringComparison.OrdinalIgnoreCase) ? "Child" : "Adult");
                }
                if (snap.SkulltulaCount.HasValue)
                {
                    parts.Add(string.Format(CultureInfo.InvariantCulture, "{0}/100 Gold Skulltulas", snap.SkulltulaCount.Value));
                }

                _lichiiStepDetailLabel.Text = parts.Count > 0
                    ? "Live: " + string.Join("  \u00B7  ", parts.ToArray())
                    : "Streaming live player coordinates from " + emuName + ".";
                _lichiiStepDetailLabel.ForeColor = Theme.Parchment200;
            }
            else if ((snap.ServerHttpOk && snap.Connected) || snap.RpcPortOpen)
            {
                _heroLichiiDot.DotColor = Theme.Ember;
                _heroLichiiLabel.Text = emuName + ": Waiting for game";
                _heroLichiiLabel.ForeColor = Theme.Ember;

                if (snap.ServerHttpOk && string.Equals(snap.Source, "save", StringComparison.OrdinalIgnoreCase) && snap.SkulltulaCount.HasValue)
                {
                    _lichiiStepDetailLabel.Text = string.Format(
                        CultureInfo.InvariantCulture,
                        "Save loaded ({0}/100 Gold Skulltulas). Start Ocarina of Time in {1} for live sync.",
                        snap.SkulltulaCount.Value,
                        emuName);
                }
                else
                {
                    _lichiiStepDetailLabel.Text = emuName + " is ready. Load your Ocarina of Time save to start live sync.";
                }
                _lichiiStepDetailLabel.ForeColor = Theme.Parchment400;
            }
            else if (!string.IsNullOrEmpty(snap.RunningEmulator))
            {
                _heroLichiiDot.DotColor = Theme.Ember;
                _heroLichiiLabel.Text = snap.RunningEmulator + ": RPC closed";
                _heroLichiiLabel.ForeColor = Theme.Ember;

                if (_configuredPill.Visible)
                {
                    _lichiiStepDetailLabel.Text = "Restart " + snap.RunningEmulator + " so its debug server starts on the configured port.";
                }
                else
                {
                    _lichiiStepDetailLabel.Text = "Click 1-Click Setup Sync, then restart " + snap.RunningEmulator + " to enable live tracking.";
                }
                _lichiiStepDetailLabel.ForeColor = Theme.Parchment200;
            }
            else
            {
                _heroLichiiDot.DotColor = Theme.Parchment600;
                _heroLichiiLabel.Text = "Emulator: Not detected";
                _heroLichiiLabel.ForeColor = Theme.Parchment400;

                if (snap.ServerHttpOk && string.Equals(snap.Source, "save", StringComparison.OrdinalIgnoreCase) && snap.SkulltulaCount.HasValue)
                {
                    _lichiiStepDetailLabel.Text = string.Format(
                        CultureInfo.InvariantCulture,
                        "Save data found ({0}/100 Gold Skulltulas). Open Lichii or Fritchii for live player tracking.",
                        snap.SkulltulaCount.Value);
                    _lichiiStepDetailLabel.ForeColor = Theme.Parchment400;
                }
                else if (_configuredPill.Visible)
                {
                    _lichiiStepDetailLabel.Text = "Allows Ocarina Atlas to follow Link and mark Gold Skulltulas automatically.";
                    _lichiiStepDetailLabel.ForeColor = Theme.Parchment400;
                }
                else
                {
                    _lichiiStepDetailLabel.Text = "Click 1-Click Setup Sync so the map can follow Link automatically.";
                    _lichiiStepDetailLabel.ForeColor = Theme.Parchment200;
                }
            }
        }

        private static string FormatCompactFloor(string mapId)
        {
            if (string.Equals(mapId, "nino", StringComparison.OrdinalIgnoreCase)) return "Child";
            if (string.Equals(mapId, "adulto", StringComparison.OrdinalIgnoreCase)) return "Adult";
            if (string.Equals(mapId, "principal", StringComparison.OrdinalIgnoreCase)) return "Main";
            if (mapId.StartsWith("S", StringComparison.OrdinalIgnoreCase) && mapId.Length == 2)
            {
                return "B" + mapId.Substring(1);
            }
            return mapId;
        }

        private static bool ProbeTcpPort(string host, int port, int timeoutMs)
        {
            if (string.IsNullOrEmpty(host) || port < 1 || port > 65535) return false;
            try
            {
                using (TcpClient client = new TcpClient())
                {
                    IAsyncResult ar = client.BeginConnect(host, port, null, null);
                    using (WaitHandle wh = ar.AsyncWaitHandle)
                    {
                        if (!wh.WaitOne(timeoutMs, false))
                        {
                            return false;
                        }
                        client.EndConnect(ar);
                        return true;
                    }
                }
            }
            catch
            {
                return false;
            }
        }

        private static bool IsLocalTcpPortInUse(int port)
        {
            return ProbeTcpPort("127.0.0.1", port, 180);
        }

        private void AppendLog(string message)
        {
            if (_logTextBox == null || _logTextBox.IsDisposed) return;
            string line = string.Format(
                CultureInfo.InvariantCulture,
                "[{0:HH:mm:ss}] {1}",
                DateTime.Now,
                message);
            if (_logTextBox.TextLength > 32000)
            {
                _logTextBox.Clear();
            }
            _logTextBox.AppendText(line + Environment.NewLine);
        }

        internal void PrepareForSelfUpdate()
        {
            if (_pollTimer != null)
            {
                _pollTimer.Stop();
                _pollTimer.Dispose();
            }

            Process proc;
            lock (_procLock)
            {
                proc = _serverProcess;
                _serverProcess = null;
            }

            if (proc != null)
            {
                _lifecycle = ServerLifecycle.Stopping;
                TerminateProcessTree(proc);
                try { proc.Dispose(); } catch { }
            }

            if (_jobObject != null)
            {
                _jobObject.Dispose();
                _jobObject = null;
            }

            if (_trayIcon != null)
            {
                _trayIcon.Visible = false;
                _trayIcon.Dispose();
                _trayIcon = null;
            }
        }

        private void StartUpdateCheck()
        {
            string feedUrl = UpdateManager.ResolveFeedUrl(_options.UpdateFeedUrl);
            Thread t = new Thread(delegate()
            {
                try
                {
                    ServicePointManager.SecurityProtocol |= SecurityProtocolType.Tls12;
                    HttpWebRequest req = (HttpWebRequest)WebRequest.Create(feedUrl);
                    req.Method = "GET";
                    req.Timeout = 4000;
                    req.ReadWriteTimeout = 4000;
                    req.UserAgent = "OcarinaAtlas/" + AppVersion;
                    req.Accept = "application/vnd.github+json";

                    string body;
                    using (HttpWebResponse resp = (HttpWebResponse)req.GetResponse())
                    {
                        if (resp.StatusCode != HttpStatusCode.OK) return;
                        using (Stream stream = resp.GetResponseStream())
                        {
                            if (stream == null) return;
                            using (StreamReader reader = new StreamReader(stream, Encoding.UTF8))
                            {
                                body = reader.ReadToEnd();
                            }
                        }
                    }

                    UpdateInfo info = UpdateManager.ParseReleaseJson(body, AppVersion);
                    if (info == null)
                    {
                        return;
                    }

                    string skippedVersion = UpdateManager.ReadSkippedVersion();
                    bool shouldAutoOpen = !string.Equals(info.DisplayTag, skippedVersion, StringComparison.OrdinalIgnoreCase);

                    BeginInvokeSafe(delegate()
                    {
                        if (_updateLinkLabel == null || _updateLinkLabel.IsDisposed || _heroStatusPill == null) return;
                        _pendingUpdateInfo = info;
                        _updateLinkLabel.Text = "Update available: " + info.DisplayTag;
                        _updateLinkLabel.Visible = true;
                        _updateLinkLabel.Left = Math.Max(_versionLabel.Right + 10, _heroStatusPill.Left - _updateLinkLabel.Width - 10);

                        if (shouldAutoOpen)
                        {
                            ShowUpdateDialog();
                        }
                    });
                }
                catch
                {
                    // Fail silently when offline, firewalled, or rate-limited.
                }
            });
            t.IsBackground = true;
            t.Start();
        }

        private void ShowUpdateDialog()
        {
            if (_pendingUpdateInfo == null || IsDisposed) return;

            if (_activeUpdateDialog != null && !_activeUpdateDialog.IsDisposed)
            {
                if (_activeUpdateDialog.WindowState == FormWindowState.Minimized)
                {
                    _activeUpdateDialog.WindowState = FormWindowState.Normal;
                }
                _activeUpdateDialog.Activate();
                return;
            }

            using (UpdateDialog dlg = new UpdateDialog(this, _pendingUpdateInfo, _appIcon))
            {
                _activeUpdateDialog = dlg;
                dlg.ShowDialog(this);
                _activeUpdateDialog = null;
            }
        }

        private void OnUpdateLinkClicked(object sender, LinkLabelLinkClickedEventArgs e)
        {
            if (_pendingUpdateInfo != null)
            {
                ShowUpdateDialog();
            }
        }

        private void BeginInvokeSafe(MethodInvoker action)
        {
            if (IsDisposed || !IsHandleCreated) return;
            try
            {
                BeginInvoke(action);
            }
            catch
            {
                // Form disposed during shutdown.
            }
        }

        private static string StripAnsi(string input)
        {
            return Regex.Replace(input, @"\x1B\[[0-9;]*[A-Za-z]", string.Empty);
        }

        private static Icon LoadAppIcon()
        {
            try
            {
                string exePath = Application.ExecutablePath;
                if (!string.IsNullOrEmpty(exePath))
                {
                    Icon extracted = Icon.ExtractAssociatedIcon(exePath);
                    if (extracted != null)
                    {
                        return extracted;
                    }
                }
            }
            catch
            {
                // Fall back to the default system application icon if extraction fails.
            }

            return (Icon)SystemIcons.Application.Clone();
        }
    }
}
