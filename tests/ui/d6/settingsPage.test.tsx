// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { IDBFactory } from 'fake-indexeddb';
import { loadData, useFactory } from '../../../src/store/db';
import { actions } from '../../../src/ui/actions';
import { Toast } from '../../../src/ui/kit';
import { SettingsPage } from '../../../src/ui/pages/SettingsPage';
import { monthRange } from '../../../src/ui/pages/usageText';
import { data, feedMonth, resetSession } from '../../../src/ui/state';
import { scenario } from '../../engine/scenario';

const select = (name: string) => screen.getByLabelText(name) as HTMLSelectElement;
const selected = (name: string) => select(name).selectedOptions[0]?.textContent;
const type = (el: HTMLElement, text: string) => fireEvent.input(el, { target: { value: text } });

function choose(name: string, label: string) {
  const option = Array.from(select(name).options).find((o) => o.textContent === label);
  if (!option) throw new Error(`no option ${label}`);
  fireEvent.change(select(name), { target: { value: option.value } });
}

beforeEach(() => {
  useFactory(new IDBFactory());
  resetSession();
  data.value = scenario();
});

afterEach(async () => {
  cleanup();
  await actions.flush();
  resetSession();
  useFactory(undefined);
});

/** The scenario without its one row outside the accounting year (so no note about it is on the page). */
function allInside() {
  const d = scenario();
  d.journal = d.journal.filter((r) => r.id !== 'j-sentyabr');
  return d;
}

describe('monthRange', () => {
  it('one format everywhere (as «Отчёты»): «Сентябрь 2026 — август 2027», the second month in lower case', () => {
    expect(monthRange('2026-09', '2027-08')).toBe('Сентябрь 2026 — август 2027');
    expect(monthRange('2026-10', '2026-12')).toBe('Октябрь 2026 — декабрь 2026');
  });
});

describe('«Учёт и прогноз»: records outside the accounting year', () => {
  it('explains them (as «Сегодня» counts them): in the balances from «Дата остатков» on, never in «Лента» or the reports', () => {
    const d = scenario();
    d.operations.push({ id: 'o-old', date: '2025-05-02', kind: 'expense', what: 'Старая', amount: 4, account: 'acc-card' });
    d.settings = { ...d.settings, balancesDate: '2025-01-01' };
    data.value = d;
    render(<SettingsPage params={{}} />);
    expect(
      screen.getByText(
        'Вне учётного года: 1 плановая запись, 1 операция. Такие записи учтены в остатках, но не попадают в ленту и отчёты. ' +
          'Чтобы увидеть их там, выберите учётный год, в который они входят.',
      ),
    ).toBeTruthy();
  });

  it('rows before «Дата остатков» (the scenario’s: 1 October) are said to be in no balance', () => {
    const d = scenario();
    d.operations.push({ id: 'o-old', date: '2025-05-02', kind: 'expense', what: 'Старая', amount: 4, account: 'acc-card' });
    data.value = d;
    render(<SettingsPage params={{}} />);
    expect(
      screen.getByText(
        'Вне учётного года: 1 плановая запись, 1 операция. Такие записи не попадают ни в остатки (они раньше даты остатков), ' +
          'ни в ленту и отчёты. Чтобы увидеть их в ленте и отчётах, выберите учётный год, в который они входят.',
      ),
    ).toBeTruthy();
  });

  it('no note when every record is inside the year', () => {
    data.value = allInside();
    render(<SettingsPage params={{}} />);
    expect(screen.queryByText(/Такие записи учтены в остатках/)).toBeNull();
  });
});

