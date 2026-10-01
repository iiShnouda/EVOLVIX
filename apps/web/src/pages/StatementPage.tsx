import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { Party } from '@skb/shared';
import { Card, PageHeader } from '../components/ui';
import { PartyPicker } from '../components/PartyPicker';
import { StatementBody } from '../components/LedgerStatementSheet';
import { useT } from '../lib/i18n';
import { api } from '../lib/api';

const field =
  'h-9 w-full rounded-[var(--radius-app)] border border-line bg-surface px-2.5 text-sm outline-none focus:border-brand';

/**
 * Account statement (كشف الحساب) as its own page, like the old program (owner, 2026-10-01): pick
 * customers or suppliers, then the account by code or name; the period, branch and items are set
 * on the statement itself. `?party=<id>` opens one straight away.
 */
export function StatementPage() {
  const { t } = useT();
  const [params, setParams] = useSearchParams();
  const [type, setType] = useState<'CUSTOMER' | 'SUPPLIER'>('CUSTOMER');
  const [party, setParty] = useState<Party | null>(null);
  const linked = params.get('party');
  const [loaded, setLoaded] = useState<string | null>(null);
  if (linked && linked !== loaded && linked !== party?.id) {
    setLoaded(linked);
    void api
      .get<Party>(`/parties/${linked}`)
      .then((p) => {
        setParty(p);
        if (!p.types.includes('CUSTOMER') && p.types.includes('SUPPLIER')) setType('SUPPLIER');
      })
      .catch(() => undefined);
  }

  return (
    <div className="space-y-5">
      <PageHeader title={t('statement.title')} />
      <Card className="grid gap-4 sm:grid-cols-[10rem_minmax(0,1fr)]">
        <label className="block">
          <span className="mb-0.5 block text-xs text-muted">{t('statement.type')}</span>
          <select
            className={field}
            value={type}
            onChange={(e) => {
              setType(e.target.value as 'CUSTOMER' | 'SUPPLIER');
              setParty(null);
              setParams({}, { replace: true });
            }}
          >
            <option value="CUSTOMER">{t('statement.customers')}</option>
            <option value="SUPPLIER">{t('statement.suppliers')}</option>
          </select>
        </label>
        <PartyPicker
          type={type}
          withCode
          value={party}
          onChange={(p) => {
            setParty(p);
            setParams(p ? { party: p.id } : {}, { replace: true });
          }}
          label={t(type === 'CUSTOMER' ? 'invoice.customer' : 'invoice.supplier')}
          placeholder={t('statement.pick')}
        />
      </Card>
      {party ? (
        <Card>
          <StatementBody key={party.id} kind="parties" id={party.id} title={party.name} />
        </Card>
      ) : (
        <Card>
          <p className="py-6 text-center text-sm text-muted">{t('statement.pick')}</p>
        </Card>
      )}
    </div>
  );
}
