'use client';

import { useStoreWithEqualityFn } from 'zustand/traditional';
import { useOrderBookStore } from '@/stores/orderbook-store';

interface CurrentPriceProps {
  symbol: string;
}

interface BidAskSpread {
  bid: string | null;
  ask: string | null;
  spread: string | null;
}

function bidAskSpreadEqual(a: BidAskSpread, b: BidAskSpread): boolean {
  return a.bid === b.bid && a.ask === b.ask && a.spread === b.spread;
}

export function CurrentPrice({ symbol }: CurrentPriceProps) {
  const { bid, ask, spread } = useStoreWithEqualityFn(
    useOrderBookStore,
    (s) => {
      const book = s.books.get(symbol);
      // Depend on lastUpdateAt so the selector re-runs on each book update.
      void s.lastUpdateAt.get(symbol);
      if (book === undefined) return { bid: null, ask: null, spread: null };
      const bestBid = book.getBestBidPrice();
      const bestAsk = book.getBestAskPrice();
      const spreadVal = book.getSpread();
      return {
        bid: bestBid !== null ? bestBid.toFixed(2) : null,
        ask: bestAsk !== null ? bestAsk.toFixed(2) : null,
        spread: spreadVal !== null ? spreadVal.toFixed(2) : null,
      };
    },
    bidAskSpreadEqual,
  );

  const syncStatus = useOrderBookStore((s) => s.checksumStatus.get(symbol) ?? 'ok');

  const hasData = bid !== null || ask !== null;

  return (
    <div className="flex items-center gap-4">
      <div className="flex items-center gap-3 font-mono text-sm">
        <span className="text-zinc-500 uppercase tracking-wider text-xs">Bid</span>
        <span className={hasData ? 'text-green-400 font-semibold' : 'text-zinc-600'}>
          {bid ?? '—'}
        </span>
        <span className="text-zinc-700">·</span>
        <span className="text-zinc-500 uppercase tracking-wider text-xs">Ask</span>
        <span className={hasData ? 'text-red-400 font-semibold' : 'text-zinc-600'}>
          {ask ?? '—'}
        </span>
        <span className="text-zinc-700">·</span>
        <span className="text-zinc-500 uppercase tracking-wider text-xs">Spread</span>
        <span className={hasData ? 'text-zinc-300' : 'text-zinc-600'}>
          {spread ?? '—'}
        </span>
      </div>
      {syncStatus !== 'ok' && (
        <span className="text-xs font-mono text-amber-400 animate-pulse">syncing…</span>
      )}
    </div>
  );
}
