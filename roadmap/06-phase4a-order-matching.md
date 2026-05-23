# Phase 4a: Order Entry & Fill Simulation

**Goal:** Build an order entry form (market and limit) that simulates fills against the live order book, including slippage preview. This phase directly addresses the job description's question about "understanding the underlying financial mechanics, not just implementing designs."

**Estimated time:** 2 days

## Learning Objectives

1. The mechanics of order matching: how a market order "walks the book"
2. The difference between market, limit, stop, and stop-limit orders (and why)
3. What slippage is, how to compute it, and why showing it to users matters
4. Maker vs. taker fees and how they shape user behavior
5. How to model an "open orders" list that fills opportunistically as market prices move

## Why This Matters for the Interview

This is the phase that lets you say in the interview: *"I understood the underlying financial mechanics. Here's what a market order actually does: it walks the book, consuming asks for a buy or bids for a sell, until the order quantity is filled. Each level consumed at a worse price than the previous one is slippage. I implemented that simulation locally so users can preview their fill before submitting."*

That answer wins the role.

## Background: How Order Matching Works

### Limit orders

A limit order says: "I want to buy 1 BTC at $50,000 or better (lower)." It sits in the order book at $50,000. It fills if someone else sells at $50,000 or below.

A limit order is a **maker** — it adds liquidity to the book. Exchanges typically charge a lower fee (or pay a rebate) for makers because they improve market depth.

### Market orders

A market order says: "I want to buy 1 BTC now, whatever the price." The exchange matches it against the best available asks immediately.

If the best ask is `0.3 BTC @ $50,000`, the next is `0.4 BTC @ $50,005`, the next is `0.5 BTC @ $50,010`, then buying 1 BTC fills as:
- 0.3 BTC at $50,000 = $15,000
- 0.4 BTC at $50,005 = $20,002
- 0.3 BTC at $50,010 = $15,003

Total: 1 BTC for $50,005 → average price = $50,005. The expected price (top of book) was $50,000, so slippage is $5/BTC, or 0.01%.

A market order is a **taker** — it removes liquidity. Higher fees.

### Why this matters for users

Users get genuinely surprised when a market order fills at a worse price than they expected. A good UI shows slippage *before* they confirm. This is what "trading domain expertise" looks like in product UX.

## What You're Building

```typescript
<OrderEntry symbol="BTC/USD" />
```

A panel with:
- Tabs: Market / Limit
- Side: Buy / Sell
- Size input
- Price input (limit only)
- "Total cost" preview
- Slippage indicator (market orders)
- Fee preview
- Confirm button → fills against the live book, creates a position

Plus:
- An "Open orders" list (limit orders waiting to fill)
- Background process that fills limit orders when market crosses their price

## Step-by-Step Build

### Step 1: Type the domain model

`src/lib/trading/types.ts`:

```typescript
export type Side = 'buy' | 'sell';
export type OrderType = 'market' | 'limit';

export interface OrderRequest {
  symbol: string;
  side: Side;
  type: OrderType;
  size: number;        // in base asset (BTC for BTC/USD)
  limitPrice?: number; // required for limit
}

export interface Fill {
  price: number;
  size: number;
  fee: number;
}

export interface FilledOrder {
  id: string;
  symbol: string;
  side: Side;
  type: OrderType;
  requestedSize: number;
  fills: Fill[];
  totalCost: number;     // in quote asset (USD)
  averagePrice: number;
  totalFee: number;
  status: 'filled' | 'partial' | 'rejected';
  filledAt: number;
}

export interface OpenOrder {
  id: string;
  symbol: string;
  side: Side;
  type: 'limit';
  size: number;
  remainingSize: number;
  limitPrice: number;
  createdAt: number;
}
```

**Interview note:** Modeling these carefully is a senior signal. Many engineers blur "request" and "result" into one mutable shape. Separating them makes state transitions obvious.

### Step 2: Simulate a market order against the book

`src/lib/trading/simulate.ts`:

