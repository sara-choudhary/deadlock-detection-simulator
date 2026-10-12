"""Tests for deadlock.detect_deadlock (Milestone 1).

Covers master-spec cases A, B, C, D, E, G and M, plus a few edge cases.

Every fixture's expected values were calculated by hand BEFORE being written
here; the working is in the comment above each fixture. Labels are 1-based
(P1 is row 0). Selection order is lowest-index-first, so traces are
deterministic, but the property tests (case M) only rely on classifications
and trace properties, not on one particular order.
"""

import copy
import itertools
import json
import random

import pytest

from deadlock import STATUS_DEADLOCK, STATUS_NO_DEADLOCK, detect_deadlock

# ---------------------------------------------------------------------------
# Fixtures (hand-verified)
# ---------------------------------------------------------------------------

# A: spec 8.1.  Work=[1,1]. P1 req [0,1] fits -> Work=[2,1]. P2 req [1,0] fits
#    -> Work=[2,2]. (P2's [1,0] also fits [1,1] at iteration 1, but P1 has the
#    lower index.) Finish=[T,T].
CASE_A = dict(
    available=[1, 1],
    allocation=[[1, 0], [0, 1]],
    request=[[0, 1], [1, 0]],
)

# B: spec 8.2.  Work=[0,0]. P1 needs R2 (0 available), P2 needs R1 (0
#    available). Nobody fits. Unfinished = P1, P2.
CASE_B = dict(
    available=[0, 0],
    allocation=[[1, 0], [0, 1]],
    request=[[0, 1], [1, 0]],
)

# C: mixed (designed here; the spec gives no matrices).
#    Work=[0,1]. Iter 1: P1 [0,1]<=[0,1] yes; P2 [2,0] no (2>0);
#    P3 [0,2] no (2>1). Select P1, Work=[0,1]+[1,0]=[1,1].
#    Iter 2: P2 [2,0] no (2>1); P3 [0,2] no (2>1). Stop.
#    Completed: P1. Unfinished: P2, P3. Final Work=[1,1].
CASE_C = dict(
    available=[0, 1],
    allocation=[[1, 0], [0, 1], [1, 0]],
    request=[[0, 1], [2, 0], [0, 2]],
)

# D: zero-allocation process (designed here).
#    P2 holds nothing -> Finish[P2]=True from the start, even though its
#    request [5,5] can never be met (the qualification in spec 8.13).
#    Work=[0,0]: P1 [0,1] no, P3 [1,0] no. Unfinished = P1, P3.
CASE_D = dict(
    available=[0, 0],
    allocation=[[1, 0], [0, 0], [0, 1]],
    request=[[0, 1], [5, 5], [1, 0]],
)

# D2: zero-allocation process in an otherwise fine system.
#    P1 holds nothing -> finished initially. P2 req [0,0]<=[1,0] -> select,
#    Work=[1,0]+[1,0]=[2,0]. Everything finished.
CASE_D2 = dict(
    available=[1, 0],
    allocation=[[0, 0], [1, 0]],
    request=[[3, 3], [0, 0]],
)

# E1: textbook 5 processes x 3 resource types (totals 7,2,6), Available=[0,0,0].
#    Indices 0..4 = P1..P5.
#    Iter1 Work=[0,0,0]: P1 [0,0,0] yes -> select P1, Work=[0,1,0].
#    Iter2 Work=[0,1,0]: P2 [2,0,2] no (R1: 2>0 even though R2 part fits);
#          P3 [0,0,0] yes -> select P3, Work=[3,1,3].
#    Iter3 Work=[3,1,3]: P2 [2,0,2] yes -> select P2, Work=[5,1,3].
#    Iter4 Work=[5,1,3]: P4 [1,0,0] yes -> select P4, Work=[7,2,4].
#    Iter5 Work=[7,2,4]: P5 [0,0,2] yes -> select P5, Work=[7,2,6].
#    Sequence P1,P3,P2,P4,P5. Final Work=[7,2,6] = totals (7,2,6).
CASE_E1 = dict(
    available=[0, 0, 0],
    allocation=[[0, 1, 0], [2, 0, 0], [3, 0, 3], [2, 1, 1], [0, 0, 2]],
    request=[[0, 0, 0], [2, 0, 2], [0, 0, 0], [1, 0, 0], [0, 0, 2]],
)

