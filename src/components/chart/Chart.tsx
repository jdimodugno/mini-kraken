'use client';

import { useEffect, useRef } from 'react';
import { createChart, CandlestickSeries } from 'lightweight-charts';
import type { CandlestickData, Time } from 'lightweight-charts';
import { useCandlesStore } from '@/stores/candles-store';
import { useCandles } from '@/lib/candles/use-candles';
import type { Interval } from '@/lib/candles/types';

interface ChartProps {
  symbol: string;
  interval: Interval;
}

export function Chart({ symbol, interval }: ChartProps) {
  // useCandles subscribes the WS channel + loads REST data into the store
  useCandles(symbol, interval);

  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (containerRef.current === null) return;

    const chart = createChart(containerRef.current, {
      width: containerRef.current.clientWidth,
      height: containerRef.current.clientHeight || 400,
      layout: {
        background: { color: 'transparent' },
        textColor: '#d1d5db',
      },
      grid: {
        vertLines: { color: '#1f2937' },
        horzLines: { color: '#1f2937' },
      },
      timeScale: {
        borderColor: '#374151',
      },
    });

    const series = chart.addSeries(CandlestickSeries, {
      upColor: '#22c55e',
      downColor: '#ef4444',
      borderUpColor: '#22c55e',
      borderDownColor: '#ef4444',
      wickUpColor: '#22c55e',
      wickDownColor: '#ef4444',
    });

    let initialized = false;
    let lastCandleTime = 0;
    let prevVersion = 0;

    // Zustand's base subscribe doesn't support selector+listener — we read the
    // version field ourselves and bail early if it hasn't changed.
    const unsubscribe = useCandlesStore.subscribe(() => {
      const version =
        useCandlesStore.getState().series.get(`${symbol}:${interval}`)?.version ?? 0;
      if (version === prevVersion) return;
      prevVersion = version;

      const candles = useCandlesStore.getState().getCandles({ symbol, interval });
      if (candles.length === 0) return;

      if (!initialized) {
        series.setData(candles as unknown as CandlestickData<Time>[]);
        initialized = true;
        lastCandleTime = candles[candles.length - 1]?.time ?? 0;
      } else {
        for (const c of candles) {
          if (c.time >= lastCandleTime) {
            series.update(c as unknown as CandlestickData<Time>);
            lastCandleTime = Math.max(lastCandleTime, c.time);
          }
        }
      }
    });

    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry === undefined || containerRef.current === null) return;
      chart.applyOptions({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      });
    });
    ro.observe(containerRef.current);

    return () => {
      unsubscribe();
      ro.disconnect();
      chart.remove();
    };
  }, [symbol, interval]);

  return <div ref={containerRef} className="w-full h-full" />;
}