```typescript
import type { OrderBook, Level } from '@/lib/orderbook/orderbook';
import type { Fill, FilledOrder, Side } from './types';

interface SimulationInput {
  side: Side;
  size: number;
  book: OrderBook;
  feeBps: number; // e.g. 26 for 0.26% taker fee
}

interface SimulationResult {
  fills: Fill[];
  filledSize: number;
  averagePrice: number;
  totalCost: number;
  totalFee: number;
  slippageBps: number;
  insufficientLiquidity: boolean;
}

export function simulateMarketOrder({ side, size, book, feeBps }: SimulationInput): SimulationResult {
  // Buying = consume asks (ascending); selling = consume bids (descending)
  const levels: readonly Level[] = side === 'buy' ? book.getAsks(100) : book.getBids(100);
  if (levels.length === 0) {
    return emptyResult(true);
  }
  const referencePrice = levels[0].price; // top of book before fill

  let remaining = size;
  let totalCost = 0;
  const fills: Fill[] = [];

  for (const level of levels) {
    if (remaining <= 0) break;
    const filledAtLevel = Math.min(level.qty, remaining);
    const notional = filledAtLevel * level.price;
    const fee = (notional * feeBps) / 10_000;
    fills.push({ price: level.price, size: filledAtLevel, fee });
    totalCost += notional;
    remaining -= filledAtLevel;
  }

  const filledSize = size - remaining;
  const averagePrice = filledSize > 0 ? totalCost / filledSize : 0;
  const totalFee = fills.reduce((sum, f) => sum + f.fee, 0);
  const slippageBps = filledSize > 0
    ? (Math.abs(averagePrice - referencePrice) / referencePrice) * 10_000
    : 0;

  return {
    fills,
    filledSize,
    averagePrice,
    totalCost,
    totalFee,
    slippageBps,
    insufficientLiquidity: remaining > 0,
  };
}

function emptyResult(insufficient: boolean): SimulationResult {
  return {
    fills: [],
    filledSize: 0,
    averagePrice: 0,
    totalCost: 0,
    totalFee: 0,
    slippageBps: 0,
    insufficientLiquidity: insufficient,
  };
}
```

**Note on precision:** This uses regular JS numbers. For real money math, see Phase 4b — you'll replace these with decimal types. For now, get the algorithm correct.

**Interview drill:** "Walk me through what your `simulateMarketOrder` does, line by line." You should be able to do this fluently.

### Step 3: Compute slippage for the live preview

You want the preview to update as the user types size and as the order book moves. Use a memoized derivation:

```typescript
import { useMemo } from 'react';
import { useOrderBookStore } from '@/stores/orderbook-store';
import { simulateMarketOrder } from '@/lib/trading/simulate';

function useMarketOrderPreview(symbol: string, side: Side, size: number) {
  const lastUpdate = useOrderBookStore((s) => s.lastUpdateAt.get(symbol) ?? 0);
  return useMemo(() => {
    const book = useOrderBookStore.getState().books.get(symbol);
    if (!book || size <= 0) return null;
    return simulateMarketOrder({ side, size, book, feeBps: 26 });
  }, [symbol, side, size, lastUpdate]);
}
```

The `lastUpdate` timestamp dependency triggers re-computation when the book changes. The `useMemo` dependency on `book` itself wouldn't work because the book is mutated in place.

**Performance note:** This recomputes on every book update. For a small book (top 100 levels) and small order size, this is microseconds. For a deep book it'd be worth throttling. Mention this trade-off in your README.

### Step 4: The order entry form

`src/components/order-entry.tsx`:

```typescript
'use client';

import { useState } from 'react';
import { useOrderBookStore } from '@/stores/orderbook-store';
import { useTradingStore } from '@/stores/trading-store';
import { simulateMarketOrder } from '@/lib/trading/simulate';
import { useMarketOrderPreview } from '@/lib/trading/use-market-preview';
import type { Side, OrderType } from '@/lib/trading/types';

export function OrderEntry({ symbol }: { symbol: string }) {
  const [type, setType] = useState<OrderType>('market');
  const [side, setSide] = useState<Side>('buy');
  const [sizeStr, setSizeStr] = useState('');
  const [limitPriceStr, setLimitPriceStr] = useState('');
  const size = parseFloat(sizeStr) || 0;
  const limitPrice = parseFloat(limitPriceStr) || 0;

  const preview = useMarketOrderPreview(symbol, side, size);
  const placeOrder = useTradingStore((s) => s.placeOrder);

  const canSubmit =
    size > 0 &&
    (type === 'market' || limitPrice > 0) &&
    (type !== 'market' || !preview?.insufficientLiquidity);

  const onSubmit = () => {
    placeOrder({ symbol, side, type, size, limitPrice: type === 'limit' ? limitPrice : undefined });
    setSizeStr('');
    setLimitPriceStr('');
  };

  return (
    <div className="rounded border border-slate-700 p-4 space-y-3">
      <div className="flex gap-2">
        <TabButton active={type === 'market'} onClick={() => setType('market')}>Market</TabButton>
        <TabButton active={type === 'limit'} onClick={() => setType('limit')}>Limit</TabButton>
      </div>

      <div className="flex gap-2">
        <SideButton active={side === 'buy'} side="buy" onClick={() => setSide('buy')} />
        <SideButton active={side === 'sell'} side="sell" onClick={() => setSide('sell')} />
      </div>

      <LabeledInput label="Size (BTC)" value={sizeStr} onChange={setSizeStr} />
      {type === 'limit' && <LabeledInput label="Limit price (USD)" value={limitPriceStr} onChange={setLimitPriceStr} />}

      {type === 'market' && preview && size > 0 && (
        <MarketPreview preview={preview} />
      )}

      <button
        disabled={!canSubmit}
        onClick={onSubmit}
        className="w-full py-2 rounded bg-emerald-600 disabled:bg-slate-700 disabled:cursor-not-allowed"
      >
        Place {type} {side} order
      </button>
    </div>
  );
}
```

