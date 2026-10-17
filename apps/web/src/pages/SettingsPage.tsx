import { useEffect, useState } from 'react';
import { COUNTRIES, CURRENCIES, TIME_ZONES, findCountry, type CompanySettings } from '@skb/shared';
import { Button, Card, PageHeader, Spinner } from '../components/ui';
import { useT } from '../lib/i18n';
import { useAuth } from '../stores/auth';
import {
  useBranding,
  useCompanyLogo,
  useCompanySettings,
  useNumbering,
  useSaveNumbering,
  useUpdateSettings,
} from '../lib/queries';
import { CompanyMark } from '../components/CompanyBadge';
import { errorText } from '../lib/errors';
import { GetApps } from '../components/GetApps';
import { BackupsCard } from '../components/BackupsCard';

const field =
  'h-9 w-full rounded-[var(--radius-app)] border border-line bg-surface px-2.5 text-sm outline-none focus:border-brand';

/** A zone's offset from UTC right now, e.g. "GMT+3". */
function offsetOf(zone: string): string {
  try {
    return (
      new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'shortOffset' })
        .formatToParts(new Date())
        .find((p) => p.type === 'timeZoneName')?.value ?? zone
    );
  } catch {
    return zone;
  }
}

/** The time of day now in a zone. */
function clockIn(zone: string, locale: string): string {
  try {
    return new Date().toLocaleTimeString(locale === 'ar' ? 'ar-EG-u-nu-latn' : 'en-US', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: zone,
    });
  } catch {
    return '';
  }
}

