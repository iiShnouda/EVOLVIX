import { confirm } from '../lib/confirm';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  formatDate,
  formatMoney,
  formatNumber,
  toMinor,
  type AttendanceStatus,
  type Employee,
  type PayrollRun,
  type PayrollRunStatus,
  type TranslationKey,
  type WorkShift,
  addMonths,
  companyToday,
  deviceIdOk,
} from '@skb/shared';
import { Badge, Button, Card, EmptyState, PageHeader, Spinner, type Tone } from '../components/ui';
import { Sheet } from '../components/Sheet';
import { DocumentDateField, dayToSend } from '../components/DocumentDate';
import {
  NationalIdInput,
  PhoneInput,
  PhoneList,
  anyIdProblem,
  useCompanyCountry,
  type NamedPhone,
} from '../components/PhoneFields';
import { useWorkBranch } from '../stores/workBranch';
import { MoneyAccountPicker } from '../components/MoneyAccountPicker';
import { ReportActions } from '../components/ReportActions';
import { useT } from '../lib/i18n';
import { useCan } from '../lib/can';
import { errorText } from '../lib/errors';
import { useReportTools } from '../lib/report';
import {
  useAddAdjustment,
  useAdjustments,
  useAdvances,
  useAttendance,
  useBranches,
  useCancelAdjustment,
  useCancelAdvance,
  useCompanySettings,
  useCreatePayrollRun,
  useEmployees,
  useGiveAdvance,
  useImportAttendance,
  usePayrollAction,
  usePayrollRules,
  usePayrollRun,
  usePayrollRuns,
  useReps,
  useSaveAttendance,
  useSaveEmployee,
  useDeleteEmployee,
  useSavePayrollRules,
  useSaveShift,
  useShifts,
} from '../lib/queries';
import { TableColumns } from '../components/TableColumns';

type Tab = 'runs' | 'attendance' | 'employees' | 'advances' | 'setup';
const TABS: { key: Tab; label: TranslationKey }[] = [
  { key: 'runs', label: 'payroll.tabRuns' },
  { key: 'attendance', label: 'payroll.tabAttendance' },
  { key: 'employees', label: 'payroll.tabEmployees' },
  { key: 'advances', label: 'payroll.tabAdvances' },
  { key: 'setup', label: 'payroll.tabSetup' },
];
const STATUSES: AttendanceStatus[] = ['PRESENT', 'ABSENT', 'LEAVE', 'UNPAID_LEAVE', 'HOLIDAY'];
const RUN_TONE: Record<PayrollRunStatus, Tone> = {
  DRAFT: 'warning',
  POSTED: 'info',
  PAID: 'positive',
  CANCELLED: 'neutral',
};

const field =
  'h-9 w-full rounded-[var(--radius-app)] border border-line bg-surface px-2.5 text-sm outline-none focus:border-brand disabled:opacity-60';
const todayIso = companyToday;
const lastMonth = () => addMonths(`${companyToday().slice(0, 7)}-01`, -1).slice(0, 7);

function useCurrency() {
  return useCompanySettings().data?.currency ?? 'EGP';
}

function Loading() {
  return (
    <div className="grid place-items-center py-16 text-muted">
      <Spinner size={26} />
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-0.5 block text-xs text-muted">{label}</span>
      {children}
    </label>
  );
}

