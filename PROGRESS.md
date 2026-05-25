# MiniKraken — Implementation Progress

Maintained by the `ai-usage-scribe` agent. Status values: `pending` | `in-progress` | `done` | `blocked`.

`Agent` = which skill agent implemented the step. `Commit` = short SHA (filled by human at commit time). `Notes` = one short phrase.

---

## Setup

| # | Step | Status | Agent | Commit | Notes |
|---|---|---|---|---|---|
| S1 | `.gitignore` | done | orchestrator | | covers Next, pnpm, vitest, Playwright, env, macOS |
| S2 | `.claude/agents/*` + `settings.json` | done | orchestrator | | 6 agents, perms allowlist |
| S3 | `CLAUDE.md` + `AI_USAGE.md` + `DECISIONS.md` + `PROGRESS.md` | done | orchestrator | | conventions + scribe-owned logs |
| S4 | `pnpm create next-app` + deps + strict tsconfig | done | orchestrator | | Next 16 + React 19; strict TS + extra flags; typecheck green |

## Phase 1a — WebSocket Fundamentals

| # | Step | Status | Agent | Commit | Notes |
|---|---|---|---|---|---|
| 1a.1 | Type connection states (discriminated union) | done | nextjs-react-engineer | | 6-variant discriminated union incl. `degraded` |
| 1a.2 | ConnectionManager skeleton (class) | done | nextjs-react-engineer | | implements `IConnectionManager`; concrete class exposes `acknowledgePong()` |
| 1a.3 | connect / onOpen / onClose | done | nextjs-react-engineer | | `connect()` idempotent; `disconnect()` clears outbound buffer |
| 1a.4 | Exponential backoff + jitter | done | nextjs-react-engineer | | fast backoff exhausts then shifts to 5-min slow-cadence `degraded` retry |
| 1a.5 | Heartbeat (ping/pong + timeout) | done | nextjs-react-engineer | | two tracked timers (`heartbeatTimer`, `pongDeadlineTimer`); pauses on `visibilitychange` |
| 1a.6 | Outbound buffer | done | nextjs-react-engineer | | drop-newest overflow; `send()` returns `boolean`; orders bypass entirely |
| 1a.7 | React hook via `useSyncExternalStore` | done | nextjs-react-engineer | | `"use client"` + SSR guard + `globalThis` HMR stash |
| 1a.V | Verification checklist | done | nextjs-react-engineer | | `pnpm typecheck` clean; all arch-review recommendations applied |

## Phase 1b — Kraken Integration

| # | Step | Status | Agent | Commit | Notes |
|---|---|---|---|---|---|
| 1b.1 | Read Kraken WS v2 docs | done | realtime-architect | | reviewed before implementation; informed schema and DI decisions |
| 1b.2 | Install Zod | done | orchestrator | | Zod v4 installed |
| 1b.3 | Kraken message schemas (Zod + discriminated union) | done | trading-domain-engineer | | two-tier union; floats not strings; selective passthrough; typecheck clean |
| 1b.4 | KrakenClient (parse + dispatch) | done | nextjs-react-engineer | | DI constructor; typed fan-out via `onMessage<T>`; pong ack wired |
| 1b.5 | SubscriptionManager (ref-counted) | done | nextjs-react-engineer | | two-phase state; holds sends when not open |
| 1b.6 | Resubscribe on reconnect | done | nextjs-react-engineer | | batched `resubscribeAll()`; buffer cleared on close; sole replay path |
| 1b.7 | Singleton + `useChannelSubscription` hook | done | nextjs-react-engineer | | SSR guard + `globalThis` HMR stash; `'use client'` directive |
| 1b.V | Verification checklist | done | nextjs-react-engineer | | `pnpm typecheck` clean; all arch-review recommendations applied |

## Phase 2a — Order Book Data

