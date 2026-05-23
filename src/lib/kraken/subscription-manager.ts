import type { KrakenMessage } from './schemas';
import type { KrakenClient } from './client';

type ChannelKey = string;

interface ChannelDescriptor {
  channel: string;
  symbol: string;
  depth?: number;
}

type SubscriptionPhase = 'subscribing' | 'subscribed' | 'unsubscribing';

interface ManagedSubscription {
  descriptor: ChannelDescriptor;
  refCount: number;
  phase: SubscriptionPhase;
}

function keyOf(d: ChannelDescriptor): ChannelKey {
  return `${d.channel}:${d.symbol}:${d.depth ?? 'default'}`;
}

export class SubscriptionManager {
  private readonly subscriptions = new Map<ChannelKey, ManagedSubscription>();
  private lastOpenAt = 0;

  constructor(private readonly client: KrakenClient) {
    this.client.onConnectionStateChange((state) => {
      if (state.status === 'open' && state.since > this.lastOpenAt) {
        this.lastOpenAt = state.since;
        this.resubscribeAll();
      }
    });

    this.client.onMessage((msg: KrakenMessage) => {
      if (!('method' in msg)) return;

      if (msg.method === 'subscribe') {
        if (msg.success) {
          for (const [, sub] of this.subscriptions) {
            if (
              sub.descriptor.channel === msg.result.channel &&
              sub.descriptor.symbol === msg.result.symbol
            ) {
              sub.phase = 'subscribed';
              break;
            }
          }
        } else {
          console.warn('[SubscriptionManager] subscribe ack failure', msg.error);
        }
        return;
      }

      if (msg.method === 'unsubscribe') {
        if (!msg.success) {
          console.warn('[SubscriptionManager] unsubscribe ack failure', msg.error);
        }
      }
    });
  }

  subscribe(descriptor: ChannelDescriptor): () => void {
    const key = keyOf(descriptor);
    const existing = this.subscriptions.get(key);

    if (existing !== undefined) {
      existing.refCount += 1;
      return () => this.releaseSubscription(key);
    }

    this.subscriptions.set(key, {
      descriptor,
      refCount: 1,
      phase: 'subscribing',
    });

    if (this.client.getConnectionState().status === 'open') {
      this.client.subscribe({
        channel: descriptor.channel,
        symbol: [descriptor.symbol],
        ...(descriptor.depth !== undefined ? { depth: descriptor.depth } : {}),
      });
    }

    return () => this.releaseSubscription(key);
  }

  private releaseSubscription(key: ChannelKey): void {
    const entry = this.subscriptions.get(key);
    if (entry === undefined) return;

    entry.refCount -= 1;

    if (entry.refCount > 0) return;

    entry.phase = 'unsubscribing';

    if (this.client.getConnectionState().status === 'open') {
      this.client.unsubscribe({
        channel: entry.descriptor.channel,
        symbol: [entry.descriptor.symbol],
      });
    }

    this.subscriptions.delete(key);
  }

  // One batched subscribe frame per (channel, depth) group avoids sending N
  // individual frames when resubscribing after a reconnect.
  resubscribeAll(): void {
    type GroupKey = string;
    const groups = new Map<GroupKey, { channel: string; depth?: number; symbols: string[] }>();

    for (const [, sub] of this.subscriptions) {
      const { channel, symbol, depth } = sub.descriptor;
      const groupKey: GroupKey = `${channel}:${depth ?? 'default'}`;
      const existing = groups.get(groupKey);

      if (existing !== undefined) {
        existing.symbols.push(symbol);
      } else {
        groups.set(groupKey, {
          channel,
          ...(depth !== undefined ? { depth } : {}),
          symbols: [symbol],
        });
      }

      sub.phase = 'subscribing';
    }

    for (const [, group] of groups) {
      this.client.subscribe({
        channel: group.channel,
        symbol: group.symbols,
        ...(group.depth !== undefined ? { depth: group.depth } : {}),
      });
    }
  }
}