# E2: same as E1 but P3 requests [0,0,1].
#    Iter1: only P1 fits -> Work=[0,1,0].
#    Iter2 Work=[0,1,0]: P2 [2,0,2] no; P3 [0,0,1] no (1>0); P4 [1,0,0] no;
#          P5 [0,0,2] no. Stop. Unfinished P2,P3,P4,P5. Final Work=[0,1,0].
CASE_E2 = dict(
    available=[0, 0, 0],
    allocation=[[0, 1, 0], [2, 0, 0], [3, 0, 3], [2, 1, 1], [0, 0, 2]],
    request=[[0, 0, 0], [2, 0, 2], [0, 0, 1], [1, 0, 0], [0, 0, 2]],
)

# G1: all-zero matrices (3 processes, 2 resources). Nobody holds anything,
#     so everyone is finished at initialisation. No loop iterations.
CASE_G1 = dict(
    available=[0, 0],
    allocation=[[0, 0], [0, 0], [0, 0]],
    request=[[0, 0], [0, 0], [0, 0]],
)

# G2: zero requests, non-zero allocations, zero available.
#     Work=[0,0]. P1 [0,0] fits -> Work=[1,0]. P2 [0,0] fits -> Work=[1,2].
CASE_G2 = dict(
    available=[0, 0],
    allocation=[[1, 0], [0, 2]],
    request=[[0, 0], [0, 0]],
)

# G3: zero allocations, non-zero requests, zero available. Nobody holds
#     anything -> everyone finished at initialisation, no deadlock.
CASE_G3 = dict(
    available=[0, 0],
    allocation=[[0, 0], [0, 0]],
    request=[[1, 1], [2, 0]],
)

ALL_FIXTURES = {
    "A": CASE_A,
    "B": CASE_B,
    "C": CASE_C,
    "D": CASE_D,
    "D2": CASE_D2,
    "E1": CASE_E1,
    "E2": CASE_E2,
    "G1": CASE_G1,
    "G2": CASE_G2,
    "G3": CASE_G3,
}


def run(fixture):
    return detect_deadlock(**fixture)


# ---------------------------------------------------------------------------
# Case A: all processes can finish
# ---------------------------------------------------------------------------

def test_case_a_result():
    r = run(CASE_A)
    assert r["success"] is True
    assert r["status"] == STATUS_NO_DEADLOCK
    assert r["deadlocked_processes"] == []
    assert r["completion_sequence"] == ["P1", "P2"]
    assert r["finish_status"] == {"P1": True, "P2": True}
    assert r["initial_work"] == [1, 1]
    assert r["final_work"] == [2, 2]
    assert r["initially_finished"] == []
    assert r["finished_processes"] == ["P1", "P2"]
    assert r["blocked_explanations"] == {}
    assert r["stop_reason"] == "All processes finished."


def test_case_a_trace():
    t = run(CASE_A)["trace"]
    assert len(t) == 2

    assert t[0]["iteration"] == 1
    assert t[0]["work_before"] == [1, 1]
    assert t[0]["finish_before"] == {"P1": False, "P2": False}
    # Both fit at iteration 1; the lowest index (P1) is selected.
    assert t[0]["considered"] == [
        {"process": "P1", "request": [0, 1], "can_satisfy": True},
        {"process": "P2", "request": [1, 0], "can_satisfy": True},
    ]
    assert t[0]["selected"] == "P1"
    assert t[0]["selected_request"] == [0, 1]
    assert t[0]["allocation_released"] == [1, 0]
    assert t[0]["work_after"] == [2, 1]

    assert t[1]["iteration"] == 2
    assert t[1]["work_before"] == [2, 1]
    assert t[1]["finish_before"] == {"P1": True, "P2": False}
    assert t[1]["considered"] == [
        {"process": "P2", "request": [1, 0], "can_satisfy": True},
    ]
    assert t[1]["selected"] == "P2"
    assert t[1]["allocation_released"] == [0, 1]
    assert t[1]["work_after"] == [2, 2]


# ---------------------------------------------------------------------------
# Case B: simple deadlock
# ---------------------------------------------------------------------------

def test_case_b_result():
    r = run(CASE_B)
    assert r["status"] == STATUS_DEADLOCK
    assert r["deadlocked_processes"] == ["P1", "P2"]
    assert r["completion_sequence"] == []
    assert r["finish_status"] == {"P1": False, "P2": False}
    assert r["initial_work"] == [0, 0]
    assert r["final_work"] == [0, 0]
    assert r["finished_processes"] == []
    assert "P1" in r["message"] and "P2" in r["message"]


