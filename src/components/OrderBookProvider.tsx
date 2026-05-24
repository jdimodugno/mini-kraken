'use client';

import React, { useContext, useEffect } from 'react';
import { toLevel } from '@/lib/orderbook/orderbook';
import { getKrakenClient, getSubscriptionManager } from '@/lib/kraken/index';
import { useChannelSubscription } from '@/lib/kraken/use-channel';
import { useOrderBookStore, useOrderBookStatus, type ChecksumStatus } from '@/stores/orderbook-store';
import type { BookSnapshot, BookUpdate } from '@/lib/kraken/schemas';

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
      const bookMsg = msg as BookSnapshot | BookUpdate;

      for (const entry of bookMsg.data) {
        if (entry.symbol !== symbol) continue;

        const bids = entry.bids.map(toLevel);
        const asks = entry.asks.map(toLevel);

        if (bookMsg.type === 'snapshot') {
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

    // Send wire unsubscribe+subscribe without changing ref counts — the logical
    // subscription from useChannelSubscription stays active (refCount >= 1),
    // so a plain subscribe/unsub dance never drops to 0 and sends nothing.
    // forceResync bypasses ref counting and directly sends the wire frames.
    subs.forceResync({ channel: 'book', symbol, ...(depth !== undefined ? { depth } : {}) });
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
