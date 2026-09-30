import { useDeferredValue, useState } from 'react';
import type { Party } from '@skb/shared';
import { Spinner } from './ui';
import { Icon } from './Icon';
import { useT } from '../lib/i18n';
import { useParties } from '../lib/queries';

const field =
  'h-9 w-full rounded-[var(--radius-app)] border border-line bg-surface px-2.5 text-sm outline-none focus:border-brand';

/**
 * Pick a customer or supplier by typing part of the name or phone: the list narrows as you type
 * (the server searches), and opens with the first ones before anything is typed.
 */
export function PartyPicker({
  type,
  value,
  onChange,
  label,
  placeholder,
}: {
  type: 'CUSTOMER' | 'SUPPLIER';
  value: Party | null;
  onChange: (party: Party | null) => void;
  label: string;
  placeholder: string;
}) {
  const { t } = useT();
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const search = useDeferredValue(text.trim());
  const list = useParties({ page: 1, pageSize: 30, type, active: true, search: search || undefined, enabled: open });
  const rows = list.data?.items ?? [];

  return (
    <label className="relative block">
      <span className="mb-0.5 block text-xs text-muted">{label}</span>
      <span className="pointer-events-none absolute bottom-0 start-2.5 grid h-9 place-items-center text-faint">
        <Icon name="search" size={15} />
      </span>
      <input
        className={`${field} ps-8`}
        role="combobox"
        aria-expanded={open}
        placeholder={value ? value.name : placeholder}
        value={open ? text : (value?.name ?? '')}
        onFocus={() => {
          setText('');
          setOpen(true);
        }}
        // Later than a click on a result, so the click still lands.
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && rows[0]) {
            e.preventDefault();
            onChange(rows[0]);
            setOpen(false);
            (e.target as HTMLInputElement).blur();
          } else if (e.key === 'Escape') setOpen(false);
        }}
      />
      {open && (
        <div className="absolute z-30 mt-1 max-h-72 w-full overflow-auto rounded-[var(--radius-app)] border border-line bg-surface shadow-[var(--shadow-card)]">
          {list.isLoading ? (
            <div className="grid place-items-center py-5 text-muted">
              <Spinner size={18} />
            </div>
          ) : rows.length === 0 ? (
            <p className="p-3 text-sm text-muted">{t('common.empty')}</p>
          ) : (
            rows.map((p) => (
              <button
                key={p.id}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onChange(p);
                  setOpen(false);
                }}
                className={`block w-full px-3 py-2 text-start text-sm hover:bg-surface-2 ${p.id === value?.id ? 'bg-brand-soft' : ''}`}
              >
                <span className="block truncate font-medium">{p.name}</span>
                {(p.phone || p.contactName) && (
                  <span className="block truncate text-xs text-muted">
                    {[p.phone, p.contactName].filter(Boolean).join(' · ')}
                  </span>
                )}
              </button>
            ))
          )}
        </div>
      )}
    </label>
  );
}
