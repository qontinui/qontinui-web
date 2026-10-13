"""The content-addressed image store, end to end against real Postgres.

Plan ``2026-10-13-image-generation-and-visual-judgment`` Phase 13.

Layers:

* **Layer 0** — the ``web`` schema binding: the tables land in ``web``, the
  closed vocabularies agree, and the model's constraints bite in the database
  the suite runs against.
* **Layer 1** — upload: content addressing, idempotent re-upload, the format
  read from the bytes whatever the client claims, the size cap, refusals that
  store nothing.
* **Layer 2** — tenant isolation: another tenant's hash answers exactly like
  an unknown one, the same bytes are two objects, and no candidate route
  reaches across.
* **Layer 3** — the GET by hash: a presigned URL on S3, the authenticated
  content route on the local backend, and the content route itself.
* **Layer 4** — slot candidates: upsert, the one-choice rule, list by slot,
  withdrawal, and the race the partial unique index settles.
* **Layer 5** — the real app's wiring: the routes are mounted and the real
  tenant dependency is live. (The upload's body cap, through the same real
  stack, is ``tests/test_body_limit_real_stack.py``.)

The tenant dependency, ``get_memory_tenant``, is overridden at the route
boundary with a principal per tenant — resolving a real one needs coord's
JWKS; its own logic is ``tests/test_memory_auth.py``'s, and this phase leaves
it unchanged. Layer 5 shows the real app routes through it.
"""

from __future__ import annotations

import asyncio
import hashlib
import io
import json
from collections.abc import AsyncIterator, Iterator
from datetime import UTC, datetime, timedelta
from pathlib import Path
from types import SimpleNamespace
from typing import Any, get_args
from uuid import UUID, uuid4

import httpx
import pytest
import pytest_asyncio
from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from PIL import Image
from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.api.deps import get_async_db
from app.api.v1.endpoints import image_assets as endpoints
from app.api.v1.endpoints.memory import MemoryPrincipal, get_memory_tenant
from app.core.config import settings
from app.crud import image_assets as crud
from app.middleware.error_handler import (
    http_exception_handler,
    validation_exception_handler,
)
from app.models.image_asset import (
    IMAGE_ASSET_KINDS,
    SLOT_CANDIDATE_STATUSES,
    ImageAsset,
    ImageSlotCandidate,
)
from app.schemas.image_assets import ImageAssetKind, SlotCandidateStatus
from app.services.storage import LocalBackend, ObjectStorageService
from tests.test_image_sniff import encode, png_header_only, with_orientation
from tests.test_object_storage_content_addressed import fake_s3_backend

API = "/api/v1/image-assets"
SLOTS = f"{API}/slot-candidates"
REPO = "qontinui-web"
SLOT = "home.hero"

pytestmark = pytest.mark.asyncio


# ===========================================================================
# Harness
# ===========================================================================


class CountingLocalBackend(LocalBackend):
    """The real local backend, counting object writes."""

    def __init__(self, base_path: Path) -> None:
        super().__init__(base_path=base_path)
        self.writes: list[str] = []

    def upload_file(self, file_obj, key, content_type=None, metadata=None):  # type: ignore[no-untyped-def]
        self.writes.append(key)
        return super().upload_file(file_obj, key, content_type, metadata)


@pytest.fixture()
def storage(tmp_path: Path) -> ObjectStorageService:
    service = ObjectStorageService.__new__(ObjectStorageService)
    service.backend = CountingLocalBackend(tmp_path / "objects")
    return service


def _stored_files(storage: ObjectStorageService) -> list[Path]:
    root = Path(storage.backend.base_path)  # type: ignore[attr-defined]
    return sorted(p for p in root.rglob("*") if p.is_file())


def _build_app(
    *, db_session: Any, tenant_id: UUID, storage: ObjectStorageService
) -> FastAPI:
    """The image router with db, tenant and object store stubbed at the route
    boundary — and the production HTTP and validation error handlers, so
    refusals carry the shape a client sees (``error`` / ``message`` at the top
    level; a 422 that never echoes the request's input back)."""
    app = FastAPI()
    app.add_exception_handler(StarletteHTTPException, http_exception_handler)  # type: ignore[arg-type]
    app.add_exception_handler(RequestValidationError, validation_exception_handler)  # type: ignore[arg-type]

    async def _db() -> AsyncIterator[Any]:
        yield db_session

    app.dependency_overrides[get_async_db] = _db
    app.dependency_overrides[get_memory_tenant] = lambda: MemoryPrincipal(
        tenant_id=tenant_id, device_id=None, actor="device"
    )
    app.dependency_overrides[endpoints.get_object_storage] = lambda: storage
    app.include_router(endpoints.router, prefix=API)
    return app


def _client(app: FastAPI) -> httpx.AsyncClient:
    return httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    )


@pytest.fixture()
def tenant_a() -> UUID:
    return uuid4()


@pytest.fixture()
def tenant_b() -> UUID:
    return uuid4()


@pytest_asyncio.fixture()
async def client_a(
    async_db_session: AsyncSession, tenant_a: UUID, storage: ObjectStorageService
) -> AsyncIterator[httpx.AsyncClient]:
    app = _build_app(db_session=async_db_session, tenant_id=tenant_a, storage=storage)
    async with _client(app) as client:
        yield client


@pytest_asyncio.fixture()
async def client_b(
    async_db_session: AsyncSession, tenant_b: UUID, storage: ObjectStorageService
) -> AsyncIterator[httpx.AsyncClient]:
    app = _build_app(db_session=async_db_session, tenant_id=tenant_b, storage=storage)
    async with _client(app) as client:
        yield client


async def _upload(
    client: httpx.AsyncClient,
    data: bytes,
    *,
    kind: str = "candidate",
    provenance: Any = None,
    filename: str = "upload.bin",
    content_type: str = "application/octet-stream",
) -> httpx.Response:
    form: dict[str, str] = {"kind": kind}
    if provenance is not None:
        form["provenance"] = (
            provenance if isinstance(provenance, str) else json.dumps(provenance)
        )
    return await client.post(
        API, data=form, files={"file": (filename, data, content_type)}
    )


async def _put(client: httpx.AsyncClient, **body: Any) -> httpx.Response:
    payload = {"repo": REPO, "slot_id": SLOT, "status": "candidate", **body}
    return await client.put(SLOTS, json=payload)


