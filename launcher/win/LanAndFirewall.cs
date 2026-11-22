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
        private static readonly string[] ProfileDirNames = new[] { "fritchii", "lichii", "eden", "cheezyemu" };

        private static readonly Regex ActiveSwitchRegex = new Regex(
            @"^\s*EDEN_NX2_DEBUG_SERVER\s*=\s*(.+?)\s*$",
            RegexOptions.Compiled);

        public static string GetConfigPath()
        {
            List<string> paths = GetTargetConfigPaths();
            return paths.Count > 0 ? paths[0] : string.Empty;
        }

        private static void AddUniqueConfigPath(List<string> targets, HashSet<string> seen, string configPath)
        {
            if (string.IsNullOrEmpty(configPath)) return;
            string normalized = configPath;
            try
            {
                normalized = Path.GetFullPath(configPath);
            }
            catch
            {
                normalized = configPath;
            }
            if (seen.Add(normalized))
            {
                targets.Add(configPath);
            }
        }

        public static List<string> GetTargetConfigPaths()
        {
            string appData = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
            List<string> targets = new List<string>();
            HashSet<string> seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

            for (int i = 0; i < ProfileDirNames.Length; i++)
            {
                string profileName = ProfileDirNames[i];
                string dir = Path.Combine(appData, profileName);
                string cfg = Path.Combine(dir, "nx2_switches.txt");
                bool alwaysInclude = string.Equals(profileName, "fritchii", StringComparison.OrdinalIgnoreCase) ||
                                     string.Equals(profileName, "lichii", StringComparison.OrdinalIgnoreCase);
                if (alwaysInclude || Directory.Exists(dir) || File.Exists(cfg))
                {
                    AddUniqueConfigPath(targets, seen, cfg);
                }
            }

            for (int i = 0; i < ProfileDirNames.Length; i++)
            {
                Process[] procs = null;
                try
                {
                    procs = Process.GetProcessesByName(ProfileDirNames[i]);
                }
                catch
                {
                    procs = null;
                }

                if (procs == null || procs.Length == 0) continue;

                for (int j = 0; j < procs.Length; j++)
                {
                    Process proc = procs[j];
                    if (proc == null) continue;
                    try
                    {
                        ProcessModule mod = proc.MainModule;
                        string exePath = mod != null ? mod.FileName : null;
                        if (!string.IsNullOrEmpty(exePath))
                        {
                            string exeDir = Path.GetDirectoryName(exePath);
                            if (!string.IsNullOrEmpty(exeDir))
                            {
                                string exeCfg = Path.Combine(exeDir, "nx2_switches.txt");
                                string userDir = Path.Combine(exeDir, "user");
                                bool userDirExists = Directory.Exists(userDir);
                                if (File.Exists(exeCfg) || userDirExists)
                                {
                                    AddUniqueConfigPath(targets, seen, exeCfg);
                                }
                                if (userDirExists)
                                {
                                    AddUniqueConfigPath(targets, seen, Path.Combine(userDir, "nx2_switches.txt"));
                                }
                            }
                        }
                    }
                    catch
                    {
                        // Ignore inaccessible or exiting emulator process.
                    }
                    finally
                    {
                        try { proc.Dispose(); } catch { }
                    }
                }
            }

            return targets;
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
}
