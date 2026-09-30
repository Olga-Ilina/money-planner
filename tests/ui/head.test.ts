// The <head> of index.html: installable on the home screen on iOS and elsewhere, and an icon for the tab so
// the browser does not ask for a /favicon.ico that is not there (a 404 outside the app's base).
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(import.meta.dirname, '../..');
const html = readFileSync(join(root, 'index.html'), 'utf8');
const head = /<head>([\s\S]*)<\/head>/.exec(html)?.[1] ?? '';

/** The attributes of every `<tag …>` in the head. */
function tags(name: string): Record<string, string>[] {
  return [...head.matchAll(new RegExp(`<${name}\\s([^>]*?)/?>`, 'g'))].map((m) =>
    Object.fromEntries([...m[1]!.matchAll(/([\w-]+)="([^"]*)"/g)].map((a) => [a[1]!, a[2]!])),
  );
}

describe('index.html head', () => {
  it('can run as a home-screen app: the standard meta next to the Apple one', () => {
    const metas = tags('meta');
    expect(metas).toContainEqual({ name: 'apple-mobile-web-app-capable', content: 'yes' });
    expect(metas).toContainEqual({ name: 'mobile-web-app-capable', content: 'yes' });
  });

  it('links a PNG icon from public/ (Vite adds the base), so there is no /favicon.ico request', () => {
    const icons = tags('link').filter((l) => l.rel === 'icon');
    expect(icons).toEqual([{ rel: 'icon', type: 'image/png', href: '/icons/icon-192.png' }]);
    expect(existsSync(join(root, 'public', icons[0]!.href!))).toBe(true);
  });

  it('every icon it links exists in public/', () => {
    for (const link of tags('link').filter((l) => /icon/.test(l.rel ?? ''))) {
      expect(existsSync(join(root, 'public', link.href!)), link.href).toBe(true);
    }
  });
});
