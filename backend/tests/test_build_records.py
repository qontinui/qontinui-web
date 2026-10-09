"""Build records — the D3 allowlist, the publish step, and the public reader.

Phase 1 of ``2026-10-09-factory-built-product-portfolio-and-launch-kit``.

Layers:

* **Layer 1** — the allowlist validator as a pure function. The key set is
  pinned against the binding cross-repo contract, and an injected key is
  refused at EVERY container in a full document (the plan's Arming gate: "the
  allowlist test fails when a non-allowlisted field or a private repo name
  appears").
* **Layer 2** — full HTTP through ``ASGITransport`` against real Postgres.
  coord is stubbed at the two proxy helpers the module calls, and the tenant
  dependencies are overridden at the route boundary (resolving a real one
  needs a live coord). Everything after them — the is_public refusal, the
  re-validation, slug ownership, versioning, the public reader — runs for real.
"""

from __future__ import annotations

import copy
import hashlib
import json
from collections.abc import Iterator
from typing import Any
from uuid import UUID

import httpx
import pytest
import pytest_asyncio
from fastapi import FastAPI, HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.build_record import BuildRecordPublicSlug, BuildRecordSnapshot
from app.services.build_record_allowlist import (
    BUILD_RECORD_ALLOWED_PATHS,
    BUILD_RECORD_SCHEMA,
    BuildRecordRejected,
    build_record_violations,
    validate_build_record,
)

TENANT_A = UUID("aaaaaaaa-0000-4000-8000-0000000000b1")
TENANT_B = UUID("bbbbbbbb-0000-4000-8000-0000000000b2")
SLUG = "design-tokens"


def _document(slug: str = SLUG) -> dict[str, Any]:
    """A complete ``build-record/1`` document with every list non-empty."""
    return {
        "schema": BUILD_RECORD_SCHEMA,
        "generated_at": "2026-10-09T12:00:00Z",
        "product": {
            "slug": slug,
            "title": "Design tokens",
            "repos": ["qontinui/qontinui-design-tokens"],
            "window_start": "2026-09-01T00:00:00Z",
            "window_end": None,
        },
        "work_units": [
            {
                "slug": "2026-09-02-tokens",
                "title": "Tokens",
                "status": "shipped",
                "vetted_at": "2026-09-02T10:00:00Z",
                "shipped_at": "2026-09-04T10:00:00Z",
            }
        ],
        "timeline": [
            {
                "at": "2026-09-02T10:00:00Z",
                "work_unit": "2026-09-02-tokens",
                "from_status": "draft",
                "to_status": "vetted",
            }
        ],
        "prs": [
            {
                "repo": "qontinui/qontinui-design-tokens",
                "number": 12,
                "title": "feat: tokens",
                "opened_at": "2026-09-03T10:00:00Z",
                "landed_at": "2026-09-04T10:00:00Z",
                "ci_duration_secs": 420,
                "attempts": 2,
            }
        ],
        "gates": {"registered": 3, "cleared": 3},
        "sessions": {"count": None, "unknown_reason": "census door provisional"},
        "wall_clock_secs": 172800,
        "self_corrections": {
            "red_ci_fixed": 1,
            "review_findings_fixed": None,
            "gate_reopens": 0,
        },
        "unknowns": ["sessions.count: census door provisional"],
    }


# ===========================================================================
# Layer 1 — the allowlist
# ===========================================================================