describe('«Настройки»', () => {
  it('shows the accounting and forecast starts, the cushion and the balances date, with explanations', () => {
    render(<SettingsPage params={{}} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Учёт и прогноз' })).toBeTruthy(); // as its row in «Ещё»
    expect(selected('Учёт с: месяц')).toBe('Октябрь');
    expect(selected('Учёт с: год')).toBe('2026');
    expect(selected('Прогноз с: месяц')).toBe('Октябрь');
    expect(selected('Прогноз с: год')).toBe('2026');
    expect((screen.getByLabelText('Подушка') as HTMLInputElement).value).toBe('100');
    expect((screen.getByLabelText('Дата остатков') as HTMLInputElement).value).toBe('2026-10-01');
    expect(screen.getByText(/Октябрь 2026 — сентябрь 2027/)).toBeTruthy();
    expect(screen.getByText(/Октябрь 2026 — декабрь 2026/)).toBeTruthy();
    expect(screen.getByText(/Отметки ✓ в постоянных/)).toBeTruthy();
    expect(screen.getByText(/\(плановые записи — по месяцу учёта\)/)).toBeTruthy();
  });

  it('a new accounting year is only chosen until «Сохранить»; month and year both count', async () => {
    const start = data.value;
    render(<SettingsPage params={{}} />);
    choose('Учёт с: месяц', 'Январь');
    choose('Учёт с: год', '2027');
    expect(data.value).toBe(start); // nothing saved yet
    expect(selected('Учёт с: месяц')).toBe('Январь');
    expect(selected('Учёт с: год')).toBe('2027');
    expect(screen.getByText(/Январь 2027 — декабрь 2027/)).toBeTruthy(); // the footer follows the choice
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    await actions.flush();
    expect(data.value!.settings.accountingStart).toBe('2027-01');
    expect((await loadData())?.settings.accountingStart).toBe('2027-01');
  });

  it('while a year is chosen, a note from the engine says what falls outside it; saving can be undone', async () => {
    data.value = allInside();
    const start = data.value;
    feedMonth.value = '2026-10'; // «Лента» shows October, which the new year leaves out
    render(
      <>
        <SettingsPage params={{}} />
        <Toast />
      </>,
    );
    expect(screen.queryByText(/Вне учётного года/)).toBeNull();
    choose('Учёт с: месяц', 'Декабрь');
    expect(
      screen.getByText(
        /^Вне учётного года: 4 отметки в постоянных, 9 плановых записей, 6 операций — .* Остатки счетов изменятся\.$/,
      ),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    await actions.flush();
    expect(data.value!.settings.accountingStart).toBe('2026-12');
    expect(screen.getByText('Учётный год изменён')).toBeTruthy();
    expect(screen.queryByText(/^Вне учётного года: 4 отметки/)).toBeNull(); // the choice is saved: its note is gone
    // what is outside the new year is now explained on top
    expect(screen.getByText(/^Вне учётного года: 9 плановых записей, 6 операций\. Такие записи учтены в остатках/)).toBeTruthy();
    expect(feedMonth.value).not.toBe('2026-10');
    fireEvent.click(screen.getByRole('button', { name: 'Отменить' }));
    expect(data.value).toBe(start);
    expect(feedMonth.value).toBe('2026-10'); // «Лента» is back at its month too
    expect(selected('Учёт с: месяц')).toBe('Октябрь');
    await actions.flush();
    expect((await loadData())?.settings.accountingStart).toBe('2026-10');
  });

  it('«Отмена» drops the chosen year; choosing the stored one again hides the note', () => {
    data.value = allInside();
    const start = data.value;
    render(<SettingsPage params={{}} />);
    choose('Учёт с: месяц', 'Декабрь');
    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }));
    expect(selected('Учёт с: месяц')).toBe('Октябрь');
    expect(screen.queryByText(/Вне учётного года/)).toBeNull();
    choose('Учёт с: месяц', 'Ноябрь');
    expect(screen.getByText(/^Вне учётного года:/)).toBeTruthy();
    choose('Учёт с: месяц', 'Октябрь');
    expect(screen.queryByText(/Вне учётного года/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Сохранить' })).toBeNull();
    expect(data.value).toBe(start);
  });

  it('the forecast start too; the years around the stored one are offered', async () => {
    render(<SettingsPage params={{}} />);
    const years = Array.from(select('Прогноз с: год').options).map((o) => o.textContent);
    expect(years).toContain('2025');
    expect(years).toContain('2027');
    choose('Прогноз с: месяц', 'Ноябрь');
    await actions.flush();
    expect(data.value!.settings.forecastStart).toBe('2026-11');
    expect(data.value!.settings.accountingStart).toBe('2026-10');
  });

  it('the cushion: a number is saved; letters or an empty field keep it', async () => {
    render(<SettingsPage params={{}} />);
    const cushion = screen.getByLabelText('Подушка');
    type(cushion, '250');
    await actions.flush();
    expect(data.value!.settings.cushion).toBe(250);
    type(cushion, '250 евро');
    fireEvent.blur(cushion);
    expect(screen.getByText('Проверьте сумму')).toBeTruthy();
    type(cushion, '');
    expect(screen.getByText('Введите сумму, 0 — без подушки')).toBeTruthy();
    await actions.flush();
    expect(data.value!.settings.cushion).toBe(250);
    type(cushion, '0');
    await actions.flush();
    expect(data.value!.settings.cushion).toBe(0);
  });

  it('the balances date: a date is saved; a bad year or an empty field keeps it', async () => {
    render(<SettingsPage params={{}} />);
    const date = screen.getByLabelText('Дата остатков');
    type(date, '2026-09-15');
    await actions.flush();
    expect(data.value!.settings.balancesDate).toBe('2026-09-15');
    type(date, '0026-09-15');
    type(date, '');
    expect(screen.getByText('Укажите дату')).toBeTruthy();
    await actions.flush();
    expect(data.value!.settings.balancesDate).toBe('2026-09-15');
    expect((await loadData())?.settings.balancesDate).toBe('2026-09-15');
  });
});
