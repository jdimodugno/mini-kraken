'use client';

import { useEffect } from 'react';
import { getSubscriptionManager } from '.';

export function useChannelSubscription(
  channel: string,
  symbol: string,
  depth?: number,
  interval?: number,
): void {
  useEffect(() => {
    const descriptor = {
      channel,
      symbol,
      ...(depth !== undefined ? { depth } : {}),
      ...(interval !== undefined ? { interval } : {}),
    };
    const unsubscribe = getSubscriptionManager()?.subscribe(descriptor);
    return () => unsubscribe?.();
  }, [channel, symbol, depth, interval]);
}
