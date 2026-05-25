'use client';

import { useEffect } from 'react';
import { useChannelSubscription } from '@/lib/kraken/use-channel';
import { getKrakenClient } from '@/lib/kraken';
import { useCandlesStore, useCandlesArray } from '@/stores/candles-store';
import { fetchHistoricalCandles } from './fetch-historical';
import type { Candle, Interval } from './types';
import { INTERVAL_MINUTES } from './types';
import type { OhlcMessage } from '@/lib/kraken/schemas';
import type { KrakenMessage } from '@/lib/kraken/schemas';

export function useCandles(symbol: string, interval: Interval): readonly Candle[] {
  useChannelSubscription('ohlc', symbol, undefined, INTERVAL_MINUTES[interval]);

  useEffect(() => {
    const { startLoad, applyHistorical, applyLiveUpdate, setLoadState } =
      useCandlesStore.getState();

    const loadToken = startLoad({ symbol, interval });
    const controller = new AbortController();

    fetchHistoricalCandles(symbol, interval, controller.signal)
      .then((candles) => {
        applyHistorical({ symbol, interval }, candles, loadToken);
      })
      .catch((err: unknown) => {
        if (err instanceof Error && err.name === 'AbortError') return;
        console.error('[useCandles] failed to fetch historical candles', err);
        setLoadState({ symbol, interval }, 'error');
      });

    const client = getKrakenClient();
    let unsub: (() => void) | undefined;
    if (client !== null) {
      unsub = client.onMessage((msg: KrakenMessage) => {
        if (!('channel' in msg) || msg.channel !== 'ohlc') return;
        const ohlcMsg = msg as OhlcMessage;
        for (const d of ohlcMsg.data) {
          if (d.symbol !== symbol) continue;
          const time = Math.floor(new Date(d.interval_begin).getTime() / 1000);
          applyLiveUpdate(
            { symbol, interval },
            {
              time,
              open: d.open,
              high: d.high,
              low: d.low,
              close: d.close,
              volume: d.volume,
            },
          );
        }
      });
    }

    return () => {
      controller.abort();
      unsub?.();
    };
  }, [symbol, interval]);

  return useCandlesArray(symbol, interval);
}
