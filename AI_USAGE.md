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

## Phase 5 — Testing, A11y, Polish, Deploy

### 2026-05-23 — Test stack setup + unit tests (5.1–5.5)

- **Agent:** qa-test-engineer (sonnet)
- **Task:** Wire vitest + RTL + jsdom + Playwright config and write 53 unit/component tests across OrderBook, position math, simulator, and OrderEntry.
- **What AI got right:** All 53 tests pass across 4 suites (15 OrderBook, 13 positions, 12 simulator, 13 OrderEntry). Tests use behavior-only RTL queries (`getByRole`, `getByLabelText`) with no class-name assertions, correctly anticipating that layout and styles will change in later phases. The agent used the real `Level` type with `Decimal` for price/qty — not the plain `number` the roadmap example showed. Caught and fixed a real a11y bug in production code: `OrderEntry.tsx` labels were not associated with their inputs (missing `htmlFor`/`id` pairs). Correctly identified and tested the observable behavior for the insufficient-liquidity case — warning visible, button stays enabled — rather than blindly asserting the roadmap's incorrect claim that the submit button should be disabled.
- **What AI got wrong:** Nothing notable.
- **Human correction:** Accepted as-is. Three roadmap deviations noted and accepted: (a) `Level` shape uses `Decimal`, not `number` as roadmap example showed; (b) insufficient-liquidity submit behavior is warning-visible rather than button-disabled; (c) a11y bug fix in `OrderEntry.tsx` was a production code change, not a test-only change.
- **Files touched:** `vitest.config.ts`, `vitest.setup.ts`, `playwright.config.ts`, `package.json`, `src/components/trading/OrderEntry.tsx`, `src/lib/orderbook/__tests__/orderbook.test.ts`, `src/lib/trading/__tests__/positions.test.ts`, `src/lib/trading/__tests__/simulate.test.ts`, `src/components/trading/__tests__/order-entry.test.tsx`

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

## Tooling — Agent Config

### 2026-05-25 — BACKLOG H3/H4/H5/M9 design (subscription ack correlation, unsubscribe race, resync race)

- **Agent:** realtime-architect (opus)
- **Task:** Design solutions for BACKLOG issues H3 (subscription ack correlation), H4 (unsubscribing race), and H5/M9 (resync race / cross-epoch delta isolation).
- **What AI got right:** Produced a unified, implementation-ready design covering all three issues in a single pass. (1) H3: `req_id` as sole correlator — SubscriptionManager stamps each subscribe/unsubscribe frame with a unique `req_id` and matches incoming acks by that field, discarding acks that carry no matching pending entry. (2) H4: discriminated `Phase` state machine adding `unsubscribing` and `queuedResubscribe` variants — entries persist in the manager through `unsubscribing` rather than being removed, and a `releasePending` flag dequeues a queued resubscribe once the ack for the unsubscribe arrives. (3) H5 (subsumes M9): per-key monotonic epoch owned by SubscriptionManager, stamped into each message at parse time in `client.ts`; the store rejects any delta whose epoch is less than the current epoch for that key, making cross-epoch isolation an O(1) integer comparison rather than a checksum-only guard. Also included: sequencing diagram, test plan for each fix, and a rollback hedge (optional epoch param allowing the three PRs to land in one merge).
- **What AI got wrong:** Nothing notable.
- **Human correction:** Architect surfaced 3 open questions before the design was finalized — (1) whether provider or SubscriptionManager should own the epoch, (2) whether an ack-watchdog timeout should be a ticket in this trio or a separate backlog item, (3) whether `req_id` schema confirmation needed a Kraken docs check. Human resolved all three: manager owns epoch, watchdog is a separate backlog ticket, proceed to implementation as one trio. Design accepted as-is after those answers were incorporated.
- **Files touched:** None — design-only delegation. No code or doc edits produced.

## Backlog — L8, L9, H9 (money-math audit fixes)

### 2026-05-25 — Backlog items L8, L9, H9

