import type { CSSProperties } from 'react';

/** Local stroke-based icon set. Directional icons carry `flip-rtl` where used. */
const PATHS: Record<string, string> = {
  dashboard: 'M4 13h7V4H4zM13 20h7v-9h-7zM13 4v5h7V4zM4 20h7v-5H4z',
  bolt: 'M13 2 4.5 13.5H11L10 22l8.5-11.5H12z',
  arrowUp: 'M12 19V5M5 12l7-7 7 7',
  arrowDown: 'M12 5v14M19 12l-7 7-7-7',
  sales: 'M4 7h16M4 7l1.5 12h13L20 7M9 11v4M15 11v4M8 7a4 4 0 0 1 8 0',
  purchases: 'M4 5h2l2.5 11h9L20 8H7M9 20a1 1 0 1 0 0 .01M17 20a1 1 0 1 0 0 .01',
  receipts: 'M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6',
  parties:
    'M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM2 20c0-3 3-5 6-5s6 2 6 5M17 11a3 3 0 1 0 0-6M22 20c0-2.5-1.5-4-4-4.5',
  inventory: 'M3 8l9-5 9 5-9 5zM3 8v8l9 5 9-5V8M12 13v8',
  staff: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4 21c0-4 3.5-6 8-6s8 2 8 6',
  branches: 'M4 21V8l8-5 8 5v13M9 21v-6h6v6M9 11h.01M15 11h.01',
  analytics: 'M4 20V4M4 20h16M8 16v-4M12 16V8M16 16v-6',
  settings:
    'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM19 12a7 7 0 0 0-.1-1l2-1.5-2-3.5-2.3 1a7 7 0 0 0-1.7-1L14.5 3h-5l-.4 2.5a7 7 0 0 0-1.7 1l-2.3-1-2 3.5 2 1.5a7 7 0 0 0 0 2l-2 1.5 2 3.5 2.3-1a7 7 0 0 0 1.7 1l.4 2.5h5l.4-2.5a7 7 0 0 0 1.7-1l2.3 1 2-3.5-2-1.5c.07-.32.1-.66.1-1Z',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  themes:
    'M12 3a9 9 0 1 0 0 18c1.1 0 1.5-.8 1.5-1.6 0-.9-.6-1.4-.6-2.2 0-.9.7-1.7 1.7-1.7H17a4 4 0 0 0 4-4c0-4.7-4-8.5-9-8.5ZM7.5 11h.01M10 7.5h.01M14.5 7.5h.01M17 11h.01',
  audit: 'M9 3h6a2 2 0 0 1 2 2v14l-5-3-5 3V5a2 2 0 0 1 2-2ZM9 8h6M9 12h4',
  presence: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM6 21a6 6 0 0 1 12 0M18 6l2 2 3-3',
  payroll: 'M3 6h18v12H3zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM6 9v.01M18 15v.01',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16ZM21 21l-4.3-4.3',
  camera: 'M4 8h3l2-3h6l2 3h3v11H4zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z',
  calendar: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4',
  scan: 'M4 7V5a1 1 0 0 1 1-1h2M17 4h2a1 1 0 0 1 1 1v2M20 17v2a1 1 0 0 1-1 1h-2M7 20H5a1 1 0 0 1-1-1v-2M8 8v8M11 8v8M14 8v8M17 8v8',
  bell: 'M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0',
  sun: 'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10ZM12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4',
  moon: 'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z',
  globe:
    'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM3 12h18M12 3c2.5 2.5 2.5 15 0 18M12 3c-2.5 2.5-2.5 15 0 18',
  logout: 'M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l5-5-5-5M15 12H3',
  menu: 'M3 6h18M3 12h18M3 18h18',
  close: 'M6 6l12 12M18 6L6 18',
  plus: 'M12 5v14M5 12h14',
  chevronRight: 'M9 6l6 6-6 6',
  chevronDown: 'M6 9l6 6 6-6',
  wifi: 'M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0M12 19.5h.01M2 9a15 15 0 0 1 20 0',
  wifiOff:
    'M2 9a15 15 0 0 1 6-4.3M12 4.5c3.6 0 7 1.5 9.5 4M8.5 16a5 5 0 0 1 6-.8M12 19.5h.01M2 2l20 20',
  check: 'M20 6L9 17l-5-5',
  // A pencil.
  edit: 'M4 20h4L19 9l-4-4L4 16v4ZM14 6l4 4',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4 21c0-4 3.5-6 8-6s8 2 8 6',
  lock: 'M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4M12 15v2',
  eye: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12ZM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
  eyeOff:
    'M10.6 5.1A10.8 10.8 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-2.4 3.3M6.6 6.6A17 17 0 0 0 2 12s3.5 7 10 7a10 10 0 0 0 5.4-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2M2 2l20 20',
  shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6zM9 12l2 2 4-4',
  device: 'M7 2h10a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1ZM11 18h2',
  alert: 'M12 3l10 18H2zM12 10v4M12 17.5h.01',
  print:
    'M6 9V3h12v6M6 18H4a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2M6 14h12v7H6z',
  download: 'M12 3v12M7 10l5 5 5-5M5 21h14',
  building:
    'M4 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16M8 7h.01M12 7h.01M8 11h.01M12 11h.01M16 21V9h2a2 2 0 0 1 2 2v10',
  // A cheque: a slip with a signature line.
  notes: 'M3 6h18v12H3zM6 10h6M6 14h3M14 15c1-1 2 1 3 0s1-1 2 0',
  chat: 'M4 5h16v11H9l-5 4V5ZM8 9h8M8 12h5',
  assistant:
    'M12 3l1.6 3.9L17.5 8.5l-3.9 1.6L12 14l-1.6-3.9L6.5 8.5l3.9-1.6L12 3ZM18.5 14l.8 1.7 1.7.8-1.7.8-.8 1.7-.8-1.7-1.7-.8 1.7-.8.8-1.7ZM6 15l.6 1.4L8 17l-1.4.6L6 19l-.6-1.4L4 17l1.4-.6L6 15Z',
  send: 'M4 12l16-8-6 16-2.5-6.5L4 12Z',
  // An open ledger book.
  ledger: 'M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2V5ZM4 19V5M19 17H6M9 7h6M9 11h6',
  // A delivery truck: box, cab and two wheels.
  delivery:
    'M14 17V5H2v12h3M9 17h6M19 17h2v-4l-3-4h-4M7 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM17 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z',
  // Return / credit note: a "back" arrow curling home.
  returns: 'M9 14L4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11',
};

const DIRECTIONAL = new Set(['chevronRight', 'logout', 'returns']);

export interface IconProps {
  name: string;
  size?: number;
  className?: string;
  style?: CSSProperties;
  strokeWidth?: number;
  title?: string;
}

export function Icon({ name, size = 20, className, style, strokeWidth = 1.75, title }: IconProps) {
  const d = PATHS[name] ?? PATHS.dashboard!;
  const flip = DIRECTIONAL.has(name) ? 'flip-rtl' : '';
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`${flip} ${className ?? ''}`}
      style={style}
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
      focusable="false"
    >
      {title ? <title>{title}</title> : null}
      <path d={d} />
    </svg>
  );
}
