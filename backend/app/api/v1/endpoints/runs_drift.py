"""
Drift report proxy endpoints — Section 11 follow-up FU-3.

Forwards qontinui-web frontend drift requests to the runner's HTTP API on
this backend's own host (`/runs/:run_id/drift[/:entry_id]`, see
`qontinui-runner/src-tauri/src/regression_api/handlers.rs`). Pass-through
of the persisted `drift_report_json` blob from `regression_runs`.

The runner is the canonical store for drift reports. We don't replicate
into qontinui-web's own DB — the proxy returns 503 if the runner is
unreachable and 404 if it has nothing for this run.

**Platform admins only, on the router, so a new route inherits it.** The runner
is whichever one listens on this backend's loopback, it is not tied to the
caller, and it admits this hop with full local trust: the same reach the
co-located arm of ``device_bridge_ws.runner_proxy`` and the constraints proxy
keep for platform admins. These routes used to take no credential at all
(coord finding ``e66c681f-ee4a-4056-aaa7-0212814aafcc``, item 4).

**An id can only be one path segment.** ``run_id`` was spliced into an f-string
URL, and httpx honours a ``?`` or ``#`` and resolves ``.`` and ``..`` there:
``/runs/run-123%3F/drift/x`` sent the runner's ``GET /runs/{id}``.
:func:`_runner_url` now percent-encodes each id into its own segment, so the
runner decodes back exactly the id it was asked about, and the doors below
refuse what an id cannot be, with a 422 before the runner is contacted.
"""

from __future__ import annotations

from typing import Annotated, Any
from urllib.parse import quote

import httpx
import structlog
from fastapi import APIRouter, Depends, Path, status
from pydantic import AfterValidator

from app.api.admin_deps import require_admin
from app.core.refusal import (
    GlossaryTerm,
    NextActionKind,
    RefusalCode,
    RefusalHTTPException,
    refusal_error,
)

logger = structlog.get_logger(__name__)
router = APIRouter(dependencies=[Depends(require_admin)])

#: The co-located runner, spelled as the IPv4 loopback it binds.
RUNNER_HOST = "127.0.0.1"
RUNNER_PORT = 9876
_TIMEOUT = httpx.Timeout(10.0)

#: Statuses that, from THIS backend, are about the caller's own credential, the
#: same three as ``constraints._CALLER_CREDENTIAL_STATUSES``: the frontend reads
#: a 401 as an expired session and a 403 as ``require_admin``'s refusal. A runner
#: answering one of them is never relayed as ours.
_CALLER_CREDENTIAL_STATUSES = frozenset({401, 403, 407})

#: A run id. The runner's one caller mints ``demo-<ms>``
#: (qontinui-runner ``src/pages/regression/RegressionRunPage.tsx``), so this is
#: an allowlist: nothing that means anything in a URL gets in, and no first-
#: character dot, so ``.`` and ``..`` are out. The bound is a bound, not a format.
_RunIdPath = Annotated[
    str,
    Path(
        max_length=256,
        pattern=r"^[A-Za-z0-9_:@+~-][A-Za-z0-9_.:@+~-]*$",
        description=(
            "Letters, digits and _ . : @ + ~ - only, and not starting with a dot."
        ),
    ),
]


def _not_a_dot_segment(value: str) -> str:
    """Refuse ``.`` and ``..``, the two values encoding cannot keep in a segment.

    httpx resolves them as path segments whatever else surrounds them, and a
    dot is unreserved, so percent-encoding leaves them as they are.
    """
    if value in {".", ".."}:
        raise ValueError("a drift entry id cannot be '.' or '..'")
    return value


#: A drift entry id. It is the id of a state, transition or element in the IR
#: document or the runtime registry (``@qontinui/ui-bridge-auto/drift``), which
#: the app author chooses, so ``checkout(v2)``, ``.modal`` or ``Login Page`` can
#: be a real one and the report links to it. An allowlist here would list an
#: entry whose page then refuses it. :func:`_runner_url` keeps any other value
#: inside its segment. An id holding a ``/`` is the exception that stays: Starlette
#: will not route it, so the read is a route 404 and its page a load failure.
_EntryIdPath = Annotated[
    str,
    Path(max_length=256, description="Any id except '.' and '..'."),
    AfterValidator(_not_a_dot_segment),
]


def _runner_url(run_id: str, entry_id: str | None = None) -> httpx.URL:
    """The runner's drift URL, composed from its parts, never an f-string URL."""
    path = f"/runs/{quote(run_id, safe='')}/drift"
    if entry_id is not None:
        path = f"{path}/{quote(entry_id, safe='')}"
    return httpx.URL(scheme="http", host=RUNNER_HOST, port=RUNNER_PORT, path=path)


def _unreachable(
    reason: str, code: RefusalCode, status_code: int
) -> RefusalHTTPException:
    return refusal_error(
        status_code,
        code,
        NextActionKind.retry_later,
        reason,
        discriminator="runs_drift_runner_unreachable",
        glossary_terms=[GlossaryTerm.runner],
    )


