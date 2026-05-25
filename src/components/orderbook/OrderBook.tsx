'use client';

import { useEffect, useMemo } from 'react';
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

// Compute cumulative depth percentages for one side in O(N) once per update.
// Returns an array of primitive numbers indexed by row.
function computeDepthPcts(qtys: number[]): number[] {
  let running = 0;
  const cumulative = qtys.map((q) => {
    running += q;
    return running;
  });
  const total = running;
  return total > 0 ? cumulative.map((c) => c / total) : cumulative.map(() => 0);
}

export function OrderBook({ symbol, depth = 25 }: OrderBookProps) {
  // Re-render only when this symbol's book updates — not on every store change.
  // This primitive drives the useMemo below; other selectors that return primitives
  // also gate on this and won't trigger extra renders.
  const lastUpdateAt = useOrderBookStore((s) => s.lastUpdateAt.get(symbol) ?? 0);

  const spreadStr = useOrderBookStore((s) => {
    const sp = s.books.get(symbol)?.getSpread() ?? null;
    return sp !== null ? sp.toFixed(2) : null;
  });

  // Best bid price as a primitive string for the center price display.
  const bestBidStr = useOrderBookStore((s) => {
    const bid = s.books.get(symbol)?.getBids(1)[0] ?? null;
    return bid !== null ? bid.price.toFixed(2) : null;
  });

  // Compute depth percentages for both sides once per update via useMemo.
  // Reads the book imperatively via getState() — no new subscription, no render-storm
  // from array-returning selectors.
  // Previously: 50 row selectors each called getBids/getAsks and ran O(N) cumulative-sum
  // + reduce = 1250 iterations per tick at depth 25. Now: 2 x O(N) passes total.
  const { bidDepthPcts, askDepthPcts, bidKeys, askKeys } = useMemo(() => {
    const book = useOrderBookStore.getState().books.get(symbol);
    if (!book) {
      return {
        bidDepthPcts: [] as number[],
        askDepthPcts: [] as number[],
        bidKeys: [] as string[],
        askKeys: [] as string[],
      };
    }
    const bidLevels = book.getBids(depth);
    const askLevels = book.getAsks(depth);
    return {
      bidDepthPcts: computeDepthPcts(bidLevels.map((l) => l.qty.toNumber())),
      askDepthPcts: computeDepthPcts(askLevels.map((l) => l.qty.toNumber())),
      // rawPrice is the wire price string — stable and unique per level.
      bidKeys: bidLevels.map((l) => l.rawPrice),
      askKeys: askLevels.map((l) => l.rawPrice),
    };
    // lastUpdateAt is the only reactive signal we need — when the book mutates,
    // lastUpdateAt changes, useMemo re-runs, reads fresh data via getState().
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol, depth, lastUpdateAt]);

  return (
    <div className="order-book flex flex-col h-full">

      {/* Asks: depth-1 at top, index 0 (best ask) at bottom — closest to price */}
      <div className="order-book-side order-book-asks flex-1 flex flex-col justify-end">
        {Array.from({ length: depth }, (_, i) => depth - 1 - i).map((i) => (
          <BookRow key={askKeys[i] ?? `ask-empty-${i}`} symbol={symbol} side="ask" index={i} depth={depth} depthPct={askDepthPcts[i] ?? 0} />
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
          <BookRow key={bidKeys[i] ?? `bid-empty-${i}`} symbol={symbol} side="bid" index={i} depth={depth} depthPct={bidDepthPcts[i] ?? 0} />
        ))}
      </div>

      <MarkRendered symbol={symbol} />
    </div>
  );
}
