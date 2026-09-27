using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using SKB.Core.Models;

namespace SKB.Core.Api;

/// <summary>
/// Talks to the same NestJS server the web/PWA uses. Sends the access token as a Bearer
/// header, keeps the httpOnly refresh cookie in a CookieContainer, and transparently
/// refreshes once on a 401.
/// </summary>
public sealed class ApiClient
{
    private readonly HttpClient _http;
    private readonly SessionState _session;
    private readonly JsonSerializerOptions _json = new()
    {
        PropertyNameCaseInsensitive = true,
    };

    public ApiClient(string baseUrl, SessionState session)
    {
        _session = session;
        var handler = new HttpClientHandler
        {
            CookieContainer = new CookieContainer(),
            UseCookies = true,
            AllowAutoRedirect = false,
        };
        _http = new HttpClient(handler)
        {
            BaseAddress = new Uri(baseUrl.TrimEnd('/') + "/api/"),
            Timeout = TimeSpan.FromSeconds(20),
        };
    }

    public async Task<bool> HealthAsync(CancellationToken ct = default)
    {
        try
        {
            using var res = await _http.GetAsync("health", ct).ConfigureAwait(false);
            return res.IsSuccessStatusCode;
        }
        catch
        {
            return false;
        }
    }

    public async Task<AuthUser> LoginAsync(string email, string password, bool remember, CancellationToken ct = default)
    {
        using var req = new HttpRequestMessage(HttpMethod.Post, "auth/login")
        {
            Content = JsonContent.Create(new { email, password, rememberDevice = remember }),
        };
        using var res = await _http.SendAsync(req, ct).ConfigureAwait(false);
        if (res.StatusCode == HttpStatusCode.Unauthorized)
            throw new ApiException(401, "Incorrect email or password", "INVALID_CREDENTIALS");
        await EnsureSuccess(res).ConfigureAwait(false);

        var payload = await res.Content.ReadFromJsonAsync<LoginResponse>(_json, ct).ConfigureAwait(false)
                      ?? throw new ApiException(500, "Empty login response");
        _session.AccessToken = payload.AccessToken;
        _session.User = payload.User;
        return payload.User;
    }

    public async Task<bool> RefreshAsync(CancellationToken ct = default)
    {
        try
        {
            using var res = await _http.PostAsync("auth/refresh", null, ct).ConfigureAwait(false);
            if (!res.IsSuccessStatusCode) return false;
            var payload = await res.Content.ReadFromJsonAsync<LoginResponse>(_json, ct).ConfigureAwait(false);
            if (payload is null) return false;
            _session.AccessToken = payload.AccessToken;
            _session.User = payload.User;
            return true;
        }
        catch
        {
            return false;
        }
    }

    public async Task LogoutAsync(CancellationToken ct = default)
    {
        try
        {
            using var req = Authorized(HttpMethod.Post, "auth/logout");
            using var _ = await _http.SendAsync(req, ct).ConfigureAwait(false);
        }
        catch
        {
            // best-effort
        }
        finally
        {
            _session.Clear();
        }
    }

    public Task<DashboardData> GetDashboardAsync(CancellationToken ct = default) =>
        GetAsync<DashboardData>("dashboard", ct);

    public Task<Paginated<SalesDocumentSummary>> GetSalesInvoicesAsync(int page = 1, CancellationToken ct = default) =>
        GetAsync<Paginated<SalesDocumentSummary>>($"sales/invoices?page={page}&pageSize=20", ct);

    public Task<SalesDocument> GetSalesInvoiceAsync(string id, CancellationToken ct = default) =>
        GetAsync<SalesDocument>($"sales/invoices/{id}", ct);

    public Task<Paginated<PartyDto>> GetPartiesAsync(int page = 1, CancellationToken ct = default) =>
        GetAsync<Paginated<PartyDto>>($"parties?page={page}&pageSize=20", ct);

    private async Task<T> GetAsync<T>(string path, CancellationToken ct, bool retried = false)
    {
        using var req = Authorized(HttpMethod.Get, path);
        using var res = await _http.SendAsync(req, ct).ConfigureAwait(false);

        if (res.StatusCode == HttpStatusCode.Unauthorized && !retried)
        {
            if (await RefreshAsync(ct).ConfigureAwait(false))
                return await GetAsync<T>(path, ct, retried: true).ConfigureAwait(false);
            _session.Clear();
        }

        await EnsureSuccess(res).ConfigureAwait(false);
        return await res.Content.ReadFromJsonAsync<T>(_json, ct).ConfigureAwait(false)
               ?? throw new ApiException((int)res.StatusCode, "Empty response");
    }

    private HttpRequestMessage Authorized(HttpMethod method, string path)
    {
        var req = new HttpRequestMessage(method, path);
        if (!string.IsNullOrEmpty(_session.AccessToken))
            req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", _session.AccessToken);
        return req;
    }

    private static async Task EnsureSuccess(HttpResponseMessage res)
    {
        if (res.IsSuccessStatusCode) return;
        string message = res.ReasonPhrase ?? "Request failed";
        string? code = null;
        try
        {
            using var doc = JsonDocument.Parse(await res.Content.ReadAsStringAsync().ConfigureAwait(false));
            if (doc.RootElement.TryGetProperty("message", out var m)) message = m.ToString();
            if (doc.RootElement.TryGetProperty("code", out var c)) code = c.ToString();
        }
        catch
        {
            // non-JSON body; keep the reason phrase
        }
        throw new ApiException((int)res.StatusCode, message, code);
    }
}
