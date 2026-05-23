import { z } from "zod";

// ---------------------------------------------------------------------------
// Primitive building blocks
// ---------------------------------------------------------------------------

// Book price and quantity: Kraken WS v2 sends both as JSON numbers but with
// significant trailing zeros (e.g. "0.00005100", "0.19900000") that are required
// for checksum computation. JSON.parse discards trailing zeros when converting to
// float64, so we intercept BEFORE standard parsing using a reviver in KrakenClient
// and validate the raw strings here. z.string() is intentional — the reviver
// ensures these arrive as strings preserving the wire precision.
const bookEntrySchema = z.object({
  price: z.string(),
  qty: z.string(),
});

export type BookEntry = z.infer<typeof bookEntrySchema>;

// Book data payload — one entry per symbol in the data array.
// timestamp is present on snapshots and may be omitted on updates.
// .passthrough() here because Kraken documents that the book data object may
// gain fields (e.g. side indicators on specific data releases).
const bookDataSchema = z
  .object({
    symbol: z.string(),
    bids: z.array(bookEntrySchema),
    asks: z.array(bookEntrySchema),
    checksum: z.number(),
    timestamp: z.string().optional(),
  })
  .passthrough();

// ---------------------------------------------------------------------------
// Channel messages — discriminated on the `channel` field
// ---------------------------------------------------------------------------

export const bookSnapshotSchema = z.object({
  channel: z.literal("book"),
  type: z.literal("snapshot"),
  data: z.array(bookDataSchema),
});

export const bookUpdateSchema = z.object({
  channel: z.literal("book"),
  type: z.literal("update"),
  data: z.array(bookDataSchema),
});

// Heartbeat carries no data payload; the channel field is sufficient.
export const heartbeatSchema = z.object({
  channel: z.literal("heartbeat"),
});

// Status: `type` is present on updates but Kraken may omit it on initial
// connection status messages, so we treat it as optional.
// api_version is an optional extension field documented by Kraken.
// .passthrough() on the data entries because Kraken extends status objects.
const statusDataSchema = z
  .object({
    system: z.string(),
    version: z.string(),
    api_version: z.string().optional(),
  })
  .passthrough();

export const statusSchema = z.object({
  channel: z.literal("status"),
  type: z.string().optional(),
  data: z.array(statusDataSchema),
});

// ---------------------------------------------------------------------------
// Method messages — discriminated on the `method` field (no `channel` field)
// ---------------------------------------------------------------------------

export const pongSchema = z.object({
  method: z.literal("pong"),
  req_id: z.number().optional(),
});

// Subscribe result carries at minimum `channel`; `symbol` is present when the
// subscription is per-symbol. .passthrough() because Kraken may add result
// fields (e.g. depth, snapshot flag) that vary by channel.
const subscribeResultSchema = z
  .object({
    channel: z.string(),
    symbol: z.string().optional(),
  })
  .passthrough();

export const subscribeAckSchema = z.object({
  method: z.literal("subscribe"),
  success: z.boolean(),
  result: subscribeResultSchema,
  time_in: z.string(),
  time_out: z.string(),
  // `error` is present when success === false
  error: z.string().optional(),
});

export const unsubscribeAckSchema = z.object({
  method: z.literal("unsubscribe"),
  success: z.boolean(),
  result: subscribeResultSchema,
  time_in: z.string(),
  time_out: z.string(),
  error: z.string().optional(),
});

// ---------------------------------------------------------------------------
// OHLC channel messages
// ---------------------------------------------------------------------------

const ohlcDataSchema = z.object({
  symbol: z.string(),
  open: z.string(),
  high: z.string(),
  low: z.string(),
  close: z.string(),
  volume: z.string(),
  vwap: z.string(),
  trades: z.number(),
  interval_begin: z.string(),
  interval: z.number(),
  timestamp: z.string(),
});

export const ohlcMessageSchema = z.object({
  channel: z.literal("ohlc"),
  type: z.union([z.literal("snapshot"), z.literal("update")]),
  data: z.array(ohlcDataSchema),
});

export type OhlcMessage = z.infer<typeof ohlcMessageSchema>;
export type OhlcData = z.infer<typeof ohlcDataSchema>;

// ---------------------------------------------------------------------------
// Composite discriminated unions
// ---------------------------------------------------------------------------

// Zod v4 requires unique discriminant values. Both book variants share
// channel: "book", so they are pre-discriminated on `type` before the
// outer channel union is constructed — preserving O(1) dispatch on the hot path.
const bookChannelSchema = z.discriminatedUnion("type", [
  bookSnapshotSchema,
  bookUpdateSchema,
]);

// ohlc also discriminates on `type`, combined with book via plain union before
// the outer channel discriminated union is built.
const ohlcChannelSchema = z.discriminatedUnion("type", [
  ohlcMessageSchema,
]);

const channelMessageSchema = z.union([
  bookChannelSchema,
  ohlcChannelSchema,
  z.discriminatedUnion("channel", [heartbeatSchema, statusSchema]),
]);

// Method messages share the `method` discriminant (no `channel` field present).
const methodMessageSchema = z.discriminatedUnion("method", [
  pongSchema,
  subscribeAckSchema,
  unsubscribeAckSchema,
]);

// Top-level union: channel-based OR method-based. A plain z.union is used here
// because the two sub-unions discriminate on different keys — there is no
// single top-level field that unambiguously identifies all six message types.
export const krakenMessageSchema = z.union([
  channelMessageSchema,
  methodMessageSchema,
]);

// ---------------------------------------------------------------------------
// Exported TypeScript types (inferred, never hand-written)
// ---------------------------------------------------------------------------

export type KrakenMessage = z.infer<typeof krakenMessageSchema>;
export type BookSnapshot = z.infer<typeof bookSnapshotSchema>;
export type BookUpdate = z.infer<typeof bookUpdateSchema>;
export type SubscribeAck = z.infer<typeof subscribeAckSchema>;
export type UnsubscribeAck = z.infer<typeof unsubscribeAckSchema>;
