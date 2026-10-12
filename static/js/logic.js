/*
 * logic.js: the page's "thinking" code, with NO access to the page (DOM).
 *
 * Because it never touches the page, it can be tested on its own (see
 * tests/js/logic.test.js). app.js uses it for everything that is not
 * drawing on the screen.
 *
 * Important: nothing here decides whether there is a deadlock. That is done
 * only by the Flask server (deadlock.py). This file just checks what the user
 * typed, builds the request, and checks that the server's answer has the
 * shape the page needs.
 */
(function (root) {
  "use strict";

  var MIN_COUNT = 1;
  var MAX_COUNT = 10;
  var STATUS_NO_DEADLOCK = "NO_DEADLOCK";
  var STATUS_DEADLOCK = "DEADLOCK_DETECTED";

  // ---- names -------------------------------------------------------------

  function processNames(n) {
    var names = [];
    for (var i = 1; i <= n; i++) names.push("P" + i);
    return names;
  }

  function resourceNames(m) {
    var names = [];
    for (var j = 1; j <= m; j++) names.push("R" + j);
    return names;
  }

  function formatVector(values) {
    return "[" + values.join(", ") + "]";
  }

  // ---- one typed value ---------------------------------------------------

  /**
   * Strictly read one cell. Only whole numbers 0, 1, 2, ... are accepted.
   * Nothing is repaired: "", "-1", "1.5", "abc", " 2", "1e3" are all rejected.
   * Returns {ok: true, value: n} or {ok: false, message: "..."}.
   */
  function parseCell(text) {
    if (typeof text !== "string" || text === "") {
      return { ok: false, message: "is blank. Enter 0 or a positive whole number." };
    }
    var shown = text.length > 12 ? text.slice(0, 12) + "..." : text;
    if (/^-\d+$/.test(text)) {
      return { ok: false, message: 'is "' + shown + '", which is negative. Use 0 or more.' };
    }
    if (/^\d*[.,]\d*$/.test(text) && /\d/.test(text)) {
      return { ok: false, message: 'is "' + shown + '", which is not a whole number. Use digits only.' };
    }
    if (!/^\d+$/.test(text)) {
      return { ok: false, message: 'is "' + shown + '", which is not a whole number. Use digits only, with no spaces.' };
    }
    var n = Number(text);
    if (!Number.isSafeInteger(n)) {
      return { ok: false, message: "is too large for this page. Use a number up to 9007199254740991." };
    }
    return { ok: true, value: n };
  }

  // ---- the form state ----------------------------------------------------
  // state = { p, r, available: [string], allocation: [[string]], request: [[string]] }
  // Cells are kept as the raw text the user typed, so nothing is silently fixed.

  function filledGrid(rows, cols, fill) {
    var grid = [];
    for (var i = 0; i < rows; i++) {
      var row = [];
      for (var j = 0; j < cols; j++) row.push(fill);
      grid.push(row);
    }
    return grid;
  }

  function emptyState(p, r) {
    return {
      p: p,
      r: r,
      available: filledGrid(1, r, "0")[0],
      allocation: filledGrid(p, r, "0"),
      request: filledGrid(p, r, "0"),
    };
  }

  /** Change the size. Overlapping cells keep their typed text; new cells are "0". */
  function resizeState(state, p, r) {
    var next = emptyState(p, r);
    for (var j = 0; j < Math.min(r, state.r); j++) next.available[j] = state.available[j];
    for (var i = 0; i < Math.min(p, state.p); i++) {
      for (var k = 0; k < Math.min(r, state.r); k++) {
        next.allocation[i][k] = state.allocation[i][k];
        next.request[i][k] = state.request[i][k];
      }
    }
    return next;
  }

  function stateFromSample(sample) {
    function text(n) { return String(n); }
    return {
      p: sample.process_count,
      r: sample.resource_count,
      available: sample.available.map(text),
      allocation: sample.allocation.map(function (row) { return row.map(text); }),
      request: sample.request.map(function (row) { return row.map(text); }),
    };
  }

  // ---- checking the form before sending ----------------------------------

  /**
   * Check every cell. Returns {ok, errors, payload}.
   *  - errors: [{field, row, col, label, message}] (row/col are 0-based, or null)
   *  - payload: the JSON body for POST /api/detect, only when ok is true.
   * The server still validates everything again; this is for quick feedback.
   */
  function validateState(state) {
    var errors = [];
    var pNames = processNames(state.p);
    var rNames = resourceNames(state.r);

    function countProblem(name, value) {
      return !(Number.isInteger(value) && value >= MIN_COUNT && value <= MAX_COUNT);
    }
    if (countProblem("p", state.p)) {
      errors.push({ field: "process_count", row: null, col: null, label: "Processes",
        message: "Processes must be a whole number from " + MIN_COUNT + " to " + MAX_COUNT + "." });
    }
    if (countProblem("r", state.r)) {
      errors.push({ field: "resource_count", row: null, col: null, label: "Resource types",
        message: "Resource types must be a whole number from " + MIN_COUNT + " to " + MAX_COUNT + "." });
    }
    if (errors.length) return { ok: false, errors: errors, payload: null };

    // The grid must match the chosen size exactly. Never send a ragged matrix.
    var shapeOk = state.available.length === state.r &&
      state.allocation.length === state.p && state.request.length === state.p &&
      state.allocation.every(function (row) { return row.length === state.r; }) &&
      state.request.every(function (row) { return row.length === state.r; });
    if (!shapeOk) {
      return { ok: false, payload: null, errors: [{ field: "grid", row: null, col: null, label: "Grid",
        message: "The grid does not match the chosen number of processes and resource types. Change the size again." }] };
    }

    var available = [];
    var allocation = [];
    var request = [];

    state.available.forEach(function (text, j) {
      var parsed = parseCell(text);
      var label = "Available " + rNames[j];
      if (parsed.ok) available.push(parsed.value);
      else errors.push({ field: "available", row: 0, col: j, label: label, message: label + " " + parsed.message });
    });

    function readMatrix(field, title, rows, target) {
      rows.forEach(function (rowTexts, i) {
        var row = [];
        rowTexts.forEach(function (text, j) {
          var parsed = parseCell(text);
          var label = title + " " + pNames[i] + ", " + rNames[j];
          if (parsed.ok) row.push(parsed.value);
          else errors.push({ field: field, row: i, col: j, label: label, message: label + " " + parsed.message });
        });
        target.push(row);
      });
    }
    readMatrix("allocation", "Allocation", state.allocation, allocation);
    readMatrix("request", "Request", state.request, request);

    if (errors.length) return { ok: false, errors: errors, payload: null };
    return {
      ok: true,
      errors: [],
      payload: {
        process_count: state.p,
        resource_count: state.r,
        allocation: allocation,
        request: request,
        available: available,
      },
    };
  }

  // ---- checking the server's answer --------------------------------------

  function isArray(x) { return Array.isArray(x); }
  function isPlainObject(x) { return x !== null && typeof x === "object" && !Array.isArray(x); }
  function isNumberArray(x, length) {
    return isArray(x) && x.length === length && x.every(Number.isInteger);
  }

  /**
   * Make sure a "successful" response really has what the page needs to draw it.
   * Returns null when fine, or a short reason string when not.
   */
  function checkResponse(body, payload) {
    try {
      if (!isPlainObject(body)) return "the answer is not a JSON object";
      if (body.success !== true) return "the answer is missing success: true";
      if (body.status !== STATUS_NO_DEADLOCK && body.status !== STATUS_DEADLOCK) return "unknown status";
      if (typeof body.message !== "string") return "missing message";
      if (typeof body.stop_reason !== "string") return "missing stop_reason";
      if (body.process_count !== payload.process_count || body.resource_count !== payload.resource_count) {
        return "the answer is for a different system size than the one sent";
      }
      var listKeys = ["deadlocked_processes", "finished_processes", "completion_sequence",
                      "initially_finished", "trace"];
      for (var k = 0; k < listKeys.length; k++) {
        if (!isArray(body[listKeys[k]])) return "missing list " + listKeys[k];
      }
      var m = payload.resource_count;
      if (!isNumberArray(body.initial_work, m) || !isNumberArray(body.final_work, m)) {
        return "initial_work or final_work has the wrong length";
      }
      if (!isPlainObject(body.finish_status) || !isPlainObject(body.blocked_explanations)) {
        return "missing finish_status or blocked_explanations";
      }
      var names = processNames(payload.process_count);
      var everyoneKnown = names.every(function (name) { return typeof body.finish_status[name] === "boolean"; });
      if (!everyoneKnown) return "finish_status does not list every process";
      var listed = body.finished_processes.concat(body.deadlocked_processes);
      if (listed.length !== names.length || !names.every(function (n) { return listed.indexOf(n) !== -1; })) {
        return "finished and deadlocked lists do not cover every process exactly once";
      }
      var statusMatches = (body.status === STATUS_DEADLOCK) === (body.deadlocked_processes.length > 0);
      if (!statusMatches) return "status disagrees with the deadlocked list";

      for (var t = 0; t < body.trace.length; t++) {
        var step = body.trace[t];
        if (!isPlainObject(step) || !Number.isInteger(step.iteration) ||
            !isNumberArray(step.work_before, m) || !isNumberArray(step.work_after, m) ||
            !isPlainObject(step.finish_before) || !isArray(step.considered)) {
          return "trace step " + (t + 1) + " is malformed";
        }
        for (var c = 0; c < step.considered.length; c++) {
          var item = step.considered[c];
          if (!isPlainObject(item) || typeof item.process !== "string" ||
              !isNumberArray(item.request, m) || typeof item.can_satisfy !== "boolean") {
            return "trace step " + (t + 1) + " has a malformed entry";
          }
        }
        if (step.selected !== null &&
            (typeof step.selected !== "string" || !isNumberArray(step.allocation_released, m) ||
             !isNumberArray(step.selected_request, m))) {
          return "trace step " + (t + 1) + " is missing release details";
        }
      }
      for (var d = 0; d < body.deadlocked_processes.length; d++) {
        var info = body.blocked_explanations[body.deadlocked_processes[d]];
        if (!isPlainObject(info) || typeof info.explanation !== "string" || !isArray(info.shortages) ||
            !isNumberArray(info.request, m) || !isNumberArray(info.allocation, m)) {
          return "a blocked-process explanation is malformed";
        }
      }
      return null;
    } catch (err) {
      return err.message;
    }
  }

  /** A plain-language message for a failed HTTP answer. */
  function errorMessage(httpStatus, body) {
    if (isPlainObject(body) && typeof body.message === "string" && body.message) {
      if (body.error === "validation_error") return "The server rejected the input. " + body.message;
      return body.message;
    }
    return "The server answered with HTTP " + httpStatus + " and no readable message.";
  }

  /**
   * Label every process for the summary strip.
   * kind: "initial" (held nothing, finished at the start), "completed"
   * (finished during detection; step = its position), or "deadlocked".
   * Looks processes up by name, so it does not depend on object key order
   * (the server sorts JSON keys alphabetically, so P10 comes before P2).
   */
  function classifyProcesses(result) {
    return processNames(result.process_count).map(function (name) {
      if (result.deadlocked_processes.indexOf(name) !== -1) return { name: name, kind: "deadlocked", step: null };
      var at = result.completion_sequence.indexOf(name);
      if (at !== -1) return { name: name, kind: "completed", step: at + 1 };
      return { name: name, kind: "initial", step: null };
    });
  }

  var api = {
    MIN_COUNT: MIN_COUNT,
    MAX_COUNT: MAX_COUNT,
    STATUS_NO_DEADLOCK: STATUS_NO_DEADLOCK,
    STATUS_DEADLOCK: STATUS_DEADLOCK,
    processNames: processNames,
    resourceNames: resourceNames,
    formatVector: formatVector,
    parseCell: parseCell,
    emptyState: emptyState,
    resizeState: resizeState,
    stateFromSample: stateFromSample,
    validateState: validateState,
    checkResponse: checkResponse,
    errorMessage: errorMessage,
    classifyProcesses: classifyProcesses,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api; // used by the Node tests
  } else {
    root.DeadlockLogic = api; // used by the browser
  }
})(typeof window !== "undefined" ? window : this);
