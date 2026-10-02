// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { useState } from 'preact/hooks';
import { emptyData } from '../../src/engine';
import { Page } from '../../src/ui/kit';
import { TabContent } from '../../src/ui/TabContent';
import { currentPage, openTab, popPage, pushPage, selectTab, stackDepth } from '../../src/ui/nav';
import type { RoutedPageProps } from '../../src/ui/nav';
import { pages } from '../../src/ui/pages';
import { data, resetSession, tab } from '../../src/ui/state';

beforeEach(() => {
  resetSession();
  data.value = emptyData('2026-09-30');
});

afterEach(() => {
  cleanup();
  resetSession();
});

describe('pages registry', () => {
  it('has every sub-page of the contract', () => {
    expect(Object.keys(pages).sort()).toEqual(
      ['about', 'account', 'accounts-settings', 'backup', 'categories', 'credit', 'debts', 'import', 'pin', 'purchases', 'recurring', 'settings', 'sync'].sort(),
    );
  });
});

describe('TabContent', () => {
  it('renders the root screen of each tab', () => {
    const titles = { today: 'Сегодня', feed: 'Лента', accounts: 'Счета', reports: 'Отчёты', more: 'Ещё' } as const;
    for (const [t, title] of Object.entries(titles)) {
      const { unmount } = render(<TabContent tab={t as keyof typeof titles} />);
      expect(screen.getByRole('heading', { level: 1, name: title })).toBeTruthy();
      unmount();
    }
  });

  it('shows a pushed page with a back button titled like the page below («Назад: Ещё» for screen readers)', () => {
    render(<TabContent tab="more" />);
    act(() => pushPage('more', 'settings'));
    expect(screen.getByRole('heading', { level: 1, name: 'Учёт и прогноз' })).toBeTruthy();
    const back = screen.getByRole('button', { name: 'Назад: Ещё' });
    expect(back.textContent).toBe('Ещё');
    fireEvent.click(back);
    expect(screen.getByRole('heading', { level: 1, name: 'Ещё' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Ещё/ })).toBeNull();
  });

  it('a second page gets the first page’s title on its back button', () => {
    render(<TabContent tab="more" />);
    act(() => pushPage('more', 'settings'));
    act(() => pushPage('more', 'pin'));
    expect(screen.getByRole('heading', { level: 1, name: 'PIN-код' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Назад: Учёт и прогноз' })).toBeTruthy();
  });

  it('passes params to the page', () => {
    const acc = data.value!.accounts[0]!;
    render(<TabContent tab="accounts" />);
    act(() => pushPage('accounts', 'account', { id: acc.id }));
    expect(screen.getByRole('heading', { level: 1, name: acc.name })).toBeTruthy();
  });

  it('re-pushing the same page with other params gives a fresh page (nothing carried over)', () => {
    function Probe({ params }: RoutedPageProps) {
      const [first] = useState(params.id);
      return <Page title={`Счёт ${first}`} />;
    }
    pages.probe = Probe;
    try {
      render(<TabContent tab="accounts" />);
      act(() => pushPage('accounts', 'probe', { id: 'a' }));
      expect(screen.getByRole('heading', { level: 1, name: 'Счёт a' })).toBeTruthy();
      act(() => {
        popPage('accounts');
        pushPage('accounts', 'probe', { id: 'b' });
      });
      expect(screen.getByRole('heading', { level: 1, name: 'Счёт b' })).toBeTruthy();
      act(() => openTab('accounts', 'probe', { id: 'c' }));
      expect(screen.getByRole('heading', { level: 1, name: 'Счёт c' })).toBeTruthy();
    } finally {
      delete pages.probe;
    }
  });

  it('an unknown page says so and can go back', () => {
    render(<TabContent tab="feed" />);
    act(() => pushPage('feed', 'nope'));
    expect(screen.getByText('Страница не найдена')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Лента/ }));
    expect(screen.getByRole('heading', { level: 1, name: 'Лента' })).toBeTruthy();
  });
});

describe('stacks per tab', () => {
  it('switching tabs keeps each stack; tapping the active tab pops to root', () => {
    pushPage('more', 'settings');
    expect(selectTab('feed')).toBe(false);
    expect(tab.value).toBe('feed');
    expect(currentPage('more')?.page).toBe('settings');
    selectTab('more');
    expect(tab.value).toBe('more');
    expect(stackDepth('more')).toBe(1);
    expect(selectTab('more')).toBe(false);
    expect(stackDepth('more')).toBe(0);
    // at the root already: the caller scrolls to the top
    expect(selectTab('more')).toBe(true);
  });

  it('popPage at the root does nothing', () => {
    popPage('today');
    expect(stackDepth('today')).toBe(0);
  });

  it('openTab switches the tab and opens a page from its root', () => {
    pushPage('accounts', 'credit');
    pushPage('accounts', 'credit');
    openTab('accounts', 'account', { id: 'x' });
    expect(tab.value).toBe('accounts');
    expect(stackDepth('accounts')).toBe(1);
    expect(currentPage('accounts')).toMatchObject({ page: 'account', params: { id: 'x' }, backTitle: 'Счета' });
  });
});
