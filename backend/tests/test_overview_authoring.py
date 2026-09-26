"""The overview authoring contract, end to end against real Postgres.

Phase 1 of ``2026-09-20-overview-authoring-layer``. What this file pins:

* **The registry is exhaustive** — every ``overview.*`` table is owned by a
  resource or excluded with a reason, so nothing ships without permissions
  and audit.
* **Numeric bounds belong to the contract** — every decimal a write schema
  accepts declares the precision of the column it lands in, and an oversized
  value is a 422 naming the field, never a database overflow.
* **One permission answer** — the catalog's ``can_edit`` and the write gates
  are the same decision, for the ACTIVE project, and ``editing_roles`` widens
  web-owned resources without touching coord-owned ones.
* **The resource contract** on its first resource, coord's intent documents,
  behind a fake coord: ``If-Match`` required, a stale write refused with the
  server's copy, frontmatter preserved, the ``overview_order`` key merged
  rather than clobbered, idempotent create, and a change-log row per write.

Only :func:`app.overview.permissions.get_overview_caller` (coord's answer to
"who is this, in which project") and the coord document transport are
stubbed; everything between them and the database runs for real.
"""

from __future__ import annotations

import copy
from decimal import Decimal
from typing import Any
from uuid import UUID, uuid4

import httpx
import pytest
import pytest_asyncio
from fastapi import FastAPI, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

API = "/api/v1/overview"

pytestmark = pytest.mark.asyncio

TENANT_A = UUID("aaaaaaaa-0000-4000-8000-00000000000a")

VISION_BODY = (
    "---\n"
    "audience: leaders\n"
    "last_reviewed: 2026-09-01\n"
    "---\n"
    "\n"
    "# Vision — the autonomy ratchet\n"
    "\n"
    "Every release lets an agent do one more thing unattended.\n"
)


def _now_iso() -> str:
    from datetime import UTC, datetime

    return datetime.now(UTC).isoformat()


# ===========================================================================
# A fake coord prompt-document store
# ===========================================================================


class FakeCoord:
    """Coord's prompt-document routes, as far as the adapter uses them.

    Faithful where it matters to the contract: a body edit moves
    ``current_version``; an attrs-only edit updates in place WITHOUT moving
    it; ``attrs`` is replaced wholesale; a create of an existing name is 409.
    ``cas`` turns on the ``expected_version`` check a future coord may make.
    """

    def __init__(self) -> None:
        self.docs: dict[tuple[str, str], dict[str, Any]] = {}
        self.gets: list[tuple[str, str]] = []
        self.patches: list[dict[str, Any]] = []
        self.creates: list[dict[str, Any]] = []
        self.fail_get: set[tuple[str, str]] = set()
        self.cas = False
        self.degraded: str | None = None

    def seed(
        self,
        kind: str,
        name: str,
        body: str,
        *,
        version: int = 3,
        default_source: str | None = None,
        unedited_seed: bool | None = False,
        attrs: dict[str, Any] | None = None,
        updated_at: str = "2026-09-20T10:00:00Z",
    ) -> None:
        self.docs[(kind, name)] = {
            "id": str(uuid4()),
            "kind": kind,
            "name": name,
            "description": f"maintainer note for {name}",
            "format": "markdown",
            "default_source": default_source,
            "current_version": version,
            "unedited_seed": unedited_seed,
            "updated_at": updated_at,
            "updated_by": "someone@example.com",
            "body": body,
            "attrs": attrs,
        }

    async def list(self, tenant_id: UUID) -> dict[str, Any]:
        summaries = [
            {k: v for k, v in d.items() if k not in ("body", "attrs")}
            for d in self.docs.values()
        ]
        # Coord lists every kind, behavior kinds included.
        summaries.append(
            {
                "kind": "policy",
                "name": "testing",
                "current_version": 4,
                "default_source": None,
            }
        )
        out: dict[str, Any] = {"documents": summaries, "total": len(summaries)}
        if self.degraded:
            out["degraded"] = self.degraded
        return out

    async def get(self, tenant_id: UUID, kind: str, name: str) -> dict[str, Any]:
        self.gets.append((kind, name))
        if (kind, name) in self.fail_get:
            raise HTTPException(status_code=500, detail="boom")
        doc = self.docs.get((kind, name))
        if doc is None:
            raise HTTPException(status_code=404, detail="not found")
        return copy.deepcopy(doc)

    async def patch(
        self, tenant_id: UUID, kind: str, name: str, body: dict[str, Any]
    ) -> dict[str, Any]:
        self.patches.append(copy.deepcopy(body))
        doc = self.docs.get((kind, name))
        if doc is None:
            raise HTTPException(status_code=404, detail="not found")
        if (
            self.cas
            and "expected_version" in body
            and body["expected_version"] != doc["current_version"]
        ):
            raise HTTPException(status_code=409, detail="stale")
        if "attrs" in body:
            doc["attrs"] = body["attrs"]
        if "body" in body:
            doc["body"] = body["body"]
            doc["current_version"] += 1
            doc["unedited_seed"] = False
        return copy.deepcopy(doc)

    async def create(
        self, tenant_id: UUID, kind: str, body: dict[str, Any]
    ) -> dict[str, Any]:
        self.creates.append(copy.deepcopy(body))
        if (kind, body["name"]) in self.docs:
            raise HTTPException(status_code=409, detail="exists")
        self.seed(kind, body["name"], body["body"], version=1)
        return copy.deepcopy(self.docs[(kind, body["name"])])


