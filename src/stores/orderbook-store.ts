import { create } from 'zustand';
import { OrderBook, type Level } from '@/lib/orderbook/orderbook';
import { computeBookChecksum } from '@/lib/orderbook/checksum';
import { markUpdateReceived } from '@/lib/perf/marks';

type ChecksumStatus = 'ok' | 'failed' | 'resyncing';

export interface OrderBookState {
  books: Map<string, OrderBook>;
  lastUpdateAt: Map<string, number>;
  checksumStatus: Map<string, ChecksumStatus>;

  applySnapshot: (symbol: string, bids: Level[], asks: Level[]) => void;
  applyUpdate: (symbol: string, bids: Level[], asks: Level[], expectedChecksum: number) => void;
  setChecksumStatus: (symbol: string, status: ChecksumStatus) => void;
  getBook: (symbol: string) => OrderBook | undefined;
}

export const useOrderBookStore = create<OrderBookState>((set, get) => ({
  books: new Map(),
  lastUpdateAt: new Map(),
  checksumStatus: new Map(),

  applySnapshot(symbol, bids, asks) {
    const book = get().books.get(symbol) ?? new OrderBook();
    book.applySnapshot(bids, asks);
    set((s) => ({
      books: new Map(s.books).set(symbol, book),
      lastUpdateAt: new Map(s.lastUpdateAt).set(symbol, Date.now()),
      checksumStatus: new Map(s.checksumStatus).set(symbol, 'ok'),
    }));
  },

  applyUpdate(symbol, bids, asks, expectedChecksum) {
    markUpdateReceived(symbol);
    const state = get();
    const book = state.books.get(symbol);

    if (book === undefined) {
      console.warn(`[orderbook-store] Update for ${symbol} before snapshot — dropping`);
      return;
    }

    if (state.checksumStatus.get(symbol) === 'resyncing') {
      return;
    }

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