| # | Step | Status | Agent | Commit | Notes |
|---|---|---|---|---|---|
| 2a.1 | Pick data structure (sorted array, documented) | done | trading-domain-engineer | | sorted array with Decimal prices; `toLevel` is sole conversion boundary |
| 2a.2 | OrderBook implementation | done | trading-domain-engineer | | `Decimal.equals()` for lookup; `topChanged` handles empty→non-empty transitions |
| 2a.3 | CRC32 checksum (Kraken format) | done | trading-domain-engineer | | `formatForChecksum` uses `toFixed()` + split-on-dot; handles scientific notation |
| 2a.4 | Checksum failure → resync | done | realtime-architect + nextjs-react-engineer | | provider-driven via `checksumStatus` field; `'resyncing'` blocks delta application; surfaces in UI |
| 2a.5 | Zustand store (`useOrderBookStore`) | done | nextjs-react-engineer | | three-state machine per symbol; `applyUpdate` drops during resyncing |
| 2a.6 | Wire to KrakenClient messages | done | nextjs-react-engineer | | `OrderBookProvider` pipes via `toLevel`; null guard on `getKrakenClient()` |
| 2a.V | Verification checklist (incl. checksum-vs-Kraken-example) | done | nextjs-react-engineer | | `pnpm typecheck` zero errors confirmed by orchestrator |

## Phase 2b — Order Book Rendering

| # | Step | Status | Agent | Commit | Notes |
|---|---|---|---|---|---|
| 2b.1 | Perf instrumentation (marks, measures) | done | nextjs-react-engineer | | `markUpdateReceived`/`markUpdateRendered`; 16ms warn threshold |
| 2b.2 | Naive baseline (measure first) | done | react-performance-engineer | | measured under 2ms/sec React work at 50 rows × 50 updates/sec |
| 2b.3 | Identify bottlenecks via Profiler | done | react-performance-engineer | | no Profiler bottleneck found at baseline load |
| 2b.4 | Stabilize parent re-renders | done | nextjs-react-engineer | | parent subscribes only to `lastUpdateAt` for the symbol |
| 2b.5 | Memoize rows (primitive props) | done | nextjs-react-engineer | | selector returns pre-formatted strings; `memo`'s `===` works; roadmap `price: number` rejected |
| 2b.6 | Row-level subscriptions | done | nextjs-react-engineer | | `useStoreWithEqualityFn` (Zustand v5); `useMemo` on factory selector |
| 2b.7 | Flash animation (imperative) | done | nextjs-react-engineer | | imperative `classList` + forced reflow; no state; string inequality on `qtyStr` |
| 2b.8 | Depth bars | done | nextjs-react-engineer | | `::before` pseudo-element + `--depth-pct` CSS variable; cumulative depth in selector |
| 2b.9 | rAF coalescence (if needed) | done | react-performance-engineer | | deferred by architecture decision; add only if p95 update-to-paint > 12ms |
| 2b.10 | Final measurement + baseline-vs-optimized table | done | react-performance-engineer | | baseline is the optimized baseline; no separate regression found |
| 2b.V | Verification checklist | done | nextjs-react-engineer | | `pnpm typecheck` zero errors; both Zustand v5 and context-signature mismatches caught at typecheck |

## Phase 3 — Candlestick Charting

| # | Step | Status | Agent | Commit | Notes |
|---|---|---|---|---|---|
| 3.1 | Pick chart library (lightweight-charts), document | done | realtime-architect + nextjs-react-engineer | | lightweight-charts v5; v5 `addSeries` API documented in DECISIONS.md |
| 3.2 | Candle types + Zod schemas | done | nextjs-react-engineer | | REST OHLC shape and WS ohlc push shape separated into distinct schemas |
| 3.3 | REST fetcher with AbortSignal | done | nextjs-react-engineer | | AbortSignal wired; `toKrakenPair` normalizer included |
| 3.4 | Candle store with race-aware buffering | done | realtime-architect + nextjs-react-engineer | | load token, version counter, materialized array ref, pending buffer drains post-applyHistorical |
| 3.5 | `useCandles` orchestrating hook | done | realtime-architect + nextjs-react-engineer | | single effect; `getState()` for actions; interval subscription via SubscriptionManager |
| 3.6 | Chart component (imperative setData/update) | done | realtime-architect + nextjs-react-engineer | | single imperative effect; `setData` on load, `update` on live tick; lightweight-charts v5 |
| 3.7 | Interval switcher UI | done | nextjs-react-engineer | | ChartShell with interval switcher and load state indicator |
| 3.V | Verification checklist | done | nextjs-react-engineer | | pnpm typecheck 0 errors |

