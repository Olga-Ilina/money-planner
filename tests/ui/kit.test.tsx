// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { useState } from 'preact/hooks';
import {
  AmountField, Banner, Button, Chips, Confirm, DateField, EmptyState, ICON_NAMES, Icon, MonthPicker, Money,
  NumberField, OverlayHost, Page, PinPad, ProgressBar, Row, Section, Segmented, SelectField, Sheet, StatCard, StatGrid,
  TextField, Toast, ToggleField, focusOpenModal, showToast, useFieldValidity,
} from '../../src/ui/kit';
import { SheetHost, closeSheet, openSheet } from '../../src/ui/sheets/host';
import { data, resetSession } from '../../src/ui/state';
import { emptyData } from '../../src/engine';
import { accessibleName } from './accessibleName';

afterEach(() => {
  cleanup();
  resetSession();
});

const plain = (s: string | null | undefined): string => (s ?? '').replace(/[  ]/g, ' ');

describe('Icon', () => {
  it('draws every contract icon as decorative inline SVG', () => {
    const names = [
      'home', 'list', 'wallet', 'chart', 'more', 'plus', 'check', 'check-circle', 'chevron-right', 'chevron-left',
      'chevron-down', 'download', 'share', 'trash', 'edit', 'lock', 'repeat', 'calendar', 'cart', 'arrows', 'alert', 'x', 'search',
      // added for the screens (Wave D): income, expense, reorder, warnings, info, account types, settings rows
      'plus-circle', 'minus-circle', 'chevron-up', 'warning', 'info', 'card', 'cash', 'tag', 'sliders', 'upload', 'clock',
      // after the wave: debts
      'debt',
    ];
    expect([...ICON_NAMES].sort()).toEqual([...names].sort());
    for (const name of names) {
      const { container, unmount } = render(<Icon name={name as (typeof ICON_NAMES)[number]} size={20} />);
      const svg = container.querySelector('svg');
      expect(svg, name).not.toBeNull();
      expect(svg?.getAttribute('aria-hidden')).toBe('true');
      expect(svg?.getAttribute('width')).toBe('20');
      expect(svg?.children.length, name).toBeGreaterThan(0);
      unmount();
    }
  });
});

describe('Icon shapes', () => {
  /** The drawing of an icon (its SVG children), to tell icons apart. */
  const drawing = (name: (typeof ICON_NAMES)[number]): string => {
    const { container, unmount } = render(<Icon name={name} size={18} />);
    const html = container.querySelector('svg')?.innerHTML ?? '';
    unmount();
    return html;
  };
  /** The path data of an icon. */
  const pathData = (name: (typeof ICON_NAMES)[number]): string => {
    const { container, unmount } = render(<Icon name={name} size={18} />);
    const d = [...container.querySelectorAll('path')].map((p) => p.getAttribute('d') ?? '').join(' ');
    unmount();
    return d;
  };

  it('«repeat» is a circular arrow (arcs), unlike the two straight arrows of «arrows» (transfer)', () => {
    expect(pathData('repeat')).toMatch(/a8 8 0 0 1/); // arcs of a circle of radius 8
    expect(pathData('arrows')).not.toMatch(/a/i); // straight lines only
    expect(drawing('repeat')).not.toBe(drawing('arrows'));
  });

  it('debts have their own icon, not the clock', () => {
    expect(drawing('debt')).not.toBe(drawing('clock'));
    expect(drawing('debt')).not.toBe('');
  });
});

describe('Money', () => {
  it('formats and colours negatives red by default', () => {
    render(<Money value={-12.5} />);
    const el = screen.getByText((_, node) => plain(node?.textContent) === '-12,50 €' && node?.tagName === 'SPAN');
    expect(el.className).toContain('tone-red');
  });

  it('plain tone never colours; signed adds a plus', () => {
    const { container } = render(
      <div>
        <Money value={-3} tone="plain" />
        <Money value={7} signed />
      </div>,
    );
    const [neg, pos] = container.querySelectorAll('span.money');
    expect(neg?.className).not.toContain('tone-red');
    expect(plain(pos?.textContent)).toBe('+7,00 €');
  });
});

describe('Page, Section, Row', () => {
  it('Page has a large title, subtitle and right slot; no back button outside a tab', () => {
    render(
      <Page title="Сегодня" subtitle="30 сентября" right={<button type="button">Правка</button>}>
        <p>тело</p>
      </Page>,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Сегодня' })).toBeTruthy();
    expect(screen.getByText('30 сентября')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Правка' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /назад|сегодня/i })).toBeNull();
  });

  it('Section shows header and footer; a clickable Row is a button', () => {
    const onClick = vi.fn();
    render(
      <Section header="Счета" footer="Остатки на сегодня">
        <Row title="Карта" subtitle="Дебетовая" value="10 €" valueTone="green" chevron onClick={onClick} icon="wallet" />
        <Row title="Наличные" value="5 €" />
      </Section>,
    );
    expect(screen.getByText('Счета')).toBeTruthy();
    expect(screen.getByText('Остатки на сегодня')).toBeTruthy();
    const row = screen.getByRole('button', { name: /Карта/ });
    fireEvent.click(row);
    expect(onClick).toHaveBeenCalledOnce();
    expect(row.querySelector('.row-value')?.className).toContain('tone-green');
    expect(screen.queryByRole('button', { name: /Наличные/ })).toBeNull();
  });

  it('Row renders extra children under the title', () => {
    render(<Row title="Ноутбук"><span>прогресс</span></Row>);
    expect(screen.getByText('прогресс')).toBeTruthy();
  });

  it('Row trailing: an interactive control that does not trigger the row, and is not inside the row button', () => {
    const open = vi.fn();
    const paid = vi.fn();
    render(
      <Section>
        <Row
          title="Аренда"
          value="800 €"
          onClick={open}
          trailing={<button type="button" aria-label="Оплачено" onClick={paid}>✓</button>}
        />
      </Section>,
    );
    const check = screen.getByRole('button', { name: 'Оплачено' });
    expect(check.parentElement?.closest('button')).toBeNull();
    fireEvent.click(check);
    expect(paid).toHaveBeenCalledOnce();
    expect(open).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /Аренда/ }));
    expect(open).toHaveBeenCalledOnce();
    expect(paid).toHaveBeenCalledOnce();
  });

  it('a Row button names its parts apart: title, subtitle, extra and value joined by «, » (visually hidden)', () => {
    render(
      <Section>
        <Row title="Еда" subtitle="Продукты · Карта" value="100,00 €" onClick={() => {}} icon="cart" />
        <Row title="Ноутбук" subtitle="Техника" value="900 €" onClick={() => {}}>
          <span>Отложено 300 €</span>
        </Row>
        <Row title="Аренда" value="800 €" onClick={() => {}} trailing={<button type="button" aria-label="Оплачено">✓</button>} />
        <Row title="Категории" chevron onClick={() => {}} />
      </Section>,
    );
    // happy-dom puts a space around every element of a name («Еда , Продукты»); a browser may too — speech is the same
    const named = (want: string) => screen.getByRole('button', { name: (n) => n.replace(/ ,/g, ',') === want });
    expect(named('Еда, Продукты · Карта, 100,00 €')).toBeTruthy();
    expect(named('Ноутбук, Техника, Отложено 300 €, 900 €')).toBeTruthy();
    expect(named('Аренда, 800 €')).toBeTruthy();
    // a single part: no stray separator
    expect(named('Категории')).toBeTruthy();
    const food = screen.getByRole('button', { name: /^Еда/ });
    const seps = [...food.querySelectorAll('.sr-only')];
    expect(seps.map((s) => s.textContent)).toEqual([', ', ', ']);
    // the parts themselves stay clean (screens read the value and the subtitle)
    expect(food.querySelector('.row-subtitle')?.textContent).toBe('Продукты · Карта');
    expect(food.querySelector('.row-value')?.textContent).toBe('100,00 €');
  });

  it('Row bar: a decorative slot inside the button, hidden from the accessible name (no raw value, no «, ,»)', () => {
    const bar = <ProgressBar value={3500.5} max={12000} tone="green" label="Выплачено из суммы долга" />;
    render(
      <Section>
        <Row title="Кредит" subtitle="Банк · ставка 4,9 %" value="8 499,50 €" onClick={() => {}} bar={bar}>
          <span>Выплачено 3 500,50 € из 12 000,00 €</span>
        </Row>
        <Row title="Расход" subtitle="план 1 180,00 €" value="1 235,00 €" onClick={() => {}} chevron bar={bar} />
        <Row title="Без значения" onClick={() => {}} bar={bar} />
      </Section>,
    );
    const credit = screen.getByRole('button', { name: /^Кредит/ });
    // the bar is drawn inside the button, in an aria-hidden wrapper inside the text column
    const wrapper = credit.querySelector('[aria-hidden="true"]');
    expect(wrapper?.querySelector('[role="progressbar"]')).not.toBeNull();
    expect(wrapper?.parentElement?.className).toContain('row-main');
    // the name is the row's text only: the bar's «3500.5» / «12000» never reach it
    expect(accessibleName(credit)).toBe('Кредит, Банк · ставка 4,9 %, Выплачено 3 500,50 € из 12 000,00 €, 8 499,50 €');
    expect(accessibleName(screen.getByRole('button', { name: /^Расход/ }))).toBe('Расход, план 1 180,00 €, 1 235,00 €');
    expect(accessibleName(screen.getByRole('button', { name: /^Без значения/ }))).toBe('Без значения');
    // no separator stands before the bar: only the parts that have text get one (subtitle, extra, value)
    expect(credit.querySelectorAll('.sr-only')).toHaveLength(3);
    expect(screen.getByRole('button', { name: /^Расход/ }).querySelectorAll('.sr-only')).toHaveLength(2);
    expect(screen.getByRole('button', { name: /^Без значения/ }).querySelectorAll('.sr-only')).toHaveLength(0);
  });

  it('Row bar sits under the title and subtitle, above the extra content', () => {
    render(
      <Row title="Кредит" subtitle="Банк" onClick={() => {}} bar={<i data-t="bar" />}>
        <b data-t="extra" />
      </Row>,
    );
    const main = screen.getByRole('button').querySelector('.row-main')!;
    const parts = [...main.children].filter((el) => !el.classList.contains('sr-only'));
    const order = parts.map((el) => el.querySelector('[data-t]')?.getAttribute('data-t') ?? el.className);
    expect(order).toEqual(['row-title', 'row-subtitle', 'bar', 'extra']);
  });

  it('a Row that is not a button hides its bar from assistive tech too (and has no separators)', () => {
    const { container } = render(<Row title="Расход" bar={<ProgressBar value={1} max={2} label="из плана" />} />);
    expect(container.querySelector('[aria-hidden="true"] [role="progressbar"]')).not.toBeNull();
    expect(container.querySelector('.sr-only')).toBeNull();
  });

  it('a Row never shares one separator vnode between its parts (each use draws its own)', () => {
    const found: unknown[] = [];
    const walk = (node: unknown): void => {
      if (Array.isArray(node)) return node.forEach(walk);
      if (node === null || typeof node !== 'object') return;
      const v = node as { type?: unknown; props?: { class?: string; children?: unknown } };
      if (v.type === 'span' && v.props?.class === 'sr-only') found.push(v);
      walk(v.props?.children);
    };
    walk(Row({ title: 'Ноутбук', subtitle: 'Техника', value: '900 €', onClick: () => {}, children: <span>Отложено</span> }));
    expect(found).toHaveLength(3);
    expect(new Set(found).size).toBe(3);
  });

  it('a Row that is not a button has no separators (each part is read on its own)', () => {
    const { container } = render(<Row title="Наличные" subtitle="Наличные" value="5 €" />);
    expect(container.querySelector('.sr-only')).toBeNull();
  });

  it('Row iconTone colours the icon square; the default stays the tint', () => {
    const { container } = render(
      <Section>
        <Row title="a" icon="warning" />
        <Row title="b" icon="warning" iconTone="tint" />
        <Row title="c" icon="warning" iconTone="green" />
        <Row title="d" icon="warning" iconTone="teal" />
        <Row title="e" icon="warning" iconTone="orange" />
        <Row title="f" icon="warning" iconTone="red" />
        <Row title="g" icon="warning" iconTone="muted" />
      </Section>,
    );
    expect([...container.querySelectorAll('.row-icon')].map((el) => el.className)).toEqual([
      'row-icon', 'row-icon', 'row-icon row-icon-green', 'row-icon row-icon-teal', 'row-icon row-icon-orange',
      'row-icon row-icon-red', 'row-icon row-icon-muted',
    ]);
  });

  it('Row trailing works on a row without onClick too', () => {
    const up = vi.fn();
    render(<Row title="Продукты" trailing={<button type="button" aria-label="Выше" onClick={up}>↑</button>} />);
    fireEvent.click(screen.getByRole('button', { name: 'Выше' }));
    expect(up).toHaveBeenCalledOnce();
  });
});

