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

import asyncio
import copy
import hashlib
import json
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import UUID, uuid4

import httpx
import pytest
import pytest_asyncio
from fastapi import FastAPI, HTTPException
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.build_record import BuildRecordPublicSlug, BuildRecordSnapshot
from app.services.build_record_allowlist import (
    BUILD_RECORD_ALLOWED_PATHS,
    BUILD_RECORD_SCHEMA,
    BuildRecordRejected,
    build_record_violations,
    validate_build_record,
)
from app.services.github_repo_visibility import (
    repo_visibility as _REAL_REPO_VISIBILITY,
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
        "sessions": {
            "count": None,
            "unknown_reason": "sessions.count: census_provisional",
        },
        "wall_clock_secs": 172800,
        "self_corrections": {
            "red_ci_fixed": 1,
            "review_findings_fixed": None,
            "gate_reopens": 0,
        },
        "unknowns": [
            "sessions.count: census_provisional",
            "prs[0].opened_at: not_established",
        ],
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
            # The key's NAME is never echoed — it can be the leak itself.
            assert forbidden_key not in violations[0]
            assert (
                "<unlisted key>: key is not in the build-record allowlist"
                in (violations[0])
            )
            with pytest.raises(BuildRecordRejected):
                validate_build_record(doc)

    def test_container_in_a_scalar_slot_is_refused(self) -> None:
        """A dict where a scalar belongs could smuggle arbitrary keys."""
        doc = _document()
        doc["prs"][0]["title"] = {"body": "a findings body"}
        doc["unknowns"].append({"credential": "x"})
        violations = build_record_violations(doc)
        assert "prs[0].title: expected a scalar, got dict" in violations
        assert "unknowns[2]: expected a scalar, got dict" in violations

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
            "prs[1].repo: names an owner/name not in product.repos",
            "prs[1].repo: not one of product.repos, so not known public",
        ]
        # The refusal names the slot, never the private repo itself.
        assert not any("acme/private-thing" in v for v in violations)


class TestValueSlots:
    """Per-slot value types and the content scan over every string."""

    @staticmethod
    def _only(doc: dict[str, Any]) -> list[str]:
        violations = build_record_violations(doc)
        assert violations, "the probe was not refused"
        return violations

    def test_private_repo_in_unknowns(self) -> None:
        doc = _document()
        doc["unknowns"].append("acme/secret-repo: excluded_not_known_public")
        assert any(v.startswith("unknowns[2]:") for v in self._only(doc))

    def test_private_repo_in_product_title(self) -> None:
        doc = _document()
        doc["product"]["title"] = "Tokens, ported from acme/secret-repo"
        assert self._only(doc) == [
            "product.title: names an owner/name not in product.repos"
        ]

    def test_private_repo_in_public_pr_title(self) -> None:
        doc = _document()
        doc["prs"][0]["title"] = "fix: sync with Acme/Secret-Repo"
        assert self._only(doc) == [
            "prs[0].title: names an owner/name not in product.repos"
        ]

    def test_private_repo_in_work_unit_slug(self) -> None:
        doc = _document()
        doc["work_units"][0]["slug"] = "acme/secret-repo"
        assert self._only(doc) == [
            "work_units[0].slug: not a valid work_unit_slug value"
        ]

    def test_email_in_a_count_slot(self) -> None:
        doc = _document()
        doc["gates"]["registered"] = "ops@example.com"
        assert self._only(doc) == ["gates.registered: not a valid count value"]

    def test_device_name_in_unknown_reason(self) -> None:
        doc = _document()
        doc["sessions"]["unknown_reason"] = "census unreachable on spaceship-wsl"
        assert self._only(doc) == [
            "sessions.unknown_reason: not a valid unknown_or_null value"
        ]

    @pytest.mark.parametrize(
        "text",
        [
            "owner jane.doe@example.com shipped it",
            "device 0b6c1f1e-1111-4111-8111-111111111111",
        ],
    )
    def test_identity_shapes_in_a_title(self, text: str) -> None:
        doc = _document()
        doc["work_units"][0]["title"] = text
        assert len(self._only(doc)) == 1

    @pytest.mark.parametrize(
        ("path", "value"),
        [
            (("gates", "cleared"), True),
            (("gates", "cleared"), -1),
            (("wall_clock_secs",), 1.5),
            (("prs", 0, "number"), "12"),
            (("work_units", 0, "status"), "done"),
            (("timeline", 0, "to_status"), None),
            (("generated_at",), "2026-10-09 12:00"),
            (("generated_at",), "2026-13-40T12:00:00Z"),
            (("prs", 0, "landed_at"), "2026-02-30T25:61:00Z"),
            (("product", "repos", 0), "not-a-repo"),
            (("unknowns", 0), "sessions.count: because reasons"),
            (("unknowns", 0), "not.a.path: not_established"),
        ],
    )
    def test_slot_type_is_enforced(self, path: tuple[Any, ...], value: Any) -> None:
        doc = _document()
        target: Any = doc
        for step in path[:-1]:
            target = target[step]
        target[path[-1]] = value
        violations = self._only(doc)
        assert any("not a valid" in v for v in violations), violations

    def test_nullable_slots_accept_null_and_numeric_pairs_pass(self) -> None:
        doc = _document()
        doc["timeline"][0]["from_status"] = None
        doc["prs"][0]["landed_at"] = None
        doc["prs"][0]["title"] = (
            "chore: 2026/10 release, see qontinui/qontinui-design-tokens"
        )
        assert build_record_violations(doc) == []


# ===========================================================================
# Layer 2 — HTTP against real Postgres
# ===========================================================================


