/*
 * Tests for static/js/logic.js (the page's checking code, which never touches
 * the page itself). Uses only Node's built-in test runner; nothing to install.
 *
 *   node --test tests/js/logic.test.js
 *
 * Needs Node 18 or newer. pytest runs this file for you when Node is installed
 * (see tests/test_frontend.py), and skips it when it is not.
 *
 * These tests do not and cannot check the deadlock answer: that only comes
 * from the Flask server. They check what the page sends and how it reads
 * what comes back.
 */
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const L = require("../../static/js/logic.js");

// Load the sample list the same way a browser would (it sets window.DEADLOCK_SAMPLES).
function loadSamples() {
  const sandbox = { window: {} };
  const source = fs.readFileSync(path.join(__dirname, "../../static/js/samples.js"), "utf8");
  vm.runInNewContext(source, sandbox);
  // Round-trip through JSON so the arrays belong to this realm (strict deepEqual
  // compares prototypes, and arrays made inside vm have a different one).
  return JSON.parse(JSON.stringify(sandbox.window.DEADLOCK_SAMPLES));
}

function fixture(name) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", name + ".json"), "utf8"));
}

function stateWith(p, r, edits) {
  const state = L.emptyState(p, r);
  (edits || []).forEach(function (e) {
    if (e.field === "available") state.available[e.col] = e.text;
    else state[e.field][e.row][e.col] = e.text;
  });
  return state;
}

// ---- names -----------------------------------------------------------------

test("process and resource names are P1.. and R1..", () => {
  assert.deepEqual(L.processNames(3), ["P1", "P2", "P3"]);
  assert.deepEqual(L.resourceNames(2), ["R1", "R2"]);
  assert.equal(L.processNames(10)[9], "P10");
});

// ---- parseCell: strict, nothing repaired ------------------------------------

test("parseCell accepts whole numbers 0 or more", () => {
  ["0", "1", "7", "10", "007", "9007199254740991"].forEach((text) => {
    const r = L.parseCell(text);
    assert.equal(r.ok, true, text);
    assert.equal(r.value, Number(text));
  });
});

test("parseCell rejects blank, negative, fractional and non-numeric text", () => {
  const bad = ["", "-1", "-0", "1.5", "2.0", ".5", "1,5", "abc", " 2", "2 ", "1e3",
               "+1", "0x10", "NaN", "Infinity", "--1", "1-", "１" /* full-width 1 */];
  bad.forEach((text) => {
    const r = L.parseCell(text);
    assert.equal(r.ok, false, JSON.stringify(text));
    assert.equal(typeof r.message, "string");
    assert.ok(r.message.length > 0);
  });
});

test("parseCell rejects non-strings and numbers beyond JavaScript's safe range", () => {
  [null, undefined, 3, true, []].forEach((value) => assert.equal(L.parseCell(value).ok, false));
  assert.equal(L.parseCell("9007199254740993").ok, false);
});

test("parseCell messages name the problem", () => {
  assert.match(L.parseCell("").message, /blank/);
  assert.match(L.parseCell("-4").message, /negative/);
  assert.match(L.parseCell("1.5").message, /whole number/);
  assert.match(L.parseCell("abc").message, /whole number/);
});

// ---- dimensions --------------------------------------------------------------

test("emptyState builds p rows and r columns of '0'", () => {
  const s = L.emptyState(3, 2);
  assert.equal(s.p, 3);
  assert.equal(s.r, 2);
  assert.deepEqual(s.available, ["0", "0"]);
  assert.equal(s.allocation.length, 3);
  assert.equal(s.request.length, 3);
  s.allocation.concat(s.request).forEach((row) => assert.deepEqual(row, ["0", "0"]));
});

test("rows are independent arrays (editing one cell changes only that cell)", () => {
  const s = L.emptyState(2, 2);
  s.allocation[0][0] = "5";
  assert.equal(s.allocation[1][0], "0");
  assert.equal(s.request[0][0], "0");
});

test("growing keeps typed values and fills new cells with '0'", () => {
  const s = stateWith(2, 2, [
    { field: "available", col: 1, text: "4" },
    { field: "allocation", row: 1, col: 0, text: "3" },
    { field: "request", row: 0, col: 1, text: "2" },
  ]);
  const g = L.resizeState(s, 3, 3);
  assert.equal(g.p, 3);
  assert.equal(g.r, 3);
  assert.deepEqual(g.available, ["0", "4", "0"]);
  assert.deepEqual(g.allocation, [["0", "0", "0"], ["3", "0", "0"], ["0", "0", "0"]]);
  assert.deepEqual(g.request, [["0", "2", "0"], ["0", "0", "0"], ["0", "0", "0"]]);
});

