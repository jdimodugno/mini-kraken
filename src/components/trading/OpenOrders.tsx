'use client';

import { useTradingStore } from '@/stores/trading-store';

export function OpenOrders() {
  const openOrders = useTradingStore((s) => s.openOrders);

  if (openOrders.length === 0) {
    return (
      <div className="border border-zinc-700 rounded p-4 bg-zinc-900">
        <h2 className="text-sm font-semibold text-zinc-300 mb-2">Open Orders</h2>
        <p className="text-xs text-zinc-600">No open orders</p>
      </div>
    );
  }

  return (
    <div className="border border-zinc-700 rounded p-4 bg-zinc-900">
      <h2 className="text-sm font-semibold text-zinc-300 mb-3">Open Orders</h2>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-zinc-500 border-b border-zinc-800">
              <th className="text-left pb-2 pr-3">Symbol</th>
              <th className="text-left pb-2 pr-3">Side</th>
              <th className="text-right pb-2 pr-3">Size</th>
              <th className="text-right pb-2 pr-3">Limit Price</th>
              <th className="text-right pb-2 pr-3">Created</th>
              <th className="pb-2"></th>
            </tr>
          </thead>
          <tbody>
            {openOrders.map((order) => (
              <tr key={order.id} className="border-b border-zinc-800 last:border-0">
                <td className="py-2 pr-3 text-zinc-200 font-mono">{order.symbol}</td>
                <td
                  className={`py-2 pr-3 capitalize ${
                    order.side === 'buy' ? 'text-emerald-400' : 'text-red-400'
                  }`}
                >
                  {order.side}
                </td>
                <td className="py-2 pr-3 text-right text-zinc-200 font-mono">
                  {order.remainingSize.toFixed(8)}
                </td>
                <td className="py-2 pr-3 text-right text-zinc-200 font-mono">
                  ${order.limitPrice.toFixed(2)}
                </td>
                <td className="py-2 pr-3 text-right text-zinc-500">
                  {new Date(order.createdAt).toLocaleTimeString()}
                </td>
                <td className="py-2">
                  <button
                    onClick={() => useTradingStore.getState().cancelOpenOrder(order.id)}
                    className="text-zinc-500 hover:text-red-400 transition-colors px-1"
                    title="Cancel order"
                  >
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
