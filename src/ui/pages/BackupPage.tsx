// Page «Резервная копия» (registered as 'backup' in src/ui/pages.ts); owner: D6.
// «Сделать копию» — the full backup through backupNow() (share sheet or download; the date is recorded).
// «Восстановить из копии» — reads a backup made by this app, shows what is in it and replaces the data
// only after the user's choice (ReplaceDataSheet: not undoable, «Сначала сделать копию» offered).
import './BackupPage.css';
import { needsBackup } from '../actions';
import { copying, makeCopy } from '../backupCopy';
import { formatDate, localDateOf } from '../format';
import { loadBackup } from '../io';
import { Banner, Button, Page, Row, Section, showToast } from '../kit';
import type { RoutedPageProps } from '../nav';
import { data, meta } from '../state';
import { ReplaceDataSheet, usePickedFile } from './ReplaceDataSheet';
import type { PendingReplace } from './ReplaceDataSheet';

async function readBackup(buf: ArrayBuffer): Promise<PendingReplace> {
  const { importBackup } = await loadBackup();
  return { data: await importBackup(buf), notes: [], overrides: [] };
}

export function BackupPage(_props: RoutedPageProps) {
  const file = usePickedFile();
  const last = localDateOf(meta.value.lastBackupAt);
  const due = needsBackup(meta.value, data.value);

  const onReplaced = () => {
    file.clear();
    showToast('Данные восстановлены');
  };

  return (
    <Page title="Резервная копия">
      {due && (
        <Banner tone="warning">
          {last
            ? 'Копии не было больше 14 дней. Если iPhone удалит данные сайта, вернуть их можно только из копии.'
            : 'Копию ещё не делали. Если iPhone удалит данные сайта, вернуть их можно только из копии.'}
        </Banner>
      )}
      <Section footer="Копия — файл Excel со всеми данными приложения. Сохраните его в «Файлы» или отправьте себе: из него данные можно вернуть на этом или другом iPhone.">
        <Row title="Последняя копия" value={last ? formatDate(last) : 'ещё не было'} valueTone={due ? 'orange' : 'default'} />
      </Section>
      <div class="backup-actions">
        {/* straight from the tap: Safari opens the share sheet only then */}
        <Button full disabled={copying.value} onClick={() => void makeCopy()}>
          Сделать копию
        </Button>
      </div>
      <Section
        header="Восстановление"
        footer="Все данные в приложении заменятся данными из копии. Перед этим можно сделать копию того, что есть сейчас."
      >
        <Row
          icon="repeat"
          title="Восстановить из копии"
          subtitle={file.reading ? 'Читаю файл…' : 'Файл, выгруженный из этого приложения'}
          chevron
          onClick={() => file.pick(readBackup)}
        />
      </Section>
      {file.error && <Banner tone="error">{file.error}</Banner>}
      <ReplaceDataSheet key={file.opened} pending={file.pending} onClose={file.clear} onReplaced={onReplaced} />
    </Page>
  );
}
