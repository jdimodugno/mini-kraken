# Phase 4b: P&L Tracking & Decimal Precision

**Goal:** Track open positions from filled orders, compute unrealized P&L that updates in real-time as prices move, and replace floating-point math with a decimal library in all money paths. Show realized P&L when positions close.

**Estimated time:** 1 day

## Learning Objectives

1. Why floating-point arithmetic is dangerous for money and what to use instead
2. The difference between realized and unrealized P&L
3. What "mark price" is, why it matters, and how to choose one
4. How to model positions (long/short, average entry, current size)
5. How position-closing orders interact with existing positions (FIFO/LIFO/weighted average)

## Why This Matters for the Interview

This is the credibility test. Asked "describe a financial nuance you handled," you want to be able to say:

> *"I learned the hard way that JavaScript's `0.1 + 0.2 === 0.30000000000000004` is a production incident in trading. A user buys 0.1 BTC three times, the UI shows them owning '0.30000000000000004 BTC,' and they file a support ticket. Worse, fee calculations accumulate floating-point error over many trades. I moved all money math to `decimal.js` with explicit precision, and only converted to `number` at the display boundary."*

That answer signals you've thought about real-world consequences.

## Background: Floating Point and Money

The classic JS demo:

```javascript
0.1 + 0.2                    // 0.30000000000000004
0.1 + 0.2 === 0.3            // false
(1.005).toFixed(2)           // "1.00" (you'd expect "1.01")
50000.05 - 49999.95          // 0.10000000000291038
```

These aren't bugs; they're how IEEE 754 binary floats represent decimal fractions (badly). For pixel positions, this is invisible. For money, it accumulates and shows up.

The fix: a library that does arbitrary-precision decimal arithmetic. Options:

| Library | Pros | Cons |
|---------|------|------|
| `decimal.js` | Mature, well-tested | ~30kb, slower than native |
| `big.js` | Smaller (~5kb) | Less feature-rich |
| `bignumber.js` | Same family as big.js, more features | Larger |
| Native `BigInt` | Built-in, zero deps | Integer only — you must scale (cents, satoshis) |

**Pick `decimal.js` for this exercise.** Document the alternatives.

```bash
pnpm add decimal.js
```

**Interview talking point:** *"For maximum performance I'd use scaled `BigInt` (representing prices as integer hundredths). For developer ergonomics in a project this size, `decimal.js` is the better trade-off. Real exchanges use scaled integers internally."*

## What You're Building

```typescript
interface Position {
  symbol: string;
  side: 'long' | 'short';
  size: Decimal;
  averageEntryPrice: Decimal;
  unrealizedPnl: Decimal;  // computed from current mark
  realizedPnl: Decimal;    // accumulated from closing fills
}
```

Plus a "Positions" UI panel showing live unrealized P&L per position, and lifetime realized P&L.

## Step-by-Step Build

### Step 1: Centralize the Decimal import

`src/lib/money/decimal.ts`:

```typescript
import Decimal from 'decimal.js';

Decimal.set({
  precision: 28,         // significant digits
  rounding: Decimal.ROUND_HALF_EVEN, // banker's rounding — least biased
  toExpNeg: -7,
  toExpPos: 21,
});

export { Decimal };

// Helpers for the conversion boundary
export function toDecimal(v: number | string | Decimal): Decimal {
  return v instanceof Decimal ? v : new Decimal(v);
}

export function toNumber(d: Decimal): number {
  return d.toNumber();
}

export function toDisplayString(d: Decimal, dp: number): string {
  return d.toFixed(dp);
}
```

**Why banker's rounding?** Standard "round half up" introduces a positive bias when summed over many values. Banker's rounding (round half to even) is unbiased — used in financial regulations like IEEE 754 round-half-to-even. Mention this in the interview if asked about precision choices.

### Step 2: Update fill simulation to use Decimal

Refactor `simulateMarketOrder` from Phase 4a:

```typescript
import { Decimal } from '@/lib/money/decimal';

interface SimulationResult {
  fills: Array<{ price: Decimal; size: Decimal; fee: Decimal }>;
  filledSize: Decimal;
  averagePrice: Decimal;
  totalCost: Decimal;
  totalFee: Decimal;
  slippageBps: Decimal;
  insufficientLiquidity: boolean;
}

export function simulateMarketOrder({ side, size, book, feeBps }: {
  side: Side;
  size: Decimal;
  book: OrderBook;
  feeBps: number;
}): SimulationResult {
  const levels = side === 'buy' ? book.getAsks(100) : book.getBids(100);
  if (levels.length === 0) return emptyResult(true);

  const referencePrice = new Decimal(levels[0].price);
  const feeBpsD = new Decimal(feeBps).div(10_000);

  let remaining = size;
  let totalCost = new Decimal(0);
  const fills: SimulationResult['fills'] = [];

  for (const level of levels) {
    if (remaining.lte(0)) break;
    const levelPrice = new Decimal(level.price);
    const levelQty = new Decimal(level.qty);
    const filledAtLevel = Decimal.min(levelQty, remaining);
    const notional = filledAtLevel.mul(levelPrice);
    const fee = notional.mul(feeBpsD);
    fills.push({ price: levelPrice, size: filledAtLevel, fee });
    totalCost = totalCost.add(notional);
    remaining = remaining.sub(filledAtLevel);
  }

  const filledSize = size.sub(remaining);
  const averagePrice = filledSize.gt(0) ? totalCost.div(filledSize) : new Decimal(0);
  const totalFee = fills.reduce((sum, f) => sum.add(f.fee), new Decimal(0));
  const slippageBps = filledSize.gt(0)
    ? averagePrice.sub(referencePrice).abs().div(referencePrice).mul(10_000)
    : new Decimal(0);

  return {
    fills, filledSize, averagePrice, totalCost, totalFee, slippageBps,
    insufficientLiquidity: remaining.gt(0),
  };
}
```

**Note:** `Decimal` objects are immutable. Every operation returns a new instance. The garbage pressure is real but small at our volumes.

