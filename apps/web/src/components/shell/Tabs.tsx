import { useContext, useEffect, useMemo, useRef } from 'react';
import {
  useBlocker,
  useLocation,
  useNavigate,
  useRoutes,
  parsePath,
  UNSAFE_NavigationContext,
  type Location,
  type Navigator,
  type RouteObject,
  type To,
} from 'react-router-dom';
import { Icon } from '../Icon';
import { useT } from '../../lib/i18n';
import { api } from '../../lib/api';
import { usePreferences } from '../../lib/queries';
import { useDeviceInfo } from '../../lib/device';
import {
  MAIN_TAB,
  MAX_TABS,
  TAB_SWITCH,
  TabContext,
  isTabSwitch,
  locationOf,
  newTabId,
  useTabs,
  type AppTab,
} from '../../lib/tabs';
import { dropTabWork, guards, signedIn, tabHasWork, useLeavePrompt } from '../../lib/workDraft';
import { BackLink, pageName } from './BackLink';

/** The app's pages (App.tsx hands them over; each tab shows one of them). */
let tabRoutes: RouteObject[] = [];
export function setTabRoutes(routes: RouteObject[]) {
  tabRoutes = routes;
}

/** The open tabs are kept with the person's preferences (their addresses only). */
const TABS_PREF = 'session:tabs';
interface SavedTabs {
  tabs: { id: string; path: string }[];
  active: string;
}

/** Window scroll of each tab, so coming back to one lands where it was. */
const scrolls = new Map<string, number>();

/** Show another tab: the address bar follows it; nothing on either page is lost. */
export function useTabActions() {
  const navigate = useNavigate();
  const ask = (leave: () => void) =>
    useLeavePrompt.setState({
      ask: {
        stay: () => useLeavePrompt.setState({ ask: null }),
        leave: () => {
          useLeavePrompt.setState({ ask: null });
          leave();
        },
      },
    });
  const activate = (id: string) => {
    const { active, tabs } = useTabs.getState();
    const tab = tabs.find((x) => x.id === id);
    if (!tab || id === active) return;
    scrolls.set(active, window.scrollY);
    useTabs.setState({ active: id });
    navigate(tab.path || '/dashboard', { replace: true, state: TAB_SWITCH });
    requestAnimationFrame(() => window.scrollTo({ top: scrolls.get(id) ?? 0 }));
  };
  const open = (path: string) => {
    const { tabs, active } = useTabs.getState();
    if (tabs.length >= MAX_TABS) return;
    const id = newTabId();
    scrolls.set(active, window.scrollY);
    useTabs.setState({
      tabs: [...tabs, { id, path, loc: locationOf(path, id) }],
      active: id,
    });
    navigate(path, { state: TAB_SWITCH });
    requestAnimationFrame(() => window.scrollTo({ top: 0 }));
  };
  const close = (id: string) => {
    const doClose = () => {
      dropTabWork(id);
      const { tabs, active, second } = useTabs.getState();
      if (tabs.length <= 1) return;
      const at = tabs.findIndex((x) => x.id === id);
      const rest = tabs.filter((x) => x.id !== id);
      if (id === active) {
        const next = rest[Math.min(at, rest.length - 1)]!;
        useTabs.setState({
          tabs: rest,
          active: next.id,
          second: second === next.id ? null : second,
        });
        navigate(next.path || '/dashboard', { replace: true, state: TAB_SWITCH });
      } else useTabs.setState({ tabs: rest, second: second === id ? null : second });
      scrolls.delete(id);
    };
    if (tabHasWork(id)) ask(doClose);
    else doClose();
  };
  return { activate, open, close };
}

/**
 * The page area: a row of tabs above, and every open tab's page kept alive underneath (only the
 * shown one is visible; in split view, two side by side).
 */
