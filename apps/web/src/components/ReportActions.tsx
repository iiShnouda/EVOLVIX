import { ALL_PERMISSIONS, type Permission } from '@skb/shared';
import { Button } from './ui';
import { useT } from '../lib/i18n';
import { useCan } from '../lib/can';

/** The page a report is on: its `<scope>:print` and `<scope>:export` permissions, where it has them. */
export type ReportScope =
  | 'reports'
  | 'ledger'
  | 'money'
  | 'inventory'
  | 'statement'
  | 'audit'
  | 'payroll'
  | 'parties'
  | 'transfers';

/** A scope's permission for printing or Excel; none when that page has no such permission. */
function permissionOf(scope: ReportScope | undefined, what: 'print' | 'export'): Permission | null {
  const p = `${scope}:${what}` as Permission;
  return scope && ALL_PERMISSIONS.includes(p) ? p : null;
}

/**
 * "Print / PDF" and "Excel" buttons for a report, each shown to whoever may use it (owner,
 * 2026-10-23: printing and Excel are permissions of their own on each page). They never print themselves.
 */
export function ReportActions({
  onPrint,
  onExcel,
  disabled,
  scope,
}: {
  onPrint?: () => void;
  onExcel?: () => void;
  disabled?: boolean;
  scope?: ReportScope;
}) {
  const { t } = useT();
  const can = useCan();
  const printAs = permissionOf(scope, 'print');
  const excelAs = permissionOf(scope, 'export');
  const print = onPrint && (!printAs || can(printAs));
  const excel = onExcel && (!excelAs || can(excelAs));
  if (!print && !excel) return null;
  return (
    <div data-noprint className="flex shrink-0 items-center gap-1 print:hidden">
      {print && (
        <Button
          size="sm"
          variant="secondary"
          icon="print"
          disabled={disabled}
          onClick={onPrint}
          title={t('common.printPdf')}
          aria-label={t('common.printPdf')}
        >
          <span className="hidden sm:inline">{t('common.print')}</span>
        </Button>
      )}
      {excel && (
        <Button
          size="sm"
          variant="secondary"
          icon="download"
          disabled={disabled}
          onClick={onExcel}
          title={t('common.excelHint')}
        >
          {t('common.excel')}
        </Button>
      )}
    </div>
  );
}
