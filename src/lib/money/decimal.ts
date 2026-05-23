import Decimal from 'decimal.js';

Decimal.set({
  precision: 28,
  rounding: Decimal.ROUND_HALF_EVEN,
  toExpNeg: -7,
  toExpPos: 21,
});

export { Decimal };

export function toDisplayString(d: Decimal, dp: number): string {
  return d.toFixed(dp);
}
