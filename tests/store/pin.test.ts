import { afterEach, describe, expect, it, vi } from 'vitest';
import { pbkdf2Sync } from 'node:crypto';
import { PIN_ITERATIONS, checkPin, hashPin, isValidPin, lockDelayMs, newSalt, setPin } from '../../src/store/pin';
import { StoreError } from '../../src/store/db';
import type { Meta } from '../../src/store/db';

const SEC = 1000;
const MIN = 60 * SEC;
const NOW = Date.UTC(2026, 8, 30, 12, 0, 0);
const UNCHECKED = 'Не удалось проверить PIN. Если не получается войти, используйте «Забыли PIN?».';

afterEach(() => {
  vi.restoreAllMocks();
});

async function rejection(p: Promise<unknown>): Promise<Error> {
  try {
    await p;
  } catch (e) {
    return e as Error;
  }
  throw new Error('expected the promise to reject');
}

function bytes(b64: string): Buffer {
  return Buffer.from(b64, 'base64');
}

/** Same base64 hash with its last byte flipped. */
function flipLastByte(b64: string): string {
  const b = bytes(b64);
  b[b.length - 1] = (b[b.length - 1] ?? 0) ^ 1;
  return b.toString('base64');
}

describe('isValidPin', () => {
  it('accepts exactly four ASCII digits', () => {
    expect(isValidPin('1234')).toBe(true);
    expect(isValidPin('0000')).toBe(true);
    expect(isValidPin('9870')).toBe(true);
  });

  it.each([
    ['too short', '123'],
    ['too long', '12345'],
    ['a letter', '12a4'],
    ['Arabic-Indic digits', '١٢٣٤'],
    ['fullwidth digits', '１２３４'],
    ['empty', ''],
    ['spaces', ' 1234'],
    ['a trailing newline', '1234\n'],
    ['a sign', '-123'],
  ])('refuses %s', (_label, pin) => {
    expect(isValidPin(pin)).toBe(false);
  });
});

describe('newSalt', () => {
  it('is 16 random bytes in base64', () => {
    const a = newSalt();
    const b = newSalt();
    expect(bytes(a)).toHaveLength(16);
    expect(bytes(a).toString('base64')).toBe(a);
    expect(a).not.toBe(b);
  });
});

describe('hashPin', () => {
  it('uses 150 000 iterations by default', () => {
    expect(PIN_ITERATIONS).toBe(150_000);
  });

  it('is PBKDF2-SHA-256 with a 256-bit result in base64', async () => {
    const salt = newSalt();
    const expected = pbkdf2Sync('1234', bytes(salt), 150_000, 32, 'sha256').toString('base64');
    expect(await hashPin('1234', salt)).toBe(expected);
  });

  it('honours the iteration count', async () => {
    const salt = newSalt();
    const expected = pbkdf2Sync('1234', bytes(salt), 1000, 32, 'sha256').toString('base64');
    expect(await hashPin('1234', salt, 1000)).toBe(expected);
    expect(await hashPin('1234', salt, 1000)).not.toBe(await hashPin('1234', salt));
  });

  it('is deterministic for the same PIN and salt', async () => {
    const salt = newSalt();
    expect(await hashPin('4321', salt)).toBe(await hashPin('4321', salt));
  });

  it('differs for a different salt', async () => {
    expect(await hashPin('4321', newSalt())).not.toBe(await hashPin('4321', newSalt()));
  });

  it('differs for a different PIN', async () => {
    const salt = newSalt();
    expect(await hashPin('4321', salt)).not.toBe(await hashPin('4322', salt));
  });
});

describe('setPin', () => {
  it('stores a fresh salt, the hash and at least 150 000 iterations', async () => {
    const meta = await setPin({ failedAttempts: 0, lastBackupAt: '2026-09-29T08:00:00.000Z' }, '2580');
    expect(meta.pinIterations).toBeGreaterThanOrEqual(150_000);
    expect(meta.pinIterations).toBe(PIN_ITERATIONS);
    expect(meta.pinSalt).toBeDefined();
    expect(bytes(meta.pinSalt ?? '')).toHaveLength(16);
    expect(meta.pinHash).toBe(await hashPin('2580', meta.pinSalt ?? '', 150_000));
    expect(meta.lastBackupAt).toBe('2026-09-29T08:00:00.000Z');
  });

  it('does not keep the PIN itself', async () => {
    const meta = await setPin({ failedAttempts: 0 }, '2580');
    expect(JSON.stringify(meta)).not.toContain('2580');
  });

  it('resets failed attempts and the lockout', async () => {
    const meta = await setPin({ failedAttempts: 7, lockedUntil: NOW + 10 * MIN }, '2580');
    expect(meta.failedAttempts).toBe(0);
    expect(meta.lockedUntil).toBeUndefined();
    expect('lockedUntil' in meta).toBe(false);
  });

  it('uses a new salt every time', async () => {
    const a = await setPin({ failedAttempts: 0 }, '2580');
    const b = await setPin({ failedAttempts: 0 }, '2580');
    expect(a.pinSalt).not.toBe(b.pinSalt);
    expect(a.pinHash).not.toBe(b.pinHash);
  });

  it('refuses a PIN that is not four digits', async () => {
    await expect(setPin({ failedAttempts: 0 }, '123')).rejects.toThrow();
    await expect(setPin({ failedAttempts: 0 }, '١٢٣٤')).rejects.toThrow();
  });
});

