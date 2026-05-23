# Phase 2b: High-Performance Order Book Rendering

**Goal:** Take the working order book data layer from Phase 2a and render it in React at 10+ updates per second without dropping frames, with row-level flash animations on changes.

**Estimated time:** 2 days

## Learning Objectives

1. How to measure React render performance (Profiler, Performance API, custom marks)
2. The cost model of React reconciliation — what triggers re-renders, what skips them
3. When `React.memo` helps and when it doesn't
4. How `useSyncExternalStore` enables fine-grained subscriptions that bypass parent re-renders
5. Why "60fps" is the wrong target for streaming data, and what to target instead
6. CSS animation strategies that don't cause layout thrash

## Why This Matters for the Interview

This is *the* performance interview phase. The job description says "rendering performance and data accuracy were critical." The data accuracy was Phase 2a. The rendering performance is this. Be ready to whiteboard the render tree, point at a flame graph, and explain trade-offs.

## The Core Problem

Naïvely, the rendering flow looks like:

```
Update arrives (WS) 
  → store mutates 
  → store.subscribe fires 
  → OrderBookComponent re-renders 
  → ALL 50 row components re-render 
  → React diffs each row's props 
  → DOM updates
```

At 20 updates/sec with 50 rows, that's 1000 row re-renders per second. Each is cheap individually but the cumulative cost — plus the GC pressure from intermediate objects — can hit 16ms (the 60fps budget) on a mid-range laptop.

**The goal:** when one price level changes, *only* that row should re-render. Everything else should be skipped at the React level.

## What You're Building

A pixel-perfect order book component that:
- Shows 25 bids and 25 asks
- Updates row content within 16ms of message arrival
- Flashes changed rows green (bid increased / new bid) or red (ask changed / removal) for 250ms
- Shows depth bars (cumulative volume) behind each row
- Shows top of book + spread in a header
- Stays under 16ms render budget under realistic load

## Step-by-Step Build

### Step 1: Set up performance measurement BEFORE optimizing

You cannot optimize what you don't measure. Do this first.

Create `src/lib/perf/marks.ts`:

```typescript
let frameStartTime = 0;

export function markUpdateReceived(symbol: string): void {
  performance.mark(`update-received-${symbol}`);
}

export function markUpdateRendered(symbol: string): void {
  performance.mark(`update-rendered-${symbol}`);
  try {
    const measure = performance.measure(
      `update-to-render-${symbol}`,
      `update-received-${symbol}`,
      `update-rendered-${symbol}`
    );
    if (measure.duration > 16) {
      console.warn(`Slow update: ${measure.duration.toFixed(2)}ms for ${symbol}`);
    }
  } catch {
    // Marks may not be in order; ignore
  }
}
```

Call `markUpdateReceived` when your store applies the update; call `markUpdateRendered` in a `useEffect` after the order book renders.

Also, learn to use the React DevTools Profiler. Record a 5-second session under realistic load and inspect:
- Which components re-render
- How long each render takes
- Whether commits are batched

**Interview drill:** "How do you know your order book is fast?" Don't say "it feels smooth." Say "I measure update-arrival-to-paint latency; my 95th percentile is X ms."

### Step 2: First, build it naïvely (yes, really)

Build the dumb version first:

```typescript
'use client';

import { useOrderBookStore } from '@/stores/orderbook-store';

export function OrderBookNaive({ symbol }: { symbol: string }) {
  const book = useOrderBookStore((s) => s.books.get(symbol));
  if (!book) return <div>Loading...</div>;

  const bids = book.getBids(25);
  const asks = book.getAsks(25);

  return (
    <div className="grid grid-cols-2 gap-4">
      <div>
        {asks.slice().reverse().map((level) => (
          <Row key={level.price} level={level} side="ask" />
        ))}
      </div>
      <div>
        {bids.map((level) => (
          <Row key={level.price} level={level} side="bid" />
        ))}
      </div>
    </div>
  );
}

function Row({ level, side }: { level: Level; side: 'bid' | 'ask' }) {
  return (
    <div className={side === 'bid' ? 'text-green-500' : 'text-red-500'}>
      <span>{level.price.toFixed(2)}</span>
      <span>{level.qty.toFixed(4)}</span>
    </div>
  );
}
```

Profile this. You'll see every row re-render on every update. **This is your baseline.** Note the numbers.

**Interview gold:** Being able to say "I started with the obvious implementation, measured, found bottleneck X at Y ms, optimized to Z ms" is way stronger than "I used X advanced technique."

### Step 3: Identify the actual bottleneck

Open the React Profiler. Trigger updates. You'll likely see:

1. The parent `OrderBookNaive` re-renders on every update (selector returns the Map reference)
2. Every `Row` re-renders because props look different (new `level` object reference)

Two separate issues. Tackle them in order.