describe('StatCard and StatGrid', () => {
  it('a card shows a label, the amount through Money and a small line; with onClick it is a button', () => {
    const onClick = vi.fn();
    render(
      <StatGrid>
        <StatCard label="На картах" value={1234.5} />
        <StatCard label="Кредитка" value={-300} sub="спишется 10.10: 300 €" onClick={onClick} />
      </StatGrid>,
    );
    expect(screen.getByText('На картах')).toBeTruthy();
    expect(screen.getByText((_, n) => n?.classList.contains('money') === true && plain(n.textContent) === '1 234,50 €')).toBeTruthy();
    const card = screen.getByRole('button', { name: /Кредитка/ });
    expect(card.textContent).toContain('спишется 10.10: 300 €');
    expect(card.querySelector('.tone-red')).not.toBeNull(); // auto tone: negative is red
    fireEvent.click(card);
    expect(onClick).toHaveBeenCalledOnce();
    expect(screen.queryByRole('button', { name: /На картах/ })).toBeNull();
  });

  it('tones: neg is red, pos is green, whatever the sign', () => {
    const { container } = render(
      <StatGrid columns={2}>
        <StatCard label="Долг" value={300} tone="neg" />
        <StatCard label="Запас" value={-5} tone="pos" />
      </StatGrid>,
    );
    const [debt, reserve] = container.querySelectorAll('.stat-value');
    expect(debt?.className).toContain('tone-red');
    expect(reserve?.className).toContain('tone-green');
    expect(container.querySelector('.stat-grid')?.className).toContain('stat-grid-2');
  });
});

describe('Button', () => {
  it('filled by default, disabled does not click', () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick} disabled>Сохранить</Button>);
    const b = screen.getByRole('button', { name: 'Сохранить' });
    expect(b.className).toContain('btn-filled');
    fireEvent.click(b);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('kinds and full width', () => {
    render(<Button kind="destructive" full onClick={() => {}}>Удалить</Button>);
    const b = screen.getByRole('button', { name: 'Удалить' });
    expect(b.className).toContain('btn-destructive');
    expect(b.className).toContain('btn-full');
  });
});

