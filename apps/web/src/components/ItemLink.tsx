import type { MouseEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { CodeName } from './CodeName';
import { useCan } from '../lib/can';

/**
 * An item's name with its code; tapping it opens its item card (owner, 2026-10-19: "tapping any
 * item shows its card"). Plain text for someone who may not see the stock.
 */
export function ItemLink({
  id,
  code,
  name,
  truncate,
  className,
}: {
  id?: string | null;
  code?: number | string | null;
  name: string;
  truncate?: boolean;
  className?: string;
}) {
  const can = useCan();
  const navigate = useNavigate();
  const label = <CodeName code={code} name={name} truncate={truncate} />;
  if (!id || !can('inventory:view')) return <span className={className}>{label}</span>;
  return (
    <button
      type="button"
      className={`max-w-full text-start hover:text-brand hover:underline ${className ?? ''}`}
      onClick={(e: MouseEvent) => {
        e.stopPropagation();
        navigate(`/inventory/items/${id}`);
      }}
    >
      {label}
    </button>
  );
}
