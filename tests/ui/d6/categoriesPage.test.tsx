// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { IDBFactory } from 'fake-indexeddb';
import { loadData, useFactory } from '../../../src/store/db';
import { actions } from '../../../src/ui/actions';
import { Toast } from '../../../src/ui/kit';
import { CategoriesPage } from '../../../src/ui/pages/CategoriesPage';
import { categoryUsage } from '../../../src/ui/pages/categoriesEdit';
import { SheetHost } from '../../../src/ui/sheets/host';
import { data, resetSession } from '../../../src/ui/state';
import { scenario } from '../../engine/scenario';

function renderPage() {
  return render(
    <>
      <CategoriesPage params={{}} />
      <SheetHost />
      <Toast />
    </>,
  );
}

const input = (name: string) => screen.getByLabelText(name) as HTMLInputElement;
const type = (el: HTMLInputElement, text: string) => fireEvent.input(el, { target: { value: text } });
const expenseNames = () => data.value!.categories.expense.map((c) => c.name);

/** Chooses the option with text `label` of a select. */
function choose(select: HTMLSelectElement, label: string) {
  const option = Array.from(select.options).find((o) => o.textContent === label);
  if (!option) throw new Error(`no option ${label}`);
  fireEvent.change(select, { target: { value: option.value } });
}

function startEditing() {
  fireEvent.click(screen.getByRole('button', { name: 'Изменить' }));
}