# ===========================================================================
# Harness
# ===========================================================================


@pytest_asyncio.fixture()
async def api_user(async_db_session: AsyncSession):
    from app.models.user import User

    user = User(
        email=f"authoring_{uuid4().hex[:8]}@example.com",
        username=f"authoring_{uuid4().hex[:8]}",
        full_name="Authoring Tester",
        is_active=True,
        is_verified=True,
    )
    async_db_session.add(user)
    await async_db_session.commit()
    await async_db_session.refresh(user)
    return user


@pytest.fixture()
def coord() -> FakeCoord:
    fake = FakeCoord()
    fake.seed("product_intent", "vision", VISION_BODY)
    fake.seed(
        "product_intent",
        "non-goals",
        "# Non-goals\n\nNot a chatbot.\n",
        attrs={"overview_order": 2, "owner_note": "keep me"},
    )
    fake.seed(
        "audience_profile",
        "example-audience",
        "---\naudience: <who>\n---\n\n# Example audience — REPLACE THIS SKELETON\n",
        version=1,
        default_source="builtin",
        unedited_seed=True,
    )
    return fake


def _app(db: AsyncSession, user, coord: FakeCoord, roles: tuple[str, ...]) -> FastAPI:
    from app.api.deps import current_active_user, get_async_db
    from app.api.v1.endpoints.overview import router as overview_router
    from app.overview.intent_documents import IntentDocumentStore, intent_document_store
    from app.overview.permissions import OverviewCaller, get_overview_caller
    from app.overview.router import router as authoring_router

    app = FastAPI()
    app.dependency_overrides[current_active_user] = lambda: user

    async def _db():
        yield db

    app.dependency_overrides[get_async_db] = _db
    app.dependency_overrides[get_overview_caller] = lambda: OverviewCaller(
        tenant_id=TENANT_A, roles=roles
    )
    app.dependency_overrides[intent_document_store] = lambda: IntentDocumentStore(coord)
    app.include_router(overview_router, prefix=API)
    app.include_router(authoring_router, prefix=API)
    return app


def _client(app: FastAPI, *, source: str | None = "ui") -> httpx.AsyncClient:
    headers = {"X-Overview-Source": source} if source else {}
    return httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test", headers=headers
    )


@pytest_asyncio.fixture()
async def admin(async_db_session, api_user, coord):
    async with _client(_app(async_db_session, api_user, coord, ("admin",))) as c:
        yield c


@pytest_asyncio.fixture()
async def operator(async_db_session, api_user, coord):
    """A plain member — coord role ``operator`` in THIS project."""
    async with _client(_app(async_db_session, api_user, coord, ("operator",))) as c:
        yield c


async def _log_rows(db: AsyncSession, resource: str) -> list[Any]:
    from app.models.overview import ChangeLog

    stmt = (
        select(ChangeLog)
        .where(ChangeLog.tenant_id == TENANT_A, ChangeLog.resource == resource)
        .order_by(ChangeLog.created_at)
    )
    return list((await db.execute(stmt)).scalars().all())


# ===========================================================================
# The registry
# ===========================================================================


class TestRegistry:
    async def test_every_overview_table_is_owned_or_excluded(self) -> None:
        """A table in the ``overview`` schema with no registry entry would be
        a resource with no permission rule and no audit. Refuse it here."""
        import app.models.overview  # noqa: F401 — binds the tables
        from app.db.base import Base
        from app.overview.registry import EXCLUDED_TABLES, REGISTRY

        tables = {
            t.name for t in Base.metadata.tables.values() if t.schema == "overview"
        }
        owned: dict[str, str] = {}
        for spec in REGISTRY.values():
            for table in spec.tables:
                assert table not in owned, f"{table} is owned by {owned[table]} too"
                owned[table] = spec.name
        assert tables, "no overview tables bound — the check would be vacuous"
        unaccounted = tables - set(owned) - set(EXCLUDED_TABLES)
        assert not unaccounted, f"no registry entry or exclusion: {sorted(unaccounted)}"
        stale = (set(owned) | set(EXCLUDED_TABLES)) - tables
        assert not stale, f"registry names tables that do not exist: {sorted(stale)}"

    async def test_every_routed_resource_offers_its_write_models(self) -> None:
        from app.overview.registry import REGISTRY

        for spec in REGISTRY.values():
            if "create" in spec.operations:
                assert spec.create_model is not None, spec.name
            if "update" in spec.operations:
                assert spec.update_model is not None, spec.name
            fields = spec.read_model.model_fields
            assert "version" in fields, f"{spec.name}: no version to concur on"


# ===========================================================================
# Numeric bounds belong to the contract
# ===========================================================================


