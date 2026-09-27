using System.Windows;
using SKB.App.ViewModels;

namespace SKB.App.Views;

public partial class LoginWindow : Window
{
    private readonly LoginViewModel _vm = new();

    public LoginWindow()
    {
        InitializeComponent();
        DataContext = _vm;
    }

    private async void SignInButton_Click(object sender, RoutedEventArgs e)
    {
        var ok = await _vm.SignInAsync(PasswordBox.Password);
        if (ok)
        {
            App.ShowShell();
        }
    }
}
