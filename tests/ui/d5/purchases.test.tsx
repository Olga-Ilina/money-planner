// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/preact';
import { ACC, row, scenario } from '../../engine/scenario';
import type { Data, Purchase } from '../../../src/engine';
import { loadData } from '../../../src/store/db';
import { actions } from '../../../src/ui/actions';
import { formatMoney } from '../../../src/ui/format';
import { PurchasesPage } from '../../../src/ui/pages/PurchasesPage';
import { data } from '../../../src/ui/state';
import { accessibleName } from '../accessibleName';
import { choose, dialog, inputIn, renderScreen, section, type, useScreenTestEnv } from './setup';

useScreenTestEnv();

const m = (n: number) => formatMoney(n);
const plain = (s: string) => s.replace(/\u00a0/g, ' ');

// Scenario forecast (cushion 100): week 3 (12.10–18.10) ends at 2665, week 11 (07.12–13.12) at 640;
// the 13 weeks run from 28.09.2026 to 27.12.2026.
const PLANS: Purchase[] = [
  { id: 'p-naush', what: 'Наушники', category: 'Техника', cost: 50, saved: 50, date: '2026-10-15', bought: false },
  { id: 'p-velo', what: 'Велосипед', cost: 1000, saved: 250, date: '2026-12-08', priority: 'Желательно', bought: false },
  { id: 'p-divan', what: 'Диван', cost: 700, saved: 0, date: '2027-03-01', bought: false },
  { id: 'p-knigi', what: 'Книги', cost: 30, bought: false },
];

function withPlans(): Data {
  const d = scenario();
  d.purchases = [...d.purchases, ...PLANS.map((p) => ({ ...p }))];
  return d;
}

function rowButton(what: string): HTMLElement {
  return screen.getByRole('button', { name: new RegExp(`^${what}`) });
}

function save(d: HTMLElement): void {
  fireEvent.click(within(d).getByRole('button', { name: 'Сохранить' }));
}

// purchaseStatus and leftToSave are engine rules now: tests/engine/plans.test.ts

