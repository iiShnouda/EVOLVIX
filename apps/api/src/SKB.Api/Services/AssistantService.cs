using System.Globalization;
using System.Net.Http.Json;
using System.Security.Claims;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
using SKB.Api.Data;
using SKB.Api.Domain;

namespace SKB.Api.Services;

/// <summary>
/// The company's own assistant (owner, 2026-10-06: "an AI model installed offline on the server"): a
/// local model run by Ollama on the server itself (<c>Assistant:Endpoint</c>, by default
/// http://127.0.0.1:11434), so nothing leaves the company. It
/// <list type="bullet">
/// <item>answers questions through fixed, read-only tools that look things up the way the app does,
/// each only when the person holds that permission and only in their branches and warehouses;</item>
/// <item>reads a photo of a supplier's invoice or of cheques into a draft that the person checks and
/// saves on the usual screen (the photo itself is not kept).</item>
/// </list>
/// It never runs commands, reads files or reaches anything but the database through those tools.
/// </summary>
public sealed class AssistantService
{
    private readonly HttpClient _http;
    private readonly IConfiguration _config;
    private readonly ILogger<AssistantService> _log;

    public AssistantService(HttpClient http, IConfiguration config, ILogger<AssistantService> log)
    {
        _http = http;
        _config = config;
        _log = log;
        _http.Timeout = TimeSpan.FromMinutes(4);
    }

    public bool Enabled => _config.GetValue("Assistant:Enabled", true);
    private string Endpoint => (_config["Assistant:Endpoint"] ?? "http://127.0.0.1:11434").TrimEnd('/');
    public string ChatModel => _config["Assistant:Model"] ?? "qwen2.5:7b-instruct";
    public string VisionModel => _config["Assistant:VisionModel"] ?? "qwen2.5vl:7b";

    /// <summary>The offline speech-to-text service (Whisper) on the server, if any.</summary>
    private string? SpeechEndpoint =>
        _config["Assistant:SpeechEndpoint"] is { Length: > 0 } s ? s.TrimEnd('/') : null;

    public sealed record Status(bool Enabled, bool Reachable, bool ChatReady, bool VisionReady);

    /// <summary>Whether the speech service answers (a quick look, so the page isn't held up).</summary>
    public async Task<bool> SpeechReadyAsync(CancellationToken ct = default)
    {
        if (!Enabled || SpeechEndpoint is null) return false;
        try
        {
            using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
            cts.CancelAfter(TimeSpan.FromSeconds(3));
            using var res = await _http.GetAsync($"{SpeechEndpoint}/docs", cts.Token);
            return res.IsSuccessStatusCode;
        }
        catch (Exception e) when (e is HttpRequestException or TaskCanceledException)
        {
            return false;
        }
    }

    /// <summary>
    /// What was said in a recording (Arabic or English, found by the service), read on the company's
    /// own server: the recording goes nowhere else and isn't kept.
    /// </summary>
    public async Task<string> TranscribeAsync(byte[] audio, string? contentType, CancellationToken ct)
    {
        if (!Enabled || SpeechEndpoint is null) throw new AssistantUnavailableException("No speech service.");
        using var form = new MultipartFormDataContent();
        var file = new ByteArrayContent(audio);
        file.Headers.ContentType = System.Net.Http.Headers.MediaTypeHeaderValue.TryParse(contentType, out var type)
            ? type
            : new System.Net.Http.Headers.MediaTypeHeaderValue("application/octet-stream");
        form.Add(file, "audio_file", "speech");
        using var res = await _http.PostAsync($"{SpeechEndpoint}/asr?task=transcribe&output=json&encode=true&vad_filter=true", form, ct);
        if (!res.IsSuccessStatusCode) throw new AssistantUnavailableException($"Speech service: {(int)res.StatusCode}");
        var json = await res.Content.ReadFromJsonAsync<JsonObject>(cancellationToken: ct);
        return (json?["text"]?.GetValue<string>() ?? "").Trim();
    }

