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
}
