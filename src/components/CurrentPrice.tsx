'use client';

import { useOrderBookStore } from '@/stores/orderbook-store';

interface CurrentPriceProps {
  symbol: string;
}

export function CurrentPrice({ symbol }: CurrentPriceProps) {
  const priceStr = useOrderBookStore((s) => {
    const bestBid = s.books.get(symbol)?.getBids(1)[0] ?? null;
    return bestBid !== null ? bestBid.price.toFixed(2) : null;
  });

  const syncStatus = useOrderBookStore((s) => s.checksumStatus.get(symbol) ?? 'ok');

  return (
    <div className="flex items-center gap-2">
      <span className={`font-mono text-2xl font-semibold ${priceStr !== null ? 'text-green-400' : 'text-zinc-500'}`}>
        {priceStr ?? '—'}
      </span>
      {syncStatus !== 'ok' && (
        <span className="text-xs font-mono text-amber-400 animate-pulse">syncing…</span>
      )}
    </div>
  );
}
