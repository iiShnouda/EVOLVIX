using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SKB.Api.Data;
using SKB.Api.Domain;
using SKB.Api.Models;
using SKB.Api.Services;

namespace SKB.Api.Controllers;

/// <summary>
/// The company's offline assistant (see <see cref="AssistantService"/>): ask it (<c>ai:chat</c>), and
/// read a photo of a supplier invoice or cheques into a draft (<c>ai:scan</c> and the permission of
/// the screen the draft goes to). Each person's conversations stay on the server, theirs alone; they
/// can keep several and delete any (owner, 2026-10-10). Answers come in the app's language, and one
/// can talk with it by voice (owner, 2026-10-11): the server's own speech service (Whisper) reads what
/// was said and its own voice (Piper) reads the answer aloud; recordings and audio aren't kept.
/// </summary>
[ApiController]
[Route("api/assistant")]
[Authorize]
public sealed class AssistantController : ControllerBase
{
    private const int MaxImage = 10 * 1024 * 1024;
    /// <summary>About two minutes of speech.</summary>
    private const int MaxAudio = 8 * 1024 * 1024;
    private const int MaxQuestion = 2000;
    private const int HistoryTurns = 12;
    private readonly AppDbContext _db;
    private readonly AuditService _audit;
    private readonly AssistantService _ai;
    private readonly AssistantTools _tools;
    private readonly ILogger<AssistantController> _log;
    private readonly PhotoJobs _jobs;

    public AssistantController(AppDbContext db, AuditService audit, AssistantService ai, AssistantTools tools,
        ILogger<AssistantController> log, PhotoJobs jobs)
    {
        _log = log;
        _jobs = jobs;
        _db = db;
        _audit = audit;
        _ai = ai;
        _tools = tools;
    }

    private Guid Me => Guid.Parse(CurrentUser.Id(User));
    private bool Can(string p) => User.HasClaim("permission", p);
    private ObjectResult Unavailable() => StatusCode(503, new
    {
        message = "The assistant isn't running on the server yet.", code = "assistant_unavailable",
    });

    /// <summary>
    /// Why a photo can't be read right now (owner, 2026-10-19: one message for every cause told
    /// nothing): turned off, the model server not answering, or the photo model not downloaded.
    /// </summary>
    private async Task<ObjectResult?> PhotoBlockedAsync(CancellationToken ct)
    {
        var st = await _ai.StatusAsync(ct);
        if (!st.Enabled)
            return StatusCode(503, new { message = "The assistant is turned off.", code = "assistant_off" });
        if (!st.Reachable)
            return StatusCode(503, new { message = "The model server isn't answering.", code = "assistant_unreachable" });
        if (!st.VisionReady)
            return StatusCode(503, new { message = "The photo model isn't downloaded yet.", code = "vision_model_missing" });
        return null;
    }

    /// <summary>
    /// A read that ran out of time (not the person leaving), the model server refusing it, or anything
    /// else going wrong, each told apart (owner, 2026-10-19: "the operation failed" told nothing).
    /// </summary>
    private ObjectResult PhotoFailed(Exception e, CancellationToken ct)
    {
        if (e is TaskCanceledException && !ct.IsCancellationRequested)
            return StatusCode(504, new { message = "Reading the photo took too long.", code = "assistant_timeout" });
        _log.LogWarning(e, "Reading a photo failed");
        return e is AssistantUnavailableException
            ? StatusCode(502, new { message = "The model server couldn't read the photo.", code = "scan_refused" })
            : e is HttpRequestException
                ? Unavailable()
                : StatusCode(502, new { message = "The photo couldn't be read.", code = "scan_failed" });
    }

    /// <summary>Whether the assistant is ready (the model server answers and has its models).</summary>
    [HttpGet("status")]
    public async Task<ActionResult<AssistantStatusDto>> Status(CancellationToken ct)
    {
        if (!Can(Permissions.AiChat) && !Can(Permissions.AiScan))
            return StatusCode(403, new { message = "Not allowed.", code = "forbidden" });
        var s = await _ai.StatusAsync(ct);
        var chat = Can(Permissions.AiChat);
        var speech = chat && await _ai.SpeechReadyAsync(ct);
        var voice = chat ? (await _ai.VoiceStatusAsync(ct)).Languages : Array.Empty<string>();
        return Ok(new AssistantStatusDto(s.Enabled, s.Reachable, s.ChatReady, s.VisionReady, speech, voice));
    }

