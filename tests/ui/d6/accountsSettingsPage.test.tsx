// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { IDBFactory } from 'fake-indexeddb';
import { emptyData } from '../../../src/engine';
import { loadData, useFactory } from '../../../src/store/db';
import { actions } from '../../../src/ui/actions';
import { formatMoney } from '../../../src/ui/format';
import { Toast } from '../../../src/ui/kit';
import { AccountsSettingsPage } from '../../../src/ui/pages/AccountsSettingsPage';
import { SheetHost } from '../../../src/ui/sheets/host';
import { data, resetSession } from '../../../src/ui/state';
import { ACC, scenario } from '../../engine/scenario';

function renderPage() {
  return render(
    <>
      <AccountsSettingsPage params={{}} />
      <SheetHost />
      <Toast />
    </>,
  );
}

const type = (el: HTMLElement, text: string) => fireEvent.input(el, { target: { value: text } });

function choose(select: HTMLElement, label: string) {
  const option = Array.from((select as HTMLSelectElement).options).find((o) => o.textContent === label);
  if (!option) throw new Error(`no option ${label}`);
  fireEvent.change(select, { target: { value: option.value } });
}

async function openAccount(name: RegExp) {
  fireEvent.click(screen.getByRole('button', { name }));
  return screen.findByRole('dialog', { name: 'Счёт' });
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

describe('«Счета и кредитка» — accounts', () => {
  it('lists the accounts with their type and start, and the date of the starts', () => {
    renderPage();
    expect(screen.getByRole('heading', { level: 1, name: 'Счета и кредитка' })).toBeTruthy();
    const card = screen.getByRole('button', { name: /^Карта/ });
    expect(card.textContent).toContain('Дебетовая');
    expect(card.textContent).toContain(formatMoney(1000));
    expect(screen.getByRole('button', { name: /^Кредитка/ }).textContent).toContain('Кредитная');
    expect(screen.getByText(/Остаток на начало — на 01\.10\.2026/)).toBeTruthy();
  });

  it('edits name, type and start; the rows keep the account', async () => {
    renderPage();
    const sheet = await openAccount(/^Карта/);
    type(within(sheet).getByLabelText('Название'), 'Основная');
    type(within(sheet).getByLabelText('Остаток на 01.10.2026'), '1 200');
    fireEvent.click(within(sheet).getByRole('button', { name: 'Сохранить' }));
    await actions.flush();
    expect(data.value!.accounts[0]).toEqual({ id: ACC.card, name: 'Основная', type: 'debit', start: 1200 });
    expect(data.value!.operations).toEqual(scenario().operations);
    expect(await loadData()).toEqual(data.value);
    expect(screen.getByText('Сохранено')).toBeTruthy();
  });

  it('a credit card start can be negative; letters keep the start and block saving', async () => {
    renderPage();
    const sheet = await openAccount(/^Кредитка/);
    const start = within(sheet).getByLabelText('Остаток на 01.10.2026');
    type(start, '-150');
    type(start, '-150x');
    const save = within(sheet).getByRole('button', { name: 'Сохранить' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    type(start, '-150');
    fireEvent.click(save);
    await actions.flush();
    expect(data.value!.accounts[2]).toMatchObject({ id: ACC.credit, start: -150 });
  });

  it('a cleared start of an existing account asks for an amount instead of saving 0', async () => {
    renderPage();
    const sheet = await openAccount(/^Карта/);
    type(within(sheet).getByLabelText('Остаток на 01.10.2026'), '');
    expect(within(sheet).getByText('Введите сумму')).toBeTruthy();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Сохранить' }));
    await actions.flush();
    expect(data.value!.accounts[0]).toEqual({ id: ACC.card, name: 'Карта', type: 'debit', start: 1000 });
    expect(screen.getByRole('dialog', { name: 'Счёт' })).toBeTruthy();
    type(within(sheet).getByLabelText('Остаток на 01.10.2026'), '0');
    expect(within(sheet).queryByText('Введите сумму')).toBeNull();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Сохранить' }));
    await actions.flush();
    expect(data.value!.accounts[0]).toEqual({ id: ACC.card, name: 'Карта', type: 'debit', start: 0 });
  });

  it('adds an account with a new id', async () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Добавить счёт' }));
    const sheet = await screen.findByRole('dialog', { name: 'Новый счёт' });
    type(within(sheet).getByLabelText('Название'), ' Вклад ');
    choose(within(sheet).getByLabelText('Тип'), 'Сберегательная');
    type(within(sheet).getByLabelText('Остаток на 01.10.2026'), '250');
    fireEvent.click(within(sheet).getByRole('button', { name: 'Сохранить' }));
    await actions.flush();
    const added = data.value!.accounts.at(-1)!;
    expect(added).toMatchObject({ name: 'Вклад', type: 'savings', start: 250 });
    expect(added.id).toMatch(/.+/);
    expect(scenario().accounts.map((a) => a.id)).not.toContain(added.id);
  });

  it('the type «Сберегательная» says under the field that such accounts are outside «Всего» and the forecast', async () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Добавить счёт' }));
    const sheet = await screen.findByRole('dialog', { name: 'Новый счёт' });
    const typeField = within(sheet).getByLabelText('Тип');
    const NOTE = 'Сберегательные счета не входят во «Всего» и в прогноз';
    expect(within(sheet).queryByText(NOTE)).toBeNull();
    choose(typeField, 'Сберегательная');
    expect(within(sheet).getByText(NOTE)).toBeTruthy();
    // the note describes the field (the kit's hint)
    const hintId = typeField.getAttribute('aria-describedby') ?? '';
    expect(hintId).not.toBe('');
    expect(sheet.querySelector(`#${CSS.escape(hintId)}`)?.textContent).toBe(NOTE);
    choose(typeField, 'Наличные');
    expect(within(sheet).queryByText(NOTE)).toBeNull();
  });

  it('an existing savings account shows the note when its sheet opens', async () => {
    data.value = { ...scenario(), accounts: [...scenario().accounts, { id: 'acc-vklad', name: 'Вклад', type: 'savings', start: 250 }] };
    renderPage();
    const sheet = await openAccount(/^Вклад/);
    expect(within(sheet).getByText('Сберегательные счета не входят во «Всего» и в прогноз')).toBeTruthy();
  });

  it('an empty start of a new account is 0; the name is required and must be new', async () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Добавить счёт' }));
    const sheet = await screen.findByRole('dialog', { name: 'Новый счёт' });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Сохранить' }));
    expect(within(sheet).getByText('Введите название')).toBeTruthy();
    type(within(sheet).getByLabelText('Название'), 'наличные');
    fireEvent.click(within(sheet).getByRole('button', { name: 'Сохранить' }));
    expect(within(sheet).getByText('Такой счёт уже есть')).toBeTruthy();
    expect(data.value!.accounts).toHaveLength(3);
    type(within(sheet).getByLabelText('Название'), 'Кошелёк');
    fireEvent.click(within(sheet).getByRole('button', { name: 'Сохранить' }));
    await actions.flush();
    expect(data.value!.accounts.at(-1)).toMatchObject({ name: 'Кошелёк', type: 'debit', start: 0 });
  });

  it('an account that rows use cannot be deleted, and the sheet says what uses it', async () => {
    renderPage();
    const sheet = await openAccount(/^Наличные/);
    expect((within(sheet).getByRole('button', { name: 'Удалить счёт' }) as HTMLButtonElement).disabled).toBe(true);
    expect(within(sheet).getByText(/На нём: 2 операции — укажите в них другой счёт/)).toBeTruthy();
    const card = await (async () => {
      fireEvent.click(within(sheet).getByRole('button', { name: 'Отмена' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      return openAccount(/^Карта/);
    })();
    expect(within(card).getByText(/в настройках кредитки \(«Со счёта»\)/)).toBeTruthy();
  });

  it('new data with one card purchase: «Основная карта» pays the card by default, so it cannot be deleted', async () => {
    const d = emptyData('2026-10-01');
    d.operations.push({ id: 'o-1', date: '2026-10-05', kind: 'expense', what: 'Кафе', amount: 40, account: d.accounts[2]!.id });
    data.value = d;
    renderPage();
    const sheet = await openAccount(/^Основная карта/);
    expect((within(sheet).getByRole('button', { name: 'Удалить счёт' }) as HTMLButtonElement).disabled).toBe(true);
    expect(
      within(sheet).getByText(
        'Счёт нельзя удалить. Он выбран в настройках кредитки («Со счёта») — выберите там другой счёт или выключите «Гасится автоматически».',
      ),
    ).toBeTruthy();
  });

  it('the card of the auto-payments cannot become another type: the sheet says why and does not save', async () => {
    renderPage();
    const sheet = await openAccount(/^Кредитка/);
    choose(within(sheet).getByLabelText('Тип'), 'Дебетовая');
    expect(
      within(sheet).getByText(
        'Тип не сменить: счёт выбран в настройках кредитки («Карта») — выберите там другой счёт или выключите «Гасится автоматически».',
      ),
    ).toBeTruthy();
    const save = within(sheet).getByRole('button', { name: 'Сохранить' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.click(save);
    await actions.flush();
    expect(data.value).toEqual(scenario());
    choose(within(sheet).getByLabelText('Тип'), 'Кредитная');
    expect(save.disabled).toBe(false);
  });

  it('an unused account is deleted after a confirm that mentions its start, with undo', async () => {
    const start = scenario();
    start.accounts.push({ id: 'acc-vklad', name: 'Вклад', type: 'savings', start: 250 });
    data.value = start;
    renderPage();
    const sheet = await openAccount(/^Вклад/);
    fireEvent.click(within(sheet).getByRole('button', { name: 'Удалить счёт' }));
    const confirm = await screen.findByRole('alertdialog', { name: 'Удалить счёт «Вклад»?' });
    expect(confirm.textContent).toContain(formatMoney(250));
    fireEvent.click(within(confirm).getByRole('button', { name: 'Удалить' }));
    await actions.flush();
    expect(data.value!.accounts.map((a) => a.id)).toEqual([ACC.card, ACC.cash, ACC.credit]);
    expect(screen.getByText('Счёт удалён')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Отменить' }));
    expect(data.value).toBe(start);
  });

  it('«Изменить» reorders the accounts', async () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Изменить' }));
    fireEvent.click(screen.getByRole('button', { name: 'Ниже: Карта' }));
    await actions.flush();
    expect(data.value!.accounts.map((a) => a.id)).toEqual([ACC.cash, ACC.card, ACC.credit]);
    expect((screen.getByRole('button', { name: 'Ниже: Кредитка' }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('«Счета и кредитка» — credit card', () => {
  it('shows the settings: the card among credit accounts, auto, the account to pay from, the days', () => {
    renderPage();
    const card = screen.getByLabelText('Карта') as HTMLSelectElement;
    expect(Array.from(card.options).map((o) => o.textContent)).toEqual(['Кредитка']);
    expect(card.value).toBe(ACC.credit);
    expect(screen.getByRole('switch', { name: 'Гасится автоматически' }).getAttribute('aria-checked')).toBe('true');
    const from = screen.getByLabelText('Со счёта') as HTMLSelectElement;
    expect(Array.from(from.options).map((o) => o.textContent)).toEqual(['Карта', 'Наличные']);
    expect(from.value).toBe(ACC.card);
    expect((screen.getByLabelText('Выписка (число)') as HTMLInputElement).value).toBe('4');
    expect((screen.getByLabelText('Списание (число)') as HTMLInputElement).value).toBe('10');
    expect(screen.getByText(/после выписки/)).toBeTruthy();
  });

  it('a card that is gone (deleted account): «Карта» reads «Не выбрана»', () => {
    const d = scenario();
    d.credit = { ...d.credit, accountId: 'acc-gone' };
    data.value = d;
    renderPage();
    const card = screen.getByLabelText('Карта') as HTMLSelectElement;
    expect(card.value).toBe('');
    expect(card.selectedOptions[0]?.textContent).toBe('Не выбрана');
  });

  it('changes are saved at once', async () => {
    renderPage();
    fireEvent.click(screen.getByRole('switch', { name: 'Гасится автоматически' }));
    choose(screen.getByLabelText('Со счёта'), 'Наличные');
    type(screen.getByLabelText('Выписка (число)'), '5');
    type(screen.getByLabelText('Списание (число)'), '12');
    await actions.flush();
    expect(data.value!.credit).toEqual({ auto: false, fromAccountId: ACC.cash, closeDay: 5, payDay: 12 });
    expect((await loadData())?.credit).toEqual(data.value!.credit);
  });

  it('a day outside 1..28 or an empty day keeps the stored day and says why', async () => {
    renderPage();
    const close = screen.getByLabelText('Выписка (число)');
    type(close, '31');
    expect(screen.getByText('От 1 до 28')).toBeTruthy();
    type(close, '');
    expect(screen.getByText('Укажите число от 1 до 28')).toBeTruthy();
    await actions.flush();
    expect(data.value!.credit.closeDay).toBe(4);
  });

  it('without a credit account it says how to add one', () => {
    const d = scenario();
    d.accounts = d.accounts.filter((a) => a.type !== 'credit');
    d.operations = [];
    d.recurring = [];
    data.value = d;
    renderPage();
    expect(screen.getByText('Кредитной карты нет')).toBeTruthy(); // the words of «Кредитка»
    expect(screen.getByText('Добавьте счёт с типом «Кредитная» — здесь появятся его выписки и списания.')).toBeTruthy();
    expect(screen.queryByLabelText('Выписка (число)')).toBeNull();
  });
});