describe('lockDelayMs', () => {
  it('lets the first four mistakes go', () => {
    expect([0, 1, 2, 3, 4].map(lockDelayMs)).toEqual([0, 0, 0, 0, 0]);
  });

  it('pauses 30 s after the fifth and doubles after each further one', () => {
    expect([5, 6, 7, 8, 9, 10].map(lockDelayMs)).toEqual([30 * SEC, 60 * SEC, 2 * MIN, 4 * MIN, 8 * MIN, 16 * MIN]);
  });

  it('caps the pause at 30 minutes', () => {
    expect(lockDelayMs(11)).toBe(30 * MIN);
    expect(lockDelayMs(12)).toBe(30 * MIN);
    expect(lockDelayMs(1000)).toBe(30 * MIN);
    expect(lockDelayMs(Number.MAX_SAFE_INTEGER)).toBe(30 * MIN);
  });

  it('treats a damaged count as the longest pause, never as none', () => {
    expect(lockDelayMs(Number.NaN)).toBe(30 * MIN);
    expect(lockDelayMs(Number.POSITIVE_INFINITY)).toBe(30 * MIN);
    expect(lockDelayMs(Number.NEGATIVE_INFINITY)).toBe(30 * MIN);
  });
});

describe('checkPin', () => {
  it('opens with the right PIN and clears the counter', async () => {
    const meta = { ...(await setPin({ failedAttempts: 0 }, '2580')), failedAttempts: 3, lockedUntil: NOW - 1 };
    const res = await checkPin(meta, '2580', NOW);
    expect(res.ok).toBe(true);
    expect(res.waitMs).toBe(0);
    expect(res.meta.failedAttempts).toBe(0);
    expect(res.meta.lockedUntil).toBeUndefined();
    expect(res.meta.pinHash).toBe(meta.pinHash);
    expect(res.meta.pinSalt).toBe(meta.pinSalt);
    expect(res.meta.pinIterations).toBe(meta.pinIterations);
  });

  it('refuses a wrong PIN and counts it', async () => {
    const meta = await setPin({ failedAttempts: 0 }, '2580');
    const res = await checkPin(meta, '0852', NOW);
    expect(res.ok).toBe(false);
    expect(res.waitMs).toBe(0);
    expect(res.meta.failedAttempts).toBe(1);
    expect(res.meta.pinHash).toBe(meta.pinHash);
  });

  it('does not change the meta it was given', async () => {
    const meta = { ...(await setPin({ failedAttempts: 0 }, '2580')), failedAttempts: 2, lockedUntil: NOW - 1 };
    const copy = structuredClone(meta);
    await checkPin(meta, '0000', NOW);
    await checkPin(meta, '2580', NOW);
    expect(meta).toEqual(copy);
  });

  it('pauses 30 s after five wrong PINs, 60 s after six', async () => {
    let meta: Meta = await setPin({ failedAttempts: 0 }, '2580');
    let now = NOW;
    for (let i = 1; i <= 4; i++) {
      const res = await checkPin(meta, '1111', now);
      expect(res).toMatchObject({ ok: false, waitMs: 0 });
      meta = res.meta;
    }
    const fifth = await checkPin(meta, '1111', now);
    expect(fifth.ok).toBe(false);
    expect(fifth.waitMs).toBe(30 * SEC);
    expect(fifth.meta).toMatchObject({ failedAttempts: 5, lockedUntil: now + 30 * SEC });

    now += 30 * SEC;
    const sixth = await checkPin(fifth.meta, '1111', now);
    expect(sixth.waitMs).toBe(60 * SEC);
    expect(sixth.meta).toMatchObject({ failedAttempts: 6, lockedUntil: now + 60 * SEC });
  });

  it('never pauses longer than 30 minutes', async () => {
    const meta = { ...(await setPin({ failedAttempts: 0 }, '2580')), failedAttempts: 40 };
    const res = await checkPin(meta, '1111', NOW);
    expect(res.waitMs).toBe(30 * MIN);
    expect(res.meta).toMatchObject({ failedAttempts: 41, lockedUntil: NOW + 30 * MIN });
  });

  it('refuses even the right PIN during a pause, without hashing or changing the meta', async () => {
    const meta = { ...(await setPin({ failedAttempts: 0 }, '2580')), failedAttempts: 5, lockedUntil: NOW + 30 * SEC };
    const derive = vi.spyOn(globalThis.crypto.subtle, 'deriveBits');
    const res = await checkPin(meta, '2580', NOW + 10 * SEC);
    expect(res.ok).toBe(false);
    expect(res.waitMs).toBe(20 * SEC);
    expect(res.meta).toBe(meta);
    expect(derive).not.toHaveBeenCalled();
  });

  it('accepts the right PIN once the pause is over', async () => {
    const meta = { ...(await setPin({ failedAttempts: 0 }, '2580')), failedAttempts: 5, lockedUntil: NOW + 30 * SEC };
    const res = await checkPin(meta, '2580', NOW + 30 * SEC);
    expect(res.ok).toBe(true);
    expect(res.meta.failedAttempts).toBe(0);
    expect(res.meta.lockedUntil).toBeUndefined();
  });

  it('verifies with the iteration count stored in the meta', async () => {
    const salt = newSalt();
    const meta: Meta = { pinSalt: salt, pinHash: await hashPin('2580', salt, 200_000), pinIterations: 200_000, failedAttempts: 0 };
    expect((await checkPin(meta, '2580', NOW)).ok).toBe(true);
  });

  it('refuses a stored hash that differs in a single byte', async () => {
    const meta = await setPin({ failedAttempts: 0 }, '2580');
    const tampered = { ...meta, pinHash: flipLastByte(meta.pinHash ?? '') };
    expect((await checkPin(tampered, '2580', NOW)).ok).toBe(false);
  });

  it('refuses a stored hash of another length', async () => {
    const meta = await setPin({ failedAttempts: 0 }, '2580');
    const short = bytes(meta.pinHash ?? '').subarray(0, 16).toString('base64');
    const long = Buffer.concat([bytes(meta.pinHash ?? ''), Buffer.alloc(4)]).toString('base64');
    expect((await checkPin({ ...meta, pinHash: short }, '2580', NOW)).ok).toBe(false);
    expect((await checkPin({ ...meta, pinHash: long }, '2580', NOW)).ok).toBe(false);
    expect((await checkPin({ ...meta, pinHash: '' }, '2580', NOW)).ok).toBe(false);
  });

  it('opens nothing when no PIN is stored', async () => {
    const res = await checkPin({ failedAttempts: 0 }, '2580', NOW);
    expect(res.ok).toBe(false);
    expect(res.meta.failedAttempts).toBe(1);
  });

  it('counts a malformed PIN as a wrong one', async () => {
    const meta = await setPin({ failedAttempts: 0 }, '2580');
    const res = await checkPin(meta, '25800', NOW);
    expect(res.ok).toBe(false);
    expect(res.meta.failedAttempts).toBe(1);
  });

  it('pauses for the maximum after a mistake on a damaged counter', async () => {
    const meta = { ...(await setPin({ failedAttempts: 0 }, '2580')), failedAttempts: Number.NaN };
    const res = await checkPin(meta, '1111', NOW);
    expect(res.ok).toBe(false);
    expect(res.waitMs).toBe(30 * MIN);
    expect(res.meta.lockedUntil).toBe(NOW + 30 * MIN);
  });
});