def _write_models() -> list[type]:
    """Every model in the overview schema module a client WRITES."""
    import inspect

    from pydantic import BaseModel

    import app.schemas.overview as schemas

    return [
        obj
        for name, obj in inspect.getmembers(schemas, inspect.isclass)
        if issubclass(obj, BaseModel)
        and obj.__module__ == schemas.__name__
        and name.endswith(("Write", "Create", "Update"))
    ]


def _decimal_fields(model: type) -> list[str]:
    from typing import get_args

    def mentions_decimal(annotation: Any) -> bool:
        if annotation is Decimal:
            return True
        return any(mentions_decimal(a) for a in get_args(annotation))

    return [
        name
        for name, info in model.model_fields.items()
        if mentions_decimal(info.annotation)
    ]


class TestNumericBounds:
    async def test_every_decimal_a_client_writes_declares_its_precision(self) -> None:
        from app.overview.precision import numeric_spec_of

        models = _write_models()
        assert len(models) >= 8, "the write-model scan found too few models"
        missing = [
            f"{m.__name__}.{f}"
            for m in models
            for f in _decimal_fields(m)
            if numeric_spec_of(m.model_fields[f]) is None
        ]
        assert not missing, f"decimal fields with no declared precision: {missing}"

    async def test_each_declared_precision_matches_its_column(self) -> None:
        from sqlalchemy import Numeric

        from app.models import overview as models
        from app.overview.precision import numeric_spec_of
        from app.schemas import overview as schemas

        pairs = {
            schemas.OverviewSettingsWrite: models.OverviewSettings,
            schemas.EstimateCreate: models.Estimate,
            schemas.EstimateUpdate: models.Estimate,
            schemas.PhaseWrite: models.Phase,
            schemas.TaskEffortWrite: models.TaskEffort,
            schemas.AllocationWrite: models.PhaseAllocation,
            schemas.PriceTierWrite: models.PriceTier,
        }
        checked = 0
        for write, orm in pairs.items():
            for field in _decimal_fields(write):
                column = orm.__table__.columns[field]
                assert isinstance(column.type, Numeric), f"{orm.__name__}.{field}"
                spec = numeric_spec_of(write.model_fields[field])
                assert spec is not None
                assert (spec.precision, spec.scale) == (
                    column.type.precision,
                    column.type.scale,
                ), f"{write.__name__}.{field} disagrees with its column"
                checked += 1
        assert checked >= 8

    async def test_an_oversized_person_day_count_is_a_422_not_an_overflow(
        self, admin: httpx.AsyncClient
    ) -> None:
        """The gap overview Phase 2 left on ``planned_person_days``: reachable
        by a direct API caller, and a database ``numeric_field_overflow``."""
        estimate = (
            await admin.post(
                f"{API}/estimates", json={"name": "Big", "purpose": "forecast"}
            )
        ).json()

        def content(days: str) -> dict[str, Any]:
            return {
                "roles": [{"code": "BE", "name": "Backend"}],
                "phases": [
                    {
                        "code": "P1",
                        "name": "Build",
                        "tasks": [
                            {
                                "number": "1",
                                "title": "Everything",
                                "efforts": [
                                    {"role_code": "BE", "planned_person_days": days}
                                ],
                            }
                        ],
                    }
                ],
            }

        url = f"{API}/estimates/{estimate['id']}/content"
        too_big = await admin.put(url, json=content("10000000000"))
        assert too_big.status_code == 422, too_big.text
        assert "planned_person_days" in too_big.text

        # Rounding can carry a value over the limit; that is refused too.
        carried = await admin.put(url, json=content("99999999.995"))
        assert carried.status_code == 422, carried.text

        # Extra places round, as NUMERIC does — an import that stored 1.33
        # yesterday still stores 1.33.
        ok = await admin.put(url, json=content("1.335"))
        assert ok.status_code == 200, ok.text
        effort = ok.json()["phases"][0]["tasks"][0]["efforts"][0]
        assert Decimal(effort["planned_person_days"]) == Decimal("1.34")

    async def test_a_positive_value_that_rounds_to_zero_is_a_422(
        self, admin: httpx.AsyncClient
    ) -> None:
        """``gt=0`` passes 0.004 hours, which then rounds to 0.00 and would
        fail the column's CHECK as a database error rather than a 422."""
        response = await admin.put(f"{API}/settings", json={"hours_per_day": "0.004"})
        assert response.status_code == 422, response.text
        assert "hours_per_day" in response.text

    async def test_the_bound_is_published_for_the_form(
        self, admin: httpx.AsyncClient
    ) -> None:
        catalog = (await admin.get(f"{API}/resources")).json()
        estimates = next(r for r in catalog["resources"] if r["name"] == "estimates")
        field = estimates["schemas"]["update"]["properties"]["contingency_pct"]
        rendered = str(field)
        assert "x-numeric" in rendered and "exclusiveMaximum" in rendered


# ===========================================================================
# Permissions — one answer, served and enforced
# ===========================================================================


def _can_edit(catalog: dict[str, Any], name: str) -> bool:
    return next(r for r in catalog["resources"] if r["name"] == name)["can_edit"]


