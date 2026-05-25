import type { ConnectionState } from './types';

export interface IConnectionManager {
  connect(): void;
  disconnect(): void;
  send(payload: unknown): boolean;
  onRawMessage(handler: (raw: string) => void): () => void;
  onStateChange(handler: (state: ConnectionState) => void): () => void;
  getState(): ConnectionState;
  acknowledgePong(): void;
}

export interface ConnectionManagerOptions {
  url: string;
  maxFastReconnectAttempts?: number;
  initialReconnectDelayMs?: number;
  maxReconnectDelayMs?: number;
  slowReconnectDelayMs?: number;
  heartbeatIntervalMs?: number;
  outboundBufferSize?: number;
}

type StateListener = (state: ConnectionState) => void;
type RawMessageListener = (raw: string) => void;

export class ConnectionManager implements IConnectionManager {
  private socket: WebSocket | null = null;
  private state: ConnectionState = { status: 'idle' };
  private stateListeners = new Set<StateListener>();
  private rawMessageListeners = new Set<RawMessageListener>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private pongDeadlineTimer: ReturnType<typeof setTimeout> | null = null;
  private outboundBuffer: string[] = [];
  private intentionallyClosed = false;
  private fastAttempts = 0;
  private lastPongAt = 0;
  private pendingPing = false;

  private readonly opts: Required<ConnectionManagerOptions>;

  private visibilityChangeHandler: (() => void) | null = null;

  constructor(opts: ConnectionManagerOptions) {
    this.opts = {
      maxFastReconnectAttempts: opts.maxFastReconnectAttempts ?? 20,
      initialReconnectDelayMs: opts.initialReconnectDelayMs ?? 1000,
      maxReconnectDelayMs: opts.maxReconnectDelayMs ?? 30_000,
      slowReconnectDelayMs: opts.slowReconnectDelayMs ?? 300_000,
      heartbeatIntervalMs: opts.heartbeatIntervalMs ?? 30_000,
      outboundBufferSize: opts.outboundBufferSize ?? 100,
      url: opts.url,
    };
  }

  connect(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    // Reset before the guard so a CLOSING socket still clears the flag.
    // Without this, calling connect() while CLOSING leaves intentionallyClosed=true
    // and the onClose handler silently no-ops the reconnect.
    this.intentionallyClosed = false;

    if (this.socket && this.socket.readyState !== WebSocket.CLOSED) return;

    const attempt = this.fastAttempts + 1;
    this.setState({ status: 'connecting', attempt });

    try {
      this.socket = new WebSocket(this.opts.url);
    } catch {
      this.scheduleReconnect(null, null);
      return;
    }

    this.socket.addEventListener('open', this.onOpen);
    this.socket.addEventListener('message', this.onMessage);
    this.socket.addEventListener('error', this.onError);
    this.socket.addEventListener('close', this.onClose);
  }

  disconnect(): void {
    this.intentionallyClosed = true;

    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    this.stopHeartbeat();
    this.removeVisibilityListener();

    if (this.socket) {
      this.socket.close(1000);
    }

    this.outboundBuffer = [];
    this.setState({ status: 'closed', reason: 'intentional' });
  }

  send(payload: unknown): boolean {
    const serialized = JSON.stringify(payload);

    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(serialized);
      return true;
    }

    if (this.outboundBuffer.length >= this.opts.outboundBufferSize) {
      // Buffer full — drop the newest message; oldest (already buffered) are preserved.
      return false;
    }

