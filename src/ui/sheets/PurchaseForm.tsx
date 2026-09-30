// «Новая покупка» / «Покупка» — openSheet('purchase', {initial?}); owner D5.
// What, category, cost, saved, date, priority; «Куплено» with the price paid (empty = the cost) and the
// account. Only the name is required, as blanks are in the model and the tracker. A bought purchase
// also needs its date, its account and a price or a cost (otherwise the tracker's statistics and
// balances miss it or count 0).
import { useState } from 'preact/hooks';
import { PRIORITIES, newId, opt } from '../../engine';
import type { Purchase } from '../../engine';
import { actions } from '../actions';
import { formatMoney } from '../format';
import { AmountField, Button, Confirm, DateField, Section, SelectField, Sheet, TextField, ToggleField, useFieldValidity } from '../kit';
import { appData } from '../state';
import { accountOptions, compact, hasErrors, nameOptions, upsert } from './planForm';
import type { Errors } from './planForm';

export interface PurchaseFormProps {
  open: boolean;
  onClose: () => void;
  initial?: Purchase;
}

type Field = 'what' | 'price' | 'date' | 'account';

export function PurchaseForm({ open, onClose, initial }: PurchaseFormProps) {
  const d = appData();
  const [what, setWhat] = useState<string | undefined>(initial?.what || undefined);
  const [category, setCategory] = useState<string | undefined>(opt(initial?.category));
  const [cost, setCost] = useState<number | undefined>(initial?.cost);
  const [saved, setSaved] = useState<number | undefined>(initial?.saved);
  const [date, setDate] = useState<string | undefined>(opt(initial?.date));
  const [priority, setPriority] = useState<string | undefined>(opt(initial?.priority));
  const [bought, setBought] = useState<boolean>(initial?.bought ?? false);
  const [price, setPrice] = useState<number | undefined>(initial?.price);
  const [account, setAccount] = useState<string | undefined>(opt(initial?.account));
  const [tried, setTried] = useState(false);
  const [asking, setAsking] = useState(false);
  const v = useFieldValidity();

  const positive = (n: number | undefined): boolean => n !== undefined && n > 0;
  const validate = (): Errors<Field> => ({
    what: what?.trim() ? undefined : 'Введите название',
    // the fact of a bought purchase is the price, or the cost when there is no price: it must not be 0
    price: bought && !positive(price ?? cost) ? 'Укажите цену или стоимость' : undefined,
    date: bought && date === undefined ? 'Укажите дату покупки' : undefined,
    account: bought && account === undefined ? 'Выберите счёт' : undefined,
  });
  const errors: Errors<Field> = tried ? validate() : {};

  const save = () => {
    setTried(true);
    if (v.anyInvalid || hasErrors(validate())) return;
    const p = compact<Purchase>({
      ...initial,
      id: initial?.id ?? newId(),
      what: (what ?? '').trim(),
      category,
      cost,
      saved,
      date,
      priority,
      bought,
      price,
      account,
    });
    const cur = appData();
    actions.commit({ ...cur, purchases: upsert(cur.purchases, p) }, 'Сохранено');
    onClose();
  };

  const remove = () => {
    setAsking(false);
    if (!initial) return;
    const cur = appData();
    actions.commit({ ...cur, purchases: cur.purchases.filter((p) => p.id !== initial.id) }, 'Покупка удалена');
    onClose();
  };

  return (
    <Sheet
      open={open}
      title={initial ? 'Покупка' : 'Новая покупка'}
      onClose={onClose}
      left={
        <Button kind="plain" onClick={onClose}>
          Отмена
        </Button>
      }
      right={
        <Button kind="plain" onClick={save} disabled={v.anyInvalid}>
          Сохранить
        </Button>
      }
    >
      <Section>
        <TextField label="Что" value={what} onChange={setWhat} placeholder="Что покупаем" error={errors.what} autoFocus={!initial} />
        <SelectField
          label="Категория"
          value={category}
          options={nameOptions(d.categories.expense.map((c) => c.name), category)}
          onChange={setCategory}
          placeholder="Без категории"
        />
        <AmountField label="Стоимость" value={cost} onChange={v.field('cost', setCost)} />
        <AmountField label="Отложено" value={saved} onChange={v.field('saved', setSaved)} />
        <DateField label="Дата покупки" value={date} onChange={v.field('date', setDate)} error={errors.date} />
        <SelectField
          label="Приоритет"
          value={priority}
          options={nameOptions(PRIORITIES, priority)}
          onChange={setPriority}
          placeholder="Не указан"
        />
      </Section>
      <Section
        footer={
          bought
            ? 'Пустая цена — как стоимость.'
            : 'Купили — включите и укажите дату и счёт.'
        }
      >
        <ToggleField label="Куплено" value={bought} onChange={setBought} />
        {bought && (
          <AmountField
            label="Цена факт"
            value={price}
            onChange={v.field('price', setPrice)}
            placeholder={cost !== undefined ? formatMoney(cost) : undefined}
            error={errors.price}
          />
        )}
        {bought && (
          <SelectField
            label="Счёт"
            value={account}
            options={accountOptions(d, account)}
            onChange={setAccount}
            placeholder="Не выбран"
            error={errors.account}
          />
        )}
      </Section>
      {initial && (
        <div class="sheet-actions">
          <Button kind="destructive" full onClick={() => setAsking(true)}>
            Удалить покупку
          </Button>
        </div>
      )}
      <Confirm
        open={asking}
        title="Удалить покупку?"
        confirmLabel="Удалить"
        onConfirm={remove}
        onCancel={() => setAsking(false)}
      />
    </Sheet>
  );
}