    /// <summary>Whether the model server answers and has the two models.</summary>
    public async Task<Status> StatusAsync(CancellationToken ct = default)
    {
        if (!Enabled) return new(false, false, false, false);
        try
        {
            using var res = await _http.GetAsync($"{Endpoint}/api/tags", ct);
            if (!res.IsSuccessStatusCode) return new(true, false, false, false);
            var tags = await res.Content.ReadFromJsonAsync<JsonObject>(cancellationToken: ct);
            var names = tags?["models"]?.AsArray().Select(m => m?["name"]?.GetValue<string>() ?? "").ToList() ?? new();
            bool Has(string model) => names.Any(n => n == model || n == model + ":latest" || n.StartsWith(model + ":"));
            return new(true, true, Has(ChatModel), Has(VisionModel));
        }
        catch (Exception e) when (e is HttpRequestException or TaskCanceledException)
        {
            return new(true, false, false, false);
        }
    }

    // ------------------------------------------------------------------ chat

    private const string Instructions =
        "You are the assistant inside Evolvix, a wholesale accounting program. Answer in the language the " +
        "person writes in (formal business Arabic or English), briefly and exactly. Use the tools for any " +
        "figure, name or document; never guess numbers. Amounts from tools are already formatted. If a tool " +
        "says the person may not see something, say so politely. You can read but not change anything: for " +
        "changes, tell the person which screen to use. Never talk about the server, its files, settings, " +
        "passwords or how the program is built.";

    public sealed record Turn(string Role, string Content);

    /// <summary>One answer to the person's question, given the conversation so far.</summary>
    public async Task<string> AskAsync(ClaimsPrincipal user, IReadOnlyList<Turn> history, string question,
        AssistantTools tools, CancellationToken ct = default)
    {
        var messages = new JsonArray { Msg("system", Instructions + $" Today is {CompanyClock.Today:yyyy-MM-dd}.") };
        foreach (var t in history) messages.Add(Msg(t.Role, t.Content));
        messages.Add(Msg("user", question));
        var toolList = tools.Definitions(user);
        for (var round = 0; round < 5; round++)
        {
            var body = new JsonObject
            {
                ["model"] = ChatModel,
                ["messages"] = messages.DeepClone(),
                ["stream"] = false,
                ["options"] = new JsonObject { ["temperature"] = 0.2 },
            };
            if (toolList.Count > 0) body["tools"] = toolList.DeepClone();
            var reply = await PostAsync("/api/chat", body, ct);
            var message = reply["message"] as JsonObject ?? new JsonObject();
            var calls = message["tool_calls"] as JsonArray;
            if (calls is null || calls.Count == 0) return message["content"]?.GetValue<string>()?.Trim() ?? "";
            messages.Add(message.DeepClone());
            foreach (var call in calls)
            {
                var fn = call?["function"];
                var name = fn?["name"]?.GetValue<string>() ?? "";
                var args = fn?["arguments"] as JsonObject ?? ParseArgs(fn?["arguments"]);
                string result;
                try
                {
                    result = await tools.RunAsync(user, name, args, ct);
                }
                catch (Exception e)
                {
                    _log.LogWarning(e, "Assistant tool {Tool} failed", name);
                    result = "The lookup failed.";
                }
                messages.Add(new JsonObject { ["role"] = "tool", ["content"] = result });
            }
        }
        return "";
    }

    private static JsonObject ParseArgs(JsonNode? raw)
    {
        try
        {
            return raw is null ? new JsonObject() : JsonNode.Parse(raw.GetValue<string>()) as JsonObject ?? new JsonObject();
        }
        catch
        {
            return new JsonObject();
        }
    }

    private static JsonObject Msg(string role, string content) => new() { ["role"] = role, ["content"] = content };

