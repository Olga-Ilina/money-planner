// @vitest-environment happy-dom
// «Сегодня»: a quiet one-line reminder when the app holds changes not sent to the Mac and the last sync is
// more than a day old (spec 2026-10-01-icloud-sync). Never for someone who has never synced.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { IDBFactory } from 'fake-indexeddb';
import { dataHash } from '../../../src/io/sync';
import * as db from '../../../src/store/db';
import type { SyncState } from '../../../src/store/db';
import { actions } from '../../../src/ui/actions';
import { currentPage } from '../../../src/ui/nav';
import { Today } from '../../../src/ui/screens/Today';
import { hashOf, reminderDue } from '../../../src/ui/sync';
import { data, meta as appMeta, resetSession, tab } from '../../../src/ui/state';
import { scenario } from '../../engine/scenario';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const REMINDER = /^Отправьте изменения на Mac/;

async function show(sync: SyncState | undefined): Promise<void> {
  appMeta.value = { failedAttempts: 0, lastBackupAt: new Date().toISOString(), ...(sync ? { sync } : {}) };
  data.value = scenario();
  render(<Today />);
  await act(async () => {
    await hashOf(data.value!); // the hash the reminder waits for
  });
}

async function syncedAgo(ms: number, changed: boolean): Promise<SyncState> {
  const base = changed ? { ...scenario(), operations: [] } : scenario();
  return { lastId: '0123456789abcdef', lastAt: new Date(Date.now() - ms).toISOString(), syncedHash: await dataHash(base) };
}

beforeEach(() => {
  db.useFactory(new IDBFactory());
  resetSession();
});

afterEach(async () => {
  cleanup();
  await actions.flush();
  resetSession();
  db.useFactory(undefined);
});

describe('«Сегодня» — the sync reminder', () => {
  it('changes not sent and the last sync more than a day ago: one row that opens «Синхронизация»', async () => {
    await show(await syncedAgo(2 * DAY, true));
    const row = await screen.findByRole('button', { name: REMINDER });
    expect(screen.getAllByRole('button', { name: REMINDER })).toHaveLength(1);
    fireEvent.click(row);
    expect(tab.value).toBe('more');
    expect(currentPage('more')?.page).toBe('sync');
  });

  it('everything sent: none', async () => {
    await show(await syncedAgo(2 * DAY, false));
    expect(screen.queryByRole('button', { name: REMINDER })).toBeNull();
  });

  it('changes, but the last sync was within a day: none', async () => {
    await show(await syncedAgo(2 * HOUR, true));
    expect(screen.queryByRole('button', { name: REMINDER })).toBeNull();
  });

  it('never synced: none (the sync is not in use)', async () => {
    await show(undefined);
    expect(screen.queryByRole('button', { name: REMINDER })).toBeNull();
  });
});

describe('reminderDue', () => {
  const s = (lastAt: string): SyncState => ({ lastId: '0123456789abcdef', lastAt, syncedHash: 'f'.repeat(64) });
  const now = Date.parse('2026-10-03T12:00:00.000Z');

  it('more than 24 hours after the last sync', () => {
    expect(reminderDue(s('2026-10-02T12:00:00.000Z'), now)).toBe(false);
    expect(reminderDue(s('2026-10-02T11:59:59.000Z'), now)).toBe(true);
  });

  it('never synced: never', () => {
    expect(reminderDue(undefined, now)).toBe(false);
  });
});
