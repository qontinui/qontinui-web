"""``StrictQueryRoute`` — refuse a query parameter the route does not implement.

Phase 4 of plan ``2026-09-03-coord-agent-doors-honour-or-refuse-every-parameter``
(dossier ``agent-door-filters-silently-ignored``).

FastAPI ignores an unknown query parameter by default: ``?work_unit_slig=abc``
(a typo) or ``?slug=abc`` (a key another service accepts) returns a ``200``
page that answers a question the caller did not ask. Every instance of that
class the dossier collected has the shape of a measurement — a count, an
empty list, a page — so it corrupts a conclusion instead of costing a retry.
This route class turns the silent discard into a loud refusal at the first
call: a ``422`` whose body names the keys that were not understood and the
keys the route does accept.

**This is the first ``route_class`` in ``backend/app``.** It is deliberately
opt-in per router — ``APIRouter(route_class=StrictQueryRoute)`` — rather than
installed app-wide, because a strict contract is a behaviour change for every
caller of the router that adopts it, and the callers of each router are known
to that router's owner, not to this module. Adopt it router by router, after
checking that router's live callers send only implemented keys.

The accepted set is DERIVED from FastAPI's own resolved dependency tree
(``get_flat_dependant(self.dependant).query_params``) at route construction
time — never hand-copied — so a parameter added to a handler is accepted the
moment it is declared and a hand-maintained allow-list cannot drift from the
signature. Each field is read by its **alias** (the wire name), not its Python
name: ``artifact_status: str | None = Query(None, alias="status")`` accepts
``?status=``, and would wrongly refuse it under the Python name.

Ordering: the check runs inside the route handler BEFORE dependency
resolution, so it precedes authentication. That is intentional — refusing a
malformed request costs no database or coord round-trip — and it reveals
nothing: the route's declared query parameters are already published, in
this open-source repo's committed OpenAPI snapshot
(``frontend/src/lib/api-client/openapi-schema.json``) and at
``/api/v1/openapi.json`` on a development build. Path parameters, headers,
cookies and the body are outside the check entirely; only
``request.query_params`` keys are compared, and only against query-parameter
fields.

Refusal body (``HTTPException.detail``; the app-level handler in
``app.middleware.error_handler`` lifts ``error`` and the extra fields to the
top level of the JSON response)::

    {
        "error": "unknown_query_parameter",
        "message": "...",
        "unknown": ["slug"],
        "accepted": ["kind", "status", ...],
        "route": "/api/v1/plan-library",
    }

``error`` / ``unknown`` / ``accepted`` / ``route`` are the SAME field names
coord's ``400 unknown_query_parameter`` carries on its agent doors (Phase 2 of
the same plan), so a cross-service caller learns one refusal shape.
"""

from __future__ import annotations

from collections.abc import Callable, Coroutine
from typing import Any, TypeGuard

from fastapi import HTTPException, Request, Response
from fastapi.dependencies.models import Dependant
from fastapi.dependencies.utils import get_flat_dependant
from fastapi.routing import APIRoute
from pydantic import BaseModel

#: The ``error`` code in the refusal body. Shared with coord's HTTP doors.
UNKNOWN_QUERY_PARAMETER = "unknown_query_parameter"


def accepted_query_keys(dependant: Dependant) -> list[str]:
    """The wire names of every query parameter a dependant resolves.

    Walks the FULL dependency tree (``get_flat_dependant``), so a query
    parameter declared on a sub-dependency (``Depends(...)``) or on a
    router-level dependency counts as accepted — those are keys FastAPI would
    itself read from the query string.

    A single query field whose annotation is a pydantic model is FastAPI's
    "query parameter model" form: the wire keys are the MODEL's field aliases,
    not the parameter's own name, so those are what get accepted.

    Sorted and de-duplicated: the list is part of a response body, and a
    stable order keeps two refusals for the same route byte-comparable.
    """
    flat = get_flat_dependant(dependant, skip_repeats=True)
    names: set[str] = set()
    query_fields = flat.query_params
    if len(query_fields) == 1 and _is_model(query_fields[0].field_info.annotation):
        model = query_fields[0].field_info.annotation
        for field_name, info in model.model_fields.items():
            names.add(info.alias or field_name)
    else:
        for field in query_fields:
            names.add(field.alias)
    return sorted(names)


def _is_model(annotation: object) -> TypeGuard[type[BaseModel]]:
    return isinstance(annotation, type) and issubclass(annotation, BaseModel)


class StrictQueryRoute(APIRoute):
    """An ``APIRoute`` that 422s on any query key the handler does not declare.

    Install per router::

        router = APIRouter(route_class=StrictQueryRoute)

    ``APIRouter.include_router`` re-creates each route with
    ``route_class_override=type(route)``, so the class survives being mounted
    under a prefix and the accepted set is recomputed against the mounted
    route's full dependency tree.
    """

    def get_route_handler(self) -> Callable[[Request], Coroutine[Any, Any, Response]]:
        original_route_handler = super().get_route_handler()
        accepted = accepted_query_keys(self.dependant)
        accepted_set = frozenset(accepted)
        route_path = self.path

        async def strict_route_handler(request: Request) -> Response:
            unknown = sorted(
                {key for key in request.query_params.keys() if key not in accepted_set}
            )
            if unknown:
                raise HTTPException(
                    status_code=422,
                    detail={
                        "error": UNKNOWN_QUERY_PARAMETER,
                        "message": (
                            f"{route_path} does not implement query parameter(s) "
                            f"{', '.join(unknown)}; it accepts "
                            f"{', '.join(accepted) or '(none)'}. A key this route "
                            "does not implement is refused rather than ignored, "
                            "so a filter that did not apply cannot look like a "
                            "result."
                        ),
                        "unknown": unknown,
                        "accepted": accepted,
                        "route": route_path,
                    },
                )
            return await original_route_handler(request)

        return strict_route_handler
