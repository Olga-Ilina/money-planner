// «Новый долг» / «Долг» — openSheet('debt', {initial?}); owner D5.
// Name, to whom, the amount of the debt, paid so far, the rate (typed in percent, stored as a
// fraction like the tracker's percent cell), the monthly payment and the next payment date. Only the
// name is required: the model and the tracker allow blank amounts.
import { useState } from 'preact/hooks';
import { newId, opt } from '../../engine';
import type { Debt } from '../../engine';
import { actions } from '../actions';
import { AmountField, Button, Confirm, DateField, NumberField, Section, Sheet, TextField, useFieldValidity } from '../kit';
import { appData } from '../state';
import { compact, hasErrors, upsert } from './planForm';
import type { Errors } from './planForm';

export interface DebtFormProps {
  open: boolean;
  onClose: () => void;
  initial?: Debt;
}

/** 12 significant digits: 0.049 × 100 is 4.9, not 4.8999999999999995. */
const clean = (n: number): number => Number(n.toPrecision(12));

type Field = 'name';

export function DebtForm({ open, onClose, initial }: DebtFormProps) {
  const [name, setName] = useState<string | undefined>(initial?.name || undefined);
  const [whom, setWhom] = useState<string | undefined>(opt(initial?.whom));
  const [total, setTotal] = useState<number | undefined>(initial?.total);
  const [paid, setPaid] = useState<number | undefined>(initial?.paid);
  const [percent, setPercent] = useState<number | undefined>(initial?.rate !== undefined ? clean(initial.rate * 100) : undefined);
  const [payment, setPayment] = useState<number | undefined>(initial?.payment);
  const [nextDate, setNextDate] = useState<string | undefined>(opt(initial?.nextDate));
  const [tried, setTried] = useState(false);
  const [asking, setAsking] = useState(false);
  const v = useFieldValidity();

  const validate = (): Errors<Field> => ({
    name: name?.trim() ? undefined : 'Введите название',
  });
  const errors: Errors<Field> = tried ? validate() : {};

  const save = () => {
    setTried(true);
    if (v.anyInvalid || hasErrors(validate())) return;
    // an untouched rate keeps its stored value exactly
    const unchanged = initial?.rate !== undefined && percent === clean(initial.rate * 100);
    const x = compact<Debt>({
      ...initial,
      id: initial?.id ?? newId(),
      name: (name ?? '').trim(),
      whom: whom?.trim() || undefined,
      total,
      paid,
      rate: unchanged ? initial?.rate : percent !== undefined ? clean(percent / 100) : undefined,
      payment,
      nextDate,
    });
    const cur = appData();
    actions.commit({ ...cur, debts: upsert(cur.debts, x) }, 'Сохранено');
    onClose();
  };

  const remove = () => {
    setAsking(false);
    if (!initial) return;
    const cur = appData();
    actions.commit({ ...cur, debts: cur.debts.filter((x) => x.id !== initial.id) }, 'Долг удалён');
    onClose();
  };

  return (
    <Sheet
      open={open}
      title={initial ? 'Долг' : 'Новый долг'}
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
        <TextField label="Название" value={name} onChange={setName} placeholder="Кредит, рассрочка" error={errors.name} autoFocus={!initial} />
        <TextField label="Кому" value={whom} onChange={setWhom} placeholder="Банк или человек" />
      </Section>
      <Section>
        <AmountField label="Сумма долга" value={total} onChange={v.field('total', setTotal)} />
        <AmountField label="Выплачено" value={paid} onChange={v.field('paid', setPaid)} />
        <NumberField
          label="Ставка, %"
          value={percent}
          integer={false}
          min={0}
          max={100}
          onChange={v.field('rate', setPercent)}
          placeholder="0"
        />
      </Section>
      <Section footer="Внесли платёж — прибавьте его к «Выплачено» и передвиньте дату следующего.">
        <AmountField label="Платёж в месяц" value={payment} onChange={v.field('payment', setPayment)} />
        <DateField label="Следующий платёж" value={nextDate} onChange={v.field('next', setNextDate)} />
      </Section>
      {initial && (
        <div class="sheet-actions">
          <Button kind="destructive" full onClick={() => setAsking(true)}>
            Удалить долг
          </Button>
        </div>
      )}
      <Confirm open={asking} title="Удалить долг?" confirmLabel="Удалить" onConfirm={remove} onCancel={() => setAsking(false)} />
    </Sheet>
  );
}
