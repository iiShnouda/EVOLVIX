using System.Globalization;
using System.Windows;
using System.Windows.Data;
using System.Windows.Media;

namespace SKB.App.Infrastructure;

/// <summary>Maps a semantic "tone" string to the themed foreground brush.</summary>
public sealed class ToneToForegroundConverter : IValueConverter
{
    public object Convert(object value, Type targetType, object? parameter, CultureInfo culture)
    {
        var key = (value as string) switch
        {
            "positive" => "PositiveBrush",
            "warning" => "WarningBrush",
            "destructive" => "DestructiveBrush",
            "info" => "InfoBrush",
            "brand" => "BrandBrush",
            _ => "MutedBrush",
        };
        return Application.Current.Resources[key] ?? Brushes.Gray;
    }

    public object ConvertBack(object value, Type t, object? p, CultureInfo c) => Binding.DoNothing;
}

/// <summary>Maps a semantic "tone" string to the themed soft background brush.</summary>
public sealed class ToneToBackgroundConverter : IValueConverter
{
    public object Convert(object value, Type targetType, object? parameter, CultureInfo culture)
    {
        var key = (value as string) switch
        {
            "positive" => "PositiveSoftBrush",
            "warning" => "WarningSoftBrush",
            "destructive" => "DestructiveSoftBrush",
            "info" => "InfoSoftBrush",
            "brand" => "BrandSoftBrush",
            _ => "Surface2Brush",
        };
        return Application.Current.Resources[key] ?? Brushes.Transparent;
    }

    public object ConvertBack(object value, Type t, object? p, CultureInfo c) => Binding.DoNothing;
}

/// <summary>Visible when the bound string equals the ConverterParameter.</summary>
public sealed class StringEqualsToVisibilityConverter : IValueConverter
{
    public object Convert(object value, Type targetType, object? parameter, CultureInfo culture) =>
        string.Equals(value as string, parameter as string, StringComparison.Ordinal)
            ? Visibility.Visible
            : Visibility.Collapsed;

    public object ConvertBack(object value, Type t, object? p, CultureInfo c) => Binding.DoNothing;
}

/// <summary>Collapsed when the value is null; visible otherwise.</summary>
public sealed class NullToCollapsedConverter : IValueConverter
{
    public object Convert(object? value, Type targetType, object? parameter, CultureInfo culture) =>
        value is null ? Visibility.Collapsed : Visibility.Visible;

    public object ConvertBack(object value, Type t, object? p, CultureInfo c) => Binding.DoNothing;
}

/// <summary>Visible when the value IS null; collapsed otherwise (for empty states).</summary>
public sealed class NullToVisibleConverter : IValueConverter
{
    public object Convert(object? value, Type targetType, object? parameter, CultureInfo culture) =>
        value is null ? Visibility.Visible : Visibility.Collapsed;

    public object ConvertBack(object value, Type t, object? p, CultureInfo c) => Binding.DoNothing;
}

/// <summary>Inverts a boolean (for IsEnabled bindings while busy).</summary>
public sealed class InverseBooleanConverter : IValueConverter
{
    public object Convert(object value, Type targetType, object? parameter, CultureInfo culture) =>
        value is bool b && !b;

    public object ConvertBack(object value, Type t, object? p, CultureInfo c) =>
        value is bool b && !b;
}
