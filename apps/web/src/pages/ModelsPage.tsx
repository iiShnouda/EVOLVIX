import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { formatNumber } from '@skb/shared';
import { Badge, Button, Card, EmptyState, PageHeader, Spinner } from '../components/ui';
import { Icon } from '../components/Icon';
import { useT } from '../lib/i18n';
import { useCan } from '../lib/can';
import { useModels } from '../lib/queries';

const field =
  'h-9 w-full rounded-[var(--radius-app)] border border-line bg-surface px-2.5 text-sm outline-none focus:border-brand';

/** Item models made in sizes × colors (الموديلات), with how many items each has and their stock. */
export function ModelsPage() {
  const { t, locale } = useT();
  const navigate = useNavigate();
  const can = useCan();
  const [search, setSearch] = useState('');
  const models = useModels(search.trim());

  return (
    <div className="space-y-5">
      <PageHeader
        title={t('model.title')}
        subtitle={t('model.subtitle')}
        action={
          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" size="sm" icon="close" onClick={() => navigate('/inventory')}>
              {t('itemCard.back')}
            </Button>
            {can('products:create') && (
              <Button size="sm" icon="plus" onClick={() => navigate('/inventory/models/new')}>
                {t('model.new')}
              </Button>
            )}
          </div>
        }
      />

      <Card padded={false} className="overflow-hidden">
        <div className="border-b border-line p-3">
          <div className="relative">
            <span className="pointer-events-none absolute inset-y-0 start-2.5 grid place-items-center text-faint">
              <Icon name="search" size={16} />
            </span>
            <input
              className={`${field} ps-8`}
              placeholder={t('model.search')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>
        {models.isLoading ? (
          <div className="grid place-items-center py-16 text-muted">
            <Spinner size={26} />
          </div>
        ) : (models.data ?? []).length === 0 ? (
          <EmptyState title={t('model.none')} icon="inventory" />
        ) : (
          <ul className="divide-y divide-[var(--c-line)]">
            {(models.data ?? []).map((m) => (
              <li key={m.id}>
                <button
                  onClick={() => navigate(`/inventory/models/${m.id}`)}
                  className={`flex w-full items-center gap-3 p-4 text-start hover:bg-surface-2 ${m.isActive ? '' : 'opacity-60'}`}
                >
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="truncate font-medium">{m.name}</span>
                      {!m.isActive && <Badge>{t('item.closed')}</Badge>}
                    </span>
                    <span className="text-xs text-muted tnum">
                      {m.code} · {m.categoryName}
                    </span>
                  </span>
                  <span className="text-end text-xs text-muted tnum">
                    <span className="block">
                      {t('model.items')}: {formatNumber(m.variants, locale)}
                    </span>
                    <span className="block font-semibold text-fg">
                      {t('item.stock')}: {formatNumber(m.stockOnHand, locale)}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
