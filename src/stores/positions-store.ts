import { create } from 'zustand';
import { useStoreWithEqualityFn } from 'zustand/traditional';
import { Decimal } from '@/lib/money/decimal';
import { applyFillToPosition, emptyPosition, type Position } from '@/lib/trading/positions';
import type { FilledOrder } from '@/lib/trading/types';

export interface PositionsState {
  positions: Map<string, Position>;
  totalRealizedPnl: Decimal;

  applyFilledOrder: (order: FilledOrder) => void;
}

export const usePositionsStore = create<PositionsState>((set, get) => ({
  positions: new Map(),
  totalRealizedPnl: new Decimal(0),

  applyFilledOrder(order: FilledOrder) {
    const { positions, totalRealizedPnl } = get();

    // Determine initial position side from order side.
    const positionSide = order.side === 'buy' ? 'long' : 'short';
    let position: Position =
      positions.get(order.symbol) ?? emptyPosition(order.symbol, positionSide);

    const prevRealized = position.realizedPnl;

    // All fee arithmetic must stay in Decimal. Do not introduce a number accumulator here when extending for phase 6+ fee tracking.
    for (const fill of order.fills) {
      position = applyFillToPosition(position, order.side, fill.size, fill.price, fill.fee);
    }

    const realizedDelta = position.realizedPnl.minus(prevRealized);

    const newPositions = new Map(positions);
    // If size is zero and no realized P&L was accumulated this order, remove.
    // Keep the position if it has realized P&L — caller may want to display history.
    if (position.size.eq(0) && position.realizedPnl.eq(0)) {
      newPositions.delete(order.symbol);
    } else {
      newPositions.set(order.symbol, position);
    }

    set({
      positions: newPositions,
      totalRealizedPnl: totalRealizedPnl.plus(realizedDelta),
    });
  },
}));

export function usePosition(symbol: string): Position | undefined {
  return useStoreWithEqualityFn(
    usePositionsStore,
    (s) => s.positions.get(symbol),
    Object.is,
  );
}
