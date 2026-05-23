# Phase 3: Candlestick Charting & REST/WebSocket Handoff

**Goal:** Build a candlestick chart with multiple intervals that loads historical data from Kraken's REST API, then continuously updates the latest candle via WebSocket. Handle the race condition between the REST response and incoming WS messages cleanly.

**Estimated time:** 1–2 days

## Learning Objectives

1. The mental model for combining REST (historical) and WebSocket (live) data sources
2. How to handle race conditions in async data loading
3. The difference between OHLCV (candle) data and trade-level data
4. When to reach for a charting library vs. roll your own
5. How charting libraries integrate with React without fighting it

## Why This Matters for the Interview

A common senior interview question: *"You need to display historical data with live updates. How do you architect this?"* The naïve answers (poll, or refetch on every WS message) reveal junior thinking. The good answer involves a one-time historical fetch followed by stream-driven incremental updates, with explicit handling of the seam between them.

## Background: Candlesticks and OHLCV

A candlestick represents price movement over a fixed interval:

- **O**pen: price at interval start
- **H**igh: highest price in interval
- **L**ow: lowest price in interval
- **C**lose: most recent price (final if interval closed, current if still open)
- **V**olume: total traded volume in interval

For each trading pair and interval (1m, 5m, 1h, 1d), Kraken provides:
- REST endpoint: `GET /0/public/OHLC` — returns the last ~720 candles
- WebSocket channel: `ohlc` — streams candle updates (the current open candle gets updated; closed candles arrive as final)

## The Race Condition

Picture the sequence:

```
t=0:   You request 720 historical candles via REST.
t=0:   You subscribe to ohlc WS channel.
t=10:  WS message arrives: candle update for 12:34:00.
t=15:  REST response arrives with candles up to 12:33:59.
```

The WS update arrived first. If you apply it, then overwrite with REST data, you lose the update. If you reject WS until REST arrives, you might miss live data. You need to:

