// @vitest-environment happy-dom
// «Отчёты»: month (categories with limit / plan / fact), year (chart, table, categories × months) and
// forecast (weekly balance with the cushion, three months) — numbers from the engine's scenario.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { IDBFactory } from 'fake-indexeddb';
import { forecast } from '../../../src/engine';
import type { Data } from '../../../src/engine';
import * as db from '../../../src/store/db';
import { actions } from '../../../src/ui/actions';
import { formatMoney } from '../../../src/ui/format';
import * as io from '../../../src/ui/io';
import { Toast } from '../../../src/ui/kit';
import { Reports } from '../../../src/ui/screens/Reports';
import * as share from '../../../src/ui/share';
import { SheetHost } from '../../../src/ui/sheets/host';
import { data, resetSession } from '../../../src/ui/state';
import { ACC, scenario } from '../../engine/scenario';
import { withBox } from '../../engine/savingsScenario';

const chartJs = vi.hoisted(() => {
  class FakeChart {
    static instances: FakeChart[] = [];
    static fail = false;
    type: string;
    data: { labels: string[]; datasets: { label: string; data: number[] }[] };
    options: unknown;
    destroyed = false;
    constructor(
      public canvas: HTMLCanvasElement,
      config: { type: string; data: FakeChart['data']; options: unknown },
    ) {
      if (FakeChart.fail) throw new Error('no canvas');
      this.type = config.type;
      this.data = config.data;
      this.options = config.options;
      FakeChart.instances.push(this);
    }
    update() {}
    destroy() {
      this.destroyed = true;
    }
  }
  return { FakeChart };
});

vi.mock('chart.js/auto', () => ({ default: chartJs.FakeChart }));

vi.mock('../../../src/ui/io', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../../src/ui/io')>();
  return { ...mod, loadReports: vi.fn(mod.loadReports) };
});

vi.mock('../../../src/ui/share', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../../src/ui/share')>();
  return { ...mod, shareFile: vi.fn(async () => 'shared' as const) };
});

const { FakeChart } = chartJs;

const money = (n: number) => formatMoney(n);
/** getByText compares with the text as shown, with runs of spaces (and no-break spaces) collapsed. */
const plain = (s: string) => s.replace(/\s+/g, ' ');

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function statCard(label: string): HTMLElement {
  const el = screen.getByText(label, { selector: '.stat-label' }).closest('.stat-card');
  if (!(el instanceof HTMLElement)) throw new Error(`no stat card «${label}»`);
  return el;
}

function row(title: string): HTMLElement {
  const el = screen.getByText(title, { selector: '.row-title' }).closest('.row');
  if (!(el instanceof HTMLElement)) throw new Error(`no row «${title}»`);
  return el;
}

function section(header: string): HTMLElement {
  const el = screen.getByRole('heading', { name: header, level: 2 }).closest('.section');
  if (!(el instanceof HTMLElement)) throw new Error(`no section «${header}»`);
  return el;
}

/** The table inside the scrolling region called `name` (the region carries the label, the table does not). */
function tableIn(name: string): HTMLTableElement {
  const table = screen.getByRole('region', { name }).querySelector('table');
  if (!table) throw new Error(`no table in the region «${name}»`);
  return table;
}

function bodyRows(tableName: string): HTMLTableRowElement[] {
  return [...tableIn(tableName).querySelectorAll('tbody tr')] as HTMLTableRowElement[];
}

function show(view: 'Месяц' | 'Год' | 'Прогноз'): void {
  fireEvent.click(screen.getByRole('radio', { name: view }));
}

function renderReports() {
  return render(
    <>
      <Reports />
      <SheetHost />
      <Toast />
    </>,
  );
}

function withData(change?: (d: Data) => void): Data {
  const d = scenario();
  change?.(d);
  data.value = d;
  return d;
}

beforeEach(() => {
  db.useFactory(new IDBFactory());
  vi.setSystemTime(new Date(2026, 9, 15, 12, 0, 0)); // 15.10.2026, local time
  resetSession();
  FakeChart.instances = [];
  FakeChart.fail = false;
  vi.mocked(io.loadReports).mockClear();
  vi.mocked(share.shareFile).mockClear();
});

afterEach(async () => {
  cleanup();
  await actions.flush();
  resetSession();
  db.useFactory(undefined);
  vi.useRealTimers();
});

