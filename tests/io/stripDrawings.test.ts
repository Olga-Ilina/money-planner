import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { importTracker } from '../../src/io/importTracker';
import { stripDrawings } from '../../src/io/stripDrawings';

function fixture(): ArrayBuffer {
  const file = readFileSync(join(import.meta.dirname, '../fixtures/tracker-scenario.xlsx'));
  return file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer;
}

/** Every entry of the zip (folders left out) as bytes. */
async function entries(buf: ArrayBuffer): Promise<Map<string, Uint8Array>> {
  const zip = await JSZip.loadAsync(buf);
  const out = new Map<string, Uint8Array>();
  for (const file of Object.values(zip.files)) {
    if (!file.dir) out.set(file.name, await file.async('uint8array'));
  }
  return out;
}

const text = (bytes: Uint8Array | undefined): string => new TextDecoder().decode(bytes);

/**
 * Each test unzips and parses the whole tracker with ExcelJS (about 0.5–1 s alone). Under a full parallel run on
 * a busy machine that went past Vitest's default 5 s, so these blocks get a generous limit.
 */
const SLOW = { timeout: 30_000 };

const sameBytes = (a: Uint8Array | undefined, b: Uint8Array | undefined): boolean =>
  a !== undefined && b !== undefined && Buffer.from(a).equals(Buffer.from(b));