- **Agent:** trading-domain-engineer (sonnet) — planning pass then implementation pass
- **Task:** Fix L8 (`feeBps` float-safety), add L9 JSDoc on `FilledOrder.totalCost`, and address H9 (`fill.fee` Decimal accumulation warning in positions-store).
- **What AI got right:** Planning pass correctly identified L8 as a config-not-money parameter — `feeBps` is a fixed integer basis-point value, not a financial quantity — and recommended an integer-guard (assertion that the value is a safe integer) plus JSDoc documenting the caller contract rather than forcing a Decimal wrap, which would have been overengineered. For H9, correctly determined that `positions-store` has no `number` accumulator for fees yet (phase 6+ fill aggregation has not landed), so the appropriate fix is a pre-emptive comment flagging the constraint rather than a code change against non-existent logic. L9 JSDoc added to `FilledOrder.totalCost` clarifying that the field excludes fees. All 14/14 vitest tests pass; typecheck clean.
- **What AI got wrong:** Nothing notable.
- **Human correction:** Accepted as-is. Single PR bundle for all three items.
- **Files touched:** `src/lib/trading/simulate.ts`, `src/lib/trading/types.ts`, `src/stores/positions-store.ts`, `src/lib/trading/__tests__/simulate.test.ts`

## Backlog — Subscription Reliability (H3/H4/H5/M9)

### 2026-05-25 — BACKLOG H3/H4/H5/M9 implementation (req_id, Phase state machine, epoch isolation)

- **Agent:** nextjs-react-engineer (sonnet)
- **Task:** Implement BACKLOG H3 + H4 + (H5 + M9) per architect design — req_id correlation, discriminated Phase state machine, per-key epoch resync isolation.
- **What AI got right:** Full rewrite of `subscription-manager.ts` landed cleanly: monotonic `req_id` counter, `pendingRequests` map keyed by req_id, four-state `Phase` discriminated union (`subscribing` / `subscribed` / `unsubscribing` / `idle`) with `queuedResubscribe` and `releasePending` flags, per-key `epochs` map with `getEpoch()` / `bumpEpoch()`, `forceResync` renamed to `requestResync` that bumps epoch before unsubscribe and rides the `queuedResubscribe` path. `orderbook-store` gained `bookEpochs: Map<string, number>` and optional `epoch` param on `applySnapshot`/`applyUpdate` (rollback hedge); `resyncing` no longer gates `applyUpdate`. Provider reads `subs.getEpoch()` synchronously per book frame; HMR `useEffect` that reset `resyncing` deleted (bug class gone with epoch model). Schemas gained `req_id` field plus `.passthrough()` on sub/unsub ack schemas. `KrakenClient.subscribe`/`unsubscribe` hoist `req_id` to frame top-level matching Kraken WS v2 wire format. 15 new unit tests (10 subscription-manager, 5 orderbook-store) — 71/71 tests pass. Three entries appended to `DECISIONS.md`.
- **What AI got wrong:** Architect design placed `req_id` inside `params`; Kraken WS v2 wire format requires it at the outer frame level (sibling of `method`). Agent correctly placed it at the outer level but this was a deviation from the design doc, not an error caught by the design. Also: `resubscribeAll` batches one subscribe frame per `(channel, depth, interval)` group, so one `req_id` covers multiple symbols and per-symbol acks for the same id hit a "pending not found" early-return — benign under the epoch model (entries stay in `subscribing` but epoch already bumped), but logged by the agent as a known limitation without filing a ticket.
- **Human correction:** Accepted as-is. No changes requested.
- **Files touched:** `src/lib/kraken/schemas.ts`, `src/lib/kraken/client.ts`, `src/lib/kraken/subscription-manager.ts`, `src/stores/orderbook-store.ts`, `src/components/OrderBookProvider.tsx`, `DECISIONS.md`, `src/lib/kraken/__tests__/subscription-manager.test.ts` (new), `src/stores/__tests__/orderbook-store.test.ts` (new)

## Backlog — Performance (H7: O(N²) selector fix)

### 2026-05-25 — BACKLOG H7: O(N²) work in selectLevelDisplay

