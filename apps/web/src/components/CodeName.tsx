import type { ReactNode } from 'react';

/**
 * A name with its code (كود) before it (owner, 2026-10-03: "the customer's and the rep's code sit
 * to the right of the name, on the invoice and everywhere"): on the right in Arabic, on the left in
 * English. No code (null) shows the name alone.
 */
export function CodeName({
  code,
  name,
  truncate = false,
  className,
}: {
  code?: number | string | null;
  name: ReactNode;
  /** Cut a long name to one line (lists); otherwise it wraps (documents). */
  truncate?: boolean;
  className?: string;
}) {
  const hasCode = code != null && code !== '';
  return (
    <span
      className={`inline-flex max-w-full items-baseline gap-1.5 ${truncate ? 'min-w-0' : 'flex-wrap'} ${className ?? ''}`}
    >
      {hasCode && (
        <span className="shrink-0 rounded bg-surface-2 px-1 text-[0.85em] font-semibold text-muted tnum">
          {code}
        </span>
      )}
      <bdi className={truncate ? 'min-w-0 truncate' : 'break-words'}>{name}</bdi>
    </span>
  );
}

/**
 * The same as text (a title, a select option): "code - name", each kept in its own direction, and
 * the whole read in the screen's direction so the code stays before the name even when the name is
 * in English on an Arabic screen.
 */
export function codeName(code: number | string | null | undefined, name: string): string {
  if (code == null || code === '') return name;
  const mark = document.documentElement.dir === 'rtl' ? '\u200F' : '\u200E';
  return `${mark}\u2068${code}\u2069 - \u2068${name}\u2069`;
}