def test_case_b_trace_and_explanations():
    r = run(CASE_B)
    assert len(r["trace"]) == 1
    entry = r["trace"][0]
    assert entry["selected"] is None
    assert entry["selected_request"] is None
    assert entry["allocation_released"] is None
    assert entry["work_after"] == [0, 0]
    assert [c["can_satisfy"] for c in entry["considered"]] == [False, False]

    p1 = r["blocked_explanations"]["P1"]
    assert p1["request"] == [0, 1]
    assert p1["allocation"] == [1, 0]
    assert p1["shortages"] == [
        {"resource": "R2", "requested": 1, "available": 0, "shortfall": 1}
    ]
    p2 = r["blocked_explanations"]["P2"]
    assert p2["shortages"] == [
        {"resource": "R1", "requested": 1, "available": 0, "shortfall": 1}
    ]
    assert "R2" in p1["explanation"]


# ---------------------------------------------------------------------------
# Case C: mixed outcome
# ---------------------------------------------------------------------------

def test_case_c_result():
    r = run(CASE_C)
    assert r["status"] == STATUS_DEADLOCK
    assert r["completion_sequence"] == ["P1"]
    assert r["deadlocked_processes"] == ["P2", "P3"]
    assert r["finished_processes"] == ["P1"]
    assert r["finish_status"] == {"P1": True, "P2": False, "P3": False}
    assert r["initial_work"] == [0, 1]
    assert r["final_work"] == [1, 1]


def test_case_c_trace_and_explanations():
    r = run(CASE_C)
    t = r["trace"]
    assert len(t) == 2
    assert [c["can_satisfy"] for c in t[0]["considered"]] == [True, False, False]
    assert t[0]["selected"] == "P1"
    assert t[0]["work_after"] == [1, 1]
    # P1's release did not help P2/P3: still nobody fits.
    assert t[1]["work_before"] == [1, 1]
    assert [c["can_satisfy"] for c in t[1]["considered"]] == [False, False]
    assert t[1]["selected"] is None
    assert "P2, P3 unfinished" in r["stop_reason"]

    assert r["blocked_explanations"]["P2"]["shortages"] == [
        {"resource": "R1", "requested": 2, "available": 1, "shortfall": 1}
    ]
    assert r["blocked_explanations"]["P3"]["shortages"] == [
        {"resource": "R2", "requested": 2, "available": 1, "shortfall": 1}
    ]


# ---------------------------------------------------------------------------
# Case D: zero-allocation process
# ---------------------------------------------------------------------------

def test_case_d_zero_allocation_process_is_not_deadlocked():
    r = run(CASE_D)
    assert r["initially_finished"] == ["P2"]
    assert r["finish_status"]["P2"] is True
    assert "P2" not in r["deadlocked_processes"]
    assert r["deadlocked_processes"] == ["P1", "P3"]
    # P2 was finished by initialisation, not selected by the loop.
    assert r["completion_sequence"] == []
    assert r["finished_processes"] == ["P2"]
    # The trace never lists P2 as considered (it was already finished).
    for entry in r["trace"]:
        assert "P2" not in [c["process"] for c in entry["considered"]]
        assert entry["finish_before"]["P2"] is True


def test_case_d_qualification_finished_process_request_may_not_fit():
    """Spec 8.13 qualification: an initially finished process may have a
    request that does NOT fit the final Work vector, yet it is finished."""
    r = run(CASE_D)
    request_p2 = CASE_D["request"][1]
    assert any(q > w for q, w in zip(request_p2, r["final_work"]))
    assert r["finish_status"]["P2"] is True


def test_case_d2_zero_allocation_process_in_healthy_system():
    r = run(CASE_D2)
    assert r["status"] == STATUS_NO_DEADLOCK
    assert r["initially_finished"] == ["P1"]
    assert r["completion_sequence"] == ["P2"]
    assert r["finished_processes"] == ["P1", "P2"]
    assert r["final_work"] == [2, 0]


# ---------------------------------------------------------------------------
# Case E: multiple resource types and instances
# ---------------------------------------------------------------------------

def test_case_e1_no_deadlock_with_release_chain():
    r = run(CASE_E1)
    assert r["status"] == STATUS_NO_DEADLOCK
    assert r["completion_sequence"] == ["P1", "P3", "P2", "P4", "P5"]
    assert r["final_work"] == [7, 2, 6]
    assert [e["work_after"] for e in r["trace"]] == [
        [0, 1, 0],
        [3, 1, 3],
        [5, 1, 3],
        [7, 2, 4],
        [7, 2, 6],
    ]


