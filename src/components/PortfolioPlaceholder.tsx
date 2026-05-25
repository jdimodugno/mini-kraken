// Server component — no live data, no hooks needed

const PORTFOLIO_ROWS = [
  { label: 'Equity', value: '$—', muted: false },
  { label: 'Available', value: '$—', muted: false },
  { label: 'Unrealized P&L', value: '$—', muted: false },
  { label: "Today's P&L", value: '$—', muted: false },
] as const;

export function PortfolioPlaceholder() {
  return (
    <div className="flex flex-col h-full p-3">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-semibold text-zinc-200 tracking-wide">
          Portfolio
        </span>
        <span className="text-[10px] text-zinc-500 bg-zinc-800 px-1.5 py-0.5 rounded font-mono">
          Phase 6+
        </span>
      </div>

      {/* Stat rows */}
      <dl className="flex flex-col gap-2">
        {PORTFOLIO_ROWS.map(({ label, value }) => (
          <div key={label} className="flex items-center justify-between">
            <dt className="text-[11px] text-zinc-500">{label}</dt>
            <dd className="text-xs font-mono text-zinc-600 tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>

      {/* Divider + coming-soon note */}
      <div className="mt-auto pt-3 border-t border-zinc-800/60">
        <p className="text-[10px] text-zinc-600 leading-snug">
          Live portfolio data connects in Phase 6 via the Kraken account channel.
        </p>
      </div>
    </div>
  );
}
