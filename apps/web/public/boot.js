// The start-up splash (index.html). A file of its own, not inline, so the server's
// Content-Security-Policy can refuse every inline script.
//
// The splash shows ONE language — the last one used on this device (Arabic by default for a new
// install). The app's own language preference is kept under "skb.prefs"; read it so the splash
// matches, and set the page direction before anything paints.
(function () {
  var ar = true;
  try {
    var p = JSON.parse(localStorage.getItem('skb.prefs') || '{}');
    if (p && p.state && p.state.locale === 'en') ar = false;
  } catch (e) {
    /* default to Arabic */
  }
  document.documentElement.lang = ar ? 'ar' : 'en';
  document.documentElement.dir = ar ? 'rtl' : 'ltr';
  var msg = document.getElementById('boot-msg');
  if (msg) msg.textContent = ar ? 'جارٍ التشغيل…' : 'Starting…';
  var retry = document.getElementById('boot-retry');
  if (retry) {
    retry.textContent = ar ? 'إعادة المحاولة' : 'Retry';
    retry.addEventListener('click', function () {
      location.reload();
    });
  }
  // If the app hasn't taken the splash away after a while, the code didn't load or the server is down.
  setTimeout(function () {
    var boot = document.getElementById('boot');
    if (!boot) return; // the app is up and took the splash away — all good.
    boot.className = 'failed';
    var msg = document.getElementById('boot-msg');
    if (msg)
      msg.textContent = ar
        ? 'الخادم غير متاح حالياً. تأكد أن السيرفر يعمل ثم أعد المحاولة.'
        : 'The server is unavailable. Make sure it is running, then retry.';
  }, 12000);
})();
