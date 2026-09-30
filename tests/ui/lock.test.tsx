// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { IDBFactory } from 'fake-indexeddb';
import { emptyData } from '../../src/engine';
import type { Data } from '../../src/engine';
import * as db from '../../src/store/db';
import * as pin from '../../src/store/pin';
import { setPin } from '../../src/store/pin';
import { actions } from '../../src/ui/actions';
import { PinPad } from '../../src/ui/kit';
import { Lock } from '../../src/ui/Lock';
import { LOCK_AFTER_MS, noteHidden, noteVisible } from '../../src/ui/session';
import { data, locked, meta, resetSession } from '../../src/ui/state';

vi.mock('../../src/store/db', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../src/store/db')>();
  return {
    ...mod, wipeAll: vi.fn(mod.wipeAll), loadMeta: vi.fn(mod.loadMeta), saveMeta: vi.fn(mod.saveMeta),
    updateStoredMeta: vi.fn(mod.updateStoredMeta),
  };
});

vi.mock('../../src/store/pin', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../src/store/pin')>();
  return { ...mod, checkPin: vi.fn(mod.checkPin) };
});

const MIN = 60_000;

/** Makes the next checkPin wait until the returned function is called. */
function holdNextCheck(): () => void {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const real = vi.mocked(pin.checkPin).getMockImplementation()!;
  vi.mocked(pin.checkPin).mockImplementationOnce(async (...args) => {
    await gate;
    return real(...args);
  });
  return release;
}

const PIN = '2580';

async function withPin(extra: Partial<db.Meta> = {}): Promise<void> {
  const m = { ...(await setPin({ failedAttempts: 0 }, PIN)), ...extra };
  await db.saveMeta(m);
  meta.value = m;
  const d = emptyData('2026-09-30');
  await db.saveData(d);
  data.value = d;
  locked.value = true;
}

function key(digit: string): HTMLButtonElement {
  return screen.getByRole('button', { name: digit }) as HTMLButtonElement;
}

async function enter(pin: string): Promise<void> {
  await waitFor(() => expect(key('1').disabled).toBe(false));
  for (const d of pin) fireEvent.click(key(d));
}

beforeEach(() => {
  vi.mocked(db.wipeAll).mockClear();
  vi.mocked(db.loadMeta).mockReset(); // the real loadMeta
  vi.mocked(db.saveMeta).mockReset(); // the real saveMeta
  vi.mocked(db.updateStoredMeta).mockReset(); // the real updateStoredMeta (the app's meta writes)
  vi.mocked(pin.checkPin).mockClear();
  db.useFactory(new IDBFactory());
  resetSession();
});

afterEach(async () => {
  cleanup();
  await actions.flush();
  resetSession();
  db.useFactory(undefined);
  vi.useRealTimers();
});

