import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  formatDate,
  formatMoney,
  type SalesDocument,
  type SalesDocumentSummary,
  type TranslationKey,
} from '@skb/shared';
import { Badge, Button, Card, EmptyState, PageHeader, Spinner } from '../components/ui';
import { Icon } from '../components/Icon';
import { DocumentPreview } from '../components/DocumentPreview';
import { useT } from '../lib/i18n';
import { useAuth } from '../stores/auth';
import {
  useCancelQuotation,
  useDocument,
  useDocumentList,
  type DocKind,
  type DocScope,
} from '../lib/queries';
import { useDeviceInfo } from '../lib/device';
import { statusOf } from '../lib/status';
import { errorText } from '../lib/errors';
import { ConvertQuoteSheet } from '../components/ConvertQuoteSheet';

const TAB_LABEL: Record<DocScope, Partial<Record<DocKind, TranslationKey>>> = {
  sales: { invoices: 'sales.invoices', returns: 'sales.returns', quotations: 'quote.tab' },
  purchases: { invoices: 'purchases.invoices', returns: 'purchases.returns' },
};

/** An invoice that still has something left to return (and isn't cancelled). */
function isReturnable(doc: SalesDocument | undefined): doc is SalesDocument {
  return (
    !!doc &&
    (doc.type === 'SALES_INVOICE' || doc.type === 'PURCHASE_INVOICE') &&
    doc.status !== 'CANCELLED' &&
    doc.lines.some((l) => l.quantity > l.returnedQuantity)
  );
}

/**
 * Sales or purchases: invoices and returns (and, for sales, price quotations) in one master-detail
 * screen. `?tab=returns` / `?tab=quotations` opens that list.
 */