class TestPermissions:
    async def test_the_catalog_serves_what_the_gates_enforce(
        self, admin: httpx.AsyncClient, operator: httpx.AsyncClient
    ) -> None:
        a = (await admin.get(f"{API}/resources")).json()
        o = (await operator.get(f"{API}/resources")).json()
        assert a["tenant_id"] == str(TENANT_A)
        for name in ("intent_documents", "estimates", "settings"):
            assert _can_edit(a, name) is True
            assert _can_edit(o, name) is False
        # …and the operator's writes are refused, exactly as served.
        denied = await operator.post(
            f"{API}/estimates", json={"name": "x", "purpose": "budget"}
        )
        assert denied.status_code == 403
        doc = await operator.get(f"{API}/intent-documents/product_intent:vision")
        assert doc.json()["can_edit"] is False
        patched = await operator.patch(
            f"{API}/intent-documents/product_intent:vision",
            json={"body": "mine"},
            headers={"If-Match": '"3"'},
        )
        assert patched.status_code == 403

    async def test_editing_roles_widens_web_owned_resources_only(
        self, admin: httpx.AsyncClient, operator: httpx.AsyncClient
    ) -> None:
        saved = await admin.put(
            f"{API}/settings", json={"editing_roles": ["admin", "operator"]}
        )
        assert saved.status_code == 200, saved.text
        assert saved.json()["editing_roles"] == ["admin", "operator"]

        catalog = (await operator.get(f"{API}/resources")).json()
        assert _can_edit(catalog, "estimates") is True
        # Coord decides its own writes; a web setting cannot promise more.
        assert _can_edit(catalog, "intent_documents") is False
        # The setting that widens access is not writable by those it widens to.
        assert _can_edit(catalog, "settings") is False

        created = await operator.post(
            f"{API}/estimates", json={"name": "by an operator", "purpose": "budget"}
        )
        assert created.status_code == 201, created.text
        refused = await operator.put(
            f"{API}/settings", json={"editing_roles": ["admin", "operator"]}
        )
        assert refused.status_code == 403

    async def test_a_null_editing_roles_reads_as_admins_only(
        self,
        admin: httpx.AsyncClient,
        operator: httpx.AsyncClient,
        async_db_session: AsyncSession,
    ) -> None:
        """The column is nullable only so its migration is provably additive.
        A NULL must read as the default — admins only — never as a wider set."""
        from sqlalchemy import text

        await admin.put(f"{API}/settings", json={"base_currency": "EUR"})
        await async_db_session.execute(
            text(
                "UPDATE overview.settings SET editing_roles = NULL WHERE tenant_id = :t"
            ),
            {"t": TENANT_A},
        )
        # Refresh only the settings row: the raw UPDATE bypassed the session,
        # and expiring everything would also expire the shared test user.
        from app.models.overview import OverviewSettings

        row = await async_db_session.get(OverviewSettings, TENANT_A)
        assert row is not None
        await async_db_session.refresh(row)
        assert row.editing_roles is None
        read = await admin.get(f"{API}/settings")
        assert read.status_code == 200, read.text
        assert read.json()["editing_roles"] == ["admin"]
        catalog = (await operator.get(f"{API}/resources")).json()
        assert _can_edit(catalog, "estimates") is False

    async def test_editing_roles_must_keep_admin(
        self, admin: httpx.AsyncClient
    ) -> None:
        response = await admin.put(
            f"{API}/settings", json={"editing_roles": ["operator"]}
        )
        assert response.status_code == 422
        unknown = await admin.put(
            f"{API}/settings", json={"editing_roles": ["admin", "everyone"]}
        )
        assert unknown.status_code == 422

    async def test_a_settings_save_without_editing_roles_keeps_them(
        self, admin: httpx.AsyncClient
    ) -> None:
        await admin.put(
            f"{API}/settings", json={"editing_roles": ["admin", "operator"]}
        )
        again = await admin.put(f"{API}/settings", json={"base_currency": "EUR"})
        assert again.json()["editing_roles"] == ["admin", "operator"]


# ===========================================================================
# Intent documents — the contract on a store we do not own
# ===========================================================================


