using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Runtime.InteropServices;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;
using Text_ = SKB.Desktop.Text; // Form.Text is the window title

namespace SKB.Desktop;

/// <summary>
/// Evolvix for Windows. The whole app — screens, rules, data — lives on the company server; this
/// window is a secure view onto it (Edge WebView2), so it is always the latest version the moment
/// the server is updated. Only pages of the configured server open inside; any other link opens in
/// the default browser. The window has no title bar (owner, 2026-11-10): it fills the screen's
/// working area, the taskbar showing, and the page has its own minimize and close buttons
/// (window.SKBDesktop). "Server address…" is in the window menu (right-click those buttons,
/// Alt+Space, or Shift+right-click the taskbar button) and on the page shown when the server
/// can't be reached.
/// </summary>
internal sealed class MainForm : Form
{
    private const int WmSysCommand = 0x0112;
    private const int WmGetMinMaxInfo = 0x0024;
    private const int WmInitMenuPopup = 0x0117;
    private const int SettingsCommand = 0x1000;
    private const int ScSize = 0xF000, ScMove = 0xF010, ScMaximize = 0xF030, ScKeyMenu = 0xF100, ScRestore = 0xF120;
    private const int MfString = 0x0;
    private const int MfSeparator = 0x800;
    private const int MfGrayed = 0x1;
    private const int WsMinimizeBox = 0x00020000, WsSysMenu = 0x00080000;
    private const int TpmRightButton = 0x0002, TpmReturnCmd = 0x0100;

    private readonly WebView2 _web = new() { Dock = DockStyle.Fill };
    // A branded splash shown from the very first moment, while WebView2 starts up and the server
    // page (which has its own boot splash) is still loading — so there is never a blank gap.
    private readonly Panel _splash = new() { Dock = DockStyle.Fill, BackColor = Color.FromArgb(0xF6, 0xF7, 0xFB) };
    private bool _splashGone;
    private bool _closing;

    private enum ExitChoice { Cancel, Exit, SignOut }

    public MainForm()
    {
        Text = Installer.Name;
        Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
        StartPosition = FormStartPosition.Manual;
        // The screen it was last on, filled (owner, 2026-10-05: "full screen on the computer, never
        // small"), with no title bar or border (owner, 2026-11-10: "remove minimize and maximize";
        // the page has its own minimize and close). The taskbar stays showing; F11 hides it too
        // (owner, 2026-10-11: "open full screen by default"), remembered on this computer.
        var bounds = AppSettings.WindowBounds;
        var screen = bounds is Rectangle r && Array.Find(Screen.AllScreens, s => s.WorkingArea.IntersectsWith(r)) is Screen hit
            ? hit
            : Screen.PrimaryScreen;
        FormBorderStyle = FormBorderStyle.None;
        _wantFullScreen = AppSettings.FullScreen;
        Bounds = screen.WorkingArea;
        WindowState = FormWindowState.Maximized;
        KeyPreview = true;
        // A light backdrop so the view is never a black flash while a page is still loading or while
        // the server is being reached (owner, 2026-10-12: "a black screen that tells me nothing").
        _web.DefaultBackgroundColor = Color.FromArgb(0xF6, 0xF7, 0xFB);
        Controls.Add(_web);
        BuildSplash();
        Controls.Add(_splash);
        _splash.BringToFront();
    }

    /// <summary>
    /// No title bar, yet still a window Windows minimizes and restores: its taskbar button
    /// minimizes and restores it, and it keeps its window menu with "Server address…".
    /// </summary>
    protected override CreateParams CreateParams
    {
        get
        {
            var cp = base.CreateParams;
            cp.Style |= WsMinimizeBox | WsSysMenu;
            return cp;
        }
    }