- **Agent:** react-performance-engineer (sonnet)
- **Task:** Fix O(N²) cumulative-depth work in `selectLevelDisplay` (orderbook selector) per BACKLOG item H7.
- **What AI got right:** Correctly pushed back on the backlog note's "hoist derivation above selector (store)" framing — proposed hoisting into `OrderBook` `useMemo` instead, which avoids conflict with the store's M1 Map-clone concern and keeps store shape unchanged. Human approved the alternative plan before implementation began. Measured the hot path with an isolated Node micro-benchmark (200 ticks × 25 depth × 50 rows): baseline p95 0.098ms → post-fix p95 0.016ms (6x speedup). Removed `depthPct` from `LevelDisplay` and eliminated the cumulative loop + reduce in the selector, making it an O(1) index lookup of `priceStr` + `qtyStr`. Added a `computeDepthPcts` helper with `useMemo` in `OrderBook.tsx` keyed on `lastUpdateAt`, reading the book via `useOrderBookStore.getState()` to avoid triggering a new subscription. `BookRow` received a new `depthPct: number` prop applied to `style`. `useMemo + getState()` pattern preserved the `lastUpdateAt`-pinned re-render gate — a naive subscription would have caused cross-symbol re-renders.
- **What AI got wrong:** No production-code instrumentation was added; the benchmark was a throwaway Node script. Acceptable per agent — `marks.ts` covers in-browser observability. The agent also flagged but did not fix a follow-on: `getBids`/`getAsks` `.slice()` per-row still allocates O(N) per tick × 50 rows. Not acted on as it was outside scope.
- **Human correction:** Accepted as-is. Pre-task: human chose "measure + fix in one pass" over measure-only.
- **Files touched:** `src/components/orderbook/selectors.ts`, `src/components/orderbook/OrderBook.tsx`, `src/components/orderbook/BookRow.tsx`

## Backlog — Cross-Cutting Hardening (post-Phase 5)

### 2026-05-25 — Cross-cutting hardening planning (H1, H2, H3–H5, H6, H8, M1–M11, L2–L11)

- **Agent:** nextjs-react-engineer (sonnet)
- **Task:** Review BACKLOG.md and produce per-issue implementation plans for all hardening items before any code was written.
- **What AI got right:** Produced actionable per-issue plans for H1, H2, H6, H8, and M1–M11 and L2–L11 in a single pass. Correctly identified H3/H4/H5 as blocked on architect sign-off (req_id correlation, unsubscribing race, epoch design) before implementation could begin. Flagged M2/M3 as requiring human scope decision (they touch SubscriptionManager internals that interact with the H3/H4 state machine). Correctly noted L3 (fallback loading skeleton) as dependent on H6 (Suspense boundaries) landing first.
- **What AI got wrong:** Nothing notable.
- **Human correction:** Accepted as-is. H3/H4/H5 routed to realtime-architect before implementation. M2/M3 scope deferred to human decision post-architect review.
- **Files touched:** None — planning only.

### 2026-05-25 — Cross-cutting hardening architecture review (H3, H4, H5 impl deltas)

- **Agent:** realtime-architect (opus)
- **Task:** Ratify existing scaffolding for req_id correlation (H3), releaseSubscription race (H4), and epoch token (H5); identify any implementation gaps before the nextjs-react-engineer delegation.
- **What AI got right:** Confirmed the prior H3/H4/H5 design was sound. Identified 4 concrete implementation deltas that were missing from the existing code: (1) `releasePending` must be cleared in the subscribing-phase `subscribe()` call (not only on ack arrival), otherwise a queued resubscribe could ghost; (2) a watchdog `setInterval` with `ACK_TIMEOUT_MS = 10000` should fire after each pending request to recover from acks silently dropped by the server; (3) any non-`open` connection status transition must wipe `pendingRequests` and reset all phases to idle, preventing stale phase state from surviving a reconnect; (4) `destroy()` must clear the watchdog interval to avoid a leak after the manager is torn down. Locked the invariant that `req_id` (wire correlation) and `epoch` (generation correlation) remain distinct tokens and must never be conflated.
- **What AI got wrong:** Nothing notable.
- **Human correction:** Human resolved 4 open design decisions: (1) per-symbol resubscribe on reconnect (not grouped batch); (2) watchdog interval 10 s confirmed; (3) error-ack handling — immediate idle + single retry, surface `status: 'failed'` to the provider; (4) `resyncing` stays as UX-only state (not gated on epoch). All 4 decisions accepted before implementation.
- **Files touched:** None — design only.

### 2026-05-25 — Cross-cutting hardening implementation (H1, H2, H3/H4/H5 deltas, H6, H8, M1)

