'use client';

import { OrderEntry } from './OrderEntry';
import { PositionsPanel } from './PositionsPanel';
import { OpenOrders } from './OpenOrders';
import { FilledOrders } from './FilledOrders';

interface TradingPanelProps {
  symbol: string;
}

export function TradingPanel({ symbol }: TradingPanelProps) {
  return (
    <div className="space-y-4">
      <OrderEntry symbol={symbol} />
      <PositionsPanel />
      <OpenOrders />
      <FilledOrders />
    </div>
  );
}
