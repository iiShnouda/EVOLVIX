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
/// the default browser. "Server address…" is in the window menu (right-click the title bar) and on
/// the page shown when the server can't be reached.
/// </summary>
internal sealed class MainForm : Form
{
    private const int WmSysCommand = 0x0112;
    private const int SettingsCommand = 0x1000;
    private const int MfString = 0x0;
    private const int MfSeparator = 0x800;

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
        // The screen it was last on (owner, 2026-10-05: "full screen on the computer, never small"):
        // it always opens in full screen there, no title bar or taskbar (owner, 2026-10-11: "open
        // full screen by default"); F11 brings them back for the moment, F11 again hides them.
        var bounds = AppSettings.WindowBounds;
        var screen = bounds is Rectangle r && Array.Find(Screen.AllScreens, s => s.WorkingArea.IntersectsWith(r)) is Screen hit
            ? hit
            : Screen.PrimaryScreen;
        // Never larger than the screen (a laptop at 125-150% scaling is smaller than 1024 x 700), or
        // Windows can't make it fill the screen.
        MinimumSize = new Size(Math.Min(1024, screen.WorkingArea.Width), Math.Min(700, screen.WorkingArea.Height));
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
        void Centre() => box.Location =
            new Point((_splash.Width - box.Width) / 2, (_splash.Height - box.Height) / 2);
        _splash.Resize += (_, _) => Centre();
        box.SizeChanged += (_, _) => Centre();
        Centre();
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
        ToggleFullScreen(true);
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

        // The company server's pages may use the microphone (the assistant's spoken questions).
        core.PermissionRequested += (_, a) =>
        {
            if (a.PermissionKind == CoreWebView2PermissionKind.Microphone && AppSettings.IsServerUrl(a.Uri))
                a.State = CoreWebView2PermissionState.Allow;
        };
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
        // Buttons on the offline page, and F11 inside the page (the page has the keyboard, so the
        // window never sees it). Harmless if a server page sends them.
        core.WebMessageReceived += (_, a) =>
        {
            var message = a.TryGetWebMessageAsString();
            if (message == "retry") OpenServer();
            else if (message == "settings") ShowSettings();
            else if (message == "fullscreen") ToggleFullScreen(!_fullScreen);
        };
        await core.AddScriptToExecuteOnDocumentCreatedAsync(
            "addEventListener('keydown',function(e){if(e.key==='F11'){e.preventDefault();" +
            "chrome.webview.postMessage('fullscreen')}},true);");
        // A page asking for the whole screen (e.g. a video) gets the window's whole screen too.
        core.ContainsFullScreenElementChanged += (_, _) => ToggleFullScreen(core.ContainsFullScreenElement);

        OpenServer();
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
.primary{{background:#4f46e5;color:#fff}}.secondary{{background:#e5e7eb;color:#111827}}</style></head>
<body><main><div class='logo'>Evolvix</div><h1>{Enc(Text_.OfflineTitle)}</h1>
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

    // ---- "Server address…" in the window (system) menu ----

    [DllImport("user32.dll")] private static extern IntPtr GetSystemMenu(IntPtr hWnd, bool revert);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern bool AppendMenu(IntPtr menu, int flags, int id, string? item);

    protected override void OnHandleCreated(EventArgs e)
    {
        base.OnHandleCreated(e);
        var menu = GetSystemMenu(Handle, false);
        AppendMenu(menu, MfSeparator, 0, null);
        AppendMenu(menu, MfString, SettingsCommand, Text_.ServerSettings);
    }

    protected override void WndProc(ref Message m)
    {
        if (m.Msg == WmSysCommand && (int)m.WParam == SettingsCommand)
        {
            ShowSettings();
            return;
        }
        base.WndProc(ref m);
    }

    /// <summary>F11: the whole screen, no title bar or taskbar; F11 again brings them back.</summary>
    private bool _fullScreen;

    private void ToggleFullScreen(bool on)
    {
        if (on == _fullScreen) return;
        _fullScreen = on;
        if (on)
        {
            WindowState = FormWindowState.Normal;
            FormBorderStyle = FormBorderStyle.None;
            Bounds = Screen.FromControl(this).Bounds;
        }
        else
        {
            FormBorderStyle = FormBorderStyle.Sizable;
            Bounds = Screen.FromControl(this).WorkingArea;
            WindowState = FormWindowState.Maximized;
        }
    }

    protected override bool ProcessCmdKey(ref Message msg, Keys keyData)
    {
        if (keyData == Keys.F11)
        {
            ToggleFullScreen(!_fullScreen);
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
        AppSettings.Maximized = WindowState == FormWindowState.Maximized;
        if (!_fullScreen) AppSettings.WindowBounds = WindowState == FormWindowState.Normal ? Bounds : RestoreBounds;
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
