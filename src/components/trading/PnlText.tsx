'use client';

import { toDisplayString, type Decimal } from '@/lib/money/decimal';

interface PnlTextProps {
  value: Decimal;
  dp?: number;
  className?: string;
}

export function PnlText({ value, dp = 2, className = '' }: PnlTextProps) {
  const isPositive = value.gt(0);
  const isNegative = value.lt(0);

  const colorClass = isPositive
    ? 'text-emerald-400'
    : isNegative
      ? 'text-red-400'
      : 'text-zinc-400';

  // Non-color signals: arrows + prefix for a11y (don't rely solely on color)
  const prefix = isPositive ? '+' : isNegative ? '-' : '';
  const arrow = isPositive ? '▲' : isNegative ? '▼' : '';
  const displayValue = toDisplayString(value.abs(), dp);

  return (
    <span className={`${colorClass} ${className}`}>
      <span aria-hidden="true">{arrow}</span>
      {prefix}${displayValue}
    </span>
  );
}
