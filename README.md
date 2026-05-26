# MiniKraken

[![CI](https://github.com/jdimodugno/mini-kraken/actions/workflows/ci.yml/badge.svg)](https://github.com/jdimodugno/mini-kraken/actions/workflows/ci.yml)

A real-time cryptocurrency trading UI built for Senior Frontend Engineer interview preparation. Connects to Kraken's WebSocket v2 API for live order book and candlestick data, with a local order simulation engine.

## Features

- **Real-time Order Book** — Live bid/ask depth with CRC32 checksum verification and automatic resync on mismatch
- **Candlestick Charts** — Historical + live OHLC data via REST/WS handoff using lightweight-charts
- **Order Simulation** — Market and limit order placement with simulated fills against the live book
- **P&L Tracking** — Position management with realized/unrealized P&L using `decimal.js` for precision
- **Connection Resilience** — Exponential backoff, heartbeat monitoring, and degraded-state recovery

## Tech Stack

| Layer | Technology |
|-------|------------|
| Framework | Next.js 16 (App Router) + React 19 |
| Language | TypeScript (strict mode) |
| State | Zustand 5 with row-level subscriptions |
| Styling | Tailwind CSS 4 |
| Charts | lightweight-charts v5 |
| Validation | Zod 4 |
| Precision | decimal.js (banker's rounding) |
| Testing | Vitest + React Testing Library + Playwright |

## Getting Started

```bash
# Install dependencies
pnpm install

# Start development server
pnpm dev

# Open http://localhost:3000
```

## Scripts

```bash
pnpm dev          # Start dev server
pnpm build        # Production build
pnpm start        # Start production server
pnpm typecheck    # TypeScript check
pnpm lint         # ESLint
pnpm test         # Run unit tests
pnpm test:watch   # Run tests in watch mode
pnpm test:e2e     # Run Playwright E2E tests
```

## Architecture

```
Kraken WS v2 server
    ↓ (raw frames, ~10-50/sec)
ConnectionManager (transport layer)
    ↓ (typed, validated messages)
KrakenClient + SubscriptionManager (protocol layer)
    ↓ (domain events)
Zustand stores (order book, candles, positions)
    ↓ (selectors)
React components (row-level subscriptions)
    ↓ (user actions)
Order simulation engine
    ↓ (fills)
Position + P&L tracking
```

## Project Structure

```
src/
├── app/              # Next.js App Router pages
├── components/       # React components
├── lib/
│   ├── kraken/       # WebSocket + Kraken protocol
│   ├── candles/      # OHLC data fetching
│   ├── money/        # Decimal utilities
│   └── trading/      # Order simulation + P&L
└── stores/           # Zustand state stores
```

## Key Design Decisions

See [`DECISIONS.md`](./DECISIONS.md) for 24 documented architectural decisions covering:

- WebSocket connection lifecycle and resilience
- Order book checksum verification and resync strategy
- Decimal precision throughout the money path
- Row-level React subscriptions for performance
- Subscription correlation via `req_id` for reliability

## Development Notes

- **Strict TypeScript**: `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` enabled
- **No number for money**: All prices/quantities use `Decimal` until the display boundary
- **Performance measured**: `performance.mark` instrumentation; rAF batching deferred until measured need
- **Kraken WS v2**: Uses the newer v2 API with discriminated union message schemas

## Mock Data

The following are intentionally mocked (real implementation would require API keys):

- 24h change/high/low/volume in `AssetInfoBar` — uses static values
- Portfolio equity panel — placeholder pending account integration
- Taker fee — hardcoded at 26 bps

## CI/CD

**Branching Strategy:** GitHub Flow
- `main` is always deployable (production)
- Feature branches (`feature/*`) branch from and merge to `main`
- Every PR gets a Vercel preview deploy (staging)
- Branch protection: PRs required, CI must pass

**Git Hooks** via Husky:
- **pre-commit**: Branch guard (blocks `main`) + lint-staged + typecheck
- **pre-push**: Full test suite

**Continuous Integration** via GitHub Actions:
- Runs on every push to `main` and on pull requests
- Pipeline: `pnpm install` → `typecheck` → `lint` → `test` → `build`
- All checks must pass before merge

**Deployment** via Vercel:
- Auto-deploys `main` branch to production
- Preview deploys generated for every PR
- Zero-config Next.js deployment

## License

Private project for interview preparation.