class TestIntentDocumentReads:
    async def test_the_list_is_intent_kinds_only_and_skeletons_are_not_fetched(
        self, admin: httpx.AsyncClient, coord: FakeCoord
    ) -> None:
        response = await admin.get(f"{API}/intent-documents")
        assert response.status_code == 200, response.text
        body = response.json()
        ids = {i["id"] for i in body["items"]}
        assert ids == {
            "product_intent:vision",
            "product_intent:non-goals",
            "audience_profile:example-audience",
        }
        assert body["can_edit"] is True and body["degraded"] is None
        skeleton = next(i for i in body["items"] if i["state"] == "skeleton")
        assert skeleton["body"] == ""
        assert ("audience_profile", "example-audience") not in coord.gets

    async def test_the_prose_and_the_frontmatter_are_served_apart(
        self, admin: httpx.AsyncClient
    ) -> None:
        response = await admin.get(f"{API}/intent-documents/product_intent:vision")
        assert response.headers["ETag"] == '"3"'
        item = response.json()["item"]
        assert item["frontmatter"].startswith("---\naudience: leaders")
        assert item["body"].startswith("# Vision")
        assert "audience:" not in item["body"]

    async def test_a_kind_filter_narrows_the_list(
        self, admin: httpx.AsyncClient
    ) -> None:
        body = (
            await admin.get(
                f"{API}/intent-documents", params={"kind": "audience_profile"}
            )
        ).json()
        assert [i["kind"] for i in body["items"]] == ["audience_profile"]

    async def test_one_unreadable_body_marks_only_itself(
        self, admin: httpx.AsyncClient, coord: FakeCoord
    ) -> None:
        coord.fail_get.add(("product_intent", "vision"))
        items = (await admin.get(f"{API}/intent-documents")).json()["items"]
        states = {i["id"]: i["state"] for i in items}
        assert states["product_intent:vision"] == "unreadable"
        assert states["product_intent:non-goals"] == "authored"

    async def test_a_degraded_store_says_so_instead_of_reading_empty(
        self, admin: httpx.AsyncClient, coord: FakeCoord
    ) -> None:
        coord.docs.clear()
        coord.degraded = "prompt_documents relation missing"
        body = (await admin.get(f"{API}/intent-documents")).json()
        assert body["items"] == [] and body["degraded"]

    async def test_an_id_this_resource_cannot_hold_is_404(
        self, admin: httpx.AsyncClient
    ) -> None:
        for bad in ("policy:testing", "vision", "product_intent:Not Kebab"):
            response = await admin.get(f"{API}/intent-documents/{bad}")
            assert response.status_code == 404, bad


