'use client';

import { toDisplayString } from '@/lib/money/decimal';
import type { SimulationResult } from '@/lib/trading/simulate';

interface MarketPreviewProps {
  preview: SimulationResult;
}

function slippageColorClass(bps: number): string {
  if (bps > 50) return 'text-red-400';
  if (bps > 10) return 'text-amber-400';
  return 'text-zinc-400';
}

export function MarketPreview({ preview }: MarketPreviewProps) {
  const slippageBpsNum = parseFloat(preview.slippageBps.toFixed(2));

  return (
    <div className="mt-3 rounded border border-zinc-700 bg-zinc-900 p-3 text-xs space-y-1">
      {preview.insufficientLiquidity && (
        <p className="text-amber-400 font-medium">Insufficient liquidity — partial fill only</p>
      )}
      <div className="flex justify-between">
        <span className="text-zinc-500">Avg fill price</span>
        <span className="text-zinc-200">${toDisplayString(preview.averagePrice, 2)}</span>
      </div>
      <div className="flex justify-between">
        <span className="text-zinc-500">Total cost</span>
        <span className="text-zinc-200">${toDisplayString(preview.totalCost, 2)}</span>
      </div>
      <div className="flex justify-between">
        <span className="text-zinc-500">Fee (0.26%)</span>
        <span className="text-zinc-200">${toDisplayString(preview.totalFee, 2)}</span>
      </div>
      <div className="flex justify-between">
        <span className="text-zinc-500">Slippage</span>
        <span className={slippageColorClass(slippageBpsNum)}>
          {toDisplayString(preview.slippageBps, 2)} bps
        </span>
      </div>
      <div className="flex justify-between">
        <span className="text-zinc-500">Fills across levels</span>
        <span className="text-zinc-200">{preview.levelFills.length}</span>
      </div>
    </div>
  );
}
