'use client';

import { useMemo } from 'react';
import { useOrderBookStore } from '@/stores/orderbook-store';
import { simulateMarketOrder, type SimulationResult } from './simulate';
import type { Side } from './types';
import type { Decimal } from '@/lib/money/decimal';

export function useMarketOrderPreview(
  symbol: string,
  side: Side,
  size: Decimal | null,
): SimulationResult | null {
  // Subscribe to lastUpdateAt for reactivity — re-runs memo when book changes.
  const lastUpdate = useOrderBookStore((s) => s.lastUpdateAt.get(symbol) ?? 0);

  return useMemo(() => {
    if (size === null || size.lte(0)) return null;

    const book = useOrderBookStore.getState().books.get(symbol);
    if (book === undefined) return null;

    return simulateMarketOrder(side, size, book, 26); // 0.26% taker fee
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol, side, size?.toString(), lastUpdate]);
}