### Step 4: Stabilize the parent re-render

The problem: `useOrderBookStore((s) => s.books.get(symbol))` returns the OrderBook instance. The instance is the same reference, but every store update creates a new `books` Map, so Zustand's default shallow comparison thinks it changed. Plus, the instance is mutated, so even reference equality wouldn't help React.

Fix: subscribe only to the `lastUpdateAt` timestamp for *this symbol*. That triggers a re-render only when this specific book updates.

```typescript
const lastUpdate = useOrderBookStore((s) => s.lastUpdateAt.get(symbol) ?? 0);
const book = useOrderBookStore.getState().books.get(symbol);
```

Better — even more targeted: select only what this component renders, with custom equality.

**Interview drill:** "How does Zustand know when to re-render?" Answer: it runs the selector on every store change, then compares results with `Object.is` (or custom comparator). So your selector should return primitives or stable references.

### Step 5: Memoize rows correctly

```typescript
import { memo } from 'react';

interface RowProps {
  price: number;
  qty: number;
  side: 'bid' | 'ask';
}

const Row = memo(function Row({ price, qty, side }: RowProps) {
  return (
    <div className={side === 'bid' ? 'text-green-500' : 'text-red-500'}>
      <span>{price.toFixed(2)}</span>
      <span>{qty.toFixed(4)}</span>
    </div>
  );
});
```

**Crucial:** pass *primitives*, not the level object. If you pass `level={level}`, `React.memo`'s default shallow comparison checks `prevProps.level === nextProps.level`. Since the level object reference is new on every update, memo never bails out. Pass `price` and `qty` separately as numbers, and memo will correctly skip the row when neither changed.

### Step 6: Fan out the parent so it doesn't re-render

Even with memoized rows, the parent still re-renders on every update — and traverses 50 row components calling memo's equality check each time. At 50 updates/sec that's 2500 equality checks/sec. Not catastrophic, but wasteful.

The advanced fix: row-level subscriptions. Each row subscribes directly to its own price level. The parent renders the *structure* (which prices exist), and each row reads its own data.

```typescript
// In your store, expose a per-level selector
export function selectLevel(symbol: string, side: 'bid' | 'ask', index: number) {
  return (state: OrderBookState) => {
    const book = state.books.get(symbol);
    const levels = side === 'bid' ? book?.getBids(25) : book?.getAsks(25);
    return levels?.[index] ?? null;
  };
}

// Then in Row:
function Row({ symbol, side, index }: { symbol: string; side: 'bid' | 'ask'; index: number }) {
  const level = useOrderBookStore(selectLevel(symbol, side, index));
  if (!level) return <div className="row-empty" />;
  // render
}
```

Now the parent passes only `symbol`, `side`, `index` — all stable across updates. The parent never re-renders unless those change. Each row independently subscribes.

**Caveat:** This creates N selectors firing on every store update. At small N (50) the per-selector overhead is negligible. At large N, you'd want a more sophisticated approach (selectorless atoms a la Jotai, or batched coalescence).

**Interview drill:** "Walk me through why this row pattern is faster than the memoized version." You should be able to count the equality checks per update for each approach.

### Step 7: Flash animation on change

When a price level's qty changes, you want to briefly highlight that row. The temptation is to use React state for "isFlashing." Resist it — state changes cause re-renders, which fight the optimization you just built.

Better: trigger a CSS class via `data-` attribute changes or imperative DOM manipulation. Even better: use CSS animations that auto-cleanup.

Approach: when a row's qty changes, add a class that triggers a CSS animation. The animation fades on its own and the row goes back to normal styling — no React involvement.

```typescript
import { useRef, useEffect } from 'react';

function Row({ symbol, side, index }: RowProps) {
  const level = useOrderBookStore(selectLevel(symbol, side, index));
  const ref = useRef<HTMLDivElement>(null);
  const prevQty = useRef(level?.qty);

  useEffect(() => {
    if (!level || !ref.current) return;
    if (prevQty.current !== undefined && prevQty.current !== level.qty) {
      // Trigger flash animation imperatively
      ref.current.classList.remove('flash');
      void ref.current.offsetWidth; // force reflow to restart animation
      ref.current.classList.add('flash');
    }
    prevQty.current = level.qty;
  }, [level?.qty]);

  if (!level) return <div className="row-empty" />;
  return (
    <div ref={ref} className="row">
      <span>{level.price.toFixed(2)}</span>
      <span>{level.qty.toFixed(4)}</span>
    </div>
  );
}
```

CSS:

```css
.row.flash {
  animation: flash 250ms ease-out;
}
@keyframes flash {
  0% { background-color: rgba(34, 197, 94, 0.4); }
  100% { background-color: transparent; }
}
```