    /// <summary>The app's own name, shown big while the first page loads (owner, 2026-10-13).</summary>
    private void BuildSplash()
    {
        var box = new TableLayoutPanel
        {
            AutoSize = true,
            AutoSizeMode = AutoSizeMode.GrowAndShrink,
            ColumnCount = 1,
            RowCount = 3,
            Anchor = AnchorStyles.None,
        };
        var name = new Label
        {
            Text = "Evolvix",
            AutoSize = true,
            Font = new Font("Segoe UI", 30f, FontStyle.Bold),
            ForeColor = Color.FromArgb(0x4F, 0x46, 0xE5),
            Anchor = AnchorStyles.None,
            Margin = new Padding(0, 0, 0, 16),
        };
        var bar = new ProgressBar
        {
            Style = ProgressBarStyle.Marquee,
            MarqueeAnimationSpeed = 28,
            Width = 220,
            Height = 6,
            Anchor = AnchorStyles.None,
            Margin = new Padding(0, 0, 0, 12),
        };
        var sub = new Label
        {
            Text = Text_.Starting,
            AutoSize = true,
            ForeColor = Color.FromArgb(0x6B, 0x72, 0x80),
            Font = new Font("Segoe UI", 10f),
            Anchor = AnchorStyles.None,
        };
        box.Controls.Add(name, 0, 0);
        box.Controls.Add(bar, 0, 1);
        box.Controls.Add(sub, 0, 2);
        _splash.Controls.Add(box);
        _splash.Controls.Add(CaptionButtons());
        void Centre() => box.Location =
            new Point((_splash.Width - box.Width) / 2, (_splash.Height - box.Height) / 2);
        _splash.Resize += (_, _) => Centre();
        box.SizeChanged += (_, _) => Centre();
        Centre();
    }

    /// <summary>Minimize and close while the first page loads (the page then shows its own).</summary>
    private Control CaptionButtons()
    {
        var glyphs = new Font("Segoe MDL2 Assets", 10f);
        var mdl2 = glyphs.Name == "Segoe MDL2 Assets";
        var row = new FlowLayoutPanel
        {
            Dock = DockStyle.Top,
            AutoSize = true,
            WrapContents = false,
            // The end of the top edge: right in English, left in Arabic (as Windows mirrors it).
            FlowDirection = Text_.Arabic ? FlowDirection.LeftToRight : FlowDirection.RightToLeft,
            BackColor = _splash.BackColor,
            Margin = Padding.Empty,
            Padding = Padding.Empty,
        };
        Button Make(string glyph, string plain, string name, Color hover, bool white, Action act)
        {
            var b = new Button
            {
                Text = mdl2 ? glyph : plain,
                Font = mdl2 ? glyphs : new Font("Segoe UI", 11f),
                AccessibleName = name,
                FlatStyle = FlatStyle.Flat,
                Size = new Size(46, 32),
                Margin = Padding.Empty,
                TabStop = false,
                ForeColor = Color.FromArgb(0x1F, 0x29, 0x37),
                BackColor = _splash.BackColor,
                UseVisualStyleBackColor = false,
            };
            b.FlatAppearance.BorderSize = 0;
            b.FlatAppearance.MouseOverBackColor = hover;
            b.FlatAppearance.MouseDownBackColor = hover;
            if (white)
            {
                b.MouseEnter += (_, _) => b.ForeColor = Color.White;
                b.MouseLeave += (_, _) => b.ForeColor = Color.FromArgb(0x1F, 0x29, 0x37);
            }
            b.Click += (_, _) => act();
            return b;
        }
        row.Controls.Add(Make("\uE8BB", "\u2715", Text_.Close, Color.FromArgb(0xE8, 0x11, 0x23), true, Close));
        row.Controls.Add(Make("\uE921", "\u2014", Text_.Minimize, Color.FromArgb(0xE5, 0xE7, 0xEB), false,
            () => WindowState = FormWindowState.Minimized));
        return row;
    }

    private void HideSplash()
    {
        if (_splashGone) return;
        _splashGone = true;
        _splash.Visible = false;
    }

    protected override async void OnLoad(EventArgs e)
    {
        base.OnLoad(e);
        await InitAsync();
    }

    protected override void OnShown(EventArgs e)
    {
        base.OnShown(e);
        if (_wantFullScreen) SetFullScreen(true);
    }

