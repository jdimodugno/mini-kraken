'use client';

import { useState } from 'react';
import { Decimal } from '@/lib/money/decimal';
import { useMarketOrderPreview } from '@/lib/trading/use-market-preview';
import { useLimitFillTrigger } from '@/lib/trading/use-limit-fill-trigger';
import { useTradingStore } from '@/stores/trading-store';
import type { OrderType, Side } from '@/lib/trading/types';
import { MarketPreview } from './MarketPreview';

interface OrderEntryProps {
  symbol: string;
}

function parseSafeDecimal(raw: string): Decimal | null {
  if (!raw.trim()) return null;
  try {
    const d = new Decimal(raw);
    return d.isFinite() ? d : null;
  } catch {
    return null;
  }
}

export function OrderEntry({ symbol }: OrderEntryProps) {
  useLimitFillTrigger(symbol);

  const [type, setType] = useState<OrderType>('market');
  const [side, setSide] = useState<Side>('buy');
  const [sizeStr, setSizeStr] = useState('');
  const [limitPriceStr, setLimitPriceStr] = useState('');

  const size = parseSafeDecimal(sizeStr);
  const preview = useMarketOrderPreview(symbol, side, type === 'market' ? size : null);

  const isDisabled = (() => {
    if (size === null || !size.gt(0)) return true;
    if (type === 'limit' && !limitPriceStr.trim()) return true;
    if (type === 'market' && preview?.insufficientLiquidity === true && size !== null) {
      // Allow partial fills — only block if preview is unavailable due to empty book
      // (preview null means no book data, not necessarily insufficient)
    }
    return false;
  })();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (isDisabled || size === null) return;

    const limitPrice = type === 'limit' ? parseSafeDecimal(limitPriceStr) : undefined;
    if (type === 'limit' && limitPrice === null) return;

    useTradingStore.getState().placeOrder({
      symbol,
      side,
      type,
      size,
      ...(limitPrice !== undefined && limitPrice !== null ? { limitPrice } : {}),
    });

    setSizeStr('');
    setLimitPriceStr('');
  }

  return (
    <div className="border border-zinc-700 rounded p-4 bg-zinc-900">
      <h2 className="text-sm font-semibold text-zinc-300 mb-3">Order Entry — {symbol}</h2>

      {/* Order type toggle */}
      <div className="flex gap-1 mb-3">
        {(['market', 'limit'] as OrderType[]).map((t) => (
          <button
            key={t}
            onClick={() => setType(t)}
            className={`flex-1 py-1 text-xs rounded capitalize transition-colors ${
              type === t
                ? 'bg-zinc-700 text-zinc-100'
                : 'bg-zinc-800 text-zinc-500 hover:text-zinc-300'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Side toggle */}
      <div className="flex gap-1 mb-3">
        <button
          onClick={() => setSide('buy')}
          className={`flex-1 py-1 text-xs rounded transition-colors ${
            side === 'buy'
              ? 'bg-emerald-700 text-white'
              : 'bg-zinc-800 text-zinc-500 hover:text-zinc-300'
          }`}
        >
          Buy
        </button>
        <button
          onClick={() => setSide('sell')}
          className={`flex-1 py-1 text-xs rounded transition-colors ${
            side === 'sell'
              ? 'bg-red-700 text-white'
              : 'bg-zinc-800 text-zinc-500 hover:text-zinc-300'
          }`}
        >
          Sell
        </button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-2">
        <div>
          <label className="block text-xs text-zinc-500 mb-1">Size (BTC)</label>
          <input
            type="number"
            min="0"
            step="any"
            value={sizeStr}
            onChange={(e) => setSizeStr(e.target.value)}
            placeholder="0.00"
            className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
          />
        </div>

        {type === 'limit' && (
          <div>
            <label className="block text-xs text-zinc-500 mb-1">Limit Price (USD)</label>
            <input
              type="number"
              min="0"
              step="any"
              value={limitPriceStr}
              onChange={(e) => setLimitPriceStr(e.target.value)}
              placeholder="0.00"
              className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
            />
          </div>
        )}

        {type === 'market' && preview !== null && <MarketPreview preview={preview} />}

        <button
          type="submit"
          disabled={isDisabled}
          className={`w-full py-2 text-sm font-medium rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
            side === 'buy'
              ? 'bg-emerald-700 hover:bg-emerald-600 text-white'
              : 'bg-red-700 hover:bg-red-600 text-white'
          }`}
        >
          {side === 'buy' ? 'Buy' : 'Sell'} {type === 'market' ? 'Market' : 'Limit'}
        </button>
      </form>
    </div>
  );
}