- **Agent:** nextjs-react-engineer (sonnet)
- **Task:** Implement Group A (H1, H2, H6, H8, M1) and Group B (H3/H4/H5 architect deltas) in a single delegation.
- **What AI got right:** All items landed with `pnpm typecheck` clean and 92/92 tests passing. H1/H2: `connection-manager.ts` updated with the relevant fixes. H4 gap + watchdog + reconnect-wipe + per-symbol resubscribe + error-ack retry/failure + `destroy()` cleanup all implemented in `subscription-manager.ts`. M1: `orderbook-store.ts` switched to in-place `Map` mutation (eliminates the per-tick clone). H8: `OrderBook.tsx` keyed rows by `rawPrice` string (stable key across re-renders, eliminates unmount/remount churn on depth changes). H6: `page.tsx` gained `<Suspense>` boundaries with skeletons while remaining a Server Component. New test file `src/lib/kraken/__tests__/subscription-manager-groupb.test.ts` covers the Group B deltas. The `status?: 'failed'` field on subscription entries uses the `delete` idiom to satisfy `exactOptionalPropertyTypes`; pre-existing epoch double-bump in `resubscribeAll` was found and fixed as a side effect; `wipePendingOnDisconnect` fires on all non-`open` statuses (not just `disconnected`).
- **What AI got wrong:** Nothing notable.
- **Human correction:** H6 browser verification (Suspense skeleton visible under throttled network) deferred — requires human with devtools network throttling. All code changes accepted as-is.
- **Files touched:** `src/lib/ws/connection-manager.ts`, `src/lib/kraken/subscription-manager.ts`, `src/stores/orderbook-store.ts`, `src/components/orderbook/OrderBook.tsx`, `src/app/page.tsx`, `src/lib/kraken/__tests__/subscription-manager-groupb.test.ts`

### 2026-05-25 — Cross-cutting hardening M/L tier batch (M2–M6, M8, M10–M11, L2–L7, L10–L11)

- **Agent:** nextjs-react-engineer (sonnet)
- **Task:** Implement 16 M/L-tier backlog hardening items across CSS tokens, OrderEntry validation, OrderBook selector, connection-manager control path, route-level loader, store hooks, and test coverage.
- **What AI got right:** All 16 items landed in a single pass with typecheck clean and tests advancing from 92 to 96 (all pass). M2: de-duplicated hex values in `globals.css` while preserving existing class names. M3: conservative token approach — dropped `--background`/`--foreground` from `@theme inline`, leaving them as plain CSS vars driving `body` only (no cascade bleed). M4: CSS token or utility addition in `globals.css`. M5/M8: `OrderEntry.tsx` validation and UX hardening. M6: added `getBestBidPrice`/`getBestAskPrice` methods on `OrderBook` class and updated `CurrentPrice.tsx` to call them directly, eliminating a selector-level array allocation per tick. M10: added `sendControl` method on `connection-manager.ts` plus corrected the buffer comment; M11: armed the pong deadline timer correctly on visibility restore; also added clarifying comment for L11. L2: `layout.tsx` className statically set from font CSS variables — `suppressHydrationWarning` not needed. L3: new `src/app/loading.tsx` route-level loader (depends on H6 Suspense boundary already landed). L4/L6: `OrderEntry.tsx` updates. L5: comment added to `selectors.ts`. L7: optional chain in `candles-store.ts` intentionally kept — required by `noUncheckedIndexedAccess`; comment documents the constraint. L10: `usePosition` hook added to `positions-store.ts`. L11: comment added to `connection-manager.ts`. Self-caught bug during L6: switching `!== null` to `!== undefined` violated `exactOptionalPropertyTypes` on `OrderRequest` spread; resolved with `!= null` (narrows both null and undefined).
- **What AI got wrong:** Nothing notable.
- **Human correction:** M3 conservative scope chosen by human (drop `--background`/`--foreground` from `@theme inline`; keep as plain CSS vars). M2 conservative scope chosen by human (de-dupe hex values only; keep existing class names). Both decisions made before implementation began.
- **Files touched:** `src/app/globals.css`, `src/components/trading/OrderEntry.tsx`, `src/lib/orderbook/orderbook.ts`, `src/components/CurrentPrice.tsx`, `src/lib/ws/connection-manager.ts`, `src/app/loading.tsx`, `src/components/orderbook/selectors.ts`, `src/stores/positions-store.ts`, `src/stores/candles-store.ts`, `src/lib/orderbook/__tests__/orderbook.test.ts`

