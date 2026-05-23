# Architectural Decisions

One entry per load-bearing choice. Aim for ~10 by ship.

## Template

```markdown
## Decision: {{short title}}

**Date:** YYYY-MM-DD
**Status:** proposed | accepted | superseded

**Context:** Why this decision needed making. The forces at play.

**Alternatives considered:**
- Option A — pros / cons
- Option B — pros / cons

**Choice:** What was picked.

**Why:** The reasoning, including which forces won.

**Trade-offs accepted:** What we're giving up.

**What would change my mind:** Conditions under which we'd revisit.
```

---

## Decision: Skill-aligned subagents, not phase-aligned

**Date:** 2026-05-22
**Status:** accepted

**Context:** The roadmap is organized in 8 phases (1a, 1b, 2a, 2b, 3, 4a, 4b, 5). The obvious move was one agent per phase. But concerns repeat across phases — WebSocket lifecycle thinking shows up in 1a, 1b, and 3; render perf shows up in 2b and recurs in 4a's preview UI; money math is centered in 4a/4b but tests for it land in 5.

**Alternatives considered:**
- Phase-aligned (one agent per roadmap file) — pros: clean 1:1 mapping; cons: same concerns get re-learned in each agent's prompt, context fragmentation
- Skill-aligned (architect, react/next, perf, trading, QA, scribe) — pros: each agent accumulates expertise across phases; cons: requires orchestrator to know which agent to call for which step

**Choice:** Skill-aligned, with the orchestrator routing per step.

**Why:** The skills repeat; the phases don't. A perf agent that has seen Phase 2b's row-subscription pattern will recognize the same problem in Phase 4a's order preview. A phase-aligned `phase2b-agent` would have no context from `phase2a-agent` despite their stores being tightly coupled.

**Trade-offs accepted:** Orchestrator does more routing work; user has to learn six agent names instead of eight phase names. Mitigated by clear routing table in `CLAUDE.md`.

**What would change my mind:** If routing becomes ambiguous in practice (orchestrator hesitates which agent owns a task), the cut is wrong and we'd reconsider.

---

## Decision: KrakenClient uses dependency-injected ConnectionManager

**Date:** 2026-05-23
**Status:** accepted

**Context:** The Phase 1b roadmap has `KrakenClient` constructing its own `new ConnectionManager(...)`. Phase 1a already defines a `getManager()` singleton. Two `ConnectionManager` instances = two sockets to Kraken's server.

**Alternatives considered:**
- `KrakenClient` creates its own `ConnectionManager` (roadmap) — two sockets; heartbeats race; rejected
- `KrakenClient` imports `getManager()` directly — hidden coupling, hard to unit-test
- `KrakenClient` takes `ConnectionManager` as a constructor param (DI) — explicit, testable, no cycles

**Choice:** DI. `KrakenClient(manager: ConnectionManager)`. The composition root (`src/lib/kraken/index.ts`) passes the Phase 1a singleton.

**Why:** One socket per browser tab is a hard invariant. DI makes the dependency visible and injectable for tests.

**Trade-offs accepted:** Slightly more wiring code in `index.ts`. Negligible.

**What would change my mind:** A design where multiple independent WebSocket connections are genuinely needed (e.g., private + public channels on different endpoints). That would warrant separate managers, not a shared one.

---

## Decision: `acknowledgePong()` is on `IConnectionManager` interface

**Date:** 2026-05-23
**Status:** accepted

**Context:** Phase 1a placed `acknowledgePong()` on the concrete `ConnectionManager` class but not on `IConnectionManager`, treating it as an implementation detail. Phase 1b's `KrakenClient` must call it when it recognises a pong frame.

**Alternatives considered:**
- Keep off interface, `KrakenClient` takes concrete type — works but couples protocol layer to concrete transport class
- Add to interface — honest; it IS a transport↔protocol seam (protocol layer signals "pong received"; transport resets its dead-connection timer)

**Choice:** Add `acknowledgePong(): void` to `IConnectionManager`.

