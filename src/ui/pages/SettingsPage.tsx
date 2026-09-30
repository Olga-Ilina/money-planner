// Page «Учёт и прогноз» (registered as 'settings' in src/ui/pages.ts); owner: D6.
// On top, when records lie outside the accounting year («Сегодня» sends them here: «Лента» cannot show
// them), what that means. The accounting year is chosen first: while a new «Учёт с» is picked, a note from the engine says what
// falls outside that year and whether the balances change; «Сохранить» commits it with undo. The
// forecast start, the cushion and the balances date are saved as they change (like the iOS Settings
// app). A typo or an emptied field keeps the stored value and says why.
import './SettingsPage.css';
import { useState } from 'preact/hooks';
import { accountingMonths, addMonths, forecastMonths } from '../../engine';
import type { Data, ISODate, Settings, YM } from '../../engine';
import { actions } from '../actions';
import { AmountField, Banner, Button, DateField, Page, Section } from '../kit';
import type { FieldInfo } from '../kit';
import type { RoutedPageProps } from '../nav';
import { appData, today } from '../state';
import { monthName, monthRange } from './usageText';
import { outOfYearNote, yearChangeNote } from './yearChange';

const MONTHS = Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0'));

function commitSettings(patch: Partial<Settings>, message?: string): void {
  const d: Data = appData();
  const settings = { ...d.settings, ...patch };
  const changed = (Object.keys(patch) as (keyof Settings)[]).some((k) => d.settings[k] !== settings[k]);
  if (changed) actions.commit({ ...d, settings }, message);
}

interface MonthYearFieldProps {
  label: string;
  value: YM;
  onChange: (ym: YM) => void;
}

/** One row: the label, then a month and a year select («Учёт с  Октябрь  2026»). */
function MonthYearField({ label, value, onChange }: MonthYearFieldProps) {
  const year = Number(value.slice(0, 4));
  const now = Number(today().slice(0, 4));
  const from = Math.min(year, now) - 3;
  const to = Math.max(year, now) + 3;
  const years = Array.from({ length: to - from + 1 }, (_, i) => String(from + i));
  return (
    <div class="field">
      <div class="field-row">
        <span class="field-label" aria-hidden="true">
          {label}
        </span>
        <select
          class="field-input field-select settings-month"
          aria-label={`${label}: месяц`}
          value={value.slice(5, 7)}
          onChange={(e) => onChange(`${value.slice(0, 4)}-${e.currentTarget.value}`)}
        >
          {MONTHS.map((m) => (
            <option key={m} value={m}>
              {monthName(`2000-${m}`)}
            </option>
          ))}
        </select>
        <select
          class="field-input field-select settings-year"
          aria-label={`${label}: год`}
          value={value.slice(0, 4)}
          onChange={(e) => onChange(`${e.currentTarget.value}-${value.slice(5, 7)}`)}
        >
          {years.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

export function SettingsPage(_props: RoutedPageProps) {
  const s = appData().settings;
  const [cushionEmpty, setCushionEmpty] = useState(false);
  const [dateEmpty, setDateEmpty] = useState(false);
  // a new «Учёт с» being chosen, not saved yet (none when it is the stored one)
  const [yearChoice, setYearChoice] = useState<YM | null>(null);
  const chosen = yearChoice !== null && yearChoice !== s.accountingStart ? yearChoice : null;
  const year = accountingMonths({ ...s, accountingStart: chosen ?? s.accountingStart });
  const forecast = forecastMonths(s);
  const outside = outOfYearNote(appData());

  const saveYear = () => {
    if (chosen === null) return;
    commitSettings({ accountingStart: chosen }, 'Учётный год изменён');
    setYearChoice(null);
  };

  const onCushion = (v: number | undefined, info: FieldInfo) => {
    if (info.invalid) return;
    setCushionEmpty(v === undefined);
    if (v !== undefined) commitSettings({ cushion: v });
  };

  const onDate = (v: ISODate | undefined, info: FieldInfo) => {
    if (info.invalid) return;
    setDateEmpty(v === undefined);
    if (v !== undefined) commitSettings({ balancesDate: v });
  };

  return (
    <Page title="Учёт и прогноз">
      {outside && <Banner tone="warning">{outside}</Banner>}
      <Section
        header="Учётный год"
        footer={`12 месяцев: ${monthRange(year[0] ?? s.accountingStart, year[11] ?? addMonths(s.accountingStart, 11))}. По ним строятся лента, отчёты и статистика года. Отметки ✓ в постоянных привязаны к месяцам учётного года: отметки других месяцев не учитываются.`}
      >
        <MonthYearField label="Учёт с" value={chosen ?? s.accountingStart} onChange={setYearChoice} />
      </Section>
      {chosen !== null && (
        <div class="settings-year-change">
          <Banner tone="warning">{yearChangeNote(appData(), chosen, today())}</Banner>
          <div class="sheet-actions">
            <Button full onClick={saveYear}>
              Сохранить
            </Button>
            <Button kind="plain" full onClick={() => setYearChoice(null)}>
              Отмена
            </Button>
          </div>
        </div>
      )}
      <Section
        header="Прогноз"
        footer={`Три месяца: ${monthRange(forecast[0] ?? s.forecastStart, forecast[2] ?? addMonths(s.forecastStart, 2))}, и 13 недель с понедельника перед началом. Подушка — сколько денег должно оставаться всегда: прогноз показывает запас над ней и недели, когда остаток ниже.`}
      >
        <MonthYearField label="Прогноз с" value={s.forecastStart} onChange={(ym) => commitSettings({ forecastStart: ym })} />
        <AmountField
          label="Подушка"
          value={s.cushion}
          error={cushionEmpty ? 'Введите сумму, 0 — без подушки' : undefined}
          onChange={onCushion}
        />
      </Section>
      <Section
        header="Остатки"
        footer="На эту дату записаны остатки на начало в «Счета и кредитка». Всё, что оплачено с этой даты, меняет остатки счетов (плановые записи — по месяцу учёта)."
      >
        <DateField
          label="Дата остатков"
          value={s.balancesDate}
          error={dateEmpty ? 'Укажите дату' : undefined}
          onChange={onDate}
        />
      </Section>
    </Page>
  );
}