describe('checkPin and the clock', () => {
  it('keeps no pause end for the four free mistakes, and drops a stale one', async () => {
    let meta: Meta = { ...(await setPin({ failedAttempts: 0 }, '2580')), lockedUntil: NOW - MIN };
    for (let i = 1; i <= 4; i++) {
      const res = await checkPin(meta, '1111', NOW);
      expect(res).toMatchObject({ ok: false, waitMs: 0 });
      expect(res.meta.failedAttempts).toBe(i);
      expect('lockedUntil' in res.meta).toBe(false);
      meta = res.meta;
    }
  });

  it('does not turn a free mistake into a pause when the clock moves back', async () => {
    const meta = await setPin({ failedAttempts: 0 }, '2580');
    const wrong = await checkPin(meta, '1111', NOW);
    const res = await checkPin(wrong.meta, '2580', NOW - 60 * MIN);
    expect(res.ok).toBe(true);
  });

  it('caps the wait at 30 minutes and rewrites the pause end when the clock moved back', async () => {
    const meta = { ...(await setPin({ failedAttempts: 0 }, '2580')), failedAttempts: 6, lockedUntil: NOW + MIN };
    const copy = structuredClone(meta);
    const derive = vi.spyOn(globalThis.crypto.subtle, 'deriveBits');
    const back = NOW - 5 * 60 * MIN; // the clock moved back five hours
    const res = await checkPin(meta, '2580', back);
    expect(res.ok).toBe(false);
    expect(res.waitMs).toBe(30 * MIN);
    expect(res.meta).toEqual({ ...meta, lockedUntil: back + 30 * MIN });
    expect(meta).toEqual(copy);
    expect(derive).not.toHaveBeenCalled();
    derive.mockRestore();
    expect((await checkPin(res.meta, '2580', back + 30 * MIN)).ok).toBe(true);
  });

  it('leaves a pause of exactly 30 minutes as it is', async () => {
    const meta = { ...(await setPin({ failedAttempts: 0 }, '2580')), failedAttempts: 11, lockedUntil: NOW + 30 * MIN };
    const res = await checkPin(meta, '2580', NOW);
    expect(res).toMatchObject({ ok: false, waitMs: 30 * MIN });
    expect(res.meta).toBe(meta);
    const later = await checkPin(meta, '2580', NOW - 1);
    expect(later).toMatchObject({ ok: false, waitMs: 30 * MIN });
    expect(later.meta.lockedUntil).toBe(NOW - 1 + 30 * MIN);
  });

  it('treats a pause end that is not a number as the longest pause', async () => {
    const meta = { ...(await setPin({ failedAttempts: 0 }, '2580')), failedAttempts: 5, lockedUntil: Number.NaN };
    const res = await checkPin(meta, '2580', NOW);
    expect(res).toMatchObject({ ok: false, waitMs: 30 * MIN });
    expect(res.meta.lockedUntil).toBe(NOW + 30 * MIN);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'refuses to check at a time of %s, without hashing',
    async (now) => {
      const meta = await setPin({ failedAttempts: 0 }, '2580');
      const derive = vi.spyOn(globalThis.crypto.subtle, 'deriveBits');
      const e = await rejection(checkPin(meta, '2580', now));
      expect(e).toBeInstanceOf(StoreError);
      expect(e.message).toBe(UNCHECKED);
      const paused = { ...meta, failedAttempts: 5, lockedUntil: NOW + MIN };
      expect(await rejection(checkPin(paused, '2580', now))).toBeInstanceOf(StoreError);
      expect(derive).not.toHaveBeenCalled();
    },
  );
});

describe('checkPin on a damaged meta', () => {
  it.each([
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['negative', -1],
    ['zero', 0],
    ['fractional', 1.5],
    ['null', null],
    ['a string', '150000'],
  ])('fails closed when the stored iteration count is %s', async (_label, pinIterations) => {
    const meta = { ...(await setPin({ failedAttempts: 0 }, '2580')), pinIterations } as unknown as Meta;
    const e = await rejection(checkPin(meta, '2580', NOW));
    expect(e).toBeInstanceOf(StoreError);
    expect(e.message).toBe(UNCHECKED);
  });

  it.each([
    ['hash', { pinHash: '%%% not base64 %%%' }],
    ['salt', { pinSalt: '%%% not base64 %%%' }],
  ])('fails closed with the «Забыли PIN?» hint when the stored %s cannot be decoded', async (_label, damage) => {
    const meta = { ...(await setPin({ failedAttempts: 0 }, '2580')), ...damage };
    const e = await rejection(checkPin(meta, '2580', NOW));
    expect(e).toBeInstanceOf(StoreError);
    expect(e.message).toBe(UNCHECKED);
    expect(e.cause).toBeDefined();
  });

  it('fails closed with the «Забыли PIN?» hint when hashing fails', async () => {
    const meta = await setPin({ failedAttempts: 0 }, '2580');
    const failure = new DOMException('boom', 'OperationError');
    vi.spyOn(globalThis.crypto.subtle, 'deriveBits').mockRejectedValue(failure);
    const e = await rejection(checkPin(meta, '2580', NOW));
    expect(e).toBeInstanceOf(StoreError);
    expect(e.message).toBe(UNCHECKED);
    expect(e.cause).toBe(failure);
  });
});
