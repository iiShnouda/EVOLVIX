import { useEffect, useState } from 'react';
import { COUNTRIES, CURRENCIES, findCountry, type CompanySettings } from '@skb/shared';
import { Button, Card, PageHeader, Spinner } from '../components/ui';
import { useT } from '../lib/i18n';
import { useAuth } from '../stores/auth';
import { useCompanySettings, useUpdateSettings } from '../lib/queries';
import { errorText } from '../lib/errors';
import { GetApps } from '../components/GetApps';
import { BackupsCard } from '../components/BackupsCard';

const field =
  'h-9 w-full rounded-[var(--radius-app)] border border-line bg-surface px-2.5 text-sm outline-none focus:border-brand';

export function SettingsPage() {
  const { t, locale } = useT();
  const permissions = useAuth((s) => s.user?.permissions ?? []);
  const canManage = permissions.includes('settings:manage');
  const canBackup = permissions.includes('backup:create');
  const query = useCompanySettings();
  const update = useUpdateSettings();

  const [form, setForm] = useState<CompanySettings | null>(null);
  const [saved, setSaved] = useState(false);

  // Load server settings into the editable form once.
  useEffect(() => {
    if (query.data && !form) setForm(query.data);
  }, [query.data, form]);

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
  };

  // Picking a country suggests its currency + typical VAT (owner can still override).
  const onCountry = (code: string) => {
    const c = findCountry(code);
    set(c ? { country: code, currency: c.currency, defaultTaxPercent: c.vat } : { country: code });
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
      transfersRequireReceipt: form.transfersRequireReceipt,
      address: form.address ?? '',
      phone: form.phone ?? '',
      email: form.email ?? '',
      taxNumber: form.taxNumber ?? '',
      commercialRegister: form.commercialRegister ?? '',
    });
    setSaved(true);
  }

  const disabled = !canManage;

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <PageHeader title={t('settings.title')} />

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
          <p className="text-xs text-faint sm:col-span-2">{t('settings.profileHint')}</p>
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
            <span className="mt-0.5 block text-xs text-faint">{t('settings.vatHint')}</span>
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
            <span className="mt-0.5 block text-xs text-faint">{t('settings.minMarkupHint')}</span>
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
            checked={form.transfersRequireReceipt}
            onChange={(e) => set({ transfersRequireReceipt: e.target.checked })}
          />
          <span>
            <span className="block text-sm">{t('settings.transfersRequireReceipt')}</span>
            <span className="block text-xs text-faint">
              {t('settings.transfersRequireReceiptHint')}
            </span>
          </span>
        </label>
      </Card>

      <Card>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">
          {t('apps.title')}
        </h2>
        <GetApps />
      </Card>

      {canManage && (
        <div className="flex items-center gap-3">
          <Button icon="check" loading={update.isPending} onClick={save}>
            {update.isPending ? t('settings.saving') : t('settings.save')}
          </Button>
          {saved && <span className="text-sm text-positive">{t('settings.saved')}</span>}
          {update.error && (
            <span className="text-sm text-destructive">{errorText(t, update.error)}</span>
          )}
        </div>
      )}

      {canBackup && <BackupsCard />}
    </div>
  );
}

function clampInt(v: string, min: number, max: number): number {
  const n = Math.floor(Number(v) || 0);
  return Math.max(min, Math.min(max, n));
}
