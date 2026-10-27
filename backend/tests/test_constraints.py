"""What the constraints proxy forwards to the co-located runner, for an admin.

``app/api/v1/endpoints/constraints.py`` forwards each route to the runner on
the backend's own host. Who may call it at all is
``tests/test_constraints_platform_admin_gate.py``'s subject; this module is
about what an admin's call does: what reaches the runner, what does not, and
how each failure of the hop is answered.

The runner is a stand-in, a real HTTP server on loopback that records every
request (``tests/_constraints_stand_in.py``), reached through real httpx. The
app is the constraints router behind the production error handler, with
``current_active_user`` answering an active platform admin: the router's real
``require_admin`` runs on top of it. No database is needed.
"""

from __future__ import annotations

import socket
from collections.abc import Iterator
from types import SimpleNamespace
from urllib.parse import quote

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.api.v1.endpoints import constraints
from tests._constraints_stand_in import (
    CONFIG,
    Scripted,
    StandInRunner,
    envelope,
    serving_stand_in,
)

PREFIX = "/api/v1/constraints"

ADMIN = SimpleNamespace(
    id="11111111-1111-1111-1111-111111111111",
    is_active=True,
    is_superuser=True,
)

#: The longest id the runner mints: a replay of a replay of
#: ``trigger-<uuid>-<ms>-<u8>`` (155 characters).
_U1 = "0f8c2a4e-7b1d-4c3a-9e5f-2d6b8a1c3e70"
_U2 = "5a9d3c1b-2e4f-4a6c-8b7d-1c3e5f7a9b20"
_U3 = "c4e6a8b0-d2f4-4e6a-8c0b-2d4f6a8c0e10"
LONGEST_MINTED_ID = f"trigger-{_U1}-1700000000000-ab12cd34-replay-{_U2}-replay-{_U3}"

#: ``task_run_id`` values that would steer the runner GET elsewhere, or are no
#: task-run id. Each reaches the route as ONE path segment: :func:`_segment`
#: percent-encodes it, dots included, so the test client does not resolve
#: ``.`` and ``..`` itself before the backend sees them.
HOSTILE_IDS = [
    "..",
    ".",
    "a#b",
    "a?b",
    "a b",
    "a\\b",
    "%2e%2e",
    "a" * 257,
]


def _segment(value: str) -> str:
    return quote(value, safe="").replace(".", "%2E")


@pytest.fixture()
def runner(monkeypatch: pytest.MonkeyPatch) -> Iterator[StandInRunner]:
    with serving_stand_in(monkeypatch) as stand_in:
        yield stand_in


@pytest.fixture()
def admin_client(runner: StandInRunner) -> TestClient:
    from app.api.deps import current_active_user
    from app.middleware.error_handler import http_exception_handler

    app = FastAPI()
    app.dependency_overrides[current_active_user] = lambda: ADMIN
    app.include_router(constraints.router, prefix=PREFIX)
    app.add_exception_handler(
        StarletteHTTPException,
        http_exception_handler,  # type: ignore[arg-type]
    )
    return TestClient(app)


def _refusal(response: httpx.Response) -> tuple[str, str, str]:
    refusal = response.json()["refusal"]
    return (refusal["code"], refusal["discriminator"], refusal["next_action"]["kind"])


# ---------------------------------------------------------------------------
# What reaches the runner
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("route", ["/active", "/config"])
def test_a_read_without_a_project_path_lets_the_runner_choose(
    admin_client: TestClient, runner: StandInRunner, route: str
) -> None:
    """The runner falls back to its workspace root when no ``project_path``
    comes, which is how the workflow builder reads it."""
    response = admin_client.get(f"{PREFIX}{route}")

    assert response.status_code == 200, response.text
    assert [(r.method, r.target) for r in runner.received] == [
        ("GET", f"/constraints{route}")
    ]


def test_a_read_returns_the_runner_answer_verbatim(
    admin_client: TestClient, runner: StandInRunner
) -> None:
    response = admin_client.get(
        f"{PREFIX}/config", params={"project_path": "/home/acme/project"}
    )

    assert response.json() == envelope(CONFIG)
    assert [r.target for r in runner.received] == [
        "/constraints/config?project_path=%2Fhome%2Facme%2Fproject"
    ]


def test_a_write_without_a_project_path_sends_none(
    admin_client: TestClient, runner: StandInRunner
) -> None:
    response = admin_client.post(f"{PREFIX}/config", json={"toml": "[c]\nk = 1\n"})

    assert response.status_code == 200, response.text
    assert [(r.method, r.target, r.body) for r in runner.received] == [
        ("POST", "/constraints/config", {"toml": "[c]\nk = 1\n"})
    ]


