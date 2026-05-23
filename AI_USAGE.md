# How I used AI building MiniKraken

This log is maintained by the `ai-usage-scribe` agent. Every non-trivial delegation to a Claude Code subagent during this project is recorded below with what worked, what didn't, and what the human corrected.

The goal: by the time Phase 5 ships, this file is the honest, specific, evidence-backed answer to "how did you use AI?" — not a retrofit.

## Entry template

```markdown
### YYYY-MM-DD — phase/feature short name

- **Agent:** {{agent name}}
- **Task:** {{1-line description}}
- **What AI got right:** {{specific facts}}
- **What AI got wrong:** {{specific bugs / misreadings / hallucinated APIs. "Nothing notable." is acceptable.}}
- **Human correction:** {{what was changed before accepting, or "Accepted as-is."}}
- **Files touched:** {{paths}}
```

Group entries under phase headings (`## Phase 2a — Order Book Data`). New phases get added as we reach them.

---

## Setup

### 2026-05-22 — Project scaffolding plan

- **Agent:** orchestrator (no subagent)
- **Task:** Read `roadmap/` end-to-end, propose agent topology and scaffolding plan.
- **What AI got right:** Surfaced the realtime/perf/trading split as skill axes rather than phase axes. Caught that the scribe needs to be the sole writer of `AI_USAGE.md` and `PROGRESS.md` to avoid drift.
- **What AI got wrong:** Initial proposal was phase-aligned agents. Human redirected to skill-aligned.
- **Human correction:** Switched agent topology from phase-aligned to skill-aligned (react/next, QA, architect, trading domain, perf, scribe). Specified opus for architect, sonnet for implementation. Asked for boilerplate to be scaffolded.
- **Files touched:** none yet (planning only)

### 2026-05-22 — Boilerplate scaffolding

- **Agent:** orchestrator (no subagent)
- **Task:** Scaffold Next.js app, install runtime/test deps, tighten tsconfig, add scripts.
- **What AI got right:** Caught that `pnpm create next-app .` refuses to run in a non-empty directory and pivoted to scaffolding in `/tmp/mk-scaffold` then moving files in. Resulting Next 16 + React 19 + Tailwind 4 setup typechecks cleanly under `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`. Noticed scaffold's `AGENTS.md` warning that Next 16 has breaking changes from training data and folded it into `CLAUDE.md`.
- **What AI got wrong:** When moving scaffold files in, included `CLAUDE.md` in the move list and overwrote the project's comprehensive conventions file with the scaffold's one-line `@AGENTS.md` stub. Caught by the system-reminder diff notification.
- **Human correction:** None directly — orchestrator self-corrected by restoring the full `CLAUDE.md` from memory of what it had just written, and added the Next 16 warning section. Worth noting: without the system-reminder, the regression would have been invisible.
- **Files touched:** `package.json`, `tsconfig.json`, `.gitignore`, `CLAUDE.md`, `next.config.ts`, `next-env.d.ts`, `eslint.config.mjs`, `postcss.config.mjs`, `src/**`, `public/**`, `pnpm-lock.yaml`

## Phase 1a — WebSocket Fundamentals

### 2026-05-23 — Phase 1a architecture review

- **Agent:** realtime-architect (opus)
- **Task:** Evaluate 5 specific design concerns in the Phase 1a roadmap before any code was written.
- **What AI got right:** Identified all 5 problems correctly and with actionable resolutions. (1) Spotted that `subscribe<T>(predicate, handler)` on `ConnectionManager` conflicted with the roadmap's own `Set<MessageListener>` implementation — recommended deferring typed fan-out to KrakenClient in Phase 1b and making `ConnectionManager` transport-only via `onRawMessage`. (2) Flagged that a module-level singleton is SSR-unsafe and HMR-fragile under Next.js App Router; recommended `"use client"` + `typeof window` guard + `globalThis.__minikrakenManager` dev stash. (3) Caught that nested anonymous `setTimeout` inside `setInterval` for heartbeat cannot be cancelled; recommended two tracked instance fields (`heartbeatTimer`, `pongDeadlineTimer`) cleared on every close/stop, plus `document.visibilitychange` pause. (4) Argued against dropping oldest on buffer overflow — dropping newest (incoming) is safer and `send()` should return `boolean`. (5) Identified hard stop after 20 reconnect attempts as a dead-tab failure mode; recommended shifting to slow-cadence retry (`degraded` status, 5-min interval) after fast backoff exhausts. Also surfaced: `getAttemptCount()` read-after-write hazard, non-idempotent `connect()` with pending timer not cleared, undefined `disconnect()` semantics, uncaught `new WebSocket()` throws, `setState` listener set mutation hazard.
- **What AI got wrong:** Nothing notable.
- **Human correction:** Accepted all 5 recommendations. Added one requirement to recommendation 5: UI must surface `degraded` state visibly.
- **Files touched:** none (architecture review only)