    private async Task<JsonObject> PostAsync(string path, JsonObject body, CancellationToken ct)
    {
        using var res = await _http.PostAsync($"{Endpoint}{path}",
            new StringContent(body.ToJsonString(), System.Text.Encoding.UTF8, "application/json"), ct);
        if (!res.IsSuccessStatusCode)
            throw new AssistantUnavailableException($"Model server answered {(int)res.StatusCode}.");
        return await res.Content.ReadFromJsonAsync<JsonObject>(cancellationToken: ct) ?? new JsonObject();
    }

    // ------------------------------------------------------------------ reading photos

    public sealed record PurchaseLine(string Name, decimal Quantity, decimal UnitPrice, decimal Discount);
    public sealed record PurchaseScan(string? SupplierName, string? Number, string? Date, List<PurchaseLine> Lines);
    public sealed record ChequeScan(string? Serial, decimal Amount, string? DueDate, string? Bank, string? Drawer);

    private const string PurchasePrompt =
        "Read this supplier invoice. Reply with JSON only: {\"supplierName\": string|null, \"number\": string|null, " +
        "\"date\": \"YYYY-MM-DD\"|null, \"lines\": [{\"name\": string, \"quantity\": number, \"unitPrice\": number, " +
        "\"discount\": number}]}. One entry per printed line, names exactly as printed, prices per unit before " +
        "discount, discount as an amount per unit (0 if none). Use 0 for anything unreadable.";

    private const string ChequePrompt =
        "Read the cheque(s) in this photo. Reply with JSON only: {\"cheques\": [{\"serial\": string|null, " +
        "\"amount\": number, \"dueDate\": \"YYYY-MM-DD\"|null, \"bank\": string|null, \"drawer\": string|null}]}. " +
        "One entry per cheque; amount as a number; the due date as printed on the cheque.";

    public async Task<PurchaseScan> ReadPurchaseAsync(byte[] image, CancellationToken ct = default)
    {
        var json = await VisionAsync(PurchasePrompt, image, ct);
        var lines = new List<PurchaseLine>();
        foreach (var l in json["lines"] as JsonArray ?? new JsonArray())
        {
            var name = Str(l?["name"]);
            if (string.IsNullOrWhiteSpace(name)) continue;
            lines.Add(new PurchaseLine(name.Trim()[..Math.Min(200, name.Trim().Length)],
                Math.Max(0, Num(l?["quantity"])), Math.Max(0, Num(l?["unitPrice"])), Math.Max(0, Num(l?["discount"]))));
        }
        return new PurchaseScan(Str(json["supplierName"]), Str(json["number"]), Day(Str(json["date"])), lines.Take(300).ToList());
    }

    public async Task<List<ChequeScan>> ReadChequesAsync(byte[] image, CancellationToken ct = default)
    {
        var json = await VisionAsync(ChequePrompt, image, ct);
        return (json["cheques"] as JsonArray ?? new JsonArray())
            .Select(c => new ChequeScan(Str(c?["serial"]), Math.Max(0, Num(c?["amount"])), Day(Str(c?["dueDate"])),
                Str(c?["bank"]), Str(c?["drawer"])))
            .Where(c => c.Amount > 0 || c.Serial is not null).Take(100).ToList();
    }

    private async Task<JsonObject> VisionAsync(string prompt, byte[] image, CancellationToken ct)
    {
        var body = new JsonObject
        {
            ["model"] = VisionModel,
            ["stream"] = false,
            ["format"] = "json",
            ["options"] = new JsonObject { ["temperature"] = 0 },
            ["messages"] = new JsonArray
            {
                new JsonObject
                {
                    ["role"] = "user", ["content"] = prompt,
                    ["images"] = new JsonArray { Convert.ToBase64String(image) },
                },
            },
        };
        var reply = await PostAsync("/api/chat", body, ct);
        var text = reply["message"]?["content"]?.GetValue<string>() ?? "{}";
        try
        {
            return JsonNode.Parse(text) as JsonObject ?? new JsonObject();
        }
        catch (JsonException)
        {
            var start = text.IndexOf('{');
            var end = text.LastIndexOf('}');
            return start >= 0 && end > start
                ? JsonNode.Parse(text[start..(end + 1)]) as JsonObject ?? new JsonObject()
                : new JsonObject();
        }
    }

