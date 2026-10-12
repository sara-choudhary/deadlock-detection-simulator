"""Tests for the Flask API in app.py (Milestone 3), using Flask's test client.

Only the standard library's unittest.mock is used for patching, so no pytest
fixtures are needed. Patch target "app.detect_deadlock" replaces the name
that the route looks up, which lets the tests (a) check the argument order
and (b) simulate internal failures.
"""

import json
from unittest import mock

import pytest

import app as app_module
from deadlock import detect_deadlock
from validation import ValidationError, validate_payload

URL = "/api/detect"

CASE_A = {  # everyone can finish
    "process_count": 2,
    "resource_count": 2,
    "allocation": [[1, 0], [0, 1]],
    "request": [[0, 1], [1, 0]],
    "available": [1, 1],
}
CASE_B = {  # simple deadlock
    "process_count": 2,
    "resource_count": 2,
    "allocation": [[1, 0], [0, 1]],
    "request": [[0, 1], [1, 0]],
    "available": [0, 0],
}
CASE_C = {  # mixed: P1 finishes, P2 and P3 stay unfinished
    "process_count": 3,
    "resource_count": 2,
    "allocation": [[1, 0], [0, 1], [1, 0]],
    "request": [[0, 1], [2, 0], [0, 2]],
    "available": [0, 1],
}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def client():
    return app_module.app.test_client()


def post_json(payload):
    """POST a Python object as a JSON body with the right Content-Type.

    The body is serialised here (not via the test client's json= argument,
    which sends NO body for None) so that JSON null really is sent as "null".
    """
    return post_raw(json.dumps(payload).encode("utf-8"))


def post_raw(data, content_type="application/json"):
    """POST raw bytes, optionally with a chosen Content-Type."""
    if content_type is None:
        return client().post(URL, data=data)
    return client().post(URL, data=data, content_type=content_type)


def assert_error(response, status, code):
    """Every error: right status, JSON, and the common body shape."""
    assert response.status_code == status
    assert response.mimetype == "application/json"
    body = response.get_json()
    assert body["success"] is False
    assert body["error"] == code
    assert isinstance(body["message"], str) and body["message"]
    return body


# ---------------------------------------------------------------------------
# Existing routes keep working
# ---------------------------------------------------------------------------

def test_home_route_serves_the_simulator_page():
    # Milestone 4: "/" used to return a temporary "environment check" line;
    # it now serves the real page (details are tested in test_frontend.py).
    response = client().get("/")
    assert response.status_code == 200
    assert response.mimetype == "text/html"
    assert b"Deadlock Detection Simulator" in response.data


def test_health_route_still_works():
    response = client().get("/health")
    assert response.status_code == 200
    assert response.get_json() == {"status": "ok"}


def test_debug_mode_is_off_unless_started_from_the_command_line():
    assert app_module.app.debug is False


# ---------------------------------------------------------------------------
# Success responses
# ---------------------------------------------------------------------------

def test_post_no_deadlock_case_a_returns_200_and_correct_result():
    response = post_json(CASE_A)
    assert response.status_code == 200
    assert response.mimetype == "application/json"
    body = response.get_json()
    assert body["success"] is True
    assert body["status"] == "NO_DEADLOCK"
    assert body["deadlocked_processes"] == []
    assert body["completion_sequence"] == ["P1", "P2"]
    assert body["initial_work"] == [1, 1]
    assert body["final_work"] == [2, 2]


def test_post_deadlock_case_b_returns_200_and_deadlocked_processes():
    response = post_json(CASE_B)
    assert response.status_code == 200  # a detected deadlock is a valid answer
    body = response.get_json()
    assert body["success"] is True
    assert body["status"] == "DEADLOCK_DETECTED"
    assert body["deadlocked_processes"] == ["P1", "P2"]
    assert body["completion_sequence"] == []
    assert body["blocked_explanations"]["P1"]["shortages"][0]["resource"] == "R2"


def test_post_mixed_case_c_separates_finished_and_unfinished():
    body = post_json(CASE_C).get_json()
    assert body["status"] == "DEADLOCK_DETECTED"
    assert body["completion_sequence"] == ["P1"]
    assert body["finished_processes"] == ["P1"]
    assert body["deadlocked_processes"] == ["P2", "P3"]
    assert body["final_work"] == [1, 1]


@pytest.mark.parametrize("payload", [CASE_A, CASE_B, CASE_C])
def test_response_is_exactly_the_algorithms_result(payload):
    """No field is renamed, dropped or added by the API layer."""
    expected = detect_deadlock(
        payload["available"], payload["allocation"], payload["request"]
    )
    assert post_json(payload).get_json() == expected


