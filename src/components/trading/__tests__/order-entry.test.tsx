import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { OrderEntry } from '../OrderEntry';
import { useOrderBookStore } from '@/stores/orderbook-store';
import { OrderBook } from '@/lib/orderbook/orderbook';
import type { Level } from '@/lib/orderbook/orderbook';
import { Decimal } from '@/lib/money/decimal';

// useLimitFillTrigger uses useEffect with a store subscription.
// We mock it to a no-op to keep tests synchronous and avoid noise from
// store subscriptions setting up across test boundaries.
vi.mock('@/lib/trading/use-limit-fill-trigger', () => ({
  useLimitFillTrigger: () => undefined,
}));

function level(price: string, qty: string): Level {
  return {
    price: new Decimal(price),
    qty: new Decimal(qty),
    rawPrice: price,
    rawQty: qty,
  };
}

function seedBook(symbol: string, bids: Level[], asks: Level[]) {
  const book = new OrderBook();
  book.applySnapshot(bids, asks);
  useOrderBookStore.setState((s) => ({
    books: new Map(s.books).set(symbol, book),
    lastUpdateAt: new Map(s.lastUpdateAt).set(symbol, Date.now()),
  }));
}

function resetStore() {
  useOrderBookStore.setState({
    books: new Map(),
    lastUpdateAt: new Map(),
    checksumStatus: new Map(),
  });
}

const SYMBOL = 'XBT/USD';

describe('OrderEntry', () => {
  beforeEach(() => {
    resetStore();
  });

  describe('submit button disabled states', () => {
    it('is disabled when size input is empty', () => {
      render(<OrderEntry symbol={SYMBOL} />);
      const button = screen.getByRole('button', { name: /buy market/i });
      expect(button).toBeDisabled();
    });

    it('is disabled when size is zero', async () => {
      const user = userEvent.setup();
      render(<OrderEntry symbol={SYMBOL} />);
      const input = screen.getByLabelText(/size/i);
      await user.type(input, '0');
      expect(screen.getByRole('button', { name: /buy market/i })).toBeDisabled();
    });

    it('is enabled when a positive size is entered', async () => {
      const user = userEvent.setup();
      render(<OrderEntry symbol={SYMBOL} />);
      const input = screen.getByLabelText(/size/i);
      await user.type(input, '1');
      expect(screen.getByRole('button', { name: /buy market/i })).not.toBeDisabled();
    });

    it('is disabled for limit order when limit price is empty', async () => {
      const user = userEvent.setup();
      render(<OrderEntry symbol={SYMBOL} />);
      // Switch to limit order type
      await user.click(screen.getByRole('button', { name: /limit/i }));
      const sizeInput = screen.getByLabelText(/size/i);
      await user.type(sizeInput, '1');
      // Limit price field is visible but empty
      expect(screen.getByLabelText(/limit price/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /buy limit/i })).toBeDisabled();
    });

    it('is enabled for limit order when both size and limit price are entered', async () => {
      const user = userEvent.setup();
      render(<OrderEntry symbol={SYMBOL} />);
      await user.click(screen.getByRole('button', { name: /limit/i }));
      await user.type(screen.getByLabelText(/size/i), '1');
      await user.type(screen.getByLabelText(/limit price/i), '50000');
      expect(screen.getByRole('button', { name: /buy limit/i })).not.toBeDisabled();
    });
  });

  describe('market preview (slippage display)', () => {
    it('shows slippage info when size is entered and book has data', async () => {
      seedBook(SYMBOL, [], [level('50000', '5'), level('50100', '5')]);
      const user = userEvent.setup();
      render(<OrderEntry symbol={SYMBOL} />);
      await user.type(screen.getByLabelText(/size/i), '1');
      expect(screen.getByText(/slippage/i)).toBeInTheDocument();
      expect(screen.getByText(/avg fill price/i)).toBeInTheDocument();
    });

    it('does not show preview when book is empty', async () => {
      const user = userEvent.setup();
      render(<OrderEntry symbol={SYMBOL} />);
      await user.type(screen.getByLabelText(/size/i), '1');
      expect(screen.queryByText(/avg fill price/i)).not.toBeInTheDocument();
    });

    it('shows insufficient liquidity warning when order exceeds available depth', async () => {
      // Thin book: only 0.1 BTC available at a single ask level
      seedBook(SYMBOL, [], [level('50000', '0.1')]);
      const user = userEvent.setup();
      render(<OrderEntry symbol={SYMBOL} />);
      await user.type(screen.getByLabelText(/size/i), '5');
      expect(screen.getByText(/insufficient liquidity/i)).toBeInTheDocument();
    });

    it('does not show preview for limit order type', async () => {
      seedBook(SYMBOL, [], [level('50000', '5')]);
      const user = userEvent.setup();
      render(<OrderEntry symbol={SYMBOL} />);
      await user.click(screen.getByRole('button', { name: /limit/i }));
      await user.type(screen.getByLabelText(/size/i), '1');
      expect(screen.queryByText(/avg fill price/i)).not.toBeInTheDocument();
    });
  });

  describe('side toggle', () => {
    it('changes submit button label when switching to Sell', async () => {
      const user = userEvent.setup();
      render(<OrderEntry symbol={SYMBOL} />);
      await user.click(screen.getByRole('button', { name: 'Sell' }));
      // The submit button label should now say "Sell Market"
      expect(screen.getByRole('button', { name: /sell market/i })).toBeInTheDocument();
    });
  });

  describe('form reset after submit', () => {
    it('clears the size field after a successful market order submit', async () => {
      seedBook(SYMBOL, [], [level('50000', '5')]);
      const user = userEvent.setup();
      render(<OrderEntry symbol={SYMBOL} />);
      const sizeInput = screen.getByLabelText(/size/i);
      await user.type(sizeInput, '1');
      await user.click(screen.getByRole('button', { name: /buy market/i }));
      expect(sizeInput).toHaveValue(null);
    });
  });
});
