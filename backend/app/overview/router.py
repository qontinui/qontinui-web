"""The generic overview authoring routes, built from the registry.

Plan ``2026-09-20-overview-authoring-layer`` §1–§2. Mounted at
``/api/v1/overview`` beside the estimate routes.

Routes
------
``GET    /resources``                 every resource: permission for THIS project + JSON Schemas
``GET    /change-log``                a resource's (or one record's) write history
``GET    /<path>``                    list (``can_edit`` + ``degraded`` beside the items)
``GET    /<path>/{record_id}``        one record; ``ETag`` is its version
``POST   /<path>``                    create; ``Idempotency-Key`` makes a retry safe
``PATCH  /<path>/{record_id}``        partial update; ``If-Match: <version>`` REQUIRED
``DELETE /<path>/{record_id}``        delete; ``If-Match`` REQUIRED

Only the verbs a spec lists are routed.

The contract, uniformly
-----------------------
* **Reads are open to any member of the ACTIVE project; writes follow the
  spec's permission rule**, resolved by :mod:`app.overview.permissions` — the
  same function whose answer every read serves as ``can_edit``.
* **Never last-write-wins.** A write without ``If-Match`` is ``428``; a stale
  one is ``409`` whose body carries the server's current copy, so a client can
  show both sides instead of only saying "somebody else saved".
* **Every write appends ``overview.change_log``** with who, the source
  (``X-Overview-Source``: ui / api / import), and the record before and after.
"""

# No ``from __future__ import annotations`` here: the per-resource handlers
# annotate their bodies with a LOCAL variable (the spec's write model), and
# FastAPI resolves string annotations against module globals, where it is not.
from datetime import datetime
from typing import Any
from uuid import UUID

import structlog
from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request, Response
from pydantic import BaseModel, create_model
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_async_db
from app.overview import change_log
from app.overview import http as contract_http
from app.overview.files import router as files_routes
from app.overview.pages import router as pages_routes
from app.overview.permissions import OverviewAccess, get_overview_access, require_edit
from app.overview.registry import REGISTRY
from app.overview.resource import (
    RecordNotFound,
    ResourceSpec,
    StaleVersion,
    StoreContext,
    StoreRefused,
)

logger = structlog.get_logger(__name__)

router = APIRouter()

#: Response headers this contract emits. ``app.main`` publishes them to
#: cross-origin browsers (``CORS_EXPOSE_HEADERS``); a header left out of that
#: list reads as absent in production and present in local dev.
CONTRACT_RESPONSE_HEADERS: tuple[str, ...] = ("ETag", "Idempotent-Replayed")

#: Past this, a client is sending something other than a retry key.
_MAX_IDEMPOTENCY_KEY = 200


# The contract's HTTP pieces (If-Match parsing, ETag, the 409 body) live in
# ``app.overview.http`` so routes outside this module — page versions, file
# upload — speak exactly the same contract.
parse_if_match = contract_http.parse_if_match
_etag = contract_http.etag
_stale = contract_http.stale
_refused = contract_http.refused
_not_found = contract_http.not_found


# ---------------------------------------------------------------------------
# Catalog and history — shared by every resource
# ---------------------------------------------------------------------------


class ResourceDescriptor(BaseModel):
    name: str
    path: str
    title: str
    description: str
    operations: list[str]
    #: Whether the CALLER may write this resource in the ACTIVE project —
    #: the same answer the write routes enforce.
    can_edit: bool
    #: JSON Schemas of the read shape and of each write body the resource
    #: takes. The editing kit validates a form against these, so the form and
    #: the API apply one set of rules.
    schemas: dict[str, dict[str, Any]]


class ResourceCatalog(BaseModel):
    tenant_id: UUID
    resources: list[ResourceDescriptor]


def _descriptor(spec: ResourceSpec, access: OverviewAccess) -> ResourceDescriptor:
    schemas: dict[str, dict[str, Any]] = {
        "read": spec.read_model.model_json_schema(mode="serialization")
    }
    if spec.create_model is not None:
        schemas["create"] = spec.create_model.model_json_schema()
    if spec.update_model is not None:
        schemas["update"] = spec.update_model.model_json_schema()
    return ResourceDescriptor(
        name=spec.name,
        path=spec.path,
        title=spec.title,
        description=spec.description,
        operations=sorted(spec.operations),
        can_edit=access.can_edit(spec.permission),
        schemas=schemas,
    )