def _malformed(reason: str) -> RefusalHTTPException:
    """The runner answered, with something that is not a drift answer."""
    return refusal_error(
        status.HTTP_502_BAD_GATEWAY,
        RefusalCode.upstream_unavailable,
        NextActionKind.retry_later,
        reason,
        discriminator="runs_drift_runner_malformed",
        glossary_terms=[GlossaryTerm.runner],
    )


def _json_or_none(resp: httpx.Response) -> Any:
    """The answer's JSON body; ``None`` for one that is not JSON at all."""
    try:
        return resp.json()
    except ValueError:
        return None


def _runner_error(resp: httpx.Response) -> RefusalHTTPException:
    """The runner answered an error status: say so, in the runner's words.

    A 4xx about the request is relayed with its own status. Anything else, a 5xx
    or one of :data:`_CALLER_CREDENTIAL_STATUSES`, is a 502 naming the runner's
    status, so it is never read as a fault of the caller's own session.
    """
    body = _json_or_none(resp)
    said = body.get("error") if isinstance(body, dict) else None
    said = said or resp.text.strip() or "(no body)"
    if resp.status_code == status.HTTP_404_NOT_FOUND:
        return refusal_error(
            status.HTTP_404_NOT_FOUND,
            RefusalCode.not_found,
            NextActionKind.none_terminal,
            str(said),
            discriminator="runs_drift_not_found",
            glossary_terms=[GlossaryTerm.runner],
        )
    if (
        400 <= resp.status_code < 500
        and resp.status_code not in _CALLER_CREDENTIAL_STATUSES
    ):
        return refusal_error(
            resp.status_code,
            RefusalCode.invalid_request,
            NextActionKind.fix_request,
            f"The runner refused the request ({resp.status_code}): {said}",
            discriminator="runs_drift_runner_refused",
            glossary_terms=[GlossaryTerm.runner],
        )
    return _malformed(f"The runner answered {resp.status_code}: {said}")


async def _proxy_get(url: httpx.URL) -> dict[str, Any]:
    """GET the runner endpoint, return its `data` payload, raise on failure."""
    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        try:
            resp = await client.get(url)
        except httpx.DecodingError as exc:
            logger.warning(
                "runner answer undecodable in drift proxy", url=str(url), error=str(exc)
            )
            raise _malformed("runner response could not be decoded") from exc
        except httpx.TimeoutException as exc:
            logger.warning(
                "runner timeout in drift proxy", url=str(url), error=str(exc)
            )
            raise _unreachable(
                "The runner on this backend's host did not answer in time.",
                RefusalCode.upstream_timeout,
                status.HTTP_504_GATEWAY_TIMEOUT,
            ) from exc
        except httpx.TransportError as exc:
            logger.warning(
                "runner connect error in drift proxy", url=str(url), error=str(exc)
            )
            raise _unreachable(
                "Runner HTTP API is unreachable. "
                "Confirm the runner is up and listening on port 9876.",
                RefusalCode.upstream_unavailable,
                status.HTTP_503_SERVICE_UNAVAILABLE,
            ) from exc

    if resp.status_code >= 400:
        raise _runner_error(resp)

    body = _json_or_none(resp)
    if not isinstance(body, dict) or not body.get("success", False):
        said = body.get("error") if isinstance(body, dict) else None
        raise _malformed(str(said or "runner response envelope malformed"))

    data = body.get("data")
    if not isinstance(data, dict):
        raise _malformed("runner data payload missing or wrong shape")
    return data


@router.get(
    "/{run_id}/drift",
    summary="List drift entries for a run",
    description=(
        "Forwards to the runner's `/runs/:run_id/drift` endpoint and returns "
        "the persisted `DriftReport`. The runner stores the report on the "
        "`regression_runs.drift_report_json` column at run-record time. "
        "Returns 404 when no drift report exists for the run."
    ),
)
async def list_drift_entries(run_id: _RunIdPath) -> dict[str, Any]:
    data = await _proxy_get(_runner_url(run_id))
    # Frontend's `DriftReportView` shape: `{ runId, entries }`. The runner
    # returns `{ entries }` (it doesn't echo the run id back, since the
    # caller already has it). Re-wrap so the frontend contract holds.
    entries = data.get("entries", [])
    return {"runId": run_id, "entries": entries}


@router.get(
    "/{run_id}/drift/{entry_id}",
    summary="Get a single drift entry",
    description=(
        "Forwards to the runner's `/runs/:run_id/drift/:entry_id` endpoint "
        "and returns the matched entry. 404 when the entry id is not "
        "present in the persisted report."
    ),
)
async def get_drift_entry(run_id: _RunIdPath, entry_id: _EntryIdPath) -> dict[str, Any]:
    return await _proxy_get(_runner_url(run_id, entry_id))
