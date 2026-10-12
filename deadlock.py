"""Core deadlock *detection* algorithm (multiple instances per resource type).

This module is pure Python. It knows nothing about Flask, HTTP or JSON
requests; it only turns three plain lists of integers into a result dict.

This is deadlock DETECTION (what is stuck right now?), not Banker's
deadlock AVOIDANCE (is it safe to grant this request?). There is no
Maximum or Need matrix here.

Notation
--------
n          number of processes (rows)
m          number of resource types (columns)
available  length-m list: free instances of each resource type
allocation n x m list: allocation[i][j] = instances of resource j held by process i
request    n x m list: request[i][j]    = additional instances of resource j
                                          process i is still waiting for

Algorithm
---------
1. Work = copy of Available.
2. Finish[i] = True if process i holds no resources, else False.
3. Find the LOWEST index i with Finish[i] == False and
   request[i][j] <= Work[j] for every j.
4. If there is none, stop.
5. Otherwise process i can finish: Work = Work + allocation[i],
   Finish[i] = True, go to step 3.
6. Every process still unfinished is reported as deadlocked (potentially
   deadlocked under the standard model, for the supplied snapshot).

Why a process holding nothing starts as finished: it holds nothing, so it
cannot be blocking anybody and cannot be part of a circular wait. Even if
it never gets what it asks for, it would release nothing, so it never
changes Work. (Textbook convention, e.g. Silberschatz.) Consequence: such a
process may be marked finished although its request does not fit in Work.

Selection order: lowest index first. This only makes the trace
deterministic; Work never decreases, so the final classification does not
depend on the order.

Complexity: time O(m * n^2), space O(n * m) including the trace.
"""

from typing import Any, Dict, List, Sequence

STATUS_NO_DEADLOCK = "NO_DEADLOCK"
STATUS_DEADLOCK = "DEADLOCK_DETECTED"


def _process_label(index: int) -> str:
    """0-based index -> 'P1', 'P2', ..."""
    return "P{}".format(index + 1)


def _resource_label(index: int) -> str:
    """0-based index -> 'R1', 'R2', ..."""
    return "R{}".format(index + 1)


def _fits(request_row: Sequence[int], work: Sequence[int]) -> bool:
    """Element-wise comparison: request_row[j] <= work[j] for every j."""
    return all(r <= w for r, w in zip(request_row, work))


def _check_shapes(available, allocation, request) -> None:
    """Sanity check so the algorithm never indexes out of range.

    This is NOT the user-input validation (types, negatives, bounds); that
    lives in validation.py (Milestone 2). It only guards the function's
    own preconditions.
    """
    if len(available) < 1:
        raise ValueError("available must contain at least one resource type.")
    if len(allocation) < 1:
        raise ValueError("allocation must contain at least one process.")
    if len(request) != len(allocation):
        raise ValueError(
            "request has {} rows but allocation has {}.".format(
                len(request), len(allocation)
            )
        )
    m = len(available)
    for name, matrix in (("allocation", allocation), ("request", request)):
        for i, row in enumerate(matrix):
            if len(row) != m:
                raise ValueError(
                    "{} row {} has {} columns, expected {}.".format(
                        name, i + 1, len(row), m
                    )
                )


