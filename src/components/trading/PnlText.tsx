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

  const prefix = isPositive ? '+' : '';

  return (
    <span className={`${colorClass} ${className}`}>
      {prefix}${toDisplayString(value, dp)}
    </span>
  );
}
