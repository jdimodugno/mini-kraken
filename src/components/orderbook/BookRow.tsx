'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useStoreWithEqualityFn } from 'zustand/traditional';
import { useOrderBookStore } from '@/stores/orderbook-store';
import { selectLevelDisplay, levelDisplayEqual } from './selectors';

interface BookRowProps {
  symbol: string;
  side: 'bid' | 'ask';
  index: number;
  depth: number;
}

export function BookRow({ symbol, side, index, depth }: BookRowProps) {
  const selector = useMemo(
    () => selectLevelDisplay(symbol, side, index, depth),
    [symbol, side, index, depth],
  );
  const display = useStoreWithEqualityFn(useOrderBookStore, selector, levelDisplayEqual);

  const rowRef = useRef<HTMLDivElement>(null);
  const prevQtyStr = useRef<string | undefined>(undefined);

  useEffect(() => {
    const currentQty = display?.qtyStr;
    if (prevQtyStr.current !== undefined && prevQtyStr.current !== currentQty) {
      const el = rowRef.current;
      if (el) {
        el.classList.remove('book-row-flash');
        // Force reflow to restart the CSS animation from the beginning.
        void el.offsetWidth;
        el.classList.add('book-row-flash');
      }
    }
    prevQtyStr.current = currentQty;
  }, [display?.qtyStr]);

  if (!display) {
    return <div className="book-row book-row-empty" />;
  }

  return (
    <div
      ref={rowRef}
      className={`book-row book-row-${side}`}
      style={{ '--depth-pct': display.depthPct } as React.CSSProperties}
    >
      <span className="book-row-price">{display.priceStr}</span>
      <span className="book-row-qty">{display.qtyStr}</span>
    </div>
  );
}