/** Payroll & attendance (الرواتب والحضور, DOMAIN.md §2.9). */
export function PayrollPage() {
  const { t } = useT();
  const [params, setParams] = useSearchParams();
  const tab = (TABS.find((x) => x.key === params.get('tab'))?.key ?? 'runs') as Tab;
  return (
    <div className="space-y-5">
      <PageHeader title={t('payroll.title')} subtitle={t('payroll.subtitle')} />
      <div
        role="tablist"
        className="flex max-w-full flex-wrap gap-1 rounded-[var(--radius-app)] border border-line bg-surface p-1"
      >
        {TABS.map((x) => (
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
      {tab === 'runs' && <RunsTab />}
      {tab === 'attendance' && <AttendanceTab />}
      {tab === 'employees' && <EmployeesTab />}
      {tab === 'advances' && <AdvancesTab />}
      {tab === 'setup' && <SetupTab />}
    </div>
  );
}

/* ------------------------------------------------------------ payroll runs */

function RunsTab() {
  const { t, locale } = useT();
  const can = useCan();
  const currency = useCurrency();
  const [month, setMonth] = useState(lastMonth());
  const [branchId, setBranchId] = useState('');
  const branches = useBranches();
  const runs = usePayrollRuns();
  const [year, m] = month.split('-').map(Number) as [number, number];
  const found = (runs.data ?? []).find(
    (r) => r.year === year && r.month === m && (r.branchId ?? '') === branchId,
  );
  const other = (runs.data ?? []).filter((r) => r.year === year && r.month === m && r !== found);
  const run = usePayrollRun(found?.id ?? null);
  const create = useCreatePayrollRun();
  const action = usePayrollAction();
  const [confirmPost, setConfirmPost] = useState(false);
  // The day its entry carries (owner, 2026-10-02: the date of the payroll is the owner's to set).
  const [postDate, setPostDate] = useState(todayIso);
  const [paying, setPaying] = useState(false);
  const report = useReportTools();
  const paper = useRef<HTMLDivElement>(null);
  const money = (v: number) => formatMoney(v, currency, locale);
  const monthName = new Date(`${month}-15`).toLocaleDateString(
    locale === 'ar' ? 'ar-EG-u-nu-latn' : 'en-US',
    {
      month: 'long',
      year: 'numeric',
    },
  );
  const r = run.data;
  const title = `${t('payroll.title')} — ${monthName}${r?.branchName ? ` · ${r.branchName}` : ''}`;
  const cols: { key: keyof PayrollRun['lines'][number]; label: TranslationKey; minus?: boolean }[] =
    [
      { key: 'basic', label: 'payroll.basic' },
      { key: 'overtimePay', label: 'payroll.overtime' },
      { key: 'bonuses', label: 'payroll.bonuses' },
      { key: 'absenceDeduction', label: 'payroll.absence', minus: true },
      { key: 'lateDeduction', label: 'payroll.late', minus: true },
      { key: 'deductions', label: 'payroll.deductions', minus: true },
      { key: 'earned', label: 'payroll.earned' },
      { key: 'advanceRecovery', label: 'payroll.advance', minus: true },
      { key: 'net', label: 'payroll.net' },
    ];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <Field label={t('payroll.month')}>
            <input
              className={field}
              type="month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
            />
          </Field>
          <Field label={t('payroll.branch')}>
            <select
              className={field}
              value={branchId}
              onChange={(e) => setBranchId(e.target.value)}
            >
              <option value="">{t('payroll.wholeCompany')}</option>
              {(branches.data ?? []).map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
        {r && (
          <ReportActions
            onPrint={() => report.print(paper.current, title)}
            onExcel={() =>
              report.excel(
                title,
                r.number,
                [
                  t('payroll.code'),
                  t('payroll.employee'),
                  t('payroll.days'),
                  ...cols.map((c) => t(c.label)),
                  t('payroll.paid'),
                ],
                r.lines.map((l) => [
                  l.employeeCode,
                  l.employeeName,
                  `${l.workDays - l.absentDays}/${l.workDays}`,
                  ...cols.map((c) => ({ money: l[c.key] as number })),
                  l.paidAmount >= l.net ? t('payroll.yes') : '',
                ]),
                [
                  t('ledger.total'),
                  '',
                  '',
                  ...cols.map((c) => ({
                    money: r.lines.reduce((s, l) => s + (l[c.key] as number), 0),
                  })),
                ],
              )
            }
          />
        )}
      </div>

      <AdjustmentsCard year={year} month={m} branchId={branchId} />

      {runs.isLoading ? (
        <Loading />
      ) : !found ? (
        <Card className="space-y-2 text-sm">
          <p className="text-muted">{t('payroll.noRun')}</p>
          {other.length > 0 && (
            <p className="text-xs text-faint">
              {t('payroll.otherRuns')}:{' '}
              {other
                .map((o) => `${o.number} (${o.branchName ?? t('payroll.wholeCompany')})`)
                .join(' · ')}
            </p>
          )}
          {can('payroll:post') && (
            <Button
              icon="plus"
              loading={create.isPending}
              onClick={() => create.mutate({ year, month: m, branchId: branchId || undefined })}
            >
              {t('payroll.make')}
            </Button>
          )}
          {create.error && <p className="text-destructive">{errorText(t, create.error)}</p>}
        </Card>
      ) : !r ? (
        <Loading />
      ) : (
        <div className="space-y-3">
          <Card className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold tnum">{r.number}</span>
                <Badge tone={RUN_TONE[r.status]}>
                  {t(`payroll.status.${r.status}` as TranslationKey)}
                </Badge>
                {r.postedByName && (
                  <span className="text-xs text-muted">
                    {t('payroll.postedBy')} {r.postedByName} ·{' '}
                    {r.postedAt && formatDate(r.postedAt, locale)}
                  </span>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                {r.status === 'DRAFT' && can('payroll:post') && (
                  <>
                    <Button
                      size="sm"
                      variant="secondary"
                      loading={action.isPending && action.variables?.action === 'recalculate'}
                      onClick={() => action.mutate({ id: r.id, action: 'recalculate' })}
                    >
                      {t('payroll.recalculate')}
                    </Button>
                    {confirmPost ? (
                      <>
                        <DocumentDateField
                          value={postDate}
                          onChange={setPostDate}
                          className="w-40"
                        />
                        <Button
                          size="sm"
                          loading={action.isPending}
                          onClick={() =>
                            action.mutate(
                              { id: r.id, action: 'post', date: dayToSend(postDate) },
                              { onSettled: () => setConfirmPost(false) },
                            )
                          }
                        >
                          {t('payroll.postConfirm')}
                        </Button>
                      </>
                    ) : (
                      <Button size="sm" icon="check" onClick={() => setConfirmPost(true)}>
                        {t('payroll.post')}
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => action.mutate({ id: r.id, action: 'cancel' })}
                    >
                      {t('payroll.cancelDraft')}
                    </Button>
                  </>
                )}
                {r.status === 'POSTED' && can('payroll:pay') && (
                  <Button size="sm" icon="receipts" onClick={() => setPaying(true)}>
                    {t('payroll.pay')}
                  </Button>
                )}
              </div>
            </div>
            {action.error && (
              <p className="text-sm text-destructive">{errorText(t, action.error)}</p>
            )}
          </Card>

          <div ref={paper} className="space-y-3">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[
                [t('payroll.earned'), r.earned],
                [t('payroll.advance'), r.recovered],
                [t('payroll.net'), r.net],
                [t('payroll.paid'), r.paid],
              ].map(([label, value]) => (
                <Card key={label as string} className="!p-3">
                  <p className="text-xs text-muted">{label}</p>
                  <p className="mt-0.5 font-semibold tnum">{money(value as number)}</p>
                </Card>
              ))}
            </div>
            <Card padded={false} className="overflow-x-auto">
              <TableColumns id="payroll.sheet">
                <table className="w-full min-w-[60rem] text-sm">
                  <thead className="bg-surface-2 text-xs text-muted">
                    <tr>
                      <th className="px-3 py-2 text-start font-normal">{t('payroll.employee')}</th>
                      <th className="px-2 py-2 text-end font-normal">{t('payroll.days')}</th>
                      {cols.map((c) => (
                        <th key={c.key} className="px-2 py-2 text-end font-normal">
                          {t(c.label)}
                        </th>
                      ))}
                      <th className="px-3 py-2 text-end font-normal">{t('payroll.paid')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {r.lines.map((l) => (
                      <tr key={l.id}>
                        <td className="px-3 py-1.5">
                          <span className="font-medium">{l.employeeName}</span>
                          <span className="block text-xs text-faint tnum">
                            {l.employeeCode}
                            {l.lateMinutes > 0 &&
                              ` · ${t('payroll.lateMin')} ${formatNumber(l.lateMinutes, locale)}`}
                            {l.overtimeMinutes > 0 &&
                              ` · ${t('payroll.overtimeMin')} ${formatNumber(l.overtimeMinutes, locale)}`}
                          </span>
                        </td>
                        <td className="px-2 py-1.5 text-end tnum">
                          {formatNumber(l.workDays - l.absentDays, locale)}/
                          {formatNumber(l.workDays, locale)}
                        </td>
                        {cols.map((c) => {
                          const v = l[c.key] as number;
                          return (
                            <td
                              key={c.key}
                              className={`px-2 py-1.5 text-end tnum ${c.key === 'net' ? 'font-semibold' : ''} ${c.minus && v ? 'text-destructive' : ''}`}
                            >
                              {v ? money(c.minus ? -v : v) : '–'}
                            </td>
                          );
                        })}
                        <td className="px-3 py-1.5 text-end">
                          {l.paidAmount >= l.net && r.status !== 'DRAFT' ? (
                            <Badge tone="positive">{t('payroll.yes')}</Badge>
                          ) : (
                            '–'
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableColumns>
            </Card>
          </div>
          {paying && <PaySheet run={r} onClose={() => setPaying(false)} />}
        </div>
      )}
    </div>
  );
}

function PaySheet({ run, onClose }: { run: PayrollRun; onClose: () => void }) {
  const { t, locale } = useT();
  const action = usePayrollAction();
  const unpaid = run.lines.filter((l) => l.paidAmount < l.net);
  const [picked, setPicked] = useState<Set<string>>(() => new Set(unpaid.map((l) => l.employeeId)));
  const [account, setAccount] = useState('');
  const [payDate, setPayDate] = useState(todayIso);
  const total = unpaid
    .filter((l) => picked.has(l.employeeId))
    .reduce((s, l) => s + l.net - l.paidAmount, 0);
  return (
    <Sheet
      title={`${t('payroll.pay')} — ${run.number}`}
      onClose={onClose}
      closeLabel={t('common.close')}
    >
      <div className="space-y-3 text-sm">
        <MoneyAccountPicker
          className={field}
          label={t('payroll.payFrom')}
          value={account}
          onChange={setAccount}
        />
        <ul className="max-h-72 divide-y divide-line overflow-y-auto rounded-[var(--radius-app)] border border-line">
          {unpaid.map((l) => (
            <li key={l.id} className="flex items-center justify-between gap-2 px-3 py-1.5">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={picked.has(l.employeeId)}
                  onChange={(e) =>
                    setPicked((s) => {
                      const n = new Set(s);
                      if (e.target.checked) n.add(l.employeeId);
                      else n.delete(l.employeeId);
                      return n;
                    })
                  }
                />
                {l.employeeName}
              </label>
              <span className="tnum">
                {formatMoney(l.net - l.paidAmount, run.currency, locale)}
              </span>
            </li>
          ))}
        </ul>
        <p className="font-semibold tnum">
          {t('ledger.total')}: {formatMoney(total, run.currency, locale)}
        </p>
        <DocumentDateField value={payDate} onChange={setPayDate} />
        {action.error && <p className="text-destructive">{errorText(t, action.error)}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            icon="check"
            disabled={total === 0}
            loading={action.isPending}
            onClick={() =>
              action.mutate(
                {
                  id: run.id,
                  action: 'pay',
                  body: {
                    accountId: account || undefined,
                    employeeIds: picked.size === unpaid.length ? undefined : [...picked],
                    documentDate: dayToSend(payDate),
                  },
                },
                { onSuccess: onClose },
              )
            }
          >
            {t('payroll.pay')}
          </Button>
        </div>
      </div>
    </Sheet>
  );
}

function AdjustmentsCard({
  year,
  month,
  branchId,
}: {
  year: number;
  month: number;
  branchId: string;
}) {
  const { t, locale } = useT();
  const can = useCan();
  const currency = useCurrency();
  const list = useAdjustments(year, month);
  const employees = useEmployees();
  const add = useAddAdjustment();
  const cancel = useCancelAdjustment();
  const [employeeId, setEmployeeId] = useState('');
  const [kind, setKind] = useState<'BONUS' | 'DEDUCTION'>('BONUS');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  // Only the chosen branch's employees (all of them for the whole company).
  const staff = (employees.data ?? []).filter((e) => !branchId || e.branchId === branchId);
  const inBranch = new Set(staff.map((e) => e.id));
  const rows = (list.data ?? []).filter((a) => !branchId || inBranch.has(a.employeeId));
  if (!can('payroll:adjust') && rows.length === 0) return null;
  return (
    <Card className="space-y-2 text-sm">
      <p className="font-medium">{t('payroll.adjustments')}</p>
      {rows.length > 0 && (
        <ul className="divide-y divide-line">
          {rows.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-1">
              <span>
                <Badge tone={a.kind === 'BONUS' ? 'positive' : 'destructive'}>
                  {t(`payroll.kind.${a.kind}` as TranslationKey)}
                </Badge>{' '}
                {a.employeeName}
                {a.reason && <span className="text-xs text-muted"> · {a.reason}</span>}
              </span>
              <span className="flex items-center gap-2">
                <span className="tnum">{formatMoney(a.amount, currency, locale)}</span>
                {!a.posted && can('payroll:adjust') && (
                  <Button
                    size="sm"
                    variant="ghost"
                    icon="close"
                    aria-label={t('common.delete')}
                    onClick={() => cancel.mutate(a.id)}
                  />
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      {can('payroll:adjust') && (
        <div className="grid gap-2 sm:grid-cols-[1fr_8rem_7rem_1fr_auto] sm:items-end">
          <label className="block shrink-0">
            <span className="mb-0.5 block text-xs text-muted">{t('payroll.employee')}</span>
            <select
              className={field}
              aria-label={t('payroll.employee')}
              value={employeeId}
              onChange={(e) => setEmployeeId(e.target.value)}
            >
              <option value="">{t('payroll.employee')}</option>
              {staff
                .filter((e) => e.isActive)
                .map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
            </select>
          </label>
          <label className="block shrink-0">
            <span className="mb-0.5 block text-xs text-muted">{t('payroll.adjustKind')}</span>
            <select
              className={field}
              value={kind}
              aria-label={t('payroll.adjustKind')}
              onChange={(e) => setKind(e.target.value as 'BONUS' | 'DEDUCTION')}
            >
              <option value="BONUS">{t('payroll.kind.BONUS')}</option>
              <option value="DEDUCTION">{t('payroll.kind.DEDUCTION')}</option>
            </select>
          </label>
          <input
            className={`${field} tnum`}
            type="number"
            min={0}
            step="0.01"
            placeholder={t('charge.amount')}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
          <input
            className={field}
            placeholder={t('payroll.reason')}
            maxLength={200}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <Button
            size="sm"
            icon="plus"
            disabled={!employeeId || !(Number(amount) > 0)}
            loading={add.isPending}
            onClick={() =>
              add.mutate(
                {
                  employeeId,
                  year,
                  month,
                  kind,
                  amount: toMinor(Number(amount)),
                  reason: reason.trim() || undefined,
                },
                {
                  onSuccess: () => {
                    setAmount('');
                    setReason('');
                  },
                },
              )
            }
          >
            {t('payroll.add')}
          </Button>
        </div>
      )}
      {(add.error || cancel.error) && (
        <p className="text-destructive">{errorText(t, add.error ?? cancel.error)}</p>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------ attendance */

interface DayDraft {
  status: AttendanceStatus | '';
  checkIn: string;
  checkOut: string;
  notes: string;
}

function AttendanceTab() {
  const { t, locale } = useT();
  const can = useCan();
  const [date, setDate] = useState(todayIso());
  const [branchId, setBranchId] = useState('');
  const branches = useBranches();
  const sheet = useAttendance(date, branchId);
  const save = useSaveAttendance();
  const [draft, setDraft] = useState<Record<string, DayDraft>>({});
  const [importing, setImporting] = useState(false);
  const editable = can('attendance:edit');

  useEffect(() => {
    if (!sheet.data) return;
    setDraft(
      Object.fromEntries(
        sheet.data.rows.map((r) => [
          r.employeeId,
          {
            status: r.status ?? '',
            checkIn: r.checkIn ?? '',
            checkOut: r.checkOut ?? '',
            notes: r.notes ?? '',
          },
        ]),
      ),
    );
  }, [sheet.data]);

  const rows = sheet.data?.rows ?? [];
  const changed = rows.filter((r) => {
    const d = draft[r.employeeId];
    return (
      d &&
      (d.status !== (r.status ?? '') ||
        d.checkIn !== (r.checkIn ?? '') ||
        d.checkOut !== (r.checkOut ?? '') ||
        d.notes !== (r.notes ?? ''))
    );
  });
  const set = (id: string, patch: Partial<DayDraft>) =>
    setDraft((cur) => ({ ...cur, [id]: { ...cur[id]!, ...patch } }));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <Field label={t('payroll.day')}>
            <input
              className={field}
              type="date"
              max={todayIso()}
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </Field>
          <Field label={t('payroll.branch')}>
            <select
              className={field}
              value={branchId}
              onChange={(e) => setBranchId(e.target.value)}
            >
              <option value="">{t('payroll.allBranches')}</option>
              {(branches.data ?? []).map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
        {editable && (
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={() =>
                setDraft((cur) =>
                  Object.fromEntries(
                    rows.map((r) => [
                      r.employeeId,
                      r.locked || r.dayOff || cur[r.employeeId]?.status
                        ? cur[r.employeeId]!
                        : { ...cur[r.employeeId]!, status: 'PRESENT' as AttendanceStatus },
                    ]),
                  ),
                )
              }
            >
              {t('payroll.allPresent')}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              icon="download"
              onClick={() => setImporting(true)}
            >
              {t('payroll.import')}
            </Button>
          </div>
        )}
      </div>
      {sheet.isLoading ? (
        <Loading />
      ) : rows.length === 0 ? (
        <Card>
          <EmptyState title={t('payroll.noEmployees')} icon="payroll" />
        </Card>
      ) : (
        <Card padded={false} className="overflow-x-auto">
          <TableColumns id="payroll.history">
            <table className="w-full min-w-[46rem] text-sm">
              <thead className="bg-surface-2 text-xs text-muted">
                <tr>
                  <th className="px-3 py-2 text-start font-normal">{t('payroll.employee')}</th>
                  <th className="px-2 py-2 text-start font-normal">{t('payroll.status')}</th>
                  <th className="px-2 py-2 text-start font-normal">{t('payroll.in')}</th>
                  <th className="px-2 py-2 text-start font-normal">{t('payroll.out')}</th>
                  <th className="px-2 py-2 text-end font-normal">{t('payroll.lateMin')}</th>
                  <th className="px-2 py-2 text-end font-normal">{t('payroll.overtimeMin')}</th>
                  <th className="px-3 py-2 text-start font-normal">{t('payroll.notes')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((r) => {
                  const d = draft[r.employeeId];
                  if (!d) return null;
                  const disabled = !editable || r.locked;
                  return (
                    <tr key={r.employeeId} className={r.dayOff ? 'bg-surface-2/50' : ''}>
                      <td className="px-3 py-1.5">
                        <span className="font-medium">{r.name}</span>
                        <span className="block text-xs text-faint">
                          {r.code}
                          {r.shiftName && ` · ${r.shiftName}`}
                          {r.dayOff && ` · ${t('payroll.dayOff')}`}
                          {r.source === 'DEVICE' && ` · ${t('payroll.fromDevice')}`}
                          {r.locked && ` · ${t('payroll.locked')}`}
                        </span>
                      </td>
                      <td className="px-2 py-1.5">
                        <select
                          className={`${field} !w-36`}
                          disabled={disabled}
                          aria-label={t('payroll.status')}
                          value={d.status}
                          onChange={(e) =>
                            set(r.employeeId, { status: e.target.value as AttendanceStatus | '' })
                          }
                        >
                          <option value="">—</option>
                          {STATUSES.map((s) => (
                            <option key={s} value={s}>
                              {t(`payroll.att.${s}` as TranslationKey)}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-2 py-1.5">
                        <input
                          className={`${field} !w-28 tnum`}
                          type="time"
                          disabled={disabled || d.status !== 'PRESENT'}
                          aria-label={t('payroll.in')}
                          value={d.checkIn}
                          onChange={(e) => set(r.employeeId, { checkIn: e.target.value })}
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <input
                          className={`${field} !w-28 tnum`}
                          type="time"
                          disabled={disabled || d.status !== 'PRESENT'}
                          aria-label={t('payroll.out')}
                          value={d.checkOut}
                          onChange={(e) => set(r.employeeId, { checkOut: e.target.value })}
                        />
                      </td>
                      <td
                        className={`px-2 py-1.5 text-end tnum ${r.lateMinutes ? 'text-warning' : 'text-faint'}`}
                      >
                        {formatNumber(r.lateMinutes, locale)}
                      </td>
                      <td
                        className={`px-2 py-1.5 text-end tnum ${r.overtimeMinutes ? 'text-positive' : 'text-faint'}`}
                      >
                        {formatNumber(r.overtimeMinutes, locale)}
                      </td>
                      <td className="px-3 py-1.5">
                        <input
                          className={field}
                          disabled={disabled}
                          maxLength={200}
                          aria-label={t('payroll.notes')}
                          value={d.notes}
                          onChange={(e) => set(r.employeeId, { notes: e.target.value })}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableColumns>
        </Card>
      )}
      {editable && rows.length > 0 && (
        <div className="flex flex-wrap items-center gap-3">
          <Button
            icon="check"
            disabled={changed.length === 0}
            loading={save.isPending}
            onClick={() =>
              save.mutate({
                date,
                rows: changed.map((r) => {
                  const d = draft[r.employeeId]!;
                  return {
                    employeeId: r.employeeId,
                    status: d.status || null,
                    checkIn: d.status === 'PRESENT' && d.checkIn ? d.checkIn : undefined,
                    checkOut: d.status === 'PRESENT' && d.checkOut ? d.checkOut : undefined,
                    notes: d.notes.trim() || undefined,
                  };
                }),
              })
            }
          >
            {t('payroll.saveDay')}{' '}
            {changed.length > 0 && `(${formatNumber(changed.length, locale)})`}
          </Button>
          {save.error && (
            <span className="text-sm text-destructive">{errorText(t, save.error)}</span>
          )}
        </div>
      )}
      {importing && <ImportSheet onClose={() => setImporting(false)} />}
    </div>
  );
}

function ImportSheet({ onClose }: { onClose: () => void }) {
  const { t, locale } = useT();
  const run = useImportAttendance();
  const [text, setText] = useState('');
  const n = (v: number) => formatNumber(v, locale);
  return (
    <Sheet title={t('payroll.import')} onClose={onClose} closeLabel={t('common.close')}>
      <div className="space-y-3 text-sm">
        <p className="text-xs text-muted">{t('payroll.importHint')}</p>
        <input
          type="file"
          accept=".csv,.txt,.dat,text/plain,text/csv"
          className="block w-full text-sm"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (f) setText(await f.text());
          }}
        />
        <textarea
          className="h-40 w-full rounded-[var(--radius-app)] border border-line bg-surface p-2 font-mono text-xs"
          dir="ltr"
          placeholder={'101,2026-09-28 08:57:03\n101,2026-09-28 17:05:41'}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        {run.data && (
          <div className="rounded-[var(--radius-app)] bg-surface-2 p-3 text-xs">
            <p>
              {t('payroll.importDone')}: {n(run.data.days)} · {t('payroll.punches')}{' '}
              {n(run.data.punches)} · {t('payroll.skipped')} {n(run.data.skipped)}
              {run.data.locked > 0 && ` · ${t('payroll.locked')} ${n(run.data.locked)}`}
            </p>
            {run.data.unknownIds.length > 0 && (
              <p className="text-warning">
                {t('payroll.unknownIds')}: <bdi>{run.data.unknownIds.join(', ')}</bdi>
              </p>
            )}
          </div>
        )}
        {run.error && <p className="text-destructive">{errorText(t, run.error)}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            {t('common.close')}
          </Button>
          <Button
            icon="check"
            disabled={!text.trim()}
            loading={run.isPending}
            onClick={() => run.mutate(text)}
          >
            {t('payroll.read')}
          </Button>
        </div>
      </div>
    </Sheet>
  );
}

/* ------------------------------------------------------------ employees */

function EmployeesTab() {
  const { t, locale } = useT();
  const can = useCan();
  const currency = useCurrency();
  const list = useEmployees();
  const [editing, setEditing] = useState<Employee | 'new' | null>(null);
  const [showInactive, setShowInactive] = useState(false);
  const rows = (list.data ?? []).filter((e) => showInactive || e.isActive);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-sm text-muted">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
          />
          {t('payroll.showInactive')}
        </label>
        {can('employees:manage') && (
          <Button size="sm" icon="plus" onClick={() => setEditing('new')}>
            {t('payroll.addEmployee')}
          </Button>
        )}
      </div>
      {list.isLoading ? (
        <Loading />
      ) : rows.length === 0 ? (
        <Card>
          <EmptyState title={t('payroll.noEmployees')} icon="payroll" />
        </Card>
      ) : (
        <Card padded={false} className="overflow-hidden">
          <ul className="divide-y divide-line">
            {rows.map((e) => (
              <li key={e.id}>
                <button
                  type="button"
                  disabled={!can('employees:manage')}
                  onClick={() => setEditing(e)}
                  className={`flex w-full flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-start hover:bg-surface-2 disabled:hover:bg-transparent ${e.isActive ? '' : 'opacity-60'}`}
                >
                  <span className="min-w-0">
                    <span className="font-medium">{e.name}</span>{' '}
                    <span className="text-xs text-faint tnum">{e.code}</span>
                    <span className="block truncate text-xs text-muted">
                      {[
                        e.jobTitle,
                        e.branchName,
                        e.shiftName,
                        e.deviceUserId && `#${e.deviceUserId}`,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </span>
                  <span className="text-end">
                    <span className="block font-medium tnum">
                      {formatMoney(e.monthlySalary, currency, locale)}
                    </span>
                    {e.advanceBalance > 0 && (
                      <span className="text-xs text-warning tnum">
                        {t('payroll.owesAdvance')} {formatMoney(e.advanceBalance, currency, locale)}
                      </span>
                    )}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}
      {editing && (
        <EmployeeSheet
          employee={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function EmployeeSheet({ employee, onClose }: { employee?: Employee; onClose: () => void }) {
  const { t } = useT();
  const can = useCan();
  const save = useSaveEmployee();
  const remove = useDeleteEmployee();
  const branches = useBranches();
  const workBranch = useWorkBranch();
  const country = useCompanyCountry();
  const [others, setOthers] = useState<NamedPhone[]>(
    (employee?.otherPhones ?? []).map((phone, i) => ({
      phone,
      label: employee?.otherPhoneLabels?.[i] ?? '',
    })),
  );
  const shifts = useShifts();
  const staff = useReps(can('sales:view'));
  const [f, setF] = useState({
    name: employee?.name ?? '',
    branchId: employee?.branchId ?? workBranch,
    jobTitle: employee?.jobTitle ?? '',
    phone: employee?.phone ?? '',
    nationalId: employee?.nationalId ?? '',
    hireDate: employee?.hireDate ?? todayIso(),
    salary: employee ? String(employee.monthlySalary / 100) : '',
    shiftId: employee?.shiftId ?? '',
    deviceUserId: employee?.deviceUserId ?? '',
    staffId: employee?.staffId ?? '',
  });
  const set = (patch: Partial<typeof f>) => setF((cur) => ({ ...cur, ...patch }));
  const input = {
    name: f.name.trim(),
    branchId: f.branchId || undefined,
    jobTitle: f.jobTitle,
    phone: f.phone,
    nationalId: f.nationalId,
    hireDate: f.hireDate,
    monthlySalary: toMinor(Number(f.salary) || 0),
    shiftId: f.shiftId,
    deviceUserId: f.deviceUserId,
    staffId: f.staffId,
    otherPhones: others.filter((x) => x.phone.trim()).map((x) => x.phone.trim()),
    otherPhoneLabels: others.filter((x) => x.phone.trim()).map((x) => x.label.trim()),
  };
  // Phones and the national ID as the company's country has them; the device number digits only.
  const idBad =
    anyIdProblem(country, [f.phone, ...input.otherPhones], f.nationalId) ||
    !deviceIdOk(f.deviceUserId);
  async function run(extra: Record<string, unknown> = {}) {
    try {
      await save.mutateAsync({ id: employee?.id, input: { ...input, ...extra } });
      onClose();
    } catch {
      /* shown below */
    }
  }
  return (
    <Sheet
      title={employee ? `${employee.code} ${employee.name}` : t('payroll.addEmployee')}
      onClose={onClose}
      closeLabel={t('common.close')}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Field label={t('common.name')}>
            <input
              className={field}
              dir="auto"
              maxLength={200}
              value={f.name}
              onChange={(e) => set({ name: e.target.value })}
            />
          </Field>
        </div>
        <Field label={t('payroll.branch')}>
          <select
            className={field}
            value={f.branchId}
            onChange={(e) => set({ branchId: e.target.value })}
          >
            {(branches.data ?? []).map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t('payroll.jobTitle')}>
          <input
            className={field}
            dir="auto"
            maxLength={100}
            value={f.jobTitle}
            onChange={(e) => set({ jobTitle: e.target.value })}
          />
        </Field>
        <Field label={t('payroll.salary')}>
          <input
            className={`${field} tnum`}
            type="number"
            min={0}
            step="0.01"
            value={f.salary}
            onChange={(e) => set({ salary: e.target.value })}
          />
        </Field>
        <Field label={t('payroll.hireDate')}>
          <input
            className={field}
            type="date"
            value={f.hireDate}
            onChange={(e) => set({ hireDate: e.target.value })}
          />
        </Field>
        <Field label={t('payroll.shift')}>
          <select
            className={field}
            value={f.shiftId}
            onChange={(e) => set({ shiftId: e.target.value })}
          >
            <option value="">{t('payroll.defaultShift')}</option>
            {(shifts.data ?? [])
              .filter((s) => s.isActive || s.id === f.shiftId)
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.start}–{s.end})
                </option>
              ))}
          </select>
        </Field>
        <Field label={t('payroll.deviceId')}>
          <input
            className={`${field} tnum`}
            dir="ltr"
            inputMode="numeric"
            maxLength={10}
            value={f.deviceUserId}
            onChange={(e) => set({ deviceUserId: e.target.value.replace(/\D/g, '') })}
          />
        </Field>
        <PhoneInput
          value={f.phone}
          onChange={(phone) => set({ phone })}
          label={t('payroll.phone')}
        />
        <NationalIdInput
          value={f.nationalId}
          onChange={(nationalId) => set({ nationalId })}
          label={t('payroll.nationalId')}
        />
        <PhoneList value={others} onChange={setOthers} listId="employee-phone-kinds" />
        {staff.data && (
          <div className="sm:col-span-2">
            <Field label={t('payroll.signIn')}>
              <select
                className={field}
                value={f.staffId}
                onChange={(e) => set({ staffId: e.target.value })}
              >
                <option value="">{t('payroll.noSignIn')}</option>
                {staff.data.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        )}
      </div>
      {(save.error || remove.error) && (
        <p className="mt-3 text-sm text-destructive">{errorText(t, save.error ?? remove.error)}</p>
      )}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
        {employee ? (
          <span className="flex flex-wrap gap-1">
            <Button
              variant="ghost"
              size="sm"
              disabled={save.isPending}
              onClick={() => void run({ isActive: !employee.isActive })}
            >
              {employee.isActive ? t('payroll.deactivate') : t('payroll.reactivate')}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              icon="close"
              loading={remove.isPending}
              onClick={async () => {
                if (!(await confirm({ message: t('payroll.deleteAsk'), danger: true }))) return;
                try {
                  await remove.mutateAsync(employee.id);
                  onClose();
                } catch {
                  /* shown below */
                }
              }}
            >
              {t('payroll.delete')}
            </Button>
          </span>
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            icon="check"
            loading={save.isPending}
            disabled={!f.name.trim() || idBad}
            onClick={() => void run()}
          >
            {t('common.save')}
          </Button>
        </div>
      </div>
    </Sheet>
  );
}

/* ------------------------------------------------------------ advances */

function AdvancesTab() {
  const { t, locale } = useT();
  const can = useCan();
  const currency = useCurrency();
  const list = useAdvances();
  const employees = useEmployees();
  const give = useGiveAdvance();
  const cancel = useCancelAdvance();
  const [open, setOpen] = useState(false);
  const [advanceDate, setAdvanceDate] = useState(todayIso);
  const [f, setF] = useState({
    employeeId: '',
    amount: '',
    installment: '',
    accountId: '',
    notes: '',
  });
  const money = (v: number) => formatMoney(v, currency, locale);
  const rows = list.data ?? [];
  return (
    <div className="space-y-3">
      {can('payroll:advance') && (
        <div className="flex justify-end">
          <Button size="sm" icon="plus" onClick={() => setOpen(true)}>
            {t('payroll.newAdvance')}
          </Button>
        </div>
      )}
      {list.isLoading ? (
        <Loading />
      ) : rows.length === 0 ? (
        <Card>
          <EmptyState title={t('payroll.noAdvances')} icon="payroll" />
        </Card>
      ) : (
        <Card padded={false} className="overflow-hidden">
          <ul className="divide-y divide-line">
            {rows.map((a) => (
              <li
                key={a.id}
                className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm"
              >
                <span className="min-w-0">
                  <span className="font-medium">{a.employeeName}</span>{' '}
                  <span className="text-xs text-faint tnum">{a.number}</span>
                  <span className="block text-xs text-muted">
                    {formatDate(a.createdAt, locale)} · {a.accountName} · {t('payroll.installment')}{' '}
                    {money(a.installment)}
                    {a.notes && ` · ${a.notes}`}
                  </span>
                </span>
                <span className="flex items-center gap-2">
                  <span className="text-end">
                    <span className="block tnum">{money(a.amount)}</span>
                    {a.status === 'OPEN' && (
                      <span className="text-xs text-warning tnum">
                        {t('payroll.remaining')} {money(a.remaining)}
                      </span>
                    )}
                  </span>
                  <Badge
                    tone={
                      a.status === 'OPEN'
                        ? 'warning'
                        : a.status === 'SETTLED'
                          ? 'positive'
                          : 'neutral'
                    }
                  >
                    {t(`payroll.adv.${a.status}` as TranslationKey)}
                  </Badge>
                  {a.status === 'OPEN' && a.remaining === a.amount && can('payroll:advance') && (
                    <Button
                      size="sm"
                      variant="ghost"
                      loading={cancel.isPending && cancel.variables === a.id}
                      onClick={() => cancel.mutate(a.id)}
                    >
                      {t('payroll.returned')}
                    </Button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
      {cancel.error && <p className="text-sm text-destructive">{errorText(t, cancel.error)}</p>}
      {open && (
        <Sheet
          title={t('payroll.newAdvance')}
          onClose={() => setOpen(false)}
          closeLabel={t('common.close')}
        >
          <div className="space-y-3">
            <Field label={t('payroll.employee')}>
              <select
                className={field}
                value={f.employeeId}
                onChange={(e) => setF({ ...f, employeeId: e.target.value })}
              >
                <option value="">{t('payroll.employee')}</option>
                {(employees.data ?? [])
                  .filter((e) => e.isActive)
                  .map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.name}
                    </option>
                  ))}
              </select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t('charge.amount')}>
                <input
                  className={`${field} tnum`}
                  type="number"
                  min={0}
                  step="0.01"
                  value={f.amount}
                  onChange={(e) => setF({ ...f, amount: e.target.value })}
                />
              </Field>
              <Field label={t('payroll.installment')}>
                <input
                  className={`${field} tnum`}
                  type="number"
                  min={0}
                  step="0.01"
                  placeholder={f.amount}
                  value={f.installment}
                  onChange={(e) => setF({ ...f, installment: e.target.value })}
                />
              </Field>
            </div>
            <MoneyAccountPicker
              className={field}
              label={t('payroll.payFrom')}
              value={f.accountId}
              onChange={(v) => setF({ ...f, accountId: v })}
            />
            <Field label={t('payroll.notes')}>
              <input
                className={field}
                maxLength={300}
                value={f.notes}
                onChange={(e) => setF({ ...f, notes: e.target.value })}
              />
            </Field>
            <DocumentDateField value={advanceDate} onChange={setAdvanceDate} />
            {give.error && <p className="text-sm text-destructive">{errorText(t, give.error)}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setOpen(false)}>
                {t('common.cancel')}
              </Button>
              <Button
                icon="check"
                disabled={!f.employeeId || !(Number(f.amount) > 0)}
                loading={give.isPending}
                onClick={() =>
                  give.mutate(
                    {
                      employeeId: f.employeeId,
                      amount: toMinor(Number(f.amount)),
                      installment:
                        Number(f.installment) > 0 ? toMinor(Number(f.installment)) : undefined,
                      accountId: f.accountId || undefined,
                      notes: f.notes.trim() || undefined,
                      documentDate: dayToSend(advanceDate),
                    },
                    {
                      onSuccess: () => {
                        setOpen(false);
                        setF({
                          employeeId: '',
                          amount: '',
                          installment: '',
                          accountId: '',
                          notes: '',
                        });
                      },
                    },
                  )
                }
              >
                {t('payroll.give')}
              </Button>
            </div>
          </div>
        </Sheet>
      )}
    </div>
  );
}

/* ------------------------------------------------------------ shifts and rules */

function SetupTab() {
  const { t, locale } = useT();
  const can = useCan();
  const shifts = useShifts();
  const rules = usePayrollRules();
  const saveRules = useSavePayrollRules();
  const [editing, setEditing] = useState<WorkShift | 'new' | null>(null);
  const [r, setR] = useState<{
    dayBasis: string;
    overtimePercent: string;
    missing: boolean;
  } | null>(null);
  useEffect(() => {
    if (rules.data && !r)
      setR({
        dayBasis: String(rules.data.dayBasis),
        overtimePercent: String(rules.data.overtimePercent),
        missing: rules.data.missingAttendanceIsAbsent,
      });
  }, [rules.data, r]);
  const dayNames = useDayNames();
  const manage = can('employees:manage');
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <Card className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="font-medium">{t('payroll.shifts')}</p>
          {manage && (
            <Button size="sm" icon="plus" onClick={() => setEditing('new')}>
              {t('payroll.addShift')}
            </Button>
          )}
        </div>
        {(shifts.data ?? []).length === 0 ? (
          <p className="text-sm text-muted">{t('payroll.noShifts')}</p>
        ) : (
          <ul className="divide-y divide-line text-sm">
            {(shifts.data ?? []).map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  disabled={!manage}
                  onClick={() => setEditing(s)}
                  className={`flex w-full items-center justify-between gap-2 py-2 text-start ${s.isActive ? '' : 'opacity-60'}`}
                >
                  <span>
                    <span className="font-medium">{s.name}</span>
                    <span className="block text-xs text-muted tnum">
                      <bdi>
                        {s.start}–{s.end}
                      </bdi>{' '}
                      · {t('payroll.grace')} {formatNumber(s.graceMinutes, locale)} ·{' '}
                      {s.daysOff.map((d) => dayNames[d]).join(locale === 'ar' ? '، ' : ', ')}
                    </span>
                  </span>
                  <span className="text-xs text-faint tnum">
                    {formatNumber(Math.round((s.minutes / 60) * 10) / 10, locale)}{' '}
                    {t('payroll.hours')}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card className="space-y-3">
        <p className="font-medium">{t('payroll.rules')}</p>
        {r && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t('payroll.dayBasis')}>
                <input
                  className={`${field} tnum`}
                  type="number"
                  min={20}
                  max={31}
                  disabled={!manage}
                  value={r.dayBasis}
                  onChange={(e) => setR({ ...r, dayBasis: e.target.value })}
                />
              </Field>
              <Field label={t('payroll.overtimePercent')}>
                <input
                  className={`${field} tnum`}
                  type="number"
                  min={0}
                  max={500}
                  disabled={!manage}
                  value={r.overtimePercent}
                  onChange={(e) => setR({ ...r, overtimePercent: e.target.value })}
                />
              </Field>
            </div>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-1"
                disabled={!manage}
                checked={r.missing}
                onChange={(e) => setR({ ...r, missing: e.target.checked })}
              />
              <span>{t('payroll.missingIsAbsent')}</span>
            </label>
            {manage && (
              <Button
                size="sm"
                icon="check"
                loading={saveRules.isPending}
                onClick={() =>
                  saveRules.mutate({
                    dayBasis: Number(r.dayBasis),
                    overtimePercent: Number(r.overtimePercent),
                    missingAttendanceIsAbsent: r.missing,
                  })
                }
              >
                {t('common.save')}
              </Button>
            )}
            {saveRules.error && (
              <p className="text-sm text-destructive">{errorText(t, saveRules.error)}</p>
            )}
          </>
        )}
      </Card>
      {editing && (
        <ShiftSheet
          shift={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

/** Sunday … Saturday in the screen language. */
function useDayNames() {
  const { locale } = useT();
  return useMemo(
    () =>
      [...Array(7).keys()].map((d) =>
        new Date(Date.UTC(2023, 0, 1 + d)).toLocaleDateString(
          locale === 'ar' ? 'ar-EG-u-nu-latn' : 'en-US',
          {
            weekday: 'short',
            timeZone: 'UTC',
          },
        ),
      ),
    [locale],
  );
}

function ShiftSheet({ shift, onClose }: { shift?: WorkShift; onClose: () => void }) {
  const { t } = useT();
  const save = useSaveShift();
  const dayNames = useDayNames();
  const [f, setF] = useState({
    name: shift?.name ?? '',
    start: shift?.start ?? '09:00',
    end: shift?.end ?? '17:00',
    grace: String(shift?.graceMinutes ?? 15),
    daysOff: shift?.daysOff ?? [5],
  });
  async function run(extra: Record<string, unknown> = {}) {
    try {
      await save.mutateAsync({
        id: shift?.id,
        input: {
          name: f.name.trim(),
          start: f.start,
          end: f.end,
          graceMinutes: Number(f.grace) || 0,
          daysOff: f.daysOff,
          ...extra,
        },
      });
      onClose();
    } catch {
      /* shown below */
    }
  }
  return (
    <Sheet
      title={shift ? shift.name : t('payroll.addShift')}
      onClose={onClose}
      closeLabel={t('common.close')}
    >
      <div className="space-y-3">
        <Field label={t('common.name')}>
          <input
            className={field}
            dir="auto"
            maxLength={200}
            value={f.name}
            onChange={(e) => setF({ ...f, name: e.target.value })}
          />
        </Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label={t('payroll.start')}>
            <input
              className={`${field} tnum`}
              type="time"
              value={f.start}
              onChange={(e) => setF({ ...f, start: e.target.value })}
            />
          </Field>
          <Field label={t('payroll.end')}>
            <input
              className={`${field} tnum`}
              type="time"
              value={f.end}
              onChange={(e) => setF({ ...f, end: e.target.value })}
            />
          </Field>
          <Field label={t('payroll.grace')}>
            <input
              className={`${field} tnum`}
              type="number"
              min={0}
              max={240}
              value={f.grace}
              onChange={(e) => setF({ ...f, grace: e.target.value })}
            />
          </Field>
        </div>
        <div>
          <p className="mb-1 text-xs text-muted">{t('payroll.daysOff')}</p>
          <div className="flex flex-wrap gap-1">
            {dayNames.map((name, d) => (
              <button
                key={d}
                type="button"
                aria-pressed={f.daysOff.includes(d)}
                onClick={() =>
                  setF({
                    ...f,
                    daysOff: f.daysOff.includes(d)
                      ? f.daysOff.filter((x) => x !== d)
                      : [...f.daysOff, d],
                  })
                }
                className={`h-8 rounded-lg px-3 text-sm ${f.daysOff.includes(d) ? 'bg-brand-soft text-brand' : 'border border-line text-muted'}`}
              >
                {name}
              </button>
            ))}
          </div>
        </div>
        {save.error && <p className="text-sm text-destructive">{errorText(t, save.error)}</p>}
        <div className="flex flex-wrap items-center justify-between gap-2">
          {shift ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void run({ isActive: !shift.isActive })}
            >
              {shift.isActive ? t('payroll.deactivate') : t('payroll.reactivate')}
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button
              icon="check"
              loading={save.isPending}
              disabled={!f.name.trim()}
              onClick={() => void run()}
            >
              {t('common.save')}
            </Button>
          </div>
        </div>
      </div>
    </Sheet>
  );
}
