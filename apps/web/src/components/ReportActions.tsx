import { useState } from 'react';
import { ALL_PERMISSIONS, type Permission } from '@skb/shared';
import { Button } from './ui';
import { useT } from '../lib/i18n';
import { useCan } from '../lib/can';
import { errorText } from '../lib/errors';
import { askOutput, asOutput, type OutputKind, type OutputPage } from '../lib/print';

/** The page a report is on: its `<scope>:print`, `<scope>:pdf` and `<scope>:export` (Excel) permissions. */
export type ReportScope = Exclude<OutputPage, 'sales' | 'purchases' | 'labels'>;

/** A scope's permission for printing, PDF or Excel; none when that page has no such permission. */
function permissionOf(scope: ReportScope, kind: OutputKind): Permission | null {
  const p = `${scope}:${kind === 'excel' ? 'export' : kind}` as Permission;
  return ALL_PERMISSIONS.includes(p) ? p : null;
}

/**
 * "Print", "PDF" and "Excel" buttons for a report, each shown to whoever may use it (owner,
 * 2026-10-23, and 2026-11-12: each kind of output is a permission of its own on each page). The
 * server is asked before anything comes out (and notes it); they never print themselves.
 */
export function ReportActions({
  onPrint,
  onExcel,
  disabled,
  scope,
  title,
}: {
  /** Opens the print editor (report.print); the PDF button opens it too, to save as PDF. */
  onPrint?: () => void;
  onExcel?: () => void;
  disabled?: boolean;
  scope: ReportScope;
  /** What it is, for the activity log. */
  title?: string;
}) {
  const { t } = useT();
  const can = useCan();
  const [refused, setRefused] = useState<unknown>(null);
  const may = (kind: OutputKind) => {
    const p = permissionOf(scope, kind);
    return !!p && can(p);
  };
  const print = onPrint && may('print');
  const pdf = onPrint && may('pdf');
  const excel = onExcel && may('excel');
  if (!print && !pdf && !excel) return null;
  const open = (kind: 'print' | 'pdf') => asOutput({ page: scope, kind }, () => onPrint?.());
  const saveExcel = async () => {
    setRefused(null);
    try {
      await askOutput({ page: scope, kind: 'excel' }, title ?? scope);
      onExcel?.();
    } catch (e) {
      setRefused(e);
    }
  };
  return (
    <div data-noprint className="flex shrink-0 flex-wrap items-center gap-1 print:hidden">
      {print && (
        <Button
          size="sm"
          variant="secondary"
          icon="print"
          disabled={disabled}
          onClick={() => open('print')}
          title={t('common.print')}
          aria-label={t('common.print')}
        >
          <span className="hidden sm:inline">{t('common.print')}</span>
        </Button>
      )}
      {pdf && (
        <Button
          size="sm"
          variant="secondary"
          icon="download"
          disabled={disabled}
          onClick={() => open('pdf')}
          title={t('common.pdfHint')}
        >
          {t('common.pdf')}
        </Button>
      )}
      {excel && (
        <Button
          size="sm"
          variant="secondary"
          icon="download"
          disabled={disabled}
          onClick={() => void saveExcel()}
          title={t('common.excelHint')}
        >
          {t('common.excel')}
        </Button>
      )}
      {refused != null && <span className="text-xs text-destructive">{errorText(t, refused)}</span>}
    </div>
  );
}
