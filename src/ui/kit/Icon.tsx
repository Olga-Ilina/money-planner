// Inline SVG icons (no icon fonts or files: the CSP allows nothing external). 24×24 grid, drawn
// with currentColor strokes so they take the colour of the text around them. Always decorative:
// give the button or row around an icon its own label.
import type { JSX } from 'preact';

export const ICON_NAMES = [
  'home', 'list', 'wallet', 'chart', 'more', 'plus', 'check', 'check-circle', 'chevron-right', 'chevron-left',
  'chevron-down', 'download', 'share', 'trash', 'edit', 'lock', 'repeat', 'calendar', 'cart', 'arrows', 'alert', 'x',
  'search',
  // for the screens: income / expense, reorder, warnings, info, account types, settings rows
  'plus-circle', 'minus-circle', 'chevron-up', 'warning', 'info', 'card', 'cash', 'tag', 'sliders', 'upload', 'clock',
  // debts
  'debt',
] as const;

export type IconName = (typeof ICON_NAMES)[number];

const PATHS: Record<IconName, JSX.Element> = {
  home: <path d="M3.5 10.5 12 3.5l8.5 7V20a1 1 0 0 1-1 1H15v-6H9v6H4.5a1 1 0 0 1-1-1z" />,
  list: (
    <>
      <path d="M9 6h11M9 12h11M9 18h11" />
      <circle cx="4.5" cy="6" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="4.5" cy="12" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="4.5" cy="18" r="1.2" fill="currentColor" stroke="none" />
    </>
  ),
  wallet: (
    <>
      <path d="M17 7V5a1 1 0 0 0-1-1H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h14a1 1 0 0 0 1-1v-9a1 1 0 0 0-1-1H5a2 2 0 0 1-2-2" />
      <circle cx="16" cy="13.5" r="1.2" fill="currentColor" stroke="none" />
    </>
  ),
  chart: <path d="M3 20.5h18M6 20.5v-6M11 20.5V8M16 20.5v-9M21 20.5V4" />,
  more: (
    <>
      <circle cx="5" cy="12" r="1.8" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.8" fill="currentColor" stroke="none" />
      <circle cx="19" cy="12" r="1.8" fill="currentColor" stroke="none" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  'check-circle': (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m8 12.5 3 3 5-6" />
    </>
  ),
  'chevron-right': <path d="m9 5 7 7-7 7" />,
  'chevron-left': <path d="m15 5-7 7 7 7" />,
  'chevron-down': <path d="m5 9 7 7 7-7" />,
  // an export: a file goes out to the user (reports, the backup copy)
  download: <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />,
  share: <path d="M12 3v12M8 7l4-4 4 4M8 10H6a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-9a1 1 0 0 0-1-1h-2" />,
  trash: <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13M9 7V4h6v3" />,
  edit: <path d="M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4" />,
  lock: (
    <>
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </>
  ),
  // repeating (recurring payments, restoring): two arrows chasing each other round a circle — round, so at
  // 18 px it never looks like «arrows» (a transfer: two straight arrows)
  repeat: <path d="M4 12a8 8 0 0 1 14.93-4M19 3.5V8h-4.5M20 12a8 8 0 0 1-14.93 4M5 20.5V16h4.5" />,
  calendar: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </>
  ),
  cart: (
    <>
      <path d="M3 4h2l2.5 11h11L21 7H6.2" />
      <circle cx="9" cy="19.5" r="1.5" />
      <circle cx="17" cy="19.5" r="1.5" />
    </>
  ),
  // a transfer: two straight arrows, one each way
  arrows: <path d="M4 8h15M15 4l4 4-4 4M20 16H5M9 12l-4 4 4 4" />,
  // an error: «!» in a circle
  alert: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.5v5.5" />
      <circle cx="12" cy="16.5" r="1.1" fill="currentColor" stroke="none" />
    </>
  ),
  // a warning: «!» in a triangle
  warning: (
    <>
      <path d="M10.3 4 2.6 18a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 4a2 2 0 0 0-3.4 0z" />
      <path d="M12 9.5v4" />
      <circle cx="12" cy="17" r="1.1" fill="currentColor" stroke="none" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5.5" />
      <circle cx="12" cy="7.5" r="1.1" fill="currentColor" stroke="none" />
    </>
  ),
  // income
  'plus-circle': (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v8M8 12h8" />
    </>
  ),
  // expense
  'minus-circle': (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M8 12h8" />
    </>
  ),
  'chevron-up': <path d="m5 15 7-7 7 7" />,
  // a bank card (debit or credit account)
  card: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3 10h18M7 15h4" />
    </>
  ),
  // cash (a banknote)
  cash: (
    <>
      <rect x="2.5" y="6" width="19" height="12" rx="2" />
      <circle cx="12" cy="12" r="2.5" />
      <path d="M6 9.5v5M18 9.5v5" />
    </>
  ),
  // categories
  tag: (
    <>
      <path d="M3.5 12.5V4.5a1 1 0 0 1 1-1h8l8 8a1 1 0 0 1 0 1.4l-7.6 7.6a1 1 0 0 1-1.4 0z" />
      <circle cx="8" cy="8" r="1.4" fill="currentColor" stroke="none" />
    </>
  ),
  // settings
  sliders: (
    <>
      <path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1" />
      <circle cx="15" cy="6" r="2" />
      <circle cx="9" cy="12" r="2" />
      <circle cx="17" cy="18" r="2" />
    </>
  ),
  // load a file in (tracker import, restore)
  upload: <path d="M12 20V9M7 14l5-5 5 5M5 4h14" />,
  // postponed, pending
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3.5 2" />
    </>
  ),
  // a debt (loans, instalments, money owed): a bill with a zigzag tear and a «%»
  debt: (
    <>
      <path d="M6 3h12v18l-2-1.5-2 1.5-2-1.5-2 1.5-2-1.5-2 1.5z" />
      <path d="m14.5 8.5-5 7" />
      <circle cx="9.6" cy="9.4" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="14.4" cy="14.6" r="1.3" fill="currentColor" stroke="none" />
    </>
  ),
  x: <path d="M6 6l12 12M18 6 6 18" />,
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-4-4" />
    </>
  ),
};

export interface IconProps {
  name: IconName;
  /** Width and height in px; default 24. */
  size?: number;
}

export function Icon({ name, size = 24 }: IconProps) {
  return (
    <svg
      class="icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}
