# The deadlock detection algorithm

This document explains the algorithm implemented in [`deadlock.py`](../deadlock.py)
(`detect_deadlock`) in detail: what it computes, why it works, and where its answer
should and should not be trusted. For setup and usage, see the [README](../README.md).

## 1. Terms

| Term | Meaning in this project |
|---|---|
| Process `Pi` | One participant, numbered from 1 (`P1`, `P2`, ...). Row `i` of each matrix. |
| Resource type `Rj` | One kind of resource, numbered from 1 (`R1`, `R2`, ...). Column `j` of each matrix. |
| Instance | One identical unit of a resource type. A type may have several (for example 3 printers). |
| `n`, `m` | Number of processes, number of resource types. Both must be 1 to 10. |
| `Available[j]` | Instances of `Rj` that are free right now. |
| `Allocation[i][j]` | Instances of `Rj` that process `Pi` currently holds. |
| `Request[i][j]` | **Additional** instances of `Rj` that `Pi` is waiting for before it can finish. |
| `Work[j]` | The algorithm's working copy of `Available`. It grows as processes are assumed to finish. |
| `Finish[i]` | Whether the algorithm has concluded that `Pi` can finish. |

`Request` is an *outstanding* request: what the process still needs right now, not its
maximum possible demand.

## 2. Detection is not avoidance (not the Banker's algorithm)

The two are often taught side by side and use a similar `Work`/`Finish` loop, so they are
easy to confuse. They answer different questions. **This project implements detection only.**

| | Deadlock detection (this project) | Banker's algorithm (not implemented) |
|---|---|---|
| Question | Given the current state, which processes are stuck? | Would granting this request keep the system in a safe state? |
| When it is used | After resources have been handed out: looks at what is happening | Before granting a request: decides whether to grant it |
| Per-process data | `Allocation` and outstanding `Request` | `Allocation`, `Max` (declared maximum) and `Need = Max - Allocation` |
| Compares `Work` against | `Request[i]` (what the process is waiting for now) | `Need[i]` (everything it might still ask for) |
| Initial `Finish[i]` | `true` when the process holds nothing | `false` for every process |
| Result | The set of unfinished (deadlocked) processes | Safe or unsafe, plus a safe sequence |
| Looks into the future? | No. It uses only requests already made | Yes. It assumes each process may ask for up to `Max` |

There is no `Max` or `Need` matrix anywhere in this code. A state can show "no deadlock" here
while still being unsafe in the Banker's sense, because detection does not assume anything
about requests that have not been made yet.

## 3. The algorithm

### Steps

1. `Work = Available` (a copy).
2. For every process `i`: `Finish[i] = true` if `Allocation[i]` is all zeros, otherwise `false`.
3. Look at the processes with `Finish[i] == false`, lowest number first. Find the first one
   whose request fits: `Request[i][j] <= Work[j]` for **every** `j`.
4. If there is none, stop.
5. Otherwise `Pi` is assumed to run to completion and give back what it holds:
   `Work = Work + Allocation[i]`, `Finish[i] = true`, and go back to step 3.
6. Every process with `Finish[i] == false` when the algorithm stops is reported as
   **deadlocked**. If there are none, there is no deadlock.

### Pseudocode

This follows `detect_deadlock` line by line (the trace and explanation bookkeeping are shown
as comments).

```text
function detect_deadlock(Available, Allocation, Request):
    n = number of rows of Allocation
    m = length of Available
    copy all three inputs                       # the caller's data is never modified

    Work = Available
    for i in 1..n:
        Finish[i] = (every entry of Allocation[i] is 0)
    initially_finished = { i : Finish[i] }
    completion_sequence = []
    trace = []

    loop:
        unfinished = [ i in ascending order : Finish[i] is false ]
        if unfinished is empty:
            stop_reason = "All processes finished."
            break

        selected = none
        for i in unfinished:                    # ascending = lowest index first
            fits[i] = for all j: Request[i][j] <= Work[j]
            record (i, Request[i], fits[i]) as "considered"
            if fits[i] and selected is none:
                selected = i

        if selected is none:
            append a trace entry with selected = null
            stop_reason = "No unfinished process has a request that fits ..."
            break

        Work = Work + Allocation[selected]      # it finishes and releases everything
        Finish[selected] = true
        append selected to completion_sequence
        append a trace entry (Work before, considered, selected, released, Work after)

    deadlocked = [ i : Finish[i] is false ]
    for each i in deadlocked:
        shortages = [ j : Request[i][j] > Work[j] ]    # final Work
        explanation = which resources it is short of, and by how much
    status = DEADLOCK_DETECTED if deadlocked is not empty else NO_DEADLOCK
    return status, lists, Work vectors, trace, explanations
```

### Flowchart (in words)

Start, then copy the inputs and set `Work` and `Finish`. Then ask "is any process
unfinished?". If no, stop with *no deadlock*. If yes, scan the unfinished processes in
order and ask "does one of them fit within `Work`?". If yes, release its allocation into
`Work`, mark it finished, and ask the first question again. If no, stop with *deadlock
detected* and list the unfinished processes.

### Why a process that holds nothing starts as finished

A process holding no resources cannot be blocking anyone: nobody is waiting for something
it owns. It cannot be part of a circular wait either, since a cycle needs every member to
hold something another member wants. Even if its own request can never be met, finishing it
would release nothing, so it would never change `Work`. Marking it finished at the start
therefore changes no other process's outcome. This is the usual textbook convention.

