import { Decimal } from '@/lib/money/decimal';
import type { OrderBook } from '@/lib/orderbook/orderbook';
import type { Side } from './types';

export interface SimulationResult {
  // The average price across all fills.
  averagePrice: Decimal;
  // Total base currency filled.
  filledSize: Decimal;
  // Total quote currency spent / received (excluding fees).
  totalCost: Decimal;
  // Total fees paid.
  totalFee: Decimal;
  // Slippage vs top-of-book price, in basis points.
  slippageBps: Decimal;
  // True when the book did not have enough liquidity to fill the full size.
  insufficientLiquidity: boolean;
  // Individual level fills for auditability.
  levelFills: Array<{ price: Decimal; size: Decimal; fee: Decimal }>;
}

/**
 * Simulate a market order against a live order book snapshot.
 *
 * @param side - Direction of the order: 'buy' walks asks ascending, 'sell' walks bids descending.
 * @param size - Base currency quantity to fill (must be positive).
 * @param book - Current order book snapshot.
 * @param feeBps - Taker fee in integer basis points (e.g. 25 = 0.25%). Must be a non-negative integer.
 * @returns SimulationResult with fill details, or null if the relevant side of the book is empty.
 */
export function simulateMarketOrder(
  side: Side,
  size: Decimal,
  book: OrderBook,
  feeBps: number,
): SimulationResult | null {
  if (!Number.isInteger(feeBps) || feeBps < 0) {
    throw new Error(
      `feeBps must be a non-negative integer (received ${feeBps}). Pass e.g. 25 for 0.25%.`,
    );
  }

  const levels = side === 'buy' ? book.getAsks(100) : book.getBids(100);

  if (levels.length === 0) return null;

  const referencePrice = levels[0]!.price;
  const feeRate = new Decimal(feeBps).div(10000);

  let remaining = size;
  let totalCost = new Decimal(0);
  let totalFee = new Decimal(0);
  const levelFills: Array<{ price: Decimal; size: Decimal; fee: Decimal }> = [];

  for (const level of levels) {
    if (remaining.lte(0)) break;

    const filledAtLevel = Decimal.min(level.qty, remaining);
    const notional = filledAtLevel.times(level.price);
    const fee = notional.times(feeRate);

    totalCost = totalCost.plus(notional);
    totalFee = totalFee.plus(fee);
    levelFills.push({ price: level.price, size: filledAtLevel, fee });

    remaining = remaining.minus(filledAtLevel);
  }

  const filledSize = size.minus(remaining);

  if (filledSize.lte(0)) return null;

  const averagePrice = totalCost.div(filledSize);

  // Slippage is abs value of (avgFill - reference) / reference * 10000 bps.
  // Side-aware sign: for a buy, paying above reference is positive slippage (bad);
  // for a sell, receiving below reference is positive slippage (bad).
  // We return abs value so callers don't need to be side-aware for display.
  const slippageBps = averagePrice.minus(referencePrice).abs().div(referencePrice).times(10000);

  return {
    averagePrice,
    filledSize,
    totalCost,
    totalFee,
    slippageBps,
    insufficientLiquidity: remaining.gt(0),
    levelFills,
  };
}