def detect_deadlock(
    available: Sequence[int],
    allocation: Sequence[Sequence[int]],
    request: Sequence[Sequence[int]],
) -> Dict[str, Any]:
    """Run deadlock detection on one snapshot and return a result dict.

    The inputs are copied first and never modified.

    Raises ValueError if the shapes are inconsistent (see _check_shapes).

    Returned keys
    -------------
    success               always True here (errors are exceptions / HTTP layer)
    status                "NO_DEADLOCK" or "DEADLOCK_DETECTED"
    message               one-sentence human-readable summary
    process_count, resource_count
    deadlocked_processes  labels left unfinished, in index order
    finished_processes    labels initially finished + completed, in index order
    completion_sequence   labels in the order the algorithm completed them
                          (does NOT include initially finished processes)
    initially_finished    labels of processes that held nothing at the start
    finish_status         {"P1": bool, ...} final Finish array
    initial_work          copy of Available
    final_work            Work when the algorithm stopped
    trace                 list of iteration dicts (see below)
    stop_reason           why the algorithm stopped
    blocked_explanations  {label: {...}} for every deadlocked process

    Each trace entry describes one scan of the unfinished processes:
      iteration, work_before, finish_before, considered
      (every unfinished process with its request and can_satisfy),
      selected (label or None), selected_request, allocation_released,
      work_after.
    The last entry has selected == None when the algorithm stopped with
    unfinished processes (the scan that found nobody). When every process
    finishes there is no such entry.
    """
    _check_shapes(available, allocation, request)

    n = len(allocation)
    m = len(available)

    # Private copies: the caller's lists are never touched.
    work = [int(x) for x in available]
    alloc = [[int(x) for x in row] for row in allocation]
    req = [[int(x) for x in row] for row in request]

    # Step 2: a process holding nothing starts as finished.
    finish = [all(x == 0 for x in alloc[i]) for i in range(n)]
    initially_finished = [_process_label(i) for i in range(n) if finish[i]]
    initial_work = list(work)

    trace: List[Dict[str, Any]] = []
    completion_sequence: List[str] = []
    iteration = 0

    # Steps 3-5.
    while True:
        unfinished = [i for i in range(n) if not finish[i]]
        if not unfinished:
            stop_reason = "All processes finished."
            break

        iteration += 1
        work_before = list(work)
        finish_before = {_process_label(i): finish[i] for i in range(n)}

        considered = []
        selected = None
        for i in unfinished:  # ascending index = lowest-index-first
            can = _fits(req[i], work)
            considered.append(
                {
                    "process": _process_label(i),
                    "request": list(req[i]),
                    "can_satisfy": can,
                }
            )
            if can and selected is None:
                selected = i

        if selected is None:
            # Step 4: nobody can proceed.
            trace.append(
                {
                    "iteration": iteration,
                    "work_before": work_before,
                    "finish_before": finish_before,
                    "considered": considered,
                    "selected": None,
                    "selected_request": None,
                    "allocation_released": None,
                    "work_after": list(work),
                }
            )
            names = ", ".join(_process_label(i) for i in unfinished)
            stop_reason = (
                "No unfinished process has a request that fits within "
                "Work {}. Stopped with {} unfinished.".format(work, names)
            )
            break

        # Step 5: the selected process finishes and releases its allocation.
        released = list(alloc[selected])
        work = [w + a for w, a in zip(work, released)]
        finish[selected] = True
        label = _process_label(selected)
        completion_sequence.append(label)
        trace.append(
            {
                "iteration": iteration,
                "work_before": work_before,
                "finish_before": finish_before,
                "considered": considered,
                "selected": label,
                "selected_request": list(req[selected]),
                "allocation_released": released,
                "work_after": list(work),
            }
        )

    # Step 6: classify.
    deadlocked_idx = [i for i in range(n) if not finish[i]]
    deadlocked = [_process_label(i) for i in deadlocked_idx]
    finished = [_process_label(i) for i in range(n) if finish[i]]

    blocked_explanations: Dict[str, Any] = {}
    for i in deadlocked_idx:
        shortages = [
            {
                "resource": _resource_label(j),
                "requested": req[i][j],
                "available": work[j],
                "shortfall": req[i][j] - work[j],
            }
            for j in range(m)
            if req[i][j] > work[j]
        ]
        parts = [
            "{} (needs {}, only {} available)".format(
                s["resource"], s["requested"], s["available"]
            )
            for s in shortages
        ]
        blocked_explanations[_process_label(i)] = {
            "request": list(req[i]),
            "allocation": list(alloc[i]),
            "final_work": list(work),
            "shortages": shortages,
            "explanation": "{} cannot finish: it is waiting for {} in the "
            "final Work vector.".format(_process_label(i), "; ".join(parts)),
        }

    if deadlocked:
        status = STATUS_DEADLOCK
        message = (
            "Deadlock detected: {} cannot finish (potentially deadlocked "
            "under the standard model, for the supplied snapshot)."
        ).format(", ".join(deadlocked))
    else:
        status = STATUS_NO_DEADLOCK
        message = "No deadlock detected: every process can finish."

    return {
        "success": True,
        "status": status,
        "message": message,
        "process_count": n,
        "resource_count": m,
        "deadlocked_processes": deadlocked,
        "finished_processes": finished,
        "completion_sequence": completion_sequence,
        "initially_finished": initially_finished,
        "finish_status": {_process_label(i): finish[i] for i in range(n)},
        "initial_work": initial_work,
        "final_work": list(work),
        "trace": trace,
        "stop_reason": stop_reason,
        "blocked_explanations": blocked_explanations,
    }