export function TabsView() {
  const { t } = useT();
  const location = useLocation();
  const { tabs, active, split, second } = useTabs();
  const { deviceClass } = useDeviceInfo();
  const actions = useTabActions();
  const prefs = usePreferences();

  // The shown tab follows the address bar (a page change inside it, or a filter).
  useEffect(() => {
    useTabs.setState((s) => ({
      tabs: s.tabs.map((x) =>
        x.id === s.active ? { ...x, path: location.pathname + location.search, loc: location } : x,
      ),
    }));
  }, [location]);

  // Reopen the tabs that were open (after an update or signing in again), once.
  const restored = useRef(false);
  useEffect(() => {
    if (restored.current || prefs.isPending) return;
    restored.current = true;
    const raw = prefs.data?.[TABS_PREF];
    if (!raw) return;
    try {
      const saved = JSON.parse(raw) as SavedTabs;
      if (!Array.isArray(saved.tabs) || saved.tabs.length < 2) return;
      const here = location.pathname + location.search;
      const list = saved.tabs
        .filter(
          (x) => typeof x.id === 'string' && typeof x.path === 'string' && x.path.startsWith('/'),
        )
        .slice(0, MAX_TABS);
      const activeId = list.some((x) => x.id === saved.active) ? saved.active : list[0]?.id;
      if (!activeId) return;
      useTabs.setState({
        tabs: list.map((x) =>
          x.id === activeId
            ? { id: x.id, path: here, loc: location }
            : { id: x.id, path: x.path, loc: locationOf(x.path, x.id) },
        ),
        active: activeId,
      });
    } catch {
      /* a bad value is ignored */
    }
    // Once, when the preferences arrive.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefs.isPending]);

  // Keep the open tabs' addresses for next time (a moment after they change).
  const savedText = JSON.stringify({ tabs: tabs.map((x) => ({ id: x.id, path: x.path })), active });
  useEffect(() => {
    if (!restored.current) return;
    const timer = window.setTimeout(() => {
      const value = tabs.length > 1 ? savedText : '';
      void api.put('/preferences', { key: TABS_PREF, value }).catch(() => undefined);
    }, 1000);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedText]);

  // The app's one guard: leaving the shown tab's page with work typed on it asks first; moving
  // between tabs never does (the work stays in its tab).
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      !isTabSwitch(nextLocation.state) &&
      currentLocation.pathname !== nextLocation.pathname &&
      signedIn() &&
      [...guards.values()].some((g) => g.tab === useTabs.getState().active && g.pending()),
  );
  useEffect(() => {
    if (blocker.state !== 'blocked') return;
    useLeavePrompt.setState({
      ask: {
        stay: () => {
          useLeavePrompt.setState({ ask: null });
          blocker.reset();
        },
        leave: () => {
          useLeavePrompt.setState({ ask: null });
          dropTabWork(useTabs.getState().active);
          blocker.proceed();
        },
      },
    });
  }, [blocker]);

  const canSplit = deviceClass === 'desktop';
  const splitOn = split && canSplit && tabs.length > 1;
  const other = splitOn
    ? (tabs.find((x) => x.id === second && x.id !== active) ?? tabs.find((x) => x.id !== active))
    : undefined;

  const toggleSplit = () => {
    if (splitOn) return useTabs.setState({ split: false });
    if (tabs.length < 2) actions.open('/dashboard');
    useTabs.setState({ split: true });
  };

  return (
    <>
      <div
        role="tablist"
        aria-label={t('tabs.title')}
        className="mb-4 flex items-center gap-1 overflow-x-auto border-b border-line pb-1"
      >
        {tabs.map((tab) => (
          <TabButton
            key={tab.id}
            tab={tab}
            active={tab.id === active}
            shownBeside={tab.id === other?.id}
            closable={tabs.length > 1}
            onPick={() => actions.activate(tab.id)}
            onClose={() => actions.close(tab.id)}
          />
        ))}
        {tabs.length < MAX_TABS && (
          <button
            type="button"
            onClick={() => actions.open('/dashboard')}
            title={t('tabs.new')}
            aria-label={t('tabs.new')}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-muted hover:bg-surface-2 hover:text-fg"
          >
            <Icon name="plus" size={16} />
          </button>
        )}
        {canSplit && (
          <button
            type="button"
            onClick={toggleSplit}
            aria-pressed={splitOn}
            className={`ms-auto flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium ${
              splitOn ? 'bg-brand-soft text-brand' : 'text-muted hover:bg-surface-2 hover:text-fg'
            }`}
          >
            {t('tabs.split')}
            <span className="rounded bg-warning-soft px-1 text-[10px] text-warning">
              {t('tabs.beta')}
            </span>
          </button>
        )}
      </div>
      <div className={splitOn ? 'grid grid-cols-2 gap-4' : undefined}>
        {tabs.map((tab) => {
          const shown = tab.id === active || tab.id === other?.id;
          return (
            <div
              key={tab.id}
              hidden={!shown}
              onPointerDownCapture={
                splitOn && tab.id !== active ? () => actions.activate(tab.id) : undefined
              }
              className={
                splitOn && shown
                  ? `min-w-0 overflow-y-auto rounded-[var(--radius-app)] border p-3 [height:calc(100vh-9rem)] ${
                      tab.id === active ? 'border-brand' : 'border-line'
                    }`
                  : 'min-w-0'
              }
              style={splitOn && shown ? { order: tab.id === active ? 0 : 1 } : undefined}
            >
              <TabPane tab={tab} active={tab.id === active} fallback={location} />
            </div>
          );
        })}
      </div>
    </>
  );
}

function TabButton({
  tab,
  active,
  shownBeside,
  closable,
  onPick,
  onClose,
}: {
  tab: AppTab;
  active: boolean;
  shownBeside: boolean;
  closable: boolean;
  onPick: () => void;
  onClose: () => void;
}) {
  const { t } = useT();
  const name = pageName(tab.loc?.pathname ?? tab.path, t) ?? t('nav.dashboard');
  return (
    <div
      role="tab"
      aria-selected={active}
      className={`group flex h-8 max-w-[14rem] shrink-0 items-center gap-1 rounded-lg ps-3 pe-1 text-sm ${
        active
          ? 'bg-brand-soft font-semibold text-brand'
          : shownBeside
            ? 'bg-surface-2 text-fg'
            : 'text-muted hover:bg-surface-2 hover:text-fg'
      }`}
    >
      <button
        type="button"
        className="min-w-0 truncate"
        onClick={onPick}
        onAuxClick={(e) => e.button === 1 && closable && onClose()}
      >
        {name}
      </button>
      {closable && (
        <button
          type="button"
          onClick={onClose}
          title={t('tabs.close')}
          aria-label={t('tabs.close')}
          className="grid h-6 w-6 place-items-center rounded-md text-muted opacity-60 hover:bg-surface hover:opacity-100"
        >
          <Icon name="close" size={13} />
        </button>
      )}
    </div>
  );
}

/** One tab's page, at the tab's own address. */
function TabPane({ tab, active, fallback }: { tab: AppTab; active: boolean; fallback: Location }) {
  const location = useMemo(
    () => tab.loc ?? (tab.id === MAIN_TAB ? fallback : locationOf(tab.path, tab.id)),
    // The first tab shows the address bar until it has its own.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tab.loc, tab.path, tab.loc ? null : fallback],
  );
  // A tab that isn't shown moves within itself: a page in it that changes its address (a filter
  // following the person's working place, a redirect) must not take the app away from the page
  // being worked in.
  const base = useContext(UNSAFE_NavigationContext);
  const shown = useRef(active);
  shown.current = active;
  const navigation = useMemo(() => {
    const here = (to: To, state: unknown) => {
      const path = typeof to === 'string' ? parsePath(to) : to;
      const next: Location = {
        pathname: path.pathname ?? '/',
        search: path.search ?? '',
        hash: path.hash ?? '',
        state: state ?? null,
        key: `${tab.id}-${Date.now().toString(36)}`,
      };
      useTabs.setState((st) => ({
        tabs: st.tabs.map((x) =>
          x.id === tab.id ? { ...x, path: next.pathname + next.search, loc: next } : x,
        ),
      }));
    };
    const navigator: Navigator = {
      ...base.navigator,
      push: (to, state, opts) =>
        shown.current ? base.navigator.push(to, state, opts) : here(to, state),
      replace: (to, state, opts) =>
        shown.current ? base.navigator.replace(to, state, opts) : here(to, state),
      go: (delta) => (shown.current ? base.navigator.go(delta) : undefined),
    };
    return { ...base, navigator };
  }, [base, tab.id]);
  const element = useRoutes(tabRoutes, location);
  const value = useMemo(() => ({ id: tab.id, active }), [tab.id, active]);
  return (
    <UNSAFE_NavigationContext.Provider value={navigation}>
      <TabContext.Provider value={value}>
        <BackLink location={location} />
        {element}
      </TabContext.Provider>
    </UNSAFE_NavigationContext.Provider>
  );
}