class TestAllowlist:
    def test_key_set_is_exactly_the_contract(self) -> None:
        """The contract's ``build-record/1`` key list, written out by hand. A
        key added to the allowlist without the contract changing fails here."""
        assert BUILD_RECORD_ALLOWED_PATHS == {
            "schema",
            "generated_at",
            "product",
            "product.slug",
            "product.title",
            "product.repos",
            "product.window_start",
            "product.window_end",
            "work_units",
            "work_units[].slug",
            "work_units[].title",
            "work_units[].status",
            "work_units[].vetted_at",
            "work_units[].shipped_at",
            "timeline",
            "timeline[].at",
            "timeline[].work_unit",
            "timeline[].from_status",
            "timeline[].to_status",
            "prs",
            "prs[].repo",
            "prs[].number",
            "prs[].title",
            "prs[].opened_at",
            "prs[].landed_at",
            "prs[].ci_duration_secs",
            "prs[].attempts",
            "gates",
            "gates.registered",
            "gates.cleared",
            "sessions",
            "sessions.count",
            "sessions.unknown_reason",
            "wall_clock_secs",
            "self_corrections",
            "self_corrections.red_ci_fixed",
            "self_corrections.review_findings_fixed",
            "self_corrections.gate_reopens",
            "unknowns",
        }

    def test_full_document_passes(self) -> None:
        doc = _document()
        assert build_record_violations(doc) == []
        assert validate_build_record(doc) is doc

    def test_document_with_omitted_keys_passes(self) -> None:
        """Absence leaks nothing; only `schema` is required."""
        assert build_record_violations({"schema": BUILD_RECORD_SCHEMA}) == []

    @staticmethod
    def _object_nodes(
        value: Any, path: tuple[Any, ...] = ()
    ) -> Iterator[tuple[Any, ...]]:
        """The path of every JSON object in ``value``, the root included."""
        if isinstance(value, dict):
            yield path
            for key, sub in value.items():
                yield from TestAllowlist._object_nodes(sub, (*path, key))
        elif isinstance(value, list):
            for index, item in enumerate(value):
                yield from TestAllowlist._object_nodes(item, (*path, index))

    @pytest.mark.parametrize(
        "forbidden_key",
        ["transcript", "email", "machine_name", "device_id", "operator", "user_id"],
    )
    def test_extra_key_is_refused_at_every_depth(self, forbidden_key: str) -> None:
        base = _document()
        nodes = list(self._object_nodes(base))
        # Root, product, gates, sessions, self_corrections and one item in each
        # of work_units / timeline / prs — every object the shape can hold.
        assert len(nodes) == 8
        for node_path in nodes:
            doc = copy.deepcopy(base)
            target: Any = doc
            for step in node_path:
                target = target[step]
            target[forbidden_key] = "leak"
            violations = build_record_violations(doc)
            assert len(violations) == 1, (node_path, violations)
            assert forbidden_key in violations[0]
            assert "not in the build-record allowlist" in violations[0]
            with pytest.raises(BuildRecordRejected):
                validate_build_record(doc)

    def test_container_in_a_scalar_slot_is_refused(self) -> None:
        """A dict where a scalar belongs could smuggle arbitrary keys."""
        doc = _document()
        doc["prs"][0]["title"] = {"body": "a findings body"}
        doc["unknowns"].append({"credential": "x"})
        violations = build_record_violations(doc)
        assert "prs[0].title: expected a scalar, got dict" in violations
        assert "unknowns[1]: expected a scalar, got dict" in violations

    def test_scalar_in_a_container_slot_is_refused(self) -> None:
        doc = _document()
        doc["gates"] = 3
        assert build_record_violations(doc) == ["gates: expected an object, got int"]

    def test_wrong_schema_is_refused(self) -> None:
        doc = _document()
        doc["schema"] = "build-record/2"
        assert len(build_record_violations(doc)) == 1

    def test_non_object_root_is_refused(self) -> None:
        assert build_record_violations(["not", "a", "record"]) == [
            "<root>: expected an object, got list"
        ]

    def test_private_repo_in_the_pr_list_is_refused(self) -> None:
        """coord lists only positively-public repos in product.repos, so a PR
        from any other repo is a private repo name leaking through."""
        doc = _document()
        doc["prs"].append({**doc["prs"][0], "repo": "acme/private-thing"})
        violations = build_record_violations(doc)
        assert violations == [
            "prs[1].repo: not one of product.repos, so not known public"
        ]
        # The refusal names the slot, never the private repo itself.
        assert "acme/private-thing" not in violations[0]


# ===========================================================================
# Layer 2 — HTTP against real Postgres
# ===========================================================================


class _Coord:
    """A stub coord: one tenant's product rows and the documents it serves."""

    def __init__(self) -> None:
        self.products: dict[UUID, list[dict[str, Any]]] = {}
        self.documents: dict[tuple[UUID, str], dict[str, Any]] = {}
        self.puts: list[tuple[str, Any, UUID | None]] = []

    async def get(self, path: str, *, tenant_id: UUID | None = None, **_: Any) -> Any:
        assert tenant_id is not None, "every build-record proxy forwards the bearer"
        if path == "/coord/build-record-products":
            return {"products": self.products.get(tenant_id, [])}
        prefix = "/coord/build-records/"
        if path.startswith(prefix):
            key = (tenant_id, path[len(prefix) :])
            if key not in self.documents:
                raise HTTPException(
                    status_code=404,
                    detail={"error": "build_record_product_not_found"},
                )
            return copy.deepcopy(self.documents[key])
        raise AssertionError(f"unexpected coord GET {path}")

    async def put(
        self, path: str, body: Any, *, tenant_id: UUID | None = None, **_: Any
    ) -> Any:
        self.puts.append((path, body, tenant_id))
        return {"slug": path.rsplit("/", 1)[1], **body}

    def define(
        self, tenant_id: UUID, slug: str = SLUG, *, is_public: bool = True
    ) -> None:
        self.products.setdefault(tenant_id, []).append(
            {"slug": slug, "title": "Design tokens", "is_public": is_public}
        )
        self.documents[(tenant_id, slug)] = _document(slug)


