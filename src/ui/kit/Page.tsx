// A screen with an iOS large title. A slim bar stays on top while scrolling: the back button (on a
// page pushed inside a tab), the title in small type once the large one has scrolled away, and the
// `right` actions.
import type { ComponentChildren } from 'preact';
import { useContext, useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { PageContext, popPage, rememberTitle } from '../nav';
import { Icon } from './Icon';

export interface PageProps {
  title: string;
  subtitle?: ComponentChildren;
  /** Actions at the top right (plain buttons or icon buttons with aria-label). */
  right?: ComponentChildren;
  children?: ComponentChildren;
}

export function Page({ title, subtitle, right, children }: PageProps) {
  const ctx = useContext(PageContext);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const barRef = useRef<HTMLElement>(null);
  const [compact, setCompact] = useState(false);

  useLayoutEffect(() => {
    if (ctx) rememberTitle(ctx.tab, ctx.depth, title);
  }, [ctx?.tab, ctx?.depth, title]);

  useEffect(() => {
    const el = titleRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    // the large title counts as gone once it has slid fully under the bar (44 px + the notch)
    const barHeight = barRef.current?.offsetHeight ?? 44;
    const io = new IntersectionObserver(([e]) => setCompact(e ? !e.isIntersecting : false), {
      rootMargin: `-${barHeight}px 0px 0px 0px`,
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const backTitle = ctx?.backTitle ?? 'Назад';
  const back =
    ctx && ctx.depth > 0 ? (
      <button
        type="button"
        class="nav-back"
        aria-label={backTitle === 'Назад' ? 'Назад' : `Назад: ${backTitle}`}
        onClick={() => popPage(ctx.tab)}
      >
        <Icon name="chevron-left" size={22} />
        <span class="nav-back-title">{backTitle}</span>
      </button>
    ) : null;

  return (
    <div class="page">
      <header ref={barRef} class={`page-bar${compact ? ' page-bar-compact' : ''}`}>
        <div class="page-bar-side page-bar-left">{back}</div>
        <div class="page-bar-title" aria-hidden="true">
          {title}
        </div>
        <div class="page-bar-side page-bar-right">{right}</div>
      </header>
      <div class="page-head">
        {/* focusable by script only: where focus goes when the element that opened a sheet is gone */}
        <h1 class="large-title" ref={titleRef} tabIndex={-1}>
          {title}
        </h1>
        {subtitle !== undefined && subtitle !== null && subtitle !== '' && <p class="page-subtitle">{subtitle}</p>}
      </div>
      <div class="page-body">{children}</div>
    </div>
  );
}
