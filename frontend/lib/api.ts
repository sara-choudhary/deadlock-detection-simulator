// Talks to the Flask backend. The only place in the frontend that sends a
// network request. It never decides who is deadlocked: it sends the inputs,
// checks that the answer has the expected shape, and hands it back.

import { processNames, type DetectPayload } from "@/lib/inputs";
import type { DetectResponse } from "@/lib/types";

// Empty by default: the browser calls /api/detect on the Next.js server, and
// next.config.ts forwards it to Flask (so Flask needs no CORS settings).
const API_BASE = (process.env.NEXT_PUBLIC_API_BASE_URL ?? "").replace(/\/+$/, "");
export const DETECT_URL = `${API_BASE}/api/detect`;
export const REQUEST_TIMEOUT_MS = 15000;

export type DetectOutcome =
  | { kind: "ok"; result: DetectResponse }
  | { kind: "error"; title: string; detail: string };

// ---- small type guards ------------------------------------------------------

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

function isIntArray(x: unknown, length: number): x is number[] {
  return Array.isArray(x) && x.length === length && x.every((v) => Number.isInteger(v));
}

function isStringArray(x: unknown): x is string[] {
  return Array.isArray(x) && x.every((v) => typeof v === "string");
}

// ---- checking the server's answer --------------------------------------------

// Make sure a "successful" answer really has everything the page needs to
// draw it. Returns null when it does, or a short reason when it does not.
export function checkResponse(body: unknown, payload: DetectPayload): string | null {
  if (!isRecord(body)) return "the answer is not a JSON object";
  if (body.success !== true) return "the answer is missing success: true";
  if (body.status !== "NO_DEADLOCK" && body.status !== "DEADLOCK_DETECTED") return "unknown status";
  if (typeof body.message !== "string") return "missing message";
  if (typeof body.stop_reason !== "string") return "missing stop_reason";
  if (body.process_count !== payload.process_count || body.resource_count !== payload.resource_count) {
    return "the answer is for a different system size than the one sent";
  }

  const names = processNames(payload.process_count);
  const m = payload.resource_count;

  for (const key of ["deadlocked_processes", "finished_processes", "completion_sequence", "initially_finished"]) {
    const list = body[key];
    if (!isStringArray(list)) return `missing list ${key}`;
    if (!list.every((name) => names.includes(name))) return `${key} names an unknown process`;
  }
  const deadlocked = body.deadlocked_processes as string[];
  const finished = body.finished_processes as string[];

  if (!Array.isArray(body.trace)) return "missing list trace";
  if (!isIntArray(body.initial_work, m) || !isIntArray(body.final_work, m)) {
    return "initial_work or final_work has the wrong length";
  }
  if (!isRecord(body.finish_status) || !isRecord(body.blocked_explanations)) {
    return "missing finish_status or blocked_explanations";
  }
  const finishStatus = body.finish_status;
  if (!names.every((name) => typeof finishStatus[name] === "boolean")) {
    return "finish_status does not list every process";
  }
  const covered = finished.length + deadlocked.length === names.length &&
    names.every((name) => finished.includes(name) !== deadlocked.includes(name));
  if (!covered) return "finished and deadlocked lists do not cover every process exactly once";
  if ((body.status === "DEADLOCK_DETECTED") !== (deadlocked.length > 0)) {
    return "status disagrees with the deadlocked list";
  }

  for (let t = 0; t < body.trace.length; t++) {
    const step: unknown = body.trace[t];
    const where = `trace step ${t + 1}`;
    if (!isRecord(step) || !Number.isInteger(step.iteration) || !isIntArray(step.work_before, m) ||
        !isIntArray(step.work_after, m) || !isRecord(step.finish_before) || !Array.isArray(step.considered)) {
      return `${where} is malformed`;
    }
    const finishBefore = step.finish_before;
    if (!names.every((name) => typeof finishBefore[name] === "boolean")) {
      return `${where} does not list every process state`;
    }
    for (const item of step.considered as unknown[]) {
      if (!isRecord(item) || typeof item.process !== "string" || !isIntArray(item.request, m) ||
          typeof item.can_satisfy !== "boolean") {
        return `${where} has a malformed entry`;
      }
    }
    if (step.selected !== null &&
        (typeof step.selected !== "string" || !isIntArray(step.allocation_released, m) ||
         !isIntArray(step.selected_request, m))) {
      return `${where} is missing release details`;
    }
  }

  for (const name of deadlocked) {
    const info = body.blocked_explanations[name];
    if (!isRecord(info) || typeof info.explanation !== "string" || !Array.isArray(info.shortages) ||
        !isIntArray(info.request, m) || !isIntArray(info.allocation, m)) {
      return "a blocked-process explanation is malformed";
    }
    for (const shortage of info.shortages as unknown[]) {
      if (!isRecord(shortage) || typeof shortage.resource !== "string" ||
          !Number.isInteger(shortage.requested) || !Number.isInteger(shortage.available) ||
          !Number.isInteger(shortage.shortfall)) {
        return "a blocked-process shortage is malformed";
      }
    }
  }
  return null;
}

// ---- turning failures into plain sentences -------------------------------------

function httpErrorMessage(status: number, body: unknown): string {
  if (isRecord(body) && typeof body.message === "string" && body.message !== "") {
    return body.error === "validation_error" ? `The server rejected the input. ${body.message}` : body.message;
  }
  if (status >= 500) {
    return (
      `The server answered with HTTP ${status} and no readable message. ` +
      'If the Flask backend is not running, the Next.js proxy may report an error like this. ' +
      'Start it with "python app.py" and try again.'
    );
  }
  return `The server answered with HTTP ${status} and no readable message.`;
}

function isAbortError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "name" in error && error.name === "AbortError";
}

// ---- the request -----------------------------------------------------------------

export async function requestDetection(payload: DetectPayload): Promise<DetectOutcome> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(DETECT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      body = null; // the answer was not JSON
    }

    if (!response.ok) {
      return {
        kind: "error",
        title: "The server could not run detection.",
        detail: httpErrorMessage(response.status, body),
      };
    }
    const problem = checkResponse(body, payload);
    if (problem !== null) {
      return {
        kind: "error",
        title: "The server's answer could not be displayed.",
        detail: `Unexpected response: ${problem}.`,
      };
    }
    return { kind: "ok", result: body as DetectResponse };
  } catch (error) {
    if (isAbortError(error)) {
      return {
        kind: "error",
        title: "The server took too long to answer.",
        detail: `Waited ${REQUEST_TIMEOUT_MS / 1000} seconds. Try again.`,
      };
    }
    return {
      kind: "error",
      title: "Could not reach the server.",
      detail: 'Check that the Flask backend is running ("python app.py") and try again.',
    };
  } finally {
    clearTimeout(timer);
  }
}