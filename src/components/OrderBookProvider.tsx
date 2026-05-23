'use client';

import React, { useContext, useEffect } from 'react';
import { toLevel } from '@/lib/orderbook/orderbook';
import { getKrakenClient, getSubscriptionManager } from '@/lib/kraken/index';
import { useChannelSubscription } from '@/lib/kraken/use-channel';
import { useOrderBookStore, useOrderBookStatus, type ChecksumStatus } from '@/stores/orderbook-store';

interface OrderBookProviderProps {
  symbol: string;
  depth?: number;
  children: React.ReactNode;
}

export const OrderBookStatusContext = React.createContext<ChecksumStatus>('ok');

export function OrderBookProvider({ symbol, depth = 25, children }: OrderBookProviderProps) {
  useChannelSubscription('book', symbol, depth);

  const applySnapshot = useOrderBookStore((s) => s.applySnapshot);
  const applyUpdate = useOrderBookStore((s) => s.applyUpdate);
  const setChecksumStatus = useOrderBookStore((s) => s.setChecksumStatus);
  const checksumStatus = useOrderBookStatus(symbol);

  useEffect(() => {
    const client = getKrakenClient();
    if (!client) return;

    return client.onMessage((msg) => {
      if (!('channel' in msg) || msg.channel !== 'book') return;

      for (const entry of msg.data) {
        if (entry.symbol !== symbol) continue;

        const bids = entry.bids.map(toLevel);
        const asks = entry.asks.map(toLevel);

        if (msg.type === 'snapshot') {
          applySnapshot(symbol, bids, asks);
        } else {
          applyUpdate(symbol, bids, asks, entry.checksum);
        }
      }
    });
  }, [symbol, applySnapshot, applyUpdate]);

  // On mount, clear any stale 'resyncing' left by a previous HMR cycle. A
  // stale 'resyncing' silently drops all applyUpdate calls in the store,
  // freezing the book. Resetting to 'ok' lets the next real checksum failure
  // retrigger the recovery flow cleanly.
  useEffect(() => {
    // Read current state at effect time (not from the render closure) to avoid
    // the stale-closure problem. useOrderBookStore.getState() is safe here.
    const current = useOrderBookStore.getState().checksumStatus.get(symbol);
    if (current === 'resyncing') {
      setChecksumStatus(symbol, 'ok');
    }
  }, [symbol, setChecksumStatus]);

  useEffect(() => {
    if (checksumStatus !== 'failed') return;

    const subs = getSubscriptionManager();
    if (!subs) return;

    setChecksumStatus(symbol, 'resyncing');

    const descriptor = { channel: 'book', symbol, ...(depth !== undefined ? { depth } : {}) };

    // Force Kraken to send a fresh snapshot: release then re-acquire the subscription.
    const unsub = subs.subscribe(descriptor);
    unsub();
    return subs.subscribe(descriptor);
  }, [checksumStatus, symbol, depth, setChecksumStatus]);

  return (
    <OrderBookStatusContext.Provider value={checksumStatus}>
      {children}
    </OrderBookStatusContext.Provider>
  );
}

export function useOrderBookSyncStatus(): ChecksumStatus {
  return useContext(OrderBookStatusContext);
}
