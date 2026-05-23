# Phase 1a: WebSocket Connection Fundamentals

**Goal:** Build a robust, typed WebSocket connection manager that survives network failures and provides a clean API for the rest of the app. No Kraken-specific code yet — that's Phase 1b. We're building the plumbing.

**Estimated time:** 1 day

## Learning Objectives

By the end of this phase, you should be able to answer (out loud, without notes):

1. What's the difference between a WebSocket and a regular HTTP request? When is each appropriate?
2. What's the full lifecycle of a WebSocket connection? (connecting → open → message/error → closing → closed)
3. What is exponential backoff and why is it preferred over fixed retry intervals?
4. What's the difference between a clean and an unclean close? How do you detect each?
5. Why might a WebSocket "look connected" but actually be dead? (Answer involves TCP keepalive, intermediate proxies, mobile network handoffs.)

If any of these are fuzzy, read the MDN WebSocket page and the RFC 6455 intro section before continuing.

## Why This Matters for the Interview

Kraken's job description explicitly calls out: *"real-time streaming data (e.g. via WebSockets) — such as order books, live P&L, or dashboards, where rendering performance and data accuracy were critical."*

If you can confidently explain how you handle a dropped connection during a market spike — when reconnecting fast and not losing data matters most — you've already separated yourself from candidates who treat WebSockets as a black box.

## What You're Building

