"""Backend-side checks for the frontend (Milestone 4).

These tests do NOT drive a browser. They check the things Python can check:
the page and its files are served, every element the JavaScript looks for
exists in the HTML, the example scenarios are valid and give the expected
answers through the REAL API, the JavaScript avoids unsafe patterns, and (when
Node is installed) the page's checking code passes its own tests.

What a browser does with the page (clicking, typing, loading states, network
failures, double clicks) is covered by the manual checklist, not by pytest.
"""

import json
import re
import shutil
import subprocess
from pathlib import Path

import pytest

import app as app_module

ROOT = Path(__file__).resolve().parent.parent
TEMPLATE = ROOT / "templates" / "index.html"
STATIC = ROOT / "static"
JS_FILES = ["app.js", "logic.js", "samples.js"]


def client():
    return app_module.app.test_client()


def read(path):
    return Path(path).read_text(encoding="utf-8")


def load_samples():
    """Read static/js/samples.js back as data (the list is plain JSON)."""
    text = read(STATIC / "js" / "samples.js")
    start = text.index("window.DEADLOCK_SAMPLES =") + len("window.DEADLOCK_SAMPLES =")
    end = text.rindex("];") + 1
    return json.loads(text[start:end])


# ---------------------------------------------------------------------------
# The page and its files are served
# ---------------------------------------------------------------------------

def test_home_page_is_html_with_title_and_script_tags():
    response = client().get("/")
    assert response.status_code == 200
    assert response.mimetype == "text/html"
    html = response.get_data(as_text=True)
    assert "<title>Deadlock Detection Simulator</title>" in html
    for name in JS_FILES:
        assert "/static/js/{}".format(name) in html
    assert "/static/css/style.css" in html


def test_every_static_file_the_page_loads_is_served():
    html = client().get("/").get_data(as_text=True)
    urls = re.findall(r'(?:src|href)="(/static/[^"]+)"', html)
    assert len(urls) == 4
    for url in urls:
        response = client().get(url)
        assert response.status_code == 200, url
        assert len(response.data) > 100, url
        response.close()


def test_static_scripts_load_in_dependency_order():
    html = client().get("/").get_data(as_text=True)
    order = [html.index("js/" + name) for name in ("samples.js", "logic.js", "app.js")]
    assert order == sorted(order)  # app.js needs the other two first


def test_missing_static_file_is_a_json_404():
    response = client().get("/static/js/nope.js")
    assert response.status_code == 404
    assert response.get_json()["error"] == "not_found"


def test_health_and_api_still_work_next_to_the_page():
    assert client().get("/health").get_json() == {"status": "ok"}
    assert client().get("/api/detect").status_code == 405


def test_every_element_id_the_script_uses_exists_in_the_html():
    html = read(TEMPLATE)
    html_ids = set(re.findall(r'\bid="([\w-]+)"', html))
    used = set(re.findall(r'\$\("([\w-]+)"\)', read(STATIC / "js" / "app.js")))
    assert used, "expected app.js to look up elements by id"
    assert used <= html_ids, "ids missing from index.html: {}".format(sorted(used - html_ids))


def test_page_has_every_control_the_task_asks_for():
    html = read(TEMPLATE)
    for needed in (
        'id="p-count"', 'id="r-count"', 'id="available-grid"',
        'id="allocation-grid"', 'id="request-grid"', 'id="detect-btn"',
        'id="reset-btn"', 'id="clear-btn"', 'id="load-sample-btn"',
        'id="results"', 'id="input-errors"', 'id="api-error"',
    ):
        assert needed in html, needed
    assert 'lang="en"' in html and 'name="viewport"' in html


# ---------------------------------------------------------------------------
# The script talks to the API correctly and avoids unsafe patterns
# ---------------------------------------------------------------------------

def test_script_posts_json_to_the_detect_endpoint():
    source = read(STATIC / "js" / "app.js")
    assert 'fetch("/api/detect"' in source
    assert 'method: "POST"' in source
    assert '"Content-Type": "application/json"' in source
    assert "JSON.stringify(check.payload)" in source


