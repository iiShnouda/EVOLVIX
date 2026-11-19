import { useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  addDays,
  addMonths,
  companyToday,
  formatDate,
  formatMoney,
  formatNumber,
  type CommissionBasis,
  type CommissionItem,
  type CommissionRow,
  type CommissionRule,
  type Permission,
  type TranslationKey,
} from '@skb/shared';
import { Badge, Button, Card, EmptyState, PageHeader, Spinner } from '../components/ui';
import { Sheet } from '../components/Sheet';
import { CodeName, codeName } from '../components/CodeName';
import { ReportActions } from '../components/ReportActions';
import { useT } from '../lib/i18n';
import { useCan } from '../lib/can';
import { errorText } from '../lib/errors';
import { confirm } from '../lib/confirm';
import { useReportTools } from '../lib/report';
import {
  useBranches,
  useCommissionItems,
  useCommissionOptions,
  useCommissionReport,
  useCommissionRules,
  useCommissionToPayroll,
  useCompanySettings,
  useDeleteCommissionRule,
  useSaveCommissionRule,
} from '../lib/queries';

type Tab = 'report' | 'rules';
/** Each part opens for its own permissions (owner, 2026-10-23: none needs another). */
const TABS: { key: Tab; label: TranslationKey; anyOf: Permission[] }[] = [
  { key: 'report', label: 'commission.tabReport', anyOf: ['reports:commission'] },
  { key: 'rules', label: 'commission.tabRules', anyOf: ['commission:setup'] },
];

const field =
  'h-9 w-full rounded-[var(--radius-app)] border border-line bg-surface px-2.5 text-sm outline-none focus:border-brand disabled:opacity-60';

function useCurrency() {
  return useCompanySettings().data?.currency ?? 'EGP';
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-0.5 block text-xs text-muted">{label}</span>
      {children}
    </label>
  );
}

function Loading() {
  return (
    <div className="grid place-items-center py-16 text-muted">
      <Spinner size={26} />
    </div>
  );
}

const percentText = (bp: number, locale: string) =>
  `${formatNumber(bp / 100, locale as 'ar' | 'en')}%`;

/** Sales reps' commission (عمولة المندوبين, owner 2026-11-18): the report per rep and the rules. */
export function CommissionPage() {
  const { t } = useT();
  const can = useCan();
  const [params, setParams] = useSearchParams();
  const tabs = TABS.filter((x) => x.anyOf.some(can));
  const tab = (tabs.find((x) => x.key === params.get('tab'))?.key ?? tabs[0]?.key) as
    Tab | undefined;
  return (
    <div className="space-y-5">
      <PageHeader title={t('commission.title')} subtitle={t('commission.subtitle')} />
      {tabs.length > 1 && (
        <div
          role="tablist"
          className="flex max-w-full flex-wrap gap-1 rounded-[var(--radius-app)] border border-line bg-surface p-1"
        >
          {tabs.map((x) => (
            <button
              key={x.key}
              role="tab"
              aria-selected={tab === x.key}
              onClick={() => setParams({ tab: x.key }, { replace: true })}
              className={`h-8 rounded-lg px-3 text-sm font-medium transition-colors ${
                tab === x.key ? 'bg-brand-soft text-brand' : 'text-muted hover:text-fg'
              }`}
            >
              {t(x.label)}
            </button>
          ))}
        </div>
      )}
      {!tab ? (
        <EmptyState title={t('common.empty')} icon="payroll" />
      ) : tab === 'report' ? (
        <ReportTab />
      ) : (
        <RulesTab />
      )}
    </div>
  );
}

/* ------------------------------------------------------------ the report */