export function SettingsPage() {
  const { t, locale } = useT();
  const permissions = useAuth((s) => s.user?.permissions ?? []);
  const canManage = permissions.includes('settings:manage');
  const canBackup = permissions.includes('backup:create');
  const query = useCompanySettings();
  const update = useUpdateSettings();

  const [form, setForm] = useState<CompanySettings | null>(null);
  const [saved, setSaved] = useState(false);
  const [dirty, setDirty] = useState(false);

  // Load server settings into the editable form once.
  useEffect(() => {
    if (query.data && !form) setForm(query.data);
  }, [query.data, form]);

  // Leaving with changes not saved asks first.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  if (!form) {
    return (
      <div className="grid place-items-center py-16 text-muted">
        <Spinner size={26} />
      </div>
    );
  }

  const set = (patch: Partial<CompanySettings>) => {
    setForm((f) => (f ? { ...f, ...patch } : f));
    setSaved(false);
    setDirty(true);
  };

  // Picking a country suggests its currency + typical VAT (owner can still override).
  const onCountry = (code: string) => {
    const c = findCountry(code);
    set(
      c
        ? { country: code, currency: c.currency, defaultTaxPercent: c.vat, timeZone: c.timeZone }
        : { country: code },
    );
  };

  async function save() {
    if (!form) return;
    await update.mutateAsync({
      companyName: form.companyName,
      country: form.country,
      currency: form.currency,
      defaultTaxPercent: form.defaultTaxPercent,
      defaultMarkupPercent: form.defaultMarkupPercent,
      minMarkupPercent: form.minMarkupPercent,
      maxDiscountPercent: form.maxDiscountPercent,
      pendingHoldDays: form.pendingHoldDays,
      returnAfterHours: form.returnAfterHours ?? 12,
      transfersRequireReceipt: form.transfersRequireReceipt,
      requireDepartment: form.requireDepartment !== false,
      hideNewPlaces: form.hideNewPlaces !== false,
      idleMinutes: form.idleMinutes ?? 30,
      address: form.address ?? '',
      phone: form.phone ?? '',
      email: form.email ?? '',
      taxNumber: form.taxNumber ?? '',
      commercialRegister: form.commercialRegister ?? '',
      timeZone: form.timeZone,
    });
    setSaved(true);
    setDirty(false);
  }

  const disabled = !canManage;

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <PageHeader title={t('settings.title')} />

      {/* Save stays in reach at the top while scrolling (owner, 2026-10-02). */}
      {canManage && (
        <div className="sticky top-16 z-10 -mx-1 flex flex-wrap items-center gap-3 rounded-[var(--radius-app)] border border-line bg-surface px-3 py-2 shadow-sm">
          <Button
            icon="check"
            loading={update.isPending}
            onClick={save}
            disabled={!dirty && !update.error}
          >
            {update.isPending ? t('settings.saving') : t('settings.save')}
          </Button>
          {dirty ? (
            <span className="text-sm text-warning">{t('settings.unsaved')}</span>
          ) : saved ? (
            <span className="text-sm text-positive">{t('settings.saved')}</span>
          ) : null}
          {update.error && (
            <span className="text-sm text-destructive">{errorText(t, update.error)}</span>
          )}
        </div>
      )}

      {!canManage && (
        <p className="rounded-[var(--radius-app)] bg-warning-soft p-3 text-sm text-warning">
          {t('settings.readonly')}
        </p>
      )}

      {/* Company */}
      <Card>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">
          {t('settings.company')}
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block sm:col-span-2">
            <span className="mb-0.5 block text-xs text-muted">{t('settings.companyName')}</span>
            <input
              className={field}
              disabled={disabled}
              value={form.companyName}
              onChange={(e) => set({ companyName: e.target.value })}
            />
          </label>
          <CompanyLogoField disabled={disabled} />
          <label className="block">
            <span className="mb-0.5 block text-xs text-muted">{t('settings.country')}</span>
            <select
              className={field}
              disabled={disabled}
              value={form.country}
              onChange={(e) => onCountry(e.target.value)}
            >
              {COUNTRIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {locale === 'ar' ? c.nameAr : c.nameEn}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-0.5 block text-xs text-muted">{t('settings.currency')}</span>
            <select
              className={field}
              disabled={disabled}
              value={form.currency}
              onChange={(e) => set({ currency: e.target.value })}
            >
              {CURRENCIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.code} — {locale === 'ar' ? c.nameAr : c.nameEn}
                </option>
              ))}
            </select>
          </label>
          <label className="block sm:col-span-2">
            <span className="mb-0.5 block text-xs text-muted">{t('settings.timeZone')}</span>
            <select
              className={field}
              disabled={disabled}
              value={form.timeZone}
              onChange={(e) => set({ timeZone: e.target.value })}
            >
              {TIME_ZONES.map((z) => (
                <option key={z.id} value={z.id}>
                  {locale === 'ar' ? z.nameAr : z.nameEn} ({'⁦'}
                  {offsetOf(z.id)}
                  {'⁩'})
                </option>
              ))}
            </select>
            <span className="mt-1 block text-xs text-muted">
              {t('settings.timeZoneNow')}{' '}
              <bdi className="tnum">{clockIn(form.timeZone, locale)}</bdi>
            </span>
          </label>
          <label className="block sm:col-span-2">
            <span className="mb-0.5 block text-xs text-muted">{t('settings.address')}</span>
            <input
              className={field}
              dir="auto"
              disabled={disabled}
              maxLength={300}
              value={form.address ?? ''}
              onChange={(e) => set({ address: e.target.value })}
            />
          </label>
          <label className="block">
            <span className="mb-0.5 block text-xs text-muted">{t('settings.phone')}</span>
            <input
              className={field}
              dir="ltr"
              inputMode="tel"
              disabled={disabled}
              maxLength={60}
              value={form.phone ?? ''}
              onChange={(e) => set({ phone: e.target.value })}
            />
          </label>
          <label className="block">
            <span className="mb-0.5 block text-xs text-muted">{t('settings.email')}</span>
            <input
              className={field}
              dir="ltr"
              type="email"
              disabled={disabled}
              maxLength={200}
              value={form.email ?? ''}
              onChange={(e) => set({ email: e.target.value })}
            />
          </label>
          <label className="block">
            <span className="mb-0.5 block text-xs text-muted">{t('settings.taxNumber')}</span>
            <input
              className={`${field} tnum`}
              dir="ltr"
              disabled={disabled}
              maxLength={60}
              value={form.taxNumber ?? ''}
              onChange={(e) => set({ taxNumber: e.target.value })}
            />
          </label>
          <label className="block">
            <span className="mb-0.5 block text-xs text-muted">
              {t('settings.commercialRegister')}
            </span>
            <input
              className={`${field} tnum`}
              dir="ltr"
              disabled={disabled}
              maxLength={60}
              value={form.commercialRegister ?? ''}
              onChange={(e) => set({ commercialRegister: e.target.value })}
            />
          </label>
        </div>
      </Card>

      {/* Pricing & tax */}
      <Card>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">
          {t('settings.pricing')}
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="mb-0.5 block text-xs text-muted">{t('settings.vat')}</span>
            <input
              type="number"
              min={0}
              max={100}
              className={`${field} tnum`}
              disabled={disabled}
              value={form.defaultTaxPercent}
              onChange={(e) => set({ defaultTaxPercent: clampInt(e.target.value, 0, 100) })}
            />
          </label>
          <label className="block">
            <span className="mb-0.5 block text-xs text-muted">{t('settings.defaultMarkup')}</span>
            <input
              type="number"
              min={0}
              className={`${field} tnum`}
              disabled={disabled}
              value={form.defaultMarkupPercent}
              onChange={(e) => set({ defaultMarkupPercent: clampInt(e.target.value, 0, 1000) })}
            />
          </label>
          <label className="block sm:col-span-2">
            <span className="mb-0.5 block text-xs text-muted">{t('settings.minMarkup')}</span>
            <input
              type="number"
              min={0}
              className={`${field} tnum`}
              disabled={disabled}
              value={form.minMarkupPercent}
              onChange={(e) => set({ minMarkupPercent: clampInt(e.target.value, 0, 1000) })}
            />
          </label>
          <label className="block sm:col-span-2">
            <span className="mb-0.5 block text-xs text-muted">{t('settings.maxDiscount')}</span>
            <input
              type="number"
              min={0}
              max={100}
              className={`${field} tnum`}
              disabled={disabled}
              value={form.maxDiscountPercent ?? 100}
              onChange={(e) => set({ maxDiscountPercent: clampInt(e.target.value, 0, 100) })}
            />
          </label>
          <label className="block sm:col-span-2">
            <span className="mb-0.5 block text-xs text-muted">{t('settings.pendingHoldDays')}</span>
            <input
              type="number"
              min={0}
              max={365}
              className={`${field} tnum`}
              disabled={disabled}
              value={form.pendingHoldDays ?? 0}
              onChange={(e) => set({ pendingHoldDays: clampInt(e.target.value, 0, 365) })}
            />
          </label>
          {/* Goods on an invoice come back only after this many hours (owner, 2026-10-02). */}
          <label className="block sm:col-span-2">
            <span className="mb-0.5 block text-xs text-muted">
              {t('settings.returnAfterHours')}
            </span>
            <input
              type="number"
              min={0}
              max={720}
              className={`${field} tnum`}
              disabled={disabled}
              value={form.returnAfterHours ?? 12}
              onChange={(e) => set({ returnAfterHours: clampInt(e.target.value, 0, 720) })}
            />
          </label>
        </div>
      </Card>

      <Card>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">
          {t('settings.stock')}
        </h2>

        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            className="mt-1"
            disabled={disabled}
            checked={form.requireDepartment !== false}
            onChange={(e) => set({ requireDepartment: e.target.checked })}
          />
          <span className="block text-sm">{t('settings.requireDepartment')}</span>
        </label>
        <label className="mt-3 flex items-start gap-3">
          <input
            type="checkbox"
            className="mt-1"
            disabled={disabled}
            checked={form.hideNewPlaces !== false}
            onChange={(e) => set({ hideNewPlaces: e.target.checked })}
          />
          <span className="block text-sm">{t('settings.hideNewPlaces')}</span>
        </label>
        {/* Signing out after a while without use, for everyone (owner, 2026-10-17). */}
        <label className="mt-3 flex items-center gap-3">
          <span className="min-w-0 flex-1 text-sm">{t('auth.idleLock')}</span>
          <select
            className="h-9 rounded-[var(--radius-app)] border border-line bg-surface px-2.5 text-sm"
            disabled={disabled}
            value={form.idleMinutes ?? 30}
            onChange={(e) => set({ idleMinutes: Number(e.target.value) })}
          >
            {[5, 10, 15, 30, 60, 120, 0].map((m) => (
              <option key={m} value={m}>
                {m === 0 ? t('auth.idleNever') : t('auth.idleMinutes').replace('{n}', String(m))}
              </option>
            ))}
          </select>
        </label>
      </Card>

      <NumberingCard disabled={disabled} />

      <Card>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">
          {t('apps.title')}
        </h2>
        <GetApps />
      </Card>

      {canBackup && <BackupsCard />}
    </div>
  );
}