### 2026-05-23 — Phase 1a implementation

- **Agent:** nextjs-react-engineer (sonnet)
- **Task:** Implement `ConnectionState` discriminated union, `ConnectionManager` class, and `useConnectionState` hook per the architecture-reviewed design.
- **What AI got right:** Produced all three files in a single pass with zero typecheck errors (`pnpm typecheck` clean). Correctly implemented `degraded` as a 6th connection state variant. Applied two tracked instance fields for heartbeat timers (`heartbeatTimer`, `pongDeadlineTimer`) that are cleared on close/stop. Implemented `send()` returning `boolean` with drop-newest overflow policy. Added `"use client"` directive, `typeof window` SSR guard, and `globalThis.__minikrakenManager` HMR stash in the hook file. Exposed `acknowledgePong()` as a public method on the concrete class (not on the interface) for Phase 1b wiring. Caught and fixed 3 issues during implementation without prompting: (1) `exactOptionalPropertyTypes` required spread-optional pattern for `lastCloseCode`/`lastCloseReason` fields; (2) `fastAttempts` counter had a read-after-write hazard that was resolved before submission; (3) `noUncheckedIndexedAccess` required a non-null check on `outboundBuffer.shift()`.
- **What AI got wrong:** Nothing notable — the 3 issues caught were self-identified and self-corrected during implementation, not post-review failures.
- **Human correction:** Accepted as-is.
- **Files touched:** `src/lib/ws/types.ts`, `src/lib/ws/connection-manager.ts`, `src/lib/ws/use-connection.ts`

## Phase 1b — Kraken Integration

### 2026-05-23 — Phase 1b architecture review

- **Agent:** realtime-architect (opus)
- **Task:** Pre-implementation review of 4 cross-layer design concerns before any Phase 1b code was written.
- **What AI got right:** Identified all 4 concerns with actionable resolutions. (1) Caught that roadmap's `KrakenClient` called `new ConnectionManager(...)` internally, which would open a second socket alongside the Phase 1a singleton; recommended DI — `KrakenClient(manager: ConnectionManager)` — with the composition root wiring the singleton. (2) Identified that `acknowledgePong()` belonged on `IConnectionManager` rather than only the concrete class, correctly framing it as a transport/protocol seam. (3) Confirmed no init race exists when `SubscriptionManager` listens through `KrakenClient.onConnectionStateChange()` as long as all listeners are wired before `manager.connect()` fires; warned against `SubscriptionManager` touching `ConnectionManager` directly. (4) Recommended clearing the outbound buffer on socket close so `resubscribeAll()` is the sole authoritative replay path, eliminating a double-subscribe bug from buffer+resubscribe interaction.
- **What AI got wrong:** Nothing notable.
- **Human correction:** Accepted all 4 recommendations. The orchestrator applied the `IConnectionManager` and buffer-clear changes to `connection-manager.ts` before implementation began, and logged 4 entries in `DECISIONS.md`.
- **Files touched:** none (architecture review only); orchestrator applied changes to `src/lib/ws/connection-manager.ts`

### 2026-05-23 — Kraken message schemas

- **Agent:** trading-domain-engineer (sonnet)
- **Task:** Implement Zod v4 message schemas for all Kraken WS v2 message types in `src/lib/kraken/schemas.ts`.
- **What AI got right:** Modeled `price` and `qty` as `z.number()` correctly — Kraken WS v2 sends floats, not strings. Structured the schema as a two-tier union: `z.discriminatedUnion("channel", [...])` for channel messages and `z.discriminatedUnion("method", [...])` for method messages, composed with `z.union([...])`. Applied `passthrough()` selectively on `bookDataSchema`, `statusDataSchema`, and `subscribeResultSchema` only — not on top-level envelopes. Made `type` on `statusSchema` `.optional()` to handle initial connection status messages that omit it. Made `error` on ack schemas `.optional()` to handle the success case where the field is absent. Typecheck clean on first pass.
- **What AI got wrong:** Nothing notable.
- **Human correction:** Accepted as-is.
- **Files touched:** `src/lib/kraken/schemas.ts`

