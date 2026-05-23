import type { Candle, Interval } from './types';
import { INTERVAL_MINUTES } from './types';
import { ohlcRestResponseSchema } from './schemas';

// Kraken REST uses legacy pair names with no slash and BTC→XBT.
export function toKrakenPair(symbol: string): string {
  return symbol.replace('/', '').replace('BTC', 'XBT');
}

export async function fetchHistoricalCandles(
  symbol: string,
  interval: Interval,
  signal?: AbortSignal,
): Promise<Candle[]> {
  const pair = toKrakenPair(symbol);
  const minutes = INTERVAL_MINUTES[interval];
  const url = `https://api.kraken.com/0/public/OHLC?pair=${pair}&interval=${minutes}`;

  const response = await fetch(url, { signal: signal ?? null });
  if (!response.ok) {
    throw new Error(`Kraken REST error: ${response.status} ${response.statusText}`);
  }

  const raw: unknown = await response.json();
  const parsed = ohlcRestResponseSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`Kraken OHLC response failed validation: ${parsed.error.message}`);
  }

  const candles: Candle[] = [];

  for (const [key, value] of Object.entries(parsed.data.result)) {
    // The `last` key is a number (last trade ID), skip it.
    if (key === 'last' || !Array.isArray(value)) continue;

    for (const row of value) {
      const [time, open, high, low, close, , volume] = row;
      candles.push({
        time,
        open: parseFloat(open),
        high: parseFloat(high),
        low: parseFloat(low),
        close: parseFloat(close),
        volume: parseFloat(volume),
      });
    }
  }

  candles.sort((a, b) => a.time - b.time);
  return candles;
}
