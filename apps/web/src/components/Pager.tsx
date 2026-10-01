import { Icon } from './Icon';
import { useT } from '../lib/i18n';
import { PAGE_SIZES } from '../lib/queries';

/**
 * Rows per page (kept per person) and arrows to the previous and next page (owner, 2026-10-01).
 * The arrows show only when there is more than one page.
 */
export function Pager({
  page,
  size,
  onPage,
  onSize,
  hasMore,
  pages,
}: {
  page: number;
  size: number;
  onPage: (page: number) => void;
  onSize: (size: number) => void;
  /** There is a page after this one (when the total isn't known). */
  hasMore?: boolean;
  /** The number of pages, when the total is known. */
  pages?: number;
}) {
  const { t } = useT();
  const next = pages != null ? page < pages : !!hasMore;
  const arrow =
    'grid h-8 w-8 place-items-center rounded-lg border border-line text-muted hover:text-fg disabled:opacity-30';
  return (
    <div className="flex items-center gap-2 text-xs text-muted">
      <label className="flex items-center gap-1.5">
        {t('list.perPage')}
        <select
          className="h-8 rounded-lg border border-line bg-surface px-1.5 text-xs outline-none focus:border-brand"
          value={size}
          onChange={(e) => onSize(Number(e.target.value))}
        >
          {PAGE_SIZES.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </label>
      {(page > 1 || next) && (
        <span className="flex items-center gap-1">
          <button
            type="button"
            className={arrow}
            disabled={page <= 1}
            aria-label={t('list.prevPage')}
            title={t('list.prevPage')}
            onClick={() => onPage(page - 1)}
          >
            <Icon name="chevronRight" size={16} className="rotate-180" />
          </button>
          <span className="min-w-[3ch] text-center tnum">
            {page}
            {pages != null ? ` / ${pages}` : ''}
          </span>
          <button
            type="button"
            className={arrow}
            disabled={!next}
            aria-label={t('list.nextPage')}
            title={t('list.nextPage')}
            onClick={() => onPage(page + 1)}
          >
            <Icon name="chevronRight" size={16} />
          </button>
        </span>
      )}
    </div>
  );
}