def test_results_without_an_iteration_send_no_query(
    admin_client: TestClient, runner: StandInRunner
) -> None:
    response = admin_client.get(f"{PREFIX}/results/{LONGEST_MINTED_ID}")

    assert response.status_code == 200, response.text
    assert [r.target for r in runner.received] == [
        f"/constraints/results/{LONGEST_MINTED_ID}"
    ]


@pytest.mark.parametrize("task_run_id", HOSTILE_IDS)
def test_a_task_run_id_that_is_no_runner_id_is_refused_before_the_runner(
    admin_client: TestClient, runner: StandInRunner, task_run_id: str
) -> None:
    response = admin_client.get(f"{PREFIX}/results/{_segment(task_run_id)}")

    assert (response.status_code, runner.received) == (422, []), response.text


@pytest.mark.parametrize(
    ("route", "body"), [("/config", {"project_path": "/p"}), ("/validate", {})]
)
def test_a_body_without_toml_is_refused_before_the_runner(
    admin_client: TestClient, runner: StandInRunner, route: str, body: dict
) -> None:
    response = admin_client.post(f"{PREFIX}{route}", json=body)

    assert (response.status_code, runner.received) == (422, []), response.text


def test_the_callers_credentials_and_origin_stay_on_this_side(
    admin_client: TestClient, runner: StandInRunner
) -> None:
    admin_client.get(
        f"{PREFIX}/active",
        headers={
            "Authorization": "Bearer caller-secret",
            "Cookie": "access_token=caller-cookie",
            "Origin": "https://evil.example",
        },
    )

    forwarded = runner.received[0].headers
    assert not {"authorization", "cookie", "origin"} & set(forwarded)
    assert "caller-secret" not in str(forwarded)
    assert "caller-cookie" not in str(forwarded)


# ---------------------------------------------------------------------------
# How each failure of the hop is answered: a typed refusal
# ---------------------------------------------------------------------------


def test_an_unreachable_runner_is_a_502_retry_later(
    admin_client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        closed_port = probe.getsockname()[1]
    monkeypatch.setattr(constraints, "RUNNER_PORT", closed_port)

    response = admin_client.get(f"{PREFIX}/active")

    assert response.status_code == 502, response.text
    assert _refusal(response) == (
        "upstream_unavailable",
        "constraints_runner_unreachable",
        "retry_later",
    )


def test_a_runner_that_does_not_answer_in_time_is_a_504(
    admin_client: TestClient, runner: StandInRunner, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(constraints, "_TIMEOUT", httpx.Timeout(0.2))
    runner.script("GET", "/constraints/active", Scripted(200, "[]", delay=1.0))

    response = admin_client.get(f"{PREFIX}/active")

    assert response.status_code == 504, response.text
    assert _refusal(response) == (
        "upstream_timeout",
        "constraints_runner_timeout",
        "retry_later",
    )


def test_a_runner_refusal_of_the_request_is_relayed_in_its_words(
    admin_client: TestClient, runner: StandInRunner
) -> None:
    runner.script(
        "POST",
        "/constraints/config",
        Scripted(
            400,
            "No project_path provided and no workspace root could be detected",
            content_type="text/plain",
        ),
    )

    response = admin_client.post(f"{PREFIX}/config", json={"toml": "[c]\nk = 1\n"})

    assert response.status_code == 400, response.text
    assert _refusal(response) == (
        "invalid_request",
        "constraints_runner_refused",
        "fix_request",
    )
    assert response.json()["message"] == (
        "The runner refused the request (400): No project_path provided and "
        "no workspace root could be detected"
    )


@pytest.mark.parametrize("runner_status", [500, 401, 403])
def test_a_runner_failure_or_credential_refusal_is_a_502(
    admin_client: TestClient, runner: StandInRunner, runner_status: int
) -> None:
    """A 5xx is the runner's failure, not this backend's; a runner 401 or 403
    relayed as ours would read as the caller's own session failing (a 401 signs
    the browser out) or as ``require_admin`` refusing them."""
    runner.script(
        "GET",
        "/constraints/config",
        Scripted(runner_status, "Failed to read", content_type="text/plain"),
    )

    response = admin_client.get(f"{PREFIX}/config")

    assert response.status_code == 502, response.text
    assert _refusal(response) == (
        "upstream_unavailable",
        "constraints_runner_failed",
        "retry_later",
    )
    body = response.json()
    assert body["runner_status"] == runner_status
    assert body["message"] == f"The runner answered {runner_status}: Failed to read"


def test_a_runner_answer_that_is_not_json_is_a_502(
    admin_client: TestClient, runner: StandInRunner
) -> None:
    runner.script(
        "POST",
        "/constraints/validate",
        Scripted(200, "<html>runner</html>", content_type="text/html"),
    )

    response = admin_client.post(f"{PREFIX}/validate", json={"toml": "[c]\n"})

    assert response.status_code == 502, response.text
    assert _refusal(response) == (
        "upstream_unavailable",
        "constraints_runner_unreadable",
        "report_defect",
    )