**Interview drill:** "Are there places where regular JavaScript numbers are fine?" Yes — display formatting (humans can't see sub-cent precision), animation positions, sort comparisons by approximate value. Reserve Decimal for *accumulating* money math.

### Step 3: Define the position model

`src/lib/trading/positions.ts`:

```typescript
import { Decimal } from '@/lib/money/decimal';
import type { FilledOrder } from './types';

export interface Position {
  symbol: string;
  side: 'long' | 'short';
  size: Decimal;                // current open size
  averageEntryPrice: Decimal;   // weighted by fill size
  totalCostBasis: Decimal;      // size * avg entry, kept for fast P&L math
  realizedPnl: Decimal;         // from prior partial closes
}

export function emptyPosition(symbol: string, side: 'long' | 'short'): Position {
  return {
    symbol, side,
    size: new Decimal(0),
    averageEntryPrice: new Decimal(0),
    totalCostBasis: new Decimal(0),
    realizedPnl: new Decimal(0),
  };
}
```

### Step 4: Apply fills to positions

This is the interesting accounting logic. A fill in the same direction as the position *increases* it (and updates the weighted-average entry price). A fill in the opposite direction *reduces* it (and realizes P&L on the closed portion). A fill larger than the position flips it (closes existing + opens new in opposite direction).

```typescript
export function applyFillToPosition(
  position: Position,
  fillSide: 'buy' | 'sell',
  fillSize: Decimal,
  fillPrice: Decimal,
  fillFee: Decimal,
): Position {
  // Convention: long means we own; short means we owe.
  // A 'buy' increases long / reduces short.
  // A 'sell' increases short / reduces long.

  const positionDirection = position.size.gt(0) ? position.side : null;
  
  // Case 1: opening or adding to position in the same direction
  const isOpening =
    (fillSide === 'buy' && position.side === 'long') ||
    (fillSide === 'sell' && position.side === 'short') ||
    position.size.eq(0);

  if (isOpening) {
    const newSize = position.size.add(fillSize);
    const newCostBasis = position.totalCostBasis.add(fillSize.mul(fillPrice)).add(fillFee);
    const newAvgEntry = newCostBasis.div(newSize);
    return {
      ...position,
      side: fillSide === 'buy' ? 'long' : 'short',
      size: newSize,
      averageEntryPrice: newAvgEntry,
      totalCostBasis: newCostBasis,
    };
  }

  // Case 2: reducing position (opposite-side fill)
  if (fillSize.lte(position.size)) {
    // Partial or full close
    const closingProportion = fillSize.div(position.size);
    const closedCostBasis = position.totalCostBasis.mul(closingProportion);
    const closingNotional = fillSize.mul(fillPrice);
    // For longs: pnl = closingNotional - closedCostBasis - fee
    // For shorts: pnl = closedCostBasis - closingNotional - fee
    const pnl = position.side === 'long'
      ? closingNotional.sub(closedCostBasis).sub(fillFee)
      : closedCostBasis.sub(closingNotional).sub(fillFee);

    const newSize = position.size.sub(fillSize);
    const newCostBasis = newSize.eq(0) ? new Decimal(0) : position.totalCostBasis.sub(closedCostBasis);

    return {
      ...position,
      size: newSize,
      totalCostBasis: newCostBasis,
      // averageEntryPrice stays the same on a partial close
      realizedPnl: position.realizedPnl.add(pnl),
    };
  }

  // Case 3: flipping (close existing + open in opposite direction)
  const sizeToClose = position.size;
  const sizeToOpen = fillSize.sub(sizeToClose);
  const closingNotional = sizeToClose.mul(fillPrice);
  const proportionalFee = fillFee.mul(sizeToClose.div(fillSize));
  const remainingFee = fillFee.sub(proportionalFee);

  const pnl = position.side === 'long'
    ? closingNotional.sub(position.totalCostBasis).sub(proportionalFee)
    : position.totalCostBasis.sub(closingNotional).sub(proportionalFee);

  const newSide = fillSide === 'buy' ? 'long' : 'short';
  const newCostBasis = sizeToOpen.mul(fillPrice).add(remainingFee);

  return {
    symbol: position.symbol,
    side: newSide,
    size: sizeToOpen,
    totalCostBasis: newCostBasis,
    averageEntryPrice: newCostBasis.div(sizeToOpen),
    realizedPnl: position.realizedPnl.add(pnl),
  };
}
```

**This is dense code. Walk through it on paper with concrete numbers** before you trust it. Example: start flat, buy 1 BTC @ 50000, sell 2 BTC @ 51000. You should end up with -1 BTC short at average entry 51000, realized P&L of (51000 - 50000) = 1000 (minus fees) from closing the long, and zero unrealized P&L until prices move.

**Interview drill:** "Walk me through what happens if I buy 1 BTC at $50,000, then sell 2 BTC at $51,000." If you can do this in real-time on a whiteboard, you're golden.

### Step 5: Compute unrealized P&L

```typescript
export function computeUnrealizedPnl(position: Position, markPrice: Decimal): Decimal {
  if (position.size.eq(0)) return new Decimal(0);
  // Long: (markPrice - avgEntry) * size
  // Short: (avgEntry - markPrice) * size
  const priceDiff = position.side === 'long'
    ? markPrice.sub(position.averageEntryPrice)
    : position.averageEntryPrice.sub(markPrice);
  return priceDiff.mul(position.size);
}
```

### Step 6: Choose your mark price

This is a real decision worth defending.

Options:
1. **Last trade price** — simple, but can be stale or manipulated by a single tiny trade.
2. **Mid price** (`(bestBid + bestAsk) / 2`) — what most simple UIs show.
3. **Side-aware mark** — best bid for longs (price you'd sell into), best ask for shorts (price you'd buy to close). This is *conservative* — it reflects the immediate exit price.
4. **VWAP of recent trades** — smoother but lags.

For this project, **use side-aware mark for the position panel** (most honest about exit), and **mid for the chart header** (most stable to display).

Document this in `DECISIONS.md`: *"Position P&L uses side-aware mark price (best bid for long, best ask for short) because it represents the realizable exit value, not a hypothetical mid-spread number. Mid-price-marked positions look more profitable than they are."*

**Interview drill:** "Why does mark price matter?" Be ready to discuss this for 90 seconds.

### Step 7: Positions store

`src/stores/positions-store.ts`:

```typescript
import { create } from 'zustand';
import { Decimal } from '@/lib/money/decimal';
import { Position, emptyPosition, applyFillToPosition } from '@/lib/trading/positions';
import type { FilledOrder } from '@/lib/trading/types';

interface PositionsState {
  positions: Map<string, Position>;
  totalRealizedPnl: Decimal;
  applyFilledOrder: (order: FilledOrder) => void;
}

export const usePositionsStore = create<PositionsState>((set, get) => ({
  positions: new Map(),
  totalRealizedPnl: new Decimal(0),

  applyFilledOrder(order) {
    const existing = get().positions.get(order.symbol) ?? emptyPosition(order.symbol, 'long');
    let pos = existing;
    for (const fill of order.fills) {
      pos = applyFillToPosition(
        pos,
        order.side,
        new Decimal(fill.size.toString()),
        new Decimal(fill.price.toString()),
        new Decimal(fill.fee.toString()),
      );
    }
    set((s) => {
      const next = new Map(s.positions);
      if (pos.size.eq(0) && pos.realizedPnl.eq(0)) {
        next.delete(order.symbol);
      } else {
        next.set(order.symbol, pos);
      }
      return {
        positions: next,
        totalRealizedPnl: s.totalRealizedPnl.add(pos.realizedPnl.sub(existing.realizedPnl)),
      };
    });
  },
}));
```

Wire this into your trading store: after every fill, call `applyFilledOrder`.

### Step 8: Live unrealized P&L hook

```typescript
import { useMemo } from 'react';
import { Decimal } from '@/lib/money/decimal';
import { usePositionsStore } from '@/stores/positions-store';
import { useOrderBookStore } from '@/stores/orderbook-store';
import { computeUnrealizedPnl } from '@/lib/trading/positions';

export function usePositionWithPnl(symbol: string) {
  const position = usePositionsStore((s) => s.positions.get(symbol));
  const lastUpdate = useOrderBookStore((s) => s.lastUpdateAt.get(symbol) ?? 0);

  return useMemo(() => {
    if (!position) return null;
    const book = useOrderBookStore.getState().books.get(symbol);
    if (!book) return { position, markPrice: null, unrealizedPnl: new Decimal(0) };
    const { bestBid, bestAsk } = book.topOfBook();
    const markPrice = position.side === 'long'
      ? (bestBid ? new Decimal(bestBid.price) : null)
      : (bestAsk ? new Decimal(bestAsk.price) : null);
    if (!markPrice) return { position, markPrice: null, unrealizedPnl: new Decimal(0) };
    const unrealizedPnl = computeUnrealizedPnl(position, markPrice);
    return { position, markPrice, unrealizedPnl };
  }, [symbol, position, lastUpdate]);
}
```

### Step 9: Positions UI

```typescript
export function PositionsPanel() {
  const positions = usePositionsStore((s) => Array.from(s.positions.values()));
  const totalRealized = usePositionsStore((s) => s.totalRealizedPnl);
  return (
    <div>
      <div>Total realized P&L: <PnlText value={totalRealized} /></div>
      <table>
        <thead>...</thead>
        <tbody>
          {positions.map((p) => <PositionRow key={p.symbol} symbol={p.symbol} />)}
        </tbody>
      </table>
    </div>
  );
}

function PositionRow({ symbol }: { symbol: string }) {
  const data = usePositionWithPnl(symbol);
  if (!data) return null;
  const { position, markPrice, unrealizedPnl } = data;
  return (
    <tr>
      <td>{symbol}</td>
      <td>{position.side}</td>
      <td>{position.size.toFixed(8)}</td>
      <td>${position.averageEntryPrice.toFixed(2)}</td>
      <td>{markPrice ? `$${markPrice.toFixed(2)}` : '-'}</td>
      <td><PnlText value={unrealizedPnl} /></td>
      <td><PnlText value={position.realizedPnl} /></td>
    </tr>
  );
}

function PnlText({ value }: { value: Decimal }) {
  const color = value.gt(0) ? 'text-emerald-500' : value.lt(0) ? 'text-red-500' : 'text-slate-400';
  const prefix = value.gt(0) ? '+' : '';
  return <span className={color}>{prefix}${value.toFixed(2)}</span>;
}
```

## Common Mistakes

1. **Mixing `number` and `Decimal` in a single calculation** — `decimal.add(0.1 + 0.2)` carries the float error in. Convert at the boundary, then stay in Decimal.
2. **Using `Decimal.toNumber()` mid-pipeline** — Defeats the purpose. Only at display.
3. **Forgetting that `Decimal` is immutable** — `d.add(1)` returns a new Decimal; doesn't mutate `d`.
4. **Computing P&L without fees** — Real P&L is net of fees. Easy to forget on the close side.
5. **Wrong sign convention for shorts** — `(entry - mark) * size` for shorts. Many people get this backwards.
6. **Not handling position flips** — Selling 2 BTC when you own 1 should close the long and open a 1 BTC short. If your code only handles "reduce," you'll silently drop the rest.

## Verification Checklist

Run through these scenarios manually and verify the math:

- [ ] Buy 1 BTC at $50,000. Position: long 1 BTC @ avg $50,000.
- [ ] Price moves to $51,000. Unrealized P&L: +$1,000 (minus fees from entry).
- [ ] Buy another 1 BTC at $52,000. Position: long 2 BTC @ avg $51,000 (weighted).
- [ ] Sell 1 BTC at $53,000. Position: long 1 BTC @ avg $51,000. Realized P&L: +$2,000 (minus fees).
- [ ] Sell 2 BTC at $54,000. Position flips: short 1 BTC @ avg $54,000. Realized P&L should accumulate.
- [ ] All amounts shown in UI never display floating-point artifacts (no "0.30000000000000004").

## Interview Drill Questions

1. Why not use regular JS numbers for prices?
2. What's the difference between realized and unrealized P&L?
3. What's a mark price and why does it matter? Which one did you pick and why?
4. Walk me through what happens when I sell more than I own.
5. Why banker's rounding?
6. If I have a long position and the market gaps down through my entire stop, what happens?
7. How do partial fills affect average entry price?
8. What's the worst rounding error you could see in your system, and where would it accumulate?
9. How would you test the P&L math?
10. If we wanted to support leveraged positions (e.g., 5x), how would the model change? (Hint: liquidation prices, margin calls.)

## A Note for the Interview

When asked "describe a financial mechanic you understood deeply for this project," tell the position-flip story. It's specific, technical, demonstrates real domain knowledge, and shows you went past the obvious.

Once positions and P&L are reliable and the UI never shows weird float artifacts, move to `08-phase5-testing-polish.md`.
