import { useMemo, useState, type ReactNode } from 'react';
import { NavLink, useLocation, type NavLinkProps } from 'react-router-dom';
import { NAV_ITEMS, hasPermission, type NavItem } from '@skb/shared';
import { Icon } from '../Icon';
import { Logo, Wordmark } from '../Logo';
import { CompanyMark, CompanyName } from '../CompanyBadge';
import { useBranding } from '../../lib/queries';
import { usePrefs } from '../../stores/prefs';
import { useBackdropStyle } from '../../lib/backdrop';
import { useT } from '../../lib/i18n';
import { useAuth } from '../../stores/auth';
import { useDeviceInfo } from '../../lib/device';
import { usePresenceReporter } from '../../lib/presence';
import { ConnectionBadge } from './ConnectionBadge';
import { PrefControls } from './PrefControls';
import { AccountMenu } from './AccountMenu';
import { NotificationBell } from './NotificationBell';
import { TabsView, useTabActions } from './Tabs';
import { QuickActions } from '../QuickActions';
import { ChatBadge } from './ChatBadge';
import { UpdateBadge } from './UpdateBadge';
import { GlobalSearch, PhoneSearch } from './GlobalSearch';
import { FROM_MENU } from '../../lib/tabs';

function useVisibleNav(): NavItem[] {
  const user = useAuth((s) => s.user);
  return useMemo(
    () =>
      NAV_ITEMS.filter(
        (item) =>
          !item.permission ||
          (user &&
            (hasPermission(user.permissions, item.permission) ||
              (item.anyOf ?? []).some((p) => hasPermission(user.permissions, p)))),
      ),
    [user],
  );
}

/** Adaptive application shell: desktop sidebar · tablet rail · phone bottom tabs + More. */
export function Shell() {
  const { deviceClass } = useDeviceInfo();
  usePresenceReporter();

  return (
    <>
      {deviceClass === 'phone' ? (
        <PhoneShell />
      ) : deviceClass === 'tablet' ? (
        <RailShell />
      ) : (
        <SidebarShell />
      )}
      <QuickActions />
    </>
  );
}

/* ------------------------------ Desktop / iPad -------------------------- */

function SidebarShell() {
  const backdrop = useBackdropStyle();
  const { t } = useT();
  const items = useVisibleNav();
  const collapsed = usePrefs((s) => s.navCollapsed);
  if (collapsed) return <RailShell canExpand />;
  return (
    // The shell fills the screen and never scrolls itself; the side menu and the page each scroll
    // on their own (owner, 2026-10-14: one scroll inside the menu, not a second bar on the outside).
    <div className="flex h-screen overflow-hidden bg-canvas" style={backdrop}>
      <aside
        data-ui="sidebar"
        className="flex h-screen w-64 shrink-0 flex-col overflow-hidden border-e border-line bg-surface"
      >
        {/* The side menu's own slim scroll, on its inner edge; the brand now lives in the top bar. */}
        <nav className="nav-scroll min-h-0 flex-1 space-y-1 overflow-y-auto px-3 py-3">
          {items.map((item) => (
            <SidebarLink key={item.key} item={item} label={t(item.labelKey)} />
          ))}
        </nav>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <MainArea />
      </div>
    </div>
  );
}

function RailShell({ canExpand = false }: { canExpand?: boolean }) {
  const backdrop = useBackdropStyle();
  const { t } = useT();
  const items = useVisibleNav();
  return (
    <div className="flex h-screen overflow-hidden bg-canvas" style={backdrop}>
      <aside
        data-ui="sidebar"
        className="flex h-screen w-20 shrink-0 flex-col items-center overflow-hidden border-e border-line bg-surface py-3"
      >
        <nav className="nav-scroll flex min-h-0 flex-1 flex-col items-center gap-1 overflow-y-auto px-1.5">
          {items.map((item) => (
            <RailLink key={item.key} item={item} label={t(item.labelKey)} />
          ))}
        </nav>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar expandable={canExpand} />
        <MainArea />
      </div>
    </div>
  );
}

/* --------------------------------- Phone -------------------------------- */

