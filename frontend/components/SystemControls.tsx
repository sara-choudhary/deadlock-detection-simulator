import { MAX_COUNT, MIN_COUNT } from "@/lib/inputs";

type Props = {
  processCount: number;
  resourceCount: number;
  canReset: boolean; // false when the form already holds the default values
  onProcessCountChange: (count: number) => void;
  onResourceCountChange: (count: number) => void;
  onReset: () => void;
};

const COUNTS = Array.from({ length: MAX_COUNT - MIN_COUNT + 1 }, (_, i) => MIN_COUNT + i);

const selectClass =
  "mt-1 block min-h-10 border border-ink bg-paper px-2 font-mono text-sm text-ink hover:bg-paper-2";
const labelClass = "font-mono text-xs uppercase tracking-wider text-soft";

export default function SystemControls({
  processCount,
  resourceCount,
  canReset,
  onProcessCountChange,
  onResourceCountChange,
  onReset,
}: Props) {
  return (
    <div className="mt-5 flex flex-wrap items-end gap-x-6 gap-y-4">
      <div>
        <label htmlFor="process-count" className={labelClass}>
          Processes
        </label>
        <select
          id="process-count"
          value={processCount}
          onChange={(event) => onProcessCountChange(Number(event.target.value))}
          className={selectClass}
        >
          {COUNTS.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor="resource-count" className={labelClass}>
          Resource types
        </label>
        <select
          id="resource-count"
          value={resourceCount}
          onChange={(event) => onResourceCountChange(Number(event.target.value))}
          className={selectClass}
        >
          {COUNTS.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </div>

      {/* A quiet, secondary action. */}
      <button
        type="button"
        onClick={onReset}
        disabled={!canReset}
        className="min-h-10 border border-rule px-3 font-mono text-xs uppercase tracking-wider text-ink transition-colors hover:border-ink hover:bg-paper-2 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-rule disabled:hover:bg-transparent"
      >
        Reset inputs
      </button>
    </div>
  );
}