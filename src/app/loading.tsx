export default function Loading() {
  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="w-full bg-zinc-900 border-b border-zinc-800 px-6 h-9 flex items-center">
        <span className="text-sm font-semibold tracking-wide text-zinc-100">MiniKraken</span>
      </div>

      <div className="max-w-[1280px] mx-auto flex flex-col" style={{ height: 'calc(100vh - 2.25rem)' }}>
        <header className="h-10 flex items-center gap-4 px-4 border-b border-zinc-800 shrink-0">
          <div className="h-3 w-16 rounded bg-zinc-800 animate-pulse" />
          <div className="h-6 w-28 rounded bg-zinc-800 animate-pulse" />
        </header>

        <div className="flex-1 grid grid-cols-[1fr_280px] min-h-0">
          {/* Left column skeleton */}
          <div className="flex flex-col min-h-0">
            <div className="h-[50vh] min-h-0 shrink-0 bg-zinc-900 animate-pulse" />
            <div className="flex-1 bg-zinc-950 animate-pulse" />
          </div>

          {/* Right column skeleton */}
          <div className="flex flex-col min-h-0 overflow-hidden bg-zinc-900">
            <div className="flex-1 animate-pulse bg-zinc-900" />
            <div className="h-48 animate-pulse bg-zinc-800 border-t border-zinc-700" />
          </div>
        </div>
      </div>
    </main>
  );
}
