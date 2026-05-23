'use client';

import { Decimal, toDisplayString } from '@/lib/money/decimal';
import { useTradingStore } from '@/stores/trading-store';

const STATUS_CLASS: Record<string, string> = {
  filled: 'text-emerald-400',
  partial: 'text-amber-400',
  rejected: 'text-red-400',
};

export function FilledOrders() {
  const allFilledOrders = useTradingStore((s) => s.filledOrders);
  const filledOrders = allFilledOrders.slice(0, 20);

  if (filledOrders.length === 0) {
    return (
      <div className="border border-zinc-700 rounded p-4 bg-zinc-900">
        <h2 className="text-sm font-semibold text-zinc-300 mb-2">Filled Orders</h2>
        <p className="text-xs text-zinc-600">No filled orders</p>
      </div>
    );
  }

  return (
    <div className="border border-zinc-700 rounded p-4 bg-zinc-900">
      <h2 className="text-sm font-semibold text-zinc-300 mb-3">Filled Orders</h2>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-zinc-500 border-b border-zinc-800">
              <th className="text-left pb-2 pr-3">Symbol</th>
              <th className="text-left pb-2 pr-3">Side</th>
              <th className="text-left pb-2 pr-3">Type</th>
              <th className="text-right pb-2 pr-3">Filled Size</th>
              <th className="text-right pb-2 pr-3">Avg Price</th>
              <th className="text-right pb-2 pr-3">Total Cost</th>
              <th className="text-right pb-2 pr-3">Fee</th>
              <th className="text-left pb-2 pr-3">Status</th>
              <th className="text-right pb-2">Time</th>
            </tr>
          </thead>
          <tbody>
            {filledOrders.map((order) => {
              const filledSize = order.fills.reduce((acc, f) => acc.plus(f.size), new Decimal(0));
              return (
                <tr key={order.id} className="border-b border-zinc-800 last:border-0">
                  <td className="py-2 pr-3 text-zinc-200 font-mono">{order.symbol}</td>
                  <td
                    className={`py-2 pr-3 capitalize ${
                      order.side === 'buy' ? 'text-emerald-400' : 'text-red-400'
                    }`}
                  >
                    {order.side}
                  </td>
                  <td className="py-2 pr-3 text-zinc-400 capitalize">{order.type}</td>
                  <td className="py-2 pr-3 text-right text-zinc-200 font-mono">
                    {toDisplayString(filledSize, 8)}
                  </td>
                  <td className="py-2 pr-3 text-right text-zinc-200 font-mono">
                    ${toDisplayString(order.averagePrice, 2)}
                  </td>
                  <td className="py-2 pr-3 text-right text-zinc-200 font-mono">
                    ${toDisplayString(order.totalCost, 2)}
                  </td>
                  <td className="py-2 pr-3 text-right text-zinc-400 font-mono">
                    ${toDisplayString(order.totalFee, 2)}
                  </td>
                  <td className={`py-2 pr-3 capitalize ${STATUS_CLASS[order.status] ?? 'text-zinc-400'}`}>
                    {order.status}
                  </td>
                  <td className="py-2 text-right text-zinc-500">
                    {new Date(order.filledAt).toLocaleTimeString()}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
