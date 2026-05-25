# BACKLOG

Tracks audit-surfaced issues. Owner = the agent that should fix it. Status: `todo` / `in-progress` / `blocked` / `done` / `wontfix`.

Source: shallow audit on 2026-05-25 by `realtime-architect`, `nextjs-react-engineer`, `react-performance-engineer`, `trading-domain-engineer`.

---

## 🔴 High

| ID | Issue | File / Loc | Owner | Status | Notes |
|----|-------|------------|-------|--------|-------|
| H1 | `connect()` no-ops when socket is `CLOSING`; `intentionallyClosed` reset never runs → manual reconnect silently dies | `src/lib/ws/connection-manager.ts` | nextjs-react-engineer | done | Landed 2026-05-25 (cross-cutting hardening wave) |
| H2 | Heartbeat deadline armed before ping actually leaves the socket (can be buffered) → false-positive dead-connection detection | `src/lib/ws/connection-manager.ts` | nextjs-react-engineer | done | Landed 2026-05-25 (cross-cutting hardening wave) |
| H3 | Subscribe-ack matches by `(channel, symbol)` only; two book subs at different depths mark the wrong one subscribed | `src/lib/kraken/subscription-manager.ts` | nextjs-react-engineer | done | Landed 2026-05-25: `req_id` correlation + `pendingRequests` map; 10 unit tests |
| H4 | `releaseSubscription` deletes entry immediately; fast resubscribe sends duplicate before unsub-ack | `src/lib/kraken/subscription-manager.ts` | nextjs-react-engineer | done | Landed 2026-05-25: discriminated `Phase` (`subscribing`/`subscribed`/`unsubscribing`/`idle`) with `queuedResubscribe` + `releasePending` |
| H5 | Resync race: in-flight updates from old subscription can land between snapshot and next checksum, poison state | `src/stores/orderbook-store.ts` + `src/components/OrderBookProvider.tsx` | nextjs-react-engineer | done | Landed 2026-05-25: per-key monotonic epoch owned by `SubscriptionManager`; provider stamps every store call; HMR `resyncing` reset removed |
| H6 | No `<Suspense>` around heavy client subtrees (chart, right column) → initial paint blocked on slow chunks | `src/app/page.tsx` | nextjs-react-engineer | done | Landed 2026-05-25; per-column Suspense + skeletons. Browser verification under network throttling deferred to human |
| H7 | `selectLevelDisplay` does O(N²) work per tick (cumulative qty + total iteration per row) | `src/components/orderbook/selectors.ts:18-26` | react-performance-engineer | done | Fixed 2026-05-25: depth-pct hoisted to `OrderBook` `useMemo`; selector now O(1). 6x p95 speedup (0.098ms→0.016ms) |
| H8 | Order book rows use index keys (`key={i}`) → DOM reuse bug when top level drops | `src/components/orderbook/OrderBook.tsx` | nextjs-react-engineer | done | Landed 2026-05-25; keyed by `rawPrice` string |
| H9 | Future: `fill.fee` aggregation across partial fills must stay in Decimal (no `number` accumulator) | `src/stores/positions-store.ts` (phase 6+) | trading-domain-engineer | in-progress | Comment landed 2026-05-25; code fix deferred until phase 6+ fill aggregation spec lands |
| H10 | Live candle chart never updates — `ohlcDataSchema` declares price/volume as `z.string()` but Kraken WS v2 sends numbers; every live frame fails Zod and is dropped silently at `console.debug` | `src/lib/kraken/schemas.ts` + `src/lib/kraken/client.ts` + `src/lib/candles/use-candles.ts` | nextjs-react-engineer | done | Landed 2026-05-25: schema fields flipped to `z.number()`, `timestamp` optional, `.passthrough()` added, `parseFloat` removed, parse-failure log → `console.warn`. 3 new schema tests (99/99 pass). Manual browser verification owed by human |
| H11 | Chart price-axis label diverges from title-bar/CurrentPrice (e.g. `77042.70` vs `77042.60`). Possibly expected (chart = last ohlc close; title/CurrentPrice = book best bid/ask) but warrants architect read | `src/components/CurrentPrice.tsx` | nextjs-react-engineer | done | Architect verdict 2026-05-25: not a bug, two-stream divergence (book best-bid vs ohlc last-trade). Fix landed: header now shows Bid/Ask/Spread with labels. 99/99 tests pass |
| H12 | Layout rework — current two-column lacks structure and breathing room. Target: top asset-info bar, 3-column main (chart \| book \| right rail with OrderEntry + Portfolio placeholder), full-width bottom tabs, consistent card spacing | `src/app/page.tsx` + `AssetInfoBar`, `PortfolioPlaceholder` (new) | nextjs-react-engineer | done | Landed 2026-05-25: `max-w-[1600px]` 3-col grid, mocked 24h widgets, portfolio placeholder w/ preview rows, card-wrapped sections with `gap-3`. 99/99 tests pass |

