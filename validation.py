"""Input validation for the Deadlock Detection Simulator (Milestone 2).

Pure Python: no Flask, no HTTP, no import of deadlock.py. The Flask route
(Milestone 3) will call validate_payload() on the already-parsed JSON body,
turn a ValidationError into an HTTP 400 response, and otherwise pass the
returned values to detect_deadlock(available, allocation, request).

Interface
---------
validate_payload(payload) -> dict
    On success returns a NEW dict (deep-copied lists, the caller's data is
    never modified) with exactly these keys:
        process_count, resource_count, allocation, request, available
    On failure raises ValidationError. The algorithm must never be run on
    input that raised.

ValidationError
    .message   human-readable text that says what to fix
    .field     name of the top-level field at fault (or None)
    .to_dict() {"success": False, "error": "validation_error",
                "message": ..., "field": ...}

Rules (nothing is ever coerced; "2", 2.0 and True are all rejected where an
integer is required):
    * payload must be a dict (a parsed JSON object).
    * All five fields must be present. Extra fields are ignored.
    * process_count and resource_count: int (not bool) from 1 to 10.
    * available: list of resource_count entries.
    * allocation, request: lists of process_count rows, each row a list of
      resource_count entries.
    * Every entry: int (not bool), >= 0. There is deliberately NO upper
      limit on the number of instances; only P and R are capped at 10.
    * Only real lists are accepted for vectors/matrices (JSON arrays arrive
      as lists); tuples, strings and dicts are rejected.

Not handled here: invalid JSON *syntax* (the web framework fails to parse
the body before we ever see it; Milestone 3 turns that into an error), and
HTTP status codes.
"""

from typing import Any, Dict, List, Optional

MIN_COUNT = 1
MAX_COUNT = 10

REQUIRED_FIELDS = (
    "process_count",
    "resource_count",
    "allocation",
    "request",
    "available",
)


class ValidationError(Exception):
    """Raised when the submitted data is not acceptable.

    Deliberately NOT a subclass of ValueError, so it cannot be confused with
    the ValueError that detect_deadlock() raises for its own shape guard.
    """

    def __init__(self, message: str, field: Optional[str] = None) -> None:
        super().__init__(message)
        self.message = message
        self.field = field

    def to_dict(self) -> Dict[str, Any]:
        """Error body in the agreed API shape (plus the 'field' hint)."""
        return {
            "success": False,
            "error": "validation_error",
            "message": self.message,
            "field": self.field,
        }


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _is_int(value: Any) -> bool:
    """True for real integers. bool is a subclass of int, so exclude it."""
    return isinstance(value, int) and not isinstance(value, bool)


def _describe(value: Any) -> str:
    """Short JSON-style description of a bad value, for error messages."""
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "a boolean ({})".format("true" if value else "false")
    if isinstance(value, int):
        return str(value)
    if isinstance(value, float):
        return "a decimal number ({})".format(value)
    if isinstance(value, str):
        text = value if len(value) <= 20 else value[:20] + "..."
        return 'a string ("{}")'.format(text)
    if isinstance(value, list):
        return "a list"
    if isinstance(value, dict):
        return "an object"
    return "a value of type {}".format(type(value).__name__)


def _check_count(payload: Dict[str, Any], name: str) -> int:
    value = payload[name]
    if not _is_int(value):
        raise ValidationError(
            "{} must be an integer from {} to {}, got {}.".format(
                name, MIN_COUNT, MAX_COUNT, _describe(value)
            ),
            name,
        )
    if value < MIN_COUNT or value > MAX_COUNT:
        raise ValidationError(
            "{} must be between {} and {}, got {}.".format(
                name, MIN_COUNT, MAX_COUNT, value
            ),
            name,
        )
    return value


def _check_entry(value: Any, where: str, field: str) -> None:
    """One resource count: a non-negative integer."""
    if not _is_int(value) or value < 0:
        raise ValidationError(
            "{} must be a non-negative integer (0, 1, 2, ...), got {}.".format(
                where, _describe(value)
            ),
            field,
        )


def _check_vector(value: Any, name: str, length: int) -> List[int]:
    if not isinstance(value, list):
        raise ValidationError(
            "{} must be a list of {} values (one per resource type), "
            "got {}.".format(name, length, _describe(value)),
            name,
        )
    if len(value) != length:
        raise ValidationError(
            "{} must have {} values (one per resource type), got {}.".format(
                name, length, len(value)
            ),
            name,
        )
    for j, entry in enumerate(value):
        _check_entry(entry, "{} entry {} (R{})".format(name, j + 1, j + 1), name)
    return list(value)


def _check_matrix(
    value: Any, name: str, rows: int, columns: int
) -> List[List[int]]:
    if not isinstance(value, list):
        raise ValidationError(
            "{} must be a list of {} rows, got {}.".format(
                name, rows, _describe(value)
            ),
            name,
        )
    if len(value) != rows:
        raise ValidationError(
            "{} must have {} rows (one per process), got {}.".format(
                name, rows, len(value)
            ),
            name,
        )
    # Pass 1: shape of every row. Dimension problems are reported before
    # problems with individual values.
    for i, row in enumerate(value):
        if not isinstance(row, list):
            raise ValidationError(
                "{} row {} must be a list of {} values, got {}.".format(
                    name, i + 1, columns, _describe(row)
                ),
                name,
            )
        if len(row) != columns:
            raise ValidationError(
                "{} row {} must have {} columns (one per resource type), "
                "got {}.".format(name, i + 1, columns, len(row)),
                name,
            )
    # Pass 2: every value.
    for i, row in enumerate(value):
        for j, entry in enumerate(row):
            _check_entry(
                entry,
                "{} row {}, column {} (P{}, R{})".format(
                    name, i + 1, j + 1, i + 1, j + 1
                ),
                name,
            )
    return [list(row) for row in value]


# ---------------------------------------------------------------------------
# Public function
# ---------------------------------------------------------------------------

def validate_payload(payload: Any) -> Dict[str, Any]:
    """Validate a parsed request body. See the module docstring."""
    if not isinstance(payload, dict):
        raise ValidationError(
            "Request body must be a JSON object, got {}.".format(
                _describe(payload)
            ),
            None,
        )

    missing = [name for name in REQUIRED_FIELDS if name not in payload]
    if missing:
        raise ValidationError(
            "Missing required field{}: {}.".format(
                "s" if len(missing) > 1 else "", ", ".join(missing)
            ),
            missing[0],
        )

    process_count = _check_count(payload, "process_count")
    resource_count = _check_count(payload, "resource_count")

    available = _check_vector(payload["available"], "available", resource_count)
    allocation = _check_matrix(
        payload["allocation"], "allocation", process_count, resource_count
    )
    request = _check_matrix(
        payload["request"], "request", process_count, resource_count
    )

    return {
        "process_count": process_count,
        "resource_count": resource_count,
        "allocation": allocation,
        "request": request,
        "available": available,
    }
