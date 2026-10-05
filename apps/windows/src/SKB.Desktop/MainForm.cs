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

    public MainForm()
    {
        Text = Installer.Name;
        Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
        MinimumSize = new Size(1024, 700);
        StartPosition = FormStartPosition.Manual;
        // The screen it was last on (owner, 2026-10-05: "full screen on the computer, never small"):
        // it always opens filling that screen; F11 hides the title bar and the taskbar too.
        var bounds = AppSettings.WindowBounds;
        var screen = bounds is Rectangle r && Array.Find(Screen.AllScreens, s => s.WorkingArea.IntersectsWith(r)) is Screen hit
            ? hit
            : Screen.PrimaryScreen;
        Bounds = screen.WorkingArea;
        WindowState = FormWindowState.Maximized;
        KeyPreview = true;
        Controls.Add(_web);
    }

    protected override async void OnLoad(EventArgs e)
    {
        base.OnLoad(e);
        await InitAsync();
    }

    private async Task InitAsync()
    {
        var dataFolder = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "SKB", "WebView2");
        try
        {
            var env = await CoreWebView2Environment.CreateAsync(null, dataFolder);
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
            if (!a.IsSuccess && a.WebErrorStatus != CoreWebView2WebErrorStatus.OperationCanceled)
                ShowOffline(a.WebErrorStatus == CoreWebView2WebErrorStatus.Unknown ? "" : a.WebErrorStatus.ToString());
            else if (a.HttpStatusCode >= 500)
                ShowOffline($"HTTP {a.HttpStatusCode}");
        };
        // Buttons on the offline page. Harmless if a server page sends them: retry / open settings.
        core.WebMessageReceived += (_, a) =>
        {
            var message = a.TryGetWebMessageAsString();
            if (message == "retry") OpenServer();
            else if (message == "settings") ShowSettings();
        };

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
        AppSettings.Maximized = WindowState == FormWindowState.Maximized;
        AppSettings.WindowBounds = WindowState == FormWindowState.Normal ? Bounds : RestoreBounds;
        base.OnFormClosing(e);
    }
}
