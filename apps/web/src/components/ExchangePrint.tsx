import { useEffect, useState } from 'react';
import { formatMoney, type SalesDocument } from '@skb/shared';
import { useT } from '../lib/i18n';
import { api } from '../lib/api';
import { errorText } from '../lib/errors';
import { safeName } from '../lib/print';
import { PrintEditor } from './PrintEditor';
import { InvoicePaper, usePaperOptions } from './DocumentPreview';

/**
 * An exchange on one paper (owner, 2026-11-18): what came back, what was taken, and the
 * difference paid or given back. Printing it is noted on both documents, like each one's print.
 */
export function ExchangePrintSheet({
  doc,
  pdf = false,
  onClose,
}: {
  doc: SalesDocument;
  pdf?: boolean;
  onClose: () => void;
}) {
  const { t, locale } = useT();
  const [options] = usePaperOptions();
  const [other, setOther] = useState<SalesDocument | null>(null);
  const [failed, setFailed] = useState<unknown>(null);
  const [paper, setPaper] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!doc.exchangeId) return;
    const path = doc.type === 'SALES_RETURN' ? 'invoices' : 'returns';
    api.get<SalesDocument>(`/sales/${path}/${doc.exchangeId}`).then(setOther).catch(setFailed);
  }, [doc.exchangeId, doc.type]);
  const back = doc.type === 'SALES_RETURN' ? doc : other;
  const taken = doc.type === 'SALES_RETURN' ? other : doc;
  const difference = back && taken ? taken.grandTotal - back.grandTotal : 0;
  const money = (v: number) => formatMoney(v, doc.currency, locale);
  const beforePrint = async () => {
    if (!back || !taken) return false;
    try {
      const kind = pdf ? '?kind=pdf' : '';
      await api.post(`/sales/returns/${back.id}/print${kind}`, {});
      await api.post(`/sales/invoices/${taken.id}/print${kind}`, {});
      return true;
    } catch (e) {
      setFailed(e);
      return false;
    }
  };
  return (
    <>
      <div className="hidden">
        {back && taken && (
          <div ref={setPaper}>
            <p className="px-5 pt-4 text-base font-bold">
              {t('exchange.title')} · {back.number} / {taken.number}
            </p>
            <InvoicePaper doc={back} options={options} />
            <InvoicePaper doc={taken} options={options} />
            <dl className="mx-5 mb-5 space-y-1.5 border-t border-line pt-3 text-sm">
              <div className="flex justify-between">
                <dt>{t('exchange.returnedTotal')}</dt>
                <dd className="tnum">{money(back.grandTotal)}</dd>
              </div>
              <div className="flex justify-between">
                <dt>{t('exchange.takenTotal')}</dt>
                <dd className="tnum">{money(taken.grandTotal)}</dd>
              </div>
              <div className="flex justify-between text-base font-semibold">
                <dt>{difference >= 0 ? t('exchange.customerPays') : t('exchange.customerGets')}</dt>
                <dd className="tnum">{money(Math.abs(difference))}</dd>
              </div>
            </dl>
          </div>
        )}
      </div>
      <PrintEditor
        source={paper}
        live
        zoomable={false}
        fileTitle={safeName(`${t('exchange.title')} ${doc.number}`)}
        onClose={onClose}
        beforePrint={beforePrint}
        pdf={pdf}
        side={
          failed != null ? (
            <p className="mb-2 text-sm text-destructive">{errorText(t, failed)}</p>
          ) : null
        }
      />
    </>
  );
}
