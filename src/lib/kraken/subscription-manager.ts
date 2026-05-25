import type { KrakenMessage } from './schemas';
import type { KrakenClient } from './client';

type ChannelKey = string;
type ReqId = number;

interface ChannelDescriptor {
  channel: string;
  symbol: string;
  depth?: number;
  interval?: number;
}

// H4: discriminated Phase state machine — entry lifecycle is explicit per variant.
// Entries are never deleted at release-time; deletion happens only after unsub-ack
// with no queued resubscribe, or on idle-release.
type Phase =
  | { kind: 'subscribing'; pendingReqId: ReqId; releasePending?: boolean }
  | { kind: 'subscribed'; activeReqId: ReqId }
  | { kind: 'unsubscribing'; pendingReqId: ReqId; queuedResubscribe: boolean }
  | { kind: 'idle' };

// Error-ack handling: entries with a failed attempt carry lastError so UI can surface it.
interface ManagedSubscription {
  descriptor: ChannelDescriptor;
  refCount: number;
  phase: Phase;
  retryCount: number;
  lastError?: string;
  status?: 'failed';
}

function keyOf(d: ChannelDescriptor): ChannelKey {
  return `${d.channel}:${d.symbol}:${d.depth ?? 'default'}:${d.interval ?? 'default'}`;
}

// H3: watchdog timeout for pending ack entries.
const ACK_TIMEOUT_MS = 10_000;
const WATCHDOG_INTERVAL_MS = 5_000;

export class SubscriptionManager {
  private readonly subscriptions = new Map<ChannelKey, ManagedSubscription>();

  // H3: monotonic counter; every outbound subscribe/unsubscribe gets a fresh id.
  private nextReqId = 1;

  // H3: pending requests indexed by req_id for O(1) ack lookup.
  private readonly pendingRequests = new Map<ReqId, { reqId: ReqId; op: 'subscribe' | 'unsubscribe'; key: ChannelKey; sentAt: number }>();

  // H5: per-key monotonic epoch owned by this manager.
  private readonly epochs = new Map<ChannelKey, number>();

  private lastOpenAt = 0;
  private watchdogTimer: ReturnType<typeof setInterval> | null = null;
  private readonly unsubscribeStateChange: () => void;
  private readonly unsubscribeMessage: () => void;

  constructor(private readonly client: KrakenClient) {
    this.unsubscribeStateChange = this.client.onConnectionStateChange((state) => {
      if (state.status === 'open' && state.since > this.lastOpenAt) {
        this.lastOpenAt = state.since;
        this.resubscribeAll();
      } else if (state.status !== 'open') {
        // H3: wipe pending requests on any non-open transition. Late acks from the
        // dead socket won't match the wiped registry and will be safely ignored.
        // Preserve refCount and descriptor so resubscribeAll can replay on reconnect.
        this.wipePendingOnDisconnect();
      }
    });

    this.unsubscribeMessage = this.client.onMessage((msg: KrakenMessage) => {
      if (!('method' in msg)) return;

      if (msg.method === 'subscribe') {
        const reqId = msg.req_id;
        if (!msg.success) {
          console.warn('[SubscriptionManager] subscribe ack failure', msg.error, { reqId });
          if (reqId !== undefined) {
            this.handleSubAckFailure(reqId);
          }
          return;
        }
        if (reqId === undefined) {
          // Kraken may occasionally omit req_id on reconnect acks; fall through gracefully.
          return;
        }
        this.handleSubAck(reqId);
        return;
      }

      if (msg.method === 'unsubscribe') {
        const reqId = msg.req_id;
        if (!msg.success) {
          console.warn('[SubscriptionManager] unsubscribe ack failure', msg.error, { reqId });
          if (reqId !== undefined) {
            this.handleUnsubAckFailure(reqId);
          }
          return;
        }
        if (reqId === undefined) {
          return;
        }
        this.handleUnsubAck(reqId);
      }
    });

    this.startWatchdog();
  }

  destroy(): void {
    this.unsubscribeStateChange();
    this.unsubscribeMessage();
    this.stopWatchdog();
    this.subscriptions.clear();
    this.epochs.clear();
    this.pendingRequests.clear();
  }

  // H5: read-only epoch accessor — called by consumers (e.g. OrderBookProvider)
  // synchronously at message-parse time to stamp incoming frames.
  getEpoch(descriptor: ChannelDescriptor): number {
    return this.epochs.get(keyOf(descriptor)) ?? 0;
  }

