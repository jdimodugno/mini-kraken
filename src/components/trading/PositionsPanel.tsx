'use client';

import { toDisplayString } from '@/lib/money/decimal';
import { usePositionWithPnl } from '@/lib/trading/use-position-pnl';
import { usePositionsStore } from '@/stores/positions-store';
import { PnlText } from './PnlText';

interface PositionRowProps {
  symbol: string;
}

function PositionRow({ symbol }: PositionRowProps) {
  const data = usePositionWithPnl(symbol);
  if (data === null) return null;

  const { position, markPrice, unrealizedPnl } = data;

  return (
    <tr className="border-b border-zinc-800 last:border-0">
      <td className="py-2 pr-3 text-zinc-200 font-mono">{symbol}</td>
      <td
        className={`py-2 pr-3 capitalize ${
          position.side === 'long' ? 'text-emerald-400' : 'text-red-400'
        }`}
      >
        {position.side}
      </td>
      <td className="py-2 pr-3 text-right text-zinc-200 font-mono">
        {toDisplayString(position.size, 8)}
      </td>
      <td className="py-2 pr-3 text-right text-zinc-200 font-mono">
        ${toDisplayString(position.averageEntryPrice, 2)}
      </td>
      <td className="py-2 pr-3 text-right text-zinc-400 font-mono">
        {markPrice !== null ? `$${toDisplayString(markPrice, 2)}` : '—'}
      </td>
      <td className="py-2 pr-3 text-right font-mono">
        <PnlText value={unrealizedPnl} />
      </td>
      <td className="py-2 text-right font-mono">
        <PnlText value={position.realizedPnl} />
      </td>
    </tr>
  );
}

export function PositionsPanel() {
  const positionsMap = usePositionsStore((s) => s.positions);
  const positions = Array.from(positionsMap.values());
  const totalRealizedPnl = usePositionsStore((s) => s.totalRealizedPnl);

  return (
    <div className="border border-zinc-700 rounded p-4 bg-zinc-900">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-zinc-300">Positions</h2>
        <span className="text-xs text-zinc-500">
          Total realized P&amp;L:{' '}
          <PnlText value={totalRealizedPnl} className="text-xs" />
        </span>
      </div>

      {positions.length === 0 ? (
        <p className="text-xs text-zinc-600">No positions</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-zinc-500 border-b border-zinc-800">
                <th className="text-left pb-2 pr-3">Symbol</th>
                <th className="text-left pb-2 pr-3">Side</th>
                <th className="text-right pb-2 pr-3">Size</th>
                <th className="text-right pb-2 pr-3">Avg Entry</th>
                <th className="text-right pb-2 pr-3">Mark Price</th>
                <th className="text-right pb-2 pr-3">Unrealized P&amp;L</th>
                <th className="text-right pb-2">Realized P&amp;L</th>
              </tr>
            </thead>
            <tbody>
              {positions.map((p) => (
                <PositionRow key={p.symbol} symbol={p.symbol} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
