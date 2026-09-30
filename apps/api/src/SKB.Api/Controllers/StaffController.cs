using System.Net.Mail;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SKB.Api.Data;
using SKB.Api.Domain;
using SKB.Api.Models;
using SKB.Api.Services;

namespace SKB.Api.Controllers;

/// <summary>
/// Staff and permissions (الموظفون والصلاحيات). Owner decision 2026-09-29: every action has its own
/// permission and roles bundle them. Here the owner:
/// <list type="bullet">
/// <item>adds staff and changes their role, branch, password or active state (<c>staff:manage</c>);</item>
/// <item>changes what each role may do, and gives a person extra permissions or takes some of their
/// role's away (<c>roles:manage</c>).</item>
/// </list>
/// Safety rules, all checked here: nobody can grant a permission they don't hold themselves; only an
/// owner can make or change an owner; there is always at least one active owner; nobody can
/// deactivate themselves or change their own role. The OWNER role always has every permission.
/// A change reaches the person at their next token refresh (at most 15 minutes); deactivating ends
/// their sessions.
/// </summary>
[ApiController]
[Route("api")]
public sealed class StaffController : ControllerBase
{
    private const int MinPassword = 8;

    private readonly AppDbContext _db;
    private readonly PermissionService _permissions;
    private readonly AuthService _auth;
    private readonly AuditService _audit;

    public StaffController(AppDbContext db, PermissionService permissions, AuthService auth, AuditService audit)
    {
        _db = db;
        _permissions = permissions;
        _auth = auth;
        _audit = audit;
    }

    // ------------------------------------------------------------------ staff

    [HttpGet("staff")]
    [Authorize(Policy = Permissions.StaffView)]
    public async Task<ActionResult<StaffDto[]>> List()
    {
        var staff = await _db.Staff.AsNoTracking().Include(s => s.Branch).ToListAsync();
        var sets = await _permissions.RoleSetsAsync();
        return Ok(staff
            .OrderByDescending(s => s.IsActive).ThenBy(s => s.Role).ThenBy(s => s.FullName)
            .Select(s => ToDto(s, sets)).ToArray());
    }

    [HttpPost("staff")]
    [Authorize(Policy = Permissions.StaffManage)]
    public async Task<ActionResult<StaffDto>> Create([FromBody] CreateStaffRequest req)
    {
        var name = Clean(req.FullName, 100);
        if (name is null) return Bad("bad_name", "Enter the person's name.");
        var email = CleanEmail(req.Email);
        if (email is null) return Bad("bad_email", "Enter a valid email.");
        if (await _db.Staff.AnyAsync(s => s.Email == email))
            return Bad("duplicate_email", $"{email} already has an account.");
        if (req.Password is null || req.Password.Length < MinPassword || req.Password.Length > 200)
            return Bad("weak_password", $"The password needs at least {MinPassword} characters.");
        if (!Enum.TryParse<Role>(req.Role, true, out var role))
            return Bad("bad_role", "Choose a role.");
        if (role == Role.OWNER && CurrentUser.Role(User) != Role.OWNER)
            return Forbidden("owner_only", "Only an owner can add another owner.");
        if (!Guid.TryParse(req.BranchId, out var branchId) || !await _db.Branches.AnyAsync(b => b.Id == branchId))
            return Bad("branch_not_found", "Choose a branch.");

        var staff = new Staff
        {
            FullName = name, Email = email, Role = role, BranchId = branchId, Phone = Clean(req.Phone, 40),
            PasswordHash = _auth.HashPassword(req.Password),
        };
        _db.Staff.Add(staff);
        await _db.SaveChangesAsync();
        await AuditAsync("create", "staff", staff.Id);

        await _db.Entry(staff).Reference(s => s.Branch).LoadAsync();
        return Created($"/api/staff/{staff.Id}", ToDto(staff, await _permissions.RoleSetsAsync()));
    }

