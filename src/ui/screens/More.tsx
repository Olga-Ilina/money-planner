// Root screen of the «Ещё» tab; owner: D6. Plans (recurring payments, purchases, debts), settings
// (categories and limits, accounts and the credit card, accounting and forecast, PIN), data (the sync with
// the Mac, tracker import, backup) and «О приложении» — each row opens its page in this tab.
import type { ComponentChildren } from 'preact';
import { version } from '../../../package.json';
import { needsBackup } from '../actions';
import { formatDate, localDateOf } from '../format';
import { Page, Row, Section } from '../kit';
import type { IconName } from '../kit';
import { pushPage } from '../nav';
import { data, meta } from '../state';
import { syncOf } from '../sync';

const open = (page: string) => () => pushPage('more', page);

/** A count for the row's value; nothing when there is none. */
const count = (n: number | undefined): string | undefined => (n ? String(n) : undefined);

/** «Последняя копия 20.09.2026», with «— пора сделать новую» in the warning colour once one is due. */
function backupLine(): ComponentChildren {
  const last = localDateOf(meta.value.lastBackupAt);
  if (!last) return 'Копии ещё не было';
  if (!needsBackup(meta.value, data.value)) return `Последняя копия ${formatDate(last)}`;
  return (
    <>
      {`Последняя копия ${formatDate(last)} `}
      <span class="tone-orange">— пора сделать новую</span>
    </>
  );
}

/** «Последняя 01.10.2026» once synced; what it is before the first sync. */
function syncLine(): string {
  const last = localDateOf(syncOf(meta.value)?.lastAt);
  return last ? `Последняя ${formatDate(last)}` : 'С Mac через iCloud Drive';
}

interface Item {
  title: string;
  page: string;
  icon: IconName;
  value?: string;
  subtitle?: ComponentChildren;
}

export function More() {
  const d = data.value;
  const sections: { header?: string; items: Item[] }[] = [
    {
      header: 'Планы',
      items: [
        { title: 'Постоянные платежи', page: 'recurring', icon: 'repeat', value: count(d?.recurring.length) },
        { title: 'Покупки', page: 'purchases', icon: 'cart', value: count(d?.purchases.length) },
        { title: 'Долги', page: 'debts', icon: 'debt', value: count(d?.debts.length) },
      ],
    },
    {
      header: 'Настройки',
      items: [
        { title: 'Категории и лимиты', page: 'categories', icon: 'tag' },
        { title: 'Счета и кредитка', page: 'accounts-settings', icon: 'wallet' },
        { title: 'Учёт и прогноз', page: 'settings', icon: 'sliders' },
        { title: 'PIN-код', page: 'pin', icon: 'lock' },
      ],
    },
    {
      header: 'Данные',
      items: [
        { title: 'Синхронизация', page: 'sync', icon: 'arrows', subtitle: syncLine() },
        { title: 'Загрузить трекер', page: 'import', icon: 'upload', subtitle: 'Из Excel, заменит данные' },
        { title: 'Резервная копия', page: 'backup', icon: 'share', subtitle: backupLine() },
      ],
    },
    { items: [{ title: 'О приложении', page: 'about', icon: 'info', value: version }] },
  ];

  return (
    <Page title="Ещё">
      {sections.map((s) => (
        <Section key={s.header ?? 'about'} header={s.header}>
          {s.items.map((item) => (
            <Row
              key={item.page}
              icon={item.icon}
              title={item.title}
              subtitle={item.subtitle}
              value={item.value}
              valueTone="muted"
              chevron
              onClick={open(item.page)}
            />
          ))}
        </Section>
      ))}
    </Page>
  );
}
