import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  formatDateTime,
  formatNumber,
  type BackupContents,
  type ImportDone,
  type ImportKind,
  type ImportKindInfo,
  type ImportPreview,
  type RestoreJob,
  type StagedBackup,
} from '@skb/shared';
import { Badge, Button, Card, PageHeader } from '../components/ui';
import { Icon } from '../components/Icon';
import { useT } from '../lib/i18n';
import { useCan, useCanAny } from '../lib/can';
import { api, ApiError, API_BASE } from '../lib/api';
import { errorText } from '../lib/errors';
import { saveFile } from '../lib/print';
import { useImportKinds, usePreviewImport, useRestoreOptions, useRunImport } from '../lib/queries';

const field =
  'h-9 w-full rounded-[var(--radius-app)] border border-line bg-surface px-2.5 text-sm outline-none focus:border-brand';

const sizeText = (bytes: number, locale: 'en' | 'ar') =>
  bytes >= 1024 * 1024
    ? `${formatNumber(Math.round((bytes / 1024 / 1024) * 10) / 10, locale)} MB`
    : `${formatNumber(Math.max(1, Math.round(bytes / 1024)), locale)} KB`;

/** A server code shown as the `error.<code>` text. */
const codeError = (code: string) => new ApiError(400, '', code);

/**
 * Bringing data in (owner, 2026-11-16: "from a PDF, an Excel file or the program's own backup"):
 * importing each kind of list from Excel (template, check, then all or nothing), restoring a backup,
 * and where a supplier's PDF invoice is read. The server checks everything and keeps no file.
 */
