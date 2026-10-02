// Files with a sync stamp in docProps/core.xml <dc:description>, as the Mac writes «Для приложения.xlsx».
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import JSZip from 'jszip';
import { formatStamp } from '../../../src/io/sync';
import type { SyncStamp } from '../../../src/io/sync';

export const MAC_ID = 'aaaaaaaaaaaaaaaa';

/** A stamp the Mac wrote: version MAC_ID, nothing seen from the app. */
export function macStampText(over: Partial<SyncStamp> = {}): string {
  return formatStamp({ id: MAC_ID, base: null, dirty: false, at: '2026-10-01T08:00:00Z', from: 'mac', ...over });
}

/** The real fixture tracker (tests/fixtures/tracker-scenario.xlsx) with `description` as its stamp. */
export async function stampedTracker(description: string, name = 'Для приложения.xlsx'): Promise<File> {
  const zip = await JSZip.loadAsync(readFileSync(join(import.meta.dirname, '../../fixtures/tracker-scenario.xlsx')));
  const core = await zip.file('docProps/core.xml')!.async('string');
  zip.file('docProps/core.xml', core.replace('</cp:coreProperties>', `<dc:description>${description}</dc:description></cp:coreProperties>`));
  return new File([await zip.generateAsync({ type: 'arraybuffer' })], name);
}
