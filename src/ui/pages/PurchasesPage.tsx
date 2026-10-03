// Page «Покупки» (registered as 'purchases' in src/ui/pages.ts); owner D5.
// Plans (cost, saved, date, «Хватит ли денег» from the forecast weeks, as on the tracker's sheet)
// and bought purchases (price, account). A row opens PurchaseForm.
import { useMemo } from 'preact/hooks';
import { forecast, leftToSave, opt, purchaseFact, purchaseStatus } from '../../engine';
import type { Data, Forecast, Purchase, PurchaseStatus } from '../../engine';
import { formatDate, formatMoney } from '../format';
import { EmptyState, Icon, Money, Page, ProgressBar, Row, Section, StatCard, StatGrid } from '../kit';
import type { RoutedPageProps } from '../nav';
import { openSheet } from '../sheets/host';
import { DOT, dotted } from '../sheets/planForm';
import { accountName, appData, today } from '../state';
import './PurchasesPage.css';

/** How the engine's purchaseStatus («Хватит ли денег») is shown. */
const STATUS: Record<PurchaseStatus, { label: string; tone: string }> = {
  bought: { label: 'Куплено', tone: 'green' },
  savings: { label: 'Из сбережений', tone: 'default' }, // from a savings account: not compared with the cushion
  enough: { label: 'Хватает', tone: 'green' },
  short: { label: 'Не хватает', tone: 'red' },
  outside: { label: 'Вне прогноза', tone: 'muted' },
};

const ENOUGH_NOTE = '«Хватает» — по прогнозу остаток на конец недели покупки не ниже подушки.';

function StatusText({ status }: { status: PurchaseStatus }) {
  const s = STATUS[status];
  return <span class={`purchases-status tone-${s.tone}`}>{s.label}</span>;
}

function describe(p: Purchase): string {
  const date = opt(p.date);
  return dotted([opt(p.category), date !== undefined ? formatDate(date) : 'без даты']);
}

function PlanRow({ d, p, fc }: { d: Data; p: Purchase; fc: Forecast | null }) {
  const cost = p.cost ?? 0;
  const saved = p.saved ?? 0;
  const status = fc ? purchaseStatus(p, fc, d) : null;
  return (
    <Row
      title={p.what}
      subtitle={describe(p)}
      // a plan without a cost has no amount to show («—», not 0,00 €)
      value={p.cost !== undefined ? <Money value={p.cost} /> : '—'}
      valueTone={p.cost !== undefined ? 'default' : 'muted'}
      onClick={() => openSheet('purchase', { initial: p })}
      bar={
        cost > 0 ? (
          <ProgressBar value={Math.min(saved, cost)} max={cost} tone={saved >= cost ? 'green' : 'tint'} label="Отложено из стоимости" />
        ) : undefined
      }
    >
      <span class="purchases-line">
        Отложено {formatMoney(saved)}
        {cost > 0 && <> из {formatMoney(cost)}</>}
        {status && (
          <>
            {DOT}
            <StatusText status={status} />
          </>
        )}
      </span>
    </Row>
  );
}

function BoughtRow({ d, p }: { d: Data; p: Purchase }) {
  const account = accountName(d, opt(p.account));
  return (
    <Row
      title={p.what}
      subtitle={describe(p)}
      value={<Money value={purchaseFact(p)} />}
      onClick={() => openSheet('purchase', { initial: p })}
    >
      <span class="purchases-line">
        <StatusText status="bought" />
        {account && `${DOT}${account}`}
      </span>
    </Row>
  );
}

export function PurchasesPage(_props: RoutedPageProps) {
  const d = appData();
  const plans = d.purchases.filter((p) => !p.bought);
  const bought = d.purchases.filter((p) => p.bought);
  const needsForecast = plans.some((p) => opt(p.date) !== undefined);
  const day = today();
  const fc = useMemo(() => (needsForecast ? forecast(d, day) : null), [d, day, needsForecast]);
  const add = () => openSheet('purchase');

  const cost = plans.reduce((s, p) => s + (p.cost ?? 0), 0);
  const saved = plans.reduce((s, p) => s + (p.saved ?? 0), 0);
  const left = leftToSave(plans); // «Осталось накопить» of the tracker (its H column)
  const fromSavings = fc !== null && plans.some((p) => purchaseStatus(p, fc, d) === 'savings');

  return (
    <Page
      title="Покупки"
      right={
        <button type="button" class="icon-button" aria-label="Новая покупка" onClick={add}>
          <Icon name="plus" />
        </button>
      }
    >
      {d.purchases.length === 0 ? (
        <EmptyState
          title="Покупок пока нет"
          text="Крупные покупки, на которые копите: сколько стоит, сколько отложено и хватит ли денег к дате."
          action={{ label: 'Добавить покупку', onClick: add }}
        />
      ) : (
        <>
          {plans.length > 0 && (
            <StatGrid>
              <StatCard label="Стоимость" value={cost} />
              <StatCard label="Отложено" value={saved} />
              <StatCard label="Осталось накопить" value={left} />
            </StatGrid>
          )}
          {plans.length > 0 && (
            <Section
              header="Планы"
              footer={
                fromSavings
                  ? `${ENOUGH_NOTE} «Из сбережений» — покупка со сберегательного счёта: в прогнозе её нет.`
                  : ENOUGH_NOTE
              }
            >
              {plans.map((p) => (
                <PlanRow key={p.id} d={d} p={p} fc={fc} />
              ))}
            </Section>
          )}
          {bought.length > 0 && (
            <Section header="Куплено">
              {bought.map((p) => (
                <BoughtRow key={p.id} d={d} p={p} />
              ))}
            </Section>
          )}
        </>
      )}
    </Page>
  );
}
