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

[assembly: AssemblyTitle("Ocarina Atlas")]
[assembly: AssemblyDescription("Interactive live companion atlas for OoT Remake")]
[assembly: AssemblyCompany("antonioalvromero")]
[assembly: AssemblyProduct("Ocarina Atlas")]
[assembly: AssemblyCopyright("Copyright (c) 2026 antonioalvromero")]
[assembly: AssemblyVersion("2.3.1.0")]
[assembly: AssemblyFileVersion("2.3.1.0")]

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
        public string RejectedUpdateFeedUrl = null;

        private static void SetValidatedUpdateFeed(LaunchOptions opts, string rawUrl)
        {
            string trimmed = (rawUrl ?? string.Empty).Trim();
            if (string.IsNullOrEmpty(trimmed)) return;
            if (UpdateManager.IsAllowedUpdateFeedUrl(trimmed))
            {
                opts.UpdateFeedUrl = trimmed;
                opts.RejectedUpdateFeedUrl = null;
            }
            else
            {
                opts.UpdateFeedUrl = null;
                opts.RejectedUpdateFeedUrl = trimmed;
            }
        }

        public static LaunchOptions Parse(string[] args)
        {
            LaunchOptions opts = new LaunchOptions();
            string envUpdateFeed = Environment.GetEnvironmentVariable("OCARINA_ATLAS_UPDATE_URL");
            if (!string.IsNullOrEmpty(envUpdateFeed))
            {
                SetValidatedUpdateFeed(opts, envUpdateFeed);
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
                        SetValidatedUpdateFeed(opts, raw);
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
        [DllImport("dwmapi.dll", PreserveSig = true)]
        private static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int attrValue, int attrSize);

        private const int DwmwaUseImmersiveDarkMode = 20;
        private const int DwmwaUseImmersiveDarkModeBefore20H1 = 19;

        public static readonly Color Ink950 = Color.FromArgb(0x13, 0x10, 0x0C);
        public static readonly Color Ink900 = Color.FromArgb(0x1B, 0x17, 0x12);
        public static readonly Color Ink800 = Color.FromArgb(0x25, 0x20, 0x19);
        public static readonly Color Ink700 = Color.FromArgb(0x36, 0x2E, 0x24);
        public static readonly Color Ink600 = Color.FromArgb(0x4C, 0x42, 0x33);

        public static readonly Color Parchment50 = Color.FromArgb(0xF8, 0xF1, 0xE0);
        public static readonly Color Parchment200 = Color.FromArgb(0xE6, 0xD8, 0xB8);
        public static readonly Color Parchment300 = Color.FromArgb(0xD5, 0xC3, 0x9C);
        public static readonly Color Parchment400 = Color.FromArgb(0xC4, 0xAD, 0x7F);
        public static readonly Color Parchment600 = Color.FromArgb(0x93, 0x80, 0x5C);

        public static readonly Color Ember = Color.FromArgb(0xD9, 0x73, 0x4A);
        public static readonly Color Moss = Color.FromArgb(0x86, 0xB6, 0x7E);
        public static readonly Color Gold = Color.FromArgb(0xE0, 0xB3, 0x54);

        public static void EnableDarkTitleBar(Form form)
        {
            if (form == null || form.IsDisposed) return;

            MethodInvoker apply = delegate
            {
                if (form.IsDisposed || !form.IsHandleCreated) return;
                try
                {
                    int useImmersiveDarkMode = 1;
                    int hr = DwmSetWindowAttribute(form.Handle, DwmwaUseImmersiveDarkMode, ref useImmersiveDarkMode, sizeof(int));
                    if (hr != 0)
                    {
                        DwmSetWindowAttribute(form.Handle, DwmwaUseImmersiveDarkModeBefore20H1, ref useImmersiveDarkMode, sizeof(int));
                    }
                }
                catch
                {
                    // Ignore on Windows versions that do not support DwmSetWindowAttribute dark mode.
                }
            };

            if (form.IsHandleCreated)
            {
                apply();
            }
            else
            {
                form.HandleCreated += delegate { apply(); };
            }
        }

        public static float GetDpiScale(Control control = null)
        {
            try
            {
                using (Graphics g = control != null ? control.CreateGraphics() : Graphics.FromHwnd(IntPtr.Zero))
                {
                    if (g != null && g.DpiX > 0f)
                    {
                        return g.DpiX / 96f;
                    }
                }
            }
            catch
            {
                // Fallback to 1.0x (96 DPI).
            }
            return 1f;
        }

        public static int ScaleDpi(int value, float dpiScale)
        {
            return (int)Math.Round(value * dpiScale, MidpointRounding.AwayFromZero);
        }
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
        private static readonly string[] ProfileDirNames = new[] { "fritchii", "lichii", "cheezyemu" };

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
            string[] names = new[] { "fritchii", "lichii", "eden", "cheezyemu", "hookshot", "Longshot", "relink-game", "relink", "Triforce", "HeyListen" };
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

            if (string.Equals(fallbackName, "cheezyemu", StringComparison.OrdinalIgnoreCase))
            {
                return "CheezyEmu";
            }

            if (string.Equals(fallbackName, "hookshot", StringComparison.OrdinalIgnoreCase) ||
                string.Equals(fallbackName, "Longshot", StringComparison.OrdinalIgnoreCase))
            {
                return "Longshot";
            }

            if (string.Equals(fallbackName, "relink-game", StringComparison.OrdinalIgnoreCase) ||
                string.Equals(fallbackName, "relink", StringComparison.OrdinalIgnoreCase))
            {
                return "Project ReLink";
            }

            if (string.Equals(fallbackName, "Triforce", StringComparison.OrdinalIgnoreCase))
            {
                return "Triforce";
            }

            if (string.Equals(fallbackName, "HeyListen", StringComparison.OrdinalIgnoreCase))
            {
                return "HeyListen";
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

        private static readonly string[] ProcessNames = new[] { "hookshot", "Longshot", "relink-game", "relink", "Triforce", "HeyListen" };
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

        public static LongshotRpcBridge TryFindLongshotProcess()
        {
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

                        handle = OpenProcess(ProcessReadAccess, false, proc.Id);
                        if (handle == IntPtr.Zero)
                        {
                            continue;
                        }

                        if (!VerifyGuestCodeMapped(handle))
                        {
                            continue;
                        }

                        string userSaveDir = ResolveUserSaveDir(proc);
                        string emulatorKind = ProcessNames[n].StartsWith("relink", StringComparison.OrdinalIgnoreCase)
                            ? "relink"
                            : string.Equals(ProcessNames[n], "Triforce", StringComparison.OrdinalIgnoreCase)
                                ? "triforce"
                                : string.Equals(ProcessNames[n], "HeyListen", StringComparison.OrdinalIgnoreCase)
                                    ? "heylisten"
                                    : "longshot";
                        keepProc = true;
                        for (int k = i + 1; k < procs.Length; k++)
                        {
                            if (procs[k] != null)
                            {
                                try { procs[k].Dispose(); } catch { }
                            }
                        }
                        return new LongshotRpcBridge(proc, proc.Id, handle, userSaveDir, emulatorKind);
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

            return null;
        }

        public static string DetectRunningUserSaveDir()
        {
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

                if (procs == null) continue;

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

            return null;
        }

        private static string ResolveUserSaveDir(Process proc)
        {
            if (proc == null) return null;
            try
            {
                ProcessModule mod = proc.MainModule;
                string exePath = mod != null ? mod.FileName : null;
                if (string.IsNullOrEmpty(exePath)) return null;

                string exeDir = Path.GetDirectoryName(exePath);
                if (string.IsNullOrEmpty(exeDir)) return null;
                exeDir = exeDir.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);

                string leaf = Path.GetFileName(exeDir);
                string gameRoot = string.Equals(leaf, "bin", StringComparison.OrdinalIgnoreCase)
                    ? Path.GetDirectoryName(exeDir)
                    : exeDir;
                if (string.IsNullOrEmpty(gameRoot)) return null;

                return Path.Combine(gameRoot, "user");
            }
            catch
            {
                return null;
            }
        }

        private static bool VerifyGuestCodeMapped(IntPtr handle)
        {
            ulong hostCodeAddr = GuestWindowBase + GuestCodeBase;
            MEMORY_BASIC_INFORMATION mbi;
            int mbiSize = Marshal.SizeOf(typeof(MEMORY_BASIC_INFORMATION));
            UIntPtr queried = VirtualQueryEx(handle, new UIntPtr(hostCodeAddr), out mbi, new UIntPtr((uint)mbiSize));
            if (queried == UIntPtr.Zero)
            {
                return false;
            }
            if (mbi.State != MemCommit || !IsReadableProtect(mbi.Protect))
            {
                return false;
            }

            byte[] probe = new byte[8];
            UIntPtr bytesRead;
            if (!ReadProcessMemory(handle, new UIntPtr(hostCodeAddr), probe, new UIntPtr((uint)probe.Length), out bytesRead))
            {
                return false;
            }
            return bytesRead.ToUInt64() == (ulong)probe.Length;
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

            if (guestAddr >= GuestWindowSize || (ulong)size > GuestWindowSize - guestAddr)
            {
                return BuildErrorResponse(idJson, -32602, "Address out of guest window");
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
            ulong guestStart = isHeapRegion ? StandardHeapThreshold : 0UL;
            if (hasStart && !TryParseGuestAddress(rawStart, out guestStart))
            {
                return BuildErrorResponse(idJson, -32602, "Invalid start address");
            }

            object rawEnd;
            bool hasEnd = paramsDict.TryGetValue("end", out rawEnd) && rawEnd != null;
            ulong guestEnd = GuestWindowSize;
            if (hasEnd && !TryParseGuestAddress(rawEnd, out guestEnd))
            {
                return BuildErrorResponse(idJson, -32602, "Invalid end address");
            }

            if (guestStart > GuestWindowSize) guestStart = GuestWindowSize;
            if (guestEnd > GuestWindowSize) guestEnd = GuestWindowSize;

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
            if (guestAddr >= GuestWindowSize || (ulong)size > GuestWindowSize - guestAddr) return false;

            ulong hostAddr = GuestWindowBase + guestAddr;
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

            lock (_handleLock)
            {
                if (_disposed != 0 || !_running || _processHandle == IntPtr.Zero)
                {
                    return hits;
                }

                if (guestEnd > guestStart)
                {
                    SearchHostRange(
                        GuestWindowBase + guestStart,
                        GuestWindowBase + guestEnd,
                        patternBytes,
                        patternMask,
                        anchorIdx,
                        hasAnchor,
                        maxHits,
                        hits,
                        sw,
                        budgetMs,
                        scanBuffer);
                }

                if (hits.Count == 0 && (isHeapRegion || guestStart >= StandardHeapThreshold))
                {
                    bool alreadyCovered = guestStart <= LongshotHeapBase && guestEnd >= LongshotHeapEnd;
                    if (!alreadyCovered)
                    {
                        SearchHostRange(
                            GuestWindowBase + LongshotHeapBase,
                            GuestWindowBase + LongshotHeapEnd,
                            patternBytes,
                            patternMask,
                            anchorIdx,
                            hasAnchor,
                            maxHits,
                            hits,
                            sw,
                            budgetMs,
                            scanBuffer);
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
            byte[] scanBuffer)
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
                            scanBuffer);
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
            byte[] scanBuffer)
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
                MatchBuffer(scanBuffer, bufLen, cursor, patternBytes, patternMask, anchorIdx, hasAnchor, maxHits, hits);

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
            List<string> hits)
        {
            int m = patternBytes.Length;
            if (bufLen < m) return;
            int maxStart = bufLen - m;

            if (!hasAnchor)
            {
                for (int i = 0; i <= maxStart && hits.Count < maxHits; i++)
                {
                    ulong guestAddr = (baseHostAddr + (ulong)i) - GuestWindowBase;
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
                    ulong guestAddr = (baseHostAddr + (ulong)start) - GuestWindowBase;
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
        public Color BorderColor = Theme.Ink700;
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
            int scaledRadius = Theme.ScaleDpi(CornerRadius, e.Graphics.DpiX > 0f ? e.Graphics.DpiX / 96f : 1f);
            using (GraphicsPath path = CreateRoundedRectPath(rect, scaledRadius))
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
        public string Sha256DownloadUrl = string.Empty;
        public string ExpectedSha256 = string.Empty;
        public bool RequireSha256 = false;
        public Version ParsedVersion;
    }

    internal static class UpdateManager
    {
        public const string OfficialRepoUrl = "https://github.com/antonioalvromero/Ocarina-Atlas";
        public const string OriginalRepoUrl = "https://github.com/lucasriondel/oot-remake-map";
        public const string DefaultReleaseApiUrl = "https://api.github.com/repos/antonioalvromero/Ocarina-Atlas/releases/latest";
        public const string DefaultReleaseFallbackUrl = OfficialRepoUrl + "/releases/latest";

        private const string OfficialGithubPathPrefix = "/antonioalvromero/Ocarina-Atlas";
        private const string OfficialApiPathPrefix = "/repos/antonioalvromero/Ocarina-Atlas";
        private static readonly Regex Sha256TokenRegex = new Regex(@"\b([0-9a-fA-F]{64})\b", RegexOptions.Compiled);

        public static string ResolveFeedUrl(string overrideUrl)
        {
            if (!string.IsNullOrEmpty(overrideUrl) && IsAllowedUpdateFeedUrl(overrideUrl))
            {
                return overrideUrl.Trim();
            }
            return DefaultReleaseApiUrl;
        }

        public static bool IsLoopbackUrl(string rawUrl)
        {
            if (string.IsNullOrEmpty(rawUrl)) return false;
            Uri uri;
            if (!Uri.TryCreate(rawUrl.Trim(), UriKind.Absolute, out uri)) return false;
            return IsLoopbackUri(uri);
        }

        private static bool IsLoopbackUri(Uri uri)
        {
            if (uri == null) return false;
            if (!string.Equals(uri.Scheme, Uri.UriSchemeHttp, StringComparison.OrdinalIgnoreCase) &&
                !string.Equals(uri.Scheme, Uri.UriSchemeHttps, StringComparison.OrdinalIgnoreCase))
            {
                return false;
            }
            string host = uri.Host ?? string.Empty;
            return string.Equals(host, "127.0.0.1", StringComparison.OrdinalIgnoreCase) ||
                   string.Equals(host, "localhost", StringComparison.OrdinalIgnoreCase);
        }

        private static bool HasExactPathOrPrefix(string absolutePath, string prefix)
        {
            if (string.IsNullOrEmpty(absolutePath) || string.IsNullOrEmpty(prefix)) return false;
            if (absolutePath.IndexOf("..", StringComparison.Ordinal) >= 0) return false;
            return string.Equals(absolutePath, prefix, StringComparison.OrdinalIgnoreCase) ||
                   absolutePath.StartsWith(prefix + "/", StringComparison.OrdinalIgnoreCase);
        }

        private static bool IsOfficialRepoUri(Uri uri)
        {
            if (uri == null || !string.Equals(uri.Scheme, Uri.UriSchemeHttps, StringComparison.OrdinalIgnoreCase))
            {
                return false;
            }
            if (!string.IsNullOrEmpty(uri.UserInfo)) return false;

            string host = uri.Host ?? string.Empty;
            string path = uri.AbsolutePath ?? string.Empty;

            if (string.Equals(host, "github.com", StringComparison.OrdinalIgnoreCase))
            {
                return HasExactPathOrPrefix(path, OfficialGithubPathPrefix);
            }
            if (string.Equals(host, "api.github.com", StringComparison.OrdinalIgnoreCase))
            {
                return HasExactPathOrPrefix(path, OfficialApiPathPrefix);
            }
            return false;
        }

        private static bool IsAllowedGitHubUri(Uri uri)
        {
            if (uri == null || !string.Equals(uri.Scheme, Uri.UriSchemeHttps, StringComparison.OrdinalIgnoreCase))
            {
                return false;
            }
            if (!string.IsNullOrEmpty(uri.UserInfo)) return false;

            string host = uri.Host ?? string.Empty;
            return string.Equals(host, "github.com", StringComparison.OrdinalIgnoreCase) ||
                   host.EndsWith(".github.com", StringComparison.OrdinalIgnoreCase) ||
                   host.EndsWith(".githubusercontent.com", StringComparison.OrdinalIgnoreCase);
        }

        public static bool IsAllowedUpdateFeedUrl(string rawUrl)
        {
            if (string.IsNullOrEmpty(rawUrl)) return false;
            Uri uri;
            if (!Uri.TryCreate(rawUrl.Trim(), UriKind.Absolute, out uri)) return false;
            return IsLoopbackUri(uri) || IsAllowedGitHubUri(uri);
        }

        public static bool IsAllowedUpdateUrl(string rawUrl)
        {
            if (string.IsNullOrEmpty(rawUrl)) return false;
            Uri uri;
            if (!Uri.TryCreate(rawUrl.Trim(), UriKind.Absolute, out uri)) return false;
            return IsLoopbackUri(uri) || IsAllowedGitHubUri(uri);
        }

        public static string ParseSha256DigestText(string content)
        {
            if (string.IsNullOrEmpty(content)) return string.Empty;
            string[] lines = content.Replace("\r\n", "\n").Replace('\r', '\n').Split('\n');
            for (int i = 0; i < lines.Length; i++)
            {
                string trimmed = lines[i].Trim();
                if (trimmed.Length == 0) continue;
                Match match = Sha256TokenRegex.Match(trimmed);
                if (match.Success)
                {
                    return match.Groups[1].Value.ToLowerInvariant();
                }
            }
            return string.Empty;
        }

        public static string TryExtractSha256FromReleaseBody(string rawBody)
        {
            if (string.IsNullOrEmpty(rawBody)) return string.Empty;
            string[] lines = rawBody.Replace("\r\n", "\n").Replace('\r', '\n').Split('\n');
            int shaSectionWindow = 0;
            for (int i = 0; i < lines.Length; i++)
            {
                string line = lines[i];
                bool mentionsChecksum =
                    line.IndexOf("SHA-256", StringComparison.OrdinalIgnoreCase) >= 0 ||
                    line.IndexOf("SHA256", StringComparison.OrdinalIgnoreCase) >= 0 ||
                    line.IndexOf("OcarinaAtlas-Windows-x64.zip", StringComparison.OrdinalIgnoreCase) >= 0 ||
                    line.IndexOf("amd64", StringComparison.OrdinalIgnoreCase) >= 0;

                if (mentionsChecksum)
                {
                    shaSectionWindow = 5;
                }

                if (mentionsChecksum || shaSectionWindow > 0)
                {
                    Match match = Sha256TokenRegex.Match(line);
                    if (match.Success)
                    {
                        return match.Groups[1].Value.ToLowerInvariant();
                    }
                    if (shaSectionWindow > 0)
                    {
                        shaSectionWindow--;
                    }
                }
            }
            return string.Empty;
        }

        public static string ComputeFileSha256(string filePath)
        {
            using (SHA256 sha = SHA256.Create())
            using (FileStream fs = File.OpenRead(filePath))
            {
                byte[] hash = sha.ComputeHash(fs);
                StringBuilder sb = new StringBuilder(hash.Length * 2);
                for (int i = 0; i < hash.Length; i++)
                {
                    sb.Append(hash[i].ToString("x2", CultureInfo.InvariantCulture));
                }
                return sb.ToString();
            }
        }

        public static string FetchExpectedSha256(string sha256Url, string userAgent)
        {
            if (!IsAllowedUpdateUrl(sha256Url))
            {
                throw new InvalidOperationException("Blocked untrusted SHA-256 checksum URL.");
            }
            ServicePointManager.SecurityProtocol |= SecurityProtocolType.Tls12;
            HttpWebRequest req = (HttpWebRequest)WebRequest.Create(sha256Url);
            req.Method = "GET";
            req.Timeout = 10000;
            req.ReadWriteTimeout = 10000;
            req.UserAgent = userAgent;

            using (HttpWebResponse resp = (HttpWebResponse)req.GetResponse())
            {
                if (resp.StatusCode != HttpStatusCode.OK)
                {
                    throw new InvalidOperationException("Checksum download failed with HTTP " + (int)resp.StatusCode);
                }
                if (resp.ResponseUri == null || !IsAllowedUpdateUrl(resp.ResponseUri.AbsoluteUri))
                {
                    throw new InvalidOperationException("Checksum redirect pointed to an untrusted host.");
                }
                using (Stream stream = resp.GetResponseStream())
                {
                    if (stream == null)
                    {
                        throw new InvalidOperationException("Empty checksum response stream.");
                    }
                    using (StreamReader reader = new StreamReader(stream, Encoding.UTF8))
                    {
                        string body = reader.ReadToEnd();
                        string parsed = ParseSha256DigestText(body);
                        if (string.IsNullOrEmpty(parsed))
                        {
                            throw new InvalidOperationException("Invalid SHA-256 checksum format in release asset.");
                        }
                        return parsed;
                    }
                }
            }
        }

        public static void VerifyDownloadedArchiveSha256(UpdateInfo info, string zipPath, string userAgent)
        {
            if (info == null)
            {
                throw new InvalidOperationException("Missing update metadata.");
            }
            if (string.IsNullOrEmpty(zipPath) || !File.Exists(zipPath))
            {
                throw new FileNotFoundException("Downloaded update archive not found.", zipPath);
            }

            string assetSha256 = string.Empty;
            if (!string.IsNullOrEmpty(info.Sha256DownloadUrl))
            {
                assetSha256 = FetchExpectedSha256(info.Sha256DownloadUrl, userAgent);
            }

            string notesSha256 = info.ExpectedSha256 ?? string.Empty;
            if (!string.IsNullOrEmpty(assetSha256) &&
                !string.IsNullOrEmpty(notesSha256) &&
                !string.Equals(assetSha256, notesSha256, StringComparison.OrdinalIgnoreCase))
            {
                throw new InvalidOperationException(
                    "SHA-256 mismatch between release checksum file and release notes. Download official releases from " + OfficialRepoUrl);
            }

            string expectedSha256 = !string.IsNullOrEmpty(assetSha256) ? assetSha256 : notesSha256;
            if (string.IsNullOrEmpty(expectedSha256))
            {
                if (info.RequireSha256)
                {
                    throw new InvalidOperationException(
                        "Missing official SHA-256 checksum. Download official releases from " + OfficialRepoUrl);
                }
                AppendUpdateLog("Update source provided no SHA-256 digest; skipping checksum verification.");
                return;
            }

            string actualSha256 = ComputeFileSha256(zipPath);
            if (!string.Equals(actualSha256, expectedSha256, StringComparison.OrdinalIgnoreCase))
            {
                AppendUpdateLog("SHA-256 verification failed! Expected=" + expectedSha256 + " Actual=" + actualSha256);
                throw new InvalidOperationException(
                    "SHA-256 verification failed! Update aborted. Download official releases from " + OfficialRepoUrl);
            }

            AppendUpdateLog("SHA-256 verified: " + actualSha256);
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
            return ParseReleaseJson(json, currentAppVersion, null);
        }

        public static UpdateInfo ParseReleaseJson(string json, string currentAppVersion, string feedUrl)
        {
            Dictionary<string, object> obj = SimpleJsonParser.ParseObject(json);
            if (obj == null) return null;

            if (SimpleJsonParser.GetBool(obj, "prerelease") || SimpleJsonParser.GetBool(obj, "draft"))
            {
                return null;
            }

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
            string zipAssetName = string.Empty;
            string fallbackZipUrl = string.Empty;
            string fallbackZipAssetName = string.Empty;
            Dictionary<string, string> sha256Assets = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);

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

                    string trimmedUrl = downloadUrl.Trim();
                    if (string.Equals(assetName, "OcarinaAtlas-Windows-x64.zip", StringComparison.OrdinalIgnoreCase))
                    {
                        zipUrl = trimmedUrl;
                        zipAssetName = assetName.Trim();
                    }
                    else if (string.IsNullOrEmpty(fallbackZipUrl) &&
                             assetName.EndsWith(".zip", StringComparison.OrdinalIgnoreCase))
                    {
                        fallbackZipUrl = trimmedUrl;
                        fallbackZipAssetName = assetName.Trim();
                    }
                    else if (assetName.EndsWith(".sha256", StringComparison.OrdinalIgnoreCase))
                    {
                        sha256Assets[assetName.Trim()] = trimmedUrl;
                    }
                }
            }

            if (string.IsNullOrEmpty(zipUrl))
            {
                zipUrl = fallbackZipUrl;
                zipAssetName = fallbackZipAssetName;
            }

            string sha256DownloadUrl = string.Empty;
            if (!string.IsNullOrEmpty(zipAssetName))
            {
                string directMatch;
                if (sha256Assets.TryGetValue(zipAssetName + ".sha256", out directMatch))
                {
                    sha256DownloadUrl = directMatch;
                }
            }
            if (string.IsNullOrEmpty(sha256DownloadUrl))
            {
                string preferredSha256;
                if (sha256Assets.TryGetValue("OcarinaAtlas-Windows-x64.zip.sha256", out preferredSha256))
                {
                    sha256DownloadUrl = preferredSha256;
                }
            }

            string expectedSha256 = TryExtractSha256FromReleaseBody(rawBody);
            Uri feedUri;
            bool isOfficialFeed = string.IsNullOrEmpty(feedUrl) ||
                (Uri.TryCreate(feedUrl.Trim(), UriKind.Absolute, out feedUri) && IsOfficialRepoUri(feedUri));
            Uri zipUri;
            bool isOfficialZip = !string.IsNullOrEmpty(zipUrl) &&
                Uri.TryCreate(zipUrl, UriKind.Absolute, out zipUri) &&
                IsOfficialRepoUri(zipUri);

            UpdateInfo info = new UpdateInfo();
            info.DisplayTag = displayTag;
            info.ReleaseName = releaseName;
            info.ReleaseNotes = cleanNotes;
            info.HtmlUrl = targetHtmlUrl;
            info.ZipDownloadUrl = zipUrl;
            info.Sha256DownloadUrl = sha256DownloadUrl;
            info.ExpectedSha256 = expectedSha256;
            info.RequireSha256 = isOfficialFeed && isOfficialZip;
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
        private readonly RichTextBox _notesBox;
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

            SuspendLayout();

            Text = "Update Available \u2014 Ocarina Atlas";
            BackColor = Theme.Ink950;
            ForeColor = Theme.Parchment200;
            AutoScaleDimensions = new SizeF(96F, 96F);
            AutoScaleMode = AutoScaleMode.Dpi;
            Font = new Font("Segoe UI", 9f, FontStyle.Regular);
            FormBorderStyle = FormBorderStyle.FixedDialog;
            StartPosition = FormStartPosition.CenterParent;
            MaximizeBox = false;
            MinimizeBox = false;
            ShowInTaskbar = false;
            ClientSize = new Size(520, 412);
            if (appIcon != null) Icon = appIcon;
            Theme.EnableDarkTitleBar(this);

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

            BorderedPanel notesContainer = new BorderedPanel();
            notesContainer.Location = new Point(20, 94);
            notesContainer.Size = new Size(480, 212);
            notesContainer.FillColor = Theme.Ink900;
            notesContainer.BorderColor = Theme.Ink700;
            notesContainer.CornerRadius = 8;
            notesContainer.Padding = new Padding(8, 6, 8, 6);
            Controls.Add(notesContainer);

            _notesBox = new RichTextBox();
            _notesBox.ReadOnly = true;
            _notesBox.ScrollBars = RichTextBoxScrollBars.Vertical;
            _notesBox.WordWrap = true;
            _notesBox.DetectUrls = true;
            _notesBox.BorderStyle = BorderStyle.None;
            _notesBox.Dock = DockStyle.Fill;
            _notesBox.BackColor = Theme.Ink900;
            _notesBox.ForeColor = Theme.Parchment200;
            _notesBox.Font = new Font("Segoe UI", 9f, FontStyle.Regular);
            _notesBox.LinkClicked += OnNotesLinkClicked;
            RenderMarkdownToRichTextBox(_notesBox, info.ReleaseNotes);
            notesContainer.Controls.Add(_notesBox);

            _statusLabel = new Label();
            _statusLabel.Text = string.Empty;
            _statusLabel.Font = new Font("Segoe UI", 8.5f, FontStyle.Regular);
            _statusLabel.ForeColor = Theme.Parchment400;
            _statusLabel.AutoSize = false;
            _statusLabel.Location = new Point(20, 314);
            _statusLabel.Size = new Size(480, 20);
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
            _skipButton.ForeColor = Theme.Gold;
            _skipButton.FlatAppearance.BorderColor = Theme.Gold;
            _skipButton.Click += OnSkipVersionClick;
            Controls.Add(_skipButton);

            _closeButton = CreateDialogButton("Close", 412, 364, 88, 32, false);
            _closeButton.DialogResult = DialogResult.Cancel;
            Controls.Add(_closeButton);
            CancelButton = _closeButton;

            ResumeLayout(false);
            PerformLayout();

            Shown += delegate
            {
                _notesBox.Select(0, 0);
                _notesBox.ScrollToCaret();
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
            btn.FlatAppearance.BorderColor = Theme.Ink700;
            btn.FlatAppearance.MouseOverBackColor = Theme.Ink700;
            btn.BackColor = Theme.Ink800;
            btn.ForeColor = Theme.Parchment200;
            btn.Font = new Font("Segoe UI", 9f, bold ? FontStyle.Bold : FontStyle.Regular);
            btn.Cursor = Cursors.Hand;
            btn.UseVisualStyleBackColor = false;
            return btn;
        }

        private void OnNotesLinkClicked(object sender, LinkClickedEventArgs e)
        {
            if (e == null || string.IsNullOrEmpty(e.LinkText)) return;
            Uri uri;
            if (!Uri.TryCreate(e.LinkText, UriKind.Absolute, out uri)) return;
            if (!string.Equals(uri.Scheme, Uri.UriSchemeHttp, StringComparison.OrdinalIgnoreCase) &&
                !string.Equals(uri.Scheme, Uri.UriSchemeHttps, StringComparison.OrdinalIgnoreCase))
            {
                return;
            }

            try
            {
                ProcessStartInfo psi = new ProcessStartInfo(uri.AbsoluteUri);
                psi.UseShellExecute = true;
                Process.Start(psi);
            }
            catch
            {
                // Non-fatal if no browser handler is registered.
            }
        }

        private static void RenderMarkdownToRichTextBox(RichTextBox box, string markdown)
        {
            if (box == null) return;
            box.Clear();
            if (string.IsNullOrEmpty(markdown)) return;

            string normalized = markdown.Replace("\r\n", "\n").Replace('\r', '\n');
            string[] lines = normalized.Split('\n');

            Dictionary<string, Font> fonts = new Dictionary<string, Font>(StringComparer.Ordinal);
            try
            {
                Font bodyFont = GetCachedFont(fonts, "Segoe UI", 9f, FontStyle.Regular);
                Font bodyBoldFont = GetCachedFont(fonts, "Segoe UI", 9f, FontStyle.Bold);
                Font codeFont = GetCachedFont(fonts, "Consolas", 8.75f, FontStyle.Regular);

                bool inCodeBlock = false;
                bool hasOutput = false;

                for (int lineIndex = 0; lineIndex < lines.Length; lineIndex++)
                {
                    string line = lines[lineIndex];
                    string trimmed = line.Trim();

                    if (trimmed.StartsWith("```", StringComparison.Ordinal))
                    {
                        inCodeBlock = !inCodeBlock;
                        continue;
                    }

                    if (hasOutput)
                    {
                        AppendStyledText(box, "\n", bodyFont, Theme.Parchment200);
                    }

                    if (inCodeBlock)
                    {
                        SetParagraphIndent(box, 12, 0);
                        AppendStyledText(box, line, codeFont, Theme.Parchment300);
                        hasOutput = true;
                        continue;
                    }

                    if (trimmed.Length == 0)
                    {
                        SetParagraphIndent(box, 0, 0);
                        hasOutput = true;
                        continue;
                    }

                    if (IsHorizontalRule(trimmed))
                    {
                        SetParagraphIndent(box, 0, 0);
                        AppendStyledText(box, new string('\u2500', 38), bodyFont, Theme.Ink600);
                        hasOutput = true;
                        continue;
                    }

                    int headingLevel;
                    string headingText;
                    if (TryParseHeading(trimmed, out headingLevel, out headingText))
                    {
                        float headingSize = headingLevel == 1 ? 12.5f : (headingLevel == 2 ? 11f : (headingLevel == 3 ? 10f : 9.5f));
                        Color headingColor = headingLevel <= 2 ? Theme.Gold : Theme.Parchment50;
                        SetParagraphIndent(box, 0, 0);
                        AppendInlineMarkdown(box, fonts, headingText, "Segoe UI", headingSize, FontStyle.Bold, headingColor);
                        hasOutput = true;
                        continue;
                    }

                    if (trimmed.StartsWith(">", StringComparison.Ordinal))
                    {
                        string quoteText = StripBlockquotePrefix(trimmed);
                        SetParagraphIndent(box, 12, 12);
                        AppendStyledText(box, "\u2502 ", bodyFont, Theme.Parchment600);
                        AppendInlineMarkdown(box, fonts, quoteText, "Segoe UI", 9f, FontStyle.Italic, Theme.Parchment400);
                        hasOutput = true;
                        continue;
                    }

                    int indentLevel;
                    string listItemText;
                    if (TryParseBulletListItem(line, out indentLevel, out listItemText))
                    {
                        SetParagraphIndent(box, 8 + indentLevel * 14, 14);
                        AppendStyledText(box, "  \u2022  ", bodyFont, Theme.Gold);
                        AppendInlineMarkdown(box, fonts, listItemText, "Segoe UI", 9f, FontStyle.Regular, Theme.Parchment200);
                        hasOutput = true;
                        continue;
                    }

                    string numberPrefix;
                    if (TryParseNumberedListItem(line, out indentLevel, out numberPrefix, out listItemText))
                    {
                        SetParagraphIndent(box, 8 + indentLevel * 14, 18);
                        AppendStyledText(box, "  " + numberPrefix + ". ", bodyBoldFont, Theme.Gold);
                        AppendInlineMarkdown(box, fonts, listItemText, "Segoe UI", 9f, FontStyle.Regular, Theme.Parchment200);
                        hasOutput = true;
                        continue;
                    }

                    SetParagraphIndent(box, 0, 0);
                    AppendInlineMarkdown(box, fonts, line, "Segoe UI", 9f, FontStyle.Regular, Theme.Parchment200);
                    hasOutput = true;
                }

                box.SelectionStart = 0;
                box.SelectionLength = 0;
            }
            finally
            {
                foreach (Font f in fonts.Values)
                {
                    f.Dispose();
                }
            }
        }

        private static Font GetCachedFont(Dictionary<string, Font> fonts, string family, float size, FontStyle style)
        {
            string key = family + "|" + size.ToString("0.00", CultureInfo.InvariantCulture) + "|" + ((int)style).ToString(CultureInfo.InvariantCulture);
            Font cached;
            if (fonts.TryGetValue(key, out cached))
            {
                return cached;
            }

            Font created = new Font(family, size, style);
            fonts[key] = created;
            return created;
        }

        private static void SetParagraphIndent(RichTextBox box, int indent, int hangingIndent)
        {
            box.SelectionStart = box.TextLength;
            box.SelectionLength = 0;
            box.SelectionIndent = indent;
            box.SelectionHangingIndent = hangingIndent;
        }

        private static void AppendStyledText(RichTextBox box, string text, Font font, Color color)
        {
            if (string.IsNullOrEmpty(text)) return;
            box.SelectionStart = box.TextLength;
            box.SelectionLength = 0;
            box.SelectionFont = font;
            box.SelectionColor = color;
            box.AppendText(text);
        }

        private static bool IsHorizontalRule(string trimmed)
        {
            if (trimmed.Length < 3) return false;
            char marker = '\0';
            int count = 0;
            for (int i = 0; i < trimmed.Length; i++)
            {
                char c = trimmed[i];
                if (c == ' ' || c == '\t') continue;
                if (c != '-' && c != '*' && c != '_') return false;
                if (marker == '\0')
                {
                    marker = c;
                }
                else if (c != marker)
                {
                    return false;
                }
                count++;
            }
            return count >= 3;
        }

        private static bool TryParseHeading(string trimmed, out int level, out string text)
        {
            level = 0;
            text = string.Empty;
            int hashes = 0;
            while (hashes < trimmed.Length && hashes < 4 && trimmed[hashes] == '#')
            {
                hashes++;
            }
            if (hashes == 0 || hashes >= trimmed.Length) return false;
            if (trimmed[hashes] != ' ' && trimmed[hashes] != '\t') return false;

            level = hashes;
            text = trimmed.Substring(hashes).Trim();
            while (text.EndsWith("#", StringComparison.Ordinal))
            {
                int lastSpace = text.LastIndexOf(' ');
                if (lastSpace < 0) break;
                string trailing = text.Substring(lastSpace + 1);
                bool allHashes = trailing.Length > 0;
                for (int i = 0; i < trailing.Length; i++)
                {
                    if (trailing[i] != '#')
                    {
                        allHashes = false;
                        break;
                    }
                }
                if (!allHashes) break;
                text = text.Substring(0, lastSpace).TrimEnd();
            }
            return true;
        }

        private static string StripBlockquotePrefix(string trimmed)
        {
            string rest = trimmed;
            while (rest.StartsWith(">", StringComparison.Ordinal))
            {
                rest = rest.Substring(1);
                if (rest.StartsWith(" ", StringComparison.Ordinal))
                {
                    rest = rest.Substring(1);
                }
                rest = rest.TrimStart();
            }
            return rest;
        }

        private static bool TryParseBulletListItem(string line, out int indentLevel, out string itemText)
        {
            indentLevel = 0;
            itemText = string.Empty;
            int idx = 0;
            while (idx < line.Length && line[idx] == ' ')
            {
                idx++;
            }
            if (idx + 1 >= line.Length) return false;
            if ((line[idx] == '-' || line[idx] == '*') && (line[idx + 1] == ' ' || line[idx + 1] == '\t'))
            {
                indentLevel = Math.Min(3, idx / 2);
                itemText = line.Substring(idx + 2).TrimStart();
                return true;
            }
            return false;
        }

        private static bool TryParseNumberedListItem(string line, out int indentLevel, out string numberPrefix, out string itemText)
        {
            indentLevel = 0;
            numberPrefix = string.Empty;
            itemText = string.Empty;
            int idx = 0;
            while (idx < line.Length && line[idx] == ' ')
            {
                idx++;
            }
            int numStart = idx;
            while (idx < line.Length && char.IsDigit(line[idx]))
            {
                idx++;
            }
            if (idx == numStart || idx + 1 >= line.Length) return false;
            if (line[idx] == '.' && (line[idx + 1] == ' ' || line[idx + 1] == '\t'))
            {
                indentLevel = Math.Min(3, numStart / 2);
                numberPrefix = line.Substring(numStart, idx - numStart);
                itemText = line.Substring(idx + 2).TrimStart();
                return true;
            }
            return false;
        }

        private static void AppendInlineMarkdown(
            RichTextBox box,
            Dictionary<string, Font> fonts,
            string text,
            string baseFamily,
            float baseSize,
            FontStyle baseStyle,
            Color baseColor)
        {
            if (string.IsNullOrEmpty(text)) return;

            Font baseFont = GetCachedFont(fonts, baseFamily, baseSize, baseStyle);
            StringBuilder plain = new StringBuilder();
            int i = 0;

            while (i < text.Length)
            {
                char ch = text[i];

                if (ch == '\\' && i + 1 < text.Length)
                {
                    char next = text[i + 1];
                    if (next == '\\' || next == '*' || next == '`' || next == '[' || next == ']' || next == '_')
                    {
                        plain.Append(next);
                        i += 2;
                        continue;
                    }
                }

                if (ch == '`')
                {
                    int close = text.IndexOf('`', i + 1);
                    if (close > i + 1)
                    {
                        FlushPlainText(box, plain, baseFont, baseColor);
                        string code = text.Substring(i + 1, close - i - 1);
                        Font inlineCodeFont = GetCachedFont(fonts, "Consolas", Math.Max(8f, baseSize - 0.25f), FontStyle.Regular);
                        AppendStyledText(box, code, inlineCodeFont, Theme.Moss);
                        i = close + 1;
                        continue;
                    }
                }

                if (ch == '*' && i + 1 < text.Length && text[i + 1] == '*')
                {
                    int close = text.IndexOf("**", i + 2, StringComparison.Ordinal);
                    if (close > i + 2)
                    {
                        FlushPlainText(box, plain, baseFont, baseColor);
                        string inner = text.Substring(i + 2, close - i - 2);
                        AppendInlineMarkdown(box, fonts, inner, baseFamily, baseSize, baseStyle | FontStyle.Bold, baseColor);
                        i = close + 2;
                        continue;
                    }
                }

                if (ch == '*' && i + 1 < text.Length && !char.IsWhiteSpace(text[i + 1]))
                {
                    int close = FindClosingSingleAsterisk(text, i + 1);
                    if (close > i + 1)
                    {
                        FlushPlainText(box, plain, baseFont, baseColor);
                        string inner = text.Substring(i + 1, close - i - 1);
                        AppendInlineMarkdown(box, fonts, inner, baseFamily, baseSize, baseStyle | FontStyle.Italic, baseColor);
                        i = close + 1;
                        continue;
                    }
                }

                if (ch == '[')
                {
                    int labelEnd;
                    int urlEnd;
                    string label;
                    string url;
                    if (TryParseMarkdownLink(text, i, out labelEnd, out urlEnd, out label, out url))
                    {
                        FlushPlainText(box, plain, baseFont, baseColor);
                        bool isHttp = url.StartsWith("http://", StringComparison.OrdinalIgnoreCase) ||
                                      url.StartsWith("https://", StringComparison.OrdinalIgnoreCase);
                        if (isHttp && !string.Equals(label, url, StringComparison.OrdinalIgnoreCase))
                        {
                            AppendStyledText(box, label, GetCachedFont(fonts, baseFamily, baseSize, baseStyle), Theme.Parchment50);
                            AppendStyledText(box, " (", baseFont, Theme.Parchment400);
                            AppendStyledText(box, url, baseFont, Theme.Moss);
                            AppendStyledText(box, ")", baseFont, Theme.Parchment400);
                        }
                        else if (isHttp)
                        {
                            AppendStyledText(box, url, baseFont, Theme.Moss);
                        }
                        else
                        {
                            AppendStyledText(box, label, baseFont, Theme.Parchment50);
                        }
                        i = urlEnd + 1;
                        continue;
                    }
                }

                plain.Append(ch);
                i++;
            }

            FlushPlainText(box, plain, baseFont, baseColor);
        }

        private static void FlushPlainText(RichTextBox box, StringBuilder plain, Font font, Color color)
        {
            if (plain.Length == 0) return;
            AppendStyledText(box, plain.ToString(), font, color);
            plain.Length = 0;
        }

        private static int FindClosingSingleAsterisk(string text, int start)
        {
            for (int i = start; i < text.Length; i++)
            {
                if (text[i] != '*') continue;
                bool isDouble = (i + 1 < text.Length && text[i + 1] == '*') || (i > 0 && text[i - 1] == '*');
                if (isDouble) continue;
                if (!char.IsWhiteSpace(text[i - 1]))
                {
                    return i;
                }
            }
            return -1;
        }

        private static bool TryParseMarkdownLink(
            string text,
            int openBracketIndex,
            out int closeBracketIndex,
            out int closeParenIndex,
            out string label,
            out string url)
        {
            closeBracketIndex = -1;
            closeParenIndex = -1;
            label = string.Empty;
            url = string.Empty;

            int i = openBracketIndex + 1;
            while (i < text.Length)
            {
                if (text[i] == '\\' && i + 1 < text.Length)
                {
                    i += 2;
                    continue;
                }
                if (text[i] == ']')
                {
                    closeBracketIndex = i;
                    break;
                }
                if (text[i] == '\n') return false;
                i++;
            }

            if (closeBracketIndex <= openBracketIndex) return false;
            if (closeBracketIndex + 1 >= text.Length || text[closeBracketIndex + 1] != '(') return false;

            int parenEnd = text.IndexOf(')', closeBracketIndex + 2);
            if (parenEnd <= closeBracketIndex + 2) return false;

            closeParenIndex = parenEnd;
            label = text.Substring(openBracketIndex + 1, closeBracketIndex - openBracketIndex - 1);
            url = text.Substring(closeBracketIndex + 2, parenEnd - closeBracketIndex - 2).Trim();
            return true;
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

            if (!UpdateManager.IsAllowedUpdateUrl(_info.ZipDownloadUrl))
            {
                FailUpdate(
                    "Blocked untrusted update URL. Download official releases from " + UpdateManager.OfficialRepoUrl,
                    null);
                return;
            }

            _isUpdating = true;
            _updateNowButton.Enabled = false;
            _skipButton.Enabled = false;
            _closeButton.Enabled = false;

            _statusLabel.Size = new Size(480, 20);
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
                    _statusLabel.Text = "Verifying SHA-256 checksum...";

                    Thread extractThread = new Thread(delegate()
                    {
                        try
                        {
                            UpdateManager.VerifyDownloadedArchiveSha256(
                                _info,
                                zipPath,
                                "OcarinaAtlas/" + MainForm.AppVersion);

                            if (!IsDisposed && IsHandleCreated)
                            {
                                BeginInvoke((MethodInvoker)delegate()
                                {
                                    if (!IsDisposed)
                                    {
                                        _statusLabel.Text = "Extracting update archive...";
                                    }
                                });
                            }

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
                                    FailUpdate("Update verification/extraction failed: " + ex.Message, tempDir);
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
            _statusLabel.Size = new Size(480, 42);
            _statusLabel.ForeColor = Theme.Ember;
            _statusLabel.Text = message + " (See update.log)";
            _statusLabel.Visible = true;
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
        public const string AppVersion = "2.3.1";

        private const int BaseClientWidth = 540;
        private const int CollapsedClientHeight = 392;
        private const int ExpandedMinClientHeight = 590;
        private const int ExpandedClientHeight = 640;

        private readonly LaunchOptions _options;
        private readonly object _procLock = new object();
        private readonly object _bridgeLock = new object();
        private readonly System.Windows.Forms.Timer _pollTimer;
        private readonly Icon _appIcon;
        private float _dpiScale = 1f;

        private JobObject _jobObject;
        private Process _serverProcess;
        private LongshotRpcBridge _longshotBridge;
        private volatile bool _isShuttingDown = false;
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
        private int _copyLogFeedbackTicks = 0;
        private int _syncFeedbackTicks = 0;
        private int _lanFeedbackTicks = 0;
        private bool _lichiiConfigured = false;
        private string _selectedLanUrl = string.Empty;
        private UpdateInfo _pendingUpdateInfo;
        private UpdateDialog _activeUpdateDialog;
        private bool _updateCheckInFlight = false;
        private List<LanEndpoint> _lanEndpoints = new List<LanEndpoint>();
        private ToolTip _toolTip;

        // Layout containers
        private BorderedPanel _serverStatusPill;
        private BorderedPanel _emulatorStatusPill;
        private BorderedPanel _updatePill;
        private BorderedPanel _heroCard;
        private BorderedPanel _syncStripPanel;
        private BorderedPanel _step2Card;
        private BorderedPanel _advancedDrawerPanel;
        private Panel _settingsTabPanel;
        private Panel _logsTabPanel;
        private Panel _aboutTabPanel;
        private BorderedPanel _logContainer;

        // Header controls
        private Label _titleLabel;
        private Label _versionLabel;
        private Label _updatePillLabel;
        private StatusDot _serverDot;
        private Label _serverStatusLabel;
        private StatusDot _heroLichiiDot;
        private Label _heroLichiiLabel;

        // About tab controls aligned after DPI layout
        private Label _atlasCreditTitle;
        private Label _atlasCreditAuthor;
        private LinkLabel _officialRepoLink;
        private Label _originalCreditTitle;
        private Label _originalCreditAuthor;
        private LinkLabel _originalRepoLink;
        private Label _artworkCreditTitle;
        private Label _artworkCreditAuthor;

        // Primary Control + Sync Card controls
        private Label _heroSummaryLabel;
        private LinkLabel _serverUrlLink;
        private Button _startStopButton;
        private Button _openBrowserButton;
        private Button _enableRpcButton;
        private Label _lichiiStepDetailLabel;

        // Second Screen / LAN Card controls
        private Button _firewallButton;
        private ComboBox _lanComboBox;
        private LinkLabel _lanUrlLink;
        private Label _lanStatusLabel;
        private Button _refreshLanButton;
        private Button _copyLanUrlButton;
        private Button _qrButton;
        private Label _lanHintLabel;

        // Drawer controls
        private Button _advancedToggleButton;
        private Button _settingsTabButton;
        private Button _logsTabButton;
        private Button _aboutTabButton;
        private Label _settingsLockHintLabel;
        private BorderedPanel _modeBadgePanel;
        private Label _modeBadgeLabel;
        private Button _copyLogButton;
        private Button _clearLogButton;
        private NumericUpDown _portInput;
        private TextBox _lichiiHostInput;
        private NumericUpDown _lichiiPortInput;
        private CheckBox _allowLanCheckBox;
        private CheckBox _autoOpenCheckBox;
        private CheckBox _trayMinimizeCheckBox;
        private Label _updateStatusLabel;
        private LinkLabel _checkUpdatesLink;
        private TextBox _logTextBox;

        private NotifyIcon _trayIcon;
        private ToolStripMenuItem _trayToggleServerItem;
        private ToolStripMenuItem _trayOpenBrowserItem;

        private bool _advancedExpanded = false;
        private int _activeDrawerTab = 0; // 0 = Settings, 1 = Logs, 2 = About
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

            SuspendLayout();

            Text = "Ocarina Atlas \u2014 Ocarina of Time Map Tracker";
            BackColor = Theme.Ink950;
            ForeColor = Theme.Parchment200;
            AutoScaleDimensions = new SizeF(96F, 96F);
            AutoScaleMode = AutoScaleMode.Dpi;
            Font = new Font("Segoe UI", 9f, FontStyle.Regular);
            ClientSize = new Size(BaseClientWidth, CollapsedClientHeight);
            StartPosition = FormStartPosition.CenterScreen;
            Theme.EnableDarkTitleBar(this);

            BuildLayout();
            ResumeLayout(false);
            PerformLayout();

            _dpiScale = Theme.GetDpiScale(this);
            AlignAutoSizedPairs();

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

            // 0. Borderless Header Bar (54px on Ink950)
            _titleLabel = new Label();
            _titleLabel.Text = "Ocarina Atlas";
            _titleLabel.Font = new Font("Georgia", 15f, FontStyle.Bold);
            _titleLabel.ForeColor = Theme.Parchment50;
            _titleLabel.AutoSize = true;
            _titleLabel.Location = new Point(18, 13);
            Controls.Add(_titleLabel);

            _versionLabel = new Label();
            _versionLabel.Text = "v" + AppVersion;
            _versionLabel.Font = new Font("Segoe UI", 8.5f, FontStyle.Regular);
            _versionLabel.ForeColor = Theme.Parchment600;
            _versionLabel.AutoSize = true;
            _versionLabel.Cursor = Cursors.Hand;
            _versionLabel.Location = new Point(176, 21);
            _versionLabel.Click += OnVersionLabelClick;
            _versionLabel.MouseEnter += delegate { _versionLabel.ForeColor = Theme.Gold; };
            _versionLabel.MouseLeave += delegate { _versionLabel.ForeColor = Theme.Parchment600; };
            _toolTip.SetToolTip(_versionLabel, "About Ocarina Atlas, credits & official repository");
            Controls.Add(_versionLabel);

            _updatePill = new BorderedPanel();
            _updatePill.Location = new Point(226, 16);
            _updatePill.Size = new Size(64, 22);
            _updatePill.FillColor = Color.FromArgb(0x28, 0x20, 0x12);
            _updatePill.BorderColor = Theme.Gold;
            _updatePill.CornerRadius = 11;
            _updatePill.Cursor = Cursors.Hand;
            _updatePill.Visible = false;
            _updatePill.Click += OnUpdatePillClick;
            Controls.Add(_updatePill);

            _updatePillLabel = new Label();
            _updatePillLabel.Text = "Update";
            _updatePillLabel.Font = new Font("Segoe UI", 8f, FontStyle.Bold);
            _updatePillLabel.ForeColor = Theme.Gold;
            _updatePillLabel.BackColor = Color.FromArgb(0x28, 0x20, 0x12);
            _updatePillLabel.Dock = DockStyle.Fill;
            _updatePillLabel.TextAlign = ContentAlignment.MiddleCenter;
            _updatePillLabel.Cursor = Cursors.Hand;
            _updatePillLabel.Click += OnUpdatePillClick;
            _updatePill.Controls.Add(_updatePillLabel);

            _serverStatusPill = new BorderedPanel();
            _serverStatusPill.Location = new Point(312, 16);
            _serverStatusPill.Size = new Size(98, 24);
            _serverStatusPill.Anchor = AnchorStyles.Top | AnchorStyles.Right;
            _serverStatusPill.FillColor = Theme.Ink900;
            _serverStatusPill.BorderColor = Theme.Ink700;
            _serverStatusPill.CornerRadius = 11;
            Controls.Add(_serverStatusPill);

            _serverDot = new StatusDot();
            _serverDot.Location = new Point(8, 6);
            _serverDot.BackColor = Theme.Ink900;
            _serverDot.DotColor = Theme.Parchment600;
            _serverStatusPill.Controls.Add(_serverDot);

            _serverStatusLabel = new Label();
            _serverStatusLabel.Text = "Stopped";
            _serverStatusLabel.Font = new Font("Segoe UI", 8f, FontStyle.Bold);
            _serverStatusLabel.ForeColor = Theme.Parchment400;
            _serverStatusLabel.BackColor = Theme.Ink900;
            _serverStatusLabel.AutoSize = false;
            _serverStatusLabel.TextAlign = ContentAlignment.MiddleLeft;
            _serverStatusLabel.Location = new Point(23, 2);
            _serverStatusLabel.Size = new Size(70, 20);
            _serverStatusPill.Controls.Add(_serverStatusLabel);

            _emulatorStatusPill = new BorderedPanel();
            _emulatorStatusPill.Location = new Point(418, 16);
            _emulatorStatusPill.Size = new Size(104, 24);
            _emulatorStatusPill.Anchor = AnchorStyles.Top | AnchorStyles.Right;
            _emulatorStatusPill.FillColor = Theme.Ink900;
            _emulatorStatusPill.BorderColor = Theme.Ink700;
            _emulatorStatusPill.CornerRadius = 11;
            Controls.Add(_emulatorStatusPill);

            _heroLichiiDot = new StatusDot();
            _heroLichiiDot.Location = new Point(8, 6);
            _heroLichiiDot.BackColor = Theme.Ink900;
            _heroLichiiDot.DotColor = Theme.Parchment600;
            _emulatorStatusPill.Controls.Add(_heroLichiiDot);

            _heroLichiiLabel = new Label();
            _heroLichiiLabel.Text = "No Emu";
            _heroLichiiLabel.Font = new Font("Segoe UI", 8f, FontStyle.Bold);
            _heroLichiiLabel.ForeColor = Theme.Parchment400;
            _heroLichiiLabel.BackColor = Theme.Ink900;
            _heroLichiiLabel.AutoSize = false;
            _heroLichiiLabel.TextAlign = ContentAlignment.MiddleLeft;
            _heroLichiiLabel.Location = new Point(23, 2);
            _heroLichiiLabel.Size = new Size(76, 20);
            _emulatorStatusPill.Controls.Add(_heroLichiiLabel);
            _toolTip.SetToolTip(_emulatorStatusPill, "Emulator: Not detected");
            _toolTip.SetToolTip(_heroLichiiLabel, "Emulator: Not detected");

            // 1. Primary Control + Sync Card (Ink900)
            _heroCard = new BorderedPanel();
            _heroCard.Location = new Point(18, 56);
            _heroCard.Size = new Size(504, 152);
            _heroCard.Anchor = AnchorStyles.Top | AnchorStyles.Left | AnchorStyles.Right;
            _heroCard.FillColor = Theme.Ink900;
            _heroCard.BorderColor = Theme.Ink700;
            _heroCard.CornerRadius = 10;
            Controls.Add(_heroCard);

            _heroSummaryLabel = new Label();
            _heroSummaryLabel.Text = "Click Start Map to open the interactive Hyrule map in your browser.";
            _heroSummaryLabel.Font = new Font("Segoe UI", 9.25f, FontStyle.Regular);
            _heroSummaryLabel.ForeColor = Theme.Parchment200;
            _heroSummaryLabel.AutoSize = false;
            _heroSummaryLabel.Location = new Point(18, 14);
            _heroSummaryLabel.Size = new Size(468, 20);
            _heroSummaryLabel.Anchor = AnchorStyles.Top | AnchorStyles.Left | AnchorStyles.Right;
            _heroCard.Controls.Add(_heroSummaryLabel);

            _serverUrlLink = new LinkLabel();
            _serverUrlLink.Text = string.Empty;
            _serverUrlLink.LinkColor = Theme.Moss;
            _serverUrlLink.ActiveLinkColor = Theme.Parchment50;
            _serverUrlLink.VisitedLinkColor = Theme.Moss;
            _serverUrlLink.Font = new Font("Segoe UI", 8.75f, FontStyle.Bold);
            _serverUrlLink.AutoSize = true;
            _serverUrlLink.Visible = false;
            _serverUrlLink.Location = new Point(18, 36);
            _serverUrlLink.LinkClicked += OnServerUrlLinkClicked;
            _heroCard.Controls.Add(_serverUrlLink);

            _startStopButton = CreateButton("Start Map", 18, 62, 134, 36, true);
            _startStopButton.Font = new Font("Segoe UI", 9.5f, FontStyle.Bold);
            _startStopButton.BackColor = Theme.Moss;
            _startStopButton.ForeColor = Theme.Ink950;
            _startStopButton.FlatAppearance.BorderColor = Theme.Moss;
            _startStopButton.Click += OnStartStopClick;
            _heroCard.Controls.Add(_startStopButton);

            _openBrowserButton = CreateButton("Open Map", 160, 62, 124, 36, true);
            _openBrowserButton.Click += OnOpenBrowserClick;
            _heroCard.Controls.Add(_openBrowserButton);

            _enableRpcButton = CreateButton("1-Click Setup Sync", 342, 65, 144, 30, true);
            _enableRpcButton.Anchor = AnchorStyles.Top | AnchorStyles.Right;
            _enableRpcButton.Font = new Font("Segoe UI", 8.25f, FontStyle.Bold);
            _enableRpcButton.ForeColor = Theme.Gold;
            _enableRpcButton.FlatAppearance.BorderColor = Theme.Gold;
            _enableRpcButton.Click += OnEnableRpcClick;
            _heroCard.Controls.Add(_enableRpcButton);

            _syncStripPanel = new BorderedPanel();
            _syncStripPanel.Location = new Point(14, 108);
            _syncStripPanel.Size = new Size(476, 32);
            _syncStripPanel.Anchor = AnchorStyles.Top | AnchorStyles.Left | AnchorStyles.Right;
            _syncStripPanel.FillColor = Theme.Ink800;
            _syncStripPanel.BorderColor = Theme.Ink700;
            _syncStripPanel.CornerRadius = 6;
            _heroCard.Controls.Add(_syncStripPanel);

            _lichiiStepDetailLabel = new Label();
            _lichiiStepDetailLabel.Text = "Allows Ocarina Atlas to follow Link and mark Gold Skulltulas automatically.";
            _lichiiStepDetailLabel.Font = new Font("Segoe UI", 8.5f, FontStyle.Regular);
            _lichiiStepDetailLabel.ForeColor = Theme.Parchment400;
            _lichiiStepDetailLabel.BackColor = Theme.Ink800;
            _lichiiStepDetailLabel.Dock = DockStyle.Fill;
            _lichiiStepDetailLabel.Padding = new Padding(10, 0, 10, 0);
            _lichiiStepDetailLabel.TextAlign = ContentAlignment.MiddleLeft;
            _lichiiStepDetailLabel.AutoEllipsis = true;
            _syncStripPanel.Controls.Add(_lichiiStepDetailLabel);

            // 2. Compact Second Screen / LAN Card (Ink900)
            _step2Card = new BorderedPanel();
            _step2Card.Location = new Point(18, 220);
            _step2Card.Size = new Size(504, 114);
            _step2Card.Anchor = AnchorStyles.Top | AnchorStyles.Left | AnchorStyles.Right;
            _step2Card.FillColor = Theme.Ink900;
            _step2Card.BorderColor = Theme.Ink700;
            _step2Card.CornerRadius = 10;
            Controls.Add(_step2Card);

            Label step2Title = new Label();
            step2Title.Text = "Second Screen (LAN)";
            step2Title.Font = new Font("Segoe UI", 9.5f, FontStyle.Bold);
            step2Title.ForeColor = Theme.Parchment50;
            step2Title.AutoSize = true;
            step2Title.Location = new Point(18, 16);
            _step2Card.Controls.Add(step2Title);

            _firewallButton = CreateButton("Allow LAN Access", 292, 13, 126, 26, true);
            _firewallButton.Anchor = AnchorStyles.Top | AnchorStyles.Right;
            _firewallButton.Font = new Font("Segoe UI", 8f, FontStyle.Bold);
            _firewallButton.Click += OnAllowFirewallClick;
            _step2Card.Controls.Add(_firewallButton);
            _toolTip.SetToolTip(_firewallButton, "Adds a Windows Firewall rule on Private networks so your tablet or phone can connect.");

            _refreshLanButton = CreateButton("Refresh", 424, 13, 64, 26, false);
            _refreshLanButton.Anchor = AnchorStyles.Top | AnchorStyles.Right;
            _refreshLanButton.Font = new Font("Segoe UI", 8f, FontStyle.Regular);
            _refreshLanButton.Click += OnRefreshLanClick;
            _step2Card.Controls.Add(_refreshLanButton);
            _toolTip.SetToolTip(_refreshLanButton, "Re-scan active Wi-Fi and Ethernet network adapters.");

            _lanComboBox = new ComboBox();
            _lanComboBox.DropDownStyle = ComboBoxStyle.DropDownList;
            _lanComboBox.FlatStyle = FlatStyle.Flat;
            _lanComboBox.BackColor = Theme.Ink800;
            _lanComboBox.ForeColor = Theme.Parchment50;
            _lanComboBox.Font = new Font("Segoe UI", 8.75f, FontStyle.Regular);
            _lanComboBox.Location = new Point(18, 49);
            _lanComboBox.Size = new Size(296, 24);
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
            _lanUrlLink.AutoSize = false;
            _lanUrlLink.AutoEllipsis = true;
            _lanUrlLink.Location = new Point(18, 52);
            _lanUrlLink.Size = new Size(296, 20);
            _lanUrlLink.Anchor = AnchorStyles.Top | AnchorStyles.Left | AnchorStyles.Right;
            _lanUrlLink.Visible = false;
            _lanUrlLink.LinkClicked += OnLanUrlLinkClicked;
            _step2Card.Controls.Add(_lanUrlLink);

            _lanStatusLabel = new Label();
            _lanStatusLabel.Text = "Checking network adapters...";
            _lanStatusLabel.Font = new Font("Segoe UI", 8.75f, FontStyle.Regular);
            _lanStatusLabel.ForeColor = Theme.Parchment200;
            _lanStatusLabel.AutoSize = false;
            _lanStatusLabel.AutoEllipsis = true;
            _lanStatusLabel.Location = new Point(18, 52);
            _lanStatusLabel.Size = new Size(296, 20);
            _lanStatusLabel.Anchor = AnchorStyles.Top | AnchorStyles.Left | AnchorStyles.Right;
            _step2Card.Controls.Add(_lanStatusLabel);

            _copyLanUrlButton = CreateButton("Copy URL", 322, 48, 82, 28, true);
            _copyLanUrlButton.Anchor = AnchorStyles.Top | AnchorStyles.Right;
            _copyLanUrlButton.Font = new Font("Segoe UI", 8f, FontStyle.Bold);
            _copyLanUrlButton.Click += OnCopyLanUrlClick;
            _step2Card.Controls.Add(_copyLanUrlButton);
            _toolTip.SetToolTip(_copyLanUrlButton, "Copy the selected LAN address to open on your tablet, iPad, or phone.");

            _qrButton = CreateButton("QR Code", 410, 48, 78, 28, true);
            _qrButton.Anchor = AnchorStyles.Top | AnchorStyles.Right;
            _qrButton.Font = new Font("Segoe UI", 8f, FontStyle.Bold);
            _qrButton.ForeColor = Theme.Gold;
            _qrButton.FlatAppearance.BorderColor = Theme.Gold;
            _qrButton.Click += OnQrButtonClick;
            _step2Card.Controls.Add(_qrButton);
            _toolTip.SetToolTip(_qrButton, "Show a large QR code to scan with your phone or tablet camera.");

            _lanHintLabel = new Label();
            _lanHintLabel.Text = "Open this address or scan the QR code on your tablet, iPad, or phone.";
            _lanHintLabel.Font = new Font("Segoe UI", 8.25f, FontStyle.Regular);
            _lanHintLabel.ForeColor = Theme.Parchment400;
            _lanHintLabel.AutoSize = false;
            _lanHintLabel.AutoEllipsis = true;
            _lanHintLabel.Location = new Point(18, 82);
            _lanHintLabel.Size = new Size(468, 20);
            _lanHintLabel.Anchor = AnchorStyles.Top | AnchorStyles.Left | AnchorStyles.Right;
            _step2Card.Controls.Add(_lanHintLabel);

            // 3. Collapsible Drawer Toggle + Tabbed Drawer (Settings | Logs | About)
            _advancedToggleButton = CreateButton("\u25B8 Settings, Logs & About", 18, 346, 504, 30, true);
            _advancedToggleButton.Anchor = AnchorStyles.Top | AnchorStyles.Left | AnchorStyles.Right;
            _advancedToggleButton.TextAlign = ContentAlignment.MiddleLeft;
            _advancedToggleButton.Padding = new Padding(10, 0, 0, 0);
            _advancedToggleButton.Font = new Font("Segoe UI", 8.75f, FontStyle.Bold);
            _advancedToggleButton.ForeColor = Theme.Parchment400;
            _advancedToggleButton.Click += OnAdvancedToggleClick;
            Controls.Add(_advancedToggleButton);

            _advancedDrawerPanel = new BorderedPanel();
            _advancedDrawerPanel.Location = new Point(18, 384);
            _advancedDrawerPanel.Size = new Size(504, 242);
            _advancedDrawerPanel.Anchor = AnchorStyles.Top | AnchorStyles.Bottom | AnchorStyles.Left | AnchorStyles.Right;
            _advancedDrawerPanel.FillColor = Theme.Ink900;
            _advancedDrawerPanel.BorderColor = Theme.Ink700;
            _advancedDrawerPanel.CornerRadius = 10;
            _advancedDrawerPanel.Visible = false;
            Controls.Add(_advancedDrawerPanel);

            BorderedPanel tabBarPanel = new BorderedPanel();
            tabBarPanel.Location = new Point(14, 12);
            tabBarPanel.Size = new Size(232, 28);
            tabBarPanel.FillColor = Theme.Ink950;
            tabBarPanel.BorderColor = Theme.Ink700;
            tabBarPanel.CornerRadius = 6;
            _advancedDrawerPanel.Controls.Add(tabBarPanel);

            _settingsTabButton = new Button();
            _settingsTabButton.Text = "Settings";
            _settingsTabButton.Location = new Point(2, 2);
            _settingsTabButton.Size = new Size(76, 24);
            _settingsTabButton.FlatStyle = FlatStyle.Flat;
            _settingsTabButton.FlatAppearance.BorderSize = 0;
            _settingsTabButton.Cursor = Cursors.Hand;
            _settingsTabButton.UseVisualStyleBackColor = false;
            _settingsTabButton.Click += delegate { SelectDrawerTab(0); };
            tabBarPanel.Controls.Add(_settingsTabButton);

            _logsTabButton = new Button();
            _logsTabButton.Text = "Logs";
            _logsTabButton.Location = new Point(78, 2);
            _logsTabButton.Size = new Size(76, 24);
            _logsTabButton.FlatStyle = FlatStyle.Flat;
            _logsTabButton.FlatAppearance.BorderSize = 0;
            _logsTabButton.Cursor = Cursors.Hand;
            _logsTabButton.UseVisualStyleBackColor = false;
            _logsTabButton.Click += delegate { SelectDrawerTab(1); };
            tabBarPanel.Controls.Add(_logsTabButton);

            _aboutTabButton = new Button();
            _aboutTabButton.Text = "About";
            _aboutTabButton.Location = new Point(154, 2);
            _aboutTabButton.Size = new Size(76, 24);
            _aboutTabButton.FlatStyle = FlatStyle.Flat;
            _aboutTabButton.FlatAppearance.BorderSize = 0;
            _aboutTabButton.Cursor = Cursors.Hand;
            _aboutTabButton.UseVisualStyleBackColor = false;
            _aboutTabButton.Click += delegate { SelectDrawerTab(2); };
            tabBarPanel.Controls.Add(_aboutTabButton);

            _settingsLockHintLabel = new Label();
            _settingsLockHintLabel.Text = "Stop server to edit port or host settings";
            _settingsLockHintLabel.Font = new Font("Segoe UI", 8f, FontStyle.Italic);
            _settingsLockHintLabel.ForeColor = Theme.Parchment600;
            _settingsLockHintLabel.AutoSize = false;
            _settingsLockHintLabel.TextAlign = ContentAlignment.MiddleRight;
            _settingsLockHintLabel.Location = new Point(254, 16);
            _settingsLockHintLabel.Size = new Size(234, 20);
            _settingsLockHintLabel.Anchor = AnchorStyles.Top | AnchorStyles.Right;
            _settingsLockHintLabel.Visible = false;
            _advancedDrawerPanel.Controls.Add(_settingsLockHintLabel);

            _modeBadgePanel = new BorderedPanel();
            _modeBadgePanel.Location = new Point(254, 13);
            _modeBadgePanel.Size = new Size(96, 24);
            _modeBadgePanel.Anchor = AnchorStyles.Top | AnchorStyles.Right;
            _modeBadgePanel.FillColor = Theme.Ink800;
            _modeBadgePanel.BorderColor = Theme.Ink700;
            _modeBadgePanel.CornerRadius = 6;
            _modeBadgePanel.Visible = false;
            _advancedDrawerPanel.Controls.Add(_modeBadgePanel);

            _modeBadgeLabel = new Label();
            _modeBadgeLabel.Dock = DockStyle.Fill;
            _modeBadgeLabel.TextAlign = ContentAlignment.MiddleCenter;
            _modeBadgeLabel.Font = new Font("Segoe UI", 7.5f, FontStyle.Bold);
            _modeBadgeLabel.BackColor = Theme.Ink800;
            _modeBadgeLabel.ForeColor = Theme.Parchment400;
            _modeBadgePanel.Controls.Add(_modeBadgeLabel);

            _copyLogButton = CreateButton("Copy", 356, 13, 62, 24, false);
            _copyLogButton.Anchor = AnchorStyles.Top | AnchorStyles.Right;
            _copyLogButton.Font = new Font("Segoe UI", 7.75f, FontStyle.Regular);
            _copyLogButton.Visible = false;
            _copyLogButton.Click += OnCopyLogClick;
            _advancedDrawerPanel.Controls.Add(_copyLogButton);

            _clearLogButton = CreateButton("Clear", 424, 13, 64, 24, false);
            _clearLogButton.Anchor = AnchorStyles.Top | AnchorStyles.Right;
            _clearLogButton.Font = new Font("Segoe UI", 7.75f, FontStyle.Regular);
            _clearLogButton.Visible = false;
            _clearLogButton.Click += OnClearLogClick;
            _advancedDrawerPanel.Controls.Add(_clearLogButton);

            // Settings Tab Panel (2-column grid)
            _settingsTabPanel = new Panel();
            _settingsTabPanel.Location = new Point(14, 48);
            _settingsTabPanel.Size = new Size(476, 182);
            _settingsTabPanel.Anchor = AnchorStyles.Top | AnchorStyles.Bottom | AnchorStyles.Left | AnchorStyles.Right;
            _settingsTabPanel.BackColor = Theme.Ink900;
            _advancedDrawerPanel.Controls.Add(_settingsTabPanel);

            Label portLabel = new Label();
            portLabel.Text = "Map Port";
            portLabel.Font = new Font("Segoe UI", 8.25f, FontStyle.Bold);
            portLabel.ForeColor = Theme.Parchment400;
            portLabel.AutoSize = true;
            portLabel.Location = new Point(0, 4);
            _settingsTabPanel.Controls.Add(portLabel);

            _portInput = new NumericUpDown();
            _portInput.Minimum = 1;
            _portInput.Maximum = 65535;
            _portInput.Value = 3000;
            _portInput.BackColor = Theme.Ink800;
            _portInput.ForeColor = Theme.Parchment50;
            _portInput.BorderStyle = BorderStyle.None;
            _portInput.ValueChanged += OnPortInputChanged;
            _settingsTabPanel.Controls.Add(WrapInputInBorderedPanel(_portInput, 0, 24, 110, 28));

            Label lHostLabel = new Label();
            lHostLabel.Text = "Emulator RPC Host";
            lHostLabel.Font = new Font("Segoe UI", 8.25f, FontStyle.Bold);
            lHostLabel.ForeColor = Theme.Parchment400;
            lHostLabel.AutoSize = true;
            lHostLabel.Location = new Point(244, 4);
            _settingsTabPanel.Controls.Add(lHostLabel);

            _lichiiHostInput = new TextBox();
            _lichiiHostInput.Text = "127.0.0.1";
            _lichiiHostInput.BackColor = Theme.Ink800;
            _lichiiHostInput.ForeColor = Theme.Parchment50;
            _lichiiHostInput.BorderStyle = BorderStyle.None;
            _lichiiHostInput.TextChanged += OnLichiiHostChanged;
            BorderedPanel hostWrap = WrapInputInBorderedPanel(_lichiiHostInput, 244, 24, 232, 28);
            hostWrap.Anchor = AnchorStyles.Top | AnchorStyles.Left | AnchorStyles.Right;
            _settingsTabPanel.Controls.Add(hostWrap);

            Label lPortLabel = new Label();
            lPortLabel.Text = "Emulator RPC Port";
            lPortLabel.Font = new Font("Segoe UI", 8.25f, FontStyle.Bold);
            lPortLabel.ForeColor = Theme.Parchment400;
            lPortLabel.AutoSize = true;
            lPortLabel.Location = new Point(0, 64);
            _settingsTabPanel.Controls.Add(lPortLabel);

            _lichiiPortInput = new NumericUpDown();
            _lichiiPortInput.Minimum = 1;
            _lichiiPortInput.Maximum = 65535;
            _lichiiPortInput.Value = 6545;
            _lichiiPortInput.BackColor = Theme.Ink800;
            _lichiiPortInput.ForeColor = Theme.Parchment50;
            _lichiiPortInput.BorderStyle = BorderStyle.None;
            _lichiiPortInput.ValueChanged += OnLichiiPortChanged;
            _settingsTabPanel.Controls.Add(WrapInputInBorderedPanel(_lichiiPortInput, 0, 84, 110, 28));

            Button resetLichiiBtn = CreateButton("Reset", 118, 84, 68, 28, false);
            resetLichiiBtn.Font = new Font("Segoe UI", 8f, FontStyle.Regular);
            resetLichiiBtn.Click += OnResetLichiiDefaultsClick;
            _settingsTabPanel.Controls.Add(resetLichiiBtn);

            _allowLanCheckBox = new CheckBox();
            _allowLanCheckBox.Text = "Allow LAN access";
            _allowLanCheckBox.AutoSize = true;
            _allowLanCheckBox.Checked = true;
            _allowLanCheckBox.ForeColor = Theme.Parchment200;
            _allowLanCheckBox.BackColor = Theme.Ink900;
            _allowLanCheckBox.Location = new Point(244, 66);
            _allowLanCheckBox.CheckedChanged += OnAllowLanCheckedChanged;
            _settingsTabPanel.Controls.Add(_allowLanCheckBox);

            _autoOpenCheckBox = new CheckBox();
            _autoOpenCheckBox.Text = "Auto-open browser";
            _autoOpenCheckBox.AutoSize = true;
            _autoOpenCheckBox.Checked = true;
            _autoOpenCheckBox.ForeColor = Theme.Parchment200;
            _autoOpenCheckBox.BackColor = Theme.Ink900;
            _autoOpenCheckBox.Location = new Point(244, 90);
            _settingsTabPanel.Controls.Add(_autoOpenCheckBox);

            _trayMinimizeCheckBox = new CheckBox();
            _trayMinimizeCheckBox.Text = "Minimize to tray";
            _trayMinimizeCheckBox.AutoSize = true;
            _trayMinimizeCheckBox.Checked = false;
            _trayMinimizeCheckBox.ForeColor = Theme.Parchment200;
            _trayMinimizeCheckBox.BackColor = Theme.Ink900;
            _trayMinimizeCheckBox.Location = new Point(244, 114);
            _settingsTabPanel.Controls.Add(_trayMinimizeCheckBox);

            _updateStatusLabel = new Label();
            _updateStatusLabel.Text = "Version " + AppVersion;
            _updateStatusLabel.Font = new Font("Segoe UI", 8.25f, FontStyle.Regular);
            _updateStatusLabel.ForeColor = Theme.Parchment600;
            _updateStatusLabel.AutoSize = false;
            _updateStatusLabel.Location = new Point(0, 150);
            _updateStatusLabel.Size = new Size(340, 20);
            _updateStatusLabel.Anchor = AnchorStyles.Bottom | AnchorStyles.Left | AnchorStyles.Right;
            _settingsTabPanel.Controls.Add(_updateStatusLabel);

            _checkUpdatesLink = new LinkLabel();
            _checkUpdatesLink.Text = "Check for Updates";
            _checkUpdatesLink.LinkColor = Theme.Gold;
            _checkUpdatesLink.ActiveLinkColor = Theme.Parchment50;
            _checkUpdatesLink.VisitedLinkColor = Theme.Gold;
            _checkUpdatesLink.Font = new Font("Segoe UI", 8.25f, FontStyle.Bold);
            _checkUpdatesLink.AutoSize = true;
            _checkUpdatesLink.Anchor = AnchorStyles.Bottom | AnchorStyles.Right;
            _checkUpdatesLink.Location = new Point(368, 150);
            _checkUpdatesLink.LinkClicked += OnCheckUpdatesClick;
            _settingsTabPanel.Controls.Add(_checkUpdatesLink);

            // Logs Tab Panel
            _logsTabPanel = new Panel();
            _logsTabPanel.Location = new Point(14, 48);
            _logsTabPanel.Size = new Size(476, 182);
            _logsTabPanel.Anchor = AnchorStyles.Top | AnchorStyles.Bottom | AnchorStyles.Left | AnchorStyles.Right;
            _logsTabPanel.BackColor = Theme.Ink900;
            _logsTabPanel.Visible = false;
            _advancedDrawerPanel.Controls.Add(_logsTabPanel);

            _logContainer = new BorderedPanel();
            _logContainer.Dock = DockStyle.Fill;
            _logContainer.FillColor = Theme.Ink950;
            _logContainer.BorderColor = Theme.Ink700;
            _logContainer.CornerRadius = 6;
            _logContainer.Padding = new Padding(8, 6, 8, 6);
            _logsTabPanel.Controls.Add(_logContainer);

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

            // About Tab Panel
            _aboutTabPanel = new Panel();
            _aboutTabPanel.Location = new Point(14, 48);
            _aboutTabPanel.Size = new Size(476, 182);
            _aboutTabPanel.Anchor = AnchorStyles.Top | AnchorStyles.Bottom | AnchorStyles.Left | AnchorStyles.Right;
            _aboutTabPanel.BackColor = Theme.Ink900;
            _aboutTabPanel.Visible = false;
            _advancedDrawerPanel.Controls.Add(_aboutTabPanel);

            _atlasCreditTitle = new Label();
            _atlasCreditTitle.Text = "Ocarina Atlas";
            _atlasCreditTitle.Font = new Font("Segoe UI", 8.75f, FontStyle.Bold);
            _atlasCreditTitle.ForeColor = Theme.Parchment50;
            _atlasCreditTitle.AutoSize = true;
            _atlasCreditTitle.Location = new Point(0, 4);
            _aboutTabPanel.Controls.Add(_atlasCreditTitle);

            _atlasCreditAuthor = new Label();
            _atlasCreditAuthor.Text = "by antonioalvromero";
            _atlasCreditAuthor.Font = new Font("Segoe UI", 8.5f, FontStyle.Regular);
            _atlasCreditAuthor.ForeColor = Theme.Parchment300;
            _atlasCreditAuthor.AutoSize = true;
            _atlasCreditAuthor.Location = new Point(92, 4);
            _aboutTabPanel.Controls.Add(_atlasCreditAuthor);

            _officialRepoLink = new LinkLabel();
            _officialRepoLink.Text = "github.com/antonioalvromero/Ocarina-Atlas";
            _officialRepoLink.LinkColor = Theme.Gold;
            _officialRepoLink.ActiveLinkColor = Theme.Parchment50;
            _officialRepoLink.VisitedLinkColor = Theme.Gold;
            _officialRepoLink.Font = new Font("Segoe UI", 8.25f, FontStyle.Bold);
            _officialRepoLink.AutoSize = true;
            _officialRepoLink.Location = new Point(214, 4);
            _officialRepoLink.LinkClicked += delegate { OpenUrlInBrowser(UpdateManager.OfficialRepoUrl); };
            _toolTip.SetToolTip(_officialRepoLink, UpdateManager.OfficialRepoUrl);
            _aboutTabPanel.Controls.Add(_officialRepoLink);

            _originalCreditTitle = new Label();
            _originalCreditTitle.Text = "Original Map";
            _originalCreditTitle.Font = new Font("Segoe UI", 8.75f, FontStyle.Bold);
            _originalCreditTitle.ForeColor = Theme.Parchment200;
            _originalCreditTitle.AutoSize = true;
            _originalCreditTitle.Location = new Point(0, 28);
            _aboutTabPanel.Controls.Add(_originalCreditTitle);

            _originalCreditAuthor = new Label();
            _originalCreditAuthor.Text = "by lucasriondel";
            _originalCreditAuthor.Font = new Font("Segoe UI", 8.5f, FontStyle.Regular);
            _originalCreditAuthor.ForeColor = Theme.Parchment400;
            _originalCreditAuthor.AutoSize = true;
            _originalCreditAuthor.Location = new Point(92, 28);
            _aboutTabPanel.Controls.Add(_originalCreditAuthor);

            _originalRepoLink = new LinkLabel();
            _originalRepoLink.Text = "lucasriondel/oot-remake-map";
            _originalRepoLink.LinkColor = Theme.Moss;
            _originalRepoLink.ActiveLinkColor = Theme.Parchment50;
            _originalRepoLink.VisitedLinkColor = Theme.Moss;
            _originalRepoLink.Font = new Font("Segoe UI", 8.25f, FontStyle.Bold);
            _originalRepoLink.AutoSize = true;
            _originalRepoLink.Location = new Point(214, 28);
            _originalRepoLink.LinkClicked += delegate { OpenUrlInBrowser(UpdateManager.OriginalRepoUrl); };
            _toolTip.SetToolTip(_originalRepoLink, UpdateManager.OriginalRepoUrl);
            _aboutTabPanel.Controls.Add(_originalRepoLink);

            _artworkCreditTitle = new Label();
            _artworkCreditTitle.Text = "Map Artwork";
            _artworkCreditTitle.Font = new Font("Segoe UI", 8.75f, FontStyle.Bold);
            _artworkCreditTitle.ForeColor = Theme.Parchment200;
            _artworkCreditTitle.AutoSize = true;
            _artworkCreditTitle.Location = new Point(0, 52);
            _aboutTabPanel.Controls.Add(_artworkCreditTitle);

            _artworkCreditAuthor = new Label();
            _artworkCreditAuthor.Text = "by Nintend\u00FAo";
            _artworkCreditAuthor.Font = new Font("Segoe UI", 8.5f, FontStyle.Regular);
            _artworkCreditAuthor.ForeColor = Theme.Parchment400;
            _artworkCreditAuthor.AutoSize = true;
            _artworkCreditAuthor.Location = new Point(92, 52);
            _aboutTabPanel.Controls.Add(_artworkCreditAuthor);

            BorderedPanel securityNoticePanel = new BorderedPanel();
            securityNoticePanel.Location = new Point(0, 80);
            securityNoticePanel.Size = new Size(476, 60);
            securityNoticePanel.Anchor = AnchorStyles.Top | AnchorStyles.Left | AnchorStyles.Right;
            securityNoticePanel.FillColor = Theme.Ink950;
            securityNoticePanel.BorderColor = Color.FromArgb(0x5A, 0x47, 0x22);
            securityNoticePanel.CornerRadius = 6;
            _aboutTabPanel.Controls.Add(securityNoticePanel);

            Label securityNoticeLabel = new Label();
            securityNoticeLabel.Text = "Free & open-source (GNU AGPL-3.0). Official builds: github.com/antonioalvromero/Ocarina-Atlas \u2014 forks must preserve credits and share source.";
            securityNoticeLabel.Font = new Font("Segoe UI", 8.25f, FontStyle.Regular);
            securityNoticeLabel.ForeColor = Theme.Parchment200;
            securityNoticeLabel.BackColor = Theme.Ink950;
            securityNoticeLabel.Dock = DockStyle.Fill;
            securityNoticeLabel.Padding = new Padding(10, 8, 10, 8);
            securityNoticeLabel.TextAlign = ContentAlignment.MiddleLeft;
            securityNoticePanel.Controls.Add(securityNoticeLabel);

            Label aboutFooterLabel = new Label();
            aboutFooterLabel.Text = "Version " + AppVersion + "  \u2022  Verify official releases via SHA-256 or GitHub attestation";
            aboutFooterLabel.Font = new Font("Segoe UI", 8f, FontStyle.Regular);
            aboutFooterLabel.ForeColor = Theme.Parchment600;
            aboutFooterLabel.AutoSize = false;
            aboutFooterLabel.Location = new Point(0, 150);
            aboutFooterLabel.Size = new Size(476, 20);
            aboutFooterLabel.Anchor = AnchorStyles.Bottom | AnchorStyles.Left | AnchorStyles.Right;
            _aboutTabPanel.Controls.Add(aboutFooterLabel);

            SelectDrawerTab(0);
        }

        private static BorderedPanel WrapInputInBorderedPanel(Control input, int x, int y, int width, int height)
        {
            BorderedPanel container = new BorderedPanel();
            container.Location = new Point(x, y);
            container.Size = new Size(width, height);
            container.FillColor = Theme.Ink800;
            container.BorderColor = Theme.Ink700;
            container.CornerRadius = 6;
            container.Padding = new Padding(8, 5, 8, 4);
            input.Dock = DockStyle.Fill;
            container.Controls.Add(input);
            return container;
        }

        private void SelectDrawerTab(int tabIndex)
        {
            _activeDrawerTab = (tabIndex >= 0 && tabIndex <= 2) ? tabIndex : 0;
            bool isSettings = _activeDrawerTab == 0;
            bool isLogs = _activeDrawerTab == 1;
            bool isAbout = _activeDrawerTab == 2;

            _settingsTabPanel.Visible = isSettings;
            _logsTabPanel.Visible = isLogs;
            _aboutTabPanel.Visible = isAbout;

            _settingsTabButton.BackColor = isSettings ? Theme.Ink800 : Theme.Ink950;
            _settingsTabButton.ForeColor = isSettings ? Theme.Gold : Theme.Parchment600;
            _settingsTabButton.Font = new Font("Segoe UI", 8.25f, isSettings ? FontStyle.Bold : FontStyle.Regular);

            _logsTabButton.BackColor = isLogs ? Theme.Ink800 : Theme.Ink950;
            _logsTabButton.ForeColor = isLogs ? Theme.Gold : Theme.Parchment600;
            _logsTabButton.Font = new Font("Segoe UI", 8.25f, isLogs ? FontStyle.Bold : FontStyle.Regular);

            _aboutTabButton.BackColor = isAbout ? Theme.Ink800 : Theme.Ink950;
            _aboutTabButton.ForeColor = isAbout ? Theme.Gold : Theme.Parchment600;
            _aboutTabButton.Font = new Font("Segoe UI", 8.25f, isAbout ? FontStyle.Bold : FontStyle.Regular);

            _settingsLockHintLabel.Visible = isSettings && _lifecycle != ServerLifecycle.Stopped;
            _modeBadgePanel.Visible = isLogs;
            _copyLogButton.Visible = isLogs;
            _clearLogButton.Visible = isLogs;
        }

        private Button CreateButton(string text, int x, int y, int width, int height, bool bold)
        {
            Button btn = new Button();
            btn.Text = text;
            btn.Location = new Point(x, y);
            btn.Size = new Size(width, height);
            btn.FlatStyle = FlatStyle.Flat;
            btn.FlatAppearance.BorderSize = 1;
            btn.FlatAppearance.BorderColor = Theme.Ink700;
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

        private void AlignAutoSizedPairs()
        {
            int titleGap = Theme.ScaleDpi(8, _dpiScale);
            int pillGap = Theme.ScaleDpi(10, _dpiScale);
            int creditGap = Theme.ScaleDpi(6, _dpiScale);
            int repoGap = Theme.ScaleDpi(10, _dpiScale);
            int repoMinX = Theme.ScaleDpi(214, _dpiScale);

            _versionLabel.Left = _titleLabel.Right + titleGap;
            _updatePill.Left = _versionLabel.Right + pillGap;

            _atlasCreditAuthor.Left = _atlasCreditTitle.Right + creditGap;
            _officialRepoLink.Left = Math.Max(repoMinX, _atlasCreditAuthor.Right + repoGap);

            _originalCreditAuthor.Left = _originalCreditTitle.Right + creditGap;
            _originalRepoLink.Left = Math.Max(repoMinX, _originalCreditAuthor.Right + repoGap);

            _artworkCreditAuthor.Left = _artworkCreditTitle.Right + creditGap;
        }

        private void ReflowLayout()
        {
            _advancedToggleButton.Text = _advancedExpanded
                ? "\u25BE Settings, Logs & About"
                : "\u25B8 Settings, Logs & About";

            int nonClientW = Size.Width - ClientSize.Width;
            int nonClientH = Size.Height - ClientSize.Height;

            int minWidth = Theme.ScaleDpi(BaseClientWidth, _dpiScale);
            int collapsedHeight = Theme.ScaleDpi(CollapsedClientHeight, _dpiScale);
            int expandedMinHeight = Theme.ScaleDpi(ExpandedMinClientHeight, _dpiScale);
            int expandedHeight = Theme.ScaleDpi(ExpandedClientHeight, _dpiScale);
            int minDrawerHeight = Theme.ScaleDpi(180, _dpiScale);
            int bottomMargin = Theme.ScaleDpi(14, _dpiScale);

            if (_advancedExpanded)
            {
                _advancedDrawerPanel.Visible = true;
                MinimumSize = new Size(minWidth + nonClientW, expandedMinHeight + nonClientH);
                if (ClientSize.Height < expandedHeight)
                {
                    ClientSize = new Size(ClientSize.Width, expandedHeight);
                }
                int drawerHeight = Math.Max(minDrawerHeight, ClientSize.Height - _advancedDrawerPanel.Top - bottomMargin);
                _advancedDrawerPanel.Height = drawerHeight;
            }
            else
            {
                _advancedDrawerPanel.Visible = false;
                MinimumSize = new Size(minWidth + nonClientW, collapsedHeight + nonClientH);
                ClientSize = new Size(ClientSize.Width, collapsedHeight);
            }
        }

        private void OnVersionLabelClick(object sender, EventArgs e)
        {
            if (!_advancedExpanded)
            {
                _advancedExpanded = true;
                SelectDrawerTab(2);
                ReflowLayout();
            }
            else if (_activeDrawerTab != 2)
            {
                SelectDrawerTab(2);
            }
            else
            {
                _advancedExpanded = false;
                ReflowLayout();
            }
        }

        private void OnFormLoad(object sender, EventArgs e)
        {
            AppendLog("Launcher ready. Checking runtime and Lichii status...");
            if (!string.IsNullOrEmpty(_options.RejectedUpdateFeedUrl))
            {
                AppendLog("Security warning: ignored untrusted update feed URL (" + _options.RejectedUpdateFeedUrl + "). Official builds: " + UpdateManager.OfficialRepoUrl);
            }
            RefreshLanDisplays();
            TriggerFirewallStatusCheck();
            TriggerPollNow();
            StartUpdateCheck(false);

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
                _lichiiConfigured = false;
                UpdateLichiiPortLabels();
                _enableRpcButton.ForeColor = Theme.Gold;
                _enableRpcButton.FlatAppearance.BorderColor = Theme.Gold;
                _lichiiStepDetailLabel.Text = "Could not read emulator config: " + status.ErrorMessage;
                _lichiiStepDetailLabel.ForeColor = Theme.Ember;
                return;
            }

            if (status.IsEnabled)
            {
                _lichiiConfigured = true;
                UpdateLichiiPortLabels();
                _enableRpcButton.ForeColor = Theme.Moss;
                _enableRpcButton.FlatAppearance.BorderColor = Theme.Moss;
                if (_syncFeedbackTicks == 0)
                {
                    _lichiiStepDetailLabel.Text = "Live sync configured. Start Lichii or Fritchii and load Ocarina of Time.";
                    _lichiiStepDetailLabel.ForeColor = Theme.Parchment400;
                }
                string pathsSummary = status.TargetPaths != null && status.TargetPaths.Count > 0
                    ? string.Join("\n", status.TargetPaths.ToArray())
                    : status.FilePath;
                _toolTip.SetToolTip(_enableRpcButton, "Configured: EDEN_NX2_DEBUG_SERVER=" + status.ConfiguredTarget + "\nClick to re-apply config.\n" + pathsSummary);
            }
            else
            {
                _lichiiConfigured = false;
                UpdateLichiiPortLabels();
                _enableRpcButton.ForeColor = Theme.Gold;
                _enableRpcButton.FlatAppearance.BorderColor = Theme.Gold;
                if (_syncFeedbackTicks == 0)
                {
                    _lichiiStepDetailLabel.Text = "Click 1-Click Setup Sync to enable live tracking in Lichii / Fritchii.";
                    _lichiiStepDetailLabel.ForeColor = Theme.Parchment200;
                }
                _toolTip.SetToolTip(_enableRpcButton, "Writes EDEN_NX2_DEBUG_SERVER to nx2_switches.txt for Lichii and Fritchii.");
            }
        }

        private void UpdateLichiiPortLabels()
        {
            int lPort = (int)_lichiiPortInput.Value;
            if (_lichiiConfigured)
            {
                _enableRpcButton.Text = lPort == 6545
                    ? "Configured \u21BB"
                    : string.Format(CultureInfo.InvariantCulture, "Configured (:{0}) \u21BB", lPort);
            }
            else
            {
                _enableRpcButton.Text = lPort == 6545
                    ? "1-Click Setup Sync"
                    : string.Format(CultureInfo.InvariantCulture, "Setup Sync (:{0})", lPort);
            }
        }

        private void OnLichiiHostChanged(object sender, EventArgs e)
        {
            TriggerPollNow();
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

        private void OnCopyLogClick(object sender, EventArgs e)
        {
            if (_logTextBox == null || _logTextBox.IsDisposed || string.IsNullOrEmpty(_logTextBox.Text)) return;
            try
            {
                Clipboard.SetText(_logTextBox.Text);
                _copyLogButton.Text = "Copied!";
                _copyLogFeedbackTicks = 2;
            }
            catch (Exception ex)
            {
                AppendLog("Could not copy logs to clipboard: " + ex.Message);
            }
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
                string updatedPaths = updated.TargetPaths != null && updated.TargetPaths.Count > 0
                    ? string.Join(", ", updated.TargetPaths.ToArray())
                    : updated.FilePath;
                AppendLog(string.Format(
                    CultureInfo.InvariantCulture,
                    "Updated {0} with EDEN_NX2_DEBUG_SERVER={1}:{2}.",
                    updatedPaths,
                    host,
                    port));

                string runningEmulator = LichiiConfigManager.DetectRunningEmulator();
                _syncFeedbackTicks = 5;
                _lichiiStepDetailLabel.Text = runningEmulator != null
                    ? string.Format(CultureInfo.InvariantCulture, "Live sync configured ({0}:{1}) \u2014 restart {2} to apply.", host, port, runningEmulator)
                    : string.Format(CultureInfo.InvariantCulture, "Live sync configured ({0}:{1}). Load Ocarina of Time in Lichii/Fritchii.", host, port);
                _lichiiStepDetailLabel.ForeColor = Theme.Moss;

                RefreshLichiiConfigStatus();
                TriggerPollNow();
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
            if (_lanStatusLabel == null || _lanUrlLink == null || _copyLanUrlButton == null || _lanComboBox == null || _qrButton == null) return;

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
                _qrButton.Enabled = false;
                _qrButton.ForeColor = Theme.Parchment600;
                _qrButton.FlatAppearance.BorderColor = Theme.Ink700;
                if (_lanFeedbackTicks == 0)
                {
                    _lanHintLabel.Text = "Enable \"Allow LAN access\" in Settings to connect a tablet or phone.";
                    _lanHintLabel.ForeColor = Theme.Parchment400;
                }
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
                _qrButton.Enabled = false;
                _qrButton.ForeColor = Theme.Parchment600;
                _qrButton.FlatAppearance.BorderColor = Theme.Ink700;
                if (_lanFeedbackTicks == 0)
                {
                    _lanHintLabel.Text = "Connect your PC to Wi-Fi or Ethernet, then click Refresh.";
                    _lanHintLabel.ForeColor = Theme.Parchment400;
                }
                return;
            }

            _copyLanUrlButton.Enabled = true;
            _qrButton.Enabled = true;
            _qrButton.ForeColor = Theme.Gold;
            _qrButton.FlatAppearance.BorderColor = Theme.Gold;

            if (_lanEndpoints.Count > 1)
            {
                _lanUrlLink.Visible = false;
                _lanStatusLabel.Visible = false;
                _lanComboBox.Visible = true;
                if (_lanFeedbackTicks == 0)
                {
                    _lanHintLabel.Text = "Multiple network adapters found \u2014 pick the one your tablet or phone uses.";
                    _lanHintLabel.ForeColor = Theme.Parchment400;
                }
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

                if (_lanFeedbackTicks == 0)
                {
                    _lanHintLabel.Text = "Open this address or click QR Code to connect your tablet, iPad, or phone.";
                    _lanHintLabel.ForeColor = Theme.Parchment400;
                }
            }
        }

        private void OnQrButtonClick(object sender, EventArgs e)
        {
            if (string.IsNullOrEmpty(_selectedLanUrl)) return;

            Bitmap largeBmp = QrCodeEncoder.RenderBitmap(_selectedLanUrl, Theme.ScaleDpi(280, _dpiScale));
            if (largeBmp == null) return;

            using (largeBmp)
            using (Form modal = new Form())
            {
                modal.SuspendLayout();
                modal.Text = "Scan QR Code \u2014 Ocarina Atlas";
                modal.BackColor = Theme.Ink950;
                modal.ForeColor = Theme.Parchment200;
                modal.AutoScaleDimensions = new SizeF(96F, 96F);
                modal.AutoScaleMode = AutoScaleMode.Dpi;
                modal.Font = new Font("Segoe UI", 9f, FontStyle.Regular);
                modal.FormBorderStyle = FormBorderStyle.FixedDialog;
                modal.StartPosition = FormStartPosition.CenterParent;
                modal.MaximizeBox = false;
                modal.MinimizeBox = false;
                modal.ShowInTaskbar = false;
                modal.ClientSize = new Size(328, 376);
                if (_appIcon != null) modal.Icon = _appIcon;
                Theme.EnableDarkTitleBar(modal);

                PictureBox largeBox = new PictureBox();
                largeBox.Location = new Point(24, 16);
                largeBox.Size = new Size(280, 280);
                largeBox.BackColor = Color.White;
                largeBox.SizeMode = PictureBoxSizeMode.Zoom;
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

                modal.ResumeLayout(false);
                modal.PerformLayout();
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
                _firewallButton.FlatAppearance.BorderColor = Theme.Ink700;
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
                _firewallButton.FlatAppearance.BorderColor = Theme.Ink700;
            }
        }

        private void OnAllowFirewallClick(object sender, EventArgs e)
        {
            int port = GetEffectivePort();
            if (_firewallCheckedPort == port && _firewallAllowed)
            {
                _lanFeedbackTicks = 4;
                _lanHintLabel.Text = string.Format(
                    CultureInfo.InvariantCulture,
                    "Windows Firewall rule \"{0}\" is already active (Private networks).",
                    LanNetworkHelper.GetFirewallRuleName(port));
                _lanHintLabel.ForeColor = Theme.Moss;
                AppendLog(string.Format(
                    CultureInfo.InvariantCulture,
                    "Windows Firewall rule \"{0}\" is already present for Private networks.",
                    LanNetworkHelper.GetFirewallRuleName(port)));
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
                _lanFeedbackTicks = 5;
                _lanHintLabel.Text = string.Format(
                    CultureInfo.InvariantCulture,
                    "Firewall rule added for TCP port {0} (Private networks).",
                    port);
                _lanHintLabel.ForeColor = Theme.Moss;
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
                string longshotSaveDir = ResolveLongshotSaveDir();
                if (!string.IsNullOrEmpty(longshotSaveDir))
                {
                    psi.EnvironmentVariables["LONGSHOT_SAVE_DIR"] = longshotSaveDir;
                }
                if (string.IsNullOrEmpty(Environment.GetEnvironmentVariable("NX2SARIA_SAVE_DIR")))
                {
                    string nx2sariaProfileDir = ResolveNx2SariaProfileDir();
                    if (!string.IsNullOrEmpty(nx2sariaProfileDir))
                    {
                        psi.EnvironmentVariables["NX2SARIA_SAVE_DIR"] = nx2sariaProfileDir;
                    }
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
            _isShuttingDown = true;
            if (_pollTimer != null)
            {
                _pollTimer.Stop();
                _pollTimer.Dispose();
            }

            StopLongshotBridge();

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
            if (_settingsLockHintLabel != null)
            {
                _settingsLockHintLabel.Visible = _activeDrawerTab == 0 && !isStopped;
            }

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
                    _serverStatusPill.BorderColor = Theme.Ember;
                    _heroSummaryLabel.Text = "Could not start the map server. Check Settings, Logs & About for details.";
                }
                else
                {
                    _serverDot.DotColor = Theme.Parchment600;
                    _serverStatusLabel.Text = "Stopped";
                    _serverStatusLabel.ForeColor = Theme.Parchment400;
                    _serverStatusPill.BorderColor = Theme.Ink700;
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
                _serverStatusPill.BorderColor = Theme.Ember;
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
                _serverStatusPill.BorderColor = Theme.Moss;
                _heroSummaryLabel.Text = "Map is live and ready in your browser.";
                _serverUrlLink.Text = GetServerUrl();
                _serverUrlLink.Visible = true;
            }
            else if (isStopping)
            {
                _startStopButton.Text = "Stopping...";
                _startStopButton.Enabled = false;
                _startStopButton.BackColor = Theme.Ink800;
                _startStopButton.ForeColor = Theme.Parchment400;
                _startStopButton.FlatAppearance.BorderColor = Theme.Ink700;

                _serverDot.DotColor = Theme.Ember;
                _serverStatusLabel.Text = "Stopping...";
                _serverStatusLabel.ForeColor = Theme.Ember;
                _serverStatusPill.BorderColor = Theme.Ember;
                _heroSummaryLabel.Text = "Shutting down the map server...";
                _serverUrlLink.Visible = false;
            }

            _serverStatusPill.Invalidate();
            _openBrowserButton.Enabled = isRunning;
            if (isRunning)
            {
                _openBrowserButton.ForeColor = Theme.Gold;
                _openBrowserButton.FlatAppearance.BorderColor = Theme.Gold;
            }
            else
            {
                _openBrowserButton.ForeColor = Theme.Parchment600;
                _openBrowserButton.FlatAppearance.BorderColor = Theme.Ink700;
            }

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
            if (_copyLogFeedbackTicks > 0)
            {
                _copyLogFeedbackTicks--;
                if (_copyLogFeedbackTicks == 0 && _copyLogButton != null)
                {
                    _copyLogButton.Text = "Copy";
                }
            }
            if (_syncFeedbackTicks > 0)
            {
                _syncFeedbackTicks--;
            }
            if (_lanFeedbackTicks > 0)
            {
                _lanFeedbackTicks--;
            }
            RefreshLanDisplays();
            TriggerPollNow();
        }

        private string ResolveLongshotSaveDir()
        {
            string bridgeDir = null;
            lock (_bridgeLock)
            {
                if (_longshotBridge != null)
                {
                    bridgeDir = _longshotBridge.DetectedUserSaveDir;
                }
            }
            if (!string.IsNullOrEmpty(bridgeDir) && Directory.Exists(bridgeDir))
            {
                return bridgeDir;
            }

            string runningDir = LongshotRpcBridge.DetectRunningUserSaveDir();
            if (!string.IsNullOrEmpty(runningDir) && Directory.Exists(runningDir))
            {
                return runningDir;
            }

            const string defaultLongshotDir = @"E:\Longshot\Game\user";
            if (Directory.Exists(defaultLongshotDir))
            {
                return defaultLongshotDir;
            }

            return null;
        }

        // NX2Saria serves the debug RPC on 127.0.0.1:6545 itself, so only its save folder is detected:
        // the profile folder beside ocarina.exe (installed builds) or nx2saria.exe (developer builds).
        private static string ResolveNx2SariaProfileDir()
        {
            string[] names = new[] { "ocarina", "nx2saria" };
            string found = null;
            for (int n = 0; n < names.Length && found == null; n++)
            {
                Process[] procs = null;
                try
                {
                    procs = Process.GetProcessesByName(names[n]);
                }
                catch
                {
                    procs = null;
                }

                if (procs == null) continue;

                for (int i = 0; i < procs.Length; i++)
                {
                    Process proc = procs[i];
                    if (proc == null) continue;
                    try
                    {
                        if (found == null)
                        {
                            ProcessModule mod = proc.MainModule;
                            string exePath = mod != null ? mod.FileName : null;
                            if (!string.IsNullOrEmpty(exePath))
                            {
                                string profileDir = Path.Combine(Path.GetDirectoryName(exePath), "profile");
                                if (Directory.Exists(Path.Combine(profileDir, "save")))
                                {
                                    found = profileDir;
                                }
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
            }

            return found;
        }

        private void StopLongshotBridge()
        {
            lock (_bridgeLock)
            {
                if (_longshotBridge != null)
                {
                    _longshotBridge.Dispose();
                    _longshotBridge = null;
                }
            }
        }

        private static bool IsBridgeLoopbackHost(string host)
        {
            if (string.IsNullOrEmpty(host)) return true;
            string normalized = host.Trim();
            return string.Equals(normalized, "127.0.0.1", StringComparison.OrdinalIgnoreCase) ||
                   string.Equals(normalized, "localhost", StringComparison.OrdinalIgnoreCase);
        }

        private void ManageLongshotBridge(string lichiiHost, int lichiiPort)
        {
            if (_isShuttingDown) return;

            bool isLoopback = IsBridgeLoopbackHost(lichiiHost);
            string logMsg = null;

            lock (_bridgeLock)
            {
                if (_isShuttingDown) return;

                if (_longshotBridge != null)
                {
                    bool processAlive = _longshotBridge.IsProcessAlive;
                    bool portOrHostMismatch = !isLoopback || _longshotBridge.Port != lichiiPort;
                    if (portOrHostMismatch || !processAlive)
                    {
                        int oldPid = _longshotBridge.ProcessId;
                        int oldPort = _longshotBridge.Port;
                        _longshotBridge.Dispose();
                        _longshotBridge = null;

                        if (portOrHostMismatch)
                        {
                            logMsg = string.Format(
                                CultureInfo.InvariantCulture,
                                "Stopped Longshot RPC bridge on 127.0.0.1:{0} due to RPC target change.",
                                oldPort);
                        }
                        else
                        {
                            logMsg = string.Format(
                                CultureInfo.InvariantCulture,
                                "Longshot process (PID {0}) exited; freed TCP port {1}.",
                                oldPid,
                                oldPort);
                        }
                    }
                }

                if (_longshotBridge == null && isLoopback && lichiiPort >= 1 && lichiiPort <= 65535)
                {
                    if (!ProbeTcpPort("127.0.0.1", lichiiPort, 120))
                    {
                        LongshotRpcBridge candidate = LongshotRpcBridge.TryFindLongshotProcess();
                        if (candidate != null)
                        {
                            if (candidate.Start(lichiiPort))
                            {
                                _longshotBridge = candidate;
                                string saveNote = string.IsNullOrEmpty(candidate.DetectedUserSaveDir)
                                    ? "no user save dir"
                                    : candidate.DetectedUserSaveDir;
                                string startMsg = string.Format(
                                    CultureInfo.InvariantCulture,
                                    "Started read-only Longshot RPC bridge on 127.0.0.1:{0} (PID {1}, saves: {2}).",
                                    lichiiPort,
                                    candidate.ProcessId,
                                    saveNote);
                                logMsg = logMsg != null ? (logMsg + " " + startMsg) : startMsg;
                            }
                            else
                            {
                                candidate.Dispose();
                            }
                        }
                    }
                }
            }

            if (!string.IsNullOrEmpty(logMsg))
            {
                string msgToLog = logMsg;
                BeginInvokeSafe(delegate { AppendLog(msgToLog); });
            }
        }

        private void TriggerPollNow()
        {
            if (IsDisposed || !IsHandleCreated || _isShuttingDown) return;
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
                    ManageLongshotBridge(lichiiHost, lichiiPort);
                    PollSnapshot snap = FetchStatusSnapshot(serverActive, serverPort, lichiiHost, lichiiPort);
                    BeginInvokeSafe(delegate { ApplyPollSnapshot(snap); });
                }
                finally
                {
                    Interlocked.Exchange(ref _pollInFlight, 0);
                }
            });
        }

        private static string FormatEmulatorDisplayName(string emulatorKind)
        {
            if (string.Equals(emulatorKind, "longshot", StringComparison.OrdinalIgnoreCase)) return "Longshot";
            if (string.Equals(emulatorKind, "relink", StringComparison.OrdinalIgnoreCase)) return "Project ReLink";
            if (string.Equals(emulatorKind, "triforce", StringComparison.OrdinalIgnoreCase)) return "Triforce";
            if (string.Equals(emulatorKind, "nx2saria", StringComparison.OrdinalIgnoreCase)) return "NX2Saria";
            if (string.Equals(emulatorKind, "heylisten", StringComparison.OrdinalIgnoreCase)) return "HeyListen";
            if (string.Equals(emulatorKind, "fritchii", StringComparison.OrdinalIgnoreCase)) return "Fritchii";
            if (string.Equals(emulatorKind, "cheezyemu", StringComparison.OrdinalIgnoreCase)) return "CheezyEmu";
            if (string.Equals(emulatorKind, "lichii", StringComparison.OrdinalIgnoreCase)) return "Lichii";
            if (string.Equals(emulatorKind, "eden", StringComparison.OrdinalIgnoreCase)) return "Eden";
            return emulatorKind;
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
                                    snap.RpcPortOpen = snap.Connected || ProbeTcpPort(lichiiHost, lichiiPort, 150);
                                    snap.RunningEmulator = LichiiConfigManager.DetectRunningEmulator();
                                    if (snap.Connected && string.IsNullOrEmpty(snap.RunningEmulator))
                                    {
                                        string emuKind = SimpleJsonParser.GetString(obj, "emulator");
                                        if (!string.IsNullOrEmpty(emuKind))
                                        {
                                            snap.RunningEmulator = FormatEmulatorDisplayName(emuKind);
                                        }
                                    }
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
                _syncFeedbackTicks = 0;
                _heroLichiiDot.DotColor = Theme.Moss;
                _heroLichiiLabel.Text = "Live Sync";
                _heroLichiiLabel.ForeColor = Theme.Moss;
                _emulatorStatusPill.BorderColor = Theme.Moss;
                string fullEmuTip = emuName + ": Live Sync";
                _toolTip.SetToolTip(_emulatorStatusPill, fullEmuTip);
                _toolTip.SetToolTip(_heroLichiiLabel, fullEmuTip);

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
                    parts.Add(string.Format(CultureInfo.InvariantCulture, "{0}/100 GS", snap.SkulltulaCount.Value));
                }

                _lichiiStepDetailLabel.Text = parts.Count > 0
                    ? string.Join("  \u00B7  ", parts.ToArray())
                    : "Streaming live player coordinates from " + emuName + ".";
                _lichiiStepDetailLabel.ForeColor = Theme.Parchment200;
            }
            else if ((snap.ServerHttpOk && snap.Connected) || snap.RpcPortOpen)
            {
                _heroLichiiDot.DotColor = Theme.Ember;
                _heroLichiiLabel.Text = "Waiting";
                _heroLichiiLabel.ForeColor = Theme.Ember;
                _emulatorStatusPill.BorderColor = Theme.Ember;
                string fullEmuTip = emuName + ": Waiting for game";
                _toolTip.SetToolTip(_emulatorStatusPill, fullEmuTip);
                _toolTip.SetToolTip(_heroLichiiLabel, fullEmuTip);

                if (_syncFeedbackTicks == 0)
                {
                    if (snap.ServerHttpOk && string.Equals(snap.Source, "save", StringComparison.OrdinalIgnoreCase) && snap.SkulltulaCount.HasValue)
                    {
                        _lichiiStepDetailLabel.Text = string.Format(
                            CultureInfo.InvariantCulture,
                            "Save loaded ({0}/100 GS) \u2014 start Ocarina of Time in {1} for live sync.",
                            snap.SkulltulaCount.Value,
                            emuName);
                    }
                    else
                    {
                        _lichiiStepDetailLabel.Text = emuName + " is ready. Load your Ocarina of Time save to start live sync.";
                    }
                    _lichiiStepDetailLabel.ForeColor = Theme.Parchment400;
                }
            }
            else if (!string.IsNullOrEmpty(snap.RunningEmulator))
            {
                bool isRecomp = string.Equals(snap.RunningEmulator, "Longshot", StringComparison.OrdinalIgnoreCase) ||
                                string.Equals(snap.RunningEmulator, "Project ReLink", StringComparison.OrdinalIgnoreCase) ||
                                string.Equals(snap.RunningEmulator, "Triforce", StringComparison.OrdinalIgnoreCase) ||
                                string.Equals(snap.RunningEmulator, "HeyListen", StringComparison.OrdinalIgnoreCase);
                _heroLichiiDot.DotColor = Theme.Ember;
                _heroLichiiLabel.Text = isRecomp ? "Waiting" : "RPC Closed";
                _heroLichiiLabel.ForeColor = Theme.Ember;
                _emulatorStatusPill.BorderColor = Theme.Ember;
                string fullEmuTip = isRecomp ? (snap.RunningEmulator + ": Waiting for game") : (snap.RunningEmulator + ": RPC closed");
                _toolTip.SetToolTip(_emulatorStatusPill, fullEmuTip);
                _toolTip.SetToolTip(_heroLichiiLabel, fullEmuTip);

                if (_syncFeedbackTicks == 0)
                {
                    if (isRecomp)
                    {
                        string currentHost = _lifecycle == ServerLifecycle.Stopped
                            ? ((_lichiiHostInput.Text ?? string.Empty).Trim())
                            : _activeLichiiHost;
                        _lichiiStepDetailLabel.Text = IsBridgeLoopbackHost(currentHost)
                            ? (snap.RunningEmulator + " detected \u2014 load Ocarina of Time to start the read-only live sync bridge.")
                            : (snap.RunningEmulator + " detected \u2014 set Emulator RPC Host to 127.0.0.1 for automatic live sync.");
                    }
                    else if (_lichiiConfigured)
                    {
                        _lichiiStepDetailLabel.Text = "Restart " + snap.RunningEmulator + " so its debug server starts on the configured port.";
                    }
                    else
                    {
                        _lichiiStepDetailLabel.Text = "Click 1-Click Setup Sync, then restart " + snap.RunningEmulator + " to enable live tracking.";
                    }
                    _lichiiStepDetailLabel.ForeColor = Theme.Parchment200;
                }
            }
            else
            {
                _heroLichiiDot.DotColor = Theme.Parchment600;
                _heroLichiiLabel.Text = "No Emu";
                _heroLichiiLabel.ForeColor = Theme.Parchment400;
                _emulatorStatusPill.BorderColor = Theme.Ink700;
                _toolTip.SetToolTip(_emulatorStatusPill, "Emulator: Not detected");
                _toolTip.SetToolTip(_heroLichiiLabel, "Emulator: Not detected");

                if (_syncFeedbackTicks == 0)
                {
                    if (snap.ServerHttpOk && string.Equals(snap.Source, "save", StringComparison.OrdinalIgnoreCase) && snap.SkulltulaCount.HasValue)
                    {
                        _lichiiStepDetailLabel.Text = string.Format(
                            CultureInfo.InvariantCulture,
                            "Save data found ({0}/100 GS) \u2014 open Lichii or Fritchii for live tracking.",
                            snap.SkulltulaCount.Value);
                        _lichiiStepDetailLabel.ForeColor = Theme.Parchment400;
                    }
                    else if (_lichiiConfigured)
                    {
                        _lichiiStepDetailLabel.Text = "Live sync configured. Start Lichii or Fritchii and load Ocarina of Time.";
                        _lichiiStepDetailLabel.ForeColor = Theme.Parchment400;
                    }
                    else
                    {
                        _lichiiStepDetailLabel.Text = "Click 1-Click Setup Sync so the map can follow Link automatically.";
                        _lichiiStepDetailLabel.ForeColor = Theme.Parchment200;
                    }
                }
            }

            _emulatorStatusPill.Invalidate();
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
            _isShuttingDown = true;
            if (_pollTimer != null)
            {
                _pollTimer.Stop();
                _pollTimer.Dispose();
            }

            StopLongshotBridge();

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

        private void StartUpdateCheck(bool userInitiated)
        {
            if (_updateCheckInFlight) return;
            _updateCheckInFlight = true;

            if (userInitiated && _updateStatusLabel != null && _checkUpdatesLink != null)
            {
                _checkUpdatesLink.Enabled = false;
                _updateStatusLabel.Text = "Checking for updates...";
                _updateStatusLabel.ForeColor = Theme.Parchment400;
            }

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
                        if (resp.StatusCode != HttpStatusCode.OK)
                        {
                            throw new InvalidOperationException("HTTP " + (int)resp.StatusCode);
                        }
                        if (resp.ResponseUri == null || !UpdateManager.IsAllowedUpdateFeedUrl(resp.ResponseUri.AbsoluteUri))
                        {
                            throw new InvalidOperationException("Update feed redirect pointed to an untrusted URL.");
                        }
                        using (Stream stream = resp.GetResponseStream())
                        {
                            if (stream == null)
                            {
                                throw new InvalidOperationException("Empty response stream.");
                            }
                            using (StreamReader reader = new StreamReader(stream, Encoding.UTF8))
                            {
                                body = reader.ReadToEnd();
                            }
                        }
                    }

                    UpdateInfo info = UpdateManager.ParseReleaseJson(body, AppVersion, feedUrl);
                    if (info == null)
                    {
                        BeginInvokeSafe(delegate()
                        {
                            _updateCheckInFlight = false;
                            if (_checkUpdatesLink != null) _checkUpdatesLink.Enabled = true;
                            if (userInitiated && _updateStatusLabel != null)
                            {
                                _updateStatusLabel.Text = "You are on the latest version (v" + AppVersion + ").";
                                _updateStatusLabel.ForeColor = Theme.Moss;
                                AppendLog("Checked for updates: already on latest version v" + AppVersion + ".");
                            }
                        });
                        return;
                    }

                    string skippedVersion = UpdateManager.ReadSkippedVersion();
                    bool shouldAutoOpen = userInitiated || !string.Equals(info.DisplayTag, skippedVersion, StringComparison.OrdinalIgnoreCase);

                    BeginInvokeSafe(delegate()
                    {
                        _updateCheckInFlight = false;
                        if (_checkUpdatesLink != null) _checkUpdatesLink.Enabled = true;
                        if (_updatePill == null || _updatePill.IsDisposed) return;

                        _pendingUpdateInfo = info;
                        _updatePill.Visible = true;
                        string updateTip = "Update available: " + info.DisplayTag + " (click to view)";
                        _toolTip.SetToolTip(_updatePill, updateTip);
                        if (_updatePillLabel != null) _toolTip.SetToolTip(_updatePillLabel, updateTip);

                        if (_updateStatusLabel != null)
                        {
                            _updateStatusLabel.Text = "Update available: " + info.DisplayTag;
                            _updateStatusLabel.ForeColor = Theme.Gold;
                        }

                        if (shouldAutoOpen)
                        {
                            ShowUpdateDialog();
                        }
                    });
                }
                catch (Exception ex)
                {
                    BeginInvokeSafe(delegate()
                    {
                        _updateCheckInFlight = false;
                        if (_checkUpdatesLink != null) _checkUpdatesLink.Enabled = true;
                        if (userInitiated && _updateStatusLabel != null)
                        {
                            _updateStatusLabel.Text = "Could not check for updates.";
                            _updateStatusLabel.ForeColor = Theme.Ember;
                            AppendLog("Manual update check failed: " + ex.Message);
                        }
                    });
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

        private void OnUpdatePillClick(object sender, EventArgs e)
        {
            if (_pendingUpdateInfo != null)
            {
                ShowUpdateDialog();
            }
        }

        private void OnCheckUpdatesClick(object sender, LinkLabelLinkClickedEventArgs e)
        {
            StartUpdateCheck(true);
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