def test_case_e1_elementwise_comparison_and_late_completion():
    t = run(CASE_E1)["trace"]
    # Iteration 2, Work=[0,1,0]: P2 asks [2,0,2]. Its R2 component fits
    # (0<=1) but R1 does not (2>0), so the comparison must be False.
    it2 = {c["process"]: c["can_satisfy"] for c in t[1]["considered"]}
    assert t[1]["work_before"] == [0, 1, 0]
    assert it2["P2"] is False
    assert it2["P3"] is True
    # Iteration 1: P2 could not finish yet ...
    it1 = {c["process"]: c["can_satisfy"] for c in t[0]["considered"]}
    assert it1["P2"] is False
    # ... but it finished later (failing the first iteration != deadlock).
    assert t[2]["selected"] == "P2"
    # Iteration 3: P2, P4, P5 all fit; lowest index wins.
    it3 = {c["process"]: c["can_satisfy"] for c in t[2]["considered"]}
    assert it3 == {"P2": True, "P4": True, "P5": True}


def test_case_e2_deadlock_with_multiple_resources():
    r = run(CASE_E2)
    assert r["status"] == STATUS_DEADLOCK
    assert r["completion_sequence"] == ["P1"]
    assert r["deadlocked_processes"] == ["P2", "P3", "P4", "P5"]
    assert r["final_work"] == [0, 1, 0]
    assert r["blocked_explanations"]["P3"]["shortages"] == [
        {"resource": "R3", "requested": 1, "available": 0, "shortfall": 1}
    ]
    # P2 asks R1 and R3; both are short.
    assert [s["resource"] for s in
            r["blocked_explanations"]["P2"]["shortages"]] == ["R1", "R3"]


# ---------------------------------------------------------------------------
# Case G: all-zero matrices (and zero-request / zero-allocation variants)
# ---------------------------------------------------------------------------

def test_case_g1_all_zero():
    r = run(CASE_G1)
    assert r["status"] == STATUS_NO_DEADLOCK
    assert r["initially_finished"] == ["P1", "P2", "P3"]
    assert r["completion_sequence"] == []
    assert r["deadlocked_processes"] == []
    assert r["trace"] == []
    assert r["initial_work"] == [0, 0]
    assert r["final_work"] == [0, 0]
    assert r["stop_reason"] == "All processes finished."


def test_case_g2_zero_requests_nonzero_allocation():
    r = run(CASE_G2)
    assert r["status"] == STATUS_NO_DEADLOCK
    assert r["initially_finished"] == []
    assert r["completion_sequence"] == ["P1", "P2"]
    assert r["final_work"] == [1, 2]


def test_case_g3_zero_allocation_nonzero_requests():
    r = run(CASE_G3)
    assert r["status"] == STATUS_NO_DEADLOCK
    assert r["initially_finished"] == ["P1", "P2"]
    assert r["completion_sequence"] == []
    assert r["trace"] == []
    assert r["final_work"] == [0, 0]


# ---------------------------------------------------------------------------
# Edge cases (algorithm level only; input-bounds checks belong to Milestone 2)
# ---------------------------------------------------------------------------

def test_edge_1x1_deadlock_and_no_deadlock():
    r = detect_deadlock([0], [[1]], [[1]])
    assert r["deadlocked_processes"] == ["P1"]
    r = detect_deadlock([1], [[1]], [[1]])
    assert r["status"] == STATUS_NO_DEADLOCK
    assert r["completion_sequence"] == ["P1"]
    assert r["final_work"] == [2]
    r = detect_deadlock([0], [[0]], [[1]])
    assert r["initially_finished"] == ["P1"]
    assert r["status"] == STATUS_NO_DEADLOCK


def test_edge_10x10_chain_finishes_in_reverse_order():
    # Pi holds Ri and requests R(i+1); P10 requests nothing. Available all 0.
    # Only P10 fits at first; each completion frees the resource the next
    # lower process needs. Completion order: P10, P9, ..., P1.
    n = 10
    allocation = [[1 if j == i else 0 for j in range(n)] for i in range(n)]
    request = [
        [1 if (j == i + 1) else 0 for j in range(n)] for i in range(n)
    ]
    r = detect_deadlock([0] * n, allocation, request)
    assert r["status"] == STATUS_NO_DEADLOCK
    assert r["completion_sequence"] == ["P{}".format(k) for k in range(10, 0, -1)]
    assert r["final_work"] == [1] * n
    assert len(r["trace"]) == 10


