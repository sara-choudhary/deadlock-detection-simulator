"""Flask application for the Deadlock Detection Simulator (Milestone 3).

Routes
------
GET  /            the simulator page (templates/index.html)
GET  /static/...  its CSS and JavaScript
GET  /health      {"status": "ok"}
POST /api/detect  run deadlock detection on a JSON body

POST /api/detect pipeline
-------------------------
1. read the raw body          empty                -> 400 missing_body
2. check Content-Type         not JSON             -> 415 unsupported_media_type
3. parse JSON                 bad syntax           -> 400 invalid_json
4. validate_payload()         bad data             -> 400 validation_error
5. detect_deadlock(available, allocation, request) -> 200 + the result as is

Every error body has the same shape:
    {"success": false, "error": "<code>", "message": "<text>"}
(validation_error also carries "field"). Unexpected exceptions are logged
on the server and answered with a generic 500; no stack trace or internal
detail is ever sent to the client.
"""

import json

from flask import Flask, jsonify, render_template, request
from werkzeug.exceptions import HTTPException, MethodNotAllowed

from deadlock import detect_deadlock
from validation import ValidationError, validate_payload

app = Flask(__name__)

# A 10 x 10 problem is a few hundred bytes. Refuse anything much larger
# before parsing it (answered with 413).
MAX_BODY_BYTES = 100 * 1024
app.config["MAX_CONTENT_LENGTH"] = MAX_BODY_BYTES


class ApiError(Exception):
    """A client mistake detected by this module (not by validation.py)."""

    def __init__(self, code, message, status):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status = status


def _error_response(code, message, status):
    body = {"success": False, "error": code, "message": message}
    return jsonify(body), status


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.route("/")
def home():
    # The simulator page. templates/index.html loads static/css and static/js.
    return render_template("index.html")


@app.route("/health")
def health():
    return jsonify({"status": "ok"})


def _parse_json_body():
    """Return the parsed JSON body, or raise ApiError.

    Done by hand (not request.get_json) so that "no body", "wrong content
    type", "broken JSON" and "valid JSON containing null" can be told apart.
    """
    raw = request.get_data()
    if not raw.strip():
        raise ApiError(
            "missing_body", "Request body is empty. Send a JSON object.", 400
        )
    if not request.is_json:
        raise ApiError(
            "unsupported_media_type",
            "Content-Type must be application/json.",
            415,
        )
    try:
        return json.loads(raw.decode("utf-8"))
    except json.JSONDecodeError as exc:
        raise ApiError(
            "invalid_json",
            "Request body is not valid JSON ({} at line {}, column {}).".format(
                exc.msg, exc.lineno, exc.colno
            ),
            400,
        )
    except (ValueError, RecursionError):
        # Not valid UTF-8, absurdly deep nesting, oversized number literal...
        raise ApiError("invalid_json", "Request body is not valid JSON.", 400)


@app.route("/api/detect", methods=["POST"])
def api_detect():
    payload = _parse_json_body()
    data = validate_payload(payload)  # raises ValidationError on bad input
    result = detect_deadlock(
        data["available"], data["allocation"], data["request"]
    )
    return jsonify(result)


# ---------------------------------------------------------------------------
# Error handlers (all answers are JSON)
# ---------------------------------------------------------------------------

@app.errorhandler(ValidationError)
def handle_validation_error(exc):
    return jsonify(exc.to_dict()), 400


@app.errorhandler(ApiError)
def handle_api_error(exc):
    return _error_response(exc.code, exc.message, exc.status)


_HTTP_ERRORS = {
    404: ("not_found", "The requested URL was not found."),
    405: ("method_not_allowed", "This URL does not support that HTTP method."),
    413: (
        "payload_too_large",
        "Request body is too large (limit {} KB).".format(MAX_BODY_BYTES // 1024),
    ),
}


@app.errorhandler(HTTPException)
def handle_http_exception(exc):
    code, message = _HTTP_ERRORS.get(exc.code, ("http_error", exc.name))
    response, status = _error_response(code, message, exc.code)
    if isinstance(exc, MethodNotAllowed) and exc.valid_methods:
        response.headers["Allow"] = ", ".join(exc.valid_methods)
    return response, status


@app.errorhandler(Exception)
def handle_unexpected_error(exc):
    # Full details go to the server log only.
    app.logger.exception(
        "Unhandled error while serving %s %s", request.method, request.path
    )
    return _error_response(
        "internal_error", "Internal server error. Please try again.", 500
    )


if __name__ == "__main__":
    # Port 5001 because macOS's AirPlay Receiver often occupies port 5000.
    # Debug mode is for local development only.
    app.run(host="127.0.0.1", port=5001, debug=True)
