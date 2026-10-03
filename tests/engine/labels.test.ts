// The Russian names of the model's enum values: one copy, in the engine, shared by the screens and by io.
import { describe, expect, it } from 'vitest';
import {
  ACCOUNT_TYPE_LABEL,
  CARD_REPAYMENT_LABEL,
  DUPLICATE_LABEL,
  FREE_AFTER_SAVINGS_LABEL,
  JOURNAL_STATUS_LABEL,
  KIND_LABEL,
  MOVEMENT_SOURCE_LABEL,
  PRIORITIES,
  ROW_CHECK_LABEL,
  SAVINGS_NOTE,
  SOURCE_LABEL,
  TO_SAVINGS_LABEL,
} from '../../src/engine';
import * as ioLabels from '../../src/io/labels';

describe('engine labels', () => {
  it('names every journal status', () => {
    expect(JOURNAL_STATUS_LABEL).toEqual({
      planned: 'Запланировано', paid: 'Оплачено', postponed: 'Перенесено', cancelled: 'Отменено',
    });
  });

  it('names every operation kind', () => {
    expect(KIND_LABEL).toEqual({ expense: 'Расход', income: 'Доход', transfer: 'Перевод' });
  });

  it('names every account type', () => {
    expect(ACCOUNT_TYPE_LABEL).toEqual({
      debit: 'Дебетовая', cash: 'Наличные', credit: 'Кредитная', savings: 'Сберегательная',
    });
  });

  it('says in one line what a savings account is (the tracker keeps them out of «Всего» and the forecast)', () => {
    expect(SAVINGS_NOTE).toBe('Сберегательные счета не входят во «Всего» и в прогноз');
  });

  it('names every source of the month feed', () => {
    expect(SOURCE_LABEL).toEqual({ operation: 'Операция', journal: 'Запланированные', recurring: 'Постоянный', purchase: 'Покупка' });
  });

  it('names every source of an account movement: the feed sources and the credit card auto-payment', () => {
    // on screen a journal row is a «Плановая запись»; the files keep the tracker's sheet name «Запланированные» (SOURCE_LABEL)
    expect(MOVEMENT_SOURCE_LABEL).toEqual({ ...SOURCE_LABEL, journal: 'Плановая запись', repayment: 'Автопогашение' });
    expect(SOURCE_LABEL.journal).toBe('Запланированные');
  });

  it('names what an item may duplicate', () => {
    expect(DUPLICATE_LABEL).toEqual({ journal: 'Запланированные', recurring: 'Постоянные', purchase: 'Покупки' });
  });

  it('words the checks of a row exactly as the tracker’s «Дубль или проверка» does', () => {
    expect(ROW_CHECK_LABEL).toEqual({
      looksLikeTransfer: 'Похоже на перевод — если деньги пришли с вашей карты, выберите тип «Перевод»',
      noTarget: 'Перевод: укажите «На счёт»',
      sameAccount: 'Перевод: «Счёт» = «На счёт»',
    });
  });

  it('names the lines of «Месяц» under the categories as the tracker does', () => {
    expect([TO_SAVINGS_LABEL, FREE_AFTER_SAVINGS_LABEL, CARD_REPAYMENT_LABEL])
      .toEqual(['Переводы в накопления', 'Свободно после накоплений', 'Погашение кредитки']);
  });

  it('lists the priorities in the tracker order', () => {
    expect(PRIORITIES).toEqual(['Обязательно', 'Желательно', 'Можно отложить']);
  });

  it('is the very copy io writes into the files (io re-exports it)', () => {
    expect(ioLabels.JOURNAL_STATUS_LABEL).toBe(JOURNAL_STATUS_LABEL);
    expect(ioLabels.KIND_LABEL).toBe(KIND_LABEL);
    expect(ioLabels.ACCOUNT_TYPE_LABEL).toBe(ACCOUNT_TYPE_LABEL);
    expect(ioLabels.SOURCE_LABEL).toBe(SOURCE_LABEL);
    expect(ioLabels.DUPLICATE_LABEL).toBe(DUPLICATE_LABEL);
    expect(ioLabels.PRIORITIES).toBe(PRIORITIES);
  });
});
