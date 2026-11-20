/**
 * System notifications while the app is open but in the background (owner, 2026-11-12): a browser
 * tab, the home-screen app, the Windows app (1.9+ shows the page's Web Notifications as Windows
 * notifications) and, when its shell offers it, the Android app (`window.SKBApp.notify`, 1.5+;
 * a tap comes back as the `skbapp:notification` event with the tag). Only the kind's title is shown — never an
 * amount or a name — since a lock screen is public. Nothing is kept on the device.
 */

interface ShellBridge {
  notify?: (title: string, tag: string) => void;
  /** Android 1.5+: 'granted' | 'default' | 'asking' | 'denied'. */
  notifyState?: () => string;
  /** Android 1.5+: ask the phone (Android 13+); answers the state, 'asking' while it asks. */
  notifyAsk?: () => string;
}

function shell(): ShellBridge | undefined {
  return (window as unknown as { SKBApp?: ShellBridge }).SKBApp;
}

export type DeviceState = 'granted' | 'default' | 'denied' | 'unsupported';

/** May this device show system notifications, and has the person allowed them? */
export function deviceState(): DeviceState {
  const bridge = shell();
  if (bridge?.notify) return bridge.notifyState ? fromShell(bridge.notifyState()) : 'granted';
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
  return Notification.permission;
}

function fromShell(state: string): DeviceState {
  if (state === 'asking') return 'default';
  return state === 'default' || state === 'denied' ? state : 'granted';
}

/** Ask to show notifications. Call from a click (browsers ignore it otherwise). */
export async function askDevice(): Promise<DeviceState> {
  if (deviceState() !== 'default') return deviceState();
  const bridge = shell();
  if (bridge?.notify) {
    // The Android app asks the phone; wait while the phone's question is showing (at most 2 min).
    try {
      let state = bridge.notifyAsk?.() ?? 'granted';
      for (let i = 0; state === 'asking' && i < 300; i++) {
        await new Promise((r) => setTimeout(r, 400));
        state = bridge.notifyState?.() ?? 'granted';
      }
    } catch {
      /* the shell said no */
    }
    return deviceState();
  }
  try {
    await Notification.requestPermission();
  } catch {
    /* an old browser: only the callback form, or none */
  }
  return deviceState();
}

/** What a tap on the Android app's notification opens, by its tag (the shell sends the tag back). */
const shellOpens = new Map<string, () => void>();
let shellListening = false;

function listenShell(): void {
  if (shellListening) return;
  shellListening = true;
  window.addEventListener('skbapp:notification', (e) => {
    const tag = (e as CustomEvent<unknown>).detail;
    if (typeof tag !== 'string') return;
    const open = shellOpens.get(tag);
    shellOpens.delete(tag);
    open?.();
  });
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
    shellOpens.set(tag, onOpen);
    if (shellOpens.size > 20) shellOpens.delete(shellOpens.keys().next().value as string);
    listenShell();
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
