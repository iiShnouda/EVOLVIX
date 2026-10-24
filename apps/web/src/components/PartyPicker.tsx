import { useDeferredValue, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Party, TranslationKey } from '@skb/shared';
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
 * a code fills in the name, and picking a name fills in its code. The arrow at its end opens the
 * whole list (owner, 2026-10-02); code 0 is the walk-in cash customer.
 *
 * Opening it shows the first 7 by name (owner, 2026-10-19: less for the server to send); typing
 * completes the name with the best match, selected so typing on replaces it (Enter or Tab takes
 * it); emptying the box clears the choice. A typed code shows whose it is before it is taken.
 */
const NO_ROWS: Party[] = [];

export function PartyPicker({
  type,
  value,
  onChange,
  label,
  placeholder,
  withCode,
  disabled,
}: {
  type: 'CUSTOMER' | 'SUPPLIER' | 'CARRIER';
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
  /** The rest of the best match's name, shown selected after what was typed. */
  const [hint, setHint] = useState('');
  const completing = useRef(false);
  const [open, setOpen] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  // The chosen name stays in the box to edit like any text (owner, 2026-10-17: clicking in it
  // wiped the whole name); the list narrows only once the text differs from it.
  const typed = text.trim() !== (value?.name ?? '').trim() ? text.trim() : '';
  const search = useDeferredValue(typed);
  const list = useParties({
    page: 1,
    pageSize: 7,
    type,
    active: true,
    search: search || undefined,
    enabled: open,
  });
  const rows = list.data?.items ?? NO_ROWS;
  useEffect(() => {
    const top = rows[0];
    setHint(
      open && completing.current && text && top?.name.toLowerCase().startsWith(text.toLowerCase())
        ? top.name.slice(text.length)
        : '',
    );
  }, [rows, text, open]);
  useLayoutEffect(() => {
    const el = input.current;
    if (hint && el && document.activeElement === el)
      el.setSelectionRange(text.length, text.length + hint.length);
  }, [hint, text]);
  const take = (p: Party) => {
    onChange(p);
    setHint('');
    setOpen(false);
  };

  // Whose a typed code is, shown under it before it is taken.
  const [codeHint, setCodeHint] = useState<Party | null>(null);

  // The code box shows the chosen one's code until something else is typed in it.
  const [code, setCode] = useState(value ? String(value.code) : '');
  const [codeError, setCodeError] = useState(false);
  const [looking, setLooking] = useState(false);
  useEffect(() => {
    setCode(value ? String(value.code) : '');
    setCodeError(false);
  }, [value]);

  useEffect(() => {
    const n = Number(code.trim());
    if (!code.trim() || !Number.isInteger(n) || (value && n === value.code)) {
      setCodeHint(null);
      return;
    }
    const timer = setTimeout(() => {
      api
        .get<Paginated<Party>>(`/parties?type=${type}&active=true&code=${n}&pageSize=1`)
        .then((r) => setCodeHint(r.items[0] ?? null))
        .catch(() => setCodeHint(null));
    }, 300);
    return () => clearTimeout(timer);
  }, [code, type, value]);

  async function findByCode() {
    const n = Number(code.trim());
    if (!code.trim()) return;
    if (value && n === value.code) return;
    if (!Number.isInteger(n) || n < 0) {
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

  // Each box says what goes in it (owner, 2026-10-22): "customer code", "supplier name"…
  const codeKey: TranslationKey =
    type === 'CUSTOMER'
      ? 'parties.customerCode'
      : type === 'SUPPLIER'
        ? 'parties.supplierCode'
        : 'parties.carrierCode';
  const nameKey: TranslationKey =
    type === 'CUSTOMER'
      ? 'parties.customerName'
      : type === 'SUPPLIER'
        ? 'parties.supplierName'
        : 'parties.carrierName';
  const generic = [t('invoice.customer'), t('invoice.supplier'), t('inventory.supplier')];
  const nameLabel = !withCode
    ? label
    : generic.includes(label)
      ? t(nameKey)
      : `${label} (${t(nameKey)})`;
  const name = (
    <label className="relative block min-w-0 flex-1">
      <span className="mb-0.5 block truncate text-xs text-muted">{nameLabel}</span>
      <span className="pointer-events-none absolute bottom-0 start-2.5 grid h-9 place-items-center text-faint">
        <Icon name="search" size={15} />
      </span>
      <input
        ref={input}
        className={`${field} ps-8 pe-8 disabled:opacity-50`}
        disabled={disabled}
        role="combobox"
        aria-expanded={open}
        placeholder={placeholder}
        value={open ? text + hint : (value?.name ?? '')}
        onFocus={() => {
          completing.current = false;
          setText(value?.name ?? '');
          setOpen(true);
        }}
        // Later than a click on a result, so the click still lands. An emptied box clears it.
        onBlur={() =>
          setTimeout(() => {
            setOpen(false);
            setHint('');
            if (!input.current?.value.trim() && value) onChange(null);
          }, 150)
        }
        onChange={(e) => {
          // Deleting doesn't complete again, or the letter just removed would come back.
          const kind = (e.nativeEvent as InputEvent).inputType ?? '';
          completing.current = !kind.startsWith('delete');
          setHint('');
          setText(e.target.value);
        }}
        onKeyDown={(e) => {
          if ((e.key === 'Enter' || (e.key === 'Tab' && hint)) && rows[0]) {
            if (e.key === 'Enter') e.preventDefault();
            take(rows[0]);
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          } else if (e.key === 'Escape') setOpen(false);
        }}
      />
      <button
        type="button"
        tabIndex={-1}
        disabled={disabled}
        aria-label={t('common.showAll')}
        title={t('common.showAll')}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          if (open) {
            setOpen(false);
            input.current?.blur();
          } else input.current?.focus();
        }}
        className="absolute bottom-0 end-0 grid h-9 w-8 place-items-center text-muted hover:text-fg disabled:opacity-50"
      >
        <Icon name="chevronDown" size={16} className={open ? 'rotate-180' : ''} />
      </button>
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
                onClick={() => take(p)}
                className={`flex w-full items-start gap-2 px-3 py-2 text-start text-sm hover:bg-surface-2 ${p.id === value?.id ? 'bg-brand-soft' : ''}`}
              >
                <span className="mt-px min-w-8 shrink-0 rounded bg-surface-2 px-1 text-center text-xs text-muted tnum">
                  {p.code}
                </span>
                {/* Only the code and name: a party's details are on its directory page, for
                    whoever may see them (owner, 2026-10-19). */}
                <span className="block min-w-0 flex-1 truncate font-medium">{p.name}</span>
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
        <span className="mb-0.5 block truncate text-xs text-muted">{t(codeKey)}</span>
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
        ) : codeHint ? (
          <span className="mt-0.5 block truncate text-xs text-brand">{codeHint.name}</span>
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
