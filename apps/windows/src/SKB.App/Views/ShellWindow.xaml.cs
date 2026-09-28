using System.Windows;
using SKB.App.ViewModels;

namespace SKB.App.Views;

public partial class ShellWindow : Window
{
    public ShellWindow()
    {
        InitializeComponent();
        DataContext = new ShellViewModel();
    }
}
