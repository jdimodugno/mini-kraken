# Phase 2a: Order Book Data Structure & Checksum Validation

**Goal:** Build the in-memory representation of an order book that can apply snapshots and deltas correctly, validate against Kraken's checksum, and expose efficient reads for the UI.

**Estimated time:** 1–2 days

## Learning Objectives

1. What an order book actually *is* (data structure, not just visuals)
2. The difference between a snapshot and an incremental update
3. Why data structure choice (sorted array vs. tree vs. map) drastically affects perf at scale
4. How CRC32 checksums work and why exchanges use them
5. How to detect that your local state has diverged from the server's and recover

## Why This Matters for the Interview

The job description's smoking gun: *"order books, live P&L, or dashboards, where rendering performance and **data accuracy** were critical."*

Data accuracy in an order book means: at every moment, your local book is *byte-identical* to what every other Kraken client sees. If a delta is dropped or applied wrong, you're showing users prices that don't exist. This is a real production hazard at every exchange, and engineers who've done it know about checksum validation. Saying "I implemented CRC32 checksum verification against Kraken's spec" is a strong senior signal.

## Background: What Is an Order Book?

An order book has two sides:

- **Bids**: prices people want to buy at, sorted descending (highest first)
- **Asks**: prices people want to sell at, sorted ascending (lowest first)

Each side is a list of `(price, quantity)` levels. The top of book is the highest bid and lowest ask; the gap between them is the *spread*.

```
ASKS (sell orders, ascending)         BIDS (buy orders, descending)
                                      
   50,005  →  0.5 BTC                    50,000  →  1.2 BTC   ← best bid
   50,006  →  1.8 BTC                    49,998  →  0.8 BTC
   50,010  →  3.0 BTC                    49,995  →  2.5 BTC
   ...                                   ...
   ↑ best ask                            
   
   Spread = 50,005 - 50,000 = $5
```

Updates from Kraken arrive as either:
- A **snapshot**: full state at a point in time
- An **update (delta)**: a list of `(price, new_qty)` pairs where `new_qty = 0` means "remove this price level entirely"

## What You're Building

```typescript
class OrderBook {
  applySnapshot(snapshot: BookSnapshot): void;
  applyUpdate(update: BookUpdate): UpdateResult;
  validateChecksum(expected: number): boolean;
  topOfBook(): { bestBid: Level | null; bestAsk: Level | null };
  getBids(depth: number): Level[];
  getAsks(depth: number): Level[];
  getSpread(): number | null;
}
```

Plus a Zustand store that owns one `OrderBook` per symbol and emits updates.

## Step-by-Step Build

### Step 1: Choose your data structure

This decision is interview-worthy. Walk through the trade-offs:

| Structure | Insert/Remove | Top-N read | Memory | Notes |
|-----------|---------------|------------|--------|-------|
| Sorted array | O(n) — shift on insert | O(1) | Tight | Fine if depth ≤ 100 |
| `Map<price, qty>` + sort on read | O(1) write, O(n log n) read | O(n log n) per read | Higher | Bad — sort on hot path |
| Sorted Map (red-black tree) | O(log n) | O(k) for top-k | Higher | Optimal at scale, no built-in JS |
| Map + sorted keys array (hybrid) | O(log n) binary-search insert | O(k) | Medium | Best practical JS choice |

