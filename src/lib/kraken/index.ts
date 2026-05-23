'use client';

import { getManager } from '../ws/use-connection';
import { KrakenClient } from './client';
import { SubscriptionManager } from './subscription-manager';

let _client: KrakenClient | null = null;
let _subs: SubscriptionManager | null = null;

export function getKrakenClient(): KrakenClient | null {
  if (typeof window === 'undefined') return null;

  if (process.env.NODE_ENV === 'development') {
    const global = globalThis as Record<string, unknown>;
    if (!global['__minikrakenClient']) {
      const manager = getManager();
      if (!manager) return null;
      const client = new KrakenClient(manager);
      client.connect();
      global['__minikrakenClient'] = client;
    }
    return global['__minikrakenClient'] as KrakenClient;
  }

  if (!_client) {
    const manager = getManager();
    if (!manager) return null;
    _client = new KrakenClient(manager);
    _client.connect();
  }
  return _client;
}

export function getSubscriptionManager(): SubscriptionManager | null {
  if (typeof window === 'undefined') return null;

  if (process.env.NODE_ENV === 'development') {
    const global = globalThis as Record<string, unknown>;
    if (!global['__minikrakenSubs']) {
      const client = getKrakenClient();
      if (!client) return null;
      global['__minikrakenSubs'] = new SubscriptionManager(client);
    }
    return global['__minikrakenSubs'] as SubscriptionManager;
  }

  if (!_subs) {
    const client = getKrakenClient();
    if (!client) return null;
    _subs = new SubscriptionManager(client);
  }
  return _subs;
}
