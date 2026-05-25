import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SubscriptionManager } from '../subscription-manager';
import type { KrakenClient } from '../client';
import type { KrakenMessage } from '../schemas';

// ---------------------------------------------------------------------------
// Minimal KrakenClient stub
// ---------------------------------------------------------------------------

function makeClient() {
  const messageHandlers = new Set<(msg: KrakenMessage) => void>();
  const stateHandlers = new Set<(state: { status: string; since: number }) => void>();
  let connectionStatus: 'open' | 'closed' = 'open';
  const sentFrames: unknown[] = [];

  const client = {
    subscribe: vi.fn((params) => { sentFrames.push({ method: 'subscribe', ...params }); return true; }),
    unsubscribe: vi.fn((params) => { sentFrames.push({ method: 'unsubscribe', ...params }); return true; }),
    getConnectionState: () => ({ status: connectionStatus, since: 1000 }),
    onConnectionStateChange: (h: (state: { status: string; since: number }) => void) => {
      stateHandlers.add(h);
      return () => stateHandlers.delete(h);
    },
    onMessage: (h: (msg: KrakenMessage) => void) => {
      messageHandlers.add(h);
      return () => messageHandlers.delete(h);
    },
    // helpers for tests
    _emit: (msg: KrakenMessage) => messageHandlers.forEach((h) => h(msg)),
    _setStatus: (s: 'open' | 'closed') => { connectionStatus = s; },
    _reconnect: (since: number) => {
      connectionStatus = 'open';
      stateHandlers.forEach((h) => h({ status: 'open', since }));
    },
    _sent: sentFrames,
  };
  return client as unknown as typeof client & KrakenClient;
}

// Helper: emit a subscribe ack with a given req_id
function subAck(client: ReturnType<typeof makeClient>, reqId: number, success = true) {
  client._emit({
    method: 'subscribe',
    success,
    req_id: reqId,
    result: { channel: 'book', symbol: 'BTC/USD' },
    time_in: '',
    time_out: '',
  } as unknown as KrakenMessage);
}

function unsubAck(client: ReturnType<typeof makeClient>, reqId: number, success = true) {
  client._emit({
    method: 'unsubscribe',
    success,
    req_id: reqId,
    result: { channel: 'book', symbol: 'BTC/USD' },
    time_in: '',
    time_out: '',
  } as unknown as KrakenMessage);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SubscriptionManager — H3 req_id correlation', () => {
  it('assigns unique req_ids to successive subscribe calls', () => {
    const client = makeClient();
    const subs = new SubscriptionManager(client as unknown as KrakenClient);

    subs.subscribe({ channel: 'book', symbol: 'BTC/USD', depth: 10 });
    subs.subscribe({ channel: 'book', symbol: 'ETH/USD', depth: 10 });

    const ids = (client.subscribe as ReturnType<typeof vi.fn>).mock.calls.map(
      (c: unknown[]) => (c[0] as { req_id?: number }).req_id,
    );
    expect(ids[0]).not.toBe(ids[1]);
    expect(typeof ids[0]).toBe('number');
    expect(typeof ids[1]).toBe('number');
  });

  it('matches sub ack by req_id not by channel+symbol scan', () => {
    const client = makeClient();
    const subs = new SubscriptionManager(client as unknown as KrakenClient);

    // Subscribe BTC depth=10 first, then depth=25 — both are 'book'/'BTC/USD'
    subs.subscribe({ channel: 'book', symbol: 'BTC/USD', depth: 10 });
    subs.subscribe({ channel: 'book', symbol: 'BTC/USD', depth: 25 });

    const calls = (client.subscribe as ReturnType<typeof vi.fn>).mock.calls as [{ req_id: number }][];
    const reqId10 = calls[0]![0].req_id;
    const reqId25 = calls[1]![0].req_id;

    // Ack for depth=25 first — should not flip depth=10 to subscribed
    subAck(client, reqId25);

    // Epoch for depth=10 should still be 1 (not double-bumped)
    expect(subs.getEpoch({ channel: 'book', symbol: 'BTC/USD', depth: 10 })).toBe(1);
    expect(subs.getEpoch({ channel: 'book', symbol: 'BTC/USD', depth: 25 })).toBe(1);

    // Now ack depth=10 — no error thrown
    expect(() => subAck(client, reqId10)).not.toThrow();
  });
});

