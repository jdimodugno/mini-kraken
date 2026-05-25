import { describe, it, expect } from 'vitest';
import { krakenMessageSchema } from '../schemas';

describe('krakenMessageSchema — ohlc channel', () => {
  const baseData = {
    symbol: 'ALGO/USD',
    open: 0.09875,
    high: 0.09875,
    low: 0.09875,
    close: 0.09875,
    trades: 1,
    volume: 201.86015,
    vwap: 0.09875,
    interval_begin: '2023-10-04T15:25:00.000000000Z',
    interval: 5,
  };

  it('parses a snapshot frame with numeric ohlc values', () => {
    const payload = {
      channel: 'ohlc',
      type: 'snapshot',
      data: [{ ...baseData, timestamp: '2023-10-04T15:30:00.000000000Z' }],
    };

    const result = krakenMessageSchema.safeParse(payload);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.channel).toBe('ohlc');
  });

  it('parses an update frame without the deprecated timestamp field', () => {
    const payload = {
      channel: 'ohlc',
      type: 'update',
      data: [baseData],
    };

    const result = krakenMessageSchema.safeParse(payload);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.channel).toBe('ohlc');
  });

  it('rejects a frame with string ohlc values (old wire format)', () => {
    const payload = {
      channel: 'ohlc',
      type: 'update',
      data: [
        {
          ...baseData,
          open: '0.09875',
          high: '0.09875',
          low: '0.09875',
          close: '0.09875',
          volume: '201.86015',
          vwap: '0.09875',
        },
      ],
    };

    const result = krakenMessageSchema.safeParse(payload);
    expect(result.success).toBe(false);
  });
});
