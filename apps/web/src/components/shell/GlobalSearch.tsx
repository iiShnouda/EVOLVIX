import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  type DocumentList,
  type Paginated,
  type Party,
  type Product,
  type TranslationKey,
} from '@skb/shared';
import { Icon } from '../Icon';
import { Sheet } from '../Sheet';
import { CodeName } from '../CodeName';
import { api } from '../../lib/api';
import { useT } from '../../lib/i18n';
import { useCan } from '../../lib/can';
import { useAuth } from '../../stores/auth';
import { FROM_MENU } from '../../lib/tabs';
import { QUICK_ACTIONS, mayUse } from '../../lib/quickActions';

/** One thing found: what it is, how it reads, where it goes. */
interface Hit {
  key: string;
  icon: string;
  label: ReactNode;
  detail?: string;
  to: string;
}

/** The value after a short pause in typing. */
function useSettled(value: string, ms = 250) {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setSettled(value), ms);
    return () => window.clearTimeout(id);
  }, [value, ms]);
  return settled;
}

/**
 * What the search box finds (owner, 2026-10-06: "what is this search for?"): customers, suppliers
 * and shipping companies by name, code or phone; sales and purchase invoices by number; items by
 * name, code or barcode; and the app's pages and actions. Each part only for people who may see it;
 * the server checks again.
 */
function useHits(text: string) {
  const { t } = useT();
  const can = useCan();
  const permissions = useAuth((s) => s.user?.permissions ?? []);
  const q = useSettled(text.trim());
  const on = q.length > 0;
  const enc = encodeURIComponent(q);

  const parties = useQuery({
    queryKey: ['search', 'parties', q],
    queryFn: () => api.get<Paginated<Party>>(`/parties?page=1&pageSize=5&search=${enc}`),
    enabled: on && can('parties:view'),
  });
  const sales = useQuery({
    queryKey: ['search', 'sales', q],
    queryFn: () => api.get<DocumentList>(`/sales/invoices?page=1&pageSize=5&number=${enc}`),
    enabled: on && can('sales:view'),
  });
  const purchases = useQuery({
    queryKey: ['search', 'purchases', q],
    queryFn: () => api.get<DocumentList>(`/purchases/invoices?page=1&pageSize=5&number=${enc}`),
    enabled: on && can('purchases:view'),
  });
  const items = useQuery({
    queryKey: ['search', 'items', q],
    queryFn: () => api.get<Product[]>(`/products?limit=5&search=${enc}`),
    enabled: on && can('inventory:view'),
  });

  const groups = useMemo(() => {
    if (!on) return [];
    const low = q.toLowerCase();
    const pages: Hit[] = QUICK_ACTIONS.filter(
      (a) => mayUse(a, permissions) && t(a.label).toLowerCase().includes(low),
    )
      .slice(0, 6)
      .map((a) => ({ key: `p-${a.id}`, icon: a.icon, label: t(a.label), to: a.path }));
    const out: { title: TranslationKey; hits: Hit[] }[] = [
      {
        title: 'search.parties',
        hits: (parties.data?.items ?? []).map((p) => ({
          key: `c-${p.id}`,
          icon: p.types.includes('CARRIER') ? 'delivery' : 'parties',
          label: <CodeName code={p.code} name={p.name} truncate />,
          detail: p.phone ?? undefined,
          to: `/parties/${p.id}/account`,
        })),
      },
      {
        title: 'search.sales',
        hits: (sales.data?.items ?? []).map((d) => ({
          key: `s-${d.id}`,
          icon: 'sales',
          label: d.number,
          detail: d.partyName,
          to: `/sales?doc=${d.id}`,
        })),
      },
      {
        title: 'search.purchases',
        hits: (purchases.data?.items ?? []).map((d) => ({
          key: `b-${d.id}`,
          icon: 'purchases',
          label: d.number,
          detail: d.partyName,
          to: `/purchases?doc=${d.id}`,
        })),
      },
      {
        title: 'search.items',
        hits: (items.data ?? []).slice(0, 5).map((p) => ({
          key: `i-${p.id}`,
          icon: 'inventory',
          label: p.name,
          detail: p.sku,
          to: `/inventory/items/${p.id}`,
        })),
      },
      { title: 'search.pages', hits: pages },
    ];
    return out.filter((g) => g.hits.length > 0);
  }, [on, q, t, permissions, parties.data, sales.data, purchases.data, items.data]);

  const loading =
    on && [parties, sales, purchases, items].some((x) => x.isFetching && x.fetchStatus !== 'idle');
  return { groups, loading, settled: q };
}

