// @vitest-environment happy-dom
// «Ещё» → «Синхронизация» (spec 2026-10-01-icloud-sync): the status, «Отправить на Mac» (shared / downloaded /
// cancelled), every branch of «Забрать с Mac», the data set kept before it and «Вернуть данные до синхронизации».
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import JSZip from 'jszip';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { IDBFactory } from 'fake-indexeddb';
import { emptyData } from '../../../src/engine';
import type { Data } from '../../../src/engine';
import { importBackup } from '../../../src/io/backup';
import { dataHash, formatStamp, readStamp } from '../../../src/io/sync';
import type { SyncStamp } from '../../../src/io/sync';
import * as db from '../../../src/store/db';
import type { Meta, SyncState } from '../../../src/store/db';
import { actions } from '../../../src/ui/actions';
import * as io from '../../../src/ui/io';
import { Toast } from '../../../src/ui/kit';
import { SyncPage } from '../../../src/ui/pages/SyncPage';
import * as share from '../../../src/ui/share';
import { data, meta as appMeta, resetSession, stopped } from '../../../src/ui/state';
import { beforeSync } from '../../../src/ui/sync';
import { scenario } from '../../engine/scenario';

vi.mock('../../../src/ui/share', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../../src/ui/share')>();
  return { ...mod, pickFile: vi.fn(async () => null), shareFile: vi.fn(async () => 'shared' as const) };
});

vi.mock('../../../src/ui/io', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../../src/ui/io')>();
  return { ...mod, loadTrackerImport: vi.fn(mod.loadTrackerImport) };
});

vi.mock('../../../src/ui/backupNow', () => ({ backupNow: vi.fn(async () => 'shared') }));

vi.mock('../../../src/store/db', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../../src/store/db')>();
  return {
    ...mod,
    saveData: vi.fn(mod.saveData),
    saveBeforeSync: vi.fn(mod.saveBeforeSync),
    updateStoredMeta: vi.fn(mod.updateStoredMeta),
  };
});

type TrackerModule = Awaited<ReturnType<typeof io.loadTrackerImport>>;

const MINE: Meta = { pinHash: 'aGFzaEE=', pinSalt: 'c2FsdEE=', pinIterations: 150_000, failedAttempts: 0, generation: 'g1' };
const MAC_ID = 'aaaaaaaaaaaaaaaa';
const SENT_ID = '0123456789abcdef';

/** A Mac version, as `Для приложения.xlsx` carries it. */
const macStamp = (over: Partial<SyncStamp> = {}): SyncStamp => ({
  id: MAC_ID, base: SENT_ID, dirty: false, at: '2026-10-01T08:00:00Z', from: 'mac', ...over,
});

/** An .xlsx-like zip whose docProps/core.xml carries `description` (enough for readStamp; the import is faked). */
async function fileWith(description: string | null, name = 'Для приложения.xlsx'): Promise<File> {
  const zip = new JSZip();
  const desc = description === null ? '' : `<dc:description>${description}</dc:description>`;
  zip.file('docProps/core.xml', `<cp:coreProperties xmlns:cp="x" xmlns:dc="http://purl.org/dc/elements/1.1/">${desc}</cp:coreProperties>`);
  return new File([await zip.generateAsync({ type: 'arraybuffer' })], name);
}

/** The data the faked tracker import gives: another data set than the scenario. */
function trackerData(): Data {
  return { ...emptyData('2026-10-01'), operations: [{ id: 'op1', date: '2026-10-02', kind: 'expense', what: 'С Mac', amount: 5 }] };
}

let imported: Data;

function fakeImport(): void {
  imported = trackerData();
  vi.mocked(io.loadTrackerImport).mockResolvedValue({
    importTracker: async () => ({ data: imported, notes: [], overrides: [] }),
  } as unknown as TrackerModule);
}

async function pickUp(file: File): Promise<void> {
  vi.mocked(share.pickFile).mockResolvedValueOnce(file);
  fireEvent.click(screen.getByRole('button', { name: /^Забрать с Mac/ }));
}

async function synced(over: Partial<SyncState> = {}, d: Data = scenario()): Promise<SyncState> {
  const s: SyncState = { lastId: SENT_ID, lastAt: '2026-10-01T10:00:00.000Z', syncedHash: await dataHash(d), ...over };
  appMeta.value = { ...MINE, sync: s };
  await db.saveMeta(appMeta.value);
  return s;
}

function renderPage() {
  return render(
    <>
      <SyncPage params={{}} />
      <Toast />
    </>,
  );
}

const sendButton = () => screen.getByRole('button', { name: 'Отправить на Mac' });

beforeEach(async () => {
  db.useFactory(new IDBFactory());
  resetSession();
  appMeta.value = MINE;
  await db.saveMeta(MINE);
  data.value = scenario();
  await db.saveData(scenario());
  vi.mocked(share.pickFile).mockReset().mockResolvedValue(null);
  vi.mocked(share.shareFile).mockReset().mockResolvedValue('shared');
  vi.mocked(io.loadTrackerImport).mockReset();
  vi.mocked(db.saveBeforeSync).mockClear();
  vi.mocked(db.updateStoredMeta).mockClear();
  fakeImport();
});

afterEach(async () => {
  cleanup();
  await actions.flush();
  resetSession();
  db.useFactory(undefined);
});

