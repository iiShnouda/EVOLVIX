using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using SKB.Api.Data;
using SKB.Api.Domain;
using SKB.Api.Hubs;
using SKB.Api.Models;
using SKB.Api.Services;

namespace SKB.Api.Controllers;

/// <summary>
/// The staff chat (owner, 2026-10-06: "a chat between the reps inside the program; the supervisor sees
/// everything in it and can stop or allow anyone writing").
/// <list type="bullet">
/// <item><c>chat:use</c>: talk one to one, and in the groups one is in.</item>
/// <item><c>chat:monitor</c>: read every conversation (not write in others').</item>
/// <item><c>chat:groups</c>: make groups and change who is in them.</item>
/// <item><c>chat:mute</c>: stop or allow people writing.</item>
/// </list>
/// Messages stay on the server; nothing is deleted. Each new message is only signalled over the live
/// connection ("chat" with the conversation id); its text is read from here, which checks access.
/// </summary>
[ApiController]
[Route("api/chat")]
[Authorize]
public sealed class ChatController : ControllerBase
{
    public const int MaxText = 4000;
    private readonly AppDbContext _db;
    private readonly AuditService _audit;
    private readonly IHubContext<PresenceHub> _hub;

    public ChatController(AppDbContext db, AuditService audit, IHubContext<PresenceHub> hub)
    {
        _db = db;
        _audit = audit;
        _hub = hub;
    }

    private Guid Me => Guid.Parse(CurrentUser.Id(User));
    private bool Can(string permission) => User.HasClaim("permission", permission);
    private ActionResult Denied() => StatusCode(403, new { message = "Not allowed.", code = "forbidden" });
    /// <summary>Any of the chat's permissions opens it (owner, 2026-10-23: none needs another).</summary>
    private bool Opens() => User.HasAny(Permissions.ChatUse, Permissions.ChatMonitor, Permissions.ChatGroups, Permissions.ChatMute);

    /// <summary>Whether this person may write, and how many messages wait for them.</summary>
    [HttpGet("status")]
    public async Task<ActionResult<ChatStatusDto>> Status()
    {
        if (!Opens()) return Denied();
        var me = Me;
        var unread = await _db.ChatMembers.Where(m => m.StaffId == me)
            .SumAsync(m => _db.ChatMessages.Count(x => x.ConversationId == m.ConversationId
                && x.CreatedAt > m.LastReadAt && x.SenderId != me));
        return Ok(new ChatStatusDto(await _db.ChatMutes.AnyAsync(x => x.StaffId == me), unread));
    }

    /// <summary>Colleagues one can write to (open accounts), with who is stopped from writing.</summary>
    [HttpGet("people")]
    public async Task<ActionResult<ChatPersonDto[]>> People()
    {
        if (!Opens()) return Denied();
        var muted = (await _db.ChatMutes.Select(m => m.StaffId).ToListAsync()).ToHashSet();
        var people = await _db.Staff.AsNoTracking().Where(s => s.IsActive)
            .OrderBy(s => s.FullName).Select(s => new { s.Id, s.Code, s.FullName, s.Role }).ToListAsync();
        return Ok(people.Select(p => new ChatPersonDto(p.Id.ToString(), p.Code, p.FullName, p.Role.ToString(),
            muted.Contains(p.Id))).ToArray());
    }

