// Page «Счета и кредитка» (registered as 'accounts-settings' in src/ui/pages.ts); owner: D6.
// Accounts: name, type and the start balance on the balances date; tapping one opens its sheet (edit,
// delete). An account that any row or the credit settings still use (the card and the account that
// auto-payments run between, chosen or by default) cannot be deleted — the sheet says what uses it.
// «Изменить» shows reorder buttons. The credit-card settings are saved as they change.
import './AccountsSettingsPage.css';
import { useRef, useState } from 'preact/hooks';
import { ACCOUNT_TYPE_LABEL, SAVINGS_NOTE, creditCardId, newId, payFromId } from '../../engine';
import type { AccountType } from '../../engine';
import { actions } from '../actions';
import { formatDate, formatMoney } from '../format';
import {
  AmountField, Button, Confirm, Icon, Money, NumberField, Page, Row, Section, SelectField, Sheet, TextField, ToggleField,
  useFieldValidity,
} from '../kit';
import type { RoutedPageProps } from '../nav';
import { appData } from '../state';
import {
  accountBlockText, accountNameError, accountTypeError, accountUsage, addAccount, moveAccount, removeAccount, setCredit,
  updateAccount,
} from './accountsSettingsEdit';

const TYPE_OPTIONS = (Object.keys(ACCOUNT_TYPE_LABEL) as AccountType[]).map((t) => ({ value: t, label: ACCOUNT_TYPE_LABEL[t] }));

export function AccountsSettingsPage(_props: RoutedPageProps) {
  const d = appData();
  const [editMode, setEditMode] = useState(false);
  const [editing, setEditing] = useState<{ id?: string } | null>(null);
  const [opened, setOpened] = useState(0);

  const open = (id?: string) => {
    setEditing({ id });
    setOpened((n) => n + 1);
  };

  const move = (index: number, delta: -1 | 1) => {
    const next = moveAccount(appData(), index, delta);
    if (next !== appData()) actions.commit(next);
  };

  return (
    <Page
      title="Счета и кредитка"
      right={
        <Button kind="plain" onClick={() => setEditMode(!editMode)}>
          {editMode ? 'Готово' : 'Изменить'}
        </Button>
      }
    >
      <Section
        header="Счета"
        footer={`Остаток на начало — на ${formatDate(d.settings.balancesDate)} (дату меняют в «Учёт и прогноз»). Долг по кредитке — со знаком минус.`}
      >
        {d.accounts.map((a, i) => (
          <Row
            key={a.id}
            title={a.name}
            subtitle={ACCOUNT_TYPE_LABEL[a.type] ?? a.type}
            value={<Money value={a.start} />}
            chevron={!editMode}
            onClick={() => open(a.id)}
            trailing={
              editMode ? (
                <>
                  <button
                    type="button"
                    class="icon-button"
                    aria-label={`Выше: ${a.name}`}
                    disabled={i === 0}
                    onClick={() => move(i, -1)}
                  >
                    <Icon name="chevron-up" size={20} />
                  </button>
                  <button
                    type="button"
                    class="icon-button"
                    aria-label={`Ниже: ${a.name}`}
                    disabled={i === d.accounts.length - 1}
                    onClick={() => move(i, 1)}
                  >
                    <Icon name="chevron-down" size={20} />
                  </button>
                </>
              ) : undefined
            }
          />
        ))}
        <Row icon="plus" title="Добавить счёт" onClick={() => open()} />
      </Section>
      <CreditSection />
      <AccountSheet key={opened} editing={editing} onClose={() => setEditing(null)} />
    </Page>
  );
}

function CreditSection() {
  const d = appData();
  const credit = d.credit;
  const cards = d.accounts.filter((a) => a.type === 'credit');
  const payers = d.accounts.filter((a) => a.type !== 'credit');
  const [emptyDay, setEmptyDay] = useState<{ close: boolean; pay: boolean }>({ close: false, pay: false });

  const change = (patch: Parameters<typeof setCredit>[1]) => actions.commit(setCredit(appData(), patch));

  const day = (which: 'close' | 'pay') => (v: number | undefined, info: { invalid: boolean }) => {
    if (info.invalid) return;
    setEmptyDay((e) => ({ ...e, [which]: v === undefined }));
    if (v === undefined) return;
    const current = which === 'close' ? appData().credit.closeDay : appData().credit.payDay;
    if (v !== current) change(which === 'close' ? { closeDay: v } : { payDay: v });
  };

  if (cards.length === 0) {
    return (
      <Section header="Кредитка">
        <Row title="Кредитной карты нет" subtitle="Добавьте счёт с типом «Кредитная» — здесь появятся его выписки и списания." />
      </Section>
    );
  }

  return (
    <Section
      header="Кредитка"
      footer="Выписка — день, когда банк подводит итог по карте; списание — день, когда долг по выписке гасится со счёта. Списание всегда после выписки: если его число не больше числа выписки, оно в следующем месяце."
    >
      <SelectField
        label="Карта"
        emptyLabel="Не выбрана"
        value={creditCardId(d)}
        options={cards.map((a) => ({ value: a.id, label: a.name }))}
        onChange={(id) => id !== undefined && id !== creditCardId(appData()) && change({ accountId: id })}
      />
      <ToggleField label="Гасится автоматически" value={credit.auto} onChange={(auto) => change({ auto })} />
      <SelectField
        label="Со счёта"
        value={payFromId(d)}
        options={payers.map((a) => ({ value: a.id, label: a.name }))}
        onChange={(id) => id !== undefined && id !== payFromId(appData()) && change({ fromAccountId: id })}
      />
      <NumberField
        label="Выписка (число)"
        value={credit.closeDay}
        min={1}
        max={28}
        error={emptyDay.close ? 'Укажите число от 1 до 28' : undefined}
        onChange={day('close')}
      />
      <NumberField
        label="Списание (число)"
        value={credit.payDay}
        min={1}
        max={28}
        error={emptyDay.pay ? 'Укажите число от 1 до 28' : undefined}
        onChange={day('pay')}
      />
    </Section>
  );
}

