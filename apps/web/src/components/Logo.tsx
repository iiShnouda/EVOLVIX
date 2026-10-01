import { useId } from 'react';
import { useT } from '../lib/i18n';

/**
 * The Evolvix mark (owner, 2026-10-01): two strands crossing into an X, like a helix — the white
 * one is where a business is, the green one rises to where it grows; the spark marks the next step.
 * Same drawing as public/icon.svg (the app icon); ids are per instance so several can share a page.
 */
export function Logo({ size = 36, className }: { size?: number; className?: string }) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  return (
    <svg
      viewBox="0 0 512 512"
      width={size}
      height={size}
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id={`${id}bg`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#7263ff" />
          <stop offset=".55" stopColor="#4f46e5" />
          <stop offset="1" stopColor="#3423b5" />
        </linearGradient>
        <linearGradient
          id={`${id}up`}
          x1="136"
          y1="386"
          x2="376"
          y2="126"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0" stopColor="#0ea371" />
          <stop offset=".55" stopColor="#34d399" />
          <stop offset="1" stopColor="#b4f8d8" />
        </linearGradient>
        <radialGradient id={`${id}glow`} cx=".8" cy=".18" r=".55">
          <stop offset="0" stopColor="#fff" stopOpacity=".2" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="512" height="512" rx="116" fill={`url(#${id}bg)`} />
      <rect width="512" height="512" rx="116" fill={`url(#${id}glow)`} />
      <path
        d="M136 126C178.2 144.4 203.7 166.4 221.3 189.9M290.7 322.1C308.3 345.6 333.8 367.6 376 386"
        fill="none"
        stroke="#fff"
        strokeWidth="54"
        strokeLinecap="round"
      />
      <path
        d="M136 386C296 316 216 196 376 126"
        fill="none"
        stroke={`url(#${id}up)`}
        strokeWidth="54"
        strokeLinecap="round"
      />
      <path d="M428 60q3 22 25 25q-22 3-25 25q-3-22-25-25q22-3 25-25Z" fill="#d1fae5" />
    </svg>
  );
}

/** The name as a wordmark, its last letter (the "x") in the rising green unless `plain`. */
export function Wordmark({ className, plain }: { className?: string; plain?: boolean }) {
  const { t } = useT();
  const name = t('app.name');
  return (
    <span dir="ltr" className={`font-bold tracking-tight ${className ?? ''}`}>
      {name.slice(0, -1)}
      <span className={plain ? undefined : 'text-[#10b981]'}>{name.slice(-1)}</span>
    </span>
  );
}
