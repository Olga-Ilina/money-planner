// @vitest-environment happy-dom
// Chart.js helpers of «Отчёты»: colours from the CSS tokens, the two chart configurations and the
// lifecycle of a chart (lazy load, theme changes, destroy).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { forecast, yearStats } from '../../../src/engine';
import {
  axisMoney,
  createChart,
  forecastChartConfig,
  readChartColors,
  shortMonth,
  weekLabel,
  yearChartConfig,
} from '../../../src/ui/charts';
import type { LegendItem } from 'chart.js';
import type { ChartColors, ChartEnv, ChartLike } from '../../../src/ui/charts';
import { formatMoney } from '../../../src/ui/format';
import { scenario } from '../../engine/scenario';

const LIGHT: ChartColors = {
  tint: '#4f46e5',
  teal: '#0e8fa8',
  red: '#ff3b30',
  label: '#000000',
  label2: 'rgba(60, 60, 67, 0.6)',
  separator: 'rgba(60, 60, 67, 0.29)',
  card: '#ffffff',
  toastBg: 'rgba(44, 44, 46, 0.96)',
  font: 'system-ui',
};

const env = (over: Partial<ChartEnv> = {}): ChartEnv => ({ colors: LIGHT, reducedMotion: false, ...over });

const root = document.documentElement;

afterEach(() => {
  for (const name of ['--tint', '--teal', '--red', '--label', '--label-2', '--separator', '--card', '--toast-bg', '--font']) {
    root.style.removeProperty(name);
  }
  vi.restoreAllMocks();
});

describe('readChartColors', () => {
  it('reads the colour tokens of the page (they change with the theme)', () => {
    root.style.setProperty('--tint', ' #8b85ff');
    root.style.setProperty('--teal', '#40c8e0');
    root.style.setProperty('--red', '#ff453a');
    root.style.setProperty('--label', '#ffffff');
    root.style.setProperty('--label-2', 'rgba(235, 235, 245, 0.6)');
    root.style.setProperty('--separator', 'rgba(84, 84, 88, 0.6)');
    root.style.setProperty('--card', '#1c1c1e');
    root.style.setProperty('--toast-bg', 'rgba(58, 58, 60, 0.96)');
    root.style.setProperty('--font', '-apple-system, sans-serif');
    expect(readChartColors()).toEqual({
      tint: '#8b85ff',
      teal: '#40c8e0',
      red: '#ff453a',
      label: '#ffffff',
      label2: 'rgba(235, 235, 245, 0.6)',
      separator: 'rgba(84, 84, 88, 0.6)',
      card: '#1c1c1e',
      toastBg: 'rgba(58, 58, 60, 0.96)',
      font: '-apple-system, sans-serif',
    });
  });

  it('falls back to the light theme when a token is missing', () => {
    expect(readChartColors().tint).toBe('#4f46e5');
    expect(readChartColors().separator).toBe('rgba(60, 60, 67, 0.29)');
  });
});

describe('labels', () => {
  it('short month names for the axis', () => {
    expect(['2026-10', '2026-11', '2027-01', '2027-05', '2027-09'].map(shortMonth)).toEqual(['Окт', 'Ноя', 'Янв', 'Май', 'Сен']);
  });

  it('whole euros on the axis, with the app’s money format', () => {
    expect(axisMoney(1000)).toBe('1 000 €');
    expect(axisMoney(-1234.4)).toBe('-1 234 €');
    expect(axisMoney(0)).toBe('0 €');
    expect(axisMoney(2500.5)).toBe('2 501 €');
  });

  it('a week as «28.09–04.10»', () => {
    expect(weekLabel({ from: '2026-09-28', to: '2026-10-04' })).toBe('28.09–04.10');
  });
});

