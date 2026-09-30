// Removes chart drawings from an .xlsx before ExcelJS reads it. ExcelJS 4.4 throws
// "Cannot read properties of undefined (reading 'anchors')" on drawings written without the
// `xdr:` prefix (openpyxl does that — the Excel tracker is generated with it). The import does not
// need charts, so only the drawings that worksheets reference by a …/relationships/drawing
// relationship are dropped, with the charts they hold (and the charts' style, colour and shape
// parts) and every reference to them. Cell notes stay: their VML drawings (xl/drawings/*.vml,
// <legacyDrawing>, …/vmlDrawing), comments and threaded comments are left as they are, and so are
// images. All parts that are not edited keep their bytes. jszip is loaded lazily, like exceljs;
// a caller that has already loaded it passes it in.
import type JSZip from 'jszip';

const SHEET_RELS = /^xl\/worksheets\/_rels\/[^/]+\.rels$/;
const CONTENT_TYPES = '[Content_Types].xml';

/** Relationship types by their last path segment (transitional and strict namespaces alike). */
const DRAWING = /\/drawing$/;
const CHART = /\/chart$/;
const CHART_PARTS = /\/(?:chartStyle|chartColorStyle|chartUserShapes)$/;

const RELATIONSHIP = /<Relationship\b[^>]*?(?:\/>|>[\s\S]*?<\/Relationship>)/g;
/** `<drawing r:id="…"/>` (any namespace prefix, self-closing or not) — not `<legacyDrawing>`. */
const DRAWING_ELEMENT = /<(?:[\w.-]+:)?drawing\b[^>]*?(?:\/>|>[\s\S]*?<\/(?:[\w.-]+:)?drawing>)/g;
const OVERRIDE = /<Override\b[^>]*?(?:\/>|>\s*<\/Override>)/g;
const ATTRIBUTE = /([\w.:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

interface Relationship {
  xml: string;
  type: string;
  target: string;
  external: boolean;
}

/** Attributes of the start tag of an element. */
function attributes(element: string): Map<string, string> {
  const start = element.slice(0, element.indexOf('>') + 1);
  return new Map([...start.matchAll(ATTRIBUTE)].map((m) => [m[1] ?? '', m[2] ?? m[3] ?? '']));
}

function relationships(xml: string): Relationship[] {
  return [...xml.matchAll(RELATIONSHIP)].map(([element]) => {
    const a = attributes(element);
    return {
      xml: element,
      type: a.get('Type') ?? '',
      target: a.get('Target') ?? '',
      external: a.get('TargetMode') === 'External',
    };
  });
}

/** The part a relationship target points to, from the part that owns the relationships. */
function resolve(source: string, target: string): string {
  const path = target.startsWith('/') ? [] : source.split('/').slice(0, -1);
  for (const segment of target.replace(/^\/+/, '').split('/')) {
    if (segment === '..') path.pop();
    else if (segment !== '.' && segment !== '') path.push(segment);
  }
  return path.join('/');
}

/** 'xl/drawings/drawing1.xml' → 'xl/drawings/_rels/drawing1.xml.rels'. */
function relsOf(part: string): string {
  const slash = part.lastIndexOf('/');
  return `${part.slice(0, slash + 1)}_rels/${part.slice(slash + 1)}.rels`;
}

/** 'xl/worksheets/_rels/sheet4.xml.rels' → 'xl/worksheets/sheet4.xml'. */
function ownerOf(rels: string): string {
  return rels.replace(/_rels\/([^/]+)\.rels$/, '$1');
}

export async function stripDrawings(buf: ArrayBuffer, zipLib?: JSZip): Promise<ArrayBuffer> {
  const Zip = zipLib ?? (await import('jszip')).default;
  const zip = await Zip.loadAsync(buf);
  // Part names are case-insensitive in the package; zip entry names are not.
  const byName = new Map(Object.values(zip.files).filter((f) => !f.dir).map((f) => [f.name.toLowerCase(), f.name]));
  const entry = (part: string): string | undefined => byName.get(part.toLowerCase());
  const read = async (name: string): Promise<string> => (await zip.file(name)?.async('string')) ?? '';
  /** Parts that `part` points to by internal relationships of the given type. */
  const targets = async (part: string, type: RegExp): Promise<string[]> => {
    const rels = entry(relsOf(part));
    if (!rels) return [];
    return relationships(await read(rels)).filter((r) => !r.external && type.test(r.type)).map((r) => resolve(part, r.target));
  };

  const removed = new Set<string>();
  const edited = new Map<string, string>();
  const remove = (part: string): void => {
    const name = entry(part);
    if (name) removed.add(name);
  };

  for (const relsName of [...byName.values()].filter((name) => SHEET_RELS.test(name))) {
    const xml = await read(relsName);
    const drawings = relationships(xml).filter((r) => !r.external && DRAWING.test(r.type));
    if (drawings.length === 0) continue;
    edited.set(relsName, drawings.reduce((out, r) => out.replace(r.xml, ''), xml));

    // A worksheet has at most one <drawing>, and it points to this relationship.
    const sheet = ownerOf(relsName);
    const sheetName = entry(sheet);
    if (sheetName) edited.set(sheetName, (await read(sheetName)).replace(DRAWING_ELEMENT, ''));

    for (const drawing of drawings.map((r) => resolve(sheet, r.target))) {
      for (const chart of await targets(drawing, CHART)) {
        for (const part of await targets(chart, CHART_PARTS)) {
          remove(part);
          remove(relsOf(part));
        }
        remove(chart);
        remove(relsOf(chart));
      }
      remove(drawing);
      remove(relsOf(drawing));
    }
  }
  if (edited.size === 0) return buf;

  const gone = new Set([...removed].map((name) => `/${name.toLowerCase()}`));
  const types = await read(CONTENT_TYPES);
  edited.set(CONTENT_TYPES, types.replace(OVERRIDE, (element) =>
    gone.has((attributes(element).get('PartName') ?? '').toLowerCase()) ? '' : element));

  for (const name of removed) zip.remove(name);
  for (const [name, xml] of edited) {
    if (!removed.has(name) && xml !== (await read(name))) zip.file(name, xml);
  }
  return zip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE' });
}
