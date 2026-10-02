using System.Linq.Expressions;
using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using SKB.Api.Data;
using SKB.Api.Domain;

namespace SKB.Api.Services;

/// <summary>
/// What a person may work with (DOMAIN.md §2.1): their branches, and within them, if the owner
/// narrowed it, only some warehouses and money accounts. It replaces the old per-user flags
/// (chkBoxFar*, chkBoxMakhzan*, chkBoxKhazna*).
///
/// It's read from their token, which <see cref="AccessService"/> fills at sign-in and at every
/// refresh (so a change reaches them within 15 minutes, like permissions). New documents go to
/// their <b>working branch</b>: the one picked in the app (the <c>X-Branch</c> header) when they
/// may use it, else their own branch.
/// </summary>
public static class Access
{
    public const string BranchHeader = "X-Branch";
    public const string WorkClaim = "workBranch";

    /// <summary>The person's own branch (their staff record's).</summary>
    public static Guid Home(ClaimsPrincipal u) => Guid.TryParse(CurrentUser.BranchId(u), out var b) ? b : Guid.Empty;

    /// <summary>Where new documents, vouchers and defaults go: the branch picked in the app, else their own.</summary>
    public static Guid Work(ClaimsPrincipal u) =>
        Guid.TryParse(u.FindFirst(WorkClaim)?.Value, out var b) ? b : Home(u);

    /// <summary>Sees every branch (the owner always; others when their role or the owner says so).</summary>
    public static bool AllBranches(ClaimsPrincipal u) =>
        u.HasClaim("allBranches", "1") || (u.FindFirst("branches") is null && CurrentUser.RoleSeesAllBranches(u));

    /// <summary>The branches the person may see and use; null = every branch.</summary>
    public static Guid[]? Branches(ClaimsPrincipal u)
    {
        if (AllBranches(u)) return null;
        // A token from before scopes existed: their own branch, as it was then.
        return Ids(u, "branches") ?? new[] { Home(u) };
    }

    /// <summary>
    /// May the person work in this branch (see it, make documents in it)? For people who see every
    /// branch, any branch — callers that take a branch id from a request check that it exists.
    /// </summary>
    public static bool CanUseBranch(ClaimsPrincipal u, Guid branchId) =>
        branchId != Guid.Empty && (Branches(u) is not { } mine || mine.Contains(branchId));

    /// <summary>Only these warehouses (within their branches); null = any in their branches.</summary>
    public static Guid[]? Warehouses(ClaimsPrincipal u) => Ids(u, "warehouses");

    /// <summary>Only these cash boxes / banks / wallets (within their branches); null = any in their branches.</summary>
    public static Guid[]? MoneyAccounts(ClaimsPrincipal u) => Ids(u, "moneyAccounts");

    /// <summary>Only these sales departments; null = every department.</summary>
    public static Guid[]? Departments(ClaimsPrincipal u) => Ids(u, "departments");

    public static bool CanUseDepartment(ClaimsPrincipal u, Guid departmentId) =>
        Departments(u) is not { } mine || mine.Contains(departmentId);

    /// <summary>The most discount the person may give (% of a line's worth); null = no limit.</summary>
    public static int? MaxDiscount(ClaimsPrincipal u) =>
        int.TryParse(u.FindFirst("maxDiscount")?.Value, out var p) ? p : null;

    /// <summary>Sales documents of the person's departments, and those of no department.</summary>
    public static IQueryable<SalesDocument> InDepartments(this IQueryable<SalesDocument> q, ClaimsPrincipal u)
    {
        if (Departments(u) is not { } mine) return q;
        var list = new IdList(mine);
        return q.Where(d => d.DepartmentId == null || list.Ids.Contains(d.DepartmentId.Value));
    }

    /// <summary>Rows of the person's branches only (all rows for everyone-branch people).</summary>
    public static IQueryable<T> InBranches<T>(this IQueryable<T> q, ClaimsPrincipal u, Expression<Func<T, Guid>> branchOf)
    {
        if (Branches(u) is not { } branches) return q;
        var holder = Expression.Property(Expression.Constant(new IdList(branches)), nameof(IdList.Ids));
        var body = Expression.Call(typeof(Enumerable), nameof(Enumerable.Contains), new[] { typeof(Guid) }, holder, branchOf.Body);
        return q.Where(Expression.Lambda<Func<T, bool>>(body, branchOf.Parameters));
    }

