package com.skb.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.net.Uri;

/** The company server this app opens: the company server (the office Raspberry Pi by default). */
final class ServerConfig {
    static final String DEFAULT_URL = "http://192.168.100.63:8080";
    private static final String PREFS = "skb";
    private static final String KEY = "server";

    private ServerConfig() {}

    static String get(Context context) {
        SharedPreferences p = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        return p.getString(KEY, DEFAULT_URL);
    }

    static void set(Context context, String url) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY, url).apply();
    }

    /**
     * A usable server address, or null. Accepts "http(s)://host[:port]" (a path is dropped) and
     * adds https:// when no scheme is typed.
     */
    static String normalize(String input) {
        if (input == null) return null;
        String text = input.trim();
        if (text.isEmpty()) return null;
        if (!text.contains("://")) text = "https://" + text;
        Uri uri = Uri.parse(text);
        String scheme = uri.getScheme();
        String host = uri.getHost();
        if (host == null || host.isEmpty()) return null;
        if (!"https".equalsIgnoreCase(scheme) && !"http".equalsIgnoreCase(scheme)) return null;
        String port = uri.getPort() > 0 ? ":" + uri.getPort() : "";
        return scheme.toLowerCase() + "://" + host.toLowerCase() + port;
    }

    /** True when the page belongs to the configured server (same scheme, host and port). */
    static boolean isServerUrl(Context context, Uri url) {
        Uri server = Uri.parse(get(context));
        return url != null
                && server.getScheme() != null && server.getScheme().equalsIgnoreCase(url.getScheme())
                && server.getHost() != null && server.getHost().equalsIgnoreCase(url.getHost())
                && server.getPort() == url.getPort();
    }
}