describe('stripDrawings — tracker written by the Python generator', SLOW, () => {
  it('ExcelJS cannot load the fixture as it is (charts without the xdr: prefix)', async () => {
    const wb = new ExcelJS.Workbook();
    await expect(wb.xlsx.load(fixture())).rejects.toThrow(/anchors/);
  });

  it('ExcelJS loads the fixture once the drawings are stripped', async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await stripDrawings(fixture()));
    expect(wb.worksheets.map((ws) => ws.name)).toEqual([
      'Инструкция', 'Настройки', 'Операции', 'Счета', 'Журнал', 'Постоянные',
      'Покупки', 'Месяц', 'Прогноз', 'Статистика', 'Долги',
    ]);
    expect(wb.getWorksheet('Журнал')?.getCell('F10').value).toBe('Еда');
  });

  it('removes drawing and chart parts and every reference to them', async () => {
    const before = await entries(fixture());
    const after = await entries(await stripDrawings(fixture()));

    expect([...before.keys()].some((name) => name.startsWith('xl/charts/'))).toBe(true);
    expect([...after.keys()].filter((name) => /^xl\/(drawings|charts)\//.test(name))).toEqual([]);

    for (const [name, bytes] of after) {
      if (/^xl\/worksheets\/sheet\d+\.xml$/.test(name)) expect(text(bytes)).not.toMatch(/<drawing\b/);
      if (/^xl\/worksheets\/_rels\//.test(name)) expect(text(bytes)).not.toMatch(/relationships\/drawing"/);
    }
    expect(text(after.get('[Content_Types].xml'))).not.toMatch(/\/xl\/(drawings|charts)\//);
  });

  it('keeps everything else byte-identical', async () => {
    const before = await entries(fixture());
    const after = await entries(await stripDrawings(fixture()));
    const edited = /^(xl\/worksheets\/sheet\d+\.xml|xl\/worksheets\/_rels\/.*|\[Content_Types\]\.xml)$/;

    const kept = [...before.keys()].filter((name) => !/^xl\/(drawings|charts)\//.test(name));
    expect([...after.keys()].sort()).toEqual(kept.sort());
    for (const name of kept) {
      if (edited.test(name)) continue;
      expect(sameBytes(after.get(name), before.get(name)), name).toBe(true);
    }
    // An edited sheet differs only by the removed <drawing/> element.
    const sheet = text(before.get('xl/worksheets/sheet4.xml'));
    const drawing = /<drawing\b[^>]*\/>/.exec(sheet)?.[0] ?? '';
    expect(drawing).not.toBe('');
    expect(text(after.get('xl/worksheets/sheet4.xml'))).toBe(sheet.replace(drawing, ''));
    // A sheet without charts is not touched at all.
    expect(sameBytes(after.get('xl/worksheets/sheet5.xml'), before.get('xl/worksheets/sheet5.xml'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------
// Cell notes: Excel keeps them in xl/commentsN.xml plus a VML drawing in xl/drawings/, referenced
// by a …/vmlDrawing relationship and <legacyDrawing r:id=…/>. They are not charts and must stay.

const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PKG_REL = 'http://schemas.openxmlformats.org/package/2006/relationships';

const COMMENTS_XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
  + '<comments xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><authors><author>Автор</author></authors>'
  + '<commentList><comment ref="F10" authorId="0"><text><r><t xml:space="preserve">Проверить сумму</t></r></text></comment>'
  + '</commentList></comments>';

const NOTE_VML = '<xml xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office" '
  + 'xmlns:x="urn:schemas-microsoft-com:office:excel">\n'
  + ' <o:shapelayout v:ext="edit"><o:idmap v:ext="edit" data="1"/></o:shapelayout>\n'
  + ' <v:shapetype id="_x0000_t202" coordsize="21600,21600" o:spt="202" path="m,l,21600r21600,l21600,xe">'
  + '<v:stroke joinstyle="miter"/><v:path gradientshapeok="t" o:connecttype="rect"/></v:shapetype>\n'
  + ' <v:shape id="_x0000_s1025" type="#_x0000_t202" style="position:absolute;margin-left:59.25pt;margin-top:1.5pt;'
  + 'width:108pt;height:59.25pt;z-index:1;visibility:hidden" fillcolor="#ffffe1" o:insetmode="auto">'
  + '<v:fill color2="#ffffe1"/><v:shadow on="t" color="black" obscured="t"/><v:path o:connecttype="none"/>'
  + '<v:textbox style="mso-direction-alt:auto"><div style="text-align:left"></div></v:textbox>'
  + '<x:ClientData ObjectType="Note"><x:MoveWithCells/><x:SizeWithCells/><x:Anchor>6, 15, 9, 2, 8, 15, 13, 6</x:Anchor>'
  + '<x:AutoFill>False</x:AutoFill><x:Row>9</x:Row><x:Column>5</x:Column></x:ClientData></v:shape>\n</xml>';

/** Adds an Excel-style note on F10 of the sheet part, the way Excel writes it (relative targets). */
async function withNote(buf: ArrayBuffer, sheet: string): Promise<ArrayBuffer> {
  const zip = await JSZip.loadAsync(buf);
  const rels = sheet.replace(/^xl\/worksheets\//, 'xl/worksheets/_rels/') + '.rels';
  const extra = `<Relationship Id="rId91" Type="${REL}/vmlDrawing" Target="../drawings/vmlDrawing1.vml"/>`
    + `<Relationship Id="rId92" Type="${REL}/comments" Target="../comments1.xml"/>`;
  const oldRels = await zip.file(rels)?.async('string');
  zip.file(rels, oldRels
    ? oldRels.replace('</Relationships>', `${extra}</Relationships>`)
    : `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="${PKG_REL}">${extra}</Relationships>`);
  const xml = await zip.file(sheet)?.async('string');
  if (!xml) throw new Error(`no ${sheet}`);
  zip.file(sheet, xml.replace('</worksheet>', `<legacyDrawing xmlns:r="${REL}" r:id="rId91"/></worksheet>`));
  const types = await zip.file('[Content_Types].xml')?.async('string');
  if (!types) throw new Error('no [Content_Types].xml');
  zip.file('[Content_Types].xml', types.replace('</Types>',
    '<Default Extension="vml" ContentType="application/vnd.openxmlformats-officedocument.vmlDrawing"/>'
    + '<Override PartName="/xl/comments1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.comments+xml"/>'
    + '</Types>'));
  zip.file('xl/comments1.xml', COMMENTS_XML);
  zip.file('xl/drawings/vmlDrawing1.vml', NOTE_VML);
  return zip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE' });
}

/** The note text on a cell, whatever shape ExcelJS gives it. */
function noteText(note: unknown): string {
  if (typeof note === 'string') return note;
  const texts = (note as { texts?: unknown[] } | undefined)?.texts ?? [];
  return texts.map((t) => (typeof t === 'string' ? t : String((t as { text?: unknown }).text ?? ''))).join('');
}

describe('stripDrawings — a chart saved by Excel', SLOW, () => {
  /** Chart 1 as Excel saves it: relative targets, with its own style and colour parts. */
  async function excelStyleChart(buf: ArrayBuffer): Promise<ArrayBuffer> {
    const zip = await JSZip.loadAsync(buf);
    zip.file('xl/worksheets/_rels/sheet4.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="${PKG_REL}">`
      + `<Relationship Id="rId1" Type="${REL}/drawing" Target="../drawings/drawing1.xml"/></Relationships>`);
    zip.file('xl/drawings/_rels/drawing1.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="${PKG_REL}">`
      + `<Relationship Id="rId1" Type="${REL}/chart" Target="../charts/chart1.xml"/></Relationships>`);
    zip.file('xl/charts/_rels/chart1.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="${PKG_REL}">`
      + '<Relationship Id="rId2" Type="http://schemas.microsoft.com/office/2011/relationships/chartColorStyle" Target="colors1.xml"/>'
      + '<Relationship Id="rId1" Type="http://schemas.microsoft.com/office/2011/relationships/chartStyle" Target="style1.xml"/></Relationships>');
    zip.file('xl/charts/style1.xml', '<cs:chartStyle xmlns:cs="http://schemas.microsoft.com/office/drawing/2012/chartStyle" id="201"/>');
    zip.file('xl/charts/colors1.xml', '<cs:colorStyle xmlns:cs="http://schemas.microsoft.com/office/drawing/2012/chartStyle" meth="cycle" id="10"/>');
    const types = await zip.file('[Content_Types].xml')?.async('string');
    if (!types) throw new Error('no [Content_Types].xml');
    zip.file('[Content_Types].xml', types.replace('</Types>',
      '<Override PartName="/xl/charts/style1.xml" ContentType="application/vnd.ms-office.chartstyle+xml"/>'
      + '<Override PartName="/xl/charts/colors1.xml" ContentType="application/vnd.ms-office.chartcolorstyle+xml"/></Types>'));
    return zip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE' });
  }

  it('drops the chart with its style and colour parts, following relative targets', async () => {
    const original = await excelStyleChart(fixture());
    const stripped = await stripDrawings(original);
    const after = await entries(stripped);
    for (const name of ['xl/drawings/drawing1.xml', 'xl/charts/chart1.xml', 'xl/charts/_rels/chart1.xml.rels', 'xl/charts/style1.xml', 'xl/charts/colors1.xml']) {
      expect(after.has(name), name).toBe(false);
    }
    expect(text(after.get('[Content_Types].xml'))).not.toMatch(/\/xl\/(drawings|charts)\//);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(stripped);
    expect(wb.getWorksheet('Счета')).toBeDefined();
  });
});

describe('stripDrawings — cell notes are kept', SLOW, () => {
  it('the fixture with a note on «Журнал»: the note parts and references survive, ExcelJS reads the note', async () => {
    const original = await withNote(fixture(), 'xl/worksheets/sheet5.xml');
    const before = await entries(original);
    const stripped = await stripDrawings(original);
    const after = await entries(stripped);

    for (const name of ['xl/comments1.xml', 'xl/drawings/vmlDrawing1.vml', 'xl/worksheets/_rels/sheet5.xml.rels', 'xl/worksheets/sheet5.xml']) {
      expect(sameBytes(after.get(name), before.get(name)), name).toBe(true);
    }
    const types = text(after.get('[Content_Types].xml'));
    expect(types).toContain('Extension="vml"');
    expect(types).toContain('PartName="/xl/comments1.xml"');
    expect([...after.keys()].filter((name) => name.startsWith('xl/charts/'))).toEqual([]);

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(stripped);
    expect(noteText(wb.getWorksheet('Журнал')?.getCell('F10').note)).toBe('Проверить сумму');

    const imported = await importTracker(original);
    expect(imported.data.journal.map((r) => r.what)).toContain('Еда');
    // the note is not carried over, but the import says it is there
    expect(imported.notes).toEqual(['Лист «Журнал», ячейка F10: есть примечание «Проверить сумму» — в приложение не переносится']);
  });

  it('a sheet with both a chart and a note: the chart goes, the note stays', async () => {
    const original = await withNote(fixture(), 'xl/worksheets/sheet4.xml');
    const stripped = await stripDrawings(original);
    const after = await entries(stripped);

    expect(after.has('xl/drawings/drawing1.xml')).toBe(false);
    expect(after.has('xl/drawings/_rels/drawing1.xml.rels')).toBe(false);
    expect(after.has('xl/charts/chart1.xml')).toBe(false);
    expect(after.has('xl/drawings/vmlDrawing1.vml')).toBe(true);
    expect(after.has('xl/comments1.xml')).toBe(true);

    const sheet = text(after.get('xl/worksheets/sheet4.xml'));
    expect(sheet).not.toMatch(/<drawing\b/);
    expect(sheet).toContain('<legacyDrawing');
    const rels = text(after.get('xl/worksheets/_rels/sheet4.xml.rels'));
    expect(rels).not.toMatch(/relationships\/drawing"/);
    expect(rels).toContain('relationships/vmlDrawing"');
    expect(rels).toContain('relationships/comments"');
    const types = text(after.get('[Content_Types].xml'));
    expect(types).not.toContain('/xl/drawings/drawing1.xml');
    expect(types).not.toContain('/xl/charts/');
    expect(types).toContain('PartName="/xl/comments1.xml"');

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(stripped);
    expect(noteText(wb.getWorksheet('Счета')?.getCell('F10').note)).toBe('Проверить сумму');
  });
});

describe('stripDrawings — workbook written by ExcelJS', SLOW, () => {
  it('a workbook with a note passes through and still loads with the note', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Журнал');
    ws.getCell('F10').value = 'Еда';
    ws.getCell('F10').note = 'Проверить сумму';
    const written = new Uint8Array(await wb.xlsx.writeBuffer());
    const original = written.buffer.slice(written.byteOffset, written.byteOffset + written.byteLength);

    const before = await entries(original);
    const stripped = await stripDrawings(original);
    const after = await entries(stripped);
    expect([...before.keys()].some((name) => name.endsWith('.vml'))).toBe(true);
    expect([...after.keys()]).toEqual([...before.keys()]);
    for (const [name, bytes] of before) expect(sameBytes(after.get(name), bytes), name).toBe(true);

    const back = new ExcelJS.Workbook();
    await back.xlsx.load(stripped);
    expect(noteText(back.getWorksheet('Журнал')?.getCell('F10').note)).toBe('Проверить сумму');
  });

  it('passes through unchanged in content', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Журнал');
    ws.getCell('C10').value = new Date(Date.UTC(2026, 9, 5));
    ws.getCell('F10').value = 'Еда';
    ws.getCell('P10').value = { formula: 'G10*2', result: 200 };
    const written = new Uint8Array(await wb.xlsx.writeBuffer());
    const original = written.buffer.slice(written.byteOffset, written.byteOffset + written.byteLength);

    const before = await entries(original);
    const after = await entries(await stripDrawings(original));
    expect([...after.keys()]).toEqual([...before.keys()]);
    for (const [name, bytes] of before) expect(sameBytes(after.get(name), bytes), name).toBe(true);
  });
});
