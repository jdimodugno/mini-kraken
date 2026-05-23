# MiniKraken — Project Conventions

This is a Senior Frontend interview-prep build targeting Kraken. The spec is in `roadmap/` (8 phase files). This file tells Claude *how* to work in this repo.

## ⚠️ Next.js 16 — breaking changes from training data

This project uses **Next.js 16**, which has breaking changes from prior versions (15 and earlier). APIs, conventions, and file structure may differ from what's in training data. Before writing Next.js code:

- Check `node_modules/next/dist/docs/` for current API shapes
- Heed deprecation notices in the dev server output
- Do not assume Pages Router patterns; this is App Router only
- React 19 is installed — server actions, `use`, and async components are the norm

## Triggering work

The user invokes work in one of two ways:

1. **Roadmap-anchored** — "Start phase 2a", "Continue phase 1b from step 4". When you see this:
   - Read the relevant `roadmap/0X-*.md` file end-to-end.
   - For any non-trivial cross-layer design decision, delegate to `realtime-architect` (opus) FIRST. Do not write code until the architecture is settled.
   - Hand implementation to the right skill agent (see routing below).
   - After the agent returns, invoke `ai-usage-scribe` with the structured log.

2. **Skill-targeted** — "Have the react-performance-engineer profile X", "Ask the trading-domain-engineer to review Y". Delegate directly, then invoke the scribe.

## Agent routing

| Domain | Agent | Model |
|---|---|---|
| WS lifecycle, race conditions, store boundaries, cross-layer contracts | `realtime-architect` | opus |
| Next/React/Zustand/Tailwind implementation | `nextjs-react-engineer` | sonnet |
| Render perf, Profiler, memoization, row-level subs | `react-performance-engineer` | sonnet |
| Money math, order matching, positions, P&L, Decimal | `trading-domain-engineer` | sonnet |
| vitest, RTL, Playwright, a11y | `qa-test-engineer` | sonnet |
| Logging AI usage + updating progress grid | `ai-usage-scribe` | sonnet |

## The scribe mandate (non-negotiable)

After **every** non-trivial agent delegation, invoke `ai-usage-scribe` with:
- Which agent ran
- Task summary (1 line)
- What worked / what didn't / what the human corrected
- Files touched
- Which roadmap step(s) this maps to

The scribe is the **only** writer of `AI_USAGE.md` and `PROGRESS.md`. Do not edit those files directly, and instruct no other agent to.

"Non-trivial" = anything that produces or modifies code, design notes, or test results. Trivial reads, lookups, or status checks don't need a log entry.

## The roadmap is not gospel

The `roadmap/*.md` files are a learning scaffold authored before Next 16 / React 19 shipped. Skill agents are **expected** to challenge roadmap snippets when their expertise warrants — outdated APIs, weak designs, internal inconsistencies, missed failure modes. When an agent pushes back:

1. They surface the disagreement to the orchestrator before implementing
2. The orchestrator brings the choice to the human (one short message, with the trade-off)
3. If the agent's counter wins, a `DECISIONS.md` entry captures it
4. The agent then implements the *accepted* version, not the roadmap's

Blind adherence is a failure mode. So is bikeshedding. Push back only when the win is real.

## Project conventions

### TypeScript

- Strict mode with `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`.
- No `any`. No `as` casts outside Zod parse boundaries.
- Discriminated unions for state shapes (not bare string literals).

### Money math

- All prices, sizes, fees, P&L use `decimal.js`. Native `number` is allowed only at the display boundary (`toFixed`) and for non-money values (timestamps, indices, pixel positions).
- Banker's rounding (`ROUND_HALF_EVEN`).
- Never mix `number` arithmetic into a Decimal pipeline.

### State

- Long-lived domain state (connection, order book, subscriptions) lives in plain TS classes or Zustand stores, **outside React**.
- React reads via `useSyncExternalStore` (directly or via Zustand selectors). Never store WebSocket instances or OrderBook instances in `useState`.
- Mutable in-place updates are allowed inside class instances on the hot path. The Zustand store's `lastUpdateAt` map is the immutability boundary that triggers re-renders.

### React

- Selectors return primitives or stable references. Object-returning selectors trigger render storms.
- `React.memo` on rows only when props are primitives. Don't memo a component that takes an object prop.
- Animations that fire on every update use imperative DOM (`ref.classList`), not state.
- Use Profiler before optimizing. No optimization without a before/after number.

### Validation

- Every WS message and REST response passes through Zod at the boundary.
- `safeParse` + `console.debug` on unknown shapes — don't crash on Kraken adding fields.

### Comments

- Default to no comments. Code should read itself.
- Comment only the non-obvious *why* (sign conventions on shorts, why a class is mutated in place, etc.).

## Reference files

- `roadmap/00-README.md` — pipeline overview, interview themes
- `roadmap/01..08-*.md` — phase specs (read the relevant one before implementing)
- `DECISIONS.md` — architectural decision log
- `PROGRESS.md` — completion grid (scribe-maintained)
- `AI_USAGE.md` — AI leverage log (scribe-maintained, becomes the application's required AI usage doc)
