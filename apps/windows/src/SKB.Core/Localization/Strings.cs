namespace SKB.Core.Localization;

/// <summary>
/// Bilingual dictionary for the Windows app, matching the shared web dictionary so the
/// two clients speak the same business terminology. Keys are dotted; look-ups fall back
/// to the key itself if missing.
/// </summary>
public static class Strings
{
    public static readonly IReadOnlyDictionary<string, string> En = new Dictionary<string, string>
    {
        ["app.name"] = "SKB",
        ["app.tagline"] = "Wholesale Accounting",

        ["common.search"] = "Search",
        ["common.total"] = "Total",
        ["common.status"] = "Status",
        ["common.date"] = "Date",
        ["common.retry"] = "Retry",
        ["common.loading"] = "Loading…",
        ["common.empty"] = "Nothing to show yet",
        ["common.errorTitle"] = "Something went wrong",
        ["common.errorBody"] = "Please try again.",

        ["conn.online"] = "Online",
        ["conn.connecting"] = "Connecting…",
        ["conn.offline"] = "Offline",
        ["offline.title"] = "Not connected to the server",
        ["offline.body"] = "For security, data is only available while connected to your company server. Reconnect to continue.",
        ["offline.reconnect"] = "Reconnect",

        ["pref.language"] = "Language",
        ["pref.theme"] = "Theme",

        ["auth.signIn"] = "Sign in",
        ["auth.signOut"] = "Sign out",
        ["auth.email"] = "Email or staff ID",
        ["auth.password"] = "Password",
        ["auth.rememberDevice"] = "Remember this device",
        ["auth.forgotPassword"] = "Forgot password?",
        ["auth.signingIn"] = "Signing in…",
        ["auth.invalidCredentials"] = "Incorrect email or password.",
        ["auth.welcome"] = "Sign in to your workspace",
        ["auth.serverHealthy"] = "Server reachable",
        ["auth.serverUnreachable"] = "Server unreachable",

        ["nav.dashboard"] = "Dashboard",
        ["nav.sales"] = "Sales",
        ["nav.purchases"] = "Purchases",
        ["nav.receipts"] = "Receipts & Payments",
        ["nav.parties"] = "Customers & Suppliers",
        ["nav.inventory"] = "Inventory",
        ["nav.analytics"] = "Analytics & Reports",
        ["nav.settings"] = "Settings",

        ["kpi.revenue"] = "Revenue",
        ["kpi.purchases"] = "Purchases",
        ["kpi.receivables"] = "Receivables",
        ["kpi.payables"] = "Payables",
        ["kpi.lowStock"] = "Low stock items",
        ["kpi.cashPosition"] = "Cash position",
        ["dashboard.trend"] = "Sales vs. purchases",
        ["dashboard.lowStock"] = "Low stock alerts",
        ["dashboard.recent"] = "Recent documents",

        ["sales.invoices"] = "Sales invoices",
        ["sales.number"] = "Number",
        ["sales.customer"] = "Customer",
        ["sales.preview"] = "Document preview",
        ["sales.qty"] = "Qty",
        ["sales.unitPrice"] = "Unit price",
        ["sales.subtotal"] = "Subtotal",
        ["sales.discount"] = "Discount",
        ["sales.tax"] = "Tax",
        ["sales.paid"] = "Paid",
        ["sales.outstanding"] = "Outstanding",
        ["sales.issuedBy"] = "Issued by",

        ["parties.customer"] = "Customer",
        ["parties.supplier"] = "Supplier",
        ["parties.factory"] = "Factory",
        ["parties.theyOweUs"] = "They owe us",
        ["parties.weOweThem"] = "We owe them",
        ["parties.settled"] = "Settled",

        ["status.DRAFT"] = "Draft",
        ["status.PENDING"] = "Pending",
        ["status.CONFIRMED"] = "Confirmed",
        ["status.PAID"] = "Paid",
        ["status.PARTIALLY_PAID"] = "Partially paid",
        ["status.OVERDUE"] = "Overdue",
        ["status.CANCELLED"] = "Cancelled",
        ["status.RETURNED"] = "Returned",

        ["role.OWNER"] = "Owner",
        ["role.ADMIN"] = "Admin",
        ["role.ACCOUNTANT"] = "Accountant",
        ["role.SALES"] = "Sales",
        ["role.INVENTORY"] = "Inventory",
        ["role.VIEWER"] = "Viewer",
    };