describe('yearChartConfig', () => {
  const months = yearStats(scenario()).months;

  it('income and expense fact per accounting month as bars', () => {
    const cfg = yearChartConfig(months, env());
    expect(cfg.type).toBe('bar');
    expect(cfg.data.labels).toEqual(['Окт', 'Ноя', 'Дек', 'Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен']);
    const [income, expense] = cfg.data.datasets;
    expect(income?.label).toBe('Доход');
    expect(income?.data.slice(0, 3)).toEqual([3205, 0, 0]);
    expect(expense?.label).toBe('Расход');
    expect(expense?.data.slice(0, 3)).toEqual([1235, 1010, 480]);
    expect(cfg.data.datasets).toHaveLength(2);
  });

  it('colours come from the tokens: income teal, expense tint; text and grid from the label and separator', () => {
    const cfg = yearChartConfig(months, env());
    const [income, expense] = cfg.data.datasets;
    expect(income?.backgroundColor).toBe(LIGHT.teal);
    expect(expense?.backgroundColor).toBe(LIGHT.tint);
    expect(cfg.options?.scales?.y?.grid?.color).toBe(LIGHT.separator);
    expect(cfg.options?.scales?.y?.ticks?.color).toBe(LIGHT.label2);
    expect(cfg.options?.plugins?.legend?.labels?.color).toBe(LIGHT.label);
  });

  it('one y axis, a legend for the two series, responsive to its box', () => {
    const cfg = yearChartConfig(months, env());
    expect(Object.keys(cfg.options?.scales ?? {}).sort()).toEqual(['x', 'y']);
    expect(cfg.options?.plugins?.legend?.display).toBe(true);
    expect(cfg.options?.responsive).toBe(true);
    expect(cfg.options?.maintainAspectRatio).toBe(false);
  });

  it('no animation when the user asks for reduced motion', () => {
    expect(yearChartConfig(months, env({ reducedMotion: true })).options?.animation).toBe(false);
    expect(yearChartConfig(months, env()).options?.animation).not.toBe(false);
  });

  it('tooltip: the full month and the amounts in the app’s money format; axis in whole euros', () => {
    const cfg = yearChartConfig(months, env());
    const cb = cfg.options?.plugins?.tooltip?.callbacks;
    const title = cb?.title as unknown as (items: { dataIndex: number }[]) => string;
    const label = cb?.label as unknown as (item: { dataset: { label: string }; parsed: { y: number } }) => string;
    expect(title([{ dataIndex: 0 }])).toBe('Октябрь 2026');
    expect(label({ dataset: { label: 'Расход' }, parsed: { y: 1235 } })).toBe(`Расход: ${formatMoney(1235)}`);
    const tick = cfg.options?.scales?.y?.ticks?.callback as unknown as (v: number | string) => string;
    expect(tick(1000)).toBe(axisMoney(1000));
  });
});

describe('forecastChartConfig', () => {
  it('the weekly end balance as a line and the cushion as a flat dashed line', () => {
    const weeks = forecast(scenario()).weeks;
    const cfg = forecastChartConfig(weeks, env());
    expect(cfg.type).toBe('line');
    // the axis shows the Monday of each week (short labels fit more ticks), the tooltip the whole week
    expect(cfg.data.labels?.slice(0, 3)).toEqual(['28.09', '05.10', '12.10']);
    expect(cfg.data.labels).toHaveLength(13);
    const title = cfg.options?.plugins?.tooltip?.callbacks?.title as unknown as (items: { dataIndex: number }[]) => string;
    expect(title([{ dataIndex: 1 }])).toBe('05.10–11.10');
    const [balance, cushion] = cfg.data.datasets;
    expect(balance?.label).toBe('Остаток на конец недели');
    expect(balance?.data.map((v) => Math.round(v * 100) / 100)).toEqual([4000, 2715, 2665, 2870, 2870, 1920, 1830, 2030, 2030, 1130, 640, 840, 840]);
    expect(balance?.borderColor).toBe(LIGHT.tint);
    expect(cushion?.label).toBe('Подушка');
    expect(cushion?.data).toEqual(Array(13).fill(100));
    expect(cushion?.borderDash).toEqual([6, 4]);
    expect(cushion?.borderColor).toBe(LIGHT.label2);
    expect(Object.keys(cfg.options?.scales ?? {}).sort()).toEqual(['x', 'y']);
    expect(cfg.options?.plugins?.legend?.display).toBe(true);
    expect(cfg.options?.maintainAspectRatio).toBe(false);
  });

  it('weeks that end below the cushion get a red point', () => {
    const data = scenario();
    data.settings.cushion = 1000;
    const cfg = forecastChartConfig(forecast(data).weeks, env());
    const colors = cfg.data.datasets[0]?.pointBackgroundColor as string[];
    // ends: … 1130, 640, 840, 840 — the last three are below 1000
    expect(colors.slice(9)).toEqual([LIGHT.tint, LIGHT.red, LIGHT.red, LIGHT.red]);
    expect(colors.filter((c) => c === LIGHT.red)).toHaveLength(3);
  });

  it('no animation under reduced motion', () => {
    const weeks = forecast(scenario()).weeks;
    expect(forecastChartConfig(weeks, env({ reducedMotion: true })).options?.animation).toBe(false);
  });
});

