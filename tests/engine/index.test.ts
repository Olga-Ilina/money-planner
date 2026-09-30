import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as engine from '../../src/engine';

describe('engine public API', () => {
  it('exports every function later layers use', () => {
    const names = [
      'emptyData', 'newId',
      'ymOf', 'addMonths', 'monthStart', 'monthEnd', 'daysInMonth', 'addDays', 'mondayOnOrBefore',
      'accountingMonths', 'forecastMonths', 'inAccountingYear', 'monthLabel', 'parseMonthLabel', 'monthDiff',
      'dateIn', 'clampDay',
      'journalFact', 'journalPlan', 'journalExpected', 'journalMonth',
      'recurringDue', 'recurringDate', 'recurringPlan', 'recurringFact', 'recurringExpected',
      'purchasePlan', 'purchaseFact', 'purchaseExpected', 'opAmount', 'opt',
      'duplicatesForJournal', 'duplicatesForOperation',
      'monthSummary', 'dailySpend', 'yearStats',
      'balances', 'creditStatements', 'nextCreditDebit', 'cashAtForecastStart', 'accountMovements',
      'creditCardId', 'payFromId', 'inBalance', 'transferToFree', 'freeMoneyTransfers',
      'forecast', 'upcoming', 'markPaid', 'warnings',
      'monthItems',
      'roundCents', 'monthlyAverage', 'purchaseStatus', 'leftToSave', 'debtLeft', 'debtStatus', 'isDebtOpen',
    ];
    const exported = engine as unknown as Record<string, unknown>;
    expect(names.filter((n) => typeof exported[n] !== 'function')).toEqual([]);
    expect(engine.SCHEMA_VERSION).toBe(1);
  });
});

/** What makes an engine source impure: imports from outside the engine and host globals. */
const HOST_GLOBALS = /\b(globalThis|self|process|Buffer|window|document|localStorage|indexedDB|navigator)\b/g;

function purityViolations(source: string): string[] {
  // `from '…'`, `import '…'`, `import('…')`, `require('…')` — single or double quotes.
  const imports = [...source.matchAll(/\b(?:from|import|require)\s*\(?\s*(['"])([^'"]+)\1/g)].map((m) => m[2] ?? '');
  const out = imports.filter((p) => !p.startsWith('./')).map((p) => `import ${p}`);
  for (const m of source.matchAll(HOST_GLOBALS)) out.push(`global ${m[1]}`);
  return out;
}

describe('engine purity guard', () => {
  it('accepts engine-relative imports in both quote styles', () => {
    expect(purityViolations(`import { a } from './dates';\nimport type { B } from "./model";`)).toEqual([]);
  });

  it('flags outside imports in both quote styles, side-effect and dynamic imports', () => {
    expect(purityViolations(`import x from 'lodash';`)).toEqual(['import lodash']);
    expect(purityViolations(`import { y } from "exceljs";`)).toEqual(['import exceljs']);
    expect(purityViolations(`export * from "../ui/App";`)).toEqual(['import ../ui/App']);
    expect(purityViolations(`import "polyfill";`)).toEqual(['import polyfill']);
    expect(purityViolations(`const m = await import('node:fs');`)).toEqual(['import node:fs']);
    expect(purityViolations(`const fs = require("fs");`)).toEqual(['import fs']);
  });

  it.each(['globalThis', 'self', 'process', 'Buffer', 'window', 'document', 'localStorage', 'indexedDB', 'navigator'])(
    'flags the host global %s',
    (name) => {
      expect(purityViolations(`const x = ${name}.foo;`)).toEqual([`global ${name}`]);
    },
  );

  it('does not flag words that only contain a global name', () => {
    expect(purityViolations(`const selfish = 1; const processed = 2; const documents = [];`)).toEqual([]);
  });
});

describe('engine purity', () => {
  const dir = join(import.meta.dirname, '../../src/engine');
  const files = readdirSync(dir).filter((f) => f.endsWith('.ts'));

  it('covers every engine file, the shared labels and plan rules included', () => {
    expect(files).toEqual(expect.arrayContaining(['labels.ts', 'money.ts', 'plans.ts', 'index.ts']));
  });

  it.each(files)('%s imports only other engine modules and no host globals', (file) => {
    expect(purityViolations(readFileSync(join(dir, file), 'utf8'))).toEqual([]);
  });
});
