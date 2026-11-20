# SKB for Windows

**`src/SKB.Desktop` is the Windows app.** It is a real installable program that opens the
company server's SKB web app in its own window, using Edge WebView2, which is built into
Windows 10/11.
- All screens, rules and data stay on the server, so **it updates itself whenever the server is
  updated**.
- You rebuild it only when this shell changes.
- It targets .NET Framework 4.8, which is also built into Windows. The whole app is about
  300 KB zipped and needs nothing else installed.

## What it does

- Opens the server address: `http://192.168.100.63:8080` (the office Raspberry Pi) by default.
- **The window:** no title bar or border. It fills the screen's working area (the taskbar stays
  showing) on the screen it was last on; the app's top bar has **Minimize** and **Close**
  (close asks: exit, or exit and sign out). The taskbar button minimizes and restores it as usual.
  **F11** switches to full screen (the taskbar hidden too) and back; the choice is remembered.
- **Changing the server:** right-click the Minimize/Close buttons (or Alt+Space, or Shift+right-click
  the taskbar button) → **Server address…**. This works for the company's own server on the office
  network; plain http:// gets a warning.
- **Links:** only pages of that server open inside the window. Other links open in the default
  browser.
- **Notifications:** the server's pages may show system notifications (others are denied). While
  the app is in the background, a new bell notification appears as a Windows notification (app
  name and the kind only); clicking it brings the window to the front and opens what it is about.
- **Server unreachable:** a page offers **Try again** / **Server address**.
- **Stored on the PC:** settings (the server address, the screen it opens on and full screen) live in
  `HKCU\Software\SKB`, and the browser profile (the sign-in cookie) in `%LOCALAPPDATA%\SKB`.
  No business data is stored on the PC.
- **Installing:** running `Evolvix.exe` from the downloaded folder offers to **install for this
  user**, with no admin rights:
  - It copies the app to `%LOCALAPPDATA%\Programs\Evolvix` (a copy installed before the rename, in `Programs\SKB`, is removed).
  - It adds Start-menu and desktop shortcuts.
  - It adds an entry in **Settings › Apps**, so it can be uninstalled normally.
  - Run with `--portable` to skip installing.
- **Language:** Arabic/English follows the Windows display language.

## Build

```powershell
cd apps\windows\src\SKB.Desktop
dotnet build -c Release
```

Output: `bin\Release\net48\`. To publish, zip these files into an `Evolvix\` folder as
`apps/web/public/downloads/Evolvix-Windows.zip`:
- `Evolvix.exe`
- `Evolvix.exe.config`
- `Microsoft.Web.WebView2.Core.dll`
- `Microsoft.Web.WebView2.WinForms.dll`
- `WebView2Loader.dll`

The server then offers it on the login page and in Settings → Get the app.

The exe is not code-signed (a certificate costs money), so Windows SmartScreen may warn the
first time. Choose **More info → Run anyway**.
