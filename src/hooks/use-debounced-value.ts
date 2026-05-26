'use client';

import { useEffect, useState } from 'react';

/**
 * Debounces a value by the specified delay.
 * Used for aria-live regions to avoid spamming screen readers.
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedValue(value);
    }, delayMs);

    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debouncedValue;
}