@pytest.mark.parametrize("name", JS_FILES)
def test_script_does_not_insert_html_or_run_dynamic_code(name):
    source = read(STATIC / "js" / name)
    for forbidden in ("innerHTML", "outerHTML", "insertAdjacentHTML",
                      "document.write", "eval(", "new Function"):
        assert forbidden not in source, "{} uses {}".format(name, forbidden)


def test_script_never_decides_deadlock_itself():
    # The only place a verdict can come from is the server's `status` field.
    logic = read(STATIC / "js" / "logic.js")
    app_js = read(STATIC / "js" / "app.js")
    assert "STATUS_DEADLOCK" in app_js
    for source in (logic, app_js):
        assert "detect_deadlock" not in source
        assert not re.search(r"\bwork\s*\[\w+\]\s*[+-]=", source, re.IGNORECASE)


def test_default_reset_sample_exists():
    default_id = re.search(r'DEFAULT_SAMPLE_ID\s*=\s*"([^"]+)"', read(STATIC / "js" / "app.js"))
    assert default_id
    assert default_id.group(1) in [s["id"] for s in load_samples()]


# ---------------------------------------------------------------------------
# Example scenarios: valid inputs, and the right answers from the real API
# ---------------------------------------------------------------------------

# Expected answers, calculated by hand (lowest-index-first). Only the TEST knows
# these; the page stores inputs only and always asks the server for the answer.
#   status, deadlocked, completion order, initially finished, final Work
EXPECTED = {
    # P3 holds R3 and asks for nothing: finishes, Work=[0,0,1]. P1 needs R2
    # and P2 needs R1, neither is free.
    "deadlock-with-independent": ("DEADLOCK_DETECTED", ["P1", "P2"], ["P3"], [], [0, 0, 1]),
    # Work=[1,1]: P1 -> [2,1]; P2 -> [2,2].
    "all-finish": ("NO_DEADLOCK", [], ["P1", "P2"], [], [2, 2]),
    # Work=[1,0]: P2 needs [0,2] no; P1 needs [1,0] yes -> [1,2]; P2 yes -> [2,2].
    # (Lowest index first picks P1 anyway, so the order is P1, P2.)
    "release-chain": ("NO_DEADLOCK", [], ["P1", "P2"], [], [2, 2]),
    # Textbook 5x3: P1, P3, P2, P4, P5 ending at the totals [7,2,6].
    "textbook-five-processes": ("NO_DEADLOCK", [], ["P1", "P3", "P2", "P4", "P5"], [], [7, 2, 6]),
    # Same but P3 also needs 1 R3: only P1 can finish, Work=[0,1,0].
    "multi-resource-deadlock": ("DEADLOCK_DETECTED", ["P2", "P3", "P4", "P5"], ["P1"], [], [0, 1, 0]),
    # P2 holds nothing, starts finished; P1 and P3 wait on each other.
    "zero-allocation-edge": ("DEADLOCK_DETECTED", ["P1", "P3"], [], ["P2"], [0, 0]),
}


def sample_payload(sample):
    keys = ("process_count", "resource_count", "allocation", "request", "available")
    return {key: sample[key] for key in keys}


def test_every_sample_has_an_expected_answer_and_vice_versa():
    assert sorted(s["id"] for s in load_samples()) == sorted(EXPECTED)


def test_samples_cover_the_five_required_kinds_and_have_descriptions():
    samples = load_samples()
    assert len(samples) >= 5
    assert len({s["id"] for s in samples}) == len(samples)
    statuses = {EXPECTED[s["id"]][0] for s in samples}
    assert statuses == {"NO_DEADLOCK", "DEADLOCK_DETECTED"}
    assert any(EXPECTED[s["id"]][3] for s in samples)        # zero-allocation process
    assert any(s["resource_count"] >= 2 and max(max(r) for r in s["allocation"]) > 1
               for s in samples)                              # several instances
    for s in samples:
        assert len(s["description"]) > 30, s["id"]


