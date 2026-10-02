// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/preact';
import { version } from '../../../package.json';
import { currentPage, popPage } from '../../../src/ui/nav';
import { Icon } from '../../../src/ui/kit';
import { AboutPage } from '../../../src/ui/pages/AboutPage';
import { TabContent } from '../../../src/ui/TabContent';
import { data, meta, resetSession } from '../../../src/ui/state';
import { scenario } from '../../engine/scenario';

beforeEach(() => {
  resetSession();
  data.value = scenario();
});

afterEach(() => {
  cleanup();
  resetSession();
});

describe('«Ещё»', () => {
  it('groups the plans, the settings, the data and «О приложении»', () => {
    render(<TabContent tab="more" />);
    expect(screen.getByRole('heading', { level: 1, name: 'Ещё' })).toBeTruthy();
    const sections = Array.from(document.querySelectorAll('.section'));
    const headers = sections.map((s) => s.querySelector('.section-header')?.textContent ?? '');
    expect(headers).toEqual(['Планы', 'Настройки', 'Данные', '']);
    const titles = sections.map((s) => Array.from(s.querySelectorAll('.row-title')).map((t) => t.textContent));
    expect(titles).toEqual([
      ['Постоянные платежи', 'Покупки', 'Долги'],
      ['Категории и лимиты', 'Счета и кредитка', 'Учёт и прогноз', 'PIN-код'],
      ['Синхронизация', 'Загрузить трекер', 'Резервная копия'],
      ['О приложении'],
    ]);
  });

  it('«Загрузить трекер» has the import glyph (upload), not the export one (download)', () => {
    const glyph = (name: 'upload' | 'download') => render(<Icon name={name} />).container.querySelector('svg')?.innerHTML;
    const [upload, download] = [glyph('upload'), glyph('download')];
    render(<TabContent tab="more" />);
    const row = screen.getByRole('button', { name: /^Загрузить трекер/ });
    expect(row.querySelector('.row-icon svg')?.innerHTML).toBe(upload);
    expect(upload).not.toBe(download);
  });

  it('each row opens its page', () => {
    const expected: [RegExp, string][] = [
      [/^Постоянные платежи/, 'recurring'],
      [/^Покупки/, 'purchases'],
      [/^Долги/, 'debts'],
      [/^Категории и лимиты/, 'categories'],
      [/^Счета и кредитка/, 'accounts-settings'],
      [/^Учёт и прогноз/, 'settings'],
      [/^PIN-код/, 'pin'],
      [/^Синхронизация/, 'sync'],
      [/^Загрузить трекер/, 'import'],
      [/^Резервная копия/, 'backup'],
      [/^О приложении/, 'about'],
    ];
    render(<TabContent tab="more" />);
    for (const [name, page] of expected) {
      fireEvent.click(screen.getByRole('button', { name }));
      expect(currentPage('more')?.page).toBe(page);
      act(() => popPage('more'));
    }
  });

  it('shows how many plans there are and when the last backup was made', () => {
    meta.value = { failedAttempts: 0 };
    render(<TabContent tab="more" />);
    expect(screen.getByRole('button', { name: /^Постоянные платежи/ }).textContent).toContain('4');
    expect(screen.getByRole('button', { name: /^Резервная копия/ }).textContent).toContain('Копии ещё не было');
  });

  it('«Синхронизация» says when the last sync was, or what it is before the first', () => {
    meta.value = { failedAttempts: 0 };
    const { unmount } = render(<TabContent tab="more" />);
    expect(screen.getByRole('button', { name: /^Синхронизация/ }).textContent).toContain('С Mac через iCloud Drive');
    unmount();
    meta.value = {
      failedAttempts: 0,
      sync: { lastId: '0123456789abcdef', lastAt: '2026-10-01T10:00:00.000Z', syncedHash: 'f'.repeat(64) },
    };
    render(<TabContent tab="more" />);
    expect(screen.getByRole('button', { name: /^Синхронизация/ }).textContent).toContain('Последняя 01.10.2026');
  });

  it('an old backup: «пора сделать новую» in the warning colour', () => {
    meta.value = { failedAttempts: 0, lastBackupAt: '2026-01-10T10:00:00.000Z' };
    render(<TabContent tab="more" />);
    const row = screen.getByRole('button', { name: /^Резервная копия/ });
    expect(row.textContent).toContain('Последняя копия 10.01.2026 — пора сделать новую');
    expect(within(row).getByText('— пора сделать новую').classList.contains('tone-orange')).toBe(true);
  });

  it('with a recent backup, its date', () => {
    meta.value = { failedAttempts: 0, lastBackupAt: '2026-09-20T10:00:00.000Z' };
    render(<TabContent tab="more" />);
    expect(screen.getByRole('button', { name: /^Резервная копия/ }).textContent).toContain('20.09.2026');
  });
});

describe('«О приложении»', () => {
  it('shows the version, where the data lives and how to install the app', () => {
    render(<AboutPage params={{}} />);
    expect(screen.getByRole('heading', { level: 1, name: 'О приложении' })).toBeTruthy();
    const versionRow = screen.getByText('Версия').closest('.row') as HTMLElement;
    expect(within(versionRow).getByText(version)).toBeTruthy();
    expect(screen.getByText(/Данные хранятся только на этом телефоне/)).toBeTruthy();
    expect(screen.getByText('Выберите «На экран „Домой“» и нажмите «Добавить».')).toBeTruthy();
    expect(document.querySelectorAll('a')).toHaveLength(0); // link-free
  });

  it('«Лицензии сторонних библиотек» opens the licences file shipped with the app in a new window', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    try {
      render(<AboutPage params={{}} />);
      fireEvent.click(screen.getByRole('button', { name: /^Лицензии сторонних библиотек/ }));
      // next to index.html (the build's base, «/» in tests): precached by the service worker, never the internet
      expect(open).toHaveBeenCalledWith(`${import.meta.env.BASE_URL}licenses.md`, '_blank', 'noopener');
    } finally {
      open.mockRestore();
    }
  });
});
