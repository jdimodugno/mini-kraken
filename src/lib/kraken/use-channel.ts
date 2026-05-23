'use client';

import { useEffect } from 'react';
import { getSubscriptionManager } from '.';

export function useChannelSubscription(
  channel: string,
  symbol: string,
  depth?: number,
): void {
  useEffect(() => {
    const descriptor = depth !== undefined
      ? { channel, symbol, depth }
      : { channel, symbol };
    const unsubscribe = getSubscriptionManager()?.subscribe(descriptor);
    return () => unsubscribe?.();
  }, [channel, symbol, depth]);
}
