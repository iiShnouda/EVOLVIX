import { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from './Icon';
import { Sheet } from './Sheet';
import { Button } from './ui';
import { useT } from '../lib/i18n';
import { useAuth } from '../stores/auth';
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
 * The quick-action button (owner, 2026-10-05): a tap opens the person's own shortcuts; holding it
 * (or a right-click) lets them choose which, and in what order, from every main action and page
 * they may use. A shortcut opens in a new tab when the shown page has unsaved work, so nothing is
 * lost.
 */
export function QuickActions() {
  const { t } = useT();
  const navigate = useNavigate();
  const { open: openTab } = useTabActions();
  const { deviceClass } = useDeviceInfo();
  const [allowed, chosen, save] = useQuickChoice();
  const [menu, setMenu] = useState(false);
  const [editing, setEditing] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const held = useRef(false);

  const go = (a: QuickAction) => {
    setMenu(false);
    if (tabHasWork(useTabs.getState().active)) openTab(a.path);
    else navigate(a.path, { state: FROM_MENU });
  };
  const startHold = () => {
    held.current = false;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      held.current = true;
      setMenu(false);
      setEditing(true);
    }, HOLD_MS);
  };
  const endHold = () => window.clearTimeout(timer.current);

  if (allowed.length === 0) return null;
  return (
    <>
      {menu && (
        <div className="fixed inset-0 z-40" onClick={() => setMenu(false)}>
          <div
            role="menu"
            aria-label={t('qa.title')}
            onClick={(e) => e.stopPropagation()}
            className={`absolute end-4 w-[min(22rem,calc(100vw-2rem))] rounded-[var(--radius-app)] border border-line bg-surface p-3 shadow-[var(--shadow-pop)] ${
              deviceClass === 'phone' ? 'bottom-40' : 'bottom-24'
            }`}
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
                    <span className="line-clamp-2">{t(a.label)}</span>
                  </button>
                ))}
              </div>
            )}
            <button
              type="button"
              onClick={() => {
                setMenu(false);
                setEditing(true);
              }}
              className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-medium text-brand hover:bg-brand-soft"
            >
              <Icon name="edit" size={14} />
              {t('qa.customize')}
            </button>
          </div>
        </div>
      )}
      <button
        type="button"
        aria-label={t('qa.title')}
        title={t('qa.title')}
        aria-expanded={menu}
        onPointerDown={startHold}
        onPointerUp={endHold}
        onPointerLeave={endHold}
        onContextMenu={(e) => {
          e.preventDefault();
          endHold();
          setMenu(false);
          setEditing(true);
        }}
        onClick={() => {
          if (held.current) return;
          setMenu((m) => !m);
        }}
        className={`fixed end-5 z-40 grid h-14 w-14 select-none place-items-center rounded-full bg-brand text-brand-fg shadow-[var(--shadow-pop)] transition-transform hover:scale-105 active:scale-95 ${
          deviceClass === 'phone' ? 'bottom-24' : 'bottom-6'
        }`}
        style={{ touchAction: 'manipulation', WebkitTouchCallout: 'none' }}
      >
        <Icon name={menu ? 'close' : 'bolt'} size={24} />
      </button>
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