### 2026-05-23 — KrakenClient, SubscriptionManager, singleton, hook

- **Agent:** nextjs-react-engineer (sonnet)
- **Task:** Implement `KrakenClient`, `SubscriptionManager`, SSR-guarded singletons, and `useChannelSubscription` hook.
- **What AI got right:** Implemented `KrakenClient` with DI wiring — takes `ConnectionManager` as a constructor argument, no internal socket creation. Correctly called `manager.acknowledgePong()` on pong messages. Implemented typed fan-out via `onMessage<T extends KrakenMessage>` with the handler stored as `(msg: KrakenMessage) => void` internally and one controlled cast at the registration boundary. `SubscriptionManager` is reference-counted, uses two-phase state (`subscribing` → `subscribed`), batches `resubscribeAll()` one frame per `(channel, depth)` group, and holds sends when the connection is not open. Singletons in `index.ts` are SSR-guarded with `typeof window` checks and stashed on `globalThis` as `__minikrakenClient` and `__minikrakenSubs` for HMR stability. `use-channel.ts` has `'use client'` directive. Agent self-caught 3 issues during implementation: (1) required `'method' in msg` guard before accessing `.method` on the `KrakenMessage` union since channel messages have no `method` field; (2) `exactOptionalPropertyTypes` required conditional spread `depth !== undefined ? { ..., depth } : { ... }` instead of passing `depth: number | undefined`; (3) one controlled cast at the `onMessage<T>` registration boundary. Typecheck clean confirmed independently by orchestrator.
- **What AI got wrong:** Nothing notable — the 3 issues were self-identified and self-corrected during implementation.
- **Human correction:** Accepted as-is.
- **Files touched:** `src/lib/kraken/client.ts`, `src/lib/kraken/subscription-manager.ts`, `src/lib/kraken/index.ts`, `src/lib/kraken/use-channel.ts`

## Phase 2a — Order Book Data

### 2026-05-23 — Resync path architecture review

- **Agent:** realtime-architect (opus)
- **Task:** Determine which layer should call resubscribe when an order book checksum fails, and how state flows across the WS/store/provider boundary.
- **What AI got right:** Evaluated 4 concrete options (A: store imports SubscriptionManager directly; B: injected callback; C: checksumFailures map + React watches; D: provider watches a store status field) and correctly identified that Option D — store exposes `checksumStatus: Map<string, 'ok' | 'failed' | 'resyncing'>` per symbol, provider watches it via selector and calls unsubscribe+subscribe on `'failed'`, store transitions to `'resyncing'` to block stale delta application — is the cleanest layer separation. Correctly flagged that `'resyncing'` must block delta application in the store to prevent stale data from landing between the unsubscribe and the new snapshot.
- **What AI got wrong:** Nothing notable.
- **Human correction:** Accepted Option D. Added one requirement: `'resyncing'` must surface in the UI as a visible "syncing" indicator, because trading UIs deal with money and users must know when data accuracy is momentarily compromised.
- **Files touched:** none (architecture review only)

### 2026-05-23 — Price precision + checksum format pre-implementation review

- **Agent:** trading-domain-engineer (sonnet)
- **Task:** Answer three design questions before implementation: (1) should `Level.price`/`qty` be `Decimal` or `number`; (2) is `===` safe for price comparison; (3) is the roadmap's `formatForChecksum` correct?
- **What AI got right:** All three answers were correct and well-reasoned. (1) `Decimal` is required — CLAUDE.md mandates it and `Decimal.toFixed()` is also needed for correct checksum string formatting. (2) `===` is not safe for `Decimal` objects; `Decimal.equals()` is required. (3) Correctly identified that the roadmap's `String(n)` produces `"1e-5"` for small quantities and `"5"` for `50000`, both wrong for the Kraken CRC32 format. Prescribed the correct algorithm: `Decimal.toFixed()` + split on `.` + strip trailing fractional zeros + strip leading zeros on the integer part.
- **What AI got wrong:** Nothing notable.
- **Human correction:** Accepted all three answers as-is.
- **Files touched:** none (design review only)