describe('Lock', () => {
  it('has a labelled keypad: digits 0–9 and delete', async () => {
    await withPin();
    render(<Lock />);
    expect(screen.getByRole('heading', { name: 'Введите PIN' })).toBeTruthy();
    for (const d of '0123456789') expect(key(d)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Удалить цифру' })).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Введено цифр: 0 из 4' })).toBeTruthy();
  });

  it('the correct PIN unlocks', async () => {
    await withPin({ failedAttempts: 2 });
    render(<Lock />);
    await enter(PIN);
    await waitFor(() => expect(locked.value).toBe(false));
    expect((await db.loadMeta()).failedAttempts).toBe(0);
  });

  it('delete removes the last digit', async () => {
    await withPin();
    render(<Lock />);
    fireEvent.click(key('1'));
    fireEvent.click(key('2'));
    expect(screen.getByRole('img', { name: 'Введено цифр: 2 из 4' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Удалить цифру' }));
    expect(screen.getByRole('img', { name: 'Введено цифр: 1 из 4' })).toBeTruthy();
  });

  it('a wrong PIN clears the dots, says so and is counted in the stored meta', async () => {
    await withPin();
    render(<Lock />);
    await enter('0000');
    expect(await screen.findByText('Неверный PIN')).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Введено цифр: 0 из 4' })).toBeTruthy();
    expect(locked.value).toBe(true);
    // saved before the result was shown, so a reload does not reset the counter
    expect((await db.loadMeta()).failedAttempts).toBe(1);
  });

  it('after 5 wrong PINs: a countdown and a disabled keypad', async () => {
    await withPin();
    render(<Lock />);
    for (let i = 0; i < 4; i++) {
      await enter('1111');
      await screen.findByText('Неверный PIN');
      await waitFor(() => expect(screen.getByRole('img', { name: 'Введено цифр: 0 из 4' })).toBeTruthy());
    }
    await enter('1111');
    expect(await screen.findByText(/Попробуйте через (30|29) с/)).toBeTruthy();
    expect(key('5').disabled).toBe(true);
    expect(locked.value).toBe(true);
    const stored = await db.loadMeta();
    expect(stored.failedAttempts).toBe(5);
    expect(stored.lockedUntil).toBeGreaterThan(Date.now());
  }, 20_000);

  it('a pause saved before a restart is shown at once', async () => {
    await withPin({ failedAttempts: 5, lockedUntil: Date.now() + 90_000 });
    render(<Lock />);
    expect(screen.getByText(/Попробуйте через 1 мин (30|29) с/)).toBeTruthy();
    expect(key('1').disabled).toBe(true);
  });

  it('a pause ending more than 30 min away (clock moved back) is cut to 30 min, saved, and the keypad follows it', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const now = Date.now();
    await withPin({ failedAttempts: 9, lockedUntil: now + 24 * 60 * MIN });
    render(<Lock />);
    await waitFor(async () => expect((await db.loadMeta()).lockedUntil).toBe(now + 30 * MIN));
    expect(meta.value.lockedUntil).toBe(now + 30 * MIN);
    expect(meta.value.failedAttempts).toBe(9);
    expect(screen.getByText('Попробуйте через 30 мин')).toBeTruthy();
    expect(key('1').disabled).toBe(true);
    vi.setSystemTime(now + 30 * MIN + 1_000);
    await waitFor(() => expect(key('1').disabled).toBe(false), { timeout: 3_000 });
    expect(screen.queryByText(/Попробуйте через/)).toBeNull();
  });

  it('the keypad comes back when the pause is over', async () => {
    await withPin({ failedAttempts: 5, lockedUntil: Date.now() + 1_200 });
    render(<Lock />);
    expect(key('1').disabled).toBe(true);
    await waitFor(() => expect(key('1').disabled).toBe(false), { timeout: 3_000 });
    expect(screen.queryByText(/Попробуйте через/)).toBeNull();
  });

  it('damaged PIN data never unlocks: keypad off, «Забыли PIN?» still there', async () => {
    await withPin({ pinIterations: -1 });
    render(<Lock />);
    await enter(PIN);
    expect(await screen.findByText(/Не удалось проверить PIN/)).toBeTruthy();
    expect(locked.value).toBe(true);
    expect(key('1').disabled).toBe(true);
    expect(screen.getByRole('button', { name: 'Забыли PIN?' })).toBeTruthy();
  });

  it('the hardware keyboard types digits', async () => {
    await withPin();
    render(<Lock />);
    for (const d of PIN) fireEvent.keyDown(document, { key: d });
    await waitFor(() => expect(locked.value).toBe(false));
  });
});

