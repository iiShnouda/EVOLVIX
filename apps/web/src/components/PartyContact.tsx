import { useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import type { PartyType, TranslationKey } from '@skb/shared';
import { Badge, Spinner } from './ui';
import { Sheet } from './Sheet';
import { Icon } from './Icon';
import { CodeName, codeName } from './CodeName';
import { ReportActions } from './ReportActions';
import { useT } from '../lib/i18n';
import { mayOpenStatement, useCan } from '../lib/can';
import { useParty } from '../lib/queries';
import { useReportTools } from '../lib/report';

const TYPE_LABEL: Record<PartyType, TranslationKey> = {
  CUSTOMER: 'parties.customer',
  SUPPLIER: 'parties.supplier',
  CARRIER: 'parties.carrier',
};

/**
 * A customer's, supplier's or shipping company's name with its code; tapping it opens its account
 * directory (دليل الحساب). Plain text for someone who may not see parties.
 */
export function PartyLink({
  id,
  code,
  name,
  truncate,
  className,
}: {
  id?: string | null;
  code?: number | null;
  name: ReactNode;
  truncate?: boolean;
  className?: string;
}) {
  const can = useCan();
  const [open, setOpen] = useState(false);
  const label = <CodeName code={code} name={name} truncate={truncate} />;
  if (!id || !(can('parties:view') || can('parties:contact'))) {
    return <span className={className}>{label}</span>;
  }
  return (
    <>
      <button
        type="button"
        className={`max-w-full text-start hover:text-brand hover:underline ${className ?? ''}`}
        onClick={(e: MouseEvent) => {
          e.stopPropagation();
          setOpen(true);
        }}
      >
        {label}
      </button>
      {open && <PartyDirectory id={id} onClose={() => setOpen(false)} />}
    </>
  );
}

/**
 * The account directory (owner, 2026-10-03: "tapping a customer, supplier or shipping company
 * shows its directory: phone numbers, address and all its details, only"): who they are and how
 * to reach them — no balances or prices. It prints like everything else.
 */
export function PartyDirectory({ id, onClose }: { id: string; onClose: () => void }) {
  const { t } = useT();
  const party = useParty(id);
  const p = party.data;
  const carrier = useParty(p?.defaultCarrierId ?? null);
  const report = useReportTools();
  const paper = useRef<HTMLDivElement>(null);
  const factory = !!p && p.types.includes('SUPPLIER') && !p.types.includes('CUSTOMER');
  const can = useCan();
  const navigate = useNavigate();

  const rows: [string, ReactNode][] = [];
  if (p) {
    if (p.contactName)
      rows.push([t(factory ? 'parties.ownerName' : 'parties.contactName'), p.contactName]);
    const phones = [
      ...(p.phone ? [{ phone: p.phone, label: p.phoneLabel ?? '' }] : []),
      ...(p.otherPhones ?? []).map((phone, i) => ({ phone, label: p.otherPhoneLabels?.[i] ?? '' })),
    ];
    if (phones.length)
      rows.push([
        t('parties.phone'),
        <span className="flex flex-col gap-0.5">
          {phones.map((ph) => (
            <span key={ph.phone}>
              <a
                href={`tel:${ph.phone.replace(/\s+/g, '')}`}
                dir="ltr"
                className="tnum hover:text-brand"
              >
                {ph.phone}
              </a>
              {ph.label && <span className="ms-1.5 text-muted">({ph.label})</span>}
            </span>
          ))}
        </span>,
      ]);
    if (p.email) rows.push([t('parties.email'), <bdi>{p.email}</bdi>]);
    if (p.address)
      rows.push([t(factory ? 'parties.factoryAddress' : 'parties.address'), p.address]);
    if (p.extraAddress)
      rows.push([p.extraAddressLabel || t('parties.extraAddress'), p.extraAddress]);
    if (p.shippingAddress) rows.push([t('parties.shippingAddress'), p.shippingAddress]);
    const carrierName = carrier.data
      ? codeName(carrier.data.code, carrier.data.name)
      : p.tempCarrierName;
    if (carrierName) rows.push([t('parties.defaultCarrier'), carrierName]);
    if (p.taxNumber) rows.push([t('parties.taxNumber'), <bdi className="tnum">{p.taxNumber}</bdi>]);
    if (p.nationalId)
      rows.push([t('parties.nationalId'), <bdi className="tnum">{p.nationalId}</bdi>]);
    if (p.notes)
      rows.push([t('parties.notes'), <span className="whitespace-pre-line">{p.notes}</span>]);
  }

  return (
    <Sheet title={t('parties.directory')} onClose={onClose} closeLabel={t('common.close')}>
      {party.isLoading || !p ? (
        <div className="grid place-items-center py-12 text-muted">
          <Spinner size={24} />
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-end gap-2">
            {mayOpenStatement(p, can) && (
              <button
                type="button"
                className="inline-flex h-9 items-center gap-1.5 rounded-[var(--radius-app)] border border-line px-3 text-sm hover:border-brand hover:text-brand"
                onClick={() => {
                  onClose();
                  navigate(`/statement?party=${p.id}`);
                }}
              >
                <Icon name="ledger" size={16} />
                {t('statement.openStatement')}
              </button>
            )}
            <ReportActions
              scope="parties"
              onPrint={() =>
                report.print(paper.current, t('parties.directory'), codeName(p.code, p.name))
              }
            />
          </div>
          <div ref={paper} className="space-y-3">
            <div className="flex items-start gap-3">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-surface-2 text-muted">
                <Icon name={p.types.includes('CARRIER') ? 'delivery' : 'parties'} size={22} />
              </span>
              <div className="min-w-0">
                <p className="text-base font-semibold">
                  <CodeName code={p.code} name={p.name} />
                </p>
                <div className="mt-1 flex flex-wrap gap-1">
                  {p.types.map((type) => (
                    <Badge key={type} tone="brand">
                      {t(TYPE_LABEL[type])}
                    </Badge>
                  ))}
                  {!p.isActive && <Badge tone="warning">{t('parties.closed')}</Badge>}
                </div>
              </div>
            </div>
            {rows.length === 0 ? (
              <p className="text-sm text-muted">{t('common.empty')}</p>
            ) : (
              <dl className="divide-y divide-[var(--c-line)] rounded-[var(--radius-app)] border border-line text-sm">
                {rows.map(([label, value]) => (
                  <div
                    key={label}
                    className="grid grid-cols-[8.5rem_minmax(0,1fr)] gap-3 px-3 py-2"
                  >
                    <dt className="text-muted">{label}</dt>
                    <dd className="min-w-0 break-words">{value}</dd>
                  </div>
                ))}
              </dl>
            )}
          </div>
        </div>
      )}
    </Sheet>
  );
}
