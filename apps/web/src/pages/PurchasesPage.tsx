import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { formatDate, formatMoney } from '@skb/shared';
import { Badge, Button, Card, EmptyState, PageHeader, Spinner } from '../components/ui';
import { Icon } from '../components/Icon';
import { useT } from '../lib/i18n';
import { useAuth } from '../stores/auth';
import { usePurchaseInvoices } from '../lib/queries';
import { STATUS_TONE } from '../lib/status';

export function PurchasesPage() {
  const { t, locale } = useT();
  const navigate = useNavigate();
  const canCreate = useAuth((s) => s.user?.permissions ?? []).includes('purchases:create');
  const [page] = useState(1);
  const list = usePurchaseInvoices({ page });
  const rows = list.data?.items ?? [];

  return (
    <div className="space-y-5">
      <PageHeader
        title={t('nav.purchases')}
        subtitle={list.data ? `${list.data.total} ${t('common.total')}` : undefined}
        action={
          canCreate ? (
            <Button icon="plus" size="sm" onClick={() => navigate('/purchases/new')}>
              {t('invoice.newPurchase')}
            </Button>
          ) : undefined
        }
      />

      <Card padded={false} className="overflow-hidden">
        {list.isLoading ? (
          <div className="grid place-items-center py-16 text-muted">
            <Spinner size={26} />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState title={t('common.empty')} icon="purchases" />
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-line bg-surface-2 text-xs text-muted">
              <tr>
                <th className="p-3 text-start font-medium">{t('sales.number')}</th>
                <th className="p-3 text-start font-medium">{t('invoice.supplier')}</th>
                <th className="hidden p-3 text-start font-medium md:table-cell">{t('common.date')}</th>
                <th className="p-3 text-start font-medium">{t('common.status')}</th>
                <th className="p-3 text-end font-medium">{t('common.total')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--c-line)]">
              {rows.map((doc) => (
                <tr key={doc.id} className="transition-colors hover:bg-surface-2">
                  <td className="p-3 font-medium tnum">{doc.number}</td>
                  <td className="p-3">
                    <span className="flex items-center gap-2">
                      <Icon name="parties" size={16} className="text-faint" />
                      <span className="truncate">{doc.partyName}</span>
                    </span>
                  </td>
                  <td className="hidden p-3 text-muted tnum md:table-cell">
                    {formatDate(doc.issueDate, locale)}
                  </td>
                  <td className="p-3">
                    <Badge tone={STATUS_TONE[doc.status]}>{t(`status.${doc.status}`)}</Badge>
                  </td>
                  <td className="p-3 text-end font-semibold tnum">
                    {formatMoney(doc.grandTotal, doc.currency, locale)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