    /// <summary>This person's conversations, latest first.</summary>
    [HttpGet("conversations")]
    [Authorize(Policy = Permissions.AiChat)]
    public async Task<ActionResult<AssistantConversationDto[]>> Conversations()
    {
        var me = Me;
        return Ok(await _db.AssistantConversations.AsNoTracking().Where(c => c.StaffId == me)
            .OrderByDescending(c => c.UpdatedAt).Take(500)
            .Select(c => new AssistantConversationDto(c.Id.ToString(), c.Title, c.CreatedAt, c.UpdatedAt, c.Turns.Count))
            .ToArrayAsync());
    }

    /// <summary>One conversation's questions and answers, oldest first (the person's own only).</summary>
    [HttpGet("conversations/{id:guid}")]
    [Authorize(Policy = Permissions.AiChat)]
    public async Task<ActionResult<AssistantTurnDto[]>> Turns(Guid id)
    {
        var me = Me;
        if (!await _db.AssistantConversations.AnyAsync(c => c.Id == id && c.StaffId == me)) return NotFoundConversation();
        return Ok(await _db.AssistantTurns.AsNoTracking().Where(t => t.ConversationId == id)
            .OrderBy(t => t.CreatedAt).Take(400)
            .Select(t => new AssistantTurnDto(t.Role, t.Content, t.CreatedAt)).ToArrayAsync());
    }

    [HttpDelete("conversations/{id:guid}")]
    [Authorize(Policy = Permissions.AiChat)]
    public async Task<IActionResult> DeleteConversation(Guid id)
    {
        var me = Me;
        var gone = await _db.AssistantConversations.Where(c => c.Id == id && c.StaffId == me).ExecuteDeleteAsync();
        if (gone == 0) return NotFoundConversation();
        await AuditAsync("delete", "assistant_conversation", id);
        return NoContent();
    }

    /// <summary>
    /// Delete this person's old conversations: those untouched for <paramref name="olderThanDays"/>
    /// days, or all of them when it isn't given.
    /// </summary>
    [HttpDelete("conversations")]
    [Authorize(Policy = Permissions.AiChat)]
    public async Task<ActionResult<object>> DeleteConversations([FromQuery] int? olderThanDays)
    {
        var me = Me;
        var q = _db.AssistantConversations.Where(c => c.StaffId == me);
        if (olderThanDays is int days)
        {
            if (days < 1) return BadRequest(new { message = "Choose a number of days.", code = "bad_days" });
            var before = DateTime.UtcNow.AddDays(-days);
            q = q.Where(c => c.UpdatedAt < before);
        }
        var deleted = await q.ExecuteDeleteAsync();
        await AuditAsync("delete", "assistant_conversations", me);
        return Ok(new { deleted });
    }

    /// <summary>
    /// Ask a question in a conversation (a new one when none is given); the answer is kept with it.
    /// </summary>
    [HttpPost("ask")]
    [Authorize(Policy = Permissions.AiChat)]
    public async Task<ActionResult<AssistantAnswerDto>> Ask([FromBody] AssistantAskRequest req, CancellationToken ct)
    {
        var question = (req.Text ?? "").Trim();
        if (question.Length == 0) return BadRequest(new { message = "Write a question.", code = "empty_message" });
        if (question.Length > MaxQuestion) question = question[..MaxQuestion];
        var me = Me;
        AssistantConversation? conv = null;
        if (!string.IsNullOrEmpty(req.ConversationId))
        {
            if (!Guid.TryParse(req.ConversationId, out var cid)) return NotFoundConversation();
            conv = await _db.AssistantConversations.FirstOrDefaultAsync(c => c.Id == cid && c.StaffId == me, ct);
            if (conv is null) return NotFoundConversation();
        }
        var history = conv is null
            ? new List<AssistantService.Turn>()
            : await _db.AssistantTurns.AsNoTracking().Where(t => t.ConversationId == conv.Id)
                .OrderByDescending(t => t.CreatedAt).Take(HistoryTurns)
                .Select(t => new AssistantService.Turn(t.Role, t.Content)).ToListAsync(ct);
        history.Reverse();
        string answer;
        try
        {
            answer = await _ai.AskAsync(User, history, question, _tools, Language(req.Language, question), req.Spoken, ct);
        }
        catch (Exception e) when (e is HttpRequestException or AssistantUnavailableException or TaskCanceledException)
        {
            return Unavailable();
        }
        if (answer.Length == 0) return Unavailable();
        if (conv is null)
        {
            var title = question.ReplaceLineEndings(" ");
            conv = new AssistantConversation { StaffId = me, Title = title.Length > 80 ? title[..80] + "…" : title };
            _db.AssistantConversations.Add(conv);
        }
        var asked = new AssistantTurn { StaffId = me, ConversationId = conv.Id, Role = "user", Content = question };
        var said = new AssistantTurn
        {
            StaffId = me, ConversationId = conv.Id, Role = "assistant", Content = answer,
            CreatedAt = asked.CreatedAt.AddMilliseconds(1),
        };
        conv.UpdatedAt = said.CreatedAt;
        _db.AssistantTurns.AddRange(asked, said);
        await _db.SaveChangesAsync(ct);
        await AuditAsync("ask", "assistant", said.Id);
        return Ok(new AssistantAnswerDto(conv.Id.ToString(), new AssistantTurnDto(said.Role, said.Content, said.CreatedAt)));
    }

