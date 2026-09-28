using System.Text;
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
        };
    });

// --- Authorization: one policy per permission (checks the "permission" claim) ------------
builder.Services.AddAuthorization(options =>
{
    foreach (var perm in Permissions.All)
        options.AddPolicy(perm, policy => policy.RequireClaim("permission", perm));
});

// --- CORS (strict allow-list, credentials for the refresh cookie) -----------------------
var origins = builder.Configuration.GetSection("Cors:Origins").Get<string[]>()
              ?? new[] { "http://localhost:5173", "http://localhost:4173" };
builder.Services.AddCors(o => o.AddDefaultPolicy(p =>
    p.WithOrigins(origins).AllowAnyHeader().AllowAnyMethod().AllowCredentials()));

// --- Rate limiting (120 req/min/IP) -----------------------------------------------------
builder.Services.AddRateLimiter(options =>
{
    options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    options.GlobalLimiter = PartitionedRateLimiter.Create<HttpContext, string>(ctx =>
        RateLimitPartition.GetFixedWindowLimiter(
            ctx.Connection.RemoteIpAddress?.ToString() ?? "anon",
            _ => new FixedWindowRateLimiterOptions { PermitLimit = 120, Window = TimeSpan.FromMinutes(1) }));
});

builder.Services.AddControllers();
builder.Services.AddSignalR();

var app = builder.Build();

// --- Migrate + seed on startup ----------------------------------------------------------
using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
    var auth = scope.ServiceProvider.GetRequiredService<AuthService>();
    await DbSeeder.SeedAsync(db, auth, app.Configuration);
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
app.UseStaticFiles();

// Enable HTTPS redirection only when a certificate/HTTPS endpoint is configured.
if (builder.Configuration.GetValue<bool>("UseHttpsRedirection"))
    app.UseHttpsRedirection();

app.UseCors();
app.UseRateLimiter();
app.UseAuthentication();
app.UseAuthorization();

app.MapControllers();
app.MapHub<PresenceHub>("/hubs/presence");
// SPA fallback: any non-API, non-file route serves index.html so client-side routing works.
app.MapFallbackToFile("index.html");

app.Run();
