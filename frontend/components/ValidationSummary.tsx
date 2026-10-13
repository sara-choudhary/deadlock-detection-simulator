import type { CellError } from "@/lib/inputs";

type Props = {
  errors: CellError[];
  notice: string; // a short message such as "Inputs reset", or ""
};

const MAX_LISTED = 8;

// The visible feedback area under the inputs.
// Only the short headline lines are live regions (polite), so screen readers
// hear "3 values need fixing" when the count changes, not the whole list on
// every keystroke. Each invalid cell also carries its own message (see
// MatrixField), and the list below is for sighted readers and for browsing.
export default function ValidationSummary({ errors, notice }: Props) {
  const listed = errors.slice(0, MAX_LISTED);
  const hidden = errors.length - listed.length;
  const headline =
    errors.length === 0
      ? "Every value is a whole number of 0 or more."
      : errors.length === 1
        ? "1 value needs fixing:"
        : `${errors.length} values need fixing:`;

  return (
    <div id="input-problems" className="mt-6 text-sm">
      <p role="status" aria-live="polite" className="font-mono text-xs text-soft">
        {notice}
      </p>

      <p
        role="status"
        aria-live="polite"
        className={errors.length > 0 ? "mt-2 font-semibold text-accent" : "mt-2 text-soft"}
      >
        {headline}
      </p>

      {errors.length > 0 && (
        <div className="mt-1 border-l-2 border-accent pl-4">
          <ul className="list-disc space-y-0.5 pl-5">
            {listed.map((error) => (
              <li key={`${error.field}:${error.row}:${error.col}`}>{error.message}</li>
            ))}
          </ul>
          {hidden > 0 && <p className="mt-1 text-soft">…and {hidden} more.</p>}
        </div>
      )}
    </div>
  );
}