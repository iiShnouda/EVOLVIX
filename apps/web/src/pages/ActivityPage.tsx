import { useState, useRef } from 'react';
import { Filter, FilterPanel, filterField, useSettled } from '../components/FilterPanel';
import { useAuth } from '../stores/auth';
import { companyToday, en, formatDateTime, formatNumber, type TranslationKey } from '@skb/shared';
import { Badge, Card, EmptyState, PageHeader, Spinner } from '../components/ui';
import { ReportActions } from '../components/ReportActions';
import { useT } from '../lib/i18n';
import { useReportTools } from '../lib/report';
import { useAuditFacets, useAuditLog, usePageSize, type AuditFilter } from '../lib/queries';
import { Pager } from '../components/Pager';
import { TableColumns } from '../components/TableColumns';
import { useDeviceInfo } from '../lib/device';

/** A code's label in the screen language, or the code itself made readable. */
function label(t: (k: TranslationKey) => string, prefix: string, code: string) {
  const key = `${prefix}.${code}`;
  return key in en ? t(key as TranslationKey) : code.replace(/[._]/g, ' ');
}

/**
 * The activity log (سجل النشاط): every change anyone made — who, what, when, from where. For
 * the owner (`audit:view`); read-only.
 */
export function ActivityPage() {
  const { t, locale } = useT();
  const [size, setSize] = usePageSize('audit', 50);
  const [filter, setFilter] = useState<AuditFilter>(() => ({
    page: 1,
    from: companyToday(),
    to: companyToday(),
  }));
  // Words typed apply once the person pauses.
  const [words, setWords] = useState('');
  const search = useSettled(words.trim());
  const [lastSearch, setLastSearch] = useState(search);
  if (lastSearch !== search) {
    setLastSearch(search);
    setFilter((f) => ({ ...f, page: 1 }));
  }
  const branches = useAuth((s) => s.user?.branches ?? []);
  const { data, isLoading, isFetching } = useAuditLog({
    ...filter,
    search: search || undefined,
    pageSize: size,
  });
  const detailed = [filter.resource, filter.action, filter.branchId, search].filter(Boolean).length;
  const facets = useAuditFacets();
  const report = useReportTools();
  const paper = useRef<HTMLDivElement>(null);
  const isPhone = useDeviceInfo().deviceClass === 'phone';
  const set = (patch: Partial<AuditFilter>) => setFilter((f) => ({ ...f, ...patch, page: 1 }));
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const what = (action: string, resource: string) =>
    `${label(t, 'audit.action', action)} · ${label(t, 'audit.resource', resource)}`;

  return (
    <div className="space-y-4">
      <PageHeader
        title={t('audit.title')}
        subtitle={t('audit.subtitle')}
        action={
          <ReportActions
            scope="audit"
            disabled={!data || data.items.length === 0}
            onPrint={() => report.print(paper.current, t('audit.title'))}
            onExcel={() =>
              data &&
              report.excel(
                t('audit.title'),
                `${formatNumber(filter.page, locale)} / ${formatNumber(pages, locale)}`,
                [
                  t('audit.when'),
                  t('audit.who'),
                  t('audit.what'),
                  t('audit.record'),
                  t('audit.branch'),
                  'IP',
                ],
                data.items.map((e) => [
                  formatDateTime(e.createdAt, locale),
                  e.actorName,
                  what(e.action, e.resource),
                  e.resourceId ?? '',
                  e.branchName ?? '',
                  e.ip ?? '',
                ]),
              )
            }
          />
        }
      />

      <FilterPanel
        id="audit"
        active={detailed}
        onClear={() => {
          setWords('');
          set({ resource: undefined, action: undefined, branchId: undefined });
        }}
        quick={
          <>
            <label className="block w-48 min-w-0">
              <span className="mb-0.5 block text-xs text-muted">{t('audit.who')}</span>
              <select
                className={filterField}
                value={filter.actorId ?? ''}
                onChange={(e) => set({ actorId: e.target.value || undefined })}
              >
                <option value="">{t('audit.everyone')}</option>
                {facets.data?.actors.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block w-36 min-w-0">
              <span className="mb-0.5 block text-xs text-muted">{t('ledger.from')}</span>
              <input
                className={`${filterField} tnum`}
                type="date"
                value={filter.from ?? ''}
                max={filter.to}
                onChange={(e) => set({ from: e.target.value || undefined })}
              />
            </label>
            <label className="block w-36 min-w-0">
              <span className="mb-0.5 block text-xs text-muted">{t('ledger.to')}</span>
              <input
                className={`${filterField} tnum`}
                type="date"
                value={filter.to ?? ''}
                min={filter.from}
                onChange={(e) => set({ to: e.target.value || undefined })}
              />
            </label>
          </>
        }
      >
        <Filter label={t('audit.record')}>
          <select
            className={filterField}
            value={filter.resource ?? ''}
            onChange={(e) => set({ resource: e.target.value || undefined })}
          >
            <option value="">{t('audit.all')}</option>
            {facets.data?.resources.map((r) => (
              <option key={r} value={r}>
                {label(t, 'audit.resource', r)}
              </option>
            ))}
          </select>
        </Filter>
        <Filter label={t('audit.what')}>
          <select
            className={filterField}
            value={filter.action ?? ''}
            onChange={(e) => set({ action: e.target.value || undefined })}
          >
            <option value="">{t('audit.all')}</option>
            {facets.data?.actions.map((a) => (
              <option key={a} value={a}>
                {label(t, 'audit.action', a)}
              </option>
            ))}
          </select>
        </Filter>
        {branches.length > 1 && (
          <Filter label={t('audit.branch')}>
            <select
              className={filterField}
              value={filter.branchId ?? ''}
              onChange={(e) => set({ branchId: e.target.value || undefined })}
            >
              <option value="">{t('audit.all')}</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </Filter>
        )}
        <Filter label={t('audit.search')} wide>
          <input
            type="search"
            className={filterField}
            value={words}
            onChange={(e) => setWords(e.target.value)}
          />
        </Filter>
      </FilterPanel>

      {isLoading || !data ? (
        <div className="grid place-items-center py-16 text-muted">
          <Spinner size={26} />
        </div>
      ) : data.items.length === 0 ? (
        <Card>
          <EmptyState title={t('audit.empty')} icon="audit" />
        </Card>
      ) : (
        <Card padded={false} className={`overflow-hidden ${isFetching ? 'opacity-70' : ''}`}>
          {!isPhone ? (
            // A table with its columns on a computer or tablet (owner, 2026-11-16).
            <TableColumns id="audit" className="pt-2">
              <div ref={paper} className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-surface-2 text-xs text-muted">
                    <tr>
                      <th className="p-2 text-start font-medium">{t('audit.when')}</th>
                      <th className="p-2 text-start font-medium">{t('audit.who')}</th>
                      <th className="p-2 text-start font-medium">{t('audit.what')}</th>
                      <th className="p-2 text-start font-medium">{t('audit.record')}</th>
                      <th className="p-2 text-start font-medium">{t('audit.details')}</th>
                      <th className="p-2 text-start font-medium">{t('audit.branch')}</th>
                      <th className="p-2 text-start font-medium">{t('audit.device')}</th>
                      <th className="p-2 text-start font-medium">IP</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--c-line)]">
                    {data.items.map((e) => (
                      <tr key={e.id} className="align-top">
                        <td className="whitespace-nowrap p-2 text-xs text-muted tnum">
                          {formatDateTime(e.createdAt, locale)}
                        </td>
                        <td className="whitespace-nowrap p-2 font-medium">
                          {e.actorName || t('audit.unknown')}
                        </td>
                        <td className="whitespace-nowrap p-2">
                          <Badge
                            tone={
                              e.action.includes('failed')
                                ? 'destructive'
                                : e.action === 'cancel' || e.action === 'reverse'
                                  ? 'warning'
                                  : 'neutral'
                            }
                          >
                            {label(t, 'audit.action', e.action)}
                          </Badge>
                        </td>
                        <td className="whitespace-nowrap p-2 text-muted">
                          {label(t, 'audit.resource', e.resource)}
                        </td>
                        <td className="min-w-64 break-words p-2">
                          <bdi>
                            {e.details ?? (e.resourceId ? `#${e.resourceId.slice(0, 8)}` : '')}
                          </bdi>
                        </td>
                        <td className="whitespace-nowrap p-2 text-xs text-muted">
                          {e.branchName ?? ''}
                        </td>
                        <td className="whitespace-nowrap p-2 text-xs text-muted">
                          {e.device ? t(`audit.device.${e.device}` as 'audit.device.web') : ''}
                        </td>
                        <td className="whitespace-nowrap p-2 text-xs text-muted tnum" dir="ltr">
                          {e.ip ?? ''}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </TableColumns>
          ) : (
            <div ref={paper}>
              <ul className="divide-y divide-line">
                {data.items.map((e) => (
                  <li
                    key={e.id}
                    className="flex flex-wrap items-start justify-between gap-2 px-4 py-2.5"
                  >
                    <div className="min-w-0">
                      <p className="text-sm">
                        <span className="font-medium">{e.actorName || t('audit.unknown')}</span>{' '}
                        <Badge
                          tone={
                            e.action.includes('failed')
                              ? 'destructive'
                              : e.action === 'cancel' || e.action === 'reverse'
                                ? 'warning'
                                : 'neutral'
                          }
                        >
                          {label(t, 'audit.action', e.action)}
                        </Badge>{' '}
                        <span className="text-muted">{label(t, 'audit.resource', e.resource)}</span>
                      </p>
                      {e.details && (
                        <p className="break-words text-sm text-fg">
                          <bdi>{e.details}</bdi>
                        </p>
                      )}
                      <p className="truncate text-xs text-faint">
                        {[
                          e.device && t(`audit.device.${e.device}` as 'audit.device.web'),
                          e.branchName,
                          e.ip,
                          !e.details && e.resourceId && `#${e.resourceId.slice(0, 8)}`,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </p>
                    </div>
                    <span className="shrink-0 text-xs text-muted tnum">
                      {formatDateTime(e.createdAt, locale)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      )}

      {data && data.total > data.pageSize && (
        <div className="flex justify-center">
          <Pager
            page={filter.page}
            size={size}
            pages={pages}
            onPage={(n) => setFilter((f) => ({ ...f, page: n }))}
            onSize={(n) => {
              setSize(n);
              setFilter((f) => ({ ...f, page: 1 }));
            }}
          />
        </div>
      )}
    </div>
  );
}
