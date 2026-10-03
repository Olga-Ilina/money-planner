// Root screen of the «Отчёты» tab: «Месяц» (expense categories with limit, plan and fact; below them, as the tracker's
// «Месяц», «Переводы в накопления», «Свободно после накоплений» and the card repayment, none in the expenses), «Год» (income
// and expense per month — chart, table, categories × months) and «Прогноз» (weekly balance with the
// cushion, the three forecast months). Every number comes from the engine; the download button exports
// the view shown: the month report, the year statistics or the forecast (.xlsx). The chosen view and month
// survive tab switches.
import { signal } from '@preact/signals';
import type { ComponentChildren } from 'preact';
import { useMemo, useRef } from 'preact/hooks';
import {
  CARD_REPAYMENT_LABEL, FREE_AFTER_SAVINGS_LABEL, TO_SAVINGS_LABEL, accountingMonths, creditCardId, forecast, forecastCardRepayment,
  forecastMonths, monthCardRepayment,
  monthLabel, monthStart, monthSummary, ymOf, yearStats,
} from '../../engine';
import type { CategorySummary, Data, ForecastMonth, ForecastWeek, YM, YearStats } from '../../engine';
import { forecastChartConfig, shortMonth, useChart, weekLabel, yearChartConfig } from '../charts';
import type { ChartBuilder } from '../charts';
import { formatDay, formatMoney, roundCents } from '../format';
import { ioErrorMessage, loadReports } from '../io';
import {
  Icon, Money, MonthPicker, Page, ProgressBar, Row, Section, Segmented, StatCard, StatGrid, showToast,
} from '../kit';
import { shareFile } from '../share';
import { appData, clampMonth, onResetSession, today } from '../state';
import './Reports.css';

type View = 'month' | 'year' | 'forecast';

const VIEWS: { value: View; label: string }[] = [
  { value: 'month', label: 'Месяц' },
  { value: 'year', label: 'Год' },
  { value: 'forecast', label: 'Прогноз' },
];

const EXPORT_LABEL: Record<View, string> = {
  month: 'Выгрузить отчёт за месяц',
  year: 'Выгрузить статистику года',
  forecast: 'Выгрузить прогноз',
};

/** The chosen view and month: kept while the tab is switched (the screen unmounts). */
const view = signal<View>('month');
const chosenMonth = signal<YM | null>(null);
/** An export is running — also while the tab is switched, so a second one cannot be started meanwhile. */
const exporting = signal(false);

onResetSession(() => {
  view.value = 'month';
  chosenMonth.value = null;
  exporting.value = false;
});

const capitalize = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
const lowerFirst = (s: string): string => s.charAt(0).toLowerCase() + s.slice(1);
/** 'Октябрь 2026 — сентябрь 2027'. */
const monthRange = (a: YM, b: YM): string => `${monthLabel(a)} — ${lowerFirst(monthLabel(b))}`;
const isZero = (n: number): boolean => roundCents(n) === 0;

export function Reports() {
  const d = appData();
  const current = ymOf(today());
  const months = accountingMonths(d.settings);
  const ym = clampMonth(chosenMonth.value ?? current, months, current);
  const v = view.value;
  const busy = exporting.value;

  // straight from the tap: Safari opens the share sheet only shortly after it
  const exportReport = async (kind: View) => {
    if (exporting.value) return;
    exporting.value = true;
    try {
      const { monthReport, yearReport, forecastReport } = await loadReports();
      const data = appData();
      const file =
        kind === 'month' ? await monthReport(data, ym) : kind === 'year' ? await yearReport(data) : await forecastReport(data);
      await shareFile(file.filename, file.buffer);
    } catch (e) {
      showToast(ioErrorMessage(e));
    } finally {
      exporting.value = false;
    }
  };

  const fm = forecastMonths(d.settings);
  const subtitle =
    v === 'forecast'
      ? monthRange(fm[0] ?? current, fm[fm.length - 1] ?? current)
      : monthRange(months[0] ?? current, months[months.length - 1] ?? current);

  const right = (
    <button type="button" class="icon-button" aria-label={EXPORT_LABEL[v]} disabled={busy} onClick={() => void exportReport(v)}>
      <Icon name="download" size={22} />
    </button>
  );

  return (
    <Page title="Отчёты" subtitle={subtitle} right={right}>
      <div class="reports-segment">
        <Segmented label="Вид отчёта" options={VIEWS} value={v} onChange={(x) => (view.value = x)} />
      </div>
      {v === 'month' && <MonthView data={d} ym={ym} months={months} today={today()} />}
      {v === 'year' && <YearView data={d} />}
      {v === 'forecast' && <ForecastView data={d} today={today()} />}
    </Page>
  );
}