async function openCategory(name: string) {
  startEditing();
  fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${name}`) }));
  return screen.findByRole('dialog', { name: 'Категория' });
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

describe('«Категории и лимиты» — limits inline', () => {
  it('shows every expense category with its limit field and the income categories', () => {
    data.value = { ...scenario(), categories: { ...scenario().categories, expense: [{ name: 'Жильё', limit: 900 }, { name: 'Продукты' }] } };
    renderPage();
    expect(screen.getByRole('heading', { level: 1, name: 'Категории и лимиты' })).toBeTruthy();
    expect(input('Жильё').value).toBe('900');
    expect(input('Продукты').value).toBe('');
    expect(screen.getByText('Зарплата')).toBeTruthy();
    expect(screen.getByText('Премия')).toBeTruthy();
  });

  it('typing a limit saves it; clearing removes it; letters never delete it', async () => {
    renderPage();
    type(input('Продукты'), '300');
    await actions.flush();
    expect(data.value!.categories.expense[1]).toEqual({ name: 'Продукты', limit: 300 });
    expect((await loadData())?.categories.expense[1]).toEqual({ name: 'Продукты', limit: 300 });
    type(input('Продукты'), '300р');
    fireEvent.blur(input('Продукты'));
    expect(data.value!.categories.expense[1]).toEqual({ name: 'Продукты', limit: 300 });
    expect(screen.getByText('Проверьте сумму')).toBeTruthy();
    type(input('Продукты'), '');
    await actions.flush();
    expect(data.value!.categories.expense[1]).toEqual({ name: 'Продукты' });
  });
});

describe('«Категории и лимиты» — limits inline, more', () => {
  it('a limit of 0 is a limit, not «Без лимита»', async () => {
    renderPage();
    type(input('Продукты'), '0');
    await actions.flush();
    expect(data.value!.categories.expense[1]).toEqual({ name: 'Продукты', limit: 0 });
    expect(input('Продукты').value).toBe('0');
  });
});

describe('«Категории и лимиты» — editing the lists', () => {
  it('in edit mode both lists say how to edit them', () => {
    renderPage();
    startEditing();
    const hints = screen.getAllByText('Нажмите на категорию, чтобы переименовать или удалить её; стрелки меняют порядок.');
    expect(hints).toHaveLength(2);
  });

  it('a change of letter case only is a rename: rows follow', async () => {
    renderPage();
    const sheet = await openCategory('Продукты');
    type(within(sheet).getByLabelText('Название') as HTMLInputElement, 'продукты');
    fireEvent.click(within(sheet).getByRole('button', { name: 'Сохранить' }));
    await actions.flush();
    expect(expenseNames()).toEqual(['Жильё', 'продукты', 'Транспорт', 'Подписки', 'Техника']);
    expect(categoryUsage(data.value!, 'expense', 'продукты').total).toBe(7);
    expect(JSON.stringify(data.value)).not.toContain('"Продукты"');
  });

  it('a new name and a new limit are one change (one undo)', async () => {
    const start = data.value;
    renderPage();
    const sheet = await openCategory('Продукты');
    type(within(sheet).getByLabelText('Название') as HTMLInputElement, 'Еда');
    type(within(sheet).getByLabelText('Лимит в месяц') as HTMLInputElement, '300');
    fireEvent.click(within(sheet).getByRole('button', { name: 'Сохранить' }));
    await actions.flush();
    expect(data.value!.categories.expense[1]).toEqual({ name: 'Еда', limit: 300 });
    expect(categoryUsage(data.value!, 'expense', 'Еда').total).toBe(7);
    expect(await loadData()).toEqual(data.value);
    fireEvent.click(screen.getByRole('button', { name: 'Отменить' }));
    expect(data.value).toBe(start);
  });

  it('two categories with the same name (an imported tracker) both show, each with its limit', async () => {
    const d = scenario();
    d.categories.expense = [{ name: 'Кафе' }, { name: 'Кафе', limit: 5 }, { name: 'Жильё' }];
    data.value = d;
    renderPage();
    expect(screen.getAllByLabelText('Кафе').map((el) => (el as HTMLInputElement).value)).toEqual(['', '5']);
    startEditing();
    fireEvent.click(screen.getAllByRole('button', { name: 'Ниже: Кафе' })[1]!);
    await actions.flush();
    expect(data.value!.categories.expense).toEqual([{ name: 'Кафе' }, { name: 'Жильё' }, { name: 'Кафе', limit: 5 }]);
    expect(screen.getAllByRole('button', { name: /^Кафе/ }).map((b) => b.textContent)).toEqual([
      expect.stringContaining('Без лимита'),
      expect.stringContaining('Лимит'),
    ]);
  });

  it('«Изменить» shows reorder buttons; «Ниже» moves a category down', async () => {
    renderPage();
    startEditing();
    expect(screen.getByRole('button', { name: 'Готово' })).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Выше: Жильё' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Ниже: Жильё' }));
    await actions.flush();
    expect(expenseNames()).toEqual(['Продукты', 'Жильё', 'Транспорт', 'Подписки', 'Техника']);
    fireEvent.click(screen.getByRole('button', { name: 'Выше: Премия' }));
    expect(data.value!.categories.income.map((c) => c.name)).toEqual(['Премия', 'Зарплата']);
    expect((await loadData())?.categories.income.map((c) => c.name)).toEqual(['Премия', 'Зарплата']);
  });

  it('renaming updates every row that used the old name in one change (one undo)', async () => {
    const start = scenario();
    // saved by the operation form with «Что» left empty: named after its category
    start.operations.push({ id: 'o-auto', date: '2026-10-15', kind: 'expense', category: 'Продукты', what: 'Продукты', amount: 12, account: 'acc-card' });
    data.value = start;
    renderPage();
    const sheet = await openCategory('Продукты');
    type(within(sheet).getByLabelText('Название') as HTMLInputElement, 'Еда');
    fireEvent.click(within(sheet).getByRole('button', { name: 'Сохранить' }));
    await actions.flush();
    const d = data.value!;
    expect(expenseNames()).toEqual(['Жильё', 'Еда', 'Транспорт', 'Подписки', 'Техника']);
    expect(categoryUsage(d, 'expense', 'Еда').total).toBe(8);
    expect(d.operations.find((o) => o.id === 'o-auto')).toMatchObject({ category: 'Еда', what: 'Еда' });
    expect(JSON.stringify(d)).not.toContain('"Продукты"');
    expect(await loadData()).toEqual(d);
    expect(screen.getByText('Сохранено')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Отменить' }));
    await actions.flush();
    expect(data.value).toBe(start);
  });

  it('after a rename, focus stays on the renamed row (not lost to the page)', async () => {
    renderPage();
    startEditing();
    const row = screen.getByRole('button', { name: /^Продукты/ });
    row.focus();
    fireEvent.click(row);
    const sheet = await screen.findByRole('dialog', { name: 'Категория' });
    await waitFor(() => expect(sheet.contains(document.activeElement)).toBe(true));
    type(within(sheet).getByLabelText('Название') as HTMLInputElement, 'Еда');
    fireEvent.click(within(sheet).getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: /^Еда/ })));
  });

  it('a name already in the list, or in the other list, is refused next to the field', async () => {
    renderPage();
    const sheet = await openCategory('Продукты');
    type(within(sheet).getByLabelText('Название') as HTMLInputElement, 'жильё');
    fireEvent.click(within(sheet).getByRole('button', { name: 'Сохранить' }));
    expect(within(sheet).getByText('Такая категория уже есть')).toBeTruthy();
    type(within(sheet).getByLabelText('Название') as HTMLInputElement, 'Зарплата');
    fireEvent.click(within(sheet).getByRole('button', { name: 'Сохранить' }));
    expect(within(sheet).getByText('Такая категория уже есть среди доходов')).toBeTruthy();
    type(within(sheet).getByLabelText('Название') as HTMLInputElement, '');
    fireEvent.click(within(sheet).getByRole('button', { name: 'Сохранить' }));
    expect(within(sheet).getByText('Введите название')).toBeTruthy();
    await actions.flush();
    expect(data.value).toEqual(scenario());
  });

  it('the sheet also sets the limit of an expense category', async () => {
    renderPage();
    const sheet = await openCategory('Транспорт');
    type(within(sheet).getByLabelText('Лимит в месяц') as HTMLInputElement, '120,50');
    fireEvent.click(within(sheet).getByRole('button', { name: 'Сохранить' }));
    await actions.flush();
    expect(data.value!.categories.expense[2]).toEqual({ name: 'Транспорт', limit: 120.5 });
  });

  it('adds an expense category with a limit, and an income category', async () => {
    renderPage();
    fireEvent.click(screen.getAllByRole('button', { name: 'Добавить категорию' })[0]!);
    let sheet = await screen.findByRole('dialog', { name: 'Новая категория' });
    type(within(sheet).getByLabelText('Название') as HTMLInputElement, ' Одежда ');
    type(within(sheet).getByLabelText('Лимит в месяц') as HTMLInputElement, '50');
    fireEvent.click(within(sheet).getByRole('button', { name: 'Сохранить' }));
    await actions.flush();
    expect(data.value!.categories.expense.at(-1)).toEqual({ name: 'Одежда', limit: 50 });

    fireEvent.click(screen.getAllByRole('button', { name: 'Добавить категорию' })[1]!);
    sheet = await screen.findByRole('dialog', { name: 'Новая категория' });
    expect(within(sheet).queryByLabelText('Лимит в месяц')).toBeNull();
    type(within(sheet).getByLabelText('Название') as HTMLInputElement, 'Фриланс');
    fireEvent.click(within(sheet).getByRole('button', { name: 'Сохранить' }));
    await actions.flush();
    expect(data.value!.categories.income.at(-1)).toEqual({ name: 'Фриланс' });
  });

  it('an unused category is deleted after a confirm, with undo', async () => {
    data.value = { ...scenario(), categories: { ...scenario().categories, expense: [...scenario().categories.expense, { name: 'Кино' }] } };
    const before = data.value;
    renderPage();
    const sheet = await openCategory('Кино');
    fireEvent.click(within(sheet).getByRole('button', { name: 'Удалить категорию' }));
    const confirm = await screen.findByRole('alertdialog', { name: 'Удалить категорию «Кино»?' });
    fireEvent.click(within(confirm).getByRole('button', { name: 'Удалить' }));
    await actions.flush();
    expect(expenseNames()).not.toContain('Кино');
    expect(screen.getByText('Категория удалена')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Отменить' }));
    expect(data.value).toBe(before);
  });

  it('a used category is deleted only by moving its rows to a chosen category', async () => {
    renderPage();
    const sheet = await openCategory('Продукты');
    fireEvent.click(within(sheet).getByRole('button', { name: 'Удалить категорию' }));
    expect(
      within(sheet).getByText(
        'В категории «Продукты»: 2 операции, 5 плановых записей. Выберите, куда их перенести: категория удалится, а записи останутся.',
      ),
    ).toBeTruthy();
    const move = within(sheet).getByRole('button', { name: 'Перенести и удалить' }) as HTMLButtonElement;
    expect(move.disabled).toBe(true); // nothing chosen yet
    const select = within(sheet).getByLabelText('Перенести в') as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual([
      'Выберите', 'Жильё', 'Транспорт', 'Подписки', 'Техника', 'Без категории',
    ]);
    choose(select, 'Жильё');
    fireEvent.click(move);
    await actions.flush();
    const d = data.value!;
    expect(expenseNames()).toEqual(['Жильё', 'Транспорт', 'Подписки', 'Техника']);
    expect(categoryUsage(d, 'expense', 'Жильё').total).toBe(9);
    expect(JSON.stringify(d)).not.toContain('"Продукты"');
    expect(await loadData()).toEqual(d);
    expect(screen.getByText('Категория удалена')).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Отменить' }));
    expect(data.value).toEqual(scenario());
  });

  it('the delete view takes the focus, «Не удалять» gives it back to «Удалить категорию», Esc still closes', async () => {
    renderPage();
    const sheet = await openCategory('Продукты');
    const deleteButton = () => within(sheet).getByRole('button', { name: 'Удалить категорию' });
    deleteButton().focus();
    fireEvent.click(deleteButton());
    const note = within(sheet).getByText(/^В категории «Продукты»:/);
    await waitFor(() => expect(document.activeElement).toBe(note));
    fireEvent.click(within(sheet).getByRole('button', { name: 'Не удалять' }));
    await waitFor(() => expect(document.activeElement).toBe(deleteButton()));

    fireEvent.click(deleteButton());
    await waitFor(() => expect(document.activeElement?.textContent).toMatch(/^В категории «Продукты»:/));
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await actions.flush();
    expect(data.value).toEqual(scenario());
  });

  it('«Без категории» clears the category of the moved rows', async () => {
    renderPage();
    const sheet = await openCategory('Техника');
    fireEvent.click(within(sheet).getByRole('button', { name: 'Удалить категорию' }));
    expect(within(sheet).getByText(/^В категории «Техника»: 1 покупка\. /)).toBeTruthy();
    choose(within(sheet).getByLabelText('Перенести в') as HTMLSelectElement, 'Без категории');
    fireEvent.click(within(sheet).getByRole('button', { name: 'Перенести и удалить' }));
    await actions.flush();
    expect(data.value!.purchases[0]).not.toHaveProperty('category');
    expect(expenseNames()).not.toContain('Техника');
  });
});
