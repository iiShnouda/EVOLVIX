using System.Globalization;

namespace SKB.Desktop;

/// <summary>The few words this window shows itself, in Arabic or English (following Windows).</summary>
internal static class Text
{
    public static bool Arabic => CultureInfo.CurrentUICulture.TwoLetterISOLanguageName == "ar";

    public static string ServerSettings => Arabic ? "عنوان الخادم…" : "Server address…";
    public static string SettingsTitle => Arabic ? "عنوان الخادم" : "Server address";
    public static string SettingsHint => Arabic
        ? "الخادم السحابي، أو خادم الشركة على شبكة المكتب (مثال: http://192.168.1.10:8080)."
        : "The cloud server, or your company server on the office network (for example http://192.168.1.10:8080).";
    public static string HttpWarning => Arabic
        ? "غير مشفّر: استخدم http:// داخل شبكة المكتب فقط."
        : "Not encrypted: use http:// only inside the office network.";
    public static string Invalid => Arabic
        ? "أدخل عنواناً مثل https://example.com أو http://192.168.1.10:8080"
        : "Enter an address like https://example.com or http://192.168.1.10:8080";
    public static string Save => Arabic ? "حفظ" : "Save";
    public static string Cancel => Arabic ? "إلغاء" : "Cancel";
    public static string Default => Arabic ? "الافتراضي" : "Default";
    public static string OfflineTitle => Arabic ? "تعذّر الوصول إلى الخادم" : "Can't reach the server";
    public static string OfflineBody => Arabic
        ? "تحقق من اتصال الإنترنت أو شبكة المكتب. الخادم:"
        : "Check the internet or office network connection. Server:";
    public static string Retry => Arabic ? "إعادة المحاولة" : "Try again";
    public static string NeedsWebView2 => Arabic
        ? "يحتاج Evolvix إلى مكوّن Microsoft Edge WebView2 (موجود في ويندوز 10/11 عادةً). هل تريد فتح صفحة التنزيل؟"
        : "Evolvix needs Microsoft Edge WebView2 (normally part of Windows 10/11). Open the download page?";
    public static string InstallAsk => Arabic
        ? "تثبيت Evolvix على هذا الجهاز؟\n\nسيُضاف إلى قائمة ابدأ وسطح المكتب، ويمكن إزالته من إعدادات ويندوز › التطبيقات."
        : "Install Evolvix on this computer?\n\nIt will be added to the Start menu and the desktop, and can be removed from Windows Settings › Apps.";
    public static string UninstallDone => Arabic ? "تمت إزالة Evolvix." : "Evolvix was removed.";
    public static string Starting => Arabic ? "جارٍ التشغيل…" : "Starting…";
    public static string ExitTitle => Arabic ? "إغلاق Evolvix" : "Close Evolvix";
    public static string ExitPrompt => Arabic ? "تحب تعمل إيه قبل الخروج؟" : "What would you like to do?";
    public static string ExitJustClose => Arabic ? "خروج" : "Exit";
    public static string ExitSignOut => Arabic ? "خروج وتسجيل الخروج" : "Exit and sign out";
}
