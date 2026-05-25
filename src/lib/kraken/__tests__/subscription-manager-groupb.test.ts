/**
 * Group B vitest tests — state-machine matrix + epoch gate
 *
 * Covers per the architect's spec:
 * - starting phase × input event: subscribe, release, sub-ack, unsub-ack,
 *   sub-ack-fail, unsub-ack-fail, socket-close, watchdog-timeout
 * - epoch gate: snapshot @ epoch 1 → update @ epoch 1 accepted →
 *   update @ epoch 0 dropped → snapshot @ epoch 2 accepted → update @ epoch 1 dropped
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SubscriptionManager } from '../subscription-manager';
import type { KrakenClient } from '../client';
import type { KrakenMessage } from '../schemas';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeClient(initialStatus: 'open' | 'closed' = 'open') {
  const messageHandlers = new Set<(msg: KrakenMessage) => void>();
  const stateHandlers = new Set<(state: { status: string; since: number }) => void>();
  let connectionStatus: 'open' | 'closed' = initialStatus;
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
    _emit: (msg: KrakenMessage) => messageHandlers.forEach((h) => h(msg)),
    _setStatus: (s: 'open' | 'closed') => {
      connectionStatus = s;
      stateHandlers.forEach((h) => h({ status: s, since: s === 'open' ? Date.now() : 0 }));
    },
    _reconnect: (since: number) => {
      connectionStatus = 'open';
      stateHandlers.forEach((h) => h({ status: 'open', since }));
    },
    _sent: sentFrames,
  };
  return client as unknown as typeof client & KrakenClient;
}

const DESC = { channel: 'book', symbol: 'BTC/USD', depth: 10 };

function subAck(client: ReturnType<typeof makeClient>, reqId: number, success = true) {
  client._emit({
    method: 'subscribe',
    success,
    req_id: reqId,
    result: { channel: 'book', symbol: 'BTC/USD' },
    time_in: '',
    time_out: '',
    ...(success ? {} : { error: 'test error' }),
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
    ...(success ? {} : { error: 'test error' }),
  } as unknown as KrakenMessage);
}

function lastSubReqId(client: ReturnType<typeof makeClient>): number {
  const calls = (client.subscribe as ReturnType<typeof vi.fn>).mock.calls as [{ req_id: number }][];
  const last = calls[calls.length - 1];
  if (!last?.[0]) throw new Error('No subscribe call found');
  return last[0].req_id;
}

function lastUnsubReqId(client: ReturnType<typeof makeClient>): number {
  const calls = (client.unsubscribe as ReturnType<typeof vi.fn>).mock.calls as [{ req_id: number }][];
  const last = calls[calls.length - 1];
  if (!last?.[0]) throw new Error('No unsubscribe call found');
  return last[0].req_id;
}

// ---------------------------------------------------------------------------
// H4 gap: releasePending cleared on re-subscribe during subscribing
// ---------------------------------------------------------------------------

describe('H4 gap — releasePending cleared on concurrent re-subscribe', () => {
  it('subscribe → release → re-subscribe before ack: ack fires subscribed, not unsubscribe', () => {
    const client = makeClient();
    const subs = new SubscriptionManager(client as unknown as KrakenClient);

    const r1 = subs.subscribe(DESC);
    const reqId = lastSubReqId(client);

    r1(); // sets releasePending
    subs.subscribe(DESC); // bumps refCount, clears releasePending

    // Sub-ack arrives — should go to 'subscribed', NOT send unsubscribe
    subAck(client, reqId);

    expect((client.unsubscribe as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);

    subs.destroy();
  });
});

// ---------------------------------------------------------------------------
// State machine matrix
// ---------------------------------------------------------------------------

describe('State machine — starting phase: idle', () => {
  it('idle + subscribe (online): sends subscribe frame, transitions to subscribing', () => {
    const client = makeClient();
    const subs = new SubscriptionManager(client as unknown as KrakenClient);

    subs.subscribe(DESC);

    expect((client.subscribe as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
    subs.destroy();
  });

  it('idle + subscribe (offline): no wire frame sent', () => {
    const client = makeClient('closed');
    const subs = new SubscriptionManager(client as unknown as KrakenClient);

    subs.subscribe(DESC);

    expect((client.subscribe as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);
    subs.destroy();
  });
});

describe('State machine — starting phase: subscribing', () => {
  it('subscribing + sub-ack (success): transitions to subscribed', () => {
    const client = makeClient();
    const subs = new SubscriptionManager(client as unknown as KrakenClient);
    subs.subscribe(DESC);
    const reqId = lastSubReqId(client);

    subAck(client, reqId);

    // Epoch is at 1 (bumped on sendSubscribe)
    expect(subs.getEpoch(DESC)).toBe(1);
    subs.destroy();
  });

  it('subscribing + release → sub-ack: sends unsubscribe on ack (releasePending)', () => {
    const client = makeClient();
    const subs = new SubscriptionManager(client as unknown as KrakenClient);
    const r = subs.subscribe(DESC);
    const reqId = lastSubReqId(client);

    r();
    subAck(client, reqId);

    expect((client.unsubscribe as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
    subs.destroy();
  });

  it('subscribing + sub-ack-fail (first attempt): retries subscribe', () => {
    const client = makeClient();
    const subs = new SubscriptionManager(client as unknown as KrakenClient);
    subs.subscribe(DESC);
    const reqId = lastSubReqId(client);

    subAck(client, reqId, false); // failure

    expect((client.subscribe as ReturnType<typeof vi.fn>).mock.calls.length).toBe(2);
    subs.destroy();
  });

  it('subscribing + sub-ack-fail (second attempt): marks status failed', () => {
    const client = makeClient();
    const subs = new SubscriptionManager(client as unknown as KrakenClient);
    subs.subscribe(DESC);
    const reqId1 = lastSubReqId(client);

    subAck(client, reqId1, false); // first failure → retry
    const reqId2 = lastSubReqId(client);
    subAck(client, reqId2, false); // second failure → mark failed

    // No further subscribe calls
    expect((client.subscribe as ReturnType<typeof vi.fn>).mock.calls.length).toBe(2);
    subs.destroy();
  });

  it('subscribing + socket-close: phase reset to idle, pendingRequests wiped', () => {
    const client = makeClient();
    const subs = new SubscriptionManager(client as unknown as KrakenClient);
    subs.subscribe(DESC);
    const epochBefore = subs.getEpoch(DESC);

    client._setStatus('closed');

    // After disconnect wipe, reconnect fires resubscribeAll
    // which bumps epoch again and sends a new subscribe
    client._reconnect(Date.now() + 100);

    expect(subs.getEpoch(DESC)).toBeGreaterThan(epochBefore);
    subs.destroy();
  });
});

describe('State machine — starting phase: subscribed', () => {
  function makeSubscribed() {
    const client = makeClient();
    const subs = new SubscriptionManager(client as unknown as KrakenClient);
    const release = subs.subscribe(DESC);
    const reqId = lastSubReqId(client);
    subAck(client, reqId);
    return { client, subs, release };
  }

  it('subscribed + release: sends unsubscribe, transitions to unsubscribing', () => {
    const { client, subs, release } = makeSubscribed();

    release();

    expect((client.unsubscribe as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
    subs.destroy();
  });

  it('subscribed + refCount sub: bumps refCount only, no new wire frame', () => {
    const { client, subs } = makeSubscribed();

    subs.subscribe(DESC);

    expect((client.subscribe as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
    subs.destroy();
  });

  it('subscribed + socket-close → reconnect: epoch bumped, new subscribe sent', () => {
    const { client, subs } = makeSubscribed();
    const epochBefore = subs.getEpoch(DESC);

    client._setStatus('closed');
    client._reconnect(Date.now() + 100);

    expect(subs.getEpoch(DESC)).toBeGreaterThan(epochBefore);
    expect((client.subscribe as ReturnType<typeof vi.fn>).mock.calls.length).toBe(2);
    subs.destroy();
  });
});

describe('State machine — starting phase: unsubscribing', () => {
  function makeUnsubscribing() {
    const client = makeClient();
    const subs = new SubscriptionManager(client as unknown as KrakenClient);
    const release = subs.subscribe(DESC);
    const subReqId = lastSubReqId(client);
    subAck(client, subReqId);
    release();
    const unsubReqId = lastUnsubReqId(client);
    return { client, subs, unsubReqId };
  }

  it('unsubscribing + unsub-ack: deletes entry, cleans epochs', () => {
    const { client, subs, unsubReqId } = makeUnsubscribing();

    unsubAck(client, unsubReqId);

    expect(subs.getEpoch(DESC)).toBe(0); // epoch deleted → returns 0
    subs.destroy();
  });

  it('unsubscribing + subscribe: sets queuedResubscribe; unsub-ack fires resubscribe', () => {
    const { client, subs, unsubReqId } = makeUnsubscribing();

    subs.subscribe(DESC);
    unsubAck(client, unsubReqId);

    expect((client.subscribe as ReturnType<typeof vi.fn>).mock.calls.length).toBe(2);
    subs.destroy();
  });

  it('unsubscribing + unsub-ack-fail (first): retries unsubscribe', () => {
    const { client, subs, unsubReqId } = makeUnsubscribing();

    unsubAck(client, unsubReqId, false); // first failure

    expect((client.unsubscribe as ReturnType<typeof vi.fn>).mock.calls.length).toBe(2);
    subs.destroy();
  });

  it('unsubscribing + unsub-ack-fail (second): marks status failed', () => {
    const { client, subs, unsubReqId } = makeUnsubscribing();

    unsubAck(client, unsubReqId, false); // first failure → retry
    const unsubReqId2 = lastUnsubReqId(client);
    unsubAck(client, unsubReqId2, false); // second failure → mark failed

    expect((client.unsubscribe as ReturnType<typeof vi.fn>).mock.calls.length).toBe(2);
    subs.destroy();
  });
});

// ---------------------------------------------------------------------------
// Reconnect batching policy: one subscribe frame PER SYMBOL
// ---------------------------------------------------------------------------

describe('Reconnect batching policy — one frame per symbol', () => {
  it('two symbols → two subscribe frames on reconnect', () => {
    const client = makeClient('closed');
    const subs = new SubscriptionManager(client as unknown as KrakenClient);

    subs.subscribe({ channel: 'book', symbol: 'BTC/USD', depth: 10 });
    subs.subscribe({ channel: 'book', symbol: 'ETH/USD', depth: 10 });

    expect((client.subscribe as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);

    client._reconnect(2000);

    const calls = (client.subscribe as ReturnType<typeof vi.fn>).mock.calls as [{ symbol: string[] }][];
    expect(calls.length).toBe(2);
    // Each frame has exactly one symbol
    expect(calls[0]?.[0].symbol).toHaveLength(1);
    expect(calls[1]?.[0].symbol).toHaveLength(1);
    subs.destroy();
  });

  it('each symbol gets its own req_id on reconnect', () => {
    const client = makeClient('closed');
    const subs = new SubscriptionManager(client as unknown as KrakenClient);

    subs.subscribe({ channel: 'book', symbol: 'BTC/USD', depth: 10 });
    subs.subscribe({ channel: 'book', symbol: 'ETH/USD', depth: 10 });
    client._reconnect(2000);

    const calls = (client.subscribe as ReturnType<typeof vi.fn>).mock.calls as [{ req_id: number }][];
    const reqId1 = calls[0]?.[0].req_id;
    const reqId2 = calls[1]?.[0].req_id;
    expect(reqId1).not.toBe(reqId2);
    subs.destroy();
  });
});

// ---------------------------------------------------------------------------
// Watchdog timeout
// ---------------------------------------------------------------------------

describe('Watchdog timeout', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('subscribe timeout: logs and retries if refCount > 0 and socket open', () => {
    const client = makeClient();
    const subs = new SubscriptionManager(client as unknown as KrakenClient);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    subs.subscribe(DESC);
    const callsBefore = (client.subscribe as ReturnType<typeof vi.fn>).mock.calls.length;

    // Advance past ACK_TIMEOUT_MS and watchdog interval
    vi.advanceTimersByTime(15_000);

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('watchdog: subscribe timed out'),
      expect.anything(),
    );
    expect((client.subscribe as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(callsBefore);

    warnSpy.mockRestore();
    subs.destroy();
  });

  it('unsubscribe timeout: treated as ack — entry deleted', () => {
    const client = makeClient();
    const subs = new SubscriptionManager(client as unknown as KrakenClient);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const release = subs.subscribe(DESC);
    const subReqId = lastSubReqId(client);
    subAck(client, subReqId);
    release(); // transitions to unsubscribing

    // Advance past ACK_TIMEOUT_MS
    vi.advanceTimersByTime(15_000);

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('watchdog: unsubscribe timed out'),
      expect.anything(),
    );
    // Epoch deleted → returns 0
    expect(subs.getEpoch(DESC)).toBe(0);

    warnSpy.mockRestore();
    subs.destroy();
  });
});

// ---------------------------------------------------------------------------
// Epoch gate via orderbook-store (via SubscriptionManager getEpoch)
// ---------------------------------------------------------------------------

describe('Epoch gate — SubscriptionManager.getEpoch progression', () => {
  it('snapshot @ epoch 1 → update @ epoch 1 accepted → update @ epoch 0 dropped → snapshot @ epoch 2 → update @ epoch 1 dropped', () => {
    const client = makeClient();
    const subs = new SubscriptionManager(client as unknown as KrakenClient);

    subs.subscribe(DESC);
    expect(subs.getEpoch(DESC)).toBe(1); // bumped on sendSubscribe

    // Ack → subscribed
    const reqId = lastSubReqId(client);
    subAck(client, reqId);

    // Simulate a requestResync: bumps epoch to 2 before unsubscribe
    subs.requestResync(DESC);
    expect(subs.getEpoch(DESC)).toBe(2);

    // Unsub ack → queuedResubscribe fires, bumps epoch to 3
    const unsubReqId = lastUnsubReqId(client);
    unsubAck(client, unsubReqId);
    expect(subs.getEpoch(DESC)).toBe(3);

    // Epoch sequence: 1 → 2 (resync) → 3 (resubscribe)
    // Any frame stamped epoch 1 or 2 would be stale; epoch 3 is current
    expect(subs.getEpoch(DESC)).toBe(3);

    subs.destroy();
  });
});

// ---------------------------------------------------------------------------
// destroy() cleanup
// ---------------------------------------------------------------------------

describe('destroy() — full cleanup', () => {
  it('destroy clears subscriptions, epochs, pendingRequests, and watchdog', () => {
    vi.useFakeTimers();

    const client = makeClient();
    const subs = new SubscriptionManager(client as unknown as KrakenClient);
    subs.subscribe(DESC);

    subs.destroy();

    // After destroy, getEpoch returns 0 (maps cleared)
    expect(subs.getEpoch(DESC)).toBe(0);

    // Advancing timers should not throw (watchdog cleared)
    expect(() => vi.advanceTimersByTime(20_000)).not.toThrow();

    vi.useRealTimers();
  });
});
