import { formatDateTime } from '@skb/shared';
import { useT } from './i18n';
import { useAuth } from '../stores/auth';
import { useBranding, useCompanySettings } from './queries';
import { companyLogoUrl } from '../components/CompanyBadge';
import { printElement, saveXlsx, safeName } from './print';
import type { Cell } from './xlsx';

export type { Cell } from './xlsx';

/**
 * Print and Excel export for a report or statement, with the company's letterhead (name,
 * address, phone, tax number from Settings) and who printed it when.
 */
export function useReportTools() {
  const { t, locale, rtl } = useT();
  const settings = useCompanySettings().data;
  const logo = companyLogoUrl(useBranding().data?.logoVersion ?? 0);
  const user = useAuth((s) => s.user);
  const company = settings?.companyName || t('app.name');
  // Each value keeps its own direction (a Latin address or number inside Arabic text).
  const iso = (v: string) => `\u2068${v}\u2069`;
  const details = [
    settings?.address && iso(settings.address),
    [settings?.phone, settings?.email]
      .filter(Boolean)
      .map((v) => iso(v!))
      .join(' · '),
    [
      settings?.taxNumber && `${t('settings.taxNumber')}: ${iso(settings.taxNumber)}`,
      settings?.commercialRegister &&
        `${t('settings.commercialRegister')}: ${iso(settings.commercialRegister)}`,
    ]
      .filter(Boolean)
      .join(' · '),
  ].filter((d): d is string => !!d);
  const fileTitle = (title: string, subtitle?: string) =>
    safeName(subtitle ? `${title} - ${subtitle}` : title);

  return {
    company,
    details,
    /** Print (or save as PDF) the element under the letterhead. */
    print(el: HTMLElement | null, title: string, subtitle?: string) {
      if (!el) return;
      printElement(el, fileTitle(title, subtitle), {
        company,
        logo,
        details,
        title,
        subtitle,
        footer: `${t('print.printedBy')} ${user?.fullName ?? ''} · ${formatDateTime(new Date().toISOString(), locale)}`,
      });
    },
    /** Save the table as an Excel file. Money cells are `{ money: minorUnits }`. */
    excel(
      title: string,
      subtitle: string | undefined,
      header: string[],
      rows: Cell[][],
      total?: Cell[],
    ) {
      saveXlsx(fileTitle(title, subtitle), {
        name: title,
        title: [company, subtitle ? `${title} — ${subtitle}` : title],
        header,
        rows,
        total,
        rtl,
      });
    },
  };
}
