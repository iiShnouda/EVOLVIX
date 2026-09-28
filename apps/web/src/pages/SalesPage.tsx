import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { formatDate, formatMoney, type SalesDocumentSummary } from '@skb/shared';
import { Badge, Card, EmptyState, PageHeader, Spinner, Button } from '../components/ui';
import { Icon } from '../components/Icon';
import { DocumentPreview } from '../components/DocumentPreview';
import { useT } from '../lib/i18n';
import { useAuth } from '../stores/auth';
import { useSalesInvoices, useSalesInvoice } from '../lib/queries';
import { useDeviceInfo } from '../lib/device';
import { STATUS_TONE } from '../lib/status';

export function SalesPage() {
  const { t, locale } = useT();
  const { deviceClass } = useDeviceInfo();
  const navigate = useNavigate();
  const canCreate = useAuth((s) => s.user?.permissions ?? []).includes('sales:create');
  const [page] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const list = useSalesInvoices({ page });
  const detail = useSalesInvoice(selectedId);
  const isPhone = deviceClass === 'phone';

  const rows = list.data?.items ?? [];

  return (
    <div className="space-y-5">
      <PageHeader
        title={t('sales.invoices')}
        subtitle={list.data ? `${list.data.total} ${t('common.total')}` : undefined}
        action={
          canCreate ? (
            <Button icon="plus" size="sm" onClick={() => navigate('/sales/new')}>
              {t('sales.newInvoice')}
            </Button>
          ) : undefined
        }
      />

      <div className={`grid gap-4 ${isPhone ? '' : 'lg:grid-cols-[1fr_minmax(340px,420px)]'}`}>
        {/* List */}
        <Card padded={false} className="overflow-hidden">
          {list.isLoading ? (
            <div className="grid place-items-center py-16 text-muted">
              <Spinner size={26} />
            </div>
          ) : rows.length === 0 ? (
            <EmptyState title={t('common.empty')} icon="sales" />
          ) : isPhone ? (
            <ul className="divide-y divide-[var(--c-line)]">
              {rows.map((doc) => (
                <li key={doc.id}>
                  <button
                    onClick={() => setSelectedId(doc.id)}
                    className="flex w-full items-center gap-3 p-4 text-start hover:bg-surface-2"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{doc.partyName}</span>
                      <span className="text-xs text-muted tnum">
                        {doc.number} · {formatDate(doc.issueDate, locale)}
                      </span>
                    </span>
                    <span className="text-end">
                      <span className="block text-sm font-semibold tnum">
                        {formatMoney(doc.grandTotal, doc.currency, locale)}
                      </span>
                      <Badge tone={STATUS_TONE[doc.status]}>{t(`status.${doc.status}`)}</Badge>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <table className="w-full text-sm">
              <thead className="border-b border-line bg-surface-2 text-xs text-muted">
                <tr>
                  <th className="p-3 text-start font-medium">{t('sales.number')}</th>
                  <th className="p-3 text-start font-medium">{t('sales.customer')}</th>
                  <th className="hidden p-3 text-start font-medium md:table-cell">
                    {t('common.date')}
                  </th>
                  <th className="p-3 text-start font-medium">{t('common.status')}</th>
                  <th className="p-3 text-end font-medium">{t('common.total')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--c-line)]">
                {rows.map((doc) => (
                  <SalesRow
                    key={doc.id}
                    doc={doc}
                    selected={doc.id === selectedId}
                    onSelect={() => setSelectedId(doc.id)}
                    locale={locale}
                    statusLabel={t(`status.${doc.status}`)}
                  />
                ))}
              </tbody>
            </table>
          )}
        </Card>

        {/* Detail (side panel on tablet/desktop) */}
        {!isPhone && (
          <Card padded={false} className="sticky top-20 h-[calc(100vh-7rem)] overflow-hidden">
            <DocumentPreview doc={detail.data} loading={detail.isFetching && !!selectedId} />
          </Card>
        )}
      </div>

      {/* Detail (full-screen sheet on phone) */}
      {isPhone && selectedId && (
        <div className="fixed inset-0 z-40 bg-canvas">
          <div className="h-full">
            <DocumentPreview
              doc={detail.data}
              loading={detail.isFetching}
              onClose={() => setSelectedId(null)}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function SalesRow({
  doc,
  selected,
  onSelect,
  locale,
  statusLabel,
}: {
  doc: SalesDocumentSummary;
  selected: boolean;
  onSelect: () => void;
  locale: 'en' | 'ar';
  statusLabel: string;
}) {
  return (
    <tr
      onClick={onSelect}
      className={`cursor-pointer transition-colors hover:bg-surface-2 ${selected ? 'bg-brand-soft' : ''}`}
    >
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
        <Badge tone={STATUS_TONE[doc.status]}>{statusLabel}</Badge>
      </td>
      <td className="p-3 text-end font-semibold tnum">
        {formatMoney(doc.grandTotal, doc.currency, locale)}
      </td>
    </tr>
  );
}