@pytest.fixture()
def coord(monkeypatch: pytest.MonkeyPatch) -> _Coord:
    from app.api.v1.endpoints import build_records

    stub = _Coord()
    monkeypatch.setattr(build_records, "_proxy_coord_get", stub.get)
    monkeypatch.setattr(build_records, "_proxy_coord_put", stub.put)
    return stub


def _build_app(db_session: AsyncSession, tenant_id: UUID) -> FastAPI:
    from app.api.deps import get_async_db
    from app.api.v1.endpoints import build_records, public
    from app.api.v1.endpoints.operations import (
        get_tenant_id,
        require_coord_tenant_admin_target,
    )

    app = FastAPI()

    async def _db_override():
        yield db_session

    app.dependency_overrides[get_async_db] = _db_override
    app.dependency_overrides[get_tenant_id] = lambda: tenant_id
    app.dependency_overrides[require_coord_tenant_admin_target] = lambda: tenant_id
    app.include_router(build_records.router, prefix="/api/v1/build-records")
    app.include_router(public.router, prefix="/api/v1/public")
    return app


def _client(app: FastAPI) -> httpx.AsyncClient:
    return httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    )


@pytest_asyncio.fixture()
async def client_a(async_db_session: AsyncSession, coord: _Coord):
    async with _client(_build_app(async_db_session, TENANT_A)) as c:
        yield c


@pytest_asyncio.fixture()
async def client_b(async_db_session: AsyncSession, coord: _Coord):
    async with _client(_build_app(async_db_session, TENANT_B)) as c:
        yield c


async def _snapshot_count(db: AsyncSession, slug: str = SLUG) -> int:
    return (
        await db.execute(
            select(func.count())
            .select_from(BuildRecordSnapshot)
            .where(BuildRecordSnapshot.public_slug == slug)
        )
    ).scalar_one()


@pytest.mark.asyncio
class TestPublish:
    async def test_publish_refuses_a_product_that_is_not_public(
        self, client_a: httpx.AsyncClient, coord: _Coord, async_db_session
    ) -> None:
        coord.define(TENANT_A, is_public=False)
        r = await client_a.post(f"/api/v1/build-records/{SLUG}/publish")
        assert r.status_code == 409
        assert r.json()["detail"]["error"] == "build_record_product_not_public"
        assert await _snapshot_count(async_db_session) == 0

    async def test_publish_404s_an_unknown_product(
        self, client_a: httpx.AsyncClient, coord: _Coord
    ) -> None:
        r = await client_a.post("/api/v1/build-records/no-such-product/publish")
        assert r.status_code == 404
        assert r.json()["detail"]["error"] == "build_record_product_not_found"

    async def test_publish_revalidates_the_allowlist(
        self, client_a: httpx.AsyncClient, coord: _Coord, async_db_session
    ) -> None:
        """A coord regression that emits a new field never reaches a snapshot."""
        coord.define(TENANT_A)
        coord.documents[(TENANT_A, SLUG)]["sessions"]["transcript"] = "secret"
        r = await client_a.post(f"/api/v1/build-records/{SLUG}/publish")
        assert r.status_code == 502
        detail = r.json()["detail"]
        assert detail["error"] == "build_record_allowlist_violation"
        assert detail["violations"] == [
            "sessions.transcript: key is not in the build-record allowlist"
        ]
        assert await _snapshot_count(async_db_session) == 0

    async def test_publish_refuses_a_document_for_another_product(
        self, client_a: httpx.AsyncClient, coord: _Coord, async_db_session
    ) -> None:
        coord.define(TENANT_A)
        coord.documents[(TENANT_A, SLUG)]["product"]["slug"] = "other"
        r = await client_a.post(f"/api/v1/build-records/{SLUG}/publish")
        assert r.status_code == 502
        assert await _snapshot_count(async_db_session) == 0

    async def test_snapshot_versioning(
        self, client_a: httpx.AsyncClient, coord: _Coord
    ) -> None:
        coord.define(TENANT_A)
        first = await client_a.post(f"/api/v1/build-records/{SLUG}/publish")
        assert first.status_code == 201, first.text
        assert first.json()["version"] == 1
        assert first.json()["public_slug"] == SLUG

        coord.documents[(TENANT_A, SLUG)]["gates"]["registered"] = 4
        second = await client_a.post(f"/api/v1/build-records/{SLUG}/publish")
        assert second.status_code == 201, second.text
        assert second.json()["version"] == 2
        assert second.json()["content_sha256"] != first.json()["content_sha256"]

        # The public reader serves the LATEST version, frozen, with a digest a
        # reader can recompute from the served document.
        r = await client_a.get(f"/api/v1/public/build-records/{SLUG}")
        assert r.status_code == 200
        body = r.json()
        assert body["version"] == 2
        assert body["public_slug"] == SLUG
        assert body["published_at"]
        assert body["document"]["gates"]["registered"] == 4
        canonical = json.dumps(
            body["document"], sort_keys=True, separators=(",", ":"), ensure_ascii=False
        ).encode("utf-8")
        assert hashlib.sha256(canonical).hexdigest() == body["content_sha256"]
        assert body["content_sha256"] == second.json()["content_sha256"]

        # Frozen: coord changing afterwards does not move the public copy.
        coord.documents[(TENANT_A, SLUG)]["gates"]["registered"] = 99
        again = await client_a.get(f"/api/v1/public/build-records/{SLUG}")
        assert again.json()["document"]["gates"]["registered"] == 4

    async def test_cross_tenant_public_slug_collision_is_409(
        self,
        client_a: httpx.AsyncClient,
        client_b: httpx.AsyncClient,
        coord: _Coord,
        async_db_session,
    ) -> None:
        coord.define(TENANT_A)
        coord.define(TENANT_B)
        owned = await client_a.post(f"/api/v1/build-records/{SLUG}/publish")
        assert owned.status_code == 201, owned.text

        r = await client_b.post(f"/api/v1/build-records/{SLUG}/publish")
        assert r.status_code == 409
        assert r.json()["detail"]["error"] == "public_slug_owned_by_another_tenant"

        owner = (
            await async_db_session.execute(
                select(BuildRecordPublicSlug).where(
                    BuildRecordPublicSlug.public_slug == SLUG
                )
            )
        ).scalar_one()
        assert owner.tenant_id == TENANT_A
        assert await _snapshot_count(async_db_session) == 1

        # The owner keeps publishing.
        more = await client_a.post(f"/api/v1/build-records/{SLUG}/publish")
        assert more.status_code == 201
        assert more.json()["version"] == 2


