// Russian names of the model's enum values, as the Excel tracker writes them. One copy for everyone:
// the screens show them, and src/io/labels.ts re-exports them for the files (and keeps its parsers).
import type { MovementSource } from './accounts';
import type { FeedSource } from './feed';
import type { AccountType, JournalStatus, OpKind } from './model';
import type { DuplicateOf } from './rules';

export const JOURNAL_STATUS_LABEL: Record<JournalStatus, string> = {
  planned: 'Запланировано', paid: 'Оплачено', postponed: 'Перенесено', cancelled: 'Отменено',
};

export const KIND_LABEL: Record<OpKind, string> = { expense: 'Расход', income: 'Доход', transfer: 'Перевод' };

export const ACCOUNT_TYPE_LABEL: Record<AccountType, string> = {
  debit: 'Дебетовая', cash: 'Наличные', credit: 'Кредитная', savings: 'Сберегательная',
};

/** What a savings account is, in one line (the tracker's rule: outside «Всего» and the forecast, see `inBalance`). */
export const SAVINGS_NOTE = 'Сберегательные счета не входят во «Всего» и в прогноз';

/** Where an item of the month feed comes from. */
export const SOURCE_LABEL: Record<FeedSource, string> = {
  operation: 'Операция', journal: 'Запланированные', recurring: 'Постоянный', purchase: 'Покупка',
};

/**
 * Where a movement of an account comes from (the account page): a feed source, or the credit card's
 * auto-payment. A journal row is a «Плановая запись» on screen, as everywhere in the app; the files keep
 * the tracker's sheet name «Запланированные» (SOURCE_LABEL — the reports do not use this map).
 */
export const MOVEMENT_SOURCE_LABEL: Record<MovementSource, string> = {
  ...SOURCE_LABEL,
  journal: 'Плановая запись',
  repayment: 'Автопогашение',
};

/** What an item may duplicate — «Возможный дубль». */
export const DUPLICATE_LABEL: Record<DuplicateOf, string> = { journal: 'Запланированные', recurring: 'Постоянные', purchase: 'Покупки' };

/** The tracker's priorities (its drop-down on «Запланированные» and «Покупки»), in its order. */
export const PRIORITIES = ['Обязательно', 'Желательно', 'Можно отложить'] as const;
