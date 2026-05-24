import { describe, it, expect, beforeEach } from 'vitest';
import { simulateMarketOrder } from '../simulate';
import { OrderBook } from '@/lib/orderbook/orderbook';
import type { Level } from '@/lib/orderbook/orderbook';
import { Decimal } from '@/lib/money/decimal';

function level(price: string, qty: string): Level {
  return {
    price: new Decimal(price),
    qty: new Decimal(qty),
    rawPrice: price,
    rawQty: qty,
  };
}

function makeBook(bids: Level[], asks: Level[]): OrderBook {
  const book = new OrderBook();
  book.applySnapshot(bids, asks);
  return book;
}

// 26 bps = 0.26% taker fee, matching production
const FEE_BPS = 26;

describe('simulateMarketOrder', () => {
  describe('buy — single-level fill', () => {
    it('fills entirely at the best ask when liquidity is sufficient', () => {
      const book = makeBook([], [level('50000', '2')]);
      const result = simulateMarketOrder('buy', new Decimal(1), book, FEE_BPS);
      expect(result).not.toBeNull();
      expect(result!.filledSize.toNumber()).toBe(1);
      expect(result!.averagePrice.toNumber()).toBe(50000);
      expect(result!.insufficientLiquidity).toBe(false);
      expect(result!.levelFills).toHaveLength(1);
    });

    it('computes fee correctly', () => {
      const book = makeBook([], [level('50000', '1')]);
      const result = simulateMarketOrder('buy', new Decimal(1), book, FEE_BPS);
      // notional = 1 * 50000 = 50000; fee = 50000 * 26/10000 = 130
      expect(result!.totalCost.toNumber()).toBe(50000);
      expect(result!.totalFee.toNumber()).toBeCloseTo(130, 8);
    });
  });

  describe('buy — multi-level fill with slippage', () => {
    it('walks the book across multiple ask levels', () => {
      const book = makeBook(
        [],
        [
          level('50000', '1'), // level 1: 1 BTC @ 50000
          level('50100', '1'), // level 2: 1 BTC @ 50100
          level('50200', '1'), // level 3: 1 BTC @ 50200
        ],
      );
      // Buy 2.5 BTC: fills level1 (1), level2 (1), level3 (0.5)
      const result = simulateMarketOrder('buy', new Decimal(2.5), book, FEE_BPS);
      expect(result).not.toBeNull();
      expect(result!.filledSize.toNumber()).toBe(2.5);
      expect(result!.insufficientLiquidity).toBe(false);
      expect(result!.levelFills).toHaveLength(3);
      // avgPrice = (1*50000 + 1*50100 + 0.5*50200) / 2.5 = 125200 / 2.5 = 50080
      expect(result!.averagePrice.toNumber()).toBe(50080);
    });

    it('reports slippage relative to the best ask (reference price)', () => {
      const book = makeBook(
        [],
        [level('50000', '1'), level('50200', '1')],
      );
      // Buy 1.5 BTC: fills 1 @ 50000, 0.5 @ 50200
      // avg = (50000 + 0.5*50200) / 1.5 = 75100 / 1.5 = 50066.666...
      // slippage = |50066.666 - 50000| / 50000 * 10000 ≈ 13.33 bps
      const result = simulateMarketOrder('buy', new Decimal(1.5), book, FEE_BPS);
      expect(result!.slippageBps.greaterThan(0)).toBe(true);
    });
  });

  describe('sell — single-level fill', () => {
    it('fills entirely at the best bid when liquidity is sufficient', () => {
      const book = makeBook([level('49900', '5')], []);
      const result = simulateMarketOrder('sell', new Decimal(2), book, FEE_BPS);
      expect(result).not.toBeNull();
      expect(result!.filledSize.toNumber()).toBe(2);
      expect(result!.averagePrice.toNumber()).toBe(49900);
      expect(result!.insufficientLiquidity).toBe(false);
    });
  });

  describe('insufficient liquidity', () => {
    it('flags partial fill when order exceeds available liquidity', () => {
      const book = makeBook([], [level('50000', '1')]);
      // Try to buy 3 BTC but only 1 is available
      const result = simulateMarketOrder('buy', new Decimal(3), book, FEE_BPS);
      expect(result).not.toBeNull();
      expect(result!.insufficientLiquidity).toBe(true);
      expect(result!.filledSize.toNumber()).toBe(1);
    });

    it('partial fill amount matches available liquidity across levels', () => {
      const book = makeBook(
        [],
        [level('50000', '0.5'), level('50100', '0.5')],
      );
      const result = simulateMarketOrder('buy', new Decimal(5), book, FEE_BPS);
      expect(result!.filledSize.toNumber()).toBe(1);
      expect(result!.insufficientLiquidity).toBe(true);
    });
  });

  describe('empty book', () => {
    it('returns null for a buy when the ask side is empty', () => {
      const book = makeBook([level('49900', '1')], []);
      expect(simulateMarketOrder('buy', new Decimal(1), book, FEE_BPS)).toBeNull();
    });

    it('returns null for a sell when the bid side is empty', () => {
      const book = makeBook([], [level('50000', '1')]);
      expect(simulateMarketOrder('sell', new Decimal(1), book, FEE_BPS)).toBeNull();
    });

    it('returns null when the entire book is empty', () => {
      const book = new OrderBook();
      expect(simulateMarketOrder('buy', new Decimal(1), book, FEE_BPS)).toBeNull();
    });
  });

  describe('zero-size order', () => {
    it('returns null for size zero', () => {
      const book = makeBook([], [level('50000', '1')]);
      // filledSize = 0 → simulateMarketOrder returns null
      expect(simulateMarketOrder('buy', new Decimal(0), book, FEE_BPS)).toBeNull();
    });
  });
});
