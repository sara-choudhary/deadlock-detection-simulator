"""Tests for validation.validate_payload (Milestone 2).

Covers master-spec cases F (supported bounds), H (invalid dimensions),
I (invalid numeric inputs) and J (invalid counts and payloads).

Out of scope here (Milestone 3, API layer): invalid JSON *syntax*, HTTP
status codes, unsupported HTTP methods. This module only sees data that has
already been parsed (what request.get_json() would return); a body that
parses to null is covered below as payload None.
"""

import copy
import random

import pytest

from deadlock import detect_deadlock
from validation import (
    MAX_COUNT,
    MIN_COUNT,
    REQUIRED_FIELDS,
    ValidationError,
    validate_payload,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def make_payload(p=2, r=2):
    """A valid payload with p processes and r resource types."""
    return {
        "process_count": p,
        "resource_count": r,
        "allocation": [[(i + j) % 3 for j in range(r)] for i in range(p)],
        "request": [[(i * j) % 2 for j in range(r)] for i in range(p)],
        "available": [j % 2 for j in range(r)],
    }


def error_of(payload):
    """Validate, expect a ValidationError, and return it."""
    with pytest.raises(ValidationError) as info:
        validate_payload(payload)
    return info.value


# Values that are never acceptable where a resource count is required.
BAD_ENTRIES = [
    pytest.param(-1, id="negative-int"),
    pytest.param(-100, id="large-negative-int"),
    pytest.param(1.5, id="float"),
    pytest.param(2.0, id="whole-number-float"),
    pytest.param(0.0, id="zero-float"),
    pytest.param(float("nan"), id="nan"),
    pytest.param(float("inf"), id="infinity"),
    pytest.param("2", id="numeric-string"),
    pytest.param("", id="empty-string"),
    pytest.param("abc", id="text-string"),
    pytest.param(True, id="bool-true"),
    pytest.param(False, id="bool-false"),
    pytest.param(None, id="null"),
    pytest.param([], id="empty-list"),
    pytest.param([1], id="nested-list"),
    pytest.param({}, id="empty-object"),
    pytest.param({"a": 1}, id="object"),
]

# Values that are never acceptable as a whole payload.
BAD_PAYLOADS = [
    pytest.param(None, id="null-json"),
    pytest.param([], id="empty-array"),
    pytest.param([make_payload()], id="array-containing-valid-object"),
    pytest.param("deadlock", id="string"),
    pytest.param("", id="empty-string"),
    pytest.param(5, id="int"),
    pytest.param(1.5, id="float"),
    pytest.param(True, id="bool"),
]


# ---------------------------------------------------------------------------
# Case F: supported bounds (valid configurations)
# ---------------------------------------------------------------------------

def test_case_f_constants_match_spec():
    assert (MIN_COUNT, MAX_COUNT) == (1, 10)


def test_case_f_minimum_configuration_1x1():
    payload = {
        "process_count": 1,
        "resource_count": 1,
        "allocation": [[0]],
        "request": [[0]],
        "available": [0],
    }
    assert validate_payload(payload) == payload


def test_case_f_maximum_configuration_10x10():
    payload = make_payload(10, 10)
    assert validate_payload(payload) == payload


@pytest.mark.parametrize("p, r", [(1, 10), (10, 1), (1, 2), (2, 1), (3, 7)])
def test_case_f_other_valid_shapes(p, r):
    payload = make_payload(p, r)
    assert validate_payload(payload) == payload


def test_case_f_boundary_counts_around_limits():
    # 1 and 10 are accepted ...
    validate_payload(make_payload(1, 1))
    validate_payload(make_payload(10, 10))
    # ... 0 and 11 are not (data shape irrelevant, count is checked first).
    for bad in (0, 11):
        assert error_of(dict(make_payload(), process_count=bad)).field == "process_count"
        assert error_of(dict(make_payload(), resource_count=bad)).field == "resource_count"


# ---------------------------------------------------------------------------
# Valid values: what IS accepted
# ---------------------------------------------------------------------------

def test_valid_returns_exactly_the_five_fields():
    result = validate_payload(make_payload())
    assert sorted(result) == sorted(REQUIRED_FIELDS)


def test_valid_zero_values_are_accepted():
    payload = {
        "process_count": 2,
        "resource_count": 2,
        "allocation": [[0, 0], [0, 0]],
        "request": [[0, 0], [0, 0]],
        "available": [0, 0],
    }
    assert validate_payload(payload) == payload


@pytest.mark.parametrize("big", [100, 10 ** 6, 10 ** 9, 10 ** 30])
def test_valid_no_upper_limit_on_instance_counts(big):
    # Documented decision: only P and R are capped, not instance counts.
    payload = dict(make_payload(1, 1), allocation=[[big]], request=[[big]],
                   available=[big])
    assert validate_payload(payload)["allocation"] == [[big]]


def test_valid_extra_fields_are_ignored_and_not_returned():
    payload = dict(make_payload(), note="hello", total=[9, 9])
    result = validate_payload(payload)
    assert "note" not in result and "total" not in result
    assert sorted(result) == sorted(REQUIRED_FIELDS)


def test_valid_result_is_a_copy_and_input_is_untouched():
    payload = make_payload(3, 2)
    snapshot = copy.deepcopy(payload)
    result = validate_payload(payload)
    assert payload == snapshot
    # Changing the result must not change the caller's data.
    result["allocation"][0][0] = 999
    result["available"][0] = 999
    assert payload == snapshot
    assert result["allocation"] is not payload["allocation"]
    assert result["allocation"][0] is not payload["allocation"][0]


def test_validation_does_not_mutate_input_when_it_fails():
    payload = make_payload()
    payload["allocation"][1][1] = -5
    snapshot = copy.deepcopy(payload)
    error_of(payload)
    assert payload == snapshot


# ---------------------------------------------------------------------------
# Case J: invalid counts
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("count_field", ["process_count", "resource_count"])
@pytest.mark.parametrize(
    "bad",
    [
        pytest.param(0, id="zero"),
        pytest.param(-1, id="negative"),
        pytest.param(-10, id="large-negative"),
        pytest.param(11, id="above-max"),
        pytest.param(100, id="far-above-max"),
        pytest.param(10 ** 12, id="huge"),
        pytest.param(1.5, id="float"),
        pytest.param(2.0, id="whole-number-float"),
        pytest.param(float("nan"), id="nan"),
        pytest.param("2", id="numeric-string"),
        pytest.param("two", id="text-string"),
        pytest.param(True, id="bool-true"),
        pytest.param(False, id="bool-false"),
        pytest.param(None, id="null"),
        pytest.param([2], id="list"),
        pytest.param({"n": 2}, id="object"),
    ],
)
def test_case_j_invalid_counts_are_rejected(count_field, bad):
    err = error_of(dict(make_payload(), **{count_field: bad}))
    assert err.field == count_field
    assert count_field in err.message
    assert "1" in err.message and "10" in err.message  # tells the valid range


def test_case_j_count_messages_distinguish_type_and_range():
    assert "between 1 and 10, got 11" in error_of(
        dict(make_payload(), process_count=11)).message
    assert "got a decimal number (1.5)" in error_of(
        dict(make_payload(), process_count=1.5)).message
    assert 'got a string ("2")' in error_of(
        dict(make_payload(), process_count="2")).message
    assert "got a boolean (true)" in error_of(
        dict(make_payload(), process_count=True)).message
    assert "got null" in error_of(
        dict(make_payload(), process_count=None)).message


def test_case_j_counts_must_match_the_data():
    # process_count says 3 but the matrices have 2 rows -> dimension error.
    err = error_of(dict(make_payload(2, 2), process_count=3))
    assert err.field == "allocation"
    assert "3 rows" in err.message and "got 2" in err.message
    # resource_count says 3 but available has 2 entries.
    err = error_of(dict(make_payload(2, 2), resource_count=3))
    assert err.field == "available"


# ---------------------------------------------------------------------------
# Case J: missing fields and unsupported payload types
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("field", REQUIRED_FIELDS)
def test_case_j_each_missing_field_is_rejected(field):
    payload = make_payload()
    del payload[field]
    err = error_of(payload)
    assert err.field == field
    assert field in err.message
    assert "Missing" in err.message


def test_case_j_empty_object_lists_all_missing_fields():
    err = error_of({})
    assert err.message.startswith("Missing required fields:")
    for field in REQUIRED_FIELDS:
        assert field in err.message


def test_case_j_several_missing_fields_are_all_named():
    payload = make_payload()
    del payload["allocation"]
    del payload["available"]
    err = error_of(payload)
    assert "allocation" in err.message and "available" in err.message
    assert "request" not in err.message.split(":")[1]


@pytest.mark.parametrize("bad_payload", BAD_PAYLOADS)
def test_case_j_non_object_payloads_are_rejected(bad_payload):
    err = error_of(bad_payload)
    assert err.field is None
    assert "JSON object" in err.message


def test_case_j_payload_type_is_named_in_message():
    assert "got null" in error_of(None).message
    assert "got a list" in error_of([]).message
    assert 'got a string ("deadlock")' in error_of("deadlock").message


@pytest.mark.parametrize("field", ["allocation", "request", "available"])
@pytest.mark.parametrize(
    "bad",
    [
        pytest.param(None, id="null"),
        pytest.param("abc", id="string"),
        pytest.param("", id="empty-string"),
        pytest.param(5, id="int"),
        pytest.param(1.5, id="float"),
        pytest.param(True, id="bool"),
        pytest.param({"0": [1, 2]}, id="object"),
        pytest.param((1, 2), id="tuple"),
    ],
)
def test_case_j_unexpected_field_types_are_rejected(field, bad):
    err = error_of(dict(make_payload(2, 2), **{field: bad}))
    assert err.field == field
    assert field in err.message


@pytest.mark.parametrize("field", ["allocation", "request"])
@pytest.mark.parametrize(
    "bad_row",
    [
        pytest.param(None, id="null-row"),
        pytest.param(5, id="int-row"),
        pytest.param("ab", id="string-row"),
        pytest.param({"a": 1}, id="object-row"),
    ],
)
def test_case_j_matrix_rows_must_be_lists(field, bad_row):
    payload = make_payload(2, 2)
    payload[field][1] = bad_row
    err = error_of(payload)
    assert err.field == field
    assert "row 2" in err.message


def test_case_j_first_problem_reported_is_the_count():
    payload = dict(make_payload(), process_count=0, allocation="garbage",
                   available=None)
    assert error_of(payload).field == "process_count"


# ---------------------------------------------------------------------------
# Case H: invalid dimensions
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("field", ["allocation", "request"])
def test_case_h_too_few_rows(field):
    payload = make_payload(3, 2)
    payload[field] = payload[field][:2]
    err = error_of(payload)
    assert err.field == field
    assert "3 rows" in err.message and "got 2" in err.message


@pytest.mark.parametrize("field", ["allocation", "request"])
def test_case_h_too_many_rows(field):
    payload = make_payload(2, 2)
    payload[field] = payload[field] + [[0, 0]]
    err = error_of(payload)
    assert err.field == field
    assert "2 rows" in err.message and "got 3" in err.message


@pytest.mark.parametrize("field", ["allocation", "request"])
def test_case_h_empty_matrix(field):
    err = error_of(dict(make_payload(2, 2), **{field: []}))
    assert err.field == field
    assert "got 0" in err.message


@pytest.mark.parametrize("field", ["allocation", "request"])
def test_case_h_too_few_columns(field):
    payload = make_payload(2, 3)
    payload[field][1] = payload[field][1][:2]
    err = error_of(payload)
    assert err.field == field
    assert "row 2" in err.message
    assert "3 columns" in err.message and "got 2" in err.message


@pytest.mark.parametrize("field", ["allocation", "request"])
def test_case_h_too_many_columns(field):
    payload = make_payload(2, 2)
    payload[field][0] = payload[field][0] + [0]
    err = error_of(payload)
    assert err.field == field
    assert "row 1" in err.message
    assert "2 columns" in err.message and "got 3" in err.message


@pytest.mark.parametrize("field", ["allocation", "request"])
def test_case_h_empty_rows(field):
    payload = make_payload(2, 2)
    payload[field] = [[], []]
    err = error_of(payload)
    assert err.field == field
    assert "got 0" in err.message


@pytest.mark.parametrize("field", ["allocation", "request"])
def test_case_h_ragged_matrix(field):
    payload = make_payload(3, 2)
    payload[field] = [[0, 0], [0, 0, 0], [0]]
    err = error_of(payload)
    assert err.field == field
    assert "row 2" in err.message  # first bad row is reported


@pytest.mark.parametrize("length", [0, 1, 3, 5])
def test_case_h_available_wrong_length(length):
    payload = dict(make_payload(2, 2), available=[0] * length)
    err = error_of(payload)
    assert err.field == "available"
    assert "2 values" in err.message
    assert "got {}".format(length) in err.message


def test_case_h_dimension_errors_come_before_value_errors():
    payload = make_payload(2, 2)
    payload["allocation"] = [[-1, 0], [0, 0], [0, 0]]  # bad value AND bad shape
    err = error_of(payload)
    assert "rows" in err.message


# ---------------------------------------------------------------------------
# Case I: invalid numeric inputs (in every place a number can appear)
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("bad", BAD_ENTRIES)
def test_case_i_bad_value_in_allocation(bad):
    payload = make_payload(2, 2)
    payload["allocation"][1][0] = bad
    err = error_of(payload)
    assert err.field == "allocation"
    assert "allocation row 2, column 1 (P2, R1)" in err.message
    assert "non-negative integer" in err.message


@pytest.mark.parametrize("bad", BAD_ENTRIES)
def test_case_i_bad_value_in_request(bad):
    payload = make_payload(2, 2)
    payload["request"][0][1] = bad
    err = error_of(payload)
    assert err.field == "request"
    assert "request row 1, column 2 (P1, R2)" in err.message


@pytest.mark.parametrize("bad", BAD_ENTRIES)
def test_case_i_bad_value_in_available(bad):
    payload = make_payload(2, 2)
    payload["available"][1] = bad
    err = error_of(payload)
    assert err.field == "available"
    assert "available entry 2 (R2)" in err.message


def test_case_i_messages_name_the_offending_value():
    def msg(value):
        payload = make_payload()
        payload["available"][0] = value
        return error_of(payload).message

    assert "got -3." in msg(-3)
    assert "got a decimal number (1.5)" in msg(1.5)
    assert "got a decimal number (2.0)" in msg(2.0)
    assert 'got a string ("2")' in msg("2")
    assert "got a boolean (true)" in msg(True)
    assert "got a boolean (false)" in msg(False)
    assert "got null" in msg(None)
    assert "got a list" in msg([1])
    assert "got an object" in msg({"a": 1})


def test_case_i_long_strings_are_truncated_in_messages():
    payload = make_payload()
    payload["available"][0] = "x" * 500
    assert len(error_of(payload).message) < 200


def test_case_i_missing_value_is_a_dimension_error():
    # A "missing" cell in JSON is a row that is one entry short.
    payload = make_payload(2, 3)
    del payload["allocation"][0][2]
    err = error_of(payload)
    assert err.field == "allocation" and "3 columns" in err.message


def test_case_i_no_coercion_happens():
    """The three classic coercion traps must be rejected, not converted."""
    for trap in ("2", 2.0, True):
        payload = make_payload(1, 1)
        payload["allocation"] = [[trap]]
        with pytest.raises(ValidationError):
            validate_payload(payload)


def test_case_i_first_bad_value_is_reported_in_reading_order():
    payload = make_payload(2, 2)
    payload["allocation"][1][1] = -1
    payload["allocation"][0][1] = 1.5
    assert "row 1, column 2" in error_of(payload).message


def test_case_i_allocation_checked_before_request_before_available_order():
    payload = make_payload(2, 2)
    payload["available"][0] = -1
    payload["request"][0][0] = -1
    payload["allocation"][0][0] = -1
    assert error_of(payload).field == "available"  # vector is checked first
    payload["available"][0] = 0
    assert error_of(payload).field == "allocation"
    payload["allocation"][0][0] = 0
    assert error_of(payload).field == "request"


# ---------------------------------------------------------------------------
# Error object contract
# ---------------------------------------------------------------------------

def test_error_to_dict_has_the_agreed_shape():
    err = error_of(dict(make_payload(), process_count=0))
    body = err.to_dict()
    assert body["success"] is False
    assert body["error"] == "validation_error"
    assert body["message"] == err.message
    assert body["field"] == "process_count"
    assert sorted(body) == ["error", "field", "message", "success"]


def test_error_for_non_object_payload_has_null_field():
    assert error_of([]).to_dict()["field"] is None


def test_validation_error_is_not_a_value_error():
    # detect_deadlock raises ValueError for its own shape guard; the two must
    # stay distinguishable for the API layer.
    assert not issubclass(ValidationError, ValueError)
    assert str(error_of(None)) == error_of(None).message


# ---------------------------------------------------------------------------
# Never crashes with an unexpected exception type
# ---------------------------------------------------------------------------

def _random_json_like(rng, depth=0):
    kind = rng.randint(0, 8 if depth < 3 else 5)
    if kind == 0:
        return None
    if kind == 1:
        return rng.choice([True, False])
    if kind == 2:
        return rng.randint(-3, 12)
    if kind == 3:
        return rng.choice([0.0, 1.5, -2.5, 2.0, float("nan"), float("inf")])
    if kind == 4:
        return rng.choice(["", "0", "1", "abc", "x" * 50])
    if kind == 5:
        return rng.randint(0, 3)
    if kind == 6 or kind == 7:
        return [_random_json_like(rng, depth + 1) for _ in range(rng.randint(0, 4))]
    return {
        rng.choice(["a", "process_count", "allocation"]): _random_json_like(rng, depth + 1)
        for _ in range(rng.randint(0, 3))
    }


def test_fuzz_only_validation_error_or_a_well_formed_result():
    rng = random.Random(20261010)  # fixed seed: reproducible
    accepted = 0
    for _ in range(3000):
        mode = rng.randint(0, 2)
        if mode == 0:
            payload = _random_json_like(rng)
        else:
            # Start valid, then corrupt one or two fields with garbage.
            p, r = rng.randint(1, 4), rng.randint(1, 4)
            payload = make_payload(p, r)
            for _ in range(rng.randint(0, 2)):
                payload[rng.choice(list(REQUIRED_FIELDS))] = _random_json_like(rng)
        try:
            result = validate_payload(payload)
        except ValidationError as err:
            assert err.message  # always explains itself
            continue
        # If it was accepted, it must really be well formed.
        accepted += 1
        p, r = result["process_count"], result["resource_count"]
        assert 1 <= p <= 10 and 1 <= r <= 10
        assert len(result["available"]) == r
        for matrix in (result["allocation"], result["request"]):
            assert len(matrix) == p and all(len(row) == r for row in matrix)
        everything = result["available"] + sum(
            result["allocation"] + result["request"], [])
        assert all(type(x) is int and x >= 0 for x in everything)
    assert accepted > 100  # sanity check: the fuzz did exercise the success path


# ---------------------------------------------------------------------------
# Integration with the algorithm (argument order and shapes)
# ---------------------------------------------------------------------------

def test_validated_output_feeds_detect_deadlock_in_agreed_order():
    # Spec case B through the validation layer.
    payload = {
        "process_count": 2,
        "resource_count": 2,
        "allocation": [[1, 0], [0, 1]],
        "request": [[0, 1], [1, 0]],
        "available": [0, 0],
    }
    data = validate_payload(payload)
    result = detect_deadlock(data["available"], data["allocation"], data["request"])
    assert result["status"] == "DEADLOCK_DETECTED"
    assert result["deadlocked_processes"] == ["P1", "P2"]


@pytest.mark.parametrize("p, r", [(1, 1), (10, 10), (1, 10), (10, 1), (4, 3)])
def test_validated_output_never_trips_the_algorithms_shape_guard(p, r):
    data = validate_payload(make_payload(p, r))
    result = detect_deadlock(data["available"], data["allocation"], data["request"])
    assert result["success"] is True
    assert result["process_count"] == p and result["resource_count"] == r
