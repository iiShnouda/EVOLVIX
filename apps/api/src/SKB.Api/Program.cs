using System.Globalization;
using System.Text;
using Microsoft.AspNetCore.Localization;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using SKB.Api.Data;
using SKB.Api.Domain;
using SKB.Api.Hubs;
using SKB.Api.Services;

var builder = WebApplication.CreateBuilder(args);

// Allow running as a Windows Service (no-op when launched normally or on Linux/systemd).
builder.Host.UseWindowsService();

// Cloud hosts (Render / Fly / Cloud Run) inject the listen port via $PORT.
// Local dev uses launchSettings (:5080), so this only applies in the cloud.
var cloudPort = Environment.GetEnvironmentVariable("PORT");
if (!string.IsNullOrEmpty(cloudPort))
    builder.WebHost.UseUrls($"http://0.0.0.0:{cloudPort}");

// --- Database (PostgreSQL) with EF Core context pooling + Npgsql connection pooling ------
var connString = builder.Configuration.GetConnectionString("Default")
                 ?? throw new InvalidOperationException("ConnectionStrings:Default is required");
// Keep the server's plans for the queries the app repeats (prepared statements). Opening an
// invoice joins about ten tables: PostgreSQL took ~20 ms to plan it and 0.2 ms to run it, on every
// request. A server's own connection string can still set its own values.
var csb = new Npgsql.NpgsqlConnectionStringBuilder(connString);
if (csb.MaxAutoPrepare == 0) csb.MaxAutoPrepare = 100;
if (!connString.Contains("Auto Prepare Min Usages", StringComparison.OrdinalIgnoreCase)) csb.AutoPrepareMinUsages = 2;
connString = csb.ConnectionString;
builder.Services.AddDbContextPool<AppDbContext>(o => o.UseNpgsql(connString));

// --- Services ---------------------------------------------------------------------------
builder.Services.AddSingleton<CryptoService>();
builder.Services.AddSingleton<PresenceTracker>();
builder.Services.AddSingleton<IPasswordHasher<Staff>, PasswordHasher<Staff>>();
builder.Services.AddScoped<TokenService>();
builder.Services.AddScoped<AuditService>();
builder.Services.AddScoped<AuthService>();
builder.Services.AddScoped<InventoryService>();
builder.Services.AddScoped<ReturnsService>();
builder.Services.AddScoped<MoneyService>();
builder.Services.AddScoped<LedgerService>();
builder.Services.AddScoped<WarehouseService>();
// The offline assistant: a model server (Ollama) on the company's own machine (Assistant:* settings).
builder.Services.AddHttpClient<AssistantService>();
builder.Services.AddScoped<AssistantTools>();
builder.Services.AddScoped<SystemMonitor>();
builder.Services.AddSingleton<UpdateService>();
builder.Services.AddScoped<StockValuation>();
builder.Services.AddScoped<PermissionService>();
builder.Services.AddScoped<NotificationService>();
builder.Services.AddScoped<AccessService>();
builder.Services.AddScoped<BackupService>();
builder.Services.AddScoped<PayrollService>();
builder.Services.AddSingleton<BackupScheduler>();
builder.Services.AddHostedService(sp => sp.GetRequiredService<BackupScheduler>());
builder.Services.AddHostedService<Housekeeping>();


// --- Authentication (JWT bearer) --------------------------------------------------------
var jwtSecret = builder.Configuration["Jwt:AccessSecret"]
                ?? throw new InvalidOperationException("Jwt:AccessSecret is required");
builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(options =>
    {
        options.MapInboundClaims = false; // keep raw claim names: sub, role, permission, name
        options.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuer = true,
            ValidateAudience = true,
            ValidateLifetime = true,
            ValidateIssuerSigningKey = true,
            ValidIssuer = builder.Configuration["Jwt:Issuer"] ?? "skb",
            ValidAudience = builder.Configuration["Jwt:Audience"] ?? "skb",
            IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwtSecret)),
            NameClaimType = "name",
            RoleClaimType = "role",
            ClockSkew = TimeSpan.FromSeconds(30),
        };
        // Let SignalR carry the token via the query string on the hub path.
        options.Events = new JwtBearerEvents
        {
            OnMessageReceived = ctx =>
            {
                var accessToken = ctx.Request.Query["access_token"];
                if (!string.IsNullOrEmpty(accessToken) &&
                    ctx.HttpContext.Request.Path.StartsWithSegments("/hubs/presence"))
                {
                    ctx.Token = accessToken;
                }
                return Task.CompletedTask;
            },
            // One phone and one computer per account (owner, 2026-10-01; two at once 2026-10-12):
            // a token from a device the account has since left (a newer sign-in of the same kind)
            // no longer works; the other kind's device is unaffected.
            OnTokenValidated = async ctx =>
            {
                var sub = ctx.Principal?.FindFirst("sub")?.Value;
                if (!Guid.TryParse(sub, out var staffId)) return;
                var db = ctx.HttpContext.RequestServices.GetRequiredService<SKB.Api.Data.AppDbContext>();
                var current = await SKB.Api.Services.DeviceGate.CurrentAsync(db, staffId);
                if (current.Mobile is null && current.Desktop is null) return;
                var sid = ctx.Principal?.FindFirst(SKB.Api.Services.TokenService.DeviceClaim)?.Value;
                if (!Guid.TryParse(sid, out var device) || !SKB.Api.Services.DeviceGate.Allows(current, device))
                {
                    ctx.HttpContext.Items["signedInElsewhere"] = true;
                    ctx.Fail("Signed in on another device.");
                }
            },
            OnChallenge = async ctx =>
            {
                if (ctx.HttpContext.Items.ContainsKey("signedInElsewhere"))
                {
                    ctx.HandleResponse();
                    ctx.Response.StatusCode = 401;
                    await ctx.Response.WriteAsJsonAsync(new { message = "This account signed in on another device.", code = "SIGNED_IN_ELSEWHERE" });
                }
            },
        };
    });

// --- Authorization: one policy per permission (checks the "permission" claim) ------------
builder.Services.AddAuthorization(options =>
{
    foreach (var perm in Permissions.All)
        options.AddPolicy(perm, policy =>
        {
            policy.RequireClaim("permission", perm);
            // The owner's own permissions also need the owner's role (a forged grant can't pass).
            if (Permissions.OwnerOnly.Contains(perm)) policy.RequireClaim("role", nameof(Role.OWNER));
        });
});

// --- CORS (strict allow-list, credentials for the refresh cookie) -----------------------
var origins = builder.Configuration.GetSection("Cors:Origins").Get<string[]>()
              ?? new[] { "http://localhost:5173", "http://localhost:4173" };
builder.Services.AddCors(o => o.AddDefaultPolicy(p =>
    p.WithOrigins(origins).AllowAnyHeader().AllowAnyMethod().AllowCredentials()));

// --- Rate limiting ----------------------------------------------------------------------
// Signed-in requests are limited per user, so a whole office sharing one internet address
// doesn't throttle itself; anonymous requests (login, health) per client IP, which also caps
// password guessing. Limits per minute are configurable (RateLimit:UserPerMinute / IpPerMinute).
var userPerMinute = builder.Configuration.GetValue("RateLimit:UserPerMinute", 600);
var ipPerMinute = builder.Configuration.GetValue("RateLimit:IpPerMinute", 120);
builder.Services.AddRateLimiter(options =>
{
    options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    options.GlobalLimiter = PartitionedRateLimiter.Create<HttpContext, string>(ctx =>
    {
        var userId = ctx.User.FindFirst("sub")?.Value;
        return userId is not null
            ? RateLimitPartition.GetFixedWindowLimiter("user:" + userId,
                _ => new FixedWindowRateLimiterOptions { PermitLimit = userPerMinute, Window = TimeSpan.FromMinutes(1) })
            : RateLimitPartition.GetFixedWindowLimiter("ip:" + (ctx.Connection.RemoteIpAddress?.ToString() ?? "anon"),
                _ => new FixedWindowRateLimiterOptions { PermitLimit = ipPerMinute, Window = TimeSpan.FromMinutes(1) });
    });
});