class TestIntentDocumentWrites:
    async def test_a_write_without_if_match_is_428(
        self, admin: httpx.AsyncClient
    ) -> None:
        response = await admin.patch(
            f"{API}/intent-documents/product_intent:vision", json={"body": "x"}
        )
        assert response.status_code == 428

    async def test_a_stale_write_is_refused_with_the_servers_copy(
        self, admin: httpx.AsyncClient, coord: FakeCoord
    ) -> None:
        response = await admin.patch(
            f"{API}/intent-documents/product_intent:vision",
            json={"body": "my version"},
            headers={"If-Match": '"2"'},
        )
        assert response.status_code == 409
        body = response.json()
        assert body["error"] == "version_conflict"
        assert body["current_version"] == 3
        assert body["current"]["body"].startswith("# Vision")
        assert coord.patches == []  # nothing reached coord

    async def test_an_edit_keeps_the_frontmatter_and_is_logged(
        self, admin: httpx.AsyncClient, coord: FakeCoord, async_db_session: AsyncSession
    ) -> None:
        response = await admin.patch(
            f"{API}/intent-documents/product_intent:vision",
            json={"body": "# Vision\n\nShip the ratchet.\n"},
            headers={"If-Match": '"3"'},
        )
        assert response.status_code == 200, response.text
        assert response.headers["ETag"] == '"4"'
        stored = coord.docs[("product_intent", "vision")]["body"]
        assert stored.startswith(
            "---\naudience: leaders\nlast_reviewed: 2026-09-01\n---\n"
        )
        assert stored.endswith("# Vision\n\nShip the ratchet.\n")
        # The version it was built on travels to coord, for a coord that checks.
        assert coord.patches[-1]["expected_version"] == 3

        rows = await _log_rows(async_db_session, "intent_documents")
        assert len(rows) == 1
        row = rows[0]
        assert (row.record_id, row.action, row.source) == (
            "product_intent:vision",
            "update",
            "ui",
        )
        assert (row.version_before, row.version_after) == (3, 4)
        assert "Every release" in row.before["body"]
        assert "Ship the ratchet" in row.after["body"]

    async def test_an_unchanged_save_writes_nothing(
        self, admin: httpx.AsyncClient, coord: FakeCoord, async_db_session: AsyncSession
    ) -> None:
        current = (
            await admin.get(f"{API}/intent-documents/product_intent:vision")
        ).json()["item"]
        response = await admin.patch(
            f"{API}/intent-documents/product_intent:vision",
            json={"body": current["body"]},
            headers={"If-Match": '"3"'},
        )
        assert response.status_code == 200
        assert coord.patches == []
        assert await _log_rows(async_db_session, "intent_documents") == []

    async def test_reordering_merges_into_the_stored_attrs(
        self, admin: httpx.AsyncClient, coord: FakeCoord
    ) -> None:
        response = await admin.patch(
            f"{API}/intent-documents/product_intent:non-goals",
            json={"overview_order": 1},
            headers={"If-Match": '"3"'},
        )
        assert response.status_code == 200, response.text
        attrs = coord.docs[("product_intent", "non-goals")]["attrs"]
        assert attrs == {"overview_order": 1, "owner_note": "keep me"}
        # An attrs-only edit does not move coord's version.
        assert response.json()["item"]["version"] == 3

        cleared = await admin.patch(
            f"{API}/intent-documents/product_intent:non-goals",
            json={"overview_order": None},
            headers={"If-Match": '"3"'},
        )
        assert cleared.status_code == 200
        assert coord.docs[("product_intent", "non-goals")]["attrs"] == {
            "owner_note": "keep me"
        }

    async def test_a_body_cannot_be_blanked(self, admin: httpx.AsyncClient) -> None:
        for body in ({"body": "   "}, {"body": None}, {}):
            response = await admin.patch(
                f"{API}/intent-documents/product_intent:vision",
                json=body,
                headers={"If-Match": '"3"'},
            )
            assert response.status_code == 422, body

    async def test_a_position_is_bounded(self, admin: httpx.AsyncClient) -> None:
        for order in (0, 1000):
            response = await admin.patch(
                f"{API}/intent-documents/product_intent:vision",
                json={"overview_order": order},
                headers={"If-Match": '"3"'},
            )
            assert response.status_code == 422, order

    async def test_a_coord_that_checks_the_version_is_honoured(
        self, admin: httpx.AsyncClient, coord: FakeCoord
    ) -> None:
        """The window between the adapter's re-read and its PATCH: a coord
        that checks ``expected_version`` refuses, and the caller still gets
        the server's copy rather than a bare error."""
        coord.cas = True
        original_get = coord.get

        async def racing_get(tenant_id, kind, name):
            doc = await original_get(tenant_id, kind, name)
            if len(coord.gets) == 1:
                # Somebody else saves right after the adapter's re-read.
                coord.docs[(kind, name)]["current_version"] += 1
            return doc

        coord.get = racing_get  # type: ignore[method-assign]
        response = await admin.patch(
            f"{API}/intent-documents/product_intent:vision",
            json={"body": "late"},
            headers={"If-Match": '"3"'},
        )
        assert response.status_code == 409
        assert response.json()["current_version"] == 4

    async def test_create_is_idempotent_under_a_retry(
        self, admin: httpx.AsyncClient, coord: FakeCoord, async_db_session: AsyncSession
    ) -> None:
        payload = {
            "kind": "initiative",
            "name": "launch-plan",
            "body": "# Launch plan\n\nThree pilots by spring.\n",
            "overview_order": 1,
        }
        headers = {"Idempotency-Key": "abc-123"}
        first = await admin.post(
            f"{API}/intent-documents", json=payload, headers=headers
        )
        assert first.status_code == 201, first.text
        second = await admin.post(
            f"{API}/intent-documents", json=payload, headers=headers
        )
        assert second.status_code == 200
        assert second.headers.get("Idempotent-Replayed") == "true"
        assert second.json()["item"]["id"] == "initiative:launch-plan"
        assert len(coord.creates) == 1
        assert coord.docs[("initiative", "launch-plan")]["attrs"] == {
            "overview_order": 1
        }
        rows = await _log_rows(async_db_session, "intent_documents")
        assert [r.action for r in rows] == ["create"]

    async def test_a_taken_name_is_a_409_the_reader_can_act_on(
        self, admin: httpx.AsyncClient
    ) -> None:
        response = await admin.post(
            f"{API}/intent-documents",
            json={"kind": "product_intent", "name": "vision", "body": "again"},
        )
        assert response.status_code == 409
        assert response.json()["error"] == "name_taken"

    async def test_a_behavior_kind_cannot_be_created_here(
        self, admin: httpx.AsyncClient
    ) -> None:
        response = await admin.post(
            f"{API}/intent-documents",
            json={"kind": "policy", "name": "sneaky", "body": "x"},
        )
        assert response.status_code == 422

    async def test_the_change_log_reads_newest_first_and_says_when_it_truncates(
        self, admin: httpx.AsyncClient
    ) -> None:
        for n in range(3):
            current = (
                await admin.get(f"{API}/intent-documents/product_intent:vision")
            ).json()["item"]
            await admin.patch(
                f"{API}/intent-documents/product_intent:vision",
                json={"body": f"# Vision\n\nRevision {n}\n"},
                headers={"If-Match": f'"{current["version"]}"'},
            )
        page = (
            await admin.get(
                f"{API}/change-log",
                params={
                    "resource": "intent_documents",
                    "record_id": "product_intent:vision",
                    "limit": 2,
                },
            )
        ).json()
        assert page["truncated"] is True
        assert [e["version_after"] for e in page["entries"]] == [6, 5]
        assert page["entries"][0]["actor"].startswith("authoring_")


class TestEstimateWritesAreLogged:
    async def test_create_content_and_delete_each_leave_a_row(
        self, admin: httpx.AsyncClient, async_db_session: AsyncSession
    ) -> None:
        created = (
            await admin.post(
                f"{API}/estimates", json={"name": "Logged", "purpose": "budget"}
            )
        ).json()
        await admin.put(
            f"{API}/estimates/{created['id']}/content",
            json={"roles": [{"code": "BE", "name": "Backend"}]},
        )
        await admin.delete(f"{API}/estimates/{created['id']}")
        rows = await _log_rows(async_db_session, "estimates")
        assert [r.action for r in rows] == ["create", "update", "delete"]
        assert rows[1].after["roles"][0]["code"] == "BE"
        # A deleted estimate is still answerable: the row keeps what it said.
        assert rows[2].before["estimate"]["name"] == "Logged"
        assert rows[2].after is None


