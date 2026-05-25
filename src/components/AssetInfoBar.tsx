'use client';

import { CurrentPrice } from '@/components/CurrentPrice';
import { ConnectionStatusDot } from '@/components/ConnectionStatusDot';

// MOCK — phase 6+ will wire to Kraken WS ticker channel
const MOCK_24H = {
  changePercent: '+2.34',
  high: '111,842.50',
  low: '107,215.00',
  volume: '14,203 BTC',
} as const;

const isPositive = MOCK_24H.changePercent.startsWith('+');

interface AssetInfoBarProps {
  symbol: string;
}

export function AssetInfoBar({ symbol }: AssetInfoBarProps) {
  return (
    <div className="flex items-center gap-6 px-4 py-2.5 h-full">
      {/* Left cluster: symbol + live bid/ask/spread */}
      <div className="flex items-center gap-3 shrink-0">
        <span className="text-sm font-mono font-semibold text-zinc-100 tracking-wide">
          {symbol}
        </span>
        <CurrentPrice symbol={symbol} />
      </div>

      {/* Middle cluster: 24h stats */}
      <dl className="flex items-center gap-5">
        <div className="flex flex-col">
          <dt className="text-[10px] text-zinc-500 uppercase tracking-wider leading-none mb-0.5">
            24h Change
          </dt>
          <dd
            className={`text-xs font-mono font-medium ${
              isPositive ? 'text-emerald-400' : 'text-red-400'
            }`}
          >
            {MOCK_24H.changePercent}%
          </dd>
        </div>
        <div className="flex flex-col">
          <dt className="text-[10px] text-zinc-500 uppercase tracking-wider leading-none mb-0.5">
            24h High
          </dt>
          <dd className="text-xs font-mono text-zinc-200">${MOCK_24H.high}</dd>
        </div>
        <div className="flex flex-col">
          <dt className="text-[10px] text-zinc-500 uppercase tracking-wider leading-none mb-0.5">
            24h Low
          </dt>
          <dd className="text-xs font-mono text-zinc-200">${MOCK_24H.low}</dd>
        </div>
        <div className="flex flex-col">
          <dt className="text-[10px] text-zinc-500 uppercase tracking-wider leading-none mb-0.5">
            24h Volume
          </dt>
          <dd className="text-xs font-mono text-zinc-200">{MOCK_24H.volume}</dd>
        </div>
      </dl>

      {/* Right cluster: connection + utility placeholder */}
      <div className="ml-auto flex items-center gap-3">
        <ConnectionStatusDot />
        <div className="w-8 h-8 rounded bg-zinc-800/40" />
      </div>
    </div>
  );
}
