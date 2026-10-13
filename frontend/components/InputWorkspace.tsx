"use client";

import { useMemo, useRef, useState } from "react";
import DetectBar from "@/components/DetectBar";
import MatrixField from "@/components/MatrixField";
import ResultPanel from "@/components/ResultPanel";
import SystemControls from "@/components/SystemControls";
import ValidationSummary from "@/components/ValidationSummary";
import { requestDetection } from "@/lib/api";
import {
  cellKey,
  defaultInputs,
  isDefaultInputs,
  processNames,
  resizeInputs,
  resourceNames,
  setCell,
  validateInputs,
  type CellError,
  type FieldName,
  type InputState,
} from "@/lib/inputs";
import type { DetectResponse } from "@/lib/types";

// Where the page is in a detection run.
type RunState =
  | { phase: "idle" } // nothing run yet
  | { phase: "blocked" } // Detect was pressed with invalid inputs; nothing was sent
  | { phase: "running" } // request in flight
  | { phase: "failed"; title: string; detail: string }
  | { phase: "done"; id: number; result: DetectResponse; sentJson: string };

function statusText(run: RunState, inputsValid: boolean): string {
  switch (run.phase) {
    case "running":
      return "Running detection…";
    case "blocked":
      return inputsValid ? "" : "Nothing was sent. Fix the highlighted values first.";
    case "failed":
      return "Detection failed.";
    case "done":
      return run.result.status === "DEADLOCK_DETECTED" ? "Done. Deadlock detected." : "Done. No deadlock detected.";
    default:
      return "";
  }
}

// Owns the form state and the detection run.
export default function InputWorkspace() {
  const [inputs, setInputs] = useState<InputState>(defaultInputs);
  const [notice, setNotice] = useState("");
  const [run, setRun] = useState<RunState>({ phase: "idle" });
  const inFlight = useRef(false); // blocks a second request even before React re-renders
  const runCounter = useRef(0);

  const { errors, payload } = useMemo(() => validateInputs(inputs), [inputs]);
  const errorsByCell = useMemo(() => {
    const lookup: Record<string, CellError> = {};
    errors.forEach((error) => {
      lookup[cellKey(error.field, error.row, error.col)] = error;
    });
    return lookup;
  }, [errors]);

  // A result is "stale" when the inputs no longer match what was sent.
  const currentJson = payload === null ? null : JSON.stringify(payload);
  const stale = run.phase === "done" && run.sentJson !== currentJson;

  const pNames = processNames(inputs.processCount);
  const rNames = resourceNames(inputs.resourceCount);

  function changeProcessCount(count: number) {
    setInputs((previous) => resizeInputs(previous, count, previous.resourceCount));
    setNotice("");
  }

  function changeResourceCount(count: number) {
    setInputs((previous) => resizeInputs(previous, previous.processCount, count));
    setNotice("");
  }

  function changeCell(field: FieldName, row: number, col: number, value: string) {
    setInputs((previous) => setCell(previous, field, row, col, value));
    setNotice("");
  }

  function reset() {
    const fresh = defaultInputs();
    setInputs(fresh);
    setNotice(
      `Inputs reset: ${fresh.processCount} processes, ${fresh.resourceCount} resource types, every value 0.`,
    );
  }

  async function detect() {
    if (inFlight.current) return; // a request is already running

    // Never send invalid inputs. The messages are already on screen.
    if (payload === null) {
      setRun({ phase: "blocked" });
      document.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
      return;
    }

    inFlight.current = true;
    setRun({ phase: "running" });
    try {
      const outcome = await requestDetection(payload);
      if (outcome.kind === "ok") {
        runCounter.current += 1;
        setRun({ phase: "done", id: runCounter.current, result: outcome.result, sentJson: JSON.stringify(payload) });
      } else {
        setRun({ phase: "failed", title: outcome.title, detail: outcome.detail });
      }
    } finally {
      inFlight.current = false;
    }
  }

  return (
    <>
      {/* 01: system size */}
      <section
        aria-labelledby="system-title"
        className="grid gap-4 border-b border-rule py-8 md:grid-cols-12 md:gap-8"
      >
        <p className="font-mono text-xs uppercase tracking-widest text-soft md:col-span-3">
          01 &mdash; System
        </p>
        <div className="md:col-span-9">
          <h2 id="system-title" className="font-serif text-2xl font-semibold tracking-tight">
            System size
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-soft">
            A resource type can have several identical instances, for example 3 printers. Changing
            the size keeps the numbers you already typed and fills new cells with 0.
          </p>
          <SystemControls
            processCount={inputs.processCount}
            resourceCount={inputs.resourceCount}
            canReset={!isDefaultInputs(inputs)}
            onProcessCountChange={changeProcessCount}
            onResourceCountChange={changeResourceCount}
            onReset={reset}
          />
        </div>
      </section>

      {/* 02: the three inputs, and the Detect button */}
      <section
        aria-labelledby="inputs-title"
        className="grid gap-4 border-b border-rule py-8 md:grid-cols-12 md:gap-8"
      >
        <p className="font-mono text-xs uppercase tracking-widest text-soft md:col-span-3">
          02 &mdash; Inputs
        </p>
        <div className="min-w-0 md:col-span-9">
          <h2 id="inputs-title" className="font-serif text-2xl font-semibold tracking-tight">
            Resources and requests
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-soft">
            Whole numbers, 0 or more. Click a cell and type to replace its value.
          </p>

          <div className="mt-6 grid gap-10 lg:grid-cols-2">
            <div className="min-w-0 lg:col-span-2">
              <MatrixField
                field="available"
                title="Available"
                description="Free instances of each resource type right now."
                rowLabels={["Free"]}
                columnLabels={rNames}
                values={[inputs.available]}
                errors={errorsByCell}
                onCellChange={(_row, col, value) => changeCell("available", 0, col, value)}
              />
            </div>
            <MatrixField
              field="allocation"
              title="Allocation"
              description="How many instances of each resource a process holds now."
              rowLabels={pNames}
              columnLabels={rNames}
              values={inputs.allocation}
              errors={errorsByCell}
              onCellChange={(row, col, value) => changeCell("allocation", row, col, value)}
            />
            <MatrixField
              field="request"
              title="Request"
              description="How many more instances a process is waiting for before it can finish."
              rowLabels={pNames}
              columnLabels={rNames}
              values={inputs.request}
              errors={errorsByCell}
              onCellChange={(row, col, value) => changeCell("request", row, col, value)}
            />
          </div>

          <ValidationSummary errors={errors} notice={notice} />

          <DetectBar
            running={run.phase === "running"}
            statusText={statusText(run, payload !== null)}
            error={run.phase === "failed" ? { title: run.title, detail: run.detail } : null}
            onDetect={detect}
          />
        </div>
      </section>

      {/* 03: the server's answer */}
      {run.phase === "done" && (
        <section aria-labelledby="result-title" className="grid gap-4 py-8 md:grid-cols-12 md:gap-8">
          <p className="font-mono text-xs uppercase tracking-widest text-soft md:col-span-3">
            03 &mdash; Result
          </p>
          <div className="min-w-0 md:col-span-9">
            <ResultPanel key={run.id} result={run.result} stale={stale} />
          </div>
        </section>
      )}
    </>
  );
}