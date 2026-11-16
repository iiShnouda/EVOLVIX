import { parseDepartmentSeason, type DepartmentSeason } from '@skb/shared';
import { useT } from '../lib/i18n';

/**
 * The season of the departments shown (owner, 2026-11-16): all, summer or winter. A department's
 * season is read from its name; departments with no season word go with both.
 */
export function DeptSeasonSelect({
  value,
  onChange,
  className,
}: {
  value?: DepartmentSeason;
  onChange: (season: DepartmentSeason | undefined) => void;
  className?: string;
}) {
  const { t } = useT();
  return (
    <select
      aria-label={t('dash.deptSeason')}
      className={className}
      value={value ?? ''}
      onChange={(e) => onChange(parseDepartmentSeason(e.target.value))}
    >
      <option value="">{t('dash.allSeasons')}</option>
      <option value="SUMMER">{t('dash.summer')}</option>
      <option value="WINTER">{t('dash.winter')}</option>
    </select>
  );
}