describe('SubscriptionManager — H4 Phase state machine', () => {
  it('subscribe → release before sub-ack → sends unsubscribe on ack (releasePending)', () => {
    const client = makeClient();
    const subs = new SubscriptionManager(client as unknown as KrakenClient);

    const release = subs.subscribe({ channel: 'book', symbol: 'BTC/USD', depth: 10 });
    const subReqId = ((client.subscribe as ReturnType<typeof vi.fn>).mock.calls[0] as [{ req_id: number }, ...unknown[]])[0].req_id;

    // Release before ack arrives
    release();

    // No unsubscribe sent yet (still subscribing)
    expect((client.unsubscribe as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);

    // Sub-ack arrives — should immediately send unsubscribe
    subAck(client, subReqId);

    expect((client.unsubscribe as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
  });

  it('subscribe → release (after sub-ack) → subscribe again: no duplicate wire frame', () => {
    const client = makeClient();
    const subs = new SubscriptionManager(client as unknown as KrakenClient);

    const release = subs.subscribe({ channel: 'book', symbol: 'BTC/USD', depth: 10 });
    const subReqId1 = ((client.subscribe as ReturnType<typeof vi.fn>).mock.calls[0] as [{ req_id: number }, ...unknown[]])[0].req_id;
    subAck(client, subReqId1);

    // Release — sends unsubscribe
    release();
    expect((client.unsubscribe as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
    const unsubReqId = ((client.unsubscribe as ReturnType<typeof vi.fn>).mock.calls[0] as [{ req_id: number }, ...unknown[]])[0].req_id;

    // Re-subscribe while unsubscribing — sets queuedResubscribe, no wire frame
    const subCallsBefore = (client.subscribe as ReturnType<typeof vi.fn>).mock.calls.length;
    subs.subscribe({ channel: 'book', symbol: 'BTC/USD', depth: 10 });
    expect((client.subscribe as ReturnType<typeof vi.fn>).mock.calls.length).toBe(subCallsBefore);

    // Unsub-ack arrives — should send subscribe (queuedResubscribe)
    unsubAck(client, unsubReqId);
    expect((client.subscribe as ReturnType<typeof vi.fn>).mock.calls.length).toBe(subCallsBefore + 1);
  });

  it('refCount fan-out: second subscribe while subscribed bumps refCount only', () => {
    const client = makeClient();
    const subs = new SubscriptionManager(client as unknown as KrakenClient);

    const r1 = subs.subscribe({ channel: 'book', symbol: 'BTC/USD', depth: 10 });
    const r2 = subs.subscribe({ channel: 'book', symbol: 'BTC/USD', depth: 10 });

    // Only one subscribe frame sent
    expect((client.subscribe as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);

    // Release one — no unsub yet (refCount still > 0)
    r1();
    expect((client.unsubscribe as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);

    // Release second — now unsub sends (but needs sub-ack first to be 'subscribed')
    // Actually we skipped sub-ack so phase is 'subscribing'; releasePending is set
    r2();
    expect((client.unsubscribe as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);
  });
});

describe('SubscriptionManager — H5 epoch', () => {
  it('epoch starts at 0, bumps to 1 on first sendSubscribe', () => {
    const client = makeClient();
    const subs = new SubscriptionManager(client as unknown as KrakenClient);

    expect(subs.getEpoch({ channel: 'book', symbol: 'BTC/USD', depth: 10 })).toBe(0);
    subs.subscribe({ channel: 'book', symbol: 'BTC/USD', depth: 10 });
    expect(subs.getEpoch({ channel: 'book', symbol: 'BTC/USD', depth: 10 })).toBe(1);
  });

  it('refCount subscribe does NOT bump epoch', () => {
    const client = makeClient();
    const subs = new SubscriptionManager(client as unknown as KrakenClient);

    subs.subscribe({ channel: 'book', symbol: 'BTC/USD', depth: 10 });
    expect(subs.getEpoch({ channel: 'book', symbol: 'BTC/USD', depth: 10 })).toBe(1);

    subs.subscribe({ channel: 'book', symbol: 'BTC/USD', depth: 10 }); // refCount bump
    expect(subs.getEpoch({ channel: 'book', symbol: 'BTC/USD', depth: 10 })).toBe(1);
  });

  it('requestResync bumps epoch BEFORE sending unsubscribe wire frame', () => {
    const client = makeClient();
    const subs = new SubscriptionManager(client as unknown as KrakenClient);

    const release = subs.subscribe({ channel: 'book', symbol: 'BTC/USD', depth: 10 });
    const reqId1 = ((client.subscribe as ReturnType<typeof vi.fn>).mock.calls[0] as [{ req_id: number }, ...unknown[]])[0].req_id;
    subAck(client, reqId1);

    const epochBeforeResync = subs.getEpoch({ channel: 'book', symbol: 'BTC/USD', depth: 10 });
    expect(epochBeforeResync).toBe(1);

    subs.requestResync({ channel: 'book', symbol: 'BTC/USD', depth: 10 });

    // Epoch bumped before unsubscribe frame
    expect(subs.getEpoch({ channel: 'book', symbol: 'BTC/USD', depth: 10 })).toBe(2);
    expect((client.unsubscribe as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);

    // Unsub ack arrives — queued resubscribe fires, bumps epoch again
    const unsubReqId = ((client.unsubscribe as ReturnType<typeof vi.fn>).mock.calls[0] as [{ req_id: number }, ...unknown[]])[0].req_id;
    unsubAck(client, unsubReqId);

    expect(subs.getEpoch({ channel: 'book', symbol: 'BTC/USD', depth: 10 })).toBe(3);
    expect((client.subscribe as ReturnType<typeof vi.fn>).mock.calls.length).toBe(2);

    release();
  });

  it('resubscribeAll bumps epoch for every key', () => {
    const client = makeClient();
    client._setStatus('closed');
    const subs = new SubscriptionManager(client as unknown as KrakenClient);

    // Subscribe while offline — no wire frame yet
    subs.subscribe({ channel: 'book', symbol: 'BTC/USD', depth: 10 });
    subs.subscribe({ channel: 'book', symbol: 'ETH/USD', depth: 10 });

    expect(subs.getEpoch({ channel: 'book', symbol: 'BTC/USD', depth: 10 })).toBe(0);
    expect(subs.getEpoch({ channel: 'book', symbol: 'ETH/USD', depth: 10 })).toBe(0);

    client._reconnect(2000);

    expect(subs.getEpoch({ channel: 'book', symbol: 'BTC/USD', depth: 10 })).toBe(1);
    expect(subs.getEpoch({ channel: 'book', symbol: 'ETH/USD', depth: 10 })).toBe(1);
  });
});