## Phase 4a — Order Matching & Simulation

| # | Step | Status | Agent | Commit | Notes |
|---|---|---|---|---|---|
| 4a.1 | Domain types (OrderRequest, Fill, FilledOrder, OpenOrder) | done | trading-domain-engineer | | Domain types: Side, OrderType, OrderRequest, Fill, FilledOrder, OpenOrder — all Decimal |
| 4a.2 | `simulateMarketOrder` (walk the book) | done | trading-domain-engineer | | simulateMarketOrder walks book with Decimal; skipped native-number intermediate step |
| 4a.3 | `useMarketOrderPreview` hook | done | trading-domain-engineer | | useMarketOrderPreview; lastUpdateAt-gated useMemo; 26bps hardcoded taker |
| 4a.4 | OrderEntry form | done | nextjs-react-engineer | | OrderEntry form; market/limit tabs; slippage color-coded; useLimitFillTrigger mounted |
| 4a.5 | Trading store (placeOrder, openOrders, filledOrders) | done | trading-domain-engineer | | useTradingStore: placeOrder, cancelOpenOrder, tryFillOpenOrders |
| 4a.6 | Limit-fill trigger on book updates (throttled) | done | trading-domain-engineer | | useLimitFillTrigger: per-symbol store subscriber; throttle via topOfBook check |
| 4a.7 | Open + filled orders UI | done | nextjs-react-engineer | | OpenOrders + FilledOrders tables; cancel; last-20 cap |
| 4a.V | Verification checklist | done | trading-domain-engineer + nextjs-react-engineer | | pnpm typecheck 0 errors |

## Phase 4b — P&L & Decimal Precision