@router.get("/resources", response_model=ResourceCatalog)
async def read_catalog(
    access: OverviewAccess = Depends(get_overview_access),
) -> ResourceCatalog:
    """Every overview resource, with what the caller may do in this project."""
    return ResourceCatalog(
        tenant_id=access.tenant_id,
        resources=[_descriptor(spec, access) for spec in REGISTRY.values()],
    )


class ChangeLogEntry(BaseModel):
    id: UUID
    resource: str
    record_id: str
    action: str
    source: str
    actor: str | None
    created_at: datetime
    version_before: int | None
    version_after: int | None
    before: dict[str, Any] | None
    after: dict[str, Any] | None


class ChangeLogPage(BaseModel):
    entries: list[ChangeLogEntry]
    #: More history exists than this page shows.
    truncated: bool


@router.get("/change-log", response_model=ChangeLogPage)
async def read_change_log(
    resource: str = Query(..., description="A registry name, e.g. intent_documents"),
    record_id: str | None = Query(default=None),
    limit: int = Query(default=20, ge=1, le=100),
    access: OverviewAccess = Depends(get_overview_access),
    db: AsyncSession = Depends(get_async_db),
) -> ChangeLogPage:
    """Newest first. Readable by any member, like the records it describes."""
    if resource not in REGISTRY:
        raise HTTPException(status_code=404, detail="unknown_resource")
    rows = await change_log.history(
        db,
        tenant_id=access.tenant_id,
        resource=resource,
        record_id=record_id,
        limit=limit,
    )
    return ChangeLogPage(
        entries=[
            ChangeLogEntry(
                id=r.id,
                resource=r.resource,
                record_id=r.record_id,
                action=r.action,
                source=r.source,
                actor=r.actor,
                created_at=r.created_at,
                version_before=r.version_before,
                version_after=r.version_after,
                before=r.before,
                after=r.after,
            )
            for r in rows[:limit]
        ],
        truncated=len(rows) > limit,
    )


# ---------------------------------------------------------------------------
# Per-resource CRUD
# ---------------------------------------------------------------------------


def _envelopes(spec: ResourceSpec) -> tuple[type[BaseModel], type[BaseModel]]:
    """The list and item response shapes, named per resource so the OpenAPI
    snapshot carries a typed model for each."""
    stem = "".join(part.capitalize() for part in spec.name.split("_"))
    list_model = create_model(
        f"{stem}List",
        items=(list[spec.read_model], ...),  # type: ignore[valid-type,name-defined]
        total=(int, ...),
        can_edit=(bool, ...),
        degraded=(str | None, None),
    )
    item_model = create_model(
        f"{stem}Item",
        item=(spec.read_model, ...),
        can_edit=(bool, ...),
    )
    return list_model, item_model


async def _run_after_commit(context: StoreContext) -> None:
    """Run a write's after-commit work. Each step is independent: one failing
    (a storage delete, say) is logged and never undoes the committed write."""
    for step in context.after_commit:
        try:
            await step()
        except Exception:  # noqa: BLE001 — the write is committed; report, don't raise
            logger.exception("overview_after_commit_failed")
    context.after_commit.clear()


def _audit(spec: ResourceSpec, record: BaseModel | None) -> dict[str, Any] | None:
    """A record as the change log keeps it on create/update: without the
    fields another table already holds in full (``ResourceSpec.audit_exclude``)."""
    if record is None:
        return None
    return record.model_dump(mode="json", exclude=set(spec.audit_exclude))


