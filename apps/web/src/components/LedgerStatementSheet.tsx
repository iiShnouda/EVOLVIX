import { Fragment, useRef, useState, type ReactNode } from 'react';
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
import {
  useDepartments,
  useDocument,
  useHiddenColumns,
  useLedgerStatement,
  useWarehouses,
} from '../lib/queries';
import { useDeviceInfo } from '../lib/device';
import { DocumentPreview } from './DocumentPreview';
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
  department,
  onDepartment,
  before,
  after,
}: {
  kind: 'accounts' | 'parties';
  id: string;
  title: string;
  /** The sales department shown, when the page around shares it (the party's account). */
  department?: string;
  onDepartment?: (id: string) => void;
  /** More of the account above and below the statement; printed with it. */
  before?: ReactNode;
  after?: ReactNode;
}) {
  const { t, locale } = useT();
  const [from, setFrom] = useState(() => `${companyToday().slice(0, 4)}-01-01`);
  const [to, setTo] = useState(companyToday);
  const isParty = kind === 'parties';
  const [branchId, setBranchId] = useState('');
  const [ownDepartment, setOwnDepartment] = useState('');
  const departmentId = department ?? ownDepartment;
  const setDepartmentId = onDepartment ?? setOwnDepartment;
  const [warehouseId, setWarehouseId] = useState('');
  const [withItems, setWithItems] = useState(false);
  const branches = useAuth((s) => s.user?.branches ?? []);
  const departments = useDepartments().data ?? [];
  const warehouses = (useWarehouses(true).data ?? []).filter(
    (w) => !branchId || w.branchId === branchId,
  );
  const { data, isLoading, error } = useLedgerStatement(kind, id, from, to, {
    branchId: isParty ? branchId : undefined,
    departmentId: isParty ? departmentId : undefined,
    warehouseId: isParty ? warehouseId : undefined,
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
      const cols: [string, (l: LedgerLine, i: number) => unknown][] = [
        [t('ledger.entryNumber'), (_l, i) => i + 1],
        [t('ledger.date'), (l) => formatDate(l.date, locale)],
        [t('ledger.kindCol'), (l) => [lineKind(t, l), l.memo].filter(Boolean).join(' — ')],
        [t('ledger.docNumber'), (l) => l.documentNumber ?? l.number],
        [t('ledger.branchCol'), (l) => l.branchName ?? ''],
        [t('invoice.department'), (l) => l.departmentName ?? ''],
        [t('warehouse.label'), (l) => l.warehouseName ?? ''],
        [t('ledger.noteCol'), (l) => l.note ?? ''],
        [t('ledger.debit'), (l) => (l.debit ? { money: l.debit } : null)],
        [t('ledger.credit'), (l) => (l.credit ? { money: l.credit } : null)],
        [t('ledger.balance'), (l) => ({ money: Math.abs(l.balance) })],
        ['', (l) => side(l.balance)],
      ];
      const blank = cols.map(() => '' as unknown);
      report.excel(
        heading,
        period,
        cols.map((c) => c[0]),
        [
          blank.map((_, j) =>
            j === 1
              ? formatDate(from, locale)
              : j === 2
                ? t('ledger.previousBalance')
                : j === 10
                  ? { money: Math.abs(data.opening) }
                  : j === 11
                    ? side(data.opening)
                    : '',
          ),
          ...data.lines.flatMap((l, i) => [
            cols.map((c) => c[1](l, i)),
            ...(l.items ?? []).map((it) =>
              blank.map((_, j) =>
                j === 2
                  ? `   ${it.productName}`
                  : j === 7
                    ? `${it.quantity} ${it.unitName ?? ''}`
                    : j === 8
                      ? { money: it.unitPrice }
                      : j === 9
                        ? it.discount
                          ? { money: it.discount }
                          : null
                        : j === 10
                          ? { money: it.lineTotal }
                          : '',
              ),
            ),
          ]),
        ] as never,
        blank.map((_, j) =>
          j === 0
            ? t('ledger.total')
            : j === 8
              ? { money: data.totalDebit }
              : j === 9
                ? { money: data.totalCredit }
                : j === 10
                  ? { money: Math.abs(data.closing) }
                  : j === 11
                    ? side(data.closing)
                    : '',
        ) as never,
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
      <div className="flex flex-wrap items-end gap-3 rounded-[var(--radius-app)] border border-line bg-surface-2/50 p-3">
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
              onChange={(e) => {
                setBranchId(e.target.value);
                setWarehouseId('');
              }}
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
        {isParty && departments.length > 0 && (
          <label className="block">
            <span className="mb-1 block text-xs text-muted">{t('invoice.department')}</span>
            <select
              className={small}
              value={departmentId}
              onChange={(e) => setDepartmentId(e.target.value)}
            >
              <option value="">{t('account.allDepartments')}</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {isParty && warehouses.length > 1 && (
          <label className="block">
            <span className="mb-1 block text-xs text-muted">{t('warehouse.label')}</span>
            <select
              className={small}
              value={warehouseId}
              onChange={(e) => setWarehouseId(e.target.value)}
            >
              <option value="">{t('warehouse.all')}</option>
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
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
          {before}
          {/* The four figures of a statement, the way an accountant reads them. */}
          <SectionHeading>{t('statement.summary')}</SectionHeading>
          <dl className="grid grid-cols-2 overflow-hidden rounded-[var(--radius-app)] border border-line text-sm sm:grid-cols-4">
            {(
              [
                ['ledger.opening', <SidedMoney value={data.opening} currency={data.currency} />],
                ['statement.totalDebit', <span className="tnum">{money(data.totalDebit)}</span>],
                ['statement.totalCredit', <span className="tnum">{money(data.totalCredit)}</span>],
                ['ledger.closing', <SidedMoney value={data.closing} currency={data.currency} />],
              ] as [TranslationKey, ReactNode][]
            ).map(([k, v], i) => (
              <div
                key={k}
                className={`border-line p-3 ${i < 3 ? 'border-e' : ''} ${i < 2 ? 'border-b sm:border-b-0' : ''} ${i === 1 ? 'border-e-0 sm:border-e' : ''} ${i === 3 ? 'bg-brand-soft/60' : ''}`}
              >
                <dt className="text-xs text-muted">{t(k)}</dt>
                <dd className={`mt-0.5 ${i === 3 ? 'text-base font-bold' : 'font-semibold'}`}>
                  {v}
                </dd>
              </div>
            ))}
          </dl>
          <SectionHeading
            extra={
              <span className="text-xs font-normal text-muted tnum">
                {t('ledger.movements')}: {data.lines.length}
              </span>
            }
          >
            {t('statement.lines')}
          </SectionHeading>
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
          {after}
        </div>
      )}
    </>
  );
}

/** A titled part of a statement or account (a clear line under its name; it prints too). */
export function SectionHeading({ children, extra }: { children: ReactNode; extra?: ReactNode }) {
  return (
    <div className="mt-6 mb-2 flex items-end justify-between gap-2 border-b-2 border-[var(--c-fg)] pb-1 first:mt-4">
      <h3 className="text-sm font-bold">{children}</h3>
      {extra}
    </div>
  );
}

/** What a party statement line is, as the person reads it (owner, 2026-10-02): a sales invoice /
 * return for customers, a purchase invoice / return for suppliers, a receipt, a payment… */
export function lineKind(t: (k: TranslationKey) => string, l: LedgerLine): string {
  if (l.sourceType === 'MANUAL') return l.description;
  if (l.documentKind && l.sourceType !== 'VOUCHER_CANCEL') {
    const key = `statement.kind.${l.documentKind}` as TranslationKey;
    const label = t(key);
    if (label !== key) return label;
  }
  return t(`ledger.source.${l.sourceType}` as TranslationKey);
}

type ColKey =
  | 'seq'
  | 'date'
  | 'kind'
  | 'doc'
  | 'branch'
  | 'department'
  | 'warehouse'
  | 'note'
  | 'debit'
  | 'credit'
  | 'balance';
const DEFAULT_ORDER: ColKey[] = [
  'seq',
  'date',
  'kind',
  'doc',
  'branch',
  'department',
  'warehouse',
  'note',
  'debit',
  'credit',
  'balance',
];
const COL_LABEL: Record<ColKey, TranslationKey> = {
  seq: 'ledger.entryNumber',
  date: 'ledger.date',
  kind: 'ledger.kindCol',
  doc: 'ledger.docNumber',
  branch: 'ledger.branchCol',
  department: 'invoice.department',
  warehouse: 'warehouse.label',
  note: 'ledger.noteCol',
  debit: 'ledger.debit',
  credit: 'ledger.credit',
  balance: 'ledger.balance',
};
const NUMERIC = new Set<ColKey>(['debit', 'credit', 'balance']);
/** Documents that open from the statement (invoices and returns). */
const OPENS = new Set(['SALES_INVOICE', 'SALES_RETURN', 'PURCHASE_INVOICE', 'PURCHASE_RETURN']);

/**
 * A party statement (كشف حساب), the owner's way (2026-10-02): a running entry number, the date, what
 * it is (البيان: sales invoice, return, receipt…), the document (opens it), the branch, sales
 * department and warehouse, the note, debit, credit and the running balance, from the previous
 * balance. The columns can be moved, widened and hidden; on a phone each line is a card.
 */
function PartyStatementTable({ data, from }: { data: LedgerStatement; from: string }) {
  const { t, locale } = useT();
  const { deviceClass } = useDeviceInfo();
  const money = (v: number) => formatMoney(v, data.currency, locale);
  const [saved, setSaved] = useHiddenColumns('statement.order');
  // Branch, department, warehouse and notes show only when a line has one (a clear statement).
  const OPTIONAL: Partial<Record<ColKey, (l: LedgerLine) => unknown>> = {
    branch: (l) => l.branchName,
    department: (l) => l.departmentName,
    warehouse: (l) => l.warehouseName,
    note: (l) => l.note,
  };
  const used = (k: ColKey) => !OPTIONAL[k] || data.lines.some((l) => !!OPTIONAL[k]!(l));
  const order: ColKey[] = [
    ...saved.filter((k): k is ColKey => (DEFAULT_ORDER as string[]).includes(k)),
    ...DEFAULT_ORDER.filter((k) => !saved.includes(k)),
  ].filter(used);
  const keyOf = (label: string) => order.find((k) => t(COL_LABEL[k]) === label);
  const move = (label: string, step: -1 | 1) => {
    const k = keyOf(label);
    if (!k) return;
    const i = order.indexOf(k);
    const j = i + step;
    if (j < 0 || j >= order.length) return;
    const next = [...order];
    [next[i], next[j]] = [next[j]!, next[i]!];
    setSaved(next);
  };
  const drop = (label: string, target: string) => {
    const k = keyOf(label);
    const to = keyOf(target);
    if (!k || !to || k === to) return;
    const next = order.filter((x) => x !== k);
    next.splice(next.indexOf(to) + (order.indexOf(k) < order.indexOf(to) ? 1 : 0), 0, k);
    setSaved(next);
  };
  const [open, setOpen] = useState<{ id: string; scope: 'sales' | 'purchases' } | null>(null);
  const doc = useDocument(open?.scope ?? 'sales', open?.id ?? null);
  const cell = 'p-2 align-top';

  const docLink = (l: LedgerLine) => {
    // An opening balance has no document of its own.
    const number = l.documentNumber ?? (l.sourceType === 'OPENING' ? '' : l.number);
    if (!l.documentId || !l.documentKind || !OPENS.has(l.documentKind))
      return <bdi className="whitespace-nowrap">{number}</bdi>;
    return (
      <button
        type="button"
        className="whitespace-nowrap text-brand hover:underline"
        onClick={() =>
          setOpen({
            id: l.documentId!,
            scope: l.documentKind!.startsWith('PURCHASE') ? 'purchases' : 'sales',
          })
        }
      >
        <bdi>{number}</bdi>
      </button>
    );
  };
  const value = (k: ColKey, l: LedgerLine, i: number): ReactNode => {
    switch (k) {
      case 'seq':
        return i + 1;
      case 'date':
        return formatDate(l.date, locale);
      case 'kind':
        return (
          <span className="line-clamp-2">
            {lineKind(t, l)}
            {l.memo && <span className="text-muted"> — {l.memo}</span>}
          </span>
        );
      case 'doc':
        return docLink(l);
      case 'branch':
        return l.branchName ?? '';
      case 'department':
        return l.departmentName ?? '';
      case 'warehouse':
        return l.warehouseName ?? '';
      case 'note':
        return <span className="line-clamp-2">{l.note ?? ''}</span>;
      case 'debit':
        return l.debit ? money(l.debit) : '';
      case 'credit':
        return l.credit ? money(l.credit) : '';
      case 'balance':
        return <SidedMoney value={l.balance} currency={data.currency} />;
    }
  };
  const preview = open && (
    <Sheet
      title={doc.data?.number ?? ''}
      onClose={() => setOpen(null)}
      closeLabel={t('common.close')}
      wide
    >
      <div className="h-[75vh]">
        <DocumentPreview doc={doc.data} loading={doc.isFetching} />
      </div>
    </Sheet>
  );

  // A phone or tablet: one card per line, easy to read without scrolling sideways.
  if (deviceClass !== 'desktop')
    return (
      <div className="mt-3 space-y-2">
        <div className="flex items-center justify-between rounded-[var(--radius-app)] bg-surface-2 px-3 py-2 text-sm">
          <span>
            {t('ledger.previousBalance')} · <span className="tnum">{formatDate(from, locale)}</span>
          </span>
          <SidedMoney value={data.opening} currency={data.currency} />
        </div>
        {data.lines.length === 0 && <p className="p-3 text-sm text-muted">{t('ledger.noLines')}</p>}
        {data.lines.map((l, i) => (
          <div
            key={`${l.entryId}-${i}`}
            className="rounded-[var(--radius-app)] border border-line p-3 text-sm"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-medium">
                  <span className="me-1 text-xs text-faint tnum">{i + 1}</span>
                  {lineKind(t, l)}
                </p>
                <p className="text-xs text-muted tnum">
                  {formatDate(l.date, locale)} · {docLink(l)}
                </p>
              </div>
              <div className="shrink-0 text-end">
                {l.debit > 0 ? (
                  <p className="tnum text-positive">
                    {t('ledger.drSide')} <bdi>{money(l.debit)}</bdi>
                  </p>
                ) : (
                  <p className="tnum text-destructive">
                    {t('ledger.crSide')} <bdi>{money(l.credit)}</bdi>
                  </p>
                )}
                <p className="text-xs">
                  <SidedMoney value={l.balance} currency={data.currency} />
                </p>
              </div>
            </div>
            {(l.branchName || l.departmentName || l.warehouseName || l.note) && (
              <p className="mt-1 text-xs text-muted">
                {[l.branchName, l.departmentName, l.warehouseName, l.note]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            )}
            {(l.items ?? []).length > 0 && (
              <ul className="mt-2 space-y-0.5 border-t border-line pt-2 text-xs text-muted">
                {(l.items ?? []).map((it, j) => (
                  <li key={j} className="flex justify-between gap-2">
                    <span className="min-w-0 truncate">
                      {it.productName} · {it.quantity} {it.unitName ?? ''}
                    </span>
                    <span className="shrink-0 tnum">{money(it.lineTotal)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
        <div className="flex items-center justify-between rounded-[var(--radius-app)] bg-surface-2 px-3 py-2 text-sm font-semibold">
          <span>{t('ledger.total')}</span>
          <SidedMoney value={data.closing} currency={data.currency} />
        </div>
        {preview}
      </div>
    );

  return (
    <div className="rounded-[var(--radius-app)] border border-line">
      <TableColumns id="statement.v2" className="pt-2" onMove={move} onDrop={drop}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-sm">
            <thead className="bg-surface-2 text-xs text-muted">
              <tr>
                {order.map((k) => (
                  <th
                    key={k}
                    className={`${cell} font-medium ${NUMERIC.has(k) ? 'text-end' : 'text-start'}`}
                  >
                    {t(COL_LABEL[k])}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--c-line)]">
              <tr className="bg-surface-2/50 font-medium">
                {order.map((k) => (
                  <td key={k} className={`${cell} ${NUMERIC.has(k) ? 'text-end' : ''}`}>
                    {k === 'kind' ? (
                      t('ledger.previousBalance')
                    ) : k === 'date' ? (
                      <span className="tnum">{formatDate(from, locale)}</span>
                    ) : k === 'balance' ? (
                      <SidedMoney value={data.opening} currency={data.currency} />
                    ) : null}
                  </td>
                ))}
              </tr>
              {data.lines.map((l, i) => (
                <Fragment key={`${l.entryId}-${i}`}>
                  <tr className="hover:bg-surface-2/60">
                    {order.map((k) => (
                      <td
                        key={k}
                        className={`${cell} ${NUMERIC.has(k) ? 'whitespace-nowrap text-end tnum' : ''} ${
                          k === 'date' || k === 'seq' || k === 'doc' ? 'whitespace-nowrap tnum' : ''
                        } ${k === 'branch' || k === 'department' || k === 'warehouse' || k === 'note' ? 'text-muted' : ''}`}
                      >
                        {value(k, l, i)}
                      </td>
                    ))}
                  </tr>
                  {(l.items ?? []).length > 0 && (
                    <tr data-span className="text-xs text-muted">
                      <td colSpan={order.length} className="px-2 py-1">
                        <ul className="space-y-0.5 ps-8">
                          {(l.items ?? []).map((it, j) => (
                            <li key={j} className="flex flex-wrap gap-x-4">
                              <span className="min-w-[12rem]">
                                {it.productName}
                                {it.isBonus && ` (${t('invoice.bonus')})`}
                              </span>
                              <span className="tnum">
                                {it.quantity} {it.unitName ?? ''} × {money(it.unitPrice)}
                              </span>
                              {it.discount > 0 && (
                                <span className="tnum">−{money(it.discount)}</span>
                              )}
                              <span className="tnum font-medium">{money(it.lineTotal)}</span>
                            </li>
                          ))}
                        </ul>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
              {data.lines.length === 0 && (
                <tr data-span>
                  <td colSpan={order.length} className="p-3 text-muted">
                    {t('ledger.noLines')}
                  </td>
                </tr>
              )}
            </tbody>
            <tfoot className="bg-surface-2 font-semibold">
              <tr>
                {order.map((k, i) => (
                  <td key={k} className={`${cell} ${NUMERIC.has(k) ? 'text-end tnum' : ''}`}>
                    {i === 0 ? (
                      t('ledger.total')
                    ) : k === 'debit' ? (
                      money(data.totalDebit)
                    ) : k === 'credit' ? (
                      money(data.totalCredit)
                    ) : k === 'balance' ? (
                      <SidedMoney value={data.closing} currency={data.currency} />
                    ) : null}
                  </td>
                ))}
              </tr>
            </tfoot>
          </table>
        </div>
      </TableColumns>
      {preview}
    </div>
  );
}