describe('Segmented and Chips', () => {
  it('Segmented is a labelled radio group', () => {
    const onChange = vi.fn();
    render(
      <Segmented
        label="Тип"
        options={[{ value: 'expense', label: 'Расход' }, { value: 'income', label: 'Доход' }]}
        value="expense"
        onChange={onChange}
      />,
    );
    expect(screen.getByRole('radiogroup', { name: 'Тип' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Расход' }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(screen.getByRole('radio', { name: 'Доход' }));
    expect(onChange).toHaveBeenCalledWith('income');
  });

  it('Segmented: one tab stop (the selected segment); arrow keys, Home and End choose and move focus', () => {
    function Host() {
      const [v, setV] = useState('all');
      return (
        <Segmented
          label="Показать"
          options={[
            { value: 'all', label: 'Все' },
            { value: 'out', label: 'Траты' },
            { value: 'in', label: 'Доходы' },
            { value: 'unpaid', label: 'Не оплачено' },
          ]}
          value={v}
          onChange={setV}
        />
      );
    }
    render(<Host />);
    const radio = (name: string) => screen.getByRole('radio', { name });
    expect(radio('Все').tabIndex).toBe(0);
    expect(['Траты', 'Доходы', 'Не оплачено'].map((n) => radio(n).tabIndex)).toEqual([-1, -1, -1]);
    radio('Все').focus();
    fireEvent.keyDown(radio('Все'), { key: 'ArrowRight' });
    expect(radio('Траты').getAttribute('aria-checked')).toBe('true');
    expect(document.activeElement).toBe(radio('Траты'));
    expect(radio('Траты').tabIndex).toBe(0);
    expect(radio('Все').tabIndex).toBe(-1);
    fireEvent.keyDown(radio('Траты'), { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(radio('Все'));
    fireEvent.keyDown(radio('Все'), { key: 'ArrowLeft' }); // wraps around
    expect(document.activeElement).toBe(radio('Не оплачено'));
    fireEvent.keyDown(radio('Не оплачено'), { key: 'Home' });
    expect(radio('Все').getAttribute('aria-checked')).toBe('true');
    fireEvent.keyDown(radio('Все'), { key: 'End' });
    expect(radio('Не оплачено').getAttribute('aria-checked')).toBe('true');
    fireEvent.keyDown(radio('Не оплачено'), { key: 'ArrowDown' });
    expect(document.activeElement).toBe(radio('Все'));
  });

  it('Chips: single picks one value, multi toggles', () => {
    const single = vi.fn();
    const multi = vi.fn();
    const options = [{ value: 'a', label: 'Продукты' }, { value: 'b', label: 'Кафе' }];
    render(
      <div>
        <Chips options={options} value="a" onChange={single} />
        <Chips options={options} value={['a']} onChange={multi} multi />
      </div>,
    );
    const [, cafe] = screen.getAllByRole('button', { name: 'Кафе' });
    fireEvent.click(screen.getAllByRole('button', { name: 'Кафе' })[0]!);
    expect(single).toHaveBeenCalledWith('b');
    fireEvent.click(cafe!);
    expect(multi).toHaveBeenCalledWith(['a', 'b']);
    fireEvent.click(screen.getAllByRole('button', { name: 'Продукты' })[1]!);
    expect(multi).toHaveBeenLastCalledWith([]);
    expect(screen.getAllByRole('button', { name: 'Продукты' })[0]!.getAttribute('aria-pressed')).toBe('true');
  });
});

function type(input: HTMLElement, value: string): void {
  fireEvent.input(input, { target: { value } });
}

const OK = { invalid: false };
const BAD = { invalid: true };

describe('AmountField', () => {
  it('accepts a comma or a dot, empty is undefined (not invalid), keyboard is decimal', () => {
    const onChange = vi.fn();
    render(<AmountField label="Сумма" onChange={onChange} />);
    const input = screen.getByLabelText('Сумма');
    expect(input.getAttribute('inputmode')).toBe('decimal');
    type(input, '12,5');
    expect(onChange).toHaveBeenLastCalledWith(12.5, OK);
    type(input, '1 234.56');
    expect(onChange).toHaveBeenLastCalledWith(1234.56, OK);
    type(input, '');
    expect(onChange).toHaveBeenLastCalledWith(undefined, OK);
  });

  it.each([
    ['1.234,56', 1234.56],
    ['1 234,56', 1234.56],
    ['1 234,56', 1234.56],
    ['1,234.56', 1234.56],
    ['12.500', 12500],
    ['1,234', 1234],
    ['12,345', 12345],
    ['12,5', 12.5],
    ['0,5', 0.5],
    ['0.50', 0.5],
    ['1.234.567', 1234567],
    ['1 234 567,8', 1234567.8],
    ['12,', 12],
    [',5', 0.5],
    ['7', 7],
  ])('reads «%s» as %s', (text, value) => {
    const onChange = vi.fn();
    render(<AmountField label="Сумма" onChange={onChange} />);
    type(screen.getByLabelText('Сумма'), text);
    expect(onChange).toHaveBeenLastCalledWith(value, OK);
  });

  it.each(['0,125', '1234,567', '1,2,3', '1.23.4', '1.2345', '1.234,5.6', ','])(
    '«%s» is invalid: undefined, and «Проверьте сумму» once the field is left',
    (text) => {
      const onChange = vi.fn();
      render(<AmountField label="Сумма" onChange={onChange} />);
      const input = screen.getByLabelText('Сумма') as HTMLInputElement;
      fireEvent.focus(input);
      type(input, text);
      expect(onChange).toHaveBeenLastCalledWith(undefined, BAD);
      expect(input.value).toBe(text); // kept as typed, so it can be fixed
      fireEvent.blur(input);
      expect(screen.getByText('Проверьте сумму')).toBeTruthy();
      expect(input.getAttribute('aria-invalid')).toBe('true');
    },
  );

  it.each(['abc', '12€', '12 руб', '1e3', '--5', '12-', '١٢'])(
    '«%s»: any text that is not empty and not an amount is invalid, kept as typed, «Проверьте сумму» once left',
    (text) => {
      const onChange = vi.fn();
      render(<AmountField label="Сумма" onChange={onChange} />);
      const input = screen.getByLabelText('Сумма') as HTMLInputElement;
      fireEvent.focus(input);
      type(input, text);
      expect(input.value).toBe(text); // nothing is cut or cleared: the user sees what to fix
      expect(onChange).toHaveBeenLastCalledWith(undefined, BAD);
      for (const [v] of onChange.mock.calls) expect(Number.isNaN(v)).toBe(false);
      expect(screen.queryByText('Проверьте сумму')).toBeNull(); // not while typing
      fireEvent.blur(input);
      expect(screen.getByText('Проверьте сумму')).toBeTruthy();
      expect(input.getAttribute('aria-invalid')).toBe('true');
    },
  );

  it('fixing invalid text makes the field valid again', () => {
    const onChange = vi.fn();
    render(<AmountField label="Сумма" onChange={onChange} />);
    const input = screen.getByLabelText('Сумма') as HTMLInputElement;
    type(input, '12€');
    expect(onChange).toHaveBeenLastCalledWith(undefined, BAD);
    type(input, '12');
    expect(onChange).toHaveBeenLastCalledWith(12, OK);
    fireEvent.blur(input);
    expect(screen.queryByText('Проверьте сумму')).toBeNull();
  });

  it('shows an external value with a comma, rounded to cents without float noise, and follows its changes', () => {
    function Host() {
      const [v, setV] = useState<number | undefined>(1234.5);
      return (
        <div>
          <AmountField label="Сумма" value={v} onChange={(n) => setV(n)} />
          <button type="button" onClick={() => setV(0.1 + 0.2)}>шум</button>
          <button type="button" onClick={() => setV(-12.345)}>минус</button>
        </div>
      );
    }
    render(<Host />);
    const input = screen.getByLabelText('Сумма') as HTMLInputElement;
    expect(input.value).toBe('1234,5');
    fireEvent.click(screen.getByText('шум'));
    expect(input.value).toBe('0,3');
    fireEvent.click(screen.getByText('минус'));
    expect(input.value).toBe('-12,35');
  });

  it('negative amounts only when allowed; a minus where it is not allowed is invalid, never silently dropped', () => {
    const onChange = vi.fn();
    render(
      <div>
        <AmountField label="Сумма" onChange={onChange} />
        <AmountField label="Факт" onChange={onChange} allowNegative />
      </div>,
    );
    const plainInput = screen.getByLabelText('Сумма') as HTMLInputElement;
    type(plainInput, '-20');
    expect(onChange).toHaveBeenLastCalledWith(undefined, BAD);
    expect(plainInput.value).toBe('-20');
    type(screen.getByLabelText('Факт'), '-20,5');
    expect(onChange).toHaveBeenLastCalledWith(-20.5, OK);
  });

  it('shows an error from the form next to the field', () => {
    render(<AmountField label="Сумма" onChange={() => {}} error="Сумма должна быть больше нуля" />);
    expect(screen.getByText('Сумма должна быть больше нуля')).toBeTruthy();
    expect(screen.getByLabelText('Сумма').getAttribute('aria-invalid')).toBe('true');
  });
});

describe('DateField', () => {
  it('emits the date, and undefined (not invalid) when cleared', () => {
    const onChange = vi.fn();
    render(<DateField label="Дата" value="2026-09-30" onChange={onChange} />);
    const input = screen.getByLabelText('Дата');
    expect(input.getAttribute('type')).toBe('date');
    type(input, '2026-10-05');
    expect(onChange).toHaveBeenLastCalledWith('2026-10-05', OK);
    type(input, '');
    expect(onChange).toHaveBeenLastCalledWith(undefined, OK);
  });

  it('a year outside 1900..2200 never reaches onChange: undefined + invalid, «Проверьте год»', () => {
    const onChange = vi.fn();
    render(<DateField label="Дата" value="2026-09-30" onChange={onChange} />);
    const input = screen.getByLabelText('Дата');
    type(input, '0025-10-05');
    fireEvent.blur(input);
    for (const [v] of onChange.mock.calls) expect(v).not.toBe('0025-10-05');
    expect(onChange).toHaveBeenLastCalledWith(undefined, BAD);
    expect(screen.getByText('Проверьте год')).toBeTruthy();
    type(input, '2201-01-01');
    expect(onChange).toHaveBeenLastCalledWith(undefined, BAD);
    type(input, '1900-01-01');
    expect(onChange).toHaveBeenLastCalledWith('1900-01-01', OK);
    expect(screen.queryByText('Проверьте год')).toBeNull();
    type(input, '2200-12-31');
    expect(onChange).toHaveBeenLastCalledWith('2200-12-31', OK);
  });

  it('a half-typed date (the browser reports badInput and an empty value) is invalid, not cleared', () => {
    const onChange = vi.fn();
    render(<DateField label="Дата" value="2026-09-30" onChange={onChange} />);
    const input = screen.getByLabelText('Дата');
    Object.defineProperty(input, 'validity', { configurable: true, value: { badInput: true } });
    type(input, '');
    expect(onChange).toHaveBeenLastCalledWith(undefined, BAD);
  });
});

describe('a form with optional fields (README: keep the invalid set, disable saving)', () => {
  function PaymentForm({ onSave }: { onSave: (v: { date?: string; amount?: number }) => void }) {
    const [date, setDate] = useState<string | undefined>('2026-09-30');
    const [amount, setAmount] = useState<number | undefined>(120);
    const validity = useFieldValidity();
    return (
      <div>
        <DateField label="Оплатить до" value={date} onChange={validity.field('date', setDate)} />
        <AmountField label="Сумма" value={amount} onChange={validity.field('amount', setAmount)} />
        <output>{`${date ?? 'нет даты'} / ${amount ?? 'нет суммы'}`}</output>
        <Button disabled={validity.anyInvalid} onClick={() => onSave({ date, amount })}>
          Сохранить
        </Button>
      </div>
    );
  }

  it('typing «0026» in the year of an existing date: save disabled, the old date kept', () => {
    const onSave = vi.fn();
    render(<PaymentForm onSave={onSave} />);
    const save = screen.getByRole('button', { name: 'Сохранить' }) as HTMLButtonElement;
    const date = screen.getByLabelText('Оплатить до');
    type(date, '0026-09-30');
    fireEvent.blur(date);
    expect(save.disabled).toBe(true);
    expect(screen.getByText('Проверьте год')).toBeTruthy();
    expect(screen.getByText('2026-09-30 / 120')).toBeTruthy();
    fireEvent.click(save);
    expect(onSave).not.toHaveBeenCalled();
    type(date, '2026-10-01');
    expect(save.disabled).toBe(false);
    fireEvent.click(save);
    expect(onSave).toHaveBeenLastCalledWith({ date: '2026-10-01', amount: 120 });
  });

  it('a mistyped amount keeps the old amount and blocks saving; clearing a field is allowed', () => {
    const onSave = vi.fn();
    render(<PaymentForm onSave={onSave} />);
    const save = screen.getByRole('button', { name: 'Сохранить' }) as HTMLButtonElement;
    type(screen.getByLabelText('Сумма'), '0,125');
    expect(save.disabled).toBe(true);
    expect(screen.getByText('2026-09-30 / 120')).toBeTruthy();
    type(screen.getByLabelText('Сумма'), '');
    type(screen.getByLabelText('Оплатить до'), '');
    expect(save.disabled).toBe(false);
    fireEvent.click(save);
    expect(onSave).toHaveBeenLastCalledWith({ date: undefined, amount: undefined });
  });
});

describe('a form: letters typed over a value never delete it', () => {
  function Form({ onSave }: { onSave: (v: { amount?: number; times?: number }) => void }) {
    const [amount, setAmount] = useState<number | undefined>(120);
    const [times, setTimes] = useState<number | undefined>(6);
    const validity = useFieldValidity();
    return (
      <div>
        <AmountField label="Сумма" value={amount} onChange={validity.field('amount', setAmount)} />
        <NumberField label="Платежей" value={times} min={1} max={60} onChange={validity.field('times', setTimes)} />
        <output>{`${amount ?? 'нет суммы'} / ${times ?? 'нет числа'}`}</output>
        <Button disabled={validity.anyInvalid} onClick={() => onSave({ amount, times })}>
          Сохранить
        </Button>
      </div>
    );
  }

  it('AmountField 120 → «abc»: the form still holds 120, saving is disabled, the text stays visible', () => {
    const onSave = vi.fn();
    render(<Form onSave={onSave} />);
    const input = screen.getByLabelText('Сумма') as HTMLInputElement;
    const save = screen.getByRole('button', { name: 'Сохранить' }) as HTMLButtonElement;
    input.select();
    type(input, 'abc');
    expect(input.value).toBe('abc');
    expect(screen.getByText('120 / 6')).toBeTruthy();
    expect(save.disabled).toBe(true);
    fireEvent.blur(input);
    expect(screen.getByText('Проверьте сумму')).toBeTruthy();
    fireEvent.click(save);
    expect(onSave).not.toHaveBeenCalled();
    type(input, '130');
    expect(save.disabled).toBe(false);
    fireEvent.click(save);
    expect(onSave).toHaveBeenLastCalledWith({ amount: 130, times: 6 });
  });

  it('NumberField 6 → «abc»: the form still holds 6, saving is disabled', () => {
    const onSave = vi.fn();
    render(<Form onSave={onSave} />);
    const input = screen.getByLabelText('Платежей') as HTMLInputElement;
    const save = screen.getByRole('button', { name: 'Сохранить' }) as HTMLButtonElement;
    type(input, 'abc');
    expect(input.value).toBe('abc');
    expect(screen.getByText('120 / 6')).toBeTruthy();
    expect(save.disabled).toBe(true);
    type(input, '');
    expect(save.disabled).toBe(false);
  });
});

describe('a form with a conditional field (useFieldValidity forgets a field that is gone)', () => {
  function PurchaseForm({ onSave }: { onSave: (v: { bought: boolean; price?: number }) => void }) {
    const [bought, setBought] = useState(false);
    const [price, setPrice] = useState<number | undefined>(undefined);
    const validity = useFieldValidity();
    return (
      <div>
        <ToggleField label="Куплено" value={bought} onChange={setBought} />
        {bought && <AmountField label="Цена" value={price} onChange={validity.field('price', setPrice)} />}
        <Button disabled={validity.anyInvalid} onClick={() => onSave({ bought, price })}>
          Сохранить
        </Button>
      </div>
    );
  }

  it('hidden while invalid → saving works again; shown again → starts valid, with the kept value', () => {
    const onSave = vi.fn();
    render(<PurchaseForm onSave={onSave} />);
    const save = screen.getByRole('button', { name: 'Сохранить' }) as HTMLButtonElement;
    fireEvent.click(screen.getByRole('switch', { name: 'Куплено' }));
    const price = screen.getByLabelText('Цена');
    type(price, '0,125');
    expect(save.disabled).toBe(true);
    fireEvent.click(screen.getByRole('switch', { name: 'Куплено' }));
    expect(screen.queryByLabelText('Цена')).toBeNull();
    expect(save.disabled).toBe(false);
    fireEvent.click(save);
    expect(onSave).toHaveBeenLastCalledWith({ bought: false, price: undefined });
    fireEvent.click(screen.getByRole('switch', { name: 'Куплено' }));
    const again = screen.getByLabelText('Цена') as HTMLInputElement;
    expect(again.value).toBe('');
    expect(again.getAttribute('aria-invalid')).toBeNull();
    expect(save.disabled).toBe(false);
  });

  it.each([
    ['DateField', (v: ReturnType<typeof useFieldValidity>) => <DateField label="Поле" onChange={v.field('x', () => {})} />, '0025-10-05'],
    ['NumberField', (v: ReturnType<typeof useFieldValidity>) => <NumberField label="Поле" onChange={v.field('x', () => {})} />, 'abc'],
    ['NumberField (decimal)', (v: ReturnType<typeof useFieldValidity>) => <NumberField label="Поле" integer={false} onChange={v.field('x', () => {})} />, '1,2,3'],
    ['AmountField', (v: ReturnType<typeof useFieldValidity>) => <AmountField label="Поле" onChange={v.field('x', () => {})} />, 'abc'],
  ])('%s forgets itself on unmount', (_name, make, bad) => {
    function Form() {
      const [shown, setShown] = useState(true);
      const v = useFieldValidity();
      return (
        <div>
          {shown && make(v)}
          <button type="button" onClick={() => setShown(false)}>убрать</button>
          <output>{v.anyInvalid ? 'есть ошибка' : 'всё верно'}</output>
        </div>
      );
    }
    render(<Form />);
    type(screen.getByLabelText('Поле'), bad);
    expect(screen.getByText('есть ошибка')).toBeTruthy();
    fireEvent.click(screen.getByText('убрать'));
    expect(screen.getByText('всё верно')).toBeTruthy();
  });

  it('forget(name) clears a field that is hidden without unmounting; a later invalid input marks it again', () => {
    function Form() {
      const [bought, setBought] = useState(true);
      const v = useFieldValidity();
      return (
        <div>
          <ToggleField
            label="Куплено"
            value={bought}
            onChange={(b) => {
              setBought(b);
              if (!b) v.forget('price');
            }}
          />
          <div hidden={!bought}>
            <AmountField label="Цена" onChange={v.field('price', () => {})} />
          </div>
          <output>{`${v.anyInvalid} ${v.isInvalid('price')}`}</output>
        </div>
      );
    }
    render(<Form />);
    type(screen.getByLabelText('Цена', { selector: 'input' }), '0,125');
    expect(screen.getByText('true true')).toBeTruthy();
    fireEvent.click(screen.getByRole('switch', { name: 'Куплено' }));
    expect(screen.getByText('false false')).toBeTruthy();
    fireEvent.click(screen.getByRole('switch', { name: 'Куплено' }));
    type(screen.getByLabelText('Цена'), '0,126');
    expect(screen.getByText('true true')).toBeTruthy();
  });

  it('forget of an unknown name changes nothing', () => {
    function Form() {
      const v = useFieldValidity();
      return (
        <div>
          <button type="button" onClick={() => v.forget('nope')}>забыть</button>
          <output>{String(v.anyInvalid)}</output>
        </div>
      );
    }
    render(<Form />);
    fireEvent.click(screen.getByText('забыть'));
    expect(screen.getByText('false')).toBeTruthy();
  });
});

describe('field hint', () => {
  /** The ids an element's aria-describedby names, and the text of each. */
  const described = (el: HTMLElement): string[] =>
    (el.getAttribute('aria-describedby') ?? '').split(' ').filter(Boolean).map((id) => document.getElementById(id)?.textContent ?? `#${id}?`);

  it('every field shows a muted hint under it and describes its control with it', () => {
    const noop = () => {};
    render(
      <Section>
        <AmountField label="Факт" onChange={noop} hint="Сумма факт учитывается как оплата." />
        <DateField label="Новая дата" onChange={noop} hint="Месяц учёта останется: ноябрь 2026" />
        <TextField label="Что" onChange={noop} hint="Как в выписке" />
        <SelectField label="Счёт" options={[{ value: 'a', label: 'Карта' }]} onChange={noop} hint="Откуда платёж" />
        <NumberField label="День" onChange={noop} hint="1–31" />
        <ToggleField label="Куплено" value={false} onChange={noop} hint="Цена — по факту" />
      </Section>,
    );
    expect(described(screen.getByLabelText('Факт'))).toEqual(['Сумма факт учитывается как оплата.']);
    expect(described(screen.getByLabelText('Новая дата'))).toEqual(['Месяц учёта останется: ноябрь 2026']);
    expect(described(screen.getByLabelText('Что'))).toEqual(['Как в выписке']);
    expect(described(screen.getByLabelText('Счёт'))).toEqual(['Откуда платёж']);
    expect(described(screen.getByLabelText('День'))).toEqual(['1–31']);
    expect(described(screen.getByRole('switch', { name: 'Куплено' }))).toEqual(['Цена — по факту']);
    const hints = [...document.querySelectorAll('.field-hint')];
    expect(hints).toHaveLength(6);
    // inside the field's own block, so the kit's separator before the next field stays right
    for (const h of hints) expect(h.parentElement?.classList.contains('field')).toBe(true);
  });

  it('with an error the control is described by both, the error first', () => {
    render(<TextField label="Что" onChange={() => {}} error="Укажите, что это" hint="Как в выписке" />);
    expect(described(screen.getByLabelText('Что'))).toEqual(['Укажите, что это', 'Как в выписке']);
    expect(screen.getByLabelText('Что').getAttribute('aria-invalid')).toBe('true');
  });

  it('without a hint nothing changes: no hint element, described only by an error', () => {
    const { container } = render(<AmountField label="План" onChange={() => {}} />);
    expect(container.querySelector('.field-hint')).toBeNull();
    expect(screen.getByLabelText('План').hasAttribute('aria-describedby')).toBe(false);
  });
});

describe('TextField, SelectField, NumberField, ToggleField', () => {
  it('TextField emits undefined when cleared', () => {
    const onChange = vi.fn();
    render(<TextField label="Что" value="Кафе" onChange={onChange} />);
    const input = screen.getByLabelText('Что');
    type(input, 'Кофе');
    expect(onChange).toHaveBeenLastCalledWith('Кофе');
    type(input, '');
    expect(onChange).toHaveBeenLastCalledWith(undefined);
  });

  it('SelectField: optional select emits undefined for the empty choice', () => {
    const onChange = vi.fn();
    render(
      <SelectField
        label="Счёт"
        value="a"
        options={[{ value: 'a', label: 'Карта' }, { value: 'b', label: 'Наличные' }]}
        onChange={onChange}
        placeholder="Не выбран"
      />,
    );
    const select = screen.getByLabelText('Счёт');
    fireEvent.change(select, { target: { value: 'b' } });
    expect(onChange).toHaveBeenLastCalledWith('b');
    fireEvent.change(select, { target: { value: '' } });
    expect(onChange).toHaveBeenLastCalledWith(undefined);
    expect(screen.getByRole('option', { name: 'Не выбран' })).toBeTruthy();
  });

  it('SelectField without placeholder has no empty choice', () => {
    render(<SelectField label="Тип" value="a" options={[{ value: 'a', label: 'А' }]} onChange={() => {}} />);
    expect(screen.getAllByRole('option')).toHaveLength(1);
  });

  it('SelectField without placeholder and nothing chosen yet (a required account) reads «Не выбран», not a choice', () => {
    render(<SelectField label="Со счёта" options={[{ value: 'a', label: 'Карта' }]} onChange={() => {}} />);
    const empty = screen.getByRole('option', { name: 'Не выбран' }) as HTMLOptionElement;
    expect(empty.disabled).toBe(true);
    expect((screen.getByLabelText('Со счёта') as HTMLSelectElement).value).toBe('');
  });

  it('SelectField emptyLabel: the words for nothing chosen, agreeing with the field («Не выбрана» for «Карта»)', () => {
    render(<SelectField label="Карта" emptyLabel="Не выбрана" options={[{ value: 'a', label: 'Кредитка' }]} onChange={() => {}} />);
    const empty = screen.getByRole('option', { name: 'Не выбрана' }) as HTMLOptionElement;
    expect(empty.disabled).toBe(true);
    expect(screen.queryByRole('option', { name: 'Не выбран' })).toBeNull();
  });

  it('NumberField: integers in range; out of range is invalid with the range as the error', () => {
    const onChange = vi.fn();
    render(<NumberField label="Раз в N мес." value={1} min={1} max={12} onChange={onChange} />);
    const input = screen.getByLabelText('Раз в N мес.');
    type(input, '3');
    expect(onChange).toHaveBeenLastCalledWith(3, OK);
    type(input, '13');
    expect(onChange).toHaveBeenLastCalledWith(undefined, BAD);
    expect(screen.getByText('От 1 до 12')).toBeTruthy();
    type(input, '');
    expect(onChange).toHaveBeenLastCalledWith(undefined, OK);
  });

  it('NumberField with decimals: unparseable text is invalid, «Проверьте число» once left', () => {
    const onChange = vi.fn();
    render(<NumberField label="Процент" integer={false} onChange={onChange} />);
    const input = screen.getByLabelText('Процент');
    type(input, '2,5');
    expect(onChange).toHaveBeenLastCalledWith(2.5, OK);
    type(input, '1,2,3');
    expect(onChange).toHaveBeenLastCalledWith(undefined, BAD);
    fireEvent.blur(input);
    expect(screen.getByText('Проверьте число')).toBeTruthy();
  });

  // A decimal NumberField reads a PLAIN decimal (rates like 3,875 %): one separator, never thousands.
  it.each([
    ['3,875', 3.875],
    ['3.875', 3.875],
    ['7,125', 7.125],
    ['12', 12],
    ['12.500', 12.5],
    ['1,000', 1],
    ['0,03875', 0.03875],
    ['2,5', 2.5],
    [',5', 0.5],
    ['5,', 5],
    ['.5', 0.5],
    ['5.', 5],
    ['0', 0],
    [' 3,875 ', 3.875],
    [' 3,875 ', 3.875],
    ['3,875 ', 3.875],
    ['-3,875', -3.875],
    ['-,5', -0.5],
    ['−2,5', -2.5],
  ])('decimal NumberField: «%s» is the plain decimal %s', (text, expected) => {
    const onChange = vi.fn();
    render(<NumberField label="Ставка" integer={false} onChange={onChange} />);
    const input = screen.getByLabelText('Ставка') as HTMLInputElement;
    fireEvent.focus(input);
    type(input, text);
    expect(onChange).toHaveBeenLastCalledWith(expected, OK);
    expect(input.value).toBe(text); // kept as typed
    fireEvent.blur(input);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('decimal NumberField: a typed «-0» is 0, never -0', () => {
    const onChange = vi.fn();
    render(<NumberField label="Ставка" integer={false} onChange={onChange} />);
    type(screen.getByLabelText('Ставка'), '-0');
    const value = onChange.mock.lastCall?.[0] as number;
    expect(Object.is(value, 0)).toBe(true);
  });

  it.each([
    '1 000', // no thousands grouping in a decimal field
    '1 2',
    '1 000',
    '1,2,3',
    '1.2.3',
    '1..5',
    '1.234,5',
    '1,234.5',
    '3,875,000',
    ',',
    '.',
    '-',
    '- 3',
    '--1',
    '1-',
    '3,875%',
    '1e3',
    '0x10',
  ])('decimal NumberField: «%s» is invalid, kept as typed, «Проверьте число» once left', (text) => {
    const onChange = vi.fn();
    render(<NumberField label="Ставка" integer={false} value={5} onChange={onChange} />);
    const input = screen.getByLabelText('Ставка') as HTMLInputElement;
    fireEvent.focus(input);
    type(input, text);
    expect(input.value).toBe(text);
    expect(onChange).toHaveBeenLastCalledWith(undefined, BAD);
    expect(screen.queryByText('Проверьте число')).toBeNull();
    fireEvent.blur(input);
    expect(screen.getByText('Проверьте число')).toBeTruthy();
  });

  it('decimal NumberField: a minus is invalid when the minimum is not negative', () => {
    const onChange = vi.fn();
    render(<NumberField label="Ставка" integer={false} min={0} max={100} onChange={onChange} />);
    const input = screen.getByLabelText('Ставка');
    type(input, '-1');
    expect(onChange).toHaveBeenLastCalledWith(undefined, BAD);
    fireEvent.blur(input);
    expect(screen.getByText('Проверьте число')).toBeTruthy();
  });

  it('decimal NumberField: 3,875 with a 0..100 range is fine (not read as 3875)', () => {
    const onChange = vi.fn();
    render(<NumberField label="Ставка" integer={false} min={0} max={100} onChange={onChange} />);
    const input = screen.getByLabelText('Ставка');
    type(input, '3,875');
    expect(onChange).toHaveBeenLastCalledWith(3.875, OK);
    expect(screen.queryByRole('alert')).toBeNull();
    type(input, '7,125');
    expect(onChange).toHaveBeenLastCalledWith(7.125, OK);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('decimal NumberField: range errors still show at once (no blur needed)', () => {
    const onChange = vi.fn();
    render(<NumberField label="Ставка" integer={false} min={0} max={100} onChange={onChange} />);
    const input = screen.getByLabelText('Ставка');
    fireEvent.focus(input);
    type(input, '100,5');
    expect(onChange).toHaveBeenLastCalledWith(undefined, BAD);
    expect(screen.getByText('От 0 до 100')).toBeTruthy();
    type(input, '100');
    expect(onChange).toHaveBeenLastCalledWith(100, OK);
    expect(screen.queryByRole('alert')).toBeNull();
    type(input, '1000,5');
    expect(screen.getByText('От 0 до 100')).toBeTruthy();
  });

  it('decimal NumberField: an existing 3.875 or 0.03875 renders without float noise, grouping or error', () => {
    const { rerender } = render(<NumberField label="Ставка" integer={false} min={0} max={100} value={3.875} onChange={() => {}} />);
    const input = screen.getByLabelText('Ставка') as HTMLInputElement;
    expect(input.value).toBe('3,875');
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.blur(input);
    expect(screen.queryByRole('alert')).toBeNull();
    // shown values: up to 6 decimals, trailing zeros trimmed, no thousands grouping
    for (const [value, shown] of [
      [0.03875, '0,03875'],
      [0.1 + 0.2, '0,3'],
      [0.1 + 0.7, '0,8'],
      [7.125, '7,125'],
      [100, '100'],
      [12.5, '12,5'],
      [1234.5, '1234,5'],
      [1234567.891, '1234567,891'],
      [0.123456, '0,123456'],
      [1.0000004, '1'],
      [-3.875, '-3,875'],
      [0, '0'],
      [-1e-9, '0'],
    ] as const) {
      rerender(<NumberField label="Ставка" integer={false} value={value} onChange={() => {}} />);
      expect((screen.getByLabelText('Ставка') as HTMLInputElement).value).toBe(shown);
      expect(screen.queryByRole('alert')).toBeNull();
    }
  });

  it('NumberField: an integer value also shows without grouping', () => {
    render(<NumberField label="Раз" value={1200} onChange={() => {}} />);
    expect((screen.getByLabelText('Раз') as HTMLInputElement).value).toBe('1200');
  });

  it('decimal NumberField: text like «5,» stays while typing when the form echoes the value back', () => {
    function Host() {
      const [v, setV] = useState<number | undefined>(undefined);
      return (
        <>
          <NumberField label="Ставка" integer={false} value={v} onChange={(n) => setV(n)} />
          <output data-testid="v">{v === undefined ? '—' : String(v)}</output>
        </>
      );
    }
    render(<Host />);
    const input = screen.getByLabelText('Ставка') as HTMLInputElement;
    type(input, '5,');
    expect(screen.getByTestId('v').textContent).toBe('5');
    expect(input.value).toBe('5,');
    type(input, '5,8');
    type(input, '5,87');
    type(input, '5,875');
    expect(screen.getByTestId('v').textContent).toBe('5.875');
    expect(input.value).toBe('5,875');
  });

  // A host that stores a fraction and shows a percent passes value = frac * 100, which carries float noise
  // (0.07 * 100 = 7.000000000000001). The field must not rewrite the text the user is typing because of it.
  it('decimal NumberField: a percent shown over a stored fraction (value = frac * 100) keeps the typed text', () => {
    function Host() {
      const [frac, setFrac] = useState<number | undefined>(undefined);
      return (
        <>
          <NumberField
            label="Ставка, %"
            integer={false}
            value={frac === undefined ? undefined : frac * 100}
            onChange={(n) => setFrac(n === undefined ? undefined : n / 100)}
          />
          <output data-testid="frac">{frac === undefined ? '—' : String(frac)}</output>
        </>
      );
    }
    render(<Host />);
    const input = screen.getByLabelText('Ставка, %') as HTMLInputElement;
    type(input, '7,5');
    expect(screen.getByTestId('frac').textContent).toBe('0.075');
    type(input, '7,'); // backspace: 0.07 * 100 = 7.000000000000001, still «7,»
    expect(input.value).toBe('7,');
    expect(screen.getByTestId('frac').textContent).toBe('0.07');
    type(input, '7,8'); // the next digit is a decimal one, not «78»
    expect(input.value).toBe('7,8');
    expect(screen.getByTestId('frac').textContent).toBe('0.078');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('decimal NumberField: a value changed from outside still replaces the typed text (only equal displays are kept)', () => {
    const { rerender } = render(<NumberField label="Ставка" integer={false} value={7} onChange={() => {}} />);
    const input = screen.getByLabelText('Ставка') as HTMLInputElement;
    type(input, '7,');
    rerender(<NumberField label="Ставка" integer={false} value={7.000000000000001} onChange={() => {}} />);
    expect(input.value).toBe('7,'); // same display as before: left alone
    rerender(<NumberField label="Ставка" integer={false} value={7.5} onChange={() => {}} />);
    expect(input.value).toBe('7,5');
    rerender(<NumberField label="Ставка" integer={false} value={undefined} onChange={() => {}} />);
    expect(input.value).toBe('');
  });

  it('decimal NumberField: a 400-digit string overflows to infinity, so it is invalid (no crash)', () => {
    const onChange = vi.fn();
    render(<NumberField label="Ставка" integer={false} onChange={onChange} />);
    const input = screen.getByLabelText('Ставка') as HTMLInputElement;
    fireEvent.focus(input);
    type(input, '9'.repeat(400));
    expect(onChange).toHaveBeenLastCalledWith(undefined, BAD);
    fireEvent.blur(input);
    expect(screen.getByText('Проверьте число')).toBeTruthy();
    type(input, `${'9'.repeat(400)},5`);
    expect(onChange).toHaveBeenLastCalledWith(undefined, BAD);
  });

  it('AmountField keeps the money rules (3 digits after one separator group thousands; cents at most)', () => {
    const onChange = vi.fn();
    render(<AmountField label="Сумма" onChange={onChange} />);
    const input = screen.getByLabelText('Сумма');
    type(input, '3,875');
    expect(onChange).toHaveBeenLastCalledWith(3875, OK);
    type(input, '1 000');
    expect(onChange).toHaveBeenLastCalledWith(1000, OK);
    type(input, '0,125');
    expect(onChange).toHaveBeenLastCalledWith(undefined, BAD);
  });

  it.each([
    ['integer', 'abc', true],
    ['integer', '1,5', true],
    ['integer', '1.5', true],
    ['integer', '-3', true],
    ['integer', '3 мес.', true],
    ['decimal', 'abc', false],
    ['decimal', '2%', false],
  ])('NumberField (%s): «%s» is invalid, kept as typed, «Проверьте число» once left', (_kind, text, integer) => {
    const onChange = vi.fn();
    render(<NumberField label="Число" integer={integer} value={5} onChange={onChange} />);
    const input = screen.getByLabelText('Число') as HTMLInputElement;
    fireEvent.focus(input);
    type(input, text);
    expect(input.value).toBe(text);
    expect(onChange).toHaveBeenLastCalledWith(undefined, BAD);
    expect(screen.queryByText('Проверьте число')).toBeNull();
    fireEvent.blur(input);
    expect(screen.getByText('Проверьте число')).toBeTruthy();
  });

  it('NumberField: an integer with stray spaces around it is still that integer; a huge one is invalid', () => {
    const onChange = vi.fn();
    render(<NumberField label="Число" onChange={onChange} />);
    const input = screen.getByLabelText('Число');
    type(input, ' 12 ');
    expect(onChange).toHaveBeenLastCalledWith(12, OK);
    type(input, '99999999999999999999');
    expect(onChange).toHaveBeenLastCalledWith(undefined, BAD);
  });

  it('ToggleField is a switch', () => {
    const onChange = vi.fn();
    render(<ToggleField label="Гасится автоматически" value={false} onChange={onChange} />);
    const sw = screen.getByRole('switch', { name: 'Гасится автоматически' });
    fireEvent.click(sw);
    expect(onChange).toHaveBeenCalledWith(true);
  });
});

describe('Sheet and Confirm', () => {
  it('Tab on the last control wraps to the first, Shift+Tab on the first to the last (focus trap)', async () => {
    render(
      <div>
        <button type="button">снаружи</button>
        <Sheet open title="Лист" onClose={() => {}} left={<button type="button">Отмена</button>} right={<button type="button">Готово</button>}>
          <input aria-label="Поле" />
        </Sheet>
      </div>,
    );
    const dialog = screen.getByRole('dialog');
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
    const first = screen.getByRole('button', { name: 'Отмена' });
    const last = screen.getByLabelText('Поле');
    last.focus();
    fireEvent.keyDown(last, { key: 'Tab' });
    expect(document.activeElement).toBe(first);
    fireEvent.keyDown(first, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it('focus goes back to the button that opened the sheet when it closes', async () => {
    function Host() {
      const [open, setOpen] = useState(false);
      return (
        <div>
          <button type="button" onClick={() => setOpen(true)}>Открыть</button>
          <Sheet open={open} title="Лист" onClose={() => setOpen(false)} left={<button type="button" onClick={() => setOpen(false)}>Отмена</button>}>
            <input aria-label="Поле" />
          </Sheet>
        </div>
      );
    }
    render(<Host />);
    const opener = screen.getByRole('button', { name: 'Открыть' });
    opener.focus();
    fireEvent.click(opener);
    const dialog = screen.getByRole('dialog');
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }));
    await waitFor(() => expect(document.activeElement).toBe(opener));
  });

  describe('when the element that opened a sheet is gone', () => {
    /** A page with a row that opens a sheet; saving in the sheet can remove the row or re-key it. */
    function Host({ change }: { change: 'remove' | 'rekey' }) {
      const [open, setOpen] = useState(false);
      const [gen, setGen] = useState(0);
      const done = () => {
        setGen((n) => n + 1);
        setOpen(false);
      };
      const row =
        change === 'remove' && gen > 0 ? null : (
          <Row key={`row-${gen}`} focusKey="row-0" title={`Строка ${gen}`} onClick={() => setOpen(true)} />
        );
      return (
        <OverlayHost>
          <Page title="Страница">
            <Section>
              {row}
              <Row title="Другая" onClick={() => {}} />
            </Section>
          </Page>
          <Sheet open={open} title="Лист" onClose={() => setOpen(false)} right={<button type="button" onClick={done}>Готово</button>}>
            <input aria-label="Поле" />
          </Sheet>
        </OverlayHost>
      );
    }

    async function openAndSave(opener: HTMLElement) {
      opener.focus();
      fireEvent.click(opener);
      const dialog = screen.getByRole('dialog');
      await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
      fireEvent.click(screen.getByRole('button', { name: 'Готово' }));
    }

    it('focus goes to the page’s main heading — never <body>', async () => {
      render(<Host change="remove" />);
      await openAndSave(screen.getByRole('button', { name: 'Строка 0' }));
      const heading = screen.getByRole('heading', { level: 1, name: 'Страница' });
      await waitFor(() => expect(document.activeElement).toBe(heading));
      expect(heading.getAttribute('tabindex')).toBe('-1'); // focusable by script only, not a tab stop
    });

    it('a row drawn anew in its place (the same focusKey) gets it back', async () => {
      render(<Host change="rekey" />);
      const first = screen.getByRole('button', { name: 'Строка 0' });
      await openAndSave(first);
      await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Строка 1' })));
      expect(first.isConnected).toBe(false);
    });

    it('nothing focused before the sheet opened (<body>): the heading too', async () => {
      function Plain() {
        const [open, setOpen] = useState(true);
        return (
          <OverlayHost>
            <Page title="Страница" />
            <Sheet open={open} title="Лист" onClose={() => setOpen(false)} left={<button type="button" onClick={() => setOpen(false)}>Отмена</button>}>
              тело
            </Sheet>
          </OverlayHost>
        );
      }
      (document.activeElement as HTMLElement | null)?.blur();
      render(<Plain />);
      await waitFor(() => expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true));
      fireEvent.click(screen.getByRole('button', { name: 'Отмена' }));
      await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1, name: 'Страница' })));
    });
  });

  describe('a confirm on top of a sheet deletes what opened the sheet (the item card’s «Удалить»)', () => {
    /** A page with rows; a row opens a card; the card's «Удалить» asks in a Confirm (a sibling, as ItemSheet does). */
    function Host() {
      const [rows, setRows] = useState(['Первая', 'Вторая']);
      const [card, setCard] = useState<string | null>(null);
      const [ask, setAsk] = useState(false);
      return (
        <OverlayHost>
          <Page title="Страница">
            <Section>
              {rows.map((r) => (
                <Row key={r} title={r} onClick={() => setCard(r)} />
              ))}
            </Section>
          </Page>
          <Sheet
            open={card !== null}
            title="Карточка"
            onClose={() => setCard(null)}
            left={<button type="button" onClick={() => setCard(null)}>Закрыть</button>}
          >
            <button type="button" onClick={() => setAsk(true)}>Удалить запись</button>
          </Sheet>
          <Confirm
            open={ask && card !== null}
            title="Удалить?"
            confirmLabel="Удалить"
            onConfirm={() => {
              setAsk(false);
              setRows((all) => all.filter((r) => r !== card));
              setCard(null);
            }}
            onCancel={() => setAsk(false)}
          />
        </OverlayHost>
      );
    }

    async function openCardAndAsk(name: string) {
      const opener = screen.getByRole('button', { name });
      opener.focus();
      fireEvent.click(opener);
      const sheet = screen.getByRole('dialog', { name: 'Карточка' });
      await waitFor(() => expect(sheet.contains(document.activeElement)).toBe(true));
      const del = screen.getByRole('button', { name: 'Удалить запись' });
      del.focus();
      fireEvent.click(del);
      const confirm = screen.getByRole('alertdialog', { name: 'Удалить?' });
      await waitFor(() => expect(confirm.contains(document.activeElement)).toBe(true));
      return confirm;
    }

    it('focus ends on the page’s main heading once both have gone — not on <body>', async () => {
      render(<Host />);
      const confirm = await openCardAndAsk('Первая');
      fireEvent.click(within(confirm).getByRole('button', { name: 'Удалить' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
      expect(screen.queryByRole('button', { name: 'Первая' })).toBeNull();
      expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1, name: 'Страница' }));
    });

    it('cancelling the confirm puts focus back on «Удалить» in the card, which stays open', async () => {
      render(<Host />);
      const confirm = await openCardAndAsk('Вторая');
      fireEvent.click(within(confirm).getByRole('button', { name: 'Отмена' }));
      await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Удалить запись' }));
      fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Вторая' }));
    });
  });

  it('focus already moved out of the modals (onto the page) is left there when another modal closes', async () => {
    function Host() {
      const [open, setOpen] = useState(true);
      return (
        <OverlayHost>
          <Page title="Страница">
            <button type="button">на странице</button>
          </Page>
          <Sheet open={open} title="Лист" onClose={() => setOpen(false)} left={<button type="button">Отмена</button>}>
            тело
          </Sheet>
        </OverlayHost>
      );
    }
    render(<Host />);
    const sheet = screen.getByRole('dialog', { name: 'Лист' });
    await waitFor(() => expect(sheet.contains(document.activeElement)).toBe(true));
    const onPage = screen.getByRole('button', { name: 'на странице' });
    onPage.focus(); // e.g. another modal's clean-up already gave focus back to the page
    fireEvent.keyDown(sheet, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(onPage);
  });

  it('focusOpenModal: focus back into the open sheet — or the confirm on top of it — when it was lost', async () => {
    function Host() {
      const [ask, setAsk] = useState(false);
      return (
        <OverlayHost>
          <button type="button">снаружи</button>
          <Sheet open title="Лист" onClose={() => {}} right={<button type="button" onClick={() => setAsk(true)}>Удалить</button>}>
            <input aria-label="Поле" />
          </Sheet>
          <Confirm open={ask} title="Точно?" confirmLabel="Удалить" onConfirm={() => {}} onCancel={() => setAsk(false)} />
        </OverlayHost>
      );
    }
    render(<Host />);
    const sheet = screen.getByRole('dialog', { name: 'Лист' });
    await waitFor(() => expect(sheet.contains(document.activeElement)).toBe(true));
    screen.getByRole('button', { name: 'снаружи' }).focus();
    expect(focusOpenModal()).toBe(true);
    expect(sheet.contains(document.activeElement)).toBe(true);
    const field = screen.getByLabelText('Поле');
    field.focus();
    expect(focusOpenModal()).toBe(true);
    expect(document.activeElement).toBe(field); // already inside: left where it is
    fireEvent.click(screen.getByRole('button', { name: 'Удалить' }));
    const confirm = screen.getByRole('alertdialog', { name: 'Точно?' });
    await waitFor(() => expect(confirm.contains(document.activeElement)).toBe(true));
    (document.activeElement as HTMLElement).blur();
    expect(focusOpenModal()).toBe(true);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Отмена' })); // the confirm's safe choice
  });

  it('focusOpenModal: false with no modal open', () => {
    render(<button type="button">просто</button>);
    expect(focusOpenModal()).toBe(false);
  });

  it('«+» → menu → form: closing the form puts focus back on «+»', async () => {
    data.value = emptyData('2026-09-30');
    render(
      <OverlayHost>
        <button type="button" onClick={() => openSheet('add')}>Добавить запись</button>
        <SheetHost />
      </OverlayHost>,
    );
    const plus = screen.getByRole('button', { name: 'Добавить запись' });
    plus.focus();
    fireEvent.click(plus);
    const menu = screen.getByRole('dialog', { name: 'Добавить' });
    await waitFor(() => expect(menu.contains(document.activeElement)).toBe(true));
    act(() => openSheet('operation')); // what a menu row does
    const form = screen.getByRole('dialog', { name: 'Новая операция' });
    await waitFor(() => expect(form.contains(document.activeElement)).toBe(true));
    act(() => closeSheet());
    await waitFor(() => expect(document.activeElement).toBe(plus));
  });

  it('inside an OverlayHost a sheet renders into its overlay root, never into document.body', () => {
    render(
      <OverlayHost>
        <Page title="Страница" right={<Sheet open title="Из шапки" onClose={() => {}}><p>тело</p></Sheet>} />
      </OverlayHost>,
    );
    const dialog = screen.getByRole('dialog', { name: 'Из шапки' });
    const root = document.querySelector('.overlay-root');
    expect(root?.contains(dialog)).toBe(true);
    expect(dialog.closest('.page-bar')).toBeNull();
    expect(Array.from(document.body.children).some((c) => c.classList.contains('sheet-layer'))).toBe(false);
  });

  it('outside an OverlayHost (lock screen, onboarding) a sheet renders in place', () => {
    const { container } = render(<Sheet open title="Лист" onClose={() => {}}>тело</Sheet>);
    expect(container.contains(screen.getByRole('dialog'))).toBe(true);
  });

  it('two sheets in one page get different ids for their titles and fields', () => {
    render(
      <OverlayHost>
        <TextField label="Страница" onChange={() => {}} />
        <Sheet open title="Первый" onClose={() => {}}>
          <TextField label="Поле" onChange={() => {}} />
        </Sheet>
      </OverlayHost>,
    );
    const ids = Array.from(document.querySelectorAll('[id]')).map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('is a modal dialog with a title; Esc and the backdrop close it', () => {
    const onClose = vi.fn();
    const { container } = render(
      <Sheet open title="Новая операция" onClose={onClose}>
        <input aria-label="Сумма" />
      </Sheet>,
    );
    const dialog = screen.getByRole('dialog', { name: 'Новая операция' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(container.querySelector('.sheet-backdrop')!);
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('moves focus into the sheet and keeps Tab inside it', async () => {
    render(
      <div>
        <button type="button">снаружи</button>
        <Sheet open title="Лист" onClose={() => {}} right={<button type="button">Готово</button>}>
          <input aria-label="Первое" />
          <input aria-label="Последнее" />
        </Sheet>
      </div>,
    );
    const dialog = screen.getByRole('dialog');
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
    const last = screen.getByLabelText('Последнее');
    last.focus();
    fireEvent.keyDown(last, { key: 'Tab' });
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).not.toBe(screen.getByText('снаружи'));
  });

  it('renders nothing when closed', () => {
    render(<Sheet open={false} title="Лист" onClose={() => {}}>тело</Sheet>);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('leaves the DOM after closing', async () => {
    function Host() {
      const [open, setOpen] = useState(true);
      return <Sheet open={open} title="Лист" onClose={() => setOpen(false)}>тело</Sheet>;
    }
    render(<Host />);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('Confirm asks before a destructive action; the message describes the dialog', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(<Confirm open title="Удалить операцию?" message="Это можно отменить 5 секунд." confirmLabel="Удалить" onConfirm={onConfirm} onCancel={onCancel} />);
    expect(screen.getByText('Удалить операцию?')).toBeTruthy();
    expect(screen.getByRole('alertdialog', { name: 'Удалить операцию?', description: 'Это можно отменить 5 секунд.' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }));
    expect(onCancel).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Удалить' }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });
});

describe('PinPad', () => {
  it('inside a Page: no lock icon and no second h1 (the title is an h2)', () => {
    const { container } = render(
      <Page title="PIN">
        <PinPad title="Введите текущий PIN" value="" onChange={() => {}} inPage />
      </Page>,
    );
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 2, name: 'Введите текущий PIN' })).toBeTruthy();
    expect(container.querySelector('.pinpad-head svg')).toBeNull();
  });
});

describe('MonthPicker', () => {
  const months = Array.from({ length: 12 }, (_, k) => {
    const m = 10 + k;
    const y = 2026 + Math.floor((m - 1) / 12);
    return `${y}-${String(((m - 1) % 12) + 1).padStart(2, '0')}`;
  });

  it('shows the month and stays within the given months', () => {
    const onChange = vi.fn();
    const { rerender } = render(<MonthPicker value="2026-10" months={months} onChange={onChange} />);
    expect(screen.getByText('Октябрь 2026')).toBeTruthy();
    const prev = screen.getByRole('button', { name: 'Предыдущий месяц' }) as HTMLButtonElement;
    expect(prev.disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Следующий месяц' }));
    expect(onChange).toHaveBeenCalledWith('2026-11');
    rerender(<MonthPicker value="2027-09" months={months} onChange={onChange} />);
    expect((screen.getByRole('button', { name: 'Следующий месяц' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('from a month outside the list, steps to the nearest one inside', () => {
    const onChange = vi.fn();
    render(<MonthPicker value="2026-08" months={months} onChange={onChange} />);
    expect((screen.getByRole('button', { name: 'Предыдущий месяц' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Следующий месяц' }));
    expect(onChange).toHaveBeenCalledWith('2026-10');
  });
});

describe('Banner, EmptyState, ProgressBar', () => {
  it('Banner shows text and an action', () => {
    const onClick = vi.fn();
    render(<Banner tone="warning" action={{ label: 'Сделать копию', onClick }}>Копии не было 14 дней</Banner>);
    expect(screen.getByText('Копии не было 14 дней')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Сделать копию' }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('EmptyState shows title, text and an action', () => {
    render(<EmptyState title="Скоро" text="Экран появится в следующей версии" />);
    expect(screen.getByText('Скоро')).toBeTruthy();
    expect(screen.getByText('Экран появится в следующей версии')).toBeTruthy();
  });

  it('ProgressBar reports its value and turns red over the max', () => {
    const { container, rerender } = render(<ProgressBar value={30} max={100} label="Потрачено из лимита" />);
    const bar = screen.getByRole('progressbar', { name: 'Потрачено из лимита' });
    expect(bar.getAttribute('aria-valuenow')).toBe('30');
    expect(bar.getAttribute('aria-valuemax')).toBe('100');
    rerender(<ProgressBar value={130} max={100} label="Потрачено из лимита" />);
    expect(container.querySelector('.progress-fill')?.className).toContain('tone-red');
    expect(bar.getAttribute('aria-valuenow')).toBe('100'); // never above the max
    rerender(<ProgressBar value={-5} max={100} label="Потрачено из лимита" />);
    expect(bar.getAttribute('aria-valuenow')).toBe('0');
  });
});

describe('Toast', () => {
  it('is one polite live region, empty or not', () => {
    const { container } = render(<Toast />);
    const regions = () => container.querySelectorAll('[aria-live], [role="status"], [role="alert"], [role="log"]');
    expect(regions()).toHaveLength(1);
    act(() => {
      showToast('Сохранено', { undo: () => {} });
    });
    expect(regions()).toHaveLength(1);
    expect(regions()[0]?.textContent).toContain('Сохранено');
  });

  it('shows «Отменить» that calls undo and hides the toast', () => {
    const undo = vi.fn();
    render(<Toast />);
    act(() => {
      showToast('Операция удалена', { undo });
    });
    expect(screen.getByText('Операция удалена')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Отменить' }));
    expect(undo).toHaveBeenCalledOnce();
    expect(screen.queryByText('Операция удалена')).toBeNull();
  });

  it('an action next to «Отменить» (e.g. «Показать»): each does its own thing and hides the toast', () => {
    const undo = vi.fn();
    const show = vi.fn();
    render(<Toast />);
    act(() => {
      showToast('Сохранено', { undo, action: { label: 'Показать', onClick: show } });
    });
    const buttons = screen.getAllByRole('button').map((b) => b.textContent);
    expect(buttons).toEqual(['Показать', 'Отменить']);
    fireEvent.click(screen.getByRole('button', { name: 'Показать' }));
    expect(show).toHaveBeenCalledOnce();
    expect(undo).not.toHaveBeenCalled();
    expect(screen.queryByText('Сохранено')).toBeNull();
  });

  it('a button of it that had focus: once it goes, focus goes to the page’s heading (or into the open sheet), never <body>', async () => {
    vi.useFakeTimers();
    try {
      render(
        <>
          <Page title="Страница" />
          <Toast />
        </>,
      );
      act(() => {
        showToast('Удалено', { undo: () => {} });
      });
      screen.getByRole('button', { name: 'Отменить' }).focus(); // a click focuses it in a desktop browser
      fireEvent.click(screen.getByRole('button', { name: 'Отменить' }));
      expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1, name: 'Страница' }));

      act(() => {
        showToast('Сохранено', { action: { label: 'Показать', onClick: () => {} } });
      });
      screen.getByRole('button', { name: 'Показать' }).focus();
      act(() => {
        vi.advanceTimersByTime(5_100); // it hides itself while focused
      });
      expect(screen.queryByText('Сохранено')).toBeNull();
      expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1, name: 'Страница' }));
    } finally {
      vi.useRealTimers();
    }
    cleanup();
    render(
      <OverlayHost>
        <Page title="Страница" />
        <Sheet open title="Лист" onClose={() => {}}>
          <input aria-label="Поле" />
        </Sheet>
        <Toast />
      </OverlayHost>,
    );
    const sheet = screen.getByRole('dialog', { name: 'Лист' });
    await waitFor(() => expect(sheet.contains(document.activeElement)).toBe(true));
    act(() => {
      showToast('Удалено', { undo: () => {} });
    });
    screen.getByRole('button', { name: 'Отменить' }).focus();
    fireEvent.click(screen.getByRole('button', { name: 'Отменить' }));
    expect(sheet.contains(document.activeElement)).toBe(true);
  });

  it('hides itself after a while', () => {
    vi.useFakeTimers();
    try {
      render(<Toast />);
      act(() => {
        showToast('Сохранено');
      });
      expect(screen.getByText('Сохранено')).toBeTruthy();
      act(() => {
        vi.advanceTimersByTime(3_100);
      });
      expect(screen.queryByText('Сохранено')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
