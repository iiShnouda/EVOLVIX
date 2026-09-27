import { balanceView, formatMoney, type Party, type PartyType } from '@skb/shared';
import { Badge, Card, EmptyState, PageHeader, Spinner } from '../components/ui';
import { Icon } from '../components/Icon';
import { useT } from '../lib/i18n';
import { useParties } from '../lib/queries';
import type { Tone } from '../components/ui';

const TYPE_LABEL: Record<PartyType, 'parties.customer' | 'parties.supplier' | 'parties.factory'> = {
  CUSTOMER: 'parties.customer',
  SUPPLIER: 'parties.supplier',
  FACTORY: 'parties.factory',
};

export function PartiesPage() {
  const { t, locale } = useT();
  const { data, isLoading } = useParties({ page: 1 });

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
            <PartyCard key={party.id} party={party} locale={locale} t={t} />
          ))}
        </div>
      )}
    </div>
  );
}

function PartyCard({
  party,
  locale,
  t,
}: {
  party: Party;
  locale: 'en' | 'ar';
  t: (k: never) => string;
}) {
  const bal = balanceView(party.balance, party.currency);
  const balLabel =
    bal.direction === 'receivable'
      ? t('parties.theyOweUs' as never)
      : bal.direction === 'payable'
        ? t('parties.weOweThem' as never)
        : t('parties.settled' as never);
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
                  {t(TYPE_LABEL[type] as never)}
                </Badge>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="mt-4 rounded-[var(--radius-app)] bg-surface-2 p-3">
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted">{balLabel}</span>
          <Badge tone={balTone}>{balLabel}</Badge>
        </div>
        <p className={`mt-1 text-lg font-semibold tnum ${balColor}`}>
          {formatMoney(bal.amount, bal.currency, locale)}
        </p>
      </div>

      {party.phone && (
        <p className="mt-3 flex items-center gap-1.5 text-xs text-muted">
          <Icon name="staff" size={14} /> {party.phone}
        </p>
      )}
    </Card>
  );
}
