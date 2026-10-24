import { useEffect, useRef, useState } from 'react';
import { Icon } from './Icon';
import { useT, joinList } from '../lib/i18n';

/**
 * A labelled drop-down where several choices can be ticked at once (owner, 2026-10-21: the stock
 * status). Nothing ticked means all.
 */
export function MultiSelect({
  label,
  options,
  value,
  onChange,
  className,
}: {
  label: string;
  options: { value: string; label: string }[];
  value: string[];
  onChange: (next: string[]) => void;
  className?: string;
}) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  const chosen = options.filter((o) => value.includes(o.value));
  const shown = chosen.length === 0 ? t('common.all') : joinList(chosen.map((o) => o.label));
  return (
    <div ref={box} className={`relative block ${className ?? ''}`}>
      <span className="mb-0.5 block text-xs text-muted">{label}</span>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex h-9 w-full items-center justify-between gap-2 rounded-[var(--radius-app)] border border-line bg-surface px-2.5 text-start text-sm outline-none focus:border-brand"
      >
        <span className="min-w-0 truncate">{shown}</span>
        <Icon name="chevronDown" size={16} className="shrink-0 text-muted" />
      </button>
      {open && (
        <div
          role="listbox"
          aria-multiselectable
          className="absolute z-30 mt-1 w-full min-w-[12rem] rounded-[var(--radius-app)] border border-line bg-surface p-1 shadow-[var(--shadow-card)]"
        >
          <label className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-surface-2">
            <input type="checkbox" checked={value.length === 0} onChange={() => onChange([])} />
            {t('common.all')}
          </label>
          {options.map((o) => (
            <label
              key={o.value}
              className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-surface-2"
            >
              <input
                type="checkbox"
                checked={value.includes(o.value)}
                onChange={(e) =>
                  onChange(
                    e.target.checked ? [...value, o.value] : value.filter((v) => v !== o.value),
                  )
                }
              />
              {o.label}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