**Why imperative DOM manipulation here?** Because React's declarative model assumes UI is a function of state. Animations like this are *transient effects* that don't represent state — adding them to state would force re-renders. This is a case where escaping React is the right call, and senior engineers know when to do it.

**Interview drill:** "Why did you reach for `ref.current.classList` instead of a state-driven class?" Be prepared to argue the trade-off.

### Step 8: Depth bars (cumulative volume)

A depth bar shows the cumulative quantity at that price and worse — visualizing how much volume is available within X% of the spread.

```typescript
// Compute cumulative depth from the array of levels (memoize it)
function computeDepth(levels: readonly Level[]): number[] {
  let cumulative = 0;
  return levels.map((l) => (cumulative += l.qty));
}

// Then per-row, depth percentage is depth[i] / depth[depth.length - 1]
```

Render the depth bar as a CSS-only background gradient or `::before` pseudo-element with `width: X%`. Avoid SVG for this — SVG re-renders are heavier than CSS width changes.

Depth values change on every update. To avoid passing them per-row, store them in a separate Zustand slice keyed by symbol and read with another row-level selector.

### Step 9: Batching / throttling under extreme load

If Kraken sends 100 updates/sec during a fast market, even your optimized renderer might struggle. Solution: coalesce updates within a frame.

One approach: instead of `applyUpdate` triggering a store notification immediately, queue updates and flush via `requestAnimationFrame`:

```typescript
let pendingFlush = false;
const pendingUpdates = new Map<string, { bids: Level[]; asks: Level[]; checksum: number }>();

function queueUpdate(symbol: string, update: Update) {
  // Merge consecutive updates for the same symbol (keep latest checksum, merge deltas)
  pendingUpdates.set(symbol, update); // simplification — proper merging is harder
  if (!pendingFlush) {
    pendingFlush = true;
    requestAnimationFrame(flushUpdates);
  }
}
```

**Trade-off to discuss in the interview:** Coalescing reduces render frequency but adds up-to-16ms latency. For an order book displayed to a human eye, this is fine. For a trading bot, no — but a trading bot wouldn't use a browser UI.

### Step 10: Final measurement

Re-run your profiler. Compare to baseline:

| Metric | Baseline | Optimized |
|--------|----------|-----------|
| Avg render time per update | ?? ms | ?? ms |
| Re-renders per update | 50+ | 1 |
| 95th percentile update latency | ?? ms | ?? ms |
| Dropped frames during 5min session | ?? | 0 |

Screenshot the flame graphs. You will show these in the interview.

## Common Mistakes

1. **Optimizing before measuring** — You'll waste time on the wrong thing.
2. **`React.memo` with object props** — Doesn't help unless object references are stable.
3. **Using inline functions as props** — Breaks memo equality. Use `useCallback` or define outside the component.
4. **State-driven animations** — Forces re-renders; defeats your row memoization.
5. **Re-creating the level array on every render** — `book.getBids(25).slice().reverse()` allocates twice per render. Memoize.
6. **Using `key={index}` for rows** — Causes incorrect reconciliation when levels are inserted/removed. Use `key={price}`.
7. **Forgetting that `qty.toFixed()` returns a string** — minor but means `===` won't work in custom comparators.

## Verification Checklist

- [ ] Open Performance tab in Chrome DevTools, record 10 seconds of live updates
- [ ] All frames are green (under 16ms)
- [ ] React Profiler shows only changed rows re-rendering per commit
- [ ] Flash animations don't trigger React re-renders (verify in Profiler)
- [ ] Visual: book updates feel instantaneous and smooth
- [ ] Open the Kraken Pro UI in another tab. Yours should feel comparable or better.

## Interview Drill Questions

1. Walk me through everything that happens between a WebSocket message arriving and a pixel changing on screen.
2. Explain why `React.memo` alone wasn't enough.
3. Why is using state for the flash animation a bad idea?
4. Your order book is dropping frames. How do you diagnose it?
5. What's your render budget per frame? Why?
6. How would your design change if you needed to show 500 price levels?
7. How would your design change if updates arrived 10x more frequently?
8. Walk me through your performance measurement strategy.
9. If you had to support animations *and* keep React in charge of all rendering, how would you do it? (Hint: CSS variables driven by inline styles, framer-motion's layout animations.)
10. What's the difference between `useMemo` and `React.memo`? When does each apply here?

## Bonus: virtualization (only if you have time)

For depth > 100, you'd virtualize the list — render only the visible rows. Use `@tanstack/react-virtual`. Mention this as a known scaling option even if you don't implement it.

## Reference Material

- React Profiler docs: https://react.dev/reference/react/Profiler
- Chrome Performance panel: https://developer.chrome.com/docs/devtools/performance
- `useSyncExternalStore` deep dive: https://github.com/reactwg/react-18/discussions/86

Once your order book is buttery smooth at the highest update rates Kraken throws at it, move to `05-phase3-charting.md`.
