'use client';

import { useSyncExternalStore } from 'react';
import { ConnectionManager } from './connection-manager';
import type { ConnectionState } from './types';

const idleState: ConnectionState = { status: 'idle' };

let manager: ConnectionManager | null = null;

export function getManager(): ConnectionManager | null {
  if (typeof window === 'undefined') return null;

  if (process.env.NODE_ENV === 'development') {
    const global = globalThis as Record<string, unknown>;
    if (!global['__minikrakenManager']) {
      global['__minikrakenManager'] = new ConnectionManager({
        url: 'wss://ws.kraken.com/v2',
      });
    }
    return global['__minikrakenManager'] as ConnectionManager;
  }

  if (!manager) {
    manager = new ConnectionManager({
      url: 'wss://ws.kraken.com/v2',
    });
  }
  return manager;
}

export function useConnectionState(): ConnectionState {
  return useSyncExternalStore(
    (cb) => {
      const m = getManager();
      if (!m) return () => {};
      return m.onStateChange(cb);
    },
    () => getManager()?.getState() ?? idleState,
    () => idleState,
  );
}
