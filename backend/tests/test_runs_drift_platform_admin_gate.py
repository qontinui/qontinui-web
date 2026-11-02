"""``/api/v1/runs/{run_id}/drift[/{entry_id}]`` is for ACTIVE platform admins.

Coord finding ``e66c681f-ee4a-4056-aaa7-0212814aafcc``, item 4: these routes
took no credential and spliced ``run_id`` into an f-string URL on the runner at
this backend's own host. So anyone reached that runner's drift routes, and a
``?`` in ``run_id`` steered the request: ``/runs/run-123%3F/drift/x`` sent the
runner's ``GET /runs/{id}``, whose answer came back with a 200.

The runner is a stand-in, a real HTTP server on loopback that records every
request target it receives, and what it RECEIVED is the evidence: nothing for a
refused caller or a refused id, and exactly the id's own route otherwise. The
no-credential case goes through the production app, so it meets the real
dependency chain; the signed-in cases override that chain's active-user step
with a non-admin and an admin (``require_admin``'s own chain is driven against
Postgres by ``test_constraints_platform_admin_gate.py``).
"""

from __future__ import annotations

import json
from collections.abc import Iterator
from unittest.mock import MagicMock
from uuid import uuid4

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.admin_deps import require_admin
from app.api.deps import get_current_active_user_async
from app.api.v1.endpoints import runs_drift
from tests._constraints_stand_in import Scripted, StandInRunner, envelope

PREFIX = "/api/v1/runs"
REFUSAL_SENTENCE = "Not authorized. Admin access required."

#: The runner's ``GET /runs/{id}``, which the injection reached.
RUN_RECORD = envelope({"id": "run-123", "suite": "the-whole-record"})
ENTRY = {"id": "state-A", "kind": "missing-in-ir", "detail": "state state-A"}
REPORT = envelope({"entries": [ENTRY]})

LIST_URL = f"{PREFIX}/run-123/drift"
ENTRY_URL = f"{PREFIX}/run-123/drift/state-A"
URLS = [LIST_URL, ENTRY_URL]

#: Run ids that are outside the allowlist, percent-encoded as a client sends
#: them. The first is the one that reached ``GET /runs/{id}``.
HOSTILE_RUN_IDS = [
    "run-123%3F",
    "run-123%23",
    "%2E%2E",
    "%2E",
    ".hidden",
    "a%20b",
    "a%5Cb",
    "a%25b",
    "a%00b",
    "a%0A",
    "a" * 257,
]

#: Entry ids encoding cannot keep in a segment, and one past the bound.
HOSTILE_ENTRY_IDS = ["%2E%2E", "%2E", "a" * 257]

#: Entry ids an app author can legally choose, percent-encoded as a client sends
#: them. Each must reach the runner as one segment that decodes back to itself.
FREE_FORM_ENTRY_IDS = [
    ("state:login.submit+v2~x@1", "state%3Alogin.submit%2Bv2~x%401"),
    ("checkout%28v2%29", "checkout%28v2%29"),
    ("Login%20Page", "Login%20Page"),
    ("a%2Cb", "a%2Cb"),
    ("a%3Fb", "a%3Fb"),
    ("a%23b", "a%23b"),
    ("a%25b", "a%25b"),
    ("a%5Cb", "a%5Cb"),
    (".modal", ".modal"),
    ("...", "..."),
    ("a%01b", "a%01b"),
]


@pytest.fixture()
def runner(monkeypatch: pytest.MonkeyPatch) -> Iterator[StandInRunner]:
    stand_in = StandInRunner()
    monkeypatch.setattr(runs_drift, "RUNNER_PORT", stand_in.port)
    stand_in.script("GET", "/runs/run-123", Scripted(200, json.dumps(RUN_RECORD)))
    stand_in.script("GET", "/runs/run-123/drift", Scripted(200, json.dumps(REPORT)))
    stand_in.script(
        "GET", "/runs/run-123/drift/state-A", Scripted(200, json.dumps(envelope(ENTRY)))
    )
    try:
        yield stand_in
    finally:
        stand_in.close()


def _client_as(*, superuser: bool) -> TestClient:
    user = MagicMock()
    user.id = uuid4()
    user.is_active = True
    user.is_superuser = superuser
    app = FastAPI()
    app.dependency_overrides[get_current_active_user_async] = lambda: user
    app.include_router(runs_drift.router, prefix=PREFIX)
    return TestClient(app, raise_server_exceptions=False)


@pytest.fixture()
def admin() -> TestClient:
    return _client_as(superuser=True)


def _targets(runner: StandInRunner) -> list[str]:
    return [r.target for r in runner.received]


