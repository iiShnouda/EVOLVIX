import { useRef, useState, type ReactNode } from 'react';
import { formatDate, type LicenseStatus } from '@skb/shared';
import {
  Badge,
  Button,
  Card,
  PageHeader,
  SectionTitle,
  Spinner,
  type Tone,
} from '../components/ui';
import { useT } from '../lib/i18n';
import {
  useInstallLicense,
  useIssueLicense,
  useIssuedLicenses,
  useLicense,
  useVendorKey,
} from '../lib/queries';
import { errorText } from '../lib/errors';
import { confirm } from '../lib/confirm';

const field =
  'h-10 w-full rounded-[var(--radius-app)] border border-line bg-surface px-3 text-sm outline-none focus:border-brand';

export const LICENSE_TONE: Record<LicenseStatus['state'], Tone> = {
  none: 'neutral',
  valid: 'positive',
  ending: 'warning',
  grace: 'destructive',
  expired: 'destructive',
  invalid: 'destructive',
};

/**
 * The licence (owner, 2026-10-15: each buyer pays per user). Every company sees its install id (to
 * send to the vendor), what its licence allows and a box for the code it gets back. On the vendor's
 * own server, after loading the vendor key once, it also issues codes for customers.
 */
export function LicensePage() {
  const { t, locale } = useT();
  const license = useLicense();
  const install = useInstallLicense();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  if (license.isLoading) return <Spinner />;
  const s = license.data;
  if (!s) return <p className="text-sm text-destructive">{errorText(t, license.error)}</p>;

  const save = async () => {
    setError(null);
    setSaved(false);
    try {
      await install.mutateAsync(code);
      setCode('');
      setSaved(true);
    } catch (e) {
      setError(errorText(t, e));
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <PageHeader title={t('nav.license')} />

      <Card className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-base font-semibold">{s.customer ?? t('license.state.none')}</span>
          <Badge tone={LICENSE_TONE[s.state]}>{t(`license.state.${s.state}`)}</Badge>
        </div>
        <dl className="grid gap-2 text-sm sm:grid-cols-2">
          <Row label={t('license.users')}>
            {s.maxUsers === null
              ? `${s.activeUsers} · ${t('license.unlimited')}`
              : t('license.usersOf')
                  .replace('{active}', String(s.activeUsers))
                  .replace('{max}', String(s.maxUsers))}
          </Row>
          <Row label={t('license.ends')}>
            {s.expiresAt ? formatDate(s.expiresAt, locale) : t('license.noEnd')}
          </Row>
        </dl>
        <div>
          <p className="mb-1 text-xs text-muted">{t('license.installId')}</p>
          <CopyBox value={s.installId} />
        </div>
      </Card>

      <Card className="space-y-3">
        <SectionTitle>{t('license.code')}</SectionTitle>
        <textarea
          aria-label={t('license.code')}
          value={code}
          onChange={(e) => {
            setCode(e.target.value);
            setSaved(false);
          }}
          rows={3}
          dir="ltr"
          spellCheck={false}
          className="w-full rounded-[var(--radius-app)] border border-line bg-surface p-3 font-mono text-xs outline-none focus:border-brand"
        />
        {error && <p className="text-sm text-destructive">{error}</p>}
        {saved && <p className="text-sm text-positive">{t('license.saved')}</p>}
        <Button onClick={save} loading={install.isPending} disabled={!code.trim()}>
          {t('license.install')}
        </Button>
      </Card>

      <Vendor canIssue={s.canIssue} />
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex justify-between gap-2 rounded-[var(--radius-app)] bg-surface-2 px-3 py-2">
      <dt className="text-muted">{label}</dt>
      <dd className="font-medium tabular-nums">{children}</dd>
    </div>
  );
}

/** A value with a copy button; `compact` shows only the button (long licence codes in a list). */
function CopyBox({ value, compact = false }: { value: string; compact?: boolean }) {
  const { t } = useT();
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-2">
      {!compact && (
        <code
          dir="ltr"
          className="min-w-0 flex-1 select-all break-all rounded-[var(--radius-app)] border border-line bg-surface-2 px-3 py-2 text-xs"
        >
          {value}
        </code>
      )}
      <Button
        variant="secondary"
        size="sm"
        icon={copied ? 'check' : undefined}
        onClick={() => {
          void navigator.clipboard?.writeText(value).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          });
        }}
      >
        {t(copied ? 'license.copied' : 'license.copy')}
      </Button>
    </div>
  );
}