class _Coord:
    """A stub coord: one tenant's product rows and the documents it serves."""

    def __init__(self) -> None:
        self.products: dict[UUID, list[dict[str, Any]]] = {}
        self.documents: dict[tuple[UUID, str], dict[str, Any]] = {}
        self.puts: list[tuple[str, Any, UUID | None]] = []
        #: Awaited while the document is being "composed" — a race window.
        self.during_document_fetch: Any = None
        #: Raised by the product listing when set.
        self.listing_error: Exception | None = None

    async def get(self, path: str, *, tenant_id: UUID | None = None, **_: Any) -> Any:
        assert tenant_id is not None, "every build-record proxy forwards the bearer"
        if path == "/coord/build-record-products":
            if self.listing_error is not None:
                raise self.listing_error
            return {"products": self.products.get(tenant_id, [])}
        prefix = "/coord/build-records/"
        if path.startswith(prefix):
            key = (tenant_id, path[len(prefix) :])
            if self.during_document_fetch is not None:
                await self.during_document_fetch()
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
            {
                "slug": slug,
                "title": "Design tokens",
                "is_public": is_public,
                "tenant_id": str(tenant_id),
                "repos": ["qontinui/qontinui-design-tokens"],
            }
        )
        doc = _document(slug)
        doc["generated_at"] = _now_rfc3339()
        self.documents[(tenant_id, slug)] = doc


def _now_rfc3339(delta: timedelta = timedelta(0)) -> str:
    return (datetime.now(UTC) + delta).isoformat().replace("+00:00", "Z")


@pytest.fixture()
def coord(monkeypatch: pytest.MonkeyPatch) -> _Coord:
    from app.api.v1.endpoints import build_records
    from app.services import github_repo_visibility
    from app.services.github_repo_visibility import Visibility

    stub = _Coord()
    #: What GitHub answers per repo; anything unlisted is PUBLIC.
    stub.visibility: dict[str, Visibility] = {}  # type: ignore[misc]

    async def visibility(repo: str, **_: Any) -> Visibility:
        return stub.visibility.get(repo, Visibility.PUBLIC)

    monkeypatch.setattr(build_records, "_proxy_coord_get", stub.get)
    monkeypatch.setattr(build_records, "_proxy_coord_put", stub.put)
    monkeypatch.setattr(build_records, "repo_visibility", visibility)
    # The scheduled/on-demand re-check imports it from the service module.
    monkeypatch.setattr(github_repo_visibility, "repo_visibility", visibility)
    return stub


def _app_with_production_errors() -> FastAPI:
    """A bare app carrying the PRODUCTION error envelope (``app/main.py``), so
    a refusal's ``{"error": …}`` sits at the top level here exactly as it
    does for a real caller."""
    from fastapi.exceptions import RequestValidationError
    from starlette.exceptions import HTTPException as StarletteHTTPException

    from app.middleware.error_handler import (
        http_exception_handler,
        validation_exception_handler,
    )

    app = FastAPI()
    app.add_exception_handler(StarletteHTTPException, http_exception_handler)  # type: ignore[arg-type]
    app.add_exception_handler(RequestValidationError, validation_exception_handler)  # type: ignore[arg-type]
    return app