interface AccountSheetProps {
  editing: { id?: string } | null;
  onClose: () => void;
}

function AccountSheet({ editing, onClose }: AccountSheetProps) {
  const d = appData();
  // what this sheet was opened for; kept while it (and its confirm) slide away after `editing` is cleared
  const [subject] = useState(editing);
  const id = subject?.id;
  const found = id !== undefined ? d.accounts.find((a) => a.id === id) : undefined;
  // the last one seen: the confirm still shows it while it slides away after the delete
  const last = useRef(found);
  if (found) last.current = found;
  const account = found ?? last.current;
  const [name, setName] = useState<string | undefined>(account?.name);
  const [type, setType] = useState<AccountType>(account?.type ?? 'debit');
  const [start, setStart] = useState<number | undefined>(account?.start);
  const [tried, setTried] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const v = useFieldValidity();

  const nameError = tried ? accountNameError(d, name, id) : undefined;
  // the credit settings may need this account's type (checked at once: the choice is visible)
  const typeError = id !== undefined ? accountTypeError(d, id, type) : undefined;
  // an existing account's start is never set to 0 by clearing the field (a new one starts at 0)
  const startError = id !== undefined && start === undefined ? 'Введите сумму' : undefined;
  const usage = id !== undefined ? accountUsage(d, id) : undefined;

  const save = () => {
    setTried(true);
    const latest = appData();
    if (v.anyInvalid || name === undefined || accountNameError(latest, name, id) !== undefined) return;
    if (startError !== undefined || (id !== undefined && accountTypeError(latest, id, type) !== undefined)) return;
    const fields = { name, type, start: start ?? 0 };
    if (id === undefined) {
      actions.commit(addAccount(latest, fields, newId()), 'Сохранено');
    } else {
      const was = latest.accounts.find((a) => a.id === id);
      if (was && (was.name !== name.trim() || was.type !== type || was.start !== fields.start)) {
        actions.commit(updateAccount(latest, id, fields), 'Сохранено');
      }
    }
    onClose();
  };

  const remove = () => {
    setConfirm(false);
    if (id === undefined || accountUsage(appData(), id).total > 0) return;
    actions.commit(removeAccount(appData(), id), 'Счёт удалён');
    onClose();
  };

  const startNote =
    account && account.start !== 0 ? `Его остаток на начало (${formatMoney(account.start)}) пропадёт из итогов.` : undefined;

  return (
    <>
      <Sheet
        open={editing !== null}
        title={id === undefined ? 'Новый счёт' : 'Счёт'}
        onClose={onClose}
        left={
          <Button kind="plain" onClick={onClose}>
            Отмена
          </Button>
        }
        right={
          <Button kind="plain" onClick={save} disabled={v.anyInvalid || typeError !== undefined}>
            Сохранить
          </Button>
        }
      >
        <Section>
          <TextField label="Название" value={name} onChange={setName} error={nameError} maxLength={60} />
          <SelectField
            label="Тип"
            value={type}
            options={TYPE_OPTIONS}
            error={typeError}
            hint={type === 'savings' ? SAVINGS_NOTE : undefined}
            onChange={(t) => t && setType(t)}
          />
          <AmountField
            label={`Остаток на ${formatDate(d.settings.balancesDate)}`}
            value={start}
            allowNegative
            error={startError}
            onChange={v.field('start', setStart)}
          />
        </Section>
        {account && usage && (
          <>
            <div class="sheet-actions">
              <Button kind="destructive" full disabled={usage.total > 0} onClick={() => setConfirm(true)}>
                Удалить счёт
              </Button>
            </div>
            {usage.total > 0 && (
              <p class="sheet-text accounts-settings-note">{accountBlockText(usage)}</p>
            )}
          </>
        )}
      </Sheet>
      <Confirm
        open={confirm}
        title={`Удалить счёт «${account?.name ?? ''}»?`}
        message={startNote}
        confirmLabel="Удалить"
        onConfirm={remove}
        onCancel={() => setConfirm(false)}
      />
    </>
  );
}
