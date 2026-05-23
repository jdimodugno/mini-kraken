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
  totalCost: Decimal;
  averagePrice: Decimal;
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