    [HttpPut("staff/{id:guid}")]
    [Authorize(Policy = Permissions.StaffManage)]
    public async Task<ActionResult<StaffDto>> Update(Guid id, [FromBody] UpdateStaffRequest req)
    {
        var staff = await _db.Staff.Include(s => s.Branch).FirstOrDefaultAsync(s => s.Id == id);
        if (staff is null) return NotFound(new { message = "Person not found.", code = "not_found" });
        var me = Guid.TryParse(CurrentUser.Id(User), out var myId) ? myId : Guid.Empty;
        var iAmOwner = CurrentUser.Role(User) == Role.OWNER;
        if (staff.Role == Role.OWNER && !iAmOwner)
            return Forbidden("owner_only", "Only an owner can change an owner's account.");

        if (req.FullName is not null)
        {
            var name = Clean(req.FullName, 100);
            if (name is null) return Bad("bad_name", "Enter the person's name.");
            staff.FullName = name;
        }
        if (req.Email is not null)
        {
            var email = CleanEmail(req.Email);
            if (email is null) return Bad("bad_email", "Enter a valid email.");
            if (await _db.Staff.AnyAsync(s => s.Email == email && s.Id != id))
                return Bad("duplicate_email", $"{email} already has an account.");
            staff.Email = email;
        }
        if (req.Phone is not null) staff.Phone = Clean(req.Phone, 40);
        if (req.BranchId is not null)
        {
            if (!Guid.TryParse(req.BranchId, out var branchId) || !await _db.Branches.AnyAsync(b => b.Id == branchId))
                return Bad("branch_not_found", "Choose a branch.");
            staff.BranchId = branchId;
        }
        if (req.Role is not null)
        {
            if (!Enum.TryParse<Role>(req.Role, true, out var role)) return Bad("bad_role", "Choose a role.");
            if (role != staff.Role)
            {
                if (id == me) return Bad("own_role", "You can't change your own role.");
                if (role == Role.OWNER && !iAmOwner)
                    return Forbidden("owner_only", "Only an owner can make someone an owner.");
                if (staff.Role == Role.OWNER && await LastOwnerAsync(id))
                    return Bad("last_owner", "The company needs at least one active owner.");
                staff.Role = role;
            }
        }
        if (req.IsActive is bool active && active != staff.IsActive)
        {
            if (!active && id == me) return Bad("own_account", "You can't deactivate yourself.");
            if (!active && staff.Role == Role.OWNER && await LastOwnerAsync(id))
                return Bad("last_owner", "The company needs at least one active owner.");
            staff.IsActive = active;
            if (!active) await EndSessionsAsync(id);
        }
        if (req.Password is not null)
        {
            if (req.Password.Length < MinPassword || req.Password.Length > 200)
                return Bad("weak_password", $"The password needs at least {MinPassword} characters.");
            staff.PasswordHash = _auth.HashPassword(req.Password);
            // A new password signs the person out everywhere else.
            if (id != me) await EndSessionsAsync(id);
        }

        await _db.SaveChangesAsync();
        await AuditAsync(req.Password is null ? "update" : "update_password", "staff", id);
        await _db.Entry(staff).Reference(s => s.Branch).LoadAsync();
        return Ok(ToDto(staff, await _permissions.RoleSetsAsync()));
    }

    /// <summary>Give one person permissions beyond their role, or take some of their role's away.</summary>
    [HttpPut("staff/{id:guid}/permissions")]
    [Authorize(Policy = Permissions.RolesManage)]
    public async Task<ActionResult<StaffDto>> SetPermissions(Guid id, [FromBody] StaffPermissionsRequest req)
    {
        var staff = await _db.Staff.Include(s => s.Branch).FirstOrDefaultAsync(s => s.Id == id);
        if (staff is null) return NotFound(new { message = "Person not found.", code = "not_found" });
        if (staff.Role == Role.OWNER)
            return Bad("owner_fixed", "An owner always has every permission.");
        if (id.ToString() == CurrentUser.Id(User))
            return Bad("own_permissions", "You can't change your own permissions.");

        var granted = req.Granted ?? Array.Empty<string>();
        var revoked = req.Revoked ?? Array.Empty<string>();
        var unknown = granted.Concat(revoked).FirstOrDefault(p => !Permissions.All.Contains(p));
        if (unknown is not null) return Bad("unknown_permission", $"{unknown} is not a permission.");
        if (granted.Intersect(revoked).Any())
            return Bad("bad_permissions", "A permission can't be both given and taken away.");
        var escalation = EscalationIn(granted.Concat(revoked));
        if (escalation is not null) return escalation;

        staff.GrantedPermissions = PermissionService.Known(granted).ToList();
        staff.RevokedPermissions = PermissionService.Known(revoked).ToList();
        await _db.SaveChangesAsync();
        await AuditAsync("permissions", "staff", id);
        return Ok(ToDto(staff, await _permissions.RoleSetsAsync()));
    }