    this.outboundBuffer.push(serialized);
    return true;
  }

  // Sends a control frame (ping, pong) directly when OPEN; silently drops otherwise.
  // Does NOT go through the outbound buffer — control frames must not be queued
  // behind data messages, and resubscribeAll() handles replay on reconnect.
  sendControl(payload: unknown): boolean {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(payload));
      return true;
    }
    return false;
  }

  onRawMessage(handler: RawMessageListener): () => void {
    this.rawMessageListeners.add(handler);
    return () => {
      this.rawMessageListeners.delete(handler);
    };
  }

  onStateChange(handler: StateListener): () => void {
    this.stateListeners.add(handler);
    return () => {
      this.stateListeners.delete(handler);
    };
  }

  getState(): ConnectionState {
    return this.state;
  }

  // Called by Phase 1b when it recognises a pong frame
  acknowledgePong(): void {
    this.lastPongAt = Date.now();
    this.pendingPing = false;
    if (this.pongDeadlineTimer !== null) {
      clearTimeout(this.pongDeadlineTimer);
      this.pongDeadlineTimer = null;
    }
  }

  private setState(next: ConnectionState): void {
    this.state = next;
    // Array.from snapshot prevents mutation-during-iteration if a listener calls disconnect().
    Array.from(this.stateListeners).forEach((l) => l(next));
  }

  private onOpen = (): void => {
    this.fastAttempts = 0;

    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    this.setState({ status: 'open', since: Date.now() });
    this.flushOutboundBuffer();
    this.startHeartbeat();
  };

  private onMessage = (event: MessageEvent): void => {
    const raw = typeof event.data === 'string' ? event.data : String(event.data);
    // Array.from snapshot prevents mutation-during-iteration if a listener calls disconnect().
    Array.from(this.rawMessageListeners).forEach((l) => l(raw));
  };

  // Error is always followed by close — reconnect only on close to avoid double-reconnect
  private onError = (): void => {
    console.debug('[ConnectionManager] socket error — close event will follow');
  };

  private onClose = (event: CloseEvent): void => {
    this.stopHeartbeat();
    this.socket = null;

    if (this.intentionallyClosed) {
      return;
    }

    // Per-socket-lifetime buffer: stale sends from the dead socket are dropped.
    // resubscribeAll() in SubscriptionManager is the authoritative replay path.
    this.outboundBuffer = [];
    this.scheduleReconnect(event.code, event.reason);
  };

  private scheduleReconnect(
    closeCode: number | null,
    closeReason: string | null,
  ): void {
    this.fastAttempts += 1;

    if (this.fastAttempts > this.opts.maxFastReconnectAttempts) {
      const nextRetryAt = Date.now() + this.opts.slowReconnectDelayMs;
      const nextState: ConnectionState = {
        status: 'degraded',
        nextRetryAt,
        ...(closeCode !== null ? { lastCloseCode: closeCode } : {}),
        ...(closeReason ? { lastCloseReason: closeReason } : {}),
      };
      this.setState(nextState);
      this.reconnectTimer = setTimeout(() => this.connect(), this.opts.slowReconnectDelayMs);
    } else {
      const baseDelay = Math.min(
        this.opts.initialReconnectDelayMs * 2 ** (this.fastAttempts - 1),
        this.opts.maxReconnectDelayMs,
      );
      const jitter = baseDelay * 0.25 * Math.random();
      const delay = baseDelay + jitter;
      const nextRetryAt = Date.now() + delay;

      const nextState: ConnectionState = {
        status: 'reconnecting',
        attempt: this.fastAttempts,
        nextRetryAt,
        ...(closeCode !== null ? { lastCloseCode: closeCode } : {}),
        ...(closeReason ? { lastCloseReason: closeReason } : {}),
      };
      this.setState(nextState);
      this.reconnectTimer = setTimeout(() => this.connect(), delay);
    }
  }

  private flushOutboundBuffer(): void {
    while (
      this.outboundBuffer.length > 0 &&
      this.socket?.readyState === WebSocket.OPEN
    ) {
      const msg = this.outboundBuffer.shift();
      if (msg !== undefined) {
        this.socket.send(msg);
      }
    }
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();

    this.heartbeatTimer = setInterval(() => {
      if (this.pendingPing) return;

      const sent = this.sendControl({ method: 'ping' });
      if (!sent) {
        // Socket not OPEN — skip arming deadline.
        // Degraded connection will retry on the next interval.
        return;
      }

      this.pendingPing = true;
      this.pongDeadlineTimer = setTimeout(() => {
        this.pongDeadlineTimer = null;
        // Force-close; onClose will handle reconnect
        this.socket?.close(4000, 'heartbeat-timeout');
      }, this.opts.heartbeatIntervalMs / 2);
    }, this.opts.heartbeatIntervalMs);

    if (typeof document !== 'undefined') {
      this.removeVisibilityListener();

      this.visibilityChangeHandler = () => {
        if (document.hidden) {
          this.stopHeartbeat();
        } else {
          this.startHeartbeat();
          // Immediate ping after waking — detect stale connection fast.
          const sent = this.sendControl({ method: 'ping' });
          if (sent) {
            this.pendingPing = true;
            this.pongDeadlineTimer = setTimeout(() => {
              this.pongDeadlineTimer = null;
              this.socket?.close(4000, 'heartbeat-timeout');
            }, this.opts.heartbeatIntervalMs / 2);
          }
        }
      };

      document.addEventListener('visibilitychange', this.visibilityChangeHandler);
    }
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer !== null) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.pongDeadlineTimer !== null) {
      clearTimeout(this.pongDeadlineTimer);
      this.pongDeadlineTimer = null;
    }
    this.pendingPing = false;
  }

  private removeVisibilityListener(): void {
    if (this.visibilityChangeHandler !== null && typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.visibilityChangeHandler);
      this.visibilityChangeHandler = null;
    }
  }
}
