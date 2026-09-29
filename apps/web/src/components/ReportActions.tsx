import { Button } from './ui';
import { useT } from '../lib/i18n';

/** "Print / PDF" and "Excel" buttons for a report. They never print themselves. */
export function ReportActions({
  onPrint,
  onExcel,
  disabled,
}: {
  onPrint?: () => void;
  onExcel?: () => void;
  disabled?: boolean;
}) {
  const { t } = useT();
  return (
    <div data-noprint className="flex shrink-0 items-center gap-1 print:hidden">
      {onPrint && (
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
      {onExcel && (
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