describe('«Синхронизация» — status', () => {
  it('never synced: «ещё не было», and the data count as not sent', async () => {
    renderPage();
    expect(screen.getByRole('heading', { level: 1, name: 'Синхронизация' })).toBeTruthy();
    expect(screen.getByText('Последняя синхронизация').closest('.row')?.textContent).toContain('ещё не было');
    expect(await screen.findByText('Есть неотправленные изменения')).toBeTruthy();
  });

  it('synced, nothing changed since: the date and time, «Всё отправлено»', async () => {
    await synced();
    renderPage();
    // 10:00 UTC is 23:00 in Auckland (the tests' time zone)
    expect(screen.getByText('Последняя синхронизация').closest('.row')?.textContent).toContain('01.10.2026, 23:00');
    expect(await screen.findByText('Всё отправлено')).toBeTruthy();
    expect(screen.queryByText('Есть неотправленные изменения')).toBeNull();
  });

  it('synced, changed since: «Есть неотправленные изменения»', async () => {
    await synced({}, { ...scenario(), operations: [] });
    renderPage();
    expect(await screen.findByText('Есть неотправленные изменения')).toBeTruthy();
  });

  it('explains how to save the file, what the Mac does and that it must be on', () => {
    renderPage();
    expect(screen.getByText(/«In Dateien sichern» → папка «Трекер расходов — синхронизация» → «Sichern»/)).toBeTruthy();
    expect(screen.getByText(/Mac должен быть включён/)).toBeTruthy();
    expect(screen.getByText(/резервную копию трекера/)).toBeTruthy();
  });

  it('auto-merge (spec 2026-10-04-auto-merge): the Mac merges both sides itself; the two taps stay on the phone', () => {
    renderPage();
    const how = screen.getByText('Как это работает').closest('section') ?? document.body;
    const text = how.textContent ?? '';
    // the Mac merges what was added, changed and deleted on both sides
    expect(text).toMatch(/Mac сам объединяет правки из приложения и из Excel/);
    expect(text).toMatch(/добавленное, изменённое и удалённое/);
    // on the phone the two taps stay: first send, then take
    expect(within(how as HTMLElement).getByText('На телефоне')).toBeTruthy();
    expect(text).toMatch(/Два касания остаются: «Отправить на Mac» и «Забрать с Mac»/);
    expect(text).toMatch(/Сначала отправьте свои изменения — Mac объединит их с правками в Excel, потом заберите результат/);
    // the exceptions (spec, «Дополнение 14:35»): lists of categories or accounts, the start of accounting, the
    // balances date, a failed merge → the Mac asks which version to keep and shows a notice
    expect(text).toMatch(
      /Если на одной из сторон менялись списки категорий или счетов, начало учёта или дата остатков либо объединить не получилось, Mac не объединяет сам — он спросит, какую версию оставить, и покажет уведомление/,
    );
  });

  it('no text promises a merge that never asks: the guards say what the Mac does, and when it asks', async () => {
    await synced({ sentDirty: true });
    renderPage();
    // the page itself: the merge is not «always»
    expect(document.body.textContent).not.toMatch(/всегда|никогда|без вопросов|без уведомлени/i);
    // «Изменения ещё не на Mac»: merges it, or asks which version to keep
    await pickUp(await fileWith(formatStamp(macStamp({ base: 'bbbbbbbbbbbbbbbb' }))));
    const warning = await screen.findByRole('dialog', { name: 'Изменения ещё не на Mac' });
    expect(within(warning).getByText(/Mac объединит её с правками в Excel сам, а если не сможет — спросит, какую версию оставить/)).toBeTruthy();
    expect(warning.textContent).not.toMatch(/всегда|никогда/i);
  });
});

