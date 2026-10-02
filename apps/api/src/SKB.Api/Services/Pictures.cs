namespace SKB.Api.Services;

/// <summary>Photos people keep in the app (ID cards, cheques): only real JPEG, PNG or WebP files.</summary>
public static class Pictures
{
    /// <summary>The photo's type from its first bytes (never from its name or the browser's word), or null.</summary>
    public static string? TypeOf(byte[] data) =>
        data.Length > 12 && data[0] == 0xFF && data[1] == 0xD8 && data[2] == 0xFF ? "image/jpeg"
        : data.Length > 12 && data[0] == 0x89 && data[1] == 0x50 && data[2] == 0x4E && data[3] == 0x47 ? "image/png"
        : data.Length > 12 && data[0] == 'R' && data[1] == 'I' && data[2] == 'F' && data[3] == 'F'
          && data[8] == 'W' && data[9] == 'E' && data[10] == 'B' && data[11] == 'P' ? "image/webp"
        : null;
}
