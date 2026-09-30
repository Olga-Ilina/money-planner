import { describe, expect, it } from 'vitest';
import { balances, creditCardId, emptyData, payFromId } from '../../../src/engine';
import type { Data } from '../../../src/engine';
import {
  accountBlockText, accountNameError, accountTypeError, accountUsage, addAccount, moveAccount, removeAccount, setCredit,
  updateAccount,
} from '../../../src/ui/pages/accountsSettingsEdit';
import { ACC, scenario } from '../../engine/scenario';

const ids = (d: Data) => d.accounts.map((a) => a.id);

describe('accountUsage', () => {
  it('counts rows by source and the credit settings the engine uses', () => {
    expect(accountUsage(scenario(), ACC.card)).toEqual({
      operations: 4, journal: 10, recurring: 3, purchases: 1, credit: ['Со счёта'], total: 19,
    });
    // transfers count on both ends
    expect(accountUsage(scenario(), ACC.cash)).toEqual({ operations: 2, journal: 0, recurring: 0, purchases: 0, credit: [], total: 2 });
    // no accountId: the card is the first credit account, and auto-payments repay it — it counts all the same
    expect(accountUsage(scenario(), ACC.credit)).toMatchObject({ operations: 2, recurring: 1, credit: ['Карта'], total: 4 });
  });

  it('an explicitly chosen credit card counts', () => {
    const d = scenario();
    d.accounts.push({ id: 'acc-credit2', name: 'Вторая', type: 'credit', start: 0 });
    d.credit.accountId = 'acc-credit2';
    expect(accountUsage(d, 'acc-credit2').credit).toEqual(['Карта']);
    expect(accountUsage(d, ACC.credit).credit).toEqual([]);
  });

  it('new data with one card purchase: the default «Со счёта» and «Карта» count, so neither can go', () => {
    const d = emptyData('2026-10-01');
    const [main, cash, card] = d.accounts as [Data['accounts'][0], Data['accounts'][0], Data['accounts'][0]];
    d.operations.push({ id: 'o-1', date: '2026-10-05', kind: 'expense', what: 'Кафе', amount: 40, account: card.id });
    expect(payFromId(d)).toBe(main.id);
    expect(accountUsage(d, main.id)).toEqual({ operations: 0, journal: 0, recurring: 0, purchases: 0, credit: ['Со счёта'], total: 1 });
    expect(accountUsage(d, card.id).credit).toEqual(['Карта']);
    expect(accountUsage(d, cash.id).total).toBe(0);
    expect(() => removeAccount(d, main.id)).toThrow();
    // deleting it would move the repayments to «Наличные»
    const moved = { ...d, accounts: d.accounts.filter((a) => a.id !== main.id) };
    expect(balances(moved, '2026-11-30').rows.find((r) => r.id === cash.id)?.now).not.toBe(0);
  });

  it('without auto-payments the credit settings hold nothing; an explicit choice goes with its account', () => {
    const d = setCredit(scenario(), { auto: false });
    expect(accountUsage(d, ACC.card).credit).toEqual([]);
    expect(accountUsage(d, ACC.credit).credit).toEqual([]);
    const spare = { ...d, accounts: [...d.accounts, { id: 'acc-x', name: 'Запасная', type: 'debit' as const, start: 0 }] };
    const chosen = setCredit(spare, { fromAccountId: 'acc-x' });
    const next = removeAccount(chosen, 'acc-x');
    expect(next.credit).toEqual({ auto: false, closeDay: 4, payDay: 10 });
    expect('fromAccountId' in next.credit).toBe(false);
  });

  it('nothing for an unused account', () => {
    const d = addAccount(scenario(), { name: 'Вклад', type: 'savings', start: 0 }, 'acc-new');
    expect(accountUsage(d, 'acc-new').total).toBe(0);
  });
});

describe('accountBlockText', () => {
  it('says where the account is used, in a form that fits any count, and how to free it', () => {
    expect(accountBlockText(accountUsage(scenario(), ACC.card))).toBe(
      'Счёт нельзя удалить. На нём: 4 операции, 10 плановых записей, 3 постоянных платежа, 1 покупка — укажите в них другой счёт. ' +
        'Он выбран в настройках кредитки («Со счёта») — выберите там другой счёт или выключите «Гасится автоматически».',
    );
    expect(accountBlockText(accountUsage(scenario(), ACC.cash))).toBe(
      'Счёт нельзя удалить. На нём: 2 операции — укажите в них другой счёт.',
    );
    const d = emptyData('2026-10-01');
    expect(accountBlockText(accountUsage(d, d.accounts[2]!.id))).toBe(
      'Счёт нельзя удалить. Он выбран в настройках кредитки («Карта») — выберите там другой счёт или выключите «Гасится автоматически».',
    );
  });
});

