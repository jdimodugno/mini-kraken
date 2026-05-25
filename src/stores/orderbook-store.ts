import { create } from 'zustand';
import { OrderBook, type Level } from '@/lib/orderbook/orderbook';
import { computeBookChecksum } from '@/lib/orderbook/checksum';
import { markUpdateReceived } from '@/lib/perf/marks';

// 'resyncing' is UX-only after H5+M9: it signals to the UI that a resync is in
// flight. It no longer gates applyUpdate — epoch mismatches do that now.
type ChecksumStatus = 'ok' | 'failed' | 'resyncing';

export interface OrderBookState {
  books: Map<string, OrderBook>;
  lastUpdateAt: Map<string, number>;
  checksumStatus: Map<string, ChecksumStatus>;
  // H5: per-symbol accepted epoch — frames from a prior epoch are dropped.
  bookEpochs: Map<string, number>;

  applySnapshot: (symbol: string, bids: Level[], asks: Level[], epoch?: number) => void;
  applyUpdate: (symbol: string, bids: Level[], asks: Level[], expectedChecksum: number, epoch?: number) => void;
  setChecksumStatus: (symbol: string, status: ChecksumStatus) => void;
  getBook: (symbol: string) => OrderBook | undefined;
}

export const useOrderBookStore = create<OrderBookState>((set, get) => ({
  books: new Map(),
  lastUpdateAt: new Map(),
  checksumStatus: new Map(),
  bookEpochs: new Map(),

  applySnapshot(symbol, bids, asks, epoch) {
    const state = get();
    const currentEpoch = state.bookEpochs.get(symbol);

    // Drop snapshots that are older than the current accepted epoch.
    if (epoch !== undefined && currentEpoch !== undefined && epoch < currentEpoch) {
      return;
    }

    const isNewSymbol = !state.books.has(symbol);
    const book = state.books.get(symbol) ?? new OrderBook();
    book.applySnapshot(bids, asks);

    // M1: `books` Map identity changes only when a new symbol is added.
    // On updates to an existing symbol, the mutable OrderBook instance is
    // updated in place; `lastUpdateAt` is the immutability boundary for re-renders.
    if (isNewSymbol) {
      state.books.set(symbol, book);
    }

    set((s) => ({
      ...(isNewSymbol ? { books: new Map(s.books) } : {}),
      lastUpdateAt: new Map(s.lastUpdateAt).set(symbol, Date.now()),
      checksumStatus: new Map(s.checksumStatus).set(symbol, 'ok'),
      bookEpochs: epoch !== undefined
        ? new Map(s.bookEpochs).set(symbol, epoch)
        : s.bookEpochs,
    }));
  },

  applyUpdate(symbol, bids, asks, expectedChecksum, epoch) {
    markUpdateReceived(symbol);
    const state = get();
    const book = state.books.get(symbol);

    if (book === undefined) {
      console.warn(`[orderbook-store] Update for ${symbol} before snapshot — dropping`);
      return;
    }

    // H5: epoch gate. Drop if no snapshot accepted yet (no epoch on record) or if
    // epoch doesn't match the current accepted epoch. The 'resyncing' status no
    // longer gates updates; epoch does.
    const currentEpoch = state.bookEpochs.get(symbol);
    if (currentEpoch === undefined) {
      // No snapshot accepted yet — drop.
      return;
    }
    if (epoch !== undefined && epoch !== currentEpoch) {
      return;
    }

    // M1: mutate the OrderBook instance in place — no Map clone needed.
    // `lastUpdateAt` is the signal that drives re-renders.
    book.applyUpdate(bids, asks);
    const actual = computeBookChecksum(book);

    if (actual !== expectedChecksum) {
      console.warn(
        `[orderbook-store] Checksum mismatch for ${symbol}: expected ${expectedChecksum}, got ${actual}`,
      );
      set((s) => ({
        checksumStatus: new Map(s.checksumStatus).set(symbol, 'failed'),
      }));
      return;
    }

    set((s) => ({
      lastUpdateAt: new Map(s.lastUpdateAt).set(symbol, Date.now()),
      checksumStatus: new Map(s.checksumStatus).set(symbol, 'ok'),
    }));
  },

  setChecksumStatus(symbol, status) {
    set((s) => ({
      checksumStatus: new Map(s.checksumStatus).set(symbol, status),
    }));
  },

  getBook(symbol) {
    return get().books.get(symbol);
  },
}));

export function useOrderBookStatus(symbol: string): ChecksumStatus {
  return useOrderBookStore((s) => s.checksumStatus.get(symbol) ?? 'ok');
}

export type { ChecksumStatus };
