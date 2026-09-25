'use client';

/** Never show Next's unstyled error output. */
export default function Error({ error, reset }: { error: Error; reset(): void }) {
  return (
    <main className="grid h-dvh place-items-center bg-void p-4">
      <div role="alert" className="w-full max-w-sm rounded-[4px] border border-strong bg-panel p-4 font-mono">
        <div className="flex items-center gap-2 text-[11px] tracking-[0.08em] text-dead">
          <span className="h-1.5 w-1.5 rounded-full bg-dead" /> SYSTEM FAULT
        </div>
        <p className="mt-3 text-[11px] leading-5 text-secondary">Atlas Eye hit an unexpected error.</p>
        <pre className="mt-2 overflow-x-auto rounded-[2px] border border-subtle bg-void px-2 py-1.5 text-[10px] text-tertiary">{error.message}</pre>
        <button
          type="button"
          onClick={reset}
          className="mt-3 h-8 rounded-[2px] border border-accent-muted bg-accent-glow px-3 text-[11px] tracking-[0.08em] text-accent hover:bg-accent/20"
        >
          RESTART
        </button>
      </div>
    </main>
  );
}