class TestIntentDocumentShapes:
    """Pure functions of the adapter. The classification cases moved here from
    the Summary page's ``intent.test.ts`` when classifying moved server-side."""

    async def test_coord_s_served_verdict_beats_the_version_fallback(self) -> None:
        from app.overview.intent_documents import _state

        assert (
            _state(
                {
                    "default_source": "seed/v1",
                    "current_version": 1,
                    "unedited_seed": False,
                }
            )
            == "authored"
        )
        assert (
            _state(
                {
                    "default_source": "seed/v1",
                    "current_version": 4,
                    "unedited_seed": True,
                }
            )
            == "skeleton"
        )

    async def test_without_a_verdict_origin_and_version_decide_and_never_guess(
        self,
    ) -> None:
        from app.overview.intent_documents import _state

        assert _state({"default_source": None, "current_version": 1}) == "authored"
        assert _state({"default_source": "seed/v1", "current_version": 1}) == "skeleton"
        # Edited since seeding, but only the body could say how much.
        assert _state({"default_source": "seed/v1", "current_version": 2}) == "unknown"
        assert (
            _state(
                {
                    "default_source": "seed/v1",
                    "current_version": 2,
                    "unedited_seed": None,
                }
            )
            == "unknown"
        )

    async def test_frontmatter_round_trips_byte_for_byte(self) -> None:
        from app.overview.intent_documents import join_frontmatter, split_frontmatter

        front, prose = split_frontmatter(VISION_BODY)
        assert front == "---\naudience: leaders\nlast_reviewed: 2026-09-01\n---\n"
        assert prose.startswith("# Vision")
        assert join_frontmatter(front, prose) == VISION_BODY

    async def test_a_later_rule_is_not_frontmatter(self) -> None:
        from app.overview.intent_documents import split_frontmatter

        body = "# Title\n\nText\n\n---\n\nMore"
        assert split_frontmatter(body) == (None, body)

    async def test_a_stray_boolean_is_not_a_position(self) -> None:
        from app.overview.intent_documents import _order

        assert _order({"attrs": {"overview_order": True}}) is None
        assert _order({"attrs": {"overview_order": 2}}) == 2
        assert _order({"attrs": None}) is None


