using System;
using System.Drawing;
using System.Globalization;
using Microsoft.Win32;

namespace SKB.Desktop;

/// <summary>
/// Per-user settings in the registry (HKCU\Software\SKB): the company server address and the
/// window position. Nothing business-related is stored on the PC — the server holds all data.
/// </summary>
internal static class AppSettings
{
    public const string DefaultServer = "http://192.168.100.63:8080";
    private const string KeyPath = @"Software\SKB";

    public static string Server
    {
        get => Read("Server") ?? DefaultServer;
        set => Write("Server", value);
    }

    /// <summary>A usable address ("http(s)://host[:port]", path dropped; https:// added if missing), or null.</summary>
    public static string? Normalize(string? input)
    {
        var text = input?.Trim() ?? "";
        if (text.Length == 0) return null;
        if (!text.Contains("://")) text = "https://" + text;
        if (!Uri.TryCreate(text, UriKind.Absolute, out var uri)) return null;
        if (uri.Scheme != Uri.UriSchemeHttps && uri.Scheme != Uri.UriSchemeHttp) return null;
        if (string.IsNullOrEmpty(uri.Host)) return null;
        return $"{uri.Scheme}://{uri.Host.ToLowerInvariant()}{(uri.IsDefaultPort ? "" : ":" + uri.Port)}";
    }

    /// <summary>True when <paramref name="url"/> is a page of the configured server.</summary>
    public static bool IsServerUrl(string url)
    {
        if (!Uri.TryCreate(url, UriKind.Absolute, out var target) || !Uri.TryCreate(Server, UriKind.Absolute, out var server))
            return false;
        return target.Scheme == server.Scheme
               && string.Equals(target.Host, server.Host, StringComparison.OrdinalIgnoreCase)
               && target.Port == server.Port;
    }

    public static Rectangle? WindowBounds
    {
        get
        {
            var raw = Read("Window");
            if (raw is null) return null;
            var parts = raw.Split(',');
            if (parts.Length != 4) return null;
            var n = Array.ConvertAll(parts, p => int.TryParse(p, NumberStyles.Integer, CultureInfo.InvariantCulture, out var v) ? v : -1);
            return n[2] > 200 && n[3] > 200 ? new Rectangle(n[0], n[1], n[2], n[3]) : null;
        }
        set => Write("Window", value is Rectangle r
            ? string.Join(",", r.X.ToString(CultureInfo.InvariantCulture), r.Y.ToString(CultureInfo.InvariantCulture),
                r.Width.ToString(CultureInfo.InvariantCulture), r.Height.ToString(CultureInfo.InvariantCulture))
            : null);
    }

    public static bool Maximized
    {
        get => Read("Maximized") == "1";
        set => Write("Maximized", value ? "1" : "0");
    }

    private static string? Read(string name)
    {
        using var key = Registry.CurrentUser.OpenSubKey(KeyPath);
        return key?.GetValue(name) as string;
    }

    private static void Write(string name, string? value)
    {
        using var key = Registry.CurrentUser.CreateSubKey(KeyPath);
        if (value is null) key.DeleteValue(name, throwOnMissingValue: false);
        else key.SetValue(name, value);
    }
}
