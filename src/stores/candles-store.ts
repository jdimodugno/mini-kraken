import { create } from 'zustand';
import type { Candle, Interval } from '@/lib/candles/types';

type LoadState = 'idle' | 'loading' | 'ready' | 'error';

interface SeriesKey {
  symbol: string;
  interval: Interval;
}

interface CandleSeries {
  candles: Map<number, Candle>;
  candlesArray: readonly Candle[];
  state: LoadState;
  pendingUpdates: Candle[];
  loadToken: number;
  version: number;
  lastAppliedAt: number;
}

function seriesKeyOf(key: SeriesKey): string {
  return `${key.symbol}:${key.interval}`;
}

function materialize(candles: Map<number, Candle>): readonly Candle[] {
  return Array.from(candles.values()).sort((a, b) => a.time - b.time);
}

function emptySeries(): CandleSeries {
  return {
    candles: new Map(),
    candlesArray: [],
    state: 'idle',
    pendingUpdates: [],
    loadToken: 0,
    version: 0,
    lastAppliedAt: 0,
  };
}

interface CandlesStore {
  series: Map<string, CandleSeries>;

  startLoad(key: SeriesKey): number;
  applyHistorical(key: SeriesKey, candles: Candle[], token: number): void;
  applyLiveUpdate(key: SeriesKey, candle: Candle): void;
  setLoadState(key: SeriesKey, state: LoadState): void;
  getLoadState(key: SeriesKey): LoadState;
  getCandles(key: SeriesKey): readonly Candle[];
}

export const useCandlesStore = create<CandlesStore>()((set, get) => ({
  series: new Map(),

  startLoad(key: SeriesKey): number {
    const strKey = seriesKeyOf(key);
    const existing = get().series.get(strKey) ?? emptySeries();
    const loadToken = existing.loadToken + 1;

    const next = new Map(get().series);
    next.set(strKey, {
      ...existing,
      state: 'loading',
      pendingUpdates: [],
      loadToken,
    });
    set({ series: next });
    return loadToken;
  },

  applyHistorical(key: SeriesKey, candles: Candle[], token: number): void {
    const strKey = seriesKeyOf(key);
    const existing = get().series.get(strKey);
    if (existing === undefined || existing.loadToken !== token) return;

    const candleMap = new Map<number, Candle>();
    for (const c of candles) {
      candleMap.set(c.time, c);
    }

    const lastRestTime = candles.length > 0 ? (candles[candles.length - 1]?.time ?? 0) : 0;

    // WS wins for any pending update at or after the last REST candle time
    for (const pending of existing.pendingUpdates) {
      if (pending.time >= lastRestTime) {
        candleMap.set(pending.time, pending);
      }
    }

    const candlesArray = materialize(candleMap);

    const next = new Map(get().series);
    next.set(strKey, {
      ...existing,
      candles: candleMap,
      candlesArray,
      state: 'ready',
      pendingUpdates: [],
      version: existing.version + 1,
      lastAppliedAt: Date.now(),
    });
    set({ series: next });
  },

  applyLiveUpdate(key: SeriesKey, candle: Candle): void {
    const strKey = seriesKeyOf(key);
    const existing = get().series.get(strKey) ?? emptySeries();

    if (existing.state === 'loading') {
      const next = new Map(get().series);
      next.set(strKey, {
        ...existing,
        pendingUpdates: [...existing.pendingUpdates, candle],
      });
      set({ series: next });
      return;
    }

    const candleMap = new Map(existing.candles);
    candleMap.set(candle.time, candle);
    const candlesArray = materialize(candleMap);

    const next = new Map(get().series);
    next.set(strKey, {
      ...existing,
      candles: candleMap,
      candlesArray,
      version: existing.version + 1,
    });
    set({ series: next });
  },

  setLoadState(key: SeriesKey, state: LoadState): void {
    const strKey = seriesKeyOf(key);
    const existing = get().series.get(strKey) ?? emptySeries();
    const next = new Map(get().series);
    next.set(strKey, { ...existing, state });
    set({ series: next });
  },

  getLoadState(key: SeriesKey): LoadState {
    return get().series.get(seriesKeyOf(key))?.state ?? 'idle';
  },

  getCandles(key: SeriesKey): readonly Candle[] {
    return get().series.get(seriesKeyOf(key))?.candlesArray ?? [];
  },
}));

export function useCandlesVersion(symbol: string, interval: Interval): number {
  return useCandlesStore(
    (s) => s.series.get(`${symbol}:${interval}`)?.version ?? 0,
  );
}

const EMPTY_CANDLES: readonly Candle[] = [];

export function useCandlesArray(symbol: string, interval: Interval): readonly Candle[] {
  return useCandlesStore(
    (s) => s.series.get(`${symbol}:${interval}`)?.candlesArray ?? EMPTY_CANDLES,
  );
}

export function useCandleLoadState(symbol: string, interval: Interval): LoadState {
  return useCandlesStore(
    (s) => s.series.get(`${symbol}:${interval}`)?.state ?? 'idle',
  );
}