## Backlog — Candle Chart Bug (H10)

### 2026-05-25 — BACKLOG H10: frozen live candle chart diagnosis

- **Agent:** realtime-architect (opus)
- **Task:** End-to-end diagnosis of the frozen live candle chart (BACKLOG H10) — never worked since Phase 3 shipped.
- **What AI got right:** Traced the full pipeline (wire → schema → dispatch → pipe → render) and pinpointed the break in one pass: `ohlcDataSchema` in `src/lib/kraken/schemas.ts` (lines 127–137) declares `open`/`high`/`low`/`close`/`volume`/`vwap` as `z.string()`, but Kraken WS v2 sends them as JSON numbers. Every live ohlc frame fails Zod validation at `client.ts:44` and is dropped via a `console.debug` call — silently invisible. Verified the wire format against Kraken WS v2 docs via `npx ctx7@latest` (price/volume = floats, `timestamp` deprecated). Correctly explained the schema asymmetry: the book schema uses `z.string()` paired with a regex pre-quoting reviver in `client.ts` for checksum-precision reasons; ohlc has no reviver and should consume numbers directly. Correctly identified that the historical (REST) path works because it routes through `ohlcRestRowSchema`, a separate schema. Surfaced the meta-bug: parse-failure logging at `console.debug` level made the failure observability-dark — recommended upgrading to `console.warn`.
- **What AI got wrong:** Nothing notable.
- **Human correction:** Architect surfaced 2 open questions: (a) schema-parse-failure counter in the sync-status header chip vs. warn-level log only; (b) whether to fix per-interval handler routing in `use-candles.ts` in the same PR. Human resolved both: warn-only logging (skip header chip), and per-interval routing filed as a separate backlog row (M13) — not included in this PR.
- **Files touched:** None — design-only delegation.

### 2026-05-25 — BACKLOG H10: ohlcDataSchema fix + parse-failure visibility

- **Agent:** nextjs-react-engineer (sonnet)
- **Task:** Fix `ohlcDataSchema` field types from `z.string()` to `z.number()`, remove six `parseFloat()` calls in `use-candles.ts`, upgrade parse-failure log to `console.warn`, and add schema regression tests.
- **What AI got right:** All 4 edits landed in one pass with typecheck clean. `ohlcDataSchema` correctly flipped `open`/`high`/`low`/`close`/`volume`/`vwap` to `z.number()`, changed `timestamp` to `z.string().optional()` (matching the deprecated-but-still-present wire field), and added `.passthrough()`. `use-candles.ts` had all six `parseFloat()` calls removed — values now flow through directly as numbers from the schema. `client.ts:44` parse-failure log upgraded from `console.debug` to `console.warn`, making previously invisible ohlc frame drops observable. New test file `src/lib/kraken/__tests__/schemas.test.ts` adds 3 tests: snapshot with `timestamp`, update without `timestamp`, and a regression guard that explicitly rejects string-valued ohlc fields. Test count advanced 96 → 99 with all passing.
- **What AI got wrong:** Nothing notable.
- **Human correction:** Accepted as-is.
- **Files touched:** `src/lib/kraken/schemas.ts`, `src/lib/candles/use-candles.ts`, `src/lib/kraken/client.ts`, `src/lib/kraken/__tests__/schemas.test.ts` (new)

## Backlog — H11: Chart price-axis vs. header price divergence investigation

### 2026-05-25 — BACKLOG H11: chart label vs. header price ~10c gap