    private static string? Str(JsonNode? n)
    {
        if (n is null) return null;
        var s = n.GetValueKind() == JsonValueKind.String ? n.GetValue<string>() : n.ToJsonString();
        s = s.Trim();
        return s.Length == 0 || s == "null" ? null : s[..Math.Min(200, s.Length)];
    }

    /// <summary>A number however the model wrote it ("1,250.50", "١٬٢٥٠٫٥", 1250).</summary>
    private static decimal Num(JsonNode? n)
    {
        if (n is null) return 0;
        if (n.GetValueKind() == JsonValueKind.Number) return n.GetValue<decimal>();
        var sb = new System.Text.StringBuilder();
        foreach (var ch in n.ToString())
        {
            if (ch is >= '٠' and <= '٩') sb.Append((char)('0' + (ch - '٠')));
            else if (ch is >= '۰' and <= '۹') sb.Append((char)('0' + (ch - '۰')));
            else if (ch is '٫' or '.') sb.Append('.');
            else if (char.IsAsciiDigit(ch) || ch == '-') sb.Append(ch);
            // thousands separators (, ، ٬) and currency signs are dropped
        }
        return decimal.TryParse(sb.ToString(), NumberStyles.Number, CultureInfo.InvariantCulture, out var d) ? d : 0;
    }

    private static string? Day(string? s) =>
        DateOnly.TryParse(TextKey.Fold(s ?? ""), CultureInfo.InvariantCulture, out var d) ? d.ToString("yyyy-MM-dd") : null;
}

public sealed class AssistantUnavailableException(string message) : Exception(message);

/// <summary>
/// What the assistant may look up, each behind the permission the matching screen needs and scoped
/// like it (branches, warehouses, costs). Read-only; results are short plain text.
/// </summary>
public sealed class AssistantTools
{
    private readonly AppDbContext _db;
    private readonly WarehouseService _warehouses;

    public AssistantTools(AppDbContext db, WarehouseService warehouses)
    {
        _db = db;
        _warehouses = warehouses;
    }

    private sealed record Tool(string Name, string Description, string? Permission, JsonObject Parameters);

    private static JsonObject Params(params (string Name, string Type, string Description)[] p) => new()
    {
        ["type"] = "object",
        ["properties"] = new JsonObject(p.Select(x => KeyValuePair.Create(x.Name,
            (JsonNode?)new JsonObject { ["type"] = x.Type, ["description"] = x.Description }))),
        ["required"] = new JsonArray(p.Take(1).Select(x => (JsonNode?)JsonValue.Create(x.Name)).ToArray()),
    };

    private static readonly Tool[] All =
    {
        new("find_party", "Find customers, suppliers or shipping companies by name, code or phone; gives their balance.",
            Permissions.PartiesView, Params(("query", "string", "name, code or phone"))),
        new("find_item", "Find items by name, code or barcode; gives stock in the person's warehouses and sale price.",
            Permissions.InventoryView, Params(("query", "string", "name, code or barcode"))),
        new("find_invoice", "Look up a sales or purchase invoice by its number.",
            null, Params(("number", "string", "the invoice number, e.g. INV-2026-000012"))),
        new("sales_summary", "Sales, returns and purchases totals between two days (YYYY-MM-DD).",
            Permissions.DashboardView, Params(("from", "string", "first day"), ("to", "string", "last day"))),
        new("low_stock", "Items at or below their reorder level in the person's warehouses.",
            Permissions.InventoryView, Params(("limit", "integer", "how many, default 20"))),
    };

    private static bool Has(ClaimsPrincipal u, string? p) => p is null || u.HasClaim("permission", p);

