"""Constraint engine proxy endpoints: for ACTIVE platform admins only.

The constraint engine lives in the runner. Every route here forwards to the
runner's HTTP API on THIS backend's own host (:data:`RUNNER_HOST`,
:data:`RUNNER_PORT`) so the web frontend can reach it.

Why the whole router is gated on :func:`app.api.admin_deps.require_admin`
(coord finding ``5a6791e9-607c-4658-82e2-3b509e459996``): the hop sends no
``Origin`` header, so the runner's origin guard classes it NonBrowser and lets
it reach every route with full local trust (qontinui-runner
``src-tauri/src/mcp/origin_guard.rs``), and nothing ties the runner that
answers to the caller. ``POST /config`` overwrites the ``constraints.toml``
the runner finds walking up from the given ``project_path`` (from its own
workspace root when none is given), or creates
``<project_path>/.qontinui/constraints.toml``. A
``[[constraint]]`` in it is enabled by default and its check may be
``type = "command"``, which the runner's workflow loop runs in the project root
after every agentic iteration that modified files (``constraint_engine/
evaluator.rs`` ``check_command``). Open to every signed-in user, that write was
code execution on the backend's host in every later workflow loop that finds
the file: the impact class of the fleet app-config write ``fleet_targets.py``
gates on the same dependency (coord finding
``b27adf71-4de5-49bc-ad89-7a8acd372035``). The two GETs read the config found
from a caller-chosen path, and ``/validate`` and ``/results`` forward caller
input to the same runner, so they are gated too. The gate sits on the ROUTER,
so a route added here later is gated without anyone remembering to: a missing
or invalid bearer, a coord device JWT and an inactive user get 401, an active
user who is not a platform admin gets ``require_admin``'s typed 403, and
nothing is forwarded to the runner for any of them.

Runner URLs are composed from their parts (:func:`_runner_url`), never an
f-string, and the one path parameter, ``task_run_id``, is held to the
characters a runner-minted id carries, so no input chooses another runner
route. Every error this module answers is a typed refusal
(:func:`app.core.refusal.refusal_error`).
"""

from typing import Annotated, Any

import httpx
from fastapi import APIRouter, Depends, Path, Query, status
from pydantic import BaseModel

from app.api.admin_deps import require_admin
from app.core.refusal import (
    GlossaryTerm,
    NextActionKind,
    RefusalCode,
    RefusalHTTPException,
    refusal_error,
)

router = APIRouter(dependencies=[Depends(require_admin)])

#: The co-located runner: the one listening on this backend's own host.
RUNNER_HOST = "localhost"
RUNNER_PORT = 9876
_TIMEOUT = httpx.Timeout(15.0)

#: Statuses that, from THIS backend, are about the caller's own credential: the
#: frontend's HTTP client reads a 401 as an expired session, and a 403 is how
#: ``require_admin`` refuses the caller. A runner answering one of them is
#: never relayed as ours.
_CALLER_CREDENTIAL_STATUSES = frozenset({401, 403, 407})


# ---------------------------------------------------------------------------
# Request models and parameters
# ---------------------------------------------------------------------------


class WriteConfigRequest(BaseModel):
    project_path: str | None = None
    toml: str


class ValidateConfigRequest(BaseModel):
    toml: str


_ProjectPathQuery = Annotated[
    str | None,
    Query(
        description=(
            "Absolute path of the project on the runner's host. Omitted, the "
            "runner uses its own workspace root."
        ),
    ),
]

#: A runner task-run id, as ``/results/{task_run_id}`` takes it: the characters
#: every runner-minted id carries (a UUID, or a ``-``-joined composite of words,
#: UUIDs, timestamps and numbers), the same bound the per-runner operations
#: proxies put on theirs. Anything else is a 422 before the runner is
#: contacted, so ``.``, ``..``, ``?`` and ``#`` cannot steer the runner GET.
_TaskRunIdPath = Annotated[
    str,
    Path(
        max_length=256,
        pattern=r"^[A-Za-z0-9_-]+$",
        description="A runner task-run id: letters, digits, '-' and '_' only.",
    ),
]


# ---------------------------------------------------------------------------
# The hop to the runner
# ---------------------------------------------------------------------------


def _runner_url(path: str) -> httpx.URL:
    """The co-located runner's URL for ``path``, composed from its parts."""
    return httpx.URL(scheme="http", host=RUNNER_HOST, port=RUNNER_PORT, path=path)


def _runner_unreachable() -> RefusalHTTPException:
    return refusal_error(
        status.HTTP_502_BAD_GATEWAY,
        RefusalCode.upstream_unavailable,
        NextActionKind.retry_later,
        "The runner on this backend's host is not reachable. Start the desktop "
        "runner, then try again.",
        discriminator="constraints_runner_unreachable",
        glossary_terms=[GlossaryTerm.runner],
    )