async def _list(client: httpx.AsyncClient, **params: Any) -> httpx.Response:
    return await client.get(SLOTS, params={"repo": REPO, "slot_id": SLOT, **params})


async def _rows(db: AsyncSession, tenant_id: UUID) -> list[ImageAsset]:
    result = await db.execute(
        select(ImageAsset)
        .where(ImageAsset.tenant_id == tenant_id)
        .execution_options(populate_existing=True)
    )
    return list(result.scalars())


def _png(seed: int = 0, size: tuple[int, int] = (7, 5)) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", size, (seed % 256, 40, 90)).save(buf, format="PNG")
    return buf.getvalue()


def _sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


# ===========================================================================
# Layer 0 — the schema binding
# ===========================================================================


class TestSchemaBinding:
    async def test_tables_land_in_the_web_schema(
        self, async_db_session: AsyncSession
    ) -> None:
        rows = (
            (
                await async_db_session.execute(
                    text(
                        """
                        SELECT table_name FROM information_schema.tables
                         WHERE table_schema = 'web'
                           AND table_name IN ('image_assets', 'image_slot_candidates')
                        """
                    )
                )
            )
            .scalars()
            .all()
        )
        assert set(rows) == {"image_assets", "image_slot_candidates"}

    async def test_the_api_vocabularies_are_the_tables(self) -> None:
        assert get_args(ImageAssetKind) == IMAGE_ASSET_KINDS
        assert get_args(SlotCandidateStatus) == SLOT_CANDIDATE_STATUSES

    @pytest.mark.parametrize(
        ("field", "value", "constraint"),
        [
            ("kind", "thumbnail", "ck_image_assets_kind"),
            ("orientation", 9, "ck_image_assets_orientation"),
        ],
    )
    async def test_a_check_bites_in_the_test_database(
        self,
        async_db_session: AsyncSession,
        tenant_a: UUID,
        field: str,
        value: Any,
        constraint: str,
    ) -> None:
        row: dict[str, Any] = {
            "tenant_id": tenant_a,
            "sha256": "a" * 64,
            "storage_key": "k",
            "mime_type": "image/png",
            "width": 1,
            "height": 1,
            "byte_size": 1,
            "kind": "candidate",
            field: value,
        }
        # A SAVEPOINT: the refusal rolls back only itself, never the
        # fixture's outer transaction.
        with pytest.raises(IntegrityError) as excinfo:
            async with async_db_session.begin_nested():
                async_db_session.add(ImageAsset(**row))
        assert constraint in str(excinfo.value)

    async def test_the_composite_fk_refuses_a_cross_tenant_candidate(
        self, async_db_session: AsyncSession, tenant_a: UUID, tenant_b: UUID
    ) -> None:
        async_db_session.add(
            ImageAsset(
                tenant_id=tenant_a,
                sha256="b" * 64,
                storage_key="k",
                mime_type="image/png",
                width=1,
                height=1,
                byte_size=1,
                kind="candidate",
            )
        )
        await async_db_session.flush()
        with pytest.raises(IntegrityError) as excinfo:
            async with async_db_session.begin_nested():
                async_db_session.add(
                    ImageSlotCandidate(
                        tenant_id=tenant_b,
                        repo=REPO,
                        slot_id=SLOT,
                        asset_sha256="b" * 64,
                    )
                )
        assert "fk_image_slot_candidates_asset" in str(excinfo.value)


# ===========================================================================
# Layer 1 — upload
# ===========================================================================


