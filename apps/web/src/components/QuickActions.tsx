import { useMemo, useRef, useState, type PointerEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from './Icon';
import { Sheet } from './Sheet';
import { Button } from './ui';
import { useT } from '../lib/i18n';
import { useAuth } from '../stores/auth';
import { usePrefs } from '../stores/prefs';
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
  const [dragging, setDragging] = useState(false);
  const press = useRef<{ startY: number; startTop: number; moved: boolean; timer?: number } | null>(
    null,
  );
  // "out" = pulled out and enlarged: on hover (desktop), while dragging, or while the menu is open.
  // On a touch screen it stays tucked as a clear handle on the edge and a tap opens it — it is not
  // left filling the screen (owner, 2026-10-13: "the circle and the tab don't hide").
  const out = (!touch && hover) || menu || dragging;

  const go = (a: QuickAction) => {
    setMenu(false);
    if (tabHasWork(useTabs.getState().active)) openTab(a.path);
    else navigate(a.path, { state: FROM_MENU });
  };
  const customize = () => {
    setMenu(false);
    setEditing(true);
  };

  // Press: a tap opens the shortcuts, holding still opens the chooser, moving drags it up or down.
  const onDown = (e: PointerEvent<HTMLButtonElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = { startY: e.clientY, startTop: y, moved: false, timer: 0 };
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
    const dy = e.clientY - p.startY;
    if (!p.moved && Math.abs(dy) < 6) return;
    if (!p.moved) {
      p.moved = true;
      window.clearTimeout(p.timer);
      setDragging(true);
      setMenu(false);
    }
    setY(clampY(p.startTop + (dy / window.innerHeight) * 100));
  };
  const onUp = () => {
    const p = press.current;
    press.current = null;
    if (!p) return;
    window.clearTimeout(p.timer);
    if (p.moved) {
      setDragging(false);
      writeY(y);
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

  // All three sit on the start edge (right in Arabic, left in English) and stay fully in view — a
  // clear handle you can always find and grab (owner, 2026-10-14: it was hard to reach and hid).
  // It's compact and a little see-through when idle, and grows and turns solid as the mouse nears it
  // (the "small dot that grows on approach"), while a tap opens the shortcuts on any device.
  let triggerEl;
  if (shape === 'tab') {
    triggerEl = (
      <button
        {...common}
        {...handlers}
        className={`flex select-none flex-col items-center justify-center gap-1.5 overflow-hidden rounded-e-2xl bg-brand text-brand-fg shadow-[var(--shadow-pop)] transition-all duration-200 ${
          dragging ? 'cursor-grabbing' : 'cursor-pointer'
        } ${out ? 'h-28 w-10' : 'h-20 w-8 opacity-90'}`}
      >
        <Icon name={menu ? 'close' : 'bolt'} size={out ? 22 : 18} />
        <span
          className={`block w-1 rounded-full bg-current opacity-50 ${out ? 'h-6' : 'h-4'}`}
          aria-hidden
        />
      </button>
    );
  } else if (shape === 'bubble') {
    triggerEl = (
      <button
        {...common}
        {...handlers}
        className={`grid select-none place-items-center rounded-full bg-brand text-brand-fg shadow-[var(--shadow-pop)] ring-4 ring-brand/15 transition-all duration-200 ${
          dragging ? 'cursor-grabbing' : 'cursor-pointer'
        } ${out ? 'h-14 w-14' : 'h-12 w-12 opacity-90'}`}
      >
        <Icon name={menu ? 'close' : 'bolt'} size={out ? 24 : 22} />
      </button>
    );
  } else {
    // The pill dock: a grip and a bolt, always on the edge, growing a touch when reached.
    triggerEl = (
      <button
        {...common}
        {...handlers}
        className={`flex select-none items-center gap-1 rounded-e-2xl bg-brand pe-3 text-brand-fg shadow-[var(--shadow-pop)] transition-all duration-200 ${
          dragging ? 'cursor-grabbing' : 'cursor-pointer'
        } ${out ? 'h-12 ps-2' : 'h-11 ps-1.5 opacity-90'}`}
      >
        <span className="grid h-8 w-4 place-items-center opacity-70" aria-hidden>
          <span className="block h-5 w-1 rounded-full bg-current opacity-60" />
        </span>
        <Icon name={menu ? 'close' : 'bolt'} size={out ? 22 : 20} />
      </button>
    );
  }

  const trigger = (
    <div
      className="fixed start-0 z-30 -translate-y-1/2"
      style={{ top: `${y}vh` }}
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => setHover(false)}
    >
      {triggerEl}
    </div>
  );

  return (
    <>
      {menu && (
        <QuickMenu
          items={chosen}
          y={y}
          rtl={rtl}
          title={t('qa.title')}
          emptyLabel={t('qa.empty')}
          labelOf={(a) => t(a.label)}
          onPick={go}
          onCustomize={customize}
          customizeLabel={t('qa.customize')}
          onClose={() => setMenu(false)}
        />
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

/**
 * The shortcuts, in one reliable popover for every shape (owner, 2026-10-14: the menu used to open
 * in the wrong place). It appears right beside the button at its height, on the start edge, and is
 * always kept fully on screen; it scrolls inside only if there are more shortcuts than fit. Tapping
 * the dim backdrop closes it.
 */
function QuickMenu({
  items,
  y,
  rtl,
  title,
  emptyLabel,
  labelOf,
  onPick,
  onCustomize,
  customizeLabel,
  onClose,
}: {
  items: QuickAction[];
  y: number;
  rtl: boolean;
  title: string;
  emptyLabel: string;
  labelOf: (a: QuickAction) => string;
  onPick: (a: QuickAction) => void;
  onCustomize: () => void;
  customizeLabel: string;
  onClose: () => void;
}) {
  // Line the panel's top up near the button, then clamp so it never runs off the top or bottom.
  const style = {
    top: `clamp(0.75rem, calc(${y}dvh - 6rem), calc(100dvh - 24rem))`,
    ...(rtl ? { right: '4.25rem' } : { left: '4.25rem' }),
  };
  return (
    <div className="fixed inset-0 z-40 bg-black/25 backdrop-blur-[1px]" onClick={onClose}>
      <div
        role="menu"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        className="absolute flex max-h-[calc(100dvh-1.5rem)] w-[min(20rem,calc(100vw-5.5rem))] flex-col overflow-hidden rounded-[var(--radius-app)] border border-line bg-surface shadow-[var(--shadow-pop)]"
        style={style}
      >
        <p className="border-b border-line px-3 py-2 text-sm font-semibold">{title}</p>
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {items.length === 0 ? (
            <p className="px-1 py-3 text-sm text-muted">{emptyLabel}</p>
          ) : (
            <div className="grid grid-cols-3 gap-2">
              {items.map((a, i) => (
                <button
                  key={a.id}
                  role="menuitem"
                  type="button"
                  onClick={() => onPick(a)}
                  className="flex animate-[quickPop_.16s_ease-out_both] flex-col items-center gap-1.5 rounded-xl border border-line p-2.5 text-center text-xs hover:border-brand hover:bg-brand-soft"
                  style={{ animationDelay: `${i * 20}ms`, transform: 'none' }}
                >
                  <Icon name={a.icon} size={20} className="text-brand" />
                  <span className="leading-tight">{labelOf(a)}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={onCustomize}
          className="flex items-center justify-center gap-1.5 border-t border-line py-2 text-xs font-medium text-brand hover:bg-brand-soft"
        >
          <Icon name="edit" size={14} />
          {customizeLabel}
        </button>
      </div>
    </div>
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
