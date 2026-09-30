// Chart.js for «Отчёты»: the two chart configurations (income/expense per month, weekly balance with
// the cushion) and the lifecycle of a chart on a <canvas>. Chart.js is loaded lazily — only when a
// chart is first shown — so it stays out of the app's entry chunk. Colours are the page's colour
// tokens (read again when the theme changes); no animation when the user asks for reduced motion.
import type { Chart, ChartConfiguration, ChartDataset, LegendItem } from 'chart.js';
import type { RefObject } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { monthLabel } from '../engine';
import type { ForecastWeek, YM, YearMonth } from '../engine';
import { formatMoney, formatShortDate } from './format';

/** The colour tokens of styles.css a chart uses (the values of the current theme). */
export interface ChartColors {
  tint: string;
  teal: string;
  red: string;
  label: string;
  label2: string;
  separator: string;
  card: string;
  toastBg: string;
  font: string;
}

/** What a chart configuration depends on besides its data. */
export interface ChartEnv {
  colors: ChartColors;
  reducedMotion: boolean;
}

// the light theme of styles.css: used for a token that cannot be read (never in the app)
const FALLBACK: ChartColors = {
  tint: '#4f46e5',
  teal: '#0e8fa8',
  red: '#ff3b30',
  label: '#000000',
  label2: 'rgba(60, 60, 67, 0.6)',
  separator: 'rgba(60, 60, 67, 0.29)',
  card: '#ffffff',
  toastBg: 'rgba(44, 44, 46, 0.96)',
  font: "-apple-system, system-ui, 'SF Pro Text', sans-serif",
};

const TOKENS: Record<keyof ChartColors, string> = {
  tint: '--tint',
  teal: '--teal',
  red: '--red',
  label: '--label',
  label2: '--label-2',
  separator: '--separator',
  card: '--card',
  toastBg: '--toast-bg',
  font: '--font',
};

/** The colour tokens as the page has them now (light or dark theme). */
export function readChartColors(root: Element = document.documentElement): ChartColors {
  const style = getComputedStyle(root);
  const out = { ...FALLBACK };
  for (const key of Object.keys(TOKENS) as (keyof ChartColors)[]) {
    const value = style.getPropertyValue(TOKENS[key]).trim();
    if (value) out[key] = value;
  }
  return out;
}

const DARK_QUERY = '(prefers-color-scheme: dark)';
const REDUCE_QUERY = '(prefers-reduced-motion: reduce)';

function query(media: string): MediaQueryList | null {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(media) : null;
}

/** The current theme's colours and the system's reduced-motion setting. */
export function chartEnv(): ChartEnv {
  return { colors: readChartColors(), reducedMotion: query(REDUCE_QUERY)?.matches ?? false };
}

// ── labels ───────────────────────────────────────────────────────────────

/** '2026-10' → 'Окт' (axis labels). */
export function shortMonth(ym: YM): string {
  return monthLabel(ym).slice(0, 3);
}

/** Whole euros for the axis: 1000 → '1 000 €' (the app's money format without cents). */
export function axisMoney(n: number): string {
  return formatMoney(Math.round(n)).replace(',00', '');
}


/** A week as '28.09–04.10'. */
export function weekLabel(w: { from: string; to: string }): string {
  return `${formatShortDate(w.from)}–${formatShortDate(w.to)}`;
}

// ── configurations ───────────────────────────────────────────────────────

const TICK_SIZE = 11;
const LEGEND_SIZE = 13;
const WHITE = '#ffffff'; // text on the toast background, as the toast has it

function common(env: ChartEnv) {
  const c = env.colors;
  const tickFont = { family: c.font, size: TICK_SIZE };
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: env.reducedMotion ? (false as const) : { duration: 400 },
    locale: 'ru-RU',
    interaction: { mode: 'index' as const, intersect: false },
    legend: {
      display: true,
      position: 'top' as const,
      align: 'start' as const,
      labels: {
        color: c.label,
        font: { family: c.font, size: LEGEND_SIZE },
        boxWidth: 12,
        boxHeight: 12,
        usePointStyle: true,
        pointStyle: 'rectRounded' as const,
      },
    },
    tooltip: {
      backgroundColor: c.toastBg,
      titleColor: WHITE,
      bodyColor: WHITE,
      titleFont: { family: c.font, size: LEGEND_SIZE, weight: 'bold' as const },
      bodyFont: { family: c.font, size: LEGEND_SIZE },
      padding: 10,
      cornerRadius: 10,
      boxPadding: 4,
      usePointStyle: true,
    },
    x: {
      grid: { display: false },
      border: { color: c.separator },
      // all 12 months fit at 440 pt; a narrower screen shows every other label
      ticks: { color: c.label2, font: tickFont, maxRotation: 0, autoSkip: true, autoSkipPadding: 4 },
    },
    y: {
      grid: { color: c.separator, lineWidth: 0.5 },
      border: { display: false },
      ticks: {
        color: c.label2,
        font: tickFont,
        maxTicksLimit: 5,
        callback: (value: number | string) => axisMoney(Number(value)),
      },
    },
  };
}

