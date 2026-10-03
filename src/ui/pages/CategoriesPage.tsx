// Page «Категории и лимиты» (registered as 'categories' in src/ui/pages.ts); owner: D6.
// Normal view: every expense category is a limit field (typing saves it). «Изменить» shows reorder
// buttons; tapping a category then opens its sheet: rename (every row that uses the old name follows in
// the same commit), the limit, and «Удалить категорию» — only when nothing uses it, or by moving those
// rows to another category (or «Без категории») in the same commit. Changes of the lists can be undone.
// «Лимиты по месяцам» (normal view): a row per expense category opens its sheet — «Обычный лимит» and a field for
// each of the 12 accounting months; an empty month has the usual limit (spec 2026-10-03-month-limits). Limits of
// months outside the accounting year are one line under the months, with «Очистить» (one change, one undo).
import { useEffect, useRef, useState } from 'preact/hooks';
import { accountingMonths, monthLabel } from '../../engine';
import type { ExpenseCategory, YM } from '../../engine';
import { actions } from '../actions';
import { formatMoney } from '../format';
import {
  AmountField, Button, Confirm, Icon, Page, Row, Section, SelectField, Sheet, TextField, useFieldValidity,
} from '../kit';
import type { RoutedPageProps } from '../nav';
import { appData } from '../state';
import {
  addCategory, categoryNameError, categoryUsage, clearOutOfYearMonthLimits, moveCategory, outOfYearMonths, removeCategory,
  renameCategory, setLimit, setMonthLimit, usageText,
} from './categoriesEdit';
import type { CategoryKind } from './categoriesEdit';

/** The sheet's subject: a category of list `kind`, or a new one when `name` is undefined. */
interface Editing {
  kind: CategoryKind;
  name?: string;
}

const SECTION_TITLE: Record<CategoryKind, string> = { expense: 'Расходы', income: 'Доходы' };

function limitOf(kind: CategoryKind, name: string | undefined): number | undefined {
  if (kind !== 'expense' || name === undefined) return undefined;
  return appData().categories.expense.find((c) => c.name === name)?.limit;
}

/** «Свой лимит: ноябрь, декабрь» — the accounting months with their own limit — or «Все месяцы — обычный лимит». */
function monthsSummary(c: ExpenseCategory, months: YM[]): string {
  const own = months.filter((ym) => c.monthLimits?.[ym] !== undefined);
  if (own.length === 0) return 'Все месяцы — обычный лимит';
  return `Свой лимит: ${own.map((ym) => monthLabel(ym).split(' ')[0]?.toLowerCase()).join(', ')}`;
}

export function CategoriesPage(_props: RoutedPageProps) {
  const d = appData();
  const [editMode, setEditMode] = useState(false);
  const [editing, setEditing] = useState<Editing | null>(null);
  // a fresh sheet (and form state) for every opening; the closing one keeps its state while it slides away
  const [opened, setOpened] = useState(0);
  const [monthsOf, setMonthsOf] = useState<string | null>(null);
  const [monthsOpened, setMonthsOpened] = useState(0);

  const open = (e: Editing) => {
    setEditing(e);
    setOpened((n) => n + 1);
  };

  const openMonths = (name: string) => {
    setMonthsOf(name);
    setMonthsOpened((n) => n + 1);
  };
  const months = accountingMonths(d.settings);

  const commitLimit = (name: string, limit: number | undefined) => {
    if (limitOf('expense', name) === limit) return;
    actions.commit(setLimit(appData(), name, limit));
  };

  const move = (kind: CategoryKind, index: number, delta: -1 | 1) => {
    const next = moveCategory(appData(), kind, index, delta);
    if (next !== appData()) actions.commit(next);
  };

  const list = (kind: CategoryKind) => {
    const items: { name: string; limit?: number }[] = d.categories[kind];
    return items.map((c, i) => {
      // index and name: an imported tracker may repeat a name; each row shows its own limit
      const key = `${i}:${c.name}`;
      const limit = kind === 'expense' ? c.limit : undefined;
      if (editMode) {
        const subtitle =
          kind === 'expense' ? (limit === undefined ? 'Без лимита' : `Лимит ${formatMoney(limit)}`) : undefined;
        return (
          <Row
            key={key}
            // the place in the list: a renamed row (a new key) gets the focus back from its sheet
            focusKey={`category-${kind}-${i}`}
            title={c.name}
            subtitle={subtitle}
            onClick={() => open({ kind, name: c.name })}
            trailing={
              <>
                <button
                  type="button"
                  class="icon-button"
                  aria-label={`Выше: ${c.name}`}
                  disabled={i === 0}
                  onClick={() => move(kind, i, -1)}
                >
                  <Icon name="chevron-up" size={20} />
                </button>
                <button
                  type="button"
                  class="icon-button"
                  aria-label={`Ниже: ${c.name}`}
                  disabled={i === items.length - 1}
                  onClick={() => move(kind, i, 1)}
                >
                  <Icon name="chevron-down" size={20} />
                </button>
              </>
            }
          />
        );
      }
      if (kind === 'income') return <Row key={key} title={c.name} />;
      return (
        <AmountField
          key={key}
          label={c.name}
          value={limit}
          placeholder="Без лимита"
          onChange={(v, info) => {
            if (!info.invalid) commitLimit(c.name, v);
          }}
        />
      );
    });
  };

  const footer = (kind: CategoryKind): string | undefined => {
    if (editMode) return 'Нажмите на категорию, чтобы переименовать или удалить её; стрелки меняют порядок.';
    return kind === 'expense' ? 'Лимит — сколько можно потратить за месяц. Пустое поле — без лимита.' : undefined;
  };

  return (
    <Page
      title="Категории и лимиты"
      right={
        <Button kind="plain" onClick={() => setEditMode(!editMode)}>
          {editMode ? 'Готово' : 'Изменить'}
        </Button>
      }
    >
      {(['expense', 'income'] as const).map((kind) => (
        <>
          <Section key={kind} header={SECTION_TITLE[kind]} footer={footer(kind)}>
            {list(kind)}
            <Row icon="plus" title="Добавить категорию" onClick={() => open({ kind })} />
          </Section>
          {kind === 'expense' && !editMode && d.categories.expense.length > 0 && (
            <Section
              key="months"
              header="Лимиты по месяцам"
              footer="Свой лимит на любой месяц учёта. Пустой месяц — обычный лимит."
            >
              {d.categories.expense.map((c, i) => (
                <Row
                  key={`${i}:${c.name}`}
                  focusKey={`months-${i}`}
                  title={c.name}
                  subtitle={monthsSummary(c, months)}
                  chevron
                  onClick={() => openMonths(c.name)}
                />
              ))}
            </Section>
          )}
        </>
      ))}
      <CategorySheet key={opened} editing={editing} onClose={() => setEditing(null)} />
      <MonthLimitsSheet key={`m${monthsOpened}`} name={monthsOf} onClose={() => setMonthsOf(null)} />
    </Page>
  );
}