    private async Task InitAsync()
    {
        var dataFolder = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "SKB", "WebView2");
        try
        {
            // An office server reached over plain http (http://192.168.x.x:8080) still gets the
            // microphone for spoken questions: the browser treats that one address as secure.
            var options = new CoreWebView2EnvironmentOptions();
            if (Uri.TryCreate(AppSettings.Server, UriKind.Absolute, out var origin) && origin.Scheme == Uri.UriSchemeHttp)
                options.AdditionalBrowserArguments =
                    $"--unsafely-treat-insecure-origin-as-secure={origin.Scheme}://{origin.Authority}";
            var env = await CoreWebView2Environment.CreateAsync(null, dataFolder, options);
            await _web.EnsureCoreWebView2Async(env);
        }
        catch (WebView2RuntimeNotFoundException)
        {
            if (MessageBox.Show(this, Text_.NeedsWebView2, Installer.Name, MessageBoxButtons.YesNo) == DialogResult.Yes)
                OpenExternal("https://go.microsoft.com/fwlink/p/?LinkId=2124703");
            Close();
            return;
        }

        var core = _web.CoreWebView2;
        core.Settings.UserAgent += " SKBDesktop/1.0";
        core.Settings.AreDevToolsEnabled = false;
        core.Settings.IsStatusBarEnabled = false;
        core.Settings.IsGeneralAutofillEnabled = false;
        core.Settings.IsPasswordAutosaveEnabled = false;

        // The company server's pages may use the microphone (the assistant's spoken questions) and
        // show system notifications (owner, 2026-11-12); no other page may notify.
        core.PermissionRequested += (_, a) =>
        {
            if (a.PermissionKind == CoreWebView2PermissionKind.Microphone && AppSettings.IsServerUrl(a.Uri))
                a.State = CoreWebView2PermissionState.Allow;
            else if (a.PermissionKind == CoreWebView2PermissionKind.Notifications)
                a.State = AppSettings.IsServerUrl(a.Uri)
                    ? CoreWebView2PermissionState.Allow
                    : CoreWebView2PermissionState.Deny;
        };
        WatchNotifications(core);
        core.NavigationStarting += (_, a) =>
        {
            if (a.Uri.StartsWith("data:", StringComparison.Ordinal) || a.Uri.StartsWith("about:", StringComparison.Ordinal)
                || AppSettings.IsServerUrl(a.Uri))
                return;
            a.Cancel = true;
            OpenExternal(a.Uri);
        };
        core.NewWindowRequested += (_, a) =>
        {
            a.Handled = true;
            if (AppSettings.IsServerUrl(a.Uri)) core.Navigate(a.Uri);
            else OpenExternal(a.Uri);
        };
        core.NavigationCompleted += (_, a) =>
        {
            if (a.IsSuccess) HideSplash(); // the server page (or the offline page) is now showing
            if (!a.IsSuccess && a.WebErrorStatus != CoreWebView2WebErrorStatus.OperationCanceled)
                ShowOffline(a.WebErrorStatus == CoreWebView2WebErrorStatus.Unknown ? "" : a.WebErrorStatus.ToString());
            else if (a.HttpStatusCode >= 500)
                ShowOffline($"HTTP {a.HttpStatusCode}");
        };
        // Buttons on the offline page and the app's own minimize / close / window menu, and F11
        // inside the page (the page has the keyboard, so the window never sees it). Harmless if a
        // server page sends them. Anything that opens a dialog or a menu runs after the handler
        // returns: a nested loop inside a WebView2 event is not allowed.
        core.WebMessageReceived += (_, a) =>
        {
            string? message;
            try { message = a.TryGetWebMessageAsString(); } catch (ArgumentException) { return; }
            switch (message)
            {
                case "retry": OpenServer(); break;
                case "settings": Later(ShowSettings); break;
                case "fullscreen": Later(ToggleUserFullScreen); break;
                case "minimize": Later(() => WindowState = FormWindowState.Minimized); break;
                case "close": Later(Close); break; // asks first (OnFormClosing)
                case "menu": Later(ShowWindowMenu); break;
            }
        };
        // window.SKBDesktop tells the page it is in this app, which then shows its minimize and close
        // buttons (apps/web/src/lib/desktop.ts).
        await core.AddScriptToExecuteOnDocumentCreatedAsync(
            "(function(){var w=window.chrome&&window.chrome.webview;if(!w)return;" +
            "function send(m){return function(){w.postMessage(m)}}" +
            "window.SKBDesktop=Object.freeze({minimize:send('minimize'),close:send('close'),menu:send('menu')});" +
            "addEventListener('keydown',function(e){if(e.key==='F11'){e.preventDefault();w.postMessage('fullscreen')}},true);})();");
        // A page asking for the whole screen (e.g. a video) gets the window's whole screen too, and
        // gives it back as it was.
        core.ContainsFullScreenElementChanged += (_, _) => SetFullScreen(core.ContainsFullScreenElement || _wantFullScreen);

