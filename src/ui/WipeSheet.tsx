// «Забыли PIN?»: the only way past a forgotten PIN is deleting everything in the app (data and PIN)
// and restoring from a backup (spec §7). Deleting needs the word «УДАЛИТЬ» typed exactly.
import { useState } from 'preact/hooks';
import { wipeAll } from '../store/db';
import { actions } from './actions';
import { ioErrorMessage } from './io';
import { Banner, Button, Section, Sheet, TextField } from './kit';
import { resetSession } from './state';

export const WIPE_WORD = 'УДАЛИТЬ';

export interface WipeSheetProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  /** The explanation above the confirmation word. */
  intro?: string;
  /** Called after everything was deleted and the session reset (the app then shows onboarding). */
  onWiped?: () => void;
}

const DEFAULT_INTRO =
  'PIN нельзя восстановить. Можно удалить из приложения все данные вместе с PIN и начать заново, а потом вернуть данные из резервной копии.';

export function WipeSheet({ open, onClose, title = 'Забыли PIN?', intro = DEFAULT_INTRO, onWiped }: WipeSheetProps) {
  const [word, setWord] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    if (busy) return;
    setWord(undefined);
    setError(null);
    onClose();
  };

  const wipe = async () => {
    if (word !== WIPE_WORD || busy) return;
    setBusy(true);
    setError(null);
    try {
      await actions.flush();
      await wipeAll();
    } catch (e) {
      setError(ioErrorMessage(e));
      setBusy(false);
      return;
    }
    resetSession();
    onWiped?.();
  };

  return (
    <Sheet open={open} title={title} onClose={close} left={<Button kind="plain" onClick={close}>Отмена</Button>}>
      <p class="sheet-text">{intro}</p>
      <Section footer="Удаление нельзя отменить. Без резервной копии данные пропадут.">
        <TextField
          label="Введите УДАЛИТЬ"
          value={word}
          onChange={setWord}
          placeholder={WIPE_WORD}
          autoCapitalize="characters"
          noAutocorrect
        />
      </Section>
      {error && <Banner tone="error">{error}</Banner>}
      <div class="sheet-actions">
        <Button kind="destructive" full disabled={word !== WIPE_WORD || busy} onClick={() => void wipe()}>
          Удалить все данные
        </Button>
      </div>
    </Sheet>
  );
}
