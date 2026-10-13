type Props = {
  running: boolean;
  statusText: string; // a short line such as "Done. No deadlock detected."
  error: { title: string; detail: string } | null;
  onDetect: () => void;
};

// The Detect button, a status line, and any error from the server.
// While running, the button stays focusable but ignores clicks (aria-disabled),
// so keyboard and screen-reader users do not lose their place.
export default function DetectBar({ running, statusText, error, onDetect }: Props) {
  return (
    <div className="mt-8 border-t border-rule pt-6">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
        <button
          type="button"
          onClick={onDetect}
          aria-disabled={running}
          aria-busy={running}
          className="min-h-11 bg-accent px-6 font-mono text-sm uppercase tracking-wider text-on-accent transition-opacity hover:opacity-90 aria-disabled:cursor-wait aria-disabled:opacity-70 aria-disabled:hover:opacity-70"
        >
          {running ? "Running detection…" : "Detect deadlocks"}
        </button>
        <p role="status" aria-live="polite" className="font-mono text-xs text-soft">
          {statusText}
        </p>
      </div>

      {error && (
        <div role="alert" className="mt-4 max-w-2xl border-l-2 border-accent pl-4 text-sm">
          <p className="font-semibold text-accent">{error.title}</p>
          <p className="mt-1">{error.detail}</p>
        </div>
      )}
    </div>
  );
}