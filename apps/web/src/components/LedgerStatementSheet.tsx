import { useRef, useState } from 'react';
import {
  formatDate,
  formatMoney,
  type LedgerLine,
  type LedgerStatement,
  type TranslationKey,
  companyToday,
} from '@skb/shared';
import { Sheet } from './Sheet';
import { Spinner } from './ui';
import { useT } from '../lib/i18n';
import { errorText } from '../lib/errors';
import { useLedgerStatement } from '../lib/queries';
import { useAuth } from '../stores/auth';
import { useReportTools } from '../lib/report';
import { ReportActions } from './ReportActions';
import { TableColumns } from './TableColumns';

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
  const { t } = useT();
  return (
    <Sheet
      title={`${t('ledger.statement')} — ${title}`}
      onClose={onClose}
      closeLabel={t('common.close')}
      wide={kind === 'parties' ? 'full' : true}
    >
      <StatementBody kind={kind} id={id} title={title} />
    </Sheet>
  );
}

/**
 * The statement itself: its period, branch and items filters, the totals and the lines. Used in
 * the sheet above and on the statement page (كشف الحساب), where the account is picked by code.
 */
export function StatementBody({
  kind,
  id,
  title,
}: {
  kind: 'accounts' | 'parties';
  id: string;
  title: string;
}) {
  const { t, locale } = useT();
  const [from, setFrom] = useState(() => `${companyToday().slice(0, 4)}-01-01`);
  const [to, setTo] = useState(companyToday);
  const isParty = kind === 'parties';
  const [branchId, setBranchId] = useState('');
  const [withItems, setWithItems] = useState(false);
  const branches = useAuth((s) => s.user?.branches ?? []);
  const { data, isLoading, error } = useLedgerStatement(kind, id, from, to, {
    branchId: isParty ? branchId : undefined,
    items: isParty && withItems,
  });
  const money = (v: number) => formatMoney(v, data?.currency ?? 'EGP', locale);
  const report = useReportTools();
  const paper = useRef<HTMLDivElement>(null);
  const heading = `${t('ledger.statement')} — ${title}`;
  const period = `${formatDate(from, locale)} – ${formatDate(to, locale)}`;
  const side = (v: number) => (v > 0 ? t('ledger.drSide') : v < 0 ? t('ledger.crSide') : '');

  function excel() {
    if (!data) return;
    if (isParty) {
      report.excel(
        heading,
        period,
        [
          t('ledger.branchCol'),
          t('ledger.kindCol'),
          t('ledger.entryCol'),
          t('ledger.noteCol'),
          t('ledger.date'),
          t('ledger.book'),
          t('ledger.debit'),
          t('ledger.credit'),
          t('ledger.balance'),
          '',
          t('ledger.entryNumber'),
          t('ledger.docNumber'),
        ],
        [
          [
            '',
            t('ledger.previousBalance'),
            '',
            '',
            formatDate(from, locale),
            '',
            null,
            null,
            { money: Math.abs(data.opening) },
            side(data.opening),
            '',
            '',
          ],
          ...data.lines.flatMap((l) => [
            [
              l.branchName ?? '',
              t(`ledger.source.${l.sourceType}` as TranslationKey),
              [entryTitle(t, l.sourceType, l.description), l.memo].filter(Boolean).join(' — '),
              l.note ?? '',
              formatDate(l.date, locale),
              l.book ?? '',
              l.debit ? { money: l.debit } : null,
              l.credit ? { money: l.credit } : null,
              { money: Math.abs(l.balance) },
              side(l.balance),
              l.entrySerial || '',
              l.documentNumber ?? l.number,
            ],
            ...(l.items ?? []).map((it) => [
              '',
              '',
              `   ${it.productName}`,
              `${it.quantity} ${it.unitName ?? ''}`,
              '',
              '',
              { money: it.unitPrice },
              it.discount ? { money: it.discount } : null,
              { money: it.lineTotal },
              '',
              '',
              '',
            ]),
          ]),
        ],
        [
          '',
          t('ledger.total'),
          '',
          '',
          '',
          '',
          { money: data.totalDebit },
          { money: data.totalCredit },
          { money: Math.abs(data.closing) },
          side(data.closing),
          '',
          '',
        ],
      );
      return;
    }
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
    <>
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
        {isParty && branches.length > 1 && (
          <label className="block">
            <span className="mb-1 block text-xs text-muted">{t('perf.branch')}</span>
            <select
              className={small}
              value={branchId}
              onChange={(e) => setBranchId(e.target.value)}
            >
              <option value="">{t('ledger.allBranches')}</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {isParty && (
          <label className="flex h-9 items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={withItems}
              onChange={(e) => setWithItems(e.target.checked)}
            />
            {t('ledger.withItems')}
          </label>
        )}
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
          <dl
            className={`mt-4 grid grid-cols-2 gap-2 rounded-[var(--radius-app)] bg-surface-2 p-3 text-sm ${isParty ? 'sm:grid-cols-5' : 'sm:grid-cols-4'}`}
          >
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
            {isParty && (
              <div>
                <dt className="text-xs text-muted">{t('ledger.periodBalance')}</dt>
                <dd>
                  <SidedMoney value={data.totalDebit - data.totalCredit} currency={data.currency} />
                </dd>
              </div>
            )}
            <div>
              <dt className="text-xs text-muted">{t('ledger.closing')}</dt>
              <dd className="font-semibold">
                <SidedMoney value={data.closing} currency={data.currency} />
              </dd>
            </div>
          </dl>
          {isParty ? (
            <PartyStatementTable data={data} from={from} />
          ) : data.lines.length === 0 ? (
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
                      {l.accountCode ? ` · ${l.accountCode} ${l.accountName}` : ''}
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
    </>
  );
}

/**
 * A party statement laid out like the old program's كشف حساب: kind, entry, note, date, book (the
 * invoice's department, the receipt's cash box), debit, credit, running balance and document number,
 * starting from the previous balance; with items, each invoice's lines under it.
 */
function PartyStatementTable({ data, from }: { data: LedgerStatement; from: string }) {
  const { t, locale } = useT();
  const money = (v: number) => formatMoney(v, data.currency, locale);
  const cell = 'p-2 align-top';
  return (
    <div className="mt-3 overflow-x-auto rounded-[var(--radius-app)] border border-line">
      <TableColumns
        id="statement"
        className="pt-2"
        toolbar={
          <span className="ps-2 tnum">
            {data.lines.length} {t('ledger.movements')}
          </span>
        }
      >
        <table className="w-full min-w-[860px] text-sm">
          <thead className="bg-surface-2 text-xs text-muted">
            <tr>
              <th className={`${cell} text-start font-medium`}>{t('ledger.branchCol')}</th>
              <th className={`${cell} text-start font-medium`}>{t('ledger.kindCol')}</th>
              <th className={`${cell} text-start font-medium`}>{t('ledger.entryCol')}</th>
              <th className={`${cell} text-start font-medium`}>{t('ledger.noteCol')}</th>
              <th className={`${cell} text-start font-medium`}>{t('ledger.date')}</th>
              <th className={`${cell} text-start font-medium`}>{t('ledger.book')}</th>
              <th className={`${cell} text-end font-medium`}>{t('ledger.debit')}</th>
              <th className={`${cell} text-end font-medium`}>{t('ledger.credit')}</th>
              <th className={`${cell} text-end font-medium`}>{t('ledger.balance')}</th>
              <th className={`${cell} text-start font-medium`}>{t('ledger.entryNumber')}</th>
              <th className={`${cell} text-start font-medium`}>{t('ledger.docNumber')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--c-line)]">
            <tr className="bg-surface-2/50 font-medium">
              <td className={cell} />
              <td className={cell}>{t('ledger.previousBalance')}</td>
              <td className={cell} />
              <td className={cell} />
              <td className={`${cell} tnum`}>{formatDate(from, locale)}</td>
              <td className={cell} />
              <td className={cell} />
              <td className={cell} />
              <td className={`${cell} text-end`}>
                <SidedMoney value={data.opening} currency={data.currency} />
              </td>
              <td className={cell} />
              <td className={cell} />
            </tr>
            {data.lines.map((l, i) => (
              <PartyStatementRow
                key={`${l.entryId}-${i}`}
                line={l}
                money={money}
                currency={data.currency}
              />
            ))}
            {data.lines.length === 0 && (
              <tr data-span>
                <td colSpan={11} className="p-3 text-muted">
                  {t('ledger.noLines')}
                </td>
              </tr>
            )}
          </tbody>
          <tfoot className="bg-surface-2 font-semibold">
            <tr data-span>
              <td className={cell} colSpan={6}>
                {t('ledger.total')}
              </td>
              <td className={`${cell} text-end tnum`}>{money(data.totalDebit)}</td>
              <td className={`${cell} text-end tnum`}>{money(data.totalCredit)}</td>
              <td className={`${cell} text-end`}>
                <SidedMoney value={data.closing} currency={data.currency} />
              </td>
              <td className={cell} />
              <td className={cell} />
            </tr>
          </tfoot>
        </table>
      </TableColumns>
    </div>
  );
}

function PartyStatementRow({
  line: l,
  money,
  currency,
}: {
  line: LedgerLine;
  money: (v: number) => string;
  currency: string;
}) {
  const { t, locale } = useT();
  const cell = 'p-2 align-top';
  return (
    <>
      <tr>
        <td className={`${cell} whitespace-nowrap text-muted`}>{l.branchName ?? ''}</td>
        <td className={cell}>{t(`ledger.source.${l.sourceType}` as TranslationKey)}</td>
        <td className={`${cell} max-w-72`}>
          <span className="line-clamp-2">
            {entryTitle(t, l.sourceType, l.description)}
            {l.memo && <span className="text-muted"> — {l.memo}</span>}
          </span>
        </td>
        <td className={`${cell} max-w-48 text-muted`}>
          <span className="line-clamp-2">{l.note ?? ''}</span>
        </td>
        <td className={`${cell} whitespace-nowrap tnum`}>{formatDate(l.date, locale)}</td>
        <td className={cell}>{l.book ?? ''}</td>
        <td className={`${cell} text-end tnum`}>{l.debit ? money(l.debit) : ''}</td>
        <td className={`${cell} text-end tnum`}>{l.credit ? money(l.credit) : ''}</td>
        <td className={`${cell} whitespace-nowrap text-end`}>
          <SidedMoney value={l.balance} currency={currency} />
        </td>
        <td className={`${cell} tnum`}>{l.entrySerial || ''}</td>
        <td className={`${cell} tnum`}>{l.documentNumber ?? l.number}</td>
      </tr>
      {(l.items ?? []).map((it, j) => (
        <tr data-span key={j} className="text-xs text-muted">
          <td className="px-2 py-1" />
          <td className="px-2 py-1" />
          <td className="px-2 py-1 ps-6" colSpan={2}>
            {it.productName}
            {it.isBonus && ` (${t('invoice.bonus')})`}
          </td>
          <td className="px-2 py-1 tnum" colSpan={2}>
            {it.quantity} {it.unitName ?? ''} × {money(it.unitPrice)}
          </td>
          <td className="px-2 py-1 text-end tnum">{it.discount ? `−${money(it.discount)}` : ''}</td>
          <td className="px-2 py-1" />
          <td className="px-2 py-1 text-end tnum">{money(it.lineTotal)}</td>
          <td className="px-2 py-1" />
          <td className="px-2 py-1" />
        </tr>
      ))}
    </>
  );
}