    /// <summary>What was said in a short recording, read by the server's own speech service.</summary>
    [HttpPost("transcribe")]
    [Authorize(Policy = Permissions.AiChat)]
    [RequestSizeLimit(MaxAudio + 64 * 1024)]
    public async Task<ActionResult<AssistantTranscriptDto>> Transcribe(IFormFile? file, [FromQuery] string? language,
        CancellationToken ct)
    {
        if (file is null || file.Length == 0)
            return BadRequest(new { message = "Record something first.", code = "empty_audio" });
        if (file.Length > MaxAudio) return BadRequest(new { message = "The recording is too long.", code = "audio_too_long" });
        using var ms = new MemoryStream();
        await file.CopyToAsync(ms, ct);
        try
        {
            var text = await _ai.TranscribeAsync(ms.ToArray(), file.ContentType, language, ct);
            await AuditAsync("transcribe", "assistant", Me);
            return Ok(new AssistantTranscriptDto(text));
        }
        catch (Exception e) when (e is HttpRequestException or AssistantUnavailableException or TaskCanceledException)
        {
            return StatusCode(503, new { message = "Speech isn't available on the server.", code = "speech_unavailable" });
        }
    }

    /// <summary>
    /// An answer read aloud by the server's own voice (a WAV recording), so it sounds the same on every
    /// device and in Arabic too, where a device may have no Arabic voice of its own.
    /// </summary>
    [HttpPost("speak")]
    [Authorize(Policy = Permissions.AiChat)]
    public async Task<IActionResult> Speak([FromBody] AssistantSpeakRequest req, CancellationToken ct)
    {
        var language = req.Language is "ar" or "en" ? req.Language : null;
        var text = AssistantService.SpokenText(req.Text ?? "", language ?? "en");
        if (language is null || text.Length == 0)
            return BadRequest(new { message = "Nothing to read.", code = "empty_message" });
        try
        {
            return File(await _ai.SpeakAsync(text, language, ct), "audio/wav");
        }
        catch (Exception e) when (e is HttpRequestException or AssistantUnavailableException or TaskCanceledException)
        {
            return StatusCode(503, new { message = "The server's voice isn't available.", code = "voice_unavailable" });
        }
    }

    /// <summary>The answer's language: the app's as sent, else the question's script.</summary>
    private static string Language(string? asked, string question) =>
        asked is "ar" or "en" ? asked : question.Any(c => c is >= '\u0600' and <= '\u06FF') ? "ar" : "en";

    private NotFoundObjectResult NotFoundConversation() =>
        NotFound(new { message = "Conversation not found.", code = "not_found" });

    /// <summary>
    /// Read a supplier's invoice from a photo into a draft for the purchase screen. The read goes on
    /// after this answers (<see cref="PhotoJobs"/>): the reply is the read's id, to ask for with
    /// <see cref="ScanJob"/>.
    /// </summary>
    [HttpPost("scan/purchase")]
    [Authorize(Policy = Permissions.AiScan)]
    [RequestSizeLimit(MaxImage + 64 * 1024)]
    public async Task<IActionResult> ScanPurchase(IFormFile? file, CancellationToken ct)
    {
        if (!Can(Permissions.PurchasesCreate)) return StatusCode(403, new { message = "Not allowed.", code = "forbidden" });
        var (image, error) = await ImageAsync(file, ct);
        if (error is not null) return error;
        if (await PhotoBlockedAsync(ct) is { } blocked) return blocked;
        return StartRead("purchase_photo", async (ai, c) => await ai.ReadPurchaseAsync(image!, c));
    }

    /// <summary>
    /// Read a filled-in stocktake sheet from a photo (owner, 2026-10-21): each item code and the count
    /// written beside it, for the stocktake screen to fill in. Nothing is posted: whoever reviews the
    /// count decides (read on like an invoice).
    /// </summary>
    [HttpPost("scan/stocktake")]
    [Authorize(Policy = Permissions.AiScan)]
    [RequestSizeLimit(MaxImage + 64 * 1024)]
    public async Task<IActionResult> ScanStocktake(IFormFile? file, CancellationToken ct)
    {
        if (!Can(Permissions.InventoryStocktake)) return StatusCode(403, new { message = "Not allowed.", code = "forbidden" });
        var (image, error) = await ImageAsync(file, ct);
        if (error is not null) return error;
        if (await PhotoBlockedAsync(ct) is { } blocked) return blocked;
        return StartRead("stocktake_photo", async (ai, c) => await ai.ReadCountSheetAsync(image!, c));
    }

