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
