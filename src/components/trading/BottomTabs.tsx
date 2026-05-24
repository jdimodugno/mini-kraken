'use client';

import { useState } from 'react';
import { PositionsPanel } from './PositionsPanel';
import { OpenOrders } from './OpenOrders';
import { FilledOrders } from './FilledOrders';

type Tab = 'positions' | 'open-orders' | 'filled-orders';

const TABS: { id: Tab; label: string }[] = [
  { id: 'positions', label: 'Positions' },
  { id: 'open-orders', label: 'Open Orders' },
  { id: 'filled-orders', label: 'Filled Orders' },
];

export function BottomTabs() {
  const [activeTab, setActiveTab] = useState<Tab>('positions');

  return (
    <div className="flex flex-col border-t border-zinc-800">
      <div className="flex gap-1 px-3 pt-2 bg-zinc-950">
        {TABS.map(({ id, label }) => (
          <button
            key={id}
            onClick={() => setActiveTab(id)}
            className={`px-3 py-1.5 text-xs font-mono rounded-t transition-colors ${
              id === activeTab
                ? 'bg-zinc-800 text-zinc-100 border-t border-x border-zinc-700'
                : 'text-zinc-500 hover:text-zinc-300'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="overflow-y-auto max-h-48 min-h-[120px] bg-zinc-950">
        {activeTab === 'positions' && <PositionsPanel />}
        {activeTab === 'open-orders' && <OpenOrders />}
        {activeTab === 'filled-orders' && <FilledOrders />}
      </div>
    </div>
  );
}