### 2026-05-23 — OrderBook class and checksum implementation

- **Agent:** trading-domain-engineer (sonnet)
- **Task:** Implement `OrderBook` class (sorted levels, snapshot/update, spread) and `formatForChecksum`/`computeBookChecksum` in `checksum.ts`.
- **What AI got right:** Produced both files in a single pass with zero typecheck errors. `toLevel` is the single Decimal conversion boundary from wire `number` — no `number` arithmetic leaks into the book. `applyToSide` uses `Decimal.equals()` for price lookup and `Decimal.lessThan/greaterThan` for sorted insert. `topChanged` correctly handles nullity transitions (empty-to-non-empty book) so snapshot vs. delta updates both trigger re-renders correctly. `formatForChecksum` implements the correct algorithm — `toFixed()` + split on dot + strip trailing fractional zeros + strip leading integer zeros — handling scientific notation correctly. `getSpread()` returns `Decimal | null` (not `number`), matching the DECISIONS.md entry.
- **What AI got wrong:** Nothing notable.
- **Human correction:** Accepted as-is. Typecheck confirmed clean by orchestrator (`pnpm typecheck` zero errors).
- **Files touched:** `src/lib/orderbook/orderbook.ts`, `src/lib/orderbook/checksum.ts`

### 2026-05-23 — Zustand store and OrderBookProvider implementation

- **Agent:** nextjs-react-engineer (sonnet)
- **Task:** Implement `orderbook-store.ts` (Zustand with `books`, `lastUpdateAt`, `checksumStatus` maps) and `OrderBookProvider.tsx` (resync effect, message piping, context).
- **What AI got right:** Store correctly implements the three-state `checksumStatus` machine (`'ok'` → `'failed'` → `'resyncing'` → `'ok'`) per symbol. `applySnapshot` resets status to `'ok'`. `applyUpdate` drops deltas when status is `'resyncing'` and sets `'failed'` on checksum mismatch. `useOrderBookStatus` selector hook is provided. Provider has `'use client'` directive, uses `useChannelSubscription` for lifecycle, pipes messages through `toLevel`, and the resync effect watches `checksumStatus === 'failed'` to call unsubscribe then subscribe on the SubscriptionManager. `OrderBookStatusContext` and `useOrderBookSyncStatus` hook expose resync state to children. Agent self-corrected three issues during implementation without prompting: (1) roadmap's provider passed raw `BookEntry[]` directly to the store, bypassing `toLevel` — fixed by piping through the adapter; (2) roadmap's provider had no null guard on `getKrakenClient()` — fixed with a null check before subscription; (3) a self-import artifact was removed before typecheck.
- **What AI got wrong:** Nothing notable — the three self-corrections were caught and fixed before submission, not post-review failures.
- **Human correction:** Accepted as-is. Typecheck confirmed clean independently by orchestrator (`pnpm typecheck` zero errors).
- **Files touched:** `src/stores/orderbook-store.ts`, `src/components/OrderBookProvider.tsx`

## Phase 2b — Order Book Rendering

### 2026-05-23 — Phase 2b pre-implementation design

- **Agent:** react-performance-engineer (sonnet)
- **Task:** Answer 4 design questions on row prop types, selector churn, flash animation with Decimal, and rAF batching before any code was written.
- **What AI got right:** All 4 questions resolved correctly without needing human input. (1) Recommended Option C — `selectLevelDisplay` returns `{ priceStr: string, qtyStr: string, depthPct: number }` with `Decimal.toFixed()` called inside the selector, making the selector the display boundary and allowing `memo`'s default `===` to work on strings. Correctly identified that roadmap Step 5's `price: number` violates CLAUDE.md's money math rules. (2) Correctly noted that Zustand v5 does not re-subscribe on selector reference change, so `useMemo` on `selectLevelDisplay(...)` is a hygiene improvement only, not required for correctness. (3) Correctly identified that the string-prop decision from Q1 dissolves the Decimal flash comparison problem — `prevQtyStr.current !== display?.qtyStr` is correct string inequality, no Decimal comparison needed in Row. (4) Correctly deferred rAF batching — measured the hot path at 50 rows × 50 updates/sec as under 2ms/sec React work, and prescribed adding it only if 95th-percentile update-to-paint latency exceeds 12ms at realistic load.
- **What AI got wrong:** Nothing notable.
- **Human correction:** Accepted all 4 answers. Orchestrator added 2 entries to `DECISIONS.md`: "Order book rows receive pre-formatted strings, not Decimal or number" and "rAF batching deferred; instrument first."
- **Files touched:** none (design review only)