def _runner_timeout() -> RefusalHTTPException:
    return refusal_error(
        status.HTTP_504_GATEWAY_TIMEOUT,
        RefusalCode.upstream_timeout,
        NextActionKind.retry_later,
        "The runner on this backend's host did not answer in time.",
        discriminator="constraints_runner_timeout",
        glossary_terms=[GlossaryTerm.runner],
    )


def _runner_answered_error(resp: httpx.Response) -> RefusalHTTPException:
    """The runner answered an error status: say so, in the runner's words.

    A 4xx about the request (an unparseable body, no workspace root) is relayed
    with its own status, as something the caller fixes. Anything else, a 5xx or
    one of :data:`_CALLER_CREDENTIAL_STATUSES`, is a 502 naming the runner's
    status, so it is never read as a fault of the caller's own session.
    """
    said = resp.text.strip() or "(no body)"
    if (
        400 <= resp.status_code < 500
        and resp.status_code not in _CALLER_CREDENTIAL_STATUSES
    ):
        return refusal_error(
            resp.status_code,
            RefusalCode.invalid_request,
            NextActionKind.fix_request,
            f"The runner refused the request ({resp.status_code}): {said}",
            discriminator="constraints_runner_refused",
            glossary_terms=[GlossaryTerm.runner],
        )
    return refusal_error(
        status.HTTP_502_BAD_GATEWAY,
        RefusalCode.upstream_unavailable,
        NextActionKind.retry_later,
        f"The runner answered {resp.status_code}: {said}",
        discriminator="constraints_runner_failed",
        glossary_terms=[GlossaryTerm.runner],
        metadata={"runner_status": resp.status_code},
    )


async def _forward(
    method: str,
    path: str,
    *,
    params: dict[str, Any] | None = None,
    body: dict[str, Any] | None = None,
) -> Any:
    """Send one request to the co-located runner; return its JSON body."""
    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        try:
            resp = await client.request(
                method, _runner_url(path), params=params, json=body
            )
        except httpx.ConnectError:
            raise _runner_unreachable() from None
        except httpx.TimeoutException:
            raise _runner_timeout() from None
    if resp.status_code >= 400:
        raise _runner_answered_error(resp)
    try:
        return resp.json()
    except ValueError:
        raise refusal_error(
            status.HTTP_502_BAD_GATEWAY,
            RefusalCode.upstream_unavailable,
            NextActionKind.report_defect,
            f"The runner answered {resp.status_code} with a body that is not JSON.",
            discriminator="constraints_runner_unreadable",
            glossary_terms=[GlossaryTerm.runner],
        ) from None


def _project_params(project_path: str | None) -> dict[str, Any]:
    """``project_path`` as a runner query, or none: the runner then uses its
    workspace root."""
    return {} if project_path is None else {"project_path": project_path}


# ---------------------------------------------------------------------------
# Endpoints (every one gated by the router's require_admin)
# ---------------------------------------------------------------------------


@router.get(
    "/active",
    summary="Get active constraints",
    description=(
        "Proxy to the co-located runner: the active constraints for a project. "
        "Platform admins only."
    ),
)
async def get_active_constraints(project_path: _ProjectPathQuery = None) -> Any:
    return await _forward(
        "GET", "/constraints/active", params=_project_params(project_path)
    )


@router.get(
    "/config",
    summary="Get constraint config",
    description=(
        "Proxy to the co-located runner: the constraint TOML config found from "
        "a project path. Platform admins only."
    ),
)
async def get_constraint_config(project_path: _ProjectPathQuery = None) -> Any:
    return await _forward(
        "GET", "/constraints/config", params=_project_params(project_path)
    )


@router.post(
    "/config",
    summary="Write constraint config",
    description=(
        "Proxy to the co-located runner: writes a constraint TOML config, whose "
        "command checks the runner's workflow loop executes. Platform admins "
        "only."
    ),
)
async def write_constraint_config(body: WriteConfigRequest) -> Any:
    return await _forward(
        "POST", "/constraints/config", body=body.model_dump(exclude_none=True)
    )


@router.post(
    "/validate",
    summary="Validate constraint config",
    description=(
        "Proxy to the co-located runner: validates a TOML config string without "
        "writing it. Platform admins only."
    ),
)
async def validate_constraint_config(body: ValidateConfigRequest) -> Any:
    return await _forward("POST", "/constraints/validate", body=body.model_dump())


@router.get(
    "/results/{task_run_id}",
    summary="Get constraint results",
    description=(
        "Proxy to the co-located runner: constraint evaluation results for a "
        "task run. Platform admins only."
    ),
)
async def get_constraint_results(
    task_run_id: _TaskRunIdPath,
    iteration: int | None = Query(None, description="Filter by iteration number"),
) -> Any:
    params = {} if iteration is None else {"iteration": iteration}
    return await _forward("GET", f"/constraints/results/{task_run_id}", params=params)