    /// <summary>Read cheques from a photo into rows for the notes screen (read on like an invoice).</summary>
    [HttpPost("scan/cheques")]
    [Authorize(Policy = Permissions.AiScan)]
    [RequestSizeLimit(MaxImage + 64 * 1024)]
    public async Task<IActionResult> ScanCheques(IFormFile? file, CancellationToken ct)
    {
        if (!Can(Permissions.NotesReceive) && !Can(Permissions.NotesIssue))
            return StatusCode(403, new { message = "Not allowed.", code = "forbidden" });
        var (image, error) = await ImageAsync(file, ct);
        if (error is not null) return error;
        if (await PhotoBlockedAsync(ct) is { } blocked) return blocked;
        return StartRead("cheque_photo", async (ai, c) => await ai.ReadChequesAsync(image!, c));
    }

    /// <summary>
    /// A photo read started earlier, only by the person who started it: 202 while it is still being
    /// read, then what it read, or why it couldn't be.
    /// </summary>
    [HttpGet("scan/jobs/{id:guid}")]
    [Authorize(Policy = Permissions.AiScan)]
    public IActionResult ScanJob(Guid id)
    {
        var job = _jobs.Find(id, CurrentUser.Id(User));
        if (job?.Work is null) return NotFound(new { message = "Not found.", code = "not_found" });
        if (!job.Work.IsCompleted)
            return Accepted(new { seconds = (int)(DateTime.UtcNow - job.Started).TotalSeconds });
        if (job.Work.IsCompletedSuccessfully) return Ok(job.Work.Result);
        var e = job.Work.Exception?.InnerException ?? (Exception?)job.Work.Exception ?? new TaskCanceledException();
        return PhotoFailed(e, CancellationToken.None);
    }

    private IActionResult StartRead(string resource, Func<AssistantService, CancellationToken, Task<object>> read)
    {
        var me = CurrentUser.Id(User);
        if (_jobs.Busy(me)) return Conflict(new { message = "A photo is still being read.", code = "scan_busy" });
        // What the audit needs, taken now: the request is gone when the read ends.
        var name = CurrentUser.Name(User);
        var branch = CurrentUser.BranchId(User);
        var ip = Request.HttpContext.Connection.RemoteIpAddress?.ToString();
        var agent = Request.Headers.UserAgent.ToString();
        var id = _jobs.Start(me, async (services, ct) =>
        {
            var result = await read(services.GetRequiredService<AssistantService>(), ct);
            await services.GetRequiredService<AuditService>().RecordAsync(me, name, "scan", resource, branch, ip, agent, me);
            return result;
        });
        return Accepted(new { jobId = id });
    }

    /// <summary>The uploaded photo (a JPEG, PNG or WebP image up to 10 MB), read into memory only.</summary>
    private static async Task<(byte[]? Image, ActionResult? Error)> ImageAsync(IFormFile? file, CancellationToken ct)
    {
        if (file is null || file.Length == 0 || file.Length > MaxImage)
            return (null, new BadRequestObjectResult(new { message = "Choose a photo up to 10 MB.", code = "bad_image" }));
        using var ms = new MemoryStream();
        await file.CopyToAsync(ms, ct);
        var bytes = ms.ToArray();
        var jpeg = bytes.Length > 3 && bytes[0] == 0xFF && bytes[1] == 0xD8;
        var png = bytes.Length > 8 && bytes[0] == 0x89 && bytes[1] == 0x50 && bytes[2] == 0x4E && bytes[3] == 0x47;
        var webp = bytes.Length > 12 && bytes[8] == 'W' && bytes[9] == 'E' && bytes[10] == 'B' && bytes[11] == 'P';
        return jpeg || png || webp
            ? (bytes, null)
            : (null, new BadRequestObjectResult(new { message = "Choose a photo (JPEG, PNG or WebP).", code = "bad_image" }));
    }

    private Task AuditAsync(string action, string resource, Guid id) =>
        _audit.RecordAsync(CurrentUser.Id(User), CurrentUser.Name(User), action, resource,
            CurrentUser.BranchId(User), Request.HttpContext.Connection.RemoteIpAddress?.ToString(),
            Request.Headers.UserAgent.ToString(), id.ToString());
}
