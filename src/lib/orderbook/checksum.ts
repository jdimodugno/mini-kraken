import { Crc32 } from "@aws-crypto/crc32";
import type { OrderBook } from "./orderbook";

// Kraken's checksum algorithm (WS v2): concatenate the top-10 asks then top-10
// bids, where each price and qty is formatted by stripping the decimal point and
// all leading zeros from the RAW WIRE STRING. Trailing zeros must be preserved
// because Kraken computes the checksum server-side from the original decimal
// string (e.g. "0.00005100") before JSON-encoding.
//
// Examples using the raw wire strings Kraken sends:
//   "0.00005100" → "5100"   (leading zeros stripped; trailing zeros KEPT)
//   "76773.0"    → "767730" (decimal stripped; trailing zero kept)
//   "0.19900000" → "19900000"
//   "4.20124113" → "420124113"
//   "76610"      → "76610"  (integer, no decimal)
function formatRaw(rawStr: string): string {
  return rawStr.replace(".", "").replace(/^0+/, "") || "0";
}

export function computeBookChecksum(book: OrderBook): number {
  const asks = book.getAsks(10);
  const bids = book.getBids(10);

  let buffer = "";
  for (const level of asks) {
    buffer += formatRaw(level.rawPrice) + formatRaw(level.rawQty);
  }
  for (const level of bids) {
    buffer += formatRaw(level.rawPrice) + formatRaw(level.rawQty);
  }

  const crc = new Crc32();
  crc.update(new TextEncoder().encode(buffer));
  // CRC32 result is a 32-bit unsigned integer used only for equality comparison,
  // not money math — native number is correct here.
  return crc.digest();
}
