// The iCloud Drive sync stamp (spec 2026-10-01-icloud-sync): its text in docProps/core.xml <dc:description>,
// reading it back from a picked file, and the stable hash of a data set («есть неотправленные изменения»).
import { createHash } from 'node:crypto';
import JSZip from 'jszip';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  SyncError, canonicalJson, dataHash, formatStamp, newSyncId, parseStamp, readStamp, stampTime,
} from '../../src/io/sync';
import type { SyncStamp } from '../../src/io/sync';
import { exportBackup, importBackup } from '../../src/io/backup';
import { scenario } from '../engine/scenario';
import { fixture } from './fixture';

const STAMP: SyncStamp = { id: '0123456789abcdef', base: 'fedcba9876543210', dirty: true, at: '2026-10-01T12:34:56Z', from: 'app' };
const TEXT = 'money-planner-sync/1 id=0123456789abcdef base=fedcba9876543210 dirty=1 at=2026-10-01T12:34:56Z from=app';

/** `buf` with its docProps/core.xml given `description` in place, as the Mac does (no re-save). */
async function withDescription(buf: ArrayBuffer, description: string): Promise<ArrayBuffer> {
  const zip = await JSZip.loadAsync(buf);
  const xml = await zip.file('docProps/core.xml')!.async('string');
  zip.file('docProps/core.xml', xml.replace('</cp:coreProperties>', `<dc:description>${description}</dc:description></cp:coreProperties>`));
  return zip.generateAsync({ type: 'arraybuffer' });
}

describe('formatStamp', () => {
  it('writes the exact format both sides share', () => {
    expect(formatStamp(STAMP)).toBe(TEXT);
    expect(formatStamp({ ...STAMP, base: null, dirty: false, from: 'mac' })).toBe(
      'money-planner-sync/1 id=0123456789abcdef base=- dirty=0 at=2026-10-01T12:34:56Z from=mac',
    );
  });

  it('refuses to write a stamp the other side could not read', () => {
    expect(() => formatStamp({ ...STAMP, id: 'abc' })).toThrow();
    expect(() => formatStamp({ ...STAMP, base: 'XYZ' })).toThrow();
    expect(() => formatStamp({ ...STAMP, at: 'вчера' })).toThrow();
  });
});

describe('parseStamp', () => {
  it('reads what formatStamp writes', () => {
    expect(parseStamp(TEXT)).toEqual(STAMP);
    const mac: SyncStamp = { id: 'aaaaaaaaaaaaaaaa', base: null, dirty: false, at: '2026-10-02T08:00:00Z', from: 'mac' };
    expect(parseStamp(formatStamp(mac))).toEqual(mac);
  });

  it('not a sync stamp (nothing, or the user’s own description): null', () => {
    expect(parseStamp(undefined)).toBeNull();
    expect(parseStamp('')).toBeNull();
    expect(parseStamp('   ')).toBeNull();
    expect(parseStamp('Мой бюджет на 2026 год')).toBeNull();
  });

  it('tolerates spaces around it, other key order, upper-case hex, Python’s UTC forms and keys it does not know', () => {
    expect(parseStamp(`  ${TEXT}\n`)).toEqual(STAMP);
    expect(parseStamp('money-planner-sync/1 from=app at=2026-10-01T12:34:56Z dirty=1 base=FEDCBA9876543210 id=0123456789ABCDEF')).toEqual(STAMP);
    expect(parseStamp('money-planner-sync/1 id=0123456789abcdef base=- dirty=0 at=2026-10-01T12:34:56.123456+00:00 from=mac')?.at).toBe(
      '2026-10-01T12:34:56.123456+00:00',
    );
    expect(parseStamp(`${TEXT} host=imac`)).toEqual(STAMP);
  });

  it.each([
    ['no id', 'money-planner-sync/1 base=- dirty=0 at=2026-10-01T12:34:56Z from=mac'],
    ['a short id', 'money-planner-sync/1 id=0123 base=- dirty=0 at=2026-10-01T12:34:56Z from=mac'],
    ['a bad base', 'money-planner-sync/1 id=0123456789abcdef base=none dirty=0 at=2026-10-01T12:34:56Z from=mac'],
    ['a bad dirty', 'money-planner-sync/1 id=0123456789abcdef base=- dirty=yes at=2026-10-01T12:34:56Z from=mac'],
    ['a local time', 'money-planner-sync/1 id=0123456789abcdef base=- dirty=0 at=2026-10-01T12:34:56+02:00 from=mac'],
    ['no time', 'money-planner-sync/1 id=0123456789abcdef base=- dirty=0 at=2026-13-01T12:34:56Z from=mac'],
    ['an unknown side', 'money-planner-sync/1 id=0123456789abcdef base=- dirty=0 at=2026-10-01T12:34:56Z from=ipad'],
    ['a key twice', `${TEXT} id=aaaaaaaaaaaaaaaa`],
    ['a token without «=»', `${TEXT} oops`],
  ])('ours but unreadable (%s): SyncError, never read as «no stamp»', (_, text) => {
    expect(() => parseStamp(text)).toThrow(SyncError);
    expect(() => parseStamp(text)).toThrow('Отметка синхронизации в файле повреждена.');
  });

  it('a newer stamp version asks to update the app', () => {
    expect(() => parseStamp('money-planner-sync/2 id=0123456789abcdef')).toThrow(SyncError);
    expect(() => parseStamp('money-planner-sync/2 id=0123456789abcdef')).toThrow(
      'Файл сделан более новой версией синхронизации. Обновите приложение.',
    );
  });
});

