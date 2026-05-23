'use client';

import { useEffect } from 'react';
import { useOrderBookStore } from '@/stores/orderbook-store';
import { useTradingStore } from '@/stores/trading-store';

// Mount once at the app level. Subscribes to all order book updates and attempts
// to fill any pending limit orders whose trigger condition is now met.
// The check in tryFillOpenOrders is O(n open orders) and idempotent — safe to
// call on every tick.
export function useLimitFillTrigger(symbol: string): void {
  useEffect(() => {
    const unsubscribe = useOrderBookStore.subscribe((state, prev) => {
      const current = state.lastUpdateAt.get(symbol) ?? 0;
      const previous = prev.lastUpdateAt.get(symbol) ?? 0;
      if (current !== previous) {
        useTradingStore.getState().tryFillOpenOrders();
      }
    });

    return unsubscribe;
  }, [symbol]);
}
