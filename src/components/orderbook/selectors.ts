import type { OrderBookState } from '@/stores/orderbook-store';

export interface LevelDisplay {
  priceStr: string;
  qtyStr: string;
  depthPct: number;
}

export function selectLevelDisplay(
  symbol: string,
  side: 'bid' | 'ask',
  index: number,
  totalDepth: number,
) {
  return (state: OrderBookState): LevelDisplay | null => {
    const book = state.books.get(symbol);
    if (!book) return null;
    const levels = side === 'bid' ? book.getBids(totalDepth) : book.getAsks(totalDepth);
    const level = levels[index];
    if (!level) return null;

    let cumQty = 0;
    for (let i = 0; i <= index; i++) {
      cumQty += levels[i]?.qty.toNumber() ?? 0;
    }
    const totalQty = levels.reduce((acc, l) => acc + l.qty.toNumber(), 0);
    const depthPct = totalQty > 0 ? cumQty / totalQty : 0;

    return {
      priceStr: level.price.toFixed(2),
      qtyStr: level.qty.toFixed(4),
      depthPct,
    };
  };
}

export function levelDisplayEqual(a: LevelDisplay | null, b: LevelDisplay | null): boolean {
  if (a === null && b === null) return true;
  if (a === null || b === null) return false;
  return a.priceStr === b.priceStr && a.qtyStr === b.qtyStr && a.depthPct === b.depthPct;
}
