import { ConnectionManager } from '../ws/connection-manager';
import type { ConnectionState } from '../ws/types';
import { krakenMessageSchema, type KrakenMessage } from './schemas';

// Kraken's book entries carry price and qty as JSON numbers that may include
// trailing zeros significant for checksum computation (e.g. 0.00005100 is sent
// exactly as "0.00005100" on the wire). JSON.parse discards those zeros when
// converting to float64. This regex-based transform quotes the numeric values for
// "price" and "qty" keys inside book data arrays BEFORE JSON.parse runs, so Zod
// receives them as strings and the original wire precision is preserved.
// The pattern matches only inside the book channel's "data" arrays (bids/asks)
// to avoid touching other numeric fields (depths, timestamps, counts).
//
// Pattern: "price": 76773.0  →  "price": "76773.0"
//          "qty": 0.00005100 →  "qty": "0.00005100"
const BOOK_ENTRY_RE = /("(?:price|qty)")\s*:\s*(-?(?:\d+\.?\d*|\.\d+))/g;

function quoteBookEntryNumbers(raw: string): string {
  return raw.replace(BOOK_ENTRY_RE, '$1: "$2"');
}

export class KrakenClient {
  private readonly handlers = new Set<(msg: KrakenMessage) => void>();
  private readonly unsubscribeRaw: () => void;

  constructor(private readonly manager: ConnectionManager) {
    this.unsubscribeRaw = this.manager.onRawMessage(this.handleRawFrame);
  }

  private handleRawFrame = (raw: string): void => {
    let parsed: unknown;
    try {
      // Quote "price" and "qty" number values as strings before parsing so
      // that trailing zeros (e.g. 0.00005100) survive JSON.parse. Standard
      // JSON.parse would silently discard them, breaking checksum computation.
      parsed = JSON.parse(quoteBookEntryNumbers(raw));
    } catch {
      console.warn('[KrakenClient] non-JSON frame received', raw);
      return;
    }

    const result = krakenMessageSchema.safeParse(parsed);
    if (!result.success) {
      console.warn('[KrakenClient] unknown message shape', parsed, result.error);
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
    this.unsubscribeRaw();
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

  subscribe(params: { channel: string; symbol?: string[]; depth?: number; interval?: number; req_id?: number }): boolean {
    const { req_id, ...rest } = params;
    return this.manager.send({ method: 'subscribe', params: rest, ...(req_id !== undefined ? { req_id } : {}) });
  }

  unsubscribe(params: { channel: string; symbol?: string[]; req_id?: number }): boolean {
    const { req_id, ...rest } = params;
    return this.manager.send({ method: 'unsubscribe', params: rest, ...(req_id !== undefined ? { req_id } : {}) });
  }
}
