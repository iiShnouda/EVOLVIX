package com.skb.app;

import android.Manifest;
import android.app.Activity;
import android.app.DownloadManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.media.MediaRecorder;
import android.graphics.Typeface;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.print.PrintAttributes;
import android.print.PrintManager;
import android.text.TextUtils;
import android.util.Base64;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.URLUtil;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import org.json.JSONObject;

import java.io.File;
import java.io.IOException;
import java.io.OutputStream;
import java.nio.file.Files;

/**
 * SKB for Android. The whole app — screens, rules, data — lives on the company server; this
 * activity is a secure full-screen window onto it, so the app is always the latest version the
 * moment the server is updated. Only pages of the configured server open inside the app; any
 * other link opens in the phone's browser. When the server can't be reached, a local page offers
 * to retry or change the server address. Printing and saving files (Excel exports) go through
 * {@link Bridge}, because a WebView can't print or save a file made in the page on its own; so does
 * the microphone for talking with the assistant (owner, 2026-10-11), because a page opened over
 * plain http (the office address) may not use the browser's own. Over https the page's own
 * microphone is allowed for the server's pages. System notifications while the app is in the
 * background (owner, 2026-11-12) also go through it: only the app's name and the kind's title.
 */
public class MainActivity extends Activity {
    private static final int FILE_REQUEST = 1;
    private static final int SETTINGS_REQUEST = 2;
    private static final int SAVE_REQUEST = 3;
    private static final int MIC_REQUEST = 4;
    private static final int NOTIFY_REQUEST = 5;
    private static final String CHANNEL = "evolvix";
    private static final String EXTRA_TAG = "com.skb.app.NOTIFICATION_TAG";
    private static final String PREFS = "skb";
    private static final String NOTIFY_ASKED = "notifyAsked";
    /** A recording for the assistant is at most this long. */
    private static final int MAX_RECORDING_MS = 60_000;
    /** A file the page asked to save is at most this big. */
    private static final int MAX_SAVE_BYTES = 20 * 1024 * 1024;