describe('Lock — racing the PIN check', () => {
  it('an unlock that finishes after the app locked again (hidden > 5 min meanwhile) does not unlock', async () => {
    await withPin();
    const release = holdNextCheck();
    render(<Lock />);
    await enter(PIN);
    act(() => {
      noteHidden(1_000_000);
      noteVisible(1_000_000 + LOCK_AFTER_MS + 1);
    });
    release();
    await waitFor(() => expect(key('1').disabled).toBe(false));
    expect(locked.value).toBe(true);
    // the next correct PIN unlocks as usual
    await enter(PIN);
    await waitFor(() => expect(locked.value).toBe(false));
  });

  it('a wrong PIN recorded while a backup is being marked keeps both (read-modify-write of the meta)', async () => {
    await withPin();
    const release = holdNextCheck();
    render(<Lock />);
    await enter('0000');
    await actions.markBackupDone();
    release();
    expect(await screen.findByText('Неверный PIN')).toBeTruthy();
    await actions.flush();
    const stored = await db.loadMeta();
    expect(stored.failedAttempts).toBe(1);
    expect(stored.lastBackupAt).toBeDefined();
    expect(meta.value).toEqual(stored);
  });
});

describe('Lock — another tab (the stored counter and pause)', () => {
  it('mistakes counted in another tab count here: stored 4, memory 1 → the next wrong PIN is the 5th and pauses', async () => {
    await withPin({ failedAttempts: 1 });
    await db.saveMeta({ ...meta.value, failedAttempts: 4 }); // another tab made three more mistakes
    render(<Lock />);
    await enter('0000');
    expect(await screen.findByText(/Попробуйте через (30|29) с/)).toBeTruthy();
    expect(key('1').disabled).toBe(true);
    expect(locked.value).toBe(true);
    const stored = await db.loadMeta();
    expect(stored.failedAttempts).toBe(5);
    expect(stored.lockedUntil).toBeGreaterThan(Date.now());
    expect(meta.value.failedAttempts).toBe(5);
  });

  it('a pause started in another tab holds here: even the right PIN does not unlock', async () => {
    await withPin();
    await db.saveMeta({ ...meta.value, failedAttempts: 5, lockedUntil: Date.now() + 60_000 });
    render(<Lock />);
    await enter(PIN);
    expect(await screen.findByText(/Попробуйте через (1 мин|59 с)/)).toBeTruthy();
    expect(key('1').disabled).toBe(true);
    expect(locked.value).toBe(true);
    expect((await db.loadMeta()).failedAttempts).toBe(5);
  });

  it('when the stored meta cannot be read, the PIN is not checked: no unlock, nothing counted, the next try works', async () => {
    await withPin({ failedAttempts: 2 });
    vi.mocked(db.loadMeta).mockRejectedValueOnce(new db.StoreError('Не удалось прочитать сохранённые данные.', { code: 'read' }));
    render(<Lock />);
    await enter(PIN);
    expect(await screen.findByText('Не удалось прочитать сохранённые данные.')).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Введено цифр: 0 из 4' })).toBeTruthy();
    expect(locked.value).toBe(true);
    expect(pin.checkPin).not.toHaveBeenCalled();
    expect((await db.loadMeta()).failedAttempts).toBe(2);
    expect(screen.getByRole('button', { name: 'Забыли PIN?' })).toBeTruthy();
    await enter(PIN);
    await waitFor(() => expect(locked.value).toBe(false));
  });
});

