import { OrderBookShell } from '@/components/OrderBookShell';
import { ChartShell } from '@/components/chart/ChartShell';
import { TradingPanel } from '@/components/trading/TradingPanel';

export default function Home() {
  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100 p-6">
      <h1 className="text-lg font-mono font-semibold mb-6 text-zinc-300">MiniKraken</h1>
      <div className="grid grid-cols-1 xl:grid-cols-[1fr_360px] gap-6">
        <div className="space-y-6">
          <OrderBookShell symbol="BTC/USD" />
          <ChartShell symbol="BTC/USD" />
        </div>
        <TradingPanel symbol="BTC/USD" />
      </div>
    </main>
  );
}
