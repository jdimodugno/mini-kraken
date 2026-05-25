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

      // H5: read epoch synchronously at message-parse time so frames from a
      // prior subscription cycle are stamped with the old epoch and dropped.
      const subs = getSubscriptionManager();
      const epoch = subs?.getEpoch({ channel: 'book', symbol, depth }) ?? 0;

      for (const entry of bookMsg.data) {
        if (entry.symbol !== symbol) continue;

        const bids = entry.bids.map(toLevel);
        const asks = entry.asks.map(toLevel);

        if (bookMsg.type === 'snapshot') {
          applySnapshot(symbol, bids, asks, epoch);
        } else {
          applyUpdate(symbol, bids, asks, entry.checksum, epoch);
        }
      }
    });
  }, [symbol, depth, applySnapshot, applyUpdate]);

  useEffect(() => {
    if (checksumStatus !== 'failed') return;

    const subs = getSubscriptionManager();
    if (!subs) return;

    setChecksumStatus(symbol, 'resyncing');

    // H5: requestResync bumps the epoch BEFORE sending the unsubscribe wire
    // frame. Any delta arriving after the bump carries the old epoch and will be
    // dropped by the store. The new snapshot (arriving after the resub-ack)
    // carries the new epoch and is accepted.
    subs.requestResync({ channel: 'book', symbol, ...(depth !== undefined ? { depth } : {}) });
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