describe('«Отправить на Mac»', () => {
  it.each(['shared', 'downloaded'] as const)(
    '%s: the full backup «Из приложения.xlsx» with a stamp from the app; the sync state becomes this version',
    async (outcome) => {
      vi.mocked(share.shareFile).mockResolvedValue(outcome);
      renderPage();
      fireEvent.click(sendButton());
      await waitFor(() => expect(appMeta.value.sync).toBeDefined(), { timeout: 10_000 });
      const [filename, buffer] = vi.mocked(share.shareFile).mock.calls[0]!;
      expect(filename).toBe('Из приложения.xlsx');
      const buf = buffer as ArrayBuffer;
      const stamp = (await readStamp(buf))!;
      expect(stamp).toMatchObject({ base: null, dirty: true, from: 'app' }); // never synced: base «-», dirty
      expect(stamp.id).toMatch(/^[0-9a-f]{16}$/);
      expect(await importBackup(buf)).toEqual(scenario());
      const expected = { lastId: stamp.id, syncedHash: await dataHash(scenario()), sentDirty: true };
      expect(appMeta.value.sync).toMatchObject(expected);
      expect((await db.loadMeta()).sync).toEqual(appMeta.value.sync);
      expect(Math.floor(Date.parse(appMeta.value.sync!.lastAt) / 1000) * 1000).toBe(Date.parse(stamp.at)); // the stamp: to the second
      expect(await screen.findByText('Всё отправлено')).toBeTruthy();
      expect(screen.getByText(outcome === 'shared' ? 'Файл для Mac передан' : /Файл скачан — перенесите его в папку/)).toBeTruthy();
    },
    20_000,
  );

  it('after a sync with nothing changed: base is the last version, dirty=0', async () => {
    const s = await synced();
    renderPage();
    fireEvent.click(sendButton());
    await waitFor(() => expect(appMeta.value.sync?.lastId).not.toBe(s.lastId), { timeout: 10_000 });
    const stamp = (await readStamp(vi.mocked(share.shareFile).mock.calls[0]![1] as ArrayBuffer))!;
    expect(stamp).toMatchObject({ base: SENT_ID, dirty: false, from: 'app' });
    expect(appMeta.value.sync).toEqual({ lastId: stamp.id, lastAt: expect.any(String), syncedHash: s.syncedHash });
  }, 20_000);

  it('after a sync with changes since: dirty=1', async () => {
    await synced({}, { ...scenario(), operations: [] });
    renderPage();
    fireEvent.click(sendButton());
    await waitFor(() => expect(share.shareFile).toHaveBeenCalled(), { timeout: 10_000 });
    const stamp = (await readStamp(vi.mocked(share.shareFile).mock.calls[0]![1] as ArrayBuffer))!;
    expect(stamp).toMatchObject({ base: SENT_ID, dirty: true });
  }, 20_000);

  it('cancelled: nothing recorded', async () => {
    const s = await synced();
    vi.mocked(share.shareFile).mockResolvedValue('cancelled');
    renderPage();
    fireEvent.click(sendButton());
    await waitFor(() => expect(share.shareFile).toHaveBeenCalled(), { timeout: 10_000 });
    await actions.flush();
    expect(appMeta.value.sync).toEqual(s);
    expect((await db.loadMeta()).sync).toEqual(s);
    expect(db.updateStoredMeta).not.toHaveBeenCalled();
  }, 20_000);

  it('the sync state cannot be saved: says so (the file was handed over)', async () => {
    vi.mocked(db.updateStoredMeta).mockRejectedValueOnce(new db.StoreError('Не удалось сохранить данные.', { code: 'write' }));
    renderPage();
    fireEvent.click(sendButton());
    expect(await screen.findByText('Файл для Mac готов, но отметка синхронизации не сохранилась', {}, { timeout: 10_000 })).toBeTruthy();
    expect(appMeta.value.sync).toBeUndefined();
  }, 20_000);

  it('busy while the file is made: a second tap makes no second file', async () => {
    renderPage();
    fireEvent.click(sendButton());
    expect((sendButton() as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(sendButton());
    await waitFor(() => expect((sendButton() as HTMLButtonElement).disabled).toBe(false), { timeout: 10_000 });
    expect(share.shareFile).toHaveBeenCalledTimes(1);
  }, 20_000);

  it('C1: sent with changes, then again with nothing changed — still dirty=1 until the Mac has it; its older file then warns', async () => {
    const L0 = 'cccccccccccccccc';
    await synced({ lastId: L0 }, { ...scenario(), operations: [] }); // changes since L0
    renderPage();
    fireEvent.click(sendButton());
    await waitFor(() => expect(appMeta.value.sync?.lastId).not.toBe(L0), { timeout: 10_000 });
    const s1 = (await readStamp(vi.mocked(share.shareFile).mock.calls[0]![1] as ArrayBuffer))!;
    expect(s1).toMatchObject({ base: L0, dirty: true });
    expect(appMeta.value.sync).toMatchObject({ lastId: s1.id, sentDirty: true });
    await waitFor(() => expect((sendButton() as HTMLButtonElement).disabled).toBe(false), { timeout: 10_000 });
    expect(await screen.findByText('Всё отправлено')).toBeTruthy(); // nothing changed since S1
    fireEvent.click(sendButton());
    await waitFor(() => expect(appMeta.value.sync?.lastId).not.toBe(s1.id), { timeout: 10_000 });
    const s2 = (await readStamp(vi.mocked(share.shareFile).mock.calls[1]![1] as ArrayBuffer))!;
    // the Mac may never see S1 (iOS «Ersetzen» puts S2 in its place): S2 still says «changes», or the Mac would
    // take its own older version for the newer one and archive S2
    expect(s2).toMatchObject({ base: s1.id, dirty: true });
    await actions.flush();
    expect(appMeta.value.sync).toMatchObject({ lastId: s2.id, sentDirty: true });
    expect((await db.loadMeta()).sync).toEqual(appMeta.value.sync);
    // the folder still holds the Mac's older version: taking it warns that the changes would go
    await waitFor(() => expect((sendButton() as HTMLButtonElement).disabled).toBe(false), { timeout: 10_000 });
    await pickUp(await fileWith(formatStamp(macStamp({ id: L0, base: null }))));
    expect(await screen.findByRole('dialog', { name: 'Изменения ещё не на Mac' })).toBeTruthy();
    expect(screen.queryByRole('dialog', { name: 'Заменить данные в приложении' })).toBeNull();
  }, 40_000);
});

describe('«Забрать с Mac»', () => {
  it('the picker closed: nothing happens', async () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /^Забрать с Mac/ }));
    await Promise.resolve();
    expect(share.pickFile).toHaveBeenCalledWith(expect.stringContaining('.xlsx'));
    expect(io.loadTrackerImport).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('a file the app sent: «выберите «Для приложения.xlsx»», nothing read or replaced', async () => {
    renderPage();
    await pickUp(await fileWith(formatStamp(macStamp({ from: 'app' })), 'Из приложения.xlsx'));
    expect(await screen.findByText('Это файл, отправленный из приложения. Выберите «Для приложения.xlsx».')).toBeTruthy();
    expect(io.loadTrackerImport).not.toHaveBeenCalled();
    expect(data.value).toEqual(scenario());
  });

  it('the app’s own file just sent (its id is lastId): «выберите «Для приложения.xlsx»», not «Нового нет»', async () => {
    await synced();
    renderPage();
    await pickUp(await fileWith(formatStamp(macStamp({ id: SENT_ID, from: 'app' })), 'Из приложения.xlsx'));
    expect(await screen.findByText('Это файл, отправленный из приложения. Выберите «Для приложения.xlsx».')).toBeTruthy();
    expect(screen.queryByText(/Нового/)).toBeNull();
  });

  it('the version last exchanged: «Нового нет, всё синхронизировано»', async () => {
    await synced({ lastId: MAC_ID });
    renderPage();
    await pickUp(await fileWith(formatStamp(macStamp())));
    expect(await screen.findByText('Нового нет, всё синхронизировано.')).toBeTruthy();
    expect(io.loadTrackerImport).not.toHaveBeenCalled();
    await actions.flush();
    expect(db.updateStoredMeta).not.toHaveBeenCalled(); // nothing to resolve: nothing written
  });

  it('the version last exchanged, with changes in the app: nothing new, and the changes are still to send', async () => {
    await synced({ lastId: MAC_ID }, { ...scenario(), operations: [] });
    renderPage();
    await pickUp(await fileWith(formatStamp(macStamp())));
    expect(await screen.findByText('Нового на Mac нет. Изменения из приложения ещё не отправлены — нажмите «Отправить на Mac».')).toBeTruthy();
    expect(io.loadTrackerImport).not.toHaveBeenCalled();
  });

  it('a damaged stamp: says so, nothing replaced', async () => {
    renderPage();
    await pickUp(await fileWith('money-planner-sync/1 id=zz'));
    expect(await screen.findByText(/Отметка синхронизации в файле повреждена/)).toBeTruthy();
    expect(io.loadTrackerImport).not.toHaveBeenCalled();
  });

  it('a new Mac version, nothing unsent: the import preview, then replace; the sync state becomes that version', async () => {
    const before = await synced();
    renderPage();
    await pickUp(await fileWith(formatStamp(macStamp())));
    const sheet = await screen.findByRole('dialog', { name: 'Заменить данные в приложении' });
    expect(screen.queryByRole('dialog', { name: /^Изменения/ })).toBeNull(); // base = the last send, no changes since: no guard
    expect(within(sheet).getByText(/Прежние данные сохранятся/)).toBeTruthy();
    expect(data.value).toEqual(scenario()); // nothing changed before the choice
    fireEvent.click(within(sheet).getByRole('button', { name: 'Заменить данные в приложении' }));
    expect(await screen.findByText('Данные с Mac загружены')).toBeTruthy();
    expect(data.value).toBe(imported);
    expect(await db.loadData()).toEqual(imported);
    await actions.flush();
    const s = appMeta.value.sync!;
    expect(s).toEqual({ lastId: MAC_ID, lastAt: expect.any(String), syncedHash: await dataHash(imported) });
    expect((await db.loadMeta()).sync).toEqual(s);
    // the data set it replaced is kept, with the sync state it had
    const kept = await db.loadBeforeSync({ generation: 'g1' });
    expect(kept?.data).toEqual(scenario());
    expect(kept?.sync).toEqual(before);
    expect(await screen.findByRole('button', { name: /^Вернуть данные до синхронизации/ })).toBeTruthy();
    expect(await screen.findByText('Всё отправлено')).toBeTruthy();
  });

  it('unsent changes: the guard «Сначала отправьте…» with a primary «Отправить на Mac»; nothing is replaced, nothing is read', async () => {
    await synced({}, { ...scenario(), operations: [] });
    renderPage();
    await pickUp(await fileWith(formatStamp(macStamp())));
    const warning = await screen.findByRole('dialog', { name: 'Изменения не отправлены' });
    expect(within(warning).getByText(/Сначала отправьте свои изменения на Mac — он объединит их с правками в Excel/)).toBeTruthy();
    expect(within(warning).getByText(/Если заменить данные файлом с Mac, изменения из приложения пропадут/)).toBeTruthy();
    // the one filled button is the way forward; replacing anyway is an explicit, destructive second choice
    expect(within(warning).getByRole('button', { name: 'Отправить на Mac' }).className).toContain('btn-filled');
    expect(within(warning).getByRole('button', { name: 'Всё равно заменить' }).className).toContain('btn-destructive');
    expect(within(warning).queryByRole('button', { name: 'Сначала отправить на Mac' })).toBeNull();
    expect(screen.queryByRole('dialog', { name: 'Заменить данные в приложении' })).toBeNull();
    expect(data.value).toEqual(scenario());
    expect(share.shareFile).not.toHaveBeenCalled();
  });

  it('unsent changes: «Всё равно заменить» is the explicit choice that goes on to the preview', async () => {
    await synced({}, { ...scenario(), operations: [] });
    renderPage();
    await pickUp(await fileWith(formatStamp(macStamp())));
    const warning = await screen.findByRole('dialog', { name: 'Изменения не отправлены' });
    fireEvent.click(within(warning).getByRole('button', { name: 'Всё равно заменить' }));
    const sheet = await screen.findByRole('dialog', { name: 'Заменить данные в приложении' });
    expect(data.value).toEqual(scenario()); // still nothing replaced
    fireEvent.click(within(sheet).getByRole('button', { name: 'Заменить данные в приложении' }));
    await waitFor(() => expect(data.value).toBe(imported));
    await actions.flush();
    expect(appMeta.value.sync?.lastId).toBe(MAC_ID);
  });

  it('the app changed after the last send, and the Mac file is built on that send (base = lastId): still the guard', async () => {
    await synced({ sentDirty: true }, { ...scenario(), operations: [] }); // sent SENT_ID, edited since
    renderPage();
    await pickUp(await fileWith(formatStamp(macStamp({ base: SENT_ID }))));
    expect(await screen.findByRole('dialog', { name: 'Изменения не отправлены' })).toBeTruthy();
    expect(screen.queryByRole('dialog', { name: 'Заменить данные в приложении' })).toBeNull();
    expect(data.value).toEqual(scenario());
  });

  it('the app changed after a Mac version was taken and the Mac made the next one (base = that version): the guard', async () => {
    await synced({ lastId: MAC_ID }, { ...scenario(), operations: [] });
    renderPage();
    await pickUp(await fileWith(formatStamp(macStamp({ id: 'bbbbbbbbbbbbbbbb', base: MAC_ID }))));
    expect(await screen.findByRole('dialog', { name: 'Изменения не отправлены' })).toBeTruthy();
    expect(screen.queryByRole('dialog', { name: 'Заменить данные в приложении' })).toBeNull();
  });

  it('never synced: the warning says the data have never been sent', async () => {
    renderPage();
    await pickUp(await fileWith(formatStamp(macStamp({ base: null }))));
    const warning = await screen.findByRole('dialog', { name: 'Изменения не отправлены' });
    expect(within(warning).getByText(/ещё ни разу не отправлялись на Mac/)).toBeTruthy();
    expect(within(warning).getByText(/Сначала отправьте свои изменения на Mac — он объединит их с правками в Excel/)).toBeTruthy();
    expect(within(warning).getByRole('button', { name: 'Отправить на Mac' }).className).toContain('btn-filled');
  });

  it('unsent changes, «Отправить на Mac» in the guard: sends, replaces nothing; the merged Mac version built on that send then replaces', async () => {
    await synced({}, { ...scenario(), operations: [] });
    renderPage();
    await pickUp(await fileWith(formatStamp(macStamp())));
    const warning = await screen.findByRole('dialog', { name: 'Изменения не отправлены' });
    fireEvent.click(within(warning).getByRole('button', { name: 'Отправить на Mac' }));
    await waitFor(() => expect(share.shareFile).toHaveBeenCalledWith('Из приложения.xlsx', expect.anything()), { timeout: 10_000 });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(data.value).toEqual(scenario());
    await actions.flush();
    expect(await db.loadBeforeSync({ generation: 'g1' })).toBeNull();
    const sent = (await readStamp(vi.mocked(share.shareFile).mock.calls[0]![1] as ArrayBuffer))!;
    expect(sent).toMatchObject({ base: SENT_ID, dirty: true, from: 'app' });
    expect(appMeta.value.sync).toMatchObject({ lastId: sent.id, sentDirty: true });
    await waitFor(() => expect((sendButton() as HTMLButtonElement).disabled).toBe(false), { timeout: 10_000 });
    // the Mac merged it and publishes the result, built on this send: no unsent changes, so it replaces as before
    await pickUp(await fileWith(formatStamp(macStamp({ id: 'cccccccccccccccc', base: sent.id }))));
    const sheet = await screen.findByRole('dialog', { name: 'Заменить данные в приложении' });
    expect(screen.queryByRole('dialog', { name: /^Изменения/ })).toBeNull();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Заменить данные в приложении' }));
    await waitFor(() => expect(data.value).toBe(imported));
    await actions.flush();
    expect(appMeta.value.sync).toEqual({ lastId: 'cccccccccccccccc', lastAt: expect.any(String), syncedHash: await dataHash(imported) });
  }, 30_000);

  it('the last version was sent with changes and this file is not built on it: warns that they would go', async () => {
    await synced({ sentDirty: true });
    renderPage();
    await pickUp(await fileWith(formatStamp(macStamp({ base: 'bbbbbbbbbbbbbbbb' }))));
    const warning = await screen.findByRole('dialog', { name: 'Изменения ещё не на Mac' });
    expect(within(warning).getByText(/Последняя отправка из приложения ещё не попала в трекер на Mac/)).toBeTruthy();
    expect(within(warning).getByText(/Mac объединит её с правками в Excel сам/)).toBeTruthy();
    // already sent: nothing to send again
    expect(within(warning).queryByRole('button', { name: 'Отправить на Mac' })).toBeNull();
    expect(within(warning).getByRole('button', { name: 'Всё равно заменить' })).toBeTruthy();
  });

  it('…but a file built on that version goes straight to the preview', async () => {
    await synced({ sentDirty: true });
    renderPage();
    await pickUp(await fileWith(formatStamp(macStamp({ base: SENT_ID }))));
    const sheet = await screen.findByRole('dialog', { name: 'Заменить данные в приложении' });
    expect(screen.queryByRole('dialog', { name: /^Изменения/ })).toBeNull(); // base = the last send, nothing changed since: no guard
    fireEvent.click(within(sheet).getByRole('button', { name: 'Заменить данные в приложении' }));
    expect(await screen.findByText('Данные с Mac загружены')).toBeTruthy();
    await actions.flush();
    // taken: the sent changes are resolved
    expect(appMeta.value.sync).toEqual({ lastId: MAC_ID, lastAt: expect.any(String), syncedHash: await dataHash(imported) });
  });

  it('no stamp: the normal tracker import (the sync state stays; the import date is recorded)', async () => {
    const s = await synced();
    renderPage();
    await pickUp(await fileWith(null, 'Трекер.xlsx'));
    const sheet = await screen.findByRole('dialog', { name: 'Заменить данные в приложении' });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Заменить данные в приложении' }));
    expect(await screen.findByText('Трекер загружен')).toBeTruthy();
    expect(data.value).toBe(imported);
    await actions.flush();
    expect(appMeta.value.sync).toEqual(s);
    expect(appMeta.value.lastImportAt).toBeDefined();
    expect((await db.loadBeforeSync({ generation: 'g1' }))?.data).toEqual(scenario());
  });

  it('the data set cannot be kept: nothing is replaced, and it says why', async () => {
    await synced();
    vi.mocked(db.saveBeforeSync).mockRejectedValueOnce(
      new db.StoreError('Не удалось сохранить данные: на устройстве закончилось место.', { code: 'quota' }),
    );
    renderPage();
    await pickUp(await fileWith(formatStamp(macStamp())));
    const sheet = await screen.findByRole('dialog', { name: 'Заменить данные в приложении' });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Заменить данные в приложении' }));
    expect(await within(sheet).findByText('Не удалось сохранить данные: на устройстве закончилось место.')).toBeTruthy();
    expect(data.value).toEqual(scenario());
    expect(await db.loadData()).toEqual(scenario());
    expect(appMeta.value.sync?.lastId).toBe(SENT_ID);
  });

  it('the data cannot be replaced: the data set kept before comes back', async () => {
    await synced();
    const earlier = { data: { ...scenario(), operations: [] }, at: '2026-09-01T10:00:00.000Z' };
    await db.saveBeforeSync(earlier, { generation: 'g1' });
    vi.mocked(db.saveData).mockRejectedValueOnce(new db.StoreError('Не удалось сохранить данные.', { code: 'write' }));
    renderPage();
    await pickUp(await fileWith(formatStamp(macStamp())));
    const sheet = await screen.findByRole('dialog', { name: 'Заменить данные в приложении' });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Заменить данные в приложении' }));
    expect(await within(sheet).findByText('Не удалось сохранить данные.')).toBeTruthy();
    expect(data.value).toEqual(scenario());
    expect(await db.loadBeforeSync({ generation: 'g1' })).toEqual({ ...earlier, generation: 'g1' });
    expect(appMeta.value.sync?.lastId).toBe(SENT_ID);
  });

  it('another tab set up new data meanwhile: nothing kept or replaced, the tab stops', async () => {
    await synced();
    renderPage();
    await pickUp(await fileWith(formatStamp(macStamp())));
    const sheet = await screen.findByRole('dialog', { name: 'Заменить данные в приложении' });
    const theirs: Meta = { pinHash: 'aGFzaEI=', pinSalt: 'c2FsdEI=', pinIterations: 150_000, failedAttempts: 0, generation: 'g2' };
    await db.saveMeta(theirs);
    fireEvent.click(within(sheet).getByRole('button', { name: 'Заменить данные в приложении' }));
    await waitFor(() => expect(stopped.value).toBe(true));
    expect(await db.loadBeforeSync({ generation: 'g2' })).toBeNull();
    expect(await db.loadBeforeSync({ generation: 'g1' })).toBeNull();
    expect(await db.loadData()).toEqual(scenario());
  });

  it('the last version was sent without changes and this file is not built on it: no warning, straight to the preview', async () => {
    await synced(); // no sentDirty: nothing of the app's can be missing from the Mac file
    renderPage();
    await pickUp(await fileWith(formatStamp(macStamp({ base: 'bbbbbbbbbbbbbbbb' }))));
    expect(await screen.findByRole('dialog', { name: 'Заменить данные в приложении' })).toBeTruthy();
    expect(screen.queryByRole('dialog', { name: /^Изменения/ })).toBeNull();
  });

  it('the version last sent with changes comes back from the Mac (id == lastId): they are in the tracker, sentDirty goes', async () => {
    const s = await synced({ sentDirty: true });
    renderPage();
    await pickUp(await fileWith(formatStamp(macStamp({ id: SENT_ID }))));
    expect(await screen.findByText('Нового нет, всё синхронизировано.')).toBeTruthy();
    await waitFor(() => expect(appMeta.value.sync?.sentDirty).toBeUndefined());
    await actions.flush();
    const { sentDirty: _sent, ...resolved } = s;
    expect(appMeta.value.sync).toEqual(resolved);
    expect((await db.loadMeta()).sync).toEqual(resolved);
    expect(io.loadTrackerImport).not.toHaveBeenCalled();
    // so the next send with nothing changed says so
    fireEvent.click(sendButton());
    await waitFor(() => expect(share.shareFile).toHaveBeenCalled(), { timeout: 10_000 });
    expect(await readStamp(vi.mocked(share.shareFile).mock.calls[0]![1] as ArrayBuffer)).toMatchObject({ base: SENT_ID, dirty: false });
  }, 20_000);

  it('an edit made while the data set is being kept is never lost: nothing replaced, it says why', async () => {
    await synced();
    const edited: Data = { ...scenario(), operations: [] };
    const keepIt = vi.mocked(db.saveBeforeSync).getMockImplementation()!;
    vi.mocked(db.saveBeforeSync).mockImplementationOnce(async (snapshot, check) => {
      actions.commit(edited); // the user changes something while the copy is being written
      return keepIt(snapshot, check);
    });
    renderPage();
    await pickUp(await fileWith(formatStamp(macStamp())));
    const sheet = await screen.findByRole('dialog', { name: 'Заменить данные в приложении' });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Заменить данные в приложении' }));
    expect(await within(sheet).findByText('Данные изменились, пока шло сохранение. Файл не загружен — попробуйте ещё раз.')).toBeTruthy();
    expect(data.value).toBe(edited);
    await actions.flush();
    expect(await db.loadData()).toEqual(edited);
    expect(appMeta.value.sync?.lastId).toBe(SENT_ID);
    expect(await db.loadBeforeSync({ generation: 'g1' })).toBeNull(); // the copy made for it is gone again
  });

  it('the data cannot be replaced and the earlier data set cannot be put back: what is offered is what is stored', async () => {
    await synced();
    const earlier = { data: { ...scenario(), operations: [] }, at: '2026-09-01T10:00:00.000Z' };
    await db.saveBeforeSync(earlier, { generation: 'g1' });
    vi.mocked(db.saveData).mockRejectedValueOnce(new db.StoreError('Не удалось сохранить данные.', { code: 'write' }));
    const keepIt = vi.mocked(db.saveBeforeSync).getMockImplementation()!;
    vi.mocked(db.saveBeforeSync)
      .mockImplementationOnce(keepIt) // the data set now is kept
      .mockRejectedValueOnce(new db.StoreError('Не удалось сохранить данные.', { code: 'write' })); // the earlier one cannot go back
    renderPage();
    await waitFor(() => expect(beforeSync.value?.at).toBe(earlier.at));
    await pickUp(await fileWith(formatStamp(macStamp())));
    const sheet = await screen.findByRole('dialog', { name: 'Заменить данные в приложении' });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Заменить данные в приложении' }));
    expect(await within(sheet).findByText('Не удалось сохранить данные.')).toBeTruthy();
    expect(data.value).toEqual(scenario());
    const stored = await db.loadBeforeSync({ generation: 'g1' });
    expect(stored?.data).toEqual(scenario()); // the copy just made stays stored
    await waitFor(() => expect(beforeSync.value).toEqual(stored));
  });
});

