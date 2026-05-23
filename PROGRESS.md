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
| 2a.1 | Pick data structure (sorted array, documented) | pending | | | |
| 2a.2 | OrderBook implementation | pending | | | |
| 2a.3 | CRC32 checksum (Kraken format) | pending | | | |
| 2a.4 | Checksum failure → resync | pending | | | |
| 2a.5 | Zustand store (`useOrderBookStore`) | pending | | | |
| 2a.6 | Wire to KrakenClient messages | pending | | | |
| 2a.V | Verification checklist (incl. checksum-vs-Kraken-example) | pending | | | |

## Phase 2b — Order Book Rendering

| # | Step | Status | Agent | Commit | Notes |
|---|---|---|---|---|---|
| 2b.1 | Perf instrumentation (marks, measures) | pending | | | |
| 2b.2 | Naive baseline (measure first) | pending | | | |
| 2b.3 | Identify bottlenecks via Profiler | pending | | | |
| 2b.4 | Stabilize parent re-renders | pending | | | |
| 2b.5 | Memoize rows (primitive props) | pending | | | |
| 2b.6 | Row-level subscriptions | pending | | | |
| 2b.7 | Flash animation (imperative) | pending | | | |
| 2b.8 | Depth bars | pending | | | |
| 2b.9 | rAF coalescence (if needed) | pending | | | |
| 2b.10 | Final measurement + baseline-vs-optimized table | pending | | | |
| 2b.V | Verification checklist | pending | | | |

## Phase 3 — Candlestick Charting

| # | Step | Status | Agent | Commit | Notes |
|---|---|---|---|---|---|
| 3.1 | Pick chart library (lightweight-charts), document | pending | | | |
| 3.2 | Candle types + Zod schemas | pending | | | |
| 3.3 | REST fetcher with AbortSignal | pending | | | |
| 3.4 | Candle store with race-aware buffering | pending | | | |
| 3.5 | `useCandles` orchestrating hook | pending | | | |
| 3.6 | Chart component (imperative setData/update) | pending | | | |
| 3.7 | Interval switcher UI | pending | | | |
| 3.V | Verification checklist | pending | | | |

## Phase 4a — Order Matching & Simulation

| # | Step | Status | Agent | Commit | Notes |
|---|---|---|---|---|---|
| 4a.1 | Domain types (OrderRequest, Fill, FilledOrder, OpenOrder) | pending | | | |
| 4a.2 | `simulateMarketOrder` (walk the book) | pending | | | |
| 4a.3 | `useMarketOrderPreview` hook | pending | | | |
| 4a.4 | OrderEntry form | pending | | | |
| 4a.5 | Trading store (placeOrder, openOrders, filledOrders) | pending | | | |
| 4a.6 | Limit-fill trigger on book updates (throttled) | pending | | | |
| 4a.7 | Open + filled orders UI | pending | | | |
| 4a.V | Verification checklist | pending | | | |

## Phase 4b — P&L & Decimal Precision

| # | Step | Status | Agent | Commit | Notes |
|---|---|---|---|---|---|
| 4b.1 | Centralize `decimal.js` (banker's rounding) | pending | | | |
| 4b.2 | Refactor simulate to Decimal | pending | | | |
| 4b.3 | Position model | pending | | | |
| 4b.4 | `applyFillToPosition` (open / reduce / **flip**) | pending | | | |
| 4b.5 | `computeUnrealizedPnl` | pending | | | |
| 4b.6 | Mark-price selection (side-aware, documented) | pending | | | |
| 4b.7 | Positions store | pending | | | |
| 4b.8 | `usePositionWithPnl` hook | pending | | | |
| 4b.9 | Positions UI panel | pending | | | |
| 4b.V | Verification checklist (incl. worked examples) | pending | | | |

## Phase 5 — Testing, A11y, Polish, Deploy

| # | Step | Status | Agent | Commit | Notes |
|---|---|---|---|---|---|
| 5.1 | Test stack install + vitest config | pending | | | |
| 5.2 | OrderBook unit tests | pending | | | |
| 5.3 | Position math unit tests (incl. flip case) | pending | | | |
| 5.4 | Simulator unit tests | pending | | | |
| 5.5 | OrderEntry component tests (RTL) | pending | | | |
| 5.6 | Playwright E2E smoke test | pending | | | |
| 5.7 | A11y: debounced aria-live, sr-only ticker | pending | | | |
| 5.8 | Keyboard navigation pass | pending | | | |
| 5.9 | Color/contrast + non-color signals | pending | | | |
| 5.10 | Lighthouse pass (≥90 perf, 100 a11y) | pending | | | |
| 5.11 | README polish | pending | | | |
| 5.12 | DECISIONS.md final (≥10 entries) | pending | | | |
| 5.13 | AI_USAGE.md final review | pending | | | |
| 5.V | Verification checklist | pending | | | |