function ReportTab() {
  const { t, locale } = useT();
  const can = useCan();
  const currency = useCurrency();
  const money = (v: number) => formatMoney(v, currency, locale);
  const today = companyToday();
  const [from, setFrom] = useState(`${today.slice(0, 7)}-01`);
  // The whole month by default, so its commission can go into the month's payroll.
  const [to, setTo] = useState(() => addDays(addMonths(`${today.slice(0, 7)}-01`, 1), -1));
  const [branchId, setBranchId] = useState('');
  const branches = useBranches();
  const report = useCommissionReport(from, to, branchId);
  const toPayroll = useCommissionToPayroll();
  const [open, setOpen] = useState<CommissionRow | null>(null);
  const tools = useReportTools();
  const paper = useRef<HTMLDivElement>(null);
  // The payroll button works on one whole month (its first to its last day).
  const monthEnd = addDays(addMonths(`${from.slice(0, 7)}-01`, 1), -1);
  const wholeMonth = from.endsWith('-01') && to === monthEnd;
  const [year, month] = from.split('-').map(Number) as [number, number];
  const rows = report.data?.rows ?? [];
  const total = (k: keyof CommissionRow) => rows.reduce((s, r) => s + (r[k] as number), 0);
  const cols: { key: keyof CommissionRow; label: TranslationKey; minus?: boolean }[] = [
    { key: 'sales', label: 'commission.sales' },
    { key: 'returns', label: 'commission.returns', minus: true },
    { key: 'net', label: 'commission.net' },
    { key: 'collected', label: 'commission.collected' },
    { key: 'commission', label: 'commission.due' },
  ];
  const title = `${t('commission.title')} — ${formatDate(from, locale)} → ${formatDate(to, locale)}`;

  async function add(r: CommissionRow) {
    const ok = await confirm({
      title: t('commission.addToPayroll'),
      message: `${codeName(r.repCode, r.repName)} · ${money(r.commission)} → ${r.employeeName ?? ''}`,
      confirmText: t('commission.addToPayroll'),
    });
    if (ok) toPayroll.mutate({ repId: r.repId, year, month });
  }

  /** Adding a rep's commission to their payroll, or where it stands. */
  const payrollCell = (r: CommissionRow) =>
    !r.employeeId ? (
      <span className="text-xs text-muted">{t('commission.notLinked')}</span>
    ) : r.addedToPayroll ? (
      <Badge tone="positive">{t('commission.inPayroll')}</Badge>
    ) : can('commission:payroll') && wholeMonth && r.commission > 0 ? (
      <Button
        size="sm"
        variant="secondary"
        loading={toPayroll.isPending && toPayroll.variables?.repId === r.repId}
        onClick={() => void add(r)}
      >
        {t('commission.addToPayroll')}
      </Button>
    ) : (
      <span className="text-xs text-muted">{r.employeeName}</span>
    );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <Field label={t('commission.month')}>
            <input
              className={field}
              type="month"
              value={from.slice(0, 7)}
              onChange={(e) => {
                if (!e.target.value) return;
                const first = `${e.target.value}-01`;
                setFrom(first);
                setTo(addDays(addMonths(first, 1), -1));
              }}
            />
          </Field>
          <Field label={t('commission.from')}>
            <input
              className={field}
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </Field>
          <Field label={t('commission.to')}>
            <input
              className={field}
              type="date"
              value={to}
              min={from}
              onChange={(e) => setTo(e.target.value)}
            />
          </Field>
          {(branches.data ?? []).length > 1 && (
            <Field label={t('payroll.branch')}>
              <select
                className={field}
                value={branchId}
                onChange={(e) => setBranchId(e.target.value)}
              >
                <option value="">{t('common.all')}</option>
                {(branches.data ?? []).map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </Field>
          )}
        </div>
        {rows.length > 0 && (
          <ReportActions
            scope="reports"
            onPrint={() => tools.print(paper.current, title)}
            onExcel={() =>
              tools.excel(
                title,
                t('commission.title'),
                [t('commission.rep'), ...cols.map((c) => t(c.label))],
                rows.map((r) => [
                  codeName(r.repCode, r.repName),
                  ...cols.map((c) => ({ money: r[c.key] as number })),
                ]),
                [t('ledger.total'), ...cols.map((c) => ({ money: total(c.key) }))],
              )
            }
          />
        )}
      </div>
      {report.error && <p className="text-sm text-destructive">{errorText(t, report.error)}</p>}
      {toPayroll.error && (
        <p className="text-sm text-destructive">{errorText(t, toPayroll.error)}</p>
      )}
      {toPayroll.data && (
        <p className="text-sm text-positive">
          {t('commission.added')} {toPayroll.data.employeeName} ·{' '}
          <span className="tnum">{money(toPayroll.data.amount)}</span>
        </p>
      )}
      {report.isLoading ? (
        <Loading />
      ) : rows.length === 0 ? (
        <Card>
          <EmptyState title={t('commission.none')} icon="payroll" />
        </Card>
      ) : (
        <div ref={paper}>
          {/* A phone: a card a rep, every figure readable without scrolling sideways. */}
          <div className="space-y-2 sm:hidden" data-noprint>
            {rows.map((r) => (
              <Card key={r.repId} className="space-y-2">
                <button
                  type="button"
                  className="block w-full text-start"
                  onClick={() => setOpen(r)}
                >
                  <span className="flex items-start justify-between gap-2">
                    <span className="min-w-0">
                      <CodeName code={r.repCode} name={r.repName} />
                      <span className="block text-xs text-faint">
                        {t('commission.invoices')} {formatNumber(r.invoices, locale)}
                      </span>
                    </span>
                    <span className="shrink-0 text-end font-semibold tnum">
                      {money(r.commission)}
                    </span>
                  </span>
                  <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                    {cols
                      .filter((c) => c.key !== 'commission')
                      .map((c) => {
                        const v = r[c.key] as number;
                        return (
                          <div key={c.key} className="flex justify-between gap-2">
                            <dt className="text-muted">{t(c.label)}</dt>
                            <dd className={`tnum ${c.minus && v ? 'text-destructive' : ''}`}>
                              {v ? money(c.minus ? -v : v) : '–'}
                            </dd>
                          </div>
                        );
                      })}
                  </dl>
                </button>
                <div className="flex justify-end">{payrollCell(r)}</div>
              </Card>
            ))}
            <Card className="flex justify-between font-semibold">
              <span>{t('ledger.total')}</span>
              <span className="tnum">{money(total('commission'))}</span>
            </Card>
          </div>
          <Card padded={false} className="overflow-x-auto max-sm:hidden">
            <table className="w-full min-w-[44rem] text-sm">
              <thead className="bg-surface-2 text-xs text-muted">
                <tr>
                  <th className="px-3 py-2 text-start font-normal">{t('commission.rep')}</th>
                  {cols.map((c) => (
                    <th key={c.key} className="px-2 py-2 text-end font-normal">
                      {t(c.label)}
                    </th>
                  ))}
                  <th className="px-3 py-2 text-end font-normal" data-noprint>
                    {t('commission.payroll')}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((r) => (
                  <tr
                    key={r.repId}
                    className="cursor-pointer hover:bg-surface-2"
                    onClick={() => setOpen(r)}
                  >
                    <td className="px-3 py-1.5">
                      <CodeName code={r.repCode} name={r.repName} />
                      <span className="block text-xs text-faint">
                        {t('commission.invoices')} {formatNumber(r.invoices, locale)}
                      </span>
                    </td>
                    {cols.map((c) => {
                      const v = r[c.key] as number;
                      return (
                        <td
                          key={c.key}
                          className={`px-2 py-1.5 text-end tnum ${c.key === 'commission' ? 'font-semibold' : ''} ${c.minus && v ? 'text-destructive' : ''}`}
                        >
                          {v ? money(c.minus ? -v : v) : '–'}
                        </td>
                      );
                    })}
                    <td
                      className="px-3 py-1.5 text-end"
                      data-noprint
                      onClick={(e) => e.stopPropagation()}
                    >
                      {payrollCell(r)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t border-line bg-surface-2 font-semibold">
                <tr>
                  <td className="px-3 py-2">{t('ledger.total')}</td>
                  {cols.map((c) => (
                    <td key={c.key} className="px-2 py-2 text-end tnum">
                      {money(c.minus ? -total(c.key) : total(c.key))}
                    </td>
                  ))}
                  <td data-noprint />
                </tr>
              </tfoot>
            </table>
          </Card>
          {can('commission:payroll') && !wholeMonth && (
            <p className="mt-2 text-xs text-muted" data-noprint>
              {t('commission.wholeMonthHint')}
            </p>
          )}
        </div>
      )}
      {open && (
        <ItemsSheet
          row={open}
          from={from}
          to={to}
          branchId={branchId}
          onClose={() => setOpen(null)}
        />
      )}
    </div>
  );
}

const KIND_LABEL: Record<CommissionItem['kind'], TranslationKey> = {
  SALE: 'commission.kind.SALE',
  RETURN: 'commission.kind.RETURN',
  COLLECTION: 'commission.kind.COLLECTION',
};

/** The invoices, returns and money collected behind one rep's commission. */
function ItemsSheet({
  row,
  from,
  to,
  branchId,
  onClose,
}: {
  row: CommissionRow;
  from: string;
  to: string;
  branchId: string;
  onClose: () => void;
}) {
  const { t, locale } = useT();
  const currency = useCurrency();
  const money = (v: number) => formatMoney(v, currency, locale);
  const items = useCommissionItems(row.repId, from, to, branchId);
  return (
    <Sheet
      title={codeName(row.repCode, row.repName)}
      wide
      onClose={onClose}
      closeLabel={t('common.close')}
    >
      {items.isLoading ? (
        <Loading />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-muted">
              <tr>
                <th className="py-1.5 text-start font-normal">{t('commission.date')}</th>
                <th className="py-1.5 text-start font-normal">{t('commission.document')}</th>
                <th className="py-1.5 text-start font-normal">{t('commission.customer')}</th>
                <th className="py-1.5 text-end font-normal">{t('commission.amount')}</th>
                <th className="py-1.5 text-end font-normal">%</th>
                <th className="py-1.5 text-end font-normal">{t('commission.due')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {(items.data ?? []).map((i, n) => (
                <tr key={`${i.documentId}-${i.reference}-${n}`}>
                  <td className="py-1.5 tnum">{formatDate(i.date, locale)}</td>
                  <td className="py-1.5">
                    <Badge
                      tone={
                        i.kind === 'RETURN' ? 'warning' : i.kind === 'SALE' ? 'info' : 'positive'
                      }
                    >
                      {t(KIND_LABEL[i.kind])}
                    </Badge>{' '}
                    <Link
                      className="text-brand tnum hover:underline"
                      to={`/sales?${i.kind === 'RETURN' ? 'tab=returns&' : ''}doc=${i.documentId}`}
                    >
                      {i.number}
                    </Link>
                    {i.reference !== i.number && (
                      <span className="block text-xs text-faint tnum">{i.reference}</span>
                    )}
                    {i.departmentName && (
                      <span className="block text-xs text-muted">{i.departmentName}</span>
                    )}
                  </td>
                  <td className="py-1.5">
                    <bdi>{i.partyName}</bdi>
                  </td>
                  <td className={`py-1.5 text-end tnum ${i.amount < 0 ? 'text-destructive' : ''}`}>
                    {money(i.amount)}
                  </td>
                  <td className="py-1.5 text-end tnum text-muted">
                    {i.percentBp ? percentText(i.percentBp, locale) : '–'}
                  </td>
                  <td className="py-1.5 text-end font-medium tnum">
                    {i.commission ? money(i.commission) : '–'}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t border-line font-semibold">
              <tr>
                <td className="py-2" colSpan={5}>
                  {t('ledger.total')}
                </td>
                <td className="py-2 text-end tnum">{money(row.commission)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </Sheet>
  );
}

/* ------------------------------------------------------------ the rules */

function RulesTab() {
  const { t, locale } = useT();
  const rules = useCommissionRules();
  const [editing, setEditing] = useState<CommissionRule | 'new' | null>(null);
  const byRep = useMemo(() => {
    const m = new Map<string, CommissionRule[]>();
    for (const r of rules.data ?? []) m.set(r.repId, [...(m.get(r.repId) ?? []), r]);
    return [...m.values()];
  }, [rules.data]);
  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button icon="plus" onClick={() => setEditing('new')}>
          {t('commission.addRule')}
        </Button>
      </div>
      {rules.isLoading ? (
        <Loading />
      ) : byRep.length === 0 ? (
        <Card>
          <EmptyState title={t('commission.noRules')} icon="payroll" />
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {byRep.map((list) => (
            <Card key={list[0]!.repId} className="space-y-2">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <CodeName code={list[0]!.repCode} name={list[0]!.repName} className="font-medium" />
                <span className="text-xs text-muted">
                  {list[0]!.employeeName ?? t('commission.notLinked')}
                </span>
              </div>
              <ul className="divide-y divide-line text-sm">
                {list.map((r) => (
                  <li key={r.id}>
                    <button
                      type="button"
                      onClick={() => setEditing(r)}
                      className="flex w-full items-center justify-between gap-2 py-2 text-start hover:text-brand"
                    >
                      <span>
                        <span className="font-semibold tnum">
                          {percentText(r.percentBp, locale)}
                        </span>{' '}
                        {t(`commission.basis.${r.basis}` as TranslationKey)}
                        <span className="block text-xs text-muted">
                          {r.departmentName ?? t('commission.everyDepartment')}
                        </span>
                      </span>
                      <span className="text-xs text-muted tnum">
                        {t('commission.fromDay')} {formatDate(r.startDate, locale)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </Card>
          ))}
        </div>
      )}
      {editing && (
        <RuleSheet
          rule={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function RuleSheet({ rule, onClose }: { rule?: CommissionRule; onClose: () => void }) {
  const { t } = useT();
  const options = useCommissionOptions();
  const save = useSaveCommissionRule();
  const remove = useDeleteCommissionRule();
  const [f, setF] = useState({
    repId: rule?.repId ?? '',
    basis: (rule?.basis ?? 'NET_SALES') as CommissionBasis,
    percent: rule ? String(rule.percentBp / 100) : '',
    departmentId: rule?.departmentId ?? '',
    startDate: rule?.startDate ?? `${companyToday().slice(0, 7)}-01`,
  });
  const set = (patch: Partial<typeof f>) => setF((cur) => ({ ...cur, ...patch }));
  const percent = Number(f.percent);
  const bad = !f.repId || !(percent > 0 && percent <= 100) || !f.startDate;
  const rep = options.data?.reps.find((r) => r.id === f.repId);

  async function submit() {
    try {
      await save.mutateAsync({
        id: rule?.id,
        input: { ...f, percent },
      });
      onClose();
    } catch {
      /* shown below */
    }
  }
  async function del() {
    if (!rule) return;
    const ok = await confirm({
      title: t('commission.deleteRule'),
      message: `${codeName(rule.repCode, rule.repName)} · ${rule.percentBp / 100}%`,
      confirmText: t('common.delete'),
      danger: true,
    });
    if (!ok) return;
    try {
      await remove.mutateAsync(rule.id);
      onClose();
    } catch {
      /* shown below */
    }
  }

  return (
    <Sheet
      title={rule ? t('commission.editRule') : t('commission.addRule')}
      onClose={onClose}
      closeLabel={t('common.close')}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Field label={t('commission.rep')}>
            <select
              className={field}
              value={f.repId}
              onChange={(e) => set({ repId: e.target.value })}
            >
              <option value="">—</option>
              {(options.data?.reps ?? [])
                .filter((r) => r.active || r.id === f.repId)
                .map((r) => (
                  <option key={r.id} value={r.id}>
                    {codeName(r.code, r.name)}
                  </option>
                ))}
            </select>
          </Field>
          {rep && (
            <p className="mt-1 text-xs text-muted">
              {rep.employeeName
                ? `${t('commission.employee')}: ${rep.employeeName}`
                : t('commission.notLinked')}
            </p>
          )}
        </div>
        <Field label={t('commission.basisLabel')}>
          <select
            className={field}
            value={f.basis}
            onChange={(e) => set({ basis: e.target.value as CommissionBasis })}
          >
            {(['NET_SALES', 'COLLECTIONS'] as const).map((b) => (
              <option key={b} value={b}>
                {t(`commission.basis.${b}`)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t('commission.percent')}>
          <input
            className={`${field} tnum`}
            type="number"
            min={0}
            max={100}
            step="0.01"
            value={f.percent}
            onChange={(e) => set({ percent: e.target.value })}
          />
        </Field>
        <Field label={t('commission.department')}>
          <select
            className={field}
            value={f.departmentId}
            onChange={(e) => set({ departmentId: e.target.value })}
          >
            <option value="">{t('commission.everyDepartment')}</option>
            {(options.data?.departments ?? []).map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t('commission.startDate')}>
          <input
            className={field}
            type="date"
            value={f.startDate}
            onChange={(e) => set({ startDate: e.target.value })}
          />
        </Field>
      </div>
      {(save.error || remove.error) && (
        <p className="mt-3 text-sm text-destructive">{errorText(t, save.error ?? remove.error)}</p>
      )}
      <div className="mt-4 flex flex-wrap justify-between gap-2">
        {rule ? (
          <Button variant="ghost" onClick={() => void del()} loading={remove.isPending}>
            {t('common.delete')}
          </Button>
        ) : (
          <span />
        )}
        <Button icon="check" disabled={bad} loading={save.isPending} onClick={() => void submit()}>
          {t('common.save')}
        </Button>
      </div>
    </Sheet>
  );
}
