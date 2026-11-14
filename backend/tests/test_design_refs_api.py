"""The design reference library, end to end against real Postgres.

Plan ``2026-11-13-design-reference-library-stores-described-web-examples-for-any-project-to-query``
Phase 1 (with the Phase 1b store). Every behaviour the phase lists as a test
has one here:

* **Tenancy and tiers** — another tenant's rows are invisible; the public-tier
  read filter returns zero private rows; the anonymous ``/uploads`` mount
  404s the tenant-scoped prefixes.
* **Takedown** — rows and blobs go, a blob another record still references
  survives, the other tier's record of the same domain survives a record
  takedown, judgements go with their target and a principle left below two
  reference sites returns to ``proposed``.
* **Search** — facet-exact first, ``skipped_no_embedding`` said rather than
  faked, personality ranking.
* **Judgements** — score bounds, AI evidence, ``a == b``, unknown dimension,
  re-rating appends, the rater derived from the credential, no aggregate
  column anywhere (the schema walk).
* **Holdout** — split assigned once at the first confirmation and never
  changed (API 409 and the trigger), ±1 of 20% per family, holdout absent from
  every agent-facing read but present in the operator's review read, holdout
  evidence refused, ``include_holdout`` operator-only.
* **Principles** — only the operator approves, two distinct reference sites,
  the counterexample rule under a flagged correlation, only approved
  principles served.
* **Store** — the streaming upload verifies its digest; source copies and
  bundles stream to an operator or a PAIRED device and 403 a bootstrap one;
  capture jobs; the correction log.

Dependencies are overridden at the route boundary (``get_memory_tenant`` with
a principal whose ``actor`` is swappable mid-test, ``get_principle_approver``,
the object store) because resolving real ones needs coord.
"""

from __future__ import annotations

import hashlib
import re
from collections.abc import AsyncIterator
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, get_args
from uuid import UUID, uuid4

import httpx
import pytest
import pytest_asyncio
from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi.testclient import TestClient
from sqlalchemy import func, select, text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.api import deps as api_deps
from app.api.deps import get_async_db
from app.api.v1.endpoints import design_refs as endpoints
from app.api.v1.endpoints.memory import MemoryPrincipal, get_memory_tenant
from app.middleware.error_handler import (
    http_exception_handler,
    validation_exception_handler,
)
from app.middleware.private_uploads import (
    UPLOADS_DENIED_PREFIXES,
    PrefixDenyingStaticFiles,
)
from app.models import design_refs as models
from app.models.design_refs import (
    Blob,
    Capture,
    Correction,
    DesignPrinciple,
    DesignPrincipleEvidence,
    Page,
    PerceptionDimension,
    PerceptionRating,
    PersonalityTrait,
    Site,
    SitePersonality,
    StyleFamily,
)
from app.models.user import User
from app.schemas import design_refs as schemas
from app.services import design_refs as svc
from app.services.storage import LocalBackend, ObjectStorageService

API = "/api/v1/design-refs"

pytestmark = pytest.mark.asyncio


# ═════════════════════════════ harness ═════════════════════════════


async def _user(db: AsyncSession, name: str) -> User:
    user = User(
        email=f"{name}-{uuid4().hex[:8]}@example.com",
        username=f"{name}-{uuid4().hex[:8]}",
        full_name=name.title(),
        is_active=True,
        is_verified=True,
    )
    db.add(user)
    await db.flush()
    return user


async def _seed_vocab(db: AsyncSession) -> None:
    for key, label in models.SEED_STYLE_FAMILIES:
        if await db.get(StyleFamily, key) is None:
            db.add(StyleFamily(key=key, label=label))
    for key, high, low, anchors in models.SEED_PERCEPTION_DIMENSIONS:
        if await db.get(PerceptionDimension, key) is None:
            db.add(
                PerceptionDimension(
                    key=key, pole_high=high, pole_low=low, anchors=dict(anchors)
                )
            )
    for key, description in models.SEED_PERSONALITY_TRAITS:
        if await db.get(PersonalityTrait, key) is None:
            db.add(PersonalityTrait(key=key, description=description))
    await db.flush()


def _storage(root: Path) -> ObjectStorageService:
    storage = ObjectStorageService.__new__(ObjectStorageService)
    storage.backend = LocalBackend(root)
    return storage


class Harness:
    """One tenant's view of the design-refs router. ``actor`` is swappable
    mid-test: ``"device"`` (an agent's credential, the default),
    ``"operator"`` (a human session) or ``"coord_service"``."""

    def __init__(
        self,
        db: AsyncSession,
        tenant: UUID,
        user: User,
        storage: ObjectStorageService,
    ) -> None:
        self.db = db
        self.tenant = tenant
        self.user = user
        self.storage = storage
        self.actor = "device"
        self.device_id = uuid4()
        self.app = FastAPI()
        self.app.add_exception_handler(StarletteHTTPException, http_exception_handler)  # type: ignore[arg-type]
        self.app.add_exception_handler(
            RequestValidationError,
            validation_exception_handler,  # type: ignore[arg-type]
        )

        async def _db() -> AsyncIterator[Any]:
            yield db

        def _principal() -> MemoryPrincipal:
            operator = self.actor == "operator"
            return MemoryPrincipal(
                tenant_id=tenant,
                device_id=None if operator else self.device_id,
                actor=self.actor,
                user_id=self.user.id if operator else None,
            )

        self.app.dependency_overrides[get_async_db] = _db
        self.app.dependency_overrides[get_memory_tenant] = _principal
        self.app.dependency_overrides[endpoints.get_design_refs_storage] = lambda: (
            storage
        )
        self.app.dependency_overrides[endpoints.get_principle_approver] = lambda: (
            endpoints.PrincipleApprover(tenant_id=tenant, user=self.user)
        )
        self.app.include_router(endpoints.router, prefix=API)
        self.http = httpx.AsyncClient(
            transport=httpx.ASGITransport(app=self.app), base_url="http://test"
        )

    # ── requests ──
    async def post(self, path: str, body: Any, *, expect: int | None = None) -> Any:
        resp = await self.http.post(f"{API}{path}", json=body)
        if expect is not None:
            assert resp.status_code == expect, resp.text
        return resp

    async def ok(self, method: str, path: str, **kw: Any) -> Any:
        resp = await self.http.request(method, f"{API}{path}", **kw)
        assert resp.status_code in (200, 201), resp.text
        return resp.json()

    def as_(self, actor: str) -> Harness:
        self.actor = actor
        return self

    # ── fixtures through the API ──
    async def upload(
        self,
        data: bytes,
        *,
        tier: str = "private",
        purpose: str = "record",
        ext: str = ".png",
    ) -> str:
        sha = hashlib.sha256(data).hexdigest()
        ticket = await self.ok(
            "POST",
            "/uploads",
            json={
                "purpose": purpose,
                "tier": tier,
                "sha256": sha,
                "size": len(data),
                "ext": ext,
            },
        )
        if not ticket["already_stored"]:
            assert ticket["method"] == "stream"
            resp = await self.http.put(ticket["stream_path"], content=data)
            assert resp.status_code == 200, resp.text
        return str(ticket["key"])

    async def page(
        self, site_id: Any, url: str | None = None, **kw: Any
    ) -> dict[str, Any]:
        return dict(
            await self.ok(
                "POST",
                "/pages",
                json={
                    "site_id": str(site_id),
                    "url": url or f"https://x.example/{uuid4().hex}",
                    **kw,
                },
            )
        )

    async def describe(
        self, level: str, target_id: Any, body: str, **kw: Any
    ) -> dict[str, Any]:
        return dict(
            await self.ok(
                "POST",
                "/descriptions",
                json={"level": level, "target_id": str(target_id), "body": body, **kw},
            )
        )

    async def rate(
        self, kind: str, target: Any, score: int, **kw: Any
    ) -> httpx.Response:
        body = {
            "target_kind": kind,
            "target_id": str(target),
            "dimension_key": "premium",
            "score": score,
            **kw,
        }
        if self.actor != "operator" and "positive_evidence" not in kw:
            body["positive_evidence"] = [
                {"field_path": "tokens.color.primary", "note": "restrained"}
            ]
        resp: httpx.Response = await self.http.post(f"{API}/ratings", json=body)
        return resp


