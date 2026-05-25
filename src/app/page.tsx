import { Suspense } from 'react';
import { OrderBookShell } from '@/components/OrderBookShell';
import { ChartShell } from '@/components/chart/ChartShell';
import { TradingPanel } from '@/components/trading/TradingPanel';
import { BottomTabs } from '@/components/trading/BottomTabs';
import { CurrentPrice } from '@/components/CurrentPrice';
import { ConnectionStatusDot } from '@/components/ConnectionStatusDot';

const SYMBOL = 'BTC/USD';

export default function Home() {
  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      {/* App title bar — full width, above the content container */}
      <div className="w-full bg-zinc-900 border-b border-zinc-800 px-6 h-9 flex items-center">
        <span className="text-sm font-semibold tracking-wide text-zinc-100">MiniKraken</span>
      </div>

      <div className="max-w-[1280px] mx-auto flex flex-col" style={{ height: 'calc(100vh - 2.25rem)' }}>
        {/* Symbol / price header */}
        <header className="h-10 flex items-center gap-4 px-4 border-b border-zinc-800 shrink-0">
          <span className="text-xs font-mono text-zinc-400 uppercase tracking-widest">
            {SYMBOL}
          </span>
          <CurrentPrice symbol={SYMBOL} />
          <div className="ml-auto">
            <ConnectionStatusDot />
          </div>
        </header>

        {/* Main area */}
        <div className="flex-1 grid grid-cols-[1fr_280px] min-h-0">
          {/* Left: Chart + bottom tabs */}
          <Suspense fallback={
            <div className="flex flex-col min-h-0">
              <div className="h-[50vh] min-h-0 shrink-0 bg-zinc-900 animate-pulse" />
              <div className="flex-1 bg-zinc-950 animate-pulse" />
            </div>
          }>
            <div className="flex flex-col min-h-0">
              <div className="h-[50vh] min-h-0 shrink-0">
                <ChartShell symbol={SYMBOL} />
              </div>
              <BottomTabs />
            </div>
          </Suspense>

          {/* Right: Order book + Order entry */}
          <Suspense fallback={
            <div className="flex flex-col min-h-0 overflow-hidden bg-zinc-900">
              <div className="flex-1 animate-pulse bg-zinc-900" />
              <div className="h-48 animate-pulse bg-zinc-800 border-t border-zinc-700" />
            </div>
          }>
            <div className="flex flex-col min-h-0 overflow-hidden bg-zinc-900">
              <div className="shrink-0 border-b border-zinc-800">
                <OrderBookShell symbol={SYMBOL} />
              </div>
              <div className="flex-1 overflow-y-auto p-4">
                <TradingPanel symbol={SYMBOL} />
              </div>
            </div>
          </Suspense>
        </div>
      </div>
    </main>
  );
}
