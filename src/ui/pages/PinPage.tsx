// Page «PIN» — changing the PIN (registered as 'pin' in src/ui/pages.ts); owner: D6.
// Current PIN → new PIN → the new PIN again. The current PIN goes through checkPin exactly like the lock
// screen (checkLockPin in lockState.ts): only the PIN this tab was started with goes on, and only while it
// is still the stored PIN, with the stricter counter and pause of storage and memory (another tab may have
// counted mistakes; when a read fails nothing is accepted or written); its mistake counter and pause are
// saved BEFORE the result is shown, a pause holds here too (one more than 30 min ahead — the clock moved
// back — is cut to 30 min and saved, as on the lock screen), and damaged PIN data, no PIN stored, or
// another PIN stored («Забыли PIN?» or a PIN change in another tab) never lets the change go on and turns
// the keypad off. The digits live only in this component's state (cleared after use) and only the hash of
// the new PIN is saved — onto the stored meta, only over the PIN checked on the first step: when another tab
// changed or removed it meanwhile, nothing is written and the keypad turns off («PIN изменён/удалён в другой
// вкладке…»). Locking the app forgets the checked PIN: after unlocking, the page starts over; a
// check or a save that outlives a lock does nothing (a new PIN whose write has not started when the app
// locks is not written). The helpers shared with the lock screen are in lockState.ts.
import { useContext, useEffect, useState } from 'preact/hooks';
import type { Meta } from '../../store/db';
import { setPin } from '../../store/pin';
import { actions } from '../actions';
import { ioErrorMessage } from '../io';
import { Page, PinPad, showToast } from '../kit';
import { PIN_LENGTH, PinChangedError, PinRemovedError, checkLockPin, formatWait, useCutLongPause, usePause } from '../lockState';
import { PageContext, popPage } from '../nav';
import type { RoutedPageProps } from '../nav';
import { lockGeneration } from '../session';
import { hasPin, locked, meta, samePin } from '../state';

const SAVE_FAILED = 'Не удалось сохранить новый PIN. Старый PIN действует.';

type Step = 'current' | 'new' | 'repeat';

const TITLE: Record<Step, string> = { current: 'Текущий PIN', new: 'Новый PIN', repeat: 'Повторите новый PIN' };
const HINT: Record<Step, string> = {
  current: 'PIN, которым открываете приложение',
  new: 'Четыре цифры',
  repeat: 'Введите новый PIN ещё раз',
};

export function PinPage(_props: RoutedPageProps) {
  const ctx = useContext(PageContext);
  const [step, setStep] = useState<Step>('current');
  const [entry, setEntry] = useState('');
  const [first, setFirst] = useState('');
  const [busy, setBusy] = useState(false);
  const [wrong, setWrong] = useState(false);
  const [mismatch, setMismatch] = useState(false);
  const [broken, setBroken] = useState<string | null>(null);
  const [unread, setUnread] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [shake, setShake] = useState(0);
  const until = meta.value.lockedUntil;
  const pause = usePause(until);
  const isLocked = locked.value;
  useCutLongPause(until); // as on the lock screen: a pause too far ahead is cut to 30 min and saved

  const startOver = () => {
    setStep('current');
    setEntry('');
    setFirst('');
    setWrong(false);
    setUnread(null);
    setMismatch(false);
    setError(null);
  };

  // the app locked: forget the checked PIN and the new one typed so far
  useEffect(() => {
    if (isLocked) startOver();
  }, [isLocked]);

  const verify = async (pin: string) => {
    setBusy(true);
    const since = lockGeneration();
    const result = await checkLockPin(pin); // the counter and the pause are saved before it resolves
    setEntry('');
    setBusy(false);
    if (result.kind === 'broken') {
      // damaged PIN data, no working crypto, or the PIN removed or changed in another tab: never go on
      setBroken(ioErrorMessage(result.error));
      return;
    }
    if (lockGeneration() !== since) return; // locked meanwhile: the page has started over
    if (result.kind === 'unread') {
      // the stored meta cannot be read: not accepted, nothing written; the next try reads it again
      setUnread(ioErrorMessage(result.error));
      return;
    }
    if (result.ok) {
      setStep('new');
      return;
    }
    setShake((n) => n + 1);
    setWrong(result.waitMs === 0);
  };

  const save = async (pin: string) => {
    setBusy(true);
    const since = lockGeneration();
    const checked = meta.value; // the PIN checked on the first step
    try {
      const n = await setPin(checked, pin);
      if (lockGeneration() !== since) throw new Error('locked while saving');
      await actions.updateMeta(
        (m) => {
          // the write may have waited behind another meta write: not after a lock
          if (lockGeneration() !== since) throw new Error('locked while saving');
          // written only over the PIN checked here: never over one another tab set (or into wiped storage)
          if (!hasPin(m)) throw new PinRemovedError();
          if (!samePin(m, checked)) throw new PinChangedError();
          const next: Meta = {
            ...m, pinHash: n.pinHash, pinSalt: n.pinSalt, pinIterations: n.pinIterations, failedAttempts: 0,
          };
          delete next.lockedUntil; // a new PIN also ends a pause
          return next;
        },
        { pin: true },
      );
    } catch (e) {
      setFirst('');
      setEntry('');
      setBusy(false);
      if (lockGeneration() !== since) return;
      if (e instanceof PinRemovedError || e instanceof PinChangedError) {
        setBroken(ioErrorMessage(e)); // nothing written; nothing more until a restart
        return;
      }
      setError(SAVE_FAILED);
      setStep('new');
      return;
    }
    setBusy(false);
    startOver();
    showToast('PIN изменён');
    if (ctx && ctx.depth > 0) popPage(ctx.tab);
  };

  const onChange = (value: string) => {
    setWrong(false);
    setUnread(null);
    setMismatch(false);
    setError(null);
    setEntry(value);
    if (value.length < PIN_LENGTH) return;
    if (step === 'current') {
      void verify(value);
    } else if (step === 'new') {
      setFirst(value);
      setEntry('');
      setStep('repeat');
    } else if (value !== first) {
      setFirst('');
      setEntry('');
      setMismatch(true);
      setShake((n) => n + 1);
      setStep('new');
    } else {
      setFirst('');
      void save(value);
    }
  };

  const paused = step === 'current' && pause > 0;
  let message = HINT[step];
  let tone: 'default' | 'error' = 'default';
  if (broken) [message, tone] = [broken, 'error'];
  else if (paused) [message, tone] = [`Попробуйте через ${formatWait(pause)}`, 'error'];
  else if (unread) [message, tone] = [unread, 'error'];
  else if (wrong) [message, tone] = ['Неверный PIN', 'error'];
  else if (mismatch) [message, tone] = ['PIN не совпадает. Попробуйте ещё раз.', 'error'];
  else if (error) [message, tone] = [error, 'error'];

  return (
    <Page title="PIN-код">
      <PinPad
        inPage
        title={TITLE[step]}
        message={message}
        messageTone={tone}
        value={entry}
        onChange={onChange}
        length={PIN_LENGTH}
        disabled={busy || paused || broken !== null}
        shake={shake}
        footer={
          step !== 'current' ? (
            <p class="pin-note">Если забудете PIN, данные можно вернуть только из резервной копии.</p>
          ) : undefined
        }
      />
    </Page>
  );
}
