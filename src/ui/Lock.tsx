// PIN screen: shown on every start and after 5 minutes in the background. The PIN is checked with
// checkLockPin (lockState.ts): only the PIN this tab was started with unlocks it, and only while that is
// still the stored PIN (read just before and just after the check), with the stricter counter and pause of
// storage and memory (another tab may have counted mistakes); when a read fails nothing is accepted or
// written. The returned counter and pause are saved BEFORE the result is shown (a read-modify-write of the
// stored meta in one transaction), so a reload cannot reset them. Damaged PIN data, no PIN stored («Забыли
// PIN?» in another tab), or another PIN stored (changed in another tab) never unlocks and turns the keypad
// off; «Забыли PIN?» is always there. Another data set stored (wiped and set up anew in another tab — this
// tab still holds the older data) never unlocks either: the tab stops and App shows the stop screen instead
// (generation.ts). A check that outlives an auto-lock does not unlock. The helpers shared with the «PIN» page (the check, cutting a pause
// the clock moved back, the countdown) are in lockState.ts.
import { useState } from 'preact/hooks';
import { ioErrorMessage } from './io';
import { PinPad } from './kit';
import { PIN_LENGTH, checkLockPin, formatWait, useCutLongPause, usePause } from './lockState';
import { lockGeneration, unlockIfCurrent } from './session';
import { meta } from './state';
import { WipeSheet } from './WipeSheet';

export function Lock() {
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [wrong, setWrong] = useState(false);
  const [broken, setBroken] = useState<string | null>(null);
  const [unread, setUnread] = useState<string | null>(null);
  const [shake, setShake] = useState(0);
  const [forgot, setForgot] = useState(false);
  const until = meta.value.lockedUntil;
  const pause = usePause(until);
  useCutLongPause(until); // the keypad follows the cut pause

  const onChange = async (value: string) => {
    setWrong(false);
    setUnread(null);
    setPin(value);
    if (value.length < PIN_LENGTH) return;
    setBusy(true);
    const since = lockGeneration();
    const result = await checkLockPin(value); // the counter and the pause are saved before it resolves
    setPin('');
    setBusy(false);
    if (result.kind === 'unread') {
      // the stored meta cannot be read: never unlocks, nothing written; the next try reads it again
      setUnread(ioErrorMessage(result.error));
      return;
    }
    if (result.kind === 'broken') {
      // damaged PIN data, no working crypto, or the PIN removed or changed in another tab: never unlock
      setBroken(ioErrorMessage(result.error));
      return;
    }
    if (result.ok) {
      unlockIfCurrent(since); // not when the app locked again while the PIN was being checked
      return;
    }
    setShake((n) => n + 1);
    setWrong(result.waitMs === 0);
  };

  let message: string | undefined;
  if (broken) message = broken;
  else if (pause > 0) message = `Попробуйте через ${formatWait(pause)}`;
  else if (unread) message = unread;
  else if (wrong) message = 'Неверный PIN';

  return (
    <div class="lock-screen">
      <PinPad
        title="Введите PIN"
        message={message}
        messageTone={message ? 'error' : 'default'}
        value={pin}
        onChange={(v) => void onChange(v)}
        length={PIN_LENGTH}
        disabled={busy || pause > 0 || broken !== null}
        shake={shake}
        footer={
          <button type="button" class="link-button" onClick={() => setForgot(true)}>
            Забыли PIN?
          </button>
        }
      />
      <WipeSheet open={forgot} onClose={() => setForgot(false)} />
    </div>
  );
}