/** The vendor's part: load the key once, then issue codes and see the ones issued. */
function Vendor({ canIssue }: { canIssue: boolean }) {
  const { t } = useT();
  const key = useVendorKey();
  const picker = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    try {
      await key.mutateAsync(await file.text());
    } catch (e) {
      setError(errorText(t, e));
    }
    if (picker.current) picker.current.value = '';
  };

  if (!canIssue)
    return (
      <div className="flex flex-col items-start gap-1">
        <input
          ref={picker}
          type="file"
          accept=".pem,.key,.txt"
          className="hidden"
          onChange={(e) => void load(e.target.files?.[0])}
        />
        <Button
          variant="ghost"
          size="sm"
          icon="key"
          loading={key.isPending}
          onClick={() => picker.current?.click()}
        >
          {t('license.loadKey')}
        </Button>
        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>
    );

  return (
    <>
      <IssueForm />
      <IssuedList />
      <Button
        variant="dangerGhost"
        size="sm"
        onClick={async () => {
          if (await confirm({ message: t('license.removeKeyConfirm'), danger: true }))
            key.mutate(null);
        }}
      >
        {t('license.removeKey')}
      </Button>
    </>
  );
}

function IssueForm() {
  const { t } = useT();
  const issue = useIssueLicense();
  const [customer, setCustomer] = useState('');
  const [installId, setInstallId] = useState('');
  const [users, setUsers] = useState('5');
  const [end, setEnd] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    setCode(null);
    try {
      const row = await issue.mutateAsync({
        customer: customer.trim(),
        installId: installId.trim(),
        maxUsers: Number(users),
        expiresAt: end || null,
      });
      setCode(row.code);
    } catch (e) {
      setError(errorText(t, e));
    }
  };

  return (
    <Card className="space-y-3">
      <SectionTitle>{t('license.vendor')}</SectionTitle>
      <div className="grid gap-3 sm:grid-cols-2">
        <Label text={t('license.issueCustomer')}>
          <input className={field} value={customer} onChange={(e) => setCustomer(e.target.value)} />
        </Label>
        <Label text={t('license.issueUsers')}>
          <input
            className={field}
            type="number"
            min={0}
            inputMode="numeric"
            value={users}
            onChange={(e) => setUsers(e.target.value)}
          />
        </Label>
        <Label text={t('license.issueInstall')}>
          <input
            className={`${field} font-mono`}
            dir="ltr"
            value={installId}
            onChange={(e) => setInstallId(e.target.value)}
          />
        </Label>
        <Label text={t('license.issueEnd')}>
          <input
            className={field}
            type="date"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
          />
        </Label>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button
        onClick={submit}
        loading={issue.isPending}
        disabled={!customer.trim() || !installId.trim()}
      >
        {t('license.issue')}
      </Button>
      {code && <CopyBox value={code} />}
    </Card>
  );
}

function IssuedList() {
  const { t, locale } = useT();
  const issued = useIssuedLicenses(true);
  if (!issued.data?.length) return null;
  return (
    <Card className="space-y-2">
      <SectionTitle>{t('license.issued')}</SectionTitle>
      <ul className="divide-y divide-line">
        {issued.data.map((r) => (
          <li key={r.id} className="flex items-center justify-between gap-3 py-2.5">
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium">{r.customer}</span>
              <span className="block text-xs text-muted tabular-nums">
                {r.maxUsers === 0 ? t('license.unlimited') : r.maxUsers} ·{' '}
                {r.expiresAt ? formatDate(r.expiresAt, locale) : t('license.noEnd')}
              </span>
            </span>
            <CopyBox value={r.code} compact />
          </li>
        ))}
      </ul>
    </Card>
  );
}

function Label({ text, children }: { text: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-muted">{text}</span>
      {children}
    </label>
  );
}
