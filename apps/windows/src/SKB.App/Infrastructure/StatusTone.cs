namespace SKB.App.Infrastructure;

/// <summary>Maps a document status to a semantic tone (matches the web app).</summary>
public static class StatusTone
{
    public static string For(string status) => status switch
    {
        "PAID" => "positive",
        "PARTIALLY_PAID" => "warning",
        "RETURNED" => "warning",
        "OVERDUE" => "destructive",
        "PENDING" => "info",
        "CONFIRMED" => "info",
        _ => "neutral",
    };
}
