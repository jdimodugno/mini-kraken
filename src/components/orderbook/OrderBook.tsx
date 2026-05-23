'use client';

import { useEffect } from 'react';
import { useOrderBookStore } from '@/stores/orderbook-store';
import { useOrderBookSyncStatus } from '@/components/OrderBookProvider';
import { markUpdateRendered } from '@/lib/perf/marks';
import { BookRow } from './BookRow';

interface OrderBookProps {
  symbol: string;
  depth?: number;
}

function MarkRendered({ symbol }: { symbol: string }) {
  useEffect(() => {
    markUpdateRendered(symbol);
  });
  return null;
}

export function OrderBook({ symbol, depth = 25 }: OrderBookProps) {
  // Re-render only when this symbol's book updates — not on every store change.
  const _lastUpdateAt = useOrderBookStore((s) => s.lastUpdateAt.get(symbol) ?? 0);

  // useOrderBookSyncStatus reads from OrderBookStatusContext, already scoped to this symbol
  // by the enclosing OrderBookProvider.
  const syncStatus = useOrderBookSyncStatus();

  // Primitive selector: returns the already-formatted string so no object leaves the selector.
  // useSyncExternalStore's server snapshot returns null, matching the empty-store server render.
  const spreadStr = useOrderBookStore((s) => {
    const sp = s.books.get(symbol)?.getSpread() ?? null;
    return sp !== null ? sp.toFixed(2) : null;
  });

  return (
    <div className="order-book">
      {syncStatus !== 'ok' && (
        <div className="order-book-syncing">syncing…</div>
      )}

      <div className="order-book-spread">
        Spread: {spreadStr ?? '—'}
      </div>

      {/* Asks rendered in reverse so best ask (index 0) is closest to the spread */}
      <div className="order-book-side order-book-asks">
        {Array.from({ length: depth }, (_, i) => depth - 1 - i).map((i) => (
          <BookRow key={i} symbol={symbol} side="ask" index={i} depth={depth} />
        ))}
      </div>

      <div className="order-book-side order-book-bids">
        {Array.from({ length: depth }, (_, i) => i).map((i) => (
          <BookRow key={i} symbol={symbol} side="bid" index={i} depth={depth} />
        ))}
      </div>

      <MarkRendered symbol={symbol} />
    </div>
  );
}