- **Agent:** realtime-architect (opus)
- **Task:** Analyze whether the ~10c gap between the chart right-axis price label and the header price represents a sync bug.
- **What AI got right:** Confirmed in one pass that there are exactly two sources, not three: the header price and `CurrentPrice` both derive from `OrderBook.getBestBidPrice()` on the `book` WS channel (best resting bid); the chart right-axis label is set by `lightweight-charts` from the last candle's `close`, sourced from the `ohlc` WS channel (last printed trade price). Correctly identified this as not a bug — the two values are semantically different (best bid vs. last trade), and a ~10c gap on BTC reflects normal spread/quiet-tape behavior. Correctly identified that neither pipeline has a latency problem — both are per-message synchronous. Correctly explained the "persisting on screen" observation: the chart label only mutates when a new ohlc frame arrives, while the book ticks freely between trades (quiet-tape effect). Produced a clear recommendation: keep both sources and add explicit labels so users can distinguish them ("Bid 77042.60" in the header, or a bid/ask/spread display), surfacing market microstructure rather than hiding it. Surfaced two adjacent perf flags independently, consistent with the H10 architect's earlier findings: (1) `Chart.tsx:55` subscribes to the candles store with no selector and a manual version diff, firing on every mutation; (2) `candles-store.applyLiveUpdate` sorts the full array O(n log n) per ohlc tick.
- **What AI got wrong:** Nothing notable.
- **Human correction:** Accepted the "not a bug" verdict. Architect surfaced one open question to the human before prescribing a fix: should the header show best bid, last trade, or bid/ask/spread? Fix depends on that answer — orchestrator is relaying the question to the human. No implementation authorized yet.
- **Files touched:** None — analysis only.

### 2026-05-25 — BACKLOG H11: replace single-value CurrentPrice with Bid/Ask/Spread display

- **Agent:** nextjs-react-engineer (sonnet)
- **Task:** Rewrite `CurrentPrice.tsx` to show labeled Bid / Ask / Spread fields per architect recommendation (c) from the H11 analysis.
- **What AI got right:** Single-file rewrite delivered in one pass. Selector returns `{ bid: string | null, ask: string | null, spread: string | null }` with all `Decimal.toFixed(2)` conversions at the selector boundary. `bidAskSpreadEqual` custom comparator paired with `useStoreWithEqualityFn` prevents re-renders unless one of the three string values changes. Selector correctly reads `s.lastUpdateAt.get(symbol)` via `void` to ensure it re-runs on every book mutation. Leveraged the pre-existing `OrderBook.getSpread()` method (`orderbook.ts:129`) alongside `getBestBidPrice()`/`getBestAskPrice()` — no new helper needed. Empty book renders `—` for each field (no NaN). Syncing indicator preserved. Visual output: `Bid 77042.60 · Ask 77042.80 · Spread 0.20` with Bid green, Ask red, Spread zinc-300.
- **What AI got wrong:** Nothing notable.
- **Human correction:** Accepted as-is.
- **Files touched:** `src/components/CurrentPrice.tsx`

## Backlog — UX/UI Iteration (H12: Layout Rework)

### 2026-05-25 — BACKLOG H12: layout rework to top asset-info bar + 3-column grid + full-width bottom tabs

