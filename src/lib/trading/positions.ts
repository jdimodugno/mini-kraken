import { Decimal } from '@/lib/money/decimal';
import type { OrderBook } from '@/lib/orderbook/orderbook';
import type { Side } from './types';

export interface Position {
  symbol: string;
  // 'long' = net positive base currency exposure; 'short' = net negative.
  side: 'long' | 'short';
  size: Decimal;
  averageEntryPrice: Decimal;
  // totalCostBasis accumulates (fillSize * fillPrice + entryFee) across all
  // opening fills. Used for fast realized P&L without re-walking fill history.
  // Sign convention: always positive. For shorts, P&L = costBasis - exitNotional.
  totalCostBasis: Decimal;
  realizedPnl: Decimal;
}

export function emptyPosition(symbol: string, side: 'long' | 'short'): Position {
  return {
    symbol,
    side,
    size: new Decimal(0),
    averageEntryPrice: new Decimal(0),
    totalCostBasis: new Decimal(0),
    realizedPnl: new Decimal(0),
  };
}

// Maps order fill side to position direction.
function fillSideToPositionSide(fillSide: Side): 'long' | 'short' {
  return fillSide === 'buy' ? 'long' : 'short';
}

function isSameDirection(pos: Position, fillSide: Side): boolean {
  return pos.side === fillSideToPositionSide(fillSide);
}

// Worked example (all three cases):
//
// Case 1 — Open/Add:
//   Flat → buy 2 BTC @ 50,000, fee=200
//   size=2, costBasis=100200, avgEntry=50100
//
// Case 2 — Reduce:
//   Long 2 @ 50100 (costBasis=100200) → sell 1 @ 51,000, fee=102
//   closingProportion=0.5, closedCostBasis=50100, closingNotional=51000
//   realizedPnl = 51000 - 50100 - 102 = 798
//   remaining: size=1, costBasis=50100, avgEntry unchanged=50100
//
// Case 3 — Flip:
//   Long 1 @ 50100 (costBasis=50100) → sell 2 @ 52,000, fee=208
//   feeSplit: close fee = 208 * (1/2) = 104, open fee = 104
//   Close 1: realizedPnl = 52000 - 50100 - 104 = 1796
//   Open short 1 @ 52,000: costBasis = 1*52000 + 104 = 52104, avgEntry=52104

export function applyFillToPosition(
  position: Position,
  fillSide: Side,
  fillSize: Decimal,
  fillPrice: Decimal,
  fillFee: Decimal,
): Position {
  const isFlat = position.size.eq(0);

  if (isFlat || isSameDirection(position, fillSide)) {
    // Case 1: Opening or adding to existing position.
    const newSize = position.size.plus(fillSize);
    const newCostBasis = position.totalCostBasis.plus(fillSize.times(fillPrice)).plus(fillFee);
    const newAvgEntry = newCostBasis.div(newSize);

    return {
      ...position,
      side: isFlat ? fillSideToPositionSide(fillSide) : position.side,
      size: newSize,
      averageEntryPrice: newAvgEntry,
      totalCostBasis: newCostBasis,
    };
  }

  if (fillSize.lte(position.size)) {
    // Case 2: Reducing — fillSize closes part (or all) of the position.
    const closingProportion = fillSize.div(position.size);
    const closedCostBasis = position.totalCostBasis.times(closingProportion);
    const closingNotional = fillSize.times(fillPrice);

    // P&L sign convention:
    //   long:  you paid closedCostBasis to acquire; receive closingNotional on exit.
    //   short: you received closedCostBasis (at entry); pay closingNotional to exit.
    const realized =
      position.side === 'long'
        ? closingNotional.minus(closedCostBasis).minus(fillFee)
        : closedCostBasis.minus(closingNotional).minus(fillFee);

    const newSize = position.size.minus(fillSize);
    const newCostBasis = position.totalCostBasis.minus(closedCostBasis);

    return {
      ...position,
      size: newSize,
      // avgEntry unchanged on partial close — cost basis shrinks proportionally.
      totalCostBasis: newCostBasis,
      realizedPnl: position.realizedPnl.plus(realized),
    };
  }

  // Case 3: Flipping — fill is larger than the current position.
  // Split fee proportionally: closeFee for the closing portion, openFee for the new leg.
  const closeSize = position.size;
  const openSize = fillSize.minus(closeSize);
  const closeFee = fillFee.times(closeSize.div(fillSize));
  const openFee = fillFee.minus(closeFee);

  // Close the existing position fully.
  const closingNotional = closeSize.times(fillPrice);
  const realizedOnClose =
    position.side === 'long'
      ? closingNotional.minus(position.totalCostBasis).minus(closeFee)
      : position.totalCostBasis.minus(closingNotional).minus(closeFee);

  // Open a new position in the opposite direction with the leftover size.
  const newPositionSide: 'long' | 'short' = position.side === 'long' ? 'short' : 'long';
  const newCostBasis = openSize.times(fillPrice).plus(openFee);
  const newAvgEntry = newCostBasis.div(openSize);

  return {
    symbol: position.symbol,
    side: newPositionSide,
    size: openSize,
    averageEntryPrice: newAvgEntry,
    totalCostBasis: newCostBasis,
    realizedPnl: position.realizedPnl.plus(realizedOnClose),
  };
}

export function computeUnrealizedPnl(position: Position, markPrice: Decimal): Decimal {
  if (position.size.eq(0)) return new Decimal(0);

  // long:  (markPrice - avgEntry) * size  — positive when mark > entry
  // short: (avgEntry - markPrice) * size  — positive when entry > mark
  return position.side === 'long'
    ? markPrice.minus(position.averageEntryPrice).times(position.size)
    : position.averageEntryPrice.minus(markPrice).times(position.size);
}

// Side-aware mark price: use the price you'd actually exit at.
// Long exits via a sell → you receive the bid price.
// Short exits via a buy → you pay the ask price.
export function chooseMarkPrice(position: Position, book: OrderBook): Decimal | null {
  const { bestBid, bestAsk } = book.topOfBook();
  if (position.side === 'long') {
    return bestBid?.price ?? null;
  }
  return bestAsk?.price ?? null;
}