async def reference_site(
    h: Harness,
    domain: str | None = None,
    *,
    split: str = "reference",
    tier: str = "private",
    family: str = "modern_saas",
    **kw: Any,
) -> Site:
    """A confirmed site with its split set directly (deterministic tests)."""
    site = Site(
        tenant_id=h.tenant,
        tier=tier,
        domain=domain or f"{uuid4().hex[:10]}.example",
        style_family=family,
        context_state="confirmed",
        context_confirmed_at=datetime.now(UTC),
        split=split,
        **kw,
    )
    h.db.add(site)
    await h.db.flush()
    return site


@pytest_asyncio.fixture()
async def operator(async_db_session: AsyncSession) -> User:
    await _seed_vocab(async_db_session)
    return await _user(async_db_session, "operator")


@pytest_asyncio.fixture()
async def a(
    async_db_session: AsyncSession, operator: User, tmp_path: Path
) -> AsyncIterator[Harness]:
    harness = Harness(async_db_session, uuid4(), operator, _storage(tmp_path / "a"))
    async with harness.http:
        yield harness


@pytest_asyncio.fixture()
async def b(
    async_db_session: AsyncSession, operator: User, tmp_path: Path
) -> AsyncIterator[Harness]:
    harness = Harness(async_db_session, uuid4(), operator, _storage(tmp_path / "b"))
    async with harness.http:
        yield harness


# ═════════════════════════════ vocabulary and schema ═════════════════════════════


AGGREGATE_RE = re.compile(r"(overall|grade|avg|average|mean)(_|$)|total_score", re.I)


def _schema_properties(model: type[Any]) -> set[str]:
    found: set[str] = set()

    def walk(node: Any) -> None:
        if isinstance(node, dict):
            for key, value in node.get("properties", {}).items():
                found.add(key)
                walk(value)
            for value in node.values():
                walk(value)
        elif isinstance(node, list):
            for value in node:
                walk(value)

    walk(model.model_json_schema())
    return found


def test_no_aggregate_score_is_stored_or_served() -> None:
    """No column, ORM attribute or response property is an overall score:
    judgements are distributions computed at read time, never a grade."""
    names: set[str] = set()
    for model in models.DESIGN_REFS_MODELS:
        names |= {c.name for c in model.__table__.columns}
        names |= set(model.__mapper__.attrs.keys())
    for name in dir(schemas):
        obj = getattr(schemas, name)
        if (
            isinstance(obj, type)
            and hasattr(obj, "model_json_schema")
            and obj.__module__ == schemas.__name__
        ):
            names |= _schema_properties(obj)
    offending = sorted(n for n in names if AGGREGATE_RE.search(n))
    assert not offending, offending
    # The walk is not vacuous: it saw the read-time distribution's fields.
    assert {"score", "score_median", "score_spread"} <= names


def test_the_closed_vocabularies_agree_with_the_models() -> None:
    pairs = [
        (schemas.Tier, models.TIERS),
        (schemas.ReviewState, models.REVIEW_STATES),
        (schemas.Quality, models.QUALITIES),
        (schemas.PriceTier, models.PRICE_TIERS),
        (schemas.Split, models.SPLITS),
        (schemas.Level, models.DESCRIPTION_LEVELS),
        (schemas.RaterKind, models.RATER_KINDS),
        (schemas.Winner, models.WINNERS),
        (schemas.PrincipleStatus, models.PRINCIPLE_STATUSES),
        (schemas.EvidenceRole, models.EVIDENCE_ROLES),
        (schemas.EvidenceKind, models.EVIDENCE_KINDS),
        (schemas.AssetClass, models.ASSET_CLASSES),
        (schemas.JobScope, models.JOB_SCOPES),
        (schemas.JobSource, models.JOB_SOURCES),
        (schemas.JobState, models.JOB_STATES),
    ]
    for literal, constant in pairs:
        assert get_args(literal) == tuple(constant), (literal, constant)
    assert len(models.SEED_PERCEPTION_DIMENSIONS) == 17
    assert all(
        set(a) == {"1", "4", "7", "10"} for *_r, a in models.SEED_PERCEPTION_DIMENSIONS
    )
    assert {t.schema for m in models.DESIGN_REFS_MODELS for t in [m.__table__]} == {
        "design_refs"
    }


# ═════════════════════════════ tenancy and tiers ═════════════════════════════


class TestTenancy:
    async def test_another_tenant_sees_nothing(self, a: Harness, b: Harness) -> None:
        site = await reference_site(a, "acme.example")
        page = await a.page(site.id)
        await a.describe("page", page["id"], "A calm hero with generous whitespace")

        assert (await b.http.get(f"{API}/sites/{site.id}")).status_code == 404
        assert (await b.http.get(f"{API}/pages/{page['id']}")).status_code == 404
        assert await b.ok("GET", "/sites") == []
        found = await b.ok(
            "POST", "/search", json={"level": "page", "text": "calm hero"}
        )
        assert found["results"] == []
        # ...while the owner finds it.
        mine = await a.ok(
            "POST", "/search", json={"level": "page", "text": "calm hero"}
        )
        assert [r["target_id"] for r in mine["results"]] == [page["id"]]
        # And B cannot hang a page on A's site.
        resp = await b.post(
            "/pages", {"site_id": str(site.id), "url": "https://acme.example/x"}
        )
        assert resp.status_code == 404

    async def test_the_public_filter_returns_zero_private_rows(
        self, a: Harness
    ) -> None:
        private = await reference_site(a, "p.example", tier="private")
        public = await reference_site(a, "p.example", tier="public")
        await a.page(private.id, "https://p.example/a")
        await a.page(public.id, "https://p.example/b")
        rejected = await reference_site(a, "r.example", tier="public")
        rejected.review_state = "rejected"
        await a.db.flush()

        sites = (
            (
                await a.db.execute(
                    svc.public_tier_select(Site).where(Site.tenant_id == a.tenant)
                )
            )
            .scalars()
            .all()
        )
        assert [s.id for s in sites] == [public.id]
        pages = (
            (
                await a.db.execute(
                    svc.apply_public_tier(
                        select(Page).where(Page.tenant_id == a.tenant), Page
                    )
                )
            )
            .scalars()
            .all()
        )
        assert pages and all(p.tier == "public" for p in pages)

    async def test_a_page_inherits_its_sites_tier(self, a: Harness) -> None:
        site = await reference_site(a, tier="public")
        assert (await a.page(site.id))["tier"] == "public"


def test_the_uploads_mount_404s_the_tenant_scoped_prefixes(tmp_path: Path) -> None:
    for rel in (
        "design-refs/private/x.png",
        "image-assets/t/sha256/ab/y.png",
        "avatars/me.png",
    ):
        target = tmp_path / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(b"bytes")
    app = FastAPI()
    app.mount(
        "/uploads",
        PrefixDenyingStaticFiles(
            directory=str(tmp_path), denied_prefixes=UPLOADS_DENIED_PREFIXES
        ),
    )
    client = TestClient(app)
    assert client.get("/uploads/avatars/me.png").status_code == 200
    for path in (
        "/uploads/design-refs/private/x.png",
        "/uploads/image-assets/t/sha256/ab/y.png",
        "/uploads/DESIGN-REFS/private/x.png",
        "/uploads/avatars/../design-refs/private/x.png",
        "/uploads/./design-refs/private/x.png",
    ):
        assert client.get(path).status_code == 404, path


def test_the_real_app_mounts_the_denying_uploads() -> None:
    from app.main import app

    mount = next(r for r in app.routes if getattr(r, "path", None) == "/uploads")
    assert isinstance(mount.app, PrefixDenyingStaticFiles)  # type: ignore[attr-defined]
    assert set(UPLOADS_DENIED_PREFIXES) == {"design-refs", "image-assets"}
    paths = {getattr(r, "path", "") for r in app.routes}
    assert f"{API}/search" in paths and f"{API}/takedown" in paths
    # Public serving is Phase 6: nothing under design-refs is unauthenticated.
    assert not any(p.startswith("/api/v1/public/design") for p in paths)


# ═════════════════════════════ uploads and source streaming ═════════════════════════════


