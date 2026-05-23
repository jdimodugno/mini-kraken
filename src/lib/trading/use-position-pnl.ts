'use client';

import { Decimal } from '@/lib/money/decimal';

const ZERO = new Decimal(0);
import { useOrderBookStore } from '@/stores/orderbook-store';
import { usePositionsStore } from '@/stores/positions-store';
import { chooseMarkPrice, computeUnrealizedPnl, type Position } from './positions';

export interface PositionWithPnl {
  position: Position;
  markPrice: Decimal | null;
  unrealizedPnl: Decimal;
}

export function usePositionWithPnl(symbol: string): PositionWithPnl | null {
  const position = usePositionsStore((s) => s.positions.get(symbol));
  // Subscribe to book updates so P&L recalculates on every tick.
  const _lastUpdate = useOrderBookStore((s) => s.lastUpdateAt.get(symbol) ?? 0);

  if (position === undefined) return null;

  const book = useOrderBookStore.getState().books.get(symbol);
  const markPrice = book !== undefined ? chooseMarkPrice(position, book) : null;
  const unrealizedPnl =
    markPrice !== null ? computeUnrealizedPnl(position, markPrice) : ZERO;

  return { position, markPrice, unrealizedPnl };
}
