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
[assembly: AssemblyVersion("2.5.1.0")]
[assembly: AssemblyFileVersion("2.5.1.0")]

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
        public bool PortExplicit = false;
        public string LichiiHost = "127.0.0.1";
        public bool LichiiHostExplicit = false;
        public int LichiiPort = 6545;
        public bool LichiiPortExplicit = false;
        public bool AllowLan = true;
        public bool AllowLanExplicit = false;
        public string BindHost = null;
        public bool AutoOpenBrowser = true;
        public bool AutoOpenBrowserExplicit = false;
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
                        opts.PortExplicit = true;
                    }
                }
                else if (string.Equals(key, "--lichii-host", StringComparison.OrdinalIgnoreCase))
                {
                    string raw = value ?? (i + 1 < args.Length ? args[++i] : null);
                    if (!string.IsNullOrEmpty(raw))
                    {
                        opts.LichiiHost = raw.Trim();
                        opts.LichiiHostExplicit = true;
                    }
                }
                else if (string.Equals(key, "--lichii-port", StringComparison.OrdinalIgnoreCase))
                {
                    string raw = value ?? (i + 1 < args.Length ? args[++i] : null);
                    int parsed;
                    if (int.TryParse(raw, out parsed) && parsed >= 1 && parsed <= 65535)
                    {
                        opts.LichiiPort = parsed;
                        opts.LichiiPortExplicit = true;
                    }
                }
                else if (string.Equals(key, "--lan", StringComparison.OrdinalIgnoreCase))
                {
                    opts.AllowLan = true;
                    opts.AllowLanExplicit = true;
                    opts.BindHost = null;
                }
                else if (string.Equals(key, "--local-only", StringComparison.OrdinalIgnoreCase) ||
                         string.Equals(key, "--localhost", StringComparison.OrdinalIgnoreCase))
                {
                    opts.AllowLan = false;
                    opts.AllowLanExplicit = true;
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
                        opts.AllowLanExplicit = true;
                    }
                }
                else if (string.Equals(key, "--no-browser", StringComparison.OrdinalIgnoreCase))
                {
                    opts.AutoOpenBrowser = false;
                    opts.AutoOpenBrowserExplicit = true;
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

                        string procKey = ProcessNames[n];
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

    internal sealed class LocaleOption
    {
        public readonly string Code;
        public readonly string DisplayName;

        public LocaleOption(string code, string displayName)
        {
            Code = code;
            DisplayName = displayName;
        }

        public override string ToString()
        {
            return DisplayName;
        }
    }

    internal static class LauncherI18n
    {
        public static readonly LocaleOption[] SupportedLocales = new LocaleOption[]
        {
            new LocaleOption("en", "English"),
            new LocaleOption("es", "Espa\u00F1ol"),
            new LocaleOption("fr", "Fran\u00E7ais"),
            new LocaleOption("pt", "Portugu\u00EAs"),
            new LocaleOption("zh-CN", "\u7B80\u4F53\u4E2D\u6587"),
            new LocaleOption("zh-TW", "\u7E41\u9AD4\u4E2D\u6587"),
            new LocaleOption("de", "Deutsch"),
            new LocaleOption("it", "Italiano"),
            new LocaleOption("ja", "\u65E5\u672C\u8A9E"),
            new LocaleOption("ko", "\uD55C\uAD6D\uC5B4"),
            new LocaleOption("nl", "Nederlands"),
            new LocaleOption("ru", "\u0420\u0443\u0441\u0441\u043A\u0438\u0439"),
            new LocaleOption("pl", "Polski"),
            new LocaleOption("tr", "T\u00FCrk\u00E7e"),
            new LocaleOption("uk", "\u0423\u043A\u0440\u0430\u0457\u043D\u0441\u044C\u043A\u0430")
        };

        private static readonly Dictionary<string, Dictionary<string, string>> Strings = BuildStrings();

        public static string DetectSystemLocale()
        {
            try
            {
                string ui = CultureInfo.CurrentUICulture != null ? CultureInfo.CurrentUICulture.Name : string.Empty;
                if (!string.IsNullOrEmpty(ui))
                {
                    return NormalizeLocale(ui);
                }
                string current = CultureInfo.CurrentCulture != null ? CultureInfo.CurrentCulture.Name : string.Empty;
                if (!string.IsNullOrEmpty(current))
                {
                    return NormalizeLocale(current);
                }
            }
            catch
            {
                // Fall back to English if culture inspection fails.
            }
            return "en";
        }

        public static string NormalizeLocale(string raw)
        {
            if (string.IsNullOrEmpty(raw)) return "en";
            string normalized = raw.Trim().Replace('_', '-');
            if (string.IsNullOrEmpty(normalized)) return "en";

            for (int i = 0; i < SupportedLocales.Length; i++)
            {
                if (string.Equals(SupportedLocales[i].Code, normalized, StringComparison.OrdinalIgnoreCase))
                {
                    return SupportedLocales[i].Code;
                }
            }

            string lower = normalized.ToLowerInvariant();
            if (lower.StartsWith("zh-", StringComparison.Ordinal) || string.Equals(lower, "zh", StringComparison.Ordinal))
            {
                if (lower.IndexOf("hant", StringComparison.Ordinal) >= 0 ||
                    lower.IndexOf("-tw", StringComparison.Ordinal) >= 0 ||
                    lower.IndexOf("-hk", StringComparison.Ordinal) >= 0 ||
                    lower.IndexOf("-mo", StringComparison.Ordinal) >= 0)
                {
                    return "zh-TW";
                }
                return "zh-CN";
            }

            int dash = lower.IndexOf('-');
            string prefix = dash > 0 ? lower.Substring(0, dash) : lower;
            for (int i = 0; i < SupportedLocales.Length; i++)
            {
                if (string.Equals(SupportedLocales[i].Code, prefix, StringComparison.OrdinalIgnoreCase))
                {
                    return SupportedLocales[i].Code;
                }
            }

            return "en";
        }

        public static string Get(string locale, string key)
        {
            if (string.IsNullOrEmpty(key)) return string.Empty;
            string code = NormalizeLocale(locale);
            Dictionary<string, string> table;
            string value;
            if (Strings.TryGetValue(code, out table) && table.TryGetValue(key, out value))
            {
                return value;
            }
            if (!string.Equals(code, "en", StringComparison.Ordinal) &&
                Strings.TryGetValue("en", out table) && table.TryGetValue(key, out value))
            {
                return value;
            }
            return key;
        }

        public static string Format(string locale, string key, params object[] args)
        {
            string template = Get(locale, key);
            if (args == null || args.Length == 0) return template;
            try
            {
                return string.Format(CultureInfo.InvariantCulture, template, args);
            }
            catch
            {
                return template;
            }
        }

        private static Dictionary<string, Dictionary<string, string>> BuildStrings()
        {
            Dictionary<string, Dictionary<string, string>> map =
                new Dictionary<string, Dictionary<string, string>>(StringComparer.OrdinalIgnoreCase);

            Dictionary<string, string> en = new Dictionary<string, string>(StringComparer.Ordinal);
            en["app_title"] = "Ocarina Atlas \u2014 Ocarina of Time Map Tracker";
            en["start_map"] = "Start Map";
            en["stop_map"] = "Stop Map";
            en["stopping"] = "Stopping...";
            en["open_map"] = "Open Map";
            en["setup_sync"] = "1-Click Setup Sync";
            en["setup_sync_port"] = "Setup Sync (:{0})";
            en["configured"] = "Configured \u21BB";
            en["configured_port"] = "Configured (:{0}) \u21BB";
            en["hero_idle"] = "Click Start Map to open the interactive Hyrule map in your browser.";
            en["hero_starting"] = "Starting the local map server...";
            en["hero_running"] = "Map is live and ready in your browser.";
            en["hero_stopping"] = "Shutting down the map server...";
            en["hero_error"] = "Could not start the map server. Check Settings, Logs & About for details.";
            en["sync_hint_default"] = "Click 1-Click Setup Sync to enable live tracking in Lichii / Fritchii.";
            en["sync_hint_configured"] = "Live sync configured. Start Lichii or Fritchii and load Ocarina of Time.";
            en["status_stopped"] = "Stopped";
            en["status_running"] = "Running";
            en["status_starting"] = "Starting";
            en["status_stopping"] = "Stopping...";
            en["status_error"] = "Error";
            en["emu_none"] = "No Emu";
            en["emu_live"] = "Live";
            en["emu_waiting"] = "Waiting";
            en["emu_save"] = "Save";
            en["emu_rpc_closed"] = "RPC Closed";
            en["lan_title"] = "Second Screen (LAN)";
            en["copy_url"] = "Copy URL";
            en["copied"] = "Copied!";
            en["qr_code"] = "QR Code";
            en["allow_firewall"] = "Allow Firewall";
            en["firewall_ready"] = "Firewall Ready";
            en["localhost_only"] = "Localhost Only";
            en["configuring"] = "Configuring...";
            en["refresh"] = "Refresh";
            en["lan_hint_default"] = "Open this address or click QR Code to connect your tablet, iPad, or phone.";
            en["lan_hint_disabled"] = "Enable \"Allow LAN access\" in Settings to connect a tablet or phone.";
            en["lan_hint_no_adapter"] = "Connect your PC to Wi-Fi or Ethernet, then click Refresh.";
            en["lan_hint_multi"] = "Multiple network adapters found \u2014 pick the one your tablet or phone uses.";
            en["lan_disabled"] = "Disabled (localhost only \u2014 127.0.0.1)";
            en["lan_no_adapter"] = "No active Wi-Fi or Ethernet connection detected";
            en["lan_checking"] = "Checking network adapters...";
            en["drawer_title"] = "Settings, Logs & About";
            en["tab_settings"] = "Settings";
            en["tab_logs"] = "Logs";
            en["tab_about"] = "About";
            en["settings_lock_hint"] = "Stop server to edit port or host settings";
            en["map_port"] = "Map Port";
            en["rpc_host"] = "Emulator RPC Host";
            en["rpc_port"] = "Emulator RPC Port";
            en["reset"] = "Reset";
            en["allow_lan"] = "Allow LAN access";
            en["auto_open"] = "Auto-open browser";
            en["minimize_tray"] = "Minimize to tray";
            en["save_folder"] = "Save Folder";
            en["auto_detect"] = "Auto-detect";
            en["add_ellipsis"] = "Add...";
            en["remove"] = "Remove";
            en["save_slot"] = "Save Slot";
            en["auto_latest"] = "Auto (Latest)";
            en["language"] = "Language";
            en["check_updates"] = "Check for Updates";
            en["version_label"] = "Version {0}";
            en["copy_logs"] = "Copy Logs";
            en["clear"] = "Clear";
            en["about_original_map"] = "Original Map";
            en["about_artwork"] = "Map Artwork";
            en["about_security"] = "Free & open-source (GNU AGPL-3.0). Official builds: github.com/antonioalvromero/Ocarina-Atlas \u2014 forks must preserve credits and share source.";
            en["about_footer"] = "Version {0}  \u2022  Verify official releases via SHA-256 or GitHub attestation";
            en["tray_show"] = "Show Ocarina Atlas";
            en["tray_open"] = "Open Map in Browser";
            en["tray_exit"] = "Exit";
            en["update_pill"] = "Update";
            map["en"] = en;

            Dictionary<string, string> es = new Dictionary<string, string>(StringComparer.Ordinal);
            es["app_title"] = "Ocarina Atlas \u2014 Mapa de Ocarina of Time";
            es["start_map"] = "Iniciar mapa";
            es["stop_map"] = "Detener mapa";
            es["stopping"] = "Deteniendo...";
            es["open_map"] = "Abrir mapa";
            es["setup_sync"] = "Configurar Sync (1 clic)";
            es["setup_sync_port"] = "Configurar Sync (:{0})";
            es["configured"] = "Configurado \u21BB";
            es["configured_port"] = "Configurado (:{0}) \u21BB";
            es["hero_idle"] = "Haz clic en Iniciar mapa para abrir el mapa interactivo de Hyrule en tu navegador.";
            es["hero_starting"] = "Iniciando el servidor local del mapa...";
            es["hero_running"] = "El mapa est\u00E1 activo y listo en tu navegador.";
            es["hero_stopping"] = "Deteniendo el servidor del mapa...";
            es["hero_error"] = "No se pudo iniciar el servidor. Revisa Ajustes, Registros y Acerca de.";
            es["sync_hint_default"] = "Haz clic en Configurar Sync (1 clic) para activar el seguimiento en vivo.";
            es["sync_hint_configured"] = "Sync en vivo configurado. Inicia Lichii o Fritchii y carga Ocarina of Time.";
            es["status_stopped"] = "Detenido";
            es["status_running"] = "Activo";
            es["status_starting"] = "Iniciando";
            es["status_stopping"] = "Deteniendo...";
            es["status_error"] = "Error";
            es["emu_none"] = "Sin emu";
            es["emu_live"] = "En vivo";
            es["emu_waiting"] = "Esperando";
            es["emu_save"] = "Guardado";
            es["emu_rpc_closed"] = "RPC cerrado";
            es["lan_title"] = "Segunda pantalla (LAN)";
            es["copy_url"] = "Copiar URL";
            es["copied"] = "\u00A1Copiado!";
            es["qr_code"] = "C\u00F3digo QR";
            es["allow_firewall"] = "Permitir firewall";
            es["firewall_ready"] = "Firewall listo";
            es["localhost_only"] = "Solo localhost";
            es["configuring"] = "Configurando...";
            es["refresh"] = "Actualizar";
            es["lan_hint_default"] = "Abre esta direcci\u00F3n o haz clic en C\u00F3digo QR para conectar tu tablet, iPad o m\u00F3vil.";
            es["lan_hint_disabled"] = "Activa \"Permitir acceso LAN\" en Ajustes para conectar una tablet o m\u00F3vil.";
            es["lan_hint_no_adapter"] = "Conecta tu PC a Wi-Fi o Ethernet y haz clic en Actualizar.";
            es["lan_hint_multi"] = "Varios adaptadores detectados \u2014 elige el que usa tu tablet o m\u00F3vil.";
            es["lan_disabled"] = "Desactivado (solo localhost \u2014 127.0.0.1)";
            es["lan_no_adapter"] = "No se detect\u00F3 conexi\u00F3n Wi-Fi o Ethernet activa";
            es["lan_checking"] = "Comprobando adaptadores de red...";
            es["drawer_title"] = "Ajustes, Registros y Acerca de";
            es["tab_settings"] = "Ajustes";
            es["tab_logs"] = "Registros";
            es["tab_about"] = "Acerca de";
            es["settings_lock_hint"] = "Det\u00E9n el servidor para editar el puerto o host";
            es["map_port"] = "Puerto del mapa";
            es["rpc_host"] = "Host RPC del emulador";
            es["rpc_port"] = "Puerto RPC del emulador";
            es["reset"] = "Restablecer";
            es["allow_lan"] = "Permitir acceso LAN";
            es["auto_open"] = "Abrir navegador autom.";
            es["minimize_tray"] = "Minimizar a la bandeja";
            es["save_folder"] = "Carpeta de guardado";
            es["auto_detect"] = "Detecci\u00F3n autom.";
            es["add_ellipsis"] = "A\u00F1adir...";
            es["remove"] = "Quitar";
            es["save_slot"] = "Ranura";
            es["auto_latest"] = "Auto (M\u00E1s reciente)";
            es["language"] = "Idioma";
            es["check_updates"] = "Buscar actualizaciones";
            es["version_label"] = "Versi\u00F3n {0}";
            es["copy_logs"] = "Copiar";
            es["clear"] = "Limpiar";
            es["about_original_map"] = "Mapa original";
            es["about_artwork"] = "Arte del mapa";
            es["about_security"] = "Software libre (GNU AGPL-3.0). Compilaciones oficiales: github.com/antonioalvromero/Ocarina-Atlas \u2014 los forks deben conservar cr\u00E9ditos y compartir c\u00F3digo.";
            es["about_footer"] = "Versi\u00F3n {0}  \u2022  Verifica lanzamientos oficiales por SHA-256 o atestaci\u00F3n GitHub";
            es["tray_show"] = "Mostrar Ocarina Atlas";
            es["tray_open"] = "Abrir mapa en el navegador";
            es["tray_exit"] = "Salir";
            es["update_pill"] = "Actualiz.";
            map["es"] = es;

            Dictionary<string, string> fr = new Dictionary<string, string>(StringComparer.Ordinal);
            fr["app_title"] = "Ocarina Atlas \u2014 Carte Ocarina of Time";
            fr["start_map"] = "D\u00E9marrer";
            fr["stop_map"] = "Arr\u00EAter";
            fr["stopping"] = "Arr\u00EAt...";
            fr["open_map"] = "Ouvrir la carte";
            fr["setup_sync"] = "Sync en 1 clic";
            fr["setup_sync_port"] = "Config. Sync (:{0})";
            fr["configured"] = "Configur\u00E9 \u21BB";
            fr["configured_port"] = "Configur\u00E9 (:{0}) \u21BB";
            fr["hero_idle"] = "Cliquez sur D\u00E9marrer pour ouvrir la carte interactive d'Hyrule dans votre navigateur.";
            fr["hero_starting"] = "D\u00E9marrage du serveur de carte local...";
            fr["hero_running"] = "La carte est active et pr\u00EAte dans votre navigateur.";
            fr["hero_stopping"] = "Arr\u00EAt du serveur de carte...";
            fr["hero_error"] = "Impossible de d\u00E9marrer le serveur. V\u00E9rifiez Param\u00E8tres, Journaux & \u00C0 propos.";
            fr["sync_hint_default"] = "Cliquez sur Sync en 1 clic pour activer le suivi en direct dans Lichii / Fritchii.";
            fr["sync_hint_configured"] = "Sync en direct configur\u00E9e. Lancez Lichii ou Fritchii et chargez Ocarina of Time.";
            fr["status_stopped"] = "Arr\u00EAt\u00E9";
            fr["status_running"] = "Actif";
            fr["status_starting"] = "D\u00E9marrage";
            fr["status_stopping"] = "Arr\u00EAt...";
            fr["status_error"] = "Erreur";
            fr["emu_none"] = "Aucun \u00E9mu";
            fr["emu_live"] = "En direct";
            fr["emu_waiting"] = "En attente";
            fr["emu_save"] = "Sauvegarde";
            fr["emu_rpc_closed"] = "RPC ferm\u00E9";
            fr["lan_title"] = "Deuxi\u00E8me \u00E9cran (LAN)";
            fr["copy_url"] = "Copier URL";
            fr["copied"] = "Copi\u00E9 !";
            fr["qr_code"] = "Code QR";
            fr["allow_firewall"] = "Pare-feu LAN";
            fr["firewall_ready"] = "Pare-feu pr\u00EAt";
            fr["localhost_only"] = "Local uniquement";
            fr["configuring"] = "Configuration...";
            fr["refresh"] = "Actualiser";
            fr["lan_hint_default"] = "Ouvrez cette adresse ou cliquez sur Code QR pour connecter votre tablette, iPad ou t\u00E9l\u00E9phone.";
            fr["lan_hint_disabled"] = "Activez \"Autoriser l'acc\u00E8s LAN\" dans les Param\u00E8tres pour connecter un appareil.";
            fr["lan_hint_no_adapter"] = "Connectez votre PC au Wi-Fi ou Ethernet, puis cliquez sur Actualiser.";
            fr["lan_hint_multi"] = "Plusieurs cartes r\u00E9seau d\u00E9tect\u00E9es \u2014 choisissez celle de votre appareil.";
            fr["lan_disabled"] = "D\u00E9sactiv\u00E9 (localhost uniquement \u2014 127.0.0.1)";
            fr["lan_no_adapter"] = "Aucune connexion Wi-Fi ou Ethernet active";
            fr["lan_checking"] = "V\u00E9rification des cartes r\u00E9seau...";
            fr["drawer_title"] = "Param\u00E8tres, Journaux & \u00C0 propos";
            fr["tab_settings"] = "Param\u00E8tres";
            fr["tab_logs"] = "Journaux";
            fr["tab_about"] = "\u00C0 propos";
            fr["settings_lock_hint"] = "Arr\u00EAtez le serveur pour modifier le port ou l'h\u00F4te";
            fr["map_port"] = "Port de la carte";
            fr["rpc_host"] = "H\u00F4te RPC \u00E9mulateur";
            fr["rpc_port"] = "Port RPC \u00E9mulateur";
            fr["reset"] = "R\u00E9init.";
            fr["allow_lan"] = "Autoriser l'acc\u00E8s LAN";
            fr["auto_open"] = "Ouvrir le navigateur auto.";
            fr["minimize_tray"] = "R\u00E9duire dans la zone notif.";
            fr["save_folder"] = "Dossier de sauvegarde";
            fr["auto_detect"] = "D\u00E9tection auto.";
            fr["add_ellipsis"] = "Ajouter...";
            fr["remove"] = "Retirer";
            fr["save_slot"] = "Emplacement";
            fr["auto_latest"] = "Auto (Plus r\u00E9cent)";
            fr["language"] = "Langue";
            fr["check_updates"] = "V\u00E9rifier les mises \u00E0 jour";
            fr["version_label"] = "Version {0}";
            fr["copy_logs"] = "Copier";
            fr["clear"] = "Effacer";
            fr["about_original_map"] = "Carte d'origine";
            fr["about_artwork"] = "Illustrations";
            fr["about_security"] = "Libre et open-source (GNU AGPL-3.0). Builds officiels : github.com/antonioalvromero/Ocarina-Atlas \u2014 les forks doivent pr\u00E9server les cr\u00E9dits.";
            fr["about_footer"] = "Version {0}  \u2022  V\u00E9rifiez les versions officielles via SHA-256 ou attestation GitHub";
            fr["tray_show"] = "Afficher Ocarina Atlas";
            fr["tray_open"] = "Ouvrir la carte dans le navigateur";
            fr["tray_exit"] = "Quitter";
            fr["update_pill"] = "M\u00E0J";
            map["fr"] = fr;

            Dictionary<string, string> pt = new Dictionary<string, string>(StringComparer.Ordinal);
            pt["app_title"] = "Ocarina Atlas \u2014 Mapa de Ocarina of Time";
            pt["start_map"] = "Iniciar mapa";
            pt["stop_map"] = "Parar mapa";
            pt["stopping"] = "Parando...";
            pt["open_map"] = "Abrir mapa";
            pt["setup_sync"] = "Configurar Sync (1 clique)";
            pt["setup_sync_port"] = "Configurar Sync (:{0})";
            pt["configured"] = "Configurado \u21BB";
            pt["configured_port"] = "Configurado (:{0}) \u21BB";
            pt["hero_idle"] = "Clique em Iniciar mapa para abrir o mapa interativo de Hyrule no navegador.";
            pt["hero_starting"] = "Iniciando o servidor local do mapa...";
            pt["hero_running"] = "O mapa est\u00E1 ativo e pronto no seu navegador.";
            pt["hero_stopping"] = "Encerrando o servidor do mapa...";
            pt["hero_error"] = "N\u00E3o foi poss\u00EDvel iniciar o servidor. Verifique Configura\u00E7\u00F5es, Logs e Sobre.";
            pt["sync_hint_default"] = "Clique em Configurar Sync para ativar o rastreamento ao vivo.";
            pt["sync_hint_configured"] = "Sync ao vivo configurado. Inicie Lichii ou Fritchii e carregue Ocarina of Time.";
            pt["status_stopped"] = "Parado";
            pt["status_running"] = "Ativo";
            pt["status_starting"] = "Iniciando";
            pt["status_stopping"] = "Parando...";
            pt["status_error"] = "Erro";
            pt["emu_none"] = "Sem emu";
            pt["emu_live"] = "Ao vivo";
            pt["emu_waiting"] = "Aguardando";
            pt["emu_save"] = "Save";
            pt["emu_rpc_closed"] = "RPC fechado";
            pt["lan_title"] = "Segunda tela (LAN)";
            pt["copy_url"] = "Copiar URL";
            pt["copied"] = "Copiado!";
            pt["qr_code"] = "C\u00F3digo QR";
            pt["allow_firewall"] = "Liberar firewall";
            pt["firewall_ready"] = "Firewall pronto";
            pt["localhost_only"] = "Apenas local";
            pt["configuring"] = "Configurando...";
            pt["refresh"] = "Atualizar";
            pt["lan_hint_default"] = "Abra este endere\u00E7o ou clique em C\u00F3digo QR para conectar seu tablet, iPad ou celular.";
            pt["lan_hint_disabled"] = "Ative \"Permitir acesso LAN\" nas Configura\u00E7\u00F5es para conectar um dispositivo.";
            pt["lan_hint_no_adapter"] = "Conecte o PC ao Wi-Fi ou Ethernet e clique em Atualizar.";
            pt["lan_hint_multi"] = "V\u00E1rios adaptadores encontrados \u2014 escolha o usado pelo seu dispositivo.";
            pt["lan_disabled"] = "Desativado (apenas localhost \u2014 127.0.0.1)";
            pt["lan_no_adapter"] = "Nenhuma conex\u00E3o Wi-Fi ou Ethernet ativa detectada";
            pt["lan_checking"] = "Verificando adaptadores de rede...";
            pt["drawer_title"] = "Configura\u00E7\u00F5es, Logs e Sobre";
            pt["tab_settings"] = "Config.";
            pt["tab_logs"] = "Logs";
            pt["tab_about"] = "Sobre";
            pt["settings_lock_hint"] = "Pare o servidor para editar porta ou host";
            pt["map_port"] = "Porta do mapa";
            pt["rpc_host"] = "Host RPC do emulador";
            pt["rpc_port"] = "Porta RPC do emulador";
            pt["reset"] = "Redefinir";
            pt["allow_lan"] = "Permitir acesso LAN";
            pt["auto_open"] = "Abrir navegador autom.";
            pt["minimize_tray"] = "Minimizar para bandeja";
            pt["save_folder"] = "Pasta de saves";
            pt["auto_detect"] = "Detec\u00E7\u00E3o autom.";
            pt["add_ellipsis"] = "Adicionar...";
            pt["remove"] = "Remover";
            pt["save_slot"] = "Slot";
            pt["auto_latest"] = "Auto (Mais recente)";
            pt["language"] = "Idioma";
            pt["check_updates"] = "Verificar atualiza\u00E7\u00F5es";
            pt["version_label"] = "Vers\u00E3o {0}";
            pt["copy_logs"] = "Copiar logs";
            pt["clear"] = "Limpar";
            pt["about_original_map"] = "Mapa original";
            pt["about_artwork"] = "Arte do mapa";
            pt["about_security"] = "Gratuito e c\u00F3digo aberto (GNU AGPL-3.0). Compila\u00E7\u00F5es oficiais: github.com/antonioalvromero/Ocarina-Atlas.";
            pt["about_footer"] = "Vers\u00E3o {0}  \u2022  Verifique lan\u00E7amentos oficiais via SHA-256 ou GitHub";
            pt["tray_show"] = "Mostrar Ocarina Atlas";
            pt["tray_open"] = "Abrir mapa no navegador";
            pt["tray_exit"] = "Sair";
            pt["update_pill"] = "Atualiz.";
            map["pt"] = pt;

            Dictionary<string, string> zhCn = new Dictionary<string, string>(StringComparer.Ordinal);
            zhCn["app_title"] = "Ocarina Atlas \u2014 \u65F6\u4E4B\u7B1B\u4E92\u52A8\u5730\u56FE";
            zhCn["start_map"] = "\u542F\u52A8\u5730\u56FE";
            zhCn["stop_map"] = "\u505C\u6B62\u5730\u56FE";
            zhCn["stopping"] = "\u6B63\u5728\u505C\u6B62...";
            zhCn["open_map"] = "\u6253\u5F00\u5730\u56FE";
            zhCn["setup_sync"] = "\u4E00\u952E\u914D\u7F6E\u540C\u6B65";
            zhCn["setup_sync_port"] = "\u914D\u7F6E\u540C\u6B65 (:{0})";
            zhCn["configured"] = "\u5DF2\u914D\u7F6E \u21BB";
            zhCn["configured_port"] = "\u5DF2\u914D\u7F6E (:{0}) \u21BB";
            zhCn["hero_idle"] = "\u70B9\u51FB\u201C\u542F\u52A8\u5730\u56FE\u201D\u5728\u6D4F\u89C8\u5668\u4E2D\u6253\u5F00\u6D77\u62C9\u9C81\u4E92\u52A8\u5730\u56FE\u3002";
            zhCn["hero_starting"] = "\u6B63\u5728\u542F\u52A8\u672C\u5730\u5730\u56FE\u670D\u52A1\u5668...";
            zhCn["hero_running"] = "\u5730\u56FE\u5DF2\u5C31\u7EEA\uFF0C\u53EF\u5728\u6D4F\u89C8\u5668\u4E2D\u67E5\u770B\u3002";
            zhCn["hero_stopping"] = "\u6B63\u5728\u5173\u95ED\u5730\u56FE\u670D\u52A1\u5668...";
            zhCn["hero_error"] = "\u65E0\u6CD5\u542F\u52A8\u5730\u56FE\u670D\u52A1\u5668\u3002\u8BF7\u67E5\u770B\u8BBE\u7F6E\u3001\u65E5\u5FD7\u4E0E\u5173\u4E8E\u3002";
            zhCn["sync_hint_default"] = "\u70B9\u51FB\u201C\u4E00\u952E\u914D\u7F6E\u540C\u6B65\u201D\u4EE5\u542F\u7528\u5B9E\u65F6\u8FFD\u8E2A\u3002";
            zhCn["sync_hint_configured"] = "\u5B9E\u65F6\u540C\u6B65\u5DF2\u914D\u7F6E\u3002\u8BF7\u542F\u52A8 Lichii \u6216 Fritchii \u5E76\u52A0\u8F7D\u6E38\u620F\u3002";
            zhCn["status_stopped"] = "\u5DF2\u505C\u6B62";
            zhCn["status_running"] = "\u8FD0\u884C\u4E2D";
            zhCn["status_starting"] = "\u542F\u52A8\u4E2D";
            zhCn["status_stopping"] = "\u505C\u6B62\u4E2D...";
            zhCn["status_error"] = "\u9519\u8BEF";
            zhCn["emu_none"] = "\u672A\u68C0\u6D4B";
            zhCn["emu_live"] = "\u5B9E\u65F6";
            zhCn["emu_waiting"] = "\u7B49\u5F85\u4E2D";
            zhCn["emu_save"] = "\u5B58\u6863";
            zhCn["emu_rpc_closed"] = "RPC\u5173\u95ED";
            zhCn["lan_title"] = "\u526F\u5C4F (LAN)";
            zhCn["copy_url"] = "\u590D\u5236\u94FE\u63A5";
            zhCn["copied"] = "\u5DF2\u590D\u5236!";
            zhCn["qr_code"] = "\u4E8C\u7EF4\u7801";
            zhCn["allow_firewall"] = "\u5141\u8BB8\u9632\u706B\u5899";
            zhCn["firewall_ready"] = "\u9632\u706B\u5899\u5DF2\u5C31\u7EEA";
            zhCn["localhost_only"] = "\u4EC5\u672C\u673A";
            zhCn["configuring"] = "\u914D\u7F6E\u4E2D...";
            zhCn["refresh"] = "\u5237\u65B0";
            zhCn["lan_hint_default"] = "\u6253\u5F00\u6B64\u5730\u5740\u6216\u70B9\u51FB\u4E8C\u7EF4\u7801\u4EE5\u8FDE\u63A5\u5E73\u677F\u3001iPad \u6216\u624B\u673A\u3002";
            zhCn["lan_hint_disabled"] = "\u8BF7\u5728\u8BBE\u7F6E\u4E2D\u542F\u7528\u201C\u5141\u8BB8\u5C40\u57DF\u7F51\u8BBF\u95EE\u201D\u4EE5\u8FDE\u63A5\u79FB\u52A8\u8BBE\u5907\u3002";
            zhCn["lan_hint_no_adapter"] = "\u8BF7\u5C06\u7535\u8111\u8FDE\u63A5\u5230 Wi-Fi \u6216\u4EE5\u592A\u7F51\uFF0C\u7136\u540E\u70B9\u51FB\u5237\u65B0\u3002";
            zhCn["lan_hint_multi"] = "\u68C0\u6D4B\u5230\u591A\u4E2A\u7F51\u7EDC\u9002\u914D\u5668 \u2014 \u8BF7\u9009\u62E9\u8BBE\u5907\u6240\u7528\u7684\u7F51\u7EDC\u3002";
            zhCn["lan_disabled"] = "\u5DF2\u7981\u7528 (\u4EC5\u672C\u673A \u2014 127.0.0.1)";
            zhCn["lan_no_adapter"] = "\u672A\u68C0\u6D4B\u5230\u6D3B\u52A8\u7684 Wi-Fi \u6216\u4EE5\u592A\u7F51\u8FDE\u63A5";
            zhCn["lan_checking"] = "\u6B63\u5728\u68C0\u67E5\u7F51\u7EDC\u9002\u914D\u5668...";
            zhCn["drawer_title"] = "\u8BBE\u7F6E\u3001\u65E5\u5FD7\u4E0E\u5173\u4E8E";
            zhCn["tab_settings"] = "\u8BBE\u7F6E";
            zhCn["tab_logs"] = "\u65E5\u5FD7";
            zhCn["tab_about"] = "\u5173\u4E8E";
            zhCn["settings_lock_hint"] = "\u505C\u6B62\u670D\u52A1\u5668\u540E\u53EF\u7F16\u8F91\u7AEF\u53E3\u6216\u4E3B\u673A";
            zhCn["map_port"] = "\u5730\u56FE\u7AEF\u53E3";
            zhCn["rpc_host"] = "\u6A21\u62DF\u5668 RPC \u4E3B\u673A";
            zhCn["rpc_port"] = "\u6A21\u62DF\u5668 RPC \u7AEF\u53E3";
            zhCn["reset"] = "\u91CD\u7F6E";
            zhCn["allow_lan"] = "\u5141\u8BB8\u5C40\u57DF\u7F51\u8BBF\u95EE";
            zhCn["auto_open"] = "\u81EA\u52A8\u6253\u5F00\u6D4F\u89C8\u5668";
            zhCn["minimize_tray"] = "\u6700\u5C0F\u5316\u5230\u6258\u76D8";
            zhCn["save_folder"] = "\u5B58\u6863\u6587\u4EF6\u5939";
            zhCn["auto_detect"] = "\u81EA\u52A8\u68C0\u6D4B";
            zhCn["add_ellipsis"] = "\u6DFB\u52A0...";
            zhCn["remove"] = "\u79FB\u9664";
            zhCn["save_slot"] = "\u5B58\u6863\u69FD\u4F4D";
            zhCn["auto_latest"] = "\u81EA\u52A8 (\u6700\u65B0)";
            zhCn["language"] = "\u8BED\u8A00";
            zhCn["check_updates"] = "\u68C0\u67E5\u66F4\u65B0";
            zhCn["version_label"] = "\u7248\u672C {0}";
            zhCn["copy_logs"] = "\u590D\u5236\u65E5\u5FD7";
            zhCn["clear"] = "\u6E05\u7A7A";
            zhCn["about_original_map"] = "\u539F\u59CB\u5730\u56FE";
            zhCn["about_artwork"] = "\u5730\u56FE\u7F8E\u672F";
            zhCn["about_security"] = "\u514D\u8D39\u5F00\u6E90 (GNU AGPL-3.0)\u3002\u5B98\u65B9\u6784\u5EFA: github.com/antonioalvromero/Ocarina-Atlas\u3002";
            zhCn["about_footer"] = "\u7248\u672C {0}  \u2022  \u8BF7\u901A\u8FC7 SHA-256 \u6216 GitHub \u8BC1\u660E\u9A8C\u8BC1\u5B98\u65B9\u7248\u672C";
            zhCn["tray_show"] = "\u663E\u793A Ocarina Atlas";
            zhCn["tray_open"] = "\u5728\u6D4F\u89C8\u5668\u4E2D\u6253\u5F00\u5730\u56FE";
            zhCn["tray_exit"] = "\u9000\u51FA";
            zhCn["update_pill"] = "\u66F4\u65B0";
            map["zh-CN"] = zhCn;

            Dictionary<string, string> zhTw = new Dictionary<string, string>(StringComparer.Ordinal);
            zhTw["app_title"] = "Ocarina Atlas \u2014 \u6642\u4E4B\u7B1B\u4E92\u52D5\u5730\u5716";
            zhTw["start_map"] = "\u555F\u52D5\u5730\u5716";
            zhTw["stop_map"] = "\u505C\u6B62\u5730\u5716";
            zhTw["stopping"] = "\u6B63\u5728\u505C\u6B62...";
            zhTw["open_map"] = "\u958B\u555F\u5730\u5716";
            zhTw["setup_sync"] = "\u4E00\u9375\u8A2D\u5B9A\u540C\u6B65";
            zhTw["setup_sync_port"] = "\u8A2D\u5B9A\u540C\u6B65 (:{0})";
            zhTw["configured"] = "\u5DF2\u8A2D\u5B9A \u21BB";
            zhTw["configured_port"] = "\u5DF2\u8A2D\u5B9A (:{0}) \u21BB";
            zhTw["hero_idle"] = "\u9EDE\u64CA\u300C\u555F\u52D5\u5730\u5716\u300D\u5728\u700F\u89BD\u5668\u4E2D\u958B\u555F\u6D77\u62C9\u9B6F\u4E92\u52D5\u5730\u5716\u3002";
            zhTw["hero_starting"] = "\u6B63\u5728\u555F\u52D5\u672C\u6A5F\u5730\u5716\u4F3A\u670D\u5668...";
            zhTw["hero_running"] = "\u5730\u5716\u5DF2\u5C31\u7DD2\uFF0C\u53EF\u5728\u700F\u89BD\u5668\u4E2D\u67E5\u770B\u3002";
            zhTw["hero_stopping"] = "\u6B63\u5728\u95DC\u9589\u5730\u5716\u4F3A\u670D\u5668...";
            zhTw["hero_error"] = "\u7121\u6CD5\u555F\u52D5\u5730\u5716\u4F3A\u670D\u5668\u3002\u8ACB\u67E5\u770B\u8A2D\u5B9A\u3001\u8A18\u9304\u8207\u95DC\u65BC\u3002";
            zhTw["sync_hint_default"] = "\u9EDE\u64CA\u300C\u4E00\u9375\u8A2D\u5B9A\u540C\u6B65\u300D\u4EE5\u555F\u7528\u5373\u6642\u8FFD\u8E64\u3002";
            zhTw["sync_hint_configured"] = "\u5373\u6642\u540C\u6B65\u5DF2\u8A2D\u5B9A\u3002\u8ACB\u555F\u52D5 Lichii \u6216 Fritchii \u4E26\u8F09\u5165\u904A\u6232\u3002";
            zhTw["status_stopped"] = "\u5DF2\u505C\u6B62";
            zhTw["status_running"] = "\u904B\u884C\u4E2D";
            zhTw["status_starting"] = "\u555F\u52D5\u4E2D";
            zhTw["status_stopping"] = "\u505C\u6B62\u4E2D...";
            zhTw["status_error"] = "\u932F\u8AA4";
            zhTw["emu_none"] = "\u672A\u5075\u6E2C";
            zhTw["emu_live"] = "\u5373\u6642";
            zhTw["emu_waiting"] = "\u7B49\u5019\u4E2D";
            zhTw["emu_save"] = "\u5B58\u6A94";
            zhTw["emu_rpc_closed"] = "RPC\u95DC\u9589";
            zhTw["lan_title"] = "\u526F\u87A2\u5E55 (LAN)";
            zhTw["copy_url"] = "\u8907\u88FD\u7DB2\u5740";
            zhTw["copied"] = "\u5DF2\u8907\u88FD!";
            zhTw["qr_code"] = "QR \u78BC";
            zhTw["allow_firewall"] = "\u5141\u8A31\u9632\u706B\u7246";
            zhTw["firewall_ready"] = "\u9632\u706B\u7246\u5DF2\u5C31\u7DD2";
            zhTw["localhost_only"] = "\u50C5\u9650\u672C\u6A5F";
            zhTw["configuring"] = "\u8A2D\u5B9A\u4E2D...";
            zhTw["refresh"] = "\u91CD\u65B0\u6574\u7406";
            zhTw["lan_hint_default"] = "\u958B\u555F\u6B64\u4F4D\u5740\u6216\u9EDE\u64CA QR \u78BC\u4EE5\u9023\u7DDA\u5E73\u677F\u3001iPad \u6216\u624B\u6A5F\u3002";
            zhTw["lan_hint_disabled"] = "\u8ACB\u5728\u8A2D\u5B9A\u4E2D\u555F\u7528\u300C\u5141\u8A31\u5340\u57DF\u7DB2\u8DEF\u5B58\u53D6\u300D\u4EE5\u9023\u7DDA\u88DD\u7F6E\u3002";
            zhTw["lan_hint_no_adapter"] = "\u8ACB\u5C07\u96FB\u8166\u9023\u7DDA\u81F3 Wi-Fi \u6216\u4E59\u592A\u7DB2\u8DEF\uFF0C\u7136\u5F8C\u9EDE\u64CA\u91CD\u65B0\u6574\u7406\u3002";
            zhTw["lan_hint_multi"] = "\u5075\u6E2C\u5230\u591A\u500B\u7DB2\u8DEF\u4ECB\u9762 \u2014 \u8ACB\u9078\u64C7\u88DD\u7F6E\u4F7F\u7528\u7684\u7DB2\u8DEF\u3002";
            zhTw["lan_disabled"] = "\u5DF2\u505C\u7528 (\u50C5\u672C\u6A5F \u2014 127.0.0.1)";
            zhTw["lan_no_adapter"] = "\u672A\u5075\u6E2C\u5230\u4F5C\u7528\u4E2D\u7684 Wi-Fi \u6216\u4E59\u592A\u7DB2\u8DEF\u9023\u7DDA";
            zhTw["lan_checking"] = "\u6B63\u5728\u6AA2\u67E5\u7DB2\u8DEF\u4ECB\u9762...";
            zhTw["drawer_title"] = "\u8A2D\u5B9A\u3001\u8A18\u9304\u8207\u95DC\u65BC";
            zhTw["tab_settings"] = "\u8A2D\u5B9A";
            zhTw["tab_logs"] = "\u8A18\u9304";
            zhTw["tab_about"] = "\u95DC\u65BC";
            zhTw["settings_lock_hint"] = "\u505C\u6B62\u4F3A\u670D\u5668\u5F8C\u53EF\u7DE8\u8F2F\u9023\u63A5\u57E0\u6216\u4E3B\u6A5F";
            zhTw["map_port"] = "\u5730\u5716\u9023\u63A5\u57E0";
            zhTw["rpc_host"] = "\u6A21\u64EC\u5668 RPC \u4E3B\u6A5F";
            zhTw["rpc_port"] = "\u6A21\u64EC\u5668 RPC \u9023\u63A5\u57E0";
            zhTw["reset"] = "\u91CD\u8A2D";
            zhTw["allow_lan"] = "\u5141\u8A31\u5340\u57DF\u7DB2\u8DEF\u5B58\u53D6";
            zhTw["auto_open"] = "\u81EA\u52D5\u958B\u555F\u700F\u89BD\u5668";
            zhTw["minimize_tray"] = "\u6700\u5C0F\u5316\u81F3\u7CFB\u7D71\u5323";
            zhTw["save_folder"] = "\u5B58\u6A94\u8CC7\u6599\u593E";
            zhTw["auto_detect"] = "\u81EA\u52D5\u5075\u6E2C";
            zhTw["add_ellipsis"] = "\u65B0\u589E...";
            zhTw["remove"] = "\u79FB\u9664";
            zhTw["save_slot"] = "\u5B58\u6A94\u69FD\u4F4D";
            zhTw["auto_latest"] = "\u81EA\u52D5 (\u6700\u65B0)";
            zhTw["language"] = "\u8A9E\u8A00";
            zhTw["check_updates"] = "\u6AA2\u67E5\u66F4\u65B0";
            zhTw["version_label"] = "\u7248\u672C {0}";
            zhTw["copy_logs"] = "\u8907\u88FD\u8A18\u9304";
            zhTw["clear"] = "\u6E05\u9664";
            zhTw["about_original_map"] = "\u539F\u59CB\u5730\u5716";
            zhTw["about_artwork"] = "\u5730\u5716\u7F8E\u8853";
            zhTw["about_security"] = "\u514D\u8CBB\u958B\u6E90 (GNU AGPL-3.0)\u3002\u5B98\u65B9\u5EFA\u7F6E: github.com/antonioalvromero/Ocarina-Atlas\u3002";
            zhTw["about_footer"] = "\u7248\u672C {0}  \u2022  \u8ACB\u900F\u904E SHA-256 \u6216 GitHub \u8B49\u660E\u9A57\u8B49\u5B98\u65B9\u7248\u672C";
            zhTw["tray_show"] = "\u986F\u793A Ocarina Atlas";
            zhTw["tray_open"] = "\u5728\u700F\u89BD\u5668\u4E2D\u958B\u555F\u5730\u5716";
            zhTw["tray_exit"] = "\u7D50\u675F";
            zhTw["update_pill"] = "\u66F4\u65B0";
            map["zh-TW"] = zhTw;

            Dictionary<string, string> de = new Dictionary<string, string>(StringComparer.Ordinal);
            de["app_title"] = "Ocarina Atlas \u2014 Ocarina of Time Karten-Tracker";
            de["start_map"] = "Karte starten";
            de["stop_map"] = "Karte stoppen";
            de["stopping"] = "Stoppt...";
            de["open_map"] = "Karte \u00F6ffnen";
            de["setup_sync"] = "1-Klick-Sync-Setup";
            de["setup_sync_port"] = "Sync-Setup (:{0})";
            de["configured"] = "Konfiguriert \u21BB";
            de["configured_port"] = "Konfiguriert (:{0}) \u21BB";
            de["hero_idle"] = "Klicke auf Karte starten, um die interaktive Hyrule-Karte im Browser zu \u00F6ffnen.";
            de["hero_starting"] = "Lokaler Kartenserver wird gestartet...";
            de["hero_running"] = "Die Karte ist live und im Browser bereit.";
            de["hero_stopping"] = "Kartenserver wird beendet...";
            de["hero_error"] = "Kartenserver konnte nicht gestartet werden. Siehe Einstellungen, Protokoll & Info.";
            de["sync_hint_default"] = "Klicke auf 1-Klick-Sync-Setup, um Live-Tracking in Lichii / Fritchii zu aktivieren.";
            de["sync_hint_configured"] = "Live-Sync konfiguriert. Starte Lichii oder Fritchii und lade Ocarina of Time.";
            de["status_stopped"] = "Gestoppt";
            de["status_running"] = "L\u00E4uft";
            de["status_starting"] = "Startet";
            de["status_stopping"] = "Stoppt...";
            de["status_error"] = "Fehler";
            de["emu_none"] = "Kein Emu";
            de["emu_live"] = "Live";
            de["emu_waiting"] = "Wartet";
            de["emu_save"] = "Spielstand";
            de["emu_rpc_closed"] = "RPC zu";
            de["lan_title"] = "Zweiter Bildschirm (LAN)";
            de["copy_url"] = "URL kopieren";
            de["copied"] = "Kopiert!";
            de["qr_code"] = "QR-Code";
            de["allow_firewall"] = "Firewall erlauben";
            de["firewall_ready"] = "Firewall bereit";
            de["localhost_only"] = "Nur lokal";
            de["configuring"] = "Konfiguriere...";
            de["refresh"] = "Aktualis.";
            de["lan_hint_default"] = "\u00D6ffne diese Adresse oder klicke auf QR-Code f\u00FCr Tablet, iPad oder Smartphone.";
            de["lan_hint_disabled"] = "Aktiviere \"LAN-Zugriff erlauben\" in den Einstellungen f\u00FCr mobile Ger\u00E4te.";
            de["lan_hint_no_adapter"] = "Verbinde deinen PC mit WLAN oder Ethernet und klicke auf Aktualis.";
            de["lan_hint_multi"] = "Mehrere Netzwerkadapter gefunden \u2014 w\u00E4hle den deines Ger\u00E4ts.";
            de["lan_disabled"] = "Deaktiviert (nur Localhost \u2014 127.0.0.1)";
            de["lan_no_adapter"] = "Keine aktive WLAN- oder Ethernet-Verbindung erkannt";
            de["lan_checking"] = "Netzwerkadapter werden gepr\u00FCft...";
            de["drawer_title"] = "Einstellungen, Protokoll & Info";
            de["tab_settings"] = "Einstell.";
            de["tab_logs"] = "Protokoll";
            de["tab_about"] = "Info";
            de["settings_lock_hint"] = "Server stoppen, um Port oder Host zu \u00E4ndern";
            de["map_port"] = "Karten-Port";
            de["rpc_host"] = "Emulator-RPC-Host";
            de["rpc_port"] = "Emulator-RPC-Port";
            de["reset"] = "Zur\u00FCck.";
            de["allow_lan"] = "LAN-Zugriff erlauben";
            de["auto_open"] = "Browser autom. \u00F6ffnen";
            de["minimize_tray"] = "In Tray minimieren";
            de["save_folder"] = "Speicherordner";
            de["auto_detect"] = "Automatisch";
            de["add_ellipsis"] = "Hinzuf....";
            de["remove"] = "Entfernen";
            de["save_slot"] = "Speicherplatz";
            de["auto_latest"] = "Auto (Neuester)";
            de["language"] = "Sprache";
            de["check_updates"] = "Nach Updates suchen";
            de["version_label"] = "Version {0}";
            de["copy_logs"] = "Kopieren";
            de["clear"] = "Leeren";
            de["about_original_map"] = "Originalkarte";
            de["about_artwork"] = "Karten-Artwork";
            de["about_security"] = "Frei & Open-Source (GNU AGPL-3.0). Offizielle Builds: github.com/antonioalvromero/Ocarina-Atlas.";
            de["about_footer"] = "Version {0}  \u2022  Offizielle Releases per SHA-256 oder GitHub-Attestierung pr\u00FCfen";
            de["tray_show"] = "Ocarina Atlas anzeigen";
            de["tray_open"] = "Karte im Browser \u00F6ffnen";
            de["tray_exit"] = "Beenden";
            de["update_pill"] = "Update";
            map["de"] = de;

            Dictionary<string, string> it = new Dictionary<string, string>(StringComparer.Ordinal);
            it["app_title"] = "Ocarina Atlas \u2014 Mappa di Ocarina of Time";
            it["start_map"] = "Avvia mappa";
            it["stop_map"] = "Ferma mappa";
            it["stopping"] = "Arresto...";
            it["open_map"] = "Apri mappa";
            it["setup_sync"] = "Configura Sync (1 clic)";
            it["setup_sync_port"] = "Configura Sync (:{0})";
            it["configured"] = "Configurato \u21BB";
            it["configured_port"] = "Configurato (:{0}) \u21BB";
            it["hero_idle"] = "Fai clic su Avvia mappa per aprire la mappa interattiva di Hyrule nel browser.";
            it["hero_starting"] = "Avvio del server locale della mappa...";
            it["hero_running"] = "La mappa \u00E8 attiva e pronta nel browser.";
            it["hero_stopping"] = "Arresto del server della mappa...";
            it["hero_error"] = "Impossibile avviare il server. Controlla Impostazioni, Log e Info.";
            it["sync_hint_default"] = "Fai clic su Configura Sync per abilitare il tracciamento in tempo reale.";
            it["sync_hint_configured"] = "Sync live configurato. Avvia Lichii o Fritchii e carica Ocarina of Time.";
            it["status_stopped"] = "Fermo";
            it["status_running"] = "Attivo";
            it["status_starting"] = "Avvio";
            it["status_stopping"] = "Arresto...";
            it["status_error"] = "Errore";
            it["emu_none"] = "No Emu";
            it["emu_live"] = "Live";
            it["emu_waiting"] = "In attesa";
            it["emu_save"] = "Salvat.";
            it["emu_rpc_closed"] = "RPC chiuso";
            it["lan_title"] = "Secondo schermo (LAN)";
            it["copy_url"] = "Copia URL";
            it["copied"] = "Copiato!";
            it["qr_code"] = "Codice QR";
            it["allow_firewall"] = "Consenti firewall";
            it["firewall_ready"] = "Firewall pronto";
            it["localhost_only"] = "Solo locale";
            it["configuring"] = "Configurazione...";
            it["refresh"] = "Aggiorna";
            it["lan_hint_default"] = "Apri questo indirizzo o clicca Codice QR per connettere tablet, iPad o smartphone.";
            it["lan_hint_disabled"] = "Attiva \"Consenti accesso LAN\" nelle Impostazioni per connettere un dispositivo.";
            it["lan_hint_no_adapter"] = "Collega il PC a Wi-Fi o Ethernet, poi clicca Aggiorna.";
            it["lan_hint_multi"] = "Pi\u00F9 schede di rete trovate \u2014 scegli quella del tuo dispositivo.";
            it["lan_disabled"] = "Disattivato (solo localhost \u2014 127.0.0.1)";
            it["lan_no_adapter"] = "Nessuna connessione Wi-Fi o Ethernet attiva rilevata";
            it["lan_checking"] = "Verifica schede di rete...";
            it["drawer_title"] = "Impostazioni, Log e Info";
            it["tab_settings"] = "Impost.";
            it["tab_logs"] = "Log";
            it["tab_about"] = "Info";
            it["settings_lock_hint"] = "Ferma il server per modificare porta o host";
            it["map_port"] = "Porta mappa";
            it["rpc_host"] = "Host RPC emulatore";
            it["rpc_port"] = "Porta RPC emulatore";
            it["reset"] = "Ripristina";
            it["allow_lan"] = "Consenti accesso LAN";
            it["auto_open"] = "Apri browser autom.";
            it["minimize_tray"] = "Riduci a icona nel tray";
            it["save_folder"] = "Cartella salvataggi";
            it["auto_detect"] = "Rileva autom.";
            it["add_ellipsis"] = "Aggiungi...";
            it["remove"] = "Rimuovi";
            it["save_slot"] = "Slot";
            it["auto_latest"] = "Auto (Pi\u00F9 recente)";
            it["language"] = "Lingua";
            it["check_updates"] = "Cerca aggiornamenti";
            it["version_label"] = "Versione {0}";
            it["copy_logs"] = "Copia log";
            it["clear"] = "Pulisci";
            it["about_original_map"] = "Mappa originale";
            it["about_artwork"] = "Grafica mappa";
            it["about_security"] = "Gratuito e open-source (GNU AGPL-3.0). Build ufficiali: github.com/antonioalvromero/Ocarina-Atlas.";
            it["about_footer"] = "Versione {0}  \u2022  Verifica le release ufficiali tramite SHA-256 o GitHub";
            it["tray_show"] = "Mostra Ocarina Atlas";
            it["tray_open"] = "Apri mappa nel browser";
            it["tray_exit"] = "Esci";
            it["update_pill"] = "Aggiorna";
            map["it"] = it;

            Dictionary<string, string> ja = new Dictionary<string, string>(StringComparer.Ordinal);
            ja["app_title"] = "Ocarina Atlas \u2014 \u6642\u306E\u30AA\u30AB\u30EA\u30CA \u30DE\u30C3\u30D7";
            ja["start_map"] = "\u30DE\u30C3\u30D7\u958B\u59CB";
            ja["stop_map"] = "\u30DE\u30C3\u30D7\u505C\u6B62";
            ja["stopping"] = "\u505C\u6B62\u4E2D...";
            ja["open_map"] = "\u30DE\u30C3\u30D7\u3092\u958B\u304F";
            ja["setup_sync"] = "1\u30AF\u30EA\u30C3\u30AF\u540C\u671F\u8A2D\u5B9A";
            ja["setup_sync_port"] = "\u540C\u671F\u8A2D\u5B9A (:{0})";
            ja["configured"] = "\u8A2D\u5B9A\u6E08\u307F \u21BB";
            ja["configured_port"] = "\u8A2D\u5B9A\u6E08\u307F (:{0}) \u21BB";
            ja["hero_idle"] = "\u300C\u30DE\u30C3\u30D7\u958B\u59CB\u300D\u3092\u30AF\u30EA\u30C3\u30AF\u3057\u3066\u30D6\u30E9\u30A6\u30B6\u3067\u30CF\u30A4\u30E9\u30EB\u30DE\u30C3\u30D7\u3092\u958B\u304D\u307E\u3059\u3002";
            ja["hero_starting"] = "\u30ED\u30FC\u30AB\u30EB\u30DE\u30C3\u30D7\u30B5\u30FC\u30D0\u30FC\u3092\u8D77\u52D5\u4E2D...";
            ja["hero_running"] = "\u30DE\u30C3\u30D7\u306F\u30D6\u30E9\u30A6\u30B6\u3067\u5229\u7528\u53EF\u80FD\u3067\u3059\u3002";
            ja["hero_stopping"] = "\u30DE\u30C3\u30D7\u30B5\u30FC\u30D0\u30FC\u3092\u505C\u6B62\u4E2D...";
            ja["hero_error"] = "\u30B5\u30FC\u30D0\u30FC\u3092\u8D77\u52D5\u3067\u304D\u307E\u305B\u3093\u3067\u3057\u305F\u3002\u8A2D\u5B9A\u30FB\u30ED\u30B0\u3092\u78BA\u8A8D\u3057\u3066\u304F\u3060\u3055\u3044\u3002";
            ja["sync_hint_default"] = "\u300C1\u30AF\u30EA\u30C3\u30AF\u540C\u671F\u8A2D\u5B9A\u300D\u3067\u30EA\u30A2\u30EB\u30BF\u30A4\u30E0\u8FFD\u8DE1\u3092\u6709\u52B9\u306B\u3057\u307E\u3059\u3002";
            ja["sync_hint_configured"] = "\u540C\u671F\u8A2D\u5B9A\u5B8C\u4E86\u3002Lichii / Fritchii \u3092\u8D77\u52D5\u3057\u3066\u30B2\u30FC\u30E0\u3092\u8AAD\u307F\u8FBC\u3093\u3067\u304F\u3060\u3055\u3044\u3002";
            ja["status_stopped"] = "\u505C\u6B62";
            ja["status_running"] = "\u7A3C\u50CD\u4E2D";
            ja["status_starting"] = "\u8D77\u52D5\u4E2D";
            ja["status_stopping"] = "\u505C\u6B62\u4E2D...";
            ja["status_error"] = "\u30A8\u30E9\u30FC";
            ja["emu_none"] = "\u672A\u691C\u51FA";
            ja["emu_live"] = "\u540C\u671F\u4E2D";
            ja["emu_waiting"] = "\u5F85\u6A5F\u4E2D";
            ja["emu_save"] = "\u30BB\u30FC\u30D6";
            ja["emu_rpc_closed"] = "RPC\u9589\u9396";
            ja["lan_title"] = "\u30B5\u30D6\u753B\u9762 (LAN)";
            ja["copy_url"] = "URL\u30B3\u30D4\u30FC";
            ja["copied"] = "\u30B3\u30D4\u30FC!";
            ja["qr_code"] = "QR\u30B3\u30FC\u30C9";
            ja["allow_firewall"] = "\u30D5\u30A1\u30A4\u30A2\u30A6\u30A9\u30FC\u30EB";
            ja["firewall_ready"] = "\u901A\u4FE1\u8A31\u53EF\u6E08";
            ja["localhost_only"] = "\u30ED\u30FC\u30AB\u30EB\u306E\u307F";
            ja["configuring"] = "\u8A2D\u5B9A\u4E2D...";
            ja["refresh"] = "\u66F4\u65B0";
            ja["lan_hint_default"] = "\u3053\u306EURL\u3092\u958B\u304F\u304B QR\u30B3\u30FC\u30C9\u3067\u30BF\u30D6\u30EC\u30C3\u30C8\u3084\u30B9\u30DE\u30DB\u3092\u63A5\u7D9A\u3057\u307E\u3059\u3002";
            ja["lan_hint_disabled"] = "\u8A2D\u5B9A\u3067\u300CLAN\u30A2\u30AF\u30BB\u30B9\u3092\u8A31\u53EF\u300D\u3092\u6709\u52B9\u306B\u3057\u3066\u304F\u3060\u3055\u3044\u3002";
            ja["lan_hint_no_adapter"] = "PC\u3092 Wi-Fi \u307E\u305F\u306F\u6709\u7DDALAN\u306B\u63A5\u7D9A\u3057\u3066\u66F4\u65B0\u3092\u62BC\u3057\u3066\u304F\u3060\u3055\u3044\u3002";
            ja["lan_hint_multi"] = "\u8907\u6570\u306E\u30CD\u30C3\u30C8\u30EF\u30FC\u30AF\u304C\u691C\u51FA\u3055\u308C\u307E\u3057\u305F \u2014 \u7AEF\u672B\u3068\u540C\u3058\u3082\u306E\u3092\u9078\u629E\u3057\u3066\u304F\u3060\u3055\u3044\u3002";
            ja["lan_disabled"] = "\u7121\u52B9 (localhost \u306E\u307F \u2014 127.0.0.1)";
            ja["lan_no_adapter"] = "\u6709\u52B9\u306A Wi-Fi / \u6709\u7DDALAN\u63A5\u7D9A\u304C\u3042\u308A\u307E\u305B\u3093";
            ja["lan_checking"] = "\u30CD\u30C3\u30C8\u30EF\u30FC\u30AF\u3092\u78BA\u8A8D\u4E2D...";
            ja["drawer_title"] = "\u8A2D\u5B9A\u30FB\u30ED\u30B0\u30FB\u60C5\u5831";
            ja["tab_settings"] = "\u8A2D\u5B9A";
            ja["tab_logs"] = "\u30ED\u30B0";
            ja["tab_about"] = "\u60C5\u5831";
            ja["settings_lock_hint"] = "\u30DD\u30FC\u30C8\u3084\u30DB\u30B9\u30C8\u5909\u66F4\u306F\u30B5\u30FC\u30D0\u30FC\u505C\u6B62\u4E2D\u306B\u53EF\u80FD";
            ja["map_port"] = "\u30DE\u30C3\u30D7\u30DD\u30FC\u30C8";
            ja["rpc_host"] = "\u30A8\u30DF\u30E5\u30EC\u30FC\u30BF RPC \u30DB\u30B9\u30C8";
            ja["rpc_port"] = "\u30A8\u30DF\u30E5\u30EC\u30FC\u30BF RPC \u30DD\u30FC\u30C8";
            ja["reset"] = "\u30EA\u30BB\u30C3\u30C8";
            ja["allow_lan"] = "LAN\u30A2\u30AF\u30BB\u30B9\u3092\u8A31\u53EF";
            ja["auto_open"] = "\u30D6\u30E9\u30A6\u30B6\u3092\u81EA\u52D5\u3067\u958B\u304F";
            ja["minimize_tray"] = "\u30C8\u30EC\u30A4\u306B\u6700\u5C0F\u5316";
            ja["save_folder"] = "\u30BB\u30FC\u30D6\u30D5\u30A9\u30EB\u30C0";
            ja["auto_detect"] = "\u81EA\u52D5\u691C\u51FA";
            ja["add_ellipsis"] = "\u8FFD\u52A0...";
            ja["remove"] = "\u524A\u9664";
            ja["save_slot"] = "\u30BB\u30FC\u30D6\u30B9\u30ED\u30C3\u30C8";
            ja["auto_latest"] = "\u81EA\u52D5 (\u6700\u65B0)";
            ja["language"] = "\u8A00\u8A9E";
            ja["check_updates"] = "\u30A2\u30C3\u30D7\u30C7\u30FC\u30C8\u78BA\u8A8D";
            ja["version_label"] = "\u30D0\u30FC\u30B8\u30E7\u30F3 {0}";
            ja["copy_logs"] = "\u30B3\u30D4\u30FC";
            ja["clear"] = "\u30AF\u30EA\u30A2";
            ja["about_original_map"] = "\u5143\u306E\u30DE\u30C3\u30D7";
            ja["about_artwork"] = "\u30DE\u30C3\u30D7\u30A2\u30FC\u30C8";
            ja["about_security"] = "\u7121\u6599\u30FB\u30AA\u30FC\u30D7\u30F3\u30BD\u30FC\u30B9 (GNU AGPL-3.0)\u3002\u516C\u5F0F: github.com/antonioalvromero/Ocarina-Atlas\u3002";
            ja["about_footer"] = "\u30D0\u30FC\u30B8\u30E7\u30F3 {0}  \u2022  SHA-256 \u307E\u305F\u306F GitHub \u8A3C\u660E\u3067\u516C\u5F0F\u30D3\u30EB\u30C9\u3092\u78BA\u8A8D";
            ja["tray_show"] = "Ocarina Atlas \u3092\u8868\u793A";
            ja["tray_open"] = "\u30D6\u30E9\u30A6\u30B6\u3067\u30DE\u30C3\u30D7\u3092\u958B\u304F";
            ja["tray_exit"] = "\u7D42\u4E86";
            ja["update_pill"] = "\u66F4\u65B0";
            map["ja"] = ja;

            Dictionary<string, string> ko = new Dictionary<string, string>(StringComparer.Ordinal);
            ko["app_title"] = "Ocarina Atlas \u2014 \uC2DC\uAC04\uC758 \uC624\uCE74\uB9AC\uB098 \uC9C0\uB3C4";
            ko["start_map"] = "\uC9C0\uB3C4 \uC2DC\uC791";
            ko["stop_map"] = "\uC9C0\uB3C4 \uC911\uC9C0";
            ko["stopping"] = "\uC911\uC9C0 \uC911...";
            ko["open_map"] = "\uC9C0\uB3C4 \uC5F4\uAE30";
            ko["setup_sync"] = "\uC6D0\uD074\uB9AD \uB3D9\uAE30\uD654";
            ko["setup_sync_port"] = "\uB3D9\uAE30\uD654 \uC124\uC815 (:{0})";
            ko["configured"] = "\uC124\uC815\uB428 \u21BB";
            ko["configured_port"] = "\uC124\uC815\uB428 (:{0}) \u21BB";
            ko["hero_idle"] = "\uC9C0\uB3C4 \uC2DC\uC791\uC744 \uB20C\uB7EC \uBE0C\uB77C\uC6B0\uC800\uC5D0\uC11C \uD558\uC774\uB7F4 \uC9C0\uB3C4\uB97C \uC5FD\uB2C8\uB2E4.";
            ko["hero_starting"] = "\uB85C\uCEEC \uC9C0\uB3C4 \uC11C\uBC84\uB97C \uC2DC\uC791\uD558\uB294 \uC911...";
            ko["hero_running"] = "\uC9C0\uB3C4\uAC00 \uBE0C\uB77C\uC6B0\uC800\uC5D0\uC11C \uC2E4\uD589 \uC911\uC785\uB2C8\uB2E4.";
            ko["hero_stopping"] = "\uC9C0\uB3C4 \uC11C\uBC84\uB97C \uC885\uB8CC\uD558\uB294 \uC911...";
            ko["hero_error"] = "\uC11C\uBC84\uB97C \uC2DC\uC791\uD560 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4. \uC124\uC815 \uBC0F \uB85C\uADF8\uB97C \uD655\uC778\uD558\uC138\uC694.";
            ko["sync_hint_default"] = "\uC6D0\uD074\uB9AD \uB3D9\uAE30\uD654\uB97C \uB20C\uB7EC \uC2E4\uC2DC\uAC04 \uCD94\uC801\uC744 \uD65C\uC131\uD654\uD558\uC138\uC694.";
            ko["sync_hint_configured"] = "\uC2E4\uC2DC\uAC04 \uB3D9\uAE30\uD654 \uC124\uC815\uB428. Lichii \uB610\uB294 Fritchii\uB97C \uC2E4\uD589\uD558\uC138\uC694.";
            ko["status_stopped"] = "\uC911\uC9C0\uB428";
            ko["status_running"] = "\uC2E4\uD589 \uC911";
            ko["status_starting"] = "\uC2DC\uC791 \uC911";
            ko["status_stopping"] = "\uC911\uC9C0 \uC911...";
            ko["status_error"] = "\uC624\uB958";
            ko["emu_none"] = "\uC5D0\uBBA4 \uC5C6\uC74C";
            ko["emu_live"] = "\uC2E4\uC2DC\uAC04";
            ko["emu_waiting"] = "\uB300\uAE30 \uC911";
            ko["emu_save"] = "\uC800\uC7A5";
            ko["emu_rpc_closed"] = "RPC \uB2EB\uD798";
            ko["lan_title"] = "\uC138\uCEE8\uB4DC \uC2A4\uD06C\uB9B0 (LAN)";
            ko["copy_url"] = "URL \uBCF5\uC0AC";
            ko["copied"] = "\uBCF5\uC0AC\uB428!";
            ko["qr_code"] = "QR \uCF54\uB4DC";
            ko["allow_firewall"] = "\uBC29\uD654\uBCBD \uD5C8\uC6A9";
            ko["firewall_ready"] = "\uBC29\uD654\uBCBD \uC900\uBE44";
            ko["localhost_only"] = "\uB85C\uCEEC \uC804\uC6A9";
            ko["configuring"] = "\uC124\uC815 \uC911...";
            ko["refresh"] = "\uC0C8\uB85C\uACE0\uCE68";
            ko["lan_hint_default"] = "\uC774 \uC8FC\uC18C\uB97C \uC5F4\uAC70\uB098 QR \uCF54\uB4DC\uB85C \uD0DC\uBE14\uB9BF, iPad, \uD734\uB300\uD3F0\uC744 \uC5F0\uACB0\uD558\uC138\uC694.";
            ko["lan_hint_disabled"] = "\uAE30\uAE30\uB97C \uC5F0\uACB0\uD558\uB824\uBA74 \uC124\uC815\uC5D0\uC11C \"LAN \uC811\uADFC \uD5C8\uC6A9\"\uC744 \uCF1C\uC138\uC694.";
            ko["lan_hint_no_adapter"] = "PC\uB97C Wi-Fi \uB610\uB294 \uC774\uB354\uB137\uC5D0 \uC5F0\uACB0\uD55C \uD6C4 \uC0C8\uB85C\uACE0\uCE68\uC744 \uB204\uB974\uC138\uC694.";
            ko["lan_hint_multi"] = "\uC5EC\uB7EC \uB124\uD2B8\uC6CC\uD06C \uC5B4\uB311\uD130 \uAC10\uC9C0 \u2014 \uAE30\uAE30\uAC00 \uC0AC\uC6A9\uD558\uB294 \uAC83\uC744 \uC120\uD0DD\uD558\uC138\uC694.";
            ko["lan_disabled"] = "\uBE44\uD65C\uC131\uD654 (\uB85C\uCEEC \uC804\uC6A9 \u2014 127.0.0.1)";
            ko["lan_no_adapter"] = "\uD65C\uC131 Wi-Fi \uB610\uB294 \uC774\uB354\uB137 \uC5F0\uACB0\uC774 \uAC10\uC9C0\uB418\uC9C0 \uC54A\uC558\uC2B5\uB2C8\uB2E4";
            ko["lan_checking"] = "\uB124\uD2B8\uC6CC\uD06C \uC5B4\uB311\uD130 \uD655\uC778 \uC911...";
            ko["drawer_title"] = "\uC124\uC815, \uB85C\uADF8 \uBC0F \uC815\uBCF4";
            ko["tab_settings"] = "\uC124\uC815";
            ko["tab_logs"] = "\uB85C\uADF8";
            ko["tab_about"] = "\uC815\uBCF4";
            ko["settings_lock_hint"] = "\uD3EC\uD2B8/\uD638\uC2A4\uD2B8\uB97C \uC218\uC815\uD558\uB824\uBA74 \uC11C\uBC84\uB97C \uC911\uC9C0\uD558\uC138\uC694";
            ko["map_port"] = "\uC9C0\uB3C4 \uD3EC\uD2B8";
            ko["rpc_host"] = "\uC5D0\uBBA4\uB808\uC774\uD130 RPC \uD638\uC2A4\uD2B8";
            ko["rpc_port"] = "\uC5D0\uBBA4\uB808\uC774\uD130 RPC \uD3EC\uD2B8";
            ko["reset"] = "\uCD08\uAE30\uD654";
            ko["allow_lan"] = "LAN \uC811\uADFC \uD5C8\uC6A9";
            ko["auto_open"] = "\uBE0C\uB77C\uC6B0\uC800 \uC790\uB3D9 \uC5F4\uAE30";
            ko["minimize_tray"] = "\uD2B8\uB808\uC774\uB85C \uCD5C\uC18C\uD654";
            ko["save_folder"] = "\uC800\uC7A5 \uD3F4\uB354";
            ko["auto_detect"] = "\uC790\uB3D9 \uAC10\uC9C0";
            ko["add_ellipsis"] = "\uCD94\uAC00...";
            ko["remove"] = "\uC81C\uAC70";
            ko["save_slot"] = "\uC800\uC7A5 \uC2AC\uB86F";
            ko["auto_latest"] = "\uC790\uB3D9 (\uCD5C\uC2E0)";
            ko["language"] = "\uC5B8\uC5B4";
            ko["check_updates"] = "\uC5C5\uB370\uC774\uD2B8 \uD655\uC778";
            ko["version_label"] = "\uBC84\uC804 {0}";
            ko["copy_logs"] = "\uB85C\uADF8 \uBCF5\uC0AC";
            ko["clear"] = "\uC9C0\uC6B0\uAE30";
            ko["about_original_map"] = "\uC6D0\uBCF8 \uC9C0\uB3C4";
            ko["about_artwork"] = "\uC9C0\uB3C4 \uC544\uD2B8\uC6CC\uD06C";
            ko["about_security"] = "\uBB34\uB8CC \uC624\uD508 \uC18C\uC2A4 (GNU AGPL-3.0). \uACF5\uC2DD \uBE4C\uB4DC: github.com/antonioalvromero/Ocarina-Atlas.";
            ko["about_footer"] = "\uBC84\uC804 {0}  \u2022  SHA-256 \uB610\uB294 GitHub \uC99D\uBA85\uC73C\uB85C \uACF5\uC2DD \uB9B4\uB9AC\uC2A4 \uD655\uC778";
            ko["tray_show"] = "Ocarina Atlas \uBCF4\uAE30";
            ko["tray_open"] = "\uBE0C\uB77C\uC6B0\uC800\uC5D0\uC11C \uC9C0\uB3C4 \uC5F4\uAE30";
            ko["tray_exit"] = "\uC885\uB8CC";
            ko["update_pill"] = "\uC5C5\uB370\uC774\uD2B8";
            map["ko"] = ko;

            Dictionary<string, string> nl = new Dictionary<string, string>(StringComparer.Ordinal);
            nl["app_title"] = "Ocarina Atlas \u2014 Ocarina of Time Kaart-tracker";
            nl["start_map"] = "Start kaart";
            nl["stop_map"] = "Stop kaart";
            nl["stopping"] = "Stoppen...";
            nl["open_map"] = "Open kaart";
            nl["setup_sync"] = "1-Klik Sync Instellen";
            nl["setup_sync_port"] = "Sync Instellen (:{0})";
            nl["configured"] = "Ingesteld \u21BB";
            nl["configured_port"] = "Ingesteld (:{0}) \u21BB";
            nl["hero_idle"] = "Klik op Start kaart om de interactieve Hyrule-kaart in je browser te openen.";
            nl["hero_starting"] = "Lokale kaartserver wordt gestart...";
            nl["hero_running"] = "De kaart is live en klaar in je browser.";
            nl["hero_stopping"] = "Kaartserver wordt afgesloten...";
            nl["hero_error"] = "Kan de kaartserver niet starten. Controleer Instellingen, Logboek & Over.";
            nl["sync_hint_default"] = "Klik op 1-Klik Sync Instellen om live tracking in Lichii / Fritchii te activeren.";
            nl["sync_hint_configured"] = "Live sync ingesteld. Start Lichii of Fritchii en laad Ocarina of Time.";
            nl["status_stopped"] = "Gestopt";
            nl["status_running"] = "Actief";
            nl["status_starting"] = "Starten";
            nl["status_stopping"] = "Stoppen...";
            nl["status_error"] = "Fout";
            nl["emu_none"] = "Geen emu";
            nl["emu_live"] = "Live";
            nl["emu_waiting"] = "Wachten";
            nl["emu_save"] = "Save";
            nl["emu_rpc_closed"] = "RPC dicht";
            nl["lan_title"] = "Tweede scherm (LAN)";
            nl["copy_url"] = "Kopieer URL";
            nl["copied"] = "Gekopieerd!";
            nl["qr_code"] = "QR-code";
            nl["allow_firewall"] = "Firewall toestaan";
            nl["firewall_ready"] = "Firewall gereed";
            nl["localhost_only"] = "Alleen lokaal";
            nl["configuring"] = "Instellen...";
            nl["refresh"] = "Vernieuwen";
            nl["lan_hint_default"] = "Open dit adres of klik op QR-code om je tablet, iPad of telefoon te verbinden.";
            nl["lan_hint_disabled"] = "Schakel \"LAN-toegang toestaan\" in bij Instellingen voor een mobiel apparaat.";
            nl["lan_hint_no_adapter"] = "Verbind je pc met Wi-Fi of Ethernet en klik op Vernieuwen.";
            nl["lan_hint_multi"] = "Meerdere netwerkadapters gevonden \u2014 kies die van je apparaat.";
            nl["lan_disabled"] = "Uitgeschakeld (alleen localhost \u2014 127.0.0.1)";
            nl["lan_no_adapter"] = "Geen actieve Wi-Fi- of Ethernet-verbinding gevonden";
            nl["lan_checking"] = "Netwerkadapters controleren...";
            nl["drawer_title"] = "Instellingen, Logboek & Over";
            nl["tab_settings"] = "Instell.";
            nl["tab_logs"] = "Logboek";
            nl["tab_about"] = "Over";
            nl["settings_lock_hint"] = "Stop de server om poort of host te wijzigen";
            nl["map_port"] = "Kaartpoort";
            nl["rpc_host"] = "Emulator RPC-host";
            nl["rpc_port"] = "Emulator RPC-poort";
            nl["reset"] = "Herstel";
            nl["allow_lan"] = "LAN-toegang toestaan";
            nl["auto_open"] = "Browser autom. openen";
            nl["minimize_tray"] = "Minimaliseren naar systeemvak";
            nl["save_folder"] = "Opslagmap";
            nl["auto_detect"] = "Automatisch";
            nl["add_ellipsis"] = "Toevoegen...";
            nl["remove"] = "Verwijder";
            nl["save_slot"] = "Opslagslot";
            nl["auto_latest"] = "Auto (Nieuwste)";
            nl["language"] = "Taal";
            nl["check_updates"] = "Controleer op updates";
            nl["version_label"] = "Versie {0}";
            nl["copy_logs"] = "Kopieer";
            nl["clear"] = "Wissen";
            nl["about_original_map"] = "Originele kaart";
            nl["about_artwork"] = "Kaart-artwork";
            nl["about_security"] = "Gratis & open-source (GNU AGPL-3.0). Offici\u00EBle builds: github.com/antonioalvromero/Ocarina-Atlas.";
            nl["about_footer"] = "Versie {0}  \u2022  Controleer offici\u00EBle releases via SHA-256 of GitHub-attestatie";
            nl["tray_show"] = "Ocarina Atlas tonen";
            nl["tray_open"] = "Kaart openen in browser";
            nl["tray_exit"] = "Afsluiten";
            nl["update_pill"] = "Update";
            map["nl"] = nl;

            Dictionary<string, string> ru = new Dictionary<string, string>(StringComparer.Ordinal);
            ru["app_title"] = "Ocarina Atlas \u2014 \u041A\u0430\u0440\u0442\u0430 Ocarina of Time";
            ru["start_map"] = "\u0417\u0430\u043F\u0443\u0441\u0442\u0438\u0442\u044C";
            ru["stop_map"] = "\u041E\u0441\u0442\u0430\u043D\u043E\u0432\u0438\u0442\u044C";
            ru["stopping"] = "\u041E\u0441\u0442\u0430\u043D\u043E\u0432\u043A\u0430...";
            ru["open_map"] = "\u041E\u0442\u043A\u0440\u044B\u0442\u044C \u043A\u0430\u0440\u0442\u0443";
            ru["setup_sync"] = "\u041D\u0430\u0441\u0442\u0440\u043E\u0438\u0442\u044C Sync";
            ru["setup_sync_port"] = "\u041D\u0430\u0441\u0442\u0440. Sync (:{0})";
            ru["configured"] = "\u041D\u0430\u0441\u0442\u0440\u043E\u0435\u043D\u043E \u21BB";
            ru["configured_port"] = "\u041D\u0430\u0441\u0442\u0440\u043E\u0435\u043D\u043E (:{0}) \u21BB";
            ru["hero_idle"] = "\u041D\u0430\u0436\u043C\u0438\u0442\u0435 \u0417\u0430\u043F\u0443\u0441\u0442\u0438\u0442\u044C, \u0447\u0442\u043E\u0431\u044B \u043E\u0442\u043A\u0440\u044B\u0442\u044C \u0438\u043D\u0442\u0435\u0440\u0430\u043A\u0442\u0438\u0432\u043D\u0443\u044E \u043A\u0430\u0440\u0442\u0443 \u0425\u0430\u0439\u0440\u0443\u043B\u0430 \u0432 \u0431\u0440\u0430\u0443\u0437\u0435\u0440\u0435.";
            ru["hero_starting"] = "\u0417\u0430\u043F\u0443\u0441\u043A \u043B\u043E\u043A\u0430\u043B\u044C\u043D\u043E\u0433\u043E \u0441\u0435\u0440\u0432\u0435\u0440\u0430 \u043A\u0430\u0440\u0442\u044B...";
            ru["hero_running"] = "\u041A\u0430\u0440\u0442\u0430 \u0440\u0430\u0431\u043E\u0442\u0430\u0435\u0442 \u0438 \u0433\u043E\u0442\u043E\u0432\u0430 \u0432 \u0431\u0440\u0430\u0443\u0437\u0435\u0440\u0435.";
            ru["hero_stopping"] = "\u041E\u0441\u0442\u0430\u043D\u043E\u0432\u043A\u0430 \u0441\u0435\u0440\u0432\u0435\u0440\u0430 \u043A\u0430\u0440\u0442\u044B...";
            ru["hero_error"] = "\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0437\u0430\u043F\u0443\u0441\u0442\u0438\u0442\u044C \u0441\u0435\u0440\u0432\u0435\u0440. \u041F\u0440\u043E\u0432\u0435\u0440\u044C\u0442\u0435 \u041D\u0430\u0441\u0442\u0440\u043E\u0439\u043A\u0438 \u0438 \u0416\u0443\u0440\u043D\u0430\u043B.";
            ru["sync_hint_default"] = "\u041D\u0430\u0436\u043C\u0438\u0442\u0435 \u041D\u0430\u0441\u0442\u0440\u043E\u0438\u0442\u044C Sync \u0434\u043B\u044F \u043E\u0442\u0441\u043B\u0435\u0436\u0438\u0432\u0430\u043D\u0438\u044F \u0432 \u0440\u0435\u0430\u043B\u044C\u043D\u043E\u043C \u0432\u0440\u0435\u043C\u0435\u043D\u0438.";
            ru["sync_hint_configured"] = "\u0421\u0438\u043D\u0445\u0440\u043E\u043D\u0438\u0437\u0430\u0446\u0438\u044F \u043D\u0430\u0441\u0442\u0440\u043E\u0435\u043D\u0430. \u0417\u0430\u043F\u0443\u0441\u0442\u0438\u0442\u0435 Lichii \u0438\u043B\u0438 Fritchii.";
            ru["status_stopped"] = "\u041E\u0441\u0442\u0430\u043D\u043E\u0432\u043B\u0435\u043D";
            ru["status_running"] = "\u0420\u0430\u0431\u043E\u0442\u0430\u0435\u0442";
            ru["status_starting"] = "\u0417\u0430\u043F\u0443\u0441\u043A";
            ru["status_stopping"] = "\u041E\u0441\u0442\u0430\u043D\u043E\u0432\u043A\u0430...";
            ru["status_error"] = "\u041E\u0448\u0438\u0431\u043A\u0430";
            ru["emu_none"] = "\u041D\u0435\u0442 \u044D\u043C\u0443";
            ru["emu_live"] = "\u0412 \u044D\u0444\u0438\u0440\u0435";
            ru["emu_waiting"] = "\u041E\u0436\u0438\u0434\u0430\u043D\u0438\u0435";
            ru["emu_save"] = "\u0421\u043E\u0445\u0440\u0430\u043D.";
            ru["emu_rpc_closed"] = "RPC \u0437\u0430\u043A\u0440\u044B\u0442";
            ru["lan_title"] = "\u0412\u0442\u043E\u0440\u043E\u0439 \u044D\u043A\u0440\u0430\u043D (LAN)";
            ru["copy_url"] = "\u041A\u043E\u043F\u0438\u0440. URL";
            ru["copied"] = "\u0421\u043A\u043E\u043F\u0438\u0440.!";
            ru["qr_code"] = "QR-\u043A\u043E\u0434";
            ru["allow_firewall"] = "\u0411\u0440\u0430\u043D\u0434\u043C\u0430\u0443\u044D\u0440";
            ru["firewall_ready"] = "\u041F\u043E\u0440\u0442 \u043E\u0442\u043A\u0440\u044B\u0442";
            ru["localhost_only"] = "\u0422\u043E\u043B\u044C\u043A\u043E \u043B\u043E\u043A\u0430\u043B.";
            ru["configuring"] = "\u041D\u0430\u0441\u0442\u0440\u043E\u0439\u043A\u0430...";
            ru["refresh"] = "\u041E\u0431\u043D\u043E\u0432\u0438\u0442\u044C";
            ru["lan_hint_default"] = "\u041E\u0442\u043A\u0440\u043E\u0439\u0442\u0435 \u044D\u0442\u043E\u0442 \u0430\u0434\u0440\u0435\u0441 \u0438\u043B\u0438 QR-\u043A\u043E\u0434 \u043D\u0430 \u043F\u043B\u0430\u043D\u0448\u0435\u0442\u0435 \u0438\u043B\u0438 \u0442\u0435\u043B\u0435\u0444\u043E\u043D\u0435.";
            ru["lan_hint_disabled"] = "\u0412\u043A\u043B\u044E\u0447\u0438\u0442\u0435 \u00AB\u0420\u0430\u0437\u0440\u0435\u0448\u0438\u0442\u044C \u0434\u043E\u0441\u0442\u0443\u043F \u043F\u043E LAN\u00BB \u0432 \u041D\u0430\u0441\u0442\u0440\u043E\u0439\u043A\u0430\u0445.";
            ru["lan_hint_no_adapter"] = "\u041F\u043E\u0434\u043A\u043B\u044E\u0447\u0438\u0442\u0435 \u041F\u041A \u043A Wi-Fi \u0438\u043B\u0438 Ethernet \u0438 \u043D\u0430\u0436\u043C\u0438\u0442\u0435 \u041E\u0431\u043D\u043E\u0432\u0438\u0442\u044C.";
            ru["lan_hint_multi"] = "\u041D\u0430\u0439\u0434\u0435\u043D\u043E \u043D\u0435\u0441\u043A\u043E\u043B\u044C\u043A\u043E \u0430\u0434\u0430\u043F\u0442\u0435\u0440\u043E\u0432 \u2014 \u0432\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \u043D\u0443\u0436\u043D\u044B\u0439.";
            ru["lan_disabled"] = "\u041E\u0442\u043A\u043B\u044E\u0447\u0435\u043D\u043E (\u0442\u043E\u043B\u044C\u043A\u043E localhost \u2014 127.0.0.1)";
            ru["lan_no_adapter"] = "\u0410\u043A\u0442\u0438\u0432\u043D\u043E\u0435 \u043F\u043E\u0434\u043A\u043B\u044E\u0447\u0435\u043D\u0438\u0435 Wi-Fi \u0438\u043B\u0438 Ethernet \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D\u043E";
            ru["lan_checking"] = "\u041F\u0440\u043E\u0432\u0435\u0440\u043A\u0430 \u0441\u0435\u0442\u0435\u0432\u044B\u0445 \u0430\u0434\u0430\u043F\u0442\u0435\u0440\u043E\u0432...";
            ru["drawer_title"] = "\u041D\u0430\u0441\u0442\u0440\u043E\u0439\u043A\u0438, \u0416\u0443\u0440\u043D\u0430\u043B \u0438 \u041E \u043F\u0440\u043E\u0433\u0440\u0430\u043C\u043C\u0435";
            ru["tab_settings"] = "\u041D\u0430\u0441\u0442\u0440\u043E\u0439\u043A\u0438";
            ru["tab_logs"] = "\u0416\u0443\u0440\u043D\u0430\u043B";
            ru["tab_about"] = "\u041E \u043F\u0440\u043E\u0433\u0440.";
            ru["settings_lock_hint"] = "\u041E\u0441\u0442\u0430\u043D\u043E\u0432\u0438\u0442\u0435 \u0441\u0435\u0440\u0432\u0435\u0440 \u0434\u043B\u044F \u0438\u0437\u043C\u0435\u043D\u0435\u043D\u0438\u044F \u043F\u043E\u0440\u0442\u0430";
            ru["map_port"] = "\u041F\u043E\u0440\u0442 \u043A\u0430\u0440\u0442\u044B";
            ru["rpc_host"] = "\u0425\u043E\u0441\u0442 RPC \u044D\u043C\u0443\u043B\u044F\u0442\u043E\u0440\u0430";
            ru["rpc_port"] = "\u041F\u043E\u0440\u0442 RPC \u044D\u043C\u0443\u043B\u044F\u0442\u043E\u0440\u0430";
            ru["reset"] = "\u0421\u0431\u0440\u043E\u0441";
            ru["allow_lan"] = "\u0420\u0430\u0437\u0440\u0435\u0448\u0438\u0442\u044C \u0434\u043E\u0441\u0442\u0443\u043F \u043F\u043E LAN";
            ru["auto_open"] = "\u0410\u0432\u0442\u043E\u043E\u0442\u043A\u0440\u044B\u0442\u0438\u0435 \u0431\u0440\u0430\u0443\u0437\u0435\u0440\u0430";
            ru["minimize_tray"] = "\u0421\u0432\u043E\u0440\u0430\u0447\u0438\u0432\u0430\u0442\u044C \u0432 \u0442\u0440\u0435\u0439";
            ru["save_folder"] = "\u041F\u0430\u043F\u043A\u0430 \u0441\u043E\u0445\u0440\u0430\u043D\u0435\u043D\u0438\u0439";
            ru["auto_detect"] = "\u0410\u0432\u0442\u043E\u043E\u043F\u0440\u0435\u0434\u0435\u043B\u0435\u043D\u0438\u0435";
            ru["add_ellipsis"] = "\u0414\u043E\u0431\u0430\u0432...";
            ru["remove"] = "\u0423\u0434\u0430\u043B\u0438\u0442\u044C";
            ru["save_slot"] = "\u0421\u043B\u043E\u0442";
            ru["auto_latest"] = "\u0410\u0432\u0442\u043E (\u041F\u043E\u0441\u043B\u0435\u0434\u043D\u0438\u0439)";
            ru["language"] = "\u042F\u0437\u044B\u043A";
            ru["check_updates"] = "\u041F\u0440\u043E\u0432\u0435\u0440\u0438\u0442\u044C \u043E\u0431\u043D\u043E\u0432\u043B\u0435\u043D\u0438\u044F";
            ru["version_label"] = "\u0412\u0435\u0440\u0441\u0438\u044F {0}";
            ru["copy_logs"] = "\u041A\u043E\u043F\u0438\u0440.";
            ru["clear"] = "\u041E\u0447\u0438\u0441\u0442.";
            ru["about_original_map"] = "\u041E\u0440\u0438\u0433\u0438\u043D\u0430\u043B";
            ru["about_artwork"] = "\u0413\u0440\u0430\u0444\u0438\u043A\u0430";
            ru["about_security"] = "\u0421\u0432\u043E\u0431\u043E\u0434\u043D\u043E\u0435 \u041F\u041E (GNU AGPL-3.0). \u041E\u0444\u0438\u0446\u0438\u0430\u043B\u044C\u043D\u044B\u0435 \u0441\u0431\u043E\u0440\u043A\u0438: github.com/antonioalvromero/Ocarina-Atlas.";
            ru["about_footer"] = "\u0412\u0435\u0440\u0441\u0438\u044F {0}  \u2022  \u041F\u0440\u043E\u0432\u0435\u0440\u044F\u0439\u0442\u0435 \u0440\u0435\u043B\u0438\u0437\u044B \u0447\u0435\u0440\u0435\u0437 SHA-256 \u0438\u043B\u0438 GitHub";
            ru["tray_show"] = "\u041F\u043E\u043A\u0430\u0437\u0430\u0442\u044C Ocarina Atlas";
            ru["tray_open"] = "\u041E\u0442\u043A\u0440\u044B\u0442\u044C \u043A\u0430\u0440\u0442\u0443 \u0432 \u0431\u0440\u0430\u0443\u0437\u0435\u0440\u0435";
            ru["tray_exit"] = "\u0412\u044B\u0445\u043E\u0434";
            ru["update_pill"] = "\u041E\u0431\u043D\u043E\u0432.";
            map["ru"] = ru;

            Dictionary<string, string> pl = new Dictionary<string, string>(StringComparer.Ordinal);
            pl["app_title"] = "Ocarina Atlas \u2014 Mapa Ocarina of Time";
            pl["start_map"] = "Uruchom map\u0119";
            pl["stop_map"] = "Zatrzymaj";
            pl["stopping"] = "Zatrzymywanie...";
            pl["open_map"] = "Otw\u00F3rz map\u0119";
            pl["setup_sync"] = "Konfiguruj Sync (1 klik)";
            pl["setup_sync_port"] = "Konfiguruj Sync (:{0})";
            pl["configured"] = "Skonfig. \u21BB";
            pl["configured_port"] = "Skonfig. (:{0}) \u21BB";
            pl["hero_idle"] = "Kliknij Uruchom map\u0119, aby otworzy\u0107 interaktywn\u0105 map\u0119 Hyrule w przegl\u0105darce.";
            pl["hero_starting"] = "Uruchamianie lokalnego serwera mapy...";
            pl["hero_running"] = "Mapa jest aktywna i gotowa w przegl\u0105darce.";
            pl["hero_stopping"] = "Zamykanie serwera mapy...";
            pl["hero_error"] = "Nie uda\u0142o si\u0119 uruchomi\u0107 serwera. Sprawd\u017A Ustawienia, Logi i O programie.";
            pl["sync_hint_default"] = "Kliknij Konfiguruj Sync, aby w\u0142\u0105czy\u0107 \u015Bledzenie na \u017Cywo w Lichii / Fritchii.";
            pl["sync_hint_configured"] = "Sync na \u017Cywo skonfigurowany. Uruchom Lichii lub Fritchii i wczytaj gr\u0119.";
            pl["status_stopped"] = "Zatrzymany";
            pl["status_running"] = "Dzia\u0142a";
            pl["status_starting"] = "Urucham.";
            pl["status_stopping"] = "Zatrzym...";
            pl["status_error"] = "B\u0142\u0105d";
            pl["emu_none"] = "Brak emu";
            pl["emu_live"] = "Na \u017Cywo";
            pl["emu_waiting"] = "Oczekiw.";
            pl["emu_save"] = "Zapis";
            pl["emu_rpc_closed"] = "RPC zamkn.";
            pl["lan_title"] = "Drugi ekran (LAN)";
            pl["copy_url"] = "Kopiuj URL";
            pl["copied"] = "Skopiowano!";
            pl["qr_code"] = "Kod QR";
            pl["allow_firewall"] = "Zezw\u00F3l zaporze";
            pl["firewall_ready"] = "Zapora gotowa";
            pl["localhost_only"] = "Tylko lokalnie";
            pl["configuring"] = "Konfiguracja...";
            pl["refresh"] = "Od\u015Bwie\u017C";
            pl["lan_hint_default"] = "Otw\u00F3rz ten adres lub kliknij Kod QR, aby po\u0142\u0105czy\u0107 tablet, iPad lub telefon.";
            pl["lan_hint_disabled"] = "W\u0142\u0105cz \"Zezw\u00F3l na dost\u0119p LAN\" w Ustawieniach, aby po\u0142\u0105czy\u0107 urz\u0105dzenie.";
            pl["lan_hint_no_adapter"] = "Po\u0142\u0105cz PC z Wi-Fi lub Ethernet i kliknij Od\u015Bwie\u017C.";
            pl["lan_hint_multi"] = "Wykryto wiele kart sieciowych \u2014 wybierz t\u0119 u\u017Cywan\u0105 przez urz\u0105dzenie.";
            pl["lan_disabled"] = "Wy\u0142\u0105czono (tylko localhost \u2014 127.0.0.1)";
            pl["lan_no_adapter"] = "Nie wykryto aktywnego po\u0142\u0105czenia Wi-Fi ani Ethernet";
            pl["lan_checking"] = "Sprawdzanie kart sieciowych...";
            pl["drawer_title"] = "Ustawienia, Logi i O programie";
            pl["tab_settings"] = "Ustaw.";
            pl["tab_logs"] = "Logi";
            pl["tab_about"] = "O prog.";
            pl["settings_lock_hint"] = "Zatrzymaj serwer, aby edytowa\u0107 port lub host";
            pl["map_port"] = "Port mapy";
            pl["rpc_host"] = "Host RPC emulatora";
            pl["rpc_port"] = "Port RPC emulatora";
            pl["reset"] = "Resetuj";
            pl["allow_lan"] = "Zezw\u00F3l na dost\u0119p LAN";
            pl["auto_open"] = "Auto-otwieranie przegl\u0105darki";
            pl["minimize_tray"] = "Minimalizuj do zasobnika";
            pl["save_folder"] = "Folder zapis\u00F3w";
            pl["auto_detect"] = "Auto-wykrywanie";
            pl["add_ellipsis"] = "Dodaj...";
            pl["remove"] = "Usu\u0144";
            pl["save_slot"] = "Slot zapisu";
            pl["auto_latest"] = "Auto (Najnowszy)";
            pl["language"] = "J\u0119zyk";
            pl["check_updates"] = "Sprawd\u017A aktualizacje";
            pl["version_label"] = "Wersja {0}";
            pl["copy_logs"] = "Kopiuj";
            pl["clear"] = "Wyczy\u015B\u0107";
            pl["about_original_map"] = "Oryginalna mapa";
            pl["about_artwork"] = "Grafika mapy";
            pl["about_security"] = "Darmowe i open-source (GNU AGPL-3.0). Oficjalne wydania: github.com/antonioalvromero/Ocarina-Atlas.";
            pl["about_footer"] = "Wersja {0}  \u2022  Weryfikuj oficjalne wydania przez SHA-256 lub GitHub";
            pl["tray_show"] = "Poka\u017C Ocarina Atlas";
            pl["tray_open"] = "Otw\u00F3rz map\u0119 w przegl\u0105darce";
            pl["tray_exit"] = "Zako\u0144cz";
            pl["update_pill"] = "Aktual.";
            map["pl"] = pl;

            Dictionary<string, string> tr = new Dictionary<string, string>(StringComparer.Ordinal);
            tr["app_title"] = "Ocarina Atlas \u2014 Ocarina of Time Haritas\u0131";
            tr["start_map"] = "Haritay\u0131 Ba\u015Flat";
            tr["stop_map"] = "Durdur";
            tr["stopping"] = "Durduruluyor...";
            tr["open_map"] = "Haritay\u0131 A\u00E7";
            tr["setup_sync"] = "Tek T\u0131kla Sync Kur";
            tr["setup_sync_port"] = "Sync Kur (:{0})";
            tr["configured"] = "Ayarland\u0131 \u21BB";
            tr["configured_port"] = "Ayarland\u0131 (:{0}) \u21BB";
            tr["hero_idle"] = "Taray\u0131c\u0131da etkile\u015Fimli Hyrule haritas\u0131n\u0131 a\u00E7mak i\u00E7in Haritay\u0131 Ba\u015Flat'a t\u0131klay\u0131n.";
            tr["hero_starting"] = "Yerel harita sunucusu ba\u015Flat\u0131l\u0131yor...";
            tr["hero_running"] = "Harita canl\u0131 ve taray\u0131c\u0131n\u0131zda haz\u0131r.";
            tr["hero_stopping"] = "Harita sunucusu kapat\u0131l\u0131yor...";
            tr["hero_error"] = "Harita sunucusu ba\u015Flat\u0131lamad\u0131. Ayarlar ve G\u00FCnl\u00FCkleri kontrol edin.";
            tr["sync_hint_default"] = "Canl\u0131 takip i\u00E7in Tek T\u0131kla Sync Kur d\u00FC\u011Fmesine t\u0131klay\u0131n.";
            tr["sync_hint_configured"] = "Canl\u0131 sync ayarland\u0131. Lichii veya Fritchii'yi ba\u015Flat\u0131p oyunu y\u00FCkleyin.";
            tr["status_stopped"] = "Durdu";
            tr["status_running"] = "\u00C7al\u0131\u015F\u0131yor";
            tr["status_starting"] = "Ba\u015Fl\u0131yor";
            tr["status_stopping"] = "Duruyor...";
            tr["status_error"] = "Hata";
            tr["emu_none"] = "Emu Yok";
            tr["emu_live"] = "Canl\u0131";
            tr["emu_waiting"] = "Bekliyor";
            tr["emu_save"] = "Kay\u0131t";
            tr["emu_rpc_closed"] = "RPC Kapal\u0131";
            tr["lan_title"] = "\u0130kinci Ekran (LAN)";
            tr["copy_url"] = "URL Kopyala";
            tr["copied"] = "Kopyaland\u0131!";
            tr["qr_code"] = "QR Kod";
            tr["allow_firewall"] = "G\u00FCvenlik Duvar\u0131";
            tr["firewall_ready"] = "Duvar Haz\u0131r";
            tr["localhost_only"] = "Yaln\u0131z Yerel";
            tr["configuring"] = "Ayarlan\u0131yor...";
            tr["refresh"] = "Yenile";
            tr["lan_hint_default"] = "Tablet, iPad veya telefon ba\u011Flamak i\u00E7in bu adresi a\u00E7\u0131n veya QR Kod'a t\u0131klay\u0131n.";
            tr["lan_hint_disabled"] = "Cihaz ba\u011Flamak i\u00E7in Ayarlar'dan \"LAN eri\u015Fimine izin ver\"i etkinle\u015Ftirin.";
            tr["lan_hint_no_adapter"] = "PC'yi Wi-Fi veya Ethernet'e ba\u011Flay\u0131p Yenile'ye t\u0131klay\u0131n.";
            tr["lan_hint_multi"] = "Birden fazla a\u011F ba\u011Fda\u015Ft\u0131r\u0131c\u0131s\u0131 bulundu \u2014 cihaz\u0131n\u0131z\u0131n kulland\u0131\u011F\u0131n\u0131 se\u00E7in.";
            tr["lan_disabled"] = "Devre d\u0131\u015F\u0131 (yaln\u0131zca localhost \u2014 127.0.0.1)";
            tr["lan_no_adapter"] = "Etkin Wi-Fi veya Ethernet ba\u011Flant\u0131s\u0131 alg\u0131lanmad\u0131";
            tr["lan_checking"] = "A\u011F ba\u011Fda\u015Ft\u0131r\u0131c\u0131lar\u0131 denetleniyor...";
            tr["drawer_title"] = "Ayarlar, G\u00FCnl\u00FCkler ve Hakk\u0131nda";
            tr["tab_settings"] = "Ayarlar";
            tr["tab_logs"] = "G\u00FCnl\u00FCk";
            tr["tab_about"] = "Hakk\u0131nda";
            tr["settings_lock_hint"] = "Port/host d\u00FCzenlemek i\u00E7in sunucuyu durdurun";
            tr["map_port"] = "Harita Portu";
            tr["rpc_host"] = "Em\u00FClat\u00F6r RPC Host";
            tr["rpc_port"] = "Em\u00FClat\u00F6r RPC Portu";
            tr["reset"] = "S\u0131f\u0131rla";
            tr["allow_lan"] = "LAN eri\u015Fimine izin ver";
            tr["auto_open"] = "Taray\u0131c\u0131y\u0131 oto. a\u00E7";
            tr["minimize_tray"] = "Tepsiye k\u00FC\u00E7\u00FClt";
            tr["save_folder"] = "Kay\u0131t Klas\u00F6r\u00FC";
            tr["auto_detect"] = "Otomatik alg\u0131la";
            tr["add_ellipsis"] = "Ekle...";
            tr["remove"] = "Kald\u0131r";
            tr["save_slot"] = "Kay\u0131t Yuvas\u0131";
            tr["auto_latest"] = "Oto (En Son)";
            tr["language"] = "Dil";
            tr["check_updates"] = "G\u00FCncellemeleri Denetle";
            tr["version_label"] = "S\u00FCr\u00FCm {0}";
            tr["copy_logs"] = "Kopyala";
            tr["clear"] = "Temizle";
            tr["about_original_map"] = "Orijinal Harita";
            tr["about_artwork"] = "Harita \u00C7izimi";
            tr["about_security"] = "\u00DCcretsiz ve a\u00E7\u0131k kaynak (GNU AGPL-3.0). Resmi derlemeler: github.com/antonioalvromero/Ocarina-Atlas.";
            tr["about_footer"] = "S\u00FCr\u00FCm {0}  \u2022  Resmi s\u00FCr\u00FCmleri SHA-256 veya GitHub ile do\u011Frulay\u0131n";
            tr["tray_show"] = "Ocarina Atlas'\u0131 G\u00F6ster";
            tr["tray_open"] = "Haritay\u0131 Taray\u0131c\u0131da A\u00E7";
            tr["tray_exit"] = "\u00C7\u0131k\u0131\u015F";
            tr["update_pill"] = "G\u00FCncel.";
            map["tr"] = tr;

            Dictionary<string, string> uk = new Dictionary<string, string>(StringComparer.Ordinal);
            uk["app_title"] = "Ocarina Atlas \u2014 \u041A\u0430\u0440\u0442\u0430 Ocarina of Time";
            uk["start_map"] = "\u0417\u0430\u043F\u0443\u0441\u0442\u0438\u0442\u0438";
            uk["stop_map"] = "\u0417\u0443\u043F\u0438\u043D\u0438\u0442\u0438";
            uk["stopping"] = "\u0417\u0443\u043F\u0438\u043D\u043A\u0430...";
            uk["open_map"] = "\u0412\u0456\u0434\u043A\u0440\u0438\u0442\u0438 \u043A\u0430\u0440\u0442\u0443";
            uk["setup_sync"] = "\u041D\u0430\u043B\u0430\u0448\u0442. Sync";
            uk["setup_sync_port"] = "\u041D\u0430\u043B\u0430\u0448\u0442. Sync (:{0})";
            uk["configured"] = "\u041D\u0430\u043B\u0430\u0448\u0442\u043E\u0432. \u21BB";
            uk["configured_port"] = "\u041D\u0430\u043B\u0430\u0448\u0442. (:{0}) \u21BB";
            uk["hero_idle"] = "\u041D\u0430\u0442\u0438\u0441\u043D\u0456\u0442\u044C \u0417\u0430\u043F\u0443\u0441\u0442\u0438\u0442\u0438, \u0449\u043E\u0431 \u0432\u0456\u0434\u043A\u0440\u0438\u0442\u0438 \u0456\u043D\u0442\u0435\u0440\u0430\u043A\u0442\u0438\u0432\u043D\u0443 \u043A\u0430\u0440\u0442\u0443 \u0425\u0430\u0439\u0440\u0443\u043B\u0430 \u0443 \u0431\u0440\u0430\u0443\u0437\u0435\u0440\u0456.";
            uk["hero_starting"] = "\u0417\u0430\u043F\u0443\u0441\u043A \u043B\u043E\u043A\u0430\u043B\u044C\u043D\u043E\u0433\u043E \u0441\u0435\u0440\u0432\u0435\u0440\u0430 \u043A\u0430\u0440\u0442\u0438...";
            uk["hero_running"] = "\u041A\u0430\u0440\u0442\u0430 \u043F\u0440\u0430\u0446\u044E\u0454 \u0442\u0430 \u0433\u043E\u0442\u043E\u0432\u0430 \u0443 \u0431\u0440\u0430\u0443\u0437\u0435\u0440\u0456.";
            uk["hero_stopping"] = "\u0417\u0443\u043F\u0438\u043D\u043A\u0430 \u0441\u0435\u0440\u0432\u0435\u0440\u0430 \u043A\u0430\u0440\u0442\u0438...";
            uk["hero_error"] = "\u041D\u0435 \u0432\u0434\u0430\u043B\u043E\u0441\u044F \u0437\u0430\u043F\u0443\u0441\u0442\u0438\u0442\u0438 \u0441\u0435\u0440\u0432\u0435\u0440. \u041F\u0435\u0440\u0435\u0432\u0456\u0440\u0442\u0435 \u041D\u0430\u043B\u0430\u0448\u0442\u0443\u0432\u0430\u043D\u043D\u044F \u0442\u0430 \u0416\u0443\u0440\u043D\u0430\u043B.";
            uk["sync_hint_default"] = "\u041D\u0430\u0442\u0438\u0441\u043D\u0456\u0442\u044C \u041D\u0430\u043B\u0430\u0448\u0442. Sync \u0434\u043B\u044F \u0432\u0456\u0434\u0441\u0442\u0435\u0436\u0435\u043D\u043D\u044F \u0432 \u0440\u0435\u0430\u043B\u044C\u043D\u043E\u043C\u0443 \u0447\u0430\u0441\u0456.";
            uk["sync_hint_configured"] = "\u0421\u0438\u043D\u0445\u0440\u043E\u043D\u0456\u0437\u0430\u0446\u0456\u044E \u043D\u0430\u043B\u0430\u0448\u0442\u043E\u0432\u0430\u043D\u043E. \u0417\u0430\u043F\u0443\u0441\u0442\u0456\u0442\u044C Lichii \u0430\u0431\u043E Fritchii.";
            uk["status_stopped"] = "\u0417\u0443\u043F\u0438\u043D\u0435\u043D\u043E";
            uk["status_running"] = "\u041F\u0440\u0430\u0446\u044E\u0454";
            uk["status_starting"] = "\u0417\u0430\u043F\u0443\u0441\u043A";
            uk["status_stopping"] = "\u0417\u0443\u043F\u0438\u043D\u043A\u0430...";
            uk["status_error"] = "\u041F\u043E\u043C\u0438\u043B\u043A\u0430";
            uk["emu_none"] = "\u041D\u0435\u043C\u0430 \u0435\u043C\u0443";
            uk["emu_live"] = "\u041D\u0430\u0436\u0438\u0432\u043E";
            uk["emu_waiting"] = "\u041E\u0447\u0456\u043A\u0443\u0432.";
            uk["emu_save"] = "\u0417\u0431\u0435\u0440\u0435\u0436.";
            uk["emu_rpc_closed"] = "RPC \u0437\u0430\u043A\u0440.";
            uk["lan_title"] = "\u0414\u0440\u0443\u0433\u0438\u0439 \u0435\u043A\u0440\u0430\u043D (LAN)";
            uk["copy_url"] = "\u041A\u043E\u043F\u0456\u044E\u0432. URL";
            uk["copied"] = "\u0421\u043A\u043E\u043F\u0456\u0439\u043E\u0432.!";
            uk["qr_code"] = "QR-\u043A\u043E\u0434";
            uk["allow_firewall"] = "\u0411\u0440\u0430\u043D\u0434\u043C\u0430\u0443\u0435\u0440";
            uk["firewall_ready"] = "\u041F\u043E\u0440\u0442 \u0432\u0456\u0434\u043A\u0440.";
            uk["localhost_only"] = "\u041B\u0438\u0448\u0435 \u043B\u043E\u043A\u0430\u043B.";
            uk["configuring"] = "\u041D\u0430\u043B\u0430\u0448\u0442\u0443\u0432...";
            uk["refresh"] = "\u041E\u043D\u043E\u0432\u0438\u0442\u0438";
            uk["lan_hint_default"] = "\u0412\u0456\u0434\u043A\u0440\u0438\u0439\u0442\u0435 \u0446\u044E \u0430\u0434\u0440\u0435\u0441\u0443 \u0430\u0431\u043E QR-\u043A\u043E\u0434 \u043D\u0430 \u043F\u043B\u0430\u043D\u0448\u0435\u0442\u0456 \u0447\u0438 \u0442\u0435\u043B\u0435\u0444\u043E\u043D\u0456.";
            uk["lan_hint_disabled"] = "\u0423\u0432\u0456\u043C\u043A\u043D\u0456\u0442\u044C \u00AB\u0414\u043E\u0437\u0432\u043E\u043B\u0438\u0442\u0438 \u0434\u043E\u0441\u0442\u0443\u043F \u043F\u043E LAN\u00BB \u0443 \u041D\u0430\u043B\u0430\u0448\u0442\u0443\u0432\u0430\u043D\u043D\u044F\u0445.";
            uk["lan_hint_no_adapter"] = "\u041F\u0456\u0434\u043A\u043B\u044E\u0447\u0456\u0442\u044C \u041F\u041A \u0434\u043E Wi-Fi \u0430\u0431\u043E Ethernet \u0456 \u043D\u0430\u0442\u0438\u0441\u043D\u0456\u0442\u044C \u041E\u043D\u043E\u0432\u0438\u0442\u0438.";
            uk["lan_hint_multi"] = "\u0417\u043D\u0430\u0439\u0434\u0435\u043D\u043E \u043A\u0456\u043B\u044C\u043A\u0430 \u0430\u0434\u0430\u043F\u0442\u0435\u0440\u0456\u0432 \u2014 \u043E\u0431\u0435\u0440\u0456\u0442\u044C \u043F\u043E\u0442\u0440\u0456\u0431\u043D\u0438\u0439.";
            uk["lan_disabled"] = "\u0412\u0438\u043C\u043A\u043D\u0435\u043D\u043E (\u043B\u0438\u0448\u0435 localhost \u2014 127.0.0.1)";
            uk["lan_no_adapter"] = "\u0410\u043A\u0442\u0438\u0432\u043D\u0435 \u043F\u0456\u0434\u043A\u043B\u044E\u0447\u0435\u043D\u043D\u044F Wi-Fi \u0430\u0431\u043E Ethernet \u043D\u0435 \u0437\u043D\u0430\u0439\u0434\u0435\u043D\u043E";
            uk["lan_checking"] = "\u041F\u0435\u0440\u0435\u0432\u0456\u0440\u043A\u0430 \u043C\u0435\u0440\u0435\u0436\u0435\u0432\u0438\u0445 \u0430\u0434\u0430\u043F\u0442\u0435\u0440\u0456\u0432...";
            uk["drawer_title"] = "\u041D\u0430\u043B\u0430\u0448\u0442\u0443\u0432\u0430\u043D\u043D\u044F, \u0416\u0443\u0440\u043D\u0430\u043B \u0456 \u041F\u0440\u043E \u043F\u0440\u043E\u0433\u0440\u0430\u043C\u0443";
            uk["tab_settings"] = "\u041D\u0430\u043B\u0430\u0448\u0442.";
            uk["tab_logs"] = "\u0416\u0443\u0440\u043D\u0430\u043B";
            uk["tab_about"] = "\u041F\u0440\u043E \u043F\u0440\u043E\u0433\u0440.";
            uk["settings_lock_hint"] = "\u0417\u0443\u043F\u0438\u043D\u0456\u0442\u044C \u0441\u0435\u0440\u0432\u0435\u0440 \u0434\u043B\u044F \u0437\u043C\u0456\u043D\u0438 \u043F\u043E\u0440\u0442\u0443";
            uk["map_port"] = "\u041F\u043E\u0440\u0442 \u043A\u0430\u0440\u0442\u0438";
            uk["rpc_host"] = "\u0425\u043E\u0441\u0442 RPC \u0435\u043C\u0443\u043B\u044F\u0442\u043E\u0440\u0430";
            uk["rpc_port"] = "\u041F\u043E\u0440\u0442 RPC \u0435\u043C\u0443\u043B\u044F\u0442\u043E\u0440\u0430";
            uk["reset"] = "\u0421\u043A\u0438\u043D\u0443\u0442\u0438";
            uk["allow_lan"] = "\u0414\u043E\u0437\u0432\u043E\u043B\u0438\u0442\u0438 \u0434\u043E\u0441\u0442\u0443\u043F \u043F\u043E LAN";
            uk["auto_open"] = "\u0410\u0432\u0442\u043E\u0432\u0456\u0434\u043A\u0440\u0438\u0442\u0442\u044F \u0431\u0440\u0430\u0443\u0437\u0435\u0440\u0430";
            uk["minimize_tray"] = "\u0417\u0433\u043E\u0440\u0442\u0430\u0442\u0438 \u0432 \u0442\u0440\u0435\u0439";
            uk["save_folder"] = "\u041F\u0430\u043F\u043A\u0430 \u0437\u0431\u0435\u0440\u0435\u0436\u0435\u043D\u044C";
            uk["auto_detect"] = "\u0410\u0432\u0442\u043E\u0432\u0438\u0437\u043D\u0430\u0447\u0435\u043D\u043D\u044F";
            uk["add_ellipsis"] = "\u0414\u043E\u0434\u0430\u0442\u0438...";
            uk["remove"] = "\u0412\u0438\u0434\u0430\u043B\u0438\u0442\u0438";
            uk["save_slot"] = "\u0421\u043B\u043E\u0442";
            uk["auto_latest"] = "\u0410\u0432\u0442\u043E (\u041E\u0441\u0442\u0430\u043D\u043D\u0456\u0439)";
            uk["language"] = "\u041C\u043E\u0432\u0430";
            uk["check_updates"] = "\u041F\u0435\u0440\u0435\u0432\u0456\u0440\u0438\u0442\u0438 \u043E\u043D\u043E\u0432\u043B\u0435\u043D\u043D\u044F";
            uk["version_label"] = "\u0412\u0435\u0440\u0441\u0456\u044F {0}";
            uk["copy_logs"] = "\u041A\u043E\u043F\u0456\u044E\u0432.";
            uk["clear"] = "\u041E\u0447\u0438\u0441\u0442.";
            uk["about_original_map"] = "\u041E\u0440\u0438\u0433\u0456\u043D\u0430\u043B";
            uk["about_artwork"] = "\u0413\u0440\u0430\u0444\u0456\u043A\u0430";
            uk["about_security"] = "\u0412\u0456\u043B\u044C\u043D\u0435 \u041F\u0417 (GNU AGPL-3.0). \u041E\u0444\u0456\u0446\u0456\u0439\u043D\u0456 \u0437\u0431\u0456\u0440\u043A\u0438: github.com/antonioalvromero/Ocarina-Atlas.";
            uk["about_footer"] = "\u0412\u0435\u0440\u0441\u0456\u044F {0}  \u2022  \u041F\u0435\u0440\u0435\u0432\u0456\u0440\u044F\u0439\u0442\u0435 \u0440\u0435\u043B\u0456\u0437\u0438 \u0447\u0435\u0440\u0435\u0437 SHA-256 \u0430\u0431\u043E GitHub";
            uk["tray_show"] = "\u041F\u043E\u043A\u0430\u0437\u0430\u0442\u0438 Ocarina Atlas";
            uk["tray_open"] = "\u0412\u0456\u0434\u043A\u0440\u0438\u0442\u0438 \u043A\u0430\u0440\u0442\u0443 \u0443 \u0431\u0440\u0430\u0443\u0437\u0435\u0440\u0456";
            uk["tray_exit"] = "\u0412\u0438\u0445\u0456\u0434";
            uk["update_pill"] = "\u041E\u043D\u043E\u0432.";
            map["uk"] = uk;

            return map;
        }
    }

    internal sealed class LauncherSettings
    {
        public List<string> SavedSaveDirs = new List<string>();
        public string CustomSaveDir = string.Empty;
        public string CustomSaveSlot = string.Empty;
        public int? Port;
        public string LichiiHost;
        public int? LichiiPort;
        public bool? AllowLan;
        public bool? AutoOpenBrowser;
        public bool? MinimizeToTray;
        public string Language = string.Empty;

        public static string GetSettingsFilePath()
        {
            string appData = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
            if (string.IsNullOrEmpty(appData)) return string.Empty;
            return Path.Combine(Path.Combine(appData, "OcarinaAtlas"), "settings.json");
        }

        private static bool ContainsSaveDir(List<string> list, string candidate)
        {
            if (list == null || string.IsNullOrEmpty(candidate)) return false;
            for (int i = 0; i < list.Count; i++)
            {
                if (string.Equals(list[i], candidate, StringComparison.OrdinalIgnoreCase))
                {
                    return true;
                }
            }
            return false;
        }

        public static LauncherSettings Load()
        {
            LauncherSettings settings = new LauncherSettings();
            try
            {
                string path = GetSettingsFilePath();
                if (string.IsNullOrEmpty(path) || !File.Exists(path))
                {
                    return settings;
                }

                string json = File.ReadAllText(path, Encoding.UTF8);
                Dictionary<string, object> obj = SimpleJsonParser.ParseObject(json);
                if (obj == null)
                {
                    return settings;
                }

                List<object> rawSavedDirs = SimpleJsonParser.GetArray(obj, "savedSaveDirs");
                if (rawSavedDirs == null) rawSavedDirs = SimpleJsonParser.GetArray(obj, "SavedSaveDirs");
                if (rawSavedDirs != null)
                {
                    for (int i = 0; i < rawSavedDirs.Count; i++)
                    {
                        string entry = rawSavedDirs[i] as string;
                        if (string.IsNullOrEmpty(entry)) continue;
                        string trimmed = entry.Trim();
                        if (!string.IsNullOrEmpty(trimmed) && !ContainsSaveDir(settings.SavedSaveDirs, trimmed))
                        {
                            settings.SavedSaveDirs.Add(trimmed);
                        }
                    }
                }

                string saveDir = SimpleJsonParser.GetString(obj, "customSaveDir");
                if (saveDir == null) saveDir = SimpleJsonParser.GetString(obj, "CustomSaveDir");
                if (!string.IsNullOrEmpty(saveDir))
                {
                    settings.CustomSaveDir = saveDir.Trim();
                }

                // Backward compatibility: if an existing settings.json only has customSaveDir, include it in savedSaveDirs.
                if (!string.IsNullOrEmpty(settings.CustomSaveDir) &&
                    !ContainsSaveDir(settings.SavedSaveDirs, settings.CustomSaveDir))
                {
                    settings.SavedSaveDirs.Add(settings.CustomSaveDir);
                }

                string saveSlot = SimpleJsonParser.GetString(obj, "customSaveSlot");
                if (saveSlot == null) saveSlot = SimpleJsonParser.GetString(obj, "CustomSaveSlot");
                if (!string.IsNullOrEmpty(saveSlot))
                {
                    settings.CustomSaveSlot = saveSlot.Trim();
                }

                int? port = SimpleJsonParser.GetInt(obj, "port");
                if (port.HasValue && port.Value >= 1 && port.Value <= 65535)
                {
                    settings.Port = port.Value;
                }

                string lichiiHost = SimpleJsonParser.GetString(obj, "lichiiHost");
                if (!string.IsNullOrEmpty(lichiiHost))
                {
                    settings.LichiiHost = lichiiHost.Trim();
                }

                int? lichiiPort = SimpleJsonParser.GetInt(obj, "lichiiPort");
                if (lichiiPort.HasValue && lichiiPort.Value >= 1 && lichiiPort.Value <= 65535)
                {
                    settings.LichiiPort = lichiiPort.Value;
                }

                if (obj.ContainsKey("allowLan"))
                {
                    settings.AllowLan = SimpleJsonParser.GetBool(obj, "allowLan");
                }
                if (obj.ContainsKey("autoOpenBrowser"))
                {
                    settings.AutoOpenBrowser = SimpleJsonParser.GetBool(obj, "autoOpenBrowser");
                }
                if (obj.ContainsKey("minimizeToTray"))
                {
                    settings.MinimizeToTray = SimpleJsonParser.GetBool(obj, "minimizeToTray");
                }

                string language = SimpleJsonParser.GetString(obj, "language");
                if (language == null) language = SimpleJsonParser.GetString(obj, "Language");
                if (!string.IsNullOrEmpty(language))
                {
                    settings.Language = LauncherI18n.NormalizeLocale(language);
                }
            }
            catch
            {
                // Ignore corrupt or unreadable settings; fall back to defaults.
            }
            return settings;
        }

        public void Save()
        {
            try
            {
                string path = GetSettingsFilePath();
                if (string.IsNullOrEmpty(path)) return;

                string dir = Path.GetDirectoryName(path);
                if (!string.IsNullOrEmpty(dir) && !Directory.Exists(dir))
                {
                    Directory.CreateDirectory(dir);
                }

                List<string> uniqueDirs = new List<string>();
                if (SavedSaveDirs != null)
                {
                    for (int i = 0; i < SavedSaveDirs.Count; i++)
                    {
                        string trimmed = (SavedSaveDirs[i] ?? string.Empty).Trim();
                        if (!string.IsNullOrEmpty(trimmed) && !ContainsSaveDir(uniqueDirs, trimmed))
                        {
                            uniqueDirs.Add(trimmed);
                        }
                    }
                }

                StringBuilder dirsJson = new StringBuilder();
                dirsJson.Append('[');
                for (int i = 0; i < uniqueDirs.Count; i++)
                {
                    if (i > 0) dirsJson.Append(", ");
                    dirsJson.Append('"');
                    dirsJson.Append(SimpleJsonParser.EscapeString(uniqueDirs[i]));
                    dirsJson.Append('"');
                }
                dirsJson.Append(']');

                string json = string.Format(
                    CultureInfo.InvariantCulture,
                    "{{\n  \"savedSaveDirs\": {0},\n  \"customSaveDir\": \"{1}\",\n  \"customSaveSlot\": \"{2}\",\n  \"port\": {3},\n  \"lichiiHost\": \"{4}\",\n  \"lichiiPort\": {5},\n  \"allowLan\": {6},\n  \"autoOpenBrowser\": {7},\n  \"minimizeToTray\": {8},\n  \"language\": \"{9}\"\n}}\n",
                    dirsJson.ToString(),
                    SimpleJsonParser.EscapeString((CustomSaveDir ?? string.Empty).Trim()),
                    SimpleJsonParser.EscapeString((CustomSaveSlot ?? string.Empty).Trim()),
                    (Port ?? 3000).ToString(CultureInfo.InvariantCulture),
                    SimpleJsonParser.EscapeString((LichiiHost ?? "127.0.0.1").Trim()),
                    (LichiiPort ?? 6545).ToString(CultureInfo.InvariantCulture),
                    (AllowLan ?? true) ? "true" : "false",
                    (AutoOpenBrowser ?? true) ? "true" : "false",
                    (MinimizeToTray ?? false) ? "true" : "false",
                    SimpleJsonParser.EscapeString(string.IsNullOrEmpty(Language) ? string.Empty : LauncherI18n.NormalizeLocale(Language)));

                File.WriteAllText(path, json, new UTF8Encoding(false));
            }
            catch
            {
                // Ignore write failures (e.g. read-only profile).
            }
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
        public string[] AvailableSaveSlots;
    }

    internal enum ServerLifecycle
    {
        Stopped,
        Starting,
        Running,
        Stopping
    }

    internal static class ModernFolderPicker
    {
        private const uint FosPickFolders = 0x00000020;
        private const uint FosForceFileSystem = 0x00000040;
        private const uint FosPathMustExist = 0x00000800;
        private const uint SigdnFileSysPath = 0x80058000;
        private const int ErrorCancelled = unchecked((int)0x800704C7);

        [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = true)]
        private static extern int SHCreateItemFromParsingName(
            [MarshalAs(UnmanagedType.LPWStr)] string pszPath,
            IntPtr pbc,
            ref Guid riid,
            [MarshalAs(UnmanagedType.Interface)] out IShellItem ppv);

        [ComImport]
        [Guid("DC1C5A9C-E88A-4dde-A5A1-60F82A20AEF7")]
        private class FileOpenDialogCom
        {
        }

        [ComImport]
        [Guid("42f85136-db7e-439c-85f1-e4075d135fc8")]
        [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        private interface IFileOpenDialog
        {
            [PreserveSig]
            int Show(IntPtr hwndOwner);
            void SetFileTypes(uint cFileTypes, IntPtr rgFilterSpec);
            void SetFileTypeIndex(uint iFileType);
            void GetFileTypeIndex(out uint piFileType);
            void Advise(IntPtr pfde, out uint pdwCookie);
            void Unadvise(uint dwCookie);
            void SetOptions(uint fos);
            void GetOptions(out uint pfos);
            void SetDefaultFolder(IShellItem psi);
            void SetFolder(IShellItem psi);
            void GetFolder(out IShellItem ppsi);
            void GetCurrentSelection(out IShellItem ppsi);
            void SetFileName([MarshalAs(UnmanagedType.LPWStr)] string pszName);
            void GetFileName([MarshalAs(UnmanagedType.LPWStr)] out string pszName);
            void SetTitle([MarshalAs(UnmanagedType.LPWStr)] string pszTitle);
            void SetOkButtonLabel([MarshalAs(UnmanagedType.LPWStr)] string pszText);
            void SetFileNameLabel([MarshalAs(UnmanagedType.LPWStr)] string pszLabel);
            void GetResult(out IShellItem ppsi);
            void AddPlace(IShellItem psi, int fdap);
            void SetDefaultExtension([MarshalAs(UnmanagedType.LPWStr)] string pszDefaultExtension);
            void Close(int hr);
            void SetClientGuid(ref Guid guid);
            void ClearClientData();
            void SetFilter(IntPtr pFilter);
            void GetResults(out IntPtr ppenum);
            void GetSelectedItems(out IntPtr ppsai);
        }

        [ComImport]
        [Guid("43826d1e-e718-42ee-bc55-a1e261c37bfe")]
        [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        private interface IShellItem
        {
            void BindToHandler(IntPtr pbc, ref Guid bhid, ref Guid riid, out IntPtr ppv);
            void GetParent(out IShellItem ppsi);
            void GetDisplayName(uint sigdnName, out IntPtr ppszName);
            void GetAttributes(uint sfgaoMask, out uint psfgaoAttribs);
            void Compare(IShellItem psi, uint hint, out int piOrder);
        }

        public static string PickFolder(IWin32Window owner, string title, string initialDirectory)
        {
            IFileOpenDialog dialog = null;
            IShellItem initialItem = null;
            IShellItem resultItem = null;
            try
            {
                dialog = (IFileOpenDialog)(new FileOpenDialogCom());
                uint options;
                dialog.GetOptions(out options);
                dialog.SetOptions(options | FosPickFolders | FosForceFileSystem | FosPathMustExist);
                if (!string.IsNullOrEmpty(title))
                {
                    dialog.SetTitle(title);
                }

                if (!string.IsNullOrEmpty(initialDirectory) && Directory.Exists(initialDirectory))
                {
                    Guid shellItemGuid = new Guid("43826d1e-e718-42ee-bc55-a1e261c37bfe");
                    if (SHCreateItemFromParsingName(initialDirectory, IntPtr.Zero, ref shellItemGuid, out initialItem) == 0 && initialItem != null)
                    {
                        dialog.SetFolder(initialItem);
                    }
                }

                IntPtr hwnd = owner != null ? owner.Handle : IntPtr.Zero;
                int hr = dialog.Show(hwnd);
                if (hr == ErrorCancelled)
                {
                    return null;
                }
                if (hr < 0)
                {
                    Marshal.ThrowExceptionForHR(hr);
                }

                dialog.GetResult(out resultItem);
                if (resultItem == null)
                {
                    return null;
                }

                IntPtr pszPath;
                resultItem.GetDisplayName(SigdnFileSysPath, out pszPath);
                try
                {
                    return pszPath != IntPtr.Zero ? (Marshal.PtrToStringUni(pszPath) ?? string.Empty).Trim() : null;
                }
                finally
                {
                    if (pszPath != IntPtr.Zero)
                    {
                        Marshal.FreeCoTaskMem(pszPath);
                    }
                }
            }
            catch
            {
                using (FolderBrowserDialog fallback = new FolderBrowserDialog())
                {
                    fallback.Description = title;
                    fallback.ShowNewFolderButton = false;
                    if (!string.IsNullOrEmpty(initialDirectory) && Directory.Exists(initialDirectory))
                    {
                        fallback.SelectedPath = initialDirectory;
                    }
                    if (fallback.ShowDialog(owner) == DialogResult.OK)
                    {
                        return (fallback.SelectedPath ?? string.Empty).Trim();
                    }
                    return null;
                }
            }
            finally
            {
                if (resultItem != null) Marshal.FinalReleaseComObject(resultItem);
                if (initialItem != null) Marshal.FinalReleaseComObject(initialItem);
                if (dialog != null) Marshal.FinalReleaseComObject(dialog);
            }
        }
    }

    internal sealed class DarkComboBox : ComboBox
    {
        private const int WmPaint = 0x000F;
        private bool _hovered = false;

        public DarkComboBox()
        {
            DropDownStyle = ComboBoxStyle.DropDownList;
            FlatStyle = FlatStyle.Flat;
            BackColor = Theme.Ink800;
            ForeColor = Theme.Parchment50;
            DrawMode = DrawMode.OwnerDrawFixed;
        }

        protected override void OnMouseEnter(EventArgs e)
        {
            base.OnMouseEnter(e);
            _hovered = true;
            Invalidate();
        }

        protected override void OnMouseLeave(EventArgs e)
        {
            base.OnMouseLeave(e);
            _hovered = false;
            Invalidate();
        }

        protected override void WndProc(ref Message m)
        {
            base.WndProc(ref m);
            if (m.Msg == WmPaint && Width > 2 && Height > 2)
            {
                using (Graphics g = CreateGraphics())
                {
                    g.SmoothingMode = SmoothingMode.AntiAlias;
                    Rectangle bounds = new Rectangle(0, 0, Width, Height);
                    Color bg = Enabled ? Theme.Ink800 : Theme.Ink900;
                    Color border = !Enabled
                        ? Theme.Ink700
                        : (Focused || DroppedDown)
                            ? Theme.Gold
                            : (_hovered ? Theme.Parchment600 : Theme.Ink600);

                    using (SolidBrush bgBrush = new SolidBrush(bg))
                    {
                        g.FillRectangle(bgBrush, bounds);
                    }

                    int arrowWidth = Math.Max(18, (int)Math.Round(22 * (g.DpiX / 96f)));
                    Rectangle arrowRect = new Rectangle(Width - arrowWidth, 1, arrowWidth - 1, Height - 2);
                    using (SolidBrush arrowBgBrush = new SolidBrush(Enabled ? Theme.Ink700 : Theme.Ink800))
                    {
                        g.FillRectangle(arrowBgBrush, arrowRect);
                    }

                    using (Pen sepPen = new Pen(border))
                    {
                        g.DrawLine(sepPen, Width - arrowWidth, 1, Width - arrowWidth, Height - 2);
                    }

                    int padX = Math.Max(6, (int)Math.Round(8 * (g.DpiX / 96f)));
                    Rectangle textRect = new Rectangle(padX, 1, Math.Max(10, Width - arrowWidth - padX - 2), Height - 2);
                    string displayText = SelectedItem != null ? SelectedItem.ToString() : Text;
                    Color textColor = Enabled ? Theme.Parchment50 : Theme.Parchment600;
                    TextRenderer.DrawText(
                        g,
                        displayText ?? string.Empty,
                        Font,
                        textRect,
                        textColor,
                        TextFormatFlags.Left | TextFormatFlags.VerticalCenter | TextFormatFlags.EndEllipsis | TextFormatFlags.NoPrefix);

                    float cx = Width - arrowWidth / 2f;
                    float cy = Height / 2f;
                    float halfW = Math.Max(3.2f, 3.8f * (g.DpiX / 96f));
                    float halfH = Math.Max(1.8f, 2.1f * (g.DpiX / 96f));
                    PointF[] chevron = new PointF[]
                    {
                        new PointF(cx - halfW, cy - halfH),
                        new PointF(cx + halfW, cy - halfH),
                        new PointF(cx, cy + halfH)
                    };
                    Color chevronColor = !Enabled ? Theme.Parchment600 : (DroppedDown || _hovered ? Theme.Gold : Theme.Parchment300);
                    using (SolidBrush chevBrush = new SolidBrush(chevronColor))
                    {
                        g.FillPolygon(chevBrush, chevron);
                    }

                    using (Pen borderPen = new Pen(border))
                    {
                        g.DrawRectangle(borderPen, 0, 0, Width - 1, Height - 1);
                    }
                }
            }
        }
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
        public const string AppVersion = "2.5.1";

        private const int BaseClientWidth = 540;
        private const int CollapsedClientHeight = 392;
        private const int ExpandedMinClientHeight = 700;
        private const int ExpandedClientHeight = 750;

        private sealed class SaveSlotItem
        {
            public readonly string Value;
            public readonly string Label;

            public SaveSlotItem(string value, string label)
            {
                Value = value ?? string.Empty;
                Label = label ?? string.Empty;
            }

            public override string ToString()
            {
                return Label;
            }
        }

        private readonly LaunchOptions _options;
        private readonly LauncherSettings _launcherSettings;
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
        private Label _securityNoticeLabel;
        private Label _aboutFooterLabel;

        // Primary Control + Sync Card controls
        private Label _heroSummaryLabel;
        private LinkLabel _serverUrlLink;
        private Button _startStopButton;
        private Button _openBrowserButton;
        private Button _enableRpcButton;
        private Label _lichiiStepDetailLabel;

        // Second Screen / LAN Card controls
        private Label _step2TitleLabel;
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
        private Label _portLabel;
        private NumericUpDown _portInput;
        private Label _lichiiHostLabel;
        private TextBox _lichiiHostInput;
        private Label _lichiiPortLabel;
        private NumericUpDown _lichiiPortInput;
        private Button _resetLichiiButton;
        private CheckBox _allowLanCheckBox;
        private CheckBox _autoOpenCheckBox;
        private CheckBox _trayMinimizeCheckBox;
        private Label _saveDirLabel;
        private ComboBox _saveDirComboBox;
        private Button _addSaveDirButton;
        private Button _removeSaveDirButton;
        private Label _saveSlotLabel;
        private ComboBox _saveSlotComboBox;
        private Label _languageLabel;
        private ComboBox _languageComboBox;
        private Label _updateStatusLabel;
        private LinkLabel _checkUpdatesLink;
        private TextBox _logTextBox;

        private NotifyIcon _trayIcon;
        private ToolStripMenuItem _trayShowItem;
        private ToolStripMenuItem _trayToggleServerItem;
        private ToolStripMenuItem _trayOpenBrowserItem;
        private ToolStripMenuItem _trayExitItem;

        private bool _advancedExpanded = false;
        private int _activeDrawerTab = 0; // 0 = Settings, 1 = Logs, 2 = About
        private bool _trayHintShown = false;
        private bool _suppressSaveDirChange = false;
        private bool _suppressSaveSlotChange = false;
        private bool _suppressLanguageChange = false;
        private bool _isApplyingInitialOptions = false;
        private string _currentLocale = "en";
        private string[] _lastDiscoveredSaveSlots;

        public MainForm(LaunchOptions options)
        {
            _options = options ?? new LaunchOptions();
            _launcherSettings = LauncherSettings.Load();
            if (string.IsNullOrEmpty(_launcherSettings.Language))
            {
                _currentLocale = LauncherI18n.DetectSystemLocale();
                _launcherSettings.Language = _currentLocale;
                _launcherSettings.Save();
            }
            else
            {
                _currentLocale = LauncherI18n.NormalizeLocale(_launcherSettings.Language);
            }
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
            ApplyLauncherLanguage();

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

            _enableRpcButton = CreateButton("1-Click Setup Sync", 336, 65, 150, 30, true);
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

            _step2TitleLabel = new Label();
            _step2TitleLabel.Text = "Second Screen (LAN)";
            _step2TitleLabel.Font = new Font("Segoe UI", 9.5f, FontStyle.Bold);
            _step2TitleLabel.ForeColor = Theme.Parchment50;
            _step2TitleLabel.AutoSize = true;
            _step2TitleLabel.Location = new Point(18, 16);
            _step2Card.Controls.Add(_step2TitleLabel);

            _firewallButton = CreateButton("Allow Firewall", 274, 13, 134, 26, true);
            _firewallButton.Anchor = AnchorStyles.Top | AnchorStyles.Right;
            _firewallButton.Font = new Font("Segoe UI", 8f, FontStyle.Bold);
            _firewallButton.Click += OnAllowFirewallClick;
            _step2Card.Controls.Add(_firewallButton);
            _toolTip.SetToolTip(_firewallButton, "Adds a Windows Firewall rule on Private networks so your tablet or phone can connect.");

            _refreshLanButton = CreateButton("Refresh", 414, 13, 74, 26, false);
            _refreshLanButton.Anchor = AnchorStyles.Top | AnchorStyles.Right;
            _refreshLanButton.Font = new Font("Segoe UI", 8f, FontStyle.Regular);
            _refreshLanButton.Click += OnRefreshLanClick;
            _step2Card.Controls.Add(_refreshLanButton);
            _toolTip.SetToolTip(_refreshLanButton, "Re-scan active Wi-Fi and Ethernet network adapters.");

            _lanComboBox = new DarkComboBox();
            _lanComboBox.DropDownStyle = ComboBoxStyle.DropDownList;
            _lanComboBox.FlatStyle = FlatStyle.Flat;
            _lanComboBox.BackColor = Theme.Ink800;
            _lanComboBox.ForeColor = Theme.Parchment50;
            _lanComboBox.ItemHeight = Theme.ScaleDpi(20, _dpiScale);
            _lanComboBox.Font = new Font("Segoe UI", 8.75f, FontStyle.Regular);
            _lanComboBox.Location = new Point(18, 49);
            _lanComboBox.Size = new Size(286, 24);
            _lanComboBox.Anchor = AnchorStyles.Top | AnchorStyles.Left | AnchorStyles.Right;
            _lanComboBox.Visible = false;
            _lanComboBox.DrawItem += DrawDarkComboItem;
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
            _lanUrlLink.Size = new Size(286, 20);
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
            _lanStatusLabel.Size = new Size(286, 20);
            _lanStatusLabel.Anchor = AnchorStyles.Top | AnchorStyles.Left | AnchorStyles.Right;
            _step2Card.Controls.Add(_lanStatusLabel);

            _copyLanUrlButton = CreateButton("Copy URL", 312, 48, 92, 28, true);
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
            _advancedDrawerPanel.Size = new Size(504, 352);
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
            _modeBadgePanel.Location = new Point(252, 13);
            _modeBadgePanel.Size = new Size(84, 24);
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

            _copyLogButton = CreateButton("Copy Logs", 342, 13, 80, 24, false);
            _copyLogButton.Anchor = AnchorStyles.Top | AnchorStyles.Right;
            _copyLogButton.Font = new Font("Segoe UI", 7.75f, FontStyle.Regular);
            _copyLogButton.Visible = false;
            _copyLogButton.Click += OnCopyLogClick;
            _advancedDrawerPanel.Controls.Add(_copyLogButton);

            _clearLogButton = CreateButton("Clear", 428, 13, 62, 24, false);
            _clearLogButton.Anchor = AnchorStyles.Top | AnchorStyles.Right;
            _clearLogButton.Font = new Font("Segoe UI", 7.75f, FontStyle.Regular);
            _clearLogButton.Visible = false;
            _clearLogButton.Click += OnClearLogClick;
            _advancedDrawerPanel.Controls.Add(_clearLogButton);

            // Settings Tab Panel (2-column grid)
            _settingsTabPanel = new Panel();
            _settingsTabPanel.Location = new Point(14, 48);
            _settingsTabPanel.Size = new Size(476, 292);
            _settingsTabPanel.Anchor = AnchorStyles.Top | AnchorStyles.Bottom | AnchorStyles.Left | AnchorStyles.Right;
            _settingsTabPanel.BackColor = Theme.Ink900;
            _advancedDrawerPanel.Controls.Add(_settingsTabPanel);

            _portLabel = new Label();
            _portLabel.Text = "Map Port";
            _portLabel.Font = new Font("Segoe UI", 8.25f, FontStyle.Bold);
            _portLabel.ForeColor = Theme.Parchment400;
            _portLabel.AutoSize = true;
            _portLabel.Location = new Point(0, 4);
            _settingsTabPanel.Controls.Add(_portLabel);

            _portInput = new NumericUpDown();
            _portInput.Minimum = 1;
            _portInput.Maximum = 65535;
            _portInput.Value = 3000;
            _portInput.BackColor = Theme.Ink800;
            _portInput.ForeColor = Theme.Parchment50;
            _portInput.BorderStyle = BorderStyle.None;
            _portInput.ValueChanged += OnPortInputChanged;
            _settingsTabPanel.Controls.Add(WrapInputInBorderedPanel(_portInput, 0, 24, 110, 28));

            _lichiiHostLabel = new Label();
            _lichiiHostLabel.Text = "Emulator RPC Host";
            _lichiiHostLabel.Font = new Font("Segoe UI", 8.25f, FontStyle.Bold);
            _lichiiHostLabel.ForeColor = Theme.Parchment400;
            _lichiiHostLabel.AutoSize = true;
            _lichiiHostLabel.Location = new Point(244, 4);
            _settingsTabPanel.Controls.Add(_lichiiHostLabel);

            _lichiiHostInput = new TextBox();
            _lichiiHostInput.Text = "127.0.0.1";
            _lichiiHostInput.BackColor = Theme.Ink800;
            _lichiiHostInput.ForeColor = Theme.Parchment50;
            _lichiiHostInput.BorderStyle = BorderStyle.None;
            _lichiiHostInput.TextChanged += OnLichiiHostChanged;
            BorderedPanel hostWrap = WrapInputInBorderedPanel(_lichiiHostInput, 244, 24, 232, 28);
            hostWrap.Anchor = AnchorStyles.Top | AnchorStyles.Left | AnchorStyles.Right;
            _settingsTabPanel.Controls.Add(hostWrap);

            _lichiiPortLabel = new Label();
            _lichiiPortLabel.Text = "Emulator RPC Port";
            _lichiiPortLabel.Font = new Font("Segoe UI", 8.25f, FontStyle.Bold);
            _lichiiPortLabel.ForeColor = Theme.Parchment400;
            _lichiiPortLabel.AutoSize = true;
            _lichiiPortLabel.Location = new Point(0, 64);
            _settingsTabPanel.Controls.Add(_lichiiPortLabel);

            _lichiiPortInput = new NumericUpDown();
            _lichiiPortInput.Minimum = 1;
            _lichiiPortInput.Maximum = 65535;
            _lichiiPortInput.Value = 6545;
            _lichiiPortInput.BackColor = Theme.Ink800;
            _lichiiPortInput.ForeColor = Theme.Parchment50;
            _lichiiPortInput.BorderStyle = BorderStyle.None;
            _lichiiPortInput.ValueChanged += OnLichiiPortChanged;
            _settingsTabPanel.Controls.Add(WrapInputInBorderedPanel(_lichiiPortInput, 0, 84, 110, 28));

            _resetLichiiButton = CreateButton("Reset", 118, 84, 76, 28, false);
            _resetLichiiButton.Font = new Font("Segoe UI", 8f, FontStyle.Regular);
            _resetLichiiButton.Click += OnResetLichiiDefaultsClick;
            _settingsTabPanel.Controls.Add(_resetLichiiButton);

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

            _saveDirLabel = new Label();
            _saveDirLabel.Text = "Save Folder";
            _saveDirLabel.Font = new Font("Segoe UI", 8.25f, FontStyle.Bold);
            _saveDirLabel.ForeColor = Theme.Parchment400;
            _saveDirLabel.AutoSize = true;
            _saveDirLabel.Location = new Point(0, 138);
            _settingsTabPanel.Controls.Add(_saveDirLabel);

            _saveDirComboBox = new DarkComboBox();
            _saveDirComboBox.DropDownStyle = ComboBoxStyle.DropDownList;
            _saveDirComboBox.FlatStyle = FlatStyle.Flat;
            _saveDirComboBox.BackColor = Theme.Ink800;
            _saveDirComboBox.ForeColor = Theme.Parchment50;
            _saveDirComboBox.DrawMode = DrawMode.OwnerDrawFixed;
            _saveDirComboBox.ItemHeight = Theme.ScaleDpi(20, _dpiScale);
            _saveDirComboBox.Font = new Font("Segoe UI", 8.5f, FontStyle.Regular);
            _saveDirComboBox.Location = new Point(0, 157);
            _saveDirComboBox.Size = new Size(326, 26);
            _saveDirComboBox.Anchor = AnchorStyles.Top | AnchorStyles.Left | AnchorStyles.Right;
            _saveDirComboBox.DrawItem += DrawDarkComboItem;
            _saveDirComboBox.SelectedIndexChanged += OnSaveDirSelectedIndexChanged;
            _settingsTabPanel.Controls.Add(_saveDirComboBox);

            _addSaveDirButton = CreateButton("Add...", 332, 156, 68, 28, false);
            _addSaveDirButton.Font = new Font("Segoe UI", 8f, FontStyle.Regular);
            _addSaveDirButton.Anchor = AnchorStyles.Top | AnchorStyles.Right;
            _addSaveDirButton.Click += OnAddSaveDirClick;
            _settingsTabPanel.Controls.Add(_addSaveDirButton);

            _removeSaveDirButton = CreateButton("Remove", 406, 156, 70, 28, false);
            _removeSaveDirButton.Font = new Font("Segoe UI", 8f, FontStyle.Regular);
            _removeSaveDirButton.Anchor = AnchorStyles.Top | AnchorStyles.Right;
            _removeSaveDirButton.Enabled = false;
            _removeSaveDirButton.Click += OnRemoveSaveDirClick;
            _settingsTabPanel.Controls.Add(_removeSaveDirButton);

            _saveSlotLabel = new Label();
            _saveSlotLabel.Text = "Save Slot";
            _saveSlotLabel.Font = new Font("Segoe UI", 8.25f, FontStyle.Bold);
            _saveSlotLabel.ForeColor = Theme.Parchment400;
            _saveSlotLabel.AutoSize = true;
            _saveSlotLabel.Location = new Point(0, 195);
            _settingsTabPanel.Controls.Add(_saveSlotLabel);

            _saveSlotComboBox = new DarkComboBox();
            _saveSlotComboBox.DropDownStyle = ComboBoxStyle.DropDownList;
            _saveSlotComboBox.FlatStyle = FlatStyle.Flat;
            _saveSlotComboBox.BackColor = Theme.Ink800;
            _saveSlotComboBox.ForeColor = Theme.Parchment50;
            _saveSlotComboBox.DrawMode = DrawMode.OwnerDrawFixed;
            _saveSlotComboBox.ItemHeight = Theme.ScaleDpi(20, _dpiScale);
            _saveSlotComboBox.Font = new Font("Segoe UI", 8.5f, FontStyle.Regular);
            _saveSlotComboBox.Location = new Point(76, 192);
            _saveSlotComboBox.Size = new Size(180, 26);
            _saveSlotComboBox.DrawItem += DrawDarkComboItem;
            _saveSlotComboBox.SelectedIndexChanged += OnSaveSlotSelectedIndexChanged;
            _settingsTabPanel.Controls.Add(_saveSlotComboBox);

            _languageLabel = new Label();
            _languageLabel.Text = "Language";
            _languageLabel.Font = new Font("Segoe UI", 8.25f, FontStyle.Bold);
            _languageLabel.ForeColor = Theme.Parchment400;
            _languageLabel.AutoSize = true;
            _languageLabel.Location = new Point(0, 229);
            _settingsTabPanel.Controls.Add(_languageLabel);

            _languageComboBox = new DarkComboBox();
            _languageComboBox.DropDownStyle = ComboBoxStyle.DropDownList;
            _languageComboBox.FlatStyle = FlatStyle.Flat;
            _languageComboBox.BackColor = Theme.Ink800;
            _languageComboBox.ForeColor = Theme.Parchment50;
            _languageComboBox.DrawMode = DrawMode.OwnerDrawFixed;
            _languageComboBox.ItemHeight = Theme.ScaleDpi(20, _dpiScale);
            _languageComboBox.Font = new Font("Segoe UI", 8.5f, FontStyle.Regular);
            _languageComboBox.Location = new Point(76, 226);
            _languageComboBox.Size = new Size(200, 26);
            _languageComboBox.DrawItem += DrawDarkComboItem;
            for (int i = 0; i < LauncherI18n.SupportedLocales.Length; i++)
            {
                _languageComboBox.Items.Add(LauncherI18n.SupportedLocales[i]);
            }
            _languageComboBox.SelectedIndexChanged += OnLanguageSelectedIndexChanged;
            _settingsTabPanel.Controls.Add(_languageComboBox);

            _updateStatusLabel = new Label();
            _updateStatusLabel.Text = "Version " + AppVersion;
            _updateStatusLabel.Font = new Font("Segoe UI", 8.25f, FontStyle.Regular);
            _updateStatusLabel.ForeColor = Theme.Parchment600;
            _updateStatusLabel.AutoSize = false;
            _updateStatusLabel.Location = new Point(0, 264);
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
            _checkUpdatesLink.Location = new Point(368, 264);
            _checkUpdatesLink.LinkClicked += OnCheckUpdatesClick;
            _settingsTabPanel.Controls.Add(_checkUpdatesLink);

            // Logs Tab Panel
            _logsTabPanel = new Panel();
            _logsTabPanel.Location = new Point(14, 48);
            _logsTabPanel.Size = new Size(476, 292);
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
            _aboutTabPanel.Size = new Size(476, 292);
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

            _securityNoticeLabel = new Label();
            _securityNoticeLabel.Text = "Free & open-source (GNU AGPL-3.0). Official builds: github.com/antonioalvromero/Ocarina-Atlas \u2014 forks must preserve credits and share source.";
            _securityNoticeLabel.Font = new Font("Segoe UI", 8.25f, FontStyle.Regular);
            _securityNoticeLabel.ForeColor = Theme.Parchment200;
            _securityNoticeLabel.BackColor = Theme.Ink950;
            _securityNoticeLabel.Dock = DockStyle.Fill;
            _securityNoticeLabel.Padding = new Padding(10, 8, 10, 8);
            _securityNoticeLabel.TextAlign = ContentAlignment.MiddleLeft;
            securityNoticePanel.Controls.Add(_securityNoticeLabel);

            _aboutFooterLabel = new Label();
            _aboutFooterLabel.Text = "Version " + AppVersion + "  \u2022  Verify official releases via SHA-256 or GitHub attestation";
            _aboutFooterLabel.Font = new Font("Segoe UI", 8f, FontStyle.Regular);
            _aboutFooterLabel.ForeColor = Theme.Parchment600;
            _aboutFooterLabel.AutoSize = false;
            _aboutFooterLabel.Location = new Point(0, 260);
            _aboutFooterLabel.Size = new Size(476, 20);
            _aboutFooterLabel.Anchor = AnchorStyles.Bottom | AnchorStyles.Left | AnchorStyles.Right;
            _aboutTabPanel.Controls.Add(_aboutFooterLabel);

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
            _trayShowItem = new ToolStripMenuItem("Show Ocarina Atlas");
            _trayShowItem.Font = new Font(_trayShowItem.Font, FontStyle.Bold);
            _trayShowItem.Click += delegate { RestoreFromTray(); };

            _trayOpenBrowserItem = new ToolStripMenuItem("Open Map in Browser");
            _trayOpenBrowserItem.Enabled = false;
            _trayOpenBrowserItem.Click += delegate { OpenMapInBrowser(); };

            _trayToggleServerItem = new ToolStripMenuItem("Start Map");
            _trayToggleServerItem.Click += delegate { OnStartStopClick(this, EventArgs.Empty); };

            _trayExitItem = new ToolStripMenuItem("Exit");
            _trayExitItem.Click += delegate
            {
                Close();
            };

            menu.Items.Add(_trayShowItem);
            menu.Items.Add(_trayOpenBrowserItem);
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add(_trayToggleServerItem);
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add(_trayExitItem);

            _trayIcon = new NotifyIcon();
            _trayIcon.Icon = _appIcon;
            _trayIcon.Text = "Ocarina Atlas";
            _trayIcon.ContextMenuStrip = menu;
            _trayIcon.Visible = true;
            _trayIcon.MouseClick += delegate(object s, MouseEventArgs e)
            {
                if (e.Button == MouseButtons.Left) RestoreFromTray();
            };
            _trayIcon.DoubleClick += delegate { RestoreFromTray(); };
        }

        private void ApplyInitialOptions()
        {
            _isApplyingInitialOptions = true;
            try
            {
                int port = _options.PortExplicit ? _options.Port : (_launcherSettings.Port ?? _options.Port);
                bool allowLan = _options.AllowLanExplicit ? _options.AllowLan : (_launcherSettings.AllowLan ?? _options.AllowLan);
                string lichiiHost = _options.LichiiHostExplicit
                    ? _options.LichiiHost
                    : (!string.IsNullOrEmpty(_launcherSettings.LichiiHost)
                        ? _launcherSettings.LichiiHost
                        : _options.LichiiHost);
                int lichiiPort = _options.LichiiPortExplicit ? _options.LichiiPort : (_launcherSettings.LichiiPort ?? _options.LichiiPort);
                bool autoOpen = _options.AutoOpenBrowserExplicit ? _options.AutoOpenBrowser : (_launcherSettings.AutoOpenBrowser ?? _options.AutoOpenBrowser);
                bool minimizeToTray = _options.StartMinimized || (_launcherSettings.MinimizeToTray ?? false);

                _portInput.Value = Math.Max(1, Math.Min(65535, port));
                _allowLanCheckBox.Checked = allowLan;
                _customBindHost = _options.BindHost;
                _lichiiHostInput.Text = lichiiHost;
                _lichiiPortInput.Value = Math.Max(1, Math.Min(65535, lichiiPort));
                _autoOpenCheckBox.Checked = autoOpen;
                _trayMinimizeCheckBox.Checked = minimizeToTray;

                if (_languageComboBox != null)
                {
                    _suppressLanguageChange = true;
                    try
                    {
                        int selectedLangIdx = 0;
                        for (int i = 0; i < _languageComboBox.Items.Count; i++)
                        {
                            LocaleOption opt = _languageComboBox.Items[i] as LocaleOption;
                            if (opt != null && string.Equals(opt.Code, _currentLocale, StringComparison.OrdinalIgnoreCase))
                            {
                                selectedLangIdx = i;
                                break;
                            }
                        }
                        if (_languageComboBox.Items.Count > 0)
                        {
                            _languageComboBox.SelectedIndex = selectedLangIdx;
                        }
                    }
                    finally
                    {
                        _suppressLanguageChange = false;
                    }
                }

                if (_options.StartMinimized)
                {
                    WindowState = FormWindowState.Minimized;
                }
            }
            finally
            {
                _isApplyingInitialOptions = false;
            }

            _portInput.ValueChanged += OnPersistentSettingChanged;
            _lichiiHostInput.Leave += OnPersistentSettingChanged;
            _lichiiPortInput.ValueChanged += OnPersistentSettingChanged;
            _allowLanCheckBox.CheckedChanged += OnPersistentSettingChanged;
            _autoOpenCheckBox.CheckedChanged += OnPersistentSettingChanged;
            _trayMinimizeCheckBox.CheckedChanged += OnPersistentSettingChanged;

            UpdateSaveDirUi();
            RefreshSaveSlotOptions(DiscoverSlotsInFolder(_launcherSettings.CustomSaveDir));
        }

        private void OnPersistentSettingChanged(object sender, EventArgs e)
        {
            SaveCurrentLauncherSettings();
        }

        private string T(string key)
        {
            return LauncherI18n.Get(_currentLocale, key);
        }

        private string Tf(string key, params object[] args)
        {
            return LauncherI18n.Format(_currentLocale, key, args);
        }

        private void OnLanguageSelectedIndexChanged(object sender, EventArgs e)
        {
            if (_suppressLanguageChange || _languageComboBox == null) return;
            LocaleOption opt = _languageComboBox.SelectedItem as LocaleOption;
            string nextLocale = opt != null ? LauncherI18n.NormalizeLocale(opt.Code) : "en";
            if (string.Equals(nextLocale, _currentLocale, StringComparison.OrdinalIgnoreCase)) return;

            _currentLocale = nextLocale;
            _launcherSettings.Language = _currentLocale;
            _launcherSettings.Save();
            ApplyLauncherLanguage();
        }

        private void ApplyLauncherLanguage()
        {
            Text = T("app_title");
            if (_updatePillLabel != null) _updatePillLabel.Text = T("update_pill");
            if (_openBrowserButton != null) _openBrowserButton.Text = T("open_map");

            if (_step2TitleLabel != null) _step2TitleLabel.Text = T("lan_title");
            if (_refreshLanButton != null) _refreshLanButton.Text = T("refresh");
            if (_copyLanUrlButton != null && _copyFeedbackTicks == 0) _copyLanUrlButton.Text = T("copy_url");
            if (_qrButton != null) _qrButton.Text = T("qr_code");

            if (_settingsTabButton != null) _settingsTabButton.Text = T("tab_settings");
            if (_logsTabButton != null) _logsTabButton.Text = T("tab_logs");
            if (_aboutTabButton != null) _aboutTabButton.Text = T("tab_about");
            if (_settingsLockHintLabel != null) _settingsLockHintLabel.Text = T("settings_lock_hint");
            if (_copyLogButton != null && _copyLogFeedbackTicks == 0) _copyLogButton.Text = T("copy_logs");
            if (_clearLogButton != null) _clearLogButton.Text = T("clear");

            if (_portLabel != null) _portLabel.Text = T("map_port");
            if (_lichiiHostLabel != null) _lichiiHostLabel.Text = T("rpc_host");
            if (_lichiiPortLabel != null) _lichiiPortLabel.Text = T("rpc_port");
            if (_resetLichiiButton != null) _resetLichiiButton.Text = T("reset");
            if (_allowLanCheckBox != null) _allowLanCheckBox.Text = T("allow_lan");
            if (_autoOpenCheckBox != null) _autoOpenCheckBox.Text = T("auto_open");
            if (_trayMinimizeCheckBox != null) _trayMinimizeCheckBox.Text = T("minimize_tray");
            if (_saveDirLabel != null) _saveDirLabel.Text = T("save_folder");
            if (_addSaveDirButton != null) _addSaveDirButton.Text = T("add_ellipsis");
            if (_removeSaveDirButton != null) _removeSaveDirButton.Text = T("remove");
            if (_saveSlotLabel != null) _saveSlotLabel.Text = T("save_slot");
            if (_languageLabel != null) _languageLabel.Text = T("language");
            if (_updateStatusLabel != null && !_updateCheckInFlight && _pendingUpdateInfo == null)
            {
                _updateStatusLabel.Text = Tf("version_label", AppVersion);
            }
            if (_checkUpdatesLink != null) _checkUpdatesLink.Text = T("check_updates");

            if (_originalCreditTitle != null) _originalCreditTitle.Text = T("about_original_map");
            if (_artworkCreditTitle != null) _artworkCreditTitle.Text = T("about_artwork");
            if (_securityNoticeLabel != null) _securityNoticeLabel.Text = T("about_security");
            if (_aboutFooterLabel != null) _aboutFooterLabel.Text = Tf("about_footer", AppVersion);

            if (_trayShowItem != null) _trayShowItem.Text = T("tray_show");
            if (_trayOpenBrowserItem != null) _trayOpenBrowserItem.Text = T("tray_open");
            if (_trayExitItem != null) _trayExitItem.Text = T("tray_exit");

            UpdateSaveDirUi();
            RefreshSaveSlotOptions(_lastDiscoveredSaveSlots);

            AlignAutoSizedPairs();
            UpdateControlStates();
            RefreshLanDisplays();
            RefreshLichiiConfigStatus();
            ReflowLayout();
        }

        private void SaveCurrentLauncherSettings()
        {
            if (_isApplyingInitialOptions) return;
            _launcherSettings.Port = (int)_portInput.Value;
            _launcherSettings.LichiiHost = (_lichiiHostInput.Text ?? string.Empty).Trim();
            _launcherSettings.LichiiPort = (int)_lichiiPortInput.Value;
            _launcherSettings.AllowLan = _allowLanCheckBox.Checked;
            _launcherSettings.AutoOpenBrowser = _autoOpenCheckBox.Checked;
            _launcherSettings.MinimizeToTray = _trayMinimizeCheckBox.Checked;
            _launcherSettings.Language = _currentLocale;
            _launcherSettings.Save();
        }

        private void FitHeaderStatusPills()
        {
            if (_serverStatusPill == null || _serverStatusLabel == null || _emulatorStatusPill == null || _heroLichiiLabel == null)
            {
                return;
            }
            int rightMargin = Theme.ScaleDpi(18, _dpiScale);
            int pillGap = Theme.ScaleDpi(8, _dpiScale);
            int textLeft = Theme.ScaleDpi(23, _dpiScale);
            int rightPad = Theme.ScaleDpi(10, _dpiScale);
            int minServerPillW = Theme.ScaleDpi(90, _dpiScale);
            int minEmuPillW = Theme.ScaleDpi(96, _dpiScale);

            int emuTextW = TextRenderer.MeasureText(_heroLichiiLabel.Text ?? string.Empty, _heroLichiiLabel.Font).Width;
            int emuPillW = Math.Max(minEmuPillW, textLeft + emuTextW + rightPad);
            _heroLichiiLabel.Width = emuPillW - textLeft - Theme.ScaleDpi(5, _dpiScale);
            _emulatorStatusPill.Width = emuPillW;
            _emulatorStatusPill.Left = ClientSize.Width - rightMargin - emuPillW;

            int srvTextW = TextRenderer.MeasureText(_serverStatusLabel.Text ?? string.Empty, _serverStatusLabel.Font).Width;
            int srvPillW = Math.Max(minServerPillW, textLeft + srvTextW + rightPad);
            _serverStatusLabel.Width = srvPillW - textLeft - Theme.ScaleDpi(5, _dpiScale);
            _serverStatusPill.Width = srvPillW;
            _serverStatusPill.Left = _emulatorStatusPill.Left - pillGap - srvPillW;
        }

        private void AlignAutoSizedPairs()
        {
            int titleGap = Theme.ScaleDpi(8, _dpiScale);
            int pillGap = Theme.ScaleDpi(10, _dpiScale);
            int creditGap = Theme.ScaleDpi(6, _dpiScale);
            int repoGap = Theme.ScaleDpi(10, _dpiScale);
            int repoMinX = Theme.ScaleDpi(214, _dpiScale);
            int slotGap = Theme.ScaleDpi(10, _dpiScale);

            _versionLabel.Left = _titleLabel.Right + titleGap;
            _updatePill.Left = _versionLabel.Right + pillGap;

            _atlasCreditAuthor.Left = _atlasCreditTitle.Right + creditGap;
            _officialRepoLink.Left = Math.Max(repoMinX, _atlasCreditAuthor.Right + repoGap);

            _originalCreditAuthor.Left = _originalCreditTitle.Right + creditGap;
            _originalRepoLink.Left = Math.Max(repoMinX, _originalCreditAuthor.Right + repoGap);

            _artworkCreditAuthor.Left = _artworkCreditTitle.Right + creditGap;

            int comboLeft = Theme.ScaleDpi(76, _dpiScale);
            if (_saveSlotLabel != null)
            {
                comboLeft = Math.Max(comboLeft, _saveSlotLabel.Right + slotGap);
            }
            if (_languageLabel != null)
            {
                comboLeft = Math.Max(comboLeft, _languageLabel.Right + slotGap);
            }

            if (_saveSlotComboBox != null)
            {
                _saveSlotComboBox.Left = comboLeft;
                _saveSlotComboBox.ItemHeight = Math.Max(16, Theme.ScaleDpi(20, _dpiScale));
            }
            if (_languageComboBox != null)
            {
                _languageComboBox.Left = comboLeft;
                _languageComboBox.ItemHeight = Math.Max(16, Theme.ScaleDpi(20, _dpiScale));
            }
            if (_saveDirComboBox != null)
            {
                _saveDirComboBox.ItemHeight = Math.Max(16, Theme.ScaleDpi(20, _dpiScale));
            }

            if (_settingsTabPanel != null && _checkUpdatesLink != null && _updateStatusLabel != null)
            {
                _checkUpdatesLink.Left = Math.Max(Theme.ScaleDpi(180, _dpiScale), _settingsTabPanel.ClientSize.Width - _checkUpdatesLink.Width);
                _updateStatusLabel.Width = Math.Max(Theme.ScaleDpi(100, _dpiScale), _checkUpdatesLink.Left - _updateStatusLabel.Left - slotGap);
            }

            FitHeaderStatusPills();
        }

        private void ReflowLayout()
        {
            _advancedToggleButton.Text = (_advancedExpanded ? "\u25BE " : "\u25B8 ") + T("drawer_title");

            int nonClientW = Size.Width - ClientSize.Width;
            int nonClientH = Size.Height - ClientSize.Height;

            int minWidth = Theme.ScaleDpi(BaseClientWidth, _dpiScale);
            int collapsedHeight = Theme.ScaleDpi(CollapsedClientHeight, _dpiScale);
            int expandedMinHeight = Theme.ScaleDpi(ExpandedMinClientHeight, _dpiScale);
            int expandedHeight = Theme.ScaleDpi(ExpandedClientHeight, _dpiScale);
            int minDrawerHeight = Theme.ScaleDpi(286, _dpiScale);
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

        private static string[] DiscoverSlotsInFolder(string folder)
        {
            if (string.IsNullOrEmpty(folder)) return null;
            try
            {
                if (!Directory.Exists(folder)) return null;
                List<string> found = new List<string>();
                string folderName = Path.GetFileName(folder.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar));
                if (!string.IsNullOrEmpty(folderName) &&
                    folderName.StartsWith("slot_", StringComparison.OrdinalIgnoreCase))
                {
                    found.Add(folderName);
                }
                else
                {
                    string[] dirs = Directory.GetDirectories(folder, "slot_*", SearchOption.TopDirectoryOnly);
                    for (int i = 0; i < dirs.Length; i++)
                    {
                        string name = Path.GetFileName(dirs[i]);
                        if (!string.IsNullOrEmpty(name))
                        {
                            found.Add(name);
                        }
                    }
                    found.Sort(StringComparer.OrdinalIgnoreCase);
                }
                return found.Count > 0 ? found.ToArray() : null;
            }
            catch
            {
                return null;
            }
        }

        private static void DrawDarkComboItem(object sender, DrawItemEventArgs e)
        {
            if (e.Index < 0) return;
            ComboBox combo = sender as ComboBox;
            if (combo == null || e.Index >= combo.Items.Count) return;

            bool isComboBoxEdit = (e.State & DrawItemState.ComboBoxEdit) != 0;
            bool isSelected = (e.State & DrawItemState.Selected) != 0;
            Color bgColor = isSelected ? Theme.Ink700 : Theme.Ink800;
            Color textColor = (!isComboBoxEdit && isSelected) ? Theme.Gold : Theme.Parchment50;

            using (SolidBrush bgBrush = new SolidBrush(bgColor))
            {
                e.Graphics.FillRectangle(bgBrush, e.Bounds);
            }

            string text = combo.GetItemText(combo.Items[e.Index]);
            Rectangle textBounds = new Rectangle(
                e.Bounds.X + 4,
                e.Bounds.Y,
                Math.Max(0, e.Bounds.Width - 8),
                e.Bounds.Height);
            Font font = e.Font ?? combo.Font;
            TextRenderer.DrawText(
                e.Graphics,
                text,
                font,
                textBounds,
                textColor,
                bgColor,
                TextFormatFlags.EndEllipsis | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPrefix);
        }

        private string FormatSaveDirLabel(string dir)
        {
            string trimmed = (dir ?? string.Empty).Trim();
            if (string.IsNullOrEmpty(trimmed)) return T("auto_detect");
            string cleaned = trimmed.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
            string name = Path.GetFileName(cleaned);
            if (!string.IsNullOrEmpty(name) && !string.Equals(name, trimmed, StringComparison.OrdinalIgnoreCase))
            {
                return string.Format(CultureInfo.InvariantCulture, "{0} ({1})", name, trimmed);
            }
            return trimmed;
        }

        private void UpdateSaveDirUi()
        {
            if (_saveDirComboBox == null || _removeSaveDirButton == null) return;

            string activeDir = (_launcherSettings.CustomSaveDir ?? string.Empty).Trim();
            if (_launcherSettings.SavedSaveDirs == null)
            {
                _launcherSettings.SavedSaveDirs = new List<string>();
            }

            List<string> dirs = new List<string>();
            for (int i = 0; i < _launcherSettings.SavedSaveDirs.Count; i++)
            {
                string entry = (_launcherSettings.SavedSaveDirs[i] ?? string.Empty).Trim();
                if (string.IsNullOrEmpty(entry)) continue;
                bool exists = false;
                for (int j = 0; j < dirs.Count; j++)
                {
                    if (string.Equals(dirs[j], entry, StringComparison.OrdinalIgnoreCase))
                    {
                        exists = true;
                        break;
                    }
                }
                if (!exists) dirs.Add(entry);
            }

            if (!string.IsNullOrEmpty(activeDir))
            {
                bool activeFound = false;
                for (int i = 0; i < dirs.Count; i++)
                {
                    if (string.Equals(dirs[i], activeDir, StringComparison.OrdinalIgnoreCase))
                    {
                        activeFound = true;
                        break;
                    }
                }
                if (!activeFound) dirs.Add(activeDir);
            }

            _suppressSaveDirChange = true;
            try
            {
                _saveDirComboBox.BeginUpdate();
                _saveDirComboBox.Items.Clear();
                _saveDirComboBox.Items.Add(new SaveSlotItem(string.Empty, T("auto_detect")));

                int selectIndex = 0;
                for (int i = 0; i < dirs.Count; i++)
                {
                    string path = dirs[i];
                    _saveDirComboBox.Items.Add(new SaveSlotItem(path, FormatSaveDirLabel(path)));
                    if (!string.IsNullOrEmpty(activeDir) &&
                        string.Equals(path, activeDir, StringComparison.OrdinalIgnoreCase))
                    {
                        selectIndex = i + 1;
                    }
                }

                _saveDirComboBox.SelectedIndex = selectIndex;
                _saveDirComboBox.EndUpdate();
            }
            finally
            {
                _suppressSaveDirChange = false;
            }

            bool hasCustomDir = !string.IsNullOrEmpty(activeDir);
            _removeSaveDirButton.Enabled = hasCustomDir;
            if (_toolTip != null)
            {
                _toolTip.SetToolTip(
                    _saveDirComboBox,
                    hasCustomDir ? activeDir : "Auto-detect emulator or recomp save folder");
            }
        }

        private void RefreshSaveSlotOptions(string[] discoveredSlots)
        {
            if (_saveSlotComboBox == null) return;

            List<string> slotNames = new List<string>();
            if (discoveredSlots != null && discoveredSlots.Length > 0)
            {
                for (int i = 0; i < discoveredSlots.Length; i++)
                {
                    string s = (discoveredSlots[i] ?? string.Empty).Trim();
                    if (!string.IsNullOrEmpty(s) && !slotNames.Contains(s))
                    {
                        slotNames.Add(s);
                    }
                }
            }
            else
            {
                for (int i = 0; i <= 5; i++)
                {
                    slotNames.Add(string.Format(CultureInfo.InvariantCulture, "slot_{0:00}", i));
                }
            }

            string selectedSlot = (_launcherSettings.CustomSaveSlot ?? string.Empty).Trim();
            if (!string.IsNullOrEmpty(selectedSlot) && !slotNames.Contains(selectedSlot))
            {
                slotNames.Add(selectedSlot);
            }

            _lastDiscoveredSaveSlots = discoveredSlots;

            _suppressSaveSlotChange = true;
            try
            {
                _saveSlotComboBox.BeginUpdate();
                _saveSlotComboBox.Items.Clear();
                _saveSlotComboBox.Items.Add(new SaveSlotItem(string.Empty, T("auto_latest")));

                int selectIndex = 0;
                for (int i = 0; i < slotNames.Count; i++)
                {
                    string name = slotNames[i];
                    _saveSlotComboBox.Items.Add(new SaveSlotItem(name, name));
                    if (string.Equals(name, selectedSlot, StringComparison.OrdinalIgnoreCase))
                    {
                        selectIndex = i + 1;
                    }
                }

                _saveSlotComboBox.SelectedIndex = selectIndex;
                _saveSlotComboBox.EndUpdate();
            }
            finally
            {
                _suppressSaveSlotChange = false;
            }
        }

        private void OnSaveDirSelectedIndexChanged(object sender, EventArgs e)
        {
            if (_suppressSaveDirChange) return;
            SaveSlotItem item = _saveDirComboBox.SelectedItem as SaveSlotItem;
            string dirValue = item != null ? item.Value : string.Empty;
            if (string.Equals(dirValue, _launcherSettings.CustomSaveDir, StringComparison.OrdinalIgnoreCase))
            {
                return;
            }

            _launcherSettings.CustomSaveDir = dirValue;
            _launcherSettings.Save();
            _removeSaveDirButton.Enabled = !string.IsNullOrEmpty(dirValue);
            if (_toolTip != null)
            {
                _toolTip.SetToolTip(
                    _saveDirComboBox,
                    string.IsNullOrEmpty(dirValue) ? "Auto-detect emulator or recomp save folder" : dirValue);
            }
            RefreshSaveSlotOptions(DiscoverSlotsInFolder(dirValue));
            AppendLog(string.IsNullOrEmpty(dirValue)
                ? "Save folder reset to auto-detect."
                : "Save folder set to: " + dirValue);
            ApplySaveSelectionToServerAsync();
        }

        private void OnAddSaveDirClick(object sender, EventArgs e)
        {
            string chosen = ModernFolderPicker.PickFolder(
                this,
                "Select your Ocarina of Time save folder (e.g. slot_00, user\\save, or game root)",
                _launcherSettings.CustomSaveDir);
            if (string.IsNullOrEmpty(chosen))
            {
                return;
            }

                if (_launcherSettings.SavedSaveDirs == null)
                {
                    _launcherSettings.SavedSaveDirs = new List<string>();
                }

                string matchedExisting = null;
                for (int i = 0; i < _launcherSettings.SavedSaveDirs.Count; i++)
                {
                    if (string.Equals(_launcherSettings.SavedSaveDirs[i], chosen, StringComparison.OrdinalIgnoreCase))
                    {
                        matchedExisting = _launcherSettings.SavedSaveDirs[i];
                        break;
                    }
                }

                if (matchedExisting == null)
                {
                    _launcherSettings.SavedSaveDirs.Add(chosen);
                }
                else
                {
                    chosen = matchedExisting;
                }

                bool changedActive = !string.Equals(chosen, _launcherSettings.CustomSaveDir, StringComparison.OrdinalIgnoreCase);
                _launcherSettings.CustomSaveDir = chosen;
                _launcherSettings.Save();
                UpdateSaveDirUi();

                if (changedActive)
                {
                    RefreshSaveSlotOptions(DiscoverSlotsInFolder(chosen));
                    AppendLog("Save folder set to: " + chosen);
                    ApplySaveSelectionToServerAsync();
                }
        }

        private void OnRemoveSaveDirClick(object sender, EventArgs e)
        {
            string activeDir = (_launcherSettings.CustomSaveDir ?? string.Empty).Trim();
            if (string.IsNullOrEmpty(activeDir)) return;

            if (_launcherSettings.SavedSaveDirs != null)
            {
                for (int i = _launcherSettings.SavedSaveDirs.Count - 1; i >= 0; i--)
                {
                    if (string.Equals(_launcherSettings.SavedSaveDirs[i], activeDir, StringComparison.OrdinalIgnoreCase))
                    {
                        _launcherSettings.SavedSaveDirs.RemoveAt(i);
                    }
                }
            }

            _launcherSettings.CustomSaveDir = string.Empty;
            _launcherSettings.Save();
            UpdateSaveDirUi();
            RefreshSaveSlotOptions(null);
            AppendLog("Save folder removed; reset to auto-detect.");
            ApplySaveSelectionToServerAsync();
        }

        private void OnSaveSlotSelectedIndexChanged(object sender, EventArgs e)
        {
            if (_suppressSaveSlotChange) return;
            SaveSlotItem item = _saveSlotComboBox.SelectedItem as SaveSlotItem;
            string slotValue = item != null ? item.Value : string.Empty;
            if (string.Equals(slotValue, _launcherSettings.CustomSaveSlot, StringComparison.Ordinal))
            {
                return;
            }

            _launcherSettings.CustomSaveSlot = slotValue;
            _launcherSettings.Save();
            AppendLog(string.IsNullOrEmpty(slotValue)
                ? "Save slot set to: Auto (Latest)."
                : "Save slot set to: " + slotValue);
            ApplySaveSelectionToServerAsync();
        }

        private void ApplySaveSelectionToServerAsync()
        {
            if (_lifecycle != ServerLifecycle.Running && _lifecycle != ServerLifecycle.Starting)
            {
                return;
            }

            int port = _activePort;
            string saveDir = (_launcherSettings.CustomSaveDir ?? string.Empty).Trim();
            string saveSlot = (_launcherSettings.CustomSaveSlot ?? string.Empty).Trim();

            ThreadPool.QueueUserWorkItem(delegate
            {
                string url = string.Format(CultureInfo.InvariantCulture, "http://127.0.0.1:{0}/api/saves/slot", port);
                string saveDirJson = string.IsNullOrEmpty(saveDir)
                    ? "null"
                    : "\"" + SimpleJsonParser.EscapeString(saveDir) + "\"";
                string slotJson = string.IsNullOrEmpty(saveSlot)
                    ? "null"
                    : "\"" + SimpleJsonParser.EscapeString(saveSlot) + "\"";
                string payload = string.Format(
                    CultureInfo.InvariantCulture,
                    "{{\"saveDir\":{0},\"slot\":{1}}}",
                    saveDirJson,
                    slotJson);

                try
                {
                    HttpWebRequest req = (HttpWebRequest)WebRequest.Create(url);
                    req.Method = "POST";
                    req.ContentType = "application/json";
                    req.Timeout = 2000;
                    req.ReadWriteTimeout = 2000;
                    req.Proxy = null;
                    req.KeepAlive = false;

                    byte[] bodyBytes = Encoding.UTF8.GetBytes(payload);
                    req.ContentLength = bodyBytes.Length;
                    using (Stream reqStream = req.GetRequestStream())
                    {
                        reqStream.Write(bodyBytes, 0, bodyBytes.Length);
                    }

                    using (HttpWebResponse resp = (HttpWebResponse)req.GetResponse())
                    {
                        using (Stream respStream = resp.GetResponseStream())
                        using (StreamReader reader = new StreamReader(respStream, Encoding.UTF8))
                        {
                            string respBody = reader.ReadToEnd();
                            Dictionary<string, object> obj = SimpleJsonParser.ParseObject(respBody);
                            string[] slots = ExtractStringArray(obj, "availableSaveSlots");
                            if (slots != null && !IsDisposed && IsHandleCreated)
                            {
                                BeginInvoke(new Action(delegate
                                {
                                    if (!IsDisposed)
                                    {
                                        RefreshSaveSlotOptions(slots);
                                    }
                                }));
                            }
                        }
                    }
                }
                catch (Exception ex)
                {
                    if (!IsDisposed && IsHandleCreated)
                    {
                        BeginInvoke(new Action(delegate
                        {
                            if (!IsDisposed)
                            {
                                AppendLog("Warning: could not apply save selection to running server (" + ex.Message + ").");
                            }
                        }));
                    }
                }
            });
        }

        private static string[] ExtractStringArray(Dictionary<string, object> obj, string key)
        {
            List<object> arr = SimpleJsonParser.GetArray(obj, key);
            if (arr == null || arr.Count == 0) return null;
            List<string> list = new List<string>(arr.Count);
            for (int i = 0; i < arr.Count; i++)
            {
                string s = arr[i] as string;
                if (!string.IsNullOrEmpty(s))
                {
                    list.Add(s);
                }
            }
            return list.Count > 0 ? list.ToArray() : null;
        }

        private static bool StringArraysEqual(string[] a, string[] b)
        {
            if (ReferenceEquals(a, b)) return true;
            if (a == null || b == null || a.Length != b.Length) return false;
            for (int i = 0; i < a.Length; i++)
            {
                if (!string.Equals(a[i], b[i], StringComparison.Ordinal)) return false;
            }
            return true;
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
            // Hide() removes the window from the taskbar without triggering ShowInTaskbar RecreateHandle().
            Hide();
            if (!_trayHintShown && _trayIcon != null)
            {
                _trayHintShown = true;
                _trayIcon.ShowBalloonTip(
                    2500,
                    "Ocarina Atlas",
                    "Still running in the system tray. Click or double-click the icon to reopen.",
                    ToolTipIcon.Info);
            }
        }

        private void RestoreFromTray()
        {
            if (!Visible)
            {
                Show();
            }
            if (WindowState == FormWindowState.Minimized)
            {
                WindowState = FormWindowState.Normal;
            }
            BringToFront();
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
                    _lichiiStepDetailLabel.Text = T("sync_hint_configured");
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
                    _lichiiStepDetailLabel.Text = T("sync_hint_default");
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
                    ? T("configured")
                    : Tf("configured_port", lPort);
            }
            else
            {
                _enableRpcButton.Text = lPort == 6545
                    ? T("setup_sync")
                    : Tf("setup_sync_port", lPort);
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
                _copyLogButton.Text = T("copied");
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
                _lanStatusLabel.Text = T("lan_disabled");
                _lanStatusLabel.ForeColor = Theme.Parchment600;
                _lanStatusLabel.Visible = true;
                _copyLanUrlButton.Enabled = false;
                _qrButton.Enabled = false;
                _qrButton.ForeColor = Theme.Parchment600;
                _qrButton.FlatAppearance.BorderColor = Theme.Ink700;
                if (_lanFeedbackTicks == 0)
                {
                    _lanHintLabel.Text = T("lan_hint_disabled");
                    _lanHintLabel.ForeColor = Theme.Parchment400;
                }
                return;
            }

            if (_lanEndpoints.Count == 0)
            {
                _lanComboBox.Visible = false;
                _lanUrlLink.Visible = false;
                _lanStatusLabel.Text = T("lan_no_adapter");
                _lanStatusLabel.ForeColor = Theme.Ember;
                _lanStatusLabel.Visible = true;
                _copyLanUrlButton.Enabled = false;
                _qrButton.Enabled = false;
                _qrButton.ForeColor = Theme.Parchment600;
                _qrButton.FlatAppearance.BorderColor = Theme.Ink700;
                if (_lanFeedbackTicks == 0)
                {
                    _lanHintLabel.Text = T("lan_hint_no_adapter");
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
                    _lanHintLabel.Text = T("lan_hint_multi");
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
                    _lanHintLabel.Text = T("lan_hint_default");
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
                _copyLanUrlButton.Text = T("copied");
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
                _firewallButton.Text = T("localhost_only");
                _firewallButton.ForeColor = Theme.Parchment600;
                _firewallButton.FlatAppearance.BorderColor = Theme.Ink700;
                return;
            }

            _firewallButton.Enabled = true;
            if (_firewallCheckedPort == port && _firewallAllowed)
            {
                _firewallButton.Text = T("firewall_ready");
                _firewallButton.ForeColor = Theme.Moss;
                _firewallButton.FlatAppearance.BorderColor = Theme.Moss;
            }
            else
            {
                _firewallButton.Text = T("allow_firewall");
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
                if (!string.IsNullOrEmpty(_launcherSettings.CustomSaveDir))
                {
                    psi.EnvironmentVariables["CUSTOM_SAVE_DIR"] = _launcherSettings.CustomSaveDir;
                }
                if (!string.IsNullOrEmpty(_launcherSettings.CustomSaveSlot))
                {
                    psi.EnvironmentVariables["CUSTOM_SAVE_SLOT"] = _launcherSettings.CustomSaveSlot;
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
                _startStopButton.Text = T("start_map");
                _startStopButton.Enabled = true;
                _startStopButton.BackColor = Theme.Moss;
                _startStopButton.ForeColor = Theme.Ink950;
                _startStopButton.FlatAppearance.BorderColor = Theme.Moss;

                if (_hasStartupError)
                {
                    _serverDot.DotColor = Theme.Ember;
                    _serverStatusLabel.Text = T("status_error");
                    _serverStatusLabel.ForeColor = Theme.Ember;
                    _serverStatusPill.BorderColor = Theme.Ember;
                    _heroSummaryLabel.Text = T("hero_error");
                }
                else
                {
                    _serverDot.DotColor = Theme.Parchment600;
                    _serverStatusLabel.Text = T("status_stopped");
                    _serverStatusLabel.ForeColor = Theme.Parchment400;
                    _serverStatusPill.BorderColor = Theme.Ink700;
                    _heroSummaryLabel.Text = T("hero_idle");
                }
                _serverUrlLink.Visible = false;
            }
            else if (_lifecycle == ServerLifecycle.Starting)
            {
                _startStopButton.Text = T("stop_map");
                _startStopButton.Enabled = true;
                _startStopButton.BackColor = Theme.Ember;
                _startStopButton.ForeColor = Theme.Ink950;
                _startStopButton.FlatAppearance.BorderColor = Theme.Ember;

                _serverDot.DotColor = Theme.Ember;
                _serverStatusLabel.Text = T("status_starting");
                _serverStatusLabel.ForeColor = Theme.Ember;
                _serverStatusPill.BorderColor = Theme.Ember;
                _heroSummaryLabel.Text = T("hero_starting");
                _serverUrlLink.Visible = false;
            }
            else if (isRunning)
            {
                _startStopButton.Text = T("stop_map");
                _startStopButton.Enabled = true;
                _startStopButton.BackColor = Theme.Ember;
                _startStopButton.ForeColor = Theme.Ink950;
                _startStopButton.FlatAppearance.BorderColor = Theme.Ember;

                _serverDot.DotColor = Theme.Moss;
                _serverStatusLabel.Text = T("status_running");
                _serverStatusLabel.ForeColor = Theme.Moss;
                _serverStatusPill.BorderColor = Theme.Moss;
                _heroSummaryLabel.Text = T("hero_running");
                _serverUrlLink.Text = GetServerUrl();
                _serverUrlLink.Visible = true;
            }
            else if (isStopping)
            {
                _startStopButton.Text = T("stopping");
                _startStopButton.Enabled = false;
                _startStopButton.BackColor = Theme.Ink800;
                _startStopButton.ForeColor = Theme.Parchment400;
                _startStopButton.FlatAppearance.BorderColor = Theme.Ink700;

                _serverDot.DotColor = Theme.Ember;
                _serverStatusLabel.Text = T("status_stopping");
                _serverStatusLabel.ForeColor = Theme.Ember;
                _serverStatusPill.BorderColor = Theme.Ember;
                _heroSummaryLabel.Text = T("hero_stopping");
                _serverUrlLink.Visible = false;
            }

            FitHeaderStatusPills();
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
                _trayToggleServerItem.Text = isStopped ? T("start_map") : T("stop_map");
                _trayToggleServerItem.Enabled = !isStopping;
            }
            if (_trayIcon != null)
            {
                _trayIcon.Text = isRunning
                    ? "Ocarina Atlas \u2014 " + T("status_running") + " (" + GetServerUrl() + ")"
                    : "Ocarina Atlas \u2014 " + _serverStatusLabel.Text;
            }
        }

        private void OnPollTimerTick(object sender, EventArgs e)
        {
            if (_copyFeedbackTicks > 0)
            {
                _copyFeedbackTicks--;
                if (_copyFeedbackTicks == 0 && _copyLanUrlButton != null)
                {
                    _copyLanUrlButton.Text = T("copy_url");
                }
            }
            if (_copyLogFeedbackTicks > 0)
            {
                _copyLogFeedbackTicks--;
                if (_copyLogFeedbackTicks == 0 && _copyLogButton != null)
                {
                    _copyLogButton.Text = T("copy_logs");
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
            if (string.Equals(emulatorKind, "ootpc", StringComparison.OrdinalIgnoreCase)) return "OOT-PC";
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
                                    snap.AvailableSaveSlots = ExtractStringArray(obj, "availableSaveSlots");
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

            if (snap.ServerHttpOk && snap.AvailableSaveSlots != null &&
                !StringArraysEqual(snap.AvailableSaveSlots, _lastDiscoveredSaveSlots))
            {
                RefreshSaveSlotOptions(snap.AvailableSaveSlots);
            }

            string emuName = !string.IsNullOrEmpty(snap.RunningEmulator) ? snap.RunningEmulator : "Emulator";

            if (snap.ServerHttpOk && snap.Connected && snap.EmulatorRunning &&
                string.Equals(snap.Source, "memory", StringComparison.OrdinalIgnoreCase))
            {
                _syncFeedbackTicks = 0;
                _heroLichiiDot.DotColor = Theme.Moss;
                _heroLichiiLabel.Text = T("emu_live");
                _heroLichiiLabel.ForeColor = Theme.Moss;
                _emulatorStatusPill.BorderColor = Theme.Moss;
                string fullEmuTip = emuName + ": " + T("emu_live");
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
                _heroLichiiLabel.Text = T("emu_waiting");
                _heroLichiiLabel.ForeColor = Theme.Ember;
                _emulatorStatusPill.BorderColor = Theme.Ember;
                string fullEmuTip = emuName + ": " + T("emu_waiting");
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
                _heroLichiiLabel.Text = isRecomp ? T("emu_waiting") : T("emu_rpc_closed");
                _heroLichiiLabel.ForeColor = Theme.Ember;
                _emulatorStatusPill.BorderColor = Theme.Ember;
                string fullEmuTip = snap.RunningEmulator + ": " + (isRecomp ? T("emu_waiting") : T("emu_rpc_closed"));
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
                bool hasSave = snap.ServerHttpOk && string.Equals(snap.Source, "save", StringComparison.OrdinalIgnoreCase) && snap.SkulltulaCount.HasValue;
                _heroLichiiDot.DotColor = hasSave ? Theme.Gold : Theme.Parchment600;
                _heroLichiiLabel.Text = hasSave ? T("emu_save") : T("emu_none");
                _heroLichiiLabel.ForeColor = hasSave ? Theme.Gold : Theme.Parchment400;
                _emulatorStatusPill.BorderColor = hasSave ? Theme.Gold : Theme.Ink700;
                _toolTip.SetToolTip(_emulatorStatusPill, hasSave ? T("emu_save") : "Emulator: Not detected");
                _toolTip.SetToolTip(_heroLichiiLabel, hasSave ? T("emu_save") : "Emulator: Not detected");

                if (_syncFeedbackTicks == 0)
                {
                    if (hasSave)
                    {
                        _lichiiStepDetailLabel.Text = string.Format(
                            CultureInfo.InvariantCulture,
                            "Save data found ({0}/100 GS) \u2014 open Lichii or Fritchii for live tracking.",
                            snap.SkulltulaCount.Value);
                        _lichiiStepDetailLabel.ForeColor = Theme.Parchment400;
                    }
                    else if (_lichiiConfigured)
                    {
                        _lichiiStepDetailLabel.Text = T("sync_hint_configured");
                        _lichiiStepDetailLabel.ForeColor = Theme.Parchment400;
                    }
                    else
                    {
                        _lichiiStepDetailLabel.Text = T("sync_hint_default");
                        _lichiiStepDetailLabel.ForeColor = Theme.Parchment200;
                    }
                }
            }

            FitHeaderStatusPills();
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
