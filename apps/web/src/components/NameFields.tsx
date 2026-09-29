import { useT } from '../lib/i18n';

const field =
  'h-9 w-full rounded-[var(--radius-app)] border border-line bg-surface px-2.5 text-sm outline-none focus:border-brand';

/** A name as typed (owner decision 2026-09-29: one name, Arabic or English, never translated). */
export type NameValues = string;

export const namesFrom = (name?: string | null): NameValues => name ?? '';

/** The name to send: the trimmed name when it was typed or changed; nothing otherwise. */
export function changedNames(value: NameValues, before?: string | null): { name?: string } {
  const v = value.trim();
  return v && v !== (before ?? '') ? { name: v } : {};
}

/**
 * The name of something people name (a branch, warehouse, category, unit, item…): one field. It is
 * kept exactly as typed, in Arabic or English, and shown the same in both screen languages.
 */
export function NameFields({
  values,
  onChange,
  label,
  placeholder,
  autoFocus,
}: {
  values: NameValues;
  onChange: (next: NameValues) => void;
  label?: string;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const { t } = useT();
  return (
    <label className="block">
      <span className="mb-0.5 block text-xs text-muted">{label ?? t('common.name')}</span>
      <input
        className={field}
        dir="auto"
        autoFocus={autoFocus}
        placeholder={placeholder}
        value={values}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}
