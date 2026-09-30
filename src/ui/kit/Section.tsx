// iOS inset grouped list: a Section is a rounded card with an optional header above it and a footer
// below it; Rows inside it are at least 44 px high and separated by inset hairlines.
import type { ComponentChildren, JSX } from 'preact';
import { Icon } from './Icon';
import type { IconName } from './Icon';

export interface SectionProps {
  header?: ComponentChildren;
  footer?: ComponentChildren;
  children?: ComponentChildren;
}

export function Section({ header, footer, children }: SectionProps) {
  return (
    <section class="section">
      {header !== undefined && <h2 class="section-header">{header}</h2>}
      <div class="section-card">{children}</div>
      {footer !== undefined && <p class="section-footer">{footer}</p>}
    </section>
  );
}

export type Tone = 'default' | 'green' | 'red' | 'orange' | 'muted';

/** Colour of a Row's icon square (a colour token); `muted`: a grey square with a grey glyph. */
export type IconTone = 'tint' | 'green' | 'teal' | 'orange' | 'red' | 'muted';

export interface RowProps {
  title: ComponentChildren;
  subtitle?: ComponentChildren;
  /** Right-aligned value: text, <Money/>, or a small control. */
  value?: ComponentChildren;
  valueTone?: Tone;
  /** An icon name (drawn in a tinted square) or any element. */
  icon?: IconName | JSX.Element;
  /** Colour of the icon square; default `tint`. */
  iconTone?: IconTone;
  /** Shows › at the right: the row opens something. */
  chevron?: boolean;
  /** Makes the row a button. Its children must then not be interactive. */
  onClick?: () => void;
  /** Red title (e.g. «Удалить»). */
  destructive?: boolean;
  /**
   * A decorative bar (a `ProgressBar`) under the title and subtitle, above `children`. It is drawn inside the row
   * but hidden from assistive tech (`aria-hidden`), so its raw value («3500.5») never leaks into the row
   * button's accessible name: the row's own text — subtitle, `children`, `value` — must carry the numbers.
   * Never put a ProgressBar into `children`.
   */
  bar?: ComponentChildren;
  /** Extra content under the title, subtitle and bar (e.g. a line of text). */
  children?: ComponentChildren;
  /**
   * An interactive control at the right end — a check button, reorder buttons, an inline field — that
   * does NOT trigger `onClick` (it sits next to the row's button, not inside it). Give it an aria-label.
   */
  trailing?: ComponentChildren;
  /**
   * An identity of the row button that survives it being drawn anew (e.g. a renamed category: its key
   * changes): a sheet opened from this row gives focus back to the row with the same focusKey.
   */
  focusKey?: string;
}

/**
 * A Row button reads as ONE name, so its parts are set apart by a visually hidden «, » (out of the flow, no
 * layout change): a screen reader hears «Еда, Продукты · Карта, 100,00 €», not «ЕдаПродукты · Карта100,00 €».
 * Each use below draws its own `<span class="sr-only">, </span>`: one vnode must not stand in several places.
 * A plain row's parts are read one by one, so it has none. The `bar` has none either: it is hidden.
 */
export function Row({
  title, subtitle, value, valueTone = 'default', icon, iconTone = 'tint', chevron, onClick, destructive, bar, children, trailing,
  focusKey,
}: RowProps) {
  const sep = onClick !== undefined;
  const hasBar = bar !== undefined && bar !== null && bar !== false;
  const inner = (
    <>
      {icon !== undefined && (
        <span class={`row-icon${iconTone === 'tint' ? '' : ` row-icon-${iconTone}`}`}>
          {typeof icon === 'string' ? <Icon name={icon} size={18} /> : icon}
        </span>
      )}
      <span class="row-main">
        <span class="row-title">{title}</span>
        {subtitle !== undefined && (
          <>
            {sep && <span class="sr-only">, </span>}
            <span class="row-subtitle">{subtitle}</span>
          </>
        )}
        {hasBar && (
          <span class="row-bar" aria-hidden="true">
            {bar}
          </span>
        )}
        {children !== undefined && (
          <>
            {sep && <span class="sr-only">, </span>}
            <span class="row-extra">{children}</span>
          </>
        )}
      </span>
      {value !== undefined && (
        <>
          {sep && <span class="sr-only">, </span>}
          <span class={`row-value tone-${valueTone}`}>{value}</span>
        </>
      )}
      {chevron && (
        <span class="row-chevron">
          <Icon name="chevron-right" size={16} />
        </span>
      )}
    </>
  );
  const cls = `row${icon !== undefined ? ' row-with-icon' : ''}${destructive ? ' row-destructive' : ''}`;
  if (trailing !== undefined) {
    const end = <span class="row-trailing">{trailing}</span>;
    return onClick ? (
      <div class={`${cls} row-split`}>
        <button type="button" class="row-press" onClick={onClick} data-focus-key={focusKey}>
          {inner}
        </button>
        {end}
      </div>
    ) : (
      <div class={cls}>
        {inner}
        {end}
      </div>
    );
  }
  return onClick ? (
    <button type="button" class={`${cls} row-button`} onClick={onClick} data-focus-key={focusKey}>
      {inner}
    </button>
  ) : (
    <div class={cls}>{inner}</div>
  );
}
