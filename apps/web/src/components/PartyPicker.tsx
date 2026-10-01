import { useDeferredValue, useEffect, useState } from 'react';
import type { Party } from '@skb/shared';
import { Spinner } from './ui';
import { Icon } from './Icon';
import { useT } from '../lib/i18n';
import { api } from '../lib/api';
import { useParties } from '../lib/queries';
import type { Paginated } from '@skb/shared';

const field =
  'h-9 w-full rounded-[var(--radius-app)] border border-line bg-surface px-2.5 text-sm outline-none focus:border-brand';

/**
 * Pick a customer or supplier by typing part of the name or phone: the list narrows as you type
 * (the server searches), and opens with the first ones before anything is typed. Each shows its
 * code (كود). With `withCode`, a code box sits beside the name (owner decision 2026-09-30): typing
 * a code fills in the name, and picking a name fills in its code.
 */
export function PartyPicker({
  type,
  value,
  onChange,
  label,
  placeholder,
  withCode,
  disabled,
}: {
  type: 'CUSTOMER' | 'SUPPLIER';
  value: Party | null;
  onChange: (party: Party | null) => void;
  label: string;
  placeholder: string;
  withCode?: boolean;
  /** Locked (e.g. "no supplier" is ticked). */
  disabled?: boolean;
}) {
  const { t } = useT();
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const search = useDeferredValue(text.trim());
  const list = useParties({
    page: 1,
    pageSize: 30,
    type,
    active: true,
    search: search || undefined,
    enabled: open,
  });
  const rows = list.data?.items ?? [];

  // The code box shows the chosen one's code until something else is typed in it.
  const [code, setCode] = useState(value ? String(value.code) : '');
  const [codeError, setCodeError] = useState(false);
  const [looking, setLooking] = useState(false);
  useEffect(() => {
    setCode(value ? String(value.code) : '');
    setCodeError(false);
  }, [value]);

  async function findByCode() {
    const n = Number(code.trim());
    if (!code.trim()) return;
    if (value && n === value.code) return;
    if (!Number.isInteger(n) || n <= 0) {
      setCodeError(true);
      return;
    }
    setLooking(true);
    try {
      const found = await api.get<Paginated<Party>>(
        `/parties?type=${type}&active=true&code=${n}&pageSize=1`,
      );
      const hit = found.items[0];
      setCodeError(!hit);
      if (hit) onChange(hit);
    } catch {
      setCodeError(true);
    } finally {
      setLooking(false);
    }
  }

  const name = (
    <label className="relative block min-w-0 flex-1">
      <span className="mb-0.5 block text-xs text-muted">{label}</span>
      <span className="pointer-events-none absolute bottom-0 start-2.5 grid h-9 place-items-center text-faint">
        <Icon name="search" size={15} />
      </span>
      <input
        className={`${field} ps-8 disabled:opacity-50`}
        disabled={disabled}
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
                className={`flex w-full items-start gap-2 px-3 py-2 text-start text-sm hover:bg-surface-2 ${p.id === value?.id ? 'bg-brand-soft' : ''}`}
              >
                <span className="mt-px min-w-8 shrink-0 rounded bg-surface-2 px-1 text-center text-xs text-muted tnum">
                  {p.code}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{p.name}</span>
                  {(p.phone || p.contactName) && (
                    <span className="block truncate text-xs text-muted">
                      {[p.phone, p.contactName].filter(Boolean).join(' · ')}
                    </span>
                  )}
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </label>
  );

  if (!withCode) return name;
  return (
    <div className="flex items-start gap-2">
      <label className="block w-24 shrink-0">
        <span className="mb-0.5 block text-xs text-muted">{t('invoice.code')}</span>
        <input
          className={`${field} tnum disabled:opacity-50 ${codeError ? 'border-destructive' : ''}`}
          disabled={disabled}
          inputMode="numeric"
          aria-invalid={codeError}
          value={code}
          onChange={(e) => {
            setCode(
              e.target.value
                .replace(/[^\d٠-٩]/g, '')
                .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))),
            );
            setCodeError(false);
          }}
          onBlur={() => void findByCode()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void findByCode();
            }
          }}
        />
        {looking ? (
          <span className="mt-0.5 block text-xs text-faint">…</span>
        ) : (
          codeError && (
            <span className="mt-0.5 block text-xs text-destructive">
              {t('invoice.codeNotFound')}
            </span>
          )
        )}
      </label>
      {name}
    </div>
  );
}
