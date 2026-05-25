import type { Decimal } from '@/lib/money/decimal';

export type Side = 'buy' | 'sell';
export type OrderType = 'market' | 'limit';

export interface OrderRequest {
  symbol: string;
  side: Side;
  type: OrderType;
  size: Decimal;
  limitPrice?: Decimal;
}

export interface Fill {
  price: Decimal;
  size: Decimal;
  fee: Decimal;
}

export interface FilledOrder {
  id: string;
  symbol: string;
  side: Side;
  type: OrderType;
  requestedSize: Decimal;
  fills: Fill[];
  /**
   * Total quote currency notional of all fills, excluding fees.
   * Gross cost = totalCost + totalFee for buys; gross proceeds = totalCost - totalFee for sells.
   */
  totalCost: Decimal;
  averagePrice: Decimal;
  /** Sum of all fill fees in quote currency. Always positive. */
  totalFee: Decimal;
  status: 'filled' | 'partial' | 'rejected';
  filledAt: number;
}

export interface OpenOrder {
  id: string;
  symbol: string;
  side: Side;
  type: 'limit';
  size: Decimal;
  remainingSize: Decimal;
  limitPrice: Decimal;
  createdAt: number;
}
