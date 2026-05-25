'use client';

import { OrderEntry } from './OrderEntry';

interface TradingPanelProps {
  symbol: string;
}

export function TradingPanel({ symbol }: TradingPanelProps) {
  return <OrderEntry symbol={symbol} />;
}
