using System.Security.Claims;
using SKB.Api.Domain;

namespace SKB.Api.Services;

/// <summary>Convenience accessors over the authenticated principal's claims.</summary>
public static class CurrentUser
{
    public static string Id(ClaimsPrincipal u) => u.FindFirst("sub")?.Value ?? "";
    public static string Name(ClaimsPrincipal u) => u.FindFirst("name")?.Value ?? "";
    public static string RoleName(ClaimsPrincipal u) => u.FindFirst("role")?.Value ?? "VIEWER";
    public static string BranchId(ClaimsPrincipal u) => u.FindFirst("branchId")?.Value ?? "";

    public static Role Role(ClaimsPrincipal u) =>
        Enum.TryParse<Role>(RoleName(u), out var r) ? r : Domain.Role.VIEWER;

    /// <summary>Roles allowed to see data across all branches; others are branch-scoped.</summary>
    public static bool CanSeeAllBranches(ClaimsPrincipal u)
    {
        var r = Role(u);
        return r is Domain.Role.OWNER or Domain.Role.ADMIN or Domain.Role.ACCOUNTANT;
    }
}