export function DocumentsPage({ scope }: { scope: DocScope }) {
  const isSales = scope === 'sales';
  const { t, locale } = useT();
  const { deviceClass } = useDeviceInfo();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab');
  const kind: DocKind =
    tab === 'returns' ? 'returns' : tab === 'quotations' && isSales ? 'quotations' : 'invoices';
  const kinds: DocKind[] = isSales
    ? ['invoices', 'returns', 'quotations']
    : ['invoices', 'returns'];

  const permissions = useAuth((s) => s.user?.permissions ?? []);
  const canCreate = permissions.includes(isSales ? 'sales:create' : 'purchases:create');
  const canReturn = permissions.includes(isSales ? 'sales:return' : 'purchases:return');
  const canQuote = isSales && permissions.includes('sales:quote');
  const [converting, setConverting] = useState(false);
  const cancelQuote = useCancelQuotation();
  const [confirmCancel, setConfirmCancel] = useState(false);

  // `?doc=<id>` (e.g. from an item card) opens that document straight away.
  const linkedId = params.get('doc');
  const [selectedId, setSelectedId] = useState<string | null>(linkedId);
  useEffect(() => {
    if (linkedId) setSelectedId(linkedId);
  }, [linkedId]);
  const list = useDocumentList(scope, kind, { page: 1 });
  const detail = useDocument(scope, selectedId);
  const isPhone = deviceClass === 'phone';
  const rows = list.data?.items ?? [];

  function switchKind(next: DocKind) {
    setSelectedId(null);
    setParams(next === 'invoices' ? {} : { tab: next }, { replace: true });
  }

  const quote = detail.data?.type === 'QUOTATION' ? detail.data : undefined;
  const quoteOpen = quote && quote.status === 'PENDING';
  const quoteActions = quote ? (
    <>
      {quoteOpen && canCreate && (
        <Button size="sm" icon="receipts" onClick={() => setConverting(true)}>
          {t('quote.makeInvoice')}
        </Button>
      )}
      {quoteOpen && canQuote && !confirmCancel && (
        <Button size="sm" variant="ghost" onClick={() => setConfirmCancel(true)}>
          {t('quote.cancel')}
        </Button>
      )}
      {quoteOpen && confirmCancel && (
        <Button
          size="sm"
          variant="danger"
          loading={cancelQuote.isPending}
          onClick={() => cancelQuote.mutate(quote.id, { onSettled: () => setConfirmCancel(false) })}
        >
          {t('quote.cancelConfirm')}
        </Button>
      )}
      {quote.invoiceId && (
        <Button
          size="sm"
          variant="secondary"
          onClick={() => {
            setSelectedId(quote.invoiceId!);
            setParams({ doc: quote.invoiceId! }, { replace: true });
          }}
        >
          {quote.invoiceNumber}
        </Button>
      )}
    </>
  ) : undefined;

  const returnAction = quote ? (
    quoteActions
  ) : canReturn && isReturnable(detail.data) ? (
    <Button
      size="sm"
      variant="secondary"
      icon="returns"
      onClick={() => navigate(`/${scope}/invoices/${detail.data!.id}/return`)}
    >
      {t('return.action')}
    </Button>
  ) : undefined;

  const partyLabel = isSales ? t('sales.customer') : t('invoice.supplier');

  return (
    <div className="space-y-5">
      <PageHeader
        title={t(isSales ? 'nav.sales' : 'nav.purchases')}
        subtitle={list.data ? `${list.data.total} ${t('common.total')}` : undefined}
        action={
          kind === 'quotations' ? (
            canQuote ? (
              <Button icon="plus" size="sm" onClick={() => navigate('/sales/quotes/new')}>
                {t('quote.new')}
              </Button>
            ) : undefined
          ) : canCreate ? (
            <Button icon="plus" size="sm" onClick={() => navigate(`/${scope}/new`)}>
              {t(isSales ? 'sales.newInvoice' : 'invoice.newPurchase')}
            </Button>
          ) : undefined
        }
      />

      <div
        role="tablist"
        className="inline-flex rounded-[var(--radius-app)] border border-line bg-surface p-1"
      >
        {kinds.map((k) => (
          <button
            key={k}
            role="tab"
            aria-selected={kind === k}
            onClick={() => switchKind(k)}
            className={`h-8 rounded-lg px-3 text-sm font-medium transition-colors ${
              kind === k ? 'bg-brand-soft text-brand' : 'text-muted hover:text-fg'
            }`}
          >
            {t(TAB_LABEL[scope][k]!)}
          </button>
        ))}
      </div>

      <div className={`grid gap-4 ${isPhone ? '' : 'lg:grid-cols-[1fr_minmax(340px,420px)]'}`}>
        {/* List */}
        <Card padded={false} className="overflow-hidden">
          {list.isLoading ? (
            <div className="grid place-items-center py-16 text-muted">
              <Spinner size={26} />
            </div>
          ) : rows.length === 0 ? (
            <EmptyState
              title={kind === 'quotations' ? t('quote.empty') : t('common.empty')}
              icon={kind === 'returns' ? 'returns' : scope}
            />
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
                        {doc.sourceNumber && <> · {doc.sourceNumber}</>}
                      </span>
                    </span>
                    <span className="text-end">
                      <span className="block text-sm font-semibold tnum">
                        {formatMoney(doc.grandTotal, doc.currency, locale)}
                      </span>
                      <Badge tone={statusOf(doc).tone}>
                        {t(statusOf(doc).key as TranslationKey)}
                      </Badge>
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
                  <th className="p-3 text-start font-medium">{partyLabel}</th>
                  {kind === 'returns' && (
                    <th className="hidden p-3 text-start font-medium md:table-cell">
                      {t('return.against')}
                    </th>
                  )}
                  <th className="hidden p-3 text-start font-medium md:table-cell">
                    {t('common.date')}
                  </th>
                  <th className="p-3 text-start font-medium">{t('common.status')}</th>
                  <th className="p-3 text-end font-medium">{t('common.total')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--c-line)]">
                {rows.map((doc) => (
                  <DocumentRow
                    key={doc.id}
                    doc={doc}
                    showSource={kind === 'returns'}
                    selected={doc.id === selectedId}
                    onSelect={() => setSelectedId(doc.id)}
                    locale={locale}
                    statusLabel={t(statusOf(doc).key as TranslationKey)}
                  />
                ))}
              </tbody>
            </table>
          )}
        </Card>

        {/* Detail (side panel on tablet/desktop) */}
        {!isPhone && (
          <Card padded={false} className="sticky top-20 h-[calc(100vh-7rem)] overflow-hidden">
            <DocumentPreview
              doc={detail.data}
              loading={detail.isFetching && !!selectedId}
              action={returnAction}
            />
          </Card>
        )}
      </div>

      {cancelQuote.error && (
        <p className="text-sm text-destructive">{errorText(t, cancelQuote.error)}</p>
      )}
      {converting && quote && (
        <ConvertQuoteSheet
          quote={quote}
          onClose={() => setConverting(false)}
          onDone={(invoice) => {
            setConverting(false);
            setSelectedId(invoice.id);
            setParams({ doc: invoice.id }, { replace: true });
          }}
        />
      )}

      {/* Detail (full-screen sheet on phone) */}
      {isPhone && selectedId && (
        <div className="fixed inset-0 z-40 bg-canvas">
          <div className="h-full">
            <DocumentPreview
              doc={detail.data}
              loading={detail.isFetching}
              onClose={() => setSelectedId(null)}
              action={returnAction}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function DocumentRow({
  doc,
  showSource,
  selected,
  onSelect,
  locale,
  statusLabel,
}: {
  doc: SalesDocumentSummary;
  showSource: boolean;
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
      {showSource && (
        <td className="hidden p-3 text-muted tnum md:table-cell">{doc.sourceNumber ?? '—'}</td>
      )}
      <td className="hidden p-3 text-muted tnum md:table-cell">
        {formatDate(doc.issueDate, locale)}
      </td>
      <td className="p-3">
        <Badge tone={statusOf(doc).tone}>{statusLabel}</Badge>
      </td>
      <td className="p-3 text-end font-semibold tnum">
        {formatMoney(doc.grandTotal, doc.currency, locale)}
      </td>
    </tr>
  );
}
