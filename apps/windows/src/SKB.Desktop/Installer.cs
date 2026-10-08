using System;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Windows.Forms;
using Microsoft.Win32;

namespace SKB.Desktop;

/// <summary>
/// Per-user install without admin rights, the way modern apps do it: copies the app to
/// %LOCALAPPDATA%\Programs\Evolvix, adds Start-menu and desktop shortcuts, and registers an uninstall
/// entry in Windows Settings › Apps (which runs "Evolvix.exe --uninstall").
/// </summary>
internal static class Installer
{
    // The app's name everywhere people see it (owner, 2026-10-08): the program folder, the exe, the
    // shortcuts and the entry in Settings › Apps. Its settings (HKCU\Software\SKB) and browser
    // profile (%LOCALAPPDATA%\SKB) keep the old name, so an update keeps the server and the sign-in.
    public const string Name = "Evolvix";
    private const string UninstallKey = @"Software\Microsoft\Windows\CurrentVersion\Uninstall\Evolvix";
    private const string OldUninstallKey = @"Software\Microsoft\Windows\CurrentVersion\Uninstall\SKB";

    public static string InstallDir =>
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", Name);

    /// <summary>Where copies before the rename were installed.</summary>
    private static string OldInstallDir =>
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", "SKB");

    private static string StartMenuLink =>
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), Name + ".lnk");

    private static string DesktopLink =>
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), Name + ".lnk");

    /// <summary>Shortcuts made before the rename.</summary>
    private static string[] OldLinks => new[]
    {
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), "SKB.lnk"),
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), "SKB.lnk"),
    };

    private static string RunningDir => Path.GetDirectoryName(Application.ExecutablePath)!;

    public static bool IsInstalledCopy =>
        string.Equals(Path.GetFullPath(RunningDir).TrimEnd('\\'), Path.GetFullPath(InstallDir).TrimEnd('\\'),
            StringComparison.OrdinalIgnoreCase);

    /// <summary>
    /// Run from a download folder: offer to install (or update an installed copy) and start the
    /// installed copy. Returns true when this process should exit.
    /// </summary>
    public static bool OfferInstall()
    {
        if (IsInstalledCopy) return false;
        var answer = MessageBox.Show(Text.InstallAsk, Name, MessageBoxButtons.YesNo, MessageBoxIcon.Question,
            MessageBoxDefaultButton.Button1, Text.Arabic ? MessageBoxOptions.RtlReading | MessageBoxOptions.RightAlign : 0);
        if (answer != DialogResult.Yes) return false;

        Directory.CreateDirectory(InstallDir);
        foreach (var file in Directory.GetFiles(RunningDir, "*", SearchOption.AllDirectories))
        {
            var relative = file.Substring(RunningDir.Length).TrimStart('\\');
            if (relative.EndsWith(".pdb", StringComparison.OrdinalIgnoreCase)) continue;
            var target = Path.Combine(InstallDir, relative);
            Directory.CreateDirectory(Path.GetDirectoryName(target)!);
            File.Copy(file, target, overwrite: true);
        }

        var exe = Path.Combine(InstallDir, Name + ".exe");
        foreach (var link in OldLinks.Where(File.Exists)) File.Delete(link);
        RemoveOldInstall();
        CreateShortcut(StartMenuLink, exe);
        CreateShortcut(DesktopLink, exe);

        using (var key = Registry.CurrentUser.CreateSubKey(UninstallKey))
        {
            key.SetValue("DisplayName", Name);
            key.SetValue("DisplayIcon", exe);
            key.SetValue("Publisher", Name);
            key.SetValue("DisplayVersion", Application.ProductVersion);
            key.SetValue("InstallLocation", InstallDir);
            key.SetValue("UninstallString", $"\"{exe}\" --uninstall");
            key.SetValue("NoModify", 1);
            key.SetValue("NoRepair", 1);
        }

        Process.Start(new ProcessStartInfo(exe) { UseShellExecute = true });
        return true;
    }

    /// <summary>Remove shortcuts, the uninstall entry, settings, and (after exit) the program folder.</summary>
    public static void Uninstall()
    {
        foreach (var link in new[] { StartMenuLink, DesktopLink }.Concat(OldLinks).Where(File.Exists)) File.Delete(link);
        Registry.CurrentUser.DeleteSubKeyTree(UninstallKey, throwOnMissingSubKey: false);
        Registry.CurrentUser.DeleteSubKeyTree(@"Software\SKB", throwOnMissingSubKey: false);
        RemoveOldInstall();

        // The browser profile (sign-in cookie) goes too.
        var data = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "SKB");
        var cmd = $"/c timeout /t 2 /nobreak >nul & rmdir /s /q \"{InstallDir}\" & rmdir /s /q \"{data}\"";
        Process.Start(new ProcessStartInfo("cmd.exe", cmd) { CreateNoWindow = true, UseShellExecute = false });
        MessageBox.Show(Text.UninstallDone, Name);
    }

    /// <summary>A copy installed before the rename: its uninstall entry and program folder go.</summary>
    private static void RemoveOldInstall()
    {
        Registry.CurrentUser.DeleteSubKeyTree(OldUninstallKey, throwOnMissingSubKey: false);
        try
        {
            if (Directory.Exists(OldInstallDir)) Directory.Delete(OldInstallDir, recursive: true);
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException)
        {
            // Still open: it is left for the next update.
        }
    }

    private static void CreateShortcut(string linkPath, string target)
    {
        var shellType = Type.GetTypeFromProgID("WScript.Shell");
        if (shellType is null) return;
        dynamic shell = Activator.CreateInstance(shellType)!;
        dynamic link = shell.CreateShortcut(linkPath);
        link.TargetPath = target;
        link.WorkingDirectory = Path.GetDirectoryName(target);
        link.IconLocation = target + ",0";
        link.Description = Name;
        link.Save();
    }
}
