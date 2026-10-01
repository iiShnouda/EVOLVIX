import { API_BASE } from '../lib/api';
import { useBranding } from '../lib/queries';

/** The company logo's address for a version (0 = none). */
export function companyLogoUrl(version: number): string | null {
  return version > 0 ? `${API_BASE}/branding/logo?v=${version}` : null;
}

/**
 * The company's own mark (owner, 2026-10-01): its uploaded logo, or its initials when it has none.
 * Shown beside the Evolvix mark, which never changes.
 */
export function CompanyMark({
  size = 32,
  className,
  logoOnly,
}: {
  size?: number;
  className?: string;
  /** Show nothing (rather than initials) when there is no logo, e.g. on a printed invoice. */
  logoOnly?: boolean;
}) {
  const { data } = useBranding();
  if (!data) return null;
  const url = companyLogoUrl(data.logoVersion);
  const box = { width: size, height: size };
  if (url)
    return (
      <img
        src={url}
        alt=""
        style={box}
        className={`shrink-0 rounded-lg bg-white object-contain ${className ?? ''}`}
      />
    );
  if (logoOnly) return null;
  const initials = data.companyName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => [...w][0])
    .join('')
    .toUpperCase();
  if (!initials) return null;
  return (
    <span
      style={{ ...box, fontSize: size * 0.38 }}
      className={`grid shrink-0 place-items-center rounded-lg bg-brand-soft font-bold text-brand ${className ?? ''}`}
    >
      {initials}
    </span>
  );
}

/** The company's name, or nothing while it loads. */
export function CompanyName({ className }: { className?: string }) {
  const { data } = useBranding();
  if (!data?.companyName) return null;
  return <span className={className}>{data.companyName}</span>;
}
