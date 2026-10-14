import { useRef, useState } from 'react';
import type { ImportResult } from '@skb/shared';
import { Button, Card, PageHeader } from '../components/ui';
import { Icon } from '../components/Icon';
import { useT } from '../lib/i18n';
import { useImportData } from '../lib/queries';
import { buildImportWorkbook } from '../lib/importTemplate';
import { saveFile, safeName, XLSX_MIME } from '../lib/print';
import { errorText } from '../lib/errors';

/**
 * Load items, customers and suppliers from an Excel file the owner uploads (owner, 2026-10-14). The
 * file is built here (empty template or filled with sample data); the server only reads an upload and
 * keeps nothing of it. After importing, it shows what was added, skipped or couldn't be read.
 */
export function ImportPage() {
  const { t } = useT();
  const importData = useImportData();
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const picker = useRef<HTMLInputElement>(null);

  const download = (demo: boolean) => {
    const bytes = buildImportWorkbook(t, demo);
    saveFile(`${safeName(t(demo ? 'import.demo' : 'import.template'))}.xlsx`, XLSX_MIME, bytes);
  };

  const run = async () => {
    if (!file) return;
    setError(null);
    setResult(null);
    try {
      setResult(await importData.mutateAsync(file));
    } catch (e) {
      setError(errorText(t, e));
    }
  };

  const reset = () => {
    setFile(null);
    setResult(null);
    setError(null);
    if (picker.current) picker.current.value = '';
  };

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <PageHeader title={t('nav.import')} subtitle={t('import.intro')} />

      <Card className="flex flex-wrap gap-2">
        <Button variant="secondary" icon="download" onClick={() => download(false)}>
          {t('import.template')}
        </Button>
        <Button variant="ghost" icon="download" onClick={() => download(true)}>
          {t('import.demo')}
        </Button>
      </Card>

      {!result ? (
        <Card className="space-y-3">
          <input
            ref={picker}
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="hidden"
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              setError(null);
            }}
          />
          <button
            type="button"
            onClick={() => picker.current?.click()}
            className="flex w-full items-center gap-3 rounded-[var(--radius-app)] border border-dashed border-line px-4 py-6 text-start transition-colors hover:bg-surface-2"
          >
            <Icon name="upload" size={24} className="shrink-0 text-brand" />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium">{t('import.pick')}</span>
              {file && (
                <span className="mt-0.5 block truncate text-xs text-muted" dir="auto">
                  {t('import.selected')}: {file.name}
                </span>
              )}
            </span>
          </button>
          <Button
            icon="upload"
            disabled={!file || importData.isPending}
            loading={importData.isPending}
            onClick={() => void run()}
            className="w-full"
          >
            {importData.isPending ? t('import.importing') : t('import.upload')}
          </Button>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </Card>
      ) : (
        <ResultView result={result} onAgain={reset} />
      )}
    </div>
  );
}

function ResultView({ result, onAgain }: { result: ImportResult; onAgain: () => void }) {
  const { t } = useT();
  const totalAdded = result.groups.reduce((n, g) => n + g.added, 0);
  return (
    <Card className="space-y-4">
      <div className="flex items-center gap-2">
        <span className="grid h-9 w-9 place-items-center rounded-full bg-positive-soft text-positive">
          <Icon name="check" size={20} />
        </span>
        <div>
          <p className="font-semibold">{t('import.result')}</p>
          {totalAdded === 0 && <p className="text-sm text-muted">{t('import.noneAdded')}</p>}
        </div>
      </div>

      <div className="space-y-3">
        {result.groups.map((g) => (
          <div key={g.kind} className="rounded-[var(--radius-app)] border border-line p-3">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <span className="font-medium">{t(`import.kind.${g.kind}` as 'import.kind.items')}</span>
              <span className="text-sm text-positive">
                {t('import.added')}: <bdi className="font-semibold tnum">{g.added}</bdi>
              </span>
              {g.skipped > 0 && (
                <span className="text-sm text-muted">
                  {t('import.skipped')}: <bdi className="font-semibold tnum">{g.skipped}</bdi>
                </span>
              )}
            </div>
            {g.issues.length > 0 && (
              <div className="mt-2 space-y-1 border-t border-line pt-2">
                <p className="text-xs font-semibold text-warning">
                  {t('import.issues')} ({g.issues.length})
                </p>
                <ul className="space-y-1 text-xs text-muted">
                  {g.issues.slice(0, 50).map((is, i) => (
                    <li key={i} dir="auto">
                      {t('import.rowLabel').replace('{n}', String(is.row))}: {is.message}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ))}
      </div>

      {result.unknownSheets.length > 0 && (
        <p className="text-xs text-muted">
          {t('import.unknownSheets').replace('{x}', result.unknownSheets.join('، '))}
        </p>
      )}

      <Button variant="secondary" icon="upload" onClick={onAgain} className="w-full">
        {t('import.again')}
      </Button>
    </Card>
  );
}