builder.Services.AddControllers();
builder.Services.AddSignalR();

var app = builder.Build();

// --- Server commands: "backup <file>" and "restore <file>" run and exit (no web server) ----
if (args.Length > 0 && args[0] is "backup" or "restore")
{
    Environment.ExitCode = await BackupCommands.RunAsync(app.Services, args);
    return;
}

// --- Migrate + seed on startup ----------------------------------------------------------
using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
    var auth = scope.ServiceProvider.GetRequiredService<AuthService>();
    await DbSeeder.SeedAsync(db, auth, app.Configuration);
    // The chart of accounts, and the go-live opening entry the first time the ledger runs.
    await LedgerService.SetupAsync(db);
    // Business days follow the company's clock (Settings → time zone).
    var zone = await db.CompanySettings.Select(s => s.TimeZone).FirstOrDefaultAsync();
    if (!CompanyClock.Use(zone))
        app.Logger.LogWarning("Time zone {Zone} is not available here; business days use {Default}.", zone, CompanyClock.ZoneId);
}

// Behind a cloud load balancer (Render/Fly), trust the forwarded proto + client IP so
// HTTPS is detected and rate limiting keys on the real client, not the proxy.
var forwarded = new Microsoft.AspNetCore.Builder.ForwardedHeadersOptions
{
    ForwardedHeaders = Microsoft.AspNetCore.HttpOverrides.ForwardedHeaders.XForwardedFor
                       | Microsoft.AspNetCore.HttpOverrides.ForwardedHeaders.XForwardedProto,
};
forwarded.KnownNetworks.Clear();
forwarded.KnownProxies.Clear();
app.UseForwardedHeaders(forwarded);

// Serve the built web app (if present in wwwroot) from the SAME origin as the API, so the
// whole product is one deployable service on one URL. API-only mode still works when
// wwwroot is empty. The web app then calls the API with relative "/api" paths (no CORS).
app.UseDefaultFiles();
// The Android app download is an .apk, which ASP.NET doesn't know by default (it would 404).
var contentTypes = new Microsoft.AspNetCore.StaticFiles.FileExtensionContentTypeProvider();
contentTypes.Mappings[".apk"] = "application/vnd.android.package-archive";
// The app updates itself (owner decision 2026-09-30): the page, the service worker and the version
// file are always asked for again, so a new deploy is seen within a minute; the hashed code files
// never change under the same name, so they are kept.
static void CacheRules(Microsoft.AspNetCore.StaticFiles.StaticFileResponseContext ctx)
{
    var path = ctx.Context.Request.Path.Value ?? "";
    ctx.Context.Response.Headers.CacheControl = path.StartsWith("/assets/", StringComparison.Ordinal)
        ? "public, max-age=31536000, immutable"
        : "no-cache";
}
app.UseStaticFiles(new StaticFileOptions { ContentTypeProvider = contentTypes, OnPrepareResponse = CacheRules });

// Enable HTTPS redirection only when a certificate/HTTPS endpoint is configured.
if (builder.Configuration.GetValue<bool>("UseHttpsRedirection"))
    app.UseHttpsRedirection();

// Names come back in the caller's language (Accept-Language: ar|en). Only the UI culture follows
// the header; number and date formatting on the server stay invariant English.
app.UseRequestLocalization(new RequestLocalizationOptions
{
    DefaultRequestCulture = new RequestCulture("en"),
    SupportedCultures = new[] { new CultureInfo("en") },
    SupportedUICultures = new[] { new CultureInfo("en"), new CultureInfo("ar") },
});

app.UseCors();
app.UseAuthentication();   // before the limiter, so it can key on the signed-in user
app.Use(Access.PickWorkingBranch);   // the branch picked in the app, when the person may use it
app.UseRateLimiter();
app.UseAuthorization();

app.MapControllers();
app.MapHub<PresenceHub>("/hubs/presence");
// SPA fallback: any non-API, non-file route serves index.html so client-side routing works.
app.MapFallbackToFile("index.html", new StaticFileOptions { OnPrepareResponse = CacheRules });

app.Run();