def test_success_body_contains_all_documented_fields():
    body = post_json(CASE_A).get_json()
    for field in (
        "success", "status", "message", "process_count", "resource_count",
        "deadlocked_processes", "finished_processes", "completion_sequence",
        "initially_finished", "finish_status", "initial_work", "final_work",
        "trace", "stop_reason", "blocked_explanations",
    ):
        assert field in body, field
    entry = body["trace"][0]
    for field in (
        "iteration", "work_before", "finish_before", "considered", "selected",
        "selected_request", "allocation_released", "work_after",
    ):
        assert field in entry, field


def test_maximum_size_10x10_request_is_accepted():
    n = 10
    payload = {
        "process_count": n,
        "resource_count": n,
        "allocation": [[1 if j == i else 0 for j in range(n)] for i in range(n)],
        "request": [[1 if j == (i + 1) % n else 0 for j in range(n)] for i in range(n)],
        "available": [0] * n,
    }
    body = post_json(payload).get_json()
    assert body["status"] == "DEADLOCK_DETECTED"
    assert len(body["deadlocked_processes"]) == 10


def test_content_type_with_charset_is_accepted():
    body = json.dumps(CASE_A).encode("utf-8")
    response = post_raw(body, "application/json; charset=utf-8")
    assert response.status_code == 200


def test_same_request_twice_gives_identical_responses():
    assert post_json(CASE_C).get_json() == post_json(CASE_C).get_json()


def test_extra_fields_in_the_body_are_ignored():
    response = post_json(dict(CASE_A, comment="hello"))
    assert response.status_code == 200
    assert response.get_json()["status"] == "NO_DEADLOCK"


# ---------------------------------------------------------------------------
# Regression: valid API input reaches detect_deadlock in the right order
# ---------------------------------------------------------------------------

def test_detect_deadlock_receives_available_allocation_request_in_that_order():
    # All three arguments differ in shape or content, so a swap is detectable.
    payload = {
        "process_count": 3,
        "resource_count": 2,
        "allocation": [[1, 2], [3, 4], [5, 6]],
        "request": [[7, 8], [9, 10], [11, 12]],
        "available": [13, 14],
    }
    sentinel = {"success": True, "sentinel": "from-the-mock"}
    with mock.patch("app.detect_deadlock", return_value=sentinel) as fake:
        response = post_json(payload)
    assert response.status_code == 200
    fake.assert_called_once_with(
        [13, 14],
        [[1, 2], [3, 4], [5, 6]],
        [[7, 8], [9, 10], [11, 12]],
    )
    assert response.get_json() == sentinel  # returned unchanged


def test_request_matrix_is_not_confused_with_the_http_request_object():
    payload = dict(CASE_C, request=[[0, 0], [0, 0], [0, 0]])
    fake_result = {"success": True}
    with mock.patch("app.detect_deadlock", return_value=fake_result) as fake:
        post_json(payload)
    available, allocation, request_matrix = fake.call_args[0]
    assert request_matrix == [[0, 0], [0, 0], [0, 0]]
    assert allocation == CASE_C["allocation"]
    assert available == CASE_C["available"]


# ---------------------------------------------------------------------------
# Validation errors (valid JSON, bad data) -> 400 validation_error
# ---------------------------------------------------------------------------

def _changed(**changes):
    return dict(CASE_A, **changes)


VALIDATION_CASES = [
    pytest.param(_changed(allocation=[[-1, 0], [0, 1]]), "allocation", id="negative-value"),
    pytest.param(_changed(request=[[0, 1.5], [1, 0]]), "request", id="float-value"),
    pytest.param(_changed(available=[1, "1"]), "available", id="string-value"),
    pytest.param(_changed(allocation=[[True, 0], [0, 1]]), "allocation", id="bool-value"),
    pytest.param(_changed(available=[None, 1]), "available", id="null-value"),
    pytest.param(_changed(allocation=[[1, 0]]), "allocation", id="too-few-rows"),
    pytest.param(_changed(request=[[0, 1], [1, 0], [0, 0]]), "request", id="too-many-rows"),
    pytest.param(_changed(allocation=[[1], [0, 1]]), "allocation", id="too-few-columns"),
    pytest.param(_changed(request=[[0, 1, 0], [1, 0, 0]]), "request", id="too-many-columns"),
    pytest.param(_changed(available=[1]), "available", id="available-too-short"),
    pytest.param(_changed(available=[1, 1, 1]), "available", id="available-too-long"),
    pytest.param(_changed(process_count=0), "process_count", id="zero-processes"),
    pytest.param(_changed(resource_count=11), "resource_count", id="eleven-resources"),
    pytest.param(_changed(process_count=2.0), "process_count", id="float-count"),
    pytest.param(_changed(resource_count="2"), "resource_count", id="string-count"),
    pytest.param(_changed(process_count=True), "process_count", id="bool-count"),
    pytest.param({}, "process_count", id="empty-object"),
]


