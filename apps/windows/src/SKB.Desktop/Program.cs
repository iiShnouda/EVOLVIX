using System;
using System.Linq;
using System.Windows.Forms;

namespace SKB.Desktop;

internal static class Program
{
    [STAThread]
    private static void Main(string[] args)
    {
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);

        if (args.Contains("--uninstall", StringComparer.OrdinalIgnoreCase))
        {
            Installer.Uninstall();
            return;
        }

        // Started from the downloaded folder: offer a proper per-user install first
        // (skipped with --portable, to run straight from any folder).
        if (!args.Contains("--portable", StringComparer.OrdinalIgnoreCase) && Installer.OfferInstall()) return;

        Application.Run(new MainForm());
    }
}