    /// <summary>The claims a token carries for this access.</summary>
    public static IEnumerable<Claim> Claims(StaffAccess access)
    {
        if (access.AllBranches) yield return new Claim("allBranches", "1");
        else yield return new Claim("branches", string.Join(',', access.Branches.Select(b => b.Id)));
        if (access.Warehouses is { } w) yield return new Claim("warehouses", string.Join(',', w));
        if (access.MoneyAccounts is { } m) yield return new Claim("moneyAccounts", string.Join(',', m));
        if (access.Departments is { } d) yield return new Claim("departments", string.Join(',', d));
        if (access.MaxDiscountPercent is int max) yield return new Claim("maxDiscount", max.ToString());
    }

    /// <summary>
    /// Middleware: the branch picked in the app becomes the request's working branch, when the person
    /// may use it. Anything else is ignored (they work in their own branch).
    /// </summary>
    public static async Task PickWorkingBranch(HttpContext ctx, Func<Task> next)
    {
        if (ctx.User.Identity is ClaimsIdentity { IsAuthenticated: true } identity
            && ctx.Request.Headers.TryGetValue(BranchHeader, out var raw)
            && Guid.TryParse(raw.ToString(), out var branch)
            && branch != Home(ctx.User)
            && CanUseBranch(ctx.User, branch)
            && await ExistsAsync(ctx, branch))
            identity.AddClaim(new Claim(WorkClaim, branch.ToString()));
        await next();
    }

    // Branches are never deleted, so one that exists is remembered for the life of the server.
    private static readonly System.Collections.Concurrent.ConcurrentDictionary<Guid, bool> Known = new();

    private static async Task<bool> ExistsAsync(HttpContext ctx, Guid branch)
    {
        if (Known.ContainsKey(branch)) return true;
        var db = ctx.RequestServices.GetRequiredService<AppDbContext>();
        if (!await db.Branches.AnyAsync(b => b.Id == branch)) return false;
        Known.TryAdd(branch, true);
        return true;
    }

    private static Guid[]? Ids(ClaimsPrincipal u, string claim)
    {
        var value = u.FindFirst(claim)?.Value;
        if (value is null) return null;
        return value.Split(',', StringSplitOptions.RemoveEmptyEntries)
            .Select(s => Guid.TryParse(s, out var g) ? g : Guid.Empty).Where(g => g != Guid.Empty).ToArray();
    }

    /// <summary>Holds a list so EF sends it as a query parameter.</summary>
    private sealed record IdList(Guid[] Ids);
}

/// <summary>A person's access, worked out from their staff record (see <see cref="Access"/>).</summary>
/// <param name="Branches">Their branches, their own first (every branch when <paramref name="AllBranches"/>).</param>
/// <param name="Warehouses">Only these warehouses; null = any in their branches.</param>
/// <param name="MoneyAccounts">Only these money accounts; null = any in their branches.</param>
/// <param name="Departments">Only these sales departments; null = every one.</param>
/// <param name="MaxDiscountPercent">The most discount they may give; null = no limit.</param>
public sealed record StaffAccess(
    bool AllBranches, IReadOnlyList<Branch> Branches, Guid[]? Warehouses, Guid[]? MoneyAccounts,
    Guid[]? Departments = null, int? MaxDiscountPercent = null);

/// <summary>What was just added, for <see cref="AccessService.KeepNewHiddenAsync"/>.</summary>
public enum NewKind { Branch, Warehouse, MoneyAccount, Department }

public sealed class AccessService
{
    private readonly AppDbContext _db;
    public AccessService(AppDbContext db) => _db = db;

    /// <summary>Does this role see every branch unless the owner narrows it? (Owner, admin, accountant.)</summary>
    public static bool RoleSeesAll(Role role) => role is Role.OWNER or Role.ADMIN or Role.ACCOUNTANT;

    public static bool SeesAll(Staff s) => s.Role == Role.OWNER || (s.AllBranches ?? RoleSeesAll(s.Role));