    /// <summary>The tools this person may use, in the model server's format.</summary>
    public JsonArray Definitions(ClaimsPrincipal user) => new(All.Where(t => Has(user, t.Permission) &&
            (t.Name != "find_invoice" || Has(user, Permissions.SalesView) || Has(user, Permissions.PurchasesView)))
        .Select(t => (JsonNode?)new JsonObject
        {
            ["type"] = "function",
            ["function"] = new JsonObject
            {
                ["name"] = t.Name, ["description"] = t.Description, ["parameters"] = t.Parameters.DeepClone(),
            },
        }).ToArray());

    public async Task<string> RunAsync(ClaimsPrincipal user, string name, JsonObject args, CancellationToken ct)
    {
        var tool = All.FirstOrDefault(t => t.Name == name);
        if (tool is null) return "No such lookup.";
        if (!Has(user, tool.Permission)) return "The person may not see this.";
        string Arg(string k) => (args[k]?.ToString() ?? "").Trim();
        var currency = await _db.CompanySettings.Select(s => s.Currency).FirstOrDefaultAsync(ct) ?? "EGP";
        string Money(long minor) => $"{minor / 100m:N2} {currency}";

        switch (name)
        {
            case "find_party":
            {
                var words = TextKey.Words(Arg("query"));
                if (words.Length == 0) return "Nothing to look for.";
                var parties = await _db.Parties.AsNoTracking().Where(p => p.IsActive)
                    .Select(p => new { p.Code, p.Name, p.Phone, p.Types, p.Balance }).Take(5000).ToListAsync(ct);
                var hits = parties.Where(p =>
                {
                    var have = TextKey.Words($"{p.Name} {p.Code} {p.Phone}");
                    return words.All(w => TextKey.Match(w, have) >= 0);
                }).Take(8).ToList();
                return hits.Count == 0 ? "No match." : string.Join("\n", hits.Select(p =>
                    $"{p.Code} {p.Name} ({string.Join("/", p.Types)}), phone {p.Phone ?? "-"}, balance " +
                    $"{Money(Math.Abs(p.Balance))} {(p.Balance > 0 ? "owed to the company" : p.Balance < 0 ? "owed by the company" : "settled")}"));
            }
            case "find_item":
            {
                var words = TextKey.Words(Arg("query"));
                if (words.Length == 0) return "Nothing to look for.";
                var q = _db.Products.AsNoTracking().Where(p => p.IsActive);
                if (Access.Departments(user) is { } mine)
                    q = q.Where(p => p.Category!.DepartmentId == null || mine.Contains(p.Category.DepartmentId.Value));
                var items = await q.Select(p => new
                {
                    p.Id, p.Name, p.Sku, p.SearchKey, p.SalePrice,
                    Barcodes = p.Units.Select(u => u.Barcode).ToList(),
                }).Take(20000).ToListAsync(ct);
                var hits = items.Where(p =>
                    {
                        var have = p.SearchKey.Split(' ', StringSplitOptions.RemoveEmptyEntries);
                        return words.All(w => TextKey.Match(w, have) >= 0) || p.Barcodes.Contains(Arg("query"));
                    }).Take(8).ToList();
                if (hits.Count == 0) return "No match.";
                var ids = hits.Select(h => h.Id).ToList();
                var visible = _warehouses.Visible(user).Select(w => w.Id);
                var stock = await _db.StockBalances.AsNoTracking()
                    .Where(b => ids.Contains(b.ProductId) && visible.Contains(b.WarehouseId))
                    .GroupBy(b => b.ProductId).Select(g => new { g.Key, Qty = g.Sum(b => b.Quantity) })
                    .ToDictionaryAsync(x => x.Key, x => x.Qty, ct);
                return string.Join("\n", hits.Select(h =>
                    $"{h.Sku} {h.Name}: in stock {stock.GetValueOrDefault(h.Id)}, sale price {Money(h.SalePrice)}"));
            }
            case "find_invoice":
            {
                var number = Arg("number").ToUpperInvariant();
                if (number.Length == 0) return "Nothing to look for.";
                var types = new List<DocumentType>();
                if (Has(user, Permissions.SalesView)) types.AddRange(new[] { DocumentType.SALES_INVOICE, DocumentType.SALES_RETURN });
                if (Has(user, Permissions.PurchasesView)) types.AddRange(new[] { DocumentType.PURCHASE_INVOICE, DocumentType.PURCHASE_RETURN });
                var docs = await _db.SalesDocuments.AsNoTracking().InBranches(user, d => d.BranchId)
                    .Where(d => types.Contains(d.Type) && d.Number.ToUpper().Contains(number))
                    .OrderByDescending(d => d.IssueDate).Take(5)
                    .Select(d => new { d.Number, d.Type, d.Status, d.IssueDate, Party = d.Party!.Name, d.GrandTotal, d.PaidAmount })
                    .ToListAsync(ct);
                return docs.Count == 0 ? "No match." : string.Join("\n", docs.Select(d =>
                    $"{d.Number} ({d.Type}, {d.Status}) {CompanyClock.DayOf(d.IssueDate):yyyy-MM-dd}, {d.Party}, total " +
                    $"{Money(d.GrandTotal)}, paid {Money(d.PaidAmount)}"));
            }
            case "sales_summary":
            {
                if (!DateOnly.TryParse(Arg("from"), CultureInfo.InvariantCulture, out var from)) from = CompanyClock.Today;
                if (!DateOnly.TryParse(Arg("to"), CultureInfo.InvariantCulture, out var to)) to = from;
                var start = CompanyClock.StartOf(from);
                var end = CompanyClock.StartOf(to.AddDays(1));
                var sums = await _db.SalesDocuments.AsNoTracking().InBranches(user, d => d.BranchId)
                    .Where(d => d.IssueDate >= start && d.IssueDate < end && d.Status != DocumentStatus.CANCELLED
                        && (d.Type == DocumentType.SALES_INVOICE || d.Type == DocumentType.SALES_RETURN || d.Type == DocumentType.PURCHASE_INVOICE))
                    .GroupBy(d => d.Type).Select(g => new { g.Key, Total = g.Sum(d => d.GrandTotal), Count = g.Count() })
                    .ToListAsync(ct);
                long T(DocumentType k) => sums.FirstOrDefault(s => s.Key == k)?.Total ?? 0;
                int C(DocumentType k) => sums.FirstOrDefault(s => s.Key == k)?.Count ?? 0;
                return $"{from:yyyy-MM-dd} to {to:yyyy-MM-dd}: sales {Money(T(DocumentType.SALES_INVOICE))} " +
                       $"({C(DocumentType.SALES_INVOICE)} invoices), returns {Money(T(DocumentType.SALES_RETURN))}, " +
                       (Has(user, Permissions.PurchasesView)
                           ? $"purchases {Money(T(DocumentType.PURCHASE_INVOICE))} ({C(DocumentType.PURCHASE_INVOICE)} invoices)."
                           : "purchases not shown to this person.");
            }
            case "low_stock":
            {
                var limit = int.TryParse(Arg("limit"), out var n) ? Math.Clamp(n, 1, 50) : 20;
                var visible = _warehouses.Visible(user).Select(w => w.Id);
                var rows = await _db.Products.AsNoTracking().Where(p => p.IsActive && p.ReorderLevel > 0)
                    .Select(p => new
                    {
                        p.Sku, p.Name, p.ReorderLevel,
                        Qty = _db.StockBalances.Where(b => b.ProductId == p.Id && visible.Contains(b.WarehouseId)).Sum(b => (int?)b.Quantity) ?? 0,
                    })
                    .Where(x => x.Qty <= x.ReorderLevel).OrderBy(x => x.Qty).Take(limit).ToListAsync(ct);
                return rows.Count == 0 ? "None." : string.Join("\n", rows.Select(r => $"{r.Sku} {r.Name}: {r.Qty} (reorder at {r.ReorderLevel})"));
            }
        }
        return "No such lookup.";
    }
}
