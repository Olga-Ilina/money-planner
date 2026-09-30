// What a tab shows: the page on top of its stack (src/ui/pages.ts), or its root screen.
import type { ComponentType } from 'preact';
import { useMemo } from 'preact/hooks';
import { EmptyState, Page } from './kit';
import { PageContext, currentPage, stackDepth } from './nav';
import type { PageContextValue } from './nav';
import { pages } from './pages';
import { Accounts } from './screens/Accounts';
import { Feed } from './screens/Feed';
import { More } from './screens/More';
import { Reports } from './screens/Reports';
import { Today } from './screens/Today';
import type { Tab } from './state';

const ROOTS: Record<Tab, ComponentType> = { today: Today, feed: Feed, accounts: Accounts, reports: Reports, more: More };

function NotFound() {
  return (
    <Page title="Не найдено">
      <EmptyState title="Страница не найдена" />
    </Page>
  );
}

export function TabContent({ tab }: { tab: Tab }) {
  const entry = currentPage(tab);
  const depth = stackDepth(tab);
  const ctx = useMemo<PageContextValue>(() => ({ tab, depth, backTitle: entry?.backTitle }), [tab, depth, entry]);
  const Root = ROOTS[tab];
  const Routed = entry ? pages[entry.page] : undefined;
  let content;
  if (!entry) content = <Root />;
  // keyed by the push, so the same page pushed again with other params starts afresh
  else if (Routed) content = <Routed key={entry.key} params={entry.params} />;
  else content = <NotFound key={entry.key} />;
  return <PageContext.Provider value={ctx}>{content}</PageContext.Provider>;
}
