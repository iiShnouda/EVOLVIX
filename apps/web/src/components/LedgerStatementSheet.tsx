import { useRef, useState } from 'react';
import { formatDate, formatMoney, type TranslationKey, companyToday } from '@skb/shared';
import { Sheet } from './Sheet';
import { Spinner } from './ui';
import { useT } from '../lib/i18n';
import { errorText } from '../lib/errors';
import { useLedgerStatement } from '../lib/queries';
import { useReportTools } from '../lib/report';
import { ReportActions } from './ReportActions';

const small =
  'h-9 w-full rounded-[var(--radius-app)] border border-line bg-surface px-2 text-sm outline-none focus:border-brand';


/**
 * What an entry is: a manual entry keeps the description its author typed; an automatic one is
 * named by its source in the screen language (its number is shown beside it).
 */
export function entryTitle(
  t: (k: TranslationKey) => string,
  sourceType: string,
  description: string,
) {
  return sourceType === 'MANUAL' ? description : t(`ledger.source.${sourceType}` as TranslationKey);
}

/** A balance with its side: debit (مدين) or credit (دائن). */
export function SidedMoney({ value, currency }: { value: number; currency: string }) {
  const { t, locale } = useT();
  if (value === 0) return <span className="tnum">{formatMoney(0, currency, locale)}</span>;
  return (
    <span className="tnum">
      <bdi>{formatMoney(Math.abs(value), currency, locale)}</bdi>{' '}
      <span className="text-xs text-muted">
        {value > 0 ? t('ledger.drSide') : t('ledger.crSide')}
      </span>
    </span>
  );
}

/**
 * Statement (كشف حساب) of a ledger account (a group covers everything under it) or of a party,
 * between two days, with the running balance.
 */
export function LedgerStatementSheet({
  kind,
  id,
  title,
  onClose,
}: {
  kind: 'accounts' | 'parties';
  id: string;
  title: string;
  onClose: () => void;
}) {
  const { t, locale } = useT();
  const [from, setFrom] = useState(() => `${companyToday().slice(0, 4)}-01-01`);
  const [to, setTo] = useState(companyToday);
  const { data, isLoading, error } = useLedgerStatement(kind, id, from, to);
  const money = (v: number) => formatMoney(v, data?.currency ?? 'EGP', locale);
  const report = useReportTools();
  const paper = useRef<HTMLDivElement>(null);
  const heading = `${t('ledger.statement')} — ${title}`;
  const period = `${formatDate(from, locale)} – ${formatDate(to, locale)}`;
  const side = (v: number) => (v > 0 ? t('ledger.drSide') : v < 0 ? t('ledger.crSide') : '');

  function excel() {
    if (!data) return;
    report.excel(
      heading,
      period,
      [
        t('ledger.date'),
        t('ledger.number'),
        t('ledger.sourceCol'),
        t('ledger.description'),
        t('ledger.account'),
        t('ledger.memo'),
        t('ledger.debit'),
        t('ledger.credit'),
        t('ledger.balance'),
        '',
      ],
      [
        [
          formatDate(from, locale),
          '',
          '',
          t('ledger.opening'),
          '',
          '',
          null,
          null,
          { money: Math.abs(data.opening) },
          side(data.opening),
        ],
        ...data.lines.map((l) => [
          formatDate(l.date, locale),
          l.number,
          t(`ledger.source.${l.sourceType}` as TranslationKey),
          entryTitle(t, l.sourceType, l.description),
          l.accountCode ? `${l.accountCode} ${l.accountName}` : '',
          l.memo ?? '',
          l.debit ? { money: l.debit } : null,
          l.credit ? { money: l.credit } : null,
          { money: Math.abs(l.balance) },
          side(l.balance),
        ]),
      ],
      [
        t('ledger.total'),
        '',
        '',
        '',
        '',
        '',
        { money: data.totalDebit },
        { money: data.totalCredit },
        { money: Math.abs(data.closing) },
        side(data.closing),
      ],
    );
  }

  return (
    <Sheet
      title={`${t('ledger.statement')} — ${title}`}
      onClose={onClose}
      closeLabel={t('common.close')}
      wide
    >
      <div className="flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="mb-1 block text-xs text-muted">{t('ledger.from')}</span>
          <input
            className={small}
            type="date"
            value={from}
            max={to}
            onChange={(e) => setFrom(e.target.value)}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-muted">{t('ledger.to')}</span>
          <input
            className={small}
            type="date"
            value={to}
            min={from}
            onChange={(e) => setTo(e.target.value)}
          />
        </label>
        <div className="ms-auto">
          <ReportActions
            disabled={!data}
            onPrint={() => report.print(paper.current, heading, period)}
            onExcel={excel}
          />
        </div>
      </div>
      {error && <p className="mt-3 text-sm text-destructive">{errorText(t, error)}</p>}
      {isLoading || !data ? (
        <div className="grid place-items-center py-12 text-muted">
          <Spinner size={24} />
        </div>
      ) : (
        <div ref={paper}>
          <dl className="mt-4 grid grid-cols-2 gap-2 rounded-[var(--radius-app)] bg-surface-2 p-3 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-xs text-muted">{t('ledger.opening')}</dt>
              <dd>
                <SidedMoney value={data.opening} currency={data.currency} />
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted">{t('ledger.debit')}</dt>
              <dd className="tnum">{money(data.totalDebit)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">{t('ledger.credit')}</dt>
              <dd className="tnum">{money(data.totalCredit)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">{t('ledger.closing')}</dt>
              <dd className="font-semibold">
                <SidedMoney value={data.closing} currency={data.currency} />
              </dd>
            </div>
          </dl>
          {data.lines.length === 0 ? (
            <p className="mt-4 text-sm text-muted">{t('ledger.noLines')}</p>
          ) : (
            <ul className="mt-3 divide-y divide-line">
              {data.lines.map((l, i) => (
                <li
                  key={`${l.entryId}-${i}`}
                  className="flex items-start justify-between gap-3 py-2 text-sm"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium">
                      {entryTitle(t, l.sourceType, l.description)}
                    </p>
                    <p className="truncate text-xs text-muted">
                      {formatDate(l.date, locale)} · <span className="tnum">{l.number}</span> ·{' '}
                      {t(`ledger.source.${l.sourceType}` as TranslationKey)}
                      {kind === 'parties' || l.accountCode
                        ? ` · ${l.accountCode} ${l.accountName}`
                        : ''}
                    </p>
                    {l.memo && <p className="truncate text-xs text-faint">{l.memo}</p>}
                  </div>
                  <div className="shrink-0 text-end">
                    <p className="tnum">
                      {l.debit > 0 ? (
                        <span className="text-positive">
                          {t('ledger.drSide')} <bdi>{money(l.debit)}</bdi>
                        </span>
                      ) : (
                        <span className="text-destructive">
                          {t('ledger.crSide')} <bdi>{money(l.credit)}</bdi>
                        </span>
                      )}
                    </p>
                    <p className="text-xs">
                      <SidedMoney value={l.balance} currency={data.currency} />
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Sheet>
  );
}
