import { describe, it, expect } from 'vitest';
import {
  applyFillToPosition,
  computeUnrealizedPnl,
  emptyPosition,
} from '../positions';
import { Decimal } from '@/lib/money/decimal';

// Shortcuts to reduce noise in test assertions
const D = (v: string | number) => new Decimal(v);

describe('applyFillToPosition', () => {
  describe('opening a position', () => {
    it('opens a long from a flat position', () => {
      const pos = emptyPosition('BTC/USD', 'long');
      const result = applyFillToPosition(pos, 'buy', D(2), D(50000), D(200));
      expect(result.side).toBe('long');
      expect(result.size.toNumber()).toBe(2);
      // costBasis = 2*50000 + 200 = 100200; avgEntry = 100200/2 = 50100
      expect(result.averageEntryPrice.toNumber()).toBe(50100);
      expect(result.totalCostBasis.toNumber()).toBe(100200);
      expect(result.realizedPnl.toNumber()).toBe(0);
    });

    it('opens a short from a flat position', () => {
      const pos = emptyPosition('BTC/USD', 'long');
      const result = applyFillToPosition(pos, 'sell', D(1), D(50000), D(100));
      expect(result.side).toBe('short');
      expect(result.size.toNumber()).toBe(1);
    });
  });

  describe('weighted average entry price', () => {
    it('computes weighted average across two buys', () => {
      const pos = emptyPosition('BTC/USD', 'long');
      // Buy 1 BTC @ 50000, fee=100 → costBasis=50100, avgEntry=50100
      const after1 = applyFillToPosition(pos, 'buy', D(1), D(50000), D(100));
      // Buy 1 BTC @ 52000, fee=104 → costBasis=50100+52104=102204, avgEntry=51102
      const after2 = applyFillToPosition(after1, 'buy', D(1), D(52000), D(104));
      expect(after2.size.toNumber()).toBe(2);
      expect(after2.totalCostBasis.toNumber()).toBe(102204);
      expect(after2.averageEntryPrice.toNumber()).toBe(51102);
    });
  });

  describe('reducing a long position (Case 2)', () => {
    it('computes realized P&L on partial close', () => {
      // Long 2 @ costBasis=100200 (avgEntry=50100)
      const pos = emptyPosition('BTC/USD', 'long');
      const after1 = applyFillToPosition(pos, 'buy', D(2), D(50000), D(200));

      // Sell 1 @ 51000, fee=102
      // closingProportion=0.5, closedCostBasis=50100, notional=51000
      // realized = 51000 - 50100 - 102 = 798
      const afterClose = applyFillToPosition(after1, 'sell', D(1), D(51000), D(102));
      expect(afterClose.size.toNumber()).toBe(1);
      expect(afterClose.realizedPnl.toNumber()).toBe(798);
      expect(afterClose.totalCostBasis.toNumber()).toBe(50100);
    });

    it('produces negative realized P&L when closing at a loss', () => {
      const pos = emptyPosition('BTC/USD', 'long');
      const opened = applyFillToPosition(pos, 'buy', D(1), D(50000), D(0));
      const closed = applyFillToPosition(opened, 'sell', D(1), D(48000), D(0));
      expect(closed.realizedPnl.toNumber()).toBe(-2000);
    });
  });

  describe('position flip (Case 3)', () => {
    it('flips from long to short when sell exceeds long size', () => {
      // Long 1 @ costBasis=50100 (avgEntry=50100)
      const pos = emptyPosition('BTC/USD', 'long');
      const after1 = applyFillToPosition(pos, 'buy', D(1), D(50000), D(100));

      // Sell 2 @ 52000, fee=208
      // closeSize=1, openSize=1
      // closeFee = 208 * (1/2) = 104, openFee = 104
      // realized = 52000 - 50100 - 104 = 1796
      // new short: costBasis = 1*52000 + 104 = 52104, avgEntry=52104
      const flipped = applyFillToPosition(after1, 'sell', D(2), D(52000), D(208));
      expect(flipped.side).toBe('short');
      expect(flipped.size.toNumber()).toBe(1);
      expect(flipped.realizedPnl.toNumber()).toBe(1796);
      expect(flipped.totalCostBasis.toNumber()).toBe(52104);
      expect(flipped.averageEntryPrice.toNumber()).toBe(52104);
    });

    it('flips from short to long when buy exceeds short size', () => {
      const pos = emptyPosition('BTC/USD', 'short');
      // Short 1 @ 50000, no fee
      const after1 = applyFillToPosition(pos, 'sell', D(1), D(50000), D(0));
      // Buy 2 @ 48000, no fee
      // realized on close = 50000 - 48000 = 2000
      // new long: size=1, costBasis=48000, avgEntry=48000
      const flipped = applyFillToPosition(after1, 'buy', D(2), D(48000), D(0));
      expect(flipped.side).toBe('long');
      expect(flipped.size.toNumber()).toBe(1);
      expect(flipped.realizedPnl.toNumber()).toBe(2000);
    });
  });

  describe('fees', () => {
    it('deducts fees from realized P&L when closing', () => {
      const pos = emptyPosition('BTC/USD', 'long');
      const opened = applyFillToPosition(pos, 'buy', D(1), D(50000), D(0));
      // Without fee: realized = 51000 - 50000 = 1000
      // With fee=100: realized = 900
      const closed = applyFillToPosition(opened, 'sell', D(1), D(51000), D(100));
      expect(closed.realizedPnl.toNumber()).toBe(900);
    });
  });
});

describe('computeUnrealizedPnl', () => {
  it('is positive for a long when mark price rises above entry', () => {
    const pos = emptyPosition('BTC/USD', 'long');
    const opened = applyFillToPosition(pos, 'buy', D(1), D(50000), D(0));
    // avgEntry = 50000, mark = 52000 → unrealized = (52000 - 50000) * 1 = 2000
    const pnl = computeUnrealizedPnl(opened, D(52000));
    expect(pnl.toNumber()).toBe(2000);
  });

  it('is negative for a long when mark price falls below entry', () => {
    const pos = emptyPosition('BTC/USD', 'long');
    const opened = applyFillToPosition(pos, 'buy', D(1), D(50000), D(0));
    const pnl = computeUnrealizedPnl(opened, D(48000));
    expect(pnl.toNumber()).toBe(-2000);
  });

  it('is positive for a short when mark price falls below entry', () => {
    const pos = emptyPosition('BTC/USD', 'short');
    const opened = applyFillToPosition(pos, 'sell', D(1), D(50000), D(0));
    // avgEntry = 50000, mark = 48000 → unrealized = (50000 - 48000) * 1 = 2000
    const pnl = computeUnrealizedPnl(opened, D(48000));
    expect(pnl.toNumber()).toBe(2000);
  });

  it('is negative for a short when mark price rises above entry', () => {
    const pos = emptyPosition('BTC/USD', 'short');
    const opened = applyFillToPosition(pos, 'sell', D(1), D(50000), D(0));
    const pnl = computeUnrealizedPnl(opened, D(52000));
    expect(pnl.toNumber()).toBe(-2000);
  });

  it('is zero for a flat position', () => {
    const pos = emptyPosition('BTC/USD', 'long');
    // size = 0
    const pnl = computeUnrealizedPnl(pos, D(50000));
    expect(pnl.toNumber()).toBe(0);
  });
});