**Why:** The transport can't parse Kraken-specific pong frames. The protocol can't manage heartbeat timers. The handshake between them belongs in the contract, not as an implementation leak.

**Trade-offs accepted:** `IConnectionManager` is now coupled to the concept of application-level pongs. Acceptable — every realistic financial WS transport has heartbeats.

**What would change my mind:** A transport (SSE, polling) where pongs don't exist at all and a different health-check seam is needed.

---

## Decision: Outbound buffer is per-socket-lifetime; cleared on socket close

**Date:** 2026-05-23
**Status:** accepted

**Context:** Phase 1a buffers outbound messages when the socket is not OPEN. If the buffer is not cleared on close, reconnect flushes stale messages from the previous socket lifetime AND `resubscribeAll()` also fires — causing double-subscribe for any channel that was in flight.

**Alternatives considered:**
- Retain buffer across reconnects — double-subscribe bug; stale messages from dead sockets
- Clear on close; `resubscribeAll()` is the authoritative replay — correct; no double-sends

**Choice:** Buffer cleared on socket `close` (unintentional). `resubscribeAll()` in `SubscriptionManager` is the sole replay path. Buffer only spans `connecting → open` gap within a single socket lifetime.

**Why:** Subscriptions are stateful — the server has no memory of the previous socket. The subscription map in `SubscriptionManager` is the durable state. The buffer is only for timing, not durability.

**Trade-offs accepted:** Any send during the `reconnecting` window is dropped at the transport level. Callers (SubscriptionManager) must rely on `resubscribeAll()` for recovery, not on the buffer.