function Results({ text, onPick }: { text: string; onPick: (to: string) => void }) {
  const { t } = useT();
  const { groups, loading } = useHits(text);
  if (!text.trim()) return null;
  return (
    <div className="max-h-[70vh] overflow-y-auto p-1">
      {groups.length === 0 ? (
        <p className="px-3 py-4 text-center text-sm text-muted">
          {loading ? t('common.loading') : t('search.none')}
        </p>
      ) : (
        groups.map((g) => (
          <div key={g.title} className="py-1">
            <p className="px-3 py-1 text-[11px] font-semibold uppercase text-muted">{t(g.title)}</p>
            {g.hits.map((h) => (
              <button
                key={h.key}
                type="button"
                data-hit={h.to}
                onClick={() => onPick(h.to)}
                className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-start text-sm hover:bg-surface-2 focus:bg-surface-2 focus:outline-none"
              >
                <Icon name={h.icon} size={16} className="shrink-0 text-brand" />
                <span className="min-w-0 flex-1 truncate font-medium">{h.label}</span>
                {h.detail && (
                  <span className="max-w-[45%] shrink-0 truncate text-xs text-muted">
                    {h.detail}
                  </span>
                )}
              </button>
            ))}
          </div>
        ))
      )}
    </div>
  );
}

/** The top bar's search box (Ctrl+K or / puts the cursor in it). */
export function GlobalSearch() {
  const { t } = useT();
  const navigate = useNavigate();
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement)?.closest(
        'input, textarea, select, [contenteditable]',
      );
      if ((e.key === 'k' && (e.ctrlKey || e.metaKey)) || (e.key === '/' && !typing)) {
        e.preventDefault();
        input.current?.focus();
        setOpen(true);
      }
    };
    const onDown = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
    };
  }, []);

  const pick = (to: string) => {
    setOpen(false);
    setText('');
    input.current?.blur();
    navigate(to, { state: FROM_MENU });
  };

  return (
    <div ref={box} className="relative hidden max-w-md flex-1 md:block">
      <label className="relative flex items-center">
        <span className="pointer-events-none absolute start-3 text-faint">
          <Icon name="search" size={18} />
        </span>
        <input
          ref={input}
          type="search"
          value={text}
          placeholder={t('search.placeholder')}
          aria-label={t('common.search')}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setText(e.target.value);
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setOpen(false);
              input.current?.blur();
            }
            if (e.key === 'Enter') {
              const first = box.current?.querySelector<HTMLButtonElement>('[data-hit]');
              if (first?.dataset.hit) pick(first.dataset.hit);
            }
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              box.current?.querySelector<HTMLButtonElement>('[data-hit]')?.focus();
            }
          }}
          className="h-10 w-full rounded-[var(--radius-app)] border border-line bg-canvas ps-10 pe-3 text-sm outline-none focus:border-brand"
        />
      </label>
      {open && text.trim() && (
        <div
          className="absolute inset-x-0 top-12 z-50 rounded-[var(--radius-app)] border border-line bg-surface shadow-[var(--shadow-pop)]"
          onKeyDown={(e) => {
            const all = [...(box.current?.querySelectorAll<HTMLButtonElement>('[data-hit]') ?? [])];
            const at = all.indexOf(document.activeElement as HTMLButtonElement);
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              all[Math.min(all.length - 1, at + 1)]?.focus();
            }
            if (e.key === 'ArrowUp') {
              e.preventDefault();
              if (at <= 0) input.current?.focus();
              else all[at - 1]?.focus();
            }
            if (e.key === 'Escape') setOpen(false);
          }}
        >
          <Results text={text} onPick={pick} />
        </div>
      )}
    </div>
  );
}

/** On a phone: a search button in the header that opens the same search over the page. */
export function PhoneSearch() {
  const { t } = useT();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t('common.search')}
        title={t('common.search')}
        className="grid h-9 w-9 place-items-center rounded-lg text-muted hover:bg-surface-2 hover:text-fg"
      >
        <Icon name="search" size={20} />
      </button>
      {open && (
        <Sheet
          title={t('common.search')}
          onClose={() => setOpen(false)}
          closeLabel={t('common.close')}
        >
          <input
            autoFocus
            type="search"
            value={text}
            placeholder={t('search.placeholder')}
            onChange={(e) => setText(e.target.value)}
            className="h-11 w-full rounded-[var(--radius-app)] border border-line bg-canvas px-3 text-base outline-none focus:border-brand"
          />
          <div className="mt-2">
            <Results
              text={text}
              onPick={(to) => {
                setOpen(false);
                setText('');
                navigate(to, { state: FROM_MENU });
              }}
            />
          </div>
        </Sheet>
      )}
    </>
  );
}
