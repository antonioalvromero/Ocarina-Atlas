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
[assembly: AssemblyVersion("2.6.1.0")]
[assembly: AssemblyFileVersion("2.6.1.0")]

namespace OcarinaAtlasLauncher
{
    internal sealed partial class MainForm : Form
    {
        public const string AppVersion = "2.6.1";
    }

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
}
