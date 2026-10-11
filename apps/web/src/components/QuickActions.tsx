import { useMemo, useRef, useState, type PointerEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from './Icon';
import { Sheet } from './Sheet';
import { Button } from './ui';
import { useT } from '../lib/i18n';
import { useAuth } from '../stores/auth';
import { usePrefs } from '../stores/prefs';
import { Logo } from './Logo';
import { useDeviceInfo } from '../lib/device';
import { useHiddenColumns } from '../lib/queries';
import { FROM_MENU, useTabs } from '../lib/tabs';
import { tabHasWork } from '../lib/workDraft';
import { useTabActions } from './shell/Tabs';
import {
  DEFAULT_QUICK,
  MAX_QUICK,
  NONE,
  QUICK_ACTIONS,
  mayUse,
  type QuickAction,
} from '../lib/quickActions';

const HOLD_MS = 500;

/** The person's own quick actions (kept on the server with their preferences). */
function useQuickChoice(): [QuickAction[], QuickAction[], (ids: string[]) => void] {
  const permissions = useAuth((s) => s.user?.permissions ?? []);
  const [saved, save] = useHiddenColumns('quick.actions');
  return useMemo(() => {
    const allowed = QUICK_ACTIONS.filter((a) => mayUse(a, permissions));
    const byId = new Map(allowed.map((a) => [a.id, a]));
    const ids = saved.length === 0 ? DEFAULT_QUICK : saved;
    const chosen = ids.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
    return [allowed, chosen, (next: string[]) => save(next.length ? next : [NONE])];
  }, [permissions, saved, save]);
}

/**
 * The quick-action button (owner, 2026-10-05; docked like an overlay 2026-10-06). A tap opens the
 * person's own shortcuts; holding it (or a right-click) lets them choose which, and in what order,
 * from every main action and page they may use. A shortcut opens in a new tab when the shown page
 * has unsaved work, so nothing is lost. Its shape is chosen on the Themes page (owner, 2026-10-11):
 * - dock: a tab on the screen's start edge that slides out under the mouse, dragged up or down;
 * - bubble: a round button floating over the page, dragged anywhere, settling on the nearer side;
 * - tab: a half-round tab always showing on the start edge, dragged up or down.
 */
export function QuickActions() {
  const { t, rtl } = useT();
  const navigate = useNavigate();
  const { open: openTab } = useTabActions();
  const { deviceClass } = useDeviceInfo();
  const touch = deviceClass !== 'desktop';
  const shape = usePrefs((s) => s.quickShape);
  const [allowed, chosen, save] = useQuickChoice();
  const [menu, setMenu] = useState(false);
  const [editing, setEditing] = useState(false);
  const [hover, setHover] = useState(false);
  const [y, setY] = useState(readY);
  const [spot, setSpot] = useState(readSpot);
  const [dragging, setDragging] = useState(false);
  const press = useRef<{
    startX: number;
    startY: number;
    startTop: number;
    startSpot: Spot;
    moved: boolean;
    timer?: number;
  } | null>(null);
  const bubble = shape === 'bubble';

  const go = (a: QuickAction) => {
    setMenu(false);
    if (tabHasWork(useTabs.getState().active)) openTab(a.path);
    else navigate(a.path, { state: FROM_MENU });
  };
  const customize = () => {
    setMenu(false);
    setEditing(true);
  };

  // Press: a tap opens the menu, holding still opens the chooser, moving drags it.
  const onDown = (e: PointerEvent<HTMLButtonElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = {
      startX: e.clientX,
      startY: e.clientY,
      startTop: y,
      startSpot: spot,
      moved: false,
      timer: 0,
    };
    p.timer = window.setTimeout(() => {
      if (!p.moved) {
        press.current = null;
        customize();
      }
    }, HOLD_MS);
    press.current = p;
  };
  const onMove = (e: PointerEvent<HTMLButtonElement>) => {
    const p = press.current;
    if (!p) return;
    const dx = e.clientX - p.startX;
    const dy = e.clientY - p.startY;
    if (!p.moved && Math.hypot(bubble ? dx : 0, dy) < 6) return;
    if (!p.moved) {
      p.moved = true;
      window.clearTimeout(p.timer);
      setDragging(true);
      setMenu(false);
    }
    if (bubble)
      setSpot({
        x: clampX(p.startSpot.x + (dx / window.innerWidth) * 100),
        y: clampY(p.startSpot.y + (dy / window.innerHeight) * 100),
      });
    else setY(clampY(p.startTop + (dy / window.innerHeight) * 100));
  };
  const onUp = () => {
    const p = press.current;
    press.current = null;
    if (!p) return;
    window.clearTimeout(p.timer);
    if (p.moved) {
      setDragging(false);
      if (bubble) {
        // It settles on the nearer side, out of the way of the page.
        const settled = { x: spot.x < 50 ? 0 : 100, y: spot.y };
        setSpot(settled);
        writeSpot(settled);
      } else writeY(y);
    } else setMenu((m) => !m);
  };

  if (allowed.length === 0) return null;
  const handlers = {
    onPointerDown: onDown,
    onPointerMove: onMove,
    onPointerUp: onUp,
    onPointerCancel: onUp,
    onContextMenu: (e: { preventDefault: () => void }) => {
      e.preventDefault();
      customize();
    },
  };
  const common = {
    type: 'button' as const,
    'data-quick-dock': true,
    'aria-label': t('qa.title'),
    title: t('qa.title'),
    'aria-expanded': menu,
    style: { touchAction: 'none', WebkitTouchCallout: 'none' } as const,
  };

  // Where the shortcuts open: beside the button, kept on the screen.
  const onLeft = bubble ? spot.x < 50 : !rtl;
  const top = bubble ? spot.y : y;
  const menuStyle = {
    top: `clamp(0.5rem, calc(${top}vh - 8rem), calc(100vh - 22rem))`,
    ...(onLeft ? { left: bubble ? '5rem' : '4rem' } : { right: bubble ? '5rem' : '4rem' }),
  };

  let trigger;
  if (bubble) {
    // A round button over the page (owner's picture: like a phone's floating button), the Evolvix
    // mark on it; a little see-through until it is used.
    trigger = (
      <button
        {...common}
        {...handlers}
        className={`fixed z-30 grid h-14 w-14 select-none place-items-center rounded-full bg-fg text-surface shadow-[var(--shadow-pop)] ring-4 ring-fg/10 transition-[opacity,left,top] ${
          dragging ? 'cursor-grabbing duration-0' : 'cursor-pointer duration-200'
        } ${menu || dragging ? 'opacity-100' : 'opacity-80 hover:opacity-100'}`}
        style={{
          ...common.style,
          left: `clamp(8px, calc(${spot.x}vw - 28px), calc(100vw - 64px))`,
          top: `clamp(8px, calc(${spot.y}vh - 28px), calc(100vh - 64px))`,
        }}
      >
        {menu ? <Icon name="close" size={24} /> : <Logo size={34} className="rounded-xl" />}
      </button>
    );
  } else if (shape === 'tab') {
    // A half-round tab on the start edge, always showing (owner's drawing).
    trigger = (
      <button
        {...common}
        {...handlers}
        className={`fixed start-0 z-30 flex h-28 w-7 select-none flex-col items-center justify-center gap-2 rounded-e-full bg-brand text-brand-fg shadow-[var(--shadow-pop)] transition-[width,opacity] duration-150 hover:w-8 ${
          dragging ? 'cursor-grabbing' : 'cursor-pointer'
        } ${menu || dragging ? 'opacity-100' : 'opacity-90'}`}
        style={{ ...common.style, top: `${y}vh`, transform: 'translateY(-50%)' }}
      >
        <Icon name={menu ? 'close' : 'bolt'} size={16} />
        <span className="block h-6 w-1 rounded-full bg-current opacity-50" aria-hidden />
      </button>
    );
  } else {
    // Docked on the screen's start edge (right in Arabic, left in English), mostly tucked away; it
    // slides out under the mouse, while dragged or open. A touch screen has no hover, so there a
    // wider grip stays showing (a tap on it opens the shortcuts) and the page underneath stays clear.
    const out = (!touch && hover) || menu || dragging;
    // A phone's grip stays within the page's side margin (16px), so it never covers a label.
    const tucked = out ? '0px' : touch ? 'calc(100% - 16px)' : 'calc(100% - 14px)';
    const shift = rtl ? tucked : `calc(-1 * (${tucked}))`;
    trigger = (
      <div
        className="fixed start-0 z-30 transition-transform duration-200"
        style={{ top: `${y}vh`, transform: `translate(${shift}, -50%)` }}
        onPointerEnter={() => setHover(true)}
        onPointerLeave={() => setHover(false)}
      >
        <button
          {...common}
          {...handlers}
          className={`flex h-12 select-none items-center gap-1 rounded-e-2xl bg-brand ps-2 pe-3 text-brand-fg shadow-[var(--shadow-pop)] ${
            dragging ? 'cursor-grabbing' : 'cursor-pointer'
          } ${out ? '' : 'opacity-90'}`}
        >
          <span className="grid h-8 w-6 place-items-center opacity-70" aria-hidden>
            <span className="block h-5 w-1 rounded-full bg-current opacity-60" />
          </span>
          <Icon name={menu ? 'close' : 'bolt'} size={22} />
        </button>
      </div>
    );
  }

  return (
    <>
      {menu && (
        <div className="fixed inset-0 z-40" onClick={() => setMenu(false)}>
          <div
            role="menu"
            aria-label={t('qa.title')}
            onClick={(e) => e.stopPropagation()}
            className="absolute w-[min(22rem,calc(100vw-5rem))] rounded-[var(--radius-app)] border border-line bg-surface p-3 shadow-[var(--shadow-pop)]"
            style={menuStyle}
          >
            <p className="mb-2 px-1 text-sm font-semibold">{t('qa.title')}</p>
            {chosen.length === 0 ? (
              <p className="px-1 py-3 text-sm text-muted">{t('qa.empty')}</p>
            ) : (
              <div className="grid grid-cols-3 gap-2">
                {chosen.map((a) => (
                  <button
                    key={a.id}
                    role="menuitem"
                    type="button"
                    onClick={() => go(a)}
                    className="flex flex-col items-center gap-1.5 rounded-xl border border-line p-2.5 text-center text-xs hover:border-brand hover:bg-brand-soft"
                  >
                    <Icon name={a.icon} size={20} className="text-brand" />
                    <span className="leading-tight">{t(a.label)}</span>
                  </button>
                ))}
              </div>
            )}
            <button
              type="button"
              onClick={customize}
              className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-medium text-brand hover:bg-brand-soft"
            >
              <Icon name="edit" size={14} />
              {t('qa.customize')}
            </button>
          </div>
        </div>
      )}
      {trigger}
      {editing && (
        <CustomizeSheet
          allowed={allowed}
          chosen={chosen}
          onSave={(ids) => {
            save(ids);
            setEditing(false);
          }}
          onClose={() => setEditing(false)}
        />
      )}
    </>
  );
}

/** Where on the edge the button sits (% of the screen height), kept on this device (a UI choice). */
const Y_KEY = 'skb.quickY';
const clampY = (v: number) => Math.min(90, Math.max(10, v));
function readY(): number {
  try {
    const v = Number(localStorage.getItem(Y_KEY));
    return Number.isFinite(v) && v > 0 ? clampY(v) : 60;
  } catch {
    return 60;
  }
}
function writeY(v: number) {
  try {
    localStorage.setItem(Y_KEY, String(Math.round(v)));
  } catch {
    /* private mode: it just isn't remembered */
  }
}

/** Where the round button floats (% of the screen's width and height), kept on this device. */
interface Spot {
  x: number;
  y: number;
}
const SPOT_KEY = 'skb.quickSpot';
const clampX = (v: number) => Math.min(100, Math.max(0, v));
function readSpot(): Spot {
  try {
    const v = JSON.parse(localStorage.getItem(SPOT_KEY) ?? 'null') as Spot | null;
    if (v && Number.isFinite(v.x) && Number.isFinite(v.y))
      return { x: clampX(v.x), y: clampY(v.y) };
  } catch {
    /* none kept */
  }
  return { x: document.documentElement.dir === 'rtl' ? 100 : 0, y: 75 };
}
function writeSpot(v: Spot) {
  try {
    localStorage.setItem(SPOT_KEY, JSON.stringify({ x: Math.round(v.x), y: Math.round(v.y) }));
  } catch {
    /* private mode: it just isn't remembered */
  }
}

/** Choose the shortcuts and their order (up to MAX_QUICK). */
function CustomizeSheet({
  allowed,
  chosen,
  onSave,
  onClose,
}: {
  allowed: QuickAction[];
  chosen: QuickAction[];
  onSave: (ids: string[]) => void;
  onClose: () => void;
}) {
  const { t } = useT();
  const [ids, setIds] = useState(() => chosen.map((a) => a.id));
  const byId = new Map(allowed.map((a) => [a.id, a]));
  const toggle = (id: string) =>
    setIds((cur) =>
      cur.includes(id) ? cur.filter((x) => x !== id) : cur.length < MAX_QUICK ? [...cur, id] : cur,
    );
  const move = (i: number, step: -1 | 1) =>
    setIds((cur) => {
      const j = i + step;
      if (j < 0 || j >= cur.length) return cur;
      const next = [...cur];
      [next[i], next[j]] = [next[j]!, next[i]!];
      return next;
    });
  const group = (g: QuickAction['group']) => allowed.filter((a) => a.group === g);

  return (
    <Sheet title={t('qa.customize')} onClose={onClose} closeLabel={t('common.close')} wide>
      <div className="space-y-4">
        <section>
          <h3 className="mb-2 flex items-center justify-between text-sm font-semibold">
            {t('qa.chosen')}
            <span className="text-xs font-normal text-muted tnum">
              {ids.length} / {MAX_QUICK}
            </span>
          </h3>
          {ids.length === 0 ? (
            <p className="rounded-[var(--radius-app)] border border-dashed border-line p-3 text-sm text-muted">
              {t('qa.empty')}
            </p>
          ) : (
            <ol className="divide-y divide-[var(--c-line)] rounded-[var(--radius-app)] border border-line">
              {ids.map((id, i) => {
                const a = byId.get(id);
                if (!a) return null;
                return (
                  <li key={id} className="flex items-center gap-2 px-3 py-1.5 text-sm">
                    <span className="w-5 text-xs text-muted tnum">{i + 1}</span>
                    <Icon name={a.icon} size={16} className="text-brand" />
                    <span className="min-w-0 flex-1 truncate">{t(a.label)}</span>
                    <button
                      type="button"
                      aria-label={t('qa.up')}
                      title={t('qa.up')}
                      disabled={i === 0}
                      onClick={() => move(i, -1)}
                      className="grid h-7 w-7 place-items-center rounded-md text-muted hover:bg-surface-2 disabled:opacity-30"
                    >
                      <Icon name="arrowUp" size={14} />
                    </button>
                    <button
                      type="button"
                      aria-label={t('qa.down')}
                      title={t('qa.down')}
                      disabled={i === ids.length - 1}
                      onClick={() => move(i, 1)}
                      className="grid h-7 w-7 place-items-center rounded-md text-muted hover:bg-surface-2 disabled:opacity-30"
                    >
                      <Icon name="arrowDown" size={14} />
                    </button>
                    <button
                      type="button"
                      aria-label={t('qa.remove')}
                      title={t('qa.remove')}
                      onClick={() => toggle(id)}
                      className="grid h-7 w-7 place-items-center rounded-md text-muted hover:bg-destructive-soft hover:text-destructive"
                    >
                      <Icon name="close" size={14} />
                    </button>
                  </li>
                );
              })}
            </ol>
          )}
        </section>
        {(['actions', 'pages'] as const).map((g) => (
          <section key={g}>
            <h3 className="mb-2 text-sm font-semibold">
              {t(g === 'actions' ? 'qa.actions' : 'qa.pages')}
            </h3>
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
              {group(g).map((a) => {
                const on = ids.includes(a.id);
                const full = !on && ids.length >= MAX_QUICK;
                return (
                  <label
                    key={a.id}
                    className={`flex cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-2 text-sm ${
                      on ? 'border-brand bg-brand-soft' : 'border-line hover:bg-surface-2'
                    } ${full ? 'opacity-50' : ''}`}
                  >
                    <input
                      type="checkbox"
                      checked={on}
                      disabled={full}
                      onChange={() => toggle(a.id)}
                    />
                    <Icon name={a.icon} size={16} className="shrink-0 text-brand" />
                    <span className="min-w-0 truncate">{t(a.label)}</span>
                  </label>
                );
              })}
            </div>
          </section>
        ))}
        <div className="flex flex-wrap justify-between gap-2 border-t border-line pt-3">
          <Button
            variant="ghost"
            onClick={() => setIds(DEFAULT_QUICK.filter((id) => byId.has(id)))}
          >
            {t('qa.reset')}
          </Button>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button icon="check" onClick={() => onSave(ids)}>
              {t('common.save')}
            </Button>
          </div>
        </div>
      </div>
    </Sheet>
  );
}
