using SKB.App.Infrastructure;
using SKB.App.Services;
using SKB.Core.Api;

namespace SKB.App.ViewModels;

public sealed class LoginViewModel : ObservableObject
{
    public Localizer Loc => App.Loc;
    public ThemeManager Theme => App.Theme;
    public ConnectionMonitor Connection => App.Connection;

    private string _email = "owner@skb.local";
    public string Email { get => _email; set => SetProperty(ref _email, value); }

    private bool _remember = true;
    public bool Remember { get => _remember; set => SetProperty(ref _remember, value); }

    private string? _error;
    public string? Error { get => _error; set => SetProperty(ref _error, value); }

    private bool _isBusy;
    public bool IsBusy
    {
        get => _isBusy;
        set { if (SetProperty(ref _isBusy, value)) OnPropertyChanged(nameof(IsNotBusy)); }
    }

    public bool IsNotBusy => !_isBusy;

    public RelayCommand ToggleLanguageCommand { get; }
    public RelayCommand ToggleThemeCommand { get; }

    public LoginViewModel()
    {
        ToggleLanguageCommand = new RelayCommand(() => Loc.Toggle());
        ToggleThemeCommand = new RelayCommand(() => Theme.Toggle());
    }

    /// <summary>Called by the view (PasswordBox contents can't be data-bound securely).</summary>
    public async Task<bool> SignInAsync(string password)
    {
        Error = null;
        if (string.IsNullOrWhiteSpace(Email) || string.IsNullOrEmpty(password))
        {
            Error = Loc.T("auth.invalidCredentials");
            return false;
        }

        IsBusy = true;
        try
        {
            await App.Api.LoginAsync(Email.Trim(), password, Remember).ConfigureAwait(true);
            return true;
        }
        catch (ApiException ex) when (ex.Code == "INVALID_CREDENTIALS")
        {
            Error = Loc.T("auth.invalidCredentials");
            return false;
        }
        catch (ApiException ex)
        {
            Error = ex.Message;
            return false;
        }
        catch
        {
            Error = Loc.T("common.errorBody");
            return false;
        }
        finally
        {
            IsBusy = false;
        }
    }
}
