'use client';

import { useEffect } from 'react';
import { useConnectionState } from '@/lib/ws/use-connection';
import { getKrakenClient } from '@/lib/kraken/index';
import { OrderBookProvider } from '@/components/OrderBookProvider';
import { OrderBook } from '@/components/orderbook/OrderBook';
import type { ConnectionState } from '@/lib/ws/types';

interface OrderBookShellProps {
  symbol: string;
}

function statusDisplay(connState: ConnectionState): { dotColor: string; label: string } {
  switch (connState.status) {
    case 'idle':
    case 'connecting':
      return { dotColor: 'text-amber-400', label: 'Connecting…' };
    case 'open':
      return { dotColor: 'text-green-400', label: 'Live' };
    case 'reconnecting':
      return { dotColor: 'text-amber-400', label: `Reconnecting (attempt ${connState.attempt})…` };
    case 'degraded':
      return { dotColor: 'text-red-400', label: 'Degraded — retrying' };
    case 'closed':
      return { dotColor: 'text-red-400', label: 'Disconnected' };
  }
}

export function OrderBookShell({ symbol }: OrderBookShellProps) {
  const connState = useConnectionState();

  useEffect(() => {
    getKrakenClient()?.connect();
  }, []);

  const { dotColor, label } = statusDisplay(connState);

  return (
    <div className="max-w-sm">
      <div className="flex items-center gap-2 mb-4 text-xs font-mono text-zinc-400">
        <span className={dotColor}>●</span>
        <span>{label}</span>
      </div>

      {connState.status === 'open' && (
        <OrderBookProvider symbol={symbol} depth={25}>
          <OrderBook symbol={symbol} depth={25} />
        </OrderBookProvider>
      )}

      {connState.status !== 'open' && (
        <div className="text-zinc-600 text-sm font-mono">Waiting for connection…</div>
      )}
    </div>
  );
}
