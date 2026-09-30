// Invariants of src/ui/styles.css that the DOM tests cannot see (happy-dom applies no CSS).
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(join(import.meta.dirname, '../../src/ui/styles.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/** The declarations of the first rule whose selector list is exactly `selector`. */
function rule(selector: string): Record<string, string> {
  const re = new RegExp(`(^|})\\s*${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`);
  const body = re.exec(css)?.[2];
  if (body === undefined) throw new Error(`no rule for ${selector}`);
  return Object.fromEntries(
    body
      .split(';')
      .map((d) => d.split(':'))
      .filter((p) => p.length >= 2)
      .map(([k, ...v]) => [k!.trim(), v.join(':').trim()]),
  );
}

const px = (v: string | undefined): number => Number(/^(\d+(?:\.\d+)?)px$/.exec(v ?? '')?.[1] ?? Number.NaN);

describe('styles.css', () => {
  it('toasts are drawn above sheets (and the sheet layer above the tab bar)', () => {
    expect(Number(rule('.toast-host')['z-index'])).toBeGreaterThan(Number(rule('.sheet-layer')['z-index']));
    expect(Number(rule('.sheet-layer')['z-index'])).toBeGreaterThan(Number(rule('.tabbar')['z-index']));
  });

  it('the banner close button is at least 44 × 44', () => {
    const close = rule('.banner-close');
    expect(close.width === undefined || px(close.width) >= 44).toBe(true);
    const icon = rule('.icon-button');
    expect(px(icon.width)).toBeGreaterThanOrEqual(44);
    expect(px(icon.height)).toBeGreaterThanOrEqual(44);
  });

  it('segments are at least 44 px high and never wrap', () => {
    const seg = rule('.segment');
    expect(px(seg['min-height'])).toBeGreaterThanOrEqual(44);
    expect(seg['white-space']).toBe('nowrap');
    expect(seg['text-overflow']).toBe('ellipsis');
  });

  it('.sr-only hides text from the eye only: out of the flow, 1 px, clipped, never wrapping', () => {
    const sr = rule('.sr-only');
    expect(sr.position).toBe('absolute');
    expect(sr.width).toBe('1px');
    expect(sr.height).toBe('1px');
    expect(sr.overflow).toBe('hidden');
    expect(sr['clip-path']).toBe('inset(50%)');
    expect(sr['white-space']).toBe('nowrap');
    expect(sr.display).toBeUndefined();
    expect(sr.visibility).toBeUndefined();
  });

  it('a field hint is small muted text under the field, padded like the field error', () => {
    const hint = rule('.field-hint');
    expect(hint).toEqual({ padding: '0 16px 10px', 'font-size': '13px', 'line-height': '18px', color: 'var(--label-2)' });
    expect(rule('.field-error').padding).toBe(hint.padding);
  });

  it('Row icon tones use the colour tokens', () => {
    expect(rule('.row-icon').background).toBe('var(--tint)');
    for (const tone of ['green', 'teal', 'orange', 'red']) {
      expect(rule(`.row-icon-${tone}`).background).toBe(`var(--${tone})`);
    }
    expect(rule('.row-icon-muted')).toEqual({ background: 'var(--card-2)', color: 'var(--label-2)' });
  });

  it('a Row bar is a block 6 px under the subtitle; the text under it keeps 6 px (4 + the column gap of 2)', () => {
    expect(rule('.row-bar')).toEqual({ display: 'block', 'margin-top': '6px' });
    expect(rule('.row-extra')['margin-top']).toBe('6px');
    // «~», not «+»: a row button puts a hidden separator between the bar and its text
    expect(rule('.row-bar ~ .row-extra')['margin-top']).toBe('4px');
    expect(rule('.row-main').gap).toBe('2px');
  });

  it('bars: the side slots keep their width and the title takes what is left, ellipsised', () => {
    for (const bar of ['.page-bar', '.sheet-bar']) {
      expect(rule(bar)['grid-template-columns']).toBe('minmax(max-content, 1fr) minmax(0, max-content) minmax(max-content, 1fr)');
    }
    for (const title of ['.page-bar-title', '.sheet-title']) {
      const t = rule(title);
      expect(t['text-overflow']).toBe('ellipsis');
      expect(t['white-space']).toBe('nowrap');
      expect(t['max-width']).toBeUndefined();
    }
  });
});

describe('screen CSS (loads before styles.css) never restyles kit pieces', () => {
  const root = join(import.meta.dirname, '../../src/ui');
  const files = readdirSync(root, { recursive: true, encoding: 'utf8' })
    .filter((f) => f.endsWith('.css') && f !== 'styles.css')
    .map((f) => join(root, f));

  it('finds the screen CSS files', () => {
    expect(files.length).toBeGreaterThan(5);
  });

  it.each(files.map((f) => [relative(root, f), f]))('%s: no icon squares painted over .row-icon, no local visually hidden class', (_name, file) => {
    const text = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(text).not.toMatch(/\.row-icon\b/); // Row iconTone
    expect(text).not.toMatch(/clip-path:\s*inset\(50%\)|clip:\s*rect\(/); // .sr-only
  });

  it('a busy banner action is greyed out like a disabled icon button', () => {
    expect(rule('.banner-action:disabled').color).toBe(rule('.icon-button:disabled').color);
  });

  describe('contrast (WCAG AA: 4.5:1 for text)', () => {
    const decls = (body: string): Record<string, string> =>
      Object.fromEntries(
        body
          .split(';')
          .map((d) => d.split(':'))
          .filter((p) => p.length >= 2)
          .map(([k, ...v]) => [k!.trim(), v.join(':').trim()]),
      );
    const light = decls(/(^|})\s*:root\s*\{([^}]*)\}/.exec(css)?.[2] ?? '');
    const dark = { ...light, ...decls(/@media \(prefers-color-scheme: dark\)\s*\{\s*:root\s*\{([^}]*)\}/.exec(css)?.[1] ?? '') };
    /** A colour value, following var(--x) through the theme's tokens. */
    const resolve = (theme: Record<string, string>, v: string): string => {
      const m = /^var\((--[\w-]+)\)$/.exec(v.trim());
      return m ? resolve(theme, theme[m[1]!] ?? '') : v.trim();
    };
    const lin = (c: number) => (c / 255 <= 0.04045 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4);
    const luminance = (hex: string): number => {
      const n = Number.parseInt(/^#([0-9a-f]{6})$/i.exec(hex)?.[1] ?? 'x', 16);
      if (Number.isNaN(n)) throw new Error(`not a #rrggbb colour: ${hex}`);
      return 0.2126 * lin(n >> 16) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
    };
    const contrast = (a: string, b: string): number => {
      const [x, y] = [luminance(a), luminance(b)];
      return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
    };

    it('income green as TEXT reaches 4.5:1 on the cards and the background, in both themes', () => {
      const text = rule('.tone-green').color!;
      for (const theme of [light, dark]) {
        for (const bg of ['--card', '--sheet-card', '--bg']) {
          expect(contrast(resolve(theme, text), resolve(theme, `var(${bg})`))).toBeGreaterThanOrEqual(4.5);
        }
      }
    });

    it('the bright green stays for fills and icons', () => {
      expect(rule('.row-icon-green').background).toBe('var(--green)');
      expect(rule('.switch-on').background).toBe('var(--green)');
      expect(rule('.progress-fill.tone-green').background).toBe('var(--green)');
    });

    it('red and orange as TEXT: the darker --red-text / --orange-text in the light theme (5:1 on white, 4.5:1 on the grey background); dark keeps the bright ones', () => {
      const redText = ['.tone-red', '.row-destructive .row-title', '.btn-destructive', '.confirm-destructive', '.field-error', '.pinpad-message-error'];
      for (const sel of redText) expect(rule(sel).color, sel).toBe('var(--red-text)');
      expect(rule('.tone-orange').color).toBe('var(--orange-text)');
      for (const token of ['--red-text', '--orange-text']) {
        expect(contrast(resolve(light, `var(${token})`), resolve(light, 'var(--card)'))).toBeGreaterThanOrEqual(5);
        for (const bg of ['--card', '--sheet-card', '--bg']) {
          expect(contrast(resolve(light, `var(${token})`), resolve(light, `var(${bg})`))).toBeGreaterThanOrEqual(4.5);
        }
      }
      expect(resolve(dark, 'var(--red-text)')).toBe(resolve(dark, 'var(--red)'));
      expect(resolve(dark, 'var(--orange-text)')).toBe(resolve(dark, 'var(--orange)'));
    });

    it('the bright red and orange stay for fills and icons', () => {
      expect(rule('.row-icon-orange').background).toBe('var(--orange)');
      expect(rule('.progress-fill.tone-red').background).toBe('var(--red)');
      expect(rule('.progress-fill.tone-orange').background).toBe('var(--orange)');
      expect(rule('.banner-warning .banner-icon').color).toBe('var(--orange)');
      expect(rule('.banner-error .banner-icon').color).toBe('var(--red)');
    });

    it('screens colour red / orange TEXT with the text tokens too', () => {
      const screenCss = (dir: string): string[] =>
        readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
          e.isDirectory() ? screenCss(join(dir, e.name)) : e.name.endsWith('.css') && e.name !== 'styles.css' ? [join(dir, e.name)] : [],
        );
      const offenders = screenCss(join(import.meta.dirname, '../../src/ui')).filter((f) =>
        /(^|[\s;{])color:\s*var\(--(red|orange)\)/.test(readFileSync(f, 'utf8')),
      );
      expect(offenders.map((f) => relative(join(import.meta.dirname, '../..'), f))).toEqual([]);
    });

    it('white on a filled tint (button, chosen chip) reaches 4.5:1 in both themes', () => {
      for (const sel of ['.btn-filled', '.chip-selected']) {
        expect(rule(sel).color).toBe('#ffffff');
        for (const theme of [light, dark]) {
          expect(contrast('#ffffff', resolve(theme, rule(sel).background!))).toBeGreaterThanOrEqual(4.5);
        }
      }
    });
  });
});
