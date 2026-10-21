import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  addDays,
  addMonths,
  companyToday,
  formatDate,
  formatMoney,
  toMajor,
  toMinor,
  type ChequeScan,
  type NoteDirection,
  type NoteKind,
  type Party,
} from '@skb/shared';
import { Button, Card, PageHeader } from '../components/ui';
import { Icon } from '../components/Icon';
import { PartyPicker } from '../components/PartyPicker';
import { ScanButton } from '../components/ScanButton';
import { CameraSheet, CropSheet } from '../components/ChequeCamera';
import { shrinkPhoto } from '../components/IdCards';
import { useT } from '../lib/i18n';
import { api } from '../lib/api';
import { errorText } from '../lib/errors';
import { useCreateNotes, useOpenInvoices } from '../lib/queries';

const field =
  'h-9 w-full rounded-[var(--radius-app)] border border-line bg-surface px-2.5 text-sm outline-none focus:border-brand';
const cell =
  'h-8 w-full rounded-[var(--radius-app)] border border-line bg-surface px-2 text-sm outline-none focus:border-brand';
const minor = (v: string) => (v.trim() === '' ? 0 : toMinor(Number(v) || 0));

interface Row {
  key: number;
  serial: string;
  bank: string;
  drawer: string;
  amount: string;
  due: string;
  photo: Blob | null;
  photoUrl: string | null;
}

/** Every so many days, two weeks, a month, 45 days… (owner, 2026-10-02). */
type Every = '10d' | '14d' | '1m' | '45d' | 'custom';
let nextKey = 1;
const blank = (due: string): Row => ({
  key: nextKey++,
  serial: '',
  bank: '',
  drawer: '',
  amount: '',
  due,
  photo: null,
  photoUrl: null,
});

/**
 * Receiving or issuing cheques as a page of its own (owner, 2026-10-02): the customer or supplier by
 * name or code, when it came and who brought it, one cheque or a whole series every so many days,
 * each with its photo (taken in the app or cut from one photo of all of them), and the invoices they
 * settle, oldest first by themselves. Everything is saved together, or nothing.
 */
