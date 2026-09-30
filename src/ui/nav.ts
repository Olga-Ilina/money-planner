// Navigation inside a tab: each tab has its own stack of pages on top of its root screen.
// Switching tabs keeps every stack; tapping the active tab goes back to its root.
// Pages are registered by name in src/ui/pages.ts; <TabContent tab> renders the top of the stack.
import { createContext } from 'preact';
import { signal } from '@preact/signals';
import { TAB_TITLES, onResetSession, tab as activeTab } from './state';
import type { Tab } from './state';

export type PageParams = Record<string, string>;

/** Props of a page registered in src/ui/pages.ts. */
export interface RoutedPageProps {
  params: PageParams;
}

export interface NavEntry {
  /** Name of the page in the registry (src/ui/pages.ts). */
  page: string;
  params: PageParams;
  /** Title of the page below it, shown on the back button. */
  backTitle: string;
  /** Unique per push: a page pushed again — even the same name at the same depth — is a fresh page. */
  key: number;
}

/** What <Page> needs to know about where it is shown; null outside a tab (onboarding, lock). */
export interface PageContextValue {
  tab: Tab;
  /** 0 for the tab's root screen, 1 for the first pushed page, … */
  depth: number;
  backTitle?: string;
}

export const PageContext = createContext<PageContextValue | null>(null);

type Stacks = Record<Tab, NavEntry[]>;

const emptyStacks = (): Stacks => ({ today: [], feed: [], accounts: [], reports: [], more: [] });

const stacks = signal<Stacks>(emptyStacks());

/** Title shown at each depth of each tab, recorded by <Page> for the back button of the next page. */
const titles = new Map<string, string>();
let pushes = 0;
const titleKey = (t: Tab, depth: number): string => `${t}:${depth}`;

/** Called by <Page>; not needed by screens. */
export function rememberTitle(t: Tab, depth: number, title: string): void {
  titles.set(titleKey(t, depth), title);
}

function setStack(t: Tab, stack: NavEntry[]): void {
  stacks.value = { ...stacks.value, [t]: stack };
}

/** Opens page `page` (a name from src/ui/pages.ts) on top of tab `t`'s stack. */
export function pushPage(t: Tab, page: string, params: PageParams = {}): void {
  const stack = stacks.value[t];
  const depth = stack.length;
  const backTitle = titles.get(titleKey(t, depth)) ?? (depth === 0 ? TAB_TITLES[t] : 'Назад');
  pushes += 1;
  setStack(t, [...stack, { page, params: { ...params }, backTitle, key: pushes }]);
}

/** Goes back one page in tab `t` (nothing at the root). */
export function popPage(t: Tab): void {
  const stack = stacks.value[t];
  if (stack.length > 0) setStack(t, stack.slice(0, -1));
}

/** Goes back to the root screen of tab `t`. */
export function popToRoot(t: Tab): void {
  if (stacks.value[t].length > 0) setStack(t, []);
}

/** The page on top of tab `t`, or null at the root screen. Reading it subscribes a component. */
export function currentPage(t: Tab): NavEntry | null {
  const stack = stacks.value[t];
  return stack[stack.length - 1] ?? null;
}

/** Number of pages above the root of tab `t`. Reading it subscribes a component. */
export function stackDepth(t: Tab): number {
  return stacks.value[t].length;
}

/** Switches to tab `t` at its root, optionally opening `page` there (e.g. «Сегодня» → an account). */
export function openTab(t: Tab, page?: string, params?: PageParams): void {
  popToRoot(t);
  if (page) pushPage(t, page, params);
  activeTab.value = t;
}

/**
 * Tab bar tap: another tab is shown with its stack as it was; tapping the active tab goes back to
 * its root. Returns true when the active tab was tapped while already at its root (the caller
 * scrolls to the top then).
 */
export function selectTab(t: Tab): boolean {
  if (activeTab.value !== t) {
    activeTab.value = t;
    return false;
  }
  if (stacks.value[t].length > 0) {
    popToRoot(t);
    return false;
  }
  return true;
}

onResetSession(() => {
  stacks.value = emptyStacks();
  titles.clear();
});
