import Vector from "@/components/Vector";
import { formatVector } from "@/lib/format";
import { processNames } from "@/lib/inputs";
import type { DetectResponse, TraceStep } from "@/lib/types";

const heading = "font-mono text-xs uppercase tracking-wider text-soft";
const cell = "border border-soft/70 px-3 py-1";

// One scan of the algorithm, exactly as the server reported it.
function ScanStep({ step, names, stopReason }: { step: TraceStep; names: string[]; stopReason: string }) {
  const picked = step.selected !== null;
  const title = picked ? `Scan ${step.iteration}: ${step.selected} can finish` : `Scan ${step.iteration}: no process can finish`;
  const summaryWork = picked
    ? `Work ${formatVector(step.work_before)} → ${formatVector(step.work_after)}`
    : `Work ${formatVector(step.work_before)} (unchanged)`;

  return (
    <details open className={`border ${picked ? "border-soft/70" : "border-accent"}`}>
      <summary className="cursor-pointer px-4 py-2">
        <span className="font-semibold">{title}</span>
        <span className="ml-3 font-mono text-xs text-soft">{summaryWork}</span>
      </summary>

      <div className="space-y-4 border-t border-soft/70 px-4 py-4">
        <div>
          <h4 className={heading}>Process states before this scan</h4>
          <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1 font-mono text-sm">
            {names.map((name) => {
              const done = step.finish_before[name] === true;
              return (
                <li key={name} className={done ? "text-ok" : "text-warn"}>
                  <span aria-hidden="true">{done ? "✓ " : "○ "}</span>
                  {name} {done ? "finished" : "not finished"}
                </li>
              );
            })}
          </ul>
        </div>

        <div>
          <h4 className={heading}>Work before this scan</h4>
          <Vector values={step.work_before} label="Work before this scan" />
        </div>

        <div>
          <h4 className={heading}>Unfinished processes checked, lowest number first</h4>
          <div className="mt-1 max-w-full overflow-x-auto">
            <table className="border-collapse font-mono text-sm">
              <caption className="sr-only">{`Requests checked in scan ${step.iteration}`}</caption>
              <thead>
                <tr>
                  {["Process", "Request", "Fits in Work?", "Outcome"].map((h) => (
                    <th key={h} scope="col" className={`${cell} text-left text-xs font-normal text-soft`}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {step.considered.map((item) => {
                  const chosen = item.process === step.selected;
                  return (
                    <tr key={item.process} className={chosen ? "bg-paper-2" : undefined}>
                      <th scope="row" className={`${cell} text-left font-semibold`}>
                        {item.process}
                      </th>
                      <td className={cell}>{formatVector(item.request)}</td>
                      <td className={`${cell} ${item.can_satisfy ? "font-semibold text-ok" : "text-soft"}`}>
                        <span aria-hidden="true">{item.can_satisfy ? "✓ " : "✕ "}</span>
                        {item.can_satisfy ? "Yes" : "No"}
                      </td>
                      <td className={`${cell} text-left`}>
                        {chosen && (
                          <>
                            <span aria-hidden="true">▶ </span>
                            Selected: lowest number that fits
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {step.selected !== null && step.allocation_released !== null ? (
          <div>
            <h4 className={heading}>{step.selected} finishes and releases what it holds</h4>
            <div className="mt-1 flex flex-wrap items-end gap-x-3 gap-y-3">
              <figure className="m-0">
                <Vector values={step.work_before} label="Work before" />
                <figcaption className="text-xs text-soft">Work before</figcaption>
              </figure>
              <span aria-hidden="true" className="pb-6 font-mono text-lg text-soft">+</span>
              <figure className="m-0">
                <Vector values={step.allocation_released} label={`Released by ${step.selected}`} />
                <figcaption className="text-xs text-soft">Released by {step.selected}</figcaption>
              </figure>
              <span aria-hidden="true" className="pb-6 font-mono text-lg text-soft">=</span>
              <figure className="m-0">
                <Vector values={step.work_after} label="Work after this scan" />
                <figcaption className="text-xs text-soft">Work after this scan</figcaption>
              </figure>
            </div>
          </div>
        ) : null}

        {!picked && (
          <p className="border-l-2 border-accent pl-4 text-sm">
            <span className="font-semibold">Stop.</span> {stopReason}
          </p>
        )}
      </div>
    </details>
  );
}

export default function TraceList({ result }: { result: DetectResponse }) {
  const names = processNames(result.process_count);
  const count = result.trace.length;
  const last = count > 0 ? result.trace[count - 1] : null;
  const lastStopped = last !== null && last.selected === null;

  return (
    <section aria-labelledby="trace-title" className="mt-10 border-t border-rule pt-6">
      <h3 id="trace-title" className="font-serif text-xl font-semibold tracking-tight">
        Detection trace ({count} {count === 1 ? "scan" : "scans"})
      </h3>
      <p className="mt-1 max-w-2xl text-sm text-soft">
        Each entry is one scan, exactly as the server reported it and in the same order. Vectors
        list R1, R2, … from left to right.
      </p>

      {count === 0 ? (
        <p className="mt-4 text-sm">
          No scans were needed. Every process held nothing, so every process started as finished.
        </p>
      ) : (
        <ol className="mt-4 space-y-4">
          {result.trace.map((step) => (
            <li key={step.iteration}>
              <ScanStep step={step} names={names} stopReason={result.stop_reason} />
            </li>
          ))}
          {lastStopped ? null : (
            <li>
              <p className="border-t border-rule pt-3 text-sm">
                <span className="font-semibold">Stop.</span> {result.stop_reason}
              </p>
            </li>
          )}
        </ol>
      )}
    </section>
  );
}