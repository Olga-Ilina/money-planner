// «+» of «Лента» (spec §5): an operation, a planned expense or income (journal), a recurring payment or
// a purchase. openSheet('add'); each row opens its form with openSheet(kind), which replaces this sheet
// (focus goes back to «+» when the form closes). An operation and a planned record are dated in the month
// shown in «Лента».
import { monthStart, ymOf } from '../../engine';
import type { ISODate } from '../../engine';
import { Button, Row, Section, Sheet } from '../kit';
import type { IconName } from '../kit';
import { feedMonth, today } from '../state';
import { openSheet } from './host';

export interface AddMenuProps {
  open: boolean;
  onClose: () => void;
}

interface Entry {
  kind: 'operation' | 'journal' | 'recurring' | 'purchase';
  title: string;
  subtitle: string;
  icon: IconName;
}

const ENTRIES: Entry[] = [
  { kind: 'operation', title: 'Операция', subtitle: 'Трата, доход или перевод — по факту', icon: 'wallet' },
  { kind: 'journal', title: 'Плановая запись', subtitle: 'Трата или доход на дату: план и факт', icon: 'calendar' },
  { kind: 'recurring', title: 'Постоянный платёж', subtitle: 'Каждый месяц или раз в несколько месяцев', icon: 'repeat' },
  { kind: 'purchase', title: 'Покупка', subtitle: 'Крупная покупка, на которую копите', icon: 'cart' },
];

/** Today when «Лента» shows the current month, else the 1st of the month it shows. */
export function dateInShownMonth(): ISODate {
  const now = today();
  return ymOf(now) === feedMonth.value ? now : monthStart(feedMonth.value);
}

function add(kind: Entry['kind']): void {
  if (kind === 'journal') openSheet('journal', { preset: { date: dateInShownMonth() } });
  else if (kind === 'operation') openSheet('operation', { preset: { date: dateInShownMonth() } });
  else openSheet(kind);
}

export function AddMenu({ open, onClose }: AddMenuProps) {
  return (
    <Sheet
      open={open}
      title="Добавить"
      onClose={onClose}
      left={
        <Button kind="plain" onClick={onClose}>
          Отмена
        </Button>
      }
    >
      <Section>
        {ENTRIES.map((e) => (
          <Row
            key={e.kind}
            icon={e.icon}
            title={e.title}
            subtitle={e.subtitle}
            chevron
            onClick={() => add(e.kind)}
          />
        ))}
      </Section>
    </Sheet>
  );
}
