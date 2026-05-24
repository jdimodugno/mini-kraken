'use client';

import { OrderEntry } from './OrderEntry';

interface TradingPanelProps {
  symbol: string;
}

export function TradingPanel({ symbol }: TradingPanelProps) {
  return (
    <div className="h-full overflow-y-auto">
      <OrderEntry symbol={symbol} />
    </div>
  );
}