| # | Step | Status | Agent | Commit | Notes |
|---|---|---|---|---|---|
| 4b.1 | Centralize `decimal.js` (banker's rounding) | done | trading-domain-engineer | | src/lib/money/decimal.ts: ROUND_HALF_EVEN, precision 28 |
| 4b.2 | Refactor simulate to Decimal | done | trading-domain-engineer | | simulate.ts Decimal throughout; Level.price/qty already Decimal |
| 4b.3 | Position model | done | trading-domain-engineer | | Position interface with totalCostBasis for fast P&L |
| 4b.4 | `applyFillToPosition` (open / reduce / **flip**) | done | trading-domain-engineer | | applyFillToPosition: all 3 cases; flip fee split proportional-by-size |
| 4b.5 | `computeUnrealizedPnl` | done | trading-domain-engineer | | computeUnrealizedPnl: long/short branch; correct sign convention |
| 4b.6 | Mark-price selection (side-aware, documented) | done | trading-domain-engineer | | chooseMarkPrice: side-aware (bestBid for long, bestAsk for short) |
| 4b.7 | Positions store | done | trading-domain-engineer | | usePositionsStore: applyFilledOrder; retains position if realizedPnl nonzero |
| 4b.8 | `usePositionWithPnl` hook | done | trading-domain-engineer | | usePositionWithPnl: row-level subscription; markPrice + unrealizedPnl |
| 4b.9 | Positions UI panel | done | nextjs-react-engineer | | PositionsPanel + PnlText; row-level subs; sign-aware color |
| 4b.V | Verification checklist (incl. worked examples) | done | trading-domain-engineer + nextjs-react-engineer | | pnpm typecheck 0 errors |

## Backlog — Money-Math Audit (L8, L9, H9)

| # | Step | Status | Agent | Commit | Notes |
|---|---|---|---|---|---|
| BM1 | L8: `feeBps` integer-guard + JSDoc caller contract | done | trading-domain-engineer | | integer-guard assertion; Decimal wrap rejected as overengineered for config param |
| BM2 | L9: JSDoc on `FilledOrder.totalCost` (excludes fees) | done | trading-domain-engineer | | clarifies phase 6+ fee-inclusion intent |
| BM3 | H9: Decimal-only comment in positions-store (deferred to phase 6+) | in-progress | trading-domain-engineer | | no number accumulator exists yet; comment lands now, code fix blocked on phase 6 fill aggregation |

## Backlog — Performance (H7: O(N²) selector fix)

| # | Step | Status | Agent | Commit | Notes |
|---|---|---|---|---|---|
| BP1 | H7: remove O(N²) cumulative-depth work from `selectLevelDisplay`; hoist depth-pct into `OrderBook` `useMemo` | done | react-performance-engineer | | 6x p95 speedup (0.098ms → 0.016ms); `depthPct` removed from selector; `BookRow` receives prop |

## Backlog — Subscription Reliability (H3/H4/H5/M9)

| # | Step | Status | Agent | Commit | Notes |
|---|---|---|---|---|---|
| B1 | H3: `req_id` ack correlation design | done | realtime-architect | | req_id sole correlator; unmatched acks discarded |
| B2 | H4: `unsubscribing`/`queuedResubscribe` state machine design | done | realtime-architect | | entries persist through unsubscribing; releasePending dequeues on ack |
| B3 | H5/M9: per-key monotonic epoch design | done | realtime-architect | | manager-owned epoch; stamped at parse time; O(1) reject in store |
| B4 | H3/H4/H5 implementation | done | nextjs-react-engineer | | 71/71 tests pass; req_id at frame top-level; resubscribeAll multi-symbol ack mismatch benign |
| B5 | Ack-watchdog timeout | pending | | | separate backlog ticket; not part of current trio |

## Backlog — Cross-Cutting Hardening (post-Phase 5)

| # | Step | Status | Agent | Commit | Notes |
|---|---|---|---|---|---|
| BH0 | Planning: per-issue plans for H1, H2, H6, H8, M1–M11, L2–L11 | done | nextjs-react-engineer | | H3/H4/H5 blocked on architect; M2/M3 scope deferred; L3 dependent on H6 |
| BH1a | H3/H4/H5 architecture review (impl deltas) | done | realtime-architect | | 4 deltas identified; req_id vs epoch invariant locked; 4 human decisions resolved |
| BH1 | H1: connection-manager hardening | done | nextjs-react-engineer | | 92/92 tests pass; typecheck clean |
| BH2 | H2: connection-manager hardening | done | nextjs-react-engineer | | implemented alongside H1 |
| BH3 | H3/H4/H5 deltas: releasePending clear, watchdog (10s), reconnect-wipe, per-symbol resub, error-ack retry/failure, destroy() cleanup | done | nextjs-react-engineer | | wipePendingOnDisconnect fires on all non-open statuses; epoch double-bump fixed as side effect |
| BH6 | H6: Suspense boundaries + skeletons (page.tsx stays Server Component) | done | nextjs-react-engineer | | browser verification (throttled network) deferred to human |
| BH8 | H8: OrderBook rows keyed by rawPrice string | done | nextjs-react-engineer | | eliminates unmount/remount churn on depth changes |
| BM1x | M1: in-place Map mutation in orderbook-store | done | nextjs-react-engineer | | eliminates per-tick clone |
| BM2 | M2: de-duplicate hex values in globals.css (class names preserved) | done | nextjs-react-engineer | | conservative scope; class names unchanged |
| BM3x | M3: CSS token conservative (--background/--foreground kept as plain CSS vars, not @theme inline) | done | nextjs-react-engineer | | human chose conservative scope to avoid cascade bleed |
| BM4 | M4: CSS token / utility addition in globals.css | done | nextjs-react-engineer | | globals.css |
| BM5 | M5: OrderEntry validation hardening | done | nextjs-react-engineer | | OrderEntry.tsx |
| BM6 | M6: getBestBidPrice / getBestAskPrice on OrderBook; eliminates selector array allocation | done | nextjs-react-engineer | | orderbook.ts + CurrentPrice.tsx |
| BM8 | M8: OrderEntry UX hardening | done | nextjs-react-engineer | | OrderEntry.tsx |
| BM10 | M10: sendControl method on ConnectionManager + corrected buffer comment | done | nextjs-react-engineer | | connection-manager.ts |
| BM11 | M11: arm pong deadline timer on visibility restore | done | nextjs-react-engineer | | connection-manager.ts |
| BL2 | L2: layout.tsx className set statically from font CSS vars; no suppressHydrationWarning | done | nextjs-react-engineer | | layout.tsx |
| BL3 | L3: route-level loading.tsx skeleton | done | nextjs-react-engineer | | src/app/loading.tsx (new file) |
| BL4 | L4: OrderEntry.tsx update (L4 item) | done | nextjs-react-engineer | | OrderEntry.tsx |
| BL5 | L5: selector comment (selectors.ts) | done | nextjs-react-engineer | | selectors.ts |
| BL6 | L6: OrderEntry !&#61;&#61; null → !&#61; null fix (exactOptionalPropertyTypes) | done | nextjs-react-engineer | | self-caught; satisfies exactOptionalPropertyTypes on OrderRequest spread |
| BL7 | L7: optional chain kept in candles-store; comment documents noUncheckedIndexedAccess requirement | done | nextjs-react-engineer | | candles-store.ts |
| BL10 | L10: usePosition hook added to positions-store | done | nextjs-react-engineer | | positions-store.ts |
| BL11 | L11: clarifying comment in connection-manager | done | nextjs-react-engineer | | connection-manager.ts |

## Backlog — Candle Chart Bug (H10)

| # | Step | Status | Agent | Commit | Notes |
|---|---|---|---|---|---|
| BH10a | H10: diagnosis — ohlcDataSchema uses z.string(); Kraken WS v2 sends numbers; frames silently dropped at parse | done | realtime-architect | | root cause confirmed; console.debug → console.warn; fix scoped to schema change only |
| BH10b | H10: fix — change ohlcDataSchema fields to z.number(); upgrade parse-failure log to console.warn | done | nextjs-react-engineer | | 96→99 tests; regression guard added; browser verification of live candle mutation still owed |
| BM13 | M13: per-interval handler routing in use-candles.ts | pending | | | surfaced as out-of-scope by H10 diagnosis; filed as separate ticket |
| BH11 | H11: chart price-axis vs. header price ~10c gap — verdict: not a bug (best bid vs. last trade); header label recommendation pending human decision | done | realtime-architect + nextjs-react-engineer | | CurrentPrice rewritten: labeled Bid/Ask/Spread; selector boundary conversions; bidAskSpreadEqual comparator; 99/99 tests pass |

## Backlog — UX/UI Iteration (H12)

| # | Step | Status | Agent | Commit | Notes |
|---|---|---|---|---|---|
| BH12 | H12: layout rework — top AssetInfoBar, 3-col grid (chart\|book\|right rail), full-width bottom tabs | done | nextjs-react-engineer | | 99/99 tests pass; 24h widgets mocked; browser verification owed by human |

## Phase 5 — Testing, A11y, Polish, Deploy

| # | Step | Status | Agent | Commit | Notes |
|---|---|---|---|---|---|
| 5.1 | Test stack install + vitest config | done | qa-test-engineer | | vitest + RTL + jsdom + Playwright config wired; test scripts in package.json |
| 5.2 | OrderBook unit tests | done | qa-test-engineer | | 15 tests; real Decimal Level shape; behavior-only queries |
| 5.3 | Position math unit tests (incl. flip case) | done | qa-test-engineer | | 13 tests; all 3 applyFillToPosition cases incl. flip |
| 5.4 | Simulator unit tests | done | qa-test-engineer | | 12 tests; Decimal throughout; partial-fill and slippage cases |
| 5.5 | OrderEntry component tests (RTL) | done | qa-test-engineer | | 13 tests; a11y bug in OrderEntry.tsx fixed (htmlFor/id); warning-visible not button-disabled for insufficient liquidity |
| 5.6 | Playwright E2E smoke test | pending | | | |
| 5.7 | A11y: debounced aria-live, sr-only ticker | pending | | | |
| 5.8 | Keyboard navigation pass | pending | | | |
| 5.9 | Color/contrast + non-color signals | pending | | | |
| 5.10 | Lighthouse pass (≥90 perf, 100 a11y) | pending | | | |
| 5.11 | README polish | pending | | | |
| 5.12 | DECISIONS.md final (≥10 entries) | pending | | | |
| 5.13 | AI_USAGE.md final review | pending | | | |
| 5.V | Verification checklist | pending | | | |
