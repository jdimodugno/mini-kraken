'use client';

import { useStoreWithEqualityFn } from 'zustand/traditional';
import { useOrderBookStore } from '@/stores/orderbook-store';
import { useDebouncedValue } from '@/hooks/use-debounced-value';

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

/** Debounce delay for aria-live announcements (avoid screen reader spam) */
const ARIA_LIVE_DEBOUNCE_MS = 1500;

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

  // Debounced values for screen reader announcements
  const debouncedBid = useDebouncedValue(bid, ARIA_LIVE_DEBOUNCE_MS);
  const debouncedAsk = useDebouncedValue(ask, ARIA_LIVE_DEBOUNCE_MS);

  const hasData = bid !== null || ask !== null;

  // Screen reader announcement text (only updates every 1.5s)
  const srAnnouncement =
    debouncedBid !== null && debouncedAsk !== null
      ? `Best bid ${debouncedBid} dollars, best ask ${debouncedAsk} dollars`
      : null;

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
      {/* Screen reader only: debounced price announcements */}
      {srAnnouncement !== null && (
        <span className="sr-only" aria-live="polite" aria-atomic="true">
          {srAnnouncement}
        </span>
      )}
    </div>
  );
}
