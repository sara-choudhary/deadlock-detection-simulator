// Pure helpers for the simulator's input form. No React, no network.
//
// The form keeps every cell as the raw TEXT the user typed, so nothing is
// silently "fixed" (for example "abc" is reported, not turned into 0).
// validateInputs() turns the text into the JSON body that Flask's
// POST /api/detect expects. Nothing in this file sends that body anywhere yet.

export const MIN_COUNT = 1;
export const MAX_COUNT = 10;
export const DEFAULT_PROCESSES = 3;
export const DEFAULT_RESOURCES = 3;

export type FieldName = "available" | "allocation" | "request";

export type InputState = {
  processCount: number;
  resourceCount: number;
  available: string[]; // one entry per resource type
  allocation: string[][]; // processCount rows x resourceCount columns
  request: string[][]; // processCount rows x resourceCount columns
};

// The exact request body of POST /api/detect.
export type DetectPayload = {
  process_count: number;
  resource_count: number;
  available: number[];
  allocation: number[][];
  request: number[][];
};

export type CellError = {
  field: FieldName;
  row: number; // 0-based (always 0 for "available")
  col: number; // 0-based
  message: string; // a full, readable sentence
};

// ---- labels ---------------------------------------------------------------

export function processNames(count: number): string[] {
  return Array.from({ length: count }, (_, i) => `P${i + 1}`);
}

export function resourceNames(count: number): string[] {
  return Array.from({ length: count }, (_, i) => `R${i + 1}`);
}

// ---- building and resizing the state --------------------------------------

function zeroGrid(rows: number, cols: number): string[][] {
  return Array.from({ length: rows }, () => Array.from({ length: cols }, () => "0"));
}

export function defaultInputs(): InputState {
  return {
    processCount: DEFAULT_PROCESSES,
    resourceCount: DEFAULT_RESOURCES,
    available: Array.from({ length: DEFAULT_RESOURCES }, () => "0"),
    allocation: zeroGrid(DEFAULT_PROCESSES, DEFAULT_RESOURCES),
    request: zeroGrid(DEFAULT_PROCESSES, DEFAULT_RESOURCES),
  };
}

// Change the size. Cells that still exist keep what the user typed;
// new cells start as "0". The old state is never modified.
export function resizeInputs(state: InputState, processCount: number, resourceCount: number): InputState {
  const keep = (old: string[][], i: number, j: number) => (old[i] !== undefined && old[i][j] !== undefined ? old[i][j] : "0");
  return {
    processCount,
    resourceCount,
    available: Array.from({ length: resourceCount }, (_, j) => (state.available[j] !== undefined ? state.available[j] : "0")),
    allocation: Array.from({ length: processCount }, (_, i) => Array.from({ length: resourceCount }, (_, j) => keep(state.allocation, i, j))),
    request: Array.from({ length: processCount }, (_, i) => Array.from({ length: resourceCount }, (_, j) => keep(state.request, i, j))),
  };
}

// Return a copy of the state with one cell replaced.
export function setCell(state: InputState, field: FieldName, row: number, col: number, value: string): InputState {
  if (field === "available") {
    return { ...state, available: state.available.map((v, j) => (j === col ? value : v)) };
  }
  return {
    ...state,
    [field]: state[field].map((r, i) => (i === row ? r.map((v, j) => (j === col ? value : v)) : r)),
  };
}

// True when the form is exactly the default (so "Reset" has nothing to do).
export function isDefaultInputs(state: InputState): boolean {
  if (state.processCount !== DEFAULT_PROCESSES || state.resourceCount !== DEFAULT_RESOURCES) return false;
  const allZero = (cells: string[]) => cells.every((v) => v === "0");
  return allZero(state.available) && state.allocation.every(allZero) && state.request.every(allZero);
}

// ---- checking one typed value ----------------------------------------------

export type CellResult = { ok: true; value: number } | { ok: false; problem: string };

// Strict: only whole numbers 0, 1, 2, ... written as plain digits are accepted.
// Nothing is repaired: "", "-1", "1.5", "abc", " 2", "1e3" are all rejected.
// (These are the same rules, and nearly the same wording, as the original page.)
export function parseCell(text: string): CellResult {
  if (text === "") return { ok: false, problem: "is blank. Enter 0 or a positive whole number." };
  const shown = text.length > 12 ? `${text.slice(0, 12)}...` : text;
  if (/^-\d+$/.test(text)) return { ok: false, problem: `is "${shown}", which is negative. Use 0 or more.` };
  if (/^\d*[.,]\d*$/.test(text) && /\d/.test(text)) {
    return { ok: false, problem: `is "${shown}", which is not a whole number. Use digits only.` };
  }
  if (!/^\d+$/.test(text)) {
    return { ok: false, problem: `is "${shown}", which is not a whole number. Use digits only, with no spaces.` };
  }
  const value = Number(text);
  if (!Number.isSafeInteger(value)) {
    return { ok: false, problem: `is too large for this page. Use a number up to ${Number.MAX_SAFE_INTEGER}.` };
  }
  return { ok: true, value };
}

// ---- checking the whole form -------------------------------------------------

export type Validation = {
  errors: CellError[];
  payload: DetectPayload | null; // present only when there are no errors
};

// This is a convenience for the user. Flask validates everything again.
export function validateInputs(state: InputState): Validation {
  const errors: CellError[] = [];
  const rNames = resourceNames(state.resourceCount);
  const pNames = processNames(state.processCount);

  const available: number[] = [];
  state.available.forEach((text, col) => {
    const result = parseCell(text);
    if (result.ok) available.push(result.value);
    else errors.push({ field: "available", row: 0, col, message: `Available ${rNames[col]} ${result.problem}` });
  });

  const readMatrix = (field: "allocation" | "request", title: string): number[][] =>
    state[field].map((rowTexts, row) =>
      rowTexts.map((text, col) => {
        const result = parseCell(text);
        if (result.ok) return result.value;
        errors.push({ field, row, col, message: `${title} ${pNames[row]}, ${rNames[col]} ${result.problem}` });
        return 0;
      }),
    );
  const allocation = readMatrix("allocation", "Allocation");
  const request = readMatrix("request", "Request");

  if (errors.length > 0) return { errors, payload: null };
  return {
    errors,
    payload: {
      process_count: state.processCount,
      resource_count: state.resourceCount,
      available,
      allocation,
      request,
    },
  };
}

// Key used to look up the error for one cell.
export function cellKey(field: FieldName, row: number, col: number): string {
  return `${field}:${row}:${col}`;
}