    /// <summary>
    /// What one person may work with (DOMAIN.md §2.1): every branch, or their own plus the ones
    /// listed (or as their role says); and within those, if any are listed, only those warehouses
    /// and money accounts. Nobody gives more than they have themselves; an owner always has
    /// everything; nobody changes their own. It reaches the person at their next token refresh.
    /// </summary>
    [HttpPut("staff/{id:guid}/access")]
    [Authorize(Policy = Permissions.StaffAccess)]
    public async Task<ActionResult<StaffDto>> SetAccess(Guid id, [FromBody] StaffAccessRequest req)
    {
        var staff = await _db.Staff.Include(s => s.Branch).FirstOrDefaultAsync(s => s.Id == id);
        if (staff is null) return NotFound(new { message = "Person not found.", code = "not_found" });
        if (staff.Role == Role.OWNER) return Bad("owner_fixed", "An owner always works in every branch.");
        if (id.ToString() == CurrentUser.Id(User)) return Bad("own_access", "You can't change your own access.");

        var branchIds = Ids(req.BranchIds);
        var warehouseIds = Ids(req.WarehouseIds);
        var accountIds = Ids(req.MoneyAccountIds);
        var departmentIds = Ids(req.DepartmentIds);
        if (branchIds is null) return Bad("branch_not_found", "A branch was not found.");
        if (departmentIds is null) return Bad("department_not_found", "A department was not found.");
        if (departmentIds.Count > 0 && await _db.Departments.CountAsync(d => departmentIds.Contains(d.Id)) != departmentIds.Count)
            return Bad("department_not_found", "A department was not found.");
        if (req.MaxDiscountPercent is < 0 or > 100)
            return Bad("bad_percent", "A discount limit is between 0% and 100%.");
        if (warehouseIds is null) return Bad("warehouse_not_found", "A warehouse was not found.");
        if (accountIds is null) return Bad("account_not_found", "A money account was not found.");
        if (branchIds.Count + warehouseIds.Count + accountIds.Count > 500) return Bad("too_many", "That's too many.");
        branchIds.Remove(staff.BranchId);
        if (branchIds.Count > 0 && await _db.Branches.CountAsync(b => branchIds.Contains(b.Id)) != branchIds.Count)
            return Bad("branch_not_found", "A branch was not found.");

        // The branches they'll have: every one, or theirs and the listed ones.
        var all = req.AllBranches ?? AccessService.RoleSeesAll(staff.Role);
        var theirs = all ? null : branchIds.Append(staff.BranchId).ToList();
        if (warehouseIds.Count > 0 && await _db.Warehouses.CountAsync(w => warehouseIds.Contains(w.Id)
                && w.Kind == WarehouseKind.STORE && (theirs == null || theirs.Contains(w.BranchId))) != warehouseIds.Count)
            return Bad("warehouse_not_found", "Choose warehouses in their branches.");
        if (accountIds.Count > 0 && await _db.MoneyAccounts.CountAsync(a => accountIds.Contains(a.Id)
                && (theirs == null || theirs.Contains(a.BranchId))) != accountIds.Count)
            return Bad("account_not_found", "Choose money accounts in their branches.");

        // Nobody gives more than they have themselves.
        if (Access.Branches(User) is { } myBranches
            && (all || !myBranches.Contains(staff.BranchId) || branchIds.Any(b => !myBranches.Contains(b))))
            return Forbidden("not_your_branch", "You can only give branches you work in yourself.");
        if (Access.Warehouses(User) is { } myWarehouses
            && (warehouseIds.Count == 0 || warehouseIds.Any(w => !myWarehouses.Contains(w))))
            return Forbidden("not_your_warehouse", "You can only give warehouses you use yourself.");
        if (Access.MoneyAccounts(User) is { } myAccounts
            && (accountIds.Count == 0 || accountIds.Any(a => !myAccounts.Contains(a))))
            return Forbidden("not_your_account", "You can only give money accounts you use yourself.");
        if (Access.Departments(User) is { } myDepartments
            && (departmentIds.Count == 0 || departmentIds.Any(d => !myDepartments.Contains(d))))
            return Forbidden("not_your_department", "You can only give departments you work in yourself.");
        if (Access.MaxDiscount(User) is int myMax)
        {
            var theirMax = req.MaxDiscountPercent
                ?? await _db.CompanySettings.Select(x => (int?)x.MaxDiscountPercent).FirstOrDefaultAsync() ?? 100;
            if (theirMax > myMax)
                return Forbidden("over_your_limit", $"You can give a discount limit up to your own ({myMax}%).");
        }

        staff.AllBranches = req.AllBranches;
        staff.BranchIds = all ? new List<Guid>() : branchIds;
        staff.WarehouseIds = warehouseIds;
        staff.MoneyAccountIds = accountIds;
        staff.DepartmentIds = departmentIds;
        staff.MaxDiscountPercent = req.MaxDiscountPercent;
        await _db.SaveChangesAsync();
        await AuditAsync("access", "staff", id);
        return Ok(ToDto(staff, await _permissions.RoleSetsAsync()));
    }