@pytest.mark.asyncio
class TestPublicReader:
    async def test_404_when_nothing_was_published(
        self, client_a: httpx.AsyncClient, coord: _Coord
    ) -> None:
        coord.define(TENANT_A)  # defined and public in coord, but never published
        r = await client_a.get(f"/api/v1/public/build-records/{SLUG}")
        assert r.status_code == 404

    async def test_invalid_slug_is_422(self, client_a: httpx.AsyncClient) -> None:
        r = await client_a.get("/api/v1/public/build-records/Not_A_Slug")
        assert r.status_code == 422


@pytest.mark.asyncio
class TestProxies:
    async def test_list_proxies_coord(
        self, client_a: httpx.AsyncClient, coord: _Coord
    ) -> None:
        coord.define(TENANT_A)
        r = await client_a.get("/api/v1/build-records/products")
        assert r.status_code == 200
        assert [p["slug"] for p in r.json()["products"]] == [SLUG]

    async def test_get_proxies_coord_and_passes_its_404(
        self, client_a: httpx.AsyncClient, coord: _Coord
    ) -> None:
        coord.define(TENANT_A)
        r = await client_a.get(f"/api/v1/build-records/{SLUG}")
        assert r.status_code == 200
        assert r.json() == _document()
        missing = await client_a.get("/api/v1/build-records/absent")
        assert missing.status_code == 404

    async def test_put_forwards_the_contract_body(
        self, client_a: httpx.AsyncClient, coord: _Coord
    ) -> None:
        r = await client_a.put(
            f"/api/v1/build-records/products/{SLUG}",
            json={
                "title": "Design tokens",
                "repos": ["qontinui/qontinui-design-tokens"],
                "window_start": "2026-09-01T00:00:00Z",
                "is_public": True,
            },
        )
        assert r.status_code == 200, r.text
        assert coord.puts == [
            (
                f"/coord/build-record-products/{SLUG}",
                {
                    "title": "Design tokens",
                    "repos": ["qontinui/qontinui-design-tokens"],
                    "window_start": "2026-09-01T00:00:00Z",
                    "window_end": None,
                    "is_public": True,
                },
                TENANT_A,
            )
        ]

    @pytest.mark.parametrize(
        ("slug", "body"),
        [
            ("products", {"title": "t"}),
            ("Bad_Slug", {"title": "t"}),
            (SLUG, {"title": "t", "repos": ["not-owner-slash-name"]}),
            (SLUG, {"title": "t", "owner_email": "x@example.com"}),
            (
                SLUG,
                {
                    "title": "t",
                    "window_start": "2026-09-02T00:00:00Z",
                    "window_end": "2026-09-01T00:00:00Z",
                },
            ),
        ],
    )
    async def test_put_refuses_bad_input_before_coord(
        self, client_a: httpx.AsyncClient, coord: _Coord, slug: str, body: dict
    ) -> None:
        r = await client_a.put(f"/api/v1/build-records/products/{slug}", json=body)
        assert r.status_code == 422
        assert coord.puts == []


