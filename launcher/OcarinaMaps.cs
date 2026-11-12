using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Globalization;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Windows.Forms;

namespace OcarinaMapsLauncher
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
        public bool AutoOpenBrowser = true;
        public bool StartMinimized = false;
        public bool AutoStart = false;

        public static LaunchOptions Parse(string[] args)
        {
            LaunchOptions opts = new LaunchOptions();
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
            }

            return opts;
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
        public static RuntimeResolution Resolve(int port)
        {
            string exeDir = (AppDomain.CurrentDomain.BaseDirectory ?? Environment.CurrentDirectory)
                .TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);

            // 1. Standalone Release layout beside OcarinaMaps.exe:
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
                        port.ToString(CultureInfo.InvariantCulture) + " --host 127.0.0.1\"";
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
        public bool FileExists = false;
        public bool IsEnabled = false;
        public string ConfiguredTarget = string.Empty;
        public string ErrorMessage = string.Empty;
    }

    internal static class LichiiConfigManager
    {
        private static readonly Regex ActiveSwitchRegex = new Regex(
            @"^\s*EDEN_NX2_DEBUG_SERVER\s*=\s*(.+?)\s*$",
            RegexOptions.Compiled);

        public static string GetConfigPath()
        {
            string appData = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
            return Path.Combine(appData, "lichii", "nx2_switches.txt");
        }

        public static LichiiConfigStatus Inspect()
        {
            LichiiConfigStatus status = new LichiiConfigStatus();
            status.FilePath = GetConfigPath();

            try
            {
                if (!File.Exists(status.FilePath))
                {
                    status.FileExists = false;
                    status.IsEnabled = false;
                    return status;
                }

                status.FileExists = true;
                string[] lines = File.ReadAllLines(status.FilePath, Encoding.UTF8);
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
                            status.IsEnabled = true;
                            status.ConfiguredTarget = val;
                        }
                    }
                }
            }
            catch (Exception ex)
            {
                status.ErrorMessage = ex.Message;
            }

            return status;
        }

        public static LichiiConfigStatus EnableDebugServer(string host, int port)
        {
            string target = string.Format(
                CultureInfo.InvariantCulture,
                "{0}:{1}",
                string.IsNullOrEmpty(host) ? "127.0.0.1" : host.Trim(),
                port);
            string newLine = "EDEN_NX2_DEBUG_SERVER=" + target;
            string configPath = GetConfigPath();
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
                outLines.Add("# Lichii NX2 switches (configured by OcarinaMaps Launcher)");
                outLines.Add("# Restart Lichii after editing.");
                outLines.Add(newLine);
            }

            string finalContent = string.Join(newlineSeq, outLines.ToArray());
            if (!finalContent.EndsWith(newlineSeq, StringComparison.Ordinal))
            {
                finalContent += newlineSeq;
            }

            File.WriteAllText(configPath, finalContent, new UTF8Encoding(false));
            return Inspect();
        }

        public static bool IsLichiiRunning()
        {
            string[] names = new[] { "lichii", "eden" };
            for (int i = 0; i < names.Length; i++)
            {
                try
                {
                    Process[] procs = Process.GetProcessesByName(names[i]);
                    if (procs != null && procs.Length > 0)
                    {
                        for (int j = 0; j < procs.Length; j++)
                        {
                            procs[j].Dispose();
                        }
                        return true;
                    }
                }
                catch
                {
                    // Ignore process inspection failure.
                }
            }
            return false;
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

    internal sealed class PollSnapshot
    {
        public bool ServerHttpOk;
        public bool RpcPortOpen;
        public bool Connected;
        public bool EmulatorRunning;
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

        public BorderedPanel()
        {
            SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer, true);
            BackColor = Theme.Ink900;
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            base.OnPaint(e);
            using (Pen pen = new Pen(BorderColor, 1f))
            {
                e.Graphics.DrawRectangle(pen, 0, 0, Width - 1, Height - 1);
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

    internal sealed class MainForm : Form
    {
        private readonly LaunchOptions _options;
        private readonly object _procLock = new object();
        private readonly System.Windows.Forms.Timer _pollTimer;
        private readonly Icon _appIcon;

        private JobObject _jobObject;
        private Process _serverProcess;
        private ServerLifecycle _lifecycle = ServerLifecycle.Stopped;
        private int _activePort = 3000;
        private string _activeLichiiHost = "127.0.0.1";
        private int _activeLichiiPort = 6545;
        private bool _browserOpenedForRun = false;
        private int _pollInFlight = 0;

        // Layout containers
        private BorderedPanel _controlsCard;
        private BorderedPanel _statusCard;
        private BorderedPanel _configCard;
        private Panel _advancedPanel;
        private Panel _logContainer;
        private Panel _logHeaderPanel;

        // Controls
        private Label _modeBadgeLabel;
        private Button _startStopButton;
        private Button _openBrowserButton;
        private NumericUpDown _portInput;
        private Button _advancedToggleButton;
        private CheckBox _autoOpenCheckBox;
        private CheckBox _trayMinimizeCheckBox;
        private TextBox _lichiiHostInput;
        private NumericUpDown _lichiiPortInput;

        private StatusDot _serverDot;
        private Label _serverStatusLabel;
        private LinkLabel _serverUrlLink;
        private StatusDot _lichiiDot;
        private Label _lichiiLabelTitle;
        private Label _lichiiStatusLabel;
        private Label _lichiiDetailLabel;

        private Label _configStatusLabel;
        private Button _enableRpcButton;

        private Button _logToggleButton;
        private Button _clearLogButton;
        private TextBox _logTextBox;

        private NotifyIcon _trayIcon;
        private ToolStripMenuItem _trayToggleServerItem;
        private ToolStripMenuItem _trayOpenBrowserItem;

        private bool _advancedExpanded = false;
        private bool _logExpanded = true;
        private bool _trayHintShown = false;

        public MainForm(LaunchOptions options)
        {
            _options = options ?? new LaunchOptions();
            _activePort = _options.Port;
            _activeLichiiHost = _options.LichiiHost;
            _activeLichiiPort = _options.LichiiPort;

            _appIcon = CreateTriforceIcon();
            Icon = _appIcon;

            Text = "Ocarina of Time Map Tracker — Lichii Bridge";
            BackColor = Theme.Ink950;
            ForeColor = Theme.Parchment200;
            Font = new Font("Segoe UI", 9f, FontStyle.Regular);
            ClientSize = new Size(600, 480);
            MinimumSize = new Size(580, 440);
            StartPosition = FormStartPosition.CenterScreen;
            AutoScaleMode = AutoScaleMode.Font;

            BuildLayout();
            BuildTrayIcon();
            ApplyInitialOptions();
            RefreshRuntimeBadge();
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
            // Header
            Panel headerPanel = new Panel();
            headerPanel.Location = new Point(16, 12);
            headerPanel.Size = new Size(568, 50);
            headerPanel.Anchor = AnchorStyles.Top | AnchorStyles.Left | AnchorStyles.Right;
            headerPanel.BackColor = Theme.Ink950;
            Controls.Add(headerPanel);

            Label titleLabel = new Label();
            titleLabel.Text = "Ocarina of Time Map Tracker — Lichii Bridge";
            titleLabel.Font = new Font("Georgia", 12.5f, FontStyle.Bold);
            titleLabel.ForeColor = Theme.Parchment50;
            titleLabel.AutoSize = true;
            titleLabel.Location = new Point(0, 0);
            headerPanel.Controls.Add(titleLabel);

            Label subtitleLabel = new Label();
            subtitleLabel.Text = "Launch the interactive Hyrule map and connect live Lichii emulator tracking.";
            subtitleLabel.Font = new Font("Segoe UI", 8.75f, FontStyle.Regular);
            subtitleLabel.ForeColor = Theme.Parchment400;
            subtitleLabel.AutoSize = true;
            subtitleLabel.Location = new Point(1, 27);
            headerPanel.Controls.Add(subtitleLabel);

            _modeBadgeLabel = new Label();
            _modeBadgeLabel.AutoSize = false;
            _modeBadgeLabel.Size = new Size(92, 22);
            _modeBadgeLabel.Location = new Point(476, 3);
            _modeBadgeLabel.Anchor = AnchorStyles.Top | AnchorStyles.Right;
            _modeBadgeLabel.TextAlign = ContentAlignment.MiddleCenter;
            _modeBadgeLabel.Font = new Font("Segoe UI", 7.75f, FontStyle.Bold);
            _modeBadgeLabel.BackColor = Theme.Ink800;
            _modeBadgeLabel.ForeColor = Theme.Parchment400;
            _modeBadgeLabel.BorderStyle = BorderStyle.FixedSingle;
            headerPanel.Controls.Add(_modeBadgeLabel);

            // Card 1: Server Controls
            _controlsCard = new BorderedPanel();
            _controlsCard.Location = new Point(16, 68);
            _controlsCard.Size = new Size(568, 92);
            _controlsCard.Anchor = AnchorStyles.Top | AnchorStyles.Left | AnchorStyles.Right;
            Controls.Add(_controlsCard);

            _startStopButton = CreateButton("Start Server", 12, 12, 148, 34, true);
            _startStopButton.BackColor = Theme.Moss;
            _startStopButton.ForeColor = Theme.Ink950;
            _startStopButton.FlatAppearance.BorderColor = Theme.Moss;
            _startStopButton.Click += OnStartStopClick;
            _controlsCard.Controls.Add(_startStopButton);

            _openBrowserButton = CreateButton("Open Map in Browser", 168, 12, 168, 34, false);
            _openBrowserButton.Click += OnOpenBrowserClick;
            _controlsCard.Controls.Add(_openBrowserButton);

            Label portLabel = new Label();
            portLabel.Text = "Port:";
            portLabel.ForeColor = Theme.Parchment400;
            portLabel.AutoSize = true;
            portLabel.Location = new Point(352, 21);
            portLabel.Anchor = AnchorStyles.Top | AnchorStyles.Right;
            _controlsCard.Controls.Add(portLabel);

            _portInput = new NumericUpDown();
            _portInput.Minimum = 1;
            _portInput.Maximum = 65535;
            _portInput.Value = 3000;
            _portInput.Location = new Point(388, 18);
            _portInput.Size = new Size(68, 24);
            _portInput.Anchor = AnchorStyles.Top | AnchorStyles.Right;
            _portInput.BackColor = Theme.Ink800;
            _portInput.ForeColor = Theme.Parchment50;
            _portInput.BorderStyle = BorderStyle.FixedSingle;
            _controlsCard.Controls.Add(_portInput);

            _advancedToggleButton = CreateButton("Lichii ▾", 468, 15, 86, 28, false);
            _advancedToggleButton.Anchor = AnchorStyles.Top | AnchorStyles.Right;
            _advancedToggleButton.Font = new Font("Segoe UI", 8.25f, FontStyle.Regular);
            _advancedToggleButton.Click += OnAdvancedToggleClick;
            _controlsCard.Controls.Add(_advancedToggleButton);

            _autoOpenCheckBox = new CheckBox();
            _autoOpenCheckBox.Text = "Auto-open browser when server starts";
            _autoOpenCheckBox.AutoSize = true;
            _autoOpenCheckBox.Checked = true;
            _autoOpenCheckBox.ForeColor = Theme.Parchment200;
            _autoOpenCheckBox.BackColor = Theme.Ink900;
            _autoOpenCheckBox.Location = new Point(14, 56);
            _controlsCard.Controls.Add(_autoOpenCheckBox);

            _trayMinimizeCheckBox = new CheckBox();
            _trayMinimizeCheckBox.Text = "Hide to tray on minimize";
            _trayMinimizeCheckBox.AutoSize = true;
            _trayMinimizeCheckBox.Checked = false;
            _trayMinimizeCheckBox.ForeColor = Theme.Parchment200;
            _trayMinimizeCheckBox.BackColor = Theme.Ink900;
            _trayMinimizeCheckBox.Location = new Point(316, 56);
            _controlsCard.Controls.Add(_trayMinimizeCheckBox);

            // Collapsible Lichii host/port panel inside controls card
            _advancedPanel = new Panel();
            _advancedPanel.Location = new Point(12, 86);
            _advancedPanel.Size = new Size(544, 34);
            _advancedPanel.Anchor = AnchorStyles.Top | AnchorStyles.Left | AnchorStyles.Right;
            _advancedPanel.BackColor = Theme.Ink900;
            _advancedPanel.Visible = false;
            _controlsCard.Controls.Add(_advancedPanel);

            Label lHostLabel = new Label();
            lHostLabel.Text = "Lichii Host:";
            lHostLabel.ForeColor = Theme.Parchment400;
            lHostLabel.AutoSize = true;
            lHostLabel.Location = new Point(2, 8);
            _advancedPanel.Controls.Add(lHostLabel);

            _lichiiHostInput = new TextBox();
            _lichiiHostInput.Text = "127.0.0.1";
            _lichiiHostInput.Location = new Point(74, 5);
            _lichiiHostInput.Size = new Size(140, 23);
            _lichiiHostInput.BackColor = Theme.Ink800;
            _lichiiHostInput.ForeColor = Theme.Parchment50;
            _lichiiHostInput.BorderStyle = BorderStyle.FixedSingle;
            _advancedPanel.Controls.Add(_lichiiHostInput);

            Label lPortLabel = new Label();
            lPortLabel.Text = "Lichii RPC Port:";
            lPortLabel.ForeColor = Theme.Parchment400;
            lPortLabel.AutoSize = true;
            lPortLabel.Location = new Point(232, 8);
            _advancedPanel.Controls.Add(lPortLabel);

            _lichiiPortInput = new NumericUpDown();
            _lichiiPortInput.Minimum = 1;
            _lichiiPortInput.Maximum = 65535;
            _lichiiPortInput.Value = 6545;
            _lichiiPortInput.Location = new Point(328, 5);
            _lichiiPortInput.Size = new Size(72, 23);
            _lichiiPortInput.BackColor = Theme.Ink800;
            _lichiiPortInput.ForeColor = Theme.Parchment50;
            _lichiiPortInput.BorderStyle = BorderStyle.FixedSingle;
            _lichiiPortInput.ValueChanged += OnLichiiPortChanged;
            _advancedPanel.Controls.Add(_lichiiPortInput);

            Button resetLichiiBtn = CreateButton("Reset Defaults", 418, 4, 122, 25, false);
            resetLichiiBtn.Font = new Font("Segoe UI", 8f, FontStyle.Regular);
            resetLichiiBtn.Click += OnResetLichiiDefaultsClick;
            _advancedPanel.Controls.Add(resetLichiiBtn);

            // Card 2: Live Status
            _statusCard = new BorderedPanel();
            _statusCard.Location = new Point(16, 168);
            _statusCard.Size = new Size(568, 92);
            _statusCard.Anchor = AnchorStyles.Top | AnchorStyles.Left | AnchorStyles.Right;
            Controls.Add(_statusCard);

            _serverDot = new StatusDot();
            _serverDot.Location = new Point(14, 15);
            _serverDot.DotColor = Theme.Parchment600;
            _statusCard.Controls.Add(_serverDot);

            Label serverTitleLabel = new Label();
            serverTitleLabel.Text = "Map Server:";
            serverTitleLabel.Font = new Font("Segoe UI", 9f, FontStyle.Bold);
            serverTitleLabel.ForeColor = Theme.Parchment50;
            serverTitleLabel.AutoSize = true;
            serverTitleLabel.Location = new Point(32, 13);
            _statusCard.Controls.Add(serverTitleLabel);

            _serverStatusLabel = new Label();
            _serverStatusLabel.Text = "Stopped";
            _serverStatusLabel.ForeColor = Theme.Parchment200;
            _serverStatusLabel.AutoSize = true;
            _serverStatusLabel.Location = new Point(116, 13);
            _statusCard.Controls.Add(_serverStatusLabel);

            _serverUrlLink = new LinkLabel();
            _serverUrlLink.Text = string.Empty;
            _serverUrlLink.LinkColor = Theme.Moss;
            _serverUrlLink.ActiveLinkColor = Theme.Parchment50;
            _serverUrlLink.VisitedLinkColor = Theme.Moss;
            _serverUrlLink.AutoSize = true;
            _serverUrlLink.Visible = false;
            _serverUrlLink.Location = new Point(182, 13);
            _serverUrlLink.LinkClicked += OnServerUrlLinkClicked;
            _statusCard.Controls.Add(_serverUrlLink);

            _lichiiDot = new StatusDot();
            _lichiiDot.Location = new Point(14, 42);
            _lichiiDot.DotColor = Theme.Parchment600;
            _statusCard.Controls.Add(_lichiiDot);

            _lichiiLabelTitle = new Label();
            _lichiiLabelTitle.Text = "Lichii RPC (:6545):";
            _lichiiLabelTitle.Font = new Font("Segoe UI", 9f, FontStyle.Bold);
            _lichiiLabelTitle.ForeColor = Theme.Parchment50;
            _lichiiLabelTitle.AutoSize = true;
            _lichiiLabelTitle.Location = new Point(32, 40);
            _statusCard.Controls.Add(_lichiiLabelTitle);

            _lichiiStatusLabel = new Label();
            _lichiiStatusLabel.Text = "Checking port 6545...";
            _lichiiStatusLabel.ForeColor = Theme.Parchment200;
            _lichiiStatusLabel.AutoSize = true;
            _lichiiStatusLabel.Location = new Point(156, 40);
            _statusCard.Controls.Add(_lichiiStatusLabel);

            _lichiiDetailLabel = new Label();
            _lichiiDetailLabel.Text = "Start Ocarina of Time in Lichii for live location and Gold Skulltula sync.";
            _lichiiDetailLabel.Font = new Font("Segoe UI", 8.25f, FontStyle.Regular);
            _lichiiDetailLabel.ForeColor = Theme.Parchment400;
            _lichiiDetailLabel.AutoSize = false;
            _lichiiDetailLabel.Location = new Point(32, 64);
            _lichiiDetailLabel.Size = new Size(522, 20);
            _lichiiDetailLabel.Anchor = AnchorStyles.Top | AnchorStyles.Left | AnchorStyles.Right;
            _statusCard.Controls.Add(_lichiiDetailLabel);

            // Card 3: 1-Click Lichii RPC Config
            _configCard = new BorderedPanel();
            _configCard.Location = new Point(16, 268);
            _configCard.Size = new Size(568, 62);
            _configCard.Anchor = AnchorStyles.Top | AnchorStyles.Left | AnchorStyles.Right;
            Controls.Add(_configCard);

            Label configTitleLabel = new Label();
            configTitleLabel.Text = "Lichii Auto-Setup (%APPDATA%\\lichii\\nx2_switches.txt)";
            configTitleLabel.Font = new Font("Segoe UI", 9f, FontStyle.Bold);
            configTitleLabel.ForeColor = Theme.Parchment50;
            configTitleLabel.AutoSize = true;
            configTitleLabel.Location = new Point(14, 10);
            _configCard.Controls.Add(configTitleLabel);

            _configStatusLabel = new Label();
            _configStatusLabel.Text = "Checking Lichii configuration...";
            _configStatusLabel.Font = new Font("Segoe UI", 8.25f, FontStyle.Regular);
            _configStatusLabel.ForeColor = Theme.Parchment400;
            _configStatusLabel.AutoSize = false;
            _configStatusLabel.Location = new Point(14, 33);
            _configStatusLabel.Size = new Size(346, 20);
            _configStatusLabel.Anchor = AnchorStyles.Top | AnchorStyles.Left | AnchorStyles.Right;
            _configCard.Controls.Add(_configStatusLabel);

            _enableRpcButton = CreateButton("Enable Lichii RPC (6545)", 372, 13, 182, 34, false);
            _enableRpcButton.Anchor = AnchorStyles.Top | AnchorStyles.Right;
            _enableRpcButton.Click += OnEnableRpcClick;
            _configCard.Controls.Add(_enableRpcButton);

            // Activity Log Header + Box
            _logHeaderPanel = new Panel();
            _logHeaderPanel.Location = new Point(16, 338);
            _logHeaderPanel.Size = new Size(568, 24);
            _logHeaderPanel.Anchor = AnchorStyles.Top | AnchorStyles.Left | AnchorStyles.Right;
            _logHeaderPanel.BackColor = Theme.Ink950;
            Controls.Add(_logHeaderPanel);

            Label logTitle = new Label();
            logTitle.Text = "Activity Log";
            logTitle.Font = new Font("Segoe UI", 8.5f, FontStyle.Bold);
            logTitle.ForeColor = Theme.Parchment400;
            logTitle.AutoSize = true;
            logTitle.Location = new Point(0, 4);
            _logHeaderPanel.Controls.Add(logTitle);

            _clearLogButton = CreateButton("Clear", 424, 0, 62, 22, false);
            _clearLogButton.Anchor = AnchorStyles.Top | AnchorStyles.Right;
            _clearLogButton.Font = new Font("Segoe UI", 7.75f, FontStyle.Regular);
            _clearLogButton.Click += OnClearLogClick;
            _logHeaderPanel.Controls.Add(_clearLogButton);

            _logToggleButton = CreateButton("Hide Log", 492, 0, 76, 22, false);
            _logToggleButton.Anchor = AnchorStyles.Top | AnchorStyles.Right;
            _logToggleButton.Font = new Font("Segoe UI", 7.75f, FontStyle.Regular);
            _logToggleButton.Click += OnToggleLogClick;
            _logHeaderPanel.Controls.Add(_logToggleButton);

            _logContainer = new Panel();
            _logContainer.Location = new Point(16, 366);
            _logContainer.Size = new Size(568, 100);
            _logContainer.Anchor = AnchorStyles.Top | AnchorStyles.Bottom | AnchorStyles.Left | AnchorStyles.Right;
            _logContainer.BackColor = Theme.Ink600;
            _logContainer.Padding = new Padding(1);
            Controls.Add(_logContainer);

            _logTextBox = new TextBox();
            _logTextBox.Multiline = true;
            _logTextBox.ReadOnly = true;
            _logTextBox.ScrollBars = ScrollBars.Vertical;
            _logTextBox.BorderStyle = BorderStyle.None;
            _logTextBox.Dock = DockStyle.Fill;
            _logTextBox.BackColor = Theme.Ink900;
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
            ToolStripMenuItem showItem = new ToolStripMenuItem("Show OcarinaMaps Launcher");
            showItem.Font = new Font(showItem.Font, FontStyle.Bold);
            showItem.Click += delegate { RestoreFromTray(); };

            _trayOpenBrowserItem = new ToolStripMenuItem("Open Map in Browser");
            _trayOpenBrowserItem.Enabled = false;
            _trayOpenBrowserItem.Click += delegate { OpenMapInBrowser(); };

            _trayToggleServerItem = new ToolStripMenuItem("Start Server");
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
            _trayIcon.Text = "OcarinaMaps — Lichii Bridge";
            _trayIcon.ContextMenuStrip = menu;
            _trayIcon.Visible = true;
            _trayIcon.DoubleClick += delegate { RestoreFromTray(); };
        }

        private void ApplyInitialOptions()
        {
            _portInput.Value = Math.Max(1, Math.Min(65535, _options.Port));
            _lichiiHostInput.Text = _options.LichiiHost;
            _lichiiPortInput.Value = Math.Max(1, Math.Min(65535, _options.LichiiPort));
            _autoOpenCheckBox.Checked = _options.AutoOpenBrowser;
            UpdateLichiiPortLabels();

            if (_options.StartMinimized)
            {
                _trayMinimizeCheckBox.Checked = true;
                ShowInTaskbar = false;
                WindowState = FormWindowState.Minimized;
            }
        }

        private void ReflowLayout()
        {
            _controlsCard.Height = _advancedExpanded ? 126 : 92;
            _advancedPanel.Visible = _advancedExpanded;
            _advancedToggleButton.Text = _advancedExpanded ? "Lichii ▴" : "Lichii ▾";

            int y = _controlsCard.Bottom + 8;
            _statusCard.Top = y;
            y = _statusCard.Bottom + 8;
            _configCard.Top = y;
            y = _configCard.Bottom + 8;
            _logHeaderPanel.Top = y;

            _logContainer.Visible = _logExpanded;
            _clearLogButton.Visible = _logExpanded;
            _logToggleButton.Text = _logExpanded ? "Hide Log" : "Show Log";

            if (_logExpanded)
            {
                _logContainer.Top = _logHeaderPanel.Bottom + 4;
                int remaining = ClientSize.Height - _logContainer.Top - 14;
                _logContainer.Height = Math.Max(48, remaining);
            }
        }

        private void OnFormLoad(object sender, EventArgs e)
        {
            AppendLog("Launcher ready. Checking runtime and Lichii status...");
            TriggerPollNow();

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
                    "OcarinaMaps Launcher",
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
            RuntimeResolution res = RuntimeResolver.Resolve((int)_portInput.Value);
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
                _configStatusLabel.Text = "Could not read config: " + status.ErrorMessage;
                _configStatusLabel.ForeColor = Theme.Ember;
                return;
            }

            if (status.IsEnabled)
            {
                _configStatusLabel.Text = "Enabled: EDEN_NX2_DEBUG_SERVER=" + status.ConfiguredTarget;
                _configStatusLabel.ForeColor = Theme.Moss;
            }
            else if (status.FileExists)
            {
                _configStatusLabel.Text = "Not enabled yet in nx2_switches.txt (click button to add).";
                _configStatusLabel.ForeColor = Theme.Ember;
            }
            else
            {
                _configStatusLabel.Text = "Config file not found yet (click button to create it).";
                _configStatusLabel.ForeColor = Theme.Ember;
            }
        }

        private void UpdateLichiiPortLabels()
        {
            int lPort = (int)_lichiiPortInput.Value;
            _lichiiLabelTitle.Text = string.Format(CultureInfo.InvariantCulture, "Lichii RPC (:{0}):", lPort);
            _lichiiStatusLabel.Left = _lichiiLabelTitle.Right + 6;
            _enableRpcButton.Text = string.Format(CultureInfo.InvariantCulture, "Enable Lichii RPC ({0})", lPort);
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

        private void OnToggleLogClick(object sender, EventArgs e)
        {
            _logExpanded = !_logExpanded;
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
                AppendLog(string.Format(
                    CultureInfo.InvariantCulture,
                    "Updated {0} with EDEN_NX2_DEBUG_SERVER={1}:{2}.",
                    updated.FilePath,
                    host,
                    port));

                bool running = LichiiConfigManager.IsLichiiRunning();
                string message = running
                    ? string.Format(
                        CultureInfo.InvariantCulture,
                        "Enabled EDEN_NX2_DEBUG_SERVER={0}:{1} in:\n{2}\n\nLichii appears to be running right now. Please restart Lichii for port {1} to take effect.",
                        host,
                        port,
                        updated.FilePath)
                    : string.Format(
                        CultureInfo.InvariantCulture,
                        "Enabled EDEN_NX2_DEBUG_SERVER={0}:{1} in:\n{2}\n\nStart (or restart) Lichii to activate live tracking.",
                        host,
                        port,
                        updated.FilePath);

                MessageBox.Show(
                    this,
                    message,
                    "Lichii RPC Enabled",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Information);
            }
            catch (Exception ex)
            {
                AppendLog("Failed to update nx2_switches.txt: " + ex.Message);
                MessageBox.Show(
                    this,
                    "Could not write Lichii config:\n" + ex.Message,
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

        private void OpenMapInBrowser()
        {
            string url = GetServerUrl();
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

            RuntimeResolution target = RuntimeResolver.Resolve(port);
            if (target.Mode == RuntimeMode.Missing)
            {
                AppendLog("ERROR: " + target.ErrorMessage);
                MessageBox.Show(this, target.ErrorMessage, "Runtime Missing", MessageBoxButtons.OK, MessageBoxIcon.Error);
                return;
            }

            _activePort = port;
            _activeLichiiHost = lichiiHost;
            _activeLichiiPort = lichiiPort;
            _browserOpenedForRun = false;
            _lifecycle = ServerLifecycle.Starting;
            UpdateControlStates();

            AppendLog(string.Format(
                CultureInfo.InvariantCulture,
                "Starting {0} server on http://127.0.0.1:{1} (Lichii {2}:{3})...",
                target.Summary,
                port,
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

                psi.EnvironmentVariables["HOST"] = "127.0.0.1";
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
        }

        private void UpdateControlStates()
        {
            bool isStopped = _lifecycle == ServerLifecycle.Stopped;
            bool isRunning = _lifecycle == ServerLifecycle.Running;
            bool isStopping = _lifecycle == ServerLifecycle.Stopping;

            _portInput.Enabled = isStopped;
            _lichiiHostInput.Enabled = isStopped;
            _lichiiPortInput.Enabled = isStopped;

            if (isStopped)
            {
                _startStopButton.Text = "Start Server";
                _startStopButton.Enabled = true;
                _startStopButton.BackColor = Theme.Moss;
                _startStopButton.ForeColor = Theme.Ink950;
                _startStopButton.FlatAppearance.BorderColor = Theme.Moss;

                _serverDot.DotColor = Theme.Parchment600;
                _serverStatusLabel.Text = "Stopped";
                _serverStatusLabel.ForeColor = Theme.Parchment400;
                _serverUrlLink.Visible = false;
            }
            else if (_lifecycle == ServerLifecycle.Starting)
            {
                _startStopButton.Text = "Stop Server";
                _startStopButton.Enabled = true;
                _startStopButton.BackColor = Theme.Ember;
                _startStopButton.ForeColor = Theme.Ink950;
                _startStopButton.FlatAppearance.BorderColor = Theme.Ember;

                _serverDot.DotColor = Theme.Ember;
                _serverStatusLabel.Text = "Starting...";
                _serverStatusLabel.ForeColor = Theme.Ember;
                _serverUrlLink.Visible = false;
            }
            else if (isRunning)
            {
                _startStopButton.Text = "Stop Server";
                _startStopButton.Enabled = true;
                _startStopButton.BackColor = Theme.Ember;
                _startStopButton.ForeColor = Theme.Ink950;
                _startStopButton.FlatAppearance.BorderColor = Theme.Ember;

                _serverDot.DotColor = Theme.Moss;
                _serverStatusLabel.Text = "Running at";
                _serverStatusLabel.ForeColor = Theme.Moss;
                _serverUrlLink.Text = GetServerUrl();
                _serverUrlLink.Left = _serverStatusLabel.Right + 4;
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
                _serverUrlLink.Visible = false;
            }

            _openBrowserButton.Enabled = isRunning;
            if (_trayOpenBrowserItem != null) _trayOpenBrowserItem.Enabled = isRunning;
            if (_trayToggleServerItem != null)
            {
                _trayToggleServerItem.Text = isStopped ? "Start Server" : "Stop Server";
                _trayToggleServerItem.Enabled = !isStopping;
            }
            if (_trayIcon != null)
            {
                _trayIcon.Text = isRunning
                    ? "OcarinaMaps — Running (" + GetServerUrl() + ")"
                    : "OcarinaMaps — " + _lifecycle.ToString();
            }
        }

        private void OnPollTimerTick(object sender, EventArgs e)
        {
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
                    BeginInvokeSafe(delegate { ApplyPollSnapshot(snap, lichiiPort); });
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
            return snap;
        }

        private void ApplyPollSnapshot(PollSnapshot snap, int lichiiPort)
        {
            if (snap == null || IsDisposed) return;

            if (snap.ServerHttpOk && _lifecycle == ServerLifecycle.Starting)
            {
                MarkServerRunning();
            }

            if (snap.ServerHttpOk && snap.Connected && snap.EmulatorRunning &&
                string.Equals(snap.Source, "memory", StringComparison.OrdinalIgnoreCase))
            {
                _lichiiDot.DotColor = Theme.Moss;
                _lichiiStatusLabel.Text = "In-game live tracking";
                _lichiiStatusLabel.ForeColor = Theme.Moss;

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

                _lichiiDetailLabel.Text = parts.Count > 0
                    ? string.Join("  ·  ", parts.ToArray())
                    : "Streaming live player coordinates from Lichii RAM.";
                _lichiiDetailLabel.ForeColor = Theme.Parchment200;
            }
            else if ((snap.ServerHttpOk && snap.Connected) || snap.RpcPortOpen)
            {
                _lichiiDot.DotColor = Theme.Ember;
                _lichiiStatusLabel.Text = "Lichii RPC open (Waiting for game)";
                _lichiiStatusLabel.ForeColor = Theme.Ember;

                if (snap.ServerHttpOk && string.Equals(snap.Source, "save", StringComparison.OrdinalIgnoreCase) && snap.SkulltulaCount.HasValue)
                {
                    _lichiiDetailLabel.Text = string.Format(
                        CultureInfo.InvariantCulture,
                        "Save fallback active ({0}/100 Gold Skulltulas) until Ocarina of Time loads in-game.",
                        snap.SkulltulaCount.Value);
                }
                else
                {
                    _lichiiDetailLabel.Text = "Lichii debug server is listening. Load your Ocarina of Time save to stream live movement.";
                }
                _lichiiDetailLabel.ForeColor = Theme.Parchment400;
            }
            else
            {
                _lichiiDot.DotColor = Theme.Parchment600;
                _lichiiStatusLabel.Text = string.Format(CultureInfo.InvariantCulture, "Port {0} closed (Not detected)", lichiiPort);
                _lichiiStatusLabel.ForeColor = Theme.Parchment400;

                if (snap.ServerHttpOk && string.Equals(snap.Source, "save", StringComparison.OrdinalIgnoreCase) && snap.SkulltulaCount.HasValue)
                {
                    _lichiiDetailLabel.Text = string.Format(
                        CultureInfo.InvariantCulture,
                        "Save data found ({0}/100 Gold Skulltulas). Open Lichii and click Enable Lichii RPC below for live sync.",
                        snap.SkulltulaCount.Value);
                }
                else
                {
                    _lichiiDetailLabel.Text = "Start Lichii, or click \"Enable Lichii RPC\" below if you haven't enabled it yet.";
                }
                _lichiiDetailLabel.ForeColor = Theme.Parchment600;
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

        [DllImport("user32.dll", SetLastError = true)]
        private static extern bool DestroyIcon(IntPtr hIcon);

        private static Icon CreateTriforceIcon()
        {
            using (Bitmap bmp = new Bitmap(32, 32))
            using (Graphics g = Graphics.FromImage(bmp))
            {
                g.SmoothingMode = SmoothingMode.AntiAlias;
                g.Clear(Theme.Ink950);

                using (Pen border = new Pen(Theme.Ink600, 1.5f))
                {
                    g.DrawRectangle(border, 1, 1, 29, 29);
                }

                using (SolidBrush gold = new SolidBrush(Theme.Parchment400))
                using (SolidBrush highlight = new SolidBrush(Theme.Parchment50))
                {
                    Point[] top = { new Point(16, 4), new Point(10, 15), new Point(22, 15) };
                    Point[] left = { new Point(10, 16), new Point(4, 27), new Point(16, 27) };
                    Point[] right = { new Point(22, 16), new Point(16, 27), new Point(28, 27) };
                    g.FillPolygon(highlight, top);
                    g.FillPolygon(gold, left);
                    g.FillPolygon(gold, right);
                }

                IntPtr hIcon = bmp.GetHicon();
                try
                {
                    using (Icon tempIcon = Icon.FromHandle(hIcon))
                    {
                        return (Icon)tempIcon.Clone();
                    }
                }
                finally
                {
                    DestroyIcon(hIcon);
                }
            }
        }
    }
}