interface CategorySheetProps {
  editing: Editing | null;
  onClose: () => void;
}

const NO_CATEGORY = 'none';

function CategorySheet({ editing, onClose }: CategorySheetProps) {
  const d = appData();
  // what this sheet was opened for; kept while it (and its confirm) slide away after `editing` is cleared
  const [subject] = useState(editing);
  const kind = subject?.kind ?? 'expense';
  const current = subject?.name;
  const [name, setName] = useState<string | undefined>(current);
  const [limit, setLimitValue] = useState<number | undefined>(() => limitOf(kind, current));
  const [tried, setTried] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [target, setTarget] = useState<string | undefined>();
  const [confirm, setConfirm] = useState(false);
  const v = useFieldValidity();
  const note = useRef<HTMLParagraphElement>(null);
  const deleteActions = useRef<HTMLDivElement>(null);
  const wasDeleting = useRef(false);

  // the views swap in place: focus follows (the explanation is read first), and goes back to
  // «Удалить категорию» on «Не удалять» — never left on a removed button, where Esc would not reach the sheet
  useEffect(() => {
    if (deleting) note.current?.focus();
    else if (wasDeleting.current) deleteActions.current?.querySelector('button')?.focus();
    wasDeleting.current = deleting;
  }, [deleting]);

  const nameError = tried ? categoryNameError(d, kind, name, current) : undefined;
  const others = d.categories[kind].filter((c) => c.name !== current);
  const usage = current !== undefined ? categoryUsage(d, kind, current) : undefined;

  const save = () => {
    setTried(true);
    const latest = appData();
    if (v.anyInvalid || name === undefined || categoryNameError(latest, kind, name, current) !== undefined) return;
    const clean = name.trim();
    if (current === undefined) {
      actions.commit(addCategory(latest, kind, clean, kind === 'expense' ? limit : undefined), 'Сохранено');
    } else if (clean !== current || limit !== limitOf(kind, current)) {
      let next = renameCategory(latest, kind, current, clean);
      if (kind === 'expense') next = setLimit(next, clean, limit);
      actions.commit(next, 'Сохранено');
    }
    onClose();
  };

  const askDelete = () => {
    if (current === undefined) return;
    if (categoryUsage(appData(), kind, current).total === 0) setConfirm(true);
    else setDeleting(true);
  };

  const deleteUnused = () => {
    setConfirm(false);
    if (current === undefined) return;
    actions.commit(removeCategory(appData(), kind, current), 'Категория удалена');
    onClose();
  };

  const moveAndDelete = () => {
    if (current === undefined || target === undefined) return;
    const to = target === NO_CATEGORY ? null : others[Number(target)]?.name;
    if (to === undefined) return;
    actions.commit(removeCategory(appData(), kind, current, to), 'Категория удалена');
    onClose();
  };

  const moveOptions = [
    ...others.map((c, i) => ({ value: String(i), label: c.name })),
    { value: NO_CATEGORY, label: 'Без категории' },
  ];

  return (
    <>
      <Sheet
        open={editing !== null}
        title={current === undefined ? 'Новая категория' : 'Категория'}
        onClose={onClose}
        left={
          <Button kind="plain" onClick={onClose}>
            Отмена
          </Button>
        }
        right={
          deleting ? undefined : (
            <Button kind="plain" onClick={save} disabled={v.anyInvalid}>
              Сохранить
            </Button>
          )
        }
      >
        {deleting && usage ? (
          <>
            <p class="sheet-text" ref={note} tabIndex={-1}>
              {`В категории «${current}»: ${usageText(usage)}. Выберите, куда их перенести: категория удалится, а записи останутся.`}
            </p>
            <Section>
              <SelectField
                label="Перенести в"
                placeholder="Выберите"
                value={target}
                options={moveOptions}
                onChange={setTarget}
              />
            </Section>
            <div class="sheet-actions">
              <Button kind="destructive" full disabled={target === undefined} onClick={moveAndDelete}>
                Перенести и удалить
              </Button>
              <Button kind="plain" full onClick={() => setDeleting(false)}>
                Не удалять
              </Button>
            </div>
          </>
        ) : (
          <>
            <Section>
              <TextField label="Название" value={name} onChange={setName} error={nameError} maxLength={60} />
              {kind === 'expense' && (
                <AmountField
                  label="Обычный лимит"
                  value={limit}
                  placeholder="Без лимита"
                  onChange={v.field('limit', setLimitValue)}
                />
              )}
            </Section>
            {current !== undefined && (
              <div class="sheet-actions" ref={deleteActions}>
                <Button kind="destructive" full onClick={askDelete}>
                  Удалить категорию
                </Button>
              </div>
            )}
          </>
        )}
      </Sheet>
      <Confirm
        open={confirm}
        title={`Удалить категорию «${current ?? ''}»?`}
        confirmLabel="Удалить"
        onConfirm={deleteUnused}
        onCancel={() => setConfirm(false)}
      />
    </>
  );
}