@pytest.mark.asyncio
class TestUnpublish:
    """D7's one-step unpublish: ``DELETE /{slug}/publish``."""

    async def test_retract_then_public_404_and_history_kept(
        self, client_a: httpx.AsyncClient, coord: _Coord, async_db_session
    ) -> None:
        coord.define(TENANT_A)
        assert (
            await client_a.post(f"/api/v1/build-records/{SLUG}/publish")
        ).status_code == 201
        assert (
            await client_a.get(f"/api/v1/public/build-records/{SLUG}")
        ).status_code == 200

        r = await client_a.delete(f"/api/v1/build-records/{SLUG}/publish")
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["public_slug"] == SLUG
        assert body["latest_version"] == 1
        assert body["unpublished_at"]

        gone = await client_a.get(f"/api/v1/public/build-records/{SLUG}")
        assert gone.status_code == 404
        # History kept: the snapshot row survives the retraction.
        assert await _snapshot_count(async_db_session) == 1

        # Idempotent: a second unpublish keeps the first retraction time.
        again = await client_a.delete(f"/api/v1/build-records/{SLUG}/publish")
        assert again.status_code == 200
        assert again.json()["unpublished_at"] == body["unpublished_at"]

    async def test_republish_reactivates_as_next_version(
        self, client_a: httpx.AsyncClient, coord: _Coord, async_db_session
    ) -> None:
        coord.define(TENANT_A)
        await client_a.post(f"/api/v1/build-records/{SLUG}/publish")
        await client_a.post(f"/api/v1/build-records/{SLUG}/publish")
        await client_a.delete(f"/api/v1/build-records/{SLUG}/publish")

        coord.documents[(TENANT_A, SLUG)]["gates"]["cleared"] = 7
        r = await client_a.post(f"/api/v1/build-records/{SLUG}/publish")
        assert r.status_code == 201, r.text
        assert r.json()["version"] == 3

        served = await client_a.get(f"/api/v1/public/build-records/{SLUG}")
        assert served.status_code == 200
        assert served.json()["version"] == 3
        assert served.json()["document"]["gates"]["cleared"] == 7
        assert await _snapshot_count(async_db_session) == 3

    async def test_other_tenant_is_refused_and_slug_stays_live(
        self,
        client_a: httpx.AsyncClient,
        client_b: httpx.AsyncClient,
        coord: _Coord,
    ) -> None:
        coord.define(TENANT_A)
        await client_a.post(f"/api/v1/build-records/{SLUG}/publish")

        r = await client_b.delete(f"/api/v1/build-records/{SLUG}/publish")
        assert r.status_code == 409
        assert r.json()["detail"]["error"] == "public_slug_owned_by_another_tenant"
        assert (
            await client_a.get(f"/api/v1/public/build-records/{SLUG}")
        ).status_code == 200

    async def test_retracted_slug_is_not_freed_for_another_tenant(
        self,
        client_a: httpx.AsyncClient,
        client_b: httpx.AsyncClient,
        coord: _Coord,
    ) -> None:
        coord.define(TENANT_A)
        coord.define(TENANT_B)
        await client_a.post(f"/api/v1/build-records/{SLUG}/publish")
        await client_a.delete(f"/api/v1/build-records/{SLUG}/publish")

        r = await client_b.post(f"/api/v1/build-records/{SLUG}/publish")
        assert r.status_code == 409
        assert (
            await client_b.get(f"/api/v1/public/build-records/{SLUG}")
        ).status_code == 404

    async def test_unpublish_404s_a_never_published_slug(
        self, client_a: httpx.AsyncClient, coord: _Coord
    ) -> None:
        r = await client_a.delete(f"/api/v1/build-records/{SLUG}/publish")
        assert r.status_code == 404
        assert r.json()["detail"]["error"] == "build_record_not_published"