    private WebView web;
    private View splash;
    private ValueCallback<Uri[]> pendingFiles;
    private String loadedServer;
    private byte[] pendingSave;
    private final Object micLock = new Object();
    private MediaRecorder recorder;
    private File recording;
    private volatile boolean micAsked;
    private volatile boolean micAnswered;
    private PermissionRequest pendingMic;
    /** The page now showing (set as each page starts), so the bridge serves only the server's pages. */
    private volatile String pageUrl;
    /** The phone is asking the person whether the app may notify. */
    private volatile boolean notifyAsking;
    /** A notification came before the person was ever asked: ask when they are back in the app. */
    private volatile boolean askNotifyOnResume;
    private volatile boolean resumed;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        web = new WebView(this);
        // The app's own name, shown big while the first page loads, so there is never a blank gap
        // before the server page (which has its own boot splash) appears (owner, 2026-10-13).
        FrameLayout root = new FrameLayout(this);
        root.addView(web, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
        splash = buildSplash();
        root.addView(splash, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
        setContentView(root);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        // The assistant reads its answers aloud right after they arrive (only the server's pages load here).
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setUserAgentString(s.getUserAgentString() + " SKBAndroid/" + versionName());

        CookieManager cookies = CookieManager.getInstance();
        cookies.setAcceptCookie(true);
        cookies.setAcceptThirdPartyCookies(web, false);

        // A light backdrop so the view is never a black flash while a page is still loading or while
        // the server is being reached (owner, 2026-10-12: "a black screen that tells me nothing").
        web.setBackgroundColor(0xFFF6F7FB);
        web.setWebViewClient(new Client());
        web.setWebChromeClient(new Chrome());
        web.addJavascriptInterface(new Bridge(), "SKBApp");
        web.setDownloadListener((url, userAgent, disposition, mime, length) -> download(url, disposition, mime));

        if (state != null) {
            web.restoreState(state);
            loadedServer = state.getString("server");
        } else {
            openServer();
        }
    }

    private View buildSplash() {
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setGravity(Gravity.CENTER);
        box.setBackgroundColor(0xFFF6F7FB);

        TextView name = new TextView(this);
        name.setText("Evolvix");
        name.setTextColor(0xFF4F46E5);
        name.setTextSize(TypedValue.COMPLEX_UNIT_SP, 34);
        name.setTypeface(Typeface.DEFAULT_BOLD);
        name.setGravity(Gravity.CENTER);
        box.addView(name);

        ProgressBar bar = new ProgressBar(this);
        LinearLayout.LayoutParams bp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        bp.topMargin = dp(22);
        box.addView(bar, bp);

        TextView sub = new TextView(this);
        sub.setText(getString(R.string.starting));
        sub.setTextColor(0xFF6B7280);
        sub.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
        sub.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams sp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        sp.topMargin = dp(16);
        box.addView(sub, sp);
        return box;
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private void hideSplash() {
        if (splash != null && splash.getVisibility() != View.GONE) splash.setVisibility(View.GONE);
    }

    private String versionName() {
        try {
            return getPackageManager().getPackageInfo(getPackageName(), 0).versionName;
        } catch (PackageManager.NameNotFoundException e) {
            return "1";
        }
    }

    private void openServer() {
        loadedServer = ServerConfig.get(this);
        web.loadUrl(loadedServer);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        // A notification was tapped: the page opens what it is about.
        String tag = intent.getStringExtra(EXTRA_TAG);
        if (tag != null && fromServer()) {
            web.evaluateJavascript("window.dispatchEvent(new CustomEvent('skbapp:notification',{detail:"
                    + JSONObject.quote(tag) + "}))", null);
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        resumed = true;
        if (askNotifyOnResume) {
            askNotifyOnResume = false;
            if (!notifyAsked()) askNotify();
        }
        // The address may have been changed from the launcher shortcut.
        if (loadedServer != null && !loadedServer.equals(ServerConfig.get(this))) openServer();
    }

    @Override
    protected void onPause() {
        super.onPause();
        resumed = false;
        CookieManager.getInstance().flush();
        // The microphone never listens with the app in the background.
        micCancel();
    }

    @Override
    public void onRequestPermissionsResult(int request, String[] permissions, int[] results) {
        if (request == NOTIFY_REQUEST) {
            notifyAsking = false;
            return;
        }
        if (request != MIC_REQUEST) {
            super.onRequestPermissionsResult(request, permissions, results);
            return;
        }
        micAnswered = true;
        boolean granted = results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED;
        PermissionRequest page = pendingMic;
        pendingMic = null;
        if (page != null) {
            if (granted) page.grant(new String[] {PermissionRequest.RESOURCE_AUDIO_CAPTURE});
            else page.deny();
        }
    }

    private boolean micAllowed() {
        return checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED;
    }

    private void askMic() {
        micAsked = true;
        runOnUiThread(() -> requestPermissions(new String[] {Manifest.permission.RECORD_AUDIO}, MIC_REQUEST));
    }

    /** True when the page now showing is the configured server's (the bridge serves only it). */
    private boolean fromServer() {
        String url = pageUrl;
        return url != null && ServerConfig.isServerUrl(this, Uri.parse(url));
    }

    // ---- System notifications ----

    private boolean notifyAsked() {
        return getSharedPreferences(PREFS, MODE_PRIVATE).getBoolean(NOTIFY_ASKED, false);
    }

    /** May the app notify: "granted", "default" (can be asked), "asking" or "denied". */
    private String notifyState() {
        if (notifyAsking) return "asking";
        NotificationManager nm = getSystemService(NotificationManager.class);
        boolean permitted = Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU
                || checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED;
        if (permitted) return nm != null && nm.areNotificationsEnabled() ? "granted" : "denied";
        // Android 13+: ask once; once more if the phone still offers it; then only from the phone's settings.
        if (!notifyAsked() || shouldShowRequestPermissionRationale(Manifest.permission.POST_NOTIFICATIONS)) return "default";
        return "denied";
    }

    /** Ask the person (Android 13+), from a tap in the bell's settings or once after a first notification. */
    private void askNotify() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU || notifyAsking) return;
        notifyAsking = true;
        getSharedPreferences(PREFS, MODE_PRIVATE).edit().putBoolean(NOTIFY_ASKED, true).apply();
        runOnUiThread(() -> requestPermissions(new String[] {Manifest.permission.POST_NOTIFICATIONS}, NOTIFY_REQUEST));
    }

    /** Post one: the app's name and the kind's title; the same tag replaces the earlier one. */
    private void postNotification(String title, String tag) {
        if (!"granted".equals(notifyState())) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU && !notifyAsked()) {
                if (resumed) askNotify();
                else askNotifyOnResume = true;
            }
            return;
        }
        NotificationManager nm = getSystemService(NotificationManager.class);
        if (nm == null) return;
        // Creating it again is harmless: it only updates the name (the phone's language may have changed).
        nm.createNotificationChannel(new NotificationChannel(
                CHANNEL, getString(R.string.app_name), NotificationManager.IMPORTANCE_DEFAULT));
        String text = TextUtils.isEmpty(title) ? getString(R.string.app_name)
                : title.length() > 120 ? title.substring(0, 120) : title;
        String key = TextUtils.isEmpty(tag) ? "skb" : tag.length() > 100 ? tag.substring(0, 100) : tag;
        Intent open = new Intent(this, MainActivity.class)
                .setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP)
                .putExtra(EXTRA_TAG, key);
        PendingIntent tap = PendingIntent.getActivity(this, key.hashCode(), open,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification n = new Notification.Builder(this, CHANNEL)
                .setSmallIcon(R.drawable.ic_notify)
                .setColor(0xFF4F46E5)
                .setContentTitle(getString(R.string.app_name))
                .setContentText(text)
                .setContentIntent(tap)
                .setAutoCancel(true)
                .setVisibility(Notification.VISIBILITY_PUBLIC)
                .build();
        try {
            nm.notify(key, 1, n);
        } catch (SecurityException ignored) {
            // The permission was taken back a moment ago.
        }
    }

    /** Start a recording: "ok", "asking" (the phone is asking the person), "denied" or "error". */
    private String micStart() {
        if (!micAllowed()) {
            if (!micAsked) {
                askMic();
                return "asking";
            }
            return micAnswered ? "denied" : "asking";
        }
        synchronized (micLock) {
            releaseRecorder();
            try {
                recording = File.createTempFile("talk", ".m4a", getCacheDir());
                recorder = new MediaRecorder();
                recorder.setAudioSource(MediaRecorder.AudioSource.VOICE_RECOGNITION);
                recorder.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4);
                recorder.setAudioEncoder(MediaRecorder.AudioEncoder.AAC);
                recorder.setAudioChannels(1);
                recorder.setAudioSamplingRate(16000);
                recorder.setAudioEncodingBitRate(32000);
                recorder.setMaxDuration(MAX_RECORDING_MS);
                recorder.setOutputFile(recording.getAbsolutePath());
                recorder.prepare();
                recorder.start();
                return "ok";
            } catch (IOException | RuntimeException e) {
                releaseRecorder();
                return "error";
            }
        }
    }

    /** How loud it has been since the last look, 0..1. */
    private double micLevel() {
        synchronized (micLock) {
            if (recorder == null) return 0;
            try {
                return recorder.getMaxAmplitude() / 32767.0;
            } catch (RuntimeException e) {
                return 0;
            }
        }
    }

    /** End the recording and hand it over (base64); nothing of it stays on the phone. */
    private String micStop() {
        synchronized (micLock) {
            if (recorder == null) return "";
            try {
                recorder.stop();
                recorder.release();
                recorder = null;
                return Base64.encodeToString(Files.readAllBytes(recording.toPath()), Base64.NO_WRAP);
            } catch (IOException | RuntimeException e) {
                return "";
            } finally {
                releaseRecorder();
            }
        }
    }

    private void micCancel() {
        synchronized (micLock) {
            releaseRecorder();
        }
    }

    private void releaseRecorder() {
        if (recorder != null) {
            try {
                recorder.release();
            } catch (RuntimeException ignored) {
                // already stopped
            }
            recorder = null;
        }
        if (recording != null) {
            //noinspection ResultOfMethodCallIgnored
            recording.delete();
            recording = null;
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        web.saveState(out);
        out.putString("server", loadedServer);
    }

    @Override
    public void onBackPressed() {
        if (web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onActivityResult(int request, int result, Intent data) {
        if (request == FILE_REQUEST && pendingFiles != null) {
            pendingFiles.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(result, data));
            pendingFiles = null;
        } else if (request == SETTINGS_REQUEST && result == RESULT_OK) {
            openServer();
        } else if (request == SAVE_REQUEST) {
            byte[] bytes = pendingSave;
            pendingSave = null;
            if (result == RESULT_OK && data != null && data.getData() != null && bytes != null) writeFile(data.getData(), bytes);
        } else {
            super.onActivityResult(request, result, data);
        }
    }

    @Override
    protected void onDestroy() {
        micCancel();
        web.destroy();
        super.onDestroy();
    }

    private void openSettings() {
        startActivityForResult(new Intent(this, SettingsActivity.class), SETTINGS_REQUEST);
    }

    /** Shown in place of the app when the server can't be reached. Text follows the phone language. */
    private void showOffline(String reason) {
        String html = "<!doctype html><html dir='" + getString(R.string.dir) + "'><head>"
                + "<meta name='viewport' content='width=device-width,initial-scale=1'>"
                + "<style>body{font-family:sans-serif;margin:0;min-height:100vh;display:grid;place-items:center;"
                + "background:#f6f7fb;color:#1f2937}main{max-width:320px;padding:24px;text-align:center}"
                + ".logo{font-size:28px;color:#4f46e5;font-weight:800;letter-spacing:-0.5px;"
                + "margin:0 auto 16px}h1{font-size:18px;margin:0 0 8px}"
                + "p{color:#6b7280;font-size:14px;margin:0 0 20px;word-break:break-word}"
                + "button{display:block;width:100%;height:44px;border-radius:10px;border:0;font-size:15px;margin-top:10px}"
                + ".primary{background:#4f46e5;color:#fff}.secondary{background:#e5e7eb;color:#111827}</style>"
                + "</head><body><main><div class='logo'>Evolvix</div>"
                + "<h1>" + TextUtils.htmlEncode(getString(R.string.offline_title)) + "</h1>"
                + "<p>" + TextUtils.htmlEncode(getString(R.string.offline_body, ServerConfig.get(this)))
                + (reason == null ? "" : "<br><small>" + TextUtils.htmlEncode(reason) + "</small>") + "</p>"
                + "<button class='primary' onclick='SKBApp.retry()'>" + TextUtils.htmlEncode(getString(R.string.retry)) + "</button>"
                + "<button class='secondary' onclick='SKBApp.settings()'>" + TextUtils.htmlEncode(getString(R.string.settings_title)) + "</button>"
                + "</main></body></html>";
        web.loadDataWithBaseURL(null, html, "text/html", "utf-8", null);
    }

    private void download(String url, String disposition, String mime) {
        try {
            DownloadManager.Request req = new DownloadManager.Request(Uri.parse(url));
            String cookie = CookieManager.getInstance().getCookie(url);
            if (cookie != null) req.addRequestHeader("Cookie", cookie);
            String name = URLUtil.guessFileName(url, disposition, mime);
            req.setTitle(name);
            req.setMimeType(mime);
            req.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
            req.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, name);
            ((DownloadManager) getSystemService(DOWNLOAD_SERVICE)).enqueue(req);
            Toast.makeText(this, R.string.downloading, Toast.LENGTH_SHORT).show();
        } catch (Exception e) {
            openExternal(Uri.parse(url));
        }
    }

    /** Print what the page shows (it has laid out the printout with its print styles). */
    private void print(String title) {
        String name = TextUtils.isEmpty(title) ? getString(R.string.app_name) : title;
        PrintManager pm = (PrintManager) getSystemService(PRINT_SERVICE);
        if (pm != null) pm.print(name, web.createPrintDocumentAdapter(name), new PrintAttributes.Builder().build());
    }

    /** Ask where to save a file the page made (the phone suggests Downloads); no storage permission needed. */
    private void save(String name, String mime, byte[] bytes) {
        pendingSave = bytes;
        Intent i = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        i.addCategory(Intent.CATEGORY_OPENABLE);
        i.setType(mime);
        i.putExtra(Intent.EXTRA_TITLE, name);
        try {
            startActivityForResult(i, SAVE_REQUEST);
        } catch (ActivityNotFoundException e) {
            pendingSave = null;
        }
    }

    private void writeFile(Uri uri, byte[] bytes) {
        try (OutputStream out = getContentResolver().openOutputStream(uri)) {
            if (out == null) throw new java.io.IOException("no stream");
            out.write(bytes);
            Toast.makeText(this, R.string.saved, Toast.LENGTH_SHORT).show();
        } catch (Exception e) {
            Toast.makeText(this, R.string.save_failed, Toast.LENGTH_SHORT).show();
        }
    }

    private void openExternal(Uri uri) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, uri));
        } catch (ActivityNotFoundException ignored) {
            // No app can open it: stay put.
        }
    }

    private final class Client extends WebViewClient {
        @Override
        public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
            pageUrl = url;
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            Uri url = request.getUrl();
            if (ServerConfig.isServerUrl(MainActivity.this, url)) return false;
            openExternal(url);
            return true;
        }

        @Override
        public void doUpdateVisitedHistory(WebView view, String url, boolean isReload) {
            pageUrl = url;
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            pageUrl = url;
            // The server page (or the offline page) is now showing — drop the startup splash.
            hideSplash();
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
            if (request.isForMainFrame()) showOffline(String.valueOf(error.getDescription()));
        }

        @Override
        public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse response) {
            // A server that is starting up or down answers 5xx for the page itself.
            if (request.isForMainFrame() && response.getStatusCode() >= 500) showOffline("HTTP " + response.getStatusCode());
        }
    }

    private final class Chrome extends WebChromeClient {
        /** Over https the server's pages may use the microphone (only it), once the person allows it. */
        @Override
        public void onPermissionRequest(PermissionRequest request) {
            boolean audioOnly = request.getResources().length == 1
                    && PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(request.getResources()[0]);
            if (!audioOnly || !ServerConfig.isServerUrl(MainActivity.this, request.getOrigin())) {
                request.deny();
            } else if (micAllowed()) {
                request.grant(new String[] {PermissionRequest.RESOURCE_AUDIO_CAPTURE});
            } else {
                if (pendingMic != null) pendingMic.deny();
                pendingMic = request;
                askMic();
            }
        }

        @Override
        public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
            if (pendingFiles != null) pendingFiles.onReceiveValue(null);
            pendingFiles = callback;
            try {
                startActivityForResult(params.createIntent(), FILE_REQUEST);
            } catch (ActivityNotFoundException e) {
                pendingFiles = null;
                return false;
            }
            return true;
        }
    }

    /**
     * Called from pages: the offline page's buttons (retry / open settings) and the server app's
     * print, save, microphone and notifications. Only the configured server's pages load in this
     * window, and all but the offline page's two buttons also check that the page calling is one.
     */
    private final class Bridge {
        @JavascriptInterface
        public void retry() {
            runOnUiThread(MainActivity.this::openServer);
        }

        @JavascriptInterface
        public void settings() {
            runOnUiThread(MainActivity.this::openSettings);
        }

        @JavascriptInterface
        public void print(String title) {
            if (!fromServer()) return;
            runOnUiThread(() -> MainActivity.this.print(title));
        }

        /** The microphone, for talking with the assistant (see {@link MainActivity#micStart}). */
        @JavascriptInterface
        public String micStart() {
            if (!fromServer()) return "denied";
            return MainActivity.this.micStart();
        }

        @JavascriptInterface
        public double micLevel() {
            if (!fromServer()) return 0;
            return MainActivity.this.micLevel();
        }

        @JavascriptInterface
        public String micStop() {
            if (!fromServer()) return "";
            return MainActivity.this.micStop();
        }

        @JavascriptInterface
        public void micCancel() {
            MainActivity.this.micCancel();
        }

        /** Save a file the page made: its name, type and contents (base64). */
        @JavascriptInterface
        public void saveFile(String name, String mime, String base64) {
            if (!fromServer()) return;
            if (base64 == null || base64.length() > MAX_SAVE_BYTES / 3 * 4 + 4) return;
            final byte[] bytes;
            try {
                bytes = Base64.decode(base64, Base64.DEFAULT);
            } catch (IllegalArgumentException e) {
                return;
            }
            String safe = name == null ? "" : name.replaceAll("[\\\\/:*?\"<>|\\p{Cntrl}]", "_").trim();
            String fileName = safe.isEmpty() ? "SKB" : safe.length() > 120 ? safe.substring(0, 120) : safe;
            String type = mime != null && mime.matches("[a-z]+/[a-z0-9.+-]+") ? mime : "application/octet-stream";
            runOnUiThread(() -> save(fileName, type, bytes));
        }

        /** A system notification while the app is in the background: the kind's title and a tag. */
        @JavascriptInterface
        public void notify(String title, String tag) {
            if (fromServer()) postNotification(title, tag);
        }

        /** "granted", "default", "asking" or "denied" (see {@link MainActivity#notifyState}). */
        @JavascriptInterface
        public String notifyState() {
            return fromServer() ? MainActivity.this.notifyState() : "denied";
        }

        /** Ask whether the app may notify (from a tap); answers the state now, "asking" while asking. */
        @JavascriptInterface
        public String notifyAsk() {
            if (!fromServer()) return "denied";
            if ("default".equals(MainActivity.this.notifyState())) askNotify();
            return MainActivity.this.notifyState();
        }
    }
}
