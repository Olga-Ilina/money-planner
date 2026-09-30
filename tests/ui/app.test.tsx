// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { effect } from '@preact/signals';
import { IDBFactory } from 'fake-indexeddb';
import { emptyData } from '../../src/engine';
import * as db from '../../src/store/db';
import { setPin } from '../../src/store/pin';
import { actions } from '../../src/ui/actions';
import { App } from '../../src/ui/App';
import { Page, Sheet } from '../../src/ui/kit';
import { pushPage } from '../../src/ui/nav';
import { pages } from '../../src/ui/pages';
import { setRegistration, setUpdater, updateReady } from '../../src/ui/pwa';
import { LOCK_AFTER_MS, noteHidden, noteVisible } from '../../src/ui/session';
import { openSheet } from '../../src/ui/sheets/host';
import { data, locked, meta as appMeta, resetSession, tab } from '../../src/ui/state';

vi.mock('../../src/store/db', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../src/store/db')>();
  return { ...mod, loadData: vi.fn(mod.loadData) };
});

const PIN = '1234';

async function storeWithPin(): Promise<void> {
  await db.saveMeta(await setPin({ failedAttempts: 0 }, PIN));
  await db.saveData(emptyData('2026-09-30'));
}

function key(digit: string): HTMLButtonElement {
  return screen.getByRole('button', { name: digit }) as HTMLButtonElement;
}

function tabButton(name: string): HTMLElement {
  return within(screen.getByRole('navigation', { name: 'Разделы' })).getByRole('button', { name });
}

async function unlock(): Promise<void> {
  await screen.findByRole('heading', { name: 'Введите PIN' });
  for (const d of PIN) fireEvent.click(key(d));
  await screen.findByRole('navigation', { name: 'Разделы' });
}

beforeEach(() => {
  db.useFactory(new IDBFactory());
  resetSession();
  updateReady.value = false;
});

afterEach(async () => {
  cleanup();
  await actions.flush();
  resetSession();
  db.useFactory(undefined);
  vi.mocked(db.loadData).mockClear();
  vi.useRealTimers();
  setRegistration(null);
  setUpdater(null);
  document.documentElement.classList.remove('privacy-cover');
});

const DAMAGED_PIN = /Не удалось проверить PIN/;

