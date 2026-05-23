import { create } from 'zustand';
import { Decimal } from '@/lib/money/decimal';
import { simulateMarketOrder } from '@/lib/trading/simulate';
import { useOrderBookStore } from './orderbook-store';
import { usePositionsStore } from './positions-store';
import type { FilledOrder, Fill, OpenOrder, OrderRequest } from '@/lib/trading/types';

// Taker fee: 0.26% (26 bps). Maker fee: 0.16% (16 bps).
const TAKER_FEE_BPS = 26;
const MAKER_FEE_BPS = 16;

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export interface TradingState {
  filledOrders: FilledOrder[];
  openOrders: OpenOrder[];

  placeOrder: (req: OrderRequest) => void;
  cancelOpenOrder: (id: string) => void;
  tryFillOpenOrders: () => void;
}

export const useTradingStore = create<TradingState>((set, get) => ({
  filledOrders: [],
  openOrders: [],

  placeOrder(req: OrderRequest) {
    if (req.type === 'market') {
      const book = useOrderBookStore.getState().books.get(req.symbol);
      if (book === undefined) {
        console.warn(`[trading-store] No book for ${req.symbol} — cannot place market order`);
        return;
      }

      const result = simulateMarketOrder(req.side, req.size, book, TAKER_FEE_BPS);
      if (result === null) {
        console.warn(`[trading-store] Market order simulation failed for ${req.symbol} — insufficient book`);
        return;
      }

      const fills: Fill[] = result.levelFills.map((lf) => ({
        price: lf.price,
        size: lf.size,
        fee: lf.fee,
      }));

      const filled: FilledOrder = {
        id: generateId(),
        symbol: req.symbol,
        side: req.side,
        type: 'market',
        requestedSize: req.size,
        fills,
        totalCost: result.totalCost,
        averagePrice: result.averagePrice,
        totalFee: result.totalFee,
        status: result.insufficientLiquidity ? 'partial' : 'filled',
        filledAt: Date.now(),
      };

      usePositionsStore.getState().applyFilledOrder(filled);

      set((s) => ({ filledOrders: [filled, ...s.filledOrders] }));
      return;
    }

    // Limit order.
    if (req.limitPrice === undefined) {
      console.warn('[trading-store] Limit order missing limitPrice');
      return;
    }

    const open: OpenOrder = {
      id: generateId(),
      symbol: req.symbol,
      side: req.side,
      type: 'limit',
      size: req.size,
      remainingSize: req.size,
      limitPrice: req.limitPrice,
      createdAt: Date.now(),
    };

    set((s) => ({ openOrders: [...s.openOrders, open] }));
  },

  cancelOpenOrder(id: string) {
    set((s) => ({ openOrders: s.openOrders.filter((o) => o.id !== id) }));
  },

  tryFillOpenOrders() {
    const { openOrders } = get();
    if (openOrders.length === 0) return;

    const filled: FilledOrder[] = [];
    const remainingOpen: OpenOrder[] = [];

    for (const order of openOrders) {
      const book = useOrderBookStore.getState().books.get(order.symbol);
      if (book === undefined) {
        remainingOpen.push(order);
        continue;
      }

      const { bestBid, bestAsk } = book.topOfBook();

      // Trigger conditions:
      // buy limit: fill when best ask ≤ limit price (you get filled at your limit or better)
      // sell limit: fill when best bid ≥ limit price
      const triggered =
        order.side === 'buy'
          ? bestAsk !== null && bestAsk.price.lte(order.limitPrice)
          : bestBid !== null && bestBid.price.gte(order.limitPrice);

      if (!triggered) {
        remainingOpen.push(order);
        continue;
      }

      // Fill at the limit price with maker fee.
      const feeRate = new Decimal(MAKER_FEE_BPS).div(10000);
      const fillSize = order.remainingSize;
      const fillPrice = order.limitPrice;
      const notional = fillSize.times(fillPrice);
      const fee = notional.times(feeRate);

      const fill: Fill = { price: fillPrice, size: fillSize, fee };

      const filledOrder: FilledOrder = {
        id: order.id,
        symbol: order.symbol,
        side: order.side,
        type: 'limit',
        requestedSize: order.size,
        fills: [fill],
        totalCost: notional,
        averagePrice: fillPrice,
        totalFee: fee,
        status: 'filled',
        filledAt: Date.now(),
      };

      usePositionsStore.getState().applyFilledOrder(filledOrder);
      filled.push(filledOrder);
    }

    if (filled.length > 0) {
      set((s) => ({
        openOrders: remainingOpen,
        filledOrders: [...filled, ...s.filledOrders],
      }));
    }
  },
}));
