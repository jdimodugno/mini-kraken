import { z } from 'zod';

// REST /0/public/OHLC row: [time, open, high, low, close, vwap, volume, count]
export const ohlcRestRowSchema = z.tuple([
  z.number(), // time (Unix seconds)
  z.string(), // open
  z.string(), // high
  z.string(), // low
  z.string(), // close
  z.string(), // vwap
  z.string(), // volume
  z.number(), // count
]);

export const ohlcRestResponseSchema = z.object({
  error: z.array(z.string()),
  result: z.record(
    z.string(),
    z.union([z.array(ohlcRestRowSchema), z.number()]),
  ),
});

export type OhlcRestRow = z.infer<typeof ohlcRestRowSchema>;
export type OhlcRestResponse = z.infer<typeof ohlcRestResponseSchema>;
