'use client';

import { useState } from 'react';
import { Chart } from './Chart';
import { useCandleLoadState } from '@/stores/candles-store';
import type { Interval } from '@/lib/candles/types';

const INTERVALS: Interval[] = ['1m', '5m', '15m', '1h', '4h', '1d'];

interface ChartShellProps {
  symbol: string;
}

export function ChartShell({ symbol }: ChartShellProps) {
  const [interval, setInterval] = useState<Interval>('1m');
  const loadState = useCandleLoadState(symbol, interval);

  return (
    <div className="bg-zinc-900 rounded-lg p-4">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-zinc-400 text-xs font-mono">{symbol}</span>
        <div className="flex gap-1 ml-auto">
          {INTERVALS.map((iv) => (
            <button
              key={iv}
              onClick={() => setInterval(iv)}
              className={`px-2 py-0.5 text-xs font-mono rounded transition-colors ${
                iv === interval
                  ? 'bg-zinc-600 text-zinc-100'
                  : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800'
              }`}
            >
              {iv}
            </button>
          ))}
        </div>
        {loadState === 'loading' && (
          <span className="text-zinc-500 text-xs font-mono ml-2">loading...</span>
        )}
        {loadState === 'error' && (
          <span className="text-red-400 text-xs font-mono ml-2">error</span>
        )}
      </div>
      <Chart symbol={symbol} interval={interval} />
    </div>
  );
}
