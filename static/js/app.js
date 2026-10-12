/*
 * app.js: draws the page and talks to the server.
 *
 * The deadlock answer always comes from POST /api/detect. Nothing in this
 * file works out who is deadlocked. It reads the inputs, sends them, and
 * displays what the server sends back.
 *
 * All text from the user or the server is put on the page with textContent
 * (through the el() helper), never as HTML.
 *
 * Needs logic.js and samples.js to be loaded first.
 */
(function () {
  "use strict";

  const L = window.DeadlockLogic;
  const SAMPLES = window.DEADLOCK_SAMPLES || [];
  const DEFAULT_SAMPLE_ID = "deadlock-with-independent";
  const REQUEST_TIMEOUT_MS = 15000;

  // ---- page state ----------------------------------------------------------
  let state = L.emptyState(2, 2); // what is in the grids (raw text)
  let busy = false;               // true while a request is in flight
  let hasResult = false;          // true while a result is on screen
  let editedWhileBusy = false;    // true if a cell changed after the request was sent
  let baseline = null;            // the loaded example's values (as text), to spot edits
  let baselineName = "";          // the loaded example's name

  const THEME_KEY = "dds-theme";

  const $ = (id) => document.getElementById(id);

  /** Build an element. Text always goes in as plain text. */
  function el(tag, options, children) {
    const node = document.createElement(tag);
    const opts = options || {};
    if (opts.className) node.className = opts.className;
    if (opts.text !== undefined) node.textContent = String(opts.text);
    if (opts.attrs) {
      Object.keys(opts.attrs).forEach((name) => node.setAttribute(name, opts.attrs[name]));
    }
    (children || []).forEach((child) => { if (child) node.appendChild(child); });
    return node;
  }

  // ---- the input grids -----------------------------------------------------

  // ---- user data versus loaded example data --------------------------------

  /** True when this cell differs from the loaded example (a cell the example lacks counts as edited unless it is 0). */
  function cellIsEdited(field, row, col, value) {
    const text = String(value).trim();
    if (!baseline) return false;
    let original;
    if (field === "available") original = baseline.available[col];
    else original = baseline[field][row] ? baseline[field][row][col] : undefined;
    if (original === undefined) return text !== "0";
    return text !== original;
  }

  function stateDiffersFromExample() {
    if (!baseline) return false;
    if (state.p !== baseline.p || state.r !== baseline.r) return true;
    for (let j = 0; j < state.r; j++) {
      if (cellIsEdited("available", 0, j, state.available[j])) return true;
    }
    for (let i = 0; i < state.p; i++) {
      for (let j = 0; j < state.r; j++) {
        if (cellIsEdited("allocation", i, j, state.allocation[i][j])) return true;
        if (cellIsEdited("request", i, j, state.request[i][j])) return true;
      }
    }
    return false;
  }

  function updateDataSource() {
    const tag = $("data-source");
    if (!baseline) {
      tag.textContent = "Your own values";
      tag.className = "tag tag-edited";
    } else if (stateDiffersFromExample()) {
      tag.textContent = "Edited: differs from the example \u201c" + baselineName + "\u201d";
      tag.className = "tag tag-edited";
    } else {
      tag.textContent = "Loaded example: " + baselineName;
      tag.className = "tag tag-example";
    }
  }

  function cellInput(field, row, col, title) {
    const input = el("input", {
      className: "cell",
      attrs: {
        type: "text",             // text, not number: a number box would silently turn "abc" into ""
        inputmode: "numeric",
        autocomplete: "off",
        spellcheck: "false",
        "aria-label": title,
        "data-field": field,
        "data-row": String(row),
        "data-col": String(col),
      },
    });
    input.value = field === "available" ? state.available[col] : state[field][row][col];
    input.classList.toggle("is-edited", cellIsEdited(field, row, col, input.value));
    input.addEventListener("focus", () => input.select());
    input.addEventListener("input", () => {
      if (field === "available") state.available[col] = input.value;
      else state[field][row][col] = input.value;
      input.classList.toggle("is-edited", cellIsEdited(field, row, col, input.value));
      updateDataSource();
      input.removeAttribute("aria-invalid");
      input.removeAttribute("title");
      if (busy) editedWhileBusy = true; // the answer on its way will be for older numbers
      markStale();
    });
    return input;
  }

  function headerRow(corner, names) {
    const tr = el("tr", {}, [el("th", { text: corner, attrs: { scope: "col" } })]);
    names.forEach((name) => tr.appendChild(el("th", { text: name, attrs: { scope: "col" } })));
    return el("thead", {}, [tr]);
  }

  function matrixTable(field, title) {
    const table = el("table", { className: "grid" });
    table.appendChild(el("caption", { text: title, className: "sr-only" }));
    table.appendChild(headerRow("", L.resourceNames(state.r)));
    const body = el("tbody");
    L.processNames(state.p).forEach((name, i) => {
      const tr = el("tr", {}, [el("th", { text: name, attrs: { scope: "row" } })]);
      for (let j = 0; j < state.r; j++) {
        const label = title + ": " + name + ", R" + (j + 1);
        tr.appendChild(el("td", {}, [cellInput(field, i, j, label)]));
      }
      body.appendChild(tr);
    });
    table.appendChild(body);
    return table;
  }

  function availableTable() {
    const table = el("table", { className: "grid" });
    table.appendChild(el("caption", { text: "Available", className: "sr-only" }));
    table.appendChild(headerRow("", L.resourceNames(state.r)));
    const tr = el("tr", {}, [el("th", { text: "Free", attrs: { scope: "row" } })]);
    for (let j = 0; j < state.r; j++) {
      tr.appendChild(el("td", {}, [cellInput("available", 0, j, "Available: R" + (j + 1))]));
    }
    table.appendChild(el("tbody", {}, [tr]));
    return table;
  }

  function replaceContent(container, child) {
    container.textContent = "";
    container.appendChild(child);
  }

  function renderGrids() {
    $("p-count").value = String(state.p);
    $("r-count").value = String(state.r);
    replaceContent($("available-grid"), availableTable());
    replaceContent($("allocation-grid"), matrixTable("allocation", "Allocation"));
    replaceContent($("request-grid"), matrixTable("request", "Request"));
    updateDataSource();
  }

  // ---- messages ------------------------------------------------------------

  function clearInputErrors() {
    const box = $("input-errors");
    box.hidden = true;
    box.textContent = "";
    document.querySelectorAll('input.cell[aria-invalid="true"]').forEach((input) => {
      input.removeAttribute("aria-invalid");
      input.removeAttribute("title");
    });
  }

  function showInputErrors(errors) {
    const box = $("input-errors");
    box.textContent = "";
    const heading = errors.length === 1 ? "Fix 1 value before running detection:" : "Fix " + errors.length + " values before running detection:";
    box.appendChild(el("strong", { text: heading }));
    const list = el("ul");
    errors.forEach((error) => list.appendChild(el("li", { text: error.message })));
    box.appendChild(list);
    box.hidden = false;
    errors.forEach((error) => {
      if (error.row === null) return;
      const selector = 'input.cell[data-field="' + error.field + '"][data-row="' + error.row + '"][data-col="' + error.col + '"]';
      const input = document.querySelector(selector);
      if (input) {
        input.setAttribute("aria-invalid", "true");
        input.setAttribute("title", error.message);
      }
    });
  }

  function clearApiError() {
    const box = $("api-error");
    box.hidden = true;
    box.textContent = "";
  }

  function showApiError(headline, detail) {
    const box = $("api-error");
    box.textContent = "";
    box.appendChild(el("strong", { text: headline }));
    if (detail) box.appendChild(el("span", { text: detail }));
    box.hidden = false;
  }

  function setRunStatus(text) {
    $("run-status").textContent = text;
  }

  // ---- busy / stale / clear ------------------------------------------------

  function setBusy(isBusy) {
    busy = isBusy;
    const button = $("detect-btn");
    button.disabled = isBusy;
    button.setAttribute("aria-busy", isBusy ? "true" : "false");
    $("detect-label").textContent = isBusy ? "Running detection" : "Detect deadlock";
    $("load-sample-btn").disabled = isBusy;
    $("reset-btn").disabled = isBusy;
    $("p-count").disabled = isBusy;
    $("r-count").disabled = isBusy;
  }

  function markStale() {
    if (!hasResult) return;
    $("results").classList.add("is-stale");
    $("stale-note").hidden = false;
  }

  function clearResults() {
    hasResult = false;
    $("results").textContent = "";
    $("results").classList.remove("is-stale");
    $("stale-note").hidden = true;
    $("results-section").hidden = true;
    $("clear-btn").disabled = true;
  }

  function clearEverythingAboutLastRun() {
    clearInputErrors();
    clearApiError();
    clearResults();
    setRunStatus("");
  }

  // ---- showing a result (every value comes from the server's answer) -------

  const SYM = { ok: "✓", bad: "✕", dim: "○", pick: "▶" };

  function vectorTable(values) {
    const table = el("table", { className: "vec" });
    table.appendChild(el("thead", {}, [el("tr", {}, L.resourceNames(values.length).map((n) => el("th", { text: n })))]));
    table.appendChild(el("tbody", {}, [el("tr", {}, values.map((v) => el("td", { text: v })))]));
    // Scrolls sideways inside its own box when there are many resource types.
    return el("div", { className: "scroll" }, [table]);
  }

  /** A chip: a symbol (decorative; the words carry the meaning), the process name, and words. */
  function chip(kindClass, symbol, name, words) {
    return el("li", { className: "chip " + kindClass }, [
      el("span", { className: "sym", text: symbol, attrs: { "aria-hidden": "true" } }),
      el("b", { text: name }),
      el("span", { text: words }),
    ]);
  }

  function processChips(result) {
    const list = el("ul", { className: "chips", attrs: { "aria-label": "Outcome for each process" } });
    L.classifyProcesses(result).forEach((p) => {
      if (p.kind === "deadlocked") list.appendChild(chip("chip-bad", SYM.bad, p.name, "deadlocked: cannot finish"));
      else if (p.kind === "completed") list.appendChild(chip("chip-ok", SYM.ok, p.name, "finishes at step " + p.step));
      else list.appendChild(chip("chip-wait", SYM.dim, p.name, "holds nothing: finished from the start"));
    });
    return list;
  }

  function fact(term, valueNode) {
    return [el("dt", { text: term }), el("dd", {}, [valueNode])];
  }

  function textNode(text, mono) {
    return el("span", { text: text, className: mono ? "mono" : "" });
  }

  function verdictBanner(result) {
    const bad = result.status === L.STATUS_DEADLOCK;
    const icon = el("span", { className: "verdict-icon", attrs: { "aria-hidden": "true" } }, [
      el("span", { text: bad ? SYM.bad : SYM.ok }),
    ]);
    return el("div", { className: "verdict " + (bad ? "verdict-bad" : "verdict-ok") }, [
      icon,
      el("div", {}, [
        el("h3", { text: bad ? "Deadlock detected" : "No deadlock detected" }),
        el("p", { text: result.message }),
      ]),
    ]);
  }

  /** The completion order, as a connected sequence: 1 P1 -> 2 P3 -> ... */
  function completionFlow(sequence) {
    if (!sequence.length) {
      return el("p", { className: "empty-flow", text: "None. No process finished during the scans." });
    }
    const list = el("ol", { className: "flow", attrs: { "aria-label": "Completion order" } });
    sequence.forEach((name, index) => {
      list.appendChild(el("li", {}, [
        el("span", { className: "node" }, [
          el("span", { className: "n", text: index + 1, attrs: { "aria-hidden": "true" } }),
          el("span", { className: "name", text: name }),
        ]),
      ]));
    });
    return list;
  }

  function outcomePanels(result) {
    const bad = result.status === L.STATUS_DEADLOCK;
    const grid = el("div", { className: "outcome-grid" });
    const finishedPanel = el("section", { className: "outcome outcome-ok" });
    finishedPanel.appendChild(el("h3", { text: "Completion order" }));
    finishedPanel.appendChild(completionFlow(result.completion_sequence));
    if (result.initially_finished.length) {
      finishedPanel.appendChild(el("p", {
        className: "note",
        text: "Finished from the start (they hold nothing): " + result.initially_finished.join(", ") + ".",
      }));
    }
    finishedPanel.appendChild(el("p", {
      className: "note",
      text: bad
        ? "These processes finished before the scan got stuck."
        : "Every process can finish in this order. It is one valid order for these numbers, not a guarantee about every possible schedule.",
    }));
    grid.appendChild(finishedPanel);

    if (bad) {
      const blockedPanel = el("section", { className: "outcome outcome-bad" });
      blockedPanel.appendChild(el("h3", { text: "Deadlocked (blocked) processes" }));
      const list = el("ul", { className: "chips", attrs: { "aria-label": "Deadlocked processes" } });
      result.deadlocked_processes.forEach((name) => list.appendChild(chip("chip-bad", SYM.bad, name, "cannot finish")));
      blockedPanel.appendChild(list);
      blockedPanel.appendChild(el("p", {
        className: "note",
        text: "Each one waits for resources that only other stuck processes hold.",
      }));
      grid.appendChild(blockedPanel);
    }
    return grid;
  }

  function summaryFacts(result) {
    const dl = el("dl", { className: "facts" });
    const rows = [
      fact("Finished from the start", textNode(result.initially_finished.length ? result.initially_finished.join(", ") : "None", true)),
      fact("Deadlocked", textNode(result.deadlocked_processes.length ? result.deadlocked_processes.join(", ") : "None", true)),
      fact("Work at the start", vectorTable(result.initial_work)),
      fact("Work at the end", vectorTable(result.final_work)),
      fact("Why it stopped", textNode(result.stop_reason, false)),
    ];
    rows.forEach((pair) => pair.forEach((node) => dl.appendChild(node)));
    return dl;
  }

  /** A small bar: how much of the request the final Work could cover. Decorative; the numbers are in the table. */
  function coverageMeter(requested, available) {
    const share = requested > 0 ? Math.max(0, Math.min(100, (available / requested) * 100)) : 100;
    const bar = el("i");
    bar.style.width = share + "%";
    return el("span", { className: "meter", attrs: { "aria-hidden": "true" } }, [bar]);
  }

  function blockedSection(result) {
    const wrap = el("div");
    wrap.appendChild(el("h3", { text: "Why these processes are stuck" }));
    const list = el("div", { className: "blocked-list" });
    result.deadlocked_processes.forEach((name) => {
      const info = result.blocked_explanations[name];
      const card = el("article", { className: "blocked" });
      card.appendChild(el("h4", {}, [
        el("span", { text: SYM.bad, attrs: { "aria-hidden": "true" } }),
        el("span", { className: "mono", text: name }),
      ]));
      card.appendChild(el("p", { text: info.explanation }));

      const table = el("table", { className: "data" });
      table.appendChild(el("thead", {}, [el("tr", {}, ["Resource", "Needs", "Available", "Short by", "Covered"].map((h, i) =>
        el("th", { text: h, className: i === 0 ? "left" : "" })))]));
      const body = el("tbody");
      info.shortages.forEach((s) => {
        body.appendChild(el("tr", {}, [
          el("th", { text: s.resource, className: "left", attrs: { scope: "row" } }),
          el("td", { text: s.requested }), el("td", { text: s.available }),
          el("td", { text: s.shortfall, className: "short-num" }),
          el("td", {}, [coverageMeter(s.requested, s.available)]),
        ]));
      });
      table.appendChild(body);
      card.appendChild(el("div", { className: "scroll" }, [table]));

      card.appendChild(el("div", { className: "pair" }, [
        el("div", {}, [el("span", { text: "Holds now" }), vectorTable(info.allocation)]),
        el("div", {}, [el("span", { text: "Still requests" }), vectorTable(info.request)]),
      ]));
      list.appendChild(card);
    });
    wrap.appendChild(list);
    return wrap;
  }

  // ---- the trace: one panel per scan, joined by a timeline -----------------

  function finishChips(step, names) {
    const list = el("ul", { className: "chips", attrs: { "aria-label": "Process states before this scan" } });
    names.forEach((name) => {
      const done = step.finish_before[name] === true;
      list.appendChild(chip(done ? "chip-ok" : "chip-wait", done ? SYM.ok : SYM.dim, name, done ? "finished" : "not finished"));
    });
    return list;
  }

  function checkedTable(step) {
    const table = el("table", { className: "data" });
    table.appendChild(el("thead", {}, [el("tr", {}, ["Process", "Request", "Fits in Work?", "Outcome"].map((h, i) =>
      el("th", { text: h, className: i === 0 ? "left" : "" })))]));
    const tbody = el("tbody");
    step.considered.forEach((item) => {
      const chosen = item.process === step.selected;
      const fits = el("td", { className: item.can_satisfy ? "yes" : "no" }, [
        el("span", { text: item.can_satisfy ? SYM.ok + " " : SYM.bad + " ", attrs: { "aria-hidden": "true" } }),
        el("span", { text: item.can_satisfy ? "Yes" : "No" }),
      ]);
      const outcome = el("td", { className: "left" }, chosen ? [
        el("span", { text: SYM.pick + " ", attrs: { "aria-hidden": "true" } }),
        el("span", { text: "Selected: lowest number that fits" }),
      ] : []);
      tbody.appendChild(el("tr", { className: chosen ? "is-selected" : "" }, [
        el("th", { text: item.process, className: "left", attrs: { scope: "row" } }),
        el("td", { text: L.formatVector(item.request), className: "mono" }),
        fits,
        outcome,
      ]));
    });
    table.appendChild(tbody);
    return el("div", { className: "scroll" }, [table]);
  }

  function figure(caption, values, extraClass) {
    return el("figure", { className: extraClass || "" }, [vectorTable(values), el("figcaption", { text: caption })]);
  }

  function scanCard(step, result, names) {
    const picked = step.selected !== null;
    const title = picked
      ? "Scan " + step.iteration + ": " + step.selected + " can finish"
      : "Scan " + step.iteration + ": no process can finish";
    const card = el("details", { className: "scan" + (picked ? "" : " scan-stop"), attrs: { open: "" } });
    const sub = picked
      ? "Work " + L.formatVector(step.work_before) + " → " + L.formatVector(step.work_after)
      : "Work " + L.formatVector(step.work_before) + " (unchanged, stop)";
    card.appendChild(el("summary", {}, [
      el("span", { className: "scan-title", text: title }),
      el("span", { className: "scan-sub", text: sub }),
    ]));

    const body = el("div", { className: "scan-body" });
    const section = (heading, node) => el("div", {}, [el("h5", { text: heading }), node]);

    body.appendChild(section("Process states before this scan", finishChips(step, names)));
    body.appendChild(section("Work before this scan", vectorTable(step.work_before)));
    body.appendChild(section("Unfinished processes checked, lowest number first", checkedTable(step)));

    if (picked) {
      body.appendChild(el("div", {}, [
        el("h5", { text: step.selected + " finishes and releases what it holds" }),
        el("div", { className: "equation" }, [
          figure("Work before", step.work_before),
          el("span", { className: "op", text: "+", attrs: { "aria-hidden": "true" } }),
          figure("Released by " + step.selected, step.allocation_released),
          el("span", { className: "op", text: "=", attrs: { "aria-hidden": "true" } }),
          figure("Work after this scan", step.work_after, "after"),
        ]),
      ]));
    } else {
      body.appendChild(el("p", { className: "stop-note", text: "Stop. " + result.stop_reason }));
    }
    card.appendChild(body);
    return card;
  }

  function traceSection(result) {
    const names = L.processNames(result.process_count);
    const count = result.trace.length;
    const wrap = el("section", { className: "trace", attrs: { "aria-labelledby": "h-trace" } });

    const head = el("div", { className: "trace-head" });
    head.appendChild(el("h3", { text: "Detection trace (" + count + (count === 1 ? " scan)" : " scans)"), attrs: { id: "h-trace" } }));
    if (count > 0) {
      const setAll = (open) => wrap.querySelectorAll("details.scan").forEach((d) => { d.open = open; });
      const expand = el("button", { className: "btn btn-quiet", text: "Expand all", attrs: { type: "button" } });
      const collapse = el("button", { className: "btn btn-quiet", text: "Collapse all", attrs: { type: "button" } });
      expand.addEventListener("click", () => setAll(true));
      collapse.addEventListener("click", () => setAll(false));
      head.appendChild(el("div", { className: "trace-tools" }, [expand, collapse]));
    }
    wrap.appendChild(head);
    wrap.appendChild(el("p", {
      className: "trace-intro",
      text: "Each panel is one scan, exactly as the server reported it, in order. Open a panel to see the Work vector, which unfinished processes fit, and what is released.",
    }));

    if (count === 0) {
      wrap.appendChild(el("p", { text: "No scans were needed. Every process held nothing, so every process started as finished." }));
      return wrap;
    }

    const timeline = el("ol", { className: "timeline" });
    result.trace.forEach((step) => {
      const picked = step.selected !== null;
      timeline.appendChild(el("li", {}, [
        el("span", { className: "marker" + (picked ? "" : " marker-stop"), text: picked ? step.iteration : SYM.bad, attrs: { "aria-hidden": "true" } }),
        scanCard(step, result, names),
      ]));
    });
    const last = result.trace[result.trace.length - 1];
    if (last.selected !== null) {
      // The scans ended because nothing was left unfinished.
      timeline.appendChild(el("li", {}, [
        el("span", { className: "marker marker-end", text: SYM.ok, attrs: { "aria-hidden": "true" } }),
        el("div", { className: "stop-end" }, [el("p", { text: "Stop. " + result.stop_reason })]),
      ]));
    }
    wrap.appendChild(timeline);
    return wrap;
  }

  function renderResult(result) {
    const bad = result.status === L.STATUS_DEADLOCK;
    const root = $("results");
    root.textContent = "";
    root.appendChild(verdictBanner(result));
    root.appendChild(outcomePanels(result));
    root.appendChild(processChips(result));
    root.appendChild(summaryFacts(result));
    if (bad) root.appendChild(blockedSection(result));
    root.appendChild(traceSection(result));
    root.appendChild(el("p", {
      className: "hint",
      text: "This describes only the numbers entered above. The completion order is one valid order, not a guarantee about every possible schedule.",
    }));

    root.classList.remove("is-stale");
    $("stale-note").hidden = true;
    $("results-section").hidden = false;
    hasResult = true;
    $("clear-btn").disabled = false;
  }

  // ---- talking to the server ----------------------------------------------

  async function onDetect() {
    if (busy) return; // ignore a second click while a request is running

    clearApiError();
    const check = L.validateState(state);
    clearInputErrors();
    if (!check.ok) {
      showInputErrors(check.errors);
      const first = document.querySelector('input.cell[aria-invalid="true"]');
      if (first) first.focus();
      setRunStatus("Nothing was sent. Fix the highlighted values first.");
      return;
    }

    setBusy(true);
    editedWhileBusy = false;
    clearResults();
    setRunStatus("Running detection...");

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch("/api/detect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(check.payload),
        signal: controller.signal,
      });
      let body = null;
      try { body = await response.json(); } catch (parseError) { body = null; }

      if (!response.ok) {
        showApiError("The server could not run detection.", L.errorMessage(response.status, body));
        setRunStatus("Detection failed.");
        return;
      }
      const problem = L.checkResponse(body, check.payload);
      if (problem) {
        showApiError("The server's answer could not be displayed.", "Unexpected response: " + problem + ".");
        setRunStatus("Detection failed.");
        return;
      }
      renderResult(body);
      if (editedWhileBusy) markStale(); // inputs changed while waiting: flag the result
      setRunStatus(body.status === L.STATUS_DEADLOCK ? "Done. Deadlock detected." : "Done. No deadlock detected.");
      $("results-section").scrollIntoView({ block: "start" });
    } catch (error) {
      if (error && error.name === "AbortError") {
        showApiError("The server took too long to answer.", "Waited " + REQUEST_TIMEOUT_MS / 1000 + " seconds. Try again.");
      } else {
        showApiError("Could not reach the server.", "Check that the app is still running (python app.py) and try again.");
      }
      setRunStatus("Detection failed.");
    } finally {
      clearTimeout(timer);
      setBusy(false);
    }
  }

  // ---- controls ------------------------------------------------------------

  function fillCountSelect(select) {
    for (let n = L.MIN_COUNT; n <= L.MAX_COUNT; n++) {
      select.appendChild(el("option", { text: n, attrs: { value: String(n) } }));
    }
  }

  function onSizeChange() {
    const p = Number($("p-count").value);
    const r = Number($("r-count").value);
    state = L.resizeState(state, p, r);
    clearInputErrors();
    clearApiError();
    renderGrids();
    markStale();
  }

  function findSample(id) {
    return SAMPLES.find((sample) => sample.id === id) || null;
  }

  function showSampleDescription() {
    const sample = findSample($("sample-select").value);
    $("sample-description").textContent = sample ? sample.description : "";
  }

  function loadSample(sample, announce) {
    state = L.stateFromSample(sample);
    baseline = L.stateFromSample(sample); // a separate copy, so edits never change it
    baselineName = sample.name;
    clearEverythingAboutLastRun();
    renderGrids();
    $("sample-select").value = sample.id;
    showSampleDescription();
    setRunStatus(announce + ' "' + sample.name + '". Edit anything, then run detection.');
  }

  function onLoadSample() {
    const sample = findSample($("sample-select").value);
    if (!sample) {
      setRunStatus("Choose an example first.");
      return;
    }
    loadSample(sample, "Loaded");
  }

  function onReset() {
    const sample = findSample(DEFAULT_SAMPLE_ID) || SAMPLES[0];
    if (sample) {
      loadSample(sample, "Reset to");
    } else {
      state = L.emptyState(2, 2);
      baseline = null;
      clearEverythingAboutLastRun();
      renderGrids();
      setRunStatus("Reset. All values are 0.");
    }
  }

  // ---- theme ---------------------------------------------------------------

  function currentTheme() {
    return document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    const button = $("theme-toggle");
    // The button names the theme you will get by pressing it.
    const next = theme === "dark" ? "light" : "dark";
    button.setAttribute("aria-label", "Switch to " + next + " theme");
    $("theme-toggle-text").textContent = next === "dark" ? "Dark" : "Light";
  }

  function onThemeToggle() {
    const next = currentTheme() === "dark" ? "light" : "dark";
    applyTheme(next);
    try { window.localStorage.setItem(THEME_KEY, next); } catch (e) { /* storage blocked: the choice lasts until reload */ }
  }

  function initTheme() {
    applyTheme(currentTheme()); // the inline script in <head> already chose it
    $("theme-toggle").addEventListener("click", onThemeToggle);
    if (window.matchMedia) {
      const media = window.matchMedia("(prefers-color-scheme: dark)");
      const follow = (event) => {
        let saved = null;
        try { saved = window.localStorage.getItem(THEME_KEY); } catch (e) { saved = null; }
        if (saved !== "light" && saved !== "dark") applyTheme(event.matches ? "dark" : "light");
      };
      if (media.addEventListener) media.addEventListener("change", follow);
    }
  }

  // ---- legend --------------------------------------------------------------

  function buildLegend() {
    const list = $("legend");
    const rows = [
      ["chip-ok", SYM.ok, "P1", "Finished: it can complete. The step number is its place in the completion order."],
      ["chip-bad", SYM.bad, "P2", "Deadlocked: it cannot finish with the resources that can ever be released."],
      ["chip-wait", SYM.dim, "P3", "Holds nothing: finished from the start, so it blocks no one."],
      ["chip-ok", SYM.pick, "Pn", "Selected in a scan: the lowest-numbered process whose request fits in Work."],
    ];
    rows.forEach((row) => {
      const box = el("ul", { className: "chips sym-box", attrs: { "aria-hidden": "true" } }, [chip(row[0], row[1], row[2], "")]);
      list.appendChild(el("li", {}, [box, el("span", { text: row[3] })]));
    });
  }

  function init() {
    initTheme();
    buildLegend();
    fillCountSelect($("p-count"));
    fillCountSelect($("r-count"));

    const picker = $("sample-select");
    picker.appendChild(el("option", { text: "Choose an example", attrs: { value: "" } }));
    SAMPLES.forEach((sample) => picker.appendChild(el("option", { text: sample.name, attrs: { value: sample.id } })));

    $("p-count").addEventListener("change", onSizeChange);
    $("r-count").addEventListener("change", onSizeChange);
    picker.addEventListener("change", showSampleDescription);
    $("load-sample-btn").addEventListener("click", onLoadSample);
    $("reset-btn").addEventListener("click", onReset);
    $("detect-btn").addEventListener("click", onDetect);
    $("clear-btn").addEventListener("click", () => {
      clearResults();
      clearApiError();
      setRunStatus("Results cleared.");
    });

    renderGrids();
    onReset();
    setRunStatus(""); // the starting example is not an announcement
  }

  init();
})();