describe('Lock — another tab changed or removed the PIN (this tab unlocks only with the PIN it was started with)', () => {
  const OTHER = '1111';
  const REMOVED = 'PIN удалён в другой вкладке. Перезапустите приложение.';
  const CHANGED = 'PIN изменён в другой вкладке. Перезапустите приложение.';

  /** The owner's tab: the owner's PIN and data in memory, locked. */
  async function staleTab(extra: Partial<db.Meta> = {}): Promise<{ mine: db.Meta; owner: Data }> {
    await withPin(extra);
    const owner = emptyData('2026-01-01'); // the owner's data, still in this tab's memory
    data.value = owner;
    return { mine: meta.value, owner };
  }

  /** Another tab: «Забыли PIN?», then onboarding with a new PIN and new data. */
  async function wipeAndSetUpElsewhere(): Promise<db.Meta> {
    await db.wipeAll();
    const theirs = await setPin({ failedAttempts: 0 }, OTHER);
    await db.saveMeta(theirs);
    await db.saveData(emptyData('2026-09-30'));
    vi.mocked(db.saveMeta).mockClear();
    vi.mocked(db.updateStoredMeta).mockClear();
    return theirs;
  }

  it('a PIN changed in another tab: the old PIN is rejected, nothing is written (the stored hash stays the new one), the keypad turns off', async () => {
    const { mine } = await staleTab();
    const changed = await setPin({ failedAttempts: 0 }, OTHER);
    await db.saveMeta(changed); // another tab changed the PIN
    vi.mocked(db.saveMeta).mockClear();
    vi.mocked(db.updateStoredMeta).mockClear();
    render(<Lock />);
    await enter(PIN);
    expect(await screen.findByText(CHANGED)).toBeTruthy();
    expect(locked.value).toBe(true);
    expect(pin.checkPin).not.toHaveBeenCalled();
    await actions.flush();
    expect(vi.mocked(db.saveMeta)).not.toHaveBeenCalled();
    expect(vi.mocked(db.updateStoredMeta)).not.toHaveBeenCalled();
    expect(await db.loadMeta()).toEqual(changed);
    expect(meta.value).toBe(mine); // never takes the other PIN
    expect(key('1').disabled).toBe(true); // nothing to check until a restart
    expect(screen.getByRole('button', { name: 'Забыли PIN?' })).toBeTruthy();
  });

  it('a PIN changed in another tab: the new PIN does not unlock this tab either', async () => {
    const { mine } = await staleTab();
    const changed = await setPin({ failedAttempts: 0 }, OTHER);
    await db.saveMeta(changed);
    vi.mocked(db.saveMeta).mockClear();
    vi.mocked(db.updateStoredMeta).mockClear();
    render(<Lock />);
    await enter(OTHER);
    expect(await screen.findByText(CHANGED)).toBeTruthy();
    expect(locked.value).toBe(true);
    await actions.flush();
    expect(vi.mocked(db.saveMeta)).not.toHaveBeenCalled();
    expect(vi.mocked(db.updateStoredMeta)).not.toHaveBeenCalled();
    expect(await db.loadMeta()).toEqual(changed);
    expect(meta.value).toBe(mine);
    expect(key('1').disabled).toBe(true);
  });

  it('data wiped and a new PIN set up in another tab: the newcomer’s PIN never unlocks this tab, its data is never shown', async () => {
    const { mine, owner } = await staleTab();
    const theirs = await wipeAndSetUpElsewhere();
    render(<Lock />);
    await enter(OTHER);
    expect(await screen.findByText(CHANGED)).toBeTruthy();
    await new Promise((r) => setTimeout(r, 100));
    await actions.flush();
    expect(locked.value).toBe(true); // the owner's data in memory stays behind the lock
    expect(data.value).toBe(owner);
    expect(pin.checkPin).not.toHaveBeenCalled();
    expect(vi.mocked(db.saveMeta)).not.toHaveBeenCalled();
    expect(vi.mocked(db.updateStoredMeta)).not.toHaveBeenCalled();
    expect(await db.loadMeta()).toEqual(theirs);
    expect(meta.value).toBe(mine);
    expect(key('1').disabled).toBe(true);
    for (const d of OTHER) fireEvent.click(key(d)); // disabled keys: no second try
    await actions.flush();
    expect(pin.checkPin).not.toHaveBeenCalled();
    expect(locked.value).toBe(true);
    expect(screen.getByRole('button', { name: 'Забыли PIN?' })).toBeTruthy();
  });

  it('data wiped and a new PIN set up in another tab during a pause the clock moved back: the cut writes nothing, and after the pause the newcomer’s PIN does not unlock', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const now = Date.now();
    const until = now + 24 * 60 * MIN;
    const { mine } = await staleTab({ failedAttempts: 9, lockedUntil: until });
    const theirs = await wipeAndSetUpElsewhere();
    render(<Lock />);
    await waitFor(() => expect(vi.mocked(db.loadMeta)).toHaveBeenCalled()); // the cut reads the stored meta…
    await vi.mocked(db.loadMeta).mock.results.at(-1)!.value;
    await new Promise((r) => setTimeout(r, 50));
    await actions.flush();
    expect(vi.mocked(db.saveMeta)).not.toHaveBeenCalled();
    expect(vi.mocked(db.updateStoredMeta)).not.toHaveBeenCalled(); // …and writes nothing
    expect(await db.loadMeta()).toEqual(theirs);
    expect(meta.value).toBe(mine); // never takes the newcomer's PIN
    expect(key('1').disabled).toBe(true);
    vi.setSystemTime(until + 1_000);
    await enter(OTHER);
    expect(await screen.findByText(CHANGED)).toBeTruthy();
    expect(locked.value).toBe(true);
    expect(pin.checkPin).not.toHaveBeenCalled();
    await actions.flush();
    expect(vi.mocked(db.saveMeta)).not.toHaveBeenCalled();
    expect(vi.mocked(db.updateStoredMeta)).not.toHaveBeenCalled();
    expect(await db.loadMeta()).toEqual(theirs);
  });

  it('data wiped in another tab («Забыли PIN?»): no check, nothing written, stays locked', async () => {
    await withPin();
    await db.wipeAll(); // another tab
    render(<Lock />);
    await enter(PIN);
    expect(await screen.findByText(REMOVED)).toBeTruthy();
    expect(locked.value).toBe(true);
    expect(pin.checkPin).not.toHaveBeenCalled();
    await actions.flush();
    expect(await db.loadMeta()).toEqual({ failedAttempts: 0 });
    expect(await db.loadData()).toBeNull();
    expect(key('1').disabled).toBe(true); // nothing to check until a restart
    expect(screen.getByRole('button', { name: 'Забыли PIN?' })).toBeTruthy();
  });

  it.each([
    ['the right old PIN', PIN],
    ['a wrong PIN', '0000'],
  ])('a PIN changed while the check runs: %s does not unlock, nothing is written, the keypad turns off', async (_label, typed) => {
    const { mine } = await staleTab({ failedAttempts: 4 });
    const release = holdNextCheck();
    render(<Lock />);
    await enter(typed);
    await waitFor(() => expect(pin.checkPin).toHaveBeenCalled());
    const changed = { ...(await setPin({ failedAttempts: 0 }, OTHER)), failedAttempts: 9, lockedUntil: Date.now() + 20 * MIN };
    await db.saveMeta(changed); // another tab changed the PIN and counted mistakes
    vi.mocked(db.saveMeta).mockClear();
    vi.mocked(db.updateStoredMeta).mockClear();
    release();
    expect(await screen.findByText(CHANGED)).toBeTruthy();
    expect(locked.value).toBe(true);
    await actions.flush();
    expect(vi.mocked(db.saveMeta)).not.toHaveBeenCalled();
    expect(vi.mocked(db.updateStoredMeta)).not.toHaveBeenCalled();
    expect(await db.loadMeta()).toEqual(changed);
    expect(meta.value).toBe(mine);
    expect(key('1').disabled).toBe(true);
  });

  it('a PIN changed while the check runs and the read after it fails: no unlock, nothing written', async () => {
    const { mine } = await staleTab();
    const release = holdNextCheck();
    render(<Lock />);
    await enter(PIN);
    await waitFor(() => expect(pin.checkPin).toHaveBeenCalled());
    const changed = { ...(await setPin({ failedAttempts: 0 }, OTHER)), failedAttempts: 3 };
    await db.saveMeta(changed);
    vi.mocked(db.saveMeta).mockClear();
    vi.mocked(db.updateStoredMeta).mockClear();
    vi.mocked(db.loadMeta).mockRejectedValueOnce(new db.StoreError('Не удалось прочитать сохранённые данные.', { code: 'read' }));
    release();
    expect(await screen.findByText('Не удалось прочитать сохранённые данные.')).toBeTruthy();
    expect(locked.value).toBe(true);
    await actions.flush();
    expect(vi.mocked(db.saveMeta)).not.toHaveBeenCalled();
    expect(vi.mocked(db.updateStoredMeta)).not.toHaveBeenCalled();
    expect(await db.loadMeta()).toEqual(changed);
    expect(meta.value).toBe(mine);
  });

  it('when the read after the check fails, the result is not accepted and nothing is written; the next try reads again', async () => {
    const { mine } = await staleTab({ failedAttempts: 2 });
    const release = holdNextCheck();
    render(<Lock />);
    await enter(PIN);
    await waitFor(() => expect(pin.checkPin).toHaveBeenCalled());
    vi.mocked(db.saveMeta).mockClear();
    vi.mocked(db.updateStoredMeta).mockClear();
    vi.mocked(db.loadMeta).mockRejectedValueOnce(new db.StoreError('Не удалось прочитать сохранённые данные.', { code: 'read' }));
    release();
    expect(await screen.findByText('Не удалось прочитать сохранённые данные.')).toBeTruthy();
    expect(locked.value).toBe(true);
    await actions.flush();
    expect(vi.mocked(db.saveMeta)).not.toHaveBeenCalled();
    expect(vi.mocked(db.updateStoredMeta)).not.toHaveBeenCalled();
    expect((await db.loadMeta()).failedAttempts).toBe(2);
    expect(meta.value).toBe(mine);
    await enter(PIN);
    await waitFor(() => expect(locked.value).toBe(false));
  });

  it('a PIN removed while the check runs (another tab wiped): no unlock, nothing written back', async () => {
    await withPin();
    const release = holdNextCheck();
    render(<Lock />);
    await enter(PIN);
    await waitFor(() => expect(pin.checkPin).toHaveBeenCalled());
    await db.wipeAll(); // another tab
    release();
    expect(await screen.findByText(REMOVED)).toBeTruthy();
    expect(locked.value).toBe(true);
    await actions.flush();
    expect(await db.loadMeta()).toEqual({ failedAttempts: 0 });
    expect(key('1').disabled).toBe(true);
  });

  it('the same PIN, another tab counts mistakes while a wrong PIN is checked here: the stored counter and pause are never lowered', async () => {
    const { mine } = await staleTab();
    const release = holdNextCheck();
    render(<Lock />);
    await enter('0000');
    await waitFor(() => expect(pin.checkPin).toHaveBeenCalled());
    const later = Date.now() + 4 * MIN;
    await db.saveMeta({ ...mine, failedAttempts: 7, lockedUntil: later }); // another tab, same PIN
    release();
    expect(await screen.findByText(/Попробуйте через (4 мин|3 мин \d+ с)/)).toBeTruthy();
    expect(locked.value).toBe(true);
    await actions.flush();
    const stored = await db.loadMeta();
    expect(stored.failedAttempts).toBe(7);
    expect(stored.lockedUntil).toBe(later);
    expect([stored.pinHash, stored.pinSalt, stored.pinIterations]).toEqual([mine.pinHash, mine.pinSalt, mine.pinIterations]);
    expect(meta.value).toEqual(stored);
    expect(key('1').disabled).toBe(true);
  });
});

