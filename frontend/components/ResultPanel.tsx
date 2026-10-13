import { useEffect, useRef, type ReactNode } from "react";
import BlockedList from "@/components/BlockedList";
import TraceList from "@/components/TraceList";
import Vector from "@/components/Vector";
import { processNames } from "@/lib/inputs";
import type { DetectResponse } from "@/lib/types";

type Props = {
  result: DetectResponse; // the server's answer, already checked by lib/api.ts
  stale: boolean; // true when the inputs were changed after this answer arrived
};

// A row of the summary: a small mono label on the left, the value on the right.
function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 border-t border-rule py-3 sm:grid-cols-[12rem_1fr] sm:gap-6">
      <dt className="font-mono text-xs uppercase tracking-wider text-soft">{label}</dt>
      <dd className="m-0 min-w-0">{children}</dd>
    </div>
  );
}

function Names({ list }: { list: string[] }) {
  return <span className="font-mono">{list.length > 0 ? list.join(", ") : "None"}</span>;
}

// Shows what the server returned. The words "Deadlock detected" and
// "No deadlock detected" come only from the server's `status` field; nothing
// here works out a verdict.
export default function ResultPanel({ result, stale }: Props) {
  const headingRef = useRef<HTMLHeadingElement>(null);

  // Move keyboard and screen-reader focus to the result when it appears.
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  const deadlock = result.status === "DEADLOCK_DETECTED";
  const names = processNames(result.process_count);

  return (
    <div>
      <h2
        id="result-title"
        ref={headingRef}
        tabIndex={-1}
        className="font-serif text-2xl font-semibold tracking-tight"
      >
        Result
      </h2>

      {stale && (
        <p className="mt-4 border-l-2 border-warn pl-4 text-sm text-warn">
          You changed the inputs after this result was produced. It describes the earlier inputs.
          Run detection again to update it.
        </p>
      )}

      <div className="mt-4 border-t-2 border-ink pt-4">
        <p className={`font-serif text-3xl font-semibold tracking-tight ${deadlock ? "text-accent" : "text-ok"}`}>
          <span aria-hidden="true">{deadlock ? "✕ " : "✓ "}</span>
          {deadlock ? "Deadlock detected" : "No deadlock detected"}
        </p>
        <p className="mt-1 font-mono text-xs text-soft">status: {result.status}</p>
        <p className="mt-3 max-w-2xl">{result.message}</p>
      </div>

      <ul aria-label="Outcome for each process" className="mt-6 flex flex-wrap gap-2 text-sm">
        {names.map((name) => {
          const step = result.completion_sequence.indexOf(name);
          let tone = "border-soft/70 text-soft";
          let symbol = "○";
          let words = "finished";
          if (result.deadlocked_processes.includes(name)) {
            tone = "border-accent text-accent";
            symbol = "✕";
            words = "deadlocked: cannot finish";
          } else if (step !== -1) {
            tone = "border-ok text-ok";
            symbol = "✓";
            words = `finishes at step ${step + 1}`;
          } else if (result.initially_finished.includes(name)) {
            words = "holds nothing: finished from the start";
          }
          return (
            <li key={name} className={`border px-2 py-1 ${tone}`}>
              <span aria-hidden="true">{symbol} </span>
              <span className="font-mono font-semibold">{name}</span> {words}
            </li>
          );
        })}
      </ul>

      <dl className="mt-6 border-b border-rule">
        <Fact label="Completion order">
          {result.completion_sequence.length > 0 ? (
            <ol aria-label="Completion order" className="m-0 flex list-none flex-wrap items-center gap-y-2 p-0 font-mono text-sm">
              {result.completion_sequence.map((name, i) => (
                <li key={name} className="flex items-center">
                  <span className="border border-ink px-2 py-0.5">
                    <span className="mr-1.5 text-soft">{i + 1}</span>
                    {name}
                  </span>
                  {i < result.completion_sequence.length - 1 && (
                    <span aria-hidden="true" className="px-2 text-soft">→</span>
                  )}
                </li>
              ))}
            </ol>
          ) : (
            <span>None. No process finished during the scans.</span>
          )}
          <p className="mt-2 text-xs text-soft">
            One valid order for these numbers, not a guarantee about every possible schedule.
          </p>
        </Fact>
        <Fact label="Finished">
          <Names list={result.finished_processes} />
        </Fact>
        <Fact label="Finished from the start">
          <Names list={result.initially_finished} />
        </Fact>
        <Fact label="Deadlocked">
          <Names list={result.deadlocked_processes} />
        </Fact>
        <Fact label="Work at the start">
          <Vector values={result.initial_work} label="Work at the start" />
        </Fact>
        <Fact label="Work at the end">
          <Vector values={result.final_work} label="Work at the end" />
        </Fact>
        <Fact label="Why it stopped">
          <span>{result.stop_reason}</span>
        </Fact>
      </dl>

      {deadlock && <BlockedList result={result} />}
      <TraceList result={result} />

      <p className="mt-8 max-w-2xl text-sm text-soft">
        This describes only the numbers entered above. It does not inspect any real operating-system
        processes.
      </p>
    </div>
  );
}