1. Buffer WS messages from `t=0` to whenever REST resolves.
2. When REST resolves, apply its data first, then replay buffered WS updates.
3. Resolve conflicts (REST has candle X, buffered WS also updates X → WS wins because it's newer).

This is the architectural decision worth articulating in an interview.

## What You're Building

```typescript
// User-facing
<Chart symbol="BTC/USD" interval="1m" />

// Under the hood:
// - useCandles hook returns the merged stream
// - First call triggers REST fetch + WS subscription
// - On unmount, unsubscribes
// - Chart library renders the data
```

## Step-by-Step Build

### Step 1: Pick your charting library

Two strong options:

**Option A: `lightweight-charts` from TradingView**
- Industry standard for financial charts
- Tiny (~50kb), purpose-built for OHLCV
- Imperative API (you call `series.update(candle)`) — fits streaming model perfectly
- Not React-native, but a thin wrapper is trivial

**Option B: `visx` (Airbnb)**
- React-native, fully customizable
- More code to write
- Better if you want unusual customizations

For this project, **pick lightweight-charts.** Document the decision in `DECISIONS.md`: "Chose lightweight-charts because it's purpose-built for financial data and its imperative `update()` method matches a streaming data model better than React state-driven re-renders would. For a chart-heavy product like Kraken's, this is the right primitive."

```bash
pnpm add lightweight-charts
```

**Interview drill:** "Why didn't you use Chart.js or Recharts?" Answer: those are general-purpose, not financial-specific. You'd be fighting them to get proper candlestick rendering, fractional pricing, time-axis behavior. Picking the right library is itself a senior skill.

### Step 2: Define the candle schema

`src/lib/candles/types.ts`:

```typescript
export interface Candle {
  time: number; // Unix seconds (lightweight-charts expects seconds, not ms)
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export type Interval = '1m' | '5m' | '15m' | '1h' | '4h' | '1d';

export const INTERVAL_TO_KRAKEN_MINUTES: Record<Interval, number> = {
  '1m': 1, '5m': 5, '15m': 15, '1h': 60, '4h': 240, '1d': 1440,
};
```

Add Zod schemas for both REST and WS payloads (Kraken's REST and WS schemas differ — yes, really; account for that).

### Step 3: REST fetcher

Create `src/lib/candles/fetch-historical.ts`:

```typescript
import type { Candle, Interval } from './types';
import { INTERVAL_TO_KRAKEN_MINUTES } from './types';

export async function fetchHistoricalCandles(
  symbol: string,
  interval: Interval,
  signal?: AbortSignal
): Promise<Candle[]> {
  const krakenPair = symbol.replace('/', ''); // 'BTC/USD' -> 'BTCUSD' (verify in their docs)
  const url = new URL('https://api.kraken.com/0/public/OHLC');
  url.searchParams.set('pair', krakenPair);
  url.searchParams.set('interval', String(INTERVAL_TO_KRAKEN_MINUTES[interval]));

  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`Kraken REST error ${res.status}`);
  const json = await res.json();

  if (json.error?.length) throw new Error(json.error.join(', '));

  // Kraken returns: { result: { PAIR: [[time, open, high, low, close, vwap, volume, count], ...] } }
  const pairKey = Object.keys(json.result).find((k) => k !== 'last');
  if (!pairKey) throw new Error('No candle data in response');

  const raw: Array<[number, string, string, string, string, string, string, number]> = json.result[pairKey];
  return raw.map(([time, open, high, low, close, _vwap, volume]) => ({
    time,
    open: parseFloat(open),
    high: parseFloat(high),
    low: parseFloat(low),
    close: parseFloat(close),
    volume: parseFloat(volume),
  }));
}
```

**Critical detail:** Pass an `AbortSignal`. If the user switches symbols before this resolves, you want to cancel the request, not let it land and overwrite the new symbol's data.

### Step 4: Candle store with race-aware loading

Create `src/stores/candles-store.ts`:

```typescript
import { create } from 'zustand';
import type { Candle, Interval } from '@/lib/candles/types';

type LoadState = 'idle' | 'loading' | 'ready' | 'error';

interface SeriesKey {
  symbol: string;
  interval: Interval;
}

function keyOf(k: SeriesKey): string {
  return `${k.symbol}:${k.interval}`;
}

interface CandleSeries {
  candles: Map<number, Candle>; // keyed by time for O(1) update
  state: LoadState;
  // WS updates received before REST resolved get queued here
  pendingUpdates: Candle[];
}

interface CandlesState {
  series: Map<string, CandleSeries>;
  startLoad: (key: SeriesKey) => void;
  applyHistorical: (key: SeriesKey, candles: Candle[]) => void;
  applyLiveUpdate: (key: SeriesKey, candle: Candle) => void;
  getCandles: (key: SeriesKey) => Candle[];
}

export const useCandlesStore = create<CandlesState>((set, get) => ({
  series: new Map(),

  startLoad(key) {
    const k = keyOf(key);
    set((s) => {
      const next = new Map(s.series);
      next.set(k, { candles: new Map(), state: 'loading', pendingUpdates: [] });
      return { series: next };
    });
  },

  applyHistorical(key, candles) {
    const k = keyOf(key);
    set((s) => {
      const series = s.series.get(k);
      if (!series) return s; // load was cancelled
      const candleMap = new Map<number, Candle>();
      for (const c of candles) candleMap.set(c.time, c);
      // Replay buffered WS updates AFTER historical, WS wins on conflict
      for (const update of series.pendingUpdates) {
        candleMap.set(update.time, update);
      }
      const next = new Map(s.series);
      next.set(k, { candles: candleMap, state: 'ready', pendingUpdates: [] });
      return { series: next };
    });
  },

  applyLiveUpdate(key, candle) {
    const k = keyOf(key);
    set((s) => {
      const series = s.series.get(k);
      if (!series) return s;
      const next = new Map(s.series);
      if (series.state === 'loading') {
        // Buffer until REST resolves
        next.set(k, { ...series, pendingUpdates: [...series.pendingUpdates, candle] });
      } else {
        const newCandles = new Map(series.candles);
        newCandles.set(candle.time, candle);
        next.set(k, { ...series, candles: newCandles });
      }
      return { series: next };
    });
  },

  getCandles(key) {
    const series = get().series.get(keyOf(key));
    if (!series) return [];
    return Array.from(series.candles.values()).sort((a, b) => a.time - b.time);
  },
}));
```

**This is the key idea of this phase**: the `pendingUpdates` buffer holds WS messages until REST resolves, then replays them with WS-wins semantics. Trace through this in your head until it's crystal clear, because you will explain it.

### Step 5: The orchestrating hook

Create `src/lib/candles/use-candles.ts`:

```typescript
import { useEffect, useRef } from 'react';
import { useCandlesStore } from '@/stores/candles-store';
import { useChannelSubscription } from '@/lib/kraken/use-channel';
import { getKrakenClient } from '@/lib/kraken';
import { fetchHistoricalCandles } from './fetch-historical';
import type { Interval, Candle } from './types';

export function useCandles(symbol: string, interval: Interval): Candle[] {
  const { startLoad, applyHistorical, applyLiveUpdate, getCandles } = useCandlesStore();

  // Subscribe to ohlc channel
  useChannelSubscription(`ohlc-${interval}`, symbol); // verify Kraken's channel naming

  useEffect(() => {
    const controller = new AbortController();
    startLoad({ symbol, interval });

    fetchHistoricalCandles(symbol, interval, controller.signal)
      .then((candles) => applyHistorical({ symbol, interval }, candles))
      .catch((err) => {
        if (err.name === 'AbortError') return;
        console.error('Historical fetch failed', err);
      });

    const unsub = getKrakenClient().onMessage((msg) => {
      if (msg.channel !== `ohlc-${interval}`) return;
      // Parse Kraken's WS candle shape into our Candle type
      for (const entry of msg.data) {
        if (entry.symbol !== symbol) continue;
        applyLiveUpdate({ symbol, interval }, normalizeCandle(entry));
      }
    });

    return () => {
      controller.abort();
      unsub();
    };
  }, [symbol, interval, startLoad, applyHistorical, applyLiveUpdate]);

  return useCandlesStore((s) => s.getCandles({ symbol, interval }));
}
```

Note: the `useChannelSubscription` outside of `useEffect` works because it's already wrapped in its own `useEffect`. The other side effects need their own.

### Step 6: The chart component

Create `src/components/chart.tsx`:

```typescript
'use client';

import { useEffect, useRef } from 'react';
import { createChart, IChartApi, ISeriesApi } from 'lightweight-charts';
import { useCandles } from '@/lib/candles/use-candles';
import type { Interval } from '@/lib/candles/types';

export function Chart({ symbol, interval }: { symbol: string; interval: Interval }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const candles = useCandles(symbol, interval);

  // Create chart once
  useEffect(() => {
    if (!containerRef.current) return;
    const chart = createChart(containerRef.current, {
      width: containerRef.current.clientWidth,
      height: 400,
      layout: { background: { color: 'transparent' }, textColor: '#d1d5db' },
      grid: { vertLines: { color: '#1f2937' }, horzLines: { color: '#1f2937' } },
      crosshair: { mode: 1 },
      timeScale: { borderColor: '#374151', timeVisible: true },
    });
    const series = chart.addCandlestickSeries({
      upColor: '#22c55e',
      downColor: '#ef4444',
      borderVisible: false,
      wickUpColor: '#22c55e',
      wickDownColor: '#ef4444',
    });
    chartRef.current = chart;
    seriesRef.current = series;

    const resize = () => {
      chart.applyOptions({ width: containerRef.current?.clientWidth ?? 0 });
    };
    window.addEventListener('resize', resize);
    return () => {
      window.removeEventListener('resize', resize);
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, []);

  // Sync data — bulk set on first load, incremental update afterward
  const initializedRef = useRef(false);
  const lastCandleTimeRef = useRef(0);

  useEffect(() => {
    if (!seriesRef.current) return;
    if (candles.length === 0) return;
    if (!initializedRef.current) {
      seriesRef.current.setData(candles as any);
      initializedRef.current = true;
      lastCandleTimeRef.current = candles[candles.length - 1].time;
    } else {
      // Only push new/updated candles
      for (const c of candles) {
        if (c.time >= lastCandleTimeRef.current) {
          seriesRef.current.update(c as any);
          lastCandleTimeRef.current = Math.max(lastCandleTimeRef.current, c.time);
        }
      }
    }
  }, [candles]);

  // Reset when symbol/interval changes
  useEffect(() => {
    initializedRef.current = false;
    lastCandleTimeRef.current = 0;
  }, [symbol, interval]);

  return <div ref={containerRef} className="w-full h-[400px]" />;
}
```

**Why the `initializedRef` / `lastCandleTimeRef` pattern?** `setData` is expensive (full re-render). `update` is cheap (one candle). Use `setData` once on initial load, then `update` for incremental changes. This mirrors the imperative API the library was designed for.

**Interview drill:** "Why an imperative API for the chart but declarative React for everything else?" Answer: streaming financial data plays nicely with imperative `update(candle)` calls; making React's reconciler do this 50x/sec would be slower and pointless.

### Step 7: Interval switcher UI

Add buttons above the chart to switch intervals. State lives in a parent component:

```typescript
const [interval, setInterval] = useState<Interval>('1m');

return (
  <>
    <div className="flex gap-2 mb-2">
      {(['1m','5m','15m','1h','4h','1d'] as const).map((i) => (
        <button
          key={i}
          onClick={() => setInterval(i)}
          className={interval === i ? 'font-bold' : ''}
        >
          {i}
        </button>
      ))}
    </div>
    <Chart symbol={symbol} interval={interval} />
  </>
);
```

When `interval` changes, `useCandles` re-runs its effect, which aborts the old REST call, unsubscribes the old WS channel, and starts fresh. No leaks, no stale data. Verify this works by switching rapidly.

## Common Mistakes

1. **No abort signal on the REST fetch** — User switches symbol, old fetch lands, overwrites new symbol's data. Race condition. Hard to debug.
2. **Applying REST data after WS data without merging** — Loses live updates that arrived first.
3. **Calling `setData` on every update** — Kills perf. Use `update` after initial load.
4. **Putting the chart instance in React state** — `createChart` is a side effect, the instance is mutable; it belongs in a ref.
5. **Forgetting Kraken's epoch unit** — Their REST returns seconds, some channels return milliseconds. Verify and convert.
6. **Not handling the case where WS sends a candle from an interval older than what REST returned** — Drop or apply? Decide and document.

## Verification Checklist

- [ ] Load page, see ~720 historical candles for BTC/USD 1m
- [ ] The most recent candle updates live as trades happen
- [ ] Switch intervals — chart updates without leaks, no stale data
- [ ] Switch symbols mid-load — new symbol's data shows, no old data lingering
- [ ] Crosshair shows OHLCV at hovered position
- [ ] Resize browser — chart resizes responsively
- [ ] Open Network tab during fast interval switching — old REST calls are aborted

## Interview Drill Questions

1. Walk me through how you handle the race between REST and WS.
2. Why didn't you just refetch the REST data periodically?
3. What happens if Kraken sends a candle update for an interval that's already closed (historical)?
4. Your chart is sluggish on initial load. How do you investigate?
5. Why use a chart library's imperative API instead of declaratively binding data to React?
6. How does this handle two charts on the same page (e.g., BTC/USD and ETH/USD)?
7. If you wanted users to scroll back to see older historical data, how would you implement that? (Pagination via REST, with care to not double-load and to clear out old data to avoid memory bloat.)
8. What's the consequence if the user's clock is wrong? (Most fine — time values come from server. But local-relative displays like "5m ago" would be off.)

## Bonus enhancements (if you have time)

- **Volume histogram** below the candles
- **Moving averages** overlay (compute MA from the candles array, render as a line series)
- **Click to set a price line** that the order entry form (Phase 4) reads

Once your chart is live and rock-solid through symbol/interval switching, move to `06-phase4a-order-matching.md`.
