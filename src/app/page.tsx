import { Suspense } from 'react';
import { OrderBookShell } from '@/components/OrderBookShell';
import { ChartShell } from '@/components/chart/ChartShell';
import { TradingPanel } from '@/components/trading/TradingPanel';
import { BottomTabs } from '@/components/trading/BottomTabs';
import { AssetInfoBar } from '@/components/AssetInfoBar';
import { PortfolioPlaceholder } from '@/components/PortfolioPlaceholder';

const SYMBOL = 'BTC/USD';

export default function Home() {
  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      {/* App title bar — full width, above content container */}
      <div className="w-full bg-zinc-900 border-b border-zinc-800 px-6 h-9 flex items-center">
        <span className="text-sm font-semibold tracking-wide text-zinc-100">MiniKraken</span>
      </div>

      {/* Content container */}
      <div
        className="max-w-[1600px] mx-auto p-4 flex flex-col gap-3"
        style={{ minHeight: 'calc(100vh - 2.25rem)' }}
      >
        {/* Top bar: asset info — full width */}
        <div className="rounded-lg bg-zinc-900/60 border border-zinc-800 shrink-0">
          <AssetInfoBar symbol={SYMBOL} />
        </div>

        {/* Main 3-column grid */}
        <div className="grid grid-cols-[1fr_280px_320px] gap-3 min-h-0 flex-1">
          {/* Column 1: Chart */}
          <Suspense
            fallback={
              <div className="rounded-lg bg-zinc-900/60 border border-zinc-800 animate-pulse min-h-[420px]" />
            }
          >
            <div className="rounded-lg bg-zinc-900/60 border border-zinc-800 overflow-hidden min-h-[420px]">
              <ChartShell symbol={SYMBOL} />
            </div>
          </Suspense>

          {/* Column 2: Order Book */}
          <Suspense
            fallback={
              <div className="rounded-lg bg-zinc-900/60 border border-zinc-800 animate-pulse" />
            }
          >
            <div className="rounded-lg bg-zinc-900/60 border border-zinc-800 overflow-hidden">
              <OrderBookShell symbol={SYMBOL} />
            </div>
          </Suspense>

          {/* Column 3: Right rail — Order Entry + Portfolio */}
          <div className="flex flex-col gap-3 min-h-0">
            <Suspense
              fallback={
                <div className="rounded-lg bg-zinc-900/60 border border-zinc-800 animate-pulse flex-1" />
              }
            >
              <div className="rounded-lg bg-zinc-900/60 border border-zinc-800 overflow-hidden">
                <div className="p-3">
                  <TradingPanel symbol={SYMBOL} />
                </div>
              </div>
            </Suspense>

            <div className="rounded-lg bg-zinc-900/60 border border-zinc-800 overflow-hidden">
              <PortfolioPlaceholder />
            </div>
          </div>
        </div>

        {/* Bottom row: full-width tabs */}
        <div className="rounded-lg bg-zinc-900/60 border border-zinc-800 shrink-0">
          <BottomTabs />
        </div>
      </div>
    </main>
  );
}
