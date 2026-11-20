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

    internal sealed partial class MainForm : Form
    {
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
