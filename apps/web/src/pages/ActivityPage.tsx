import { useState, useRef } from 'react';
import { companyToday, en, formatDateTime, formatNumber, type TranslationKey } from '@skb/shared';
import { Badge, Button, Card, EmptyState, PageHeader, Spinner } from '../components/ui';
import { ReportActions } from '../components/ReportActions';
import { useT } from '../lib/i18n';
import { useReportTools } from '../lib/report';
import { useAuditFacets, useAuditLog, usePageSize, type AuditFilter } from '../lib/queries';
import { Pager } from '../components/Pager';

const small =
  'h-9 rounded-[var(--radius-app)] border border-line bg-surface px-2 text-sm outline-none focus:border-brand';

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
  const { data, isLoading, isFetching } = useAuditLog({ ...filter, pageSize: size });
  const facets = useAuditFacets();
  const report = useReportTools();
  const paper = useRef<HTMLUListElement>(null);
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

      <Card className="flex flex-wrap items-end gap-3 !p-3">
        <label className="block">
          <span className="mb-1 block text-xs text-muted">{t('audit.who')}</span>
          <select
            className={small}
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
        <label className="block">
          <span className="mb-1 block text-xs text-muted">{t('audit.record')}</span>
          <select
            className={small}
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
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-muted">{t('audit.what')}</span>
          <select
            className={small}
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
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-muted">{t('ledger.from')}</span>
          <input
            className={small}
            type="date"
            value={filter.from ?? ''}
            max={filter.to}
            onChange={(e) => set({ from: e.target.value || undefined })}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-muted">{t('ledger.to')}</span>
          <input
            className={small}
            type="date"
            value={filter.to ?? ''}
            min={filter.from}
            onChange={(e) => set({ to: e.target.value || undefined })}
          />
        </label>
        {(filter.actorId || filter.resource || filter.action || filter.from || filter.to) && (
          <Button variant="ghost" size="sm" onClick={() => setFilter({ page: 1 })}>
            {t('audit.clear')}
          </Button>
        )}
      </Card>

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
          <ul ref={paper} className="divide-y divide-line">
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
