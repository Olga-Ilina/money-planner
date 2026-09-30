// @vitest-environment happy-dom
// The «+» menu of «Лента»: four rows, each opens its form in place of the menu.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { emptyData, ymOf } from '../../../src/engine';
import { SheetHost, openSheet, openSheetKind } from '../../../src/ui/sheets/host';
import { data, feedMonth, resetSession, today } from '../../../src/ui/state';
import { scenario } from '../../engine/scenario';
import { button, plain } from './helpers';

beforeEach(() => {
  resetSession();
  data.value = scenario();
});

afterEach(() => {
  cleanup();
  resetSession();
});

function openMenu(): void {
  render(<SheetHost />);
  act(() => openSheet('add'));
}

describe('«+» menu', () => {
  it('lists the four kinds of records', () => {
    openMenu();
    const menu = screen.getByRole('dialog', { name: 'Добавить' });
    const titles = Array.from(menu.querySelectorAll('.row-title')).map((t) => plain(t.textContent));
    expect(titles).toEqual(['Операция', 'Плановая запись', 'Постоянный платёж', 'Покупка']);
  });

  it.each([
    ['Операция', 'operation'],
    ['Плановая запись', 'journal'],
    ['Постоянный платёж', 'recurring'],
    ['Покупка', 'purchase'],
  ] as const)('«%s» opens the %s form in place of the menu', (title, kind) => {
    openMenu();
    fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${title}`) }));
    expect(openSheetKind()).toBe(kind);
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
  });

  it('«Плановая запись» opens a new journal form', () => {
    openMenu();
    fireEvent.click(screen.getByRole('button', { name: /^Плановая запись/ }));
    expect(screen.getByRole('dialog', { name: 'Новая плановая запись' })).toBeTruthy();
  });

  it('a new journal row is dated in the month shown in «Лента»: today in the current month, else the 1st', () => {
    feedMonth.value = '2026-11';
    openMenu();
    fireEvent.click(screen.getByRole('button', { name: /^Плановая запись/ }));
    const date = (screen.getByLabelText('Дата') as HTMLInputElement).value;
    expect(date).toBe(ymOf(today()) === '2026-11' ? today() : '2026-11-01');
    cleanup();
    data.value = emptyData(today());
    feedMonth.value = ymOf(today());
    openMenu();
    fireEvent.click(screen.getByRole('button', { name: /^Плановая запись/ }));
    expect((screen.getByLabelText('Дата') as HTMLInputElement).value).toBe(today());
  });

  it('a new operation is dated in the month shown in «Лента» too: today in the current month, else the 1st', () => {
    const other = ymOf(today()) === '2026-11' ? '2026-12' : '2026-11';
    feedMonth.value = other;
    openMenu();
    fireEvent.click(screen.getByRole('button', { name: /^Операция/ }));
    expect(screen.getByRole('dialog', { name: 'Новая операция' })).toBeTruthy();
    expect((screen.getByLabelText('Дата') as HTMLInputElement).value).toBe(`${other}-01`);
    cleanup();
    data.value = emptyData(today());
    feedMonth.value = ymOf(today());
    openMenu();
    fireEvent.click(screen.getByRole('button', { name: /^Операция/ }));
    expect((screen.getByLabelText('Дата') as HTMLInputElement).value).toBe(today());
  });

  it('«Отмена» closes the menu', () => {
    openMenu();
    fireEvent.click(button('Отмена'));
    expect(openSheetKind()).toBeNull();
  });
});
