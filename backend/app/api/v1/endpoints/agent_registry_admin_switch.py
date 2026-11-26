"""Agent-registry catalog + tenant-admin spawn switch — two coord proxies.

Phase 7 of plan
``2026-11-24-tenant-admins-switch-agent-spawns-off-per-agent-type``. Kept out
of :mod:`app.api.v1.endpoints.agent_registry` (already ~1,450 lines) and
composed into the same ``/api/v1/agent-registry`` prefix in ``api.py``. It
reuses that module's coord transport — :func:`get_registry_user`, and
:func:`_coord_request_deploy_order_aware` with its 502/504 split — rather than
growing a second copy of it.

Routes:

- ``GET /api/v1/agent-registry/catalog`` — ANY tenant member: every agent type
  a spawn may be authorized under, with or without a registry row, each with
  its provenance (registry row, spawn kind/class, runner key, harness
  built-in, role declared in a tenant repo, name observed at spawn time).
  Proxies coord ``GET /coord/agent-registry/catalog``. A member sees what is
  switched off and why; only an admin can change it.
- ``PUT /api/v1/agent-registry/admin/registry/{agent_name}/switch`` — ADMIN:
  the tenant CEILING (plan D1). Proxies coord
  ``PUT /coord/agent-registry/{agent_name}/admin-switch``. A disabled ceiling
  wins over every member's own preference; it is a separate mechanism from
  the tenant default (``default_enabled``), which this door never writes.

Both pass coord's status and error code through verbatim (its 422
``invalid_agent_name`` / ``disposition_not_allowed`` /
``disposition_requires_disabled`` / ``reason_too_long``, its 503
``registry_not_provisioned``, its 403), because the page renders coord's own
reason beside the switch that was refused.
"""

from __future__ import annotations

from typing import Any
from urllib.parse import quote
from uuid import UUID

import structlog
from fastapi import APIRouter, Depends, status
from pydantic import BaseModel, ConfigDict, Field

from app.api.coord_proxy import require_coord_tenant_admin
from app.api.v1.endpoints.agent_registry import (
    _coord_request_deploy_order_aware,
    get_registry_user,
)
from app.core.refusal import (
    GlossaryTerm,
    NextActionKind,
    RefusalCode,
    refusal_error,
)
from app.models.user import User

logger = structlog.get_logger(__name__)

router = APIRouter()

#: What a catalog answer that carried no ``sources_unread`` list is reported
#: as. Absent is not "every source was read": an older or off-contract coord
#: that omits the field says nothing about its sources, and the page renders
#: each ``sources_unread`` entry as an UNKNOWN banner — so the absence becomes
#: one such entry instead of a silent all-clear.
_SOURCES_UNREAD_ABSENT = {
    "source": "sources_unread",
    "reason": (
        "coord's catalog answer carried no sources_unread list, so whether "
        "every catalog source was read is unknown"
    ),
}


class AgentAdminSwitchRequest(BaseModel):
    """Client body for the tenant-admin spawn switch.

    ``disposition`` is the admin's pick from the row's
    ``allowed_dispositions`` and only means something with ``disabled: true``
    (coord answers 422 ``disposition_requires_disabled`` otherwise). Neither
    rule is copied here — coord's refusal is forwarded verbatim, and a web-side
    copy of the disposition set would drift from the row it is checked
    against.
    """

    model_config = ConfigDict(extra="forbid")

    disabled: bool
    disposition: str | None = Field(
        None, description="block | degrade | warn_proceed (from the row's set)"
    )
    reason: str | None = Field(
        None,
        description="Why; recorded on the row and shown to every member in the catalog",
    )


def _catalog_payload(payload: Any) -> dict[str, Any]:
    """Coord's catalog answer, checked for the two lists the page reads.

    ``agents`` that is not a list is a 502, never ``[]``: the page would render
    an empty list as "this tenant has no agent types", which is a claim no
    answer here made (``silent-empty-is-unknown``). An absent
    ``sources_unread`` becomes one UNKNOWN entry (:data:`_SOURCES_UNREAD_ABSENT`)
    rather than an empty list. Everything else passes through VERBATIM — the
    entry shape is coord's, and re-deriving any of it here is how two copies of
    an authorization claim start to disagree.
    """
    if not isinstance(payload, dict) or not isinstance(payload.get("agents"), list):
        logger.error(
            "agent_registry_catalog_off_contract",
            payload_type=type(payload).__name__,
        )
        raise refusal_error(
            status.HTTP_502_BAD_GATEWAY,
            RefusalCode.upstream_unavailable,
            NextActionKind.report_defect,
            "coord's agent catalog answer carried no `agents` list; "
            "refusing to show an empty catalog",
            discriminator="agent_registry_catalog_off_contract",
            glossary_terms=[GlossaryTerm.coord],
        )
    unread = payload.get("sources_unread")
    if not isinstance(unread, list):
        logger.warning(
            "agent_registry_catalog_sources_unread_absent",
            sources_unread_type=type(unread).__name__,
        )
        return {**payload, "sources_unread": [dict(_SOURCES_UNREAD_ABSENT)]}
    return payload


@router.get("/catalog")
async def get_agent_catalog(
    user: User = Depends(get_registry_user),
) -> dict[str, Any]:
    """Every agent type the tenant's spawns may be authorized under.

    Readable by ANY member: the page shows members what is switched off and
    why, read-only. Coord resolves the tenant from the forwarded bearer.
    """
    del user  # authentication only — coord resolves operator and tenant
    payload = await _coord_request_deploy_order_aware(
        "GET",
        "/coord/agent-registry/catalog",
        coord_route="GET /coord/agent-registry/catalog",
        log_event="agent_registry_catalog_route_absent_on_coord",
    )
    return _catalog_payload(payload)


@router.put("/admin/registry/{agent_name}/switch")
async def put_agent_admin_switch(
    agent_name: str,
    body: AgentAdminSwitchRequest,
    tenant_id: UUID = Depends(require_coord_tenant_admin),
) -> dict[str, Any]:
    """ADMIN: switch spawns of one agent type off (or back on) tenant-wide.

    Gated in the WEB tier as well as in coord (``rbac::require_role("admin")``),
    so a non-admin gets the renderable ``not_coord_tenant_admin`` and no coord
    call is made. The forwarded body carries only what the admin set: an
    omitted ``disposition`` / ``reason`` is absent, not ``null``.
    """
    del tenant_id  # gate only — coord resolves the tenant from the bearer
    coord_body: dict[str, Any] = {"disabled": body.disabled}
    if body.disposition is not None:
        coord_body["disposition"] = body.disposition
    if body.reason is not None:
        coord_body["reason"] = body.reason
    result = await _coord_request_deploy_order_aware(
        "PUT",
        f"/coord/agent-registry/{quote(agent_name, safe='')}/admin-switch",
        json_body=coord_body,
        coord_route="PUT /coord/agent-registry/{agent_name}/admin-switch",
        log_event="agent_registry_admin_switch_route_absent_on_coord",
    )
    if isinstance(result, dict):
        return result
    return {"result": result}
