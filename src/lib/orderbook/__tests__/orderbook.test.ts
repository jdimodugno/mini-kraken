import { describe, it, expect, beforeEach } from 'vitest';
import { OrderBook } from '../orderbook';
import type { Level } from '../orderbook';
import { Decimal } from '@/lib/money/decimal';

function level(price: string, qty: string): Level {
  return {
    price: new Decimal(price),
    qty: new Decimal(qty),
    rawPrice: price,
    rawQty: qty,
  };
}

describe('OrderBook', () => {
  let book: OrderBook;

  beforeEach(() => {
    book = new OrderBook();
  });

  describe('applySnapshot', () => {
    it('returns bids in descending order regardless of input order', () => {
      book.applySnapshot(
        [level('100', '1'), level('102', '2'), level('101', '3')],
        [],
      );
      const bids = book.getBids(3);
      expect(bids[0]!.price.toNumber()).toBe(102);
      expect(bids[1]!.price.toNumber()).toBe(101);
      expect(bids[2]!.price.toNumber()).toBe(100);
    });

    it('returns asks in ascending order regardless of input order', () => {
      book.applySnapshot(
        [],
        [level('103', '1'), level('101', '2'), level('102', '3')],
      );
      const asks = book.getAsks(3);
      expect(asks[0]!.price.toNumber()).toBe(101);
      expect(asks[1]!.price.toNumber()).toBe(102);
      expect(asks[2]!.price.toNumber()).toBe(103);
    });

    it('replaces a previous snapshot entirely', () => {
      book.applySnapshot([level('100', '1')], [level('101', '1')]);
      book.applySnapshot([level('200', '5')], [level('201', '5')]);
      expect(book.getBids(10)).toHaveLength(1);
      expect(book.getBids(1)[0]!.price.toNumber()).toBe(200);
    });
  });

  describe('applyUpdate — insert', () => {
    it('inserts a new bid at the correct descending position', () => {
      book.applySnapshot(
        [level('102', '1'), level('100', '1')],
        [],
      );
      book.applyUpdate([level('101', '2')], []);
      const bids = book.getBids(3);
      expect(bids[0]!.price.toNumber()).toBe(102);
      expect(bids[1]!.price.toNumber()).toBe(101);
      expect(bids[2]!.price.toNumber()).toBe(100);
    });

    it('inserts a new ask at the correct ascending position', () => {
      book.applySnapshot([], [level('101', '1'), level('103', '1')]);
      book.applyUpdate([], [level('102', '2')]);
      const asks = book.getAsks(3);
      expect(asks[0]!.price.toNumber()).toBe(101);
      expect(asks[1]!.price.toNumber()).toBe(102);
      expect(asks[2]!.price.toNumber()).toBe(103);
    });
  });

  describe('applyUpdate — remove', () => {
    it('removes a bid level when qty is 0', () => {
      book.applySnapshot([level('102', '3'), level('100', '1')], []);
      book.applyUpdate([level('102', '0')], []);
      const bids = book.getBids(10);
      expect(bids).toHaveLength(1);
      expect(bids[0]!.price.toNumber()).toBe(100);
    });

    it('removes an ask level when qty is 0', () => {
      book.applySnapshot([], [level('101', '2'), level('103', '1')]);
      book.applyUpdate([], [level('101', '0')]);
      const asks = book.getAsks(10);
      expect(asks).toHaveLength(1);
      expect(asks[0]!.price.toNumber()).toBe(103);
    });

    it('is a no-op when removing a price that does not exist', () => {
      book.applySnapshot([level('100', '1')], []);
      const result = book.applyUpdate([level('999', '0')], []);
      expect(book.getBids(10)).toHaveLength(1);
      // Price 999 was not in the book, so bidsChanged should be empty
      expect(result.bidsChanged).toHaveLength(0);
    });
  });

  describe('applyUpdate — modify', () => {
    it('updates the quantity of an existing level without changing sort order', () => {
      book.applySnapshot([level('102', '1'), level('100', '1')], []);
      book.applyUpdate([level('100', '5')], []);
      const bids = book.getBids(10);
      const level100 = bids.find((l) => l.price.toNumber() === 100);
      expect(level100!.qty.toNumber()).toBe(5);
      // Order unchanged
      expect(bids[0]!.price.toNumber()).toBe(102);
    });
  });

  describe('topChanged', () => {
    it('is true when the best bid changes', () => {
      book.applySnapshot([level('100', '1'), level('99', '1')], [level('101', '1')]);
      const result = book.applyUpdate([level('100', '0')], []);
      expect(result.topChanged).toBe(true);
    });

    it('is true when the best ask changes', () => {
      book.applySnapshot([level('100', '1')], [level('101', '1'), level('102', '1')]);
      const result = book.applyUpdate([], [level('101', '0')]);
      expect(result.topChanged).toBe(true);
    });

    it('is false for a non-top bid update', () => {
      book.applySnapshot(
        [level('102', '1'), level('100', '1'), level('99', '1')],
        [level('103', '1')],
      );
      // Updating a non-top bid (price 99) — best bid is 102, unchanged
      const result = book.applyUpdate([level('99', '5')], []);
      expect(result.topChanged).toBe(false);
    });

    it('is false for a non-top ask update', () => {
      book.applySnapshot(
        [level('100', '1')],
        [level('101', '1'), level('103', '1')],
      );
      // Updating a non-top ask (price 103) — best ask is 101, unchanged
      const result = book.applyUpdate([], [level('103', '5')]);
      expect(result.topChanged).toBe(false);
    });
  });

  describe('getSpread', () => {
    it('returns the correct spread (bestAsk - bestBid)', () => {
      book.applySnapshot([level('100', '1')], [level('101', '1')]);
      const spread = book.getSpread();
      expect(spread).not.toBeNull();
      expect(spread!.toNumber()).toBe(1);
    });

    it('returns null when the book is empty', () => {
      expect(book.getSpread()).toBeNull();
    });

    it('returns null when only bids exist', () => {
      book.applySnapshot([level('100', '1')], []);
      expect(book.getSpread()).toBeNull();
    });

    it('returns null when only asks exist', () => {
      book.applySnapshot([], [level('101', '1')]);
      expect(book.getSpread()).toBeNull();
    });
  });

  describe('getBestBidPrice / getBestAskPrice', () => {
    it('returns null for an empty book', () => {
      expect(book.getBestBidPrice()).toBeNull();
      expect(book.getBestAskPrice()).toBeNull();
    });

    it('returns the top bid and ask prices without array allocation', () => {
      book.applySnapshot(
        [level('100', '1'), level('102', '2'), level('101', '3')],
        [level('103', '1'), level('105', '2')],
      );
      expect(book.getBestBidPrice()?.toNumber()).toBe(102);
      expect(book.getBestAskPrice()?.toNumber()).toBe(103);
    });

    it('returns null ask when only bids exist', () => {
      book.applySnapshot([level('100', '1')], []);
      expect(book.getBestBidPrice()?.toNumber()).toBe(100);
      expect(book.getBestAskPrice()).toBeNull();
    });

    it('returns null bid when only asks exist', () => {
      book.applySnapshot([], [level('101', '1')]);
      expect(book.getBestBidPrice()).toBeNull();
      expect(book.getBestAskPrice()?.toNumber()).toBe(101);
    });
  });

  describe('getBids / getAsks depth', () => {
    it('respects the depth argument', () => {
      book.applySnapshot(
        [level('103', '1'), level('102', '1'), level('101', '1'), level('100', '1')],
        [],
      );
      expect(book.getBids(2)).toHaveLength(2);
      expect(book.getBids(2)[0]!.price.toNumber()).toBe(103);
    });
  });
});
