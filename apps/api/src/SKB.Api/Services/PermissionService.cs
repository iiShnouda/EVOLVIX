using Microsoft.EntityFrameworkCore;
using SKB.Api.Data;
using SKB.Api.Domain;

namespace SKB.Api.Services;

/// <summary>
/// What each person may do. A person gets their role's permissions — as the owner set them
/// (<see cref="RolePermissionSet"/>), else the defaults in <see cref="RolePermissions"/> — plus the
/// ones given to them, minus the ones taken from them. The OWNER role always has everything, so the
/// company can never lock itself out. The result goes into the access token; a change reaches the
/// person at their next token refresh (at most 15 minutes).
/// </summary>
public sealed class PermissionService
{
    private readonly AppDbContext _db;
    public PermissionService(AppDbContext db) => _db = db;

    /// <summary>Every role's permissions, with whether the owner changed them from the default.</summary>
    public async Task<Dictionary<Role, (string[] Permissions, bool Custom)>> RoleSetsAsync()
    {
        var saved = await _db.RolePermissionSets.AsNoTracking().ToDictionaryAsync(r => r.Role);
        return Enum.GetValues<Role>().ToDictionary(role => role, role =>
            role is Role.OWNER ? (Permissions.All, false)
            : role is Role.ADMIN ? (Known(Permissions.All.Except(Permissions.OwnerOnly)), false)
                : saved.TryGetValue(role, out var set)
                    ? (Known(set.Permissions), true)
                    : (RolePermissions.For(role), false));
    }

    public async Task<string[]> ForAsync(Staff staff) => Effective(staff, await RoleSetsAsync());

    public static string[] Effective(Staff staff, IReadOnlyDictionary<Role, (string[] Permissions, bool Custom)> sets)
    {
        // The owner and the admin have everything, including permissions added later.
        // The owner's own permissions (Permissions.OwnerOnly) are nobody else's.
        if (staff.Role == Role.OWNER) return Permissions.All;
        if (staff.Role == Role.ADMIN && staff.CustomRole is null) return Known(Permissions.All.Except(Permissions.OwnerOnly));
        var set = staff.CustomRole is { } custom ? custom.Permissions.ToArray()
            : sets.TryGetValue(staff.Role, out var s) ? s.Permissions : RolePermissions.For(staff.Role);
        return Known(set.Union(staff.GrantedPermissions).Except(staff.RevokedPermissions).Except(Permissions.OwnerOnly));
    }

    /// <summary>Only real permission names, in their standard order.</summary>
    public static string[] Known(IEnumerable<string> permissions)
    {
        var wanted = permissions.ToHashSet();
        return Permissions.All.Where(wanted.Contains).ToArray();
    }
}
