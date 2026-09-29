"""The resource contract every editable overview thing implements.

Plan ``2026-09-20-overview-authoring-layer`` §1. A resource is a set of
records with one identity rule, one read shape, one write shape per verb, one
permission rule and one store. :mod:`app.overview.router` turns a
:class:`ResourceSpec` into the routes; this module only says what a spec and a
store are, so the router, the registry and each store can import it without
importing each other.

A read shape carries ``id`` (a string — not every store keys by UUID) and
``version`` (an integer that moves on every content write). Those two are the
whole concurrency contract: a read serves ``version`` as an ``ETag``, a write
names the version it was built on in ``If-Match``, and a store refuses a write
whose version has moved with :class:`StaleVersion`, carrying the server's copy.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Any, Literal, Protocol

from fastapi import Request
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.overview.permissions import OverviewAccess, PermissionRule

Operation = Literal["list", "get", "create", "update", "delete"]


class RecordNotFound(Exception):
    """No such record in the ACTIVE tenant. Served as 404 — never 403, since
    whether an id exists in another tenant is itself information."""


class StaleVersion(Exception):
    """The write was built on a version the store has moved past."""

    def __init__(self, current: BaseModel) -> None:
        super().__init__("stale version")
        self.current = current


class StoreRefused(Exception):
    """The store declined the write for a reason the caller can act on (a
    name already taken, content its own rules reject)."""

    def __init__(self, status_code: int, error: str, message: str) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.error = error
        self.message = message


@dataclass
class StoreContext:
    access: OverviewAccess
    db: AsyncSession
    request: Request
    #: Work to run only once the write's transaction has COMMITTED — e.g.
    #: deleting a file's stored bytes. Run after the commit, never before, so
    #: a failed commit cannot leave a row pointing at bytes already deleted.
    #: The router runs these; a store only appends to it.
    after_commit: list[Callable[[], Awaitable[None]]] = field(default_factory=list)


@dataclass
class ListResult:
    items: list[BaseModel]
    #: Set when the store answered but cannot see its data — an empty
    #: ``items`` then means "cannot see", never "nothing here".
    degraded: str | None = None


class ResourceStore(Protocol):
    async def list(
        self, ctx: StoreContext, filters: dict[str, list[str]]
    ) -> ListResult: ...

    async def get(self, ctx: StoreContext, record_id: str) -> BaseModel: ...

    async def create(self, ctx: StoreContext, payload: BaseModel) -> BaseModel: ...

    async def update(
        self,
        ctx: StoreContext,
        record_id: str,
        payload: BaseModel,
        expected_version: int,
    ) -> tuple[BaseModel, BaseModel]:
        """Returns ``(before, after)``."""
        ...

    async def delete(
        self, ctx: StoreContext, record_id: str, expected_version: int
    ) -> BaseModel:
        """Returns the record as it was."""
        ...

    # Optional: ``adopt_existing(ctx, payload, created_through_overview)
    # -> BaseModel | None``. A store
    # whose create can be refused as a duplicate of the SAME create retried
    # (the first answer lost in transit) implements it to say which record
    # that was; the router calls it only for a keyed create refused as
    # ``name_taken``. See ``IntentDocumentStore.adopt_existing``.


@dataclass(frozen=True)
class ResourceSpec:
    """One registry entry.

    ``store`` is a FastAPI dependency returning the :class:`ResourceStore`;
    when it is ``None`` the resource's routes are hand-written elsewhere (the
    estimate, pending its refit onto this contract in Phase 3 of the plan) and
    the entry exists so its permission is served from the same place as every
    other resource's.
    """

    name: str
    path: str
    title: str
    permission: PermissionRule
    read_model: type[BaseModel]
    operations: frozenset[Operation]
    #: The ``overview.*`` tables this resource owns. Empty for a resource
    #: stored elsewhere. The registry-exhaustiveness test reads this.
    tables: tuple[str, ...] = ()
    create_model: type[BaseModel] | None = None
    update_model: type[BaseModel] | None = None
    list_filters: tuple[str, ...] = ()
    store: Callable[..., Any] | None = None
    description: str = ""
    #: Read-model fields left out of ``overview.change_log`` snapshots on
    #: create and update, where another table already keeps them in full
    #: (a page's body is in ``page_versions``). A DELETE snapshot keeps every
    #: field, because the record and whatever kept its history go with it.
    audit_exclude: frozenset[str] = frozenset()