test("shrinking drops the removed rows and columns and keeps the rest", () => {
  const s = stateWith(3, 3, [
    { field: "allocation", row: 0, col: 0, text: "1" },
    { field: "allocation", row: 2, col: 2, text: "9" },
    { field: "available", col: 2, text: "8" },
  ]);
  const small = L.resizeState(s, 2, 2);
  assert.deepEqual(small.allocation, [["1", "0"], ["0", "0"]]);
  assert.deepEqual(small.available, ["0", "0"]);
  assert.equal(small.request.length, 2);
});

test("resizing does not clean up invalid text the user typed", () => {
  const s = stateWith(2, 2, [{ field: "allocation", row: 0, col: 0, text: "abc" }]);
  const g = L.resizeState(s, 3, 2);
  assert.equal(g.allocation[0][0], "abc");
  assert.equal(L.validateState(g).ok, false);
});

test("resizing never mutates the old state", () => {
  const s = stateWith(2, 2, [{ field: "request", row: 1, col: 1, text: "6" }]);
  const before = JSON.stringify(s);
  L.resizeState(s, 4, 4);
  assert.equal(JSON.stringify(s), before);
});

test("every size from 1x1 to 10x10 resizes to a rectangular, valid grid", () => {
  for (let p = 1; p <= 10; p++) {
    for (let r = 1; r <= 10; r++) {
      const s = L.resizeState(L.emptyState(2, 2), p, r);
      const check = L.validateState(s);
      assert.equal(check.ok, true, p + "x" + r);
      assert.equal(check.payload.allocation.length, p);
      assert.ok(check.payload.allocation.every((row) => row.length === r));
      assert.equal(check.payload.available.length, r);
    }
  }
});

// ---- validateState and the request payload ---------------------------------------

test("a valid state produces exactly the five fields the API expects", () => {
  const s = stateWith(2, 3, [
    { field: "available", col: 0, text: "1" },
    { field: "allocation", row: 0, col: 1, text: "2" },
    { field: "request", row: 1, col: 2, text: "3" },
  ]);
  const check = L.validateState(s);
  assert.equal(check.ok, true);
  assert.deepEqual(Object.keys(check.payload).sort(),
    ["allocation", "available", "process_count", "request", "resource_count"]);
  assert.deepEqual(check.payload, {
    process_count: 2,
    resource_count: 3,
    available: [1, 0, 0],
    allocation: [[0, 2, 0], [0, 0, 0]],
    request: [[0, 0, 0], [0, 0, 3]],
  });
});

test("payload values are real JSON numbers, not strings", () => {
  const check = L.validateState(stateWith(1, 1, [{ field: "available", col: 0, text: "5" }]));
  assert.equal(typeof check.payload.available[0], "number");
  assert.equal(typeof check.payload.process_count, "number");
  assert.equal(JSON.stringify(check.payload).includes('"5"'), false);
});

test("blank, negative, fractional and non-numeric cells block sending", () => {
  ["", "-1", "1.5", "abc"].forEach((text) => {
    const check = L.validateState(stateWith(2, 2, [{ field: "request", row: 1, col: 0, text: text }]));
    assert.equal(check.ok, false, JSON.stringify(text));
    assert.equal(check.payload, null);
    assert.equal(check.errors.length, 1);
    assert.deepEqual(
      [check.errors[0].field, check.errors[0].row, check.errors[0].col],
      ["request", 1, 0]);
    assert.match(check.errors[0].message, /^Request P2, R1 /);
  });
});

test("every bad cell is reported, in all three grids", () => {
  const check = L.validateState(stateWith(2, 2, [
    { field: "available", col: 1, text: "" },
    { field: "allocation", row: 0, col: 0, text: "-2" },
    { field: "request", row: 1, col: 1, text: "x" },
  ]));
  assert.equal(check.ok, false);
  assert.deepEqual(check.errors.map((e) => e.field).sort(), ["allocation", "available", "request"]);
  assert.match(check.errors.find((e) => e.field === "available").message, /^Available R2 /);
});

test("a grid that does not match the chosen size is never sent", () => {
  const ragged = L.emptyState(2, 2);
  ragged.allocation[1] = ["0"];
  assert.equal(L.validateState(ragged).ok, false);

  const missingRow = L.emptyState(3, 2);
  missingRow.request.pop();
  assert.equal(L.validateState(missingRow).ok, false);

  const shortVector = L.emptyState(2, 3);
  shortVector.available.pop();
  assert.equal(L.validateState(shortVector).ok, false);
});

test("counts outside 1..10 or not whole numbers are rejected", () => {
  [0, 11, -1, 2.5, NaN].forEach((bad) => {
    const s = L.emptyState(2, 2);
    s.p = bad;
    const check = L.validateState(s);
    assert.equal(check.ok, false, String(bad));
    assert.equal(check.errors[0].field, "process_count");
  });
  const s = L.emptyState(2, 2);
  s.r = 11;
  assert.equal(L.validateState(s).errors[0].field, "resource_count");
});

