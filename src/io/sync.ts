// The iCloud Drive sync with the Mac (spec .internal/specs/2026-10-01-icloud-sync.md), the app's half of
// the file format: the stamp both sides write into docProps/core.xml <dc:description>
//   money-planner-sync/1 id=<16 hex> base=<16 hex|-> dirty=<0|1> at=<ISO-8601 UTC> from=<app|mac>
// reading it back from a picked file, and the stable hash of a data set (canonical JSON → SHA-256), which
// tells whether the app holds changes it has not sent. Pure, no ExcelJS; jszip is loaded lazily, only by
// readStamp. Loaded by the UI through src/ui/io.ts (loadSync), like every module here.
import type JSZip from 'jszip';
import type { Data } from '../engine/model';

/** A stamp that is ours but cannot be read, or a library that failed to load; the message is for the user. */
export class SyncError extends Error {
  override name = 'SyncError';
}

export type SyncFrom = 'app' | 'mac';

export interface SyncStamp {
  /** This file's version: 16 random hex digits. */
  id: string;
  /** The last version the sender had seen from the other side (null: none, written «-»). */
  base: string | null;
  /** The sender had changes after `base`. */
  dirty: boolean;
  /** When it was written, ISO-8601 in UTC. */
  at: string;
  from: SyncFrom;
}

const PREFIX = 'money-planner-sync/';
const VERSION = 1;
const ID = /^[0-9a-f]{16}$/i;
/** ISO-8601 in UTC: Z or a zero offset (Python writes «+00:00»), seconds required, any fraction. */
const UTC_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(?:Z|[+-]00:?00)$/;

const DAMAGED = 'Отметка синхронизации в файле повреждена. Выберите «Для приложения.xlsx» из папки «Трекер расходов — синхронизация».';
const NEWER = 'Файл сделан более новой версией синхронизации. Обновите приложение.';
const MODULE_FAILED = 'Не удалось загрузить модуль, проверьте подключение.';

function validTime(at: string): boolean {
  const m = UTC_TIME.exec(at);
  if (!m) return false;
  const [y, mo, d, h, mi, s] = m.slice(1, 7).map(Number) as [number, number, number, number, number, number];
  const t = new Date(Date.UTC(y, mo - 1, d, h, mi, s));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d && h < 24 && mi < 60 && s < 60;
}

/** The stamp's text. Throws (a programming error) for fields the other side could not read. */
export function formatStamp(s: SyncStamp): string {
  if (!ID.test(s.id) || (s.base !== null && !ID.test(s.base)) || !validTime(s.at) || (s.from !== 'app' && s.from !== 'mac')) {
    throw new Error(`Invalid sync stamp: ${JSON.stringify(s)}`);
  }
  const base = s.base === null ? '-' : s.base.toLowerCase();
  return `${PREFIX}${VERSION} id=${s.id.toLowerCase()} base=${base} dirty=${s.dirty ? 1 : 0} at=${s.at} from=${s.from}`;
}

/**
 * The stamp in a description: null when there is none or the text is not a sync stamp (a description of
 * the user's own). A stamp of ours that cannot be read — or of a newer version — throws SyncError: it is
 * never taken for «no stamp» (the file would then be loaded as a plain tracker, past the sync checks).
 * Keys in any order; keys it does not know are ignored; hex in any case (kept lower-case).
 */
export function parseStamp(text: string | undefined): SyncStamp | null {
  const tokens = (text ?? '').trim().split(/\s+/).filter(Boolean);
  const head = tokens[0];
  if (head === undefined || !head.startsWith(PREFIX)) return null;
  const version = head.slice(PREFIX.length);
  if (version !== String(VERSION)) {
    throw new SyncError(/^\d+$/.test(version) && Number(version) > VERSION ? NEWER : DAMAGED);
  }
  const fields = new Map<string, string>();
  for (const token of tokens.slice(1)) {
    const eq = token.indexOf('=');
    if (eq <= 0) throw new SyncError(DAMAGED);
    const key = token.slice(0, eq);
    if (fields.has(key)) throw new SyncError(DAMAGED);
    fields.set(key, token.slice(eq + 1));
  }
  const id = fields.get('id');
  const base = fields.get('base');
  const dirty = fields.get('dirty');
  const at = fields.get('at');
  const from = fields.get('from');
  if (
    id === undefined || !ID.test(id) ||
    base === undefined || (base !== '-' && !ID.test(base)) ||
    (dirty !== '0' && dirty !== '1') ||
    at === undefined || !validTime(at) ||
    (from !== 'app' && from !== 'mac')
  ) {
    throw new SyncError(DAMAGED);
  }
  return { id: id.toLowerCase(), base: base === '-' ? null : base.toLowerCase(), dirty: dirty === '1', at, from };
}

/** A new random version id: 8 random bytes, 16 hex digits. */
export function newSyncId(): string {
  return Array.from(globalThis.crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** `date` as the stamp writes it: UTC, to the second, with Z ('2026-10-01T12:34:56Z'). */
export function stampTime(date: Date): string {
  return `${date.toISOString().slice(0, 19)}Z`;
}

// ---------- the data hash ----------

/**
 * JSON with the keys of every object sorted and the properties set to undefined left out (as JSON does);
 * arrays keep their order. The same data set always gives the same text, however its objects were built.
 */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((v) => (v === undefined ? 'null' : canonicalJson(v))).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/** SHA-256 (WebCrypto) of the data set's canonical JSON, as 64 hex digits. */
export async function dataHash(data: Data): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalJson(data)));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

// ---------- reading the stamp of a file ----------

const CORE = 'docProps/core.xml';
const DESCRIPTION = /<(?:[\w.-]+:)?description\b[^>]*?(?:\/>|>([\s\S]*?)<\/(?:[\w.-]+:)?description>)/;
const ENTITY = /&(?:#(\d+)|#x([0-9a-f]+)|(amp|lt|gt|quot|apos));/gi;
const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function unescapeXml(text: string): string {
  return text.replace(ENTITY, (whole, dec: string | undefined, hex: string | undefined, name: string | undefined) => {
    if (name) return NAMED[name.toLowerCase()] ?? whole;
    const code = dec !== undefined ? Number(dec) : parseInt(hex ?? '', 16);
    return Number.isInteger(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
  });
}

/**
 * The sync stamp of an .xlsx (docProps/core.xml <dc:description>); null when it has none — or is not an
 * .xlsx at all (the import that follows says what is wrong with the file). A damaged stamp of ours rejects
 * with SyncError, and so does jszip failing to download (a connection problem, not «no stamp»).
 */
export async function readStamp(buf: ArrayBuffer): Promise<SyncStamp | null> {
  let Zip: typeof JSZip;
  try {
    Zip = (await import('jszip')).default;
  } catch {
    throw new SyncError(MODULE_FAILED);
  }
  let xml: string | undefined;
  try {
    xml = await (await Zip.loadAsync(buf)).file(CORE)?.async('string');
  } catch {
    return null; // not a zip
  }
  if (xml === undefined) return null;
  const m = DESCRIPTION.exec(xml);
  return m ? parseStamp(unescapeXml(m[1] ?? '')) : null;
}