describe('account edits', () => {
  it('adds an account at the end with the given id, trimmed', () => {
    const d = addAccount(scenario(), { name: ' Вклад ', type: 'savings', start: 250 }, 'acc-new');
    expect(d.accounts.at(-1)).toEqual({ id: 'acc-new', name: 'Вклад', type: 'savings', start: 250 });
  });

  it('updates name, type and start without touching the rows', () => {
    const d = scenario();
    const next = updateAccount(d, ACC.card, { name: 'Основная', type: 'debit', start: 1200 });
    expect(next.accounts[0]).toEqual({ id: ACC.card, name: 'Основная', type: 'debit', start: 1200 });
    expect(next.operations).toBe(d.operations);
    expect(d.accounts[0]?.name).toBe('Карта');
  });

  it('removes only an account nothing uses', () => {
    const d = addAccount(scenario(), { name: 'Вклад', type: 'savings', start: 0 }, 'acc-new');
    expect(ids(removeAccount(d, 'acc-new'))).toEqual([ACC.card, ACC.cash, ACC.credit]);
    expect(() => removeAccount(scenario(), ACC.cash)).toThrow();
  });

  it('moves an account up or down', () => {
    expect(ids(moveAccount(scenario(), 2, -1))).toEqual([ACC.card, ACC.credit, ACC.cash]);
    const d = scenario();
    expect(moveAccount(d, 0, -1)).toBe(d);
    expect(moveAccount(d, 2, 1)).toBe(d);
  });

  it('names must be there and differ from the other accounts', () => {
    const d = scenario();
    expect(accountNameError(d, undefined)).toBe('Введите название');
    expect(accountNameError(d, ' наличные ')).toBe('Такой счёт уже есть');
    expect(accountNameError(d, 'Наличные', ACC.cash)).toBeUndefined();
    expect(accountNameError(d, 'Вклад')).toBeUndefined();
  });
});

describe('the credit settings follow account edits', () => {
  const WAY_OUT = 'выберите там другой счёт или выключите «Гасится автоматически».';

  it('the card that auto-payments repay stays a credit card; the account they come from never becomes one', () => {
    const d = scenario();
    expect(accountTypeError(d, ACC.credit, 'debit')).toBe(`Тип не сменить: счёт выбран в настройках кредитки («Карта») — ${WAY_OUT}`);
    expect(accountTypeError(d, ACC.card, 'credit')).toBe(`Тип не сменить: счёт выбран в настройках кредитки («Со счёта») — ${WAY_OUT}`);
    expect(accountTypeError(d, ACC.credit, 'credit')).toBeUndefined();
    expect(accountTypeError(d, ACC.card, 'savings')).toBeUndefined();
    expect(accountTypeError(d, ACC.cash, 'credit')).toBeUndefined();
    expect(() => updateAccount(d, ACC.credit, { name: 'Кредитка', type: 'debit', start: 0 })).toThrow();
    expect(() => updateAccount(d, ACC.card, { name: 'Карта', type: 'credit', start: 1000 })).toThrow();
  });

  it('without auto-payments the type is free; an explicit choice that no longer fits is cleared with it', () => {
    const d = setCredit(scenario(), { auto: false, accountId: ACC.credit });
    expect(accountTypeError(d, ACC.credit, 'debit')).toBeUndefined();
    expect(updateAccount(d, ACC.credit, { name: 'Кредитка', type: 'debit', start: 0 }).credit).toEqual({
      auto: false, fromAccountId: ACC.card, closeDay: 4, payDay: 10,
    });
    expect(updateAccount(d, ACC.card, { name: 'Карта', type: 'credit', start: 1000 }).credit).toEqual({
      auto: false, accountId: ACC.credit, closeDay: 4, payDay: 10,
    });
  });

  it('a reorder or another account’s new type never moves the auto-payments to other accounts', () => {
    const d = scenario();
    delete d.credit.fromAccountId; // both by default
    d.accounts.push({ id: 'acc-credit2', name: 'Вторая', type: 'credit', start: -200 });
    const today = '2026-12-31';
    const now = (x: Data) => Object.fromEntries(balances(x, today).rows.map((r) => [r.id, r.now]));

    const cardUp = moveAccount(d, 3, -1); // «Вторая» above «Кредитка»: it would be the card by default
    expect(creditCardId(cardUp)).toBe(ACC.credit);
    expect(cardUp.credit.accountId).toBe(ACC.credit);
    expect(now(cardUp)).toEqual(now(d));

    const cashUp = moveAccount(d, 0, 1); // «Наличные» first: it would pay by default
    expect(payFromId(cashUp)).toBe(ACC.card);
    expect(now(cashUp)).toEqual(now(d));

    const retyped = updateAccount(d, ACC.cash, { name: 'Наличные', type: 'credit', start: 0 }); // now the first credit account
    expect(creditCardId(retyped)).toBe(ACC.credit);

    // nothing to keep without auto-payments; a move that changes neither leaves the settings as they are
    const off = setCredit(d, { auto: false });
    expect(moveAccount(off, 3, -1).credit).toBe(off.credit);
    expect(moveAccount(d, 1, 1).credit).toBe(d.credit);
  });
});

describe('setCredit', () => {
  it('changes the credit settings; days are kept within 1..28', () => {
    const d = setCredit(scenario(), { auto: false, closeDay: 5, payDay: 12, accountId: ACC.credit });
    expect(d.credit).toEqual({ auto: false, fromAccountId: ACC.card, closeDay: 5, payDay: 12, accountId: ACC.credit });
    expect(setCredit(d, { closeDay: 31 }).credit.closeDay).toBe(28);
  });
});