def _build_app(db_session: AsyncSession, tenant_id: UUID) -> FastAPI:
    from app.api.deps import get_async_db
    from app.api.v1.endpoints import build_records, public
    from app.api.v1.endpoints.operations import (
        get_tenant_id,
        require_coord_tenant_admin_target,
    )

    app = _app_with_production_errors()

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
        assert r.json()["error"] == "build_record_product_not_public"
        assert await _snapshot_count(async_db_session) == 0

    async def test_publish_404s_an_unknown_product(
        self, client_a: httpx.AsyncClient, coord: _Coord
    ) -> None:
        r = await client_a.post("/api/v1/build-records/no-such-product/publish")
        assert r.status_code == 404
        assert r.json()["error"] == "build_record_product_not_found"

    async def test_publish_revalidates_the_allowlist(
        self, client_a: httpx.AsyncClient, coord: _Coord, async_db_session
    ) -> None:
        """A coord regression that emits a new field never reaches a snapshot."""
        coord.define(TENANT_A)
        coord.documents[(TENANT_A, SLUG)]["sessions"]["transcript"] = "secret"
        r = await client_a.post(f"/api/v1/build-records/{SLUG}/publish")
        assert r.status_code == 502
        body = r.json()
        assert body["error"] == "build_record_allowlist_violation"
        assert body["violations"] == [
            "sessions.<unlisted key>: key is not in the build-record allowlist"
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
        assert r.json()["error"] == "public_slug_owned_by_another_tenant"

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
        assert r.json() == coord.documents[(TENANT_A, SLUG)]
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
        refused = await client_a.post(f"/api/v1/build-records/{SLUG}/publish")
        assert refused.status_code == 409
        assert refused.json()["error"] == "build_record_retracted"
        r = await client_a.post(
            f"/api/v1/build-records/{SLUG}/publish", json={"reactivate": True}
        )
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
        assert r.json()["error"] == "public_slug_owned_by_another_tenant"
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

        r = await client_b.post(
            f"/api/v1/build-records/{SLUG}/publish", json={"reactivate": True}
        )
        assert r.status_code == 409
        assert r.json()["error"] == "public_slug_owned_by_another_tenant"
        assert (
            await client_b.get(f"/api/v1/public/build-records/{SLUG}")
        ).status_code == 404

    async def test_unpublish_404s_a_never_published_slug(
        self, client_a: httpx.AsyncClient, coord: _Coord
    ) -> None:
        r = await client_a.delete(f"/api/v1/build-records/{SLUG}/publish")
        assert r.status_code == 404
        assert r.json()["error"] == "build_record_not_published"


@pytest.mark.asyncio
class TestPublishGuards:
    """Review findings 2, 3, 5, 7 and 8."""

    async def test_product_row_of_another_tenant_is_refused(
        self, client_a: httpx.AsyncClient, coord: _Coord, async_db_session
    ) -> None:
        coord.define(TENANT_A)
        coord.products[TENANT_A][0]["tenant_id"] = str(TENANT_B)
        r = await client_a.post(f"/api/v1/build-records/{SLUG}/publish")
        assert r.status_code == 409
        assert r.json()["error"] == "build_record_tenant_mismatch"
        assert await _snapshot_count(async_db_session) == 0

    async def test_document_repo_outside_the_definition_is_refused(
        self, client_a: httpx.AsyncClient, coord: _Coord, async_db_session
    ) -> None:
        coord.define(TENANT_A)
        coord.products[TENANT_A][0]["repos"] = ["qontinui/other-repo"]
        r = await client_a.post(f"/api/v1/build-records/{SLUG}/publish")
        assert r.status_code == 502
        assert r.json()["violations"] == [
            "product.repos[0]: not in the product definition's repos"
        ]
        assert await _snapshot_count(async_db_session) == 0

    async def test_stale_document_is_refused(
        self, client_a: httpx.AsyncClient, coord: _Coord, async_db_session
    ) -> None:
        coord.define(TENANT_A)
        assert (
            await client_a.post(f"/api/v1/build-records/{SLUG}/publish")
        ).status_code == 201
        first_generated = datetime.fromisoformat(
            coord.documents[(TENANT_A, SLUG)]["generated_at"]
        )
        coord.documents[(TENANT_A, SLUG)]["generated_at"] = _now_rfc3339(
            timedelta(minutes=-1)
        )
        r = await client_a.post(f"/api/v1/build-records/{SLUG}/publish")
        assert r.status_code == 409
        assert r.json()["error"] == "build_record_stale"
        assert await _snapshot_count(async_db_session) == 1
        stored = (
            await async_db_session.execute(select(BuildRecordSnapshot.generated_at))
        ).scalar_one()
        assert stored == first_generated

    async def test_retraction_during_the_coord_fetch_wins(
        self, client_a: httpx.AsyncClient, coord: _Coord, async_db_session
    ) -> None:
        coord.define(TENANT_A)
        await client_a.post(f"/api/v1/build-records/{SLUG}/publish")

        async def retract_now() -> None:
            await async_db_session.execute(
                update(BuildRecordPublicSlug)
                .where(BuildRecordPublicSlug.public_slug == SLUG)
                .values(unpublished_at=func.now())
            )

        coord.during_document_fetch = retract_now
        r = await client_a.post(f"/api/v1/build-records/{SLUG}/publish")
        assert r.status_code == 409
        assert r.json()["error"] == "build_record_retraction_changed"
        coord.during_document_fetch = None
        assert (
            await client_a.get(f"/api/v1/public/build-records/{SLUG}")
        ).status_code == 404
        assert await _snapshot_count(async_db_session) == 1

    async def test_put_private_retracts_the_published_snapshot(
        self, client_a: httpx.AsyncClient, coord: _Coord
    ) -> None:
        coord.define(TENANT_A)
        await client_a.post(f"/api/v1/build-records/{SLUG}/publish")
        r = await client_a.put(
            f"/api/v1/build-records/products/{SLUG}",
            json={"title": "Design tokens", "is_public": False},
        )
        assert r.status_code == 200, r.text
        assert r.headers["X-Build-Record-Retracted"] == "true"
        assert (
            await client_a.get(f"/api/v1/public/build-records/{SLUG}")
        ).status_code == 404

    async def test_put_private_leaves_another_tenants_slug_alone(
        self,
        client_a: httpx.AsyncClient,
        client_b: httpx.AsyncClient,
        coord: _Coord,
    ) -> None:
        coord.define(TENANT_A)
        await client_a.post(f"/api/v1/build-records/{SLUG}/publish")
        r = await client_b.put(
            f"/api/v1/build-records/products/{SLUG}",
            json={"title": "Mine", "is_public": False},
        )
        assert r.status_code == 200
        assert r.headers["X-Build-Record-Retracted"] == "false"
        assert (
            await client_a.get(f"/api/v1/public/build-records/{SLUG}")
        ).status_code == 200

    async def test_public_answers_are_no_store(
        self, client_a: httpx.AsyncClient, coord: _Coord
    ) -> None:
        missing = await client_a.get(f"/api/v1/public/build-records/{SLUG}")
        assert missing.status_code == 404
        assert missing.headers["cache-control"] == "no-store"
        coord.define(TENANT_A)
        await client_a.post(f"/api/v1/build-records/{SLUG}/publish")
        found = await client_a.get(f"/api/v1/public/build-records/{SLUG}")
        assert found.status_code == 200
        assert found.headers["cache-control"] == "no-store"

    async def test_stored_document_failing_the_current_allowlist_is_404(
        self, client_a: httpx.AsyncClient, async_db_session
    ) -> None:
        doc = _document()
        doc["sessions"]["unknown_reason"] = "free text from an older allowlist"
        async_db_session.add(
            BuildRecordPublicSlug(public_slug=SLUG, tenant_id=TENANT_A)
        )
        await async_db_session.flush()
        async_db_session.add(
            BuildRecordSnapshot(
                tenant_id=TENANT_A,
                public_slug=SLUG,
                version=1,
                document=doc,
                content_sha256="0" * 64,
                generated_at=datetime(2026, 10, 9, tzinfo=UTC),
            )
        )
        await async_db_session.flush()
        r = await client_a.get(f"/api/v1/public/build-records/{SLUG}")
        assert r.status_code == 404


# ===========================================================================
# Layer 3 — the REAL application (app.main.app): auth is not overridden
# ===========================================================================


@pytest_asyncio.fixture()
async def real_app(async_db_session: AsyncSession):
    """``app.main.app`` with only the database bound to the test session."""
    from app.api.deps import get_async_db
    from app.main import app

    async def _db_override():
        yield async_db_session

    app.dependency_overrides[get_async_db] = _db_override
    try:
        yield app
    finally:
        app.dependency_overrides.pop(get_async_db, None)


def _identity(*, admin: bool) -> Any:
    from app.services.coord_identity import CoordIdentity, CoordTenant

    roles = ("admin",) if admin else ("operator",)
    return CoordIdentity(
        operator_id=None,
        home_tenant_id=TENANT_A,
        email=None,
        roles=roles,
        tenants=(CoordTenant(tenant_id=TENANT_A, slug="a", roles=roles),),
        is_admin=admin,
    )


@pytest.fixture()
def signed_in_user(real_app: FastAPI) -> Iterator[None]:
    """A signed-in, non-superuser web user — the session, NOT the coord gate."""
    from app.auth.config import current_active_user
    from app.models.user import User

    user = User(email="builder@example.com", is_active=True, is_superuser=False)
    real_app.dependency_overrides[current_active_user] = lambda: user
    yield
    real_app.dependency_overrides.pop(current_active_user, None)


@pytest.mark.asyncio
class TestRealApp:
    async def test_anonymous_public_read_200_and_404(
        self, real_app: FastAPI, async_db_session
    ) -> None:
        async with _client(real_app) as anon:
            missing = await anon.get(f"/api/v1/public/build-records/{SLUG}")
            assert missing.status_code == 404

            doc = _document()
            async_db_session.add(
                BuildRecordPublicSlug(public_slug=SLUG, tenant_id=TENANT_A)
            )
            await async_db_session.flush()
            async_db_session.add(
                BuildRecordSnapshot(
                    tenant_id=TENANT_A,
                    public_slug=SLUG,
                    version=1,
                    document=doc,
                    content_sha256=hashlib.sha256(
                        json.dumps(doc, sort_keys=True, separators=(",", ":")).encode()
                    ).hexdigest(),
                    generated_at=datetime(2026, 10, 9, 12, tzinfo=UTC),
                )
            )
            await async_db_session.flush()
            found = await anon.get(f"/api/v1/public/build-records/{SLUG}")
            assert found.status_code == 200, found.text
            assert found.json()["version"] == 1

    async def test_anonymous_publish_is_401(
        self, real_app: FastAPI, async_db_session
    ) -> None:
        async with _client(real_app) as anon:
            r = await anon.post(f"/api/v1/build-records/{SLUG}/publish")
        assert r.status_code == 401
        assert await _snapshot_count(async_db_session) == 0

    async def test_non_admin_publish_is_403(
        self,
        real_app: FastAPI,
        signed_in_user: None,
        monkeypatch: pytest.MonkeyPatch,
        async_db_session,
    ) -> None:
        from app.api.v1.endpoints import operations

        async def fake_identity(request: Any) -> Any:
            return _identity(admin=False)

        monkeypatch.setattr(operations, "get_coord_identity", fake_identity)
        async with _client(real_app) as c:
            r = await c.post(f"/api/v1/build-records/{SLUG}/publish")
        assert r.status_code == 403
        assert await _snapshot_count(async_db_session) == 0

    async def test_coord_connect_error_is_502_and_stores_nothing(
        self,
        real_app: FastAPI,
        signed_in_user: None,
        monkeypatch: pytest.MonkeyPatch,
        async_db_session,
    ) -> None:
        from app.api.v1.endpoints import operations

        async def fake_identity(request: Any) -> Any:
            return _identity(admin=True)

        async def refused(self: Any, url: Any, *args: Any, **kwargs: Any) -> Any:
            raise httpx.ConnectError("connection refused")

        monkeypatch.setattr(operations, "get_coord_identity", fake_identity)
        monkeypatch.setattr(httpx.AsyncClient, "get", refused)
        async with _client(real_app) as c:
            r = await c.post(f"/api/v1/build-records/{SLUG}/publish")
        assert r.status_code == 502
        assert await _snapshot_count(async_db_session) == 0
        assert (
            await async_db_session.execute(
                select(func.count()).select_from(BuildRecordPublicSlug)
            )
        ).scalar_one() == 0


# ===========================================================================
# Second review — slot widening, normalisation, identity shapes
# ===========================================================================


class TestSecondReviewSlots:
    def test_long_real_world_work_unit_stem_passes(self) -> None:
        # A real plan stem from qontinui-dev-notes/plans (128 characters).
        stem = (
            "2026-09-08-a-gating-workflows-pr-verdict-is-frozen-at-its-original-"
            "merge-commit-so-a-red-main-window-wedges-every-pr-that-ran-during-it"
        )
        assert len(stem) > 100
        doc = _document()
        doc["work_units"][0]["slug"] = stem
        doc["timeline"][0]["work_unit"] = stem
        assert build_record_violations(doc) == []

    @pytest.mark.parametrize(
        "stem",
        ["PLAN_2026_06_17_auto_tenant_creation", "2026-08-31-x.VETTED-INPROGRESS"],
    )
    def test_upper_case_dot_and_underscore_stems_pass(self, stem: str) -> None:
        doc = _document()
        doc["work_units"][0]["slug"] = stem
        assert build_record_violations(doc) == []

    def test_work_unit_slug_still_scanned_for_identities(self) -> None:
        doc = _document()
        doc["work_units"][0]["slug"] = "deploy-" + "ab" * 16  # a bare 32-hex id
        assert build_record_violations(doc) == [
            "work_units[0].slug: contains a UUID-shaped identifier"
        ]

    def test_titles_are_nullable(self) -> None:
        doc = _document()
        doc["prs"][0]["title"] = None
        doc["work_units"][0]["title"] = None
        doc["unknowns"].append("prs[0].title: not_established")
        assert build_record_violations(doc) == []

    def test_product_title_is_not_nullable(self) -> None:
        doc = _document()
        doc["product"]["title"] = None
        assert build_record_violations(doc) == ["product.title: not a valid text value"]

    @pytest.mark.parametrize(
        "title",
        [
            "port from acme ∕ secret-repo",  # division slash, spaced
            "port from acme⁄secret-repo",  # fraction slash
            "port from ａcme／secret-repo",  # fullwidth, NFKC-folded
            "port from acme / secret-repo",  # plain slash, spaced
        ],
    )
    def test_disguised_repo_tokens_are_caught(self, title: str) -> None:
        doc = _document()
        doc["prs"][0]["title"] = title
        assert build_record_violations(doc) == [
            "prs[0].title: names an owner/name not in product.repos"
        ]

    @pytest.mark.parametrize(
        ("title", "expected"),
        [
            ("owner ops@spaceship", "contains an email-shaped identity"),
            ("id " + "0123456789abcdef" * 2, "contains a UUID-shaped identifier"),
        ],
    )
    def test_bare_identity_shapes_are_caught(self, title: str, expected: str) -> None:
        doc = _document()
        doc["work_units"][0]["title"] = title
        assert build_record_violations(doc) == [f"work_units[0].title: {expected}"]

    def test_a_forty_hex_commit_sha_is_not_a_uuid(self) -> None:
        doc = _document()
        doc["prs"][0]["title"] = "revert " + "0123456789" * 4
        assert build_record_violations(doc) == []


class TestGithubVisibility:
    """The anonymous GitHub read, through ``httpx.MockTransport``."""

    @staticmethod
    async def _ask(handler: Any, repo: str = "qontinui/tokens") -> Any:
        from app.services.github_repo_visibility import repo_visibility

        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as c:
            return await repo_visibility(repo, client=c)

    @pytest.mark.asyncio
    async def test_answers(self) -> None:
        from app.services.github_repo_visibility import Visibility

        def public(request: httpx.Request) -> httpx.Response:
            assert "authorization" not in request.headers  # asked anonymously
            assert request.url.path == "/repos/qontinui/tokens"
            return httpx.Response(
                200, json={"private": False, "full_name": "qontinui/tokens"}
            )

        def private(_: httpx.Request) -> httpx.Response:
            return httpx.Response(
                200, json={"private": True, "full_name": "qontinui/tokens"}
            )

        def renamed(_: httpx.Request) -> httpx.Response:
            return httpx.Response(
                200, json={"private": False, "full_name": "qontinui/new-name"}
            )

        def missing(_: httpx.Request) -> httpx.Response:
            return httpx.Response(404, json={"message": "Not Found"})

        def rate_limited(_: httpx.Request) -> httpx.Response:
            return httpx.Response(403, json={"message": "API rate limit exceeded"})

        def down(request: httpx.Request) -> httpx.Response:
            raise httpx.ConnectError("unreachable", request=request)

        assert await self._ask(public) is Visibility.PUBLIC
        assert await self._ask(private) is Visibility.NOT_PUBLIC
        assert await self._ask(renamed) is Visibility.NOT_PUBLIC
        assert await self._ask(missing) is Visibility.NOT_PUBLIC
        assert await self._ask(rate_limited) is Visibility.UNKNOWN
        assert await self._ask(down) is Visibility.UNKNOWN


@pytest.mark.asyncio
class TestSecondReviewPublish:
    async def test_private_repo_coord_failed_to_filter_is_refused(
        self, client_a: httpx.AsyncClient, coord: _Coord, async_db_session
    ) -> None:
        from app.services.github_repo_visibility import Visibility

        coord.define(TENANT_A)
        coord.visibility["qontinui/qontinui-design-tokens"] = Visibility.NOT_PUBLIC
        r = await client_a.post(f"/api/v1/build-records/{SLUG}/publish")
        assert r.status_code == 502
        assert r.json()["error"] == "build_record_repo_not_public"
        assert await _snapshot_count(async_db_session) == 0

    async def test_unconfirmable_visibility_is_refused(
        self, client_a: httpx.AsyncClient, coord: _Coord, async_db_session
    ) -> None:
        from app.services.github_repo_visibility import Visibility

        coord.define(TENANT_A)
        coord.visibility["qontinui/qontinui-design-tokens"] = Visibility.UNKNOWN
        r = await client_a.post(f"/api/v1/build-records/{SLUG}/publish")
        assert r.status_code == 502
        assert r.json()["error"] == "build_record_repo_visibility_unknown"
        assert await _snapshot_count(async_db_session) == 0

    @pytest.mark.parametrize("delta", [timedelta(hours=-1), timedelta(minutes=10)])
    async def test_generated_at_outside_the_window_is_refused(
        self,
        client_a: httpx.AsyncClient,
        coord: _Coord,
        async_db_session,
        delta: timedelta,
    ) -> None:
        coord.define(TENANT_A)
        coord.documents[(TENANT_A, SLUG)]["generated_at"] = _now_rfc3339(delta)
        r = await client_a.post(f"/api/v1/build-records/{SLUG}/publish")
        assert r.status_code == 502
        assert r.json()["error"] == "build_record_generated_at_out_of_window"
        assert await _snapshot_count(async_db_session) == 0

    async def test_publish_attempt_retracts_a_product_gone_private(
        self, client_a: httpx.AsyncClient, coord: _Coord
    ) -> None:
        coord.define(TENANT_A)
        await client_a.post(f"/api/v1/build-records/{SLUG}/publish")
        coord.products[TENANT_A][0]["is_public"] = False  # via coord's own door
        r = await client_a.post(f"/api/v1/build-records/{SLUG}/publish")
        assert r.status_code == 409
        assert r.json()["error"] == "build_record_product_not_public"
        assert r.json()["retracted"] is True
        assert (
            await client_a.get(f"/api/v1/public/build-records/{SLUG}")
        ).status_code == 404

    async def test_product_going_private_during_publish_retracts_the_new_version(
        self, client_a: httpx.AsyncClient, coord: _Coord, async_db_session
    ) -> None:
        coord.define(TENANT_A)

        async def go_private() -> None:
            coord.products[TENANT_A][0]["is_public"] = False

        coord.during_document_fetch = go_private
        r = await client_a.post(f"/api/v1/build-records/{SLUG}/publish")
        assert r.status_code == 409
        assert r.json()["error"] == "build_record_product_not_public"
        assert r.json()["retracted"] is True
        assert await _snapshot_count(async_db_session) == 1  # kept as history
        assert (
            await client_a.get(f"/api/v1/public/build-records/{SLUG}")
        ).status_code == 404

    async def test_put_reports_its_retraction_even_when_coord_fails(
        self, client_a: httpx.AsyncClient, coord: _Coord, monkeypatch
    ) -> None:
        from app.api.v1.endpoints import build_records

        coord.define(TENANT_A)
        await client_a.post(f"/api/v1/build-records/{SLUG}/publish")

        async def coord_down(*_: Any, **__: Any) -> Any:
            raise HTTPException(status_code=502, detail="coord is not reachable")

        monkeypatch.setattr(build_records, "_proxy_coord_put", coord_down)
        r = await client_a.put(
            f"/api/v1/build-records/products/{SLUG}",
            json={"title": "Design tokens", "is_public": False},
        )
        assert r.status_code == 502
        assert r.headers["X-Build-Record-Retracted"] == "true"
        assert (
            await client_a.get(f"/api/v1/public/build-records/{SLUG}")
        ).status_code == 404

    async def test_reconcile_endpoint_retracts_what_coord_no_longer_lists_public(
        self, client_a: httpx.AsyncClient, coord: _Coord
    ) -> None:
        for slug in ("kept", "made-private", "deleted"):
            coord.define(TENANT_A, slug)
            assert (
                await client_a.post(f"/api/v1/build-records/{slug}/publish")
            ).status_code == 201
        coord.products[TENANT_A] = [
            p for p in coord.products[TENANT_A] if p["slug"] != "deleted"
        ]
        for p in coord.products[TENANT_A]:
            if p["slug"] == "made-private":
                p["is_public"] = False

        r = await client_a.post("/api/v1/build-records/reconcile")
        assert r.status_code == 200, r.text
        assert r.json() == {"retracted": ["deleted", "made-private"]}
        public = "/api/v1/public/build-records"
        assert (await client_a.get(f"{public}/kept")).status_code == 200
        assert (await client_a.get(f"{public}/made-private")).status_code == 404
        assert (await client_a.get(f"{public}/deleted")).status_code == 404

    async def test_reconcile_endpoint_retracts_nothing_when_coord_is_down(
        self, client_a: httpx.AsyncClient, coord: _Coord, monkeypatch
    ) -> None:
        from app.api.v1.endpoints import build_records

        coord.define(TENANT_A)
        await client_a.post(f"/api/v1/build-records/{SLUG}/publish")

        async def coord_down(*_: Any, **__: Any) -> Any:
            raise HTTPException(status_code=502, detail="coord is not reachable")

        monkeypatch.setattr(build_records, "_proxy_coord_get", coord_down)
        r = await client_a.post("/api/v1/build-records/reconcile")
        assert r.status_code == 502
        assert (
            await client_a.get(f"/api/v1/public/build-records/{SLUG}")
        ).status_code == 200


# ===========================================================================
# Committed sessions — real concurrency on separate connections
# ===========================================================================


@pytest_asyncio.fixture()
async def committed(test_engine) -> Any:
    """A session maker whose sessions COMMIT for real, and cleanup of every
    ``lock-*`` slug afterwards (these rows are outside any test transaction)."""
    from sqlalchemy import delete
    from sqlalchemy.ext.asyncio import async_sessionmaker

    maker = async_sessionmaker(test_engine, expire_on_commit=False)
    yield maker
    async with maker() as session:
        await session.execute(
            delete(BuildRecordSnapshot).where(
                BuildRecordSnapshot.public_slug.like("lock-%")
            )
        )
        await session.execute(
            delete(BuildRecordPublicSlug).where(
                BuildRecordPublicSlug.public_slug.like("lock-%")
            )
        )
        await session.commit()


def _committed_app(maker: Any, tenant_id: UUID) -> FastAPI:
    """Like :func:`_build_app`, but every request gets its OWN session."""
    from app.api.deps import get_async_db
    from app.api.v1.endpoints import build_records, public
    from app.api.v1.endpoints.operations import (
        get_tenant_id,
        require_coord_tenant_admin_target,
    )

    app = _app_with_production_errors()

    async def _db_override():
        async with maker() as session:
            yield session

    app.dependency_overrides[get_async_db] = _db_override
    app.dependency_overrides[get_tenant_id] = lambda: tenant_id
    app.dependency_overrides[require_coord_tenant_admin_target] = lambda: tenant_id
    app.include_router(build_records.router, prefix="/api/v1/build-records")
    app.include_router(public.router, prefix="/api/v1/public")
    return app


@pytest.mark.asyncio
class TestConcurrency:
    async def test_retraction_committed_on_another_connection_wins(
        self, committed: Any, coord: _Coord, test_engine
    ) -> None:
        slug = f"lock-retract-{uuid4().hex[:8]}"
        coord.define(TENANT_A, slug)
        async with _client(_committed_app(committed, TENANT_A)) as c:
            assert (
                await c.post(f"/api/v1/build-records/{slug}/publish")
            ).status_code == 201

            async def retract_elsewhere() -> None:
                async with test_engine.begin() as conn:  # its own connection
                    await conn.execute(
                        update(BuildRecordPublicSlug)
                        .where(BuildRecordPublicSlug.public_slug == slug)
                        .values(unpublished_at=func.now())
                    )

            coord.during_document_fetch = retract_elsewhere
            r = await c.post(f"/api/v1/build-records/{slug}/publish")
            assert r.status_code == 409
            assert r.json()["error"] == "build_record_retraction_changed"
            assert (
                await c.get(f"/api/v1/public/build-records/{slug}")
            ).status_code == 404

    async def test_parallel_publishes_get_versions_one_and_two(
        self, committed: Any, coord: _Coord
    ) -> None:
        slug = f"lock-parallel-{uuid4().hex[:8]}"
        coord.define(TENANT_A, slug)
        async with _client(_committed_app(committed, TENANT_A)) as c:
            first, second = await asyncio.gather(
                c.post(f"/api/v1/build-records/{slug}/publish"),
                c.post(f"/api/v1/build-records/{slug}/publish"),
            )
        assert first.status_code == 201, first.text
        assert second.status_code == 201, second.text
        assert sorted([first.json()["version"], second.json()["version"]]) == [1, 2]
        async with committed() as session:
            versions = (
                (
                    await session.execute(
                        select(BuildRecordSnapshot.version).where(
                            BuildRecordSnapshot.public_slug == slug
                        )
                    )
                )
                .scalars()
                .all()
            )
        assert sorted(versions) == [1, 2]

    async def test_scheduled_reconcile_retracts_and_treats_unanswered_as_unknown(
        self, committed: Any, coord: _Coord, monkeypatch
    ) -> None:
        from app.jobs import build_record_reconcile as job

        gone = f"lock-gone-{uuid4().hex[:8]}"
        coord.define(TENANT_A, gone)
        coord.define(TENANT_B, f"lock-b-{uuid4().hex[:8]}")
        async with _client(_committed_app(committed, TENANT_A)) as c:
            assert (
                await c.post(f"/api/v1/build-records/{gone}/publish")
            ).status_code == 201
        b_slug = coord.products[TENANT_B][0]["slug"]
        async with _client(_committed_app(committed, TENANT_B)) as c:
            assert (
                await c.post(f"/api/v1/build-records/{b_slug}/publish")
            ).status_code == 201

        async def bearer(tenant_id: UUID) -> str:
            return "service-token"

        async def listing(tenant_id: UUID) -> list[Any] | None:
            # Tenant A's product was deleted in coord; tenant B's coord read
            # is unanswered — which must retract nothing.
            return [] if tenant_id == TENANT_A else None

        monkeypatch.setattr(job, "_service_bearer", bearer)
        monkeypatch.setattr(job, "_list_products", listing)
        totals = await job.reconcile_all(committed)
        assert totals["retracted"] >= 1
        assert totals["unanswered_tenants"] >= 1

        async with committed() as session:
            rows = {
                r.public_slug: r.unpublished_at
                for r in (
                    await session.execute(
                        select(BuildRecordPublicSlug).where(
                            BuildRecordPublicSlug.public_slug.in_([gone, b_slug])
                        )
                    )
                ).scalars()
            }
        assert rows[gone] is not None
        assert rows[b_slug] is None


# ===========================================================================
# Real app — the remaining writes, and the production envelope
# ===========================================================================


@pytest.mark.asyncio
class TestRealAppWrites:
    @pytest.mark.parametrize(
        ("method", "path", "body"),
        [
            ("DELETE", f"/api/v1/build-records/{SLUG}/publish", None),
            (
                "PUT",
                f"/api/v1/build-records/products/{SLUG}",
                {"title": "t", "is_public": False},
            ),
            ("POST", "/api/v1/build-records/reconcile", None),
        ],
    )
    async def test_anonymous_write_is_401(
        self, real_app: FastAPI, method: str, path: str, body: Any
    ) -> None:
        async with _client(real_app) as anon:
            r = await anon.request(method, path, json=body)
        assert r.status_code == 401

    @pytest.mark.parametrize(
        ("method", "path", "body"),
        [
            ("DELETE", f"/api/v1/build-records/{SLUG}/publish", None),
            (
                "PUT",
                f"/api/v1/build-records/products/{SLUG}",
                {"title": "t", "is_public": False},
            ),
            ("POST", "/api/v1/build-records/reconcile", None),
        ],
    )
    async def test_non_admin_write_is_403(
        self,
        real_app: FastAPI,
        signed_in_user: None,
        monkeypatch: pytest.MonkeyPatch,
        method: str,
        path: str,
        body: Any,
    ) -> None:
        from app.api.v1.endpoints import operations

        async def fake_identity(request: Any) -> Any:
            return _identity(admin=False)

        monkeypatch.setattr(operations, "get_coord_identity", fake_identity)
        async with _client(real_app) as c:
            r = await c.request(method, path, json=body)
        assert r.status_code == 403
        assert r.json()["error"]  # production envelope: top-level error code

    async def test_refusal_carries_the_production_envelope(
        self,
        real_app: FastAPI,
        signed_in_user: None,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        from app.api.v1.endpoints import operations

        async def fake_identity(request: Any) -> Any:
            return _identity(admin=True)

        monkeypatch.setattr(operations, "get_coord_identity", fake_identity)
        async with _client(real_app) as c:
            r = await c.delete(f"/api/v1/build-records/{SLUG}/publish")
        assert r.status_code == 404
        body = r.json()
        # The error handler lifts the dict detail to the top level.
        assert "detail" not in body
        assert body["error"] == "build_record_not_published"
        assert body["slug"] == SLUG
        assert {"message", "timestamp", "path"} <= body.keys()


# ===========================================================================
# Third review
# ===========================================================================


def test_slot_patterns_are_full_matches() -> None:
    """``$`` also matches before a trailing newline; fullmatch does not."""
    doc = _document()
    doc["product"]["slug"] = SLUG + "\n"
    doc["product"]["repos"] = ["qontinui/qontinui-design-tokens\n"]
    violations = build_record_violations(doc)
    assert "product.slug: not a valid slug value" in violations
    assert "product.repos[0]: not a valid repo value" in violations


@pytest.mark.asyncio
class TestThirdReview:
    async def test_post_store_transport_error_retracts_and_502s(
        self, client_a: httpx.AsyncClient, coord: _Coord, async_db_session
    ) -> None:
        coord.define(TENANT_A)

        async def coord_drops_after_compose() -> None:
            coord.listing_error = httpx.ConnectError("coord went away")

        coord.during_document_fetch = coord_drops_after_compose
        r = await client_a.post(f"/api/v1/build-records/{SLUG}/publish")
        assert r.status_code == 502
        assert r.json()["error"] == "build_record_post_publish_check_unanswered"
        assert r.json()["retracted"] is True
        assert await _snapshot_count(async_db_session) == 1
        assert (
            await client_a.get(f"/api/v1/public/build-records/{SLUG}")
        ).status_code == 404

    @pytest.mark.parametrize(
        ("github", "status", "error"),
        [
            ({"private": False}, 201, None),
            ({"private": True}, 502, "build_record_repo_not_public"),
        ],
    )
    async def test_publish_runs_the_real_visibility_check(
        self,
        client_a: httpx.AsyncClient,
        coord: _Coord,
        monkeypatch: pytest.MonkeyPatch,
        github: dict[str, Any],
        status: int,
        error: str | None,
    ) -> None:
        """Only the HTTP transport is fake: the route calls the REAL
        ``repo_visibility``, which builds its client through the production
        ``client=None`` branch (``_client_factory``)."""
        from app.api.v1.endpoints import build_records
        from app.services import github_repo_visibility

        asked: list[str] = []

        def handler(request: httpx.Request) -> httpx.Response:
            assert "authorization" not in request.headers
            asked.append(request.url.path)
            name = request.url.path.removeprefix("/repos/")
            return httpx.Response(200, json={**github, "full_name": name})

        # The fixture faked repo_visibility in both modules; put the REAL one
        # (captured at import, before any patch) back on the route's module.
        monkeypatch.setattr(build_records, "repo_visibility", _REAL_REPO_VISIBILITY)
        monkeypatch.setattr(
            github_repo_visibility,
            "_client_factory",
            lambda: httpx.AsyncClient(transport=httpx.MockTransport(handler)),
        )
        coord.define(TENANT_A)
        r = await client_a.post(f"/api/v1/build-records/{SLUG}/publish")
        assert r.status_code == status, r.text
        if error is not None:
            assert r.json()["error"] == error
        assert asked == ["/repos/qontinui/qontinui-design-tokens"]

    async def test_visibility_recheck_is_bounded_and_rotates(
        self, client_a: httpx.AsyncClient, coord: _Coord, async_db_session
    ) -> None:
        from app.jobs.build_record_reconcile import recheck_visibility
        from app.services.github_repo_visibility import Visibility

        for slug in ("vis-a", "vis-b", "vis-c"):
            coord.define(TENANT_A, slug)
            assert (
                await client_a.post(f"/api/v1/build-records/{slug}/publish")
            ).status_code == 201
        coord.visibility["qontinui/qontinui-design-tokens"] = Visibility.UNKNOWN

        # Budget 1: one slug per call, oldest-checked first, so three calls
        # visit three different slugs. UNKNOWN never retracts.
        for _ in range(3):
            assert await recheck_visibility(async_db_session, budget=1) == []
        checked = (
            (
                await async_db_session.execute(
                    select(BuildRecordPublicSlug).where(
                        BuildRecordPublicSlug.public_slug.in_(
                            ["vis-a", "vis-b", "vis-c"]
                        )
                    )
                )
            )
            .scalars()
            .all()
        )
        assert all(o.last_visibility_check_at is not None for o in checked)
        assert all(o.unpublished_at is None for o in checked)

        # The repo went private: the next call (oldest = vis-a) retracts it.
        coord.visibility["qontinui/qontinui-design-tokens"] = Visibility.NOT_PUBLIC
        assert await recheck_visibility(async_db_session, budget=1) == ["vis-a"]
        public = "/api/v1/public/build-records"
        assert (await client_a.get(f"{public}/vis-a")).status_code == 404
        assert (await client_a.get(f"{public}/vis-b")).status_code == 200


@pytest.mark.asyncio
class TestReconcileResilience:
    async def test_list_products_treats_transport_errors_as_unanswered(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from app.api.v1.endpoints import operations
        from app.jobs.build_record_reconcile import _list_products

        for exc in (httpx.ConnectError("down"), ValueError("not json")):

            async def broken(*_: Any, __exc: Exception = exc, **___: Any) -> Any:
                raise __exc

            monkeypatch.setattr(operations, "_proxy_coord_get", broken)
            assert await _list_products(TENANT_A) is None

    async def test_one_failing_or_slow_tenant_does_not_starve_the_rest(
        self, committed: Any, coord: _Coord, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from app.jobs import build_record_reconcile as job

        tenant_c = UUID("cccccccc-0000-4000-8000-0000000000c3")
        slugs = {}
        for tenant in (TENANT_A, TENANT_B, tenant_c):
            slug = f"lock-res-{uuid4().hex[:8]}"
            slugs[tenant] = slug
            coord.define(tenant, slug)
            async with _client(_committed_app(committed, tenant)) as c:
                assert (
                    await c.post(f"/api/v1/build-records/{slug}/publish")
                ).status_code == 201

        async def bearer(tenant_id: UUID) -> str:
            return "service-token"

        async def listing(tenant_id: UUID) -> list[Any] | None:
            if tenant_id == TENANT_A:
                raise RuntimeError("an unexpected bug in one tenant")
            if tenant_id == TENANT_B:
                await asyncio.sleep(5)  # past the per-tenant timeout
            return []  # tenant C: product deleted in coord

        monkeypatch.setattr(job, "_service_bearer", bearer)
        monkeypatch.setattr(job, "_list_products", listing)
        monkeypatch.setattr(job, "TENANT_TIMEOUT_SECONDS", 0.2)
        totals = await job.reconcile_all(committed)
        assert totals["unanswered_tenants"] >= 2

        async with committed() as session:
            rows = {
                r.public_slug: r.unpublished_at
                for r in (
                    await session.execute(
                        select(BuildRecordPublicSlug).where(
                            BuildRecordPublicSlug.public_slug.in_(slugs.values())
                        )
                    )
                ).scalars()
            }
        assert rows[slugs[tenant_c]] is not None  # reached despite A and B
        assert rows[slugs[TENANT_A]] is None
        assert rows[slugs[TENANT_B]] is None
