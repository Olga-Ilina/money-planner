// The synthetic tracker fixture for the io tests (not a test file itself).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import ExcelJS from 'exceljs';
import { stripDrawings } from '../../src/io/stripDrawings';

export function fixture(): ArrayBuffer {
  const file = readFileSync(join(import.meta.dirname, '../fixtures/tracker-scenario.xlsx'));
  return file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer;
}

/** The fixture as a workbook (its charts dropped, as the import does), changed by `edit`, written out again. */
export async function patchedFixture(edit: (wb: ExcelJS.Workbook) => void): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load((await stripDrawings(fixture())) as unknown as Parameters<ExcelJS.Workbook['xlsx']['load']>[0]);
  edit(wb);
  const written = new Uint8Array(await wb.xlsx.writeBuffer());
  return written.buffer.slice(written.byteOffset, written.byteOffset + written.byteLength) as ArrayBuffer;
}
