// Sheets and confirms are drawn in ONE overlay root inside the app shell, not inside the element that
// declares them: a sheet opened from a Page's `right` slot would otherwise sit in the sticky, blurred
// page bar, which clips a fixed layer and stacks it under the tab bar. The root lives inside the shell,
// so the lock's hidden / inert / aria-hidden covers every sheet (never document.body). Outside an
// OverlayHost (lock screen, onboarding, start errors) a sheet renders in place.
import { Component, createContext, render } from 'preact';
import type { ComponentChildren } from 'preact';
import { useContext, useMemo, useState } from 'preact/hooks';

interface OverlayRoot {
  el: HTMLElement | null;
}

const OverlayContext = createContext<OverlayRoot | null>(null);

/** Wraps the app shell: its sheets render into the overlay root placed after `children`. */
export function OverlayHost({ children }: { children?: ComponentChildren }) {
  const [el, setEl] = useState<HTMLElement | null>(null);
  const root = useMemo<OverlayRoot>(() => ({ el }), [el]);
  return (
    <OverlayContext.Provider value={root}>
      {children}
      <div class="overlay-root" ref={setEl} />
    </OverlayContext.Provider>
  );
}

/** Passes the contexts of the place a sheet was declared on to its separate render root. */
class ContextBridge extends Component<{ context: object; children?: ComponentChildren }> {
  getChildContext() {
    return this.props.context;
  }

  render() {
    return this.props.children;
  }
}

/** Renders its children into their own element appended to `into` (public Preact API only). */
class Portal extends Component<{ into: HTMLElement; children?: ComponentChildren }> {
  private slot: HTMLDivElement | null = null;

  override componentDidMount() {
    this.draw();
  }

  override componentDidUpdate() {
    this.draw();
  }

  override componentWillUnmount() {
    this.clear();
  }

  private clear() {
    if (!this.slot) return;
    render(null, this.slot);
    this.slot.remove();
    this.slot = null;
  }

  private draw() {
    const { into, children } = this.props;
    if (this.slot && this.slot.parentNode !== into) this.clear();
    if (!this.slot) {
      this.slot = document.createElement('div');
      this.slot.className = 'overlay-slot';
      into.appendChild(this.slot);
    }
    // without a contextType, this.context holds every context provided above this component
    render(<ContextBridge context={this.context as object}>{children}</ContextBridge>, this.slot);
  }

  override render() {
    return null;
  }
}

/** Renders `children` in the overlay root of the nearest OverlayHost, or in place without one. */
export function Overlay({ children }: { children?: ComponentChildren }) {
  const host = useContext(OverlayContext);
  if (!host) return <>{children}</>;
  if (!host.el) return null; // the root exists right after the host's first render
  return <Portal into={host.el}>{children}</Portal>;
}