describe('newSyncId and stampTime', () => {
  it('a new random 16-hex id each time', () => {
    const ids = new Set(Array.from({ length: 50 }, () => newSyncId()));
    expect(ids.size).toBe(50);
    for (const id of ids) expect(id).toMatch(/^[0-9a-f]{16}$/);
  });

  it('the time in UTC to the second, with Z', () => {
    expect(stampTime(new Date('2026-10-01T12:34:56.789Z'))).toBe('2026-10-01T12:34:56Z');
    expect(() => formatStamp({ ...STAMP, at: stampTime(new Date()) })).not.toThrow();
  });
});

describe('canonicalJson and dataHash', () => {
  it('canonical: keys sorted at every level, undefined properties left out, arrays kept in order', () => {
    expect(canonicalJson({ b: 1, a: { d: [3, { y: 1, x: undefined, w: 'з' }], c: null } })).toBe(
      '{"a":{"c":null,"d":[3,{"w":"з","y":1}]},"b":1}',
    );
    expect(canonicalJson({ a: -0 })).toBe('{"a":0}');
  });

  it('SHA-256 of the canonical JSON, hex', async () => {
    const d = scenario();
    const expected = createHash('sha256').update(canonicalJson(d), 'utf8').digest('hex');
    expect(await dataHash(d)).toBe(expected);
    expect(expected).toMatch(/^[0-9a-f]{64}$/);
  });

  it('stable: the same data in another key order or a copy gives the same hash', async () => {
    const d = scenario();
    const reordered = Object.fromEntries(Object.entries(structuredClone(d)).reverse()) as typeof d;
    expect(await dataHash(reordered)).toBe(await dataHash(d));
    expect(await dataHash(JSON.parse(JSON.stringify(d)) as typeof d)).toBe(await dataHash(d));
  });

  it('any change changes it', async () => {
    const d = scenario();
    const h = await dataHash(d);
    const op = d.operations[0]!;
    expect(await dataHash({ ...d, operations: [{ ...op, amount: op.amount + 0.01 }, ...d.operations.slice(1)] })).not.toBe(h);
    expect(await dataHash({ ...d, operations: [...d.operations].reverse() })).not.toBe(h);
    expect(await dataHash({ ...d, settings: { ...d.settings, cushion: d.settings.cushion + 1 } })).not.toBe(h);
  });
});

describe('readStamp — the stamp of a picked file', () => {
  afterEach(() => {
    vi.doUnmock('jszip');
    vi.resetModules();
  });

  it('a tracker the Mac stamped in place', async () => {
    const mac: SyncStamp = { id: 'aaaaaaaaaaaaaaaa', base: '0123456789abcdef', dirty: false, at: '2026-10-02T08:00:00Z', from: 'mac' };
    expect(await readStamp(await withDescription(fixture(), formatStamp(mac)))).toEqual(mac);
  });

  it('XML entities in the description are read as text', async () => {
    await expect(readStamp(await withDescription(fixture(), 'Бюджет &amp; планы'))).resolves.toBeNull();
    const escaped = TEXT.replace('from=app', 'from&#61;app');
    expect(await readStamp(await withDescription(fixture(), escaped))).toEqual(STAMP);
  });

  it('no stamp: a tracker without a description, the user’s own description, a file that is not a zip', async () => {
    expect(await readStamp(fixture())).toBeNull();
    expect(await readStamp(await withDescription(fixture(), 'Мой бюджет'))).toBeNull();
    expect(await readStamp(new TextEncoder().encode('not a zip').buffer as ArrayBuffer)).toBeNull();
    const zip = new JSZip();
    zip.file('hello.txt', 'hi');
    expect(await readStamp(await zip.generateAsync({ type: 'arraybuffer' }))).toBeNull();
  });

  it('a damaged stamp of ours rejects with SyncError', async () => {
    await expect(readStamp(await withDescription(fixture(), 'money-planner-sync/1 id=zz'))).rejects.toThrow(SyncError);
  });

  it('jszip that fails to download: asks to check the connection (not «no stamp»)', async () => {
    vi.resetModules();
    vi.doMock('jszip', () => Promise.reject(new TypeError('Failed to fetch dynamically imported module')));
    const { readStamp: read } = await import('../../src/io/sync');
    const error = await read(fixture()).catch((e: unknown) => e);
    expect((error as Error).name).toBe('SyncError');
    expect((error as Error).message).toBe('Не удалось загрузить модуль, проверьте подключение.');
  });
});

describe('exportBackup with a stamp — the file «Отправить на Mac» hands over', () => {
  it('lands in docProps/core.xml <dc:description>, reads back with readStamp, and the copy still restores', async () => {
    const d = scenario();
    const buf = await exportBackup(d, '2026-10-01T12:34:56.000Z', { stamp: TEXT });
    const core = await (await JSZip.loadAsync(buf)).file('docProps/core.xml')!.async('string');
    expect(core).toContain(`<dc:description>${TEXT}</dc:description>`);
    expect(await readStamp(buf)).toEqual(STAMP);
    expect(await importBackup(buf)).toEqual(d);
  });

  it('a plain backup carries no stamp', async () => {
    const buf = await exportBackup(scenario(), '2026-10-01T12:34:56.000Z');
    expect(await readStamp(buf)).toBeNull();
  });
});