@pytest.mark.parametrize("sample_id", sorted(EXPECTED))
def test_sample_gets_the_expected_answer_from_the_real_api(sample_id):
    sample = next(s for s in load_samples() if s["id"] == sample_id)
    response = client().post("/api/detect", json=sample_payload(sample))
    assert response.status_code == 200, response.get_json()
    body = response.get_json()
    status, deadlocked, completion, initially, final_work = EXPECTED[sample_id]
    assert body["status"] == status
    assert body["deadlocked_processes"] == deadlocked
    assert body["completion_sequence"] == completion
    assert body["initially_finished"] == initially
    assert body["final_work"] == final_work


def test_samples_contain_inputs_only_no_stored_answers():
    allowed = {"id", "name", "description", "process_count", "resource_count",
               "available", "allocation", "request"}
    for sample in load_samples():
        assert set(sample) == allowed, sample["id"]


@pytest.mark.parametrize("sample", load_samples(), ids=lambda s: s["id"])
def test_sample_dimensions_match_matrices(sample):
    p = sample["process_count"]
    r = sample["resource_count"]

    assert len(sample["available"]) == r, sample["id"]
    assert len(sample["allocation"]) == p, sample["id"]
    assert len(sample["request"]) == p, sample["id"]

    for row in sample["allocation"]:
        assert len(row) == r, sample["id"]
    for row in sample["request"]:
        assert len(row) == r, sample["id"]


@pytest.mark.parametrize("sample", load_samples(), ids=lambda s: s["id"])
def test_sample_name_and_description_match_dimensions(sample):
    import re

    p = sample["process_count"]
    r = sample["resource_count"]
    name = sample["name"]
    description = sample["description"]

    # If a name says "N processes" without describing a subset,
    # N must equal the total process count.
    match = re.search(r"\b(\d+)\s+processes\b", name, re.IGNORECASE)
    if match and not re.search(r"\b(stuck|deadlocked)\b", name, re.IGNORECASE):
        assert int(match.group(1)) == p, sample["id"]

    # Every process/resource label mentioned in the description must exist.
    for number in map(int, re.findall(r"\bP(\d+)\b", description)):
        assert 1 <= number <= p, sample["id"]
    for number in map(int, re.findall(r"\bR(\d+)\b", description)):
        assert 1 <= number <= r, sample["id"]



# ---------------------------------------------------------------------------
# JavaScript test fixtures stay in step with the real backend
# ---------------------------------------------------------------------------

FIXTURES = sorted((ROOT / "tests" / "js" / "fixtures").glob("*.json"))


def test_fixture_files_exist():
    assert len(FIXTURES) >= 2


@pytest.mark.parametrize("path", FIXTURES, ids=[p.stem for p in FIXTURES])
def test_js_fixture_equals_what_the_real_api_returns_now(path):
    fixture = json.loads(read(path))
    live = client().post("/api/detect", json=fixture["payload"]).get_json()
    assert live == fixture["response"]


# ---------------------------------------------------------------------------
# The page's own JavaScript tests (need Node; skipped when it is not installed)
# ---------------------------------------------------------------------------

def test_javascript_logic_tests_pass_under_node():
    node = shutil.which("node")
    if node is None:
        pytest.skip("Node.js is not installed; the page logic tests were not run")
    version = subprocess.run([node, "--version"], capture_output=True, text=True).stdout
    major = int(version.strip().lstrip("v").split(".")[0])
    if major < 18:
        pytest.skip("Node 18 or newer is needed; found {}".format(version.strip()))
    result = subprocess.run(
        [node, "--test", "tests/js/logic.test.js"],
        cwd=str(ROOT), capture_output=True, text=True, timeout=120,
    )
    assert result.returncode == 0, result.stdout[-3000:] + result.stderr[-1000:]
