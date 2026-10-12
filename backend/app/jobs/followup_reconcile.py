"""Scheduled reconcile of ``fixing`` plan-library follow-ups.

Plan ``2026-10-10-small-followups-are-recorded-but-nothing-burns-them-down``
Phase 5 step 2 (D5). Scheduled task ``followup_reconcile``
(``app.core.scheduler``, every 900 s and at boot; kill switch
``QONTINUI_SCHEDULER_FOLLOWUP_RECONCILE_ENABLED``).

A follow-up moved to ``fixing`` (its fix is in an open PR) must move on when
that PR settles: ``fixed`` once coord observes it land, back to ``open`` if it
closes unlanded. The only other caller of the reconcile core is a session
(``POST /plan-library/followups/reconcile``) — without this task a follow-up
whose tenant runs no session that asks would sit in ``fixing`` forever, and a
fix PR closed unlanded would never reopen it.

This task runs the SAME core (``app.crud.work_artifact_followups.
reconcile_fixing_followups``) over EVERY organization's ``fixing`` rows,
reading coord's land record (``GET /coord/pr/{repo}/{n}/landed``) through
web's coord service identity (:class:`~app.services.coord_service_account.
CoordServiceAccountClient`) — the one credential this backend holds that acts
for no end-user.

What it never does: guess. A coord it cannot read — unreachable, answering
5xx, refusing the service credential, or a service account that is not
configured (``COORD_ADMIN_SECRET`` unset) — moves NO row; every row it could
not settle stays ``fixing`` and is logged as UNKNOWN with its count, never as
"nothing to do".
"""

from __future__ import annotations

from collections.abc import Callable
from contextlib import AbstractAsyncContextManager
from typing import Any, Protocol
from urllib.parse import quote

import httpx
import structlog
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.crud.work_artifact_followups import (
    LandVerdict,
    parse_land_verdict,
    reconcile_fixing_followups,
)
from app.services.coord_service_account import CoordServiceAccountDisabledError

logger = structlog.get_logger(__name__)

#: ``resolved_by`` / the history ``by`` of every move this task makes.
ACTOR = "followup_reconcile (scheduled)"

#: The anchor table is created by the same revision as the closure columns,
#: so its presence says whether this database has them at all.
_MIGRATED_SQL = text(
    "SELECT to_regclass('agent.work_artifact_edge_anchors') IS NOT NULL"
)


class CoordReadClient(Protocol):
    """The part of ``CoordServiceAccountClient`` this task uses."""

    @property
    def enabled(self) -> bool: ...

    async def get(
        self, path: str, *, params: dict[str, str] | None = ..., timeout_s: float = ...
    ) -> tuple[int, object]: ...


class ServiceAccountLandReader:
    """coord's land record through web's coord service identity.

    Trips on the first failure that says the NEXT read would fail the same
    way — a disabled service account, a mint or transport failure, a 5xx, or a
    401/403 (one credential for every read) — and answers every later read
    ``unknown`` at once. A 404 or other 4xx is coord answering about that ONE
    PR, so it is recorded for that PR and the reads go on.
    """

    def __init__(self, client: CoordReadClient) -> None:
        self._client = client
        self._reason: str | None = None
        if not client.enabled:
            self._reason = (
                "coord service account disabled (COORD_ADMIN_SECRET unset) — "
                "web holds no credential to read coord's land record"
            )

    @property
    def available(self) -> bool:
        return self._reason is None

    @property
    def unavailable_reason(self) -> str | None:
        return self._reason

    def _trip(self, reason: str) -> None:
        if self._reason is None:
            self._reason = reason

    async def read(self, repo: str, pr_number: int) -> LandVerdict:
        if self._reason is not None:
            return LandVerdict("unknown", unknown_reason="coord_unavailable")
        path = f"/coord/pr/{quote(repo, safe='')}/{pr_number}/landed"
        try:
            status, body = await self._client.get(path)
        except CoordServiceAccountDisabledError:
            self._trip("coord service account disabled (COORD_ADMIN_SECRET unset)")
            return LandVerdict("unknown", unknown_reason="coord_unavailable")
        except (httpx.HTTPError, RuntimeError) as exc:
            # RuntimeError: the service-token mint failed (wrong secret, coord down).
            self._trip(f"coord unreachable: {type(exc).__name__}: {exc}")
            return LandVerdict("unknown", unknown_reason="coord_unavailable")
        if status >= 500:
            self._trip(f"coord answered {status}")
            return LandVerdict("unknown", unknown_reason="coord_unavailable")
        if status in (401, 403):
            self._trip(f"coord refused web's service credential ({status})")
            return LandVerdict("unknown", unknown_reason="coord_credential_refused")
        if status != 200:
            return LandVerdict("unknown", unknown_reason=f"coord_http_{status}")
        return parse_land_verdict(body)


def _default_client() -> CoordReadClient:
    from app.services.coord_service_account import coord_service_account

    return coord_service_account


def _default_session_factory() -> Callable[
    [], AbstractAsyncContextManager[AsyncSession]
]:
    from app.db.session import AsyncSessionLocal

    return AsyncSessionLocal


async def run_followup_reconcile(
    *,
    session_factory: Callable[[], AbstractAsyncContextManager[AsyncSession]]
    | None = None,
    client: CoordReadClient | None = None,
) -> dict[str, Any]:
    """One scheduled pass. Returns the pass's counts (the reconcile outcome),
    plus ``migration_applied``.

    ``session_factory`` / ``client`` are test seams; production uses
    ``AsyncSessionLocal`` and the process-wide service-account singleton.
    """
    factory = session_factory or _default_session_factory()
    reader = ServiceAccountLandReader(client or _default_client())
    async with factory() as db:
        if not bool((await db.execute(_MIGRATED_SQL)).scalar()):
            logger.info(
                "followup_reconcile.skipped",
                reason="plan_library_11_followup_anchors_and_closure not applied — "
                "this database has no follow-up closure columns",
            )
            return {"migration_applied": False}
        outcome = await reconcile_fixing_followups(
            db, reader=reader, actor=ACTOR, all_organizations=True
        )
    result: dict[str, Any] = {"migration_applied": True, **outcome.as_dict()}
    if outcome.unknown or not outcome.coord_available:
        # The rows this pass could not settle stay ``fixing``. Their count is
        # the figure: UNKNOWN, not "nothing to reconcile".
        logger.warning(
            "followup_reconcile.unknown",
            **result,
            detail="rows counted unknown were left fixing; coord's verdict for "
            "them is UNKNOWN",
        )
    else:
        logger.info("followup_reconcile.done", **result)
    return result