A `ConnectionManager` class (or hook — we'll discuss the trade-off) with this contract:

```typescript
interface ConnectionManager {
  connect(): void;
  disconnect(): void;
  send(payload: unknown): void;
  subscribe<T>(predicate: (msg: unknown) => msg is T, handler: (msg: T) => void): () => void;
  readonly state: ConnectionState; // 'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed'
}
```

It must handle:
- Automatic reconnection with exponential backoff (cap at 30 seconds)
- A heartbeat/ping mechanism to detect dead connections
- Buffering of outbound messages while disconnected (with a max buffer size)
- Clean teardown on unmount (no leaked listeners)

## Step-by-Step Build

### Step 1: Type the connection states

Create `src/lib/ws/types.ts`:

```typescript
export type ConnectionState =
  | { status: 'idle' }
  | { status: 'connecting'; attempt: number }
  | { status: 'open'; since: number }
  | { status: 'reconnecting'; attempt: number; nextRetryAt: number }
  | { status: 'closed'; reason: string };
```

**Why a discriminated union, not just a string?** Because `'reconnecting'` carries data (which attempt? when?) that `'open'` doesn't. The compiler will force you to handle each case correctly. This is a small example of a pattern you'll use everywhere in TypeScript-heavy frontends.

**Interview drill:** "Why is `type State = 'idle' | 'open' | ...` worse than the discriminated union above?" Be able to answer in two sentences.

### Step 2: Build the connection manager skeleton

Create `src/lib/ws/connection-manager.ts`:

```typescript
import type { ConnectionState } from './types';

type StateListener = (state: ConnectionState) => void;
type MessageListener = (data: unknown) => void;

export interface ConnectionManagerOptions {
  url: string;
  maxReconnectAttempts?: number;
  initialReconnectDelayMs?: number;
  maxReconnectDelayMs?: number;
  heartbeatIntervalMs?: number;
  outboundBufferSize?: number;
}

export class ConnectionManager {
  private socket: WebSocket | null = null;
  private state: ConnectionState = { status: 'idle' };
  private stateListeners = new Set<StateListener>();
  private messageListeners = new Set<MessageListener>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private outboundBuffer: string[] = [];
  private intentionallyClosed = false;

  constructor(private readonly opts: Required<ConnectionManagerOptions>) {}

  // ... methods below
}
```

**Why a class, not a hook?** A class is testable in isolation (no React renderer needed), reusable outside React, and easier to reason about for long-lived state. You'll wrap it in a hook later for component consumption. Senior engineers separate domain logic from framework code.

**Interview drill:** "Why didn't you put this in a `useEffect`?" Answer: lifecycle of a connection is decoupled from any one component's lifecycle. Multiple components subscribe; the connection persists.

### Step 3: Implement connection logic

Add these methods:

```typescript
connect(): void {
  if (this.socket && this.socket.readyState !== WebSocket.CLOSED) return;
  this.intentionallyClosed = false;
  this.setState({ status: 'connecting', attempt: this.getAttemptCount() + 1 });

  this.socket = new WebSocket(this.opts.url);
  this.socket.addEventListener('open', this.onOpen);
  this.socket.addEventListener('message', this.onMessage);
  this.socket.addEventListener('error', this.onError);
  this.socket.addEventListener('close', this.onClose);
}

private onOpen = (): void => {
  this.setState({ status: 'open', since: Date.now() });
  this.flushOutboundBuffer();
  this.startHeartbeat();
};

private onClose = (event: CloseEvent): void => {
  this.stopHeartbeat();
  this.socket = null;

  if (this.intentionallyClosed) {
    this.setState({ status: 'closed', reason: 'intentional' });
    return;
  }
  this.scheduleReconnect();
};
```

**Critical detail: arrow functions vs methods for event handlers.** If you write `this.socket.addEventListener('open', this.onOpen)` with `onOpen` as a regular method, `this` inside the handler will be the socket, not your manager. Arrow-function class properties bind `this` lexically. This is a classic interview gotcha.

### Step 4: Exponential backoff

```typescript
private scheduleReconnect(): void {
  const attempt = this.getAttemptCount() + 1;
  if (attempt > this.opts.maxReconnectAttempts) {
    this.setState({ status: 'closed', reason: 'max-attempts-exceeded' });
    return;
  }

  // Exponential: 1s, 2s, 4s, 8s, ... capped at maxReconnectDelayMs
  // Plus jitter (random 0-25% of delay) to avoid thundering herd
  const baseDelay = Math.min(
    this.opts.initialReconnectDelayMs * 2 ** (attempt - 1),
    this.opts.maxReconnectDelayMs
  );
  const jitter = baseDelay * 0.25 * Math.random();
  const delay = baseDelay + jitter;

  this.setState({
    status: 'reconnecting',
    attempt,
    nextRetryAt: Date.now() + delay,
  });

  this.reconnectTimer = setTimeout(() => this.connect(), delay);
}

private getAttemptCount(): number {
  if (this.state.status === 'reconnecting' || this.state.status === 'connecting') {
    return this.state.attempt;
  }
  return 0;
}
```

**Why jitter?** If 10,000 clients all disconnect at once (e.g., Kraken's WS server restarts) and all retry on the same schedule, they'll DDoS the server when it comes back up. Jitter spreads the load. This is called the "thundering herd" problem — say that name in the interview.

**Interview drill:** "What's the maximum delay your code will produce? Walk me through it." You should be able to recite the formula and the cap.

### Step 5: Heartbeat (the trickiest part)

A WebSocket can appear "open" while the underlying TCP connection is dead — e.g., the user's laptop went to sleep, or a corporate proxy silently dropped the connection. The browser doesn't tell you. You only find out when you try to send and it fails (sometimes minutes later).

The fix: send a periodic ping and require a pong within a timeout. If no pong, force-close and reconnect.

```typescript
private startHeartbeat(): void {
  this.stopHeartbeat();
  this.heartbeatTimer = setInterval(() => {
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    // Kraken-specific ping format goes in Phase 1b. For now, just send a marker.
    this.send({ method: 'ping' });
    // Set a timeout — if we don't get a pong by then, kill the connection.
    setTimeout(() => {
      if (!this.lastPongReceivedRecently()) {
        this.socket?.close(4000, 'heartbeat-timeout');
      }
    }, this.opts.heartbeatIntervalMs / 2);
  }, this.opts.heartbeatIntervalMs);
}
```

You'll wire up `lastPongReceivedRecently()` in Phase 1b, since the pong format is protocol-specific.

**Interview drill:** "How do you detect a dead WebSocket?" The answer "I rely on the close event" is wrong and a senior engineer will catch it. The correct answer involves application-level heartbeats.

### Step 6: Outbound buffer

```typescript
send(payload: unknown): void {
  const serialized = JSON.stringify(payload);
  if (this.socket?.readyState === WebSocket.OPEN) {
    this.socket.send(serialized);
    return;
  }
  if (this.outboundBuffer.length >= this.opts.outboundBufferSize) {
    this.outboundBuffer.shift(); // drop oldest
  }
  this.outboundBuffer.push(serialized);
}

private flushOutboundBuffer(): void {
  while (this.outboundBuffer.length > 0 && this.socket?.readyState === WebSocket.OPEN) {
    const msg = this.outboundBuffer.shift()!;
    this.socket.send(msg);
  }
}
```

**Design decision to defend:** Should you buffer at all? For Kraken specifically — buffering a *subscribe* message during a reconnect is fine and useful. Buffering an *order placement* would be dangerous (you might place an unwanted order seconds after the user's intent). For this exercise, buffer everything but document the limitation.

### Step 7: React hook wrapper

Create `src/lib/ws/use-connection.ts`:

```typescript
import { useEffect, useSyncExternalStore } from 'react';
import { ConnectionManager } from './connection-manager';

// A module-level singleton so all components share one socket
let manager: ConnectionManager | null = null;

function getManager(): ConnectionManager {
  if (!manager) {
    manager = new ConnectionManager({
      url: 'wss://ws.kraken.com/v2',
      maxReconnectAttempts: 20,
      initialReconnectDelayMs: 1000,
      maxReconnectDelayMs: 30000,
      heartbeatIntervalMs: 30000,
      outboundBufferSize: 100,
    });
  }
  return manager;
}

export function useConnectionState() {
  return useSyncExternalStore(
    (cb) => getManager().subscribeToState(cb),
    () => getManager().getState(),
    () => ({ status: 'idle' as const })  // server snapshot for SSR
  );
}
```

**Why `useSyncExternalStore`?** Because state lives outside React (in your manager). This hook is specifically designed for that case and handles tearing during concurrent rendering. Using `useState` + a manual subscription has subtle bugs with React 18's concurrent features.

**Interview drill:** "Why `useSyncExternalStore` instead of `useState` with a listener?" This is a strong signal of React 18 fluency.

## Common Mistakes

1. **Forgetting to remove event listeners** — Each reconnect attaches new listeners. After 10 reconnects, every message fires 10 handlers. Always `removeEventListener` (or just recreate the WebSocket fresh, since listeners attach to the instance).
2. **Storing the WebSocket in React state** — Triggers re-renders and breaks the singleton pattern. Keep it outside React.
3. **Reconnecting on `error` events** — The `close` event always fires after `error`. Reconnecting on both means double reconnects.
4. **No upper bound on backoff** — Without a cap, you'll eventually wait an hour between retries.
5. **Using `WebSocket.readyState === 1`** instead of `WebSocket.OPEN`. Use the constant, not the magic number.

## Verification Checklist

Before moving to Phase 1b, verify you can do all of these:

- [ ] Connection opens to `wss://ws.kraken.com/v2` (open DevTools Network tab, filter to WS)
- [ ] If you kill your wifi and turn it back on, the manager reconnects automatically
- [ ] If you call `disconnect()` deliberately, it does NOT reconnect
- [ ] State transitions are observable from a React component using your hook
- [ ] Closing your laptop lid for 5 minutes and reopening triggers a heartbeat failure and reconnect (this is the hard one to test — you can simulate it by manually calling `socket.close()` from the console)
- [ ] No console errors, no leaked timers (check with `setInterval` running count if needed)

## Interview Drill Questions

Practice answering these out loud before moving on. Aim for ~60 seconds per answer.

1. Walk me through what happens when a user loses wifi for 30 seconds and then regains it.
2. Why exponential backoff with jitter, not just retrying every second?
3. How do you detect that the server is alive but unresponsive (as opposed to disconnected)?
4. Where does this manager live in your React tree, and why?
5. If you had to support 5 different WebSocket endpoints in the same app, how would the design change?
6. What happens if `send()` is called from a component during render? Is that safe?
7. What's the trade-off between buffering outbound messages and dropping them?

## Reference Material

- MDN WebSocket: https://developer.mozilla.org/en-US/docs/Web/API/WebSocket
- `useSyncExternalStore` docs: https://react.dev/reference/react/useSyncExternalStore
- Exponential backoff with jitter (AWS): https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/

Once this all works against Kraken's WS endpoint (you should see the connection open even though you haven't subscribed to anything yet), move to `02-phase1b-kraken-integration.md`.
