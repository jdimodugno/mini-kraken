import type { OrderBookState } from '@/stores/orderbook-store';

export interface LevelDisplay {
  priceStr: string;
  qtyStr: string;
}

// depthPct is now computed once per side in OrderBook via useMemo and passed as a
// primitive prop — removing the O(N²) cumulative-sum and reduce that ran inside
// every row's selector on every update tick.
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

    return {
      priceStr: level.price.toFixed(2),
      // noUncheckedIndexedAccess requires the ?. + ?? 0 pattern here; the array
      // is padded to totalDepth with empty rows, so 0 is the deliberate sentinel,
      // not a masked logic error.
      qtyStr: level.qty.toFixed(4),
    };
  };
}

export function levelDisplayEqual(a: LevelDisplay | null, b: LevelDisplay | null): boolean {
  if (a === null && b === null) return true;
  if (a === null || b === null) return false;
  return a.priceStr === b.priceStr && a.qtyStr === b.qtyStr;
}