def test_edge_10x10_ring_is_fully_deadlocked():
    n = 10
    allocation = [[1 if j == i else 0 for j in range(n)] for i in range(n)]
    request = [[1 if j == (i + 1) % n else 0 for j in range(n)] for i in range(n)]
    r = detect_deadlock([0] * n, allocation, request)
    assert r["status"] == STATUS_DEADLOCK
    assert r["deadlocked_processes"] == ["P{}".format(k) for k in range(1, 11)]
    assert r["completion_sequence"] == []


def test_edge_large_instance_counts_are_allowed():
    # No upper bound on instance counts (only P and R are capped, elsewhere).
    r = detect_deadlock([10 ** 9], [[10 ** 9]], [[10 ** 9]])
    assert r["completion_sequence"] == ["P1"]
    assert r["final_work"] == [2 * 10 ** 9]


@pytest.mark.parametrize(
    "available, allocation, request_matrix",
    [
        ([], [[1]], [[1]]),                    # no resource types
        ([1], [], []),                         # no processes
        ([1], [[1], [1]], [[1]]),              # request has too few rows
        ([1], [[1]], [[1], [1]]),              # request has too many rows
        ([1, 1], [[1]], [[1, 1]]),             # allocation row too short
        ([1, 1], [[1, 1]], [[1, 1, 1]]),       # request row too long
    ],
)
def test_edge_inconsistent_shapes_raise_value_error(
    available, allocation, request_matrix
):
    with pytest.raises(ValueError):
        detect_deadlock(available, allocation, request_matrix)


def test_edge_result_is_json_serialisable():
    for fixture in ALL_FIXTURES.values():
        json.dumps(run(fixture))


# ---------------------------------------------------------------------------
# Case M: regression and algorithm properties
# ---------------------------------------------------------------------------

def oracle_unfinished(available, allocation, request):
    """Independent re-implementation used only to cross-check classifications.

    Differences from the real code: it keeps sets instead of a Finish array,
    scans in REVERSE index order, repeats until nothing changes, and records
    no trace.
    """
    n = len(allocation)
    work = list(available)
    done = set(i for i in range(n) if not any(allocation[i]))
    changed = True
    while changed:
        changed = False
        for i in reversed(range(n)):
            if i in done:
                continue
            if all(q <= w for q, w in zip(request[i], work)):
                work = [w + a for w, a in zip(work, allocation[i])]
                done.add(i)
                changed = True
    return sorted(set(range(n)) - done)


def label_to_index(label):
    return int(label[1:]) - 1