@pytest.mark.parametrize("payload, field", VALIDATION_CASES)
def test_invalid_data_returns_400_validation_error(payload, field):
    response = post_json(payload)
    body = assert_error(response, 400, "validation_error")
    assert body["field"] == field


@pytest.mark.parametrize("payload, field", VALIDATION_CASES)
def test_api_error_body_equals_validation_error_to_dict(payload, field):
    with pytest.raises(ValidationError) as info:
        validate_payload(payload)
    assert post_json(payload).get_json() == info.value.to_dict()


@pytest.mark.parametrize("missing", [
    "process_count", "resource_count", "allocation", "request", "available",
])
def test_missing_field_returns_400_naming_the_field(missing):
    payload = dict(CASE_A)
    del payload[missing]
    body = assert_error(post_json(payload), 400, "validation_error")
    assert body["field"] == missing
    assert missing in body["message"]


@pytest.mark.parametrize("payload", [
    pytest.param(None, id="null"),
    pytest.param([], id="empty-array"),
    pytest.param([CASE_A], id="array-of-objects"),
    pytest.param("deadlock", id="string"),
    pytest.param(5, id="number"),
    pytest.param(True, id="boolean"),
])
def test_valid_json_that_is_not_an_object_is_a_validation_error(payload):
    # The JSON parsed fine, so this is validation_error, NOT invalid_json.
    body = assert_error(post_json(payload), 400, "validation_error")
    assert "JSON object" in body["message"]
    assert body["field"] is None


# ---------------------------------------------------------------------------
# Malformed JSON, missing body, wrong content type
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("raw", [
    pytest.param(b'{"process_count": 2,', id="truncated"),
    pytest.param(b"not json at all", id="plain-text"),
    pytest.param(b"{'process_count': 2}", id="single-quotes"),
    pytest.param(b'{"process_count": 2,}', id="trailing-comma"),
    pytest.param(b"[1, 2", id="unclosed-array"),
    pytest.param(b"{", id="lone-brace"),
    pytest.param(b"\xff\xfe{}", id="invalid-utf8"),
    pytest.param(b"[" * 50000, id="absurdly-deep-nesting"),
])
def test_malformed_json_returns_400_invalid_json(raw):
    assert_error(post_raw(raw), 400, "invalid_json")


def test_malformed_json_message_points_to_the_problem():
    body = assert_error(post_raw(b'{"a": 1,}'), 400, "invalid_json")
    assert "line 1" in body["message"]


def test_malformed_json_is_distinguishable_from_invalid_payload():
    malformed = post_raw(b"{").get_json()["error"]
    wrong_shape = post_json([]).get_json()["error"]
    assert malformed == "invalid_json"
    assert wrong_shape == "validation_error"


@pytest.mark.parametrize("data, content_type", [
    pytest.param(b"", "application/json", id="empty-with-json-type"),
    pytest.param(b"", None, id="empty-without-type"),
    pytest.param(b"   \n\t ", "application/json", id="whitespace-only"),
])
def test_missing_body_returns_400_missing_body(data, content_type):
    assert_error(post_raw(data, content_type), 400, "missing_body")


def test_post_with_no_data_argument_at_all_is_missing_body():
    assert_error(client().post(URL), 400, "missing_body")


@pytest.mark.parametrize("content_type", [
    pytest.param("text/plain", id="text-plain"),
    pytest.param("application/x-www-form-urlencoded", id="form"),
    pytest.param("text/html", id="html"),
    pytest.param("application/xml", id="xml"),
    pytest.param(None, id="no-content-type"),
])
def test_non_json_content_type_returns_415(content_type):
    # The body itself is perfectly good JSON; the declared type is wrong.
    body = json.dumps(CASE_A).encode("utf-8")
    assert_error(post_raw(body, content_type), 415, "unsupported_media_type")


def test_oversized_body_returns_413_json():
    huge = b'{"note": "' + b"a" * (200 * 1024) + b'"}'
    assert_error(post_raw(huge), 413, "payload_too_large")