### 2026-05-23 — Phase 2b implementation

- **Agent:** nextjs-react-engineer (sonnet)
- **Task:** Implement all Phase 2b files: perf marks, row selector, `BookRow`, `OrderBook` parent, CSS, and store exports.
- **What AI got right:** Delivered all files in a single pass with zero typecheck errors. `marks.ts` implements `markUpdateReceived` and `markUpdateRendered` with a 16ms warn threshold. `selectors.ts` implements a `selectLevelDisplay` factory that returns pre-formatted strings with cumulative depth percentage, plus a `levelDisplayEqual` comparator. `BookRow.tsx` correctly uses `useStoreWithEqualityFn` from `zustand/traditional` (the Zustand v5 API), applies `useMemo` on the selector, and implements the flash animation imperatively via `classList` and a forced reflow — no state involved. `OrderBook.tsx` has the parent subscribing only to `lastUpdateAt` for the relevant symbol, renders asks in reverse index order (best ask nearest the spread), includes a `MarkRendered` internal component for perf marks, and shows a syncing indicator. `globals.css` correctly implements the depth bar using a `::before` pseudo-element and a `--depth-pct` CSS custom property, the flash keyframe animation, and the bid/ask color scheme. Agent self-caught 2 API mismatches at typecheck before reporting: (1) Zustand v5 removed the two-argument `useStore(selector, equalityFn)` overload — agent switched to `useStoreWithEqualityFn` from `zustand/traditional`; (2) `useOrderBookSyncStatus` takes no arguments (context is already symbol-scoped by the provider) — roadmap showed a `(symbol)` signature that does not match the existing implementation.
- **What AI got wrong:** Nothing notable — both API mismatches were caught at typecheck during implementation and corrected before reporting.
- **Human correction:** Accepted as-is. Typecheck confirmed clean (zero errors).
- **Files touched:** `src/lib/perf/marks.ts`, `src/components/orderbook/selectors.ts`, `src/components/orderbook/BookRow.tsx`, `src/components/orderbook/OrderBook.tsx`, `src/stores/orderbook-store.ts`, `src/app/globals.css`

## Bug Fixes

### 2026-05-23 — Zod duplicate discriminator "book" crash

- **Agent:** realtime-architect (opus)
- **Task:** Root cause and fix for console error "Duplicate discriminator value 'book'" thrown at schema module load time.
- **What AI got right:** Correctly identified that Zod v4 requires unique discriminant values within a `discriminatedUnion`, and that both `bookSnapshotSchema` and `bookUpdateSchema` share `channel: z.literal("book")`, making them unrepresentable as peers in the same `z.discriminatedUnion("channel", [...])`. Evaluated three fix options and correctly recommended Option C — nest the two book variants in an inner `z.discriminatedUnion("type", [bookSnapshotSchema, bookUpdateSchema])` and replace the single flat channel union with `z.union([bookChannelSchema, z.discriminatedUnion("channel", [heartbeatSchema, statusSchema])])` — as the minimal change that preserves O(1) dispatch on the hot book path and leaves `krakenMessageSchema`, `client.ts`, and the inferred `KrakenMessage` type unchanged.
- **What AI got wrong:** Nothing notable.
- **Human correction:** Accepted as-is. Fix was applied directly by the orchestrator as a targeted edit. Typecheck clean post-fix.
- **Files touched:** `src/lib/kraken/schemas.ts`

### 2026-05-23 — Checksum trailing-zero precision loss + UI frozen after snapshot

