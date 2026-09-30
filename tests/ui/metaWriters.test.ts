// Only the store writes the whole meta: every change in the UI goes through actions.updateMeta, which reads,
// changes and writes the STORED meta in one transaction (updateStoredMeta) — so a tab never writes back a
// meta, or a PIN, that another tab has changed meanwhile. And the UI saves the data only with the generation
// check (saveData(d, { generation })): never over a data set another tab deleted or set up anew.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(import.meta.dirname, '../../src/ui');
const files = readdirSync(root, { recursive: true, encoding: 'utf8' }).filter((f) => /\.tsx?$/.test(f));
const source = (f: string) => readFileSync(join(root, f), 'utf8');

/** The top-level arguments of the call whose «(» is at `open` in `text` (strings are not looked into). */
function callArgs(text: string, open: number): string[] {
  const args: string[] = [];
  let depth = 0;
  let from = open + 1;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (c === '(' || c === '{' || c === '[') depth += 1;
    else if (c === ')' || c === '}' || c === ']') {
      depth -= 1;
      if (depth === 0) {
        args.push(text.slice(from, i));
        return args;
      }
    } else if (c === ',' && depth === 1) {
      args.push(text.slice(from, i));
      from = i + 1;
    }
  }
  return args;
}

/** Every use of saveData in `text` that is not its import nor a call whose 2nd argument is `{ generation … }`. */
function uncheckedSaveData(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/\bsaveData\b/g)) {
    const at = m.index;
    const end = text.indexOf('\n', at);
    const line = text.slice(text.lastIndexOf('\n', at) + 1, end === -1 ? undefined : end);
    if (/^import\b.*from '\.\.\/store\/db';$/.test(line.trim())) continue;
    const open = /^\s*\(/.exec(text.slice(at + 'saveData'.length)) ? text.indexOf('(', at) : -1;
    const second = open === -1 ? undefined : callArgs(text, open)[1];
    if (second === undefined || !/^\s*\{\s*generation\b/.test(second)) out.push(line.trim());
  }
  return out;
}

describe('src/ui never writes the whole meta', () => {
  it('no saveMeta in src/ui', () => {
    expect(files.length).toBeGreaterThan(20);
    const offenders = files.filter((f) => /\bsaveMeta\b/.test(source(f)));
    expect(offenders).toEqual([]);
  });
});

describe('src/ui saves the data only with the generation check', () => {
  it('every saveData in src/ui is a call with { generation } (the unchecked saveData(d) is for the store and tests)', () => {
    const offenders = files.flatMap((f) => uncheckedSaveData(source(f)).map((l) => `${f}: ${l}`));
    expect(offenders).toEqual([]);
    expect(files.filter((f) => /\bsaveData\s*\(/.test(source(f)))).toContain('actions.ts'); // not vacuous: the save queue
  });

  it('the check itself: an unchecked call, a bare reference or a call with another argument is found', () => {
    expect(uncheckedSaveData("import { saveData } from '../store/db';\nawait saveData(job.data, { generation: g });")).toEqual([]);
    expect(uncheckedSaveData('await saveData(job.data);')).toEqual(['await saveData(job.data);']);
    expect(uncheckedSaveData('await saveData(f(a, b));')).toEqual(['await saveData(f(a, b));']);
    expect(uncheckedSaveData('const save = saveData;')).toEqual(['const save = saveData;']);
    expect(uncheckedSaveData('await saveData(d, other);')).toEqual(['await saveData(d, other);']);
    expect(uncheckedSaveData('await saveData(wrap(d, { generation: g }));')).toEqual(['await saveData(wrap(d, { generation: g }));']);
    expect(uncheckedSaveData('await db.saveData(d, {\n  generation: g,\n});')).toEqual([]);
  });
});