function clampInt(v: string, min: number, max: number): number {
  const n = Math.floor(Number(v) || 0);
  return Math.max(min, Math.min(max, n));
}

/** Shrink a picture to at most `max` px a side, as PNG (or WebP when the PNG is too big). */
async function shrinkPicture(file: File, max = 512): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = url;
    });
    const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    canvas.getContext('2d')?.drawImage(img, 0, 0, canvas.width, canvas.height);
    const png = canvas.toDataURL('image/png');
    return png.length < 600_000 ? png : canvas.toDataURL('image/webp', 0.9);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * The company's own logo (owner, 2026-10-01): shown beside the Evolvix mark on the sign-in page,
 * the side bar and the phone header. Kept on the server; the picture is shrunk before sending.
 */
function CompanyLogoField({ disabled }: { disabled: boolean }) {
  const { t } = useT();
  const { upload, remove } = useCompanyLogo();
  const [bad, setBad] = useState(false);
  const busy = upload.isPending || remove.isPending;
  const error = bad ? t('error.bad_logo') : errorText(t, upload.error ?? remove.error);

  async function pick(file: File | undefined) {
    setBad(false);
    if (!file) return;
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) {
      setBad(true);
      return;
    }
    try {
      upload.mutate(await shrinkPicture(file));
    } catch {
      setBad(true);
    }
  }

  return (
    <div className="sm:col-span-2">
      <span className="mb-1 block text-xs text-muted">{t('settings.logo')}</span>
      <div className="flex flex-wrap items-center gap-3">
        <div className="grid h-16 w-16 place-items-center rounded-xl border border-dashed border-line bg-surface-2">
          <CompanyMark size={56} />
        </div>
        {!disabled && (
          <>
            <label
              className={`inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-[var(--radius-app)] border border-line bg-surface px-3 text-sm font-medium hover:bg-surface-2 ${busy ? 'pointer-events-none opacity-60' : ''}`}
            >
              {busy ? <Spinner size={14} /> : null}
              {t('settings.logoUpload')}
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="sr-only"
                onChange={(e) => {
                  void pick(e.target.files?.[0]);
                  e.target.value = '';
                }}
              />
            </label>
            <LogoRemove onRemove={() => remove.mutate()} busy={busy} />
          </>
        )}
        {error && <p className="w-full text-xs text-destructive">{error}</p>}
      </div>
    </div>
  );
}