One consequence is easy to miss. Such a process is reported as *finished* even when its
request does not fit in `Work`. In the "A process that holds nothing" example, `P2` asks for
`[5, 5]` with nothing available, yet it is not listed as deadlocked. The page shows these
processes as "holds nothing: finished from the start", and the result lists them under
"Finished from the start". The property "every unfinished process fails the comparison
against the final `Work`" holds only for processes that *started* unfinished.

## 4. Why the order does not change the answer

The code always picks the lowest-numbered process that fits, so traces are repeatable. That
choice affects only the *order* in `completion_sequence` and the trace, never which
processes end up deadlocked, for this reason: finishing a process only **adds** to `Work`
and never removes anything. So a process that fits at some moment still fits after any
other process finishes. The set of processes that can eventually finish is the same
whichever order the eligible ones are taken in.

The tests check this rather than assuming it: `test_deadlock.py` compares the classification
with an independently written version on 400 seeded random inputs, and re-runs each example
fixture with the processes shuffled into every possible order.

The completion sequence is therefore **one valid order**, not the only one. For example, in
the "Every process can finish" example both processes fit at the start, and the code picks
`P1` first only because it has the lower number.

## 5. Worked example: a release chain (five processes, three resource types)

This is the textbook-style example from the page ("Five processes, three resource types"),
and it is one of the examples in the test suite. Totals are 7, 2 and 6 instances.

```text
Available = [0, 0, 0]

        Allocation      Request
        R1 R2 R3        R1 R2 R3
  P1     0  1  0         0  0  0
  P2     2  0  0         2  0  2
  P3     3  0  3         0  0  0
  P4     2  1  1         1  0  0
  P5     0  0  2         0  0  2
```

Every process holds something, so `Finish = [false, false, false, false, false]`, and
`Work = [0, 0, 0]`.

| Scan | `Work` before | Fits? (unfinished, in order) | Selected | `Work` after |
|---|---|---|---|---|
| 1 | `[0,0,0]` | P1 yes, P2 no, P3 yes, P4 no, P5 no | P1 | `[0,0,0] + [0,1,0] = [0,1,0]` |
| 2 | `[0,1,0]` | P2 no, P3 yes, P4 no, P5 no | P3 | `[0,1,0] + [3,0,3] = [3,1,3]` |
| 3 | `[3,1,3]` | P2 yes, P4 yes, P5 yes | P2 | `[3,1,3] + [2,0,0] = [5,1,3]` |
| 4 | `[5,1,3]` | P4 yes, P5 yes | P4 | `[5,1,3] + [2,1,1] = [7,2,4]` |
| 5 | `[7,2,4]` | P5 yes | P5 | `[7,2,4] + [0,0,2] = [7,2,6]` |

- In scan 2, `P2` asks for `[2,0,2]` against `Work = [0,1,0]`. Its `R2` part would fit
  (`0 <= 1`) but `R1` does not (`2 > 0`), so the whole request does not fit. The comparison
  is element by element and every element must pass.
- `P2` could not finish in scan 1 or 2, but it is **not** deadlocked: `P3`'s release in scan 2
  is what lets it run.
- Result: no deadlock, order `P1, P3, P2, P4, P5`, final `Work = [7, 2, 6]`, which equals the
  totals because everyone gave everything back.

If `P3` also requested one instance of `R3` (`Request[P3] = [0,0,1]`), only `P1` could finish
(`Work = [0,1,0]`), and `P2`, `P3`, `P4`, `P5` would be reported as deadlocked. That is the
"Five processes, four of them stuck" example.

## 6. Complexity

Let `n` be the number of processes and `m` the number of resource types.

- **Time: O(m · n²).** Each scan looks at up to `n` processes and compares up to `m` numbers
  each. There are at most `n` scans that select a process, plus one final scan.
- **Space:** the algorithm's own working data (copies of the inputs, `Work`, `Finish`) is
  O(n · m). The returned trace is larger: each of up to `n + 1` entries lists up to `n`
  considered processes with `m`-length vectors, so the full result is O(n² · m) in the worst
  case. With `n, m <= 10` this is small.

## 7. What the answer means, and what it does not

- The result describes **only the numbers supplied**. Nothing inspects real operating-system
  processes, and the answer is only as correct as the Allocation, Request and Available data
  entered.
- "Deadlocked" means *unfinished under the standard model's assumptions*: a process can
  finish if its whole outstanding request can be satisfied, and a finished process returns
  everything it holds.
- "No deadlock" means there exists an order in which every process can finish using the
  resources released along the way. It is **not** a promise about every possible future
  schedule or about requests not yet made.
- An unfinished process was not merely slow. It is waiting for resources that can only come
  from processes that are themselves unfinished.

## 8. Where each part lives in the code

| Part | Location |
|---|---|
| Algorithm and result structure | `detect_deadlock` in `deadlock.py` |
| Element-wise `Request <= Work` comparison | `_fits` in `deadlock.py` |
| Shape guard (internal precondition, raises `ValueError`) | `_check_shapes` in `deadlock.py` |
| Rules for what input is accepted | `validate_payload` in `validation.py` |
| Algorithm tests (hand-verified examples, order independence, properties) | `tests/test_deadlock.py` |

## 9. Reference

Silberschatz, Galvin and Gagne, *Operating System Concepts*: the chapter on deadlocks
describes detection for multiple instances of each resource type, and separately deadlock
avoidance and the Banker's algorithm. Check your own edition for chapter and page numbers.