    /// <summary>One's conversations, newest first; <paramref name="all"/> = every conversation (chat:monitor).</summary>
    [HttpGet("conversations")]
    public async Task<ActionResult<ChatConversationDto[]>> Conversations([FromQuery] bool all = false)
    {
        if (all ? !Can(Permissions.ChatMonitor) : !Opens()) return Denied();
        var me = Me;
        var q = _db.ChatConversations.AsNoTracking();
        if (!all) q = q.Where(c => c.Members.Any(m => m.StaffId == me));
        var rows = await q.OrderByDescending(c => c.LastMessageAt).Take(200)
            .Select(c => new
            {
                c.Id, c.Kind, c.Title, c.LastMessageAt,
                Members = c.Members.Select(m => new { m.StaffId, m.Staff!.FullName, m.LastReadAt }).ToList(),
                Last = _db.ChatMessages.Where(x => x.ConversationId == c.Id).OrderByDescending(x => x.CreatedAt)
                    .Select(x => new { x.Text, x.SenderId, x.CreatedAt }).FirstOrDefault(),
            }).ToListAsync();
        var ids = rows.Select(r => r.Id).ToList();
        var unread = await _db.ChatMembers.Where(m => m.StaffId == me && ids.Contains(m.ConversationId))
            .Select(m => new
            {
                m.ConversationId,
                Count = _db.ChatMessages.Count(x => x.ConversationId == m.ConversationId && x.CreatedAt > m.LastReadAt && x.SenderId != me),
            }).ToDictionaryAsync(x => x.ConversationId, x => x.Count);
        return Ok(rows.Select(r => new ChatConversationDto(
            r.Id.ToString(), r.Kind.ToString(), r.Title,
            r.Members.Select(m => new ChatMemberDto(m.StaffId.ToString(), m.FullName)).ToArray(),
            r.Members.Any(m => m.StaffId == me),
            r.Last?.Text is { } text ? (text.Length > 120 ? text[..120] : text) : null,
            r.Last?.SenderId.ToString(), r.Last?.CreatedAt ?? r.LastMessageAt,
            unread.GetValueOrDefault(r.Id))).ToArray());
    }

    /// <summary>Open (or make) the one-to-one conversation with a colleague.</summary>
    [HttpPost("direct")]
    [Authorize(Policy = Permissions.ChatUse)]
    public async Task<ActionResult<ChatConversationRefDto>> Direct([FromBody] ChatDirectRequest req)
    {
        var me = Me;
        if (!Guid.TryParse(req.StaffId, out var other) || other == me
            || !await _db.Staff.AnyAsync(s => s.Id == other && s.IsActive))
            return BadRequest(new { message = "Choose a colleague.", code = "staff_not_found" });
        return Ok(new ChatConversationRefDto((await DirectWithAsync(me, other)).ToString()));
    }

    /// <summary>
    /// The one conversation between two people, made the first time. The pair's key is unique, so a
    /// second request at the same moment (a double click) finds the first one's.
    /// </summary>
    private async Task<Guid> DirectWithAsync(Guid me, Guid other)
    {
        var key = ChatConversation.PairKey(me, other);
        var found = await _db.ChatConversations.Where(c => c.DirectKey == key).Select(c => (Guid?)c.Id).FirstOrDefaultAsync();
        if (found is Guid id) return id;
        var conv = new ChatConversation { Kind = ChatKind.DIRECT, CreatedById = me, DirectKey = key };
        conv.Members.Add(new ChatMember { StaffId = me });
        conv.Members.Add(new ChatMember { StaffId = other });
        _db.ChatConversations.Add(conv);
        try
        {
            await _db.SaveChangesAsync();
        }
        catch (DbUpdateException e) when (e.InnerException is Npgsql.PostgresException { SqlState: "23505" })
        {
            _db.ChangeTracker.Clear();
            return await _db.ChatConversations.Where(c => c.DirectKey == key).Select(c => c.Id).FirstAsync();
        }
        await AuditAsync("create", "chat_conversation", conv.Id);
        return conv.Id;
    }

    /// <summary>Make a group conversation (chat:groups); its maker is in it.</summary>
    [HttpPost("groups")]
    [Authorize(Policy = Permissions.ChatGroups)]
    public async Task<ActionResult<ChatConversationRefDto>> CreateGroup([FromBody] ChatGroupRequest req)
    {
        var title = Loc.Clean(req.Title);
        if (title is null) return BadRequest(new { message = "The group needs a name.", code = "bad_name" });
        var members = await MembersAsync(req.MemberIds);
        if (members is null) return BadRequest(new { message = "Choose its members.", code = "staff_not_found" });
        // A "group" of one other person is the one-to-one conversation with them.
        var others = members.Where(m => m != Me).Distinct().ToList();
        if (others.Count == 1)
            return Ok(new ChatConversationRefDto((await DirectWithAsync(Me, others[0])).ToString()));
        var conv = new ChatConversation { Kind = ChatKind.GROUP, Title = title[..Math.Min(120, title.Length)], CreatedById = Me };
        foreach (var id in members.Append(Me).Distinct()) conv.Members.Add(new ChatMember { StaffId = id });
        _db.ChatConversations.Add(conv);
        await _db.SaveChangesAsync();
        await AuditAsync("create", "chat_group", conv.Id);
        await SignalAsync(conv.Id, conv.Members.Select(m => m.StaffId));
        return Ok(new ChatConversationRefDto(conv.Id.ToString()));
    }

