# Phase 5: Testing, Accessibility, Polish, and Deploy

**Goal:** Ship a production-quality artifact you'd be proud to send to Kraken. Comprehensive test coverage on the high-stakes code paths, accessibility that works for keyboard and screen reader users, polish that signals craft, and a deploy + README that lets a hiring manager run your project in 30 seconds.

**Estimated time:** 2 days

## Learning Objectives

1. What to test (and what not to) in a frontend codebase
2. The three layers of frontend testing: unit, component, E2E — when each is right
3. Real-world accessibility for live-updating UIs (the `aria-live` trap)
4. How to write a README that lands the interview before the interview

## Why This Matters for the Interview

The job description mentions: *"Experience with frontend testing frameworks."* Also: *"Strong understanding of UI/UX best practices and principles."* This phase converts a working prototype into something that demonstrates senior craft. Bonus: a polished README and clean repo create an excellent first impression before the interviewer even calls.

## What You're Building

1. ~30 unit tests on pure logic (order book, position math, simulation)
2. ~10 component tests on critical UI (order entry validation, positions display)
3. 1 end-to-end test (Playwright) that runs against the live deploy
4. Full keyboard navigation
5. Screen-reader-friendly live updates (without spamming)
6. Lighthouse scores ≥ 90 across all metrics
7. A README that makes the project legible in 5 minutes
8. `DECISIONS.md` with 10 architectural decisions
9. `AI_USAGE.md` documenting how AI was used (for the application's prompt)

## Step-by-Step Build

### Step 1: Set up the test stack

```bash
pnpm add -D vitest @vitejs/plugin-react jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event
pnpm add -D @playwright/test
pnpm exec playwright install --with-deps chromium
```

`vitest.config.ts`:

```typescript
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    globals: true,
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
});
```

### Step 2: Unit tests for the order book

`src/lib/orderbook/__tests__/orderbook.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { OrderBook } from '../orderbook';

function makeBook(): OrderBook {
  const book = new OrderBook();
  book.applySnapshot(
    [{ price: 100, qty: 1 }, { price: 99, qty: 2 }],
    [{ price: 101, qty: 1 }, { price: 102, qty: 2 }],
  );
  return book;
}

describe('OrderBook', () => {
  it('applies snapshot with correct sort order', () => {
    const book = makeBook();
    expect(book.getBids(5).map((l) => l.price)).toEqual([100, 99]);
    expect(book.getAsks(5).map((l) => l.price)).toEqual([101, 102]);
  });

  it('inserts new bid at correct descending position', () => {
    const book = makeBook();
    book.applyUpdate([{ price: 99.5, qty: 5 }], []);
    expect(book.getBids(5).map((l) => l.price)).toEqual([100, 99.5, 99]);
  });

  it('inserts new ask at correct ascending position', () => {
    const book = makeBook();
    book.applyUpdate([], [{ price: 101.5, qty: 5 }]);
    expect(book.getAsks(5).map((l) => l.price)).toEqual([101, 101.5, 102]);
  });

  it('removes a level when qty is 0', () => {
    const book = makeBook();
    book.applyUpdate([{ price: 99, qty: 0 }], []);
    expect(book.getBids(5).map((l) => l.price)).toEqual([100]);
  });

  it('updates existing level quantity', () => {
    const book = makeBook();
    book.applyUpdate([{ price: 100, qty: 5 }], []);
    expect(book.getBids(1)[0].qty).toBe(5);
  });

  it('reports topChanged when best bid changes', () => {
    const book = makeBook();
    const result = book.applyUpdate([{ price: 105, qty: 1 }], []);
    expect(result.topChanged).toBe(true);
  });

  it('reports topChanged=false for non-top updates', () => {
    const book = makeBook();
    const result = book.applyUpdate([{ price: 99, qty: 3 }], []);
    expect(result.topChanged).toBe(false);
  });

  it('computes spread correctly', () => {
    const book = makeBook();
    expect(book.getSpread()).toBe(1); // 101 - 100
  });

  it('returns null spread on empty book', () => {
    const book = new OrderBook();
    expect(book.getSpread()).toBeNull();
  });
});
```

### Step 3: Tests for position math (high value — this is the part with the most ways to be wrong)

`src/lib/trading/__tests__/positions.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { Decimal } from '@/lib/money/decimal';
import { emptyPosition, applyFillToPosition, computeUnrealizedPnl } from '../positions';

const D = (v: number | string) => new Decimal(v);

describe('Position lifecycle', () => {
  it('opens a long position from a buy', () => {
    const pos = applyFillToPosition(emptyPosition('BTC/USD', 'long'), 'buy', D(1), D(50000), D(0));
    expect(pos.size.toString()).toBe('1');
    expect(pos.side).toBe('long');
    expect(pos.averageEntryPrice.toString()).toBe('50000');
  });

  it('computes weighted average entry across multiple buys', () => {
    let pos = applyFillToPosition(emptyPosition('BTC/USD', 'long'), 'buy', D(1), D(50000), D(0));
    pos = applyFillToPosition(pos, 'buy', D(1), D(52000), D(0));
    expect(pos.averageEntryPrice.toString()).toBe('51000');
  });

  it('realizes P&L on partial close', () => {
    let pos = applyFillToPosition(emptyPosition('BTC/USD', 'long'), 'buy', D(2), D(50000), D(0));
    pos = applyFillToPosition(pos, 'sell', D(1), D(51000), D(0));
    expect(pos.size.toString()).toBe('1');
    expect(pos.realizedPnl.toString()).toBe('1000');
  });

  it('flips position when sell exceeds long size', () => {
    let pos = applyFillToPosition(emptyPosition('BTC/USD', 'long'), 'buy', D(1), D(50000), D(0));
    pos = applyFillToPosition(pos, 'sell', D(2), D(51000), D(0));
    expect(pos.side).toBe('short');
    expect(pos.size.toString()).toBe('1');
    expect(pos.realizedPnl.toString()).toBe('1000'); // closed long with $1000 profit
    expect(pos.averageEntryPrice.toString()).toBe('51000'); // new short at sale price
  });

  it('includes fees in realized P&L', () => {
    let pos = applyFillToPosition(emptyPosition('BTC/USD', 'long'), 'buy', D(1), D(50000), D(0));
    pos = applyFillToPosition(pos, 'sell', D(1), D(51000), D(10));
    expect(pos.realizedPnl.toString()).toBe('990'); // $1000 gain - $10 fee
  });

  it('computes unrealized P&L for long position', () => {
    const pos = applyFillToPosition(emptyPosition('BTC/USD', 'long'), 'buy', D(2), D(50000), D(0));
    expect(computeUnrealizedPnl(pos, D(51000)).toString()).toBe('2000');
  });

  it('computes unrealized P&L for short position', () => {
    const pos = applyFillToPosition(emptyPosition('BTC/USD', 'short'), 'sell', D(2), D(50000), D(0));
    expect(computeUnrealizedPnl(pos, D(49000)).toString()).toBe('2000');
  });

  it('flat position has zero unrealized P&L regardless of price', () => {
    const pos = emptyPosition('BTC/USD', 'long');
    expect(computeUnrealizedPnl(pos, D(99999)).toString()).toBe('0');
  });
});
```

**This test file alone is interview gold.** When asked "do you write tests?" you can pull up this file and walk through the cases. Notice that they read like a spec.

### Step 4: Tests for the market order simulator

```typescript
describe('simulateMarketOrder', () => {
  function bookWith(asks: [number, number][], bids: [number, number][]) {
    const book = new OrderBook();
    book.applySnapshot(
      bids.map(([p, q]) => ({ price: p, qty: q })),
      asks.map(([p, q]) => ({ price: p, qty: q })),
    );
    return book;
  }

  it('fills a single-level buy', () => {
    const result = simulateMarketOrder({
      side: 'buy', size: D(0.5), feeBps: 26,
      book: bookWith([[100, 1]], [[99, 1]]),
    });
    expect(result.filledSize.toString()).toBe('0.5');
    expect(result.averagePrice.toString()).toBe('100');
    expect(result.slippageBps.toString()).toBe('0');
  });

  it('walks the book across levels with slippage', () => {
    const result = simulateMarketOrder({
      side: 'buy', size: D(2), feeBps: 0,
      book: bookWith([[100, 1], [110, 1]], [[99, 1]]),
    });
    expect(result.filledSize.toString()).toBe('2');
    expect(result.averagePrice.toString()).toBe('105');
    // (105 - 100) / 100 * 10000 = 500 bps
    expect(result.slippageBps.toString()).toBe('500');
  });

  it('reports insufficient liquidity', () => {
    const result = simulateMarketOrder({
      side: 'buy', size: D(10), feeBps: 0,
      book: bookWith([[100, 1]], [[99, 1]]),
    });
    expect(result.insufficientLiquidity).toBe(true);
    expect(result.filledSize.toString()).toBe('1');
  });

  it('handles empty book', () => {
    const result = simulateMarketOrder({
      side: 'buy', size: D(1), feeBps: 0,
      book: bookWith([], []),
    });
    expect(result.filledSize.toString()).toBe('0');
    expect(result.insufficientLiquidity).toBe(true);
  });
});
```

### Step 5: Component test for order entry form

`src/components/__tests__/order-entry.test.tsx`:

```typescript
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect } from 'vitest';
// ... seed the order book store with mock data before render ...

describe('OrderEntry', () => {
  it('disables submit when size is empty', () => {
    render(<OrderEntry symbol="BTC/USD" />);
    expect(screen.getByRole('button', { name: /place/i })).toBeDisabled();
  });

  it('disables submit when liquidity is insufficient', async () => {
    seedOrderBook({ asks: [[50000, 0.1]], bids: [[49999, 0.1]] });
    render(<OrderEntry symbol="BTC/USD" />);
    await userEvent.type(screen.getByLabelText(/size/i), '10');
    expect(screen.getByText(/insufficient liquidity/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /place/i })).toBeDisabled();
  });

  it('shows slippage warning at high slippage', async () => {
    seedOrderBook({ asks: [[50000, 0.1], [60000, 5]], bids: [[49999, 5]] });
    render(<OrderEntry symbol="BTC/USD" />);
    await userEvent.type(screen.getByLabelText(/size/i), '1');
    const slippage = screen.getByText(/slippage/i);
    expect(slippage).toHaveClass('text-red-500');
  });
});
```

### Step 6: End-to-end test (Playwright)

`e2e/smoke.spec.ts`:

```typescript
import { test, expect } from '@playwright/test';

test('order book and order entry smoke test', async ({ page }) => {
  await page.goto('http://localhost:3000');

  // Wait for live data
  await expect(page.getByTestId('best-bid')).not.toBeEmpty({ timeout: 15000 });
  await expect(page.getByTestId('best-ask')).not.toBeEmpty();

  // Place a market buy
  await page.getByLabel('Size').fill('0.001');
  await expect(page.getByTestId('slippage')).toBeVisible();
  await page.getByRole('button', { name: /place market buy/i }).click();

  // Position appears
  await expect(page.getByTestId('positions-row-BTC/USD')).toBeVisible();
});
```

**One end-to-end test is enough.** Don't waste time mirroring every unit test at E2E level. Use E2E for "the smoke test of smoke tests" — does the basic flow work in a real browser against real Kraken? That alone is valuable.

### Step 7: Accessibility — the live-update trap

Live-updating prices are an accessibility minefield. A screen reader using `aria-live="assertive"` on a price that changes 20 times/sec will spam the user into uninstalling your app.

The right approach:
- Static, important changes (top-of-book price): `aria-live="polite"` with the **rounded** price, and only update the announced value when it crosses a meaningful threshold (e.g., changes by $10).
- The order book grid: not live-announced; users navigate it on demand.
- Status changes (connection lost, order filled): `aria-live="polite"`, short message.

```typescript
function PriceTicker({ price }: { price: number }) {
  // Round to nearest dollar for screen reader announcements
  const announcedPrice = Math.round(price);
  return (
    <div>
      <span aria-hidden="true">${price.toFixed(2)}</span>
      <span className="sr-only" aria-live="polite">
        Bitcoin price: {announcedPrice} dollars
      </span>
    </div>
  );
}
```

But debounce the `aria-live` updates to ~5 seconds so it doesn't fire on every cent change:

```typescript
function useDebouncedAnnouncement<T>(value: T, delayMs: number): T {
  const [announced, setAnnounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setAnnounced(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);
  return announced;
}
```

**Interview gold:** "I learned that `aria-live` on streaming data is hostile to screen reader users. I debounced announcements to 5 seconds and rounded the announced value, while keeping the visible value at full precision. Accessibility for live-updating UIs isn't 'add aria-live'; it's a UX design problem."

### Step 8: Keyboard navigation

Every interactive element must be focusable and operable from the keyboard:

- Symbol selector: arrow keys or tab + enter
- Interval buttons: tab + enter
- Order form: tab through inputs, enter to submit
- Open orders cancel buttons: tab + enter

Test it: try to use the entire app without touching the mouse. Fix anything that doesn't work.

### Step 9: Color and contrast

The bid-green / ask-red color scheme is conventional but inaccessible to red-green colorblind users. Add a secondary signal:

- Bids align right, asks align left (positional information)
- Bid rows have a "▲" prefix on the price; asks have a "▼"
- Or: use a colorblind-safe palette (blue/orange) toggleable in settings

Run [Stark](https://www.getstark.co/) or DevTools' vision-deficiency simulator on your UI.

### Step 10: Lighthouse and Web Vitals

Run Lighthouse against your deploy. Aim for:
- Performance: 90+
- Accessibility: 100
- Best Practices: 100
- SEO: 90+

Typical fixes:
- Add proper `<title>` and meta description
- Set `<html lang="en">`
- Add a robots.txt
- Compress images if any
- Defer non-critical JS

### Step 11: README

This is your application's calling card. Structure:

```markdown
# MiniKraken

A real-time crypto trading dashboard built against Kraken's WebSocket v2 API. Live order book, candlestick charts, simulated order entry with slippage preview, position tracking with live P&L.

🔗 **Live demo:** https://minikraken.yourname.dev  
📺 **5-minute walkthrough:** https://loom.com/...

## What's interesting about this

- **Order book with checksum validation** against Kraken's CRC32. Detects and recovers from divergence.
- **Sub-16ms render budget** under realistic load via row-level Zustand subscriptions and imperative flash animations.
- **REST/WebSocket race-condition handling** for historical + live chart data.
- **Decimal precision** throughout the money math layer (`decimal.js`) — no floating-point bugs.
- **Live unrealized P&L** with side-aware mark price.

## Running locally

\`\`\`bash
pnpm install
pnpm dev
\`\`\`

Open http://localhost:3000. No API keys needed — uses Kraken's public endpoints.

## Architecture

[Insert one screenshot of architecture diagram]

[2–3 paragraphs of high-level design.]

## Key decisions

See `DECISIONS.md`.

## Trade-offs and known limitations

- Order book uses sorted array; would switch to a sorted-key hybrid map at depth > 100.
- Limit orders fill at the limit price; real exchanges may give price improvement.
- No persistence — refresh resets positions.

## What I'd build next

- Persistence via IndexedDB
- Multiple symbol tabs
- Stop and stop-limit orders
- ...
```

### Step 12: DECISIONS.md

10 entries in this format:

```markdown
## Decision: Class-based ConnectionManager, not a hook

**Alternatives considered:** A `useWebSocket` hook; using a library like `react-use-websocket`.

**Choice:** Pure TypeScript class, wrapped in a hook for React consumption.

**Why:** WebSocket lifecycle is decoupled from any component's lifecycle. A class is testable without rendering, reusable outside React, and easier to reason about when state spans seconds-to-minutes (reconnection backoff, heartbeat intervals).

**What I'd reconsider:** If this were the only WS connection in the app and never needed reuse, a hook would be simpler.
```

Write 10 of these covering the meaty choices: data structure for the book, class vs hook for connection, Zustand vs Redux, lightweight-charts vs visx, sorted array vs sorted map, mid vs side-aware mark price, etc.

### Step 13: AI_USAGE.md

This is what their application is asking about. Structure:

```markdown
# How I used AI building MiniKraken

## Honest answers

### What AI made possible

**Kraken's checksum validation.** Their docs describe a CRC32 over a specific concatenation format with precise digit-stripping rules. Implementing this from scratch would have taken hours of trial-and-error testing against their example values. With Claude, I had a working implementation in ~20 minutes — I described the spec, got an implementation, ran it against their published example, found one bug in the leading-zero stripping, fixed it. **Without AI, I would have skipped checksum validation entirely** and shipped a less-correct order book.

### Where AI got it wrong

**Position-flipping P&L math.** First version returned the right answer for partial closes but silently broke when a sell exceeded the long size — the close-and-reopen case. I caught it by writing a test with concrete numbers and seeing the realized P&L was zero when it should have been $1,000. Fixed by branching on `fillSize > position.size` and handling close+open as separate operations.

### How I used it day-to-day

- Generating Zod schemas from prose descriptions of Kraken's docs
- Writing initial test scaffolding from a function signature
- Debugging React render thrashing — I shared the Profiler flame graph (as text) and asked "what's the most likely cause"
- Suggesting names for ambiguous types and variables

### What I never delegated

- The data flow architecture (I needed to hold this in my head to debug)
- The position math (too easy to get subtly wrong, too important to trust)
- Performance optimizations (had to measure each change myself to verify)
```

This is the honest, specific answer their application is asking for. Generic "AI helps me code faster" will not stand out.

## Common Mistakes

1. **Testing implementation, not behavior** — `expect(component.state.x).toBe(5)` instead of `expect(screen.getByText('5')).toBeVisible()`. The latter survives refactors.
2. **Mocking everything in component tests** — Some integration is fine. Test the order entry form with the real Zustand store but mock the WS layer.
3. **No E2E test** — One E2E test catches integration bugs unit tests can't. Don't skip it.
4. **Skipping a11y because "the interview won't test it"** — They will, because their job description says they care.
5. **A README that's three lines** — Hiring managers triage 100 repos in an evening. Yours needs to make the case for itself.
6. **Hiding AI usage** — They asked about it directly. Be specific, honest, and show judgment.

## Verification Checklist

- [ ] `pnpm test` runs and all tests pass
- [ ] `pnpm test:e2e` runs against `pnpm dev` and passes
- [ ] Lighthouse: Performance 90+, A11y 100, BP 100, SEO 90+
- [ ] Navigate entire app with keyboard only
- [ ] Test in screen reader (VoiceOver on Mac, NVDA on Windows) — live updates aren't spam
- [ ] Colorblind simulator in DevTools — bids/asks still distinguishable
- [ ] Deploy works: `vercel --prod` (or your platform of choice)
- [ ] README, DECISIONS.md, AI_USAGE.md all written
- [ ] Repo is public, includes screenshots in README
- [ ] Loom video recorded — 5 minutes, walks through one hard problem

## Interview Drill Questions

1. What did you test and what did you choose not to test? Why?
2. Talk me through your testing pyramid for this project.
3. How does your app behave for a screen reader user during a fast market move?
4. What's a CSS/UX choice you're proud of?
5. What would you do differently with another two weeks?
6. What's the biggest weakness in your testing?
7. How did you measure performance? Show me numbers.
8. Walk me through your AI usage. Where did it help most? Where did it mislead you?
9. Why did you choose Playwright over Cypress?
10. If your CI runs the E2E test against the live deploy and Kraken's API goes down, what happens? (Test fails for the wrong reason. Mitigation: skip on flake, retry, or use a mock for E2E.)

## You're Ready

If you've built all 7 phases and can answer the drill questions from each, you've prepared more deeply than 95% of senior frontend candidates. The interview is now about *communicating* what you built — slowly, clearly, with specific numbers and trade-offs.

A few last tips for the interview itself:

1. **Speak in trade-offs.** "I chose X because Y, but it has drawback Z, which I'd address by doing W."
2. **Use specific numbers.** "16ms render budget", "20 bps of slippage", "26 bps taker fee."
3. **Don't pretend to know things you don't.** Saying "I haven't worked with futures, but here's how I'd approach it" is far stronger than guessing.
4. **Bring the project up early.** Once they ask about your experience, pivot to MiniKraken: *"Actually, I built a project that runs into exactly this — can I show you?"*

Good luck. You've got this.