@pytest.mark.parametrize("url", URLS)
def test_no_credential_is_a_401_and_the_runner_hears_nothing(
    runner: StandInRunner, url: str
) -> None:
    from app.main import app

    resp = TestClient(app).get(url)

    assert resp.status_code == 401, resp.text
    assert _targets(runner) == []


def test_the_injection_that_was_measured_needs_a_credential_now(
    runner: StandInRunner,
) -> None:
    from app.main import app

    resp = TestClient(app).get(f"{PREFIX}/run-123%3F/drift/x")

    assert resp.status_code == 401, resp.text
    assert "the-whole-record" not in resp.text
    assert _targets(runner) == []


@pytest.mark.parametrize("url", URLS)
def test_a_signed_in_non_admin_is_refused_and_the_runner_hears_nothing(
    runner: StandInRunner, url: str
) -> None:
    resp = _client_as(superuser=False).get(url)

    assert resp.status_code == 403, resp.text
    assert resp.json()["detail"] == REFUSAL_SENTENCE
    assert _targets(runner) == []


def test_the_refusal_reaches_the_wire_with_the_sentence_the_ui_keys_on(
    runner: StandInRunner, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Through the production error handler: the top-level ``message`` is what
    ``frontend/src/lib/api/fleet.ts`` ``isPlatformAdminRefusal`` reads."""
    from app.main import app

    user = MagicMock(id=uuid4(), is_active=True, is_superuser=False)
    monkeypatch.setitem(
        app.dependency_overrides, get_current_active_user_async, lambda: user
    )

    resp = TestClient(app).get(LIST_URL)

    assert resp.status_code == 403, resp.text
    assert resp.json()["message"] == REFUSAL_SENTENCE
    assert resp.json()["refusal"]["discriminator"] == "platform_admin_required"
    assert _targets(runner) == []


def test_the_gate_is_on_the_router_so_a_new_route_inherits_it() -> None:
    assert [d.dependency for d in runs_drift.router.dependencies] == [require_admin]


def test_an_admin_lists_a_runs_drift(runner: StandInRunner, admin: TestClient) -> None:
    resp = admin.get(LIST_URL)

    assert resp.status_code == 200, resp.text
    assert resp.json() == {"runId": "run-123", "entries": [ENTRY]}
    assert _targets(runner) == ["/runs/run-123/drift"]


def test_an_admin_reads_one_entry(runner: StandInRunner, admin: TestClient) -> None:
    resp = admin.get(ENTRY_URL)

    assert resp.status_code == 200, resp.text
    assert resp.json() == ENTRY
    assert _targets(runner) == ["/runs/run-123/drift/state-A"]


@pytest.mark.parametrize("segment", HOSTILE_RUN_IDS)
def test_a_hostile_run_id_is_a_422_before_the_runner_is_contacted(
    runner: StandInRunner, admin: TestClient, segment: str
) -> None:
    for url in (f"{PREFIX}/{segment}/drift", f"{PREFIX}/{segment}/drift/x"):
        resp = admin.get(url)

        assert resp.status_code == 422, f"{url}: {resp.text}"
    assert _targets(runner) == []


@pytest.mark.parametrize("segment", HOSTILE_ENTRY_IDS)
def test_a_hostile_entry_id_is_a_422_before_the_runner_is_contacted(
    runner: StandInRunner, admin: TestClient, segment: str
) -> None:
    resp = admin.get(f"{PREFIX}/run-123/drift/{segment}")

    assert resp.status_code == 422, resp.text
    assert _targets(runner) == []


@pytest.mark.parametrize(("sent", "received"), FREE_FORM_ENTRY_IDS)
def test_a_free_form_entry_id_reaches_the_runner_as_one_segment(
    runner: StandInRunner, admin: TestClient, sent: str, received: str
) -> None:
    """The report lists whatever id the app author chose, so its page has to be
    able to read it. A ``?`` or ``#`` here is part of the id, never the URL's."""
    resp = admin.get(f"{PREFIX}/run-123/drift/{sent}")

    assert resp.status_code == 404, resp.text
    assert _targets(runner) == [f"/runs/run-123/drift/{received}"]


def test_the_length_bound_admits_256_characters(
    runner: StandInRunner, admin: TestClient
) -> None:
    run_id = "a" * 256

    resp = admin.get(f"{PREFIX}/{run_id}/drift")

    assert resp.status_code == 404, resp.text
    assert _targets(runner) == [f"/runs/{run_id}/drift"]


@pytest.mark.parametrize("hostile", ["run-123?", "a#b", "../apps", "a/b", "%2e"])
def test_the_url_keeps_any_value_inside_one_segment(hostile: str) -> None:
    """Under the doors: the composed URL carries no query, no fragment and no
    extra segment for any of these. ``.`` and ``..`` are the doors' to refuse."""
    url = runs_drift._runner_url(hostile, hostile)

    assert url.query == b""
    assert url.fragment == ""
    assert url.host == "127.0.0.1"
    assert url.raw_path.count(b"/") == 4
    assert url.raw_path.startswith(b"/runs/")
    assert b"/drift/" in url.raw_path


@pytest.mark.parametrize(
    "answer",
    [
        Scripted(200, "[1, 2]"),
        Scripted(200, "<html>not json</html>", "text/html"),
        Scripted(200, json.dumps({"success": True, "data": [1]})),
    ],
    ids=["array", "html", "data-not-object"],
)
def test_a_200_that_is_no_drift_answer_is_a_502(
    runner: StandInRunner, admin: TestClient, answer: Scripted
) -> None:
    runner.script("GET", "/runs/run-123/drift", answer)

    resp = admin.get(LIST_URL)

    assert resp.status_code == 502, resp.text


def test_a_runner_that_says_it_failed_is_a_502_with_its_reason(
    runner: StandInRunner, admin: TestClient
) -> None:
    runner.script(
        "GET",
        "/runs/run-123/drift",
        Scripted(200, json.dumps({"success": False, "error": "storage down"})),
    )

    resp = admin.get(LIST_URL)

    assert resp.status_code == 502, resp.text
    assert "storage down" in resp.text


@pytest.mark.parametrize("status", [401, 403, 407, 500])
def test_a_runner_status_is_never_relayed_as_about_the_callers_session(
    runner: StandInRunner, admin: TestClient, status: int
) -> None:
    runner.script(
        "GET", "/runs/run-123/drift", Scripted(status, '{"error": "runner said no"}')
    )

    resp = admin.get(LIST_URL)

    assert resp.status_code == 502, resp.text
    assert f"answered {status}" in resp.text
    assert "runner said no" in resp.text


@pytest.mark.parametrize(
    "answer",
    [
        Scripted(500, "<html>boom</html>", "text/html"),
        Scripted(400, "[1]"),
    ],
    ids=["html-500", "array-400"],
)
def test_an_error_body_that_is_no_object_still_gets_its_status_mapped(
    runner: StandInRunner, admin: TestClient, answer: Scripted
) -> None:
    runner.script("GET", "/runs/run-123/drift", answer)

    resp = admin.get(LIST_URL)

    assert resp.status_code == (400 if answer.status == 400 else 502), resp.text


def test_a_runners_refusal_of_the_request_keeps_its_status(
    runner: StandInRunner, admin: TestClient
) -> None:
    runner.script(
        "GET", "/runs/run-123/drift", Scripted(400, '{"error": "empty run id"}')
    )

    resp = admin.get(LIST_URL)

    assert resp.status_code == 400, resp.text
    assert "empty run id" in resp.text


def test_the_runners_not_found_sentence_is_what_the_ui_reads(
    runner: StandInRunner, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Through the production error handler. ``drift-api.ts`` keys its labelled
    "no report" state on this sentence, so a report-less run is not a failure."""
    from app.main import app

    user = MagicMock(id=uuid4(), is_active=True, is_superuser=True)
    monkeypatch.setitem(
        app.dependency_overrides, get_current_active_user_async, lambda: user
    )
    runner.script(
        "GET",
        "/runs/run-123/drift",
        Scripted(404, '{"success": false, "error": "drift-report-not-found"}'),
    )

    resp = TestClient(app).get(LIST_URL)

    assert resp.status_code == 404, resp.text
    assert resp.json()["message"] == "drift-report-not-found"


@pytest.mark.parametrize(
    ("error", "status"),
    [
        (httpx.ConnectError("refused"), 503),
        (httpx.ReadTimeout("slow"), 504),
        (httpx.DecodingError("bad content-encoding"), 502),
    ],
    ids=["refused", "timeout", "undecodable"],
)
def test_a_runner_that_never_answers_says_which(
    monkeypatch: pytest.MonkeyPatch,
    admin: TestClient,
    error: httpx.HTTPError,
    status: int,
) -> None:
    def fail(_request: httpx.Request) -> httpx.Response:
        raise error

    real_client = httpx.AsyncClient
    monkeypatch.setattr(
        runs_drift.httpx,
        "AsyncClient",
        lambda **kw: real_client(transport=httpx.MockTransport(fail), **kw),
    )

    resp = admin.get(LIST_URL)

    assert resp.status_code == status, resp.text
