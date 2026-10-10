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
/// can keep several and delete any (owner, 2026-10-10). A question can be spoken: the recording is
/// read by the server's own speech service (Whisper) and not kept.
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

    public AssistantController(AppDbContext db, AuditService audit, AssistantService ai, AssistantTools tools)
    {
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

    /// <summary>Whether the assistant is ready (the model server answers and has its models).</summary>
    [HttpGet("status")]
    public async Task<ActionResult<AssistantStatusDto>> Status(CancellationToken ct)
    {
        if (!Can(Permissions.AiChat) && !Can(Permissions.AiScan))
            return StatusCode(403, new { message = "Not allowed.", code = "forbidden" });
        var s = await _ai.StatusAsync(ct);
        var speech = Can(Permissions.AiChat) && await _ai.SpeechReadyAsync(ct);
        return Ok(new AssistantStatusDto(s.Enabled, s.Reachable, s.ChatReady, s.VisionReady, speech));
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
            answer = await _ai.AskAsync(User, history, question, _tools, ct);
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
    public async Task<ActionResult<AssistantTranscriptDto>> Transcribe(IFormFile? file, CancellationToken ct)
    {
        if (file is null || file.Length == 0)
            return BadRequest(new { message = "Record something first.", code = "empty_audio" });
        if (file.Length > MaxAudio) return BadRequest(new { message = "The recording is too long.", code = "audio_too_long" });
        using var ms = new MemoryStream();
        await file.CopyToAsync(ms, ct);
        try
        {
            var text = await _ai.TranscribeAsync(ms.ToArray(), file.ContentType, ct);
            await AuditAsync("transcribe", "assistant", Me);
            return Ok(new AssistantTranscriptDto(text));
        }
        catch (Exception e) when (e is HttpRequestException or AssistantUnavailableException or TaskCanceledException)
        {
            return StatusCode(503, new { message = "Speech isn't available on the server.", code = "speech_unavailable" });
        }
    }

    private NotFoundObjectResult NotFoundConversation() =>
        NotFound(new { message = "Conversation not found.", code = "not_found" });

    /// <summary>Read a supplier's invoice from a photo into a draft for the purchase screen.</summary>
    [HttpPost("scan/purchase")]
    [Authorize(Policy = Permissions.AiScan)]
    [RequestSizeLimit(MaxImage + 64 * 1024)]
    public async Task<ActionResult<AssistantService.PurchaseScan>> ScanPurchase(IFormFile? file, CancellationToken ct)
    {
        if (!Can(Permissions.PurchasesCreate)) return StatusCode(403, new { message = "Not allowed.", code = "forbidden" });
        var (image, error) = await ImageAsync(file, ct);
        if (error is not null) return error;
        try
        {
            var scan = await _ai.ReadPurchaseAsync(image!, ct);
            await AuditAsync("scan", "purchase_photo", Me);
            return Ok(scan);
        }
        catch (Exception e) when (e is HttpRequestException or AssistantUnavailableException or TaskCanceledException)
        {
            return Unavailable();
        }
    }

    /// <summary>Read cheques from a photo into rows for the notes screen.</summary>
    [HttpPost("scan/cheques")]
    [Authorize(Policy = Permissions.AiScan)]
    [RequestSizeLimit(MaxImage + 64 * 1024)]
    public async Task<ActionResult<List<AssistantService.ChequeScan>>> ScanCheques(IFormFile? file, CancellationToken ct)
    {
        if (!Can(Permissions.NotesReceive) && !Can(Permissions.NotesIssue))
            return StatusCode(403, new { message = "Not allowed.", code = "forbidden" });
        var (image, error) = await ImageAsync(file, ct);
        if (error is not null) return error;
        try
        {
            var scan = await _ai.ReadChequesAsync(image!, ct);
            await AuditAsync("scan", "cheque_photo", Me);
            return Ok(scan);
        }
        catch (Exception e) when (e is HttpRequestException or AssistantUnavailableException or TaskCanceledException)
        {
            return Unavailable();
        }
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