    /// <summary>A list of ids without repeats, or null when one isn't an id.</summary>
    private static List<Guid>? Ids(string[]? raw)
    {
        var list = new List<Guid>();
        foreach (var r in raw ?? Array.Empty<string>())
        {
            if (!Guid.TryParse(r, out var g)) return null;
            if (!list.Contains(g)) list.Add(g);
        }
        return list;
    }

    // ------------------------------------------------------------------ roles

    [HttpGet("roles")]
    [Authorize(Policy = Permissions.StaffView)]
    public async Task<ActionResult<RoleDto[]>> Roles()
    {
        var sets = await _permissions.RoleSetsAsync();
        var counts = await _db.Staff.Where(s => s.IsActive).GroupBy(s => s.Role)
            .Select(g => new { g.Key, Count = g.Count() }).ToDictionaryAsync(x => x.Key, x => x.Count);
        return Ok(Enum.GetValues<Role>().Select(role => new RoleDto(role.ToString(), sets[role].Permissions,
            sets[role].Custom, role != Role.OWNER, counts.GetValueOrDefault(role))).ToArray());
    }

    /// <summary>Set what a role may do. Everyone in the role gets it at their next token refresh.</summary>
    [HttpPut("roles/{role}")]
    [Authorize(Policy = Permissions.RolesManage)]
    public async Task<ActionResult<RoleDto>> UpdateRole(string role, [FromBody] UpdateRoleRequest req)
    {
        if (!Enum.TryParse<Role>(role, true, out var r)) return NotFound(new { message = "Role not found.", code = "not_found" });
        if (r == Role.OWNER) return Bad("owner_fixed", "The owner role always has every permission.");
        if (r == CurrentUser.Role(User)) return Bad("own_role", "You can't change your own role's permissions.");
        var wanted = req.Permissions ?? Array.Empty<string>();
        var unknown = wanted.FirstOrDefault(p => !Permissions.All.Contains(p));
        if (unknown is not null) return Bad("unknown_permission", $"{unknown} is not a permission.");

        // Only permissions actually added or removed need the editor to hold them.
        var before = (await _permissions.RoleSetsAsync())[r].Permissions;
        var escalation = EscalationIn(wanted.Except(before).Concat(before.Except(wanted)));
        if (escalation is not null) return escalation;

        var set = await _db.RolePermissionSets.FirstOrDefaultAsync(x => x.Role == r);
        if (set is null) _db.RolePermissionSets.Add(set = new RolePermissionSet { Role = r });
        set.Permissions = PermissionService.Known(wanted).ToList();
        set.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        await AuditAsync("permissions", "role", Guid.Empty, r.ToString());
        return Ok(await RoleAsync(r));
    }