    /// <summary>Rename a group or change who is in it (chat:groups).</summary>
    [HttpPut("groups/{id:guid}")]
    [Authorize(Policy = Permissions.ChatGroups)]
    public async Task<ActionResult<ChatConversationRefDto>> UpdateGroup(Guid id, [FromBody] ChatGroupRequest req)
    {
        var conv = await _db.ChatConversations.Include(c => c.Members)
            .FirstOrDefaultAsync(c => c.Id == id && c.Kind == ChatKind.GROUP);
        if (conv is null) return NotFound(new { message = "Conversation not found.", code = "not_found" });
        if (req.Title is not null)
        {
            var title = Loc.Clean(req.Title);
            if (title is null) return BadRequest(new { message = "The group needs a name.", code = "bad_name" });
            conv.Title = title[..Math.Min(120, title.Length)];
        }
        if (req.MemberIds is not null)
        {
            var members = await MembersAsync(req.MemberIds);
            if (members is null) return BadRequest(new { message = "Choose its members.", code = "staff_not_found" });
            var wanted = members.ToHashSet();
            conv.Members.RemoveAll(m => !wanted.Contains(m.StaffId));
            foreach (var sid in wanted.Where(w => conv.Members.All(m => m.StaffId != w)))
                conv.Members.Add(new ChatMember { ConversationId = conv.Id, StaffId = sid });
        }
        await _db.SaveChangesAsync();
        await AuditAsync("update", "chat_group", conv.Id);
        await SignalAsync(conv.Id, conv.Members.Select(m => m.StaffId));
        return Ok(new ChatConversationRefDto(conv.Id.ToString()));
    }

    /// <summary>
    /// A conversation's messages, oldest first, a page before <paramref name="before"/>. Members read
    /// theirs (and it counts as read); people with chat:monitor read any.
    /// </summary>
    [HttpGet("conversations/{id:guid}/messages")]
    public async Task<ActionResult<ChatMessageDto[]>> Messages(Guid id, [FromQuery] DateTime? before = null,
        [FromQuery] int take = 60)
    {
        var me = Me;
        var member = await _db.ChatMembers.FirstOrDefaultAsync(m => m.ConversationId == id && m.StaffId == me);
        if (member is null && !Can(Permissions.ChatMonitor))
            return NotFound(new { message = "Conversation not found.", code = "not_found" });
        if (member is not null && !Opens()) return Denied();
        take = Math.Clamp(take, 1, 200);
        var q = _db.ChatMessages.AsNoTracking().Where(m => m.ConversationId == id);
        if (before is DateTime b) q = q.Where(m => m.CreatedAt < b);
        var rows = await q.OrderByDescending(m => m.CreatedAt).Take(take)
            .Select(m => new ChatMessageDto(m.Id.ToString(), m.SenderId.ToString(), m.Sender!.FullName, m.Text, m.CreatedAt))
            .ToListAsync();
        if (member is not null && before is null)
        {
            // The person's own reading marker (not business data), so it isn't written to the audit log.
            member.LastReadAt = DateTime.UtcNow;
            await _db.SaveChangesAsync();
        }
        rows.Reverse();
        return Ok(rows.ToArray());
    }

