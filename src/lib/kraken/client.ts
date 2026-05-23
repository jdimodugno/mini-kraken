import { ConnectionManager } from '../ws/connection-manager';
import type { ConnectionState } from '../ws/types';
import { krakenMessageSchema, type KrakenMessage } from './schemas';

export class KrakenClient {
  private readonly handlers = new Set<(msg: KrakenMessage) => void>();

  constructor(private readonly manager: ConnectionManager) {
    this.manager.onRawMessage(this.handleRawFrame);
  }

  private handleRawFrame = (raw: string): void => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      console.warn('[KrakenClient] non-JSON frame received', raw);
      return;
    }

    const result = krakenMessageSchema.safeParse(parsed);
    if (!result.success) {
      console.debug('[KrakenClient] unknown message shape', parsed, result.error);
      return;
    }

    const msg = result.data;

    if ('method' in msg && msg.method === 'pong') {
      this.manager.acknowledgePong();
    }

    Array.from(this.handlers).forEach((h) => h(msg));
  };

  connect(): void {
    this.manager.connect();
  }

  disconnect(): void {
    this.manager.disconnect();
  }

  getConnectionState(): ConnectionState {
    return this.manager.getState();
  }

  onConnectionStateChange(handler: (state: ConnectionState) => void): () => void {
    return this.manager.onStateChange(handler);
  }

  onMessage<T extends KrakenMessage>(handler: (msg: T) => void): () => void {
    const wrapped = (msg: KrakenMessage) => handler(msg as T);
    this.handlers.add(wrapped);
    return () => {
      this.handlers.delete(wrapped);
    };
  }

  subscribe(params: { channel: string; symbol?: string[]; depth?: number }): boolean {
    return this.manager.send({ method: 'subscribe', params });
  }

  unsubscribe(params: { channel: string; symbol?: string[] }): boolean {
    return this.manager.send({ method: 'unsubscribe', params });
  }
}