export function NoteFormPage({ direction }: { direction: NoteDirection }) {
  const { t, locale } = useT();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const receivable = direction === 'RECEIVABLE';
  const create = useCreateNotes();

  const [party, setParty] = useState<Party | null>(null);
  const [kind, setKind] = useState<NoteKind>('CHEQUE');
  const [receivedOn, setReceivedOn] = useState(companyToday());
  const [broughtBy, setBroughtBy] = useState('');
  const [remark, setRemark] = useState('');
  const [rows, setRows] = useState<Row[]>(() => {
    const first = blank(companyToday());
    const amount = Number(params.get('amount'));
    if (amount > 0) first.amount = String(toMajor(amount));
    return [first];
  });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // A customer picked from elsewhere (e.g. after approving an invoice): ?party=<id>.
  useEffect(() => {
    const id = params.get('party');
    if (!id || party) return;
    void api
      .get<Party>(`/parties/${id}`)
      .then(setParty)
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Photos live in memory only while the page is open.
  useEffect(
    () => () => rows.forEach((r) => r.photoUrl && URL.revokeObjectURL(r.photoUrl)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const set = (key: number, patch: Partial<Row>) =>
    setRows((cur) => cur.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const setPhoto = (key: number, blob: Blob | null) =>
    setRows((cur) =>
      cur.map((r) => {
        if (r.key !== key) return r;
        if (r.photoUrl) URL.revokeObjectURL(r.photoUrl);
        return { ...r, photo: blob, photoUrl: blob ? URL.createObjectURL(blob) : null };
      }),
    );
  const total = rows.reduce((s, r) => s + minor(r.amount), 0);

  // ---- the series: so many cheques, every so many days ----
  const [series, setSeries] = useState(false);
  const [count, setCount] = useState('6');
  const [firstDue, setFirstDue] = useState(addMonths(companyToday(), 1));
  const [every, setEvery] = useState<Every>('1m');
  const [customDays, setCustomDays] = useState('20');
  const [each, setEach] = useState('');
  const [split, setSplit] = useState<'each' | 'total'>('each');
  const [firstSerial, setFirstSerial] = useState('');
  const [seriesBank, setSeriesBank] = useState('');
  function makeSeries() {
    const n = Math.max(1, Math.min(60, Math.floor(Number(count) || 1)));
    const amounts: number[] = [];
    if (split === 'total') {
      const all = minor(each);
      const part = Math.floor(all / n);
      for (let i = 0; i < n; i++) amounts.push(i === n - 1 ? all - part * (n - 1) : part);
    } else for (let i = 0; i < n; i++) amounts.push(minor(each));
    const serialNo = /^\d+$/.test(firstSerial.trim()) ? BigInt(firstSerial.trim()) : null;
    const width = firstSerial.trim().length;
    const made: Row[] = [];
    for (let i = 0; i < n; i++) {
      const due =
        every === '1m'
          ? addMonths(firstDue, i)
          : addDays(
              firstDue,
              i *
                (every === '10d'
                  ? 10
                  : every === '14d'
                    ? 14
                    : every === '45d'
                      ? 45
                      : Math.max(1, Number(customDays) || 1)),
            );
      const r = blank(due);
      r.amount = amounts[i] ? String(toMajor(amounts[i]!)) : '';
      r.serial =
        serialNo !== null
          ? (serialNo + BigInt(i)).toString().padStart(width, '0')
          : i === 0
            ? firstSerial.trim()
            : '';
      r.bank = seriesBank.trim();
      made.push(r);
    }
    rows.forEach((r) => r.photoUrl && URL.revokeObjectURL(r.photoUrl));
    setRows(made);
    setSeries(false);
  }

  // ---- photos ----
  const [camera, setCamera] = useState<number | 'all' | null>(null);
  const [cropping, setCropping] = useState<Blob | null>(null);
  const waiting = rows.filter((r) => !r.photo);
  function takePhotos(photos: Blob[]) {
    if (camera !== 'all' && camera !== null) {
      if (photos[0]) void shrinkPhoto(photos[0]).then((b) => setPhoto(camera, b));
    } else if (photos.length === 1 && waiting.length > 1) {
      // One photo of all the cheques: cut each one out.
      setCropping(photos[0]!);
    } else {
      photos.forEach((p, i) => {
        const row = waiting[i];
        if (row) void shrinkPhoto(p).then((b) => setPhoto(row.key, b));
      });
    }
    setCamera(null);
  }
  const label = (r: Row) => `#${rows.indexOf(r) + 1}${r.serial ? ` (${r.serial})` : ''}`;

  // ---- the invoices they settle: oldest first, by themselves ----
  const open = useOpenInvoices(party?.id ?? '', receivable ? 'sales' : 'purchases');
  const invoices = useMemo(
    () => (open.data ?? []).filter((o) => !receivable || !o.onCodParcel),
    [open.data, receivable],
  );
  const [manual, setManual] = useState<Record<string, string> | null>(null);
  const fifo = useMemo(() => {
    let left = total;
    const out: Record<string, string> = {};
    for (const o of invoices) {
      if (left <= 0) break;
      const take = Math.min(left, o.outstanding);
      out[o.documentId] = String(toMajor(take));
      left -= take;
    }
    return out;
  }, [invoices, total]);
  const alloc = manual ?? fifo;
  const allocated = Object.values(alloc).reduce((s, v) => s + minor(v), 0);
  const over =
    allocated > total || invoices.some((o) => minor(alloc[o.documentId] ?? '') > o.outstanding);

  const missing: string[] = [];
  if (!party) missing.push(t('cheque.needParty'));
  rows.forEach((r, i) => {
    if (!r.serial.trim()) missing.push(`#${i + 1}: ${t('cheque.needSerial')}`);
    if (minor(r.amount) <= 0) missing.push(`#${i + 1}: ${t('cheque.needAmount')}`);
    if (!r.due) missing.push(`#${i + 1}: ${t('cheque.needDue')}`);
  });
  if (over) missing.push(t('money.overAllocated'));

  async function save() {
    if (missing.length > 0 || !party) {
      setError(missing.join(' · '));
      return;
    }
    setError(null);
    setSaving(true);
    try {
      // The settled invoices, in order, shared over the cheques in order.
      const queue = invoices
        .map((o) => ({ documentId: o.documentId, amount: minor(alloc[o.documentId] ?? '') }))
        .filter((a) => a.amount > 0);
      const notes = rows.map((r) => {
        let room = minor(r.amount);
        const allocations: { documentId: string; amount: number }[] = [];
        while (room > 0 && queue.length > 0) {
          const head = queue[0]!;
          const take = Math.min(room, head.amount);
          allocations.push({ documentId: head.documentId, amount: take });
          head.amount -= take;
          room -= take;
          if (head.amount === 0) queue.shift();
        }
        return {
          partyId: party.id,
          kind,
          serialNumber: r.serial.trim(),
          amount: minor(r.amount),
          dueDate: r.due,
          bankName: r.bank.trim() || undefined,
          drawer: r.drawer.trim() || undefined,
          remark: remark.trim() || undefined,
          receivedOn,
          broughtBy: broughtBy.trim() || undefined,
          allocations,
        };
      });
      const made = await create.mutateAsync({ direction, notes });
      // Each photo goes to its cheque, straight to the server.
      await Promise.all(
        rows.map((r, i) =>
          r.photo && made[i] ? api.upload(`/notes/${made[i]!.id}/photo`, r.photo) : null,
        ),
      );
      navigate(`/notes?tab=${receivable ? 'receivable' : 'payable'}`);
    } catch (e) {
      setError(errorText(t, e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title={receivable ? t('notes.receive') : t('notes.issue')}
        action={
          <Button variant="ghost" size="sm" icon="close" onClick={() => navigate('/notes')}>
            {t('invoice.back')}
          </Button>
        }
      />

      <Card className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="sm:col-span-2">
          <PartyPicker
            type={receivable ? 'CUSTOMER' : 'SUPPLIER'}
            withCode
            value={party}
            onChange={(p) => {
              setParty(p);
              setManual(null);
            }}
            label={receivable ? t('cheque.from') : t('cheque.to')}
            placeholder={t('money.pickParty')}
          />
        </div>
        <label className="block">
          <span className="mb-0.5 block text-xs text-muted">{t('notes.kind')}</span>
          <select
            className={field}
            value={kind}
            onChange={(e) => setKind(e.target.value as NoteKind)}
          >
            <option value="CHEQUE">{t('notes.kind.CHEQUE')}</option>
            <option value="PROMISSORY_NOTE">{t('notes.kind.PROMISSORY_NOTE')}</option>
          </select>
        </label>
        <label className="block">
          <span className="mb-0.5 block text-xs text-muted">
            {receivable ? t('cheque.receivedOn') : t('cheque.handedOn')}
          </span>
          <input
            type="date"
            className={`${field} tnum`}
            value={receivedOn}
            max={companyToday()}
            onChange={(e) => setReceivedOn(e.target.value || companyToday())}
          />
        </label>
        <label className="block sm:col-span-2">
          <span className="mb-0.5 block text-xs text-muted">
            {receivable ? t('cheque.broughtBy') : t('cheque.takenBy')}
          </span>
          <input
            className={field}
            maxLength={100}
            value={broughtBy}
            onChange={(e) => setBroughtBy(e.target.value)}
          />
        </label>
        <label className="block sm:col-span-2">
          <span className="mb-0.5 block text-xs text-muted">{t('notes.remark')}</span>
          <input
            className={field}
            maxLength={500}
            value={remark}
            onChange={(e) => setRemark(e.target.value)}
          />
        </label>
      </Card>

      <Card className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="me-auto text-sm font-semibold">
            {t('cheque.list')} <span className="text-muted tnum">({rows.length})</span>
          </h2>
          <Button
            size="sm"
            variant="secondary"
            icon="plus"
            onClick={() => setRows((cur) => [...cur, blank(cur.at(-1)?.due ?? companyToday())])}
          >
            {t('cheque.addOne')}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            icon="calendar"
            onClick={() => setSeries((s) => !s)}
          >
            {t('cheque.series')}
          </Button>
          <Button size="sm" icon="camera" onClick={() => setCamera('all')}>
            {t('cheque.photographAll')}
          </Button>
          {/* The assistant reads the cheques from one photo into rows to check (owner, 2026-10-06). */}
          <ScanButton<ChequeScan[]>
            kind="cheques"
            onResult={(found) => {
              if (found.length === 0) return;
              setRows((cur) => [
                ...cur.filter((r) => r.serial || r.amount),
                ...found.map((c) => ({
                  ...blank(c.dueDate ?? cur.at(-1)?.due ?? companyToday()),
                  serial: c.serial ?? '',
                  bank: c.bank ?? '',
                  drawer: c.drawer ?? '',
                  amount: c.amount ? String(c.amount) : '',
                })),
              ]);
            }}
          />
        </div>

        {series && (
          <div className="grid gap-3 rounded-[var(--radius-app)] border border-brand/40 bg-brand-soft/30 p-3 sm:grid-cols-3 lg:grid-cols-6">
            <label className="block">
              <span className="mb-0.5 block text-xs text-muted">{t('cheque.count')}</span>
              <input
                type="number"
                min={1}
                max={60}
                className={`${field} tnum`}
                value={count}
                onChange={(e) => setCount(e.target.value)}
              />
            </label>
            <label className="block">
              <span className="mb-0.5 block text-xs text-muted">{t('cheque.firstDue')}</span>
              <input
                type="date"
                className={`${field} tnum`}
                value={firstDue}
                onChange={(e) => setFirstDue(e.target.value)}
              />
            </label>
            <label className="block">
              <span className="mb-0.5 block text-xs text-muted">{t('cheque.every')}</span>
              <select
                className={field}
                value={every}
                onChange={(e) => setEvery(e.target.value as Every)}
              >
                <option value="10d">{t('cheque.every10')}</option>
                <option value="14d">{t('cheque.every14')}</option>
                <option value="1m">{t('cheque.everyMonth')}</option>
                <option value="45d">{t('cheque.every45')}</option>
                <option value="custom">{t('cheque.everyCustom')}</option>
              </select>
            </label>
            {every === 'custom' && (
              <label className="block">
                <span className="mb-0.5 block text-xs text-muted">{t('cheque.days')}</span>
                <input
                  type="number"
                  min={1}
                  className={`${field} tnum`}
                  value={customDays}
                  onChange={(e) => setCustomDays(e.target.value)}
                />
              </label>
            )}
            <label className="block">
              <span className="mb-0.5 block text-xs text-muted">
                {split === 'each' ? t('cheque.amountEach') : t('cheque.amountTotal')}
              </span>
              <span className="flex gap-1">
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  className={`${field} tnum`}
                  value={each}
                  onChange={(e) => setEach(e.target.value)}
                />
                <select
                  className={`${field} !w-24 px-1`}
                  value={split}
                  onChange={(e) => setSplit(e.target.value as 'each' | 'total')}
                  aria-label={t('cheque.amountEach')}
                >
                  <option value="each">{t('cheque.each')}</option>
                  <option value="total">{t('cheque.total')}</option>
                </select>
              </span>
            </label>
            <label className="block">
              <span className="mb-0.5 block text-xs text-muted">{t('cheque.firstSerial')}</span>
              <input
                className={`${field} tnum`}
                dir="ltr"
                value={firstSerial}
                onChange={(e) => setFirstSerial(e.target.value)}
              />
            </label>
            <label className="block">
              <span className="mb-0.5 block text-xs text-muted">{t('notes.bank')}</span>
              <input
                className={field}
                value={seriesBank}
                onChange={(e) => setSeriesBank(e.target.value)}
              />
            </label>
            <div className="flex items-end">
              <Button className="w-full" icon="check" onClick={makeSeries}>
                {t('cheque.makeSeries')}
              </Button>
            </div>
          </div>
        )}

        <div className="relative overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="text-xs text-muted">
              <tr>
                <th className="w-8 px-1 py-1.5 text-start font-medium">#</th>
                <th className="px-1 py-1.5 text-start font-medium">{t('notes.serial')}</th>
                <th className="px-1 py-1.5 text-start font-medium">{t('notes.amount')}</th>
                <th className="px-1 py-1.5 text-start font-medium">{t('notes.due')}</th>
                <th className="px-1 py-1.5 text-start font-medium">{t('notes.bank')}</th>
                {receivable && (
                  <th className="px-1 py-1.5 text-start font-medium">{t('notes.drawer')}</th>
                )}
                <th className="px-1 py-1.5 text-start font-medium">{t('cheque.photo')}</th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.key} className="align-top">
                  <td className="px-1 py-1 text-muted tnum">{i + 1}</td>
                  <td className="px-1 py-1">
                    <input
                      className={`${cell} tnum`}
                      dir="ltr"
                      maxLength={40}
                      value={r.serial}
                      onChange={(e) => set(r.key, { serial: e.target.value })}
                    />
                  </td>
                  <td className="px-1 py-1">
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      className={`${cell} w-28 tnum`}
                      value={r.amount}
                      onChange={(e) => set(r.key, { amount: e.target.value })}
                    />
                  </td>
                  <td className="px-1 py-1">
                    <input
                      type="date"
                      className={`${cell} tnum`}
                      value={r.due}
                      onChange={(e) => set(r.key, { due: e.target.value })}
                    />
                  </td>
                  <td className="px-1 py-1">
                    <input
                      className={cell}
                      maxLength={100}
                      value={r.bank}
                      onChange={(e) => set(r.key, { bank: e.target.value })}
                    />
                  </td>
                  {receivable && (
                    <td className="px-1 py-1">
                      <input
                        className={cell}
                        maxLength={100}
                        value={r.drawer}
                        onChange={(e) => set(r.key, { drawer: e.target.value })}
                      />
                    </td>
                  )}
                  <td className="px-1 py-1">
                    <span className="flex items-center gap-1">
                      {r.photoUrl ? (
                        <>
                          <img
                            src={r.photoUrl}
                            alt=""
                            className="h-8 w-14 rounded border border-line object-cover"
                          />
                          <button
                            type="button"
                            className="text-faint hover:text-destructive"
                            aria-label={t('common.delete')}
                            onClick={() => setPhoto(r.key, null)}
                          >
                            <Icon name="close" size={14} />
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            className="grid h-8 w-8 place-items-center rounded-md border border-line text-muted hover:text-brand"
                            title={t('cheque.camera')}
                            aria-label={t('cheque.camera')}
                            onClick={() => setCamera(r.key)}
                          >
                            <Icon name="camera" size={15} />
                          </button>
                          <label
                            className="grid h-8 w-8 cursor-pointer place-items-center rounded-md border border-line text-muted hover:text-brand"
                            title={t('cheque.fromFile')}
                          >
                            <Icon name="plus" size={15} />
                            <input
                              type="file"
                              accept="image/jpeg,image/png,image/webp"
                              className="sr-only"
                              onChange={(e) => {
                                const f = e.target.files?.[0];
                                e.target.value = '';
                                if (f) void shrinkPhoto(f).then((b) => setPhoto(r.key, b));
                              }}
                            />
                          </label>
                        </>
                      )}
                    </span>
                  </td>
                  <td className="px-1 py-1">
                    {rows.length > 1 && (
                      <button
                        type="button"
                        className="grid h-8 w-8 place-items-center text-faint hover:text-destructive"
                        aria-label={t('common.delete')}
                        onClick={() => setRows((cur) => cur.filter((x) => x.key !== r.key))}
                      >
                        <Icon name="close" size={14} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="flex justify-between border-t border-line pt-2 text-sm">
          <span className="text-muted">{t('cheque.totalAll')}</span>
          <b className="tnum">{formatMoney(total, 'EGP', locale)}</b>
        </p>
      </Card>

      {party && (
        <Card className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="me-auto text-sm font-semibold">{t('money.invoices')}</h2>
            <span className="text-xs text-muted">{t('cheque.oldestFirst')}</span>
            {manual && (
              <Button size="sm" variant="ghost" onClick={() => setManual(null)}>
                {t('cheque.backToOldest')}
              </Button>
            )}
          </div>
          {invoices.length === 0 ? (
            <p className="rounded-[var(--radius-app)] bg-surface-2 p-3 text-sm text-muted">
              {t('money.noOpenInvoices')}
            </p>
          ) : (
            <ul className="max-h-64 space-y-1 overflow-auto">
              {invoices.map((o) => (
                <li
                  key={o.documentId}
                  className="grid grid-cols-[1fr_8rem] items-center gap-2 text-sm"
                >
                  <span className="min-w-0 truncate">
                    <span className="tnum">{o.number}</span>
                    <span className="text-xs text-muted">
                      {' '}
                      · {formatDate(o.issueDate, locale)} · {t('money.outstanding')}{' '}
                      {formatMoney(o.outstanding, 'EGP', locale)}
                    </span>
                  </span>
                  <input
                    className={`${cell} tnum`}
                    type="number"
                    min={0}
                    step="0.01"
                    aria-label={o.number}
                    value={alloc[o.documentId] ?? ''}
                    onChange={(e) => setManual({ ...alloc, [o.documentId]: e.target.value })}
                  />
                </li>
              ))}
            </ul>
          )}
          {over && <p className="text-xs text-destructive">{t('money.overAllocated')}</p>}
        </Card>
      )}

      {error && (
        <p className="rounded-[var(--radius-app)] bg-destructive-soft p-3 text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={() => navigate('/notes')}>
          {t('common.cancel')}
        </Button>
        <Button icon="check" loading={saving} onClick={() => void save()}>
          {t('common.save')} ({rows.length})
        </Button>
      </div>

      {camera !== null && <CameraSheet onDone={takePhotos} onClose={() => setCamera(null)} />}
      {cropping && (
        <CropSheet
          photo={cropping}
          labels={waiting.map(label)}
          onCut={(piece) => {
            const row = rows.find((r) => !r.photo);
            if (row) setPhoto(row.key, piece);
          }}
          onClose={() => setCropping(null)}
        />
      )}
    </div>
  );
}