describe('«Вернуть данные до синхронизации»', () => {
  it('not shown while nothing is kept', async () => {
    renderPage();
    await screen.findByText('Есть неотправленные изменения');
    expect(screen.queryByRole('button', { name: /^Вернуть данные до синхронизации/ })).toBeNull();
  });

  it('brings back the data set and the sync state it had; then nothing is kept', async () => {
    const old = { lastId: SENT_ID, lastAt: '2026-09-30T10:00:00.000Z', syncedHash: 'e'.repeat(64) };
    await synced({ lastId: MAC_ID });
    const keptData = { ...scenario(), operations: [] };
    await db.saveBeforeSync({ data: keptData, at: '2026-10-01T10:00:00.000Z', sync: old }, { generation: 'g1' });
    renderPage();
    const row = await screen.findByRole('button', { name: /^Вернуть данные до синхронизации/ });
    expect(row.textContent).toContain('01.10.2026, 23:00');
    fireEvent.click(row);
    const sheet = await screen.findByRole('dialog', { name: 'Вернуть данные до синхронизации' });
    expect(within(sheet).getByText(/станут такими, какими были до синхронизации 01\.10\.2026, 23:00/)).toBeTruthy();
    expect(within(sheet).getByRole('button', { name: 'Сначала сделать копию' })).toBeTruthy();
    expect(data.value).toEqual(scenario()); // nothing before the choice
    fireEvent.click(within(sheet).getByRole('button', { name: 'Вернуть данные' }));
    expect(await screen.findByText('Данные возвращены')).toBeTruthy();
    expect(data.value).toEqual(keptData);
    expect(await db.loadData()).toEqual(keptData);
    await actions.flush();
    expect(appMeta.value.sync).toEqual(old);
    expect((await db.loadMeta()).sync).toEqual(old);
    expect(await db.loadBeforeSync({ generation: 'g1' })).toBeNull();
    await waitFor(() => expect(screen.queryByRole('button', { name: /^Вернуть данные до синхронизации/ })).toBeNull());
  });

  it('kept before the first sync: the sync state goes back to «never synced»', async () => {
    await synced({ lastId: MAC_ID });
    await db.saveBeforeSync({ data: scenario(), at: '2026-10-01T10:00:00.000Z' }, { generation: 'g1' });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /^Вернуть данные до синхронизации/ }));
    const sheet = await screen.findByRole('dialog', { name: 'Вернуть данные до синхронизации' });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Вернуть данные' }));
    expect(await screen.findByText('Данные возвращены')).toBeTruthy();
    await actions.flush();
    expect(appMeta.value.sync).toBeUndefined();
    expect('sync' in (await db.loadMeta())).toBe(false);
  });

  it('the data cannot be saved: says why, everything stays (the kept data set too)', async () => {
    await synced({ lastId: MAC_ID });
    const keptData = { ...scenario(), operations: [] };
    await db.saveBeforeSync({ data: keptData, at: '2026-10-01T10:00:00.000Z' }, { generation: 'g1' });
    vi.mocked(db.saveData).mockRejectedValueOnce(new db.StoreError('Не удалось сохранить данные.', { code: 'write' }));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /^Вернуть данные до синхронизации/ }));
    const sheet = await screen.findByRole('dialog', { name: 'Вернуть данные до синхронизации' });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Вернуть данные' }));
    expect(await within(sheet).findByText('Не удалось сохранить данные.')).toBeTruthy();
    expect(data.value).toEqual(scenario());
    expect((await db.loadBeforeSync({ generation: 'g1' }))?.data).toEqual(keptData);
    expect(appMeta.value.sync?.lastId).toBe(MAC_ID);
  });

  it('another data set’s kept data is never offered', async () => {
    await db.saveMeta({ ...MINE, generation: 'g0' });
    await db.saveBeforeSync({ data: { ...scenario(), operations: [] }, at: '2026-10-01T10:00:00.000Z' }, { generation: 'g0' });
    await db.saveMeta(MINE);
    renderPage();
    await screen.findByText('Есть неотправленные изменения');
    await actions.flush();
    expect(screen.queryByRole('button', { name: /^Вернуть данные до синхронизации/ })).toBeNull();
  });

  it('restores the newest copy stored for this data set, not the one read when the page opened', async () => {
    await synced({ lastId: MAC_ID });
    await db.saveBeforeSync({ data: { ...scenario(), operations: [] }, at: '2026-10-01T09:00:00.000Z' }, { generation: 'g1' });
    renderPage();
    const row = await screen.findByRole('button', { name: /^Вернуть данные до синхронизации/ });
    // meanwhile another tab of this data set took a newer Mac version: its copy replaced this one
    const newer = trackerData();
    const newerSync = { lastId: 'dddddddddddddddd', lastAt: '2026-10-01T10:30:00.000Z', syncedHash: 'f'.repeat(64) };
    await db.saveBeforeSync({ data: newer, at: '2026-10-01T11:00:00.000Z', sync: newerSync }, { generation: 'g1' });
    fireEvent.click(row);
    const sheet = await screen.findByRole('dialog', { name: 'Вернуть данные до синхронизации' });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Вернуть данные' }));
    expect(await screen.findByText('Данные возвращены')).toBeTruthy();
    expect(data.value).toEqual(newer);
    await actions.flush();
    expect(appMeta.value.sync).toEqual(newerSync);
  });

  it('the sync state cannot be saved: the data are back, the copy is forgotten, the toast says the sync mark was not saved', async () => {
    const old = { lastId: SENT_ID, lastAt: '2026-09-30T10:00:00.000Z', syncedHash: 'e'.repeat(64) };
    const now = await synced({ lastId: MAC_ID });
    const keptData = { ...scenario(), operations: [] };
    await db.saveBeforeSync({ data: keptData, at: '2026-10-01T10:00:00.000Z', sync: old }, { generation: 'g1' });
    vi.mocked(db.updateStoredMeta).mockRejectedValueOnce(new db.StoreError('Не удалось сохранить данные.', { code: 'write' }));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /^Вернуть данные до синхронизации/ }));
    const sheet = await screen.findByRole('dialog', { name: 'Вернуть данные до синхронизации' });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Вернуть данные' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await actions.flush();
    expect(screen.getByText('Данные возвращены, но отметка синхронизации не сохранилась')).toBeTruthy();
    expect(screen.queryByText('Данные возвращены')).toBeNull();
    expect(data.value).toEqual(keptData);
    expect(appMeta.value.sync).toEqual(now);
    expect(await db.loadBeforeSync({ generation: 'g1' })).toBeNull();
  });

  it('the copy cannot be forgotten: the sync state it had still comes back (and the copy is still offered)', async () => {
    const old = { lastId: SENT_ID, lastAt: '2026-09-30T10:00:00.000Z', syncedHash: 'e'.repeat(64) };
    await synced({ lastId: MAC_ID });
    const keptData = { ...scenario(), operations: [] };
    await db.saveBeforeSync({ data: keptData, at: '2026-10-01T10:00:00.000Z', sync: old }, { generation: 'g1' });
    vi.mocked(db.saveBeforeSync).mockRejectedValueOnce(new db.StoreError('Не удалось сохранить данные.', { code: 'write' }));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /^Вернуть данные до синхронизации/ }));
    const sheet = await screen.findByRole('dialog', { name: 'Вернуть данные до синхронизации' });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Вернуть данные' }));
    expect(await screen.findByText('Данные возвращены')).toBeTruthy();
    expect(data.value).toEqual(keptData);
    await actions.flush();
    expect(appMeta.value.sync).toEqual(old);
    expect((await db.loadMeta()).sync).toEqual(old);
    expect(await screen.findByRole('button', { name: /^Вернуть данные до синхронизации/ })).toBeTruthy();
  });

  it('another tab of this data set restored it meanwhile: «Данных до синхронизации больше нет», the tab goes on', async () => {
    await synced({ lastId: MAC_ID });
    await db.saveBeforeSync({ data: { ...scenario(), operations: [] }, at: '2026-10-01T10:00:00.000Z' }, { generation: 'g1' });
    renderPage();
    const row = await screen.findByRole('button', { name: /^Вернуть данные до синхронизации/ });
    await db.saveBeforeSync(null, { generation: 'g1' });
    fireEvent.click(row);
    const sheet = await screen.findByRole('dialog', { name: 'Вернуть данные до синхронизации' });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Вернуть данные' }));
    expect(await within(sheet).findByText('Данных до синхронизации больше нет.')).toBeTruthy();
    expect(stopped.value).toBe(false);
    expect(data.value).toEqual(scenario());
  });

  it('nothing kept any more and the storage cannot be written: still «Данных до синхронизации больше нет»', async () => {
    await synced({ lastId: MAC_ID });
    await db.saveBeforeSync({ data: { ...scenario(), operations: [] }, at: '2026-10-01T10:00:00.000Z' }, { generation: 'g1' });
    renderPage();
    const row = await screen.findByRole('button', { name: /^Вернуть данные до синхронизации/ });
    await db.saveBeforeSync(null, { generation: 'g1' });
    vi.mocked(db.saveBeforeSync).mockClear().mockRejectedValueOnce(new db.StoreError('Не удалось сохранить данные.', { code: 'write' }));
    fireEvent.click(row);
    const sheet = await screen.findByRole('dialog', { name: 'Вернуть данные до синхронизации' });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Вернуть данные' }));
    expect(await within(sheet).findByText('Данных до синхронизации больше нет.')).toBeTruthy();
    expect(db.saveBeforeSync).toHaveBeenCalledOnce();
    expect(stopped.value).toBe(false);
  });

  it('another tab replaced this data set (wipe, new data): restoring stops the tab, nothing written', async () => {
    await synced({ lastId: MAC_ID });
    await db.saveBeforeSync({ data: { ...scenario(), operations: [] }, at: '2026-10-01T10:00:00.000Z' }, { generation: 'g1' });
    renderPage();
    const row = await screen.findByRole('button', { name: /^Вернуть данные до синхронизации/ });
    // another tab: «Забыли PIN?» → wipe → a new data set with a copy of its own
    await db.wipeAll();
    const theirs: Meta = { pinHash: 'aGFzaEI=', pinSalt: 'c2FsdEI=', pinIterations: 150_000, failedAttempts: 0, generation: 'g2' };
    await db.saveMeta(theirs);
    const theirData = trackerData();
    await db.saveData(theirData);
    const theirKept = { data: emptyData('2026-10-01'), at: '2026-10-01T11:00:00.000Z' };
    await db.saveBeforeSync(theirKept, { generation: 'g2' });
    fireEvent.click(row);
    const sheet = await screen.findByRole('dialog', { name: 'Вернуть данные до синхронизации' });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Вернуть данные' }));
    await waitFor(() => expect(stopped.value).toBe(true));
    expect(within(sheet).queryByText('Данных до синхронизации больше нет.')).toBeNull();
    expect(data.value).toEqual(scenario());
    await actions.flush();
    expect(await db.loadData()).toEqual(theirData);
    expect(await db.loadMeta()).toEqual(theirs);
    expect(await db.loadBeforeSync({ generation: 'g2' })).toEqual({ ...theirKept, generation: 'g2' });
  });
});