function PhoneShell() {
  const backdrop = useBackdropStyle();
  const { t } = useT();
  const items = useVisibleNav();
  const [moreOpen, setMoreOpen] = useState(false);

  const primary = items.filter((i) => i.primaryOnPhone).slice(0, 4);
  const rest = items.filter((i) => !primary.includes(i));

  return (
    <div className="flex min-h-screen flex-col bg-canvas" style={backdrop}>
      <header className="sticky top-0 z-20 flex items-center justify-between gap-2 border-b border-line bg-surface/95 px-4 py-2 backdrop-blur safe-top">
        <span className="flex min-w-0 items-center gap-2">
          <Logo size={32} />
          <span className="min-w-0 leading-tight">
            <Wordmark className="block text-base" />
            <CompanyName className="block truncate text-[11px] text-muted" />
          </span>
        </span>
        {/* Language and look sit in "More" on a phone, so the name in the header has room. */}
        <div className="flex shrink-0 items-center gap-0.5">
          <PhoneSearch />
          <ConnectionBadge showLabel={false} />
          <NotificationBell />
          <AccountMenu />
        </div>
      </header>

      <main className="min-w-0 flex-1 px-4 py-4 pb-24">
        <TabsView />
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-line bg-surface/95 backdrop-blur pb-safe">
        {primary.map((item) => (
          <PhoneTab key={item.key} item={item} label={t(item.labelKey)} />
        ))}
        <button
          onClick={() => setMoreOpen(true)}
          className="flex flex-col items-center justify-center gap-0.5 py-2 text-faint"
        >
          <Icon name="more" size={22} />
          <span className="text-[11px] font-medium">{t('nav.more')}</span>
        </button>
      </nav>

      {moreOpen && (
        <div
          className="fixed inset-0 z-40 flex flex-col justify-end bg-black/40"
          onClick={() => setMoreOpen(false)}
        >
          <div
            className="rounded-t-2xl border-t border-line bg-surface p-4 pb-safe"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-line" />
            <div className="mb-3 flex justify-center">
              <PrefControls />
            </div>
            <div className="grid grid-cols-3 gap-2">
              {rest.map((item) => (
                <MenuLink
                  key={item.key}
                  to={item.path}
                  onClick={() => setMoreOpen(false)}
                  className="flex flex-col items-center gap-1.5 rounded-xl border border-line p-3 text-center text-sm text-fg"
                >
                  <span className="relative">
                    <Icon name={item.icon} size={22} className="text-brand" />
                    {item.key === 'chat' && <ChatBadge className="absolute -end-2.5 -top-1.5" />}
                    {item.key === 'updates' && <UpdateBadge className="absolute -end-1 -top-1" />}
                  </span>
                  <span className="text-xs">{t(item.labelKey)}</span>
                </MenuLink>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * A hamburger next to the logo that opens or closes the side menu, remembered on this device
 * (owner, 2026-10-14: a toggle by the logo instead of an arrow at the bottom).
 */
function MenuToggle({ className }: { className?: string }) {
  const { t } = useT();
  const collapsed = usePrefs((s) => s.navCollapsed);
  const set = usePrefs((s) => s.setNavCollapsed);
  const label = t(collapsed ? 'shell.expand' : 'shell.collapse');
  return (
    <button
      type="button"
      onClick={() => set(!collapsed)}
      title={label}
      aria-label={label}
      className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg text-muted hover:bg-surface-2 hover:text-fg ${className ?? ''}`}
    >
      <Icon name="menu" size={20} />
    </button>
  );
}

/* --------------------------------- Parts -------------------------------- */

/**
 * A menu item: opens its page in the shown tab, with nothing to go back to; Ctrl+click or the
 * middle button opens it in a new tab instead (owner, 2026-10-05).
 */
function MenuLink(props: NavLinkProps & { to: string }) {
  const { open } = useTabActions();
  return (
    <NavLink
      {...props}
      state={FROM_MENU}
      onClick={(e) => {
        if (e.ctrlKey || e.metaKey || e.shiftKey) {
          e.preventDefault();
          open(props.to);
        }
        props.onClick?.(e);
      }}
      onAuxClick={(e) => {
        if (e.button === 1) {
          e.preventDefault();
          open(props.to);
        }
      }}
    />
  );
}

/**
 * The brand in the top bar (owner, 2026-10-14): the animated Evolvix mark and name at the start,
 * before the search; then the company's own mark and name, shown bigger. Not in the side menu.
 */
function BrandCluster({ expandable }: { expandable?: boolean }) {
  const { data } = useBranding();
  return (
    <div className="flex min-w-0 shrink-0 items-center gap-2">
      {expandable && <MenuToggle />}
      <span className="flex shrink-0 items-center gap-2">
        <span className="logo-anim">
          <Logo size={30} />
        </span>
        <Wordmark className="hidden text-lg sm:inline" />
      </span>
      {data?.companyName && (
        <span className="hidden min-w-0 items-center gap-2 border-s border-line ps-2.5 lg:flex">
          <CompanyMark size={34} />
          <CompanyName className="min-w-0 max-w-[14rem] truncate text-base font-semibold" />
        </span>
      )}
    </div>
  );
}

function TopBar({ expandable = true }: { expandable?: boolean }) {
  return (
    <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-line bg-surface/90 px-4 py-2.5 backdrop-blur">
      <BrandCluster expandable={expandable} />
      <GlobalSearch />
      <div className="ms-auto flex shrink-0 items-center gap-2">
        <ConnectionBadge />
        <NotificationBell />
        <PrefControls />
        <AccountMenu />
      </div>
    </header>
  );
}

/**
 * The page scrolls with the window (the top bar stays), so the sticky side columns of the builder
 * pages (e.g. an invoice's totals) stick under the top bar. The main area must not be a scroll box
 * itself, or they would slide down inside it as the page grows (owner report 2026-09-30).
 */
function MainArea(): ReactNode {
  // The whole width of the screen (owner, 2026-10-05: "full screen on the computer"). The page
  // scrolls inside here, not the window (owner, 2026-10-14: one scroll on the inside, none outside);
  // the builder pages' sticky side columns stick under the top bar against this scroll box.
  return (
    <main data-scroll-root className="min-w-0 flex-1 overflow-y-auto overflow-x-clip p-5 lg:p-6">
      <TabsView />
    </main>
  );
}

function SidebarLink({ item, label }: { item: NavItem; label: string }) {
  return (
    <MenuLink
      to={item.path}
      data-ui="nav"
      className={({ isActive }) =>
        `flex items-center gap-3 rounded-[var(--radius-app)] px-3 py-2 text-sm font-medium transition-colors ${
          isActive ? 'bg-brand-soft text-brand' : 'text-muted hover:bg-surface-2 hover:text-fg'
        }`
      }
    >
      <Icon name={item.icon} size={20} />
      {label}
      {item.key === 'chat' && <ChatBadge className="ms-auto" />}
      {item.key === 'updates' && <UpdateBadge className="ms-auto" />}
    </MenuLink>
  );
}

function RailLink({ item, label }: { item: NavItem; label: string }) {
  return (
    <MenuLink
      to={item.path}
      title={label}
      className={({ isActive }) =>
        `flex w-16 flex-col items-center gap-1 rounded-xl py-2 text-[10px] font-medium transition-colors ${
          isActive ? 'bg-brand-soft text-brand' : 'text-muted hover:bg-surface-2 hover:text-fg'
        }`
      }
    >
      <span className="relative">
        <Icon name={item.icon} size={22} />
        {item.key === 'chat' && <ChatBadge className="absolute -end-2.5 -top-1.5" />}
        {item.key === 'updates' && <UpdateBadge className="absolute -end-1 -top-1" />}
      </span>
      <span className="line-clamp-1 px-1">{label}</span>
    </MenuLink>
  );
}

function PhoneTab({ item, label }: { item: NavItem; label: string }) {
  const location = useLocation();
  const active = location.pathname.startsWith(item.path);
  return (
    <MenuLink
      to={item.path}
      className={`flex flex-col items-center justify-center gap-0.5 py-2 ${active ? 'text-brand' : 'text-faint'}`}
    >
      <Icon name={item.icon} size={22} />
      <span className="text-[11px] font-medium">{label}</span>
    </MenuLink>
  );
}