For depth ≤ 25 (what Kraken's `book` channel returns by default at lowest depth), a sorted array is genuinely fine. For depth = 1000, you'd want the hybrid. **Pick sorted array for now and document this in your README as a known scaling limit.**

**Interview drill:** "If you had to support a 1000-level book updating 100x/second, would your data structure still work?" Be able to answer with the table above.

### Step 2: Implement the data structure

Create `src/lib/orderbook/orderbook.ts`:

```typescript
export interface Level {
  price: number;
  qty: number;
}

export interface UpdateResult {
  bidsChanged: number[]; // prices that changed
  asksChanged: number[];
  topChanged: boolean;
}

export class OrderBook {
  private bids: Level[] = []; // descending
  private asks: Level[] = []; // ascending
  private lastUpdateAt: number = 0;

  applySnapshot(bids: Level[], asks: Level[]): void {
    this.bids = [...bids].sort((a, b) => b.price - a.price);
    this.asks = [...asks].sort((a, b) => a.price - b.price);
    this.lastUpdateAt = Date.now();
  }

  applyUpdate(bids: Level[], asks: Level[]): UpdateResult {
    const prevBestBid = this.bids[0]?.price;
    const prevBestAsk = this.asks[0]?.price;

    const bidsChanged = this.applyToSide(this.bids, bids, 'desc');
    const asksChanged = this.applyToSide(this.asks, asks, 'asc');

    const topChanged =
      this.bids[0]?.price !== prevBestBid || this.asks[0]?.price !== prevBestAsk;

    this.lastUpdateAt = Date.now();
    return { bidsChanged, asksChanged, topChanged };
  }

  private applyToSide(side: Level[], deltas: Level[], order: 'asc' | 'desc'): number[] {
    const changed: number[] = [];
    for (const delta of deltas) {
      const idx = side.findIndex((l) => l.price === delta.price);
      if (delta.qty === 0) {
        // Remove
        if (idx !== -1) {
          side.splice(idx, 1);
          changed.push(delta.price);
        }
      } else if (idx !== -1) {
        // Update existing
        side[idx].qty = delta.qty;
        changed.push(delta.price);
      } else {
        // Insert at correct sorted position
        const insertAt = side.findIndex((l) =>
          order === 'desc' ? l.price < delta.price : l.price > delta.price
        );
        if (insertAt === -1) side.push(delta);
        else side.splice(insertAt, 0, delta);
        changed.push(delta.price);
      }
    }
    return changed;
  }

  topOfBook(): { bestBid: Level | null; bestAsk: Level | null } {
    return { bestBid: this.bids[0] ?? null, bestAsk: this.asks[0] ?? null };
  }

  getBids(depth: number): readonly Level[] {
    return this.bids.slice(0, depth);
  }

  getAsks(depth: number): readonly Level[] {
    return this.asks.slice(0, depth);
  }

  getSpread(): number | null {
    const { bestBid, bestAsk } = this.topOfBook();
    if (!bestBid || !bestAsk) return null;
    return bestAsk.price - bestBid.price;
  }
}
```

**Note the `UpdateResult`.** This is critical for Phase 2b — your React layer needs to know *which* price levels changed so it can flash only those rows, not re-render everything.

**Interview drill:** "What's the time complexity of `applyToSide` for a single delta?" Answer: O(n) due to `findIndex` and `splice`. Fine for n=25, not for n=10000.

### Step 3: Implement Kraken's checksum

This is where it gets interesting. Kraken validates that your local book matches theirs by computing a CRC32 over the top-10 bids and asks concatenated as strings in a specific format. If your CRC matches theirs, you're synchronized. If not, you've diverged and must reset.

**Read Kraken's docs carefully on the exact checksum format.** It's:

1. Take top 10 asks: for each, format the price (no decimal, scientific notation removed) concatenated with quantity (same formatting)
2. Concatenate all 20 strings (10 ask price+qty pairs, then 10 bid pair) into one big string
3. CRC32 that string as an unsigned 32-bit integer
4. Compare to the `checksum` field in the update message

Install a CRC32 lib:

```bash
pnpm add @aws-crypto/crc32
```

Or implement it yourself if you want to learn (it's ~50 lines of code, a polynomial-based hash).

```typescript
import { Crc32 } from '@aws-crypto/crc32';

export function computeBookChecksum(book: OrderBook): number {
  const asks = book.getAsks(10);
  const bids = book.getBids(10);

  let buffer = '';
  for (const level of asks) {
    buffer += formatForChecksum(level.price) + formatForChecksum(level.qty);
  }
  for (const level of bids) {
    buffer += formatForChecksum(level.price) + formatForChecksum(level.qty);
  }

  const crc = new Crc32();
  crc.update(new TextEncoder().encode(buffer));
  return crc.digest();
}

// Kraken's spec: remove decimal point, leading zeros, trailing zeros.
// VERIFY THIS AGAINST THEIR ACTUAL DOCS — they may have changed it.
function formatForChecksum(n: number): string {
  return String(n)
    .replace('.', '')
    .replace(/^0+/, '')
    .replace(/0+$/, '');
}
```

**Critical warning:** The exact formatting rule is specified by Kraken and can be fiddly. Their docs include a worked example — test your implementation against it. If your CRC is off by even one bit, you're doing something wrong.

**Interview talking point:** "Implementing the checksum forced me to read the exchange's API docs very carefully. The format rules for the price/quantity encoding were specified to the digit. I tested my implementation against their example values before trusting it."

### Step 4: Handle checksum failures

```typescript
applyUpdate(bids, asks, expectedChecksum) {
  const result = this.book.applyUpdate(bids, asks);
  const actual = computeBookChecksum(this.book);
  if (actual !== expectedChecksum) {
    // We've diverged. Resubscribe to get a fresh snapshot.
    console.warn(`Checksum mismatch: expected ${expectedChecksum}, got ${actual}. Resyncing.`);
    this.requestResync();
    return { ...result, resyncRequested: true };
  }
  return result;
}
```

Resync = unsubscribe and resubscribe to the book channel, which triggers a new snapshot.

**Interview drill:** "How could the local book diverge from the server's?" Answers: dropped message, out-of-order delivery, your code has a bug, network corruption. Checksum catches all of these.

### Step 5: Build the Zustand store

Create `src/stores/orderbook-store.ts`:

```typescript
import { create } from 'zustand';
import { OrderBook } from '@/lib/orderbook/orderbook';
import { computeBookChecksum } from '@/lib/orderbook/checksum';

interface OrderBookState {
  books: Map<string, OrderBook>;
  lastUpdateAt: Map<string, number>;
  
  applySnapshot: (symbol: string, bids: Level[], asks: Level[]) => void;
  applyUpdate: (symbol: string, bids: Level[], asks: Level[], checksum: number) => void;
  getBook: (symbol: string) => OrderBook | undefined;
}

export const useOrderBookStore = create<OrderBookState>((set, get) => ({
  books: new Map(),
  lastUpdateAt: new Map(),

  applySnapshot(symbol, bids, asks) {
    const book = get().books.get(symbol) ?? new OrderBook();
    book.applySnapshot(bids, asks);
    set((s) => ({
      books: new Map(s.books).set(symbol, book),
      lastUpdateAt: new Map(s.lastUpdateAt).set(symbol, Date.now()),
    }));
  },

  applyUpdate(symbol, bids, asks, expectedChecksum) {
    const book = get().books.get(symbol);
    if (!book) {
      console.warn(`Update for ${symbol} before snapshot — dropping`);
      return;
    }
    book.applyUpdate(bids, asks);
    if (computeBookChecksum(book) !== expectedChecksum) {
      console.warn(`Checksum failed for ${symbol}; requesting resync`);
      // TODO: trigger resubscribe
      return;
    }
    set((s) => ({
      lastUpdateAt: new Map(s.lastUpdateAt).set(symbol, Date.now()),
    }));
  },

  getBook(symbol) {
    return get().books.get(symbol);
  },
}));
```

**Interview drill:** "Why is `OrderBook` a mutable class instead of an immutable structure? Doesn't that fight React?" Answer: At 50 updates/sec on a deep book, creating a fresh immutable copy on every update is wasteful. The class is mutated in place; React is notified via the `lastUpdateAt` map (which IS replaced immutably) to trigger re-reads. The store boundary is the immutability boundary, not the data structure inside.

This is a sophisticated answer; many engineers default to immutability everywhere without thinking about hot paths.

### Step 6: Wire it up

In a top-level component or layout:

```typescript
import { useEffect } from 'react';
import { getKrakenClient } from '@/lib/kraken';
import { useChannelSubscription } from '@/lib/kraken/use-channel';
import { useOrderBookStore } from '@/stores/orderbook-store';

export function OrderBookProvider({ symbol, children }: { symbol: string; children: React.ReactNode }) {
  useChannelSubscription('book', symbol, 25);
  const { applySnapshot, applyUpdate } = useOrderBookStore();

  useEffect(() => {
    const unsub = getKrakenClient().onMessage((msg) => {
      if (msg.channel !== 'book') return;
      for (const entry of msg.data) {
        if (entry.symbol !== symbol) continue;
        if (msg.type === 'snapshot') {
          applySnapshot(symbol, entry.bids, entry.asks);
        } else {
          applyUpdate(symbol, entry.bids, entry.asks, entry.checksum);
        }
      }
    });
    return unsub;
  }, [symbol, applySnapshot, applyUpdate]);

  return <>{children}</>;
}
```

## Common Mistakes

1. **Not handling `qty: 0` as deletion** — Kraken (like most exchanges) sends `qty: 0` to mean "remove this level." Treating it as "set qty to 0" leaves zombie levels in your book.
2. **Float comparison for prices** — `findIndex((l) => l.price === delta.price)` works only if prices come in identically formatted. If Kraken sends `50000` once and `50000.0` later, you might double-insert. Use `Number()` to normalize, or store prices as strings (more correct but slower).
3. **Mutating arrays returned by `getBids` / `getAsks`** — Mark them `readonly` in TS and return a defensive copy if needed.
4. **Updating without first having a snapshot** — Drop updates that arrive before a snapshot. Don't try to apply them to an empty book.
5. **Forgetting the checksum format edge cases** — Trailing zero in quantity, scientific notation in price, etc.

## Verification Checklist

- [ ] Subscribe to `book` for `BTC/USD`, snapshot arrives, top of book displays correct best bid/ask
- [ ] Updates apply correctly — watch top of book change as the market moves
- [ ] Insert at correct sorted position — write a unit test for this
- [ ] Removal works (qty = 0) — write a unit test
- [ ] Checksum validation passes for at least 1 minute of live updates without a single mismatch
- [ ] Manually corrupt the book in the store (DevTools) and verify checksum fails on next update
- [ ] Resync after checksum failure restores correctness

## Unit Tests You Must Write

```typescript
describe('OrderBook', () => {
  it('applies snapshot in correct sort order', () => { /* ... */ });
  it('inserts new bid at correct descending position', () => { /* ... */ });
  it('inserts new ask at correct ascending position', () => { /* ... */ });
  it('removes level when qty is 0', () => { /* ... */ });
  it('updates existing level qty', () => { /* ... */ });
  it('reports topChanged correctly when best bid changes', () => { /* ... */ });
  it('reports topChanged=false when only non-top levels change', () => { /* ... */ });
});

describe('computeBookChecksum', () => {
  it('matches Kraken example value', () => {
    // Take a worked example from Kraken's docs and verify
  });
});
```

## Interview Drill Questions

1. Explain to me what an order book is, like I'm a backend engineer who's never traded.
2. Why does Kraken send a checksum with every update?
3. What happens if you drop a single update message?
4. Walk me through what your code does when the checksum doesn't match.
5. Why did you choose a sorted array? When would you switch?
6. How is your local book kept consistent across multiple browser tabs? (Trick question — it isn't, each tab has its own. If they wanted shared state, BroadcastChannel.)
7. If a price level appears at both the top of bids and top of asks (crossed book), what do you do? (This shouldn't happen but indicates either bad data or a bug.)
8. How would you detect that updates are arriving slower than expected? (Last-update timestamp, alert if > N seconds.)

Once your order book is correctly applying updates and passing checksums in real time, move to `04-phase2b-orderbook-rendering.md` to make it actually render fast.