// the dark theme of styles.css
const DARK_COLORS: ChartColors = {
  tint: '#8b85ff',
  teal: '#40c8e0',
  red: '#ff453a',
  label: '#ffffff',
  label2: 'rgba(235, 235, 245, 0.6)',
  separator: 'rgba(84, 84, 88, 0.6)',
  card: '#1c1c1e',
  toastBg: 'rgba(58, 58, 60, 0.96)',
  font: 'system-ui',
};

describe('forecast legend', () => {
  const weeks = forecast(scenario()).weeks;

  // what Chart.js passes to generateLabels: the chart with its datasets and their visibility
  function legendItems(colors: ChartColors, hidden: number[] = []) {
    const cfg = forecastChartConfig(weeks, env({ colors }));
    const generate = cfg.options?.plugins?.legend?.labels?.generateLabels as unknown as ((chart: unknown) => LegendItem[]) | undefined;
    expect(generate).toBeTypeOf('function');
    return generate?.({ data: cfg.data, isDatasetVisible: (i: number) => !hidden.includes(i) }) ?? [];
  }

  it('the key of the balance line is drawn in the line’s colour — not in the card-coloured ring of its points', () => {
    for (const colors of [LIGHT, DARK_COLORS]) {
      const [balance, cushion] = legendItems(colors);
      expect(balance?.text).toBe('Остаток на конец недели');
      expect(balance?.strokeStyle).toBe(colors.tint);
      expect(balance?.fillStyle).toBe(colors.tint);
      expect(balance?.strokeStyle).not.toBe(colors.card);
      expect(balance?.pointStyle).toBe('line');
      expect(balance?.lineWidth).toBe(2);
      expect(balance?.fontColor).toBe(colors.label);
      expect(balance?.datasetIndex).toBe(0);
      // the cushion: its own grey and its dash
      expect(cushion?.text).toBe('Подушка');
      expect(cushion?.strokeStyle).toBe(colors.label2);
      expect(cushion?.lineDash).toEqual([6, 4]);
      expect(cushion?.datasetIndex).toBe(1);
    }
  });

  it('a series the user switched off stays in the legend, marked hidden', () => {
    const [balance, cushion] = legendItems(LIGHT, [1]);
    expect(balance?.hidden).toBe(false);
    expect(cushion?.hidden).toBe(true);
  });
});

// ── lifecycle ────────────────────────────────────────────────────────────
class FakeChart implements ChartLike {
  static instances: FakeChart[] = [];
  data: unknown;
  options: unknown;
  updates: (string | undefined)[] = [];
  destroyed = false;
  constructor(public canvas: HTMLCanvasElement, public config: { data: unknown; options: unknown }) {
    this.data = config.data;
    this.options = config.options;
    FakeChart.instances.push(this);
  }
  update(mode?: string) {
    this.updates.push(mode);
  }
  destroy() {
    this.destroyed = true;
  }
}

