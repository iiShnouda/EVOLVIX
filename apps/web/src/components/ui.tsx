import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Icon } from './Icon';

/* ------------------------------- Button --------------------------------- */

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
type ButtonSize = 'sm' | 'md' | 'lg';

const VARIANT: Record<ButtonVariant, string> = {
  primary: 'bg-brand text-brand-fg hover:opacity-90 shadow-sm',
  secondary: 'bg-surface text-fg border border-line hover:bg-surface-2',
  ghost: 'text-muted hover:bg-surface-2 hover:text-fg',
  danger: 'bg-destructive text-white hover:opacity-90',
};
const SIZE: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-sm gap-1.5',
  md: 'h-10 px-4 text-sm gap-2',
  lg: 'h-12 px-5 text-base gap-2',
};

export function Button({
  variant = 'primary',
  size = 'md',
  icon,
  children,
  className,
  loading,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: string;
  loading?: boolean;
}) {
  return (
    <button
      className={`inline-flex items-center justify-center rounded-[var(--radius-app)] font-medium transition-colors disabled:opacity-50 disabled:pointer-events-none ${VARIANT[variant]} ${SIZE[size]} ${className ?? ''}`}
      disabled={loading || props.disabled}
      {...props}
    >
      {loading ? <Spinner size={16} /> : icon ? <Icon name={icon} size={18} /> : null}
      {children}
    </button>
  );
}

/* -------------------------------- Card ---------------------------------- */

export function Card({
  children,
  className,
  padded = true,
}: {
  children: ReactNode;
  className?: string;
  padded?: boolean;
}) {
  return (
    <div
      className={`rounded-[var(--radius-app)] border border-line bg-surface shadow-[var(--shadow-card)] ${padded ? 'p-4 sm:p-5' : ''} ${className ?? ''}`}
    >
      {children}
    </div>
  );
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h2 className="text-sm font-semibold text-muted uppercase tracking-wide">{children}</h2>
      {action}
    </div>
  );
}

/* -------------------------------- Badge --------------------------------- */

export type Tone = 'neutral' | 'positive' | 'warning' | 'destructive' | 'info' | 'brand';

const TONE: Record<Tone, string> = {
  neutral: 'bg-surface-2 text-muted',
  positive: 'bg-positive-soft text-positive',
  warning: 'bg-warning-soft text-warning',
  destructive: 'bg-destructive-soft text-destructive',
  info: 'bg-info-soft text-info',
  brand: 'bg-brand-soft text-brand',
};

export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${TONE[tone]}`}
    >
      {children}
    </span>
  );
}

/* ------------------------------- Spinner -------------------------------- */

export function Spinner({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className="animate-spin" aria-hidden="true">
      <circle
        cx="12"
        cy="12"
        r="9"
        stroke="currentColor"
        strokeWidth="2.5"
        fill="none"
        opacity="0.2"
      />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        stroke="currentColor"
        strokeWidth="2.5"
        fill="none"
        strokeLinecap="round"
      />
    </svg>
  );
}

/* ----------------------------- EmptyState ------------------------------- */

export function EmptyState({
  title,
  hint,
  icon = 'search',
}: {
  title: string;
  hint?: string;
  icon?: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
      <div className="grid h-12 w-12 place-items-center rounded-full bg-surface-2 text-faint">
        <Icon name={icon} size={22} />
      </div>
      <p className="font-medium text-fg">{title}</p>
      {hint ? <p className="max-w-xs text-sm text-muted">{hint}</p> : null}
    </div>
  );
}

/* ----------------------------- PageHeader ------------------------------- */

export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold sm:text-2xl">{title}</h1>
        {subtitle ? <p className="mt-0.5 text-sm text-muted">{subtitle}</p> : null}
      </div>
      {action}
    </div>
  );
}