class TestReviewRegressions:
    """Defects the independent review of this change found. Each test fails
    against the code before its fix."""

    async def test_a_locked_save_compares_the_row_as_it_is_not_as_cached(
        self, async_db_session: AsyncSession
    ) -> None:
        """The permission check reads the settings row first, so the session
        holds a copy. A concurrent save then moves the row. The locked read
        must see that save — a lock that hands back the cached copy compares
        a version from before the lock, and lets a stale write through."""
        from sqlalchemy import text

        from app.crud import overview_estimate as crud
        from app.models.overview import OverviewSettings

        common = {
            "actor": "a",
            "base_currency": "USD",
            "fx_rates": {},
            "labour_billing": "unbilled",
            "hours_per_day": Decimal("8"),
            "working_day_factor": Decimal("1"),
            "first_value_date": None,
        }
        await crud.upsert_settings(
            async_db_session, tenant_id=TENANT_A, expected_version=None, **common
        )
        cached = await async_db_session.get(OverviewSettings, TENANT_A)
        assert cached is not None and cached.version == 1
        # Somebody else's save, behind the session's back.
        await async_db_session.execute(
            text("UPDATE overview.settings SET version = 2 WHERE tenant_id = :t"),
            {"t": TENANT_A},
        )
        with pytest.raises(crud.VersionConflict) as excinfo:
            await crud.upsert_settings(
                async_db_session, tenant_id=TENANT_A, expected_version=1, **common
            )
        assert excinfo.value.current_version == 2

    async def test_a_missing_membership_row_grants_no_roles(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Not the cross-tenant union: when coord's membership list lacks the
        tenant being resolved, the caller has no roles there."""
        from app.overview import permissions
        from app.services.coord_identity import CoordIdentity

        identity = CoordIdentity(
            operator_id=uuid4(),
            home_tenant_id=TENANT_A,
            email="x@example.com",
            roles=("admin",),
            tenants=(),
            is_admin=True,
        )

        async def _identity(_request):
            return identity

        class _Req:
            headers: dict[str, str] = {}
            cookies: dict[str, str] = {}

        monkeypatch.setattr(permissions, "get_coord_identity", _identity)
        caller = await permissions.get_overview_caller(_Req())  # type: ignore[arg-type]
        assert caller.tenant_id == TENANT_A
        assert caller.roles == ()

    async def test_a_retried_create_whose_answer_was_lost_is_adopted(
        self, admin: httpx.AsyncClient, coord: FakeCoord, async_db_session: AsyncSession
    ) -> None:
        """The first attempt landed in coord but its answer was lost, so no
        change-log row carries the key. The retry is refused by coord as a
        duplicate — and must be answered with the record it made."""
        payload = {
            "kind": "initiative",
            "name": "launch-plan",
            "body": "# Launch plan\n\nThree pilots.\n",
            "overview_order": 2,
        }
        # The lost first attempt, straight into coord, moments ago.
        coord.seed(
            "initiative",
            "launch-plan",
            payload["body"],
            version=1,
            updated_at=_now_iso(),
        )
        response = await admin.post(
            f"{API}/intent-documents", json=payload, headers={"Idempotency-Key": "k-1"}
        )
        assert response.status_code == 200, response.text
        assert response.headers.get("Idempotent-Replayed") == "true"
        assert coord.docs[("initiative", "launch-plan")]["attrs"] == {
            "overview_order": 2
        }
        rows = await _log_rows(async_db_session, "intent_documents")
        assert [(r.action, r.idempotency_key) for r in rows] == [("create", "k-1")]

    @pytest.mark.parametrize(
        "case", ["edited_since", "made_long_ago", "created_through_overview"]
    )
    async def test_a_matching_document_that_is_not_this_retry_is_not_adopted(
        self,
        case: str,
        admin: httpx.AsyncClient,
        coord: FakeCoord,
        async_db_session: AsyncSession,
    ) -> None:
        """Same name, same body — but edited since, or old, or created through
        the overview under another key: somebody else's, so still refused."""
        body = "# Launch plan\n\nThree pilots.\n"
        coord.seed(
            "initiative",
            "launch-plan",
            body,
            version=2 if case == "edited_since" else 1,
            updated_at="2026-01-01T00:00:00Z"
            if case == "made_long_ago"
            else _now_iso(),
        )
        if case == "created_through_overview":
            from app.overview import change_log

            await change_log.record(
                async_db_session,
                tenant_id=TENANT_A,
                resource="intent_documents",
                record_id="initiative:launch-plan",
                action="create",
                source="ui",
                actor="someone-else@example.com",
                actor_user_id=None,
                before=None,
                after={"id": "initiative:launch-plan"},
                idempotency_key="their-key",
            )
        response = await admin.post(
            f"{API}/intent-documents",
            json={"kind": "initiative", "name": "launch-plan", "body": body},
            headers={"Idempotency-Key": "my-key"},
        )
        assert response.status_code == 409, response.text
        assert response.json()["error"] == "name_taken"

    async def test_a_placement_refused_while_adopting_keeps_its_status(
        self, admin: httpx.AsyncClient, coord: FakeCoord
    ) -> None:
        body = "# Launch plan\n\nThree pilots.\n"
        coord.seed("initiative", "launch-plan", body, version=1, updated_at=_now_iso())

        async def refuse(*args, **kwargs):
            raise HTTPException(status_code=422, detail="attrs rejected")

        coord.patch = refuse  # type: ignore[method-assign]
        response = await admin.post(
            f"{API}/intent-documents",
            json={
                "kind": "initiative",
                "name": "launch-plan",
                "body": body,
                "overview_order": 1,
            },
            headers={"Idempotency-Key": "k-3"},
        )
        assert response.status_code == 422, response.text

    async def test_somebody_elses_document_is_not_adopted(
        self, admin: httpx.AsyncClient, coord: FakeCoord
    ) -> None:
        response = await admin.post(
            f"{API}/intent-documents",
            json={"kind": "product_intent", "name": "vision", "body": "different"},
            headers={"Idempotency-Key": "k-2"},
        )
        assert response.status_code == 409
        assert response.json()["error"] == "name_taken"

    async def test_an_empty_write_answer_is_re_read_not_a_500(
        self, admin: httpx.AsyncClient, coord: FakeCoord
    ) -> None:
        original = coord.patch

        async def empty_patch(*args, **kwargs):
            await original(*args, **kwargs)
            return None

        coord.patch = empty_patch  # type: ignore[method-assign]
        response = await admin.patch(
            f"{API}/intent-documents/product_intent:vision",
            json={"body": "# Vision\n\nNew.\n"},
            headers={"If-Match": '"3"'},
        )
        assert response.status_code == 200, response.text
        assert response.json()["item"]["version"] == 4

    async def test_a_coord_refusal_on_a_read_keeps_its_status(
        self, admin: httpx.AsyncClient, coord: FakeCoord
    ) -> None:
        async def forbidden(*args, **kwargs):
            raise HTTPException(status_code=403, detail="no")

        coord.get = forbidden  # type: ignore[method-assign]
        response = await admin.get(f"{API}/intent-documents/product_intent:vision")
        assert response.status_code == 403

    async def test_saving_unchanged_prose_is_a_no_op_whatever_the_spacing(
        self, admin: httpx.AsyncClient, coord: FakeCoord, async_db_session: AsyncSession
    ) -> None:
        """A document with no blank line after its frontmatter re-joins with
        one; comparing raw text would call an untouched save a change."""
        coord.seed(
            "initiative", "tight", "---\na: b\n---\n# Tight\n\nText.\n", version=2
        )
        current = (await admin.get(f"{API}/intent-documents/initiative:tight")).json()[
            "item"
        ]
        response = await admin.patch(
            f"{API}/intent-documents/initiative:tight",
            json={"body": current["body"]},
            headers={"If-Match": '"2"'},
        )
        assert response.status_code == 200
        assert coord.patches == []
        assert await _log_rows(async_db_session, "intent_documents") == []