---

## 🟡 Medium

| ID | Issue | File / Loc | Owner | Status | Notes |
|----|-------|------------|-------|--------|-------|
| M1 | Clones `books` Map on every tick, defeats mutable-hot-path design | `src/stores/orderbook-store.ts` | nextjs-react-engineer | done | Landed 2026-05-25; in-place `Map` mutation |
| M2 | Parallel CSS class system (`.order-book`, `.book-row*`) with hardcoded hex duplicates Tailwind tokens | `src/app/globals.css` | nextjs-react-engineer | done | Landed 2026-05-25 (M/L tier wave); conservative de-dupe, class names preserved |
| M3 | `@theme inline` wires `--background`/`--foreground` but app uses `bg-zinc-950` directly → token layer unused | `src/app/globals.css` + `src/app/page.tsx` | nextjs-react-engineer | done | Landed 2026-05-25; dropped from `@theme inline`, kept as plain CSS vars on body |
| M4 | `body { font-family: Arial }` overrides Geist wired four lines earlier in `@theme` | `src/app/globals.css` | nextjs-react-engineer | done | Landed 2026-05-25 (M/L tier wave) |
| M5 | Repeated 7-utility input pattern duplicated across inputs | `src/components/trading/OrderEntry.tsx` | nextjs-react-engineer | done | Landed 2026-05-25 (M/L tier wave) |
| M6 | `CurrentPrice` selector calls `getBids(1)` → new array reference per tick | `src/components/CurrentPrice.tsx` | nextjs-react-engineer | done | Landed 2026-05-25; `getBestBidPrice()` / `getBestAskPrice()` on OrderBook |
| M7 | `OrderBook` fires three independent inline selectors per render; all fire on any symbol's update | `src/components/orderbook/OrderBook.tsx:22-32` | react-performance-engineer | deferred | Selectors return primitives; storm only materializes under multi-symbol UI. Re-evaluate when that lands |
| M8 | `OrderEntry.isDisabled` is an IIFE on every render | `src/components/trading/OrderEntry.tsx` | nextjs-react-engineer | done | Landed 2026-05-25 (M/L tier wave) |
| M9 | `forceResync` race: unsub+sub on same tick; orphan updates from old sub can pass checksum coincidentally | `src/lib/kraken/subscription-manager.ts` | nextjs-react-engineer | done | Landed 2026-05-25 with H5: `forceResync` → `requestResync` bumps epoch before unsubscribe and routes through `queuedResubscribe` path |
| M12 | Never-acked subscribe/unsubscribe hangs forever in `subscribing`/`unsubscribing` (no watchdog) | `src/lib/kraken/subscription-manager.ts` | nextjs-react-engineer | done | Landed 2026-05-25 (architect-delta wave); `ACK_TIMEOUT_MS=10000` watchdog + reconnect-wipe + error-ack retry |
| M13 | `use-candles` live handler matches on `channel === 'ohlc' && symbol === sym` without checking the wire payload's `interval` → fast interval switches could leak updates across intervals | `src/lib/candles/use-candles.ts:36-55` | nextjs-react-engineer | todo | Latent — doesn't manifest today (ChartShell mounts one Chart at a time). Architect flag during H10 diagnosis |
| M10 | Outbound buffer overflow drops newest but comment says "oldest preserved"; control frames shouldn't buffer | `src/lib/ws/connection-manager.ts` | nextjs-react-engineer | done | Landed 2026-05-25; `sendControl` method + corrected comment |
| M11 | Visibility-restore ping doesn't arm pong deadline → dead TCP after sleep undetected for 30s | `src/lib/ws/connection-manager.ts` | nextjs-react-engineer | done | Landed 2026-05-25 (M/L tier wave) |