    /// <summary>Put a role back to the permissions it came with.</summary>
    [HttpPost("roles/{role}/reset")]
    [Authorize(Policy = Permissions.RolesManage)]
    public async Task<ActionResult<RoleDto>> ResetRole(string role)
    {
        if (!Enum.TryParse<Role>(role, true, out var r)) return NotFound(new { message = "Role not found.", code = "not_found" });
        if (r == Role.OWNER) return Bad("owner_fixed", "The owner role always has every permission.");
        if (r == CurrentUser.Role(User)) return Bad("own_role", "You can't change your own role's permissions.");
        var before = (await _permissions.RoleSetsAsync())[r].Permissions;
        var defaults = RolePermissions.For(r);
        var escalation = EscalationIn(defaults.Except(before).Concat(before.Except(defaults)));
        if (escalation is not null) return escalation;

        await _db.RolePermissionSets.Where(x => x.Role == r).ExecuteDeleteAsync();
        await AuditAsync("reset", "role", Guid.Empty, r.ToString());
        return Ok(await RoleAsync(r));
    }

    /// <summary>Every permission and the module it belongs to (labels are translated in the app).</summary>
    [HttpGet("permissions")]
    [Authorize(Policy = Permissions.StaffView)]
    public ActionResult<PermissionInfoDto[]> AllPermissions() =>
        Ok(Permissions.All.Select(p => new PermissionInfoDto(p, p.Split(':')[0])).ToArray());

    // ------------------------------------------------------------------ helpers

    /// <summary>Refuse a change that touches a permission the editor doesn't hold (no self-escalation).</summary>
    private ActionResult? EscalationIn(IEnumerable<string> touched)
    {
        var mine = User.FindAll("permission").Select(c => c.Value).ToHashSet();
        var missing = touched.FirstOrDefault(p => !mine.Contains(p));
        return missing is null
            ? null
            : Forbidden("not_your_permission", $"You can only give or take permissions you have yourself ({missing}).");
    }

    private async Task<RoleDto> RoleAsync(Role r)
    {
        var sets = await _permissions.RoleSetsAsync();
        return new RoleDto(r.ToString(), sets[r].Permissions, sets[r].Custom, r != Role.OWNER,
            await _db.Staff.CountAsync(s => s.IsActive && s.Role == r));
    }

    /// <summary>Whether <paramref name="id"/> is the only active owner left.</summary>
    private async Task<bool> LastOwnerAsync(Guid id) =>
        !await _db.Staff.AnyAsync(s => s.Id != id && s.IsActive && s.Role == Role.OWNER);

    private async Task EndSessionsAsync(Guid staffId) =>
        await _db.Sessions.Where(s => s.StaffId == staffId && s.RevokedAt == null)
            .ExecuteUpdateAsync(s => s.SetProperty(x => x.RevokedAt, DateTime.UtcNow));

    private static StaffDto ToDto(Staff s, IReadOnlyDictionary<Role, (string[] Permissions, bool Custom)> sets) => new(
        s.Id.ToString(), s.FullName, s.Email, s.Role.ToString(), s.BranchId.ToString(), Loc.Name(s.Branch), s.Phone,
        s.IsActive, s.CreatedAt.ToString("o"), PermissionService.Known(s.GrantedPermissions),
        PermissionService.Known(s.RevokedPermissions), PermissionService.Effective(s, sets),
        s.Role == Role.OWNER ? true : s.AllBranches, AccessService.SeesAll(s),
        s.BranchIds.Select(x => x.ToString()).ToArray(), s.WarehouseIds.Select(x => x.ToString()).ToArray(),
        s.MoneyAccountIds.Select(x => x.ToString()).ToArray(),
        s.DepartmentIds.Select(x => x.ToString()).ToArray(), s.MaxDiscountPercent, s.Code);

    private static string? Clean(string? s, int max)
    {
        var t = s?.Trim();
        return string.IsNullOrEmpty(t) ? null : t[..Math.Min(max, t.Length)];
    }

    private static string? CleanEmail(string? s)
    {
        var t = s?.Trim().ToLowerInvariant();
        if (string.IsNullOrEmpty(t) || t.Length > 200) return null;
        return MailAddress.TryCreate(t, out var a) && a.Address == t ? t : null;
    }

    private BadRequestObjectResult Bad(string code, string message) => BadRequest(new { message, code });

    private ObjectResult Forbidden(string code, string message) => StatusCode(403, new { message, code });

    private Task AuditAsync(string action, string resource, Guid id, string? name = null) =>
        _audit.RecordAsync(CurrentUser.Id(User), CurrentUser.Name(User), action, resource,
            CurrentUser.BranchId(User), Request.HttpContext.Connection.RemoteIpAddress?.ToString(),
            Request.Headers.UserAgent.ToString(), name ?? id.ToString());
}