@pytest.mark.parametrize("bad_request", [
    pytest.param(lambda: post_json(_changed(allocation=[[-1, 0], [0, 1]])), id="validation"),
    pytest.param(lambda: post_json([]), id="non-object"),
    pytest.param(lambda: post_raw(b"{"), id="malformed"),
    pytest.param(lambda: post_raw(b""), id="empty"),
    pytest.param(lambda: post_raw(b"{}", "text/plain"), id="wrong-type"),
])
def test_algorithm_is_never_run_for_rejected_requests(bad_request):
    with mock.patch("app.detect_deadlock") as fake:
        response = bad_request()
    assert response.status_code in (400, 415)
    fake.assert_not_called()


# ---------------------------------------------------------------------------
# Unknown URLs and unsupported methods
# ---------------------------------------------------------------------------

def test_unknown_url_returns_404_json():
    assert_error(client().get("/no/such/page"), 404, "not_found")


def test_unknown_api_endpoint_returns_404_json():
    assert_error(client().post("/api/unknown", json=CASE_A), 404, "not_found")


@pytest.mark.parametrize("method", ["get", "put", "delete", "patch"])
def test_unsupported_method_on_detect_returns_405_json(method):
    response = getattr(client(), method)(URL)
    assert_error(response, 405, "method_not_allowed")
    allow = response.headers["Allow"]
    assert "POST" in allow
    for other in ("GET", "PUT", "DELETE", "PATCH"):
        assert other not in allow


def test_post_to_a_get_only_route_returns_405_json():
    assert_error(client().post("/health", json={}), 405, "method_not_allowed")


# ---------------------------------------------------------------------------
# Unexpected internal errors
# ---------------------------------------------------------------------------

LEAK_MARKERS = (
    "Traceback", "secret internal detail", "RuntimeError", "KeyError",
    ".py", "line ", "File \"", "/home/", "/Users/",
)


def _assert_no_leak(response):
    text = response.get_data(as_text=True)
    for marker in LEAK_MARKERS:
        assert marker not in text, marker


def test_algorithm_crash_returns_generic_500_without_details():
    boom = RuntimeError("secret internal detail at /Users/someone/deadlock.py")
    with mock.patch("app.detect_deadlock", side_effect=boom):
        with mock.patch.object(app_module.app.logger, "exception") as log:
            response = post_json(CASE_A)
    body = assert_error(response, 500, "internal_error")
    assert body["message"] == "Internal server error. Please try again."
    assert sorted(body) == ["error", "message", "success"]
    _assert_no_leak(response)
    log.assert_called_once()  # the details went to the server log instead


def test_validation_layer_crash_returns_generic_500():
    with mock.patch("app.validate_payload", side_effect=KeyError("secret internal detail")):
        with mock.patch.object(app_module.app.logger, "exception") as log:
            response = post_json(CASE_A)
    assert_error(response, 500, "internal_error")
    _assert_no_leak(response)
    log.assert_called_once()


def test_algorithms_own_value_error_is_a_500_not_a_400():
    # After validation a shape problem would be OUR bug, not the client's.
    with mock.patch("app.detect_deadlock", side_effect=ValueError("secret internal detail")):
        with mock.patch.object(app_module.app.logger, "exception"):
            response = post_json(CASE_A)
    assert_error(response, 500, "internal_error")
    _assert_no_leak(response)


def test_unserialisable_result_returns_generic_500():
    with mock.patch("app.detect_deadlock", return_value={"bad": object()}):
        with mock.patch.object(app_module.app.logger, "exception") as log:
            response = post_json(CASE_A)
    assert_error(response, 500, "internal_error")
    log.assert_called_once()


def test_server_still_works_after_an_internal_error():
    with mock.patch("app.detect_deadlock", side_effect=RuntimeError("x")):
        with mock.patch.object(app_module.app.logger, "exception"):
            assert post_json(CASE_A).status_code == 500
    assert post_json(CASE_A).status_code == 200


def test_internal_error_is_really_logged_with_its_traceback():
    # No patching of the logger here: check the real log record.
    import logging

    records = []

    class Collector(logging.Handler):
        def emit(self, record):
            records.append(record)

    handler = Collector()
    app_module.app.logger.addHandler(handler)
    try:
        with mock.patch("app.detect_deadlock", side_effect=RuntimeError("boom-for-log")):
            response = post_json(CASE_A)
    finally:
        app_module.app.logger.removeHandler(handler)
    assert response.status_code == 500
    assert len(records) == 1
    assert records[0].levelname == "ERROR"
    assert records[0].exc_info is not None
    assert "boom-for-log" in str(records[0].exc_info[1])
    assert "boom-for-log" not in response.get_data(as_text=True)
