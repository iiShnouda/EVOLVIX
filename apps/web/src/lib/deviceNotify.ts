/**
 * System notifications while the app is open but in the background (owner, 2026-11-12): a browser
 * tab, the home-screen app, the Windows app (WebView2 shows Web Notifications) and, when its shell
 * offers it, the Android app (`window.SKBApp.notify`). Only the kind's title is shown — never an
 * amount or a name — since a lock screen is public. Nothing is kept on the device.
 */

interface ShellBridge {
  notify?: (title: string, tag: string) => void;
}

function shell(): ShellBridge | undefined {
  return (window as unknown as { SKBApp?: ShellBridge }).SKBApp;
}

export type DeviceState = 'granted' | 'default' | 'denied' | 'unsupported';

/** May this device show system notifications, and has the person allowed them? */
export function deviceState(): DeviceState {
  if (shell()?.notify) return 'granted';
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
  return Notification.permission;
}

/** Ask to show notifications. Call from a click (browsers ignore it otherwise). */
export async function askDevice(): Promise<DeviceState> {
  if (deviceState() !== 'default') return deviceState();
  try {
    await Notification.requestPermission();
  } catch {
    /* an old browser: only the callback form, or none */
  }
  return deviceState();
}

/** Show one, when the app is not in front. `onOpen` runs when it is clicked. */
export function showDevice(appName: string, title: string, tag: string, onOpen: () => void): void {
  if (
    typeof document !== 'undefined' &&
    document.visibilityState === 'visible' &&
    document.hasFocus()
  )
    return;
  const bridge = shell();
  if (bridge?.notify) {
    try {
      bridge.notify(title, tag);
    } catch {
      /* the shell said no */
    }
    return;
  }
  if (deviceState() !== 'granted') return;
  const options: NotificationOptions = { body: title, tag, icon: '/icon-192.png' };
  try {
    const n = new Notification(appName, options);
    n.onclick = () => {
      window.focus();
      onOpen();
      n.close();
    };
  } catch {
    // Chrome on Android and the iPhone home-screen app show them only through the service worker.
    void navigator.serviceWorker?.ready
      .then((r) => r.showNotification(appName, options))
      .catch(() => undefined);
  }
}

/** The unread count on the app's icon (home-screen apps that support it) and in the tab's title. */
export function showUnread(count: number): void {
  const nav = navigator as Navigator & {
    setAppBadge?: (n?: number) => Promise<void>;
    clearAppBadge?: () => Promise<void>;
  };
  try {
    if (count > 0) void nav.setAppBadge?.(count).catch(() => undefined);
    else void nav.clearAppBadge?.().catch(() => undefined);
  } catch {
    /* not offered */
  }
  const base = document.title.replace(/^\(\d+\+?\) /, '');
  document.title = count > 0 ? `(${count > 99 ? '99+' : count}) ${base}` : base;
}
