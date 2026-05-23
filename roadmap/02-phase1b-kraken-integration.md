# Phase 1b: Kraken WebSocket Integration

**Goal:** Take the generic `ConnectionManager` from Phase 1a and wrap it in a Kraken-specific layer that handles their message protocol, subscription model, and ping/pong format. Build typed message handling and a subscription manager that prevents duplicate subscriptions.

**Estimated time:** 1–2 days

## Learning Objectives

1. How to model an external API's message shapes using discriminated unions
2. The difference between a "channel subscription" at the protocol level vs. a "subscriber" at the application level (one-to-many fan-out)
3. How to validate untrusted external data at the boundary (defense in depth)
4. Why you should never trust message shapes from a third-party service without runtime validation

## Why This Matters for the Interview

You're going to be asked: *"How do you handle data from an external API in TypeScript?"* The wrong answer is "I cast it with `as`." The right answer involves a validation library, discriminated unions, and a clear boundary where untrusted-becomes-trusted.

## What You're Building

```
ConnectionManager (Phase 1a)
       ↓ raw frames
KrakenClient (this phase)
       ↓ typed, validated messages
SubscriptionManager (this phase)
       ↓ fan-out per channel
[Future: order book store, trades store, etc.]
```

## Step-by-Step Build

### Step 1: Read Kraken's actual WebSocket v2 docs

Don't skip this. Spend 30 minutes minimum. Pay particular attention to:
- The message envelope format (every message has `channel`, `type`, `data`)
- The subscription request/response cycle
- The `book` channel specifically (order book) — the depth options, the snapshot vs. update distinction
- Heartbeats and the system status channel

URL: https://docs.kraken.com/api/docs/websocket-v2/

Take notes. You'll reference them.

### Step 2: Install Zod for runtime validation

```bash
pnpm add zod
```

**Why Zod and not just TypeScript types?** TypeScript types disappear at runtime. If Kraken sends you `{price: "abc"}` instead of `{price: "50000.5"}`, TypeScript can't help — your code will crash three layers deeper with a cryptic error. Zod validates at the boundary so failures are caught early with clear messages.

**Interview drill:** "How do you handle the case where an API sends data that doesn't match your types?" If your answer doesn't include runtime validation, redo this section.

### Step 3: Define Kraken message schemas

Create `src/lib/kraken/schemas.ts`:

```typescript
import { z } from 'zod';

// Envelope shared by all messages
const baseEnvelope = z.object({
  channel: z.string(),
});

// Order book messages — snapshot and update share most fields
const bookEntrySchema = z.object({
  price: z.number(),
  qty: z.number(),
});

const bookDataSchema = z.object({
  symbol: z.string(),
  bids: z.array(bookEntrySchema),
  asks: z.array(bookEntrySchema),
  checksum: z.number(),
  timestamp: z.string().optional(),
});

export const bookSnapshotSchema = z.object({
  channel: z.literal('book'),
  type: z.literal('snapshot'),
  data: z.array(bookDataSchema),
});

export const bookUpdateSchema = z.object({
  channel: z.literal('book'),
  type: z.literal('update'),
  data: z.array(bookDataSchema),
});

// Status / heartbeat / pong
export const heartbeatSchema = z.object({
  channel: z.literal('heartbeat'),
});

export const pongSchema = z.object({
  method: z.literal('pong'),
  req_id: z.number().optional(),
});

export const statusSchema = z.object({
  channel: z.literal('status'),
  data: z.array(z.object({
    system: z.string(),
    version: z.string(),
  })),
});

// Subscribe acknowledgment
export const subscribeAckSchema = z.object({
  method: z.literal('subscribe'),
  result: z.object({
    channel: z.string(),
    symbol: z.string().optional(),
  }).passthrough(),
  success: z.boolean(),
  time_in: z.string(),
  time_out: z.string(),
});

// Discriminated union of all messages we care about
export const krakenMessageSchema = z.union([
  bookSnapshotSchema,
  bookUpdateSchema,
  heartbeatSchema,
  pongSchema,
  statusSchema,
  subscribeAckSchema,
]);

export type KrakenMessage = z.infer<typeof krakenMessageSchema>;
export type BookSnapshot = z.infer<typeof bookSnapshotSchema>;
export type BookUpdate = z.infer<typeof bookUpdateSchema>;
```

**Why `z.infer` for types?** Single source of truth: the schema defines runtime *and* compile-time types. You'll never have them drift apart.

**Note on Kraken's actual format:** The above is a simplified version. Their actual schemas have a few more fields (timestamp formats, side indicators on some channels). Read their docs and adjust. The point of this exercise is the *pattern*, not memorizing their API.