The `MarketPreview` subcomponent shows the simulated outcome:

```typescript
function MarketPreview({ preview }: { preview: SimulationResult }) {
  if (preview.insufficientLiquidity) {
    return <div className="text-amber-500 text-sm">Insufficient liquidity in book</div>;
  }
  const slippageColor = preview.slippageBps > 50 ? 'text-red-500'
                       : preview.slippageBps > 10 ? 'text-amber-500'
                       : 'text-slate-400';
  return (
    <div className="text-sm space-y-1">
      <div className="flex justify-between"><span>Avg fill price</span><span>${preview.averagePrice.toFixed(2)}</span></div>
      <div className="flex justify-between"><span>Total cost</span><span>${preview.totalCost.toFixed(2)}</span></div>
      <div className="flex justify-between"><span>Fee (0.26%)</span><span>${preview.totalFee.toFixed(2)}</span></div>
      <div className={`flex justify-between ${slippageColor}`}>
        <span>Slippage</span>
        <span>{(preview.slippageBps / 100).toFixed(3)}%</span>
      </div>
      <div className="text-xs text-slate-500">{preview.fills.length} fills across price levels</div>
    </div>
  );
}
```

**Why color the slippage by magnitude?** It's a *signal*, not just data. A 5% slippage warning that's the same gray as "fee" is invisible to a user about to click. This is product thinking — mention it in the interview.

### Step 5: The trading store

`src/stores/trading-store.ts`:

```typescript
import { create } from 'zustand';
import type { FilledOrder, OpenOrder, OrderRequest } from '@/lib/trading/types';
import { simulateMarketOrder } from '@/lib/trading/simulate';
import { useOrderBookStore } from './orderbook-store';

interface TradingState {
  filledOrders: FilledOrder[];
  openOrders: OpenOrder[];
  placeOrder: (req: OrderRequest) => void;
  cancelOpenOrder: (id: string) => void;
  tryFillOpenOrders: () => void; // called periodically as book updates
}

export const useTradingStore = create<TradingState>((set, get) => ({
  filledOrders: [],
  openOrders: [],

  placeOrder(req) {
    if (req.type === 'market') {
      const book = useOrderBookStore.getState().books.get(req.symbol);
      if (!book) return;
      const sim = simulateMarketOrder({ side: req.side, size: req.size, book, feeBps: 26 });
      if (sim.filledSize === 0) return; // reject
      const filled: FilledOrder = {
        id: crypto.randomUUID(),
        symbol: req.symbol,
        side: req.side,
        type: 'market',
        requestedSize: req.size,
        fills: sim.fills,
        totalCost: sim.totalCost,
        averagePrice: sim.averagePrice,
        totalFee: sim.totalFee,
        status: sim.insufficientLiquidity ? 'partial' : 'filled',
        filledAt: Date.now(),
      };
      set((s) => ({ filledOrders: [filled, ...s.filledOrders] }));
    } else {
      if (!req.limitPrice) return;
      const order: OpenOrder = {
        id: crypto.randomUUID(),
        symbol: req.symbol,
        side: req.side,
        type: 'limit',
        size: req.size,
        remainingSize: req.size,
        limitPrice: req.limitPrice,
        createdAt: Date.now(),
      };
      set((s) => ({ openOrders: [...s.openOrders, order] }));
    }
  },

  cancelOpenOrder(id) {
    set((s) => ({ openOrders: s.openOrders.filter((o) => o.id !== id) }));
  },

  tryFillOpenOrders() {
    const { openOrders } = get();
    if (openOrders.length === 0) return;
    const books = useOrderBookStore.getState().books;
    const stillOpen: OpenOrder[] = [];
    const newFills: FilledOrder[] = [];

    for (const order of openOrders) {
      const book = books.get(order.symbol);
      if (!book) { stillOpen.push(order); continue; }

      // A buy limit fills when best ask <= limitPrice
      // A sell limit fills when best bid >= limitPrice
      const { bestBid, bestAsk } = book.topOfBook();
      const triggers = order.side === 'buy'
        ? bestAsk && bestAsk.price <= order.limitPrice
        : bestBid && bestBid.price >= order.limitPrice;

      if (triggers) {
        // Fill at the limit price (maker rebate) — simplified
        const filled: FilledOrder = {
          id: order.id,
          symbol: order.symbol,
          side: order.side,
          type: 'limit',
          requestedSize: order.size,
          fills: [{ price: order.limitPrice, size: order.remainingSize, fee: order.remainingSize * order.limitPrice * 0.0016 }],
          totalCost: order.remainingSize * order.limitPrice,
          averagePrice: order.limitPrice,
          totalFee: order.remainingSize * order.limitPrice * 0.0016,
          status: 'filled',
          filledAt: Date.now(),
        };
        newFills.push(filled);
      } else {
        stillOpen.push(order);
      }
    }

    if (newFills.length > 0) {
      set((s) => ({
        openOrders: stillOpen,
        filledOrders: [...newFills, ...s.filledOrders],
      }));
    }
  },
}));
```

