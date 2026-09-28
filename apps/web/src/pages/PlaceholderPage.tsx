import type { TranslationKey } from '@skb/shared';
import { Card, PageHeader } from '../components/ui';
import { Icon } from '../components/Icon';
import { useT } from '../lib/i18n';

/**
 * Coming-soon surface for modules whose backend/UI arrive in later phases. It is honest:
 * it does not fake data. The navigation, routing, and shell already treat it as first-class.
 */
export function PlaceholderPage({ titleKey, icon }: { titleKey: TranslationKey; icon: string }) {
  const { t } = useT();
  return (
    <div>
      <PageHeader title={t(titleKey)} />
      <Card>
        <div className="flex flex-col items-center gap-3 py-12 text-center">
          <div className="grid h-14 w-14 place-items-center rounded-2xl bg-brand-soft text-brand">
            <Icon name={icon} size={26} />
          </div>
          <p className="font-medium">{t(titleKey)}</p>
          <p className="max-w-sm text-sm text-muted">
            This module is part of the planned build and will connect to the same secure server and
            data model. The foundation (auth, security, roles, layout) already supports it.
          </p>
        </div>
      </Card>
    </div>
  );
}