- **Agent:** react-performance-engineer (sonnet)
- **Task:** Diagnose why the order book UI froze after the initial snapshot and trace the exact failure path through checksum validation to Zustand subscription.
- **What AI got right:** Correctly identified Hypothesis A (checksum always failing) as the root cause. Traced the exact `JSON.parse` trailing-zero loss — Kraken sends `"0.00005100"` on the wire; `JSON.parse` produces the float `0.000051`, discarding the trailing zeros. Correctly identified that Kraken's server-side checksum algorithm uses the raw wire string (`"0.00005100"` → `"5100"`), so the previous `Decimal.toFixed(d.decimalPlaces())` approach was architecturally wrong — it tried to recover precision from a float that had already lost it. Devised the correct fix: a regex pre-processing step on the raw wire string before `JSON.parse` to convert book entry numeric values to quoted strings, preserving the original wire representation. The complete chain was traced: checksum mismatch → `checksumStatus` flipped to `'failed'` → `'resyncing'` → `applyUpdate` dropped all deltas → `lastUpdateAt` never changed → Zustand subscription never fired → no re-renders.
- **What AI got wrong:** The previous fix attempt (`toFixed(d.decimalPlaces())`) was architecturally wrong — it tried to recover precision from a float that had already discarded the trailing zeros. The correct fix is to never lose the wire string in the first place.
- **Human correction:** Accepted the architectural direction. Verified 6/6 consecutive checksums passed against live Kraken WS v2. Added a `DECISIONS.md` entry: "Book price/qty parsed as strings to preserve wire precision for checksum."
- **Files touched:** `src/lib/kraken/client.ts`, `src/lib/kraken/schemas.ts`, `src/lib/orderbook/orderbook.ts`, `src/lib/orderbook/checksum.ts`

## Phase 4a — Order Matching & Simulation / Phase 4b — P&L & Decimal Precision

### 2026-05-23 — Phase 4 math layer (4a + 4b combined)

- **Agent:** trading-domain-engineer (sonnet)
- **Task:** Implement Phases 4a + 4b math layer together with Decimal throughout: centralized Decimal config, domain types, market order simulation, position model, applyFillToPosition (all 3 cases), unrealizedPnl, chooseMarkPrice, trading store, positions store, useMarketOrderPreview hook, usePositionWithPnl hook, useLimitFillTrigger hook.
- **What AI got right:** Zero typecheck errors on first pass. Correctly handled `exactOptionalPropertyTypes` constraint on `limitPrice?: Decimal`. Self-caught two bugs during reasoning before submitting: (1) positions with zero size but nonzero realizedPnl must be retained in the map, not deleted; (2) short P&L sign requires a branch on side — the naive formula produces the wrong sign for shorts. Skipped the roadmap's "use native numbers first, refactor in 4b" intermediate step, which was correct given Level already uses Decimal throughout.
- **What AI got wrong:** Nothing notable.
- **Human correction:** Accepted as-is. Three roadmap deviations noted and accepted: (a) Decimal-throughout from the start (skipped 4a native-number intermediate); (b) `useLimitFillTrigger` subscribes per-symbol rather than globally — flagged as a limitation if multi-symbol trading is needed; (c) taker fee hardcoded at 26 bps in `useMarketOrderPreview`.
- **Files touched:** `src/lib/money/decimal.ts`, `src/lib/trading/types.ts`, `src/lib/trading/simulate.ts`, `src/lib/trading/use-market-preview.ts`, `src/lib/trading/positions.ts`, `src/lib/trading/use-position-pnl.ts`, `src/lib/trading/use-limit-fill-trigger.ts`, `src/stores/trading-store.ts`, `src/stores/positions-store.ts`

### 2026-05-23 — Phase 4 UI layer (4a + 4b combined)

- **Agent:** nextjs-react-engineer (sonnet)
- **Task:** Build all Phase 4 UI components: OrderEntry form with market/limit tabs and slippage preview, OpenOrders table with cancel, FilledOrders table (last 20), PositionsPanel with row-level P&L subscriptions, TradingPanel composition. Wire into page.tsx.
- **What AI got right:** Zero typecheck errors. Decimal never passed as a React prop — all Decimal-to-string conversions happen at the render boundary. `noUncheckedIndexedAccess` guard on `STATUS_CLASS` record in FilledOrders was caught and applied. Responsive two-column layout added to page.tsx.
- **What AI got wrong:** Nothing notable.
- **Human correction:** Accepted as-is. No deviations beyond what was already settled by the trading-domain-engineer delegation.
- **Files touched:** `src/components/trading/PnlText.tsx`, `src/components/trading/MarketPreview.tsx`, `src/components/trading/OrderEntry.tsx`, `src/components/trading/OpenOrders.tsx`, `src/components/trading/FilledOrders.tsx`, `src/components/trading/PositionsPanel.tsx`, `src/components/trading/TradingPanel.tsx`, `src/app/page.tsx`