def check_properties(available, allocation, request):
    """Assert every spec-8.13 property for one input. Returns the result."""
    before = copy.deepcopy((available, allocation, request))
    r = detect_deadlock(available, allocation, request)
    case = "case={}".format((available, allocation, request))

    # M1 determinism + M2 inputs untouched
    assert r == detect_deadlock(available, allocation, request), case
    assert (available, allocation, request) == before, case

    n = len(allocation)
    all_labels = ["P{}".format(i + 1) for i in range(n)]
    completion = r["completion_sequence"]
    deadlocked = r["deadlocked_processes"]
    initially = r["initially_finished"]
    trace = r["trace"]

    # M7 completion sequence: valid ids, no duplicates
    assert all(c in all_labels for c in completion), case
    assert len(completion) == len(set(completion)), case

    # M6 exactly one final classification group
    assert set(r["finished_processes"]).isdisjoint(deadlocked), case
    assert sorted(r["finished_processes"] + deadlocked) == sorted(all_labels), case
    assert set(initially).isdisjoint(completion), case
    assert sorted(initially + completion) == sorted(r["finished_processes"]), case
    for label in all_labels:
        assert r["finish_status"][label] == (label not in deadlocked), case
    assert initially == [
        all_labels[i] for i in range(n) if not any(allocation[i])
    ], case
    assert r["status"] == (STATUS_DEADLOCK if deadlocked else STATUS_NO_DEADLOCK), case

    # Classification agrees with the independent oracle
    assert deadlocked == ["P{}".format(i + 1) for i in
                          oracle_unfinished(available, allocation, request)], case

    # M4 each completed process released exactly once
    released_total = [0] * len(available)
    for label in completion:
        row = allocation[label_to_index(label)]
        released_total = [a + b for a, b in zip(released_total, row)]
    assert r["final_work"] == [a + b for a, b in zip(available, released_total)], case

    # Trace properties
    assert [e["iteration"] for e in trace] == list(range(1, len(trace) + 1)), case
    selected_labels = [e["selected"] for e in trace if e["selected"] is not None]
    assert selected_labels == completion, case  # trace agrees with result

    for k, e in enumerate(trace):
        # Work never decreases
        assert all(a <= b for a, b in zip(e["work_before"], e["work_after"])), case
        # Chained work vectors
        if k > 0:
            assert e["work_before"] == trace[k - 1]["work_after"], case
        if e["selected"] is not None:
            i = label_to_index(e["selected"])
            # M3 selected process satisfied Request <= Work when selected
            assert all(q <= w for q, w in zip(request[i], e["work_before"])), case
            assert e["selected_request"] == request[i], case
            assert e["allocation_released"] == allocation[i], case
            assert e["work_after"] == [
                w + a for w, a in zip(e["work_before"], allocation[i])
            ], case
            # It was not finished before and is the lowest eligible index.
            assert e["finish_before"][e["selected"]] is False, case
            eligible = [c["process"] for c in e["considered"] if c["can_satisfy"]]
            assert e["selected"] == eligible[0], case
        else:
            assert e["work_after"] == e["work_before"], case
            assert all(c["can_satisfy"] is False for c in e["considered"]), case
        # Every considered entry's flag matches a fresh comparison.
        for c in e["considered"]:
            i = label_to_index(c["process"])
            assert c["can_satisfy"] == all(
                q <= w for q, w in zip(request[i], e["work_before"])
            ), case

    if trace:
        assert trace[0]["work_before"] == r["initial_work"], case
        assert trace[-1]["work_after"] == r["final_work"], case
    else:
        assert r["final_work"] == r["initial_work"], case
    assert r["initial_work"] == list(available), case

    # Terminal entry exists exactly when something is left unfinished.
    if deadlocked:
        last = trace[-1]
        assert last["selected"] is None, case
        assert [c["process"] for c in last["considered"]] == deadlocked, case
        assert sorted(r["blocked_explanations"]) == sorted(deadlocked), case
    else:
        assert all(e["selected"] is not None for e in trace), case
        assert r["blocked_explanations"] == {}, case

    # M8 every unfinished process fails the comparison against final Work.
    # (Only unfinished processes: initially finished ones are exempt.)
    for label in deadlocked:
        i = label_to_index(label)
        assert any(q > w for q, w in zip(request[i], r["final_work"])), case
        assert r["blocked_explanations"][label]["shortages"], case

    return r


@pytest.mark.parametrize("name", sorted(ALL_FIXTURES))
def test_case_m_properties_on_fixtures(name):
    fx = ALL_FIXTURES[name]
    check_properties(fx["available"], fx["allocation"], fx["request"])


def test_case_m_properties_on_random_inputs():
    rng = random.Random(20261010)  # fixed seed: reproducible
    for _ in range(400):
        n = rng.randint(1, 6)
        m = rng.randint(1, 4)
        allocation = [
            [rng.choice([0, 0, 1, 2, 3]) for _ in range(m)] for _ in range(n)
        ]
        request = [
            [rng.choice([0, 0, 1, 2, 3, 4]) for _ in range(m)] for _ in range(n)
        ]
        available = [rng.choice([0, 0, 1, 2]) for _ in range(m)]
        check_properties(available, allocation, request)


@pytest.mark.parametrize("name", ["A", "B", "C", "D", "D2", "E1", "E2"])
def test_case_m_classification_independent_of_process_order(name):
    """Spec 4.3: consistent results regardless of examination order.

    Reorder the processes in every possible way; the SET of deadlocked
    processes (mapped back to original identities) must never change.
    """
    fx = ALL_FIXTURES[name]
    n = len(fx["allocation"])
    base = set(label_to_index(p) for p in run(fx)["deadlocked_processes"])
    for perm in itertools.permutations(range(n)):
        # New row k holds original process perm[k].
        permuted = dict(
            available=fx["available"],
            allocation=[fx["allocation"][p] for p in perm],
            request=[fx["request"][p] for p in perm],
        )
        got = set(
            perm[label_to_index(p)]
            for p in run(permuted)["deadlocked_processes"]
        )
        assert got == base, "perm={}".format(perm)


def test_case_m_result_does_not_alias_inputs():
    available = [1, 1]
    allocation = [[1, 0], [0, 1]]
    request = [[0, 1], [1, 0]]
    r = detect_deadlock(available, allocation, request)
    assert r["initial_work"] is not available
    r["initial_work"].append(99)
    r["trace"][0]["allocation_released"][0] = 99
    assert available == [1, 1]
    assert allocation == [[1, 0], [0, 1]]
