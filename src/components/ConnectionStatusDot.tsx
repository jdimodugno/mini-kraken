'use client';

import { useConnectionState } from '@/lib/ws/use-connection';
import { statusDisplay } from '@/components/OrderBookShell';

export function ConnectionStatusDot() {
  const connState = useConnectionState();
  const { dotColor, label } = statusDisplay(connState);

  return (
    <span className={`flex items-center gap-1.5 text-xs font-mono ${dotColor}`}>
      <span>●</span>
      <span className="text-zinc-400">{label}</span>
    </span>
  );
}