export function ImportPage() {
  const { t } = useT();
  const can = useCan();
  const canAny = useCanAny();
  const mayImport = canAny(
    'import:items',
    'import:customers',
    'import:suppliers',
    'import:opening_customers',
    'import:opening_suppliers',
    'import:opening_money',
    'import:opening_stock',
  );
  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <PageHeader title={t('nav.import')} subtitle={t('import.intro')} />
      {mayImport && <ExcelImport />}
      {can('backup:restore') && <RestoreBackup />}
      {can('ai:scan_purchase') && can('purchases:create') && (
        <Card className="flex flex-wrap items-center justify-between gap-3">
          <span className="flex items-center gap-2 font-medium">
            <Icon name="notes" size={20} className="text-brand" />
            {t('import.pdf')}
          </span>
          <Link to="/purchases/new">
            <Button variant="secondary" icon="camera">
              {t('import.pdf.open')}
            </Button>
          </Link>
        </Card>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ Excel

function ExcelImport() {
  const { t, locale } = useT();
  const kinds = useImportKinds(true);
  const preview = usePreviewImport();
  const run = useRunImport();
  const [kind, setKind] = useState<ImportKind | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [checked, setChecked] = useState<ImportPreview | null>(null);
  const [done, setDone] = useState<ImportDone | null>(null);
  const [error, setError] = useState<unknown>(null);
  const picker = useRef<HTMLInputElement>(null);
  const list = kinds.data ?? [];
  const info: ImportKindInfo | undefined = list.find((k) => k.kind === kind) ?? list[0];

  if (!info) return null;
  const header = (key: string | null) => {
    const col = info.columns.find((c) => c.key === key);
    return col ? (locale === 'ar' ? col.ar : col.en) : t('import.wholeFile');
  };

  const reset = (next?: ImportKind) => {
    if (next) setKind(next);
    setFile(null);
    setChecked(null);
    setDone(null);
    setError(null);
    if (picker.current) picker.current.value = '';
  };

  const template = async () => {
    setError(null);
    try {
      const f = await api.download(`/imports/${info.kind}/template?lang=${locale}`);
      saveFile(`${t(`import.kind.${info.kind}`)}.xlsx`, f.type, f.bytes);
    } catch (e) {
      setError(e);
    }
  };

  const check = async (picked: File) => {
    setError(null);
    setChecked(null);
    setDone(null);
    try {
      setChecked(await preview.mutateAsync({ kind: info.kind, file: picked }));
    } catch (e) {
      setError(e);
    }
  };

  const importNow = async () => {
    if (!file) return;
    setError(null);
    try {
      setDone(await run.mutateAsync({ kind: info.kind, file }));
      setChecked(null);
    } catch (e) {
      // Something changed meanwhile: the file's rows as they now stand.
      await check(file);
      setError(e);
    }
  };

  return (
    <Card className="space-y-4">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
        {t('import.excel')}
      </h2>
      <div className="flex flex-wrap gap-2">
        {list.map((k) => (
          <button
            key={k.kind}
            type="button"
            onClick={() => reset(k.kind)}
            aria-pressed={k.kind === info.kind}
            className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${
              k.kind === info.kind
                ? 'border-brand bg-brand text-brand-fg'
                : 'border-line hover:bg-surface-2'
            }`}
          >
            {t(`import.kind.${k.kind}`)}
          </button>
        ))}
      </div>

      <div>
        <p className="mb-1 text-xs font-medium text-muted">{t('import.columns')}</p>
        <div className="flex flex-wrap gap-1.5">
          {info.columns.map((c) => (
            <span
              key={c.key}
              className="rounded-[var(--radius-app)] border border-line px-2 py-0.5 text-xs"
            >
              {locale === 'ar' ? c.ar : c.en}
              {c.required && <span className="text-destructive"> *</span>}
            </span>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" icon="download" onClick={() => void template()}>
          {t('import.template')}
        </Button>
        <input
          ref={picker}
          type="file"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="hidden"
          onChange={(e) => {
            const picked = e.target.files?.[0] ?? null;
            setFile(picked);
            if (picked) void check(picked);
          }}
        />
        <Button
          icon="upload"
          loading={preview.isPending}
          onClick={() => {
            if (picker.current) picker.current.value = '';
            picker.current?.click();
          }}
        >
          {preview.isPending ? t('import.checking') : t('import.pick')}
        </Button>
      </div>
      {file && (
        <p className="truncate text-xs text-muted" dir="auto">
          {t('import.selected')}: {file.name}
        </p>
      )}
      <p className="text-xs text-muted">{t('import.allOrNothing')}</p>

      {done && (
        <div className="flex items-center gap-2 rounded-[var(--radius-app)] bg-positive-soft p-3 text-sm text-positive">
          <Icon name="check" size={18} />
          {t('import.done')
            .replace('{added}', formatNumber(done.added, locale))
            .replace('{skipped}', formatNumber(done.skipped, locale))}
        </div>
      )}
      {error != null && <p className="text-sm text-destructive">{errorText(t, error)}</p>}

      {checked && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label={t('import.rows')} value={checked.rows} />
            <Stat label={t('import.ready')} value={checked.ready} tone="positive" />
            <Stat label={t('import.skipped')} value={checked.skipped} />
            <Stat
              label={t('import.problems')}
              value={checked.errorCount}
              tone={checked.errorCount ? 'destructive' : undefined}
            />
          </div>

          {checked.errors.length > 0 && (
            <div className="space-y-1 rounded-[var(--radius-app)] border border-line p-3">
              <p className="text-xs font-semibold text-destructive">{t('import.fix')}</p>
              <ul className="max-h-64 space-y-1 overflow-auto text-sm">
                {checked.errors.map((e, i) => (
                  <li key={i}>
                    <bdi className="font-medium">
                      {e.row > 0
                        ? t('import.rowLabel').replace('{n}', formatNumber(e.row, locale))
                        : t('import.wholeFile')}
                    </bdi>
                    {e.column && <> · {header(e.column)}</>}:{' '}
                    {t(`import.err.${e.code}` as 'import.err.required').replace(
                      '{x}',
                      e.value ?? '',
                    )}
                    {e.value && e.code !== 'too_many_rows' && (
                      <bdi className="text-muted" dir="auto">
                        {' '}
                        ({e.value})
                      </bdi>
                    )}
                  </li>
                ))}
              </ul>
              {checked.errorCount > checked.errors.length && (
                <p className="text-xs text-muted">
                  {t('import.more').replace(
                    '{n}',
                    formatNumber(checked.errorCount - checked.errors.length, locale),
                  )}
                </p>
              )}
            </div>
          )}

          {checked.sample.length > 0 && (
            <div className="max-h-96 overflow-auto rounded-[var(--radius-app)] border border-line">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-surface-2 text-xs text-muted">
                  <tr>
                    <th className="px-2 py-1.5 text-start">#</th>
                    <th className="px-2 py-1.5 text-start" />
                    {info.columns.map((c) => (
                      <th key={c.key} className="whitespace-nowrap px-2 py-1.5 text-start">
                        {locale === 'ar' ? c.ar : c.en}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {checked.sample.map((r) => (
                    <tr key={r.row} className="border-t border-line">
                      <td className="px-2 py-1 tnum text-muted">{formatNumber(r.row, locale)}</td>
                      <td className="px-2 py-1">
                        <Badge
                          tone={
                            r.status === 'error'
                              ? 'destructive'
                              : r.status === 'skip'
                                ? 'neutral'
                                : 'positive'
                          }
                        >
                          {t(`import.status.${r.status}`)}
                        </Badge>
                      </td>
                      {r.values.map((v, i) => (
                        <td key={i} className="whitespace-nowrap px-2 py-1" dir="auto">
                          {v}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {checked.errorCount === 0 && checked.ready > 0 && (
            <Button
              icon="upload"
              className="w-full"
              loading={run.isPending}
              onClick={() => void importNow()}
            >
              {run.isPending
                ? t('import.importing')
                : t('import.run').replace('{n}', formatNumber(checked.ready, locale))}
            </Button>
          )}
        </div>
      )}
      {done && (
        <Button variant="secondary" icon="upload" onClick={() => reset()} className="w-full">
          {t('import.again')}
        </Button>
      )}
    </Card>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: 'positive' | 'destructive';
}) {
  const { locale } = useT();
  return (
    <div className="rounded-[var(--radius-app)] border border-line p-2">
      <p className="text-xs text-muted">{label}</p>
      <p
        className={`text-lg font-semibold tnum ${
          tone === 'positive' ? 'text-positive' : tone === 'destructive' ? 'text-destructive' : ''
        }`}
      >
        {formatNumber(value, locale)}
      </p>
    </div>
  );
}

// ------------------------------------------------------------------ restoring a backup

function RestoreBackup() {
  const { t, locale } = useT();
  const options = useRestoreOptions(true);
  const [staged, setStaged] = useState<StagedBackup | null>(null);
  const [pass, setPass] = useState('');
  const [contents, setContents] = useState<BackupContents | null>(null);
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [job, setJob] = useState<RestoreJob | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  const o = options.data;

  // How the restore goes: asked without the sign-in, since the restore signs everyone out.
  useEffect(() => {
    if (!jobId) return;
    let stop = false;
    void (async () => {
      while (!stop) {
        await new Promise((r) => setTimeout(r, 1500));
        try {
          const res = await fetch(`${API_BASE}/backups/restore/jobs/${jobId}`);
          if (res.ok) {
            const j = (await res.json()) as RestoreJob;
            setJob(j);
            if (j.state !== 'running') return;
          }
        } catch {
          // The server may be restarting: ask again.
        }
      }
    })();
    return () => {
      stop = true;
    };
  }, [jobId]);

  const step = async (key: string, work: () => Promise<void>) => {
    setBusy(key);
    setError(null);
    try {
      await work();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  };

  const clear = () => {
    if (staged) void api.del(`/backups/restore/${staged.id}`).catch(() => undefined);
    setStaged(null);
    setContents(null);
    setPass('');
    setConfirm('');
    setError(null);
    if (picker.current) picker.current.value = '';
  };

  const inspect = () =>
    step('inspect', async () => {
      if (!staged) return;
      setContents(
        await api.post<BackupContents>(`/backups/restore/${staged.id}/inspect`, {
          passphrase: pass || null,
        }),
      );
    });

  const restore = () =>
    step('restore', async () => {
      if (!staged) return;
      const r = await api.post<{ jobId: string }>(`/backups/restore/${staged.id}`, {
        passphrase: pass || null,
        confirm,
      });
      setPass('');
      setJob({
        state: 'running',
        step: 'checking',
        error: null,
        safetyBackup: null,
        keptDatabase: null,
        rows: 0,
        restarting: false,
      });
      setJobId(r.jobId);
    });

  if (job) {
    return (
      <Card className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
          {t('restore.title')}
        </h2>
        {job.state === 'running' && (
          <p className="flex items-center gap-2 text-sm">
            <Icon name="update" size={18} className="animate-spin text-brand" />
            {t(`restore.step.${job.step}`)}
          </p>
        )}
        {job.state === 'failed' && (
          <p className="text-sm text-destructive">
            {job.error ? errorText(t, codeError(job.error)) : t('restore.failed')}
          </p>
        )}
        {job.state === 'done' && (
          <div className="space-y-2 text-sm">
            <p className="flex items-center gap-2 font-medium text-positive">
              <Icon name="check" size={18} />
              {t('restore.done')}
            </p>
            {job.safetyBackup && (
              <p className="text-muted" dir="auto">
                {t('restore.safety').replace('{x}', job.safetyBackup)}
              </p>
            )}
            {job.keptDatabase && (
              <p className="text-muted" dir="auto">
                {t('restore.kept').replace('{x}', job.keptDatabase)}
              </p>
            )}
            <Button icon="logout" onClick={() => void api.logout()}>
              {t('restore.signIn')}
            </Button>
          </div>
        )}
      </Card>
    );
  }

  return (
    <Card className="space-y-4">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
        {t('restore.title')}
      </h2>
      {o?.unavailable ? (
        <p className="text-sm text-warning">{errorText(t, codeError(o.unavailable))}</p>
      ) : !staged ? (
        <div className="space-y-3">
          <input
            ref={picker}
            type="file"
            accept=".skbak,.zip,application/octet-stream,application/zip"
            className="hidden"
            onChange={(e) => {
              const picked = e.target.files?.[0];
              if (picked)
                void step('upload', async () =>
                  setStaged(
                    await api.upload<StagedBackup>(
                      '/backups/restore/upload',
                      picked,
                      false,
                      'POST',
                      picked.name,
                    ),
                  ),
                );
            }}
          />
          <Button icon="upload" loading={busy === 'upload'} onClick={() => picker.current?.click()}>
            {t('restore.upload')}
          </Button>
          {o && o.files.length > 0 && (
            <label className="block space-y-1 text-sm">
              <span className="text-xs text-muted">{t('restore.pickAuto')}</span>
              <select
                className={field}
                value=""
                disabled={busy != null}
                onChange={(e) => {
                  const name = e.target.value;
                  if (name)
                    void step('pick', async () =>
                      setStaged(await api.post<StagedBackup>('/backups/restore/pick', { name })),
                    );
                }}
              >
                <option value="">—</option>
                {o.files.map((f) => (
                  <option key={f.name} value={f.name}>
                    {formatDateTime(f.createdAt, locale)} · {sizeText(f.size, locale)}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span dir="auto">
              {t('restore.chosen')}: <bdi className="font-medium">{staged.name}</bdi> ·{' '}
              {sizeText(staged.size, locale)}
            </span>
            <Button variant="ghost" size="sm" onClick={clear}>
              {t('restore.other')}
            </Button>
          </div>
          {!contents && (
            <div className="flex flex-wrap items-end gap-2">
              {staged.encrypted && (
                <label className="min-w-[14rem] flex-1 space-y-1 text-sm">
                  <span className="text-xs text-muted">{t('restore.passphrase')}</span>
                  <input
                    type="password"
                    autoComplete="off"
                    className={field}
                    value={pass}
                    onChange={(e) => setPass(e.target.value)}
                  />
                </label>
              )}
              <Button
                variant="secondary"
                icon="search"
                loading={busy === 'inspect'}
                disabled={staged.encrypted && !pass}
                onClick={() => void inspect()}
              >
                {t('restore.show')}
              </Button>
            </div>
          )}
          {contents && (
            <div className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                {t('restore.contents')}
              </p>
              <div className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-3">
                <Info
                  label={t('restore.createdAt')}
                  value={formatDateTime(contents.createdAt, locale)}
                />
                <Info label={t('restore.version')} value={contents.migration} />
                <Info
                  label={t('restore.totalRows')}
                  value={formatNumber(contents.totalRows, locale)}
                />
              </div>
              <div className="max-h-64 overflow-auto rounded-[var(--radius-app)] border border-line">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-surface-2 text-xs text-muted">
                    <tr>
                      <th className="px-2 py-1.5 text-start">{t('restore.table')}</th>
                      <th className="px-2 py-1.5 text-end">{t('restore.rowsCol')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {contents.tables
                      .filter((x) => x.rows > 0)
                      .map((x) => (
                        <tr key={x.name} className="border-t border-line">
                          <td className="px-2 py-1" dir="ltr">
                            {x.name}
                          </td>
                          <td className="px-2 py-1 text-end tnum">
                            {formatNumber(x.rows, locale)}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
              <p className="rounded-[var(--radius-app)] bg-warning-soft p-3 text-sm text-warning">
                {t('restore.warning')}
              </p>
              <label className="block space-y-1 text-sm">
                <span className="text-xs text-muted">{t('restore.confirm')}</span>
                <input
                  className={field}
                  autoComplete="off"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                />
              </label>
              <Button
                variant="danger"
                icon="returns"
                className="w-full"
                loading={busy === 'restore'}
                disabled={!confirm.trim()}
                onClick={() => void restore()}
              >
                {t('restore.run')}
              </Button>
            </div>
          )}
        </div>
      )}
      {error != null && <p className="text-sm text-destructive">{errorText(t, error)}</p>}
    </Card>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[var(--radius-app)] border border-line p-2">
      <p className="text-xs text-muted">{label}</p>
      <p className="truncate font-medium" dir="auto">
        {value}
      </p>
    </div>
  );
}