- **Agent:** nextjs-react-engineer (sonnet)
- **Task:** Rewrite `page.tsx` to a top asset-info bar + 3-column main grid (chart | order book | right rail) + full-width bottom tabs, with new `AssetInfoBar` and `PortfolioPlaceholder` components per user screenshot.
- **What AI got right:** Full rewrite of `page.tsx` landed cleanly: `max-w-[1600px] mx-auto p-4 flex-col gap-3` container, `grid-cols-[1fr_280px_320px]` main grid, right rail stacking `OrderEntry` + `Portfolio` in `flex-col gap-3`. Card wrapping (`rounded-lg bg-zinc-900/60 border border-zinc-800`) applied consistently. Existing `<Suspense>` boundaries preserved around Chart, OrderBook, and TradingPanel columns. `AssetInfoBar.tsx` (client component): symbol + Bid/Ask/Spread (reusing `CurrentPrice`) on the left, mocked 24h widgets (Change %, High, Low, Volume) in the middle, `ConnectionStatusDot` + utility placeholder on the right — `MOCK_24H` constant annotated with explicit `// MOCK — phase 6+ will wire to Kraken WS ticker channel` comment. `PortfolioPlaceholder.tsx` (server component, no hooks): "Coming soon · Phase 6+" tag, 4 mocked preview rows (Equity, Available, Unrealized P&L, Today's P&L) styled like real values. Minor `TradingPanel.tsx` adjustment: inner `overflow-y-auto` wrapper removed since parent card now handles scroll. `pnpm typecheck` clean; 99/99 tests pass.
- **What AI got wrong:** Nothing notable.
- **Human correction:** Accepted as-is. Manual browser verification owed by human. 24h widgets mocked by explicit user decision (no Kraken ticker subscription filed as follow-up).
- **Files touched:** `src/app/page.tsx`, `src/components/AssetInfoBar.tsx` (new), `src/components/PortfolioPlaceholder.tsx` (new), `src/components/trading/TradingPanel.tsx`

### 2026-05-25 — Install Claude Code skills for nextjs-react-engineer

- **Agent:** orchestrator (direct work, no skill agent)
- **Task:** Install three Claude Code skills globally and wire them into the `nextjs-react-engineer` agent definition.
- **What AI got right:** Skill discovery via `npx skills find` surfaced install counts and source reputation, making trust decisions straightforward. The three skills selected cover the relevant surface area: React 19 / Next.js perf guidance (`vercel-react-best-practices`, 426K installs), App Router patterns (`nextjs-app-router-patterns`, 18.8K installs), and View Transitions API (`vercel-react-view-transitions`, 41.6K installs). The `nextjs-react-engineer.md` update correctly maps each skill to its invocation trigger and adds a rule that skill guidance overrides training-data assumptions with conflicts surfaced to the orchestrator.
- **What AI got wrong:** `vercel-nextjs-best-practices` is not a real package name in `vercel-labs/agent-skills`. The `npx skills add` CLI entered an interactive picker rather than erroring cleanly, which made the failure ambiguous. Coverage for that intent is provided by the two Vercel-authored skills already installed; no functional gap exists.
- **Human correction:** Accepted the recommended three-skill substitution. No changes requested beyond what was proposed.
- **Files touched:** `.claude/agents/nextjs-react-engineer.md`

## Phase 5 — Testing, A11y, Polish, Deploy (Completion Session)

### 2026-05-26 — Phase 5 completion + backlog cleanup

- **Agent:** orchestrator + qa-test-engineer + nextjs-react-engineer (parallel delegation)
- **Task:** Complete Phase 5 final steps (5.6 E2E smoke test, 5.7–5.9 a11y work, 5.11 README polish, 5.12 DECISIONS.md count verification) + M13 latent bug fix.
- **What AI got right:** Parallel delegation for independent tasks successfully completed 8 work items in one session: (1) `e2e/smoke.spec.ts` with 2 behavior-focused Playwright tests (core UI elements load, order type toggle interaction) passed on first run. (2) `src/hooks/use-debounced-value.ts` hook created; `CurrentPrice.tsx` updated with 1.5s debounced `aria-live="polite"` region for screen reader announcements. (3) `.sr-only` utility added to `globals.css` for visually-hidden but screen-reader-accessible content. (4) `:focus-visible` styles added to `globals.css` with blue focus rings (`outline-offset: 2px`); default focus removed for mouse users. (5) `PnlText.tsx` updated to show `▲`/`▼` arrows and `+`/`-` prefixes alongside color for a11y, addressing color-blindness and non-color signal requirement. (6) README.md rewritten from boilerplate to comprehensive project documentation with architecture, tech stack, features, scripts, and design decisions summary. (7) DECISIONS.md verified at 22 entries (target was ≥10). (8) M13 latent bug in `src/lib/candles/use-candles.ts` fixed — added `d.interval !== expectedIntervalMinutes` guard to filter OHLC updates by interval, preventing cross-contamination in multi-Chart scenarios. (9) `vitest.config.ts` updated to exclude Playwright tests (`exclude: ['e2e/**']`) preventing vitest from running them.
- **What AI got wrong:** Agents encountered sandbox file write permission issues that prevented them from writing files directly — orchestrator had to apply all changes manually. This was a sandbox restriction, not an agent implementation error.
- **Human correction:** All file changes were applied manually by the orchestrator due to sandbox restrictions. No changes to the proposed implementations were needed — all were accepted as designed by the agents.
- **Files touched:** `e2e/smoke.spec.ts`, `src/hooks/use-debounced-value.ts`, `src/components/CurrentPrice.tsx`, `src/components/trading/PnlText.tsx`, `src/app/globals.css`, `src/lib/candles/use-candles.ts`, `vitest.config.ts`, `README.md`
