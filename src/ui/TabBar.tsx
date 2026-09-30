// Bottom tab bar: Сегодня, Лента, Счета, Отчёты, Ещё. Tapping the active tab goes back to its root,
// and at the root scrolls to the top.
import { Icon } from './kit';
import type { IconName } from './kit';
import { selectTab } from './nav';
import { TABS, TAB_TITLES, tab } from './state';
import type { Tab } from './state';

const ICONS: Record<Tab, IconName> = { today: 'home', feed: 'list', accounts: 'wallet', reports: 'chart', more: 'more' };

function scrollToTop(): void {
  const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' });
}

export function TabBar() {
  const active = tab.value;
  return (
    <nav class="tabbar" aria-label="Разделы">
      <div class="tabbar-inner">
        {TABS.map((t) => (
          <button
            type="button"
            key={t}
            class={`tab${t === active ? ' tab-active' : ''}`}
            aria-current={t === active ? 'page' : undefined}
            onClick={() => {
              if (selectTab(t)) scrollToTop();
            }}
          >
            <Icon name={ICONS[t]} size={26} />
            <span class="tab-label">{TAB_TITLES[t]}</span>
          </button>
        ))}
      </div>
    </nav>
  );
}