describe('PurchasesPage', () => {
  it('lists plans and bought purchases with cost, saved, date and whether the money is enough', () => {
    data.value = withPlans();
    renderScreen(<PurchasesPage params={{}} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Покупки' })).toBeTruthy();

    const plans = section('Планы');
    const titles = within(plans).getAllByRole('button').map((b) => b.querySelector('.row-title')?.textContent);
    expect(titles).toEqual(['Наушники', 'Велосипед', 'Диван', 'Книги']);
    const naush = rowButton('Наушники');
    expect(naush.textContent).toContain('Техника ·\u00a015.10.2026');
    expect(naush.textContent).toContain(m(50));
    expect(naush.textContent).toContain('Хватает');
    // the bar is decorative (aria-hidden): the row's text already carries the numbers
    expect(within(naush).getByRole('progressbar', { name: 'Отложено из стоимости', hidden: true }).getAttribute('aria-valuenow')).toBe('50');
    const velo = rowButton('Велосипед');
    expect(velo.textContent).toContain('08.12.2026');
    expect(velo.textContent).toContain(`Отложено ${m(250)} из ${m(1000)}`);
    expect(velo.textContent).toContain('Не хватает');
    // the «·» stays with the word after it, so a line never ends with a dangling dot
    expect(velo.textContent).toContain(` из ${m(1000)} ·\u00a0Не хватает`);
    expect(rowButton('Диван').textContent).toContain('Вне прогноза');
    const knigi = rowButton('Книги');
    expect(knigi.textContent).toContain('без даты');
    expect(knigi.textContent).not.toMatch(/Хватает|Не хватает|Вне прогноза/);

    const bought = section('Куплено');
    const noutbuk = within(bought).getByRole('button', { name: /^Ноутбук/ });
    expect(noutbuk.textContent).toContain(m(480));
    expect(noutbuk.textContent).toContain('Карта');
    expect(noutbuk.textContent).toContain('Куплено');
    expect(noutbuk.textContent).toContain('Куплено ·\u00a0Карта');
  });

  it('a plan from a savings account: «Из сбережений» (the engine’s status), whatever the forecast week says', () => {
    const d = withPlans();
    d.accounts.push({ id: 'acc-kopilka', name: 'Копилка', type: 'savings', start: 5000 });
    d.purchases = d.purchases.map((p) => (p.id === 'p-velo' ? { ...p, account: 'acc-kopilka' } : p));
    data.value = d;
    renderScreen(<PurchasesPage params={{}} />);
    const velo = rowButton('Велосипед');
    expect(velo.textContent).toContain(` из ${m(1000)} · Из сбережений`);
    expect(velo.textContent).not.toContain('хватает');
    expect(velo.querySelector('.purchases-status')?.textContent).toBe('Из сбережений');
    expect(rowButton('Наушники').textContent).toContain('Хватает'); // from no account: in the balance
    expect(plain(section('Планы').textContent ?? '')).toContain(
      '«Хватает» — по прогнозу остаток на конец недели покупки не ниже подушки. «Из сбережений» — покупка со сберегательного счёта: в прогнозе её нет.',
    );
  });

  it('a plan reads as text: no raw bar value, no empty «, ,» part', () => {
    data.value = withPlans();
    renderScreen(<PurchasesPage params={{}} />);
    const velo = rowButton('Велосипед');
    expect(velo.querySelector('[aria-hidden="true"] [role="progressbar"]')).not.toBeNull();
    expect(accessibleName(velo)).toBe(
      `Велосипед, 08.12.2026, Отложено ${plain(m(250))} из ${plain(m(1000))} · Не хватает, ${plain(m(1000))}`,
    );
    expect(accessibleName(rowButton('Книги'))).toBe(`Книги, без даты, Отложено ${plain(m(0))} из ${plain(m(30))}, ${plain(m(30))}`);
    for (const b of within(section('Планы')).getAllByRole('button')) expect(accessibleName(b)).not.toMatch(/,\s*,|,$/);
  });

  it('a plan without a cost shows «—» (not 0,00 €) and no progress bar', () => {
    const d = withPlans();
    d.purchases = [...d.purchases, { id: 'p-podarok', what: 'Подарок', saved: 25, bought: false }];
    data.value = d;
    renderScreen(<PurchasesPage params={{}} />);
    const podarok = rowButton('Подарок');
    expect(podarok.querySelector('.row-value')?.textContent).toBe('—');
    expect(within(podarok).queryByRole('progressbar', { hidden: true })).toBeNull();
    expect(podarok.textContent).toContain(`Отложено ${m(25)}`);
    expect(podarok.textContent).not.toContain('из');
    // a plan with a cost still shows its cost and the bar
    expect(rowButton('Книги').querySelector('.row-value')?.textContent).toBe(m(30));
    expect(within(rowButton('Книги')).getByRole('progressbar', { hidden: true })).toBeTruthy();
  });

  it('sums what is still planned: cost, saved and what is left to save', () => {
    data.value = withPlans();
    renderScreen(<PurchasesPage params={{}} />);
    const card = (label: string) => screen.getByText(label).closest('.stat-card')!.textContent;
    expect(card('Стоимость')).toContain(m(1780));
    expect(card('Отложено')).toContain(m(300));
    expect(card('Осталось накопить')).toContain(m(1480));
  });

  it('with nothing yet: an empty state that opens the form', () => {
    const d = scenario();
    d.purchases = [];
    data.value = d;
    renderScreen(<PurchasesPage params={{}} />);
    expect(screen.getByText('Покупок пока нет')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Добавить покупку' }));
    expect(dialog('Новая покупка')).toBeTruthy();
  });
});

describe('PurchaseForm', () => {
  it('creates a planned purchase', async () => {
    data.value = scenario();
    renderScreen(<PurchasesPage params={{}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Новая покупка' }));
    const d = dialog('Новая покупка');
    type(inputIn(d, 'Что'), 'Пылесос');
    choose(inputIn(d, 'Категория'), 'Техника');
    type(inputIn(d, 'Стоимость'), '320');
    type(inputIn(d, 'Отложено'), '40,5');
    type(inputIn(d, 'Дата покупки'), '2026-11-20');
    choose(inputIn(d, 'Приоритет'), 'Желательно');
    expect(within(d).queryByLabelText('Цена факт')).toBeNull();
    save(d);
    await actions.flush();
    expect(data.value!.purchases.at(-1)).toEqual({
      id: expect.any(String), what: 'Пылесос', category: 'Техника', cost: 320, saved: 40.5, date: '2026-11-20',
      priority: 'Желательно', bought: false,
    });
    expect(screen.getByText('Сохранено')).toBeTruthy();
    expect(await loadData()).toEqual(data.value);
  });

  it('needs only a name: the cost may stay blank, as in the tracker', async () => {
    data.value = scenario();
    const before = data.value;
    renderScreen(<PurchasesPage params={{}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Новая покупка' }));
    const d = dialog('Новая покупка');
    save(d);
    expect(within(d).getByText('Введите название')).toBeTruthy();
    expect(within(d).queryByText('Введите стоимость')).toBeNull();
    expect(data.value).toBe(before);

    type(inputIn(d, 'Что'), 'Подарок');
    save(d);
    await actions.flush();
    expect(data.value!.purchases.at(-1)).toEqual({ id: expect.any(String), what: 'Подарок', bought: false });
    expect(screen.getByText('Сохранено')).toBeTruthy();
  });

  it('an imported purchase without a cost can be edited: changing the priority saves', async () => {
    const d0 = scenario();
    d0.purchases = [...d0.purchases, { id: 'p-podarok', what: 'Подарок', bought: false }];
    data.value = d0;
    renderScreen(<PurchasesPage params={{}} />);
    fireEvent.click(rowButton('Подарок'));
    const d = dialog('Покупка');
    choose(inputIn(d, 'Приоритет'), 'Желательно');
    save(d);
    await actions.flush();
    expect(row(data.value!.purchases, 'p-podarok')).toEqual({
      id: 'p-podarok', what: 'Подарок', bought: false, priority: 'Желательно',
    });
  });

  it('bought: the date and the account are required', () => {
    data.value = scenario();
    const before = data.value;
    renderScreen(<PurchasesPage params={{}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Новая покупка' }));
    const d = dialog('Новая покупка');
    type(inputIn(d, 'Что'), 'Чайник');
    type(inputIn(d, 'Стоимость'), '35');
    fireEvent.click(within(d).getByRole('switch', { name: 'Куплено' }));
    save(d);
    expect(within(d).getByText('Укажите дату покупки')).toBeTruthy();
    expect(within(d).getByText('Выберите счёт')).toBeTruthy();
    expect(data.value).toBe(before);
  });

  it('bought without a price and without a cost: «Укажите цену или стоимость»', () => {
    data.value = scenario();
    const before = data.value;
    renderScreen(<PurchasesPage params={{}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Новая покупка' }));
    const d = dialog('Новая покупка');
    type(inputIn(d, 'Что'), 'Чайник');
    type(inputIn(d, 'Дата покупки'), '2026-11-02');
    fireEvent.click(within(d).getByRole('switch', { name: 'Куплено' }));
    choose(inputIn(d, 'Счёт'), ACC.card);
    save(d);
    expect(within(d).getByText('Укажите цену или стоимость')).toBeTruthy();
    expect(within(d).queryByText('Укажите дату покупки')).toBeNull();
    expect(within(d).queryByText('Выберите счёт')).toBeNull();
    expect(data.value).toBe(before);
  });

  it('bought with only a price (no cost) or only a cost (no price) saves', async () => {
    data.value = scenario();
    renderScreen(<PurchasesPage params={{}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Новая покупка' }));
    let d = dialog('Новая покупка');
    type(inputIn(d, 'Что'), 'Чайник');
    type(inputIn(d, 'Дата покупки'), '2026-11-02');
    fireEvent.click(within(d).getByRole('switch', { name: 'Куплено' }));
    type(inputIn(d, 'Цена факт'), '35');
    choose(inputIn(d, 'Счёт'), ACC.card);
    save(d);
    await actions.flush();
    expect(data.value!.purchases.at(-1)).toEqual({
      id: expect.any(String), what: 'Чайник', date: '2026-11-02', bought: true, price: 35, account: ACC.card,
    });

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Новая покупка' }));
    d = dialog('Новая покупка');
    type(inputIn(d, 'Что'), 'Штора');
    type(inputIn(d, 'Стоимость'), '60');
    type(inputIn(d, 'Дата покупки'), '2026-11-03');
    fireEvent.click(within(d).getByRole('switch', { name: 'Куплено' }));
    choose(inputIn(d, 'Счёт'), ACC.card);
    save(d);
    await actions.flush();
    expect(data.value!.purchases.at(-1)).toEqual({
      id: expect.any(String), what: 'Штора', cost: 60, date: '2026-11-03', bought: true, account: ACC.card,
    });
  });

  it('marks a purchase bought with the price and the account', async () => {
    data.value = withPlans();
    renderScreen(<PurchasesPage params={{}} />);
    fireEvent.click(rowButton('Велосипед'));
    const d = dialog('Покупка');
    expect(inputIn(d, 'Что').value).toBe('Велосипед');
    expect(inputIn(d, 'Стоимость').value).toBe('1000');
    expect((inputIn(d, 'Приоритет') as unknown as HTMLSelectElement).value).toBe('Желательно');
    fireEvent.click(within(d).getByRole('switch', { name: 'Куплено' }));
    type(inputIn(d, 'Цена факт'), '949,99');
    choose(inputIn(d, 'Счёт'), ACC.credit);
    save(d);
    await actions.flush();
    expect(row(data.value!.purchases, 'p-velo')).toEqual({
      id: 'p-velo', what: 'Велосипед', cost: 1000, saved: 250, date: '2026-12-08', priority: 'Желательно', bought: true,
      price: 949.99, account: ACC.credit,
    });
  });

  it('an empty price is the cost; clearing optional fields removes them', async () => {
    data.value = withPlans();
    renderScreen(<PurchasesPage params={{}} />);
    fireEvent.click(rowButton('Ноутбук'));
    const d = dialog('Покупка');
    expect(inputIn(d, 'Цена факт').value).toBe('480');
    type(inputIn(d, 'Цена факт'), '');
    type(inputIn(d, 'Отложено'), '');
    choose(inputIn(d, 'Категория'), '');
    save(d);
    await actions.flush();
    expect(row(data.value!.purchases, 'p-noutbuk')).toEqual({
      id: 'p-noutbuk', what: 'Ноутбук', cost: 500, date: '2026-12-10', bought: true, account: ACC.card,
    });
  });

  it('keeps a priority typed in the tracker that is not in the list', () => {
    const d0 = withPlans();
    d0.purchases[1] = { ...d0.purchases[1]!, priority: 'Срочно' };
    data.value = d0;
    renderScreen(<PurchasesPage params={{}} />);
    fireEvent.click(rowButton('Наушники'));
    expect((inputIn(dialog('Покупка'), 'Приоритет') as unknown as HTMLSelectElement).value).toBe('Срочно');
  });

  it('a mistyped price disables saving; turning «Куплено» off (the price is hidden) enables it again', () => {
    data.value = withPlans();
    renderScreen(<PurchasesPage params={{}} />);
    fireEvent.click(rowButton('Ноутбук'));
    const d = dialog('Покупка');
    const saveButton = within(d).getByRole('button', { name: 'Сохранить' }) as HTMLButtonElement;
    type(inputIn(d, 'Цена факт'), '4 8о');
    expect(saveButton.disabled).toBe(true);
    fireEvent.click(within(d).getByRole('switch', { name: 'Куплено' }));
    expect(within(d).queryByLabelText('Цена факт')).toBeNull();
    expect(saveButton.disabled).toBe(false);
  });

  it('deletes after a confirmation, with «Отменить»', async () => {
    data.value = withPlans();
    renderScreen(<PurchasesPage params={{}} />);
    fireEvent.click(rowButton('Диван'));
    fireEvent.click(within(dialog('Покупка')).getByRole('button', { name: 'Удалить покупку' }));
    const ask = screen.getByRole('alertdialog', { name: 'Удалить покупку?' });
    fireEvent.click(within(ask).getByRole('button', { name: 'Удалить' }));
    await actions.flush();
    expect(data.value!.purchases.map((p) => p.id)).toEqual(['p-noutbuk', 'p-naush', 'p-velo', 'p-knigi']);
    expect(screen.getByText('Покупка удалена')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Отменить' }));
    expect(data.value!.purchases.map((p) => p.id)).toEqual(['p-noutbuk', 'p-naush', 'p-velo', 'p-divan', 'p-knigi']);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});
