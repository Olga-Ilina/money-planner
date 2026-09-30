// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/preact';
import { emptyData } from '../../src/engine';
import { SheetHost, closeSheet, openSheet } from '../../src/ui/sheets/host';
import { data, resetSession } from '../../src/ui/state';

beforeEach(() => {
  resetSession();
  data.value = emptyData('2026-09-30');
});

afterEach(() => {
  cleanup();
  resetSession();
});

describe('SheetHost', () => {
  it('opens each kind of sheet by name and closes it', async () => {
    render(<SheetHost />);
    const cases = [
      ['operation', 'Новая операция'],
      ['journal', 'Новая плановая запись'],
      ['recurring', 'Новый постоянный платёж'],
      ['purchase', 'Новая покупка'],
      ['debt', 'Новый долг'],
      ['add', 'Добавить'],
    ] as const;
    for (const [kind, title] of cases) {
      act(() => openSheet(kind));
      expect(screen.getByRole('dialog', { name: title })).toBeTruthy();
    }
    act(() => closeSheet());
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('passes props: an item for the item sheet, initial rows for forms', () => {
    render(<SheetHost />);
    act(() => openSheet('item', { item: { source: 'journal', id: 'j1', ym: '2026-10' } }));
    expect(screen.getByRole('dialog', { name: 'Запись' })).toBeTruthy();
    act(() =>
      openSheet('operation', { initial: { id: 'o1', date: '2026-09-30', kind: 'expense', what: 'Кафе', amount: 5 } }),
    );
    expect(screen.getByRole('dialog', { name: 'Операция' })).toBeTruthy();
  });

  it('a new sheet replaces the open one', () => {
    render(<SheetHost />);
    act(() => openSheet('add'));
    act(() => openSheet('purchase'));
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(screen.getByRole('dialog', { name: 'Новая покупка' })).toBeTruthy();
  });

  it('the sheet’s own close button closes it through the host', async () => {
    render(<SheetHost />);
    act(() => openSheet('debt'));
    act(() => screen.getByRole('button', { name: 'Отмена' }).click());
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});
