// The Content-Security-Policy of index.html: the app makes no network requests and runs no foreign code.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function csp(): Map<string, string[]> {
  const html = readFileSync(join(import.meta.dirname, '../../index.html'), 'utf8');
  const content = /http-equiv="Content-Security-Policy"\s+content="([^"]+)"/.exec(html)?.[1];
  if (!content) throw new Error('no CSP meta tag in index.html');
  return new Map(
    content
      .split(';')
      .map((d) => d.trim().split(/\s+/))
      .filter((parts) => parts[0])
      .map(([name, ...values]) => [name!, values]),
  );
}

describe('CSP in index.html', () => {
  it('allows only the app itself to be loaded, connected to and run', () => {
    const p = csp();
    expect(p.get('default-src')).toEqual(["'self'"]);
    expect(p.get('script-src')).toEqual(["'self'"]);
    expect(p.get('connect-src')).toEqual(["'self'"]);
    expect(p.get('object-src')).toEqual(["'none'"]);
    expect(p.get('base-uri')).toEqual(["'self'"]);
  });

  it('forbids form submissions anywhere', () => {
    expect(csp().get('form-action')).toEqual(["'none'"]);
  });

  it('runs workers only from the app (no blob: workers)', () => {
    expect(csp().get('worker-src')).toEqual(["'self'"]);
  });
});