        OpenServer();
    }

    private void Later(Action action) => BeginInvoke(action);

    // ---- System notifications (owner, 2026-11-12) ----

    /// <summary>The tray icon a notification is shown from (a Windows toast on Windows 10/11).</summary>
    private NotifyIcon? _tray;
    /// <summary>The page's notification now showing, to tell the page when it is clicked.</summary>
    private CoreWebView2Notification? _shown;

    /// <summary>
    /// The page's <c>new Notification(…)</c> (only the app's name and the kind's title, never an amount)
    /// is shown by this window as a Windows notification; clicking it brings the window to the front
    /// and tells the page, which opens what it is about. Without the event (an old WebView2 runtime),
    /// WebView2 shows it its own way.
    /// </summary>
    private void WatchNotifications(CoreWebView2 core)
    {
        try
        {
            core.NotificationReceived += (_, a) =>
            {
                a.Handled = true; // never WebView2's own; a page that isn't the server's shows nothing
                if (!AppSettings.IsServerUrl(a.SenderOrigin)) return;
                ShowNotification(a.Notification);
            };
        }
        catch (Exception)
        {
            // An old WebView2 runtime: it shows the page's notifications itself.
        }
    }

    private void ShowNotification(CoreWebView2Notification note)
    {
        if (_closing || IsDisposed) return;
        if (_tray is null)
        {
            _tray = new NotifyIcon { Icon = Icon, Text = Installer.Name };
            _tray.BalloonTipClicked += (_, _) => OpenFromNotification();
            _tray.MouseClick += (_, _) => OpenFromNotification();
        }
        var old = _shown;
        _shown = note;
        note.CloseRequested += (_, _) =>
        {
            if (ReferenceEquals(_shown, note)) _shown = null;
        };
        if (old is not null && !ReferenceEquals(old, note))
            try { old.ReportClosed(); } catch (COMException) { /* already gone */ }
        var title = string.IsNullOrWhiteSpace(note.Title) ? Installer.Name : Trim(note.Title, 63);
        var body = string.IsNullOrWhiteSpace(note.Body) ? title : Trim(note.Body, 255);
        _tray.Visible = true;
        _tray.ShowBalloonTip(10_000, title, body, ToolTipIcon.None);
        try { note.ReportShown(); } catch (COMException) { /* the page has moved on */ }
    }

    private static string Trim(string s, int max) => s.Length <= max ? s : s.Substring(0, max);

    /// <summary>The notification (or the tray icon) was clicked: the window in front, the page told.</summary>
    private void OpenFromNotification()
    {
        if (_closing || IsDisposed) return;
        if (WindowState == FormWindowState.Minimized)
            WindowState = _fullScreen ? FormWindowState.Normal : FormWindowState.Maximized;
        Show();
        Activate();
        BringToFront();
        var note = _shown;
        _shown = null;
        if (note is not null)
            try { note.ReportClicked(); } catch (COMException) { /* the page has moved on */ }
        HideTray();
    }

    private void HideTray()
    {
        if (_tray is not null) _tray.Visible = false;
    }

    protected override void OnActivated(EventArgs e)
    {
        base.OnActivated(e);
        // Back in the app: the tray icon goes until the next notification.
        HideTray();
    }

    protected override void OnFormClosed(FormClosedEventArgs e)
    {
        _tray?.Dispose(); // no ghost icon left in the tray
        _tray = null;
        base.OnFormClosed(e);
    }

    private void OpenServer() => _web.CoreWebView2?.Navigate(AppSettings.Server);

    private void ShowSettings()
    {
        using var dialog = new SettingsForm();
        if (dialog.ShowDialog(this) == DialogResult.OK) OpenServer();
    }

    private void ShowOffline(string reason)
    {
        HideSplash();
        var dir = Text_.Arabic ? "rtl" : "ltr";
        var html = $@"<!doctype html><html dir='{dir}'><head><meta charset='utf-8'>
<style>body{{font-family:'Segoe UI',sans-serif;margin:0;min-height:100vh;display:grid;place-items:center;background:#f6f7fb;color:#1f2937}}
main{{max-width:360px;padding:24px;text-align:center}}.logo{{font-size:28px;color:#4f46e5;
font-weight:800;letter-spacing:-0.5px;margin:0 auto 16px}}h1{{font-size:18px;margin:0 0 8px}}p{{color:#6b7280;font-size:14px;
margin:0 0 20px;word-break:break-word}}button{{display:block;width:100%;height:40px;border-radius:8px;border:0;font-size:14px;margin-top:10px;cursor:pointer}}
.primary{{background:#4f46e5;color:#fff}}.secondary{{background:#e5e7eb;color:#111827}}
.win{{position:fixed;top:0;inset-inline-end:0;display:flex}}.win button{{width:46px;height:32px;margin:0;border-radius:0;
background:transparent;color:#1f2937;font:10px 'Segoe Fluent Icons','Segoe MDL2 Assets',sans-serif}}
.win button:hover{{background:#e5e7eb}}.win .x:hover{{background:#e81123;color:#fff}}</style></head>
<body><div class='win'><button title='{Enc(Text_.Minimize)}' onclick=""chrome.webview.postMessage('minimize')"">&#xE921;</button>
<button class='x' title='{Enc(Text_.Close)}' onclick=""chrome.webview.postMessage('close')"">&#xE8BB;</button></div><main><div class='logo'>Evolvix</div><h1>{Enc(Text_.OfflineTitle)}</h1>
<p>{Enc(Text_.OfflineBody)} {Enc(AppSettings.Server)}<br><small>{Enc(reason)}</small></p>
<button class='primary' onclick=""chrome.webview.postMessage('retry')"">{Enc(Text_.Retry)}</button>
<button class='secondary' onclick=""chrome.webview.postMessage('settings')"">{Enc(Text_.SettingsTitle)}</button>
</main></body></html>";
        _web.CoreWebView2?.NavigateToString(html);
    }

    private static string Enc(string s) => WebUtility.HtmlEncode(s);

    private static void OpenExternal(string url)
    {
        if (!Uri.TryCreate(url, UriKind.Absolute, out var uri)) return;
        if (uri.Scheme != Uri.UriSchemeHttps && uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeMailto) return;
        try { Process.Start(new ProcessStartInfo(uri.AbsoluteUri) { UseShellExecute = true }); } catch { /* no handler */ }
    }

    // ---- The window menu ("Server address…") and filling the screen ----

    [DllImport("user32.dll")] private static extern IntPtr GetSystemMenu(IntPtr hWnd, bool revert);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern bool AppendMenu(IntPtr menu, int flags, int id, string? item);
    [DllImport("user32.dll")] private static extern bool EnableMenuItem(IntPtr menu, int id, int flags);
    [DllImport("user32.dll")] private static extern int TrackPopupMenu(IntPtr menu, int flags, int x, int y, int reserved, IntPtr hWnd, IntPtr rect);
    [DllImport("user32.dll")] private static extern IntPtr SendMessage(IntPtr hWnd, int msg, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll")] private static extern IntPtr MonitorFromWindow(IntPtr hWnd, int flags);
    [DllImport("user32.dll")] private static extern bool GetMonitorInfo(IntPtr monitor, ref MonitorInfo info);
    [DllImport("shell32.dll")] private static extern IntPtr SHAppBarMessage(int message, ref AppBarData data);

    [StructLayout(LayoutKind.Sequential)] private struct Point32 { public int X, Y; }
    [StructLayout(LayoutKind.Sequential)] private struct Rect32 { public int Left, Top, Right, Bottom; }
    [StructLayout(LayoutKind.Sequential)]
    private struct MinMaxInfo { public Point32 Reserved, MaxSize, MaxPosition, MinTrackSize, MaxTrackSize; }
    [StructLayout(LayoutKind.Sequential)]
    private struct MonitorInfo { public int Size; public Rect32 Monitor, Work; public int Flags; }
    [StructLayout(LayoutKind.Sequential)]
    private struct AppBarData { public int Size; public IntPtr Window; public int CallbackMessage, Edge; public Rect32 Rect; public IntPtr Param; }

    protected override void OnHandleCreated(EventArgs e)
    {
        base.OnHandleCreated(e);
        var menu = GetSystemMenu(Handle, false);
        AppendMenu(menu, MfSeparator, 0, null);
        AppendMenu(menu, MfString, SettingsCommand, Text_.ServerSettings);
    }

    protected override void WndProc(ref Message m)
    {
        switch (m.Msg)
        {
            case WmSysCommand:
                var command = (int)(m.WParam.ToInt64() & 0xFFF0);
                if (command == SettingsCommand)
                {
                    ShowSettings();
                    return;
                }
                // Alt (or F10) alone would put the hidden window menu in charge of the keyboard.
                if (command == ScKeyMenu && m.LParam == IntPtr.Zero) return;
                // Never a smaller window: only a minimized one is restored.
                if (command == ScRestore && WindowState != FormWindowState.Minimized) return;
                break;
            case WmGetMinMaxInfo:
                base.WndProc(ref m);
                FitMaximized(m.HWnd, m.LParam);
                return;
            case WmInitMenuPopup when m.WParam == GetSystemMenu(Handle, false):
                base.WndProc(ref m);
                // It always fills the screen: never restored smaller, moved, sized or maximized again.
                if (WindowState != FormWindowState.Minimized) EnableMenuItem(m.WParam, ScRestore, MfGrayed);
                EnableMenuItem(m.WParam, ScMove, MfGrayed);
                EnableMenuItem(m.WParam, ScSize, MfGrayed);
                EnableMenuItem(m.WParam, ScMaximize, MfGrayed);
                return;
        }
        base.WndProc(ref m);
    }

    /// <summary>The window menu at the mouse, as a right-click on a title bar shows it.</summary>
    private void ShowWindowMenu()
    {
        if (!IsHandleCreated) return;
        var at = Cursor.Position;
        var command = TrackPopupMenu(GetSystemMenu(Handle, false), TpmRightButton | TpmReturnCmd, at.X, at.Y, 0, Handle, IntPtr.Zero);
        if (command != 0) SendMessage(Handle, WmSysCommand, (IntPtr)command, IntPtr.Zero);
    }

    /// <summary>
    /// Maximized is the working area of the window's screen, the taskbar left showing: a window
    /// without a title bar would otherwise cover the whole screen. With a taskbar that hides
    /// itself, a thin edge stays free so it still slides up.
    /// </summary>
    private static void FitMaximized(IntPtr window, IntPtr lParam)
    {
        var monitor = MonitorFromWindow(window, 2 /* MONITOR_DEFAULTTONEAREST */);
        var info = new MonitorInfo { Size = Marshal.SizeOf(typeof(MonitorInfo)) };
        if (monitor == IntPtr.Zero || !GetMonitorInfo(monitor, ref info)) return;
        var area = info.Work;
        if (area.Equals(info.Monitor))
        {
            var bar = new AppBarData { Size = Marshal.SizeOf(typeof(AppBarData)) };
            if ((SHAppBarMessage(4 /* ABM_GETSTATE */, ref bar).ToInt64() & 1 /* ABS_AUTOHIDE */) != 0
                && SHAppBarMessage(5 /* ABM_GETTASKBARPOS */, ref bar) != IntPtr.Zero)
            {
                switch (bar.Edge)
                {
                    case 0: area.Left += 2; break;
                    case 1: area.Top += 2; break;
                    case 2: area.Right -= 2; break;
                    default: area.Bottom -= 2; break;
                }
            }
        }
        var mmi = (MinMaxInfo)Marshal.PtrToStructure(lParam, typeof(MinMaxInfo));
        // Relative to the screen it is on (Windows moves it to the right one).
        mmi.MaxPosition = new Point32 { X = area.Left - info.Monitor.Left, Y = area.Top - info.Monitor.Top };
        mmi.MaxSize = new Point32 { X = area.Right - area.Left, Y = area.Bottom - area.Top };
        Marshal.StructureToPtr(mmi, lParam, false);
    }

    protected override void OnResize(EventArgs e)
    {
        base.OnResize(e);
        // Anything that restores it to a smaller window (Win+Down, …) fills the screen again.
        if (IsHandleCreated && !_fullScreen && WindowState == FormWindowState.Normal)
            BeginInvoke(new Action(() =>
            {
                if (!_fullScreen && WindowState == FormWindowState.Normal) WindowState = FormWindowState.Maximized;
            }));
    }

    /// <summary>F11: the whole screen, the taskbar hidden too; F11 again shows the taskbar.</summary>
    private bool _fullScreen;
    /// <summary>The person's F11 choice, remembered on this computer.</summary>
    private bool _wantFullScreen;

    private void ToggleUserFullScreen()
    {
        _wantFullScreen = !_fullScreen;
        AppSettings.FullScreen = _wantFullScreen;
        SetFullScreen(_wantFullScreen);
    }

    private void SetFullScreen(bool on)
    {
        if (on == _fullScreen) return;
        _fullScreen = on;
        if (on)
        {
            WindowState = FormWindowState.Normal;
            Bounds = Screen.FromControl(this).Bounds;
        }
        else
        {
            Bounds = Screen.FromControl(this).WorkingArea;
            WindowState = FormWindowState.Maximized;
        }
    }

    protected override bool ProcessCmdKey(ref Message msg, Keys keyData)
    {
        if (keyData == Keys.F11)
        {
            ToggleUserFullScreen();
            return true;
        }
        return base.ProcessCmdKey(ref msg, keyData);
    }

    protected override void OnFormClosing(FormClosingEventArgs e)
    {
        // Ask before leaving (owner, 2026-10-13): just exit, or exit and sign out, or stay.
        if (!_closing && e.CloseReason == CloseReason.UserClosing)
        {
            switch (AskExit())
            {
                case ExitChoice.Cancel:
                    e.Cancel = true;
                    return;
                case ExitChoice.SignOut:
                    // Clear the sign-in so the next launch asks to log in again on this computer.
                    try { _web.CoreWebView2?.CookieManager.DeleteAllCookies(); } catch { /* nothing to clear */ }
                    break;
            }
            _closing = true;
        }
        // The screen it is on, to open there next time (a minimized window counts where it was).
        AppSettings.WindowBounds = Screen.FromHandle(Handle).WorkingArea;
        base.OnFormClosing(e);
    }

    /// <summary>The close prompt: Exit, Exit and sign out, or stay.</summary>
    private ExitChoice AskExit()
    {
        using var dlg = new Form
        {
            Text = Text_.ExitTitle,
            FormBorderStyle = FormBorderStyle.FixedDialog,
            StartPosition = FormStartPosition.CenterParent,
            MinimizeBox = false,
            MaximizeBox = false,
            ShowInTaskbar = false,
            ClientSize = new Size(400, 158),
            BackColor = Color.White,
            RightToLeft = Text_.Arabic ? RightToLeft.Yes : RightToLeft.No,
            RightToLeftLayout = Text_.Arabic,
        };
        var prompt = new Label
        {
            Text = Text_.ExitPrompt,
            Dock = DockStyle.Top,
            Height = 92,
            TextAlign = ContentAlignment.MiddleCenter,
            Font = new Font("Segoe UI", 11f),
        };
        Button Make(string text, DialogResult result) => new()
        {
            Text = text,
            DialogResult = result,
            AutoSize = true,
            AutoSizeMode = AutoSizeMode.GrowAndShrink,
            Height = 36,
            Margin = new Padding(6, 0, 6, 0),
            Padding = new Padding(10, 6, 10, 6),
        };
        var exit = Make(Text_.ExitJustClose, DialogResult.Yes);
        var signOut = Make(Text_.ExitSignOut, DialogResult.No);
        var cancel = Make(Text_.Cancel, DialogResult.Cancel);
        var row = new FlowLayoutPanel
        {
            Dock = DockStyle.Bottom,
            Height = 60,
            FlowDirection = FlowDirection.RightToLeft,
            Padding = new Padding(12, 10, 12, 10),
        };
        row.Controls.Add(exit);
        row.Controls.Add(signOut);
        row.Controls.Add(cancel);
        dlg.Controls.Add(row);
        dlg.Controls.Add(prompt);
        dlg.AcceptButton = exit;
        dlg.CancelButton = cancel;
        return dlg.ShowDialog(this) switch
        {
            DialogResult.Yes => ExitChoice.Exit,
            DialogResult.No => ExitChoice.SignOut,
            _ => ExitChoice.Cancel,
        };
    }
}
