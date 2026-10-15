"""The backend no longer serves ``uploads/`` to anyone who asks.

``app/main.py`` used to mount the whole local-storage directory as
``StaticFiles`` at ``/uploads`` with no authentication, so under
``STORAGE_BACKEND=local`` every object — screenshots, videos, overview files,
frame caches — was readable by path. Plan ``2026-09-20-overview-authoring-layer``
Phase 2, follow-up 4. These tests pin the replacement (``app/api/local_storage.py``):
objects are readable only through a signed, expiring URL; avatars alone stay
public, at a filename that must be a UUID; traversal is refused everywhere.
"""

from __future__ import annotations

import io
import logging
import time
import uuid
from pathlib import Path
from urllib.parse import urlsplit

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app.core.config import SHIPPED_DEFAULT_SECRET_KEY, Settings, settings
from app.services.avatar_service import AvatarService
from app.services.storage import object_storage
from app.services.storage.local_backend import (
    MAX_SIGNED_URL_SECONDS,
    InvalidStorageKey,
    LocalBackend,
    sign_object_url,
)

SECRET_BYTES = b"tenant-private-bytes"


@pytest.fixture
def local_backend(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> LocalBackend:
    backend = LocalBackend(base_path=tmp_path / "uploads")
    monkeypatch.setattr(object_storage, "backend", backend)
    return backend


@pytest.fixture
def stored_key(local_backend: LocalBackend) -> str:
    key = f"overview-files/{uuid.uuid4()}.png"
    local_backend.upload_file(io.BytesIO(SECRET_BYTES), key, content_type="image/png")
    return key


def _path_and_query(url: str) -> str:
    parts = urlsplit(url)
    return f"{parts.path}?{parts.query}" if parts.query else parts.path


# --- the old blanket mount is gone ---------------------------------------


def test_old_uploads_path_no_longer_serves_a_private_object(
    test_client: TestClient, stored_key: str
) -> None:
    response = test_client.get(f"/uploads/{stored_key}")
    assert response.status_code == 404
    assert SECRET_BYTES not in response.content


def test_old_uploads_path_does_not_serve_the_frame_cache(
    test_client: TestClient,
) -> None:
    response = test_client.get("/uploads/frame-cache/1/action-1-before-frame0.jpg")
    assert response.status_code == 404


def test_no_static_mount_on_the_app() -> None:
    from starlette.routing import Mount

    import app.main as app_main

    mounts = [r.path for r in app_main.app.routes if isinstance(r, Mount)]
    assert "/uploads" not in mounts


# --- signed object URLs ---------------------------------------------------


def test_upload_file_returns_an_unsigned_address_that_is_not_servable(
    test_client: TestClient, local_backend: LocalBackend
) -> None:
    key = f"screenshots/{uuid.uuid4()}.png"
    url = local_backend.upload_file(io.BytesIO(SECRET_BYTES), key)
    assert "/uploads/" not in url
    response = test_client.get(_path_and_query(url))
    assert response.status_code == 422  # no expires / signature
    assert SECRET_BYTES not in response.content


def test_presigned_url_serves_the_object(
    test_client: TestClient, local_backend: LocalBackend, stored_key: str
) -> None:
    url = local_backend.generate_presigned_url(stored_key, expiration=60)
    assert "/uploads/" not in url
    response = test_client.get(_path_and_query(url))
    assert response.status_code == 200
    assert response.content == SECRET_BYTES
    assert response.headers["content-type"] == "image/png"
    assert response.headers["x-content-type-options"] == "nosniff"
    assert "default-src 'none'" in response.headers["content-security-policy"]
    assert "no-store" in response.headers["cache-control"]


def test_tampered_signature_is_refused(
    test_client: TestClient, local_backend: LocalBackend, stored_key: str
) -> None:
    url = local_backend.generate_presigned_url(stored_key, expiration=60)
    expires = int(url.split("expires=")[1].split("&")[0])
    response = test_client.get(
        f"/local-storage/{stored_key}?expires={expires}&signature=AAAA"
    )
    assert response.status_code == 403
    assert SECRET_BYTES not in response.content


def test_signature_for_another_key_is_refused(
    test_client: TestClient, local_backend: LocalBackend, stored_key: str
) -> None:
    other = local_backend.generate_presigned_url("overview-files/other.png", 60)
    query = urlsplit(other).query
    response = test_client.get(f"/local-storage/{stored_key}?{query}")
    assert response.status_code == 403


def test_expired_signature_is_refused(test_client: TestClient, stored_key: str) -> None:
    expires = int(time.time()) - 1
    signature = sign_object_url(stored_key, expires)
    response = test_client.get(
        f"/local-storage/{stored_key}?expires={expires}&signature={signature}"
    )
    assert response.status_code == 403


def test_put_signature_is_not_a_read_capability(
    test_client: TestClient, stored_key: str
) -> None:
    expires = int(time.time()) + 60
    signature = sign_object_url(stored_key, expires, http_method="PUT")
    response = test_client.get(
        f"/local-storage/{stored_key}?expires={expires}&signature={signature}"
    )
    assert response.status_code == 403


def test_route_is_inert_when_storage_is_not_local(
    test_client: TestClient, stored_key: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    expires = int(time.time()) + 60
    signature = sign_object_url(stored_key, expires)
    monkeypatch.setattr(object_storage, "backend", object())
    response = test_client.get(
        f"/local-storage/{stored_key}?expires={expires}&signature={signature}"
    )
    assert response.status_code == 404


# --- traversal ------------------------------------------------------------


@pytest.mark.parametrize(
    "key",
    [
        "../secret.txt",
        "a/../../secret.txt",
        "/etc/passwd",
        "a\\..\\secret.txt",
        "",
        "a/./b.png",
        "./b.png",
        "a//b.png",
        "a/",
    ],
)
def test_resolve_key_refuses_escapes(local_backend: LocalBackend, key: str) -> None:
    with pytest.raises(InvalidStorageKey):
        local_backend.resolve_key(key)


def test_resolve_key_refuses_a_symlink_out_of_the_root(
    local_backend: LocalBackend, tmp_path: Path
) -> None:
    outside = tmp_path / "outside.txt"
    outside.write_bytes(SECRET_BYTES)
    (local_backend.base_path / "link.txt").symlink_to(outside)
    with pytest.raises(InvalidStorageKey):
        local_backend.resolve_key("link.txt")


def test_presigning_a_traversal_key_is_refused(local_backend: LocalBackend) -> None:
    with pytest.raises(HTTPException) as excinfo:
        local_backend.generate_presigned_url("../secret.txt")
    assert excinfo.value.status_code == 400


def test_validly_signed_traversal_key_is_still_refused(
    test_client: TestClient, local_backend: LocalBackend, tmp_path: Path
) -> None:
    (tmp_path / "secret.txt").write_bytes(SECRET_BYTES)
    key = "../secret.txt"
    expires = int(time.time()) + 60
    signature = sign_object_url(key, expires)
    response = test_client.get(
        f"/local-storage/..%2Fsecret.txt?expires={expires}&signature={signature}"
    )
    assert response.status_code == 404
    assert SECRET_BYTES not in response.content


# --- public avatars -------------------------------------------------------


@pytest.fixture
def avatar_dir(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    directory = tmp_path / "avatars"
    directory.mkdir()
    monkeypatch.setattr(AvatarService, "UPLOAD_DIR", directory)
    return directory


def test_avatar_is_served_publicly(test_client: TestClient, avatar_dir: Path) -> None:
    filename = f"{uuid.uuid4()}.jpg"
    (avatar_dir / filename).write_bytes(b"\xff\xd8\xff avatar")
    response = test_client.get(f"/uploads/avatars/{filename}")
    assert response.status_code == 200
    assert response.content == b"\xff\xd8\xff avatar"
    assert response.headers["content-type"] == "image/jpeg"
    assert response.headers["x-content-type-options"] == "nosniff"


@pytest.mark.parametrize(
    "filename",
    [
        "avatar.jpg",  # not a uuid
        f"{uuid.uuid4()}.html",  # not an image extension
        f"{uuid.uuid4()}.jpg.meta.json",
        "..%2Fsecret.txt",
        "%2e%2e%2f%2e%2e%2fsecret.txt",
    ],
)
def test_avatar_route_refuses_anything_but_a_uuid_image(
    test_client: TestClient, avatar_dir: Path, filename: str
) -> None:
    (avatar_dir.parent / "secret.txt").write_bytes(SECRET_BYTES)
    response = test_client.get(f"/uploads/avatars/{filename}")
    assert response.status_code == 404
    assert SECRET_BYTES not in response.content


def test_avatar_symlink_out_of_the_directory_is_refused(
    test_client: TestClient, avatar_dir: Path
) -> None:
    """A UUID name passes the regex, so this reaches the resolve/parent guard."""
    outside = avatar_dir.parent / "secret.txt"
    outside.write_bytes(SECRET_BYTES)
    filename = f"{uuid.uuid4()}.jpg"
    (avatar_dir / filename).symlink_to(outside)
    response = test_client.get(f"/uploads/avatars/{filename}")
    assert response.status_code == 404
    assert SECRET_BYTES not in response.content


@pytest.mark.parametrize("filename", ["..", "../secret.txt", ".", ""])
def test_avatar_handler_refuses_traversal_names_directly(
    avatar_dir: Path, filename: str
) -> None:
    """The handler itself, so no client-side URL normalisation is involved."""
    from app.api.local_storage import read_avatar

    with pytest.raises(HTTPException) as excinfo:
        read_avatar(filename)
    assert excinfo.value.status_code == 404


def test_avatar_head(test_client: TestClient, avatar_dir: Path) -> None:
    filename = f"{uuid.uuid4()}.jpg"
    (avatar_dir / filename).write_bytes(b"\xff\xd8\xff avatar")
    response = test_client.head(f"/uploads/avatars/{filename}")
    assert response.status_code == 200
    assert response.content == b""


def test_avatar_route_does_not_reach_sibling_prefixes(
    test_client: TestClient, avatar_dir: Path
) -> None:
    name = f"{uuid.uuid4()}.jpg"
    response = test_client.get(f"/uploads/avatars/../screenshots/{name}")
    assert response.status_code == 404


# --- HEAD, encoding, lifetime cap ------------------------------------------


def test_head_is_authorised_by_the_get_signature(
    test_client: TestClient, local_backend: LocalBackend, stored_key: str
) -> None:
    url = local_backend.generate_presigned_url(stored_key, expiration=60)
    response = test_client.head(_path_and_query(url))
    assert response.status_code == 200
    assert response.content == b""
    assert response.headers["content-length"] == str(len(SECRET_BYTES))
    assert "no-store" in response.headers["cache-control"]


def test_head_with_a_bad_signature_is_refused(
    test_client: TestClient, stored_key: str
) -> None:
    expires = int(time.time()) + 60
    response = test_client.head(
        f"/local-storage/{stored_key}?expires={expires}&signature=AAAA"
    )
    assert response.status_code == 403


@pytest.mark.parametrize(
    "key",
    [
        "dir with space/file name.png",
        "q/a#b?c=d&e.png",
        "pct/100%done.png",
        "uni/caf\u00e9-\u6587\u4ef6.png",
        "plus/a+b.png",
    ],
)
def test_keys_that_need_url_encoding_round_trip(
    test_client: TestClient, local_backend: LocalBackend, key: str
) -> None:
    local_backend.upload_file(io.BytesIO(SECRET_BYTES), key)
    url = local_backend.generate_presigned_url(key, expiration=60)
    response = test_client.get(_path_and_query(url))
    assert response.status_code == 200
    assert response.content == SECRET_BYTES
    assert local_backend.key_from_object_url(url) == key


def test_signed_url_lifetime_is_capped_at_seven_days(
    local_backend: LocalBackend, stored_key: str
) -> None:
    before = int(time.time())
    url = local_backend.generate_presigned_url(stored_key, expiration=30 * 86400)
    expires = int(url.split("expires=")[1].split("&")[0])
    assert before < expires <= int(time.time()) + MAX_SIGNED_URL_SECONDS


def test_a_validly_signed_url_beyond_the_cap_is_refused(
    test_client: TestClient, stored_key: str
) -> None:
    expires = int(time.time()) + MAX_SIGNED_URL_SECONDS + 3600
    signature = sign_object_url(stored_key, expires)
    response = test_client.get(
        f"/local-storage/{stored_key}?expires={expires}&signature={signature}"
    )
    assert response.status_code == 403


# --- fail closed on the shipped SECRET_KEY ----------------------------------


@pytest.fixture
def shipped_secret_outside_tests(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "SECRET_KEY", SHIPPED_DEFAULT_SECRET_KEY)
    monkeypatch.delenv("TESTING", raising=False)


def test_shipped_secret_refuses_to_sign(
    local_backend: LocalBackend, stored_key: str, shipped_secret_outside_tests: None
) -> None:
    with pytest.raises(HTTPException) as excinfo:
        local_backend.generate_presigned_url(stored_key)
    assert excinfo.value.status_code == 503


def test_shipped_secret_refuses_to_serve(
    test_client: TestClient,
    stored_key: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # A signature that WOULD verify under the shipped key — what an attacker
    # who read config.py can compute.
    monkeypatch.setattr(settings, "SECRET_KEY", SHIPPED_DEFAULT_SECRET_KEY)
    expires = int(time.time()) + 60
    forged = sign_object_url(stored_key, expires)
    monkeypatch.delenv("TESTING", raising=False)
    response = test_client.get(
        f"/local-storage/{stored_key}?expires={expires}&signature={forged}"
    )
    assert response.status_code == 503
    assert SECRET_BYTES not in response.content


@pytest.mark.parametrize("environment", ["staging", "production"])
def test_config_rejects_the_shipped_secret_under_local_storage(
    monkeypatch: pytest.MonkeyPatch, environment: str
) -> None:
    from pydantic import ValidationError

    monkeypatch.delenv("TESTING", raising=False)
    monkeypatch.setenv("ENVIRONMENT", environment)
    monkeypatch.setenv("STORAGE_BACKEND", "local")
    monkeypatch.setenv("SECRET_KEY", SHIPPED_DEFAULT_SECRET_KEY)
    with pytest.raises(ValidationError, match="STORAGE_BACKEND=local"):
        Settings(_env_file=None)  # type: ignore[call-arg]


@pytest.mark.parametrize("storage_backend", ["s3", "minio"])
def test_config_does_not_reject_the_shipped_secret_under_s3(
    monkeypatch: pytest.MonkeyPatch, storage_backend: str
) -> None:
    """A hypothetical S3 deployment (say ENVIRONMENT=staging, secret held
    elsewhere) never signs local-storage URLs, so a shipped-default value
    there must not crash-loop the service."""
    from pydantic import ValidationError

    monkeypatch.delenv("TESTING", raising=False)
    monkeypatch.setenv("ENVIRONMENT", "staging")
    monkeypatch.setenv("STORAGE_BACKEND", storage_backend)
    monkeypatch.setenv("SECRET_KEY", SHIPPED_DEFAULT_SECRET_KEY)
    try:
        Settings(_env_file=None)  # type: ignore[call-arg]
    except ValidationError as exc:  # another validator may object; not this one
        assert "SECRET_KEY" not in str(exc)


def test_config_short_key_rule_is_unchanged(monkeypatch: pytest.MonkeyPatch) -> None:
    from pydantic import ValidationError

    monkeypatch.setenv("ENVIRONMENT", "staging")
    monkeypatch.setenv("STORAGE_BACKEND", "s3")
    monkeypatch.setenv("SECRET_KEY", "x" * 31)
    with pytest.raises(ValidationError, match="SECRET_KEY"):
        Settings(_env_file=None)  # type: ignore[call-arg]


def test_config_tolerates_the_shipped_secret_in_development(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("TESTING", raising=False)
    monkeypatch.setenv("ENVIRONMENT", "development")
    monkeypatch.setenv("STORAGE_BACKEND", "local")
    monkeypatch.setenv("SECRET_KEY", SHIPPED_DEFAULT_SECRET_KEY)
    loaded = Settings(_env_file=None)  # type: ignore[call-arg]
    assert loaded.SECRET_KEY == SHIPPED_DEFAULT_SECRET_KEY


# --- presign on read --------------------------------------------------------


def test_key_from_object_url_inverts_every_local_form(
    local_backend: LocalBackend, stored_key: str
) -> None:
    assert local_backend.key_from_object_url(local_backend.object_url(stored_key)) == (
        stored_key
    )
    signed = local_backend.generate_presigned_url(stored_key, 60)
    assert local_backend.key_from_object_url(signed) == stored_key
    assert local_backend.key_from_object_url(f"/uploads/{stored_key}") == stored_key
    assert (
        local_backend.key_from_object_url(
            f"{local_backend.backend_url}/uploads/{stored_key}"
        )
        == stored_key
    )
    assert local_backend.key_from_object_url("https://example.com/x.png") is None


@pytest.mark.parametrize(
    "url",
    [
        "https://evil.example/local-storage/{key}",
        "http://old-host:8000/uploads/{key}",
        "//evil.example/local-storage/{key}",
        "{other_scheme}/local-storage/{key}",
    ],
)
def test_local_inverter_ignores_foreign_origins(
    local_backend: LocalBackend, stored_key: str, url: str
) -> None:
    own = local_backend.backend_url
    other_scheme = (
        own.replace("http://", "https://", 1)
        if own.startswith("http://")
        else own.replace("https://", "http://", 1)
    )
    foreign = url.format(key=stored_key, other_scheme=other_scheme)
    assert local_backend.key_from_object_url(foreign) is None
    assert object_storage.presign_stored_url(foreign) == foreign
    assert local_backend.key_from_object_url("/local-storage/../etc/passwd") is None


def test_s3_key_from_object_url() -> None:
    from app.services.storage.s3_backend import S3Backend

    aws = S3Backend.__new__(S3Backend)
    aws.bucket_name, aws.region, aws.endpoint_url = "bkt", "eu-west-1", None
    assert aws.key_from_object_url(
        "https://bkt.s3.eu-west-1.amazonaws.com/a/b%20c.png"
    ) == ("a/b c.png")
    assert (
        aws.key_from_object_url(
            "https://bkt.s3.amazonaws.com/a/b.png?X-Amz-Signature=x"
        )
        == "a/b.png"
    )
    assert aws.key_from_object_url("https://other.s3.amazonaws.com/a.png") is None
    assert aws.key_from_object_url("http://bkt.s3.amazonaws.com/a.png") is None

    minio = S3Backend.__new__(S3Backend)
    minio.bucket_name, minio.region = "bkt", "us-east-1"
    minio.endpoint_url = "http://localhost:9000"
    assert minio.key_from_object_url("http://localhost:9000/bkt/a/b.png") == "a/b.png"
    assert minio.key_from_object_url("http://localhost:9000/other/a.png") is None
    assert minio.key_from_object_url("http://localhost:9001/bkt/a.png") is None
    assert minio.key_from_object_url("https://localhost:9000/bkt/a.png") is None


def test_presign_stored_url_leaves_foreign_urls_alone(
    local_backend: LocalBackend,
) -> None:
    assert object_storage.presign_stored_url(None) is None
    assert object_storage.presign_stored_url("https://cdn.example/x.png") == (
        "https://cdn.example/x.png"
    )


def _assert_readable(test_client: TestClient, url: str | None) -> None:
    assert url is not None and "signature=" in url
    response = test_client.get(_path_and_query(url))
    assert response.status_code == 200
    assert response.content == SECRET_BYTES


def test_capture_screenshot_response_is_presigned(
    test_client: TestClient, local_backend: LocalBackend, stored_key: str
) -> None:
    from datetime import UTC, datetime
    from types import SimpleNamespace

    from app.services.capture_response_builder import CaptureResponseBuilder

    row = SimpleNamespace(
        id=uuid.uuid4(),
        session_id=uuid.uuid4(),
        sequence_number=1,
        image_url=local_backend.object_url(stored_key),
        thumbnail_url=None,
        width=1,
        height=1,
        timestamp=datetime.now(UTC),
        extra_metadata=None,
        analysis_status="pending",
        actions=[],
        detected_elements=[],
    )
    response = CaptureResponseBuilder.build_screenshot_response(row)  # type: ignore[arg-type]
    _assert_readable(test_client, response.image_url)
    assert response.thumbnail_url is None


def test_execution_screenshot_response_is_presigned(
    test_client: TestClient, local_backend: LocalBackend, stored_key: str
) -> None:
    from datetime import UTC, datetime
    from types import SimpleNamespace

    from app.services.execution_screenshot_service import (
        model_to_screenshot_response,
    )

    row = SimpleNamespace(
        id=uuid.uuid4(),
        run_id=uuid.uuid4(),
        sequence_number=1,
        screenshot_type="manual",
        storage_path=stored_key,
        image_url=local_backend.object_url(stored_key),
        thumbnail_url=local_backend.object_url(stored_key),
        state_name=None,
        captured_at=datetime.now(UTC),
        file_size_bytes=len(SECRET_BYTES),
    )
    response = model_to_screenshot_response(row)  # type: ignore[arg-type]
    _assert_readable(test_client, response.image_url)
    _assert_readable(test_client, response.thumbnail_url)


def test_annotation_set_response_is_presigned(
    test_client: TestClient, local_backend: LocalBackend
) -> None:
    from app.schemas.annotation import AnnotationSetResponse

    owner = uuid.uuid4()
    key = f"annotations/{owner}/{uuid.uuid4()}.png"
    local_backend.upload_file(io.BytesIO(SECRET_BYTES), key)
    address = local_backend.object_url(key)
    response = AnnotationSetResponse.model_validate(
        _annotation_set(address, created_by_id=owner)
    )
    _assert_readable(test_client, response.screenshot_url)
    assert response.screenshots is not None
    _assert_readable(test_client, response.screenshots[0].url)


def test_another_users_annotation_upload_is_not_signed(
    local_backend: LocalBackend,
) -> None:
    """A set owned by user B naming user A's uploaded screenshot gets the
    address back unsigned."""
    key = f"annotations/{uuid.uuid4()}/{uuid.uuid4()}.png"  # user A's upload
    local_backend.upload_file(io.BytesIO(SECRET_BYTES), key)
    address = local_backend.object_url(key)
    from app.schemas.annotation import AnnotationSetResponse

    response = AnnotationSetResponse.model_validate(
        _annotation_set(address, created_by_id=uuid.uuid4())  # owned by user B
    )
    assert response.screenshot_url == address
    assert response.screenshots is not None
    assert response.screenshots[0].url == address


def _annotation_set(address: str, created_by_id: uuid.UUID) -> dict[str, object]:
    from datetime import UTC, datetime

    return {
        "id": uuid.uuid4(),
        "screenshot_name": "s",
        "screenshot_url": address,
        "image_width": 1,
        "image_height": 1,
        "screenshots": [{"name": "s", "url": address, "width": 1, "height": 1}],
        "created_at": datetime.now(UTC),
        "updated_at": datetime.now(UTC),
        "created_by_id": created_by_id,
    }


def test_execution_image_is_signed_from_storage_path_not_image_url(
    test_client: TestClient, local_backend: LocalBackend, stored_key: str
) -> None:
    """image_url written under another origin is not invertible, but the
    authoritative storage_path still yields a working signed URL."""
    from datetime import UTC, datetime
    from types import SimpleNamespace

    from app.services.execution_screenshot_service import (
        model_to_screenshot_response,
    )

    foreign = f"https://old-origin.example/local-storage/{stored_key}"
    assert local_backend.key_from_object_url(foreign) is None
    response = model_to_screenshot_response(
        SimpleNamespace(  # type: ignore[arg-type]
            id=uuid.uuid4(),
            run_id=uuid.uuid4(),
            sequence_number=1,
            screenshot_type="manual",
            storage_path=stored_key,
            image_url=foreign,
            thumbnail_url=None,
            state_name=None,
            captured_at=datetime.now(UTC),
            file_size_bytes=1,
        )
    )
    _assert_readable(test_client, response.image_url)


def test_dataset_export_job_response_is_presigned(
    test_client: TestClient, local_backend: LocalBackend, stored_key: str
) -> None:
    from datetime import UTC, datetime

    from app.schemas.training_dataset import DatasetExportJobResponse

    response = DatasetExportJobResponse.model_validate(
        {
            "id": str(uuid.uuid4()),
            "dataset_id": str(uuid.uuid4()),
            "status": "completed",
            "progress": 100,
            "format": "coco",
            "download_url": local_backend.object_url(stored_key),
            "created_at": datetime.now(UTC),
        }
    )
    _assert_readable(test_client, response.download_url)


def test_annotation_urls_outside_the_upload_prefix_are_not_signed(
    local_backend: LocalBackend, stored_key: str
) -> None:
    """screenshot_url is client-supplied: naming another object's address
    (here an overview file) must not get it signed."""
    from datetime import UTC, datetime

    from app.schemas.annotation import AnnotationSetResponse

    address = local_backend.object_url(stored_key)
    response = AnnotationSetResponse.model_validate(
        {
            "id": str(uuid.uuid4()),
            "screenshot_name": "s",
            "screenshot_url": address,
            "image_width": 1,
            "image_height": 1,
            "screenshots": [{"name": "s", "url": address, "width": 1, "height": 1}],
            "created_at": datetime.now(UTC),
            "updated_at": datetime.now(UTC),
            "created_by_id": str(uuid.uuid4()),
        }
    )
    assert response.screenshot_url == address
    assert response.screenshots is not None
    assert response.screenshots[0].url == address


def test_a_presign_failure_degrades_one_field_not_the_response(
    local_backend: LocalBackend,
    stored_key: str,
    shipped_secret_outside_tests: None,
) -> None:
    """Signer disabled (503 inside): list builders still return, the URL
    is left as stored."""
    from datetime import UTC, datetime
    from types import SimpleNamespace

    from app.services.capture_response_builder import CaptureResponseBuilder
    from app.services.execution_screenshot_service import (
        model_to_screenshot_response,
    )

    address = local_backend.object_url(stored_key)
    assert object_storage.presign_stored_url(address) == address

    capture = CaptureResponseBuilder.build_screenshot_response(
        SimpleNamespace(  # type: ignore[arg-type]
            id=uuid.uuid4(),
            session_id=uuid.uuid4(),
            sequence_number=1,
            image_url=address,
            thumbnail_url=address,
            width=1,
            height=1,
            timestamp=datetime.now(UTC),
            extra_metadata=None,
            analysis_status="pending",
            actions=[],
            detected_elements=[],
        )
    )
    assert capture.image_url == address

    execution = model_to_screenshot_response(
        SimpleNamespace(  # type: ignore[arg-type]
            id=uuid.uuid4(),
            run_id=uuid.uuid4(),
            sequence_number=1,
            screenshot_type="manual",
            storage_path=stored_key,
            image_url=address,
            thumbnail_url=None,
            state_name=None,
            captured_at=datetime.now(UTC),
            file_size_bytes=1,
        )
    )
    assert execution.image_url == address


# --- snapshot screenshot route only signs the run's own paths --------------


class _Result:
    def __init__(self, scalar: object = None, first: object = None) -> None:
        self._scalar, self._first = scalar, first

    def scalar_one_or_none(self) -> object:
        return self._scalar

    def first(self) -> object:
        return self._first


class _FakeDB:
    def __init__(self, results: list[_Result]) -> None:
        self.results = results

    async def execute(self, _stmt: object) -> _Result:
        return self.results.pop(0)


@pytest.mark.asyncio
async def test_snapshot_screenshot_refuses_a_path_not_in_the_run(
    local_backend: LocalBackend, stored_key: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    from types import SimpleNamespace

    from app.api.v1.endpoints import integration_testing

    async def allow(*_args: object) -> None:
        return None

    monkeypatch.setattr(integration_testing, "verify_project_access", allow)
    run = SimpleNamespace(id=1, project_id=uuid.uuid4())
    db = _FakeDB([_Result(scalar=run), _Result(first=None)])
    with pytest.raises(HTTPException) as excinfo:
        await integration_testing.get_screenshot(
            str(uuid.uuid4()),
            stored_key,  # someone else's key, named in the URL
            db=db,  # type: ignore[arg-type]
            current_user=SimpleNamespace(id=uuid.uuid4()),  # type: ignore[arg-type]
        )
    assert excinfo.value.status_code == 404


@pytest.mark.asyncio
async def test_snapshot_screenshot_signs_a_path_the_run_owns(
    test_client: TestClient,
    local_backend: LocalBackend,
    stored_key: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from types import SimpleNamespace

    from app.api.v1.endpoints import integration_testing

    async def allow(*_args: object) -> None:
        return None

    monkeypatch.setattr(integration_testing, "verify_project_access", allow)
    run = SimpleNamespace(id=1, project_id=uuid.uuid4())
    db = _FakeDB([_Result(scalar=run), _Result(first=(1,))])
    response = await integration_testing.get_screenshot(
        str(uuid.uuid4()),
        stored_key,
        db=db,  # type: ignore[arg-type]
        current_user=SimpleNamespace(id=uuid.uuid4()),  # type: ignore[arg-type]
    )
    _assert_readable(test_client, response.headers["location"])


# --- request logging redaction ----------------------------------------------


def test_query_params_with_credentials_are_redacted() -> None:
    from app.core.log_sanitizer import REDACTED_VALUE, sanitize_query_params

    out = sanitize_query_params(
        {
            "expires": "1",
            "signature": "s",
            "X-Amz-Signature": "s",
            "X-Amz-Credential": "c",
            "X-Amz-Security-Token": "t",
            "AWSAccessKeyId": "k",
            "code": "oauth",
            "page": "2",
        }
    )
    assert out["expires"] == "1" and out["page"] == "2"
    for name in (
        "signature",
        "X-Amz-Signature",
        "X-Amz-Credential",
        "X-Amz-Security-Token",
        "AWSAccessKeyId",
        "code",
    ):
        assert out[name] == REDACTED_VALUE


def test_request_id_middleware_does_not_log_a_signature(
    test_client: TestClient, local_backend: LocalBackend, stored_key: str
) -> None:
    from structlog.testing import capture_logs

    url = local_backend.generate_presigned_url(stored_key, 60)
    signature = url.split("signature=")[1]
    with capture_logs() as logs:
        assert test_client.get(_path_and_query(url)).status_code == 200
    started = [e for e in logs if e.get("event") == "request_started"]
    assert started, "request_started was not logged"
    assert all(signature not in str(e) for e in logs)


# --- uvicorn access log -------------------------------------------------------


def _access_record(target: str) -> logging.LogRecord:
    return logging.LogRecord(
        "uvicorn.access",
        logging.INFO,
        __file__,
        1,
        '%s - "%s %s HTTP/%s" %d',
        ("127.0.0.1:5000", "GET", target, "1.1", 200),
        None,
    )


def test_access_log_filter_redacts_credential_query_params() -> None:
    from app.core.log_sanitizer import (
        REDACTED_VALUE,
        AccessLogQueryRedactionFilter,
    )

    record = _access_record(
        "/local-storage/a%20b.png?expires=99&signature=SECRETSIG"
        "&X-Amz-Signature=AMZSIG&X-Amz-Credential=AKIA%2F1&page=2"
    )
    assert AccessLogQueryRedactionFilter().filter(record) is True
    message = record.getMessage()
    for secret in ("SECRETSIG", "AMZSIG", "AKIA"):
        assert secret not in message
    assert "/local-storage/a%20b.png?expires=99" in message
    assert f"signature={REDACTED_VALUE}" in message
    assert message.endswith('page=2 HTTP/1.1" 200')


def test_access_log_filter_leaves_other_records_alone() -> None:
    from app.core.log_sanitizer import AccessLogQueryRedactionFilter

    plain = _access_record("/health")
    AccessLogQueryRedactionFilter().filter(plain)
    assert "/health" in plain.getMessage()
    other = logging.LogRecord("x", logging.INFO, __file__, 1, "hi %s", ("a",), None)
    assert AccessLogQueryRedactionFilter().filter(other) is True
    assert other.getMessage() == "hi a"


def test_logging_setup_installs_the_access_log_filter_once() -> None:
    import app.main  # noqa: F401  (runs configure_logging)
    from app.core.log_sanitizer import (
        AccessLogQueryRedactionFilter,
        install_access_log_redaction,
    )

    install_access_log_redaction()
    filters = [
        f
        for f in logging.getLogger("uvicorn.access").filters
        if isinstance(f, AccessLogQueryRedactionFilter)
    ]
    assert len(filters) == 1
