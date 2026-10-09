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
import time
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
    check_repo as _REAL_CHECK_REPO,
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
        self,
        tenant_id: UUID,
        slug: str = SLUG,
        *,
        is_public: bool = True,
        repos: list[str] | None = None,
    ) -> None:
        repos = repos or ["qontinui/qontinui-design-tokens"]
        self.products.setdefault(tenant_id, []).append(
            {
                "slug": slug,
                "title": "Design tokens",
                "is_public": is_public,
                "tenant_id": str(tenant_id),
                "repos": list(repos),
            }
        )
        doc = _document(slug)
        doc["generated_at"] = _now_rfc3339()
        doc["product"]["repos"] = list(repos)
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
    #: X-RateLimit-Remaining the fake GitHub reports (None = header absent).
    stub.rate_remaining: int | None = None  # type: ignore[misc]
    stub.github_calls: list[str] = []  # type: ignore[misc]
    #: Full answers that override ``visibility`` (transport / rate-limit flags).
    stub.answers: dict[str, Any] = {}  # type: ignore[misc]

    async def check(repo: str, **_: Any) -> Any:
        stub.github_calls.append(repo)
        if repo in stub.answers:
            return stub.answers[repo]
        verdict = stub.visibility.get(repo, Visibility.PUBLIC)
        return github_repo_visibility.VisibilityAnswer(verdict, stub.rate_remaining)

    monkeypatch.setattr(build_records, "_proxy_coord_get", stub.get)
    monkeypatch.setattr(build_records, "_proxy_coord_put", stub.put)
    # Publish calls build_records.check_repo; the scheduled re-check imports
    # check_repo from the service module at call time.
    monkeypatch.setattr(build_records, "check_repo", check)
    monkeypatch.setattr(github_repo_visibility, "check_repo", check)
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
        from app.services.github_repo_visibility import check_repo

        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as c:
            return (await check_repo(repo, client=c)).visibility

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
            return httpx.Response(
                403,
                headers={"x-ratelimit-remaining": "0"},
                json={"message": "API rate limit exceeded"},
            )

        def blocked(_: httpx.Request) -> httpx.Response:
            return httpx.Response(
                403,
                headers={"x-ratelimit-remaining": "57"},
                json={"message": "Repository access blocked"},
            )

        def down(request: httpx.Request) -> httpx.Response:
            raise httpx.ConnectError("unreachable", request=request)

        assert await self._ask(public) is Visibility.PUBLIC
        assert await self._ask(private) is Visibility.NOT_PUBLIC
        assert await self._ask(renamed) is Visibility.NOT_PUBLIC
        assert await self._ask(missing) is Visibility.NOT_PUBLIC
        assert await self._ask(rate_limited) is Visibility.UNKNOWN
        assert await self._ask(blocked) is Visibility.NOT_PUBLIC
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
        ``check_repo``, which builds its client through the production
        ``client=None`` branch (``_client_factory``)."""
        from app.api.v1.endpoints import build_records
        from app.services import github_repo_visibility

        asked: list[str] = []

        def handler(request: httpx.Request) -> httpx.Response:
            assert "authorization" not in request.headers
            asked.append(request.url.path)
            name = request.url.path.removeprefix("/repos/")
            return httpx.Response(200, json={**github, "full_name": name})

        # The fixture faked check_repo in both modules; put the REAL one
        # (captured at import, before any patch) back on the route's module.
        monkeypatch.setattr(build_records, "check_repo", _REAL_CHECK_REPO)
        monkeypatch.setattr(github_repo_visibility, "check_repo", _REAL_CHECK_REPO)
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


# ===========================================================================
# Fourth review
# ===========================================================================


class TestHiddenCharacters:
    @pytest.mark.parametrize(
        ("slot", "value"),
        [
            (("prs", 0, "title"), "port from acme​/secret"),  # zero-width space
            (("prs", 0, "title"), "port from acme­/secret"),  # soft hyphen
            (("prs", 0, "title"), "port from acme/⁠secret"),  # word joiner
            (("work_units", 0, "title"), "owner joe​@corp"),
            (
                ("work_units", 0, "title"),
                "device 0b6c1f1e-1111-4111-​8111-111111111111",
            ),
            (("prs", 0, "title"), "port from acme̸secret"),  # overlay solidus
        ],
    )
    def test_invisible_and_overlay_characters_are_refused(
        self, slot: tuple[Any, ...], value: str
    ) -> None:
        doc = _document()
        target: Any = doc
        for step in slot[:-1]:
            target = target[step]
        target[slot[-1]] = value
        where = ".".join(
            f"{s}" if isinstance(s, str) else f"[{s}]" for s in slot
        ).replace(".[", "[")
        assert build_record_violations(doc) == [
            f"{where}: contains an invisible, control or overlay character"
        ]


@pytest.mark.asyncio
class TestFourthReviewPublish:
    @pytest.mark.parametrize(
        "where",
        [
            ("prs", 0, "title", "Port retry loop from secret-engine"),
            ("work_units", 0, "slug", "2026-10-01-secret-engine-cutover"),
        ],
    )
    async def test_excluded_repo_name_never_leaks(
        self,
        client_a: httpx.AsyncClient,
        coord: _Coord,
        async_db_session,
        where: tuple[Any, ...],
    ) -> None:
        coord.define(TENANT_A)
        # The definition names a repo coord could not establish as public, so
        # coord left it out of the document — its NAME must not appear either.
        coord.products[TENANT_A][0]["repos"].append("acme/Secret-Engine")
        target: Any = coord.documents[(TENANT_A, SLUG)]
        for step in where[:-2]:
            target = target[step]
        target[where[-2]] = where[-1]
        if where[0] == "work_units":
            coord.documents[(TENANT_A, SLUG)]["timeline"][0]["work_unit"] = where[-1]
        r = await client_a.post(f"/api/v1/build-records/{SLUG}/publish")
        assert r.status_code == 502, r.text
        violations = r.json()["violations"]
        assert any("names a repo excluded as not known public" in v for v in violations)
        assert not any("secret" in v.lower() for v in violations)  # slot only
        assert await _snapshot_count(async_db_session) == 0

    async def test_put_narrowing_repos_retracts_the_live_page(
        self, client_a: httpx.AsyncClient, coord: _Coord
    ) -> None:
        repos = ["qontinui/qontinui-design-tokens", "qontinui/qontinui-icons"]
        coord.define(TENANT_A, repos=repos)
        await client_a.post(f"/api/v1/build-records/{SLUG}/publish")
        r = await client_a.put(
            f"/api/v1/build-records/products/{SLUG}",
            json={"title": "t", "repos": repos[:1], "is_public": True},
        )
        assert r.status_code == 200, r.text
        assert r.headers["X-Build-Record-Retracted"] == "true"
        assert (
            await client_a.get(f"/api/v1/public/build-records/{SLUG}")
        ).status_code == 404

    async def test_put_keeping_every_repo_leaves_the_page_live(
        self, client_a: httpx.AsyncClient, coord: _Coord
    ) -> None:
        coord.define(TENANT_A)
        await client_a.post(f"/api/v1/build-records/{SLUG}/publish")
        r = await client_a.put(
            f"/api/v1/build-records/products/{SLUG}",
            json={
                "title": "t",
                "repos": ["Qontinui/qontinui-design-tokens", "qontinui/more"],
                "is_public": True,
            },
        )
        assert r.headers["X-Build-Record-Retracted"] == "false"
        assert (
            await client_a.get(f"/api/v1/public/build-records/{SLUG}")
        ).status_code == 200

    async def test_reconcile_retracts_a_page_whose_repo_left_the_definition(
        self, client_a: httpx.AsyncClient, coord: _Coord
    ) -> None:
        repos = ["qontinui/qontinui-design-tokens", "qontinui/qontinui-icons"]
        coord.define(TENANT_A, repos=repos)
        await client_a.post(f"/api/v1/build-records/{SLUG}/publish")
        coord.products[TENANT_A][0]["repos"] = repos[:1]  # via coord's door
        r = await client_a.post("/api/v1/build-records/reconcile")
        assert r.json() == {"retracted": [SLUG]}

    async def test_on_demand_reconcile_never_calls_github(
        self, client_a: httpx.AsyncClient, coord: _Coord
    ) -> None:
        coord.define(TENANT_A)
        await client_a.post(f"/api/v1/build-records/{SLUG}/publish")
        coord.github_calls.clear()
        assert (await client_a.post("/api/v1/build-records/reconcile")).json() == {
            "retracted": []
        }
        assert coord.github_calls == []


@pytest.mark.asyncio
class TestVisibilityTick:
    """The scheduled GitHub re-check: hard cap, cursor, stops."""

    @staticmethod
    async def _publish(client: httpx.AsyncClient, coord: _Coord, slug: str, **kw):
        coord.define(TENANT_A, slug, **kw)
        r = await client.post(f"/api/v1/build-records/{slug}/publish")
        assert r.status_code == 201, r.text

    @staticmethod
    async def _owner(db: AsyncSession, slug: str) -> BuildRecordPublicSlug:
        return (
            await db.execute(
                select(BuildRecordPublicSlug)
                .where(BuildRecordPublicSlug.public_slug == slug)
                .execution_options(populate_existing=True)
            )
        ).scalar_one()

    async def test_budget_is_a_hard_cap_and_the_cursor_rotates(
        self, client_a: httpx.AsyncClient, coord: _Coord, async_db_session
    ) -> None:
        from app.jobs.build_record_reconcile import recheck_visibility

        for slug in ("vis-a", "vis-b", "vis-c"):
            await self._publish(client_a, coord, slug)
        coord.github_calls.clear()

        first = await recheck_visibility(async_db_session, budget=2)
        assert first.calls == 2 == len(coord.github_calls)
        assert first.completed == ["vis-a", "vis-b"]
        second = await recheck_visibility(async_db_session, budget=2)
        assert second.completed[0] == "vis-c"  # never-checked first
        assert second.calls == 2

    async def test_a_wide_slug_resumes_at_its_offset(
        self, client_a: httpx.AsyncClient, coord: _Coord, async_db_session
    ) -> None:
        from app.jobs.build_record_reconcile import recheck_visibility

        repos = [
            "qontinui/qontinui-design-tokens",
            "qontinui/r2",
            "qontinui/r3",
        ]
        await self._publish(client_a, coord, "vis-wide", repos=repos)
        coord.github_calls.clear()
        # The publish itself was a complete answer; a partial tick must not
        # advance it.
        published_check = (
            await self._owner(async_db_session, "vis-wide")
        ).last_visibility_check_at

        tick = await recheck_visibility(async_db_session, budget=2)
        assert tick.calls == 2 and tick.completed == []
        owner = await self._owner(async_db_session, "vis-wide")
        assert owner.visibility_check_offset == 2
        assert owner.last_visibility_check_at == published_check

        tick = await recheck_visibility(async_db_session, budget=2)
        assert coord.github_calls[2] == "qontinui/r3"  # resumed, not restarted
        assert "vis-wide" in tick.completed
        owner = await self._owner(async_db_session, "vis-wide")
        assert owner.visibility_check_offset == 0
        assert owner.last_visibility_check_at is not None

    async def test_transport_error_stops_the_tick_without_advancing(
        self, client_a: httpx.AsyncClient, coord: _Coord, async_db_session
    ) -> None:
        from app.jobs.build_record_reconcile import recheck_visibility
        from app.services.github_repo_visibility import Visibility, VisibilityAnswer

        for slug in ("vis-a", "vis-b"):
            await self._publish(client_a, coord, slug)
        coord.answers["qontinui/qontinui-design-tokens"] = VisibilityAnswer(
            Visibility.UNKNOWN, transport_error=True
        )
        coord.github_calls.clear()

        tick = await recheck_visibility(async_db_session, budget=8)
        assert tick.calls == 1
        assert tick.stopped == "transport"
        assert tick.completed == [] and tick.retracted == [] and tick.gave_up == []
        owner = await self._owner(async_db_session, "vis-a")
        # Not the slug's fault (not counted), but stamped so it cannot hold
        # the head of the queue.
        assert owner.last_visibility_attempt_at is not None
        assert owner.visibility_unknown_attempts == 0
        assert owner.unpublished_at is None

    async def test_when_nothing_answers_no_slug_is_blamed(
        self, client_a: httpx.AsyncClient, coord: _Coord, async_db_session
    ) -> None:
        from app.jobs.build_record_reconcile import recheck_visibility
        from app.services.github_repo_visibility import Visibility

        for slug in ("vis-a", "vis-b", "vis-c"):
            await self._publish(client_a, coord, slug)
        coord.visibility["qontinui/qontinui-design-tokens"] = Visibility.UNKNOWN

        tick = await recheck_visibility(async_db_session, budget=8)
        assert tick.stopped == "github_unanswering"
        assert tick.calls == 2  # stopped after the second all-unknown slug
        assert tick.gave_up == [] and tick.unblamed == ["vis-a", "vis-b"]
        owner = await self._owner(async_db_session, "vis-a")
        assert owner.visibility_unknown_attempts == 0
        assert owner.last_visibility_attempt_at is not None  # moved back
        assert owner.unpublished_at is None

    async def test_low_rate_limit_remaining_stops_the_tick(
        self, client_a: httpx.AsyncClient, coord: _Coord, async_db_session
    ) -> None:
        from app.jobs.build_record_reconcile import recheck_visibility

        for slug in ("vis-a", "vis-b"):
            await self._publish(client_a, coord, slug)
        coord.rate_remaining = 3
        tick = await recheck_visibility(async_db_session, budget=8, reserve=10)
        assert tick.calls == 1
        assert tick.stopped == "rate_limit_low"
        assert tick.completed == ["vis-a"]  # its one repo WAS answered

    async def test_not_public_retracts(
        self, client_a: httpx.AsyncClient, coord: _Coord, async_db_session
    ) -> None:
        from app.jobs.build_record_reconcile import recheck_visibility
        from app.services.github_repo_visibility import Visibility

        await self._publish(client_a, coord, "vis-a")
        coord.visibility["qontinui/qontinui-design-tokens"] = Visibility.NOT_PUBLIC
        tick = await recheck_visibility(async_db_session, budget=8)
        assert tick.retracted == ["vis-a"]
        assert (
            await client_a.get("/api/v1/public/build-records/vis-a")
        ).status_code == 404

    async def test_rate_limited_status_is_an_unknown_that_stops(self) -> None:
        from app.services.github_repo_visibility import Visibility, check_repo

        def handler(_: httpx.Request) -> httpx.Response:
            return httpx.Response(
                403,
                headers={"X-RateLimit-Remaining": "0"},
                json={"message": "API rate limit exceeded"},
            )

        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as c:
            answer = await check_repo("qontinui/tokens", client=c)
        assert answer.visibility is Visibility.UNKNOWN
        assert answer.rate_limited is True
        assert answer.rate_limit_remaining == 0


def test_the_two_build_record_tasks_are_registered_separately() -> None:
    from app.core.scheduler import SchedulerService, install_default_tasks
    from app.jobs.build_record_reconcile import TENANT_PHASE_DEADLINE_SECONDS

    service = SchedulerService()
    install_default_tasks(service)
    reconcile = service._tasks["build_record_reconcile"]
    recheck = service._tasks["build_record_visibility_recheck"]
    assert reconcile.coro is not recheck.coro
    # The tenant phase ends on its own deadline, well inside the task timeout.
    assert TENANT_PHASE_DEADLINE_SECONDS <= reconcile.timeout_seconds / 2


@pytest.mark.asyncio
class TestListProductsThroughTheRealProxy:
    """``_reconcile_one_tenant`` with the REAL ``_list_products`` and
    ``_proxy_coord_get``; only coord's HTTP transport is fake."""

    @pytest.mark.parametrize(
        "coord_answer",
        [
            "connect_error",  # → CoordTransportUnavailable (an HTTPException)
            "read_error",  # → raw httpx.ReadError (an httpx.HTTPError)
            "non_json_200",  # → json.JSONDecodeError (a ValueError)
        ],
    )
    async def test_unanswered_coord_reads_as_none(
        self, committed: Any, monkeypatch: pytest.MonkeyPatch, coord_answer: str
    ) -> None:
        from app.jobs import build_record_reconcile as job

        def handler(request: httpx.Request) -> httpx.Response:
            assert request.headers["authorization"] == "Bearer service-token"
            if coord_answer == "connect_error":
                raise httpx.ConnectError("refused", request=request)
            if coord_answer == "read_error":
                raise httpx.ReadError("connection reset", request=request)
            return httpx.Response(200, text="<html>not json</html>")

        real_client = httpx.AsyncClient

        def fake_client(*args: Any, **kwargs: Any) -> httpx.AsyncClient:
            return real_client(*args, transport=httpx.MockTransport(handler), **kwargs)

        async def bearer(tenant_id: UUID) -> str:
            return "service-token"

        monkeypatch.setattr(job, "_service_bearer", bearer)
        monkeypatch.setattr(httpx, "AsyncClient", fake_client)
        assert await job._reconcile_one_tenant(committed, TENANT_A) is None

    async def test_an_answered_listing_reconciles(
        self, committed: Any, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from app.jobs import build_record_reconcile as job

        def handler(request: httpx.Request) -> httpx.Response:
            assert request.url.path == "/coord/build-record-products"
            return httpx.Response(200, json={"products": []})

        real_client = httpx.AsyncClient

        def fake_client(*args: Any, **kwargs: Any) -> httpx.AsyncClient:
            return real_client(*args, transport=httpx.MockTransport(handler), **kwargs)

        async def bearer(tenant_id: UUID) -> str:
            return "service-token"

        monkeypatch.setattr(job, "_service_bearer", bearer)
        monkeypatch.setattr(httpx, "AsyncClient", fake_client)
        assert await job._reconcile_one_tenant(committed, TENANT_A) == 0


# ===========================================================================
# Fifth review — regression tests from the reviewer's rev/wedge.py and
# rev/bypass.py, and the shared GitHub budget
# ===========================================================================


def _bypass_doc(title: str) -> dict[str, Any]:
    """rev/bypass.py's document: one public repo, the probe in a PR title."""
    doc = _document()
    doc["product"]["repos"] = ["acme/public-app"]
    doc["prs"] = [{**doc["prs"][0], "repo": "acme/public-app", "title": title}]
    return doc


class TestBypassRegression:
    @pytest.mark.parametrize(
        "title",
        [
            "port fix from acme/​secret-billing",  # ZWSP (Cf)
            "port fix from acme/͏secret-billing",  # CGJ (Mn, ignorable)
            "port fix from acme/️secret-billing",  # VS16 (Mn, ignorable)
            "port fix from acme/᠋secret-billing",  # Mongolian FVS1
            "port fix from acme/⁥secret-billing",  # unassigned (Cn)
            "port fix from acme/\U000e0100secret-billing",  # tag-range VS
            "port fix from acme/ㅤsecret-billing",  # Hangul filler (Lo)
            "port fix from acme⟋secret-billing",  # rising diagonal
            "port fix from acme⫽secret-billing",  # double solidus
            "port fix from acmeノsecret-billing",  # katakana NO
            "port fix from acmeﾉsecret-billing",  # halfwidth katakana NO
            "port fix from acme丿secret-billing",  # CJK stroke
            "port fix from acme⼃secret-billing",  # Kangxi radical
            "port fix from acme · secret-billing",  # infix Po
            "port fix from acme∣secret-billing",  # infix Sm (divides)
            "port fix from acme/secrét-billing",  # combining acute
            "port fix from acme/secret-billing",  # private use (Co)
            "reported by jane͏@corp",
            "device 0f8fad5b-️d9cb-469f-a165-70867728950e",
            "id 0f8fad5bd9cb469fa165͏70867728950e",
        ],
    )
    def test_probe_is_refused(self, title: str) -> None:
        assert build_record_violations(_bypass_doc(title)), repr(title)

    def test_plain_public_title_still_passes(self) -> None:
        assert build_record_violations(_bypass_doc("fix: the public app")) == []

    @pytest.mark.parametrize(
        "text",
        [
            "sync secret-billing schema",
            "sync secret͏-billing schema",
            "sync se️cret-billing schema",
            "sync secrét-billing schema",
            "sync SECRET-BILLING schema",
        ],
    )
    def test_excluded_name_is_found_in_the_stripped_form(self, text: str) -> None:
        from app.services.build_record_allowlist import names_token

        assert names_token(text, "secret-billing")

    def test_excluded_name_is_token_bounded(self) -> None:
        from app.services.build_record_allowlist import names_token

        assert not names_token("sync secret-billings schema", "secret-billing")


def _real_github(monkeypatch: pytest.MonkeyPatch, answer: Any) -> list[str]:
    """Put the REAL check_repo back on both modules, behind a MockTransport
    whose per-repo answer is ``answer(name) -> httpx.Response``."""
    from app.api.v1.endpoints import build_records
    from app.services import github_repo_visibility

    asked: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        name = request.url.path.removeprefix("/repos/")
        asked.append(name)
        return answer(name)

    monkeypatch.setattr(build_records, "check_repo", _REAL_CHECK_REPO)
    monkeypatch.setattr(github_repo_visibility, "check_repo", _REAL_CHECK_REPO)
    monkeypatch.setattr(
        github_repo_visibility,
        "_client_factory",
        lambda: httpx.AsyncClient(transport=httpx.MockTransport(handler)),
    )
    return asked


def _public(name: str) -> httpx.Response:
    return httpx.Response(
        200,
        headers={"x-ratelimit-remaining": "4000"},
        json={"private": False, "full_name": name},
    )


@pytest.mark.asyncio
class TestWedgeRegression:
    """rev/wedge.py: a 301 (renamed) repo used to wedge the re-check forever."""

    @staticmethod
    async def _publish(client: httpx.AsyncClient, coord: _Coord, slug: str, repo: str):
        coord.define(TENANT_A, slug, repos=[repo])
        coord.documents[(TENANT_A, slug)]["prs"][0]["repo"] = repo
        r = await client.post(f"/api/v1/build-records/{slug}/publish")
        assert r.status_code == 201, r.text

    async def test_redirected_repo_is_not_public_and_never_wedges(
        self,
        client_a: httpx.AsyncClient,
        coord: _Coord,
        async_db_session,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        from app.jobs.build_record_reconcile import recheck_visibility

        await self._publish(client_a, coord, "a-renamed", "tenant-a/old-name")
        await self._publish(client_a, coord, "b-private", "tenant-b/now-private")
        await self._publish(client_a, coord, "c-other", "tenant-c/fine")

        def github(name: str) -> httpx.Response:
            if name == "tenant-a/old-name":
                return httpx.Response(
                    301,
                    headers={"location": "https://api.github.com/repositories/1"},
                    json={"message": "Moved Permanently"},
                )
            if name == "tenant-b/now-private":
                return httpx.Response(404, json={"message": "Not Found"})
            return _public(name)

        _real_github(monkeypatch, github)
        tick = await recheck_visibility(async_db_session, budget=8)
        assert tick.stopped is None
        assert sorted(tick.retracted) == ["a-renamed", "b-private"]
        assert "c-other" in tick.completed

    async def test_an_unanswerable_slug_ahead_does_not_starve_the_rest(
        self,
        client_a: httpx.AsyncClient,
        coord: _Coord,
        async_db_session,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        from app.jobs.build_record_reconcile import (
            VISIBILITY_UNKNOWN_RETRACT_AFTER,
            recheck_visibility,
        )

        await self._publish(client_a, coord, "a-flaky", "tenant-a/flaky")
        await self._publish(client_a, coord, "b-private", "tenant-b/now-private")
        await self._publish(client_a, coord, "c-public", "tenant-c/fine")

        def github(name: str) -> httpx.Response:
            if name == "tenant-a/flaky":
                return httpx.Response(502, text="bad gateway")
            if name == "tenant-b/now-private":
                return httpx.Response(404, json={"message": "Not Found"})
            return _public(name)

        _real_github(monkeypatch, github)
        first = await recheck_visibility(async_db_session, budget=8)
        assert first.retracted == ["b-private"]  # not starved by a-flaky ahead
        assert first.gave_up == ["a-flaky"]  # blamed: others DID get answers

        # The flaky one is retracted after K consecutive BLAMED give-ups (the
        # public slug keeps answering, so GitHub is demonstrably up).
        retracted = list(first.retracted)
        for _ in range(VISIBILITY_UNKNOWN_RETRACT_AFTER - 1):
            retracted += (
                await recheck_visibility(async_db_session, budget=8)
            ).retracted
        assert retracted == ["b-private", "a-flaky"]

    @pytest.mark.parametrize("status", [301, 302, 307, 308, 451])
    async def test_redirect_and_451_statuses_are_not_public(self, status: int) -> None:
        from app.services.github_repo_visibility import Visibility, check_repo

        transport = httpx.MockTransport(lambda _: httpx.Response(status))
        async with httpx.AsyncClient(transport=transport) as c:
            answer = await check_repo("qontinui/tokens", client=c)
        assert answer.visibility is Visibility.NOT_PUBLIC


@pytest.mark.asyncio
class TestGithubBudget:
    async def _set_budget(self, db: AsyncSession, remaining: int, reset: Any) -> None:
        from app.services import github_rate_budget
        from app.services.github_repo_visibility import Visibility, VisibilityAnswer

        await github_rate_budget.record(
            db, [VisibilityAnswer(Visibility.PUBLIC, remaining, reset)]
        )
        await db.flush()

    async def test_publish_refuses_while_the_budget_is_at_the_reserve(
        self, client_a: httpx.AsyncClient, coord: _Coord, async_db_session
    ) -> None:
        coord.define(TENANT_A)
        await self._set_budget(
            async_db_session, 20, datetime.now(UTC) + timedelta(minutes=30)
        )
        coord.github_calls.clear()
        r = await client_a.post(f"/api/v1/build-records/{SLUG}/publish")
        assert r.status_code == 502
        assert r.json()["error"] == "build_record_repo_visibility_budget_reserved"
        assert coord.github_calls == []  # refused before asking

    async def test_a_reset_window_reserves_nothing(
        self, client_a: httpx.AsyncClient, coord: _Coord, async_db_session
    ) -> None:
        coord.define(TENANT_A)
        await self._set_budget(
            async_db_session, 0, datetime.now(UTC) - timedelta(minutes=1)
        )
        r = await client_a.post(f"/api/v1/build-records/{SLUG}/publish")
        assert r.status_code == 201, r.text

    async def test_publish_records_the_reading_and_the_recheck_respects_it(
        self, client_a: httpx.AsyncClient, coord: _Coord, async_db_session
    ) -> None:
        from app.jobs.build_record_reconcile import recheck_visibility
        from app.models.build_record import GithubRateBudget

        coord.define(TENANT_A)
        coord.rate_remaining = 25  # above publish's reserve, at the re-check's
        r = await client_a.post(f"/api/v1/build-records/{SLUG}/publish")
        assert r.status_code == 201, r.text
        row = (await async_db_session.execute(select(GithubRateBudget))).scalar_one()
        assert row.remaining == 25
        coord.github_calls.clear()
        tick = await recheck_visibility(async_db_session)
        assert tick.stopped == "budget_reserved" and coord.github_calls == []

    async def test_more_than_fifty_repos_is_refused(
        self, client_a: httpx.AsyncClient, coord: _Coord
    ) -> None:
        repos = [f"qontinui/repo-{i:02d}" for i in range(51)]
        coord.define(TENANT_A, repos=repos)
        coord.documents[(TENANT_A, SLUG)]["prs"][0]["repo"] = repos[0]
        coord.github_calls.clear()
        r = await client_a.post(f"/api/v1/build-records/{SLUG}/publish")
        assert r.status_code == 409
        assert r.json()["error"] == "build_record_too_many_repos"
        assert coord.github_calls == []

    async def test_the_operator_token_is_sent_when_configured(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from app.core.config import settings
        from app.services.github_repo_visibility import Visibility, check_repo

        seen: list[str | None] = []

        def handler(request: httpx.Request) -> httpx.Response:
            seen.append(request.headers.get("authorization"))
            return httpx.Response(
                200,
                headers={
                    "x-ratelimit-remaining": "4999",
                    "x-ratelimit-reset": "2000000000",
                },
                json={"private": False, "full_name": "qontinui/tokens"},
            )

        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as c:
            assert (await check_repo("qontinui/tokens", client=c)).visibility is (
                Visibility.PUBLIC
            )
            monkeypatch.setattr(settings, "GITHUB_VISIBILITY_TOKEN", "github_pat_x")
            answer = await check_repo("qontinui/tokens", client=c)
        assert seen == [None, "Bearer github_pat_x"]
        assert answer.rate_limit_remaining == 4999
        assert answer.rate_limit_reset is not None


# ===========================================================================
# Sixth review — regression tests from rev6/probe1.py and rev6/t/test_rev6.py
# ===========================================================================


@pytest.mark.asyncio
class TestRev6:
    @staticmethod
    async def _publish(client: httpx.AsyncClient, coord: _Coord, slug: str, repo: str):
        coord.define(TENANT_A, slug, repos=[repo])
        coord.documents[(TENANT_A, slug)]["prs"][0]["repo"] = repo
        r = await client.post(f"/api/v1/build-records/{slug}/publish")
        assert r.status_code == 201, r.text

    async def test_a_blocked_403_repo_is_not_public_and_never_wedges(
        self,
        client_a: httpx.AsyncClient,
        coord: _Coord,
        async_db_session,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        from app.jobs.build_record_reconcile import recheck_visibility

        await self._publish(client_a, coord, "a-blocked", "tenant-a/blocked")
        await self._publish(client_a, coord, "b-private", "tenant-b/now-private")

        def github(name: str) -> httpx.Response:
            if name == "tenant-a/blocked":
                return httpx.Response(
                    403,
                    headers={"x-ratelimit-remaining": "57"},
                    json={"message": "Repository access blocked"},
                )
            if name == "tenant-b/now-private":
                return httpx.Response(404, json={"message": "Not Found"})
            return _public(name)

        _real_github(monkeypatch, github)
        tick = await recheck_visibility(async_db_session, budget=8)
        assert tick.stopped is None
        assert sorted(tick.retracted) == ["a-blocked", "b-private"]
        r = await client_a.get("/api/v1/public/build-records/b-private")
        assert r.status_code == 404

    async def test_a_real_rate_limit_stops_but_cannot_hold_the_queue(
        self,
        client_a: httpx.AsyncClient,
        coord: _Coord,
        async_db_session,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        from app.jobs.build_record_reconcile import recheck_visibility

        await self._publish(client_a, coord, "a-first", "tenant-a/x")
        await self._publish(client_a, coord, "b-second", "tenant-b/now-private")
        limited = {"on": True}

        def github(name: str) -> httpx.Response:
            if name == "tenant-a/x" and limited["on"]:
                # The window has already reset by the next tick (reset in the
                # past), so the persisted budget does not hold tick two back.
                return httpx.Response(
                    403,
                    headers={
                        "x-ratelimit-remaining": "0",
                        "retry-after": "60",
                        "x-ratelimit-reset": str(int(time.time()) - 1),
                    },
                )
            if name == "tenant-b/now-private":
                return httpx.Response(404)
            return _public(name)

        _real_github(monkeypatch, github)
        first = await recheck_visibility(async_db_session, budget=8)
        assert first.stopped == "rate_limited" and first.retracted == []
        # a-first was stamped, so the next tick starts with b-second.
        second = await recheck_visibility(async_db_session, budget=8)
        assert second.retracted == ["b-second"]

    async def test_a_dead_operator_token_falls_back_and_retracts_nothing(
        self,
        client_a: httpx.AsyncClient,
        coord: _Coord,
        async_db_session,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        from app.core.config import settings
        from app.jobs.build_record_reconcile import recheck_visibility
        from app.services import github_repo_visibility

        for slug in ("p-one", "p-two", "p-three"):
            await self._publish(client_a, coord, slug, f"tenant-a/{slug}")
        monkeypatch.setattr(settings, "GITHUB_VISIBILITY_TOKEN", "github_pat_dead")
        monkeypatch.setattr(github_repo_visibility, "_token_rejected_at", None)
        auth_seen: list[str | None] = []

        def handler(request: httpx.Request) -> httpx.Response:
            auth = request.headers.get("authorization")
            auth_seen.append(auth)
            if auth:
                return httpx.Response(401, json={"message": "Bad credentials"})
            return _public(request.url.path.removeprefix("/repos/"))

        monkeypatch.setattr(github_repo_visibility, "check_repo", _REAL_CHECK_REPO)
        monkeypatch.setattr(
            github_repo_visibility,
            "_client_factory",
            lambda: httpx.AsyncClient(transport=httpx.MockTransport(handler)),
        )
        retracted: list[str] = []
        for _ in range(6):
            tick = await recheck_visibility(async_db_session, budget=8)
            retracted += tick.retracted
        assert retracted == []
        # One rejected request, then anonymous for the rest of the window.
        assert auth_seen[0] == "Bearer github_pat_dead"
        assert auth_seen[1:] and all(a is None for a in auth_seen[1:])

    async def test_a_github_wide_outage_retracts_nothing(
        self,
        client_a: httpx.AsyncClient,
        coord: _Coord,
        async_db_session,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        from app.jobs.build_record_reconcile import recheck_visibility

        for slug in ("p-one", "p-two", "p-three"):
            await self._publish(client_a, coord, slug, f"tenant-a/{slug}")
        _real_github(monkeypatch, lambda _: httpx.Response(503, text="unavailable"))
        retracted: list[str] = []
        for _ in range(12):
            tick = await recheck_visibility(async_db_session, budget=8)
            retracted += tick.retracted
            assert tick.gave_up == []
        assert retracted == []


class TestConfusables:
    @pytest.mark.parametrize(
        ("title", "expected"),
        [
            ("port from acm\u0435/secret", "names an owner/name not in product.repos"),
            ("port from acme/\u0455ecret", "names an owner/name not in product.repos"),
            (
                "device 1b4e28ba\u20132fa1\u201311d2\u2013883f\u20130016d3cca427",
                "contains a UUID-shaped identifier",
            ),
            (
                "device 1b4e28ba\u20102fa1\u201011d2\u2010883f\u20100016d3cca427",
                "contains a UUID-shaped identifier",
            ),
        ],
    )
    def test_confusables_and_dashes_are_folded_before_scanning(
        self, title: str, expected: str
    ) -> None:
        doc = _document()
        doc["work_units"][0]["title"] = title
        assert build_record_violations(doc) == [f"work_units[0].title: {expected}"]

    def test_excluded_name_with_a_cyrillic_letter_is_found(self) -> None:
        from app.services.build_record_allowlist import names_token

        assert names_token("sync \u0455ecret-billing schema", "secret-billing")


# ===========================================================================
# Seventh review — regression tests from rev7/t/tests/test_rev7.py
# ===========================================================================


def _secondary_limit() -> httpx.Response:
    """GitHub's SECONDARY rate limit: a 403 with budget remaining, no
    Retry-After, only a message."""
    return httpx.Response(
        403,
        headers={"x-ratelimit-remaining": "4321", "x-ratelimit-reset": "9999999999"},
        json={
            "message": (
                "You have exceeded a secondary rate limit. Please wait a few "
                "minutes before you try again."
            ),
            "documentation_url": (
                "https://docs.github.com/rest/overview/rate-limits-for-the-rest-api"
                "#about-secondary-rate-limits"
            ),
        },
    )


@pytest.mark.asyncio
class TestRev7:
    @staticmethod
    async def _publish(client: httpx.AsyncClient, coord: _Coord, slug: str, repo: str):
        coord.define(TENANT_A, slug, repos=[repo])
        coord.documents[(TENANT_A, slug)]["prs"][0]["repo"] = repo
        r = await client.post(f"/api/v1/build-records/{slug}/publish")
        assert r.status_code == 201, r.text

    async def test_secondary_rate_limit_403_retracts_nothing(
        self,
        client_a: httpx.AsyncClient,
        coord: _Coord,
        async_db_session,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        from app.jobs.build_record_reconcile import recheck_visibility

        for slug in ("s-1", "s-2", "s-3", "s-4", "s-5"):
            await self._publish(client_a, coord, slug, f"tenant-a/{slug}")
        _real_github(monkeypatch, lambda _: _secondary_limit())
        tick = await recheck_visibility(async_db_session, budget=8)
        assert tick.retracted == []
        assert tick.stopped == "rate_limited"
        assert tick.calls == 1
        assert (
            await client_a.get("/api/v1/public/build-records/s-1")
        ).status_code == 200

    @pytest.mark.parametrize(
        ("body", "expected"),
        [
            ({"message": "Repository access blocked"}, "not_public"),
            ({"message": "x", "block": {"reason": "tos"}}, "not_public"),
            ({"message": "API rate limit exceeded for 1.2.3.4."}, "rate_limited"),
            ({"message": "Resource not accessible"}, "rate_limited"),
            (None, "rate_limited"),  # no JSON body at all
        ],
    )
    async def test_a_403_is_classified_by_its_body(
        self, body: Any, expected: str
    ) -> None:
        from app.services.github_repo_visibility import Visibility, check_repo

        def handler(_: httpx.Request) -> httpx.Response:
            if body is None:
                return httpx.Response(403, text="forbidden")
            return httpx.Response(
                403, headers={"x-ratelimit-remaining": "50"}, json=body
            )

        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as c:
            answer = await check_repo("acme/thing", client=c)
        if expected == "not_public":
            assert answer.visibility is Visibility.NOT_PUBLIC
            assert not answer.rate_limited
        else:
            assert answer.visibility is Visibility.UNKNOWN
            assert answer.rate_limited

    async def test_a_lone_unanswerable_slug_is_retracted_once_stale(
        self,
        client_a: httpx.AsyncClient,
        coord: _Coord,
        async_db_session,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        from app.jobs.build_record_reconcile import (
            VISIBILITY_UNREACHED_STALE_AFTER,
            recheck_visibility,
        )

        await self._publish(client_a, coord, "x-a", "tenant-a/flaky")
        _real_github(
            monkeypatch, lambda _: httpx.Response(502, json={"message": "Server Error"})
        )
        # Alone, it is never BLAMED (nothing else answers) — rev7's finding.
        for _ in range(10):
            tick = await recheck_visibility(async_db_session, budget=8)
            assert tick.retracted == [] and tick.gave_up == []

        # Never blamed, so the 24 h run ceiling never applies to it; the 72 h
        # staleness clock does (it never had a complete answer, and its
        # publish is that old).
        long_ago = (
            datetime.now(UTC) - VISIBILITY_UNREACHED_STALE_AFTER - timedelta(minutes=5)
        )
        await async_db_session.execute(
            update(BuildRecordSnapshot)
            .where(BuildRecordSnapshot.public_slug == "x-a")
            .values(published_at=long_ago)
        )
        await async_db_session.execute(
            update(BuildRecordPublicSlug)
            .where(BuildRecordPublicSlug.public_slug == "x-a")
            .values(last_visibility_check_at=long_ago)
        )
        tick = await recheck_visibility(async_db_session, budget=8)
        assert tick.retracted == ["x-a"] and tick.stale == ["x-a"]
        assert (
            await client_a.get("/api/v1/public/build-records/x-a")
        ).status_code == 404

    async def test_a_recent_complete_answer_keeps_an_old_publish_live(
        self,
        client_a: httpx.AsyncClient,
        coord: _Coord,
        async_db_session,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        from app.jobs.build_record_reconcile import (
            VISIBILITY_STALE_AFTER,
            recheck_visibility,
        )

        await self._publish(client_a, coord, "old-but-checked", "tenant-a/fine")
        long_ago = datetime.now(UTC) - VISIBILITY_STALE_AFTER - timedelta(hours=1)
        await async_db_session.execute(
            update(BuildRecordSnapshot)
            .where(BuildRecordSnapshot.public_slug == "old-but-checked")
            .values(published_at=long_ago)
        )
        _real_github(monkeypatch, _public)
        tick = await recheck_visibility(async_db_session, budget=8)
        assert tick.retracted == [] and tick.completed == ["old-but-checked"]


# ===========================================================================
# Eighth review — regression tests from rev8/t/tests/test_rev8.py
# ===========================================================================


@pytest.mark.asyncio
class TestRev8:
    @staticmethod
    async def _publish(client: httpx.AsyncClient, coord: _Coord, slug: str, repo: str):
        coord.define(TENANT_A, slug, repos=[repo])
        coord.documents[(TENANT_A, slug)]["prs"][0]["repo"] = repo
        r = await client.post(f"/api/v1/build-records/{slug}/publish")
        assert r.status_code == 201, r.text

    @staticmethod
    async def _age(db: AsyncSession, by: timedelta, slugs: list[str] | None = None):
        snap = update(BuildRecordSnapshot)
        own = update(BuildRecordPublicSlug)
        if slugs is not None:
            snap = snap.where(BuildRecordSnapshot.public_slug.in_(slugs))
            own = own.where(BuildRecordPublicSlug.public_slug.in_(slugs))
        when = datetime.now(UTC) - by
        await db.execute(snap.values(published_at=when))
        await db.execute(
            own.values(last_visibility_check_at=when, last_visibility_attempt_at=when)
        )

    async def test_resume_after_a_pause_retracts_nothing_github_calls_public(
        self,
        client_a: httpx.AsyncClient,
        coord: _Coord,
        async_db_session,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        from app.jobs.build_record_reconcile import recheck_visibility

        slugs = [f"p-{i:02d}" for i in range(20)]
        for slug in slugs:
            await self._publish(client_a, coord, slug, f"tenant-a/r{slug}")
        await self._age(async_db_session, timedelta(hours=25))  # paused 25 h
        _real_github(monkeypatch, _public)
        tick = await recheck_visibility(async_db_session, budget=8)
        assert len(tick.completed) == 8
        assert tick.stale == [] and tick.retracted == []
        for slug in slugs:
            assert (
                await client_a.get(f"/api/v1/public/build-records/{slug}")
            ).status_code == 200

    async def test_a_sub_24h_outage_retracts_nothing_after_recovery(
        self,
        client_a: httpx.AsyncClient,
        coord: _Coord,
        async_db_session,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        from app.jobs.build_record_reconcile import recheck_visibility

        slugs = [f"o-{i:02d}" for i in range(20)]
        for slug in slugs:
            await self._publish(client_a, coord, slug, f"tenant-a/r{slug}")
        await self._age(async_db_session, timedelta(hours=23, minutes=50))
        _real_github(monkeypatch, _public)
        stale: list[str] = []
        for _ in range(3):
            tick = await recheck_visibility(async_db_session, budget=8)
            stale += tick.stale
            # Time passes: shift every stored timestamp back 10 minutes.
            ten = timedelta(minutes=10)
            await async_db_session.execute(
                update(BuildRecordSnapshot).values(
                    published_at=BuildRecordSnapshot.published_at - ten
                )
            )
            await async_db_session.execute(
                update(BuildRecordPublicSlug).values(
                    last_visibility_check_at=(
                        BuildRecordPublicSlug.last_visibility_check_at - ten
                    ),
                    last_visibility_attempt_at=(
                        BuildRecordPublicSlug.last_visibility_attempt_at - ten
                    ),
                )
            )
        assert stale == []

    async def test_the_queue_is_stalest_first(
        self,
        client_a: httpx.AsyncClient,
        coord: _Coord,
        async_db_session,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        from app.jobs.build_record_reconcile import recheck_visibility

        await self._publish(client_a, coord, "a-fresh", "tenant-a/fresh")
        await self._publish(client_a, coord, "b-stalest", "tenant-b/stalest")
        await self._age(async_db_session, timedelta(hours=1), ["a-fresh"])
        await self._age(async_db_session, timedelta(hours=30), ["b-stalest"])
        _real_github(monkeypatch, _public)
        tick = await recheck_visibility(async_db_session, budget=1)
        assert tick.completed == ["b-stalest"]

    async def test_an_unreached_page_waits_for_the_72h_ceiling(
        self,
        client_a: httpx.AsyncClient,
        coord: _Coord,
        async_db_session,
    ) -> None:
        from app.jobs.build_record_reconcile import recheck_visibility
        from app.services import github_rate_budget
        from app.services.github_repo_visibility import Visibility, VisibilityAnswer

        await self._publish(client_a, coord, "u-25h", "tenant-a/u25")
        await self._publish(client_a, coord, "u-73h", "tenant-a/u73")
        await self._age(async_db_session, timedelta(hours=25), ["u-25h"])
        await self._age(async_db_session, timedelta(hours=73), ["u-73h"])
        # Budget held: the tick reaches no page at all.
        await github_rate_budget.record(
            async_db_session,
            [
                VisibilityAnswer(
                    Visibility.PUBLIC, 5, datetime.now(UTC) + timedelta(minutes=30)
                )
            ],
        )
        tick = await recheck_visibility(async_db_session)
        assert tick.stopped == "budget_reserved"
        assert tick.stale == ["u-73h"]

    async def test_anonymous_throughput_is_thirty_per_hour(
        self,
        client_a: httpx.AsyncClient,
        coord: _Coord,
        async_db_session,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        from app.jobs.build_record_reconcile import (
            recheck_throughput_per_hour,
            recheck_visibility,
        )

        assert recheck_throughput_per_hour(token=False) == 30
        assert recheck_throughput_per_hour(token=True) == 480
        for i in range(40):
            await self._publish(client_a, coord, f"q-{i:02d}", f"tenant-a/q{i}")
        state = {"remaining": 60}
        reset = str(int(time.time()) + 3600)

        def anonymous(name: str) -> httpx.Response:
            state["remaining"] -= 1
            return httpx.Response(
                200,
                headers={
                    "x-ratelimit-remaining": str(state["remaining"]),
                    "x-ratelimit-reset": reset,
                },
                json={"private": False, "full_name": name},
            )

        _real_github(monkeypatch, anonymous)
        calls = 0
        for _ in range(6):  # one hour at the */10 cadence
            calls += (await recheck_visibility(async_db_session)).calls
        assert calls == 30  # the documented ~720/day ceiling, not 48/hour

    async def test_a_capacity_shortfall_is_warned_and_reported(
        self,
        client_a: httpx.AsyncClient,
        coord: _Coord,
        async_db_session,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        from app.jobs import build_record_reconcile as job

        for i in range(3):
            await self._publish(client_a, coord, f"c-{i}", f"tenant-a/c{i}")
        _real_github(monkeypatch, _public)
        tick = await job.recheck_visibility(async_db_session)
        assert tick.capacity_shortfall is None
        monkeypatch.setattr(job, "recheck_throughput_per_hour", lambda **_: 0)
        tick = await job.recheck_visibility(async_db_session)
        assert tick.capacity_shortfall == {
            "live_repos": 3,
            "throughput_per_hour": 0,
            "cycle_hours": None,
            "mode": "anonymous",
        }


# ===========================================================================
# Ninth review — regression tests from rev9/t/tests/test_rev9.py
# ===========================================================================


@pytest.mark.asyncio
class TestRev9:
    N = 100  # pages, clocks spread over a 26.7 h cycle (rev9's 800 at 30/h)

    @staticmethod
    async def _seed(
        client: httpx.AsyncClient, coord: _Coord, db: AsyncSession, n: int
    ) -> list[str]:
        """Publish ONE page through the real route, then clone its validated
        document to ``n`` pages whose clocks are spread evenly over a 26.7 h
        check cycle (p-0000 stalest) — the steady state rev9 measured."""
        from app.api.v1.endpoints.build_records import canonical_sha256

        coord.define(TENANT_A, "seed", repos=["tenant-a/seed"])
        coord.documents[(TENANT_A, "seed")]["prs"][0]["repo"] = "tenant-a/seed"
        r = await client.post("/api/v1/build-records/seed/publish")
        assert r.status_code == 201, r.text
        base = (await db.execute(select(BuildRecordSnapshot))).scalar_one()
        now = datetime.now(UTC)
        cycle = timedelta(hours=800 / 30)
        slugs = []
        for i in range(n):
            slug = f"p-{i:04d}"
            slugs.append(slug)
            doc = copy.deepcopy(base.document)
            doc["product"]["slug"] = slug
            doc["product"]["repos"] = [f"tenant-a/r{i}"]
            doc["prs"][0]["repo"] = f"tenant-a/r{i}"
            clock = now - cycle * (1 - i / n)
            db.add(
                BuildRecordPublicSlug(
                    public_slug=slug,
                    tenant_id=TENANT_A,
                    last_visibility_check_at=clock,
                    last_visibility_attempt_at=clock,
                )
            )
            db.add(
                BuildRecordSnapshot(
                    tenant_id=TENANT_A,
                    public_slug=slug,
                    version=1,
                    document=doc,
                    content_sha256=canonical_sha256(doc),
                    generated_at=base.generated_at,
                    published_at=now - timedelta(days=10),
                )
            )
        await db.execute(
            update(BuildRecordPublicSlug)
            .where(BuildRecordPublicSlug.public_slug == "seed")
            .values(unpublished_at=now)
        )
        await db.flush()
        return slugs

    @staticmethod
    async def _clear_budget(db: AsyncSession) -> None:
        from app.models.build_record import GithubRateBudget

        await db.execute(GithubRateBudget.__table__.delete())

    async def test_blips_and_a_one_hour_incident_retract_nothing(
        self,
        client_a: httpx.AsyncClient,
        coord: _Coord,
        async_db_session,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        from app.jobs.build_record_reconcile import recheck_visibility

        await self._seed(client_a, coord, async_db_session, self.N)
        stale: list[str] = []

        def blip(_: str) -> httpx.Response:
            raise httpx.ConnectError("blip")

        _real_github(monkeypatch, blip)  # (1) one transport blip
        stale += (await recheck_visibility(async_db_session)).stale

        incident = httpx.Response(503, headers={"x-ratelimit-remaining": "50"})
        _real_github(monkeypatch, lambda _: incident)  # (2) one 503 tick
        await self._clear_budget(async_db_session)
        stale += (await recheck_visibility(async_db_session)).stale

        first = {"name": None}

        def one_502(name: str) -> httpx.Response:  # (3) one blamed 502
            if first["name"] is None:
                first["name"] = name
                return httpx.Response(502)
            return _public(name)

        _real_github(monkeypatch, one_502)
        await self._clear_budget(async_db_session)
        tick = await recheck_visibility(async_db_session)
        assert len(tick.gave_up) == 1  # blamed, but its run just started
        stale += tick.stale

        _real_github(monkeypatch, lambda _: incident)  # (4) a 1-hour incident
        for _ in range(6):
            await self._clear_budget(async_db_session)
            stale += (await recheck_visibility(async_db_session)).stale
        assert stale == []

    async def test_a_blamed_run_older_than_24h_is_retracted(
        self,
        client_a: httpx.AsyncClient,
        coord: _Coord,
        async_db_session,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        from app.jobs.build_record_reconcile import recheck_visibility

        slugs = await self._seed(client_a, coord, async_db_session, 4)
        # p-0000 has been failing to answer for 25 h (its run began then).
        await async_db_session.execute(
            update(BuildRecordPublicSlug)
            .where(BuildRecordPublicSlug.public_slug == slugs[0])
            .values(first_unanswered_attempt_at=datetime.now(UTC) - timedelta(hours=25))
        )

        def github(name: str) -> httpx.Response:
            if name == "tenant-a/r0":
                return httpx.Response(502)
            return _public(name)

        _real_github(monkeypatch, github)
        tick = await recheck_visibility(async_db_session)
        assert tick.gave_up == [slugs[0]]  # blamed: the others answered
        assert tick.stale == [slugs[0]]

    async def test_an_unblamed_run_older_than_24h_is_not_retracted(
        self,
        client_a: httpx.AsyncClient,
        coord: _Coord,
        async_db_session,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        from app.jobs.build_record_reconcile import recheck_visibility

        slugs = await self._seed(client_a, coord, async_db_session, 4)
        await async_db_session.execute(
            update(BuildRecordPublicSlug).values(
                first_unanswered_attempt_at=datetime.now(UTC) - timedelta(hours=25)
            )
        )
        _real_github(monkeypatch, lambda _: httpx.Response(503))
        tick = await recheck_visibility(async_db_session)
        assert tick.gave_up == [] and tick.stale == []
        assert slugs

    async def test_a_complete_answer_clears_the_run(
        self,
        client_a: httpx.AsyncClient,
        coord: _Coord,
        async_db_session,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        from app.jobs.build_record_reconcile import recheck_visibility

        slugs = await self._seed(client_a, coord, async_db_session, 2)
        await async_db_session.execute(
            update(BuildRecordPublicSlug).values(
                first_unanswered_attempt_at=datetime.now(UTC) - timedelta(hours=2)
            )
        )
        _real_github(monkeypatch, _public)
        await recheck_visibility(async_db_session)
        rows = (
            (
                await async_db_session.execute(
                    select(BuildRecordPublicSlug)
                    .where(BuildRecordPublicSlug.public_slug.in_(slugs))
                    .execution_options(populate_existing=True)
                )
            )
            .scalars()
            .all()
        )
        assert all(r.first_unanswered_attempt_at is None for r in rows)

    async def test_the_capacity_warning_fires_past_a_24h_cycle(
        self,
        client_a: httpx.AsyncClient,
        coord: _Coord,
        async_db_session,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        from app.jobs import build_record_reconcile as job

        await self._seed(client_a, coord, async_db_session, 3)
        _real_github(monkeypatch, _public)
        # 3 repos at 1/hour = a 3 h cycle: no warning.
        monkeypatch.setattr(job, "recheck_throughput_per_hour", lambda **_: 1)
        assert (
            await job.recheck_visibility(async_db_session)
        ).capacity_shortfall is None
        # Same 3 h cycle against a 2 h warning threshold: the warning fires.
        monkeypatch.setattr(job, "VISIBILITY_CYCLE_WARN_AFTER", timedelta(hours=2))
        shortfall = (await job.recheck_visibility(async_db_session)).capacity_shortfall
        assert shortfall is not None and shortfall["cycle_hours"] == 3.0

    async def test_the_tick_stops_starting_calls_at_its_deadline(
        self,
        client_a: httpx.AsyncClient,
        coord: _Coord,
        async_db_session,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        from app.jobs import build_record_reconcile as job

        await self._seed(client_a, coord, async_db_session, 3)
        asked = _real_github(monkeypatch, _public)
        monkeypatch.setattr(job, "VISIBILITY_TICK_DEADLINE_SECONDS", -1.0)
        tick = await job.recheck_visibility(async_db_session)
        assert tick.stopped == "deadline" and tick.calls == 0 and asked == []


# ===========================================================================
# Tenth review — regression tests from rev10/t/tests/test_rev10*.py
# ===========================================================================


@pytest.mark.asyncio
class TestRev10:
    @staticmethod
    async def _publish(
        client: httpx.AsyncClient, coord: _Coord, slug: str, repo: str, **body: Any
    ) -> None:
        if not any(p["slug"] == slug for p in coord.products.get(TENANT_A, [])):
            coord.define(TENANT_A, slug, repos=[repo])
            coord.documents[(TENANT_A, slug)]["prs"][0]["repo"] = repo
        r = await client.post(
            f"/api/v1/build-records/{slug}/publish", json=body or None
        )
        assert r.status_code == 201, r.text

    @staticmethod
    async def _row(db: AsyncSession, slug: str) -> BuildRecordPublicSlug:
        return (
            await db.execute(
                select(BuildRecordPublicSlug)
                .where(BuildRecordPublicSlug.public_slug == slug)
                .execution_options(populate_existing=True)
            )
        ).scalar_one()

    @staticmethod
    async def _to_head(db: AsyncSession, slug: str) -> None:
        """Put ``slug`` at the head of the stalest-first queue."""
        from app.models.build_record import GithubRateBudget

        await db.execute(
            update(BuildRecordPublicSlug)
            .where(BuildRecordPublicSlug.public_slug != slug)
            .values(last_visibility_attempt_at=datetime.now(UTC) + timedelta(hours=1))
        )
        await db.execute(
            update(BuildRecordPublicSlug)
            .where(BuildRecordPublicSlug.public_slug == slug)
            .values(
                last_visibility_attempt_at=None,
                last_visibility_check_at=datetime.now(UTC) - timedelta(hours=2),
            )
        )
        await db.execute(GithubRateBudget.__table__.delete())

    async def test_reactivation_resets_the_run_so_one_blip_does_not_retract(
        self,
        client_a: httpx.AsyncClient,
        coord: _Coord,
        async_db_session,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        from app.jobs.build_record_reconcile import recheck_visibility

        for i in range(4):
            await self._publish(client_a, coord, f"p{i}", f"tenant-a/r{i}")
        # A blamed blip on p0 starts its run; it is then unpublished and, a
        # week later, reactivated (the publish re-confirms GitHub PUBLIC).
        _real_github(
            monkeypatch,
            lambda n: httpx.Response(502) if n == "tenant-a/r0" else _public(n),
        )
        assert "p0" in (await recheck_visibility(async_db_session)).gave_up
        assert (
            await client_a.delete("/api/v1/build-records/p0/publish")
        ).status_code == 200
        await async_db_session.execute(
            update(BuildRecordPublicSlug)
            .where(BuildRecordPublicSlug.public_slug == "p0")
            .values(first_unanswered_attempt_at=datetime.now(UTC) - timedelta(days=7))
        )
        _real_github(monkeypatch, _public)
        coord.documents[(TENANT_A, "p0")]["generated_at"] = _now_rfc3339()
        await self._publish(client_a, coord, "p0", "tenant-a/r0", reactivate=True)
        row = await self._row(async_db_session, "p0")
        assert row.first_unanswered_attempt_at is None
        assert row.visibility_unknown_attempts == 0
        assert row.last_visibility_check_at is not None

        await self._to_head(async_db_session, "p0")
        _real_github(
            monkeypatch,
            lambda n: httpx.Response(502) if n == "tenant-a/r0" else _public(n),
        )
        tick = await recheck_visibility(async_db_session)
        assert tick.gave_up == ["p0"] and tick.stale == []
        assert (
            await client_a.get("/api/v1/public/build-records/p0")
        ).status_code == 200

    async def test_a_transport_blip_does_not_start_the_24h_clock(
        self,
        client_a: httpx.AsyncClient,
        coord: _Coord,
        async_db_session,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        from app.jobs.build_record_reconcile import recheck_visibility

        for i in range(4):
            await self._publish(client_a, coord, f"q{i}", f"tenant-a/s{i}")
        await self._to_head(async_db_session, "q0")

        def boom(_: str) -> httpx.Response:
            raise httpx.ConnectError("blip")

        _real_github(monkeypatch, boom)
        tick = await recheck_visibility(async_db_session)
        assert tick.stopped == "transport"
        assert (
            await self._row(async_db_session, "q0")
        ).first_unanswered_attempt_at is None

        # An UNBLAMED give-up does not start it either.
        await self._to_head(async_db_session, "q0")
        _real_github(monkeypatch, lambda _: httpx.Response(503))
        assert (await recheck_visibility(async_db_session)).unblamed
        assert (
            await self._row(async_db_session, "q0")
        ).first_unanswered_attempt_at is None

        # Only a BLAMED one does — and the run it starts is fresh, not stale.
        await self._to_head(async_db_session, "q0")
        _real_github(
            monkeypatch,
            lambda n: httpx.Response(502) if n == "tenant-a/s0" else _public(n),
        )
        tick = await recheck_visibility(async_db_session)
        assert tick.gave_up == ["q0"] and tick.stale == []
        assert (
            await self._row(async_db_session, "q0")
        ).first_unanswered_attempt_at is not None


@pytest.mark.asyncio
async def test_a_slow_tick_never_blocks_an_unpublish(
    test_engine, coord: _Coord, monkeypatch: pytest.MonkeyPatch
) -> None:
    """rev10_lock: the tick must hold no row lock while awaiting GitHub."""
    from sqlalchemy import delete
    from sqlalchemy.ext.asyncio import async_sessionmaker

    from app.api.v1.endpoints.build_records import canonical_sha256
    from app.jobs.build_record_reconcile import recheck_visibility
    from app.models.build_record import GithubRateBudget
    from app.services import github_repo_visibility

    slugs = ["lock-rv-0", "lock-rv-1", "lock-rv-2"]
    maker = async_sessionmaker(test_engine, expire_on_commit=False)
    now = datetime.now(UTC)
    async with maker() as s:
        await s.execute(GithubRateBudget.__table__.delete())
        for i, slug in enumerate(slugs):
            doc = _document(slug)
            doc["product"]["repos"] = [f"tenant-a/l{i}"]
            doc["prs"][0]["repo"] = f"tenant-a/l{i}"
            s.add(
                BuildRecordPublicSlug(
                    public_slug=slug,
                    tenant_id=TENANT_A,
                    last_visibility_check_at=now - timedelta(hours=10 - i),
                )
            )
            s.add(
                BuildRecordSnapshot(
                    tenant_id=TENANT_A,
                    public_slug=slug,
                    version=1,
                    document=doc,
                    content_sha256=canonical_sha256(doc),
                    generated_at=now,
                )
            )
        await s.commit()
    try:

        async def slow(request: httpx.Request) -> httpx.Response:
            name = request.url.path.removeprefix("/repos/")
            if name != "tenant-a/l0":
                await asyncio.sleep(3)  # GitHub slow for the later repos
            return _public(name)

        _real_github(monkeypatch, _public)
        monkeypatch.setattr(
            github_repo_visibility,
            "_client_factory",
            lambda: httpx.AsyncClient(transport=httpx.MockTransport(slow)),
        )

        async def tick() -> Any:
            async with maker() as s:
                return await recheck_visibility(s)

        task = asyncio.create_task(tick())
        await asyncio.sleep(1.0)  # lock-rv-0 answered; tick awaits GitHub now
        async with maker() as s2:
            async with _client(_build_app(s2, TENANT_A)) as c:
                begun = time.monotonic()
                r = await c.delete(f"/api/v1/build-records/{slugs[0]}/publish")
                waited = time.monotonic() - begun
                assert r.status_code == 200, r.text
                assert waited < 2.0, waited
                gone = await c.get(f"/api/v1/public/build-records/{slugs[0]}")
                assert gone.status_code == 404
        result = await task
        assert slugs[0] in result.completed
        async with maker() as s3:
            row = (
                await s3.execute(
                    select(BuildRecordPublicSlug).where(
                        BuildRecordPublicSlug.public_slug == slugs[0]
                    )
                )
            ).scalar_one()
            assert row.unpublished_at is not None  # the unpublish stuck
    finally:
        async with maker() as s:
            await s.execute(
                delete(BuildRecordSnapshot).where(
                    BuildRecordSnapshot.public_slug.in_(slugs)
                )
            )
            await s.execute(
                delete(BuildRecordPublicSlug).where(
                    BuildRecordPublicSlug.public_slug.in_(slugs)
                )
            )
            await s.execute(GithubRateBudget.__table__.delete())
            await s.commit()


# ===========================================================================
# Eleventh review — regression tests from rev11/t/tests/test_rev11.py
# (inverted). Real committed sessions: the races are between transactions.
# ===========================================================================


class _Rev11:
    def __init__(self, maker: Any, coord: _Coord) -> None:
        self.maker = maker
        self.coord = coord

    def define(self, slug: str, repos: list[str]) -> None:
        self.coord.products[TENANT_A] = [
            p for p in self.coord.products.get(TENANT_A, []) if p["slug"] != slug
        ]
        self.coord.define(TENANT_A, slug, repos=repos)
        self.coord.documents[(TENANT_A, slug)]["prs"][0]["repo"] = repos[0]

    async def publish(self, slug: str) -> None:
        async with self.maker() as s:
            async with _client(_build_app(s, TENANT_A)) as c:
                r = await c.post(f"/api/v1/build-records/{slug}/publish")
        assert r.status_code == 201, r.text

    async def public_status(self, slug: str) -> int:
        async with self.maker() as s:
            async with _client(_build_app(s, TENANT_A)) as c:
                return (await c.get(f"/api/v1/public/build-records/{slug}")).status_code

    async def row(self, slug: str) -> BuildRecordPublicSlug:
        async with self.maker() as s:
            return (
                await s.execute(
                    select(BuildRecordPublicSlug).where(
                        BuildRecordPublicSlug.public_slug == slug
                    )
                )
            ).scalar_one()

    async def tick(self, **kwargs: Any) -> Any:
        from app.jobs.build_record_reconcile import recheck_visibility

        async with self.maker() as s:
            return await recheck_visibility(s, **kwargs)


@pytest_asyncio.fixture()
async def rev11(committed: Any, coord: _Coord):
    from app.models.build_record import BuildRecordPendingNotPublic, GithubRateBudget

    async with committed() as s:
        await s.execute(GithubRateBudget.__table__.delete())
        await s.commit()
    yield _Rev11(committed, coord)
    async with committed() as s:
        await s.execute(
            BuildRecordPendingNotPublic.__table__.delete().where(
                BuildRecordPendingNotPublic.public_slug.like("lock-%")
            )
        )
        await s.execute(GithubRateBudget.__table__.delete())
        await s.commit()


@pytest.mark.asyncio
class TestRev11:
    async def test_a_republish_mid_tick_does_not_inherit_the_old_offset(
        self, rev11: _Rev11, coord: _Coord, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from app.services import github_repo_visibility as gv
        from app.services.github_repo_visibility import Visibility

        slug = "lock-rv-offset"
        rev11.define(slug, [f"tenant-a/k{i}" for i in range(10)])
        await rev11.publish(slug)  # v1 = k0..k9
        fake = gv.check_repo
        seen = {"n": 0}

        async def check(repo: str, **kw: Any) -> Any:
            if repo.startswith("tenant-a/k"):
                seen["n"] += 1
                if seen["n"] == 2:  # the owner publishes v2 mid-tick
                    rev11.define(slug, [f"tenant-a/a{i}" for i in range(10)])
                    await rev11.publish(slug)
            return await fake(repo, **kw)

        monkeypatch.setattr(gv, "check_repo", check)
        await rev11.tick(budget=4)
        assert (await rev11.row(slug)).visibility_check_offset == 0  # v2's reset kept

        # a0 goes private after v2's publish confirmed it: the next tick must
        # start v2 from its first repo, so a0 is asked and the page retracted.
        monkeypatch.setattr(gv, "check_repo", fake)
        coord.visibility["tenant-a/a0"] = Visibility.NOT_PUBLIC
        coord.github_calls.clear()
        tick = await rev11.tick(budget=80)
        assert "tenant-a/a0" in coord.github_calls
        assert tick.retracted == [slug]
        assert await rev11.public_status(slug) == 404

    async def test_an_old_versions_private_repo_does_not_retract_the_new_version(
        self, rev11: _Rev11, coord: _Coord, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from app.services import github_repo_visibility as gv
        from app.services.github_repo_visibility import Visibility

        slug = "lock-rv-wrong"
        rev11.define(slug, ["tenant-a/k0", "tenant-a/k1"])
        await rev11.publish(slug)  # v1 = k0, k1
        fake = gv.check_repo
        fired = {"done": False}

        async def check(repo: str, **kw: Any) -> Any:
            if repo == "tenant-a/k1" and not fired["done"]:
                fired["done"] = True
                # The owner drops k1 and publishes v2 (= a0 only) while the
                # tick waits on GitHub for k1, which is now private.
                rev11.define(slug, ["tenant-a/a0"])
                await rev11.publish(slug)
                coord.visibility["tenant-a/k1"] = Visibility.NOT_PUBLIC
            return await fake(repo, **kw)

        monkeypatch.setattr(gv, "check_repo", check)
        tick = await rev11.tick(budget=8)
        assert tick.retracted == []
        assert (await rev11.row(slug)).unpublished_at is None
        assert await rev11.public_status(slug) == 200

    async def test_a_not_public_verdict_blocked_by_a_lock_is_deferred_not_dropped(
        self, rev11: _Rev11, coord: _Coord, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from app.jobs import build_record_reconcile as job
        from app.models.build_record import BuildRecordPendingNotPublic
        from app.services import github_repo_visibility as gv
        from app.services.github_repo_visibility import Visibility

        slug = "lock-rv-skip"
        rev11.define(slug, ["tenant-a/p0"])
        await rev11.publish(slug)
        coord.visibility["tenant-a/p0"] = Visibility.NOT_PUBLIC
        monkeypatch.setattr(job, "NOT_PUBLIC_LOCK_TIMEOUT_SECONDS", 0.3)
        holder = rev11.maker()
        fake = gv.check_repo

        async def check(repo: str, **kw: Any) -> Any:
            # A non-retracting holder of the owner row lock (publish's own
            # _store_next_version takes exactly this lock).
            await holder.execute(
                select(BuildRecordPublicSlug)
                .where(BuildRecordPublicSlug.public_slug == slug)
                .with_for_update()
            )
            return await fake(repo, **kw)

        monkeypatch.setattr(gv, "check_repo", check)
        try:
            tick = await rev11.tick(budget=8)
        finally:
            await holder.commit()
            await holder.close()
        assert tick.retracted == [] and tick.deferred == [slug]
        async with rev11.maker() as s:
            pending = (
                (await s.execute(select(BuildRecordPendingNotPublic.public_slug)))
                .scalars()
                .all()
            )
        assert pending == [slug]

        # The lock is released: the next tick applies the deferred verdict first.
        monkeypatch.setattr(gv, "check_repo", fake)
        tick = await rev11.tick(budget=8)
        assert slug in tick.retracted
        assert await rev11.public_status(slug) == 404
        async with rev11.maker() as s:
            assert (
                await s.execute(select(BuildRecordPendingNotPublic.public_slug))
            ).scalars().all() == []


# ===========================================================================
# Twelfth review — regression tests from rev12/t/tests/test_rev12.py
# (inverted)
# ===========================================================================


async def _defer_verdict(
    rev11: _Rev11, coord: _Coord, monkeypatch: pytest.MonkeyPatch, slug: str, repo: str
) -> None:
    """Drive the REAL deferral path: a NOT_PUBLIC verdict whose owner-row lock
    is held by a non-retracting holder through both short attempts."""
    from app.jobs import build_record_reconcile as job
    from app.services import github_repo_visibility as gv
    from app.services.github_repo_visibility import Visibility

    coord.visibility[repo] = Visibility.NOT_PUBLIC
    monkeypatch.setattr(job, "NOT_PUBLIC_LOCK_TIMEOUT_SECONDS", 0.3)
    holder = rev11.maker()
    fake = gv.check_repo

    async def check(r: str, **kw: Any) -> Any:
        await holder.execute(
            select(BuildRecordPublicSlug)
            .where(BuildRecordPublicSlug.public_slug == slug)
            .with_for_update()
        )
        return await fake(r, **kw)

    monkeypatch.setattr(gv, "check_repo", check)
    try:
        tick = await rev11.tick(budget=8)
    finally:
        await holder.commit()
        await holder.close()
        monkeypatch.setattr(gv, "check_repo", fake)
    assert tick.deferred == [slug], tick


async def _pending(rev11: _Rev11) -> list[str]:
    from app.models.build_record import BuildRecordPendingNotPublic

    async with rev11.maker() as s:
        return list(
            (await s.execute(select(BuildRecordPendingNotPublic.repo))).scalars().all()
        )


@pytest.mark.asyncio
class TestRev12:
    async def test_a_held_budget_does_not_postpone_a_deferred_verdict(
        self, rev11: _Rev11, coord: _Coord, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from app.models.build_record import GithubRateBudget

        slug, repo = "lock-r12-reserved", "tenant-a/p0"
        rev11.define(slug, [repo])
        await rev11.publish(slug)
        await _defer_verdict(rev11, coord, monkeypatch, slug, repo)

        # The routine anonymous state for part of every hour: the re-check is
        # at its reserve and the window has not reset.
        async with rev11.maker() as s:
            await s.execute(GithubRateBudget.__table__.delete())
            s.add(
                GithubRateBudget(
                    id=True,
                    remaining=30,
                    reset_at=datetime.now(UTC) + timedelta(minutes=50),
                )
            )
            await s.commit()
        coord.github_calls.clear()
        tick = await rev11.tick()
        assert tick.stopped == "budget_reserved" and coord.github_calls == []
        assert tick.retracted == [slug]
        assert await rev11.public_status(slug) == 404
        assert await _pending(rev11) == []

    async def test_a_republish_supersedes_a_deferred_verdict(
        self, rev11: _Rev11, coord: _Coord, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from app.services.github_repo_visibility import Visibility

        slug, repo = "lock-r12-stale", "tenant-a/q0"
        rev11.define(slug, [repo])
        await rev11.publish(slug)
        await _defer_verdict(rev11, coord, monkeypatch, slug, repo)

        # Before the next tick the owner unpublishes and reactivates; the
        # publish itself asks GitHub, which now says the repo IS public.
        coord.visibility[repo] = Visibility.PUBLIC
        async with rev11.maker() as s:
            async with _client(_build_app(s, TENANT_A)) as c:
                r = await c.delete(f"/api/v1/build-records/{slug}/publish")
                assert r.status_code == 200
        rev11.define(slug, [repo])
        async with rev11.maker() as s:
            async with _client(_build_app(s, TENANT_A)) as c:
                r = await c.post(
                    f"/api/v1/build-records/{slug}/publish", json={"reactivate": True}
                )
        assert r.status_code == 201, r.text

        tick = await rev11.tick(budget=8)
        assert slug not in tick.retracted
        assert (await rev11.row(slug)).unpublished_at is None
        assert await rev11.public_status(slug) == 200
        assert await _pending(rev11) == []  # superseded, dropped