class TestUpload:
    async def test_the_image_is_stored_under_the_hash_of_its_bytes(
        self,
        client_a: httpx.AsyncClient,
        tenant_a: UUID,
        storage: ObjectStorageService,
        async_db_session: AsyncSession,
    ) -> None:
        data = _png()
        resp = await _upload(client_a, data, provenance={"model": "z-image-turbo"})
        assert resp.status_code == 201, resp.text
        body = resp.json()
        digest = _sha(data)
        assert body["sha256"] == digest
        assert body["created"] is True
        assert (body["mime_type"], body["width"], body["height"]) == ("image/png", 7, 5)
        assert body["byte_size"] == len(data)
        assert body["kind"] == "candidate"
        assert body["provenance"] == {"model": "z-image-turbo"}
        assert body["orientation"] is None
        assert body["conflicts"] == []
        assert "storage_key" not in body

        key = f"image-assets/{tenant_a}/sha256/{digest[:2]}/{digest}.png"
        [row] = await _rows(async_db_session, tenant_a)
        assert row.storage_key == key
        stored = Path(storage.backend.base_path) / key  # type: ignore[attr-defined]
        assert stored.read_bytes() == data

    async def test_a_quarter_turned_photo_is_recorded_at_its_displayed_size(
        self,
        client_a: httpx.AsyncClient,
        tenant_a: UUID,
        storage: ObjectStorageService,
        async_db_session: AsyncSession,
    ) -> None:
        """A 40×20 JPEG tagged EXIF orientation 6 is SHOWN 20×40, so the record
        says 20×40 and orientation 6 — while the stored object is the uploaded
        bytes, unrotated: the store records how an image displays, it never
        re-encodes one."""
        data = with_orientation("JPEG", (40, 20), 6)
        resp = await _upload(client_a, data)
        assert resp.status_code == 201, resp.text
        body = resp.json()
        assert (body["width"], body["height"], body["orientation"]) == (20, 40, 6)

        [row] = await _rows(async_db_session, tenant_a)
        assert (row.width, row.height, row.orientation) == (20, 40, 6)
        stored = Path(storage.backend.base_path) / row.storage_key  # type: ignore[attr-defined]
        assert stored.read_bytes() == data

    async def test_the_same_bytes_again_are_the_same_asset_and_no_write(
        self,
        client_a: httpx.AsyncClient,
        tenant_a: UUID,
        storage: ObjectStorageService,
        async_db_session: AsyncSession,
    ) -> None:
        data = _png()
        first = await _upload(client_a, data)
        second = await _upload(client_a, data)
        assert (first.status_code, second.status_code) == (201, 200)
        assert second.json()["created"] is False
        assert second.json()["sha256"] == first.json()["sha256"]
        assert second.json()["created_at"] == first.json()["created_at"]
        assert len(storage.backend.writes) == 1  # type: ignore[attr-defined]
        assert len(await _rows(async_db_session, tenant_a)) == 1

    async def test_a_re_upload_keeps_the_first_kind_and_only_adds_provenance(
        self, client_a: httpx.AsyncClient
    ) -> None:
        data = _png()
        first = (
            await _upload(client_a, data, provenance={"seed": 1, "ai_generated": True})
        ).json()
        assert first["conflicts"] == []
        again = await _upload(
            client_a, data, kind="exemplar", provenance={"seed": 2, "model": "zit"}
        )
        assert again.status_code == 200
        body = again.json()
        assert body["kind"] == "candidate"
        assert body["provenance"] == {"seed": 1, "ai_generated": True, "model": "zit"}
        # What it sent but could not apply is named, not silently dropped.
        assert body["conflicts"] == ["kind", "provenance.seed"]
        assert body["updated_at"] > first["updated_at"]
        # Nothing new: nothing moves and nothing conflicts.
        same = (await _upload(client_a, data, provenance={"model": "zit"})).json()
        assert same["conflicts"] == []
        assert same["updated_at"] == body["updated_at"]

    async def test_a_later_upload_cannot_drop_the_ai_generated_marker(
        self, client_a: httpx.AsyncClient
    ) -> None:
        data = _png()
        marked = {
            "iptc": {"digital_source_type": "trainedAlgorithmicMedia"},
            "provider": "local-gpu",
        }
        await _upload(client_a, data, provenance=marked)
        relabelled = await _upload(
            client_a,
            data,
            provenance={"iptc": {"digital_source_type": "digitalCapture"}},
        )
        assert relabelled.json()["provenance"] == marked
        assert relabelled.json()["conflicts"] == ["provenance.iptc.digital_source_type"]
        emptied = (await _upload(client_a, data, provenance={})).json()
        assert emptied["provenance"] == marked
        assert emptied["conflicts"] == []

    @pytest.mark.parametrize(
        "provenance",
        [
            '{"seed": NaN}',
            '{"seed": -Infinity}',
            '{"note": "a\\u0000b"}',
            '{"a\\u0000": 1}',
            '{"note": "x\\ud800y"}',
        ],
        ids=["nan", "infinity", "nul-in-value", "nul-in-key", "lone-surrogate"],
    )
    async def test_provenance_json_storage_cannot_hold_is_refused_before_any_write(
        self,
        client_a: httpx.AsyncClient,
        tenant_a: UUID,
        storage: ObjectStorageService,
        async_db_session: AsyncSession,
        provenance: str,
    ) -> None:
        """Python's JSON reader accepts these; PostgreSQL's JSONB does not. They
        are a 422 at the door — never a 500 after the object is stored."""
        resp = await _upload(client_a, _png(), provenance=provenance)
        assert resp.status_code == 422, resp.text
        assert resp.json()["error"] == "provenance_invalid"
        assert _stored_files(storage) == []
        assert await _rows(async_db_session, tenant_a) == []

    @pytest.mark.parametrize(
        ("pillow_format", "claimed_name", "claimed_type", "mime", "ext"),
        [
            ("PNG", "photo.jpg", "image/jpeg", "image/png", ".png"),
            ("JPEG", "icon.png", "image/png", "image/jpeg", ".jpg"),
            ("WEBP", "anim.gif", "image/gif", "image/webp", ".webp"),
            ("AVIF", "x.png", "image/png", "image/avif", ".avif"),
        ],
        ids=["png-as-jpeg", "jpeg-as-png", "webp-as-gif", "avif-as-png"],
    )
    async def test_the_format_comes_from_the_bytes_not_the_client(
        self,
        client_a: httpx.AsyncClient,
        tenant_a: UUID,
        async_db_session: AsyncSession,
        pillow_format: str,
        claimed_name: str,
        claimed_type: str,
        mime: str,
        ext: str,
    ) -> None:
        data = encode(pillow_format)
        resp = await _upload(
            client_a, data, filename=claimed_name, content_type=claimed_type
        )
        assert resp.status_code == 201, resp.text
        assert resp.json()["mime_type"] == mime
        [row] = await _rows(async_db_session, tenant_a)
        assert row.mime_type == mime
        assert row.storage_key.endswith(f"{_sha(data)}{ext}")

    async def test_bytes_that_are_no_accepted_image_are_refused_and_not_stored(
        self,
        client_a: httpx.AsyncClient,
        tenant_a: UUID,
        storage: ObjectStorageService,
        async_db_session: AsyncSession,
    ) -> None:
        html = b"<!doctype html><script>alert(1)</script>"
        resp = await _upload(client_a, html, filename="x.png", content_type="image/png")
        assert resp.status_code == 415
        body = resp.json()
        assert body["error"] == "image_unsupported_format"
        assert body["accepted"] == [
            "image/png",
            "image/jpeg",
            "image/gif",
            "image/webp",
            "image/avif",
        ]
        assert _stored_files(storage) == []
        assert await _rows(async_db_session, tenant_a) == []

    @pytest.mark.parametrize(
        ("data", "code"),
        [
            (b"", "image_empty"),
            (b"\x89PNG\r\n\x1a\n" + b"no header here", "image_unreadable"),
            (png_header_only(10_000, 10_000), "image_too_many_pixels"),
        ],
        ids=["empty", "unreadable", "too-many-pixels"],
    )
    async def test_unusable_images_are_422_and_not_stored(
        self,
        client_a: httpx.AsyncClient,
        tenant_a: UUID,
        storage: ObjectStorageService,
        async_db_session: AsyncSession,
        data: bytes,
        code: str,
    ) -> None:
        resp = await _upload(client_a, data)
        assert resp.status_code == 422, resp.text
        assert resp.json()["error"] == code
        assert _stored_files(storage) == []
        assert await _rows(async_db_session, tenant_a) == []

    async def test_the_size_cap_is_exact_and_an_oversized_image_is_not_stored(
        self,
        client_a: httpx.AsyncClient,
        tenant_a: UUID,
        storage: ObjectStorageService,
        async_db_session: AsyncSession,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        # Trailing bytes after IEND leave a valid PNG of any chosen length.
        data = _png() + b"\x00" * 100
        monkeypatch.setattr(endpoints, "MAX_IMAGE_BYTES", len(data) - 1)
        over = await _upload(client_a, data)
        assert over.status_code == 413
        assert over.json()["error"] == "image_too_large"
        assert over.json()["max_bytes"] == len(data) - 1
        # The same keys BodyLimitMiddleware's refusal carries
        # (tests/test_body_limit_real_stack.py): one 413 shape.
        assert set(over.json()) == {
            "error",
            "message",
            "max_bytes",
            "timestamp",
            "path",
        }
        assert _stored_files(storage) == []
        assert await _rows(async_db_session, tenant_a) == []

        monkeypatch.setattr(endpoints, "MAX_IMAGE_BYTES", len(data))
        at_cap = await _upload(client_a, data)
        assert at_cap.status_code == 201, at_cap.text

    @pytest.mark.parametrize(
        "provenance",
        ["[1, 2]", "{not json", '"a string"', json.dumps({"x": "y" * 70_000})],
        ids=["array", "malformed", "string", "oversized"],
    )
    async def test_provenance_must_be_a_json_object(
        self, client_a: httpx.AsyncClient, provenance: str
    ) -> None:
        resp = await _upload(client_a, _png(), provenance=provenance)
        assert resp.status_code == 422
        assert resp.json()["error"] == "provenance_invalid"

    async def test_kind_is_a_closed_set(self, client_a: httpx.AsyncClient) -> None:
        resp = await _upload(client_a, _png(), kind="thumbnail")
        assert resp.status_code == 422


# ===========================================================================
# Layer 2 — tenant isolation
# ===========================================================================


class TestTenantIsolation:
    async def test_another_tenant_cannot_read_the_hash(
        self, client_a: httpx.AsyncClient, client_b: httpx.AsyncClient
    ) -> None:
        digest = (await _upload(client_a, _png())).json()["sha256"]
        assert (await client_a.get(f"{API}/{digest}")).status_code == 200
        foreign = await client_b.get(f"{API}/{digest}")
        assert foreign.status_code == 404
        assert foreign.json()["error"] == "image_asset_not_found"

    async def test_a_foreign_hash_answers_exactly_like_an_unknown_one(
        self, client_a: httpx.AsyncClient, client_b: httpx.AsyncClient
    ) -> None:
        """The 404 must not leak that ANOTHER tenant holds the image."""
        digest = (await _upload(client_a, _png())).json()["sha256"]
        foreign = await client_b.get(f"{API}/{digest}")
        unknown = await client_b.get(f"{API}/{'0' * 64}")
        assert foreign.status_code == unknown.status_code == 404
        strip = ("timestamp", "path")
        assert {k: v for k, v in foreign.json().items() if k not in strip} == {
            k: v for k, v in unknown.json().items() if k not in strip
        }

    async def test_the_same_bytes_for_two_tenants_are_two_assets_and_two_objects(
        self,
        client_a: httpx.AsyncClient,
        client_b: httpx.AsyncClient,
        tenant_a: UUID,
        tenant_b: UUID,
        storage: ObjectStorageService,
        async_db_session: AsyncSession,
    ) -> None:
        data = _png()
        a = await _upload(client_a, data)
        b = await _upload(client_b, data)
        # B is told it CREATED its asset: a 200 here would reveal that some
        # other tenant already held these bytes.
        assert (a.status_code, b.status_code) == (201, 201)
        assert b.json()["created"] is True
        [row_a] = await _rows(async_db_session, tenant_a)
        [row_b] = await _rows(async_db_session, tenant_b)
        assert row_a.storage_key != row_b.storage_key
        assert str(tenant_a) in row_a.storage_key
        assert str(tenant_b) in row_b.storage_key
        assert len(_stored_files(storage)) == 2
        # Each tenant reads its OWN object through the tenant-checked content
        # route the local backend's URL points at.
        for client in (client_a, client_b):
            url = (await client.get(f"{API}/{_sha(data)}")).json()["url"]
            assert url.endswith(f"/image-assets/{_sha(data)}/content")
            assert (await client.get(url)).content == data

    async def test_no_candidate_route_reaches_another_tenants_asset(
        self, client_a: httpx.AsyncClient, client_b: httpx.AsyncClient
    ) -> None:
        digest = (await _upload(client_a, _png())).json()["sha256"]
        assert (await _put(client_a, asset_sha256=digest)).status_code == 201

        proposed = await _put(client_b, asset_sha256=digest)
        assert proposed.status_code == 404
        assert proposed.json()["error"] == "image_asset_not_found"
        listed = (await _list(client_b)).json()
        assert listed["candidates"] == []
        withdrawn = await client_b.delete(
            SLOTS, params={"repo": REPO, "slot_id": SLOT, "asset_sha256": digest}
        )
        assert withdrawn.status_code == 404
        assert [
            c["asset_sha256"] for c in (await _list(client_a)).json()["candidates"]
        ] == [digest]


# ===========================================================================
# Layer 3 — the GET by hash: a presigned URL, or the content route
# ===========================================================================


class TestRead:
    async def test_get_returns_the_record_and_a_url_to_the_bytes(
        self, client_a: httpx.AsyncClient, tenant_a: UUID
    ) -> None:
        data = _png()
        uploaded = (await _upload(client_a, data, provenance={"seed": 7})).json()
        resp = await client_a.get(f"{API}/{uploaded['sha256']}")
        assert resp.status_code == 200
        body = resp.json()
        digest = _sha(data)
        for field in (
            "sha256",
            "kind",
            "mime_type",
            "width",
            "height",
            "orientation",
            "byte_size",
            "provenance",
        ):
            assert body[field] == uploaded[field]
        # NOT the unauthenticated /uploads static mount the local backend
        # stores under: this API's tenant-checked content route, which does
        # not expire — so no expiry time is claimed for it.
        assert body["url"] == (
            f"{settings.BACKEND_URL.rstrip('/')}{settings.API_V1_STR}"
            f"/image-assets/{digest}/content"
        )
        assert "/uploads/" not in body["url"]
        assert body["url_expires_at"] is None

    async def test_get_over_s3_returns_a_signed_url_that_expires(
        self, async_db_session: AsyncSession, tenant_a: UUID
    ) -> None:
        s3, client = fake_s3_backend()
        service = ObjectStorageService.__new__(ObjectStorageService)
        service.backend = s3
        app = _build_app(
            db_session=async_db_session, tenant_id=tenant_a, storage=service
        )
        async with _client(app) as http:
            digest = (await _upload(http, _png())).json()["sha256"]
            before = datetime.now(UTC)
            resp = await http.get(f"{API}/{digest}", params={"expires_in": 600})
        assert resp.status_code == 200
        body = resp.json()
        assert "X-Amz-Expires=600" in body["url"]
        assert (
            f"image-assets/{tenant_a}/sha256/{digest[:2]}/{digest}.png" in body["url"]
        )
        expires = datetime.fromisoformat(body["url_expires_at"])
        assert (
            before + timedelta(seconds=590)
            <= expires
            <= before + timedelta(seconds=660)
        )
        assert client.puts == 1

    @pytest.mark.parametrize(
        ("expires_in", "status"), [(59, 422), (604_801, 422), (604_800, 200)]
    )
    async def test_the_url_lifetime_is_bounded(
        self, client_a: httpx.AsyncClient, expires_in: int, status: int
    ) -> None:
        digest = (await _upload(client_a, _png())).json()["sha256"]
        resp = await client_a.get(f"{API}/{digest}", params={"expires_in": expires_in})
        assert resp.status_code == status

    @pytest.mark.parametrize("bad", ["A" * 64, "a" * 63, "g" * 64])
    async def test_the_hash_must_be_64_lowercase_hex(
        self, client_a: httpx.AsyncClient, bad: str
    ) -> None:
        assert (await client_a.get(f"{API}/{bad}")).status_code == 422

    async def test_an_unknown_query_key_is_refused_not_ignored(
        self, client_a: httpx.AsyncClient
    ) -> None:
        digest = (await _upload(client_a, _png())).json()["sha256"]
        resp = await client_a.get(f"{API}/{digest}", params={"expiry": 60})
        assert resp.status_code == 422
        assert resp.json()["error"] == "unknown_query_parameter"


# ===========================================================================
# Layer 4 — slot candidates
# ===========================================================================


class TestSlotCandidates:
    async def test_a_put_creates_then_moves_a_candidate(
        self, client_a: httpx.AsyncClient
    ) -> None:
        digest = (await _upload(client_a, _png())).json()["sha256"]
        created = await _put(
            client_a,
            asset_sha256=digest,
            recipe_hash="sha256:" + "c" * 64,
            values={"contrast": 4.6},
        )
        assert created.status_code == 201, created.text
        body = created.json()
        assert body["created"] is True and body["demoted"] == []
        candidate = body["candidate"]
        assert candidate["status"] == "candidate"
        assert candidate["values"] == {"contrast": 4.6}
        assert candidate["judge"] == {}
        assert candidate["asset"]["sha256"] == digest
        assert candidate["asset"]["mime_type"] == "image/png"

        moved = await _put(client_a, asset_sha256=digest, status="rejected")
        assert moved.status_code == 200
        assert moved.json()["created"] is False
        assert moved.json()["candidate"]["status"] == "rejected"
        # Omitted fields are kept.
        assert moved.json()["candidate"]["values"] == {"contrast": 4.6}
        assert moved.json()["candidate"]["recipe_hash"] == "sha256:" + "c" * 64

    async def test_sent_fields_replace_and_a_null_recipe_hash_clears(
        self, client_a: httpx.AsyncClient
    ) -> None:
        digest = (await _upload(client_a, _png())).json()["sha256"]
        await _put(client_a, asset_sha256=digest, recipe_hash="r1", values={"a": 1})
        resp = await _put(
            client_a,
            asset_sha256=digest,
            recipe_hash=None,
            values={"b": 2},
            judge={"votes": [{"judge": "local-vlm", "pick": True}]},
        )
        candidate = resp.json()["candidate"]
        assert candidate["recipe_hash"] is None
        assert candidate["values"] == {"b": 2}
        assert candidate["judge"] == {"votes": [{"judge": "local-vlm", "pick": True}]}

    async def test_choosing_returns_the_previous_choice_to_candidate(
        self, client_a: httpx.AsyncClient
    ) -> None:
        first = (await _upload(client_a, _png(1))).json()["sha256"]
        second = (await _upload(client_a, _png(2))).json()["sha256"]
        one = await _put(client_a, asset_sha256=first, status="chosen")
        assert one.json()["demoted"] == []
        two = await _put(client_a, asset_sha256=second, status="chosen")
        assert two.json()["demoted"] == [
            {
                "asset_sha256": first,
                "status_before": "chosen",
                "status_after": "candidate",
            }
        ]
        statuses = {
            c["asset_sha256"]: c["status"]
            for c in (await _list(client_a)).json()["candidates"]
        }
        assert statuses == {first: "candidate", second: "chosen"}
        # Choosing the current choice again moves nothing.
        again = await _put(client_a, asset_sha256=second, status="chosen")
        assert again.status_code == 200 and again.json()["demoted"] == []

    async def test_a_choice_in_one_slot_leaves_other_slots_alone(
        self, client_a: httpx.AsyncClient
    ) -> None:
        digest = (await _upload(client_a, _png())).json()["sha256"]
        other = (await _upload(client_a, _png(9))).json()["sha256"]
        await _put(
            client_a, asset_sha256=digest, status="chosen", slot_id="home.footer"
        )
        resp = await _put(client_a, asset_sha256=other, status="chosen")
        assert resp.json()["demoted"] == []
        footer = (await _list(client_a, slot_id="home.footer")).json()["candidates"]
        assert [c["status"] for c in footer] == ["chosen"]

    async def test_list_by_slot_is_oldest_first_filters_and_says_when_truncated(
        self, client_a: httpx.AsyncClient
    ) -> None:
        hashes = [(await _upload(client_a, _png(i))).json()["sha256"] for i in range(3)]
        for digest, status in zip(
            hashes, ["candidate", "rejected", "chosen"], strict=True
        ):
            await _put(client_a, asset_sha256=digest, status=status)

        listed = (await _list(client_a)).json()
        assert [c["asset_sha256"] for c in listed["candidates"]] == hashes
        assert listed["truncated"] is False
        assert (listed["repo"], listed["slot_id"], listed["status"]) == (
            REPO,
            SLOT,
            None,
        )

        rejected = (await _list(client_a, status="rejected")).json()
        assert [c["asset_sha256"] for c in rejected["candidates"]] == [hashes[1]]
        assert rejected["status"] == "rejected"

        page = (await _list(client_a, limit=2)).json()
        assert [c["asset_sha256"] for c in page["candidates"]] == hashes[:2]
        assert page["truncated"] is True and page["limit"] == 2

    async def test_an_empty_slot_is_an_empty_list_with_its_query_echoed(
        self, client_a: httpx.AsyncClient
    ) -> None:
        body = (await _list(client_a, slot_id="never.used")).json()
        assert body["candidates"] == []
        assert body["slot_id"] == "never.used"
        assert body["truncated"] is False

    async def test_a_wrong_query_key_is_refused_not_ignored(
        self, client_a: httpx.AsyncClient
    ) -> None:
        resp = await _list(client_a, state="chosen")
        assert resp.status_code == 422
        assert resp.json()["error"] == "unknown_query_parameter"
        assert "status" in resp.json()["accepted"]

    async def test_slot_candidates_is_never_read_as_a_hash(
        self, client_a: httpx.AsyncClient
    ) -> None:
        """The literal path is declared before ``/{sha256}``."""
        resp = await _list(client_a)
        assert resp.status_code == 200
        assert "candidates" in resp.json()

    async def test_withdrawing_a_candidate_keeps_the_asset(
        self, client_a: httpx.AsyncClient
    ) -> None:
        digest = (await _upload(client_a, _png())).json()["sha256"]
        await _put(client_a, asset_sha256=digest)
        params = {"repo": REPO, "slot_id": SLOT, "asset_sha256": digest}
        gone = await client_a.delete(SLOTS, params=params)
        assert gone.status_code == 204
        assert (await _list(client_a)).json()["candidates"] == []
        assert (await client_a.get(f"{API}/{digest}")).status_code == 200
        again = await client_a.delete(SLOTS, params=params)
        assert again.status_code == 404
        assert again.json()["error"] == "slot_candidate_not_found"

    async def test_a_candidate_needs_an_asset_the_tenant_holds(
        self, client_a: httpx.AsyncClient
    ) -> None:
        resp = await _put(client_a, asset_sha256="1" * 64)
        assert resp.status_code == 404
        assert resp.json()["error"] == "image_asset_not_found"

    @pytest.mark.parametrize(
        "body",
        [
            {"values": {"x": "y" * 70_000}},
            {"judge": {"x": "y" * 70_000}},
            {"values": None},
            {"values": [1, 2]},
            {"status": "picked"},
            {"repo": "has space"},
            {"slot_id": "../up"},
            {"recipe_hash": ""},
            {"tenant_id": "00000000-0000-0000-0000-000000000000"},
        ],
        ids=[
            "values-too-large",
            "judge-too-large",
            "values-null",
            "values-array",
            "status-unknown",
            "repo-pattern",
            "slot-pattern",
            "recipe-empty",
            "tenant-in-body",
        ],
    )
    async def test_the_put_body_is_validated(
        self, client_a: httpx.AsyncClient, body: dict[str, Any]
    ) -> None:
        digest = (await _upload(client_a, _png())).json()["sha256"]
        resp = await _put(client_a, asset_sha256=digest, **body)
        assert resp.status_code == 422, resp.text

    async def test_a_conflicting_write_is_a_409_not_a_500(
        self,
        tenant_a: UUID,
        storage: ObjectStorageService,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """The race itself is ``test_two_choices_racing_meet_the_index``; this
        pins what the route answers when it happens. A stub session keeps the
        handler's rollback away from the shared test transaction."""

        async def asset(*_: Any, **__: Any) -> Any:
            return SimpleNamespace(sha256="2" * 64)

        async def conflict(*_: Any, **__: Any) -> Any:
            raise IntegrityError(
                "INSERT", {}, Exception("uq_image_slot_candidates_one_chosen")
            )

        monkeypatch.setattr(crud, "get_asset", asset)
        monkeypatch.setattr(crud, "upsert_slot_candidate", conflict)
        rolled_back: list[bool] = []

        async def rollback() -> None:
            rolled_back.append(True)

        session = SimpleNamespace(rollback=rollback)
        app = _build_app(db_session=session, tenant_id=tenant_a, storage=storage)
        async with _client(app) as http:
            resp = await _put(http, asset_sha256="2" * 64, status="chosen")
        assert resp.status_code == 409
        assert resp.json()["error"] == "slot_candidate_conflict"
        assert rolled_back == [True]


@pytest_asyncio.fixture()
async def committed_tenant(test_engine: Any) -> AsyncIterator[UUID]:
    """A tenant whose rows really COMMIT (the race needs two transactions),
    deleted again afterwards whatever the test did."""
    tenant = uuid4()
    yield tenant
    async with test_engine.begin() as conn:
        await conn.execute(
            text("DELETE FROM web.image_slot_candidates WHERE tenant_id = :t"),
            {"t": tenant},
        )
        await conn.execute(
            text("DELETE FROM web.image_assets WHERE tenant_id = :t"), {"t": tenant}
        )


async def test_two_choices_racing_meet_the_index(
    test_engine: Any, committed_tenant: UUID
) -> None:
    """Two transactions choose two different candidates of one slot at once.

    Neither can see the other's uncommitted choice, so neither demotion finds
    it; the partial unique index is what decides. The second insert waits on
    the first transaction, and when that commits it fails — it does not
    produce a slot with two choices.
    """
    from sqlalchemy.ext.asyncio import async_sessionmaker

    tenant = committed_tenant
    maker = async_sessionmaker(test_engine, expire_on_commit=False)
    hashes = ["3" * 64, "4" * 64]
    async with maker() as setup:
        for digest in hashes:
            await crud.upsert_asset(
                setup,
                tenant_id=tenant,
                sha256=digest,
                storage_key=f"image-assets/{tenant}/sha256/{digest[:2]}/{digest}.png",
                mime_type="image/png",
                width=1,
                height=1,
                byte_size=1,
                kind="candidate",
                provenance=None,
                orientation=None,
            )
        await setup.commit()

    async with maker() as first, maker() as second:
        await crud.upsert_slot_candidate(
            first,
            tenant_id=tenant,
            repo=REPO,
            slot_id=SLOT,
            asset_sha256=hashes[0],
            status="chosen",
        )
        second_pid = (
            await second.execute(text("SELECT pg_backend_pid()"))
        ).scalar_one()
        racing = asyncio.create_task(
            crud.upsert_slot_candidate(
                second,
                tenant_id=tenant,
                repo=REPO,
                slot_id=SLOT,
                asset_sha256=hashes[1],
                status="chosen",
            )
        )
        # Commit the first only once the second is provably WAITING on it —
        # i.e. past its own demotion (which could not see the uncommitted
        # choice) and blocked inside the INSERT. Committing earlier would let
        # the second's demotion see the first choice and legitimately move
        # it, which is the non-racing path the other tests cover.
        async with test_engine.connect() as observer:
            for _ in range(200):
                waiting = (
                    await observer.execute(
                        text(
                            "SELECT wait_event_type = 'Lock' "
                            "AND query LIKE 'INSERT INTO web.image_slot_candidates%' "
                            "FROM pg_stat_activity WHERE pid = :pid"
                        ),
                        {"pid": second_pid},
                    )
                ).scalar_one_or_none()
                if waiting or racing.done():
                    break
                await asyncio.sleep(0.05)
        assert waiting, "the second insert never blocked on the first transaction"
        assert not racing.done()
        await first.commit()
        with pytest.raises(IntegrityError) as excinfo:
            await racing
        assert "uq_image_slot_candidates_one_chosen" in str(excinfo.value)
        await second.rollback()

    async with maker() as check:
        rows = (
            (
                await check.execute(
                    text(
                        "SELECT asset_sha256 FROM web.image_slot_candidates "
                        "WHERE tenant_id = :t AND status = 'chosen'"
                    ),
                    {"t": tenant},
                )
            )
            .scalars()
            .all()
        )
    assert list(rows) == [hashes[0]]


# ===========================================================================
# Layer 5 — the real app's wiring
# ===========================================================================


@pytest.fixture()
def real_app() -> Iterator[FastAPI]:
    from app.main import app

    yield app


async def test_the_routes_are_mounted_on_the_real_app(real_app: FastAPI) -> None:
    from fastapi.routing import APIRoute

    routes = [
        (method, route.path)
        for route in real_app.routes
        if isinstance(route, APIRoute) and route.path.startswith(API)
        for method in sorted(route.methods or ())
    ]
    assert set(routes) >= {
        ("POST", API),
        ("GET", SLOTS),
        ("PUT", SLOTS),
        ("DELETE", SLOTS),
        ("GET", f"{API}/{{sha256}}"),
        ("GET", f"{API}/{{sha256}}/content"),
    }
    paths = [path for _method, path in routes]
    assert paths.index(SLOTS) < paths.index(f"{API}/{{sha256}}")


async def test_the_real_app_runs_the_real_tenant_dependency(real_app: FastAPI) -> None:
    async with _client(real_app) as http:
        resp = await http.get(f"{API}/{'5' * 64}")
    assert resp.status_code == 401
    # get_memory_tenant's own refusal, not some other layer's.
    assert resp.json()["message"] == "Authentication required."


# The upload's request-body cap — refused before parsing on a declared length,
# and at the cap on a chunked body — is driven through this real stack, for
# every capped route, by ``tests/test_body_limit_real_stack.py``.


# ===========================================================================
# Review round 1 — the content route, credential lifetimes, paging, JSON
# storage, concurrent uploads
# ===========================================================================


class TestContentRoute:
    async def test_the_bytes_are_served_to_their_tenant_only(
        self, client_a: httpx.AsyncClient, client_b: httpx.AsyncClient
    ) -> None:
        data = _png()
        digest = (await _upload(client_a, data)).json()["sha256"]
        url = (await client_a.get(f"{API}/{digest}")).json()["url"]
        resp = await client_a.get(url)
        assert resp.status_code == 200
        assert resp.content == data
        assert resp.headers["content-type"] == "image/png"
        assert resp.headers["etag"] == f'"{digest}"'
        assert resp.headers["cache-control"].startswith("private")
        # Another tenant's probe answers exactly what an unknown hash does.
        foreign = await client_b.get(f"{API}/{digest}/content")
        unknown = await client_b.get(f"{API}/{'0' * 64}/content")
        assert foreign.status_code == unknown.status_code == 404
        strip = ("timestamp", "path")
        assert {k: v for k, v in foreign.json().items() if k not in strip} == {
            k: v for k, v in unknown.json().items() if k not in strip
        }

    async def test_a_record_whose_bytes_are_gone_is_a_typed_500(
        self, client_a: httpx.AsyncClient, storage: ObjectStorageService
    ) -> None:
        digest = (await _upload(client_a, _png())).json()["sha256"]
        for path in _stored_files(storage):
            path.unlink()
        resp = await client_a.get(f"{API}/{digest}/content")
        assert resp.status_code == 500
        assert resp.json()["error"] == "image_object_missing"

    async def test_the_content_route_reads_through_s3_too(
        self, async_db_session: AsyncSession, tenant_a: UUID
    ) -> None:
        s3, _s3_client = fake_s3_backend()
        service = ObjectStorageService.__new__(ObjectStorageService)
        service.backend = s3
        app = _build_app(
            db_session=async_db_session, tenant_id=tenant_a, storage=service
        )
        data = _png(3)
        async with _client(app) as http:
            digest = (await _upload(http, data)).json()["sha256"]
            resp = await http.get(f"{API}/{digest}/content")
        assert resp.status_code == 200 and resp.content == data


async def test_a_presigned_urls_expiry_is_capped_by_its_signing_credential(
    async_db_session: AsyncSession, tenant_a: UUID
) -> None:
    """A presigned URL dies with the temporary credential that signed it, so
    the expiry reported is the earlier of the two."""
    s3, client = fake_s3_backend()
    credential_expiry = datetime.now(UTC) + timedelta(minutes=5)
    client._request_signer = SimpleNamespace(  # type: ignore[attr-defined]
        _credentials=SimpleNamespace(_expiry_time=credential_expiry)
    )
    service = ObjectStorageService.__new__(ObjectStorageService)
    service.backend = s3
    app = _build_app(db_session=async_db_session, tenant_id=tenant_a, storage=service)
    async with _client(app) as http:
        digest = (await _upload(http, _png())).json()["sha256"]
        long_lived = await http.get(f"{API}/{digest}", params={"expires_in": 3600})
        short = await http.get(f"{API}/{digest}", params={"expires_in": 120})
    assert (
        datetime.fromisoformat(long_lived.json()["url_expires_at"]) == credential_expiry
    )
    assert datetime.fromisoformat(short.json()["url_expires_at"]) < credential_expiry


class TestPaging:
    async def _slot_of(self, client: httpx.AsyncClient, n: int) -> list[str]:
        hashes = [(await _upload(client, _png(i))).json()["sha256"] for i in range(n)]
        for digest in hashes:
            assert (await _put(client, asset_sha256=digest)).status_code == 201
        return hashes

    @pytest.mark.parametrize("order", ["oldest", "newest"])
    async def test_next_cursor_walks_every_row_once_in_either_order(
        self, client_a: httpx.AsyncClient, order: str
    ) -> None:
        hashes = await self._slot_of(client_a, 5)
        expected = hashes if order == "oldest" else hashes[::-1]
        seen: list[str] = []
        cursor: str | None = None
        pages = 0
        while True:
            params: dict[str, Any] = {"limit": 2, "order": order}
            if cursor is not None:
                params["after"] = cursor
            page = (await _list(client_a, **params)).json()
            pages += 1
            assert page["order"] == order
            assert (page["next_cursor"] is not None) == page["truncated"]
            seen += [c["asset_sha256"] for c in page["candidates"]]
            if not page["truncated"]:
                break
            cursor = page["next_cursor"]
        assert seen == expected
        assert pages == 3

    async def test_a_cursor_is_refused_in_the_other_order_or_malformed(
        self, client_a: httpx.AsyncClient
    ) -> None:
        await self._slot_of(client_a, 3)
        cursor = (await _list(client_a, limit=1)).json()["next_cursor"]
        assert cursor is not None
        wrong_order = await _list(client_a, limit=1, order="newest", after=cursor)
        assert wrong_order.status_code == 422
        assert wrong_order.json()["error"] == "invalid_cursor"
        garbled = await _list(client_a, after="not-a-cursor")
        assert garbled.status_code == 422
        assert garbled.json()["error"] == "invalid_cursor"


@pytest.mark.parametrize(
    ("extra", "reason"),
    [
        ({"values": {"contrast": float("nan")}}, "JSON storage cannot hold"),
        ({"judge": {"margin": float("inf")}}, "JSON storage cannot hold"),
        ({"values": {"note": "x\x00y"}}, "JSON storage cannot hold"),
        ({"values": {"note": "x\ud800y"}}, "lone surrogate"),
        ({"judge": {"\udc00": 1}}, "lone surrogate"),
    ],
    ids=[
        "values-nan",
        "judge-infinity",
        "values-nul",
        "values-lone-surrogate",
        "judge-key-lone-surrogate",
    ],
)
async def test_values_json_storage_cannot_hold_are_a_422_not_a_500(
    client_a: httpx.AsyncClient, extra: dict[str, Any], reason: str
) -> None:
    digest = (await _upload(client_a, _png())).json()["sha256"]
    # json.dumps writes NaN / Infinity tokens and \ud800-style escapes, as a
    # client's encoder may; httpx's own refuses NaN, so the body is encoded
    # here.
    body = json.dumps(
        {
            "repo": REPO,
            "slot_id": SLOT,
            "asset_sha256": digest,
            "status": "candidate",
            **extra,
        }
    )
    resp = await client_a.put(
        SLOTS, content=body, headers={"content-type": "application/json"}
    )
    assert resp.status_code == 422, resp.text
    assert reason in resp.text
    assert (await _list(client_a)).json()["candidates"] == []


async def test_concurrent_re_uploads_merge_and_keep_the_first_kind(
    test_engine: Any, committed_tenant: UUID
) -> None:
    """Two re-uploads of the same bytes race. The row lock makes each merge
    onto what the other committed: neither provenance is lost, the first kind
    stands, and each reports what it could not apply."""
    from sqlalchemy.ext.asyncio import async_sessionmaker

    maker = async_sessionmaker(test_engine, expire_on_commit=False)
    tenant = committed_tenant
    digest = "6" * 64
    common: dict[str, Any] = {
        "tenant_id": tenant,
        "sha256": digest,
        "storage_key": f"image-assets/{tenant}/sha256/66/{digest}.png",
        "mime_type": "image/png",
        "width": 1,
        "height": 1,
        "byte_size": 1,
        "orientation": None,
    }
    async with maker() as setup:
        await crud.upsert_asset(
            setup, **common, kind="candidate", provenance={"ai_generated": True}
        )
        await setup.commit()

    async def reupload(kind: str, provenance: dict[str, Any]) -> tuple[bool, list[str]]:
        async with maker() as session:
            _row, created, conflicts = await crud.upsert_asset(
                session, **common, kind=kind, provenance=provenance
            )
            await session.commit()
            return created, conflicts

    results = await asyncio.gather(
        reupload("exemplar", {"seed": 1}),
        reupload("capture", {"model": "m", "ai_generated": False}),
    )
    assert [created for created, _ in results] == [False, False]
    assert sorted(c for _, conflicts in results for c in conflicts) == [
        "kind",
        "kind",
        "provenance.ai_generated",
    ]
    async with maker() as check:
        row = await crud.get_asset(check, tenant_id=tenant, sha256=digest)
    assert row is not None
    assert row.kind == "candidate"
    assert row.provenance == {"ai_generated": True, "seed": 1, "model": "m"}


async def test_concurrent_first_uploads_create_one_row_and_keep_both_provenances(
    test_engine: Any, committed_tenant: UUID
) -> None:
    """Neither upload sees a row; one inserts, the other's insert waits on it
    and then merges — one row, one creator, both records' keys."""
    from sqlalchemy.ext.asyncio import async_sessionmaker

    maker = async_sessionmaker(test_engine, expire_on_commit=False)
    tenant = committed_tenant
    digest = "7" * 64
    common: dict[str, Any] = {
        "tenant_id": tenant,
        "sha256": digest,
        "storage_key": f"image-assets/{tenant}/sha256/77/{digest}.png",
        "mime_type": "image/png",
        "width": 1,
        "height": 1,
        "byte_size": 1,
        "orientation": None,
    }

    async def upload(kind: str, provenance: dict[str, Any]) -> tuple[str, bool]:
        async with maker() as session:
            _row, created, _conflicts = await crud.upsert_asset(
                session, **common, kind=kind, provenance=provenance
            )
            await session.commit()
            return kind, created

    results = await asyncio.gather(
        upload("candidate", {"a": 1}), upload("exemplar", {"b": 2})
    )
    creators = [kind for kind, created in results if created]
    assert len(creators) == 1
    async with maker() as check:
        row = await crud.get_asset(check, tenant_id=tenant, sha256=digest)
    assert row is not None
    assert row.kind == creators[0]
    assert row.provenance == {"a": 1, "b": 2}