    public static readonly IReadOnlyDictionary<string, string> Ar = new Dictionary<string, string>
    {
        ["app.name"] = "SKB",
        ["app.tagline"] = "محاسبة الجملة",

        ["common.search"] = "بحث",
        ["common.total"] = "الإجمالي",
        ["common.status"] = "الحالة",
        ["common.date"] = "التاريخ",
        ["common.retry"] = "إعادة المحاولة",
        ["common.loading"] = "جارٍ التحميل…",
        ["common.empty"] = "لا توجد بيانات بعد",
        ["common.errorTitle"] = "حدث خطأ ما",
        ["common.errorBody"] = "يرجى المحاولة مرة أخرى.",

        ["conn.online"] = "متصل",
        ["conn.connecting"] = "جارٍ الاتصال…",
        ["conn.offline"] = "غير متصل",
        ["offline.title"] = "غير متصل بالخادم",
        ["offline.body"] = "حفاظًا على الأمان، تتوفر البيانات فقط عند الاتصال بخادم الشركة. أعد الاتصال للمتابعة.",
        ["offline.reconnect"] = "إعادة الاتصال",

        ["pref.language"] = "اللغة",
        ["pref.theme"] = "المظهر",

        ["auth.signIn"] = "تسجيل الدخول",
        ["auth.signOut"] = "تسجيل الخروج",
        ["auth.email"] = "البريد الإلكتروني أو رقم الموظف",
        ["auth.password"] = "كلمة المرور",
        ["auth.rememberDevice"] = "تذكّر هذا الجهاز",
        ["auth.forgotPassword"] = "نسيت كلمة المرور؟",
        ["auth.signingIn"] = "جارٍ تسجيل الدخول…",
        ["auth.invalidCredentials"] = "البريد الإلكتروني أو كلمة المرور غير صحيحة.",
        ["auth.welcome"] = "سجّل الدخول إلى مساحة العمل",
        ["auth.serverHealthy"] = "الخادم متاح",
        ["auth.serverUnreachable"] = "تعذّر الوصول إلى الخادم",

        ["nav.dashboard"] = "لوحة التحكم",
        ["nav.sales"] = "المبيعات",
        ["nav.purchases"] = "المشتريات",
        ["nav.receipts"] = "سندات القبض والصرف",
        ["nav.parties"] = "العملاء والموردون",
        ["nav.inventory"] = "المخزون",
        ["nav.analytics"] = "التحليلات والتقارير",
        ["nav.settings"] = "الإعدادات",

        ["kpi.revenue"] = "الإيرادات",
        ["kpi.purchases"] = "المشتريات",
        ["kpi.receivables"] = "حسابات مدينة",
        ["kpi.payables"] = "حسابات دائنة",
        ["kpi.lowStock"] = "أصناف منخفضة المخزون",
        ["kpi.cashPosition"] = "الوضع النقدي",
        ["dashboard.trend"] = "المبيعات مقابل المشتريات",
        ["dashboard.lowStock"] = "تنبيهات انخفاض المخزون",
        ["dashboard.recent"] = "أحدث المستندات",

        ["sales.invoices"] = "فواتير المبيعات",
        ["sales.number"] = "الرقم",
        ["sales.customer"] = "العميل",
        ["sales.preview"] = "معاينة المستند",
        ["sales.qty"] = "الكمية",
        ["sales.unitPrice"] = "سعر الوحدة",
        ["sales.subtotal"] = "الإجمالي الفرعي",
        ["sales.discount"] = "الخصم",
        ["sales.tax"] = "الضريبة",
        ["sales.paid"] = "المدفوع",
        ["sales.outstanding"] = "المتبقي",
        ["sales.issuedBy"] = "حرّرها",

        ["parties.customer"] = "عميل",
        ["parties.supplier"] = "مورد",
        ["parties.factory"] = "مصنع",
        ["parties.theyOweUs"] = "لنا عليهم",
        ["parties.weOweThem"] = "لهم علينا",
        ["parties.settled"] = "مسوّى",

        ["status.DRAFT"] = "مسودة",
        ["status.PENDING"] = "قيد الانتظار",
        ["status.CONFIRMED"] = "مؤكدة",
        ["status.PAID"] = "مدفوعة",
        ["status.PARTIALLY_PAID"] = "مدفوعة جزئيًا",
        ["status.OVERDUE"] = "متأخرة",
        ["status.CANCELLED"] = "ملغاة",
        ["status.RETURNED"] = "مرتجعة",

        ["role.OWNER"] = "المالك",
        ["role.ADMIN"] = "مدير",
        ["role.ACCOUNTANT"] = "محاسب",
        ["role.SALES"] = "مبيعات",
        ["role.INVENTORY"] = "مخزون",
        ["role.VIEWER"] = "مطالع",
    };

    public static string Get(string locale, string key)
    {
        var dict = locale == "ar" ? Ar : En;
        return dict.TryGetValue(key, out var value) ? value : key;
    }
}