---

## 🟢 Low

| ID | Issue | File / Loc | Owner | Status | Notes |
|----|-------|------------|-------|--------|-------|
| L1 | `BookRow` not wrapped in `React.memo` | `src/components/orderbook/BookRow.tsx:15` | react-performance-engineer | wontfix | Re-renders are gated by `useStoreWithEqualityFn` + `levelDisplayEqual`, not parent. `memo` would skip zero renders |
| L2 | `layout.tsx` missing `suppressHydrationWarning` if theme class is script-applied | `src/app/layout.tsx` | nextjs-react-engineer | done | Landed 2026-05-25; className set statically from font vars (no `suppressHydrationWarning` needed) |
| L3 | No `loading.tsx` at route level | `src/app/` | nextjs-react-engineer | done | Landed 2026-05-25 (M/L tier wave) |
| L4 | No `useTransition` around `placeOrder` dispatch | `src/components/trading/OrderEntry.tsx` | nextjs-react-engineer | done | Landed 2026-05-25 (M/L tier wave) |
| L5 | `levels[i]?.qty.toNumber() ?? 0` masks potential out-of-bounds logic error | `src/components/orderbook/selectors.ts` | nextjs-react-engineer | done | Landed 2026-05-25; clarifying comment added |
| L6 | Redundant `undefined` check after `parseSafeDecimal` (returns `Decimal \| null`) | `src/components/trading/OrderEntry.tsx` | nextjs-react-engineer | done | Landed 2026-05-25 (M/L tier wave) |
| L7 | Redundant double-guard around `candles[candles.length - 1]?.time ?? 0` | `src/stores/candles-store.ts` | nextjs-react-engineer | done | Landed 2026-05-25; chain kept intentionally (required by `noUncheckedIndexedAccess`), comment documents the constraint |
| L8 | `feeBps: number` parameter could silently accept floats before Decimal wrapping | `src/lib/trading/simulate.ts:26` | trading-domain-engineer | done | Integer-guard assertion added + JSDoc caller contract; Decimal wrap rejected as overengineered for config param |
| L9 | `FilledOrder.totalCost` lacks JSDoc clarifying it excludes fees | `src/lib/trading/types.ts:27` | trading-domain-engineer | done | JSDoc added clarifying fee exclusion and phase 6+ intent |
| L10 | `positions-store` exposes no per-symbol selector hook; callers may subscribe to whole `positions` Map | `src/stores/positions-store.ts` | nextjs-react-engineer | done | Landed 2026-05-25; `usePosition(symbol)` hook added |
| L11 | Defensive `Array.from(listeners).forEach` lacks comment explaining why | `src/lib/ws/connection-manager.ts` | nextjs-react-engineer | done | Landed 2026-05-25; clarifying comment added |

---

## Workflow

- New audit findings → append to the right severity table with a new ID (continue the H/M/L counter).
- Moving status: edit the row in place. `done` rows stay in the table for traceability; archive to a `## Done` section at the bottom only when the table grows unwieldy.
- The orchestrator (this file's writer) is the only thing that mutates this file. Agents flag completions back via their normal hand-off — orchestrator updates the row, then routes the work to `ai-usage-scribe` as usual.
- `PROGRESS.md` (roadmap completion) and `AI_USAGE.md` (AI leverage log) remain scribe-owned. This file is orthogonal.