describe('Отчёты — месяц', () => {
  it('starts on the current accounting month with its totals', () => {
    withData();
    renderReports();
    expect(screen.getByRole('heading', { name: 'Отчёты', level: 1 })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Месяц' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByText('Октябрь 2026', { selector: '.month-picker-label' })).toBeTruthy();
    expect(screen.getByText('Октябрь 2026 — сентябрь 2027')).toBeTruthy(); // the accounting year
    expect(statCard('Доход').textContent).toContain(money(3205));
    expect(statCard('Доход').textContent).toContain(`план ${money(3200)}`);
    expect(statCard('Расход').textContent).toContain(money(1235));
    expect(statCard('Расход').textContent).toContain(`план ${money(1180)}`);
    expect(statCard('Баланс').textContent).toContain(money(1970));
  });

  it('a row per category with plan and fact and a bar of fact against the plan; over the plan is red', () => {
    withData();
    renderReports();
    const food = row('Продукты');
    expect(food.textContent).toContain(money(210));
    expect(food.textContent).toContain(`План ${money(180)}`);
    const bar = within(food).getByRole('progressbar', { name: 'Продукты: потрачено из плана' });
    expect(bar.getAttribute('aria-valuemax')).toBe('180');
    expect(food.querySelector('.row-value')?.classList.contains('tone-red')).toBe(true);
    const rent = row('Жильё');
    expect(rent.textContent).toContain(money(900));
    expect(rent.querySelector('.row-value')?.classList.contains('tone-red')).toBe(false);
    // nothing planned, spent or limited in October
    expect(screen.queryByText('Подписки', { selector: '.row-title' })).toBeNull();
    expect(screen.queryByText('Техника', { selector: '.row-title' })).toBeNull();
  });

  it('limits: what is left or overspent, the bar against the larger of limit and plan, red only over the limit', () => {
    withData((d) => {
      d.categories.expense[1] = { name: 'Продукты', limit: 200 }; // fact 210, plan 180
      d.categories.expense[2] = { name: 'Транспорт', limit: 150 }; // fact 125, plan 100
    });
    renderReports();
    const food = row('Продукты');
    expect(food.textContent).toContain(`Лимит ${money(200)} · план ${money(180)} · перерасход ${money(10)}`);
    expect(within(food).getByRole('progressbar').getAttribute('aria-valuemax')).toBe('200');
    expect(food.querySelector('.row-value')?.classList.contains('tone-red')).toBe(true);
    const transport = row('Транспорт');
    expect(transport.textContent).toContain(`Лимит ${money(150)} · план ${money(100)} · осталось ${money(25)}`);
    const bar = within(transport).getByRole('progressbar', { name: 'Транспорт: потрачено из лимита' });
    expect(bar.getAttribute('aria-valuenow')).toBe('125');
    expect(transport.querySelector('.row-value')?.classList.contains('tone-red')).toBe(false);
    expect(transport.querySelector('.progress-fill')?.classList.contains('tone-red')).toBe(false);
    expect(screen.getByText(plain(`По лимитам осталось ${money(15)} из ${money(350)}`))).toBeTruthy();
  });

  it('a category over its limit of 0 is red; overspent limits in the footer', () => {
    withData((d) => {
      d.categories.expense[2] = { name: 'Транспорт', limit: 0 };
    });
    renderReports();
    const transport = row('Транспорт');
    expect(transport.textContent).toContain(`Лимит ${money(0)} · план ${money(100)} · перерасход ${money(125)}`);
    expect(transport.querySelector('.row-value')?.classList.contains('tone-red')).toBe(true);
    expect(screen.getByText(plain(`Лимиты превышены на ${money(125)}`))).toBeTruthy();
  });

  it('spending without plan or limit: no bar, «Без плана»; spending without a category: «Без категории»', () => {
    withData((d) => {
      d.operations.push(
        { id: 'o-tech', date: '2026-10-22', kind: 'expense', category: 'Техника', what: 'Кабель', amount: 40, account: ACC.card },
        { id: 'o-none', date: '2026-10-23', kind: 'expense', what: 'Что-то', amount: 15, account: ACC.card },
      );
    });
    renderReports();
    const tech = row('Техника');
    expect(tech.textContent).toContain('Без плана');
    expect(tech.textContent).toContain(money(40));
    expect(within(tech).queryByRole('progressbar')).toBeNull();
    expect(tech.querySelector('.row-value')?.classList.contains('tone-red')).toBe(false);
    expect(row('Без категории').textContent).toContain(money(15));
  });

  it('steps through the accounting months; the chosen month survives leaving the tab', () => {
    withData();
    const view = renderReports();
    fireEvent.click(screen.getByRole('button', { name: 'Следующий месяц' }));
    expect(screen.getByText('Ноябрь 2026', { selector: '.month-picker-label' })).toBeTruthy();
    expect(row('Жильё').textContent).toContain(money(950));
    expect(statCard('Расход').textContent).toContain(money(1010));
    view.unmount();
    renderReports();
    expect(screen.getByText('Ноябрь 2026', { selector: '.month-picker-label' })).toBeTruthy();
  });

  it('a planned month shows the plan with an empty bar; a month without plan or spending says so', () => {
    withData();
    const view = renderReports();
    for (let i = 0; i < 4; i++) fireEvent.click(screen.getByRole('button', { name: 'Следующий месяц' }));
    expect(screen.getByText('Февраль 2027', { selector: '.month-picker-label' })).toBeTruthy();
    // February: rent 900, subscription 10 and insurance 30 planned (recurring), nothing spent yet
    const rent = row('Жильё');
    expect(rent.textContent).toContain(`План ${money(900)}`);
    expect(within(rent).getByRole('progressbar').getAttribute('aria-valuenow')).toBe('0');
    expect(row('Подписки').textContent).toContain(`План ${money(40)}`);
    view.unmount();
    withData((d) => {
      d.recurring = [];
    });
    renderReports();
    expect(screen.getByText('Февраль 2027', { selector: '.month-picker-label' })).toBeTruthy();
    expect(screen.getByText('В этом месяце нет ни плана, ни трат')).toBeTruthy();
  });

  it('exports the month report of the chosen month through the share sheet', async () => {
    const d = withData();
    const buffer = new ArrayBuffer(8);
    const monthReport = vi.fn(async () => ({ filename: 'Отчёт 2026-11.xlsx', buffer }));
    const yearReport = vi.fn();
    vi.mocked(io.loadReports).mockResolvedValueOnce({ monthReport, yearReport } as never);
    renderReports();
    fireEvent.click(screen.getByRole('button', { name: 'Следующий месяц' }));
    fireEvent.click(screen.getByRole('button', { name: 'Выгрузить отчёт за месяц' }));
    await waitFor(() => expect(share.shareFile).toHaveBeenCalledWith('Отчёт 2026-11.xlsx', buffer));
    expect(monthReport).toHaveBeenCalledWith(d, '2026-11');
    expect(yearReport).not.toHaveBeenCalled();
  });

  it('a failed export shows why in a toast', async () => {
    withData();
    vi.mocked(io.loadReports).mockRejectedValueOnce(new io.ModuleLoadError());
    renderReports();
    fireEvent.click(screen.getByRole('button', { name: 'Выгрузить отчёт за месяц' }));
    expect(await screen.findByText('Не удалось загрузить модуль, проверьте подключение.')).toBeTruthy();
    expect(share.shareFile).not.toHaveBeenCalled();
  });
});

describe('Отчёты — выгрузка прогноза', () => {
  it('«Прогноз» has its download button too: it exports the forecast through the share sheet', async () => {
    const d = withData();
    const buffer = new ArrayBuffer(4);
    const forecastReport = vi.fn(async () => ({ filename: 'Прогноз.xlsx', buffer }));
    const monthReport = vi.fn();
    const yearReport = vi.fn();
    vi.mocked(io.loadReports).mockResolvedValueOnce({ monthReport, yearReport, forecastReport } as never);
    renderReports();
    show('Прогноз');
    expect(screen.getAllByRole('button', { name: /^Выгрузить/ }).map((b) => b.getAttribute('aria-label'))).toEqual(['Выгрузить прогноз']);
    fireEvent.click(screen.getByRole('button', { name: 'Выгрузить прогноз' }));
    await waitFor(() => expect(share.shareFile).toHaveBeenCalledWith('Прогноз.xlsx', buffer));
    expect(forecastReport).toHaveBeenCalledWith(d);
    expect(monthReport).not.toHaveBeenCalled();
    expect(yearReport).not.toHaveBeenCalled();
  });

  it('a failed forecast export shows why in a toast', async () => {
    withData();
    vi.mocked(io.loadReports).mockRejectedValueOnce(new io.ModuleLoadError());
    renderReports();
    show('Прогноз');
    fireEvent.click(screen.getByRole('button', { name: 'Выгрузить прогноз' }));
    expect(await screen.findByText('Не удалось загрузить модуль, проверьте подключение.')).toBeTruthy();
    expect(share.shareFile).not.toHaveBeenCalled();
  });
});

describe('Отчёты — выгрузка', () => {
  const EXPORT = { name: 'Выгрузить отчёт за месяц' };

  it('an export still running survives leaving the tab: no second one can be started from the new screen', async () => {
    withData();
    const gate = deferred<void>();
    const buffer = new ArrayBuffer(8);
    const monthReport = vi.fn(async () => {
      await gate.promise;
      return { filename: 'Отчёт.xlsx', buffer };
    });
    vi.mocked(io.loadReports).mockResolvedValueOnce({ monthReport, yearReport: vi.fn() } as never);
    const first = renderReports();
    fireEvent.click(screen.getByRole('button', EXPORT));
    await waitFor(() => expect(monthReport).toHaveBeenCalledTimes(1));
    expect((screen.getByRole('button', EXPORT) as HTMLButtonElement).disabled).toBe(true);
    first.unmount(); // another tab, and back
    renderReports();
    const button = screen.getByRole('button', EXPORT) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(io.loadReports).toHaveBeenCalledTimes(1);
    expect(monthReport).toHaveBeenCalledTimes(1);
    gate.resolve();
    await waitFor(() => expect(share.shareFile).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(button.disabled).toBe(false)); // the screen on view is enabled again
  });

  it('a new session (lock, wipe) starts with no export running', async () => {
    withData();
    const gate = deferred<void>();
    const monthReport = vi.fn(async () => {
      await gate.promise;
      return { filename: 'Отчёт.xlsx', buffer: new ArrayBuffer(1) };
    });
    vi.mocked(io.loadReports).mockResolvedValueOnce({ monthReport, yearReport: vi.fn() } as never);
    const first = renderReports();
    fireEvent.click(screen.getByRole('button', EXPORT));
    await waitFor(() => expect(monthReport).toHaveBeenCalledTimes(1));
    first.unmount();
    resetSession();
    withData();
    renderReports();
    expect((screen.getByRole('button', EXPORT) as HTMLButtonElement).disabled).toBe(false);
    gate.resolve();
    await waitFor(() => expect(share.shareFile).toHaveBeenCalledTimes(1));
  });
});

describe('Отчёты — доступность и вёрстка', () => {
  const read = (file: string) => readFileSync(join(import.meta.dirname, '../../../src/ui', file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  // the kit's .sr-only is in styles.css, which loads after the screen's CSS
  const css = `${read('screens/Reports.css')}\n${read('styles.css')}`;

  it('the scrolling region carries the name; the table inside does not repeat it', () => {
    withData();
    renderReports();
    show('Год');
    show('Прогноз');
    show('Год');
    const names = ['По месяцам', 'Категории по месяцам'];
    for (const name of names) {
      const region = screen.getByRole('region', { name });
      expect(region.querySelectorAll('table')).toHaveLength(1);
      expect(tableIn(name).hasAttribute('aria-label')).toBe(false);
      expect(tableIn(name).hasAttribute('aria-labelledby')).toBe(false);
    }
    // the same on the forecast view
    show('Прогноз');
    expect(tableIn('По неделям').hasAttribute('aria-label')).toBe(false);
    expect(screen.queryByRole('table', { name: 'По неделям' })).toBeNull();
  });

  it('.reports-scroll is positioned: the visually hidden text (absolute) cannot escape the scroller', () => {
    const rule = (selector: string) => {
      const m = new RegExp(`(?:^|})\\s*${selector.replace('.', '\\.')}\\s*{([^}]*)}`).exec(css);
      return m?.[1] ?? '';
    };
    expect(rule('.sr-only')).toMatch(/position:\s*absolute/);
    expect(rule('.reports-scroll')).toMatch(/position:\s*relative/);
  });

  it('every visually hidden text has a positioned ancestor inside its scroller (no page-wide overflow)', () => {
    withData();
    const style = document.createElement('style');
    style.textContent = css;
    document.head.append(style);
    // happy-dom reports an unset `position` as ''
    const positioned = (el: Element) => !['', 'static'].includes(getComputedStyle(el).position);
    const escapes = () =>
      [...document.querySelectorAll('.reports-scroll .sr-only')].filter((el) => {
        let up = el.parentElement;
        while (up && !positioned(up)) up = up.parentElement;
        return !(up && el.closest('.reports-scroll')?.contains(up));
      });
    try {
      renderReports();
      show('Год');
      expect(document.querySelectorAll('.reports-scroll .sr-only').length).toBeGreaterThan(12);
      expect(positioned(document.querySelector('.reports-scroll') as Element)).toBe(true);
      expect(escapes()).toEqual([]);
      show('Прогноз');
      expect(escapes()).toEqual([]);
    } finally {
      style.remove();
    }
  });
});

describe('Отчёты — год', () => {
  it('a table of the 12 months: income, expense, balance, accumulated; and a total', () => {
    withData();
    renderReports();
    show('Год');
    const rows = bodyRows('По месяцам');
    expect(rows).toHaveLength(12);
    const oct = rows[0]?.textContent ?? '';
    expect(oct).toContain('Октябрь 2026');
    for (const n of [3205, 1235, 1970]) expect(oct).toContain(money(n));
    const nov = rows[1]?.textContent ?? '';
    for (const n of [0, 1010, -1010, 960]) expect(nov).toContain(money(n));
    expect(rows[11]?.textContent).toContain('Сентябрь 2027');
    const total = tableIn('По месяцам').querySelector('tfoot tr')?.textContent ?? '';
    for (const n of [3205, 2725, 480]) expect(total).toContain(money(n));
  });

  it('average expense, the most expensive month and what was accumulated', () => {
    withData();
    renderReports();
    show('Год');
    expect(statCard('Средний расход').textContent).toContain(money(2725 / 3));
    expect(statCard('Самый дорогой месяц').textContent).toContain(money(1235));
    expect(statCard('Самый дорогой месяц').textContent).toContain('Октябрь 2026');
    expect(statCard('Накоплено за год').textContent).toContain(money(480));
  });

  it('no «most expensive month» without spending', () => {
    withData((d) => {
      d.journal = [];
      d.operations = [];
      d.purchases = [];
      d.recurring = [];
    });
    renderReports();
    show('Год');
    expect(screen.queryByText('Самый дорогой месяц')).toBeNull();
    expect(screen.getByText('Трат по категориям нет')).toBeTruthy();
  });

  it('categories × months: the categories with spending, largest total first, 12 months each', () => {
    withData();
    renderReports();
    show('Год');
    const rows = bodyRows('Категории по месяцам');
    expect(rows.map((r) => r.querySelector('th')?.textContent)).toEqual(['Жильё', 'Техника', 'Продукты', 'Транспорт', 'Подписки']);
    const rent = rows[0];
    expect(rent?.querySelectorAll('td')).toHaveLength(13); // total + 12 months
    expect(rent?.querySelectorAll('td')[0]?.textContent).toBe(money(1850));
    expect(rent?.querySelectorAll('td')[1]?.textContent).toBe(money(900));
    expect(rent?.querySelectorAll('td')[2]?.textContent).toBe(money(950));
    expect(rent?.querySelectorAll('td')[3]?.textContent).toBe('—');
  });

  it('adds «Без категории» to the matrix when some spending has no category', () => {
    withData((d) => {
      d.operations.push({ id: 'o-none', date: '2026-11-03', kind: 'expense', what: 'X', amount: 7, account: ACC.card });
    });
    renderReports();
    show('Год');
    const rows = bodyRows('Категории по месяцам');
    const none = rows.find((r) => r.querySelector('th')?.textContent === 'Без категории');
    expect(none?.querySelectorAll('td')[0]?.textContent).toBe(money(7));
    expect(none?.querySelectorAll('td')[2]?.textContent).toBe(money(7));
  });

  it('draws the income/expense bar chart lazily and destroys it when leaving the view', async () => {
    withData();
    renderReports();
    show('Год');
    expect(screen.getByRole('img', { name: /Доход и расход по месяцам/ })).toBeTruthy();
    await waitFor(() => expect(FakeChart.instances).toHaveLength(1));
    const chart = FakeChart.instances[0];
    expect(chart?.type).toBe('bar');
    expect(chart?.data.datasets.map((s) => s.label)).toEqual(['Доход', 'Расход']);
    expect(chart?.data.datasets[1]?.data.slice(0, 3)).toEqual([1235, 1010, 480]);
    show('Месяц');
    expect(chart?.destroyed).toBe(true);
  });

  it('destroys the chart when the screen unmounts', async () => {
    withData();
    const view = renderReports();
    show('Год');
    await waitFor(() => expect(FakeChart.instances).toHaveLength(1));
    view.unmount();
    expect(FakeChart.instances[0]?.destroyed).toBe(true);
  });

  it('when the chart cannot be drawn, says so; the table still has the numbers', async () => {
    withData();
    FakeChart.fail = true;
    renderReports();
    show('Год');
    expect(await screen.findByText('График не загрузился. Цифры — в таблице ниже.')).toBeTruthy();
    expect(bodyRows('По месяцам')).toHaveLength(12);
  });

  it('exports the year statistics; the view survives leaving the tab', async () => {
    const d = withData();
    const buffer = new ArrayBuffer(4);
    const yearReport = vi.fn(async () => ({ filename: 'Статистика.xlsx', buffer }));
    vi.mocked(io.loadReports).mockResolvedValueOnce({ monthReport: vi.fn(), yearReport } as never);
    const view = renderReports();
    show('Год');
    view.unmount();
    renderReports();
    expect(screen.getByRole('radio', { name: 'Год' }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Выгрузить статистику года' }));
    await waitFor(() => expect(share.shareFile).toHaveBeenCalledWith('Статистика.xlsx', buffer));
    expect(yearReport).toHaveBeenCalledWith(d);
  });
});

describe('Отчёты — прогноз', () => {
  it('«Кредиты»: what the card repayment debits that month, for reference (not in the expenses)', () => {
    withData();
    renderReports();
    show('Прогноз');
    const credits = (month: string) => within(section(month)).getByText('Кредиты').closest('.row') as HTMLElement;
    expect(credits('Октябрь 2026').textContent).toContain(money(0));
    expect(credits('Декабрь 2026').textContent).toContain(money(10));
    expect(credits('Декабрь 2026').textContent).toContain('Погашение кредитки 10-го · справочно, не в расходах');
    expect(within(section('Декабрь 2026')).getByText('Расходы').closest('.row')?.textContent).toContain(money(1390));
  });

  it('«Резерв по лимитам»: a row of each month card, in «Расходы»; a «Резерв» column of the weeks (today 15.10)', () => {
    const d = withData((x) => {
      x.categories.expense[1] = { name: 'Продукты', limit: 400, monthLimits: { '2026-12': 600 } };
    });
    const f = forecast(d, '2026-10-15');
    renderReports();
    show('Прогноз');
    for (const m of f.months) {
      const card = section(m.label);
      const reserve = within(card).getByText('Резерв по лимитам').closest('.row') as HTMLElement;
      expect(reserve.textContent).toContain(money(m.reserve));
      expect(reserve.textContent).toContain('Повседневные траты: остаток лимитов · входит в расходы');
      const expenses = within(card).getByText('Расходы').closest('.row') as HTMLElement;
      expect(expenses.textContent).toContain(money(m.expenses));
      expect(plain(expenses.textContent ?? '')).toContain(plain(`резерв ${money(m.reserve)}`));
    }
    expect(f.months[0]!.reserve).toBeGreaterThan(0);
    expect([...tableIn('По неделям').querySelectorAll('thead th')].map((th) => th.textContent))
      .toEqual(['Неделя', 'Остаток', 'Доходы', 'Расходы', 'Резерв']);
    const rows = bodyRows('По неделям');
    rows.forEach((r, i) => expect(r.querySelectorAll('td')[3]?.textContent).toBe(money(f.weeks[i]!.reserve)));
    expect(rows[0]?.querySelectorAll('td')[3]?.textContent).toBe(money(0)); // 1…4 October: before today
  });

  it('without limits: no reserve row, no reserve column', () => {
    withData();
    renderReports();
    show('Прогноз');
    expect(screen.queryByText('Резерв по лимитам')).toBeNull();
  });

  it('«Кредиты» without auto-payment: 0 and «Автопогашение выключено»; no credit card: no row', () => {
    withData((d) => {
      d.credit.auto = false;
    });
    renderReports();
    show('Прогноз');
    const dec = within(section('Декабрь 2026')).getByText('Кредиты').closest('.row') as HTMLElement;
    expect(dec.textContent).toContain(money(0));
    expect(dec.textContent).toContain('Автопогашение выключено');
    cleanup();
    withData((d) => {
      d.accounts = d.accounts.filter((a) => a.type !== 'credit');
    });
    renderReports();
    show('Прогноз');
    expect(screen.queryByText('Кредиты')).toBeNull();
  });

  it('three month cards: income, expenses, end balance, reserve over the cushion', () => {
    withData();
    renderReports();
    show('Прогноз');
    expect(screen.getByText('Октябрь 2026 — декабрь 2026')).toBeTruthy();
    const oct = section('Октябрь 2026');
    expect(within(oct).getByText('Доходы').closest('.row')?.textContent).toContain(money(3205));
    expect(within(oct).getByText('Расходы').closest('.row')?.textContent).toContain(money(1335));
    expect(within(oct).getByText('Остаток на конец').closest('.row')?.textContent).toContain(money(2870));
    expect(within(oct).getByText('Запас над подушкой').closest('.row')?.textContent).toContain(money(2770));
    const dec = section('Декабрь 2026');
    expect(within(dec).getByText('Остаток на конец').closest('.row')?.textContent).toContain(money(840));
  });

  it('weeks below the cushion, the lowest balance and its week', () => {
    withData();
    renderReports();
    show('Прогноз');
    expect(row('Недель ниже подушки').textContent).toContain('0 из 13');
    expect(row('Недель ниже подушки').querySelector('.row-value')?.classList.contains('tone-red')).toBe(false);
    const min = row('Минимальный остаток');
    expect(min.textContent).toContain(money(640));
    expect(min.textContent).toContain('Неделя с 7 декабря');
    expect(row('Подушка').textContent).toContain(money(100));
    expect(row('На начало прогноза').textContent).toContain(money(1000));
  });

  it('with a cushion of 1000: three weeks below it, the reserve of December is negative and red', () => {
    withData((d) => {
      d.settings.cushion = 1000;
    });
    renderReports();
    show('Прогноз');
    const below = row('Недель ниже подушки');
    expect(below.textContent).toContain('3 из 13');
    expect(below.querySelector('.row-value')?.classList.contains('tone-red')).toBe(true);
    expect(row('Минимальный остаток').querySelector('.row-value')?.classList.contains('tone-red')).toBe(true);
    const reserve = within(section('Декабрь 2026')).getByText('Запас над подушкой').closest('.row');
    expect(reserve?.textContent).toContain(money(-160));
    expect(reserve?.querySelector('.tone-red')).toBeTruthy();
  });

  it('a table of the 13 weeks; weeks below the cushion are marked', () => {
    withData((d) => {
      d.settings.cushion = 1000;
    });
    renderReports();
    show('Прогноз');
    const rows = bodyRows('По неделям');
    expect(rows).toHaveLength(13);
    expect(rows[0]?.querySelector('th')?.textContent).toBe('28.09–04.10');
    expect(rows[0]?.textContent).toContain(money(4000));
    expect(rows[1]?.textContent).toContain(money(1285)); // expenses of week 2
    expect(rows[10]?.textContent).toContain(money(640));
    expect(rows[10]?.querySelectorAll('td')[0]?.classList.contains('tone-red')).toBe(true); // the end balance, right after the week
    expect(rows[9]?.querySelectorAll('td')[0]?.classList.contains('tone-red')).toBe(false);
  });

  it('without transfers to or from savings: no transfers row in the months, no transfers column in the weeks', () => {
    withData();
    renderReports();
    show('Прогноз');
    expect(screen.queryByText('Переводы в сбережения / из сбережений')).toBeNull();
    expect([...tableIn('По неделям').querySelectorAll('thead th')].map((th) => th.textContent))
      .toEqual(['Неделя', 'Остаток', 'Доходы', 'Расходы']);
  });

  it('with a savings account: the months show the transfers (−300 / +50 / +10) and end with them', () => {
    data.value = withBox();
    renderReports();
    show('Прогноз');
    const transfers = (month: string) =>
      within(section(month)).getByText('Переводы в сбережения / из сбережений').closest('.row') as HTMLElement;
    expect(transfers('Октябрь 2026').querySelector('.row-value')?.textContent).toBe(money(-300));
    expect(transfers('Ноябрь 2026').querySelector('.row-value')?.textContent).toBe(formatMoney(50, { signed: true }));
    expect(transfers('Декабрь 2026').querySelector('.row-value')?.textContent).toBe(formatMoney(10, { signed: true }));
    const oct = section('Октябрь 2026');
    // the row sits between the expenses and the end balance, which includes it
    expect([...oct.querySelectorAll('.row-title')].map((t) => t.textContent)).toEqual([
      'Доходы', 'Расходы', 'Переводы в сбережения / из сбережений', 'Остаток на конец', 'Запас над подушкой', 'Кредиты',
    ]);
    expect(within(oct).getByText('Остаток на конец').closest('.row')?.textContent).toContain(money(2570));
    expect(row('На начало прогноза').textContent).toContain(money(1000));
  });

  it('a month without transfers keeps its card without the row', () => {
    data.value = withBox((d) => {
      d.operations = d.operations.filter((o) => o.id !== 'o-iz-kopilki'); // November: none
    });
    renderReports();
    show('Прогноз');
    expect(within(section('Ноябрь 2026')).queryByText('Переводы в сбережения / из сбережений')).toBeNull();
    expect(within(section('Октябрь 2026')).getByText('Переводы в сбережения / из сбережений')).toBeTruthy();
  });

  it('with a savings account: the weekly table gets a transfers column after the expenses', () => {
    data.value = withBox();
    renderReports();
    show('Прогноз');
    expect([...tableIn('По неделям').querySelectorAll('thead th')].map((th) => th.textContent))
      .toEqual(['Неделя', 'Остаток', 'Доходы', 'Расходы', 'Переводы']);
    const rows = bodyRows('По неделям');
    const cells = (i: number) => [...(rows[i]?.querySelectorAll('td') ?? [])].map((td) => td.textContent);
    expect(cells(2)).toEqual([money(2365), money(0), money(50), money(-300)]); // week 3: into «Копилка»
    expect(cells(7)?.[3]).toBe(formatMoney(50, { signed: true })); // week 8: out of it
    expect(cells(0)?.[3]).toBe(money(0));
    expect(section('По неделям').querySelector('.section-footer')?.textContent)
      .toBe('Значком отмечены недели, которые заканчиваются ниже подушки. Переводы — в сбережения (−) и из сбережений (+).');
  });

  it('the chart draws the free money: the weekly ends without «Копилка», transfers included', async () => {
    data.value = withBox();
    renderReports();
    show('Прогноз');
    await waitFor(() => expect(FakeChart.instances).toHaveLength(1));
    expect(FakeChart.instances[0]?.data.datasets[0]?.data)
      .toEqual([4000, 2715, 2365, 2570, 2570, 1620, 1530, 1780, 1780, 880, 400, 600, 600]);
  });

  it('draws the weekly balance with the cushion as a line chart', async () => {
    withData();
    renderReports();
    show('Прогноз');
    expect(screen.getByRole('img', { name: /Остаток на конец недели/ })).toBeTruthy();
    await waitFor(() => expect(FakeChart.instances).toHaveLength(1));
    const chart = FakeChart.instances[0];
    expect(chart?.type).toBe('line');
    expect(chart?.data.datasets.map((s) => s.label)).toEqual(['Остаток на конец недели', 'Подушка']);
  });

  it('redraws the chart with new numbers when the data changes', async () => {
    withData();
    renderReports();
    show('Прогноз');
    await waitFor(() => expect(FakeChart.instances).toHaveLength(1));
    const chart = FakeChart.instances[0];
    const update = vi.spyOn(chart as InstanceType<typeof FakeChart>, 'update');
    const next = scenario();
    next.settings.cushion = 500;
    actions.commit(next);
    await waitFor(() => expect(update).toHaveBeenCalled());
    expect(chart?.data.datasets[1]?.data[0]).toBe(500);
    expect(FakeChart.instances).toHaveLength(1);
  });
});