### Step 6: Trigger limit-order fills as the book updates

Anywhere you receive book updates, after applying them, call `tryFillOpenOrders()`. Or subscribe to book updates from the trading store directly:

```typescript
// In an init effect somewhere
useEffect(() => {
  const unsub = useOrderBookStore.subscribe((state) => {
    useTradingStore.getState().tryFillOpenOrders();
  });
  return unsub;
}, []);
```

**Subtle issue:** This fires on every book update. For a heavy book, this is a lot. Throttle to, say, every 100ms with `setInterval` instead. Or only check when top-of-book changes (track this in `applyUpdate`'s return value from Phase 2a).

**Interview drill:** "When does your limit-order check run? Could it cause perf problems?" Have the throttling answer ready.

### Step 7: UI for open and filled orders

A simple table:

```typescript
export function OpenOrders() {
  const orders = useTradingStore((s) => s.openOrders);
  const cancel = useTradingStore((s) => s.cancelOpenOrder);
  return (
    <table>
      <thead>...</thead>
      <tbody>
        {orders.map((o) => (
          <tr key={o.id}>
            <td>{o.symbol}</td>
            <td>{o.side}</td>
            <td>{o.remainingSize}</td>
            <td>${o.limitPrice}</td>
            <td><button onClick={() => cancel(o.id)}>Cancel</button></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
```

## Common Mistakes

1. **Walking the wrong side of the book** — Buy walks asks; sell walks bids. Easy to flip.
2. **Computing slippage as `(avg - bestPrice)` for both sides** — For a sell, the avg is *lower* than best bid, so slippage is `bestBid - avg`. Take the abs value or branch on side.
3. **Filling a partial order at 0 average price** — When the book is too thin, `filledSize === 0` and you divide by zero. Guard against it.
4. **Not checking limit-fill triggers atomically with book updates** — If you check before applying the update, you'll miss fills. Apply first, then check.
5. **Forgetting that `crypto.randomUUID()` requires a secure context** — Works on `https://` and `localhost`, but not always on plain `http://` in dev tooling. Have a fallback.
6. **No bound on simulated book walk** — A malicious size input (`9999999999`) shouldn't iterate forever. The 100-level cap in `getAsks(100)` already protects you, but document it.

## Verification Checklist

- [ ] Type a market buy size; preview updates as the book moves
- [ ] Slippage color reflects magnitude (gray → amber → red)
- [ ] Submit a market order; appears in filled orders list with realistic fills
- [ ] Submit a buy limit order at a price below the market; sits in open orders
- [ ] Watch market fall to your limit price; order auto-fills
- [ ] Cancel an open order; it disappears
- [ ] Try a market order larger than total book depth; warning shown, button disabled

## Interview Drill Questions

1. Explain how a market order works to a non-trading engineer.
2. What is slippage and why do users care?
3. Why are limit orders cheaper than market orders (in fees)?
4. How does your code know when to fill a limit order?
5. Walk me through what happens when a user submits a market buy for 10 BTC but the book only has 5 BTC of asks.
6. If the book moves between the user seeing the preview and clicking submit, what happens? (Possible: preview was at $50,000, actual fill at $50,100. Real exchanges sometimes "lock in" the preview for a few seconds, or show a confirmation modal with fresh numbers.)
7. How would you extend this to stop-loss orders?
8. How would real Kraken integration differ? (Authenticated WS for order placement, REST for order management, order IDs returned from server, status updates via WS.)

Once your fills work and feel correct against the live book, move to `07-phase4b-pnl-precision.md`.