// ── Месяц ────────────────────────────────────────────────────────────────

function MonthView({ data, ym, months, today: day }: { data: Data; ym: YM; months: YM[]; today: string }) {
  const s = useMemo(() => monthSummary(data, ym), [data, ym]);
  const repayment = useMemo(() => monthCardRepayment(data, ym, day), [data, ym, day]);
  const rows = s.byCategory.filter((c) => c.limit !== undefined || !isZero(c.plan) || !isZero(c.fact));
  const none = s.uncategorized;
  const showNone = !isZero(none.plan) || !isZero(none.fact);
  // transfers into savings: a line of the categories (the last one, not in «Расход»), only when the month has them
  const toSavings = !isZero(s.toSavings.plan) || !isZero(s.toSavings.fact);
  const showRepayment = !isZero(repayment.plan);
  const hasLimits = s.byCategory.some((c) => c.limit !== undefined);
  const footer = !hasLimits
    ? undefined
    : roundCents(s.limitsLeft) >= 0
      ? `По лимитам осталось ${formatMoney(s.limitsLeft)} из ${formatMoney(s.limitsTotal)}`
      : `Лимиты превышены на ${formatMoney(-s.limitsLeft)}`;

  return (
    <>
      <div class="reports-month">
        <MonthPicker value={ym} months={months} onChange={(m) => (chosenMonth.value = m)} />
      </div>
      <StatGrid>
        <StatCard label="Доход" value={s.incomeFact} sub={`план ${formatMoney(s.incomePlan)}`} />
        <StatCard label="Расход" value={s.expenseFact} sub={`план ${formatMoney(s.expensePlan)}`} />
        <StatCard label="Баланс" value={s.balanceFact} />
      </StatGrid>
      <Section header="Расходы по категориям" footer={footer}>
        {rows.length === 0 && !showNone && !toSavings ? (
          <p class="reports-empty">В этом месяце нет ни плана, ни трат</p>
        ) : (
          <>
            {rows.map((c) => (
              <CategoryRow key={c.name} c={c} />
            ))}
            {showNone && <CategoryRow c={{ name: 'Без категории', plan: none.plan, fact: none.fact }} />}
            {toSavings && (
              <Row
                icon="arrows"
                iconTone="teal"
                title={TO_SAVINGS_LABEL}
                subtitle={`План ${formatMoney(s.toSavings.plan)} · не в расходах`}
                value={<Money value={s.toSavings.fact} tone="plain" />}
              />
            )}
          </>
        )}
      </Section>
      {(toSavings || showRepayment) && (
        <Section footer={linesFooter(toSavings, showRepayment)}>
          {toSavings && (
            <Row
              title={FREE_AFTER_SAVINGS_LABEL}
              subtitle={`План ${formatMoney(s.freeAfterSavings.plan)}`}
              value={<Money value={s.freeAfterSavings.fact} />}
            />
          )}
          {showRepayment && (
            <Row
              icon="card"
              iconTone="muted"
              title={`${CARD_REPAYMENT_LABEL} (${repayment.day}-го)`}
              subtitle={`Справочно, уже учтено · ${debited(repayment)}`}
              value={<Money value={repayment.plan} tone="plain" />}
              valueTone="muted"
            />
          )}
        </Section>
      )}
    </>
  );
}

/** What the lines under the categories are (in no sum of the month). */
function linesFooter(toSavings: boolean, repayment: boolean): string {
  const free = 'Свободно после накоплений — доходы минус расходы и переводы в накопления.';
  const card = 'Погашение кредитки не входит в расходы: покупки по кредитке уже там.';
  return [toSavings ? free : '', repayment ? card : ''].filter(Boolean).join(' ');
}

/** «списано» (all of it), «ожидается» (nothing yet) or «списано N» (a part) of the month's card repayment. */
function debited(r: { plan: number; fact: number }): string {
  if (roundCents(r.fact) === roundCents(r.plan)) return 'списано';
  return isZero(r.fact) ? 'ожидается' : `списано ${formatMoney(r.fact)}`;
}