function LogoRemove({ onRemove, busy }: { onRemove: () => void; busy: boolean }) {
  const { t } = useT();
  const { data } = useBranding();
  if (!data?.logoVersion) return null;
  return (
    <Button size="sm" variant="ghost" onClick={onRemove} disabled={busy}>
      {t('settings.logoRemove')}
    </Button>
  );
}

/**
 * Serial numbers (الرقم المسلسل, owner 2026-10-01): each kind of document may have its own prefix
 * (e.g. KM-, {YYYY} for the year), starting number and digits; empty = the default numbering.
 */
function NumberingCard({ disabled }: { disabled: boolean }) {
  const { t } = useT();
  const numbering = useNumbering();
  const save = useSaveNumbering();
  const [edits, setEdits] = useState<
    Record<string, { prefix: string; startAt: string; digits: string }>
  >({});
  const rows = numbering.data ?? [];
  if (rows.length === 0) return null;
  return (
    <Card>
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">
        {t('settings.numbering')}
      </h2>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs text-muted">
            <tr>
              <th className="py-1.5 text-start font-medium" />
              <th className="px-1.5 py-1.5 text-start font-medium">{t('settings.prefix')}</th>
              <th className="px-1.5 py-1.5 text-start font-medium">{t('settings.startAt')}</th>
              <th className="px-1.5 py-1.5 text-start font-medium">{t('settings.digits')}</th>
              <th className="px-1.5 py-1.5 text-start font-medium">{t('settings.nextNumber')}</th>
              <th />
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--c-line)]">
            {rows.map((n) => {
              const e = edits[n.type] ?? {
                prefix: n.prefix,
                startAt: String(n.startAt),
                digits: String(n.digits),
              };
              const changed =
                e.prefix !== n.prefix ||
                e.startAt !== String(n.startAt) ||
                e.digits !== String(n.digits);
              const set = (patch: Partial<typeof e>) =>
                setEdits((all) => ({ ...all, [n.type]: { ...e, ...patch } }));
              return (
                <tr key={n.type}>
                  <td className="whitespace-nowrap py-1.5 pe-2">{t(`doc.${n.type}`)}</td>
                  <td className="px-1.5 py-1.5">
                    <input
                      dir="ltr"
                      className={`${field} w-28`}
                      disabled={disabled}
                      placeholder={t('settings.builtIn')}
                      maxLength={20}
                      value={e.prefix}
                      onChange={(ev) => set({ prefix: ev.target.value })}
                    />
                  </td>
                  <td className="px-1.5 py-1.5">
                    <input
                      type="number"
                      min={1}
                      className={`${field} w-24 tnum`}
                      disabled={disabled || !e.prefix.trim()}
                      value={e.startAt}
                      onChange={(ev) => set({ startAt: ev.target.value })}
                    />
                  </td>
                  <td className="px-1.5 py-1.5">
                    <input
                      type="number"
                      min={1}
                      max={10}
                      className={`${field} w-16 tnum`}
                      disabled={disabled || !e.prefix.trim()}
                      value={e.digits}
                      onChange={(ev) => set({ digits: ev.target.value })}
                    />
                  </td>
                  <td className="whitespace-nowrap px-1.5 py-1.5 font-medium tnum" dir="ltr">
                    {n.next}
                  </td>
                  <td className="py-1.5">
                    {!disabled && changed && (
                      <Button
                        size="sm"
                        loading={save.isPending && save.variables?.type === n.type}
                        onClick={() =>
                          save.mutate(
                            {
                              type: n.type,
                              prefix: e.prefix.trim(),
                              startAt: Math.max(1, Math.floor(Number(e.startAt) || 1)),
                              digits: Math.min(10, Math.max(1, Math.floor(Number(e.digits) || 6))),
                            },
                            {
                              onSuccess: () =>
                                setEdits((all) => {
                                  const next = { ...all };
                                  delete next[n.type];
                                  return next;
                                }),
                            },
                          )
                        }
                      >
                        {t('settings.save')}
                      </Button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {save.error && <p className="mt-2 text-sm text-destructive">{errorText(t, save.error)}</p>}
    </Card>
  );
}