// ---- samples -------------------------------------------------------------------------

test("samples are inputs only and load into valid states", () => {
  const samples = loadSamples();
  assert.ok(samples.length >= 5);
  const ids = new Set();
  samples.forEach((sample) => {
    assert.ok(!ids.has(sample.id), "duplicate id " + sample.id);
    ids.add(sample.id);
    assert.deepEqual(Object.keys(sample).sort(),
      ["allocation", "available", "description", "id", "name", "process_count", "request", "resource_count"]);
    const state = L.stateFromSample(sample);
    const check = L.validateState(state);
    assert.equal(check.ok, true, sample.id);
    assert.deepEqual(check.payload, {
      process_count: sample.process_count,
      resource_count: sample.resource_count,
      allocation: sample.allocation,
      request: sample.request,
      available: sample.available,
    });
  });
});

// ---- reading the server's answer ----------------------------------------------------------

["no_deadlock_case_a", "deadlock_case_c_mixed"].forEach((name) => {
  test("checkResponse accepts a real server answer: " + name, () => {
    const f = fixture(name);
    assert.equal(L.checkResponse(f.response, f.payload), null);
  });
});

test("checkResponse rejects answers that are not the expected shape", () => {
  const f = fixture("deadlock_case_c_mixed");
  const clone = () => JSON.parse(JSON.stringify(f.response));
  const mutations = {
    "not an object": () => [1, 2],
    "null": () => null,
    "success false": (r) => { r.success = false; return r; },
    "unknown status": (r) => { r.status = "MAYBE"; return r; },
    "missing message": (r) => { delete r.message; return r; },
    "missing stop_reason": (r) => { delete r.stop_reason; return r; },
    "wrong process_count": (r) => { r.process_count = 9; return r; },
    "missing trace": (r) => { delete r.trace; return r; },
    "short final_work": (r) => { r.final_work = [1]; return r; },
    "string in initial_work": (r) => { r.initial_work = ["0", "1"]; return r; },
    "missing finish_status entry": (r) => { delete r.finish_status.P2; return r; },
    "status disagrees with list": (r) => { r.status = "NO_DEADLOCK"; return r; },
    "process listed twice": (r) => { r.finished_processes.push("P2"); return r; },
    "malformed trace step": (r) => { r.trace[0].work_after = "x"; return r; },
    "malformed considered entry": (r) => { r.trace[0].considered[0].can_satisfy = "yes"; return r; },
    "selected without release": (r) => { delete r.trace[0].allocation_released; return r; },
    "blocked info missing": (r) => { delete r.blocked_explanations.P2; return r; },
  };
  Object.keys(mutations).forEach((label) => {
    const problem = L.checkResponse(mutations[label](clone()), f.payload);
    assert.equal(typeof problem, "string", label + " should be rejected");
  });
});

test("checkResponse never throws on garbage", () => {
  const payload = fixture("no_deadlock_case_a").payload;
  [undefined, "text", 5, {}, { success: true }, { trace: null }].forEach((garbage) => {
    assert.equal(typeof L.checkResponse(garbage, payload), "string");
  });
});

// ---- error messages --------------------------------------------------------------------------

test("errorMessage uses the server's message, and falls back when there is none", () => {
  assert.equal(
    L.errorMessage(400, { success: false, error: "validation_error", message: "allocation must have 2 rows, got 1." }),
    "The server rejected the input. allocation must have 2 rows, got 1.");
  assert.equal(L.errorMessage(415, { error: "unsupported_media_type", message: "Content-Type must be application/json." }),
    "Content-Type must be application/json.");
  assert.match(L.errorMessage(500, null), /HTTP 500/);
  assert.match(L.errorMessage(502, "<html>Bad gateway</html>"), /HTTP 502/);
  assert.match(L.errorMessage(404, {}), /HTTP 404/);
});

// ---- summary labels ------------------------------------------------------------------------------

test("classifyProcesses labels each process by name, not by object key order", () => {
  const result = fixture("deadlock_case_c_mixed").response;
  assert.deepEqual(L.classifyProcesses(result), [
    { name: "P1", kind: "completed", step: 1 },
    { name: "P2", kind: "deadlocked", step: null },
    { name: "P3", kind: "deadlocked", step: null },
  ]);

  const ten = {
    process_count: 10,
    deadlocked_processes: [],
    completion_sequence: ["P10", "P9", "P8", "P7", "P6", "P5", "P4", "P3", "P2"],
  };
  const labels = L.classifyProcesses(ten);
  assert.deepEqual(labels.map((l) => l.name), L.processNames(10));
  assert.equal(labels[9].kind, "completed");
  assert.equal(labels[9].step, 1);
  assert.equal(labels[0].kind, "initial");
});
