"""Tests for ``/api/v1/workflows`` (workflow mirror endpoints).

These tests verify the four behaviours that matter for Phase 3 of
``D:/qontinui-root/plans/2026-05-22-mtc-iter3-remediation-web-dashboard.md``:

* Sync inserts a new mirror row when none exists.
* Sync upserts (updates) an existing mirror row.
* Sync rejects a stale write (older ``runner_updated_at``) as 409 Conflict.
* List + detail are scoped to ``tenant_id`` + ``owner_user_id``.

We use a lightweight test app + in-memory dependency overrides — no live
coord, no live DB — so the test suite stays fast and hermetic. The
in-memory store mimics ``project.workflows`` row state through the
WorkflowMirror SQLAlchemy model interactions we care about.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any
from unittest.mock import MagicMock
from uuid import UUID, uuid4

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

# ---------------------------------------------------------------------------
# Test doubles
# ---------------------------------------------------------------------------


class _StoreRow:
    """Mimic the WorkflowMirror SQLAlchemy row contract the endpoint needs."""

    def __init__(
        self,
        *,
        id: UUID,
        tenant_id: UUID,
        device_id: UUID | None,
        owner_user_id: UUID,
        name: str,
        category: str | None,
        definition: dict,
        runner_updated_at: datetime,
        mirrored_at: datetime,
    ) -> None:
        self.id = id
        self.tenant_id = tenant_id
        self.device_id = device_id
        self.owner_user_id = owner_user_id
        self.name = name
        self.category = category
        self.definition = definition
        self.runner_updated_at = runner_updated_at
        self.mirrored_at = mirrored_at


class _FakeResult:
    """Mimic the SQLAlchemy result interface for ``.scalar_one_or_none()``
    + ``.scalars().all()`` so the endpoint code path stays unmodified."""

    def __init__(self, rows: list[_StoreRow]) -> None:
        self._rows = rows

    def scalar_one_or_none(self) -> _StoreRow | None:
        return self._rows[0] if self._rows else None

    def scalars(self) -> _FakeResult:
        return self

    def all(self) -> list[_StoreRow]:
        return list(self._rows)


class _FakeDb:
    """In-memory stand-in for AsyncSession.

    We intercept ``execute(stmt)`` by introspecting the compiled SQL's
    WHERE clauses for ``id == X``, ``tenant_id == X``, ``owner_user_id == X``
    so the test exercise the actual filter logic in the endpoint without
    needing a live Postgres.
    """

    def __init__(self) -> None:
        self.rows: list[_StoreRow] = []

    async def execute(self, stmt: Any) -> _FakeResult:
        # Compile the statement, walk the bound params, then filter by them.
        try:
            compiled = stmt.compile(compile_kwargs={"literal_binds": False})
        except Exception:
            compiled = None

        # Pull WHERE binds from .compile_state.criteria, but pydantic-test
        # path: walk visit_clauses by inspecting the constructed expression
        # tree via ``.whereclause`` on Select.
        wheres = getattr(stmt, "whereclause", None)
        filters: dict[str, Any] = {}
        if wheres is not None:
            for clause in _walk_binary_eq(wheres):
                col, value = clause
                filters[col] = value

        def _match(row: _StoreRow) -> bool:
            for col, val in filters.items():
                if col == "id" and row.id != val:
                    return False
                if col == "tenant_id" and row.tenant_id != val:
                    return False
                if col == "owner_user_id" and row.owner_user_id != val:
                    return False
                if col == "category" and row.category != val:
                    return False
            return True

        matched = [r for r in self.rows if _match(r)]
        _ = compiled  # silence pyflakes
        return _FakeResult(matched)

    def add(self, row: _StoreRow) -> None:
        # Stash a row that came in via the endpoint's `db.add()` path.
        self.rows.append(row)

    async def delete(self, row: _StoreRow) -> None:
        self.rows = [r for r in self.rows if r.id != row.id]

    async def commit(self) -> None:
        pass

    async def refresh(self, row: Any) -> None:
        pass


def _walk_binary_eq(clause: Any) -> list[tuple[str, Any]]:
    """Walk a SQLAlchemy WHERE tree, return [(col_name, eq_value), ...].

    Handles AND-joined trees of ``column == value`` clauses, which is the
    shape this endpoint produces.
    """
    pairs: list[tuple[str, Any]] = []
    from sqlalchemy.sql.elements import BinaryExpression, BooleanClauseList

    if isinstance(clause, BooleanClauseList):
        for sub in clause.clauses:
            pairs.extend(_walk_binary_eq(sub))
    elif isinstance(clause, BinaryExpression):
        left = clause.left
        right = clause.right
        col_name = getattr(left, "name", None) or getattr(left, "key", None)
        try:
            value = right.value  # BindParameter
        except AttributeError:
            value = None
        if col_name is not None:
            pairs.append((col_name, value))
    return pairs


# ---------------------------------------------------------------------------
# Test app factory
# ---------------------------------------------------------------------------


def _build_test_app(
    *,
    user_id: UUID,
    tenant_id: UUID,
    device_id: UUID,
    db: _FakeDb,
    as_operator: bool = True,
) -> FastAPI:
    """Build a tiny FastAPI app with just the workflows router + DI overrides."""
    from app.api.deps import (
        DeviceTokenContext,
        current_active_user,
        get_async_db,
        get_authenticated_device,
    )
    from app.api.v1.endpoints.workflows import router as workflows_router

    test_app = FastAPI()
    test_app.include_router(workflows_router, prefix="/api/v1/workflows")

    mock_user = MagicMock()
    mock_user.id = user_id
    mock_user.email = "tester@example.com"
    mock_user.is_active = True
    mock_user.is_verified = True

    if as_operator:
        test_app.dependency_overrides[current_active_user] = lambda: mock_user

    def _device_ctx() -> DeviceTokenContext:
        return DeviceTokenContext(
            claims={"device_id": str(device_id), "user_id": str(user_id)},
            user=mock_user,
        )

    test_app.dependency_overrides[get_authenticated_device] = _device_ctx
    test_app.dependency_overrides[get_async_db] = lambda: db

    # Tenant resolver — pin the tenant_id we want this test to see.
    from app.api.v1.endpoints import workflows as wf_module

    async def _resolve_tenant(_user: Any, _db: Any) -> UUID:
        return tenant_id

    monkey = pytest.MonkeyPatch()
    monkey.setattr(wf_module, "resolve_tenant_for_user", _resolve_tenant)
    test_app.state._tenant_monkey = monkey  # keep alive
    return test_app


@pytest.fixture()
def store() -> _FakeDb:
    return _FakeDb()


@pytest.fixture()
def ids() -> dict[str, UUID]:
    return {
        "user": uuid4(),
        "tenant": uuid4(),
        "device": uuid4(),
        "wf": uuid4(),
    }


@pytest.fixture()
def operator_client(store: _FakeDb, ids: dict[str, UUID]) -> TestClient:
    app = _build_test_app(
        user_id=ids["user"],
        tenant_id=ids["tenant"],
        device_id=ids["device"],
        db=store,
    )
    return TestClient(app)


# ---------------------------------------------------------------------------
# Sync — insert
# ---------------------------------------------------------------------------


def test_sync_inserts_new_row(
    operator_client: TestClient,
    store: _FakeDb,
    ids: dict[str, UUID],
) -> None:
    """POST /api/v1/workflows/sync — first write for an id creates the row."""
    runner_at = datetime.now(UTC)
    body = {
        "id": str(ids["wf"]),
        "name": "Build & test",
        "category": "ci",
        "definition": {"setup_steps": [], "name": "Build & test"},
        "runner_updated_at": runner_at.isoformat(),
    }
    resp = operator_client.post("/api/v1/workflows/sync", json=body)
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["id"] == str(ids["wf"])
    assert data["name"] == "Build & test"
    assert data["category"] == "ci"

    assert len(store.rows) == 1
    row = store.rows[0]
    assert row.id == ids["wf"]
    assert row.tenant_id == ids["tenant"]
    assert row.owner_user_id == ids["user"]
    assert row.device_id == ids["device"]


# ---------------------------------------------------------------------------
# Sync — update
# ---------------------------------------------------------------------------


def test_sync_upserts_existing_row(
    operator_client: TestClient,
    store: _FakeDb,
    ids: dict[str, UUID],
) -> None:
    """Second sync with the same id updates name + definition + mtime."""
    initial_at = datetime.now(UTC) - timedelta(minutes=5)
    store.rows.append(
        _StoreRow(
            id=ids["wf"],
            tenant_id=ids["tenant"],
            device_id=ids["device"],
            owner_user_id=ids["user"],
            name="Old name",
            category="ci",
            definition={"setup_steps": []},
            runner_updated_at=initial_at,
            mirrored_at=initial_at,
        )
    )

    new_at = datetime.now(UTC)
    body = {
        "id": str(ids["wf"]),
        "name": "New name",
        "category": "deploy",
        "definition": {"setup_steps": [{"type": "shell"}]},
        "runner_updated_at": new_at.isoformat(),
    }
    resp = operator_client.post("/api/v1/workflows/sync", json=body)
    assert resp.status_code == 200, resp.text

    assert len(store.rows) == 1
    row = store.rows[0]
    assert row.name == "New name"
    assert row.category == "deploy"
    assert row.definition == {"setup_steps": [{"type": "shell"}]}


# ---------------------------------------------------------------------------
# Sync — stale write rejection
# ---------------------------------------------------------------------------


def test_sync_rejects_stale_runner_updated_at(
    operator_client: TestClient,
    store: _FakeDb,
    ids: dict[str, UUID],
) -> None:
    """A sync with runner_updated_at older than the stored row is 409."""
    newer_at = datetime.now(UTC)
    store.rows.append(
        _StoreRow(
            id=ids["wf"],
            tenant_id=ids["tenant"],
            device_id=ids["device"],
            owner_user_id=ids["user"],
            name="Current",
            category="ci",
            definition={"setup_steps": []},
            runner_updated_at=newer_at,
            mirrored_at=newer_at,
        )
    )

    older_at = newer_at - timedelta(minutes=10)
    body = {
        "id": str(ids["wf"]),
        "name": "Stale",
        "category": "ci",
        "definition": {"setup_steps": [{"type": "stale"}]},
        "runner_updated_at": older_at.isoformat(),
    }
    resp = operator_client.post("/api/v1/workflows/sync", json=body)
    assert resp.status_code == 409, resp.text

    # Row unchanged.
    assert store.rows[0].name == "Current"


# ---------------------------------------------------------------------------
# List — tenant + owner scoping
# ---------------------------------------------------------------------------


def test_list_scoped_to_tenant_and_user(
    operator_client: TestClient,
    store: _FakeDb,
    ids: dict[str, UUID],
) -> None:
    """List response only returns rows matching the operator's tenant + uid."""
    now = datetime.now(UTC)
    mine = _StoreRow(
        id=ids["wf"],
        tenant_id=ids["tenant"],
        device_id=ids["device"],
        owner_user_id=ids["user"],
        name="Mine",
        category="ci",
        definition={},
        runner_updated_at=now,
        mirrored_at=now,
    )
    other_tenant = _StoreRow(
        id=uuid4(),
        tenant_id=uuid4(),
        device_id=uuid4(),
        owner_user_id=ids["user"],
        name="OtherTenant",
        category="ci",
        definition={},
        runner_updated_at=now,
        mirrored_at=now,
    )
    other_user = _StoreRow(
        id=uuid4(),
        tenant_id=ids["tenant"],
        device_id=uuid4(),
        owner_user_id=uuid4(),
        name="OtherUser",
        category="ci",
        definition={},
        runner_updated_at=now,
        mirrored_at=now,
    )
    store.rows.extend([mine, other_tenant, other_user])

    resp = operator_client.get("/api/v1/workflows")
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert len(data) == 1
    assert data[0]["id"] == str(ids["wf"])
    assert data[0]["name"] == "Mine"


# ---------------------------------------------------------------------------
# Detail — 404 on wrong tenant
# ---------------------------------------------------------------------------


def test_detail_404_on_wrong_tenant(
    operator_client: TestClient,
    store: _FakeDb,
    ids: dict[str, UUID],
) -> None:
    """GET /api/v1/workflows/{id} returns 404 if the row's tenant differs."""
    now = datetime.now(UTC)
    foreign = _StoreRow(
        id=ids["wf"],
        tenant_id=uuid4(),  # not the operator's tenant
        device_id=uuid4(),
        owner_user_id=ids["user"],
        name="Foreign",
        category="ci",
        definition={"setup_steps": []},
        runner_updated_at=now,
        mirrored_at=now,
    )
    store.rows.append(foreign)

    resp = operator_client.get(f"/api/v1/workflows/{ids['wf']}")
    assert resp.status_code == 404, resp.text