### Step 4: Build the Kraken client

Create `src/lib/kraken/client.ts`:

```typescript
import { ConnectionManager } from '../ws/connection-manager';
import { krakenMessageSchema, type KrakenMessage } from './schemas';

type MessageHandler<T extends KrakenMessage = KrakenMessage> = (msg: T) => void;

export class KrakenClient {
  private connection: ConnectionManager;
  private handlers = new Set<MessageHandler>();
  private lastPongAt = 0;

  constructor() {
    this.connection = new ConnectionManager({
      url: 'wss://ws.kraken.com/v2',
      maxReconnectAttempts: 20,
      initialReconnectDelayMs: 1000,
      maxReconnectDelayMs: 30000,
      heartbeatIntervalMs: 30000,
      outboundBufferSize: 100,
    });
    this.connection.onRawMessage(this.handleRawMessage);
  }

  connect(): void {
    this.connection.connect();
  }

  disconnect(): void {
    this.connection.disconnect();
  }

  private handleRawMessage = (raw: string): void => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      console.warn('Kraken: non-JSON frame', raw);
      return;
    }

    const result = krakenMessageSchema.safeParse(parsed);
    if (!result.success) {
      // This is a real production concern: log but don't crash.
      // Unknown messages may be new fields Kraken added; don't break on them.
      console.debug('Kraken: unknown message shape', parsed, result.error);
      return;
    }

    const msg = result.data;
    if (msg.channel === undefined && 'method' in msg && msg.method === 'pong') {
      this.lastPongAt = Date.now();
    }

    this.handlers.forEach((h) => h(msg));
  };

  onMessage(handler: MessageHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  ping(): void {
    this.connection.send({ method: 'ping', req_id: Date.now() });
  }

  subscribe(params: { channel: string; symbol?: string[]; depth?: number }): void {
    this.connection.send({
      method: 'subscribe',
      params,
    });
  }

  unsubscribe(params: { channel: string; symbol?: string[] }): void {
    this.connection.send({
      method: 'unsubscribe',
      params,
    });
  }
}
```

**Design note:** Notice the `safeParse` + `console.debug` for unknown messages. In production you'd send these to an error tracker (Sentry) so you find out when Kraken changes their API before your users do. Mention this in the interview.

### Step 5: The subscription manager (the interesting part)

Multiple components in your app may want order book data for BTC/USD. You don't want to open three socket subscriptions. You want one subscription, fanned out to many subscribers.

Create `src/lib/kraken/subscription-manager.ts`:

```typescript
import { KrakenClient } from './client';

type ChannelKey = string; // e.g., "book:BTC/USD:10"

interface ChannelDescriptor {
  channel: string;
  symbol: string;
  depth?: number;
}

function keyOf(d: ChannelDescriptor): ChannelKey {
  return `${d.channel}:${d.symbol}:${d.depth ?? 'default'}`;
}

interface Subscription {
  descriptor: ChannelDescriptor;
  subscriberCount: number;
  state: 'subscribing' | 'subscribed' | 'unsubscribing';
}

export class SubscriptionManager {
  private subscriptions = new Map<ChannelKey, Subscription>();

  constructor(private client: KrakenClient) {}

  subscribe(descriptor: ChannelDescriptor): () => void {
    const key = keyOf(descriptor);
    const existing = this.subscriptions.get(key);

    if (existing) {
      existing.subscriberCount += 1;
    } else {
      this.subscriptions.set(key, {
        descriptor,
        subscriberCount: 1,
        state: 'subscribing',
      });
      this.client.subscribe({
        channel: descriptor.channel,
        symbol: [descriptor.symbol],
        depth: descriptor.depth,
      });
    }

    // Return an unsubscribe function for the caller
    return () => this.releaseSubscription(key);
  }

  private releaseSubscription(key: ChannelKey): void {
    const sub = this.subscriptions.get(key);
    if (!sub) return;
    sub.subscriberCount -= 1;
    if (sub.subscriberCount <= 0) {
      sub.state = 'unsubscribing';
      this.client.unsubscribe({
        channel: sub.descriptor.channel,
        symbol: [sub.descriptor.symbol],
      });
      this.subscriptions.delete(key);
    }
  }

  // After a reconnect, all server-side subscriptions are gone. Re-subscribe.
  resubscribeAll(): void {
    for (const sub of this.subscriptions.values()) {
      this.client.subscribe({
        channel: sub.descriptor.channel,
        symbol: [sub.descriptor.symbol],
        depth: sub.descriptor.depth,
      });
    }
  }
}
```

**This is the centerpiece concept of this phase.** Reference counting subscriptions. The first subscriber opens the channel; the last subscriber closes it. In the interview, draw this on a whiteboard.