**What would change my mind:** A Kraken API that persists subscription state across reconnects (it doesn't).

---

## Decision: SubscriptionManager does not buffer sends while disconnected; relies on resubscribeAll

**Date:** 2026-05-23
**Status:** accepted

**Context:** When the connection is in `reconnecting` or `degraded` state, a component may mount and call `subscribe()`. Should the manager optimistically send (which goes to the outbound buffer), or hold until `resubscribeAll()` covers it?

**Alternatives considered:**
- Optimistic send to buffer — buffer is cleared on socket close (per above decision), so the buffered subscribe is lost; `resubscribeAll()` also fires on open → double-subscribe if timing is unfortunate
- Hold: add to subscription map only, do not call `client.subscribe()` while disconnected — `resubscribeAll()` covers it on next `open`

**Choice:** Hold. `SubscriptionManager.subscribe()` checks current connection state before calling `client.subscribe()`. If not `open`, it adds to the map and returns. `resubscribeAll()` handles replay.

**Why:** Eliminates double-subscribe bugs and side-effects during reconnect. The map is the source of truth; `resubscribeAll()` is the flush.

**Trade-offs accepted:** A new subscription won't be sent to the server until the connection reopens. This is the correct behavior — there's nothing to subscribe to while disconnected.

**What would change my mind:** A use case where immediate subscribe confirmation is needed even during reconnect (none in this app).

---

## Decision: ConnectionManager is transport-only (no typed fan-out)

**Date:** 2026-05-23
**Status:** accepted

**Context:** The Phase 1a roadmap declared `subscribe<T>(predicate, handler)` on `ConnectionManager`, but the implementation sketch used a plain `Set<MessageListener>`. These are incompatible. The typed predicate pattern would push JSON parsing and schema knowledge into the transport layer.

**Alternatives considered:**
- Typed `subscribe<T>(predicate, handler)` on `ConnectionManager` — pros: convenient for consumers; cons: validation runs per-subscriber, transport layer knows about message shapes, Zod parses can't be shared
- Transport-only `onRawMessage(handler: (raw: string) => void)` — pros: single JSON parse + Zod run in `KrakenClient` (Phase 1b), clean layering, transport stays protocol-agnostic; cons: less convenient to use directly (but `ConnectionManager` is never consumed directly)

**Choice:** `ConnectionManager` exposes `onRawMessage`. `KrakenClient` (Phase 1b) owns JSON parse, Zod validation, and typed fan-out.

**Why:** Validation must run exactly once per frame. The transport layer must not know about Kraken message shapes — that's Phase 1b's responsibility.

**Trade-offs accepted:** `ConnectionManager`'s public API is narrower and less self-documenting. Acceptable because components never touch it directly.

**What would change my mind:** A second WebSocket endpoint with a different protocol where per-subscriber filtering would genuinely be cheaper.

---

## Decision: Outbound buffer drops newest on overflow; orders bypass entirely

**Date:** 2026-05-23
**Status:** accepted

**Context:** The roadmap's outbound buffer dropped the oldest message on overflow. Drop-oldest is wrong for subscription-based protocols: it discards the user's first (most important) subscribe request and keeps later, potentially redundant ones.

**Alternatives considered:**
- Drop-oldest (roadmap default) — breaks subscribe ordering
- Drop-newest + `send(): boolean` — preserves earliest intent; overflow is visible to caller
- Per-message coalescing — correct but requires knowing message types (Phase 1b concern)

**Choice:** Drop-newest; `send()` returns `boolean` (false = dropped). Coalescing deferred to Phase 1b.

For order placement (Phase 4): market orders and limit orders represent explicit user intent at a specific moment/price. Buffering either is dangerous — a market order replayed seconds late, or a limit order replayed at a stale price. **Order placement bypasses `send()` and the buffer entirely; it surfaces an error to the user when offline.**

**Why:** Phase 4 confirmed: both market and limit orders must not be silently buffered. Clean disconnection state is always shown to the user before an order is placed.

**Trade-offs accepted:** Subscribe requests can be dropped if the buffer fills during a storm. Phase 1b's `KrakenClient` must handle this (retry subscribe on reconnect regardless).

**What would change my mind:** Evidence that users hit the buffer cap under normal load.

---

## Decision: Reconnect cadence shifts to slow-retry (not hard stop); UI notifies user

**Date:** 2026-05-23
**Status:** accepted

**Context:** After N failed fast-backoff attempts, the roadmap transitions to `{ status: 'closed', reason: 'max-attempts-exceeded' }` permanently. This leaves a tab open during an outage dead with no recovery path.

**Alternatives considered:**
- Hard stop after 20 attempts, show "refresh page" UI — simple, predictable; user must act
- Slow-cadence retry (every 5 min) after fast-backoff exhausts — self-healing; user can stay on page

**Choice:** After fast-backoff exhausts, shift to slow-cadence retry (every 5 min). The `ConnectionState` union gets a new status variant: `degraded` — meaning "we're still trying but you should know the connection is struggling."

The UI must surface `degraded` state visibly (banner, status indicator). Silent self-healing without user awareness is not acceptable for a trading context.

**Why:** A user watching a live order book during an outage should not need to manually refresh. But they must know the feed is degraded so they don't trade on stale data.

**Trade-offs accepted:** More complex state machine; UI must handle the `degraded` status. Worth it — the alternative (silent dead UI) is worse for a trading app.

**What would change my mind:** If the `degraded` state causes user confusion in testing (e.g., they don't understand why they're still seeing data but with a warning).

---

## Decision: Intentional disconnect clears outbound buffer

**Date:** 2026-05-23
**Status:** accepted

**Context:** On `disconnect()`, the outbound buffer could be retained (so a subsequent `connect()` replays queued messages) or cleared (clean slate).

**Choice:** Clear the buffer on intentional disconnect.

**Why:** Replaying stale subscription requests after an intentional disconnect would show the user incorrect or stale data. A clean disconnect means clean intent — the app or user explicitly ended the session. Reconnecting should start fresh.

**Trade-offs accepted:** Any in-flight subscribe requests queued before `disconnect()` are lost. Acceptable: `KrakenClient` (Phase 1b) resubscribes to all active channels on every fresh connect anyway.

**What would change my mind:** A use case where buffered messages before a planned disconnect are safe and desirable to replay.