class TestStore:
    async def test_a_blob_whose_bytes_do_not_match_its_name_is_refused(
        self, a: Harness
    ) -> None:
        sha = hashlib.sha256(b"real").hexdigest()
        resp = await a.http.put(f"{API}/blobs/private/{sha}.png", content=b"forged")
        assert resp.status_code == 422
        assert resp.json()["error"] == "blob_digest_mismatch"
        assert (
            await a.db.get(Blob, svc.blob_key("private", a.tenant, sha, ".png")) is None
        )

    async def test_a_record_names_only_verified_blobs_of_its_own_tier(
        self, a: Harness
    ) -> None:
        site = await reference_site(a)
        page = await a.page(site.id)
        public_key = await a.upload(b"public-shot", tier="public")
        never = svc.blob_key("private", a.tenant, "0" * 64, ".png")
        base = {"page_id": page["id"], "run_id": str(uuid4()), "viewport": "desktop"}
        bad_tier = await a.post("/captures", {**base, "screenshot_key": public_key})
        assert bad_tier.json()["error"] == "blob_key_refused"
        missing = await a.post("/captures", {**base, "screenshot_key": never})
        assert missing.json()["error"] == "blob_not_verified"
        good = await a.upload(b"private-shot")
        await a.post("/captures", {**base, "screenshot_key": good}, expect=201)

    async def _capture_with_source(self, a: Harness) -> tuple[str, bytes]:
        site = await reference_site(a)
        page = await a.page(site.id)
        html = b"<html>" + b"x" * 5000 + b"</html>"
        key = await a.upload(html, purpose="source", ext=".html")
        assert key.startswith("design-refs/private/")
        run = str(uuid4())
        await a.ok(
            "POST",
            "/capture-sources",
            json={
                "page_id": page["id"],
                "run_id": run,
                "viewport": "desktop",
                "parts": {"html": {"key": key, "content_type": "text/html"}},
            },
        )
        bundle = await a.upload(b"PK-bundle", purpose="bundle", ext=".zip")
        await a.ok(
            "POST",
            "/replay-bundles",
            json={"page_id": page["id"], "run_id": run, "bundle_key": bundle},
        )
        capture = await a.ok(
            "POST",
            "/captures",
            json={"page_id": page["id"], "run_id": run, "viewport": "desktop"},
        )
        return str(capture["id"]), html

    async def test_source_streams_to_an_operator_with_ranges(self, a: Harness) -> None:
        capture_id, html = await self._capture_with_source(a)
        a.as_("operator")
        whole = await a.http.get(f"{API}/captures/{capture_id}/source/html")
        assert whole.status_code == 200 and whole.content == html
        assert whole.headers["cache-control"] == "private, no-store"
        part = await a.http.get(
            f"{API}/captures/{capture_id}/source/html", headers={"Range": "bytes=0-5"}
        )
        assert part.status_code == 206 and part.content == html[:6]
        assert part.headers["content-range"] == f"bytes 0-5/{len(html)}"
        tail = await a.http.get(
            f"{API}/captures/{capture_id}/source/html", headers={"Range": "bytes=-7"}
        )
        assert tail.content == html[-7:]
        bad = await a.http.get(
            f"{API}/captures/{capture_id}/source/html",
            headers={"Range": "bytes=99999-"},
        )
        assert bad.status_code == 416
        bundle = await a.http.get(f"{API}/captures/{capture_id}/bundle")
        assert bundle.status_code == 200 and bundle.content == b"PK-bundle"
        # No storage URL anywhere in what a record read returns.
        capture = await a.ok("GET", f"/captures/{capture_id}")
        assert "http" not in str(capture)

    async def test_a_bootstrap_device_is_refused_and_a_paired_one_streams(
        self, a: Harness, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        capture_id, html = await self._capture_with_source(a)
        provenance = {"value": "bootstrap"}

        async def fake_verify(token: str) -> tuple[dict[str, Any], Any]:
            return (
                {
                    "sub_type": "device",
                    "mint_provenance": provenance["value"],
                    "device_id": str(a.device_id),
                },
                a.user,
            )

        monkeypatch.setattr(api_deps, "_verify_device_jwt", fake_verify)
        auth = {"Authorization": "Bearer t"}
        refused = await a.http.get(
            f"{API}/captures/{capture_id}/source/html", headers=auth
        )
        assert refused.status_code == 403
        assert (
            await a.http.get(f"{API}/captures/{capture_id}/bundle", headers=auth)
        ).status_code == 403
        provenance["value"] = "paired"
        allowed = await a.http.get(
            f"{API}/captures/{capture_id}/source/html", headers=auth
        )
        assert allowed.status_code == 200 and allowed.content == html
        # A service credential is never a source reader.
        a.as_("coord_service")
        assert (
            await a.http.get(f"{API}/captures/{capture_id}/source/html", headers=auth)
        ).status_code == 403


# ═════════════════════════════ sites, context, split ═════════════════════════════


class TestSplit:
    async def test_split_is_assigned_at_the_first_confirmation_and_never_changes(
        self, a: Harness
    ) -> None:
        site = await a.ok(
            "POST",
            "/sites",
            json={
                "tier": "private",
                "domain": "https://Studio.Example/",
                "style_family": "modern_saas",
            },
        )
        assert site["domain"] == "studio.example" and site["split"] is None
        # A device cannot confirm a context.
        refused = await a.post(
            f"/sites/{site['id']}/context/confirm", {"industry": "design"}
        )
        assert refused.status_code == 403
        a.as_("operator")
        confirmed = await a.ok(
            "POST", f"/sites/{site['id']}/context/confirm", json={"industry": "design"}
        )
        assert confirmed["context_state"] == "confirmed" and confirmed["split"] in (
            "reference",
            "holdout",
        )
        again = await a.ok(
            "POST", f"/sites/{site['id']}/context/confirm", json={"industry": "studio"}
        )
        assert again["split"] == confirmed["split"]
        corrections = await a.ok(
            "GET",
            "/corrections",
            params={"target_kind": "site", "target_id": site["id"]},
        )
        assert {c["field"] for c in corrections} >= {"industry", "context_state"}
        # The API refuses a split change ...
        flipped = "holdout" if confirmed["split"] == "reference" else "reference"
        resp = await a.http.patch(f"{API}/sites/{site['id']}", json={"split": flipped})
        assert resp.status_code == 409 and resp.json()["error"] == "split_immutable"
        # ... and so does the database.
        with pytest.raises(DBAPIError):
            async with a.db.begin_nested():
                await a.db.execute(
                    text("UPDATE design_refs.site SET split = :s WHERE id = :id"),
                    {"s": flipped, "id": site["id"]},
                )

    async def test_every_family_holds_out_twenty_percent_within_one(
        self, a: Harness
    ) -> None:
        families = [
            "luxury_premium",
            "modern_saas",
            "architecture_editorial",
            "corporate_professional",
            "creative_experimental",
        ]
        held: dict[str, int] = dict.fromkeys(families, 0)
        for i in range(50):
            family = families[i % 5]
            site = Site(
                tenant_id=a.tenant,
                tier="private",
                domain=f"site{i}.example",
                style_family=family,
                context_state="confirmed",
                context_confirmed_at=datetime.now(UTC),
            )
            a.db.add(site)
            await a.db.flush()
            await svc.assign_split(a.db, site)
            await a.db.flush()
            held[family] += site.split == "holdout"
            n = i // 5 + 1
            assert n // 5 <= held[family] <= -(-n // 5), (family, n, held[family])
        assert held == dict.fromkeys(families, 2)

    async def test_a_domain_keeps_its_split_across_tiers(self, a: Harness) -> None:
        first = await reference_site(a, "both.example", split="holdout")
        other = Site(
            tenant_id=a.tenant,
            tier="public",
            domain="both.example",
            style_family="modern_saas",
            context_state="confirmed",
            context_confirmed_at=datetime.now(UTC),
        )
        a.db.add(other)
        await a.db.flush()
        assert await svc.assign_split(a.db, other) == first.split == "holdout"

    def test_choose_split_bounds(self) -> None:
        for assigned in range(60):
            n = assigned + 1
            for holdouts in range(
                assigned // 5, -(-assigned // 5) + 1 if assigned else 1
            ):
                got = svc.choose_split("d.example", assigned, holdouts)
                after = holdouts + (got == "holdout")
                assert n // 5 <= after <= -(-n // 5)


# ═════════════════════════════ holdout reads ═════════════════════════════


class TestHoldout:
    async def _two_sites(self, a: Harness) -> tuple[dict[str, Any], dict[str, Any]]:
        # Set up as the operator (a worker cannot reach an assigned holdout's
        # records through the CRUD routes either), then read as the agent.
        a.as_("operator")
        out = []
        for split in ("reference", "holdout"):
            site = await reference_site(a, f"{split}.example", split=split)
            page = await a.page(site.id)
            await a.describe("page", page["id"], f"warm editorial hero {split}")
            capture = await a.ok(
                "POST",
                "/captures",
                json={
                    "page_id": page["id"],
                    "run_id": str(uuid4()),
                    "viewport": "desktop",
                    "tokens": {"color": {"primary": "#111"}},
                },
            )
            await a.ok(
                "POST",
                "/components",
                json={
                    "page_id": page["id"],
                    "capture_id": capture["id"],
                    "role": "hero",
                    "tokens": {"color": {"primary": "#111"}},
                },
            )
            out.append(page)
        a.as_("device")
        return out[0], out[1]

    async def test_holdout_is_absent_from_every_agent_read(self, a: Harness) -> None:
        ref, hold = await self._two_sites(a)
        found = await a.ok(
            "POST", "/search", json={"level": "page", "text": "warm editorial hero"}
        )
        assert [r["target_id"] for r in found["results"]] == [ref["id"]]
        assert (
            await a.http.get(f"{API}/examples/page/{hold['id']}")
        ).status_code == 404
        assert (await a.http.get(f"{API}/examples/page/{ref['id']}")).status_code == 200
        similar = await a.ok(
            "POST",
            "/similar-by-style",
            json={"tokens": {"color": {"primary": "#111"}}, "role": "hero"},
        )
        assert similar["style_arm"] == "tokens_only"
        assert {r["site_id"] for r in similar["results"]} == {ref["site_id"]}
        compare = await a.ok(
            "POST",
            "/compare-to-references",
            json={
                "snapshot": {"role": "hero", "tokens": {"color": {"primary": "#222"}}}
            },
        )
        assert compare["fidelity_arm"] == "tokens_only"
        assert {r["site_id"] for r in compare["results"]} == {ref["site_id"]}
        assert compare["results"][0]["differences"][0]["token"] == "color.primary"
        assert all(s["split"] != "holdout" for s in await a.ok("GET", "/sites"))
        assert (await a.http.get(f"{API}/sites/{hold['site_id']}")).status_code == 404

    async def test_include_holdout_is_operator_only_and_shows_it(
        self, a: Harness
    ) -> None:
        _ref, hold = await self._two_sites(a)
        for method, path, kw in (
            ("POST", "/search", {"json": {"level": "page", "include_holdout": True}}),
            (
                "GET",
                f"/examples/page/{hold['id']}",
                {"params": {"include_holdout": "true"}},
            ),
            (
                "POST",
                "/similar-by-style",
                {"json": {"tokens": {"a": 1}, "include_holdout": True}},
            ),
            (
                "POST",
                "/compare-to-references",
                {"json": {"snapshot": {"tokens": {"a": 1}}, "include_holdout": True}},
            ),
            ("GET", "/sites", {"params": {"include_holdout": "true"}}),
        ):
            resp = await a.http.request(method, f"{API}{path}", **kw)
            assert resp.status_code == 403, (path, resp.text)
            assert resp.json()["error"] == "include_holdout_operator_only"
        a.as_("operator")
        review = await a.ok(
            "GET", f"/examples/page/{hold['id']}", params={"include_holdout": "true"}
        )
        assert "holdout" in review["labels"]
        found = await a.ok(
            "POST",
            "/search",
            json={
                "level": "page",
                "text": "warm editorial hero",
                "include_holdout": True,
            },
        )
        assert hold["id"] in [r["target_id"] for r in found["results"]]

    async def test_an_ai_judge_never_sees_the_operators_judgements_of_a_holdout(
        self, a: Harness
    ) -> None:
        site = await reference_site(a, split="holdout")
        a.as_("operator")
        assert (await a.rate("site", site.id, 8)).status_code == 201
        a.as_("device")
        assert (await a.rate("site", site.id, 3)).status_code == 201
        seen = await a.ok(
            "GET", "/ratings", params={"target_kind": "site", "target_id": str(site.id)}
        )
        assert [r["rater_kind"] for r in seen["ratings"]] == ["ai"]
        a.as_("operator")
        seen = await a.ok(
            "GET", "/ratings", params={"target_kind": "site", "target_id": str(site.id)}
        )
        assert sorted(r["rater_kind"] for r in seen["ratings"]) == ["ai", "operator"]


# ═════════════════════════════ search ═════════════════════════════


class TestSearch:
    async def test_facet_exact_ranks_first_and_the_vector_arm_says_it_was_skipped(
        self, a: Harness
    ) -> None:
        site = await reference_site(a)
        loud = await a.page(site.id)
        exact = await a.page(site.id)
        await a.describe(
            "page", loud["id"], "hero hero hero bold hero with a hero banner"
        )
        await a.describe(
            "page",
            exact["id"],
            "a quiet hero",
            facets={"layout": "split", "mood": "calm"},
        )
        found = await a.ok(
            "POST",
            "/search",
            json={"level": "page", "text": "hero", "facets": {"layout": "split"}},
        )
        assert found["vector_arm"] == "skipped_no_embedding"
        assert [r["target_id"] for r in found["results"]] == [exact["id"], loud["id"]]
        assert found["results"][0]["facet_exact"] is True
        assert found["results"][0]["vector_similarity"] is None

    async def test_an_embedding_runs_the_hybrid_arm(self, a: Harness) -> None:
        site = await reference_site(a)
        page = await a.page(site.id)
        vec = [0.0] * 384
        vec[0] = 1.0
        await a.describe(
            "page", page["id"], "dense", embedding=vec, embedding_model="minilm"
        )
        found = await a.ok(
            "POST",
            "/search",
            json={
                "level": "page",
                "query_embedding": vec,
                "query_embedding_model": "minilm",
            },
        )
        assert found["vector_arm"] == "hybrid"
        assert found["results"][0]["vector_similarity"] == pytest.approx(1.0)

    async def test_personality_ranks_by_distance_within_tolerance(
        self, a: Harness
    ) -> None:
        near = await reference_site(a, "near.example")
        far = await reference_site(a, "far.example")
        out = await reference_site(a, "out.example")
        proposed_only = await reference_site(a, "proposed.example")
        for site, warmth in ((near, 70), (far, 50), (out, 10)):
            a.db.add(
                SitePersonality(
                    tenant_id=a.tenant,
                    site_id=site.id,
                    trait_key="warmth",
                    value=warmth,
                    rater_kind="operator",
                    rater_id="op",
                    state="confirmed",
                )
            )
        a.db.add(
            SitePersonality(
                tenant_id=a.tenant,
                site_id=proposed_only.id,
                trait_key="warmth",
                value=72,
                rater_kind="ai",
                rater_id="m",
                state="proposed",
            )
        )
        await a.db.flush()
        query = {
            "level": "site",
            "personality_target": {"warmth": 72},
            "personality_tolerance": 30,
        }
        found = await a.ok("POST", "/search", json=query)
        assert [r["domain"] for r in found["results"]] == [
            "near.example",
            "far.example",
        ]
        assert found["results"][0]["personality_basis"] == "confirmed"
        with_unconfirmed = await a.ok(
            "POST", "/search", json={**query, "include_unconfirmed": True}
        )
        first = with_unconfirmed["results"][0]
        assert (
            first["domain"] == "proposed.example"
            and "personality_unconfirmed" in first["labels"]
        )


# ═════════════════════════════ judgements ═════════════════════════════


class TestJudgements:
    async def test_score_bounds_evidence_and_rater(self, a: Harness) -> None:
        site = await reference_site(a)
        assert (await a.rate("site", site.id, 0)).status_code == 422
        assert (await a.rate("site", site.id, 11)).status_code == 422
        no_evidence = await a.rate("site", site.id, 5, positive_evidence=[])
        assert no_evidence.json()["error"] == "ai_rating_needs_evidence"
        # The body's rater_kind is ignored: a device is always "ai".
        spoof = await a.rate(
            "site",
            site.id,
            6,
            rater_kind="operator",
            model_id="m1",
            prompt_version="v2",
        )
        assert spoof.status_code == 201
        assert (
            spoof.json()["rater_kind"] == "ai" and spoof.json()["rater_id"] == "m1@v2"
        )
        a.as_("operator")
        mine = await a.rate("site", site.id, 9, answer_ms=1200)
        assert (
            mine.json()["rater_kind"] == "operator" and mine.json()["answer_ms"] == 1200
        )
        unknown = await a.rate("site", site.id, 5, dimension_key="nope")
        assert unknown.json()["error"] == "unknown_dimension"

    async def test_re_rating_appends_and_the_distribution_is_read_time(
        self, a: Harness
    ) -> None:
        site = await reference_site(a)
        a.as_("operator")
        for score in (4, 8):
            assert (await a.rate("site", site.id, score)).status_code == 201
        listed = await a.ok(
            "GET", "/ratings", params={"target_kind": "site", "target_id": str(site.id)}
        )
        assert [r["score"] for r in listed["ratings"]] == [4, 8]
        dist = {
            (d["dimension_key"], d["rater_kind"]): d for d in listed["distributions"]
        }
        # The latest row per rater counts once.
        assert dist[("premium", "operator")]["n"] == 1
        assert dist[("premium", "operator")]["score_median"] == 8
        assert dist[("premium", "operator")]["computed_at_read_time"] is True

    async def test_a_comparison_needs_two_targets_and_a_known_dimension(
        self, a: Harness
    ) -> None:
        one = await reference_site(a)
        two = await reference_site(a)
        same = await a.post(
            "/comparisons",
            {
                "target_kind": "site",
                "a_id": str(one.id),
                "b_id": str(one.id),
                "dimension_key": "premium",
                "winner": "a",
            },
        )
        assert same.status_code == 422
        unknown = await a.post(
            "/comparisons",
            {
                "target_kind": "site",
                "a_id": str(one.id),
                "b_id": str(two.id),
                "dimension_key": "nope",
                "winner": "a",
            },
        )
        assert unknown.status_code == 422
        made = await a.post(
            "/comparisons",
            {
                "target_kind": "site",
                "a_id": str(one.id),
                "b_id": str(two.id),
                "dimension_key": "premium",
                "winner": "b",
                "rater_kind": "operator",
            },
            expect=201,
        )
        assert made.json()["rater_kind"] == "ai"

    async def test_personality_device_proposes_operator_confirms(
        self, a: Harness
    ) -> None:
        site = await reference_site(a)
        proposed = await a.ok(
            "POST",
            f"/sites/{site.id}/personality",
            json={"trait_key": "warmth", "value": 40},
        )
        assert proposed["state"] == "proposed" and proposed["rater_kind"] == "ai"
        refused = await a.post(
            f"/sites/{site.id}/personality/{proposed['id']}/confirm", {"value": 55}
        )
        assert refused.status_code == 403
        a.as_("operator")
        confirmed = await a.ok(
            "POST",
            f"/sites/{site.id}/personality/{proposed['id']}/confirm",
            json={"value": 55},
        )
        assert confirmed["state"] == "confirmed" and confirmed["value"] == 55
        corrections = await a.ok(
            "GET",
            "/corrections",
            params={"target_kind": "site_personality", "target_id": proposed["id"]},
        )
        assert [(c["from_value"], c["to_value"]) for c in corrections] == [(40, 55)]
        bad = await a.post(
            f"/sites/{site.id}/personality", {"trait_key": "warmth", "value": 101}
        )
        assert bad.status_code == 422


# ═════════════════════════════ principles ═════════════════════════════


async def _rating_id(
    h: Harness, site: Site, score: int = 8, dimension: str = "premium"
) -> str:
    resp = await h.rate("site", site.id, score, dimension_key=dimension)
    assert resp.status_code == 201, resp.text
    return str(resp.json()["id"])


async def _principle(h: Harness, **scope: Any) -> str:
    made = await h.ok(
        "POST",
        "/principles",
        json={"statement": "Restraint reads as premium.", "scope": scope},
    )
    assert made["status"] == "proposed"
    return str(made["id"])


async def _attach(
    h: Harness, principle: str, rating: str, role: str = "supports"
) -> httpx.Response:
    resp: httpx.Response = await h.http.post(
        f"{API}/principles/{principle}/evidence",
        json={
            "role": role,
            "evidence_kind": "perception_rating",
            "evidence_id": rating,
        },
    )
    return resp


class TestPrinciples:
    async def test_approval_gates(self, a: Harness) -> None:
        one = await reference_site(a)
        two = await reference_site(a)
        held = await reference_site(a, split="holdout")
        unsplit = await reference_site(a, split=None)  # type: ignore[arg-type]
        principle = await _principle(a)
        # Holdout or not-yet-split evidence is refused at insert.
        for site in (held, unsplit):
            resp = await _attach(a, principle, await _rating_id(a, site))
            assert (
                resp.status_code == 409
                and resp.json()["error"] == "holdout_evidence_refused"
            )
        assert (
            await _attach(a, principle, await _rating_id(a, one))
        ).status_code == 201
        # A device or service credential never approves.
        for actor in ("device", "coord_service"):
            a.as_(actor)
            assert (
                await a.http.post(f"{API}/principles/{principle}/approve")
            ).status_code == 403
        a.as_("operator")
        lone = await a.http.post(f"{API}/principles/{principle}/approve")
        assert (
            lone.status_code == 409
            and lone.json()["error"] == "insufficient_reference_support"
        )
        # Two ratings of the SAME site are still one site.
        assert (
            await _attach(a, principle, await _rating_id(a, one, 9))
        ).status_code == 201
        assert (
            await a.http.post(f"{API}/principles/{principle}/approve")
        ).status_code == 409
        assert (
            await _attach(a, principle, await _rating_id(a, two))
        ).status_code == 201
        approved = await a.ok("POST", f"/principles/{principle}/approve")
        assert approved["status"] == "approved" and len(approved["evidence"]) == 3

    async def test_only_approved_principles_are_served(self, a: Harness) -> None:
        one, two = await reference_site(a), await reference_site(a)
        approved = await _principle(a, price_tiers=["premium"])
        draft = await _principle(a)
        for site in (one, two):
            await _attach(a, approved, await _rating_id(a, site))
        a.as_("operator")
        await a.ok("POST", f"/principles/{approved}/approve")
        a.as_("device")
        served = await a.ok("GET", "/principles")
        assert [p["id"] for p in served] == [approved]
        assert await a.ok("GET", "/principles", params={"price_tier": "budget"}) == []
        assert (await a.http.get(f"{API}/principles/{draft}")).status_code == 404
        assert (
            await a.http.get(f"{API}/principles", params={"include_unapproved": "true"})
        ).status_code == 403
        a.as_("operator")
        assert {
            p["id"]
            for p in await a.ok(
                "GET", "/principles", params={"include_unapproved": "true"}
            )
        } == {approved, draft}
        retired = await a.ok(
            "POST", f"/principles/{approved}/retire", json={"reason": "superseded"}
        )
        assert retired["status"] == "retired"

    async def test_a_flagged_correlation_needs_a_counterexample(
        self, a: Harness
    ) -> None:
        sites = []
        for i in range(20):
            site = await reference_site(a, f"c{i}.example")
            page = Page(
                tenant_id=a.tenant,
                tier="private",
                site_id=site.id,
                url=f"https://c{i}.example/",
            )
            a.db.add(page)
            await a.db.flush()
            a.db.add(
                Capture(
                    tenant_id=a.tenant,
                    tier="private",
                    page_id=page.id,
                    run_id=uuid4(),
                    viewport="desktop",
                    facets={"background_luminance": float(i)},
                )
            )
            a.db.add(
                PerceptionRating(
                    tenant_id=a.tenant,
                    target_kind="site",
                    target_id=site.id,
                    dimension_key="premium",
                    dimension_version=1,
                    score=1 + i // 2,
                    rater_kind="operator",
                    rater_id="op",
                )
            )
            sites.append(site)
        await a.db.flush()
        report = await svc.correlation_report(a.db, a.tenant)
        flagged = [c for c in report if c.flagged]
        assert [(c.key, c.facet, c.n) for c in flagged] == [
            ("premium", "background_luminance", 20)
        ]
        balance = await a.ok("GET", "/corpus-balance")
        assert any(
            c["flagged"] and c["key"] == "premium" for c in balance["correlations"]
        )

        principle = await _principle(a, dimensions=["premium"])
        for site in sites[:2]:
            await _attach(a, principle, await _rating_id(a, site))
        a.as_("operator")
        resp = await a.http.post(f"{API}/principles/{principle}/approve")
        assert (
            resp.status_code == 409
            and resp.json()["error"] == "counterexample_required"
        )
        assert (
            await _attach(
                a, principle, await _rating_id(a, sites[5], 2), role="counterexample"
            )
        ).status_code == 201
        assert (await a.ok("POST", f"/principles/{principle}/approve"))[
            "status"
        ] == "approved"
        # A principle scoped to an unflagged dimension needs none.
        other = await _principle(a, dimensions=["calm"])
        for site in sites[:2]:
            await _attach(a, other, await _rating_id(a, site, dimension="calm"))
        assert (await a.ok("POST", f"/principles/{other}/approve"))[
            "status"
        ] == "approved"


# ═════════════════════════════ takedown ═════════════════════════════


class TestTakedown:
    async def test_record_takedown_keeps_shared_blobs_and_the_other_tier(
        self, a: Harness
    ) -> None:
        private = await reference_site(a, "owner.example", tier="private")
        public = await reference_site(a, "owner.example", tier="public")
        p1, p2 = await a.page(private.id), await a.page(private.id)
        shared = await a.upload(b"shared-shot")
        only = await a.upload(b"only-shot")
        for page, keys in ((p1, (shared, only)), (p2, (shared,))):
            for key in keys:
                await a.ok(
                    "POST",
                    "/captures",
                    json={
                        "page_id": page["id"],
                        "run_id": str(uuid4()),
                        "viewport": "desktop",
                        "screenshot_key": key,
                    },
                )
        public_page = await a.page(public.id)
        a.as_("operator")
        assert (
            await a.post(
                "/takedown",
                {"target_kind": "page", "target_id": p1["id"], "reason": "request"},
            )
        ).status_code == 200
        assert a.storage.file_exists(shared) and not a.storage.file_exists(only)
        assert (
            await a.db.get(Blob, shared) is not None
            and await a.db.get(Blob, only) is None
        )
        # Taking down the private SITE leaves the public record of the domain.
        result = await a.ok(
            "POST",
            "/takedown",
            json={
                "target_kind": "site",
                "target_id": str(private.id),
                "reason": "request",
            },
        )
        assert result["sites"] == 1 and result["do_not_capture"] == ["owner.example"]
        assert not a.storage.file_exists(shared)
        assert (await a.http.get(f"{API}/sites/{public.id}")).status_code == 200
        assert (await a.http.get(f"{API}/pages/{public_page['id']}")).status_code == 200
        # A device cannot take anything down.
        a.as_("device")
        assert (
            await a.post("/takedown", {"domain": "owner.example", "reason": "x"})
        ).status_code == 403

    async def test_domain_takedown_removes_every_tier_and_blocks_recapture(
        self, a: Harness
    ) -> None:
        await reference_site(a, "gone.example", tier="private")
        await reference_site(a, "gone.example", tier="public")
        a.as_("operator")
        result = await a.ok(
            "POST",
            "/takedown",
            json={"domain": "GONE.example", "reason": "IP holder request"},
        )
        assert result["sites"] == 2 and result["do_not_capture"] == ["gone.example"]
        count = (
            await a.db.execute(
                select(func.count())
                .select_from(Site)
                .where(Site.tenant_id == a.tenant, Site.domain == "gone.example")
            )
        ).scalar()
        assert count == 0
        a.as_("device")
        assert (
            await a.post("/sites", {"tier": "private", "domain": "gone.example"})
        ).status_code == 409
        job = await a.post(
            "/capture-jobs", {"url": "https://gone.example/pricing", "source": "mcp"}
        )
        assert job.status_code == 409 and job.json()["error"] == "do_not_capture"
        assert [d["domain"] for d in await a.ok("GET", "/do-not-capture")] == [
            "gone.example"
        ]

    async def test_takedown_removes_judgements_and_reverts_a_principle(
        self, a: Harness
    ) -> None:
        one, two = await reference_site(a), await reference_site(a)
        principle = await _principle(a)
        r1, r2 = await _rating_id(a, one), await _rating_id(a, two)
        await _attach(a, principle, r1)
        await _attach(a, principle, r2)
        await a.post(
            "/comparisons",
            {
                "target_kind": "site",
                "a_id": str(one.id),
                "b_id": str(two.id),
                "dimension_key": "premium",
                "winner": "a",
            },
            expect=201,
        )
        await a.ok(
            "POST",
            f"/sites/{one.id}/personality",
            json={"trait_key": "warmth", "value": 40},
        )
        a.as_("operator")
        await a.ok("POST", f"/principles/{principle}/approve")
        result = await a.ok(
            "POST",
            "/takedown",
            json={"target_kind": "site", "target_id": str(one.id), "reason": "request"},
        )
        assert (
            result["ratings"] == 1
            and result["comparisons"] == 1
            and result["personality_rows"] == 1
        )
        assert result["evidence_rows"] == 1 and result["principles_reverted"] == [
            principle
        ]
        assert await a.db.get(PerceptionRating, UUID(r1)) is None
        assert await a.db.get(PerceptionRating, UUID(r2)) is not None
        row = await a.db.get(DesignPrinciple, UUID(principle))
        assert row is not None and row.status == "proposed"
        left = (
            (
                await a.db.execute(
                    select(DesignPrincipleEvidence).where(
                        DesignPrincipleEvidence.principle_id == UUID(principle)
                    )
                )
            )
            .scalars()
            .all()
        )
        assert [str(e.evidence_id) for e in left] == [r2]
        reverts = (
            (
                await a.db.execute(
                    select(Correction).where(
                        Correction.target_id == UUID(principle),
                        Correction.field == "status",
                    )
                )
            )
            .scalars()
            .all()
        )
        assert [(c.from_value, c.to_value) for c in reverts][-1] == (
            "approved",
            "proposed",
        )


# ═════════════════════════════ capture jobs, curation ═════════════════════════════


class TestJobsAndCuration:
    async def test_capture_job_lifecycle(self, a: Harness) -> None:
        queued = await a.ok(
            "POST",
            "/capture-jobs",
            json={"url": "https://Shop.Example/p", "source": "mcp"},
        )
        assert queued["state"] == "queued" and queued["domain"] == "shop.example"
        assert (
            await a.post(
                "/capture-jobs", {"url": "https://x.example", "source": "operator"}
            )
        ).status_code == 422
        proposal = await a.ok(
            "POST",
            "/capture-jobs",
            json={"url": "https://found.example", "source": "discovery"},
        )
        assert proposal["state"] == "proposed"
        assert (
            await a.http.patch(
                f"{API}/capture-jobs/{proposal['id']}", json={"state": "queued"}
            )
        ).status_code == 403
        claimed = await a.ok("POST", "/capture-jobs/claim", json={"worker": "w1"})
        assert claimed["id"] == queued["id"] and claimed["state"] == "running"
        assert await a.ok("POST", "/capture-jobs/claim", json={"worker": "w2"}) is None
        done = await a.ok(
            "PATCH",
            f"/capture-jobs/{queued['id']}",
            json={"state": "done", "derived_tier": "private"},
        )
        assert done["state"] == "done"
        assert (
            await a.http.patch(
                f"{API}/capture-jobs/{queued['id']}", json={"state": "running"}
            )
        ).status_code == 409
        a.as_("operator")
        assert (
            await a.ok(
                "PATCH", f"/capture-jobs/{proposal['id']}", json={"state": "queued"}
            )
        )["state"] == "queued"
        repro = await a.ok(
            "POST",
            "/capture-jobs",
            json={"url": "https://mine.example", "is_reproduction": True},
        )
        resp = await a.http.patch(
            f"{API}/capture-jobs/{repro['id']}", json={"derived_tier": "public"}
        )
        assert (
            resp.status_code == 422
            and resp.json()["error"] == "reproduction_is_private"
        )

    async def test_curation_is_operator_only_and_logged(self, a: Harness) -> None:
        site = await reference_site(a)
        page = await a.page(site.id, title="Old")
        assert (
            await a.post(f"/review/page/{page['id']}", {"review_state": "approved"})
        ).status_code == 403
        a.as_("operator")
        reviewed = await a.ok(
            "POST",
            f"/review/page/{page['id']}",
            json={"review_state": "approved", "quality": "exemplar"},
        )
        assert (
            reviewed["review_state"] == "approved" and reviewed["quality"] == "exemplar"
        )
        await a.ok("PATCH", f"/pages/{page['id']}", json={"title": "New"})
        log = await a.ok(
            "GET",
            "/corrections",
            params={"target_kind": "page", "target_id": page["id"]},
        )
        assert {(c["field"], c["to_value"]) for c in log} >= {
            ("review_state", "approved"),
            ("quality", "exemplar"),
            ("title", "New"),
        }
        assert all(c["actor_kind"] == "operator" for c in log)
        # A rejected record leaves every agent read.
        await a.describe("page", page["id"], "rejected hero")
        await a.ok(
            "POST", f"/review/page/{page['id']}", json={"review_state": "rejected"}
        )
        assert (
            await a.ok(
                "POST", "/search", json={"level": "page", "text": "rejected hero"}
            )
        )["results"] == []

    async def test_a_bench_run_below_the_pair_floor_is_unknown(
        self, a: Harness
    ) -> None:
        few = await a.ok(
            "POST",
            "/judge-bench-runs",
            json={
                "model": "m",
                "prompt_version": "v1",
                "n_pairs": 12,
                "pair_agreement": 0.9,
            },
        )
        assert few["verdict"] == "unknown" and few["pair_agreement"] is None
        many = await a.ok(
            "POST",
            "/judge-bench-runs",
            json={
                "model": "m",
                "prompt_version": "v1",
                "n_pairs": 40,
                "pair_agreement": 0.7,
            },
        )
        assert many["verdict"] == "measured" and many["pair_agreement"] == 0.7

    async def test_vocab_is_served(self, a: Harness) -> None:
        vocab = await a.ok("GET", "/vocab")
        assert {f["key"] for f in vocab["style_families"]} == {
            k for k, _ in models.SEED_STYLE_FAMILIES
        }
        assert len(vocab["dimensions"]) == 17 and len(vocab["traits"]) == len(
            models.SEED_PERSONALITY_TRAITS
        )


# ═════════════════════════════ review fixes (f21caed40 review) ═════════════════════════════


async def _source_capture(h: Harness, site: Site) -> str:
    """A capture of ``site`` with an HTML source part and a bundle, made as
    the operator (a holdout's records are not reachable by a device)."""
    actor = h.actor
    h.as_("operator")
    page = await h.page(site.id)
    run = str(uuid4())
    key = await h.upload(
        b"<script>alert(document.cookie)</script>", purpose="source", ext=".html"
    )
    await h.ok(
        "POST",
        "/capture-sources",
        json={
            "page_id": page["id"],
            "run_id": run,
            "viewport": "desktop",
            "parts": {"html": {"key": key, "content_type": "text/html"}},
        },
    )
    bundle = await h.upload(b"PK-zip", purpose="bundle", ext=".zip")
    await h.ok(
        "POST",
        "/replay-bundles",
        json={"page_id": page["id"], "run_id": run, "bundle_key": bundle},
    )
    capture = await h.ok(
        "POST",
        "/captures",
        json={"page_id": page["id"], "run_id": run, "viewport": "desktop"},
    )
    h.as_(actor)
    return str(capture["id"])


def _paired(h: Harness, monkeypatch: pytest.MonkeyPatch) -> dict[str, str]:
    async def fake_verify(token: str) -> tuple[dict[str, Any], Any]:
        return (
            {
                "sub_type": "device",
                "mint_provenance": "paired",
                "device_id": str(h.device_id),
            },
            h.user,
        )

    monkeypatch.setattr(api_deps, "_verify_device_jwt", fake_verify)
    return {"Authorization": "Bearer t"}


class TestReviewFixes:
    # ── B1 ──
    async def test_captured_bytes_are_never_rendered_on_the_api_origin(
        self, a: Harness
    ) -> None:
        capture = await _source_capture(a, await reference_site(a))
        a.as_("operator")
        for path in (f"/captures/{capture}/source/html", f"/captures/{capture}/bundle"):
            resp = await a.http.get(f"{API}{path}")
            assert resp.status_code == 200, resp.text
            assert resp.headers["content-type"] == "application/octet-stream"
            assert resp.headers["content-disposition"].startswith("attachment;")
            assert (
                resp.headers["content-security-policy"] == "sandbox; default-src 'none'"
            )
            assert resp.headers["x-content-type-options"] == "nosniff"
        html = await a.http.get(f"{API}/captures/{capture}/source/html")
        assert html.headers["x-original-content-type"] == "text/html"

    # ── B2 ──
    async def test_a_paired_device_cannot_stream_a_holdouts_source(
        self, a: Harness, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        auth = _paired(a, monkeypatch)
        hold = await _source_capture(a, await reference_site(a, split="holdout"))
        ref = await _source_capture(a, await reference_site(a))
        for path in (f"/captures/{hold}/source/html", f"/captures/{hold}/bundle"):
            assert (await a.http.get(f"{API}{path}", headers=auth)).status_code == 404
        assert (
            await a.http.get(f"{API}/captures/{ref}/source/html", headers=auth)
        ).status_code == 200
        a.as_("operator")
        assert (
            await a.http.get(f"{API}/captures/{hold}/source/html")
        ).status_code == 200

    # ── B3 ──
    async def test_an_operator_comparison_touching_a_holdout_is_hidden_through_the_reference_side(
        self, a: Harness
    ) -> None:
        ref = await reference_site(a)
        hold = await reference_site(a, split="holdout")
        other = await reference_site(a)
        a.as_("operator")
        for b_site in (hold, other):
            await a.post(
                "/comparisons",
                {
                    "target_kind": "site",
                    "a_id": str(ref.id),
                    "b_id": str(b_site.id),
                    "dimension_key": "premium",
                    "winner": "a",
                },
                expect=201,
            )
        a.as_("device")
        await a.post(
            "/comparisons",
            {
                "target_kind": "site",
                "a_id": str(ref.id),
                "b_id": str(hold.id),
                "dimension_key": "premium",
                "winner": "b",
            },
            expect=201,
        )
        seen = await a.ok(
            "GET",
            "/comparisons",
            params={"target_kind": "site", "target_id": str(ref.id)},
        )
        assert sorted((c["rater_kind"], c["b_id"]) for c in seen) == sorted(
            [("operator", str(other.id)), ("ai", str(hold.id))]
        )
        example = await a.ok("GET", f"/examples/site/{ref.id}")
        assert sorted(
            (c["rater_kind"], c["b_id"]) for c in example["comparisons"]
        ) == sorted([("operator", str(other.id)), ("ai", str(hold.id))])
        a.as_("operator")
        assert (
            len(
                await a.ok(
                    "GET",
                    "/comparisons",
                    params={"target_kind": "site", "target_id": str(ref.id)},
                )
            )
            == 3
        )

    # ── B4 ──
    async def test_the_correction_log_is_operator_only(self, a: Harness) -> None:
        # Even a reference site's log: it carries the operator's own edits.
        site = await reference_site(a)
        proposed = await a.ok(
            "POST",
            f"/sites/{site.id}/personality",
            json={"trait_key": "warmth", "value": 40},
        )
        a.as_("operator")
        await a.ok(
            "POST",
            f"/sites/{site.id}/personality/{proposed['id']}/confirm",
            json={"value": 90},
        )
        params = {"target_kind": "site_personality", "target_id": proposed["id"]}
        assert len(await a.ok("GET", "/corrections", params=params)) == 1
        for actor in ("device", "coord_service"):
            a.as_(actor)
            resp = await a.http.get(f"{API}/corrections", params=params)
            assert (
                resp.status_code == 403 and resp.json()["error"] == "operator_required"
            )

    # ── B5 ──
    async def test_an_object_already_at_the_key_is_verified_before_it_is_recorded(
        self, a: Harness
    ) -> None:
        data = b"the real bytes"
        sha = hashlib.sha256(data).hexdigest()
        key = svc.blob_key("private", a.tenant, sha, ".png")
        import io

        a.storage.backend.upload_file(file_obj=io.BytesIO(b"planted"), key=key)
        resp = await a.http.put(f"{API}/blobs/private/{sha}.png", content=data)
        assert resp.status_code == 200, resp.text
        with a.storage.open_stream(key) as stored:
            assert stored.read() == data

    async def test_verify_never_deletes_a_recorded_blobs_object(
        self, a: Harness
    ) -> None:
        key = await a.upload(b"recorded bytes")
        import io

        a.storage.backend.upload_file(file_obj=io.BytesIO(b"corrupted"), key=key)
        resp = await a.post("/uploads/verify", {"key": key})
        assert resp.status_code == 409 and resp.json()["error"] == "blob_object_corrupt"
        assert a.storage.file_exists(key)
        assert await a.db.get(Blob, key) is not None
        # An UNrecorded mismatching object is still removed.
        stray = svc.blob_key("private", a.tenant, "a" * 64, ".png")
        a.storage.backend.upload_file(file_obj=io.BytesIO(b"stray"), key=stray)
        resp = await a.post("/uploads/verify", {"key": stray})
        assert resp.status_code == 422 and not a.storage.file_exists(stray)

    async def test_the_presigned_put_pins_the_sha256(
        self, a: Harness, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        import base64

        from app.services.storage import S3Backend

        calls: list[dict[str, Any]] = []

        class FakeClient:
            def generate_presigned_url(self, op: str, **kw: Any) -> str:
                calls.append({"op": op, **kw})
                return "https://s3.example/signed"

        backend = S3Backend.__new__(S3Backend)
        backend.client = FakeClient()
        backend.bucket_name = "bucket"
        a.storage.backend = backend
        data = b"to presign"
        sha = hashlib.sha256(data).hexdigest()
        ticket = await a.ok(
            "POST",
            "/uploads",
            json={
                "purpose": "record",
                "tier": "private",
                "sha256": sha,
                "size": len(data),
                "ext": ".png",
            },
        )
        pinned = base64.b64encode(bytes.fromhex(sha)).decode()
        assert ticket["method"] == "presigned_put"
        assert ticket["required_headers"] == {"x-amz-checksum-sha256": pinned}
        assert calls[0]["op"] == "put_object"
        assert calls[0]["Params"]["ChecksumSHA256"] == pinned
        assert calls[0]["Params"]["Key"] == ticket["key"]

    # ── B6 ──
    async def test_takedown_locks_blob_rows_and_record_creation_shares_them(
        self, a: Harness
    ) -> None:
        from sqlalchemy import event

        site = await reference_site(a)
        page = await a.page(site.id)
        key = await a.upload(b"locked shot")
        statements: list[str] = []
        sync_engine = a.db.get_bind()

        def record(conn: Any, cursor: Any, statement: str, *args: Any) -> None:
            statements.append(" ".join(statement.split()))

        event.listen(sync_engine, "before_cursor_execute", record)
        try:
            await a.ok(
                "POST",
                "/captures",
                json={
                    "page_id": page["id"],
                    "run_id": str(uuid4()),
                    "viewport": "desktop",
                    "screenshot_key": key,
                },
            )
            assert any("design_refs.blob" in s and "FOR SHARE" in s for s in statements)
            statements.clear()
            a.as_("operator")
            await a.ok(
                "POST",
                "/takedown",
                json={"target_kind": "page", "target_id": page["id"], "reason": "x"},
            )
        finally:
            event.remove(sync_engine, "before_cursor_execute", record)
        lock = next(
            i
            for i, s in enumerate(statements)
            if "design_refs.blob" in s and "FOR UPDATE" in s
        )
        count = next(i for i, s in enumerate(statements) if "unnest(" in s)
        assert lock < count

    async def test_an_object_rerecorded_after_takedown_is_not_deleted(
        self, a: Harness
    ) -> None:
        key = await a.upload(b"comes back")
        row = await a.db.get(Blob, key)
        assert row is not None
        # The takedown's commit removed the row; a re-upload recorded it again
        # before the post-commit delete ran.
        assert (
            await svc.delete_objects(a.storage, [key], db=a.db, tenant_id=a.tenant) == 0
        )
        assert a.storage.file_exists(key)
        await a.db.delete(row)
        await a.db.flush()
        assert (
            await svc.delete_objects(a.storage, [key], db=a.db, tenant_id=a.tenant) == 1
        )
        assert not a.storage.file_exists(key)

    # ── NITs ──
    async def test_an_explicit_null_for_a_required_field_is_a_422(
        self, a: Harness
    ) -> None:
        site = await reference_site(a)
        a.as_("operator")
        for body in ({"price_tier": None}, {"tags": None}):
            resp = await a.http.patch(f"{API}/sites/{site.id}", json=body)
            assert (
                resp.status_code == 422 and resp.json()["error"] == "null_not_allowed"
            ), resp.text
        page = await a.page(site.id)
        resp = await a.http.patch(f"{API}/pages/{page['id']}", json={"tags": None})
        assert resp.status_code == 422
        assert (
            await a.http.patch(f"{API}/pages/{page['id']}", json={"title": None})
        ).status_code == 200

    async def test_do_not_capture_matches_on_segment_boundaries(
        self, a: Harness
    ) -> None:
        assert svc.path_covered("/blog", "/blog")
        assert svc.path_covered("/blog/post", "/blog")
        assert svc.path_covered("/blog/post", "/blog/")
        assert not svc.path_covered("/blogger", "/blog")
        assert svc.path_covered("/anything", "")
        from app.models.design_refs import DoNotCapture

        a.db.add(
            DoNotCapture(
                tenant_id=a.tenant,
                domain="seg.example",
                path_prefix="/blog",
                reason="r",
                created_by="op",
            )
        )
        await a.db.flush()
        blocked = await a.post(
            "/capture-jobs", {"url": "https://seg.example/blog/x", "source": "mcp"}
        )
        assert blocked.status_code == 409
        allowed = await a.post(
            "/capture-jobs", {"url": "https://seg.example/blogger", "source": "mcp"}
        )
        assert allowed.status_code == 201

    def test_the_bundle_key_check_does_not_test_null_on_a_not_null_column(self) -> None:
        table = models.ReplayBundle.__table__
        assert not table.c.bundle_key.nullable
        check = next(
            c for c in table.constraints if c.name == "ck_replay_bundle_key_private"
        )
        assert "IS NULL" not in str(check.sqltext)

    async def test_a_trait_in_a_flagged_correlation_needs_a_counterexample(
        self, a: Harness
    ) -> None:
        sites = []
        for i in range(20):
            site = await reference_site(a, f"t{i}.example")
            page = Page(
                tenant_id=a.tenant,
                tier="private",
                site_id=site.id,
                url=f"https://t{i}.example/",
            )
            a.db.add(page)
            await a.db.flush()
            a.db.add(
                Capture(
                    tenant_id=a.tenant,
                    tier="private",
                    page_id=page.id,
                    run_id=uuid4(),
                    viewport="desktop",
                    facets={"palette_saturation": float(i)},
                )
            )
            a.db.add(
                SitePersonality(
                    tenant_id=a.tenant,
                    site_id=site.id,
                    trait_key="warmth",
                    value=5 * i,
                    rater_kind="operator",
                    rater_id="op",
                    state="confirmed",
                )
            )
            sites.append(site)
        await a.db.flush()
        assert "warmth" in svc.flagged_keys(
            await svc.correlation_report(a.db, a.tenant)
        )
        principle = await _principle(a, traits=["warmth"])
        for site in sites[:2]:
            await _attach(a, principle, await _rating_id(a, site))
        a.as_("operator")
        resp = await a.http.post(f"{API}/principles/{principle}/approve")
        assert (
            resp.status_code == 409
            and resp.json()["error"] == "counterexample_required"
        )
        await _attach(
            a, principle, await _rating_id(a, sites[7], 2), role="counterexample"
        )
        assert (await a.ok("POST", f"/principles/{principle}/approve"))[
            "status"
        ] == "approved"
