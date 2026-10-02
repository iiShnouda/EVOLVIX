import { useParams } from 'react-router-dom';
import { EmptyState, PageHeader, Spinner } from '../components/ui';
import { PartyAccount } from '../components/PartyAccount';
import { SidedMoney } from '../components/LedgerStatementSheet';
import { useT } from '../lib/i18n';
import { useCompanySettings, useParty } from '../lib/queries';

/**
 * A party's account (owner, 2026-10-02: "the statement and the account are the same thing", then
 * "the statement with everything of the by-department page"): one page, see PartyAccount.
 */
export function CustomerAccountPage() {
  const { id = '' } = useParams();
  const { t } = useT();
  const party = useParty(id);
  const p = party.data;
  const currency = useCompanySettings().data?.currency ?? 'EGP';

  if (party.isLoading)
    return (
      <div className="grid place-items-center py-24 text-muted">
        <Spinner size={26} />
      </div>
    );
  if (!p) return <EmptyState title={t('common.empty')} icon="parties" />;

  return (
    <div className="min-w-0 space-y-5">
      <PageHeader
        title={`${t('account.statement')} — ${p.name}`}
        subtitle={
          [p.code != null ? `${t('common.code')} ${p.code}` : null, p.phone, p.address]
            .filter(Boolean)
            .join(' · ') || undefined
        }
        action={
          <div className="flex items-center gap-2 rounded-[var(--radius-app)] bg-surface-2 px-3 py-2 text-sm">
            <span className="text-muted">{t('account.balance')}</span>
            <SidedMoney value={p.balance} currency={currency} />
          </div>
        }
      />
      <PartyAccount key={p.id} party={p} />
    </div>
  );
}