    /// <summary>Write in a conversation one is in (refused while a supervisor has stopped them).</summary>
    [HttpPost("conversations/{id:guid}/messages")]
    [Authorize(Policy = Permissions.ChatUse)]
    public async Task<ActionResult<ChatMessageDto>> Send(Guid id, [FromBody] ChatSendRequest req)
    {
        var me = Me;
        var conv = await _db.ChatConversations.Include(c => c.Members).FirstOrDefaultAsync(c => c.Id == id);
        if (conv is null || conv.Members.All(m => m.StaffId != me))
            return NotFound(new { message = "Conversation not found.", code = "not_found" });
        if (await _db.ChatMutes.AnyAsync(m => m.StaffId == me))
            return StatusCode(403, new { message = "A supervisor has stopped you writing in the chat.", code = "chat_muted" });
        var text = (req.Text ?? "").Trim();
        if (text.Length == 0) return BadRequest(new { message = "Write a message.", code = "empty_message" });
        if (text.Length > MaxText) text = text[..MaxText];
        var msg = new ChatMessage { ConversationId = id, SenderId = me, Text = text };
        _db.ChatMessages.Add(msg);
        conv.LastMessageAt = msg.CreatedAt;
        conv.Members.First(m => m.StaffId == me).LastReadAt = msg.CreatedAt;
        await _db.SaveChangesAsync();
        await AuditAsync("send", "chat_message", msg.Id);
        await SignalAsync(id, conv.Members.Select(m => m.StaffId));
        return Ok(new ChatMessageDto(msg.Id.ToString(), me.ToString(), CurrentUser.Name(User), msg.Text, msg.CreatedAt));
    }

    /// <summary>Stop someone writing in the chat (chat:mute). They still read.</summary>
    [HttpPost("mutes/{staffId:guid}")]
    [Authorize(Policy = Permissions.ChatMute)]
    public async Task<IActionResult> Mute(Guid staffId)
    {
        if (staffId == Me) return BadRequest(new { message = "You can't stop yourself.", code = "bad_request" });
        if (!await _db.Staff.AnyAsync(s => s.Id == staffId))
            return NotFound(new { message = "Not found.", code = "staff_not_found" });
        if (!await _db.ChatMutes.AnyAsync(m => m.StaffId == staffId))
        {
            _db.ChatMutes.Add(new ChatMute { StaffId = staffId, ById = Me });
            await _db.SaveChangesAsync();
            await AuditAsync("mute", "chat_member", staffId);
        }
        await _hub.Clients.Group(PresenceHub.StaffGroup(staffId)).SendAsync("chat", "");
        return NoContent();
    }

    /// <summary>Let someone write in the chat again (chat:mute).</summary>
    [HttpDelete("mutes/{staffId:guid}")]
    [Authorize(Policy = Permissions.ChatMute)]
    public async Task<IActionResult> Unmute(Guid staffId)
    {
        var row = await _db.ChatMutes.FirstOrDefaultAsync(m => m.StaffId == staffId);
        if (row is not null)
        {
            _db.ChatMutes.Remove(row);
            await _db.SaveChangesAsync();
            await AuditAsync("unmute", "chat_member", staffId);
        }
        await _hub.Clients.Group(PresenceHub.StaffGroup(staffId)).SendAsync("chat", "");
        return NoContent();
    }

    /// <summary>Open accounts among the ids given; null when one isn't.</summary>
    private async Task<List<Guid>?> MembersAsync(string[]? raw)
    {
        var ids = (raw ?? Array.Empty<string>()).Select(x => Guid.TryParse(x, out var g) ? g : Guid.Empty).Distinct().ToList();
        if (ids.Count == 0 || ids.Contains(Guid.Empty) || ids.Count > 200) return null;
        var found = await _db.Staff.Where(s => ids.Contains(s.Id) && s.IsActive).CountAsync();
        return found == ids.Count ? ids : null;
    }

    /// <summary>Tell the members' windows, and the supervisors', that a conversation changed.</summary>
    private async Task SignalAsync(Guid conversationId, IEnumerable<Guid> members)
    {
        var groups = members.Select(PresenceHub.StaffGroup).Append(PresenceHub.ChatMonitors).ToList();
        await _hub.Clients.Groups(groups).SendAsync("chat", conversationId.ToString());
    }

    private Task AuditAsync(string action, string resource, Guid id) =>
        _audit.RecordAsync(CurrentUser.Id(User), CurrentUser.Name(User), action, resource,
            CurrentUser.BranchId(User), Request.HttpContext.Connection.RemoteIpAddress?.ToString(),
            Request.Headers.UserAgent.ToString(), id.ToString());
}