  subscribe(descriptor: ChannelDescriptor): () => void {
    const key = keyOf(descriptor);
    const existing = this.subscriptions.get(key);

    if (existing !== undefined) {
      const { phase } = existing;
      // Any active phase: bump refCount only, no new wire frame.
      if (phase.kind === 'subscribed') {
        existing.refCount += 1;
        return () => this.releaseSubscription(key);
      }
      if (phase.kind === 'subscribing') {
        existing.refCount += 1;
        // H4: clear releasePending — a new subscriber arrived before sub-ack;
        // the sub-ack handler must not fire unsubscribe despite refCount now > 0.
        phase.releasePending = false;
        return () => this.releaseSubscription(key);
      }
      // Unsubscribing: bump refCount AND signal intent to resubscribe after ack.
      if (phase.kind === 'unsubscribing') {
        existing.refCount += 1;
        phase.queuedResubscribe = true;
        return () => this.releaseSubscription(key);
      }
    }

    this.subscriptions.set(key, {
      descriptor,
      refCount: 1,
      phase: { kind: 'idle' },
      retryCount: 0,
    });

    if (this.client.getConnectionState().status === 'open') {
      this.sendSubscribe(key, descriptor);
    }

    return () => this.releaseSubscription(key);
  }

  private releaseSubscription(key: ChannelKey): void {
    const entry = this.subscriptions.get(key);
    if (entry === undefined) return;

    entry.refCount -= 1;
    if (entry.refCount > 0) return;

    const { phase, descriptor } = entry;

    if (phase.kind === 'subscribed') {
      this.sendUnsubscribe(key, descriptor, false);
      return;
    }

    if (phase.kind === 'subscribing') {
      // Cannot send unsubscribe yet — wait for sub-ack, then immediately unsub.
      phase.releasePending = true;
      return;
    }

    if (phase.kind === 'unsubscribing') {
      // Already heading out; ensure queuedResubscribe is false (it should be if
      // refCount just hit 0), no-op otherwise.
      phase.queuedResubscribe = false;
      return;
    }

    // idle — nothing was ever sent; just delete.
    this.subscriptions.delete(key);
  }

  // H5: bump epoch before sending the subscribe wire frame.
  private sendSubscribe(key: ChannelKey, descriptor: ChannelDescriptor): ReqId {
    this.bumpEpoch(key);
    const reqId = this.nextReqId++;
    const entry = this.subscriptions.get(key);
    if (entry !== undefined) {
      entry.phase = { kind: 'subscribing', pendingReqId: reqId };
    }
    this.pendingRequests.set(reqId, { reqId, op: 'subscribe', key, sentAt: Date.now() });
    this.client.subscribe({
      channel: descriptor.channel,
      symbol: [descriptor.symbol],
      ...(descriptor.depth !== undefined ? { depth: descriptor.depth } : {}),
      ...(descriptor.interval !== undefined ? { interval: descriptor.interval } : {}),
      req_id: reqId,
    });
    return reqId;
  }

  private sendUnsubscribe(key: ChannelKey, descriptor: ChannelDescriptor, queuedResubscribe: boolean): ReqId {
    const reqId = this.nextReqId++;
    const entry = this.subscriptions.get(key);
    if (entry !== undefined) {
      entry.phase = { kind: 'unsubscribing', pendingReqId: reqId, queuedResubscribe };
    }
    this.pendingRequests.set(reqId, { reqId, op: 'unsubscribe', key, sentAt: Date.now() });
    this.client.unsubscribe({
      channel: descriptor.channel,
      symbol: [descriptor.symbol],
      req_id: reqId,
    });
    return reqId;
  }

  private handleSubAck(reqId: ReqId): void {
    const pending = this.pendingRequests.get(reqId);
    if (pending === undefined) return;
    this.pendingRequests.delete(reqId);

    const entry = this.subscriptions.get(pending.key);
    if (entry === undefined) return;

    const { phase } = entry;
    if (phase.kind !== 'subscribing') return;

    // Clear retry state on success.
    entry.retryCount = 0;
    delete entry.lastError;
    delete entry.status;

    if (phase.releasePending) {
      // Subscription was released before ack — immediately send unsubscribe.
      this.sendUnsubscribe(pending.key, entry.descriptor, false);
      return;
    }

    entry.phase = { kind: 'subscribed', activeReqId: reqId };
  }

  private handleSubAckFailure(reqId: ReqId): void {
    const pending = this.pendingRequests.get(reqId);
    if (pending === undefined) return;
    this.pendingRequests.delete(reqId);

    const entry = this.subscriptions.get(pending.key);
    if (entry === undefined) return;

    if (entry.retryCount === 0) {
      console.warn('[SubscriptionManager] subscribe failed, retrying once', { key: pending.key });
      entry.retryCount = 1;
      // Transition to idle so sendSubscribe sets phase to subscribing cleanly.
      entry.phase = { kind: 'idle' };
      if (this.client.getConnectionState().status === 'open') {
        this.sendSubscribe(pending.key, entry.descriptor);
      }
    } else {
      console.warn('[SubscriptionManager] subscribe retry also failed — marking failed', { key: pending.key });
      entry.phase = { kind: 'idle' };
      entry.status = 'failed';
      entry.lastError = 'subscribe ack returned success=false on retry';
    }
  }

