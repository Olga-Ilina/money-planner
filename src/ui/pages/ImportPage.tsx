// Page «Загрузить трекер» (registered as 'import' in src/ui/pages.ts); owner: D6.
// Reads the Excel tracker, shows what is in it next to what is in the app, and only after the user
// chooses «Заменить данные в приложении» (with «Сначала сделать копию» offered) replaces everything —
// not undoable (ReplaceDataSheet). A tracker the Mac stamped («Для приложения.xlsx») also sets the sync
// state, as «Забрать с Mac» does (sync.ts: readTrackerStamped, setSyncFromImport).
import './ImportPage.css';
import { actions } from '../actions';
import { formatDate, localDateOf } from '../format';
import { Banner, Button, Page, Row, Section, showToast } from '../kit';
import type { RoutedPageProps } from '../nav';
import { meta } from '../state';
import { readTrackerStamped, setSyncFromImport } from '../sync';
import { ReplaceDataSheet, usePickedFile } from './ReplaceDataSheet';

export function ImportPage(_props: RoutedPageProps) {
  const file = usePickedFile<Awaited<ReturnType<typeof readTrackerStamped>>>();
  const last = localDateOf(meta.value.lastImportAt);

  const onReplaced = () => {
    const at = new Date().toISOString();
    const mac = file.pending?.mac;
    // only a date shown here: a failed save of it is not worth a message
    actions.updateMeta((m) => ({ ...m, lastImportAt: at })).catch(() => {});
    file.clear();
    showToast('Трекер загружен');
    if (mac) void setSyncFromImport(mac); // after the toast: a failure replaces it with its own
  };

  return (
    <Page title="Загрузить трекер" subtitle="Файл Excel «Трекер и планер расходов»">
      <Section footer={last ? `Последняя загрузка: ${formatDate(last)}` : undefined}>
        <Row
          icon="repeat"
          title="Данные заменятся"
          subtitle="Настройки, категории, счета, кредитка, операции, плановые записи, постоянные, покупки и долги заменятся данными из файла. Отменить это нельзя."
        />
        <Row
          icon="download"
          title="Сначала — копия"
          subtitle="Перед заменой можно сделать резервную копию того, что сейчас в приложении."
        />
        <Row
          icon="info"
          title="Что не переносится"
          subtitle="Числа, вписанные поверх формул, и заметки к ячейкам. Их список появится перед заменой."
        />
      </Section>
      {file.error && <Banner tone="error">{file.error}</Banner>}
      <div class="import-actions">
        <Button full disabled={file.reading} onClick={() => file.pick(readTrackerStamped)}>
          {file.reading ? 'Читаю файл…' : 'Выбрать файл'}
        </Button>
      </div>
      <ReplaceDataSheet key={file.opened} pending={file.pending} onClose={file.clear} onReplaced={onReplaced} />
    </Page>
  );
}
