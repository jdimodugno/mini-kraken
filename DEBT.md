# DEBT.md — Roadmap Status & Outstanding Work

Snapshot: 2026-05-25 (post-H12 layout rework). Source of truth for phase completion is `PROGRESS.md`; this file is the narrative read of what's done, what's deferred, and where the project drifted from the original roadmap.

---

## Phase completion snapshot

| Phase | Status | Notes |
|---|---|---|
| Setup (S1–S4) | ✅ done | tooling, agents, strict TS |
| Phase 1a — WebSocket Fundamentals | ✅ done | hardened twice (initial + post-audit H1/H2) |
| Phase 1b — Kraken Integration | ✅ done | hardened twice (initial + H3/H4/H5/M12 trio + deltas) |
| Phase 2a — Order Book Data | ✅ done | epoch isolation added post-audit (H5) |
| Phase 2b — Order Book Rendering | ✅ done | O(N²) selector fix (H7) shipped post-audit |
| Phase 3 — Candlestick Charting | ✅ done | live updates broken until H10 (silent schema fail) — fixed 2026-05-25 |
| Phase 4a — Order Matching & Simulation | ✅ done | |
| Phase 4b — P&L & Decimal Precision | ✅ done | partial-fill fee aggregation deferred (see H9) |
| Phase 5 — Testing, A11y, Polish, Deploy | 🟡 **partial** — 5 of 13 items done | **the real outstanding phase** (see below) |

There is **no Phase 6** in the roadmap. Several items defer work to "phase 6+" (H9, portfolio widget, ticker channel) but no spec exists. Treat "phase 6" as an implicit future scope, not a planned phase.

---

## 🔴 Phase 5 — outstanding work (the actual debt)

These are the items still owed against the original roadmap, in dependency order:

| ID | Item | Effort | Owner candidate | Blocker / dependency |
|---|---|---|---|---|
| 5.6 | Playwright E2E smoke test | M | qa-test-engineer | None — test stack already wired |
| 5.7 | A11y: debounced `aria-live` for price updates, `sr-only` ticker | S | qa-test-engineer | None |
| 5.8 | Keyboard navigation pass (focus order, focus rings, escape on dialogs) | S | nextjs-react-engineer | Depends on layout being stable (H12 just landed — good) |
| 5.9 | Color/contrast + non-color signals (icons or text alongside green/red) | S | nextjs-react-engineer | None |
| 5.10 | Lighthouse pass (target: perf ≥90, a11y 100) | S | nextjs-react-engineer | Run after 5.7–5.9 |
| 5.11 | README polish | S | orchestrator | After everything else lands |
| 5.12 | `DECISIONS.md` final review (≥10 entries) | XS | orchestrator | Quick audit of existing entries |
| 5.13 | `AI_USAGE.md` final review | XS | orchestrator | scribe-owned; pass after 5.11 |
| 5.V | Verification checklist | XS | orchestrator | gate before "Phase 5 done" |

**Net effort to close Phase 5**: ~1–2 focused sessions. Nothing requires architectural input; mostly polish, a11y, and one E2E test.

---

## 🟡 Backlog still open

From `BACKLOG.md` (audit 2026-05-25, post-hardening waves):

| ID | Item | Status | Why still open |
|---|---|---|---|
| H9 | `fill.fee` Decimal accumulation across partial fills | in-progress | Pre-emptive comment landed; code fix requires phase 6+ fill aggregation spec that doesn't exist yet |
| M7 | `OrderBook` three independent inline selectors | deferred | Selectors return primitives — only matters under multi-symbol UI, which doesn't exist |
| M13 | `use-candles` live handler matches on `(channel, symbol)` without checking wire `interval` | todo | Latent — doesn't manifest today (one Chart at a time). Surfaced during H10 diagnosis |
| L1 | `BookRow` not wrapped in `React.memo` | wontfix | `useStoreWithEqualityFn` already gates renders; `memo` would skip zero |

**Net new risk**: only **M13** is latent code-correctness debt. The other three are correctly classified (deferred, design-intent, or N/A under current scope).

**Stale row in PROGRESS.md**: `B5` ("Ack-watchdog timeout") is marked `pending` but actually shipped under `BH3` (cross-cutting hardening deltas wave, watchdog `ACK_TIMEOUT_MS=10000`). Worth a scribe correction pass.

---

## 🔵 Mock / placeholder debt (not in original roadmap)

Introduced by the UX iteration (H12 layout rework). All are intentional and approved by the user; flagged here so they don't get lost:

1. **`AssetInfoBar` 24h widgets** — `MOCK_24H` static values for Change %, High, Low, Volume in `src/components/AssetInfoBar.tsx`. User explicitly declined to file a follow-up ticket; real wiring would require a Kraken WS `ticker` channel subscription (new schema, new store, new subscription). Surfaces here so the next person knows it's mock.
2. **`PortfolioPlaceholder`** — entirely placeholder (Equity, Available, Unrealized P&L, Today's P&L rows). Tagged "Phase 6+" in the UI. Requires a real positions/equity store and account integration that doesn't exist yet.
3. **`OrderEntry` taker fee** — hardcoded `26 bps` in `useMarketOrderPreview` (noted in AI_USAGE.md for Phase 4). Not a Kraken-tier-aware fee model.

---

## 🟢 Work shipped that wasn't in the roadmap

Treated as positive drift — these came from audits and user-driven iteration, not from a roadmap step:

- **Cross-cutting hardening waves** (2026-05-25):
  - High: H1, H2, H3, H4, H5, H6, H7, H8, H10, H11, H12
  - Medium: M1, M2, M3, M4, M5, M6, M8, M9, M10, M11, M12
  - Low: L2, L3, L4, L5, L6, L7, L8, L9, L10, L11
- **UX iteration**: title bar, centered container with breathing room, Bid/Ask/Spread header, 3-column grid with AssetInfoBar + PortfolioPlaceholder, full-width bottom tabs
- **Subscription reliability rewrite**: `req_id` correlation, `Phase` state machine with `unsubscribing`/`queuedResubscribe`/`releasePending`, per-key epoch isolation, watchdog (`ACK_TIMEOUT_MS=10000`), per-symbol reconnect resubscribe, error-ack retry semantics
- **Tooling**: three Claude Code skills wired into `nextjs-react-engineer` (`vercel-react-best-practices`, `nextjs-app-router-patterns`, `vercel-react-view-transitions`)

All recorded in `AI_USAGE.md`.

---

## 🧭 Suggested next moves

In priority order, smallest-cost-first:

1. **Close Phase 5** — items 5.6–5.13. ~1–2 sessions. Closes the only formally pending phase.
2. **Fix M13** if multi-Chart support is ever planned (cheap; one-line check on `d.interval`).
3. **Scribe correction**: flip PROGRESS row `B5` from `pending` → `done`.
4. **(Optional) Author a Phase 6 spec** if real portfolio, ticker channel, or partial-fill fee aggregation are wanted. Without a spec, H9 and the AssetInfoBar mock will sit indefinitely.

Nothing on this list is blocking the app from being demoable as-is. Phase 5 a11y/E2E work is the responsible close-out.