type CategoryFigures = Pick<CategorySummary, 'name' | 'limit' | 'plan' | 'fact' | 'left'>;

/**
 * A category: fact on the right; limit, plan and what is left under the name; a bar of fact against the
 * larger of plan and limit. Red over the limit (without a limit: over the plan).
 */
function CategoryRow({ c }: { c: CategoryFigures }) {
  const { name, limit, plan, fact } = c;
  const hasLimit = limit !== undefined;
  const hasPlan = !isZero(plan);
  const over = hasLimit ? roundCents(fact) > roundCents(limit) : hasPlan && roundCents(fact) > roundCents(plan);
  const parts: string[] = [];
  if (hasLimit) parts.push(`лимит ${formatMoney(limit)}`);
  if (hasPlan) parts.push(`план ${formatMoney(plan)}`);
  if (hasLimit) {
    const left = c.left ?? limit - fact;
    parts.push(roundCents(left) >= 0 ? `осталось ${formatMoney(left)}` : `перерасход ${formatMoney(-left)}`);
  }
  const subtitle = parts.length > 0 ? capitalize(parts.join(' · ')) : 'Без плана';
  const of = hasLimit && limit >= plan ? 'лимита' : 'плана';
  return (
    <Row title={name} subtitle={subtitle} value={<Money value={fact} tone="plain" />} valueTone={over ? 'red' : 'default'}>
      {(hasLimit || hasPlan) && (
        <ProgressBar
          value={fact}
          max={Math.max(plan, limit ?? 0)}
          tone={over ? 'red' : 'tint'}
          label={`${name}: потрачено из ${of}`}
        />
      )}
    </Row>
  );
}

// ── charts and tables ────────────────────────────────────────────────────

function ChartBox({ label, build, deps }: { label: string; build: ChartBuilder; deps: readonly unknown[] }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const failed = useChart(ref, build, deps);
  return (
    <div class="reports-chart">
      {failed ? (
        <p class="reports-chart-failed">График не загрузился. Цифры — в таблице ниже.</p>
      ) : (
        <div class="reports-chart-box">
          <canvas ref={ref} role="img" aria-label={label} />
        </div>
      )}
    </div>
  );
}

/**
 * A table that scrolls sideways inside its card when it is wider than the screen. The scrolling region carries
 * the name (it is focusable, so it needs one); the table inside is not named again.
 */
function ScrollTable({ label, wide, children }: { label: string; wide?: boolean; children: ComponentChildren }) {
  return (
    <div class="reports-scroll" role="region" aria-label={label} tabIndex={0}>
      <table class={`reports-table${wide ? ' reports-matrix' : ''}`}>{children}</table>
    </div>
  );
}

/** «Окт» on screen, «Октябрь 2026» for VoiceOver. */
function MonthName({ ym }: { ym: YM }) {
  return (
    <>
      <span aria-hidden="true">{shortMonth(ym)}</span>
      <span class="sr-only">{monthLabel(ym)}</span>
    </>
  );
}

// ── Год ──────────────────────────────────────────────────────────────────

