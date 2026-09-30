// Each tab (and each page in it) keeps its scroll position: the document scrolls, so the position
// is saved while scrolling and restored when that view comes back. A newly pushed page starts at
// the top. Paused while the app is hidden behind the lock.
import { useLayoutEffect, useRef } from 'preact/hooks';

/** `key`: the NavEntry object of a pushed page, or a string for a tab's root screen. */
export function useScrollMemory(key: object | string, paused: boolean): void {
  const roots = useRef(new Map<string, number>());
  const pages = useRef(new WeakMap<object, number>());
  const current = useRef({ key, paused });

  // attached right after mount (not after paint), so no early scroll is missed
  useLayoutEffect(() => {
    const onScroll = () => {
      const c = current.current;
      if (c.paused) return;
      if (typeof c.key === 'string') roots.current.set(c.key, window.scrollY);
      else pages.current.set(c.key, window.scrollY);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useLayoutEffect(() => {
    current.current = { key, paused };
    if (paused) return;
    const saved = typeof key === 'string' ? roots.current.get(key) : pages.current.get(key);
    window.scrollTo(0, saved ?? 0);
  }, [key, paused]);
}