describe('App start', () => {
  it('first run shows onboarding', async () => {
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Придумайте PIN' })).toBeTruthy();
    expect(screen.queryByRole('navigation', { name: 'Разделы' })).toBeNull();
  });

  it('with a PIN: the lock screen, and nothing of the app behind it', async () => {
    await storeWithPin();
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Введите PIN' })).toBeTruthy();
    expect(locked.value).toBe(true);
    expect(screen.queryByRole('navigation', { name: 'Разделы' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Сегодня' })).toBeNull();
  });

  it('unlocking opens «Сегодня» with five tabs', async () => {
    await storeWithPin();
    render(<App />);
    await unlock();
    expect(screen.getByRole('heading', { level: 1, name: 'Сегодня' })).toBeTruthy();
    const nav = screen.getByRole('navigation', { name: 'Разделы' });
    const labels = Array.from(nav.querySelectorAll('button')).map((b) => b.textContent);
    expect(labels).toEqual(['Сегодня', 'Лента', 'Счета', 'Отчёты', 'Ещё']);
  });

  it('tabs switch, keep their pages, and a second tap goes back to the root', async () => {
    await storeWithPin();
    render(<App />);
    await unlock();
    fireEvent.click(tabButton('Ещё'));
    expect(screen.getByRole('heading', { level: 1, name: 'Ещё' })).toBeTruthy();
    act(() => pushPage('more', 'settings'));
    expect(screen.getByRole('heading', { level: 1, name: 'Учёт и прогноз' })).toBeTruthy();
    fireEvent.click(tabButton('Лента'));
    expect(screen.getByRole('heading', { level: 1, name: 'Лента' })).toBeTruthy();
    expect(tabButton('Лента').getAttribute('aria-current')).toBe('page');
    fireEvent.click(tabButton('Ещё'));
    expect(screen.getByRole('heading', { level: 1, name: 'Учёт и прогноз' })).toBeTruthy();
    fireEvent.click(tabButton('Ещё'));
    expect(screen.getByRole('heading', { level: 1, name: 'Ещё' })).toBeTruthy();
  });

  it('a PIN without data: after unlocking, «С чего начнём?»', async () => {
    await db.saveMeta(await setPin({ failedAttempts: 0 }, PIN));
    render(<App />);
    await screen.findByRole('heading', { name: 'Введите PIN' });
    for (const d of PIN) fireEvent.click(key(d));
    expect(await screen.findByRole('heading', { name: 'С чего начнём?' })).toBeTruthy();
  });

  it('a storage error: full-screen message and «Попробовать снова»', async () => {
    await storeWithPin();
    vi.mocked(db.loadData).mockRejectedValueOnce(new db.StoreError('Сохранённые данные повреждены или имеют неизвестный формат.'));
    render(<App />);
    expect(await screen.findByText('Сохранённые данные повреждены или имеют неизвестный формат.')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Введите PIN' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Попробовать снова' }));
    expect(await screen.findByRole('heading', { name: 'Введите PIN' })).toBeTruthy();
  });

  it.each([
    ['a PIN hash that is not a string', { failedAttempts: 0, pinHash: 123, pinSalt: 'c2FsdA==' }],
    ['no meta at all', null],
    ['an empty PIN hash', { failedAttempts: 0, pinHash: '' }],
  ])('data without a valid PIN (%s) fails closed: no onboarding, no data, only the wipe', async (_label, stored) => {
    await db.saveData(emptyData('2026-09-30'));
    if (stored) await db.saveMeta(stored as unknown as db.Meta);
    render(<App />);
    expect(await screen.findByText(DAMAGED_PIN)).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Придумайте PIN' })).toBeNull();
    expect(screen.queryByRole('navigation', { name: 'Разделы' })).toBeNull();
    expect(data.value).toBeNull();
    expect(locked.value).toBe(false);
    // the only way on: delete everything (after typing the word), then start again
    fireEvent.click(screen.getByRole('button', { name: 'Удалить данные…' }));
    fireEvent.input(await screen.findByLabelText('Введите УДАЛИТЬ'), { target: { value: 'УДАЛИТЬ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Удалить все данные' }));
    expect(await screen.findByRole('heading', { name: 'Придумайте PIN' })).toBeTruthy();
    expect(await db.loadData()).toBeNull();
  });

  it('damaged PIN settings (meta-damaged): the damaged-PIN message and the wipe', async () => {
    await storeWithPin();
    vi.mocked(db.loadData).mockRejectedValueOnce(
      new db.StoreError('Сохранённые настройки PIN повреждены. Если не получается войти, используйте «Забыли PIN?».', { code: 'meta-damaged' }),
    );
    render(<App />);
    expect(await screen.findByText(DAMAGED_PIN)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Удалить данные…' })).toBeTruthy();
  });

  it.each([
    ['damaged data', 'damaged', 'Сохранённые данные повреждены или имеют неизвестный формат.'],
    ['a read error', 'read', 'Не удалось прочитать сохранённые данные.'],
  ] as const)('%s offers «Удалить данные…»', async (_label, code, message) => {
    await storeWithPin();
    vi.mocked(db.loadData).mockRejectedValueOnce(new db.StoreError(message, { code }));
    render(<App />);
    expect(await screen.findByText(message)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Удалить данные…' })).toBeTruthy();
  });

  it('storage that is unavailable offers only «Попробовать снова» (deleting cannot help)', async () => {
    vi.mocked(db.loadData).mockRejectedValueOnce(new db.StoreError('Хранилище на этом устройстве недоступно.', { code: 'unavailable' }));
    render(<App />);
    expect(await screen.findByText('Хранилище на этом устройстве недоступно.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Попробовать снова' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Удалить данные…' })).toBeNull();
  });

  describe('data saved by a newer app version', () => {
    const NEWER = 'Данные сохранены более новой версией приложения. Обновите приложение.';

    function registration(onUpdate: () => void) {
      const reg = { installing: null, waiting: null, update: vi.fn(async () => onUpdate()) };
      setRegistration(reg as unknown as ServiceWorkerRegistration);
      return reg;
    }

    it('asks to update, never offers to delete; the button finds and applies the new version', async () => {
      await storeWithPin();
      vi.mocked(db.loadData).mockRejectedValueOnce(new db.StoreError(NEWER, { code: 'newer-version' }));
      const update = vi.fn(async () => {});
      setUpdater(update);
      const reg = registration(() => {
        updateReady.value = true; // the service worker found a new version (onNeedRefresh)
      });
      render(<App />);
      expect(await screen.findByRole('heading', { name: 'Обновите приложение' })).toBeTruthy();
      expect(screen.getByText(NEWER)).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Удалить данные…' })).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: 'Обновить приложение' }));
      await waitFor(() => expect(update).toHaveBeenCalledWith(true));
      expect(reg.update).toHaveBeenCalledOnce();
    });

    it('no new version found: says so and keeps the data untouched', async () => {
      await storeWithPin();
      vi.mocked(db.loadData).mockRejectedValueOnce(new db.StoreError(NEWER, { code: 'newer-version' }));
      const update = vi.fn(async () => {});
      setUpdater(update);
      registration(() => {});
      render(<App />);
      fireEvent.click(await screen.findByRole('button', { name: 'Обновить приложение' }));
      expect(await screen.findByText(/Новая версия не найдена/)).toBeTruthy();
      expect(update).not.toHaveBeenCalled();
      expect(await db.loadData()).not.toBeNull();
    });
  });

  it('from the storage error screen the data can be deleted after typing «УДАЛИТЬ»', async () => {
    await storeWithPin();
    vi.mocked(db.loadData).mockRejectedValueOnce(new db.StoreError('Сохранённые данные повреждены или имеют неизвестный формат.'));
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Удалить данные…' }));
    const button = (await screen.findByRole('button', { name: 'Удалить все данные' })) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.input(screen.getByLabelText('Введите УДАЛИТЬ'), { target: { value: 'УДАЛИТЬ' } });
    fireEvent.click(button);
    expect(await screen.findByRole('heading', { name: 'Придумайте PIN' })).toBeTruthy();
    expect(await db.loadData()).toBeNull();
  });
});

describe('auto-lock', () => {
  it('locks after more than 5 minutes in the background, keeping the open page and sheet hidden and inert', async () => {
    await storeWithPin();
    render(<App />);
    await unlock();
    act(() => pushPage('today', 'credit'));
    act(() => openSheet('add'));
    const sheet = screen.getByRole('dialog', { name: 'Добавить' });
    act(() => {
      noteHidden(1_000_000);
      noteVisible(1_000_000 + LOCK_AFTER_MS + 1);
    });
    expect(locked.value).toBe(true);
    expect(await screen.findByRole('heading', { name: 'Введите PIN' })).toBeTruthy();
    // the app stays mounted but hidden, inert and out of the accessibility tree behind the lock
    const shell = document.querySelector('.shell') as HTMLElement;
    expect(shell.hidden).toBe(true);
    expect(shell.hasAttribute('inert') || (shell as HTMLElement & { inert?: boolean }).inert === true).toBe(true);
    expect(shell.getAttribute('aria-hidden')).toBe('true');
    // the open host sheet is inside that hidden subtree, not next to the lock screen
    expect(sheet.isConnected).toBe(true);
    expect(shell.contains(sheet)).toBe(true);
    expect(screen.queryByRole('dialog')).toBeNull();
    for (const d of PIN) fireEvent.click(key(d));
    await waitFor(() => expect(locked.value).toBe(false));
    expect(screen.getByRole('heading', { level: 1, name: 'Кредитка' })).toBeTruthy();
    expect(screen.getByRole('dialog', { name: 'Добавить' })).toBe(sheet);
  });

  it('after unlocking with a sheet open, focus is in the sheet: Tab stays inside, Esc closes it', async () => {
    await storeWithPin();
    render(<App />);
    await unlock();
    act(() => openSheet('add'));
    const sheet = screen.getByRole('dialog', { name: 'Добавить' });
    await waitFor(() => expect(sheet.contains(document.activeElement)).toBe(true));
    act(() => {
      noteHidden(1_000_000);
      noteVisible(1_000_000 + LOCK_AFTER_MS + 1);
    });
    await screen.findByRole('heading', { name: 'Введите PIN' });
    // the PIN is typed on the lock screen: focus is there (a browser also drops it from the hidden shell)
    key(PIN[0]!).focus();
    expect(sheet.contains(document.activeElement)).toBe(false);
    for (const d of PIN) fireEvent.click(key(d));
    await waitFor(() => expect(locked.value).toBe(false));
    await waitFor(() => expect(sheet.contains(document.activeElement)).toBe(true));
    // Tab from the last control wraps to the first, still inside
    const buttons = Array.from(sheet.querySelectorAll<HTMLElement>('button'));
    buttons[buttons.length - 1]!.focus();
    fireEvent.keyDown(document.activeElement!, { key: 'Tab' });
    expect(sheet.contains(document.activeElement)).toBe(true);
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Добавить' })).toBeNull());
  });

  it('a sheet opened from a Page right slot renders in the shell overlay root and is hidden with the shell', async () => {
    pages['sheet-in-bar'] = function SheetInBar() {
      return (
        <Page title="Проба" right={<Sheet open title="Из шапки" onClose={() => {}}><p>тело</p></Sheet>}>
          <p>страница</p>
        </Page>
      );
    };
    try {
      await storeWithPin();
      render(<App />);
      await unlock();
      act(() => pushPage('today', 'sheet-in-bar'));
      const dialog = screen.getByRole('dialog', { name: 'Из шапки' });
      const shell = document.querySelector('.shell') as HTMLElement;
      const overlay = shell.querySelector('.overlay-root') as HTMLElement;
      expect(overlay).not.toBeNull();
      expect(overlay.contains(dialog)).toBe(true);
      expect(dialog.closest('.page-bar')).toBeNull();
      act(() => {
        noteHidden(1_000_000);
        noteVisible(1_000_000 + LOCK_AFTER_MS + 1);
      });
      await screen.findByRole('heading', { name: 'Введите PIN' });
      expect(shell.hidden).toBe(true);
      expect(shell.getAttribute('aria-hidden')).toBe('true');
      expect(shell.contains(dialog)).toBe(true);
      expect(screen.queryByRole('dialog', { name: 'Из шапки' })).toBeNull();
    } finally {
      delete pages['sheet-in-bar'];
    }
  });

  it('does not lock after a short absence', async () => {
    await storeWithPin();
    render(<App />);
    await unlock();
    act(() => {
      noteHidden(1_000_000);
      noteVisible(1_000_000 + LOCK_AFTER_MS);
    });
    expect(locked.value).toBe(false);
  });

  it('locks when the clock went backwards while hidden', async () => {
    await storeWithPin();
    render(<App />);
    await unlock();
    act(() => {
      noteHidden(1_000_000);
      noteVisible(999_000);
    });
    expect(locked.value).toBe(true);
  });

  it('reacts to the page becoming hidden and visible', async () => {
    await storeWithPin();
    render(<App />);
    await unlock();
    vi.useFakeTimers({ toFake: ['Date'] });
    let state: DocumentVisibilityState = 'hidden';
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
    try {
      act(() => {
        document.dispatchEvent(new Event('visibilitychange'));
      });
      vi.setSystemTime(Date.now() + LOCK_AFTER_MS + 1_000);
      state = 'visible';
      act(() => {
        document.dispatchEvent(new Event('visibilitychange'));
      });
      expect(locked.value).toBe(true);
    } finally {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    }
  });

  it('covers the app while it is hidden and uncovers it only after deciding to lock', async () => {
    await storeWithPin();
    render(<App />);
    await unlock();
    const html = document.documentElement;
    const coveredWhenLocked: boolean[] = [];
    const stop = effect(() => {
      if (locked.value) coveredWhenLocked.push(html.classList.contains('privacy-cover'));
    });
    vi.useFakeTimers({ toFake: ['Date'] });
    let state: DocumentVisibilityState = 'hidden';
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
    try {
      act(() => {
        document.dispatchEvent(new Event('visibilitychange'));
      });
      expect(html.classList.contains('privacy-cover')).toBe(true);
      expect(locked.value).toBe(false); // hiding alone never locks (5 minutes, spec §7)
      vi.setSystemTime(Date.now() + LOCK_AFTER_MS + 1_000);
      state = 'visible';
      act(() => {
        document.dispatchEvent(new Event('visibilitychange'));
      });
      expect(locked.value).toBe(true);
      expect(coveredWhenLocked).toEqual([true]); // still covered at the moment it locked
      expect(html.classList.contains('privacy-cover')).toBe(false);
    } finally {
      stop();
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    }
  });

  it('pagehide covers, pageshow from the back/forward cache uncovers; a short absence does not lock', async () => {
    await storeWithPin();
    render(<App />);
    await unlock();
    const html = document.documentElement;
    act(() => {
      window.dispatchEvent(new Event('pagehide'));
    });
    expect(html.classList.contains('privacy-cover')).toBe(true);
    act(() => {
      window.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: true }));
    });
    expect(html.classList.contains('privacy-cover')).toBe(false);
    expect(locked.value).toBe(false);
  });

  it('never locks without a PIN', () => {
    appMeta.value = { failedAttempts: 0 };
    data.value = emptyData('2026-09-30');
    noteHidden(0);
    noteVisible(LOCK_AFTER_MS * 10);
    expect(locked.value).toBe(false);
  });
});

describe('app update', () => {
  it('offers the new version in a banner; «Обновить» applies it', async () => {
    const update = vi.fn(async () => {});
    setUpdater(update);
    render(<App />);
    await screen.findByRole('heading', { name: 'Придумайте PIN' });
    act(() => {
      updateReady.value = true;
    });
    expect(screen.getByText('Доступна новая версия')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Обновить' }));
    await waitFor(() => expect(update).toHaveBeenCalledWith(true));
  });
});

describe('tab state', () => {
  it('starts on «Сегодня»', async () => {
    tab.value = 'reports';
    resetSession();
    expect(tab.value).toBe('today');
  });
});

describe('scroll positions', () => {
  function scrollTo(y: number): void {
    window.scrollTo(0, y);
    window.dispatchEvent(new Event('scroll'));
  }

  it('each tab and page keeps its own; a new page starts at the top; the lock does not lose it', async () => {
    await storeWithPin();
    render(<App />);
    await unlock();
    scrollTo(400);
    fireEvent.click(tabButton('Лента'));
    expect(window.scrollY).toBe(0);
    scrollTo(120);
    fireEvent.click(tabButton('Сегодня'));
    expect(window.scrollY).toBe(400);
    fireEvent.click(tabButton('Лента'));
    expect(window.scrollY).toBe(120);
    fireEvent.click(tabButton('Сегодня'));

    act(() => pushPage('today', 'credit'));
    expect(window.scrollY).toBe(0);
    scrollTo(50);
    fireEvent.click(screen.getByRole('button', { name: /Сегодня/, current: false }));
    expect(screen.getByRole('heading', { level: 1, name: 'Сегодня' })).toBeTruthy();
    expect(window.scrollY).toBe(400);
    act(() => pushPage('today', 'credit'));
    expect(window.scrollY).toBe(0);

    scrollTo(70);
    act(() => {
      noteHidden(1_000_000);
      noteVisible(1_000_000 + LOCK_AFTER_MS + 1);
    });
    // the hidden app collapses the page: the browser clamps the scroll, which must not be remembered
    scrollTo(0);
    await screen.findByRole('heading', { name: 'Введите PIN' });
    for (const d of PIN) fireEvent.click(key(d));
    await waitFor(() => expect(locked.value).toBe(false));
    expect(window.scrollY).toBe(70);
  });
});