/** Income fact and expense fact per accounting month (bars). */
export function yearChartConfig(months: YearMonth[], env: ChartEnv): ChartConfiguration<'bar', number[], string> {
  const c = env.colors;
  const base = common(env);
  const bars = { borderRadius: 4, borderSkipped: 'start' as const, maxBarThickness: 14, categoryPercentage: 0.72, barPercentage: 0.86 };
  return {
    type: 'bar',
    data: {
      labels: months.map((m) => shortMonth(m.ym)),
      datasets: [
        { label: 'Доход', data: months.map((m) => m.incomeFact), backgroundColor: c.teal, hoverBackgroundColor: c.teal, ...bars },
        { label: 'Расход', data: months.map((m) => m.expenseFact), backgroundColor: c.tint, hoverBackgroundColor: c.tint, ...bars },
      ],
    },
    options: {
      responsive: base.responsive,
      maintainAspectRatio: base.maintainAspectRatio,
      animation: base.animation,
      locale: base.locale,
      interaction: base.interaction,
      plugins: {
        legend: base.legend,
        tooltip: {
          ...base.tooltip,
          callbacks: {
            title: (items) => months[items[0]?.dataIndex ?? 0]?.label ?? '',
            label: (item) => `${item.dataset.label ?? ''}: ${formatMoney(item.parsed.y ?? 0)}`,
          },
        },
      },
      scales: {
        x: base.x,
        y: { ...base.y, beginAtZero: true },
      },
    },
  };
}

/**
 * Legend keys of a line chart: a short line in the series' own colour, width and dash. The default keys of a
 * chart with point-style legends take the colours of the first *point*, whose ring is card-coloured — the key of
 * the balance line would be white on white.
 */
function lineLegendItems(fontColor: string) {
  return (chart: Chart): LegendItem[] =>
    (chart.data.datasets as ChartDataset<'line'>[]).map((ds, i) => ({
      text: ds.label ?? '',
      fillStyle: ds.borderColor as string,
      strokeStyle: ds.borderColor as string,
      lineWidth: ds.borderWidth as number,
      lineDash: ds.borderDash as number[] | undefined,
      pointStyle: 'line',
      fontColor,
      hidden: !chart.isDatasetVisible(i),
      datasetIndex: i,
    }));
}

/** End balance of the 13 forecast weeks (line) with the cushion (flat dashed line). */
export function forecastChartConfig(weeks: ForecastWeek[], env: ChartEnv): ChartConfiguration<'line', number[], string> {
  const c = env.colors;
  const base = common(env);
  const below = weeks.map((w) => w.end < w.cushion);
  return {
    type: 'line',
    data: {
      labels: weeks.map((w) => formatShortDate(w.from)), // the Monday: short labels fit more ticks
      datasets: [
        {
          label: 'Остаток на конец недели',
          data: weeks.map((w) => w.end),
          borderColor: c.tint,
          backgroundColor: c.tint,
          borderWidth: 2,
          tension: 0,
          pointRadius: 4,
          pointHoverRadius: 6,
          pointBorderWidth: 2,
          pointBorderColor: c.card,
          pointBackgroundColor: below.map((b) => (b ? c.red : c.tint)),
          pointHoverBackgroundColor: below.map((b) => (b ? c.red : c.tint)),
        },
        {
          label: 'Подушка',
          data: weeks.map((w) => w.cushion),
          borderColor: c.label2,
          backgroundColor: c.label2,
          borderWidth: 1.5,
          borderDash: [6, 4],
          pointRadius: 0,
          pointHoverRadius: 0,
          pointHitRadius: 0,
        },
      ],
    },
    options: {
      responsive: base.responsive,
      maintainAspectRatio: base.maintainAspectRatio,
      animation: base.animation,
      locale: base.locale,
      interaction: base.interaction,
      plugins: {
        legend: {
          ...base.legend,
          labels: { ...base.legend.labels, pointStyle: 'line' as const, generateLabels: lineLegendItems(c.label) },
        },
        tooltip: {
          ...base.tooltip,
          callbacks: {
            title: (items) => {
              const w = weeks[items[0]?.dataIndex ?? 0];
              return w ? weekLabel(w) : '';
            },
            label: (item) => `${item.dataset.label ?? ''}: ${formatMoney(item.parsed.y ?? 0)}`,
          },
        },
      },
      scales: {
        x: base.x,
        y: { ...base.y, grace: '5%' },
      },
    },
  };
}

