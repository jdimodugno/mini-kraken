# MiniKraken: Senior Frontend Engineer Interview Prep

This is a multi-phase project designed to prepare you for a Senior Frontend Engineer interview at Kraken. The goal is dual: **ship a real working product** AND **be able to defend every architectural decision** in a technical interview.

## How to Use These Documents

Each phase document contains:
- **Learning objectives** — what concepts you must internalize, not just implement
- **Step-by-step build instructions** with code-level guidance
- **"Why this matters" callouts** — the interview reasoning behind each decision
- **Common mistakes** — traps to avoid
- **Interview drill questions** — practice answering these out loud before moving on

Do not skip the "interview drill" sections. Building the project teaches you mechanics; answering the questions out loud teaches you to *communicate* like a senior engineer.

## Phase Index

| File | Phase | Estimated Time |
|------|-------|----------------|
| `01-phase1a-websocket-fundamentals.md` | WebSocket connection layer | 1 day |
| `02-phase1b-kraken-integration.md` | Kraken-specific WS protocol | 1–2 days |
| `03-phase2a-orderbook-data.md` | Order book data structure & checksum | 1–2 days |
| `04-phase2b-orderbook-rendering.md` | High-performance React rendering | 2 days |
| `05-phase3-charting.md` | Candlestick charts & REST/WS handoff | 1–2 days |
| `06-phase4a-order-matching.md` | Order entry & fill simulation | 2 days |
| `07-phase4b-pnl-precision.md` | P&L tracking & decimal math | 1 day |
| `08-phase5-testing-polish.md` | Tests, a11y, deploy, docs | 2 days |

**Total budget:** ~14 days of focused work. If you have less time, prioritize Phases 1, 2, and 4 — those are the meat.

## Setup Checklist (Do This First)

Before starting Phase 1, get these in place:

1. **Node.js 20+** installed
2. **A scratch repo** initialized with `pnpm create next-app@latest minikraken --typescript --tailwind --app --eslint`
3. **Strict TypeScript** — open `tsconfig.json` and add: `"noUncheckedIndexedAccess": true`, `"exactOptionalPropertyTypes": true`. These catch real bugs.
4. **Read the Kraken WebSocket v2 docs** end-to-end before writing code: https://docs.kraken.com/api/docs/websocket-v2/
5. **Open the Kraken Pro trading UI** in a browser tab and just watch it for 10 minutes. Notice what updates, how often, and where your eye is drawn. You're going to rebuild a slice of this.

## A Mental Model for the Whole Project

Picture the data flow as a pipeline:

```
Kraken WS server
    ↓ (raw frames, ~10-50/sec)
Connection Manager (Phase 1)
    ↓ (typed, validated messages)
Domain stores (order book, trades, candles) (Phase 2, 3)
    ↓ (selectors)
React components (Phase 2b, 3)
    ↓ (user actions)
Order entry + simulator (Phase 4)
    ↓ (positions, P&L)
UI (Phase 5: tested, accessible, deployed)
```

Every phase is a slice of this pipeline. When you get stuck, ask: "Where in this pipeline am I, and what's the contract between my layer and the next?"

## The Big Interview Themes

These come up repeatedly across all phases. Internalize them now:

1. **Performance is measured, not assumed.** Every claim ("this is fast", "this scales") needs a number behind it.
2. **Correctness > cleverness.** A simple, obviously-correct order book beats a clever-but-subtly-broken one. Especially in finance.
3. **The hard part is state.** Anyone can write a component. Senior engineers manage state that lives across sockets, components, and time.
4. **You own the user's trust.** A trading UI that lies — wrong P&L, stale prices, dropped fills — is worse than no UI at all.

Start with `01-phase1a-websocket-fundamentals.md`.
