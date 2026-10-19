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
        _http.Timeout = TimeSpan.FromMinutes(10); // a photo on a small server can take minutes
    }

    public bool Enabled => _config.GetValue("Assistant:Enabled", true);
    private string Endpoint => (_config["Assistant:Endpoint"] ?? "http://127.0.0.1:11434").TrimEnd('/');
    public string ChatModel => _config["Assistant:Model"] ?? "qwen2.5:7b-instruct";
    public string VisionModel => _config["Assistant:VisionModel"] ?? "qwen2.5vl:7b";

    /// <summary>The offline speech-to-text service (Whisper) on the server, if any.</summary>
    private string? SpeechEndpoint =>
        _config["Assistant:SpeechEndpoint"] is { Length: > 0 } s ? s.TrimEnd('/') : null;

    /// <summary>The offline voice (Piper) that reads answers aloud on the server, if any.</summary>
    private string? VoiceEndpoint =>
        _config["Assistant:VoiceEndpoint"] is { Length: > 0 } s ? s.TrimEnd('/') : null;

    public sealed record Status(bool Enabled, bool Reachable, bool ChatReady, bool VisionReady);

    /// <summary>The languages the server's voice speaks now ("ar", "en") and the memory it uses.</summary>
    public sealed record VoiceStatus(string[] Languages, long MemoryBytes, long DiskBytes);

    public async Task<VoiceStatus> VoiceStatusAsync(CancellationToken ct = default)
    {
        if (!Enabled || VoiceEndpoint is null) return new(Array.Empty<string>(), 0, 0);
        try
        {
            using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
            cts.CancelAfter(TimeSpan.FromSeconds(3));
            var health = await _http.GetFromJsonAsync<JsonObject>($"{VoiceEndpoint}/health", cts.Token);
            var languages = new[] { "ar", "en" }
                .Where(l => health?[l] is JsonValue v && v.TryGetValue<bool>(out var on) && on).ToArray();
            var memory = health?["memoryBytes"] is JsonValue m && m.TryGetValue<long>(out var bytes) ? bytes : 0;
            var disk = health?["diskBytes"] is JsonValue d && d.TryGetValue<long>(out var db) ? db : 0;
            return new(languages, memory, disk);
        }
        catch (Exception e) when (e is HttpRequestException or TaskCanceledException or JsonException or InvalidOperationException)
        {
            return new(Array.Empty<string>(), 0, 0);
        }
    }

    /// <summary>
    /// An answer read aloud by the server's own voice, as a WAV recording; the text goes nowhere else
    /// and isn't kept.
    /// </summary>
    public async Task<byte[]> SpeakAsync(string text, string language, CancellationToken ct)
    {
        if (!Enabled || VoiceEndpoint is null) throw new AssistantUnavailableException("No voice service.");
        var body = new JsonObject { ["text"] = text, ["language"] = language };
        using var res = await _http.PostAsync($"{VoiceEndpoint}/speak",
            new StringContent(body.ToJsonString(), System.Text.Encoding.UTF8, "application/json"), ct);
        if (!res.IsSuccessStatusCode) throw new AssistantUnavailableException($"Voice service: {(int)res.StatusCode}");
        return await res.Content.ReadAsByteArrayAsync(ct);
    }

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
    /// What was said in a recording, read on the company's own server in the app's language ("ar" or
    /// "en"; found by the service when not given): the recording goes nowhere else and isn't kept.
    /// </summary>
    public async Task<string> TranscribeAsync(byte[] audio, string? contentType, string? language, CancellationToken ct)
    {
        if (!Enabled || SpeechEndpoint is null) throw new AssistantUnavailableException("No speech service.");
        using var form = new MultipartFormDataContent();
        var file = new ByteArrayContent(audio);
        file.Headers.ContentType = System.Net.Http.Headers.MediaTypeHeaderValue.TryParse(contentType, out var type)
            ? type
            : new System.Net.Http.Headers.MediaTypeHeaderValue("application/octet-stream");
        form.Add(file, "audio_file", "speech");
        var lang = language is "ar" or "en" ? $"&language={language}" : "";
        using var res = await _http.PostAsync(
            $"{SpeechEndpoint}/asr?task=transcribe&output=json&encode=true&vad_filter=true{lang}", form, ct);
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
        "You are the assistant inside Evolvix, a wholesale accounting program. Answer briefly and exactly. " +
        "Use the tools for any figure, name or document; never guess numbers. Amounts from tools are already " +
        "formatted. If a tool says the person may not see something, say so politely. You can read but not " +
        "change anything: for changes, tell the person which screen to use. Never talk about the server, its " +
        "files, settings, passwords or how the program is built.";

    /// <summary>
    /// The answer's language is the app's (owner, 2026-10-11: "it should talk in the app's language"),
    /// whatever the question, the earlier answers or the tools' results are written in.
    /// </summary>
    private static string LanguageRule(string language) => language == "ar"
        ? " Always answer in formal Arabic, even when the question, the conversation or the tools' results are " +
          "in English; keep names, codes and numbers exactly as given. أجب دائماً باللغة العربية الفصحى."
        : " Always answer in English, even when the question or the conversation is in Arabic; keep names, " +
          "codes and numbers exactly as given (names may be in Arabic).";

    private const string SpokenRule =
        " The person is talking with you by voice and hears your answer read aloud: answer the way a person " +
        "speaks, in one to three short sentences, with no lists, tables, symbols, emojis or formatting, and " +
        "say amounts rounded to whole units with the currency's name.";

    public sealed record Turn(string Role, string Content);

    /// <summary>
    /// One answer to the person's question, given the conversation so far, in <paramref name="language"/>
    /// ("ar" or "en"); <paramref name="spoken"/>: short and plain, to be read aloud in a voice conversation.
    /// </summary>
    public async Task<string> AskAsync(ClaimsPrincipal user, IReadOnlyList<Turn> history, string question,
        AssistantTools tools, string language, bool spoken, CancellationToken ct = default)
    {
        var system = Instructions + LanguageRule(language) + (spoken ? SpokenRule : "") +
                     $" Today is {CompanyClock.Today:yyyy-MM-dd}.";
        var messages = new JsonArray { Msg("system", system) };
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
            if (calls is null || calls.Count == 0)
                return await InLanguageAsync(message["content"]?.GetValue<string>()?.Trim() ?? "", language, ct);
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

    private static readonly Dictionary<string, (string Ar, string En)> CurrencyNames = new()
    {
        ["EGP"] = ("جنيه", "pounds"), ["USD"] = ("دولار", "dollars"), ["EUR"] = ("يورو", "euros"),
        ["GBP"] = ("جنيه إسترليني", "pounds sterling"), ["SAR"] = ("ريال", "riyals"), ["AED"] = ("درهم", "dirhams"),
        ["KWD"] = ("دينار", "dinars"), ["QAR"] = ("ريال", "riyals"), ["OMR"] = ("ريال", "riyals"),
        ["BHD"] = ("دينار", "dinars"), ["JOD"] = ("دينار", "dinars"), ["IQD"] = ("دينار", "dinars"),
        ["LYD"] = ("دينار", "dinars"), ["TND"] = ("دينار", "dinars"), ["MAD"] = ("درهم", "dirhams"),
    };

    /// <summary>
    /// An answer made ready to be read aloud: no formatting marks or symbols, figures written the way
    /// the voice reads them (1,250.00 → 1250) and currency codes as words (EGP → جنيه).
    /// </summary>
    public static string SpokenText(string text, string language)
    {
        var sb = new System.Text.StringBuilder(text.Length);
        foreach (var ch in text)
        {
            if (ch is >= '٠' and <= '٩') sb.Append((char)('0' + (ch - '٠')));
            else if (ch is >= '۰' and <= '۹') sb.Append((char)('0' + (ch - '۰')));
            else if (ch == '٫') sb.Append('.');
            else if (ch == '٬') sb.Append(',');
            else sb.Append(ch);
        }
        var s = sb.ToString();
        var lines = s.Split('\n')
            .Select(l => System.Text.RegularExpressions.Regex.Replace(l.Trim(), @"^(#{1,6}\s*|[-*•·]\s+|>\s*)", ""))
            .Select(l => l.Replace("|", "، ").Trim(' ', '،'))
            .Where(l => l.Length > 0 && !System.Text.RegularExpressions.Regex.IsMatch(l, @"^[-:،\s]+$"))
            .Select(l => ".!?؟:;،,".Contains(l[^1]) ? l : l + ".");
        s = string.Join(" ", lines);
        s = s.Replace("**", "").Replace("__", "").Replace("`", "");
        s = System.Text.RegularExpressions.Regex.Replace(s, @"(?<=\d),(?=\d{3}(\D|$))", "");
        s = System.Text.RegularExpressions.Regex.Replace(s, @"(?<=\d)\.0{1,2}(?!\d)", "");
        foreach (var (code, name) in CurrencyNames)
            s = System.Text.RegularExpressions.Regex.Replace(s, $@"\b{code}\b", language == "ar" ? name.Ar : name.En);
        if (language == "ar")
            s = s.Replace("ج.م.", "جنيه.").Replace("ج.م", "جنيه").Replace("ر.س", "ريال").Replace("د.إ", "درهم");
        // Emojis and other symbols aren't read.
        s = new string(s.Where(c => char.GetUnicodeCategory(c) is not (UnicodeCategory.OtherSymbol
            or UnicodeCategory.Surrogate or UnicodeCategory.PrivateUse or UnicodeCategory.ModifierSymbol)).ToArray());
        s = System.Text.RegularExpressions.Regex.Replace(s, @"\s+", " ");
        s = System.Text.RegularExpressions.Regex.Replace(s, @"\s+(?=[.,!?؟،:;])", "").Trim();
        if (!s.Any(char.IsLetterOrDigit)) return "";
        return s.Length > 1500 ? s[..1500] : s;
    }

    /// <summary>
    /// A small model sometimes answers in the language of the tools' results (English) despite the rule:
    /// such an answer is written again in the app's language, names and figures kept as they are.
    /// </summary>
    private async Task<string> InLanguageAsync(string answer, string language, CancellationToken ct)
    {
        if (answer.Length == 0 || !WrongLanguage(answer, language)) return answer;
        var body = new JsonObject
        {
            ["model"] = ChatModel,
            ["stream"] = false,
            ["options"] = new JsonObject { ["temperature"] = 0.1 },
            ["messages"] = new JsonArray
            {
                Msg("system", language == "ar"
                    ? "Rewrite the text you are given in formal Arabic. Keep every name, code, number and amount " +
                      "exactly as written. Reply with the rewritten text only. أعد كتابة النص بالعربية الفصحى."
                    : "Rewrite the text you are given in English. Keep every name, code, number and amount " +
                      "exactly as written. Reply with the rewritten text only."),
                Msg("user", answer),
            },
        };
        try
        {
            var reply = await PostAsync("/api/chat", body, ct);
            var text = reply["message"]?["content"]?.GetValue<string>()?.Trim() ?? "";
            return text.Length > 0 && !WrongLanguage(text, language) ? text : answer;
        }
        catch (Exception e) when (e is HttpRequestException or AssistantUnavailableException)
        {
            return answer;
        }
    }

    /// <summary>
    /// Whether a text is mostly in the other language: counted on letters, so names, codes and numbers
    /// written in the other script don't count against an answer that is otherwise right.
    /// </summary>
    public static bool WrongLanguage(string text, string language)
    {
        int arabic = 0, latin = 0;
        foreach (var ch in text)
        {
            if (ch is >= '\u0621' and <= '\u064A' or >= '\u0671' and <= '\u06D3') arabic++;
            else if (ch is >= 'a' and <= 'z' or >= 'A' and <= 'Z') latin++;
        }
        var total = arabic + latin;
        if (total < 12) return false;
        return language == "ar" ? arabic < total * 0.35 : arabic > total * 0.75;
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
        {
            // Its own reason (e.g. not enough memory) goes to the server log, not to the screen.
            var why = await res.Content.ReadAsStringAsync(ct);
            throw new AssistantUnavailableException(
                $"Model server answered {(int)res.StatusCode}: {why[..Math.Min(300, why.Length)]}");
        }
        return await res.Content.ReadFromJsonAsync<JsonObject>(cancellationToken: ct) ?? new JsonObject();
    }

    // ------------------------------------------------------------------ reading photos

    /// <summary>One printed line: its name (often left blank), the factory's model number, and figures.</summary>
    public sealed record PurchaseLine(string Name, string? Model, decimal Quantity, decimal UnitPrice, decimal Discount);
    /// <summary>The invoice; <c>Discount</c> is one amount off the whole invoice (the "خصم" under the total).</summary>
    public sealed record PurchaseScan(string? SupplierName, string? Number, string? Date, decimal Discount, List<PurchaseLine> Lines);
    public sealed record ChequeScan(string? Serial, decimal Amount, string? DueDate, string? Bank, string? Drawer);

    // The owner's suppliers write invoices by hand (owner, 2026-10-19): the factory's name at the
    // top, a table of model number (رقم الموديل), item (often blank), price (السعر), count (عدد) and
    // line total (الإجمالي), then the total, a discount (خصم) and what is due; figures in
    // Arabic-Indic digits.
    private const string PurchasePrompt =
        "This is a supplier's invoice, often handwritten in Arabic. Reply with JSON only: " +
        "{\"supplierName\": string|null, \"number\": string|null, \"date\": \"YYYY-MM-DD\"|null, " +
        "\"discount\": number, \"lines\": [{\"model\": string|null, \"name\": string|null, " +
        "\"quantity\": number, \"unitPrice\": number, \"total\": number}]}. " +
        "supplierName: the shop or factory name printed at the top (e.g. after the word مصنع). " +
        "Each table row is one line: model is the model number column (رقم الموديل), name is the item " +
        "column (الصنف) or null when it is blank, unitPrice the price column (السعر), quantity the count " +
        "column (عدد), total the row's total column (الإجمالي). Read Arabic-Indic digits " +
        "(٠١٢٣٤٥٦٧٨٩) as numbers. Do not make lines from the total, discount or due rows under the table. " +
        "discount: the amount written next to خصم under the table, else 0. Use 0 for anything unreadable.";

    private const string ChequePrompt =
        "Read the cheque(s) in this photo. Reply with JSON only: {\"cheques\": [{\"serial\": string|null, " +
        "\"amount\": number, \"dueDate\": \"YYYY-MM-DD\"|null, \"bank\": string|null, \"drawer\": string|null}]}. " +
        "One entry per cheque; amount as a number; the due date as printed on the cheque.";

    public async Task<PurchaseScan> ReadPurchaseAsync(byte[] image, CancellationToken ct = default)
    {
        var json = await VisionAsync(PurchasePrompt, image, ct);
        var lines = new List<PurchaseLine>();
        // The model doesn't always keep to the shape asked (a line as plain text, a list under another
        // name): what can't be read is skipped rather than failing the whole photo.
        var rows = Field(json, "lines", "items") as JsonArray ?? new JsonArray();
        // The count most lines share (a wholesale invoice is often a dozen of each).
        var usual = rows.OfType<JsonObject>().Select(o => Num(Field(o, "quantity", "qty", "count")))
            .Where(q => q > 0).GroupBy(q => q).OrderByDescending(g => g.Count()).Select(g => g.Key).FirstOrDefault();
        foreach (var l in rows)
        {
            if (l is JsonValue && Str(l) is { } text)
            {
                lines.Add(new PurchaseLine(text, null, 1, 0, 0));
                continue;
            }
            if (l is not JsonObject o) continue;
            var name = Str(Field(o, "name", "item", "description"))?.Trim() ?? "";
            var model = Str(Field(o, "model", "modelNumber", "code"))?.Trim();
            if (model is not null) model = Digits(model);
            if (name.Length == 0 && string.IsNullOrEmpty(model)) continue;
            var (qty, price) = Checked(Math.Max(0, Num(Field(o, "quantity", "qty", "count"))),
                Math.Max(0, Num(Field(o, "unitPrice", "price"))), Math.Max(0, Num(o["total"])), usual);
            lines.Add(new PurchaseLine(name[..Math.Min(200, name.Length)], string.IsNullOrEmpty(model) ? null : model[..Math.Min(60, model.Length)],
                qty, price, Math.Max(0, Num(o["discount"]))));
        }
        return new PurchaseScan(Str(json["supplierName"]), Str(json["number"]), Day(Str(json["date"])),
            Math.Max(0, Num(json["discount"])), lines.Take(300).ToList());
    }

    /// <summary>
    /// A line's count and price, checked against its total (owner, 2026-10-19: handwritten digits are
    /// easy to misread): when they don't multiply to it, the one that divides it evenly is trusted.
    /// </summary>
    private static (decimal Qty, decimal Price) Checked(decimal qty, decimal price, decimal total, decimal usual)
    {
        if (total <= 0 || Math.Abs(qty * price - total) < 0.01m) return (qty, price);
        // Either could be the misread one: the invoice's usual count settles it when it fits.
        if (usual > 0 && price > 0 && total / price == usual) return (usual, price);
        if (qty > 0 && total % qty == 0) return (qty, total / qty);
        if (price > 0 && total % price == 0) return (total / price, price);
        return (qty, price);
    }

    /// <summary>Arabic-Indic digits as Western ones ("٢٥٥" → "255"); other characters kept.</summary>
    private static string Digits(string s)
    {
        var sb = new System.Text.StringBuilder(s.Length);
        foreach (var ch in s)
            sb.Append(ch is >= '٠' and <= '٩' ? (char)('0' + (ch - '٠'))
                : ch is >= '۰' and <= '۹' ? (char)('0' + (ch - '۰')) : ch);
        return sb.ToString().Trim();
    }

    public async Task<List<ChequeScan>> ReadChequesAsync(byte[] image, CancellationToken ct = default)
    {
        var json = await VisionAsync(ChequePrompt, image, ct);
        return (json["cheques"] as JsonArray ?? new JsonArray())
            .OfType<JsonObject>()
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
            // Room for the photo and a long invoice's answer: with the model server's small default
            // window the answer of an 11-line invoice was cut off half way (owner, 2026-10-19).
            ["options"] = new JsonObject { ["temperature"] = 0, ["num_ctx"] = 8192, ["num_predict"] = 4096 },
            ["messages"] = new JsonArray
            {
                new JsonObject
                {
                    ["role"] = "user", ["content"] = prompt,
                    ["images"] = new JsonArray { Convert.ToBase64String(image) },
                },
            },
        };
        var started = System.Diagnostics.Stopwatch.StartNew();
        var reply = await PostAsync("/api/chat", body, ct);
        var text = reply["message"]?["content"] is JsonValue v && v.TryGetValue<string>(out var c) ? c : "{}";
        var json = ParseObject(text)
            ?? (text.IndexOf('{') is var start and >= 0 && text.LastIndexOf('}') is var end && end > start
                ? ParseObject(text[start..(end + 1)])
                : null)
            ?? Salvage(text);
        // What the model answered, for the server log when a photo reads badly (no figures shown on screen).
        _log.LogInformation("Photo read in {Seconds:0}s ({Bytes} bytes): {Answer}", started.Elapsed.TotalSeconds,
            image.Length, text.Length > 2000 ? text[..2000] + "…" : text);
        return json;
    }

    /// <summary>
    /// An answer cut off before its end: the lines that did come through whole, each <c>{…}</c> on
    /// its own, and the invoice's own fields where they can be found.
    /// </summary>
    private static JsonObject Salvage(string text)
    {
        var lines = new JsonArray();
        var top = new JsonObject();
        foreach (System.Text.RegularExpressions.Match m in
                 System.Text.RegularExpressions.Regex.Matches(text, @"\{[^{}\[\]]*\}"))
            if (ParseObject(m.Value) is { } o)
                lines.Add(o);
        foreach (var key in new[] { "supplierName", "number", "date", "discount" })
        {
            var m = System.Text.RegularExpressions.Regex.Match(text, $"\"{key}\"\\s*:\\s*(\"[^\"]*\"|[0-9.]+)");
            if (!m.Success) continue;
            try
            {
                top[key] = JsonNode.Parse(m.Groups[1].Value);
            }
            catch (JsonException)
            {
                // left out
            }
        }
        top["lines"] = lines;
        return top;
    }

    /// <summary>The model's answer as a JSON object, or null when it isn't one.</summary>
    private static JsonObject? ParseObject(string text)
    {
        try
        {
            return JsonNode.Parse(text) as JsonObject;
        }
        catch (JsonException)
        {
            return null;
        }
    }

    /// <summary>The first of these names the object has (the model sometimes words a field its own way).</summary>
    private static JsonNode? Field(JsonObject o, params string[] names)
    {
        foreach (var n in names)
            if (o[n] is { } v) return v;
        return null;
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
        if (n is not JsonValue) return 0;
        if (n.GetValueKind() == JsonValueKind.Number)
            return n.AsValue().TryGetValue<decimal>(out var d0) ? d0 : 0;
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