describe('PinPad and hidden screens', () => {
  it.each([
    ['hidden and inert (the app behind the lock)', { hidden: true, inert: true }],
    ['hidden', { hidden: true }],
    ['inert', { inert: true }],
  ])('a PinPad inside a %s subtree ignores the hardware keyboard; the lock pad gets the digits', (_label, attrs) => {
    const behind = vi.fn();
    const front = vi.fn();
    render(
      <div>
        <div {...attrs}>
          <PinPad title="Новый PIN" value="" onChange={behind} inPage />
        </div>
        <PinPad title="Введите PIN" value="" onChange={front} />
      </div>,
    );
    fireEvent.keyDown(document.body, { key: '5' });
    expect(behind).not.toHaveBeenCalled();
    expect(front).toHaveBeenCalledWith('5');
  });
});

describe('Forgot PIN', () => {
  async function openForgot(): Promise<HTMLButtonElement> {
    await withPin();
    render(<Lock />);
    fireEvent.click(screen.getByRole('button', { name: 'Забыли PIN?' }));
    await screen.findByRole('dialog', { name: 'Забыли PIN?' });
    return screen.getByRole('button', { name: 'Удалить все данные' }) as HTMLButtonElement;
  }

  function typeWord(word: string): void {
    fireEvent.input(screen.getByLabelText('Введите УДАЛИТЬ'), { target: { value: word } });
  }

  it('explains that only a backup brings the data back', async () => {
    await openForgot();
    expect(screen.getByText(/вернуть\s+данные из резервной копии/)).toBeTruthy();
  });

  it('deletes only after exactly «УДАЛИТЬ»', async () => {
    const wipe = vi.mocked(db.wipeAll);
    const button = await openForgot();
    expect(button.disabled).toBe(true);
    for (const word of ['удалить', 'Удалить', 'УДАЛИТЬ ', ' УДАЛИТЬ', 'УДАЛИТ', 'DELETE']) {
      typeWord(word);
      expect(button.disabled, word).toBe(true);
    }
    fireEvent.click(button);
    expect(wipe).not.toHaveBeenCalled();
    typeWord('УДАЛИТЬ');
    expect(button.disabled).toBe(false);
  });

  it('«УДАЛИТЬ» wipes the data and the PIN', async () => {
    const button = await openForgot();
    typeWord('УДАЛИТЬ');
    fireEvent.click(button);
    await waitFor(() => expect(data.value).toBeNull());
    expect(meta.value.pinHash).toBeUndefined();
    expect(locked.value).toBe(false);
    expect(await db.loadData()).toBeNull();
    expect((await db.loadMeta()).pinHash).toBeUndefined();
  });

  it('a failed wipe says so and keeps everything', async () => {
    vi.mocked(db.wipeAll).mockRejectedValueOnce(new db.StoreError('Не удалось удалить данные.'));
    const button = await openForgot();
    typeWord('УДАЛИТЬ');
    fireEvent.click(button);
    expect(await screen.findByText('Не удалось удалить данные.')).toBeTruthy();
    expect(data.value).not.toBeNull();
    expect(meta.value.pinHash).toBeDefined();
    expect(locked.value).toBe(true);
  });
});

describe('Lock — hardware keyboard and sheets', () => {
  it('keys typed inside the «Забыли PIN?» sheet never reach the keypad', async () => {
    await withPin();
    render(<Lock />);
    fireEvent.click(screen.getByRole('button', { name: 'Забыли PIN?' }));
    const dialog = await screen.findByRole('dialog', { name: 'Забыли PIN?' });
    for (const d of PIN) fireEvent.keyDown(dialog, { key: d });
    expect(screen.getByRole('img', { name: 'Введено цифр: 0 из 4' })).toBeTruthy();
    expect(locked.value).toBe(true);
  });

  it('a sheet left open elsewhere (hidden behind the lock) does not block the keyboard', async () => {
    await withPin();
    document.documentElement.classList.add('modal-open');
    try {
      render(<Lock />);
      for (const d of PIN) fireEvent.keyDown(document.body, { key: d });
      await waitFor(() => expect(locked.value).toBe(false));
    } finally {
      document.documentElement.classList.remove('modal-open');
    }
  });
});