    /// <summary>
    /// Something new is hidden from everyone until they are given it (owner decision 2026-10-02):
    /// before a branch, warehouse, money account or department is added, each person (owners and
    /// admins aside) who sees "all" of that kind is given the list of what exists now, so the new one
    /// is not on it. The person adding it keeps seeing it. Call after adding it, before saving.
    /// </summary>
    public async Task KeepNewHiddenAsync(NewKind kind, Guid newId, string? creatorId)
    {
        if (!await _db.CompanySettings.Select(x => x.HideNewPlaces).FirstOrDefaultAsync()) return;
        Guid.TryParse(creatorId, out var creator);
        var people = await _db.Staff.Where(s => s.IsActive && s.Role != Role.OWNER && s.Role != Role.ADMIN).ToListAsync();
        if (people.Count == 0) return;
        var branches = await _db.Branches.Where(b => b.Id != newId).Select(b => b.Id).ToListAsync();
        foreach (var s in people)
        {
            var mine = s.Id == creator;
            switch (kind)
            {
                case NewKind.Branch:
                    if (SeesAll(s))
                    {
                        s.AllBranches = false;
                        s.BranchIds = branches.Where(b => b != s.BranchId).ToList();
                    }
                    if (mine && !s.BranchIds.Contains(newId)) s.BranchIds.Add(newId);
                    break;
                case NewKind.Warehouse:
                    if (s.WarehouseIds.Count == 0)
                        s.WarehouseIds = await _db.Warehouses.Where(w => w.Id != newId && w.Kind == WarehouseKind.STORE
                                && (SeesAll(s) || w.BranchId == s.BranchId || s.BranchIds.Contains(w.BranchId)))
                            .Select(w => w.Id).ToListAsync();
                    if (mine && !s.WarehouseIds.Contains(newId)) s.WarehouseIds.Add(newId);
                    break;
                case NewKind.MoneyAccount:
                    if (s.MoneyAccountIds.Count == 0)
                        s.MoneyAccountIds = await _db.MoneyAccounts.Where(a => a.Id != newId
                                && (SeesAll(s) || a.BranchId == s.BranchId || s.BranchIds.Contains(a.BranchId)))
                            .Select(a => a.Id).ToListAsync();
                    if (mine && !s.MoneyAccountIds.Contains(newId)) s.MoneyAccountIds.Add(newId);
                    break;
                case NewKind.Department:
                    if (s.DepartmentIds.Count == 0)
                        s.DepartmentIds = await _db.Departments.Where(d => d.Id != newId).Select(d => d.Id).ToListAsync();
                    if (mine && !s.DepartmentIds.Contains(newId)) s.DepartmentIds.Add(newId);
                    break;
            }
        }
    }

    public async Task<StaffAccess> ForAsync(Staff staff)
    {
        var all = SeesAll(staff);
        var branches = await _db.Branches.AsNoTracking()
            .Where(b => all || b.Id == staff.BranchId || staff.BranchIds.Contains(b.Id))
            .OrderBy(b => b.CreatedAt).ToListAsync();
        var mine = branches.Where(b => b.Id == staff.BranchId).Concat(branches.Where(b => b.Id != staff.BranchId)).ToList();
        var ids = mine.Select(b => b.Id).ToList();

        // A list that names nothing that still exists stays a (now empty) list: narrowing never widens.
        Guid[]? warehouses = null, accounts = null;
        if (staff.Role != Role.OWNER && staff.WarehouseIds.Count > 0)
            warehouses = await _db.Warehouses.Where(w => staff.WarehouseIds.Contains(w.Id) && ids.Contains(w.BranchId))
                .Select(w => w.Id).ToArrayAsync();
        if (staff.Role != Role.OWNER && staff.MoneyAccountIds.Count > 0)
            accounts = await _db.MoneyAccounts.Where(a => staff.MoneyAccountIds.Contains(a.Id) && ids.Contains(a.BranchId))
                .Select(a => a.Id).ToArrayAsync();
        Guid[]? departments = null;
        if (staff.Role != Role.OWNER && staff.DepartmentIds.Count > 0)
            departments = await _db.Departments.Where(d => staff.DepartmentIds.Contains(d.Id))
                .Select(d => d.Id).ToArrayAsync();
        return new StaffAccess(all, mine, warehouses, accounts, departments, await MaxDiscountAsync(staff));
    }

    /// <summary>The person's discount limit: their own, else the company's; the owner has none (null).</summary>
    public async Task<int?> MaxDiscountAsync(Staff staff)
    {
        if (staff.Role == Role.OWNER) return null;
        var max = staff.MaxDiscountPercent
            ?? await _db.CompanySettings.AsNoTracking().Select(s => (int?)s.MaxDiscountPercent).FirstOrDefaultAsync()
            ?? 100;
        return max >= 100 ? null : Math.Max(0, max);
    }
}