def _mount(spec: ResourceSpec) -> None:  # noqa: C901 — one closure per verb
    assert spec.store is not None
    store_dep = spec.store
    list_model, item_model = _envelopes(spec)
    base = f"/{spec.path}"
    tag = f"overview:{spec.path}"

    def ctx(access: OverviewAccess, db: AsyncSession, request: Request) -> StoreContext:
        return StoreContext(access=access, db=db, request=request)

    if "list" in spec.operations:

        async def list_records(
            request: Request,
            access: OverviewAccess = Depends(get_overview_access),
            db: AsyncSession = Depends(get_async_db),
            store: Any = Depends(store_dep),
        ) -> Any:
            filters = {f: request.query_params.getlist(f) for f in spec.list_filters}
            result = await store.list(ctx(access, db, request), filters)
            return list_model(
                items=result.items,
                total=len(result.items),
                can_edit=access.can_edit(spec.permission),
                degraded=result.degraded,
            )

        router.add_api_route(
            base,
            list_records,
            methods=["GET"],
            response_model=list_model,
            name=f"list_{spec.name}",
            tags=[tag],
        )

    if "get" in spec.operations:

        async def get_record(
            record_id: str,
            request: Request,
            response: Response,
            access: OverviewAccess = Depends(get_overview_access),
            db: AsyncSession = Depends(get_async_db),
            store: Any = Depends(store_dep),
        ) -> Any:
            try:
                record = await store.get(ctx(access, db, request), record_id)
            except RecordNotFound as exc:
                raise _not_found() from exc
            except StoreRefused as exc:
                return _refused(exc)
            response.headers["ETag"] = _etag(record.version)
            return item_model(item=record, can_edit=access.can_edit(spec.permission))

        router.add_api_route(
            f"{base}/{{record_id}}",
            get_record,
            methods=["GET"],
            response_model=item_model,
            name=f"get_{spec.name}",
            tags=[tag],
        )

    if "create" in spec.operations and spec.create_model is not None:
        create_body = spec.create_model

        async def create_record(
            payload: create_body,  # type: ignore[valid-type]
            request: Request,
            response: Response,
            idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
            access: OverviewAccess = Depends(require_edit(spec.permission)),
            db: AsyncSession = Depends(get_async_db),
            store: Any = Depends(store_dep),
        ) -> Any:
            key = (idempotency_key or "").strip() or None
            if key is not None and len(key) > _MAX_IDEMPOTENCY_KEY:
                raise HTTPException(status_code=400, detail="idempotency_key_too_long")
            context = ctx(access, db, request)
            if key is not None:
                prior = await change_log.find_by_idempotency_key(
                    db, tenant_id=access.tenant_id, resource=spec.name, key=key
                )
                if prior is not None:
                    return await _replay(prior.record_id, context, store, response)
            adopted = False
            try:
                created = await store.create(context, payload)
            except StoreRefused as exc:
                # A keyed create refused as a duplicate may be refusing its OWN
                # earlier attempt, whose answer (and so its change-log row) was
                # lost. The store decides whether the record there is that one.
                adopt = getattr(store, "adopt_existing", None)
                if key is None or exc.error != "name_taken" or adopt is None:
                    return _refused(exc)

                async def created_through_overview(record_id: str) -> bool:
                    return await change_log.has_create(
                        db,
                        tenant_id=access.tenant_id,
                        resource=spec.name,
                        record_id=record_id,
                    )

                try:
                    existing = await adopt(context, payload, created_through_overview)
                except StoreRefused as adopt_exc:
                    return _refused(adopt_exc)
                if existing is None:
                    return _refused(exc)
                created, adopted = existing, True
            try:
                await change_log.record(
                    db,
                    tenant_id=access.tenant_id,
                    resource=spec.name,
                    record_id=created.id,
                    action="create",
                    source=change_log.change_source(request),
                    actor=access.actor,
                    actor_user_id=access.user_id,
                    before=None,
                    after=_audit(spec, created),
                    version_after=created.version,
                    idempotency_key=key,
                )
                await db.commit()
                await _run_after_commit(context)
            except IntegrityError:
                # A concurrent retry with the same key won the race; answer
                # with the record the winner logged.
                await db.rollback()
                prior = await change_log.find_by_idempotency_key(
                    db, tenant_id=access.tenant_id, resource=spec.name, key=key or ""
                )
                if prior is None:
                    raise
                return await _replay(prior.record_id, context, store, response)
            response.status_code = 200 if adopted else 201
            if adopted:
                response.headers["Idempotent-Replayed"] = "true"
            response.headers["ETag"] = _etag(created.version)
            return item_model(item=created, can_edit=True)

        async def _replay(
            record_id: str, context: StoreContext, store: Any, response: Response
        ) -> Any:
            try:
                record = await store.get(context, record_id)
            except StoreRefused as exc:
                return _refused(exc)
            except RecordNotFound as exc:
                raise HTTPException(
                    status_code=409,
                    detail={
                        "error": "idempotency_key_reused",
                        "message": (
                            "That Idempotency-Key already created a record "
                            "which no longer exists. Use a new key."
                        ),
                    },
                ) from exc
            response.status_code = 200
            response.headers["Idempotent-Replayed"] = "true"
            response.headers["ETag"] = _etag(record.version)
            return item_model(item=record, can_edit=True)

        router.add_api_route(
            base,
            create_record,
            methods=["POST"],
            response_model=item_model,
            status_code=201,
            name=f"create_{spec.name}",
            tags=[tag],
        )

    if "update" in spec.operations and spec.update_model is not None:
        update_body = spec.update_model

        async def update_record(
            record_id: str,
            payload: update_body,  # type: ignore[valid-type]
            request: Request,
            response: Response,
            if_match: str | None = Header(default=None, alias="If-Match"),
            access: OverviewAccess = Depends(require_edit(spec.permission)),
            db: AsyncSession = Depends(get_async_db),
            store: Any = Depends(store_dep),
        ) -> Any:
            expected = parse_if_match(if_match)
            context = ctx(access, db, request)
            try:
                before, after = await store.update(
                    context, record_id, payload, expected
                )
            except RecordNotFound as exc:
                raise _not_found() from exc
            except StaleVersion as exc:
                return _stale(exc)
            except StoreRefused as exc:
                return _refused(exc)
            if after.model_dump() != before.model_dump():
                await change_log.record(
                    db,
                    tenant_id=access.tenant_id,
                    resource=spec.name,
                    record_id=after.id,
                    action="update",
                    source=change_log.change_source(request),
                    actor=access.actor,
                    actor_user_id=access.user_id,
                    before=_audit(spec, before),
                    after=_audit(spec, after),
                    version_before=before.version,
                    version_after=after.version,
                )
                await db.commit()
                await _run_after_commit(context)
            response.headers["ETag"] = _etag(after.version)
            return item_model(item=after, can_edit=True)

        router.add_api_route(
            f"{base}/{{record_id}}",
            update_record,
            methods=["PATCH"],
            response_model=item_model,
            name=f"update_{spec.name}",
            tags=[tag],
        )

    if "delete" in spec.operations:

        async def delete_record(
            record_id: str,
            request: Request,
            if_match: str | None = Header(default=None, alias="If-Match"),
            access: OverviewAccess = Depends(require_edit(spec.permission)),
            db: AsyncSession = Depends(get_async_db),
            store: Any = Depends(store_dep),
        ) -> Any:
            expected = parse_if_match(if_match)
            context = ctx(access, db, request)
            try:
                before = await store.delete(context, record_id, expected)
            except RecordNotFound as exc:
                raise _not_found() from exc
            except StaleVersion as exc:
                return _stale(exc)
            except StoreRefused as exc:
                return _refused(exc)
            await change_log.record(
                db,
                tenant_id=access.tenant_id,
                resource=spec.name,
                record_id=before.id,
                action="delete",
                source=change_log.change_source(request),
                actor=access.actor,
                actor_user_id=access.user_id,
                before=before,
                after=None,
                version_before=before.version,
            )
            await db.commit()
            await _run_after_commit(context)
            return Response(status_code=204)

        router.add_api_route(
            f"{base}/{{record_id}}",
            delete_record,
            methods=["DELETE"],
            status_code=204,
            # ``-> Any`` would otherwise be read as a response model, which a
            # 204 cannot carry.
            response_model=None,
            name=f"delete_{spec.name}",
            tags=[tag],
        )


for _spec in REGISTRY.values():
    if _spec.store is not None:
        _mount(_spec)

# The routes beyond the generic contract, on the same prefix: page versions,
# revert and backlinks; file upload and download.
router.include_router(pages_routes)
router.include_router(files_routes)
