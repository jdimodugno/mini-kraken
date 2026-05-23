import Decimal from "decimal.js";
import type { BookEntry } from "../kraken/schemas";

export interface Level {
  price: Decimal;
  qty: Decimal;
  // Raw wire strings, preserved from JSON for checksum computation.
  // Kraken's checksum algorithm uses the decimal string exactly as sent
  // (e.g. "0.00005100"), so we must not lose trailing zeros via float parsing.
  rawPrice: string;
  rawQty: string;
}

export interface UpdateResult {
  bidsChanged: Decimal[];
  asksChanged: Decimal[];
  topChanged: boolean;
}

// Only conversion point from wire string to Decimal + raw string pair.
// entry.price and entry.qty arrive as strings (see KrakenClient's quoteBookEntryNumbers)
// so new Decimal(string) captures their full precision, and rawPrice/rawQty
// carry the original wire representation for checksum computation.
export function toLevel(entry: BookEntry): Level {
  return {
    price: new Decimal(entry.price),
    qty: new Decimal(entry.qty),
    rawPrice: entry.price,
    rawQty: entry.qty,
  };
}

export class OrderBook {
  // bids: descending by price (highest first)
  private bids: Level[] = [];
  // asks: ascending by price (lowest first)
  private asks: Level[] = [];
  private lastUpdateAt = 0;

  applySnapshot(bids: Level[], asks: Level[]): void {
    this.bids = bids
      .map((l) => ({ price: l.price, qty: l.qty, rawPrice: l.rawPrice, rawQty: l.rawQty }))
      .sort((a, b) => b.price.comparedTo(a.price));
    this.asks = asks
      .map((l) => ({ price: l.price, qty: l.qty, rawPrice: l.rawPrice, rawQty: l.rawQty }))
      .sort((a, b) => a.price.comparedTo(b.price));
    this.lastUpdateAt = Date.now();
  }

  applyUpdate(bids: Level[], asks: Level[]): UpdateResult {
    const prevBestBid = this.bids[0]?.price ?? null;
    const prevBestAsk = this.asks[0]?.price ?? null;

    const bidsChanged = this.applyToSide(this.bids, bids, "desc");
    const asksChanged = this.applyToSide(this.asks, asks, "asc");

    const newBestBid = this.bids[0]?.price ?? null;
    const newBestAsk = this.asks[0]?.price ?? null;

    // topChanged is true when nullity differs or both non-null but prices differ.
    const bidTopChanged =
      (prevBestBid === null) !== (newBestBid === null) ||
      (prevBestBid !== null && newBestBid !== null && !prevBestBid.equals(newBestBid));
    const askTopChanged =
      (prevBestAsk === null) !== (newBestAsk === null) ||
      (prevBestAsk !== null && newBestAsk !== null && !prevBestAsk.equals(newBestAsk));

    this.lastUpdateAt = Date.now();
    return { bidsChanged, asksChanged, topChanged: bidTopChanged || askTopChanged };
  }

  // Returns prices that were added, updated, or removed.
  private applyToSide(side: Level[], deltas: Level[], order: "asc" | "desc"): Decimal[] {
    const changed: Decimal[] = [];

    for (const delta of deltas) {
      const idx = side.findIndex((l) => l.price.equals(delta.price));

      if (delta.qty.isZero()) {
        if (idx !== -1) {
          side.splice(idx, 1);
          changed.push(delta.price);
        }
      } else if (idx !== -1) {
        side[idx]!.qty = delta.qty;
        side[idx]!.rawQty = delta.rawQty;
        changed.push(delta.price);
      } else {
        const insertAt = side.findIndex((l) =>
          order === "desc"
            ? l.price.lessThan(delta.price)
            : l.price.greaterThan(delta.price)
        );
        if (insertAt === -1) {
          side.push({ price: delta.price, qty: delta.qty, rawPrice: delta.rawPrice, rawQty: delta.rawQty });
        } else {
          side.splice(insertAt, 0, { price: delta.price, qty: delta.qty, rawPrice: delta.rawPrice, rawQty: delta.rawQty });
        }
        changed.push(delta.price);
      }
    }

    return changed;
  }

  getBids(depth: number): readonly Level[] {
    return this.bids.slice(0, depth);
  }

  getAsks(depth: number): readonly Level[] {
    return this.asks.slice(0, depth);
  }

  topOfBook(): { bestBid: Level | null; bestAsk: Level | null } {
    return {
      bestBid: this.bids[0] ?? null,
      bestAsk: this.asks[0] ?? null,
    };
  }

  getSpread(): Decimal | null {
    const { bestBid, bestAsk } = this.topOfBook();
    if (bestBid === null || bestAsk === null) return null;
    return bestAsk.price.minus(bestBid.price);
  }

  getLastUpdateAt(): number {
    return this.lastUpdateAt;
  }
}