describe('round trip with the real tracker', () => {
  it('a tracker the Mac stamped: the real import replaces the data and sets lastId and syncedHash', async () => {
    vi.mocked(io.loadTrackerImport).mockReset().mockImplementation(async () => import('../../../src/io/importTracker'));
    const bytes = readFileSync(join(import.meta.dirname, '../../fixtures/tracker-scenario.xlsx'));
    const zip = await JSZip.loadAsync(bytes);
    const core = await zip.file('docProps/core.xml')!.async('string');
    zip.file('docProps/core.xml', core.replace('</cp:coreProperties>', `<dc:description>${formatStamp(macStamp({ base: null }))}</dc:description></cp:coreProperties>`));
    const file = new File([await zip.generateAsync({ type: 'arraybuffer' })], 'Для приложения.xlsx');
    renderPage();
    await pickUp(file);
    const warning = await screen.findByRole('dialog', { name: 'Изменения не отправлены' }, { timeout: 10_000 });
    fireEvent.click(within(warning).getByRole('button', { name: 'Всё равно заменить' }));
    const sheet = await screen.findByRole('dialog', { name: 'Заменить данные в приложении' });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Заменить данные в приложении' }));
    expect(await screen.findByText('Данные с Mac загружены', {}, { timeout: 10_000 })).toBeTruthy();
    expect(data.value?.operations).toHaveLength(6);
    await actions.flush();
    expect(appMeta.value.sync).toEqual({ lastId: MAC_ID, lastAt: expect.any(String), syncedHash: await dataHash(data.value!) });
    expect(await screen.findByText('Всё отправлено')).toBeTruthy();
  }, 30_000);
});
