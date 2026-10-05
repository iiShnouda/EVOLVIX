import { useParams } from 'react-router-dom';
import { useState } from 'react';
import { Button, EmptyState, PageHeader, Spinner } from '../components/ui';
import { PartyAccount } from '../components/PartyAccount';
import { SidedMoney } from '../components/LedgerStatementSheet';
import { useT } from '../lib/i18n';
import { useCompanySettings, useParty } from '../lib/queries';
import { codeName } from '../components/CodeName';
import { PartyDirectory } from '../components/PartyContact';

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
  const [directory, setDirectory] = useState(false);

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
        title={`${t('account.statement')} — ${codeName(p.code, p.name)}`}
        subtitle={[p.phone, p.address].filter(Boolean).join(' · ') || undefined}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" size="sm" icon="parties" onClick={() => setDirectory(true)}>
              {t('parties.directory')}
            </Button>
            <div className="flex items-center gap-2 rounded-[var(--radius-app)] bg-surface-2 px-3 py-2 text-sm">
              <span className="text-muted">{t('account.balance')}</span>
              <SidedMoney value={p.balance} currency={currency} />
            </div>
          </div>
        }
      />
      <PartyAccount key={p.id} party={p} />
      {directory && <PartyDirectory id={p.id} onClose={() => setDirectory(false)} />}
    </div>
  );
}
