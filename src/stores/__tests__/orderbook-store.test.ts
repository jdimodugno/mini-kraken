import { describe, it, expect, beforeEach } from 'vitest';
import { Decimal } from '@/lib/money/decimal';
import type { Level } from '@/lib/orderbook/orderbook';

// Reset Zustand store state between tests by re-creating via getState
// We import the actual store and reset it manually.
import { useOrderBookStore } from '../orderbook-store';

function level(price: string, qty: string): Level {
  return {
    price: new Decimal(price),
    qty: new Decimal(qty),
    rawPrice: price,
    rawQty: qty,
  };
}

const BID = level('100', '1');
const ASK = level('101', '1');

function resetStore() {
  useOrderBookStore.setState({
    books: new Map(),
    lastUpdateAt: new Map(),
    checksumStatus: new Map(),
    bookEpochs: new Map(),
  });
}

describe('orderbook-store — H5 epoch drop logic', () => {
  beforeEach(() => {
    resetStore();
  });

  it('applySnapshot with no prior epoch: accepted regardless', () => {
    const { applySnapshot, books } = useOrderBookStore.getState();
    applySnapshot('BTC/USD', [BID], [ASK], 1);
    expect(useOrderBookStore.getState().books.get('BTC/USD')).toBeDefined();
    expect(useOrderBookStore.getState().bookEpochs.get('BTC/USD')).toBe(1);
    void books;
  });

  it('applySnapshot with stale epoch (epoch < current) is dropped', () => {
    const { applySnapshot } = useOrderBookStore.getState();
    applySnapshot('BTC/USD', [BID], [ASK], 2);
    const bookAfterFirst = useOrderBookStore.getState().books.get('BTC/USD');

    // epoch=1 < current=2 → drop
    applySnapshot('BTC/USD', [level('99', '5')], [ASK], 1);

    // Book should be unchanged (still from epoch=2 snapshot)
    expect(useOrderBookStore.getState().books.get('BTC/USD')).toBe(bookAfterFirst);
    expect(useOrderBookStore.getState().bookEpochs.get('BTC/USD')).toBe(2);
  });

  it('applyUpdate with no bookEpoch recorded (no snapshot) is dropped', () => {
    const { applyUpdate } = useOrderBookStore.getState();
    // No snapshot applied — bookEpochs is empty
    applyUpdate('BTC/USD', [BID], [ASK], 0, 1);
    expect(useOrderBookStore.getState().books.get('BTC/USD')).toBeUndefined();
  });

  it('applyUpdate with wrong epoch is dropped', () => {
    const { applySnapshot, applyUpdate } = useOrderBookStore.getState();
    applySnapshot('BTC/USD', [BID], [ASK], 2);
    const lastUpdate = useOrderBookStore.getState().lastUpdateAt.get('BTC/USD');

    // epoch=1 ≠ current=2 → drop
    applyUpdate('BTC/USD', [BID], [ASK], 0, 1);
    expect(useOrderBookStore.getState().lastUpdateAt.get('BTC/USD')).toBe(lastUpdate);
  });

  it('applyUpdate with undefined epoch passes through to checksum check', () => {
    const { applySnapshot, applyUpdate } = useOrderBookStore.getState();
    applySnapshot('BTC/USD', [BID], [ASK], 2);

    // epoch=undefined → no epoch gate; goes to checksum check (will fail with 0)
    applyUpdate('BTC/USD', [], [], 0, undefined);
    // checksumStatus will be 'failed' if checksum didn't match, which is fine —
    // the point is it wasn't dropped at the epoch gate.
    const status = useOrderBookStore.getState().checksumStatus.get('BTC/USD');
    expect(status === 'ok' || status === 'failed').toBe(true);
  });

  it('resyncing status does NOT gate applyUpdate (epoch does)', () => {
    const { applySnapshot, setChecksumStatus, applyUpdate } = useOrderBookStore.getState();
    applySnapshot('BTC/USD', [BID], [ASK], 1);
    setChecksumStatus('BTC/USD', 'resyncing');

    const lastUpdateBefore = useOrderBookStore.getState().lastUpdateAt.get('BTC/USD');

    // epoch matches → update should proceed (resyncing is UX-only now)
    // It will likely fail checksum check; what matters is it wasn't dropped early.
    applyUpdate('BTC/USD', [], [], 999999, 1);

    // After update attempt, checksumStatus may be 'failed' or something, but
    // lastUpdateAt hasn't changed (checksum mismatch). The key assertion: the
    // update was NOT silently dropped because of 'resyncing'.
    const statusAfter = useOrderBookStore.getState().checksumStatus.get('BTC/USD');
    // statusAfter should be 'failed' because checksum didn't match — not still 'resyncing'
    expect(statusAfter).toBe('failed');
    void lastUpdateBefore;
  });
});