**Interview drill:** "Two components both want BTC/USD order book data. One mounts, then the other, then the first unmounts. What happens?" You should trace through the reference counts.

### Step 6: Handle resubscription on reconnect

After a reconnect, Kraken doesn't remember what you were subscribed to — that state lived on the connection. You need to resubscribe.

Add to `ConnectionManager`'s `onOpen` handler a callback hook, and call `subscriptionManager.resubscribeAll()` when it fires. Or, more cleanly, have the `SubscriptionManager` listen to the connection state:

```typescript
constructor(private client: KrakenClient) {
  this.client.onConnectionStateChange((state) => {
    if (state.status === 'open' && state.since > this.lastOpenAt) {
      // This is a fresh connection (or reconnect)
      this.resubscribeAll();
    }
    this.lastOpenAt = state.status === 'open' ? state.since : this.lastOpenAt;
  });
}
```

**Interview gotcha:** "What if a snapshot arrives for a channel you've already unsubscribed from?" (It can happen if unsubscribe is in-flight.) Answer: filter at the consumer level by checking the descriptor key.

### Step 7: Singleton instance + React hooks

Create `src/lib/kraken/index.ts`:

```typescript
import { KrakenClient } from './client';
import { SubscriptionManager } from './subscription-manager';

let _client: KrakenClient | null = null;
let _subs: SubscriptionManager | null = null;

export function getKrakenClient(): KrakenClient {
  if (!_client) {
    _client = new KrakenClient();
    _client.connect();
  }
  return _client;
}

export function getSubscriptionManager(): SubscriptionManager {
  if (!_subs) {
    _subs = new SubscriptionManager(getKrakenClient());
  }
  return _subs;
}
```

And a hook for components:

```typescript
// src/lib/kraken/use-channel.ts
import { useEffect } from 'react';
import { getSubscriptionManager } from '.';

export function useChannelSubscription(
  channel: string,
  symbol: string,
  depth?: number
): void {
  useEffect(() => {
    const unsubscribe = getSubscriptionManager().subscribe({ channel, symbol, depth });
    return unsubscribe;
  }, [channel, symbol, depth]);
}
```

**Why split `subscribe` (interest) from `useMessages` (data)?** Separation of concerns. Declaring "I want BTC/USD book data" is independent of "show me the latest message." This matters in Phase 2 when we add stores.

## Common Mistakes

1. **Subscribing in render** — Must be in `useEffect`. Otherwise you'll subscribe on every render, leak subscriptions, and crash the app under load.
2. **Forgetting the cleanup function** — Without returning the unsubscribe from `useEffect`, you leak.
3. **Re-running the effect on every parent re-render** — Make sure your dependency array is stable. Strings and primitives are fine; objects/arrays need `useMemo`.
4. **Trusting `safeParse` to never reject in production** — Log rejections. Set up an alert if rejection rate spikes (signals Kraken changed something).
5. **Subscribing to `book` for BTC/USD twice expecting two callbacks** — The subscription manager dedupes; that's the whole point. Use the message handler to fan out to subscribers.

## Verification Checklist

- [ ] Connect to Kraken, subscribe to `book` for `BTC/USD`, watch raw JSON arrive in the console
- [ ] Disconnect your wifi, wait, reconnect — you should see "reconnecting" state and then fresh subscriptions confirmed
- [ ] Mount two components both wanting BTC/USD; only one `subscribe` message is sent over the wire (check Network → WS tab)
- [ ] Unmount both; one `unsubscribe` message is sent
- [ ] Send a malformed message via DevTools console (force one through your handler) — your app should log a warning, not crash

## Interview Drill Questions

1. Walk me through what happens when two components both want the same data.
2. How do you know Kraken's messages match the shapes your code expects?
3. What happens after a reconnect? How does the app recover?
4. What's the failure mode if Kraken adds a new field to their book message?
5. What's the failure mode if Kraken *removes* a field?
6. Why discriminated unions for messages instead of `if (msg.channel === 'book')` everywhere?
7. How would you debug a report that "the order book stopped updating but the connection looks fine"?
8. If you had to add a second WebSocket connection (e.g., Kraken's private channels for authenticated user data), what would change?

## Bonus: Authenticated channels (skip for first pass)

Kraken's private channels (your balances, your orders) require auth tokens. You don't need to implement this for the interview prep, but be ready to discuss how you would:
- Fetch a token from their REST API
- Pass it in the subscribe message
- Handle token expiry (re-fetch and re-subscribe)
- Never log the token

Once you have a stable Kraken WS connection with deduplicated subscriptions, move to `03-phase2a-orderbook-data.md`.