/**
 * The limits of expense category `name`: «Обычный лимит» and the 12 accounting months (empty: the usual limit). One
 * commit on «Сохранить»; months outside the accounting year keep their values unless «Очистить» (its own commit) removes
 * them — it touches nothing else, so what is typed in the sheet stays.
 */
function MonthLimitsSheet({ name, onClose }: { name: string | null; onClose: () => void }) {
  // what this sheet was opened for; kept while it slides away after `name` is cleared
  const [subject] = useState(name);
  const d = appData();
  const months = accountingMonths(d.settings);
  const category = d.categories.expense.find((c) => c.name === subject);
  const [limit, setLimitValue] = useState<number | undefined>(category?.limit);
  const [own, setOwn] = useState<Partial<Record<YM, number>>>(() => ({ ...category?.monthLimits }));
  const v = useFieldValidity();
  const usual = limit === undefined ? 'Обычный (без лимита)' : `Обычный (${formatMoney(limit)})`;
  const outside = category === undefined ? 0 : outOfYearMonths(category, d.settings).length;

  const clearOutside = () => {
    if (subject === null) return;
    const latest = appData();
    const next = clearOutOfYearMonthLimits(latest, subject);
    if (next !== latest) actions.commit(next, 'Лимиты вне учётного года очищены');
  };

  const save = () => {
    if (v.anyInvalid || subject === null) return;
    const latest = appData();
    const saved = latest.categories.expense.find((c) => c.name === subject);
    if (saved === undefined) return onClose();
    let next = saved.limit === limit ? latest : setLimit(latest, subject, limit);
    for (const ym of months) {
      if (saved.monthLimits?.[ym] !== own[ym]) next = setMonthLimit(next, subject, ym, own[ym]);
    }
    if (next !== latest) actions.commit(next, 'Сохранено');
    onClose();
  };

  return (
    <Sheet
      open={name !== null}
      title={subject ?? ''}
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
        <AmountField label="Обычный лимит" value={limit} placeholder="Без лимита" onChange={v.field('limit', setLimitValue)} />
      </Section>
      <Section header="По месяцам" footer="Пустой месяц — обычный лимит.">
        {months.map((ym) => (
          <AmountField
            key={ym}
            label={monthLabel(ym)}
            value={own[ym]}
            placeholder={usual}
            onChange={v.field(`m${ym}`, (n: number | undefined) => setOwn((o) => ({ ...o, [ym]: n })))}
          />
        ))}
        {outside > 0 && (
          <Row
            title={`Ещё лимиты вне учётного года: ${outside}`}
            trailing={
              <Button kind="plain" onClick={clearOutside}>
                Очистить
              </Button>
            }
          />
        )}
      </Section>
    </Sheet>
  );
}
