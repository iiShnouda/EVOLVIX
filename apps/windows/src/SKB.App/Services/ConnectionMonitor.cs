using System.Windows.Threading;
using SKB.App.Infrastructure;
using SKB.Core.Api;

namespace SKB.App.Services;

/// <summary>
/// Polls the server health endpoint. Because the app is server-authoritative, this state
/// decides whether data screens are shown or the offline gate takes over.
/// </summary>
public sealed class ConnectionMonitor : ObservableObject
{
    private readonly ApiClient _api;
    private readonly DispatcherTimer _timer;
    private string _state = "connecting";

    public ConnectionMonitor(ApiClient api)
    {
        _api = api;
        _timer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(15) };
        _timer.Tick += async (_, _) => await PingAsync().ConfigureAwait(true);
    }

    public string State
    {
        get => _state;
        private set
        {
            if (SetProperty(ref _state, value))
            {
                OnPropertyChanged(nameof(IsOnline));
                OnPropertyChanged(nameof(IsOffline));
            }
        }
    }

    public bool IsOnline => _state == "online";
    public bool IsOffline => _state == "offline";

    public void Start()
    {
        _ = PingAsync();
        _timer.Start();
    }

    public async Task PingAsync()
    {
        var ok = await _api.HealthAsync().ConfigureAwait(true);
        State = ok ? "online" : "offline";
    }
}