  private handleUnsubAck(reqId: ReqId): void {
    const pending = this.pendingRequests.get(reqId);
    if (pending === undefined) return;
    this.pendingRequests.delete(reqId);

    const entry = this.subscriptions.get(pending.key);
    if (entry === undefined) return;

    const { phase } = entry;
    if (phase.kind !== 'unsubscribing') return;

    if (phase.queuedResubscribe) {
      this.sendSubscribe(pending.key, entry.descriptor);
      return;
    }

    this.subscriptions.delete(pending.key);
    this.epochs.delete(pending.key);
  }

  private handleUnsubAckFailure(reqId: ReqId): void {
    const pending = this.pendingRequests.get(reqId);
    if (pending === undefined) return;
    this.pendingRequests.delete(reqId);

    const entry = this.subscriptions.get(pending.key);
    if (entry === undefined) return;

    const { phase } = entry;
    if (phase.kind !== 'unsubscribing') return;

    if (entry.retryCount === 0) {
      console.warn('[SubscriptionManager] unsubscribe failed, retrying once', { key: pending.key });
      entry.retryCount = 1;
      entry.phase = { kind: 'subscribed', activeReqId: pending.reqId };
      if (this.client.getConnectionState().status === 'open') {
        this.sendUnsubscribe(pending.key, entry.descriptor, phase.queuedResubscribe);
      }
    } else {
      console.warn('[SubscriptionManager] unsubscribe retry also failed — marking failed', { key: pending.key });
      entry.phase = { kind: 'idle' };
      entry.status = 'failed';
      entry.lastError = 'unsubscribe ack returned success=false on retry';
    }
  }

  // H5: requestResync replaces forceResync. Epoch is bumped BEFORE the wire
  // unsubscribe frame so any delta arriving after the bump is stamped with the
  // old epoch and will be dropped by the store.
  requestResync(descriptor: ChannelDescriptor): void {
    if (this.client.getConnectionState().status !== 'open') return;
    const key = keyOf(descriptor);
    const entry = this.subscriptions.get(key);
    if (entry === undefined) return;

    const { phase } = entry;
    if (phase.kind !== 'subscribed') return;

    // Bump epoch first — any in-flight delta after this point carries stale epoch.
    this.bumpEpoch(key);

    // Route through unsubscribing → queuedResubscribe path so the sub-ack
    // handler fires the resubscribe (which will bump epoch again for the new sub).
    this.sendUnsubscribe(key, descriptor, true);
  }

  // H3 reconnect: one subscribe frame PER SYMBOL — one req_id ↔ one phase entry.
  // Fixes the "only first key in batch ever advances" bug from the prior batched approach.
  // sendSubscribe already bumps the epoch; no pre-bump needed here.
  resubscribeAll(): void {
    for (const [key, sub] of this.subscriptions) {
      sub.phase = { kind: 'idle' };
      this.sendSubscribe(key, sub.descriptor);
    }
  }

  // H3: wipe pending requests on disconnect. Preserve refCount + descriptor for resubscribeAll.
  private wipePendingOnDisconnect(): void {
    this.pendingRequests.clear();
    for (const [, entry] of this.subscriptions) {
      entry.phase = { kind: 'idle' };
    }
  }

  // H3: watchdog — scan pendingRequests every 5s for entries older than ACK_TIMEOUT_MS.
  private startWatchdog(): void {
    this.watchdogTimer = setInterval(() => {
      const now = Date.now();
      for (const [reqId, pending] of this.pendingRequests) {
        if (now - pending.sentAt < ACK_TIMEOUT_MS) continue;

        const entry = this.subscriptions.get(pending.key);
        this.pendingRequests.delete(reqId);

        if (pending.op === 'subscribe') {
          console.warn('[SubscriptionManager] watchdog: subscribe timed out', { key: pending.key, reqId });
          if (entry !== undefined) {
            entry.phase = { kind: 'idle' };
            if (entry.refCount > 0 && this.client.getConnectionState().status === 'open') {
              this.sendSubscribe(pending.key, entry.descriptor);
            }
          }
        } else {
          // unsubscribe timeout: treat as ack
          console.warn('[SubscriptionManager] watchdog: unsubscribe timed out, treating as ack', { key: pending.key, reqId });
          if (entry !== undefined) {
            const { phase } = entry;
            if (phase.kind === 'unsubscribing' && phase.queuedResubscribe) {
              entry.phase = { kind: 'idle' };
              this.sendSubscribe(pending.key, entry.descriptor);
            } else {
              this.subscriptions.delete(pending.key);
              this.epochs.delete(pending.key);
            }
          }
        }
      }
    }, WATCHDOG_INTERVAL_MS);
  }

  private stopWatchdog(): void {
    if (this.watchdogTimer !== null) {
      clearInterval(this.watchdogTimer);
      this.watchdogTimer = null;
    }
  }

  private bumpEpoch(key: ChannelKey): void {
    this.epochs.set(key, (this.epochs.get(key) ?? 0) + 1);
  }
}