interface FakeQuery {
  media: string;
  matches: boolean;
  listeners: Set<() => void>;
  addEventListener(type: string, fn: () => void): void;
  removeEventListener(type: string, fn: () => void): void;
}

let queries: Map<string, FakeQuery>;

function fakeMatchMedia(matching: string[] = []) {
  queries = new Map();
  vi.spyOn(window, 'matchMedia').mockImplementation((media: string) => {
    let q = queries.get(media);
    if (!q) {
      const listeners = new Set<() => void>();
      q = {
        media,
        matches: matching.includes(media),
        listeners,
        addEventListener: (_t, fn) => listeners.add(fn),
        removeEventListener: (_t, fn) => listeners.delete(fn),
      };
      queries.set(media, q);
    }
    return q as unknown as MediaQueryList;
  });
}

const DARK = '(prefers-color-scheme: dark)';
const REDUCE = '(prefers-reduced-motion: reduce)';

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('createChart', () => {
  beforeEach(() => {
    FakeChart.instances = [];
    fakeMatchMedia();
  });

  it('loads Chart.js lazily and draws the chart with the current colours and motion setting', async () => {
    const load = deferred<typeof FakeChart>();
    const canvas = document.createElement('canvas');
    const build = vi.fn((e: ChartEnv) => ({ type: 'bar', data: { tint: e.colors.tint }, options: { reduced: e.reducedMotion } }));
    const handle = createChart(canvas, build as never, { load: () => load.promise as never });
    expect(FakeChart.instances).toHaveLength(0);
    load.resolve(FakeChart);
    await handle.ready;
    expect(FakeChart.instances).toHaveLength(1);
    expect(FakeChart.instances[0]?.canvas).toBe(canvas);
    expect(FakeChart.instances[0]?.config).toEqual({ type: 'bar', data: { tint: '#4f46e5' }, options: { reduced: false } });
    handle.destroy();
  });

  it('reads reduced motion from the system setting', async () => {
    fakeMatchMedia([REDUCE]);
    const build = (e: ChartEnv) => ({ type: 'bar', data: {}, options: { reduced: e.reducedMotion } });
    const handle = createChart(document.createElement('canvas'), build as never, { load: async () => FakeChart as never });
    await handle.ready;
    expect(FakeChart.instances[0]?.options).toEqual({ reduced: true });
    handle.destroy();
  });

  it('destroyed before Chart.js arrives: no chart is ever drawn', async () => {
    const load = deferred<typeof FakeChart>();
    const handle = createChart(document.createElement('canvas'), (() => ({ data: {}, options: {} })) as never, {
      load: () => load.promise as never,
    });
    handle.destroy();
    load.resolve(FakeChart);
    await handle.ready;
    expect(FakeChart.instances).toHaveLength(0);
  });

  it('destroy() destroys the chart and stops listening to theme and motion changes', async () => {
    const handle = createChart(document.createElement('canvas'), (() => ({ data: {}, options: {} })) as never, {
      load: async () => FakeChart as never,
    });
    await handle.ready;
    expect(queries.get(DARK)?.listeners.size).toBe(1);
    expect(queries.get(REDUCE)?.listeners.size).toBe(1);
    handle.destroy();
    expect(FakeChart.instances[0]?.destroyed).toBe(true);
    expect(queries.get(DARK)?.listeners.size).toBe(0);
    expect(queries.get(REDUCE)?.listeners.size).toBe(0);
  });

  it('a theme change re-reads the colour tokens and redraws without animation', async () => {
    const build = (e: ChartEnv) => ({ data: { tint: e.colors.tint }, options: { font: e.colors.font } });
    const handle = createChart(document.createElement('canvas'), build as never, { load: async () => FakeChart as never });
    await handle.ready;
    const chart = FakeChart.instances[0];
    root.style.setProperty('--tint', '#8b85ff');
    for (const fn of queries.get(DARK)?.listeners ?? []) fn();
    expect(chart?.data).toEqual({ tint: '#8b85ff' });
    expect(chart?.updates).toEqual(['none']);
    handle.destroy();
  });

  it('a redraw that fails on a theme change is reported through onError, not thrown from the listener', async () => {
    const onError = vi.fn();
    const handle = createChart(document.createElement('canvas'), (() => ({ data: {}, options: {} })) as never, {
      load: async () => FakeChart as never,
      onError,
    });
    await handle.ready;
    const chart = FakeChart.instances[0] as FakeChart;
    chart.update = () => {
      throw new Error('canvas is gone');
    };
    expect(() => {
      for (const fn of queries.get(DARK)?.listeners ?? []) fn();
    }).not.toThrow();
    expect(onError).toHaveBeenCalledTimes(1);
    // a chart that cannot be drawn is dropped: no more redraws, no more reports
    expect(chart.destroyed).toBe(true);
    for (const fn of queries.get(REDUCE)?.listeners ?? []) fn();
    handle.refresh();
    expect(onError).toHaveBeenCalledTimes(1);
    handle.destroy();
  });

  it('a builder that throws on a redraw is reported through onError as well', async () => {
    const onError = vi.fn();
    let broken = false;
    const build = () => {
      if (broken) throw new Error('bad data');
      return { data: {}, options: {} };
    };
    const handle = createChart(document.createElement('canvas'), build as never, { load: async () => FakeChart as never, onError });
    await handle.ready;
    broken = true;
    expect(() => handle.refresh()).not.toThrow();
    expect(onError).toHaveBeenCalledTimes(1);
    handle.destroy();
  });

  it('refresh() applies new data from the builder', async () => {
    let n = 1;
    const build = () => ({ data: { n }, options: {} });
    const handle = createChart(document.createElement('canvas'), build as never, { load: async () => FakeChart as never });
    await handle.ready;
    n = 2;
    handle.refresh();
    expect(FakeChart.instances[0]?.data).toEqual({ n: 2 });
    expect(FakeChart.instances[0]?.updates).toEqual([undefined]);
    handle.destroy();
  });

  it('refresh() before Chart.js arrives draws the latest data once it does', async () => {
    const load = deferred<typeof FakeChart>();
    let n = 1;
    const handle = createChart(document.createElement('canvas'), (() => ({ data: { n }, options: {} })) as never, {
      load: () => load.promise as never,
    });
    n = 2;
    handle.refresh();
    load.resolve(FakeChart);
    await handle.ready;
    expect(FakeChart.instances[0]?.data).toEqual({ n: 2 });
    handle.destroy();
  });

  it('reports a failed load (offline, outdated app) through onError', async () => {
    const onError = vi.fn();
    const handle = createChart(document.createElement('canvas'), (() => ({ data: {}, options: {} })) as never, {
      load: () => Promise.reject(new Error('chunk')),
      onError,
    });
    await handle.ready;
    expect(onError).toHaveBeenCalledTimes(1);
    expect(FakeChart.instances).toHaveLength(0);
    handle.destroy();
  });

  it('works without matchMedia', async () => {
    vi.restoreAllMocks();
    const original = window.matchMedia;
    Object.defineProperty(window, 'matchMedia', { value: undefined, configurable: true, writable: true });
    try {
      const build = (e: ChartEnv) => ({ data: {}, options: { reduced: e.reducedMotion } });
      const handle = createChart(document.createElement('canvas'), build as never, { load: async () => FakeChart as never });
      await handle.ready;
      expect(FakeChart.instances[0]?.options).toEqual({ reduced: false });
      handle.destroy();
    } finally {
      Object.defineProperty(window, 'matchMedia', { value: original, configurable: true, writable: true });
    }
  });
});