function YearView({ data }: { data: Data }) {
  const stats = useMemo(() => yearStats(data), [data]);
  const last = stats.months[stats.months.length - 1];
  const top = stats.maxMonth === null ? undefined : stats.months.find((m) => m.label === stats.maxMonth);
  const sum = (key: 'incomeFact' | 'expenseFact' | 'balance') => stats.months.reduce((acc, m) => acc + m[key], 0);

  return (
    <>
      <Section header="Доход и расход по месяцам">
        <ChartBox
          label="Доход и расход по месяцам, столбцы. Цифры — в таблице «По месяцам»."
          build={(env) => yearChartConfig(stats.months, env)}
          deps={[stats]}
        />
      </Section>
      <StatGrid>
        <StatCard label="Средний расход" value={stats.avgExpense} />
        {top && <StatCard label="Самый дорогой месяц" value={top.expenseFact} sub={top.label} />}
        <StatCard label="Накоплено за год" value={last?.cumulative ?? 0} />
      </StatGrid>
      <Section header="По месяцам">
        <ScrollTable label="По месяцам">
          <thead>
            <tr>
              <th scope="col">Месяц</th>
              <th scope="col">Доход</th>
              <th scope="col">Расход</th>
              <th scope="col">Баланс</th>
              <th scope="col">Накоплено</th>
            </tr>
          </thead>
          <tbody>
            {stats.months.map((m) => (
              <tr key={m.ym}>
                <th scope="row">
                  <MonthName ym={m.ym} />
                </th>
                <td>
                  <Money value={m.incomeFact} />
                </td>
                <td>
                  <Money value={m.expenseFact} />
                </td>
                <td>
                  <Money value={m.balance} />
                </td>
                <td>
                  <Money value={m.cumulative} />
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row">Итого</th>
              <td>
                <Money value={sum('incomeFact')} />
              </td>
              <td>
                <Money value={sum('expenseFact')} />
              </td>
              <td>
                <Money value={sum('balance')} />
              </td>
              <td>
                <Money value={last?.cumulative ?? 0} />
              </td>
            </tr>
          </tfoot>
        </ScrollTable>
      </Section>
      <CategoryMatrix stats={stats} />
    </>
  );
}

/** Categories × months: expense fact per month of the categories with spending, largest total first. */
function CategoryMatrix({ stats }: { stats: YearStats }) {
  const rows = stats.matrix.filter((r) => r.byMonth.some((v) => !isZero(v))).sort((a, b) => b.total - a.total);
  const none = stats.uncategorized;
  const all = none.some((v) => !isZero(v))
    ? [...rows, { name: 'Без категории', byMonth: none, total: none.reduce((a, v) => a + v, 0) }]
    : rows;

  return (
    <Section header="Категории по месяцам">
      {all.length === 0 ? (
        <p class="reports-empty">Трат по категориям нет</p>
      ) : (
        <ScrollTable label="Категории по месяцам" wide>
          <thead>
            <tr>
              <th scope="col">Категория</th>
              <th scope="col">Итого</th>
              {stats.months.map((m) => (
                <th scope="col" key={m.ym}>
                  <MonthName ym={m.ym} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {all.map((r) => (
              <tr key={r.name}>
                <th scope="row">{r.name}</th>
                <td class="reports-total">
                  <Money value={r.total} />
                </td>
                {r.byMonth.map((v, i) =>
                  isZero(v) ? (
                    <td key={i} class="tone-muted">
                      —
                    </td>
                  ) : (
                    <td key={i}>
                      <Money value={v} />
                    </td>
                  ),
                )}
              </tr>
            ))}
          </tbody>
        </ScrollTable>
      )}
    </Section>
  );
}

// ── Прогноз ──────────────────────────────────────────────────────────────

function ForecastView({ data, today: day }: { data: Data; today: string }) {
  const f = useMemo(() => forecast(data, day), [data, day]);
  // «Резерв по лимитам»: a row of the month cards and a column of the weeks only when there is one
  const reserve = f.months.some((m) => !isZero(m.reserve));
  const cushion = data.settings.cushion;
  // below the cushion exactly as the engine counts weeks below it (f.weeksBelow)
  const lowBelow = f.minEnd < cushion;
  const card = creditCardId(data);
  const hasCard = card !== undefined && data.accounts.some((a) => a.id === card);

  return (
    <>
      <Section header="Остаток по неделям">
        <ChartBox
          label="Остаток на конец недели и подушка, линии. Цифры — в таблице «По неделям»."
          build={(env) => forecastChartConfig(f.weeks, env)}
          deps={[f]}
        />
      </Section>
      <Section header="Итоги прогноза">
        <Row
          title="Недель ниже подушки"
          value={`${f.weeksBelow} из ${f.weeks.length}`}
          valueTone={f.weeksBelow > 0 ? 'red' : 'default'}
        />
        <Row
          title="Минимальный остаток"
          subtitle={`Неделя с ${formatDay(f.minWeekFrom)}`}
          value={<Money value={f.minEnd} tone="plain" />}
          valueTone={lowBelow ? 'red' : 'default'}
        />
        <Row title="Подушка" value={<Money value={cushion} />} />
        <Row
          title="На начало прогноза"
          subtitle={formatDay(monthStart(data.settings.forecastStart), { year: true })}
          value={<Money value={f.start} />}
        />
      </Section>
      {f.months.map((m) => (
        <ForecastMonthCard
          key={m.ym}
          m={m}
          reserve={reserve}
          card={hasCard ? forecastCardRepayment(data, m.ym) : undefined}
        />
      ))}
      <WeeksTable weeks={f.weeks} reserve={reserve} />
    </>
  );
}

type CardRepayment = ReturnType<typeof forecastCardRepayment>;

interface ForecastMonthCardProps {
  m: ForecastMonth;
  reserve: boolean;
  card?: CardRepayment | undefined;
}

function ForecastMonthCard({ m, reserve, card }: ForecastMonthCardProps) {
  const parts: string[] = [];
  if (!isZero(m.recurring)) parts.push(`постоянные ${formatMoney(m.recurring)}`);
  if (!isZero(m.oneOff)) parts.push(`разовые ${formatMoney(m.oneOff)}`);
  if (!isZero(m.purchases)) parts.push(`покупки ${formatMoney(m.purchases)}`);
  if (!isZero(m.reserve)) parts.push(`резерв ${formatMoney(m.reserve)}`);
  return (
    <Section header={m.label}>
      <Row title="Доходы" value={<Money value={m.income} />} />
      <Row
        title="Расходы"
        subtitle={parts.length > 0 ? capitalize(parts.join(' · ')) : undefined}
        value={<Money value={m.expenses} />}
      />
      {reserve && (
        <Row
          title="Резерв по лимитам"
          subtitle="Повседневные траты: остаток лимитов · входит в расходы"
          value={<Money value={m.reserve} />}
        />
      )}
      {!isZero(m.transfers) && (
        <Row title="Переводы в сбережения / из сбережений" value={<Money value={m.transfers} signed />} />
      )}
      <Row title="Остаток на конец" value={<Money value={m.end} />} />
      <Row title="Запас над подушкой" value={<Money value={m.overCushion} />} />
      {/* «Кредиты (погашение кредитки, справочно)»: in no sum — the card's spending is already in «Расходы» */}
      {card && (
        <Row
          icon="card"
          iconTone="muted"
          title="Кредиты"
          subtitle={card.auto ? `${CARD_REPAYMENT_LABEL} ${card.day}-го · справочно, не в расходах` : 'Автопогашение выключено'}
          value={<Money value={card.amount} tone="plain" />}
          valueTone="muted"
        />
      )}
    </Section>
  );
}

function WeeksTable({ weeks, reserve }: { weeks: ForecastWeek[]; reserve: boolean }) {
  // transfers to or from savings: a column only when some week has them
  const transfers = weeks.some((w) => !isZero(w.transfers));
  const footer = [
    'Значком отмечены недели, которые заканчиваются ниже подушки.',
    reserve ? 'Резерв — повседневные траты по лимитам, поровну на каждый день месяца; входит в расходы.' : '',
    transfers ? 'Переводы — в сбережения (−) и из сбережений (+).' : '',
  ].filter(Boolean).join(' ');
  return (
    <Section header="По неделям" footer={footer}>
      <ScrollTable label="По неделям">
        <thead>
          <tr>
            <th scope="col">Неделя</th>
            <th scope="col">Остаток</th>
            <th scope="col">Доходы</th>
            <th scope="col">Расходы</th>
            {reserve && <th scope="col">Резерв</th>}
            {transfers && <th scope="col">Переводы</th>}
          </tr>
        </thead>
        <tbody>
          {weeks.map((w) => {
            const below = w.end < w.cushion; // as the engine counts f.weeksBelow
            return (
              <tr key={w.n}>
                <th scope="row">{weekLabel(w)}</th>
                {/* the end balance first: at 375 pt the last column is scrolled out of view */}
                <td class={below ? 'tone-red' : undefined}>
                  {below && (
                    <span class="reports-below">
                      <Icon name="warning" size={14} />
                      <span class="sr-only">ниже подушки: </span>
                    </span>
                  )}
                  <Money value={w.end} tone={below ? 'plain' : 'auto'} />
                </td>
                <td>
                  <Money value={w.income} />
                </td>
                <td>
                  <Money value={w.expenses} />
                </td>
                {reserve && (
                  <td>
                    <Money value={w.reserve} />
                  </td>
                )}
                {transfers && (
                  <td>
                    <Money value={w.transfers} signed />
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </ScrollTable>
    </Section>
  );
}
