// 4-digit PIN lock (spec §7): PBKDF2-SHA-256 hash with a random salt via WebCrypto, constant-time
// comparison, growing pause after repeated mistakes. A lock against casual eyes, not encryption.
import { StoreError } from './db';
import type { Meta } from './db';

export const PIN_ITERATIONS = 150_000;

const MSG_UNCHECKED = 'Не удалось проверить PIN. Если не получается войти, используйте «Забыли PIN?».';
const SALT_BYTES = 16;
const HASH_BITS = 256;
const FREE_ATTEMPTS = 4; // mistakes allowed before the first pause
const FIRST_PAUSE_MS = 30_000;
/** The longest pause checkPin makes; a pause ending further ahead means the clock moved back. */
export const MAX_PAUSE_MS = 30 * 60_000;

/** Exactly four ASCII digits. */
export function isValidPin(pin: string): boolean {
  return typeof pin === 'string' && /^[0-9]{4}$/.test(pin);
}

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function fromBase64(b64: string): Uint8Array<ArrayBuffer> {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/** 16 random bytes, base64. */
export function newSalt(): string {
  return toBase64(globalThis.crypto.getRandomValues(new Uint8Array(SALT_BYTES)));
}

async function deriveHash(pin: string, salt: string, iterations: number): Promise<Uint8Array> {
  const subtle = globalThis.crypto.subtle;
  const key = await subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: fromBase64(salt), iterations }, key, HASH_BITS);
  return new Uint8Array(bits);
}

/** PBKDF2-SHA-256 of the PIN, 256 bits, base64. */
export async function hashPin(pin: string, salt: string, iterations = PIN_ITERATIONS): Promise<string> {
  return toBase64(await deriveHash(pin, salt, iterations));
}

/** Compares in time that depends only on the lengths, never on where the bytes differ. */
function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

function withoutLock(meta: Meta): Meta {
  const next: Meta = { ...meta, failedAttempts: 0 };
  delete next.lockedUntil;
  return next;
}

/** New salt and hash for `pin`; resets the failed attempts and the pause. */
export async function setPin(meta: Meta, pin: string): Promise<Meta> {
  if (!isValidPin(pin)) throw new Error('PIN должен состоять из 4 цифр.');
  const pinSalt = newSalt();
  const pinHash = await hashPin(pin, pinSalt, PIN_ITERATIONS);
  return { ...withoutLock(meta), pinHash, pinSalt, pinIterations: PIN_ITERATIONS };
}

/** The stored iteration count (the default when absent); anything but a positive integer is damage. */
function storedIterations(meta: Meta): number {
  const n: unknown = meta.pinIterations;
  if (n === undefined) return PIN_ITERATIONS;
  if (typeof n !== 'number' || !Number.isSafeInteger(n) || n < 1) throw new StoreError(MSG_UNCHECKED);
  return n;
}

async function matches(meta: Meta, pin: string): Promise<boolean> {
  if (!isValidPin(pin) || !meta.pinHash || !meta.pinSalt) return false;
  const iterations = storedIterations(meta);
  try {
    const actual = await deriveHash(pin, meta.pinSalt, iterations);
    return constantTimeEqual(actual, fromBase64(meta.pinHash));
  } catch (e) {
    // salt or hash that cannot be decoded, or a WebCrypto failure: never ok
    throw new StoreError(MSG_UNCHECKED, { cause: e });
  }
}

/**
 * Checks `pin` at time `now` (epoch ms). During a pause nothing is checked and the meta is returned
 * unchanged, except when the pause ends more than 30 minutes from now (the clock moved back) or its end
 * is not a number: then the wait is 30 minutes and the pause end is rewritten to `now` + 30 min.
 * Rejects with StoreError, never ok, when `now` is not finite or the stored PIN data is damaged.
 * The caller must save the returned meta, so the counter survives a reload.
 */
export async function checkPin(meta: Meta, pin: string, now: number): Promise<{ ok: boolean; meta: Meta; waitMs: number }> {
  if (!Number.isFinite(now)) throw new StoreError(MSG_UNCHECKED);
  const until: unknown = meta.lockedUntil;
  if (until !== undefined) {
    const remaining = typeof until === 'number' ? until - now : Number.NaN;
    if (!(remaining <= MAX_PAUSE_MS)) {
      return { ok: false, meta: { ...meta, lockedUntil: now + MAX_PAUSE_MS }, waitMs: MAX_PAUSE_MS };
    }
    if (remaining > 0) return { ok: false, meta, waitMs: remaining };
  }
  if (await matches(meta, pin)) return { ok: true, meta: withoutLock(meta), waitMs: 0 };
  const failedAttempts = meta.failedAttempts + 1;
  const waitMs = lockDelayMs(failedAttempts);
  // a free mistake stores no pause end, so a clock moved back cannot turn it into a pause
  const next: Meta = { ...meta, failedAttempts };
  if (waitMs > 0) next.lockedUntil = now + waitMs;
  else delete next.lockedUntil;
  return { ok: false, meta: next, waitMs };
}

/**
 * Pause after `failedAttempts` mistakes in a row: none before 5, then 30 s doubling each time, at most
 * 30 min. A count that is not finite (damaged) gets the longest pause, never none.
 */
export function lockDelayMs(failedAttempts: number): number {
  if (!Number.isFinite(failedAttempts)) return MAX_PAUSE_MS;
  if (failedAttempts <= FREE_ATTEMPTS) return 0;
  return Math.min(MAX_PAUSE_MS, FIRST_PAUSE_MS * 2 ** (failedAttempts - FREE_ATTEMPTS - 1));
}
