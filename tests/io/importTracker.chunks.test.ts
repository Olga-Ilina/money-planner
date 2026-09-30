// A lazily loaded library that fails to download (offline, a stale deploy) is a connection
// problem, not a broken file, and the message must say so.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

function fixture(): ArrayBuffer {
  const file = readFileSync(join(import.meta.dirname, '../fixtures/tracker-scenario.xlsx'));
  return file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer;
}

const CHUNK_FAILED = () => Promise.reject(new TypeError('Failed to fetch dynamically imported module'));

async function importWithout(module: 'jszip' | 'exceljs'): Promise<unknown> {
  vi.resetModules();
  vi.doMock(module, CHUNK_FAILED);
  const { importTracker } = await import('../../src/io/importTracker');
  return importTracker(fixture()).catch((e: unknown) => e);
}

describe('importTracker — a library chunk that fails to load', () => {
  afterEach(() => {
    vi.doUnmock('jszip');
    vi.doUnmock('exceljs');
    vi.resetModules();
  });

  it.each(['jszip', 'exceljs'] as const)('%s: asks to check the connection, does not call the file broken', async (module) => {
    const error = await importWithout(module);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).name).toBe('TrackerImportError');
    expect((error as Error).message).toBe('Не удалось загрузить модуль, проверьте подключение.');
  });
});
