'use client';

import { useEffect } from 'react';
import { useOrderBookStore } from '@/stores/orderbook-store';
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

  const spreadStr = useOrderBookStore((s) => {
    const sp = s.books.get(symbol)?.getSpread() ?? null;
    return sp !== null ? sp.toFixed(2) : null;
  });

  // Best bid price as a primitive string for the center price display.
  const bestBidStr = useOrderBookStore((s) => {
    const bid = s.books.get(symbol)?.getBids(1)[0] ?? null;
    return bid !== null ? bid.price.toFixed(2) : null;
  });

  return (
    <div className="order-book flex flex-col h-full">

      {/* Asks: depth-1 at top, index 0 (best ask) at bottom — closest to price */}
      <div className="order-book-side order-book-asks flex-1 flex flex-col justify-end">
        {Array.from({ length: depth }, (_, i) => depth - 1 - i).map((i) => (
          <BookRow key={i} symbol={symbol} side="ask" index={i} depth={depth} />
        ))}
      </div>

      {/* Center: current price + spread */}
      <div className="order-book-spread py-2 text-center border-t border-b border-zinc-700 my-1">
        <div className={`text-base font-mono font-semibold ${bestBidStr !== null ? 'text-green-400' : 'text-zinc-500'}`}>
          {bestBidStr !== null ? `$${bestBidStr}` : '—'}
        </div>
        <div className="text-zinc-500 text-xs font-mono">
          spread: {spreadStr ?? '—'}
        </div>
      </div>

      {/* Bids: index 0 (best bid) at top, depth-1 at bottom — closest to price */}
      <div className="order-book-side order-book-bids flex-1">
        {Array.from({ length: depth }, (_, i) => i).map((i) => (
          <BookRow key={i} symbol={symbol} side="bid" index={i} depth={depth} />
        ))}
      </div>

      <MarkRendered symbol={symbol} />
    </div>
  );
}
