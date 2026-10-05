import { createContext, useContext } from 'react';
import { create } from 'zustand';
import type { Location } from 'react-router-dom';

/**
 * Several pages open at once (owner, 2026-10-05: "open more pages without closing what I am
 * working on"): each tab keeps its page, with what was typed on it, while another is shown. The
 * shown tab's page follows the address bar; the others keep their own address. Only the pages'
 * addresses are kept (on the server, with the person's preferences), never their data.
 */
export interface AppTab {
  id: string;
  /** Path and query of the page the tab shows. */
  path: string;
  /** Its full location (state included) once shown; built from `path` otherwise. */
  loc: Location | null;
}

interface TabsState {
  tabs: AppTab[];
  active: string;
  /** Two tabs side by side (beta, owner 2026-10-05). */
  split: boolean;
  /** The other tab shown in split view. */
  second: string | null;
}

/** The first tab: its drafts keep the keys they always had. */
export const MAIN_TAB = 'main';
export const MAX_TABS = 8;

export const useTabs = create<TabsState>(() => ({
  tabs: [{ id: MAIN_TAB, path: '', loc: null }],
  active: MAIN_TAB,
  split: false,
  second: null,
}));

let seq = 0;
export const newTabId = () => `t${Date.now().toString(36)}${(seq++).toString(36)}`;

/** A location for a path that was never shown in the address bar. */
export function locationOf(path: string, key = 'tab'): Location {
  const q = path.indexOf('?');
  return {
    pathname: q < 0 ? path : path.slice(0, q),
    search: q < 0 ? '' : path.slice(q),
    hash: '',
    state: null,
    key,
  };
}

/** The tab a page is in, and whether it is the one being worked in. */
export const TabContext = createContext<{ id: string; active: boolean }>({
  id: MAIN_TAB,
  active: true,
});
export const useTab = () => useContext(TabContext);

/** Navigation state that marks a move between tabs (not a page change inside one). */
export const TAB_SWITCH = { tabSwitch: true } as const;
export const isTabSwitch = (state: unknown) =>
  !!state && typeof state === 'object' && (state as { tabSwitch?: boolean }).tabSwitch === true;

/** Navigation state of the menu: a page opened from the menu has nothing to go back to. */
export const FROM_MENU = { fromMenu: true } as const;
export const isFromMenu = (state: unknown) =>
  !!state && typeof state === 'object' && (state as { fromMenu?: boolean }).fromMenu === true;
