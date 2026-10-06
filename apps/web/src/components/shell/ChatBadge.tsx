import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useCan } from '../../lib/can';
import { onChat } from '../../lib/presence';
import { useChatStatus } from '../../lib/queries';

/** Unread chat messages beside the menu's "Chat" (owner, 2026-10-06), kept fresh over the live link. */
export function ChatBadge({ className = '' }: { className?: string }) {
  const can = useCan();
  const qc = useQueryClient();
  const on = can('chat:use');
  const status = useChatStatus(on);
  useEffect(() => onChat(() => void qc.invalidateQueries({ queryKey: ['chat', 'status'] })), [qc]);
  const n = status.data?.unread ?? 0;
  if (!on || n === 0) return null;
  return (
    <span
      className={`grid min-w-5 place-items-center rounded-full bg-destructive px-1.5 text-[11px] font-bold leading-5 text-white tnum ${className}`}
    >
      {n > 99 ? '99+' : n}
    </span>
  );
}
