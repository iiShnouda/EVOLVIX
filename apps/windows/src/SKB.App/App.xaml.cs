using System.IO;
using System.Text.Json;
using System.Windows;
using SKB.App.Services;
using SKB.App.Views;
using SKB.Core.Api;

namespace SKB.App;

public partial class App : Application
{
    // Simple, explicit composition root (keeps the app free of any DI package).
    public static SessionState Session { get; private set; } = new();
    public static ApiClient Api { get; private set; } = null!;
    public static Localizer Loc { get; private set; } = new();
    public static ThemeManager Theme { get; private set; } = new();
    public static ConnectionMonitor Connection { get; private set; } = null!;

    protected override void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);

        var apiUrl = ReadApiUrl();
        Api = new ApiClient(apiUrl, Session);
        Connection = new ConnectionMonitor(Api);

        // Make the localizer available to XAML: {Binding [key], Source={StaticResource Loc}}.
        Resources["Loc"] = Loc;

        Theme.Apply();
        Connection.Start();

        var login = new LoginWindow();
        login.Show();
    }

    private static string ReadApiUrl()
    {
        try
        {
            var path = Path.Combine(AppContext.BaseDirectory, "appsettings.json");
            if (File.Exists(path))
            {
                using var doc = JsonDocument.Parse(File.ReadAllText(path));
                if (doc.RootElement.TryGetProperty("ApiUrl", out var url))
                    return url.GetString() ?? "http://localhost:3000";
            }
        }
        catch
        {
            // fall through to default
        }
        return "http://localhost:3000";
    }

    /// <summary>Swap the main window to the shell after a successful sign-in.</summary>
    public static void ShowShell()
    {
        var shell = new ShellWindow();
        Current.MainWindow = shell;
        shell.Show();
        foreach (Window w in Current.Windows)
        {
            if (w is LoginWindow) w.Close();
        }
    }

    /// <summary>Return to the login window after sign-out.</summary>
    public static void ShowLogin()
    {
        var login = new LoginWindow();
        login.Show();
        foreach (Window w in Current.Windows)
        {
            if (w is ShellWindow) w.Close();
        }
    }
}
