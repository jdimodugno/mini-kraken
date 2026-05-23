export function markUpdateReceived(symbol: string): void {
  performance.mark(`update-received-${symbol}`);
}

export function markUpdateRendered(symbol: string): void {
  performance.mark(`update-rendered-${symbol}`);
  try {
    const measure = performance.measure(
      `update-to-render-${symbol}`,
      `update-received-${symbol}`,
      `update-rendered-${symbol}`,
    );
    if (measure.duration > 16) {
      console.warn(`[perf] Slow update: ${measure.duration.toFixed(2)}ms for ${symbol}`);
    }
  } catch {
    // marks may be out of order; ignore
  }
}
