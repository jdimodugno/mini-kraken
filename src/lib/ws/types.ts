export type ConnectionState =
  | { status: 'idle' }
  | { status: 'connecting'; attempt: number }
  | { status: 'open'; since: number }
  | {
      status: 'reconnecting';
      attempt: number;
      nextRetryAt: number;
      lastCloseCode?: number;
      lastCloseReason?: string;
    }
  | {
      status: 'degraded';
      nextRetryAt: number;
      lastCloseCode?: number;
      lastCloseReason?: string;
    }
  | { status: 'closed'; reason: string };