## Phase 3 — Candlestick Charting

### 2026-05-23 — Phase 3 architecture review

- **Agent:** realtime-architect (opus)
- **Task:** Pre-implementation architecture review for Phase 3 candlestick charting — REST/WS race condition, store design, selector patterns, chart lifecycle, SubscriptionManager capability gaps.
- **What AI got right:** Identified 6 design issues before any code was written. (1) Load token required on `applyHistorical` to guard against aborted-but-resolved fetch races — without it, a slow historical response arriving after a teardown could overwrite fresh data. (2) Zustand actions must be pulled via `getState()` inside the effect, not passed as reactive dependencies, to avoid stale-closure and unnecessary re-runs. (3) Array-returning selector causes subscription churn — prescribed version counter plus a materialized array reference held outside the selector so `===` comparisons remain stable. (4) Cache-with-freshness preferred over clear-on-teardown for interval switching — avoids a blank chart flash when switching back to a previously loaded interval. (5) Single-effect chart lifecycle to avoid ordering ambiguity between initialization and data-load effects. (6) Blocking find: `SubscriptionManager` key did not include `interval`, so ohlc subscriptions at different intervals would collide and the second subscribe would be no-oped. Also caught that the roadmap's `ohlc-1m` channel name is wrong — Kraken WS v2 uses `channel: "ohlc"` with `params.interval` as a numeric field.
- **What AI got wrong:** Nothing notable.
- **Human correction:** All findings accepted. Human approved SubscriptionManager refactor (no behavior change for non-ohlc channels), confirmed right-edge-only update scope, no visibility resync needed.
- **Files touched:** none (design-only)

### 2026-05-23 — Phase 3 implementation

- **Agent:** nextjs-react-engineer (sonnet)
- **Task:** Full Phase 3 implementation: SubscriptionManager refactor, candle types/schemas, REST fetcher, Zustand candle store, `useCandles` hook, Chart component (lightweight-charts v5), ChartShell interval switcher, page wiring.
- **What AI got right:** All 8 parts implemented in a single delegation with typecheck clean (0 errors). SubscriptionManager refactor added `interval` to `ChannelDescriptor`, `keyOf`, subscribe frame, and `resubscribeAll` without touching non-ohlc channel behavior. Candle schemas correctly separated REST OHLC response shape from the WS ohlc push shape. REST fetcher uses `AbortSignal` and a `toKrakenPair` normalizer. Candle store implements load token, version counter, materialized array reference, and a pending buffer that drains after `applyHistorical` resolves. `useCandles` uses a single effect with `getState()` for actions. Chart component uses a single imperative effect to subscribe to the store, and calls `setData` on historical load and `update` on live ticks. ChartShell renders the interval switcher and a load state indicator.
- **What AI got wrong:** Nothing notable — the three roadmap deviations below were caught and resolved by the agent before reporting.
- **Human correction:** Accepted as-is. Three roadmap deviations were surfaced and corrected during implementation: (1) `resubscribeAll` group record required an `interval` value to pass in the subscribe frame — roadmap omitted this field; (2) `useCandlesStore.subscribe(selector, listener)` two-arg form requires `subscribeWithSelector` middleware not present in the codebase — implemented listener-only with manual version-equality check instead; (3) `lightweight-charts` v5 API is `chart.addSeries(CandlestickSeries, options)`, not `chart.addCandlestickSeries()` — roadmap had the v4 API.
- **Files touched:** `src/lib/kraken/client.ts`, `src/lib/kraken/subscription-manager.ts`, `src/lib/kraken/use-channel.ts`, `src/lib/kraken/schemas.ts`, `src/lib/candles/types.ts`, `src/lib/candles/schemas.ts`, `src/lib/candles/fetch-historical.ts`, `src/lib/candles/use-candles.ts`, `src/stores/candles-store.ts`, `src/components/chart/Chart.tsx`, `src/components/chart/ChartShell.tsx`, `src/app/page.tsx`
