import { cellKey, type CellError, type FieldName } from "@/lib/inputs";

type Props = {
  field: FieldName;
  title: string;
  description: string;
  rowLabels: string[]; // shown at the left of each row, e.g. P1, P2
  columnLabels: string[]; // shown above each column, e.g. R1, R2
  values: string[][]; // the typed text of every cell
  errors: Record<string, CellError>; // problems, looked up with cellKey()
  onCellChange: (row: number, col: number, value: string) => void;
};

// One editable grid of numbers. It is used for Available (one row),
// Allocation and Request (one row per process).
export default function MatrixField({
  field,
  title,
  description,
  rowLabels,
  columnLabels,
  values,
  errors,
  onCellChange,
}: Props) {
  const titleId = `${field}-title`;

  return (
    <section aria-labelledby={titleId} className="min-w-0">
      <h3 id={titleId} className="font-serif text-xl font-semibold tracking-tight">
        {title}
      </h3>
      <p className="mt-1 max-w-prose text-sm text-soft">{description}</p>

      {/* The grid scrolls sideways inside this box, never the whole page. */}
      <div className="mt-3 overflow-x-auto pb-2">
        <table className="border-collapse">
          <caption className="sr-only">{title}</caption>
          <thead>
            <tr>
              <th scope="col" className="pr-2">
                <span className="sr-only">{field === "available" ? "Row" : "Process"}</span>
              </th>
              {columnLabels.map((label) => (
                <th
                  key={label}
                  scope="col"
                  className="px-1 pb-1 text-center font-mono text-xs font-normal text-soft"
                >
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {values.map((row, r) => (
              <tr key={rowLabels[r]}>
                <th scope="row" className="pr-2 text-left font-mono text-xs font-normal text-soft">
                  {rowLabels[r]}
                </th>
                {row.map((value, c) => {
                  const error = errors[cellKey(field, r, c)];
                  const errorId = `${field}-${r}-${c}-error`;
                  const accessibleName =
                    field === "available"
                      ? `${title}, ${columnLabels[c]}`
                      : `${title}, ${rowLabels[r]}, ${columnLabels[c]}`;
                  return (
                    <td key={columnLabels[c]} className="border border-soft/70 p-0">
                      <input
                        type="text"
                        inputMode="numeric"
                        autoComplete="off"
                        spellCheck={false}
                        value={value}
                        aria-label={accessibleName}
                        aria-invalid={error ? true : undefined}
                        aria-describedby={error ? errorId : undefined}
                        title={error ? error.message : undefined}
                        onFocus={(event) => event.target.select()}
                        onChange={(event) => onCellChange(r, c, event.target.value)}
                        className={
                          "h-10 w-12 bg-paper text-center font-mono text-sm tabular-nums text-ink transition-colors hover:bg-paper-2 focus:bg-paper-2 focus-visible:outline-offset-[-2px] " +
                          (error ? "font-semibold text-accent shadow-[inset_0_-3px_0_var(--accent)]" : "")
                        }
                      />
                      {/* This cell's own message, read when the cell gets focus. */}
{error && (
  <span id={errorId} className="sr-only">
    {error.message}
  </span>
)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}