// ── lifecycle ────────────────────────────────────────────────────────────

/** What this module needs of a Chart.js chart. */
export interface ChartLike {
  data: unknown;
  options: unknown;
  update(mode?: 'none'): void;
  destroy(): void;
}

export type ChartCtor = new (canvas: HTMLCanvasElement, config: never) => ChartLike;

/** Builds the configuration from the current data; called again on every refresh and theme change. */
export type ChartBuilder = (env: ChartEnv) => { data: unknown; options?: unknown };

export interface ChartHandle {
  /** Settles once the chart is drawn (or could not be). */
  ready: Promise<void>;
  /** Draws the builder's current configuration (new data). */
  refresh(): void;
  destroy(): void;
}

export interface ChartOptions {
  /** Loads Chart.js (tests pass a fake). */
  load?: () => Promise<ChartCtor>;
  /** Chart.js could not be loaded or the chart could not be drawn. */
  onError?: () => void;
}

/** Chart.js with every controller registered — a separate chunk, loaded on first use. */
export const loadChartJs = (): Promise<ChartCtor> =>
  import('chart.js/auto').then((m) => m.default as unknown as ChartCtor);

/**
 * Draws a chart on `canvas` once Chart.js has loaded, keeps it in the current theme (colour tokens are
 * read again when the system theme or the reduced-motion setting changes) and destroys it on destroy().
 */
export function createChart(canvas: HTMLCanvasElement, build: ChartBuilder, opts: ChartOptions = {}): ChartHandle {
  let chart: ChartLike | null = null;
  let destroyed = false;

  // From a media-query listener nobody catches a throw: a chart that cannot be redrawn is dropped and reported
  const apply = (mode?: 'none') => {
    if (!chart) return;
    try {
      const cfg = build(chartEnv());
      chart.data = cfg.data;
      chart.options = cfg.options ?? {};
      chart.update(mode);
    } catch {
      const broken = chart;
      chart = null;
      try {
        broken.destroy();
      } catch {
        // already unusable
      }
      opts.onError?.();
    }
  };

  const onEnvChange = () => apply('none');
  const watched = [query(DARK_QUERY), query(REDUCE_QUERY)].filter((q): q is MediaQueryList => q !== null);
  for (const q of watched) q.addEventListener('change', onEnvChange);

  const ready = (opts.load ?? loadChartJs)()
    .then((Chart) => {
      if (destroyed) return;
      chart = new Chart(canvas, build(chartEnv()) as never);
    })
    .catch(() => {
      if (!destroyed) opts.onError?.();
    });

  return {
    ready,
    refresh: () => apply(),
    destroy: () => {
      if (destroyed) return;
      destroyed = true;
      for (const q of watched) q.removeEventListener('change', onEnvChange);
      chart?.destroy();
      chart = null;
    },
  };
}

/**
 * A chart on the canvas `ref` for the life of the component: drawn after mount, redrawn with the
 * builder's latest result when `deps` change, destroyed on unmount. Returns true when it failed.
 */
export function useChart(
  ref: RefObject<HTMLCanvasElement>,
  build: ChartBuilder,
  deps: readonly unknown[],
  opts: Pick<ChartOptions, 'load'> = {},
): boolean {
  const [failed, setFailed] = useState(false);
  const latest = useRef(build);
  latest.current = build;
  const handle = useRef<ChartHandle | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return undefined;
    const h = createChart(canvas, (env) => latest.current(env), { ...opts, onError: () => setFailed(true) });
    handle.current = h;
    return () => {
      handle.current = null;
      h.destroy();
    };
  }, []);

  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    handle.current?.refresh();
  }, deps);

  return failed;
}
