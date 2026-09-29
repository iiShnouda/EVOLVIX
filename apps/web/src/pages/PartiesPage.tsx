import {
  balanceView,
  formatMoney,
  type Party,
  type PartyType,
  type PriceLevel,
  type TranslationKey,
} from '@skb/shared';
import { Badge, Card, EmptyState, PageHeader, Spinner } from '../components/ui';
import { Icon } from '../components/Icon';
import { useT } from '../lib/i18n';
import { useCan } from '../lib/can';
import { ApiError } from '../lib/api';
import { useParties, usePriceLevels, useSetPartyPriceLevels } from '../lib/queries';
import type { Tone } from '../components/ui';

const TYPE_LABEL: Record<PartyType, TranslationKey> = {
  CUSTOMER: 'parties.customer',
  SUPPLIER: 'parties.supplier',
  FACTORY: 'parties.factory',
};

const field =
  'h-8 w-full rounded-[var(--radius-app)] border border-line bg-surface px-2 text-xs outline-none focus:border-brand disabled:opacity-70';

export function PartiesPage() {
  const { t } = useT();
  const { data, isLoading } = useParties({ page: 1 });
  const levels = usePriceLevels();

  return (
    <div className="space-y-5">
      <PageHeader
        title={t('parties.title')}
        subtitle={data ? `${data.total} ${t('common.total')}` : undefined}
      />

      {isLoading ? (
        <div className="grid place-items-center py-16 text-muted">
          <Spinner size={26} />
        </div>
      ) : !data || data.items.length === 0 ? (
        <Card>
          <EmptyState title={t('common.empty')} icon="parties" />
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {data.items.map((party) => (
            <PartyCard key={party.id} party={party} levels={levels.data ?? []} />
          ))}
        </div>
      )}
    </div>
  );
}

function PartyCard({ party, levels }: { party: Party; levels: PriceLevel[] }) {
  const { t, locale } = useT();
  const can = useCan();
  const bal = balanceView(party.balance, party.currency);
  const balLabel =
    bal.direction === 'receivable'
      ? t('parties.theyOweUs')
      : bal.direction === 'payable'
        ? t('parties.weOweThem')
        : t('parties.settled');
  const balTone: Tone =
    bal.direction === 'receivable'
      ? 'positive'
      : bal.direction === 'payable'
        ? 'warning'
        : 'neutral';
  const balColor =
    bal.direction === 'receivable'
      ? 'text-positive'
      : bal.direction === 'payable'
        ? 'text-warning'
        : 'text-muted';

  return (
    <Card>
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-surface-2 text-muted">
            <Icon name="parties" size={20} />
          </span>
          <div className="min-w-0">
            <p className="truncate font-medium">{party.name}</p>
            <div className="mt-0.5 flex flex-wrap gap-1">
              {party.types.map((type) => (
                <Badge key={type} tone="brand">
                  {t(TYPE_LABEL[type])}
                </Badge>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="mt-4 rounded-[var(--radius-app)] bg-surface-2 p-3">
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted">{t('parties.balance')}</span>
          <Badge tone={balTone}>{balLabel}</Badge>
        </div>
        <p className={`mt-1 text-lg font-semibold tnum ${balColor}`}>
          {formatMoney(bal.amount, bal.currency, locale)}
        </p>
      </div>

      {levels.length > 0 && (
        <PriceLevelPicker party={party} levels={levels} canSet={can('parties:set_price_level')} />
      )}

      {party.phone && (
        <p className="mt-3 flex items-center gap-1.5 text-xs text-muted">
          <Icon name="staff" size={14} /> {party.phone}
        </p>
      )}
    </Card>
  );
}

/** The party's own price levels: what new invoices to / from them start at. */
function PriceLevelPicker({
  party,
  levels,
  canSet,
}: {
  party: Party;
  levels: PriceLevel[];
  canSet: boolean;
}) {
  const { t } = useT();
  const set = useSetPartyPriceLevels();
  const error = set.error as ApiError | null;
  const sides = [
    party.types.includes('CUSTOMER') && {
      side: 'SALE' as const,
      label: t('parties.salesLevel'),
      value: party.salesPriceLevelId ?? '',
      key: 'salesPriceLevelId' as const,
    },
    (party.types.includes('SUPPLIER') || party.types.includes('FACTORY')) && {
      side: 'PURCHASE' as const,
      label: t('parties.purchaseLevel'),
      value: party.purchasePriceLevelId ?? '',
      key: 'purchasePriceLevelId' as const,
    },
  ].filter((x) => !!x);

  return (
    <div className="mt-3 grid gap-2">
      {sides.map((s) => {
        const options = levels.filter((l) => l.side === s.side && (l.isActive || l.id === s.value));
        const def = options.find((l) => l.isDefault);
        return (
          <label key={s.side} className="block">
            <span className="mb-0.5 block text-xs text-muted">{s.label}</span>
            <select
              className={field}
              value={s.value}
              disabled={!canSet || set.isPending}
              onChange={(e) => set.mutate({ id: party.id, input: { [s.key]: e.target.value } })}
            >
              <option value="">
                {t('parties.defaultLevel')}
                {def ? ` (${def.name})` : ''}
              </option>
              {options.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </label>
        );
      })}
      {error && <p className="text-xs text-destructive">{error.message}</p>}
    </div>
  );
}
