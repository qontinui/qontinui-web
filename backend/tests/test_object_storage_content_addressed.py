"""``ObjectStorageService.put_content_addressed`` on every backend.

Plan ``2026-10-13-image-generation-and-visual-judgment`` Phase 13. DB-free.

The method must behave the same on the local filesystem backend, on the S3 /
MinIO backend and on any other :class:`StorageBackend` — it may use only the
backend contract. So each behaviour is run against all three:

* the real :class:`LocalBackend` over a temp directory;
* the real :class:`S3Backend` over an in-memory stand-in for the boto3 client
  (``head_object`` / ``upload_fileobj`` / ``generate_presigned_url`` — the
  three calls the backend makes for this method), so the S3 code path itself
  runs with no network;
* a minimal :class:`StorageBackend` written here against the abstract
  contract alone.
"""

from __future__ import annotations

import hashlib
import io
from collections.abc import Callable, Iterator
from typing import Any, BinaryIO
from uuid import UUID, uuid4

import pytest
from botocore.exceptions import ClientError

from app.services.storage import (
    LocalBackend,
    ObjectStorageService,
    S3Backend,
    StorageBackend,
    content_addressed_key,
)

PREFIX = "image-assets"


class FakeS3Client:
    """The slice of the boto3 S3 client ``S3Backend`` uses here, in memory."""

    def __init__(self) -> None:
        self.objects: dict[str, bytes] = {}
        self.extra_args: dict[str, dict[str, Any]] = {}
        self.puts = 0

    def head_object(self, Bucket: str, Key: str) -> dict[str, Any]:  # noqa: N803
        if Key not in self.objects:
            raise ClientError({"Error": {"Code": "404"}}, "HeadObject")
        return {
            "ContentLength": len(self.objects[Key]),
            "ContentType": self.extra_args[Key].get("ContentType"),
            "LastModified": None,
            "Metadata": {},
        }

    def upload_fileobj(
        self,
        Fileobj: BinaryIO,
        Bucket: str,
        Key: str,
        ExtraArgs: dict[str, Any],  # noqa: N803
    ) -> None:
        self.objects[Key] = Fileobj.read()
        self.extra_args[Key] = ExtraArgs
        self.puts += 1

    def delete_object(self, Bucket: str, Key: str) -> dict[str, Any]:  # noqa: N803
        self.objects.pop(Key, None)
        return {}

    def generate_presigned_url(
        self,
        operation: str,
        Params: dict[str, str],
        ExpiresIn: int,  # noqa: N803
    ) -> str:
        return (
            f"https://bucket.example/{Params['Key']}"
            f"?X-Amz-Expires={ExpiresIn}&X-Amz-Signature=fake"
        )


def fake_s3_backend() -> tuple[S3Backend, FakeS3Client]:
    backend = S3Backend.__new__(S3Backend)  # skip __init__'s bucket probe
    client = FakeS3Client()
    backend.client = client  # type: ignore[assignment]
    backend.bucket_name = "test-bucket"
    backend.region = "us-east-1"
    backend.use_path_style = False
    return backend, client


class ContractOnlyBackend(StorageBackend):
    """Implements the abstract contract and nothing else."""

    def __init__(self) -> None:
        self.objects: dict[str, bytes] = {}
        self.uploads = 0

    def upload_file(
        self,
        file_obj: BinaryIO,
        key: str,
        content_type: str | None = None,
        metadata: dict | None = None,
    ) -> str:
        self.objects[key] = file_obj.read()
        self.uploads += 1
        return f"mem://{key}"

    def download_file(self, key: str) -> bytes:
        return self.objects[key]

    def delete_file(self, key: str) -> bool:
        return self.objects.pop(key, None) is not None

    def generate_presigned_url(
        self, key: str, expiration: int = 3600, http_method: str = "GET"
    ) -> str:
        return f"mem://{key}?ttl={expiration}"

    def file_exists(self, key: str) -> bool:
        return key in self.objects

    def get_file_metadata(self, key: str) -> dict:
        return {"size": len(self.objects[key]), "content_type": None, "metadata": {}}


def _service(backend: StorageBackend) -> ObjectStorageService:
    service = ObjectStorageService.__new__(ObjectStorageService)
    service.backend = backend
    return service


#: ``(service, read_bytes(key) -> bytes | None, write_count() -> int)``
StoreUnderTest = tuple[
    ObjectStorageService, Callable[[str], bytes | None], Callable[[], int]
]


@pytest.fixture(params=["local", "s3", "contract-only"])
def store(request: pytest.FixtureRequest, tmp_path: Any) -> Iterator[StoreUnderTest]:
    if request.param == "local":
        backend = LocalBackend(base_path=tmp_path)
        writes = {"n": 0}
        real_upload = backend.upload_file

        def counting_upload(*args: Any, **kwargs: Any) -> str:
            writes["n"] += 1
            return real_upload(*args, **kwargs)

        backend.upload_file = counting_upload  # type: ignore[method-assign]

        def read_local(key: str) -> bytes | None:
            path = tmp_path / key
            return path.read_bytes() if path.exists() else None

        yield _service(backend), read_local, lambda: writes["n"]
    elif request.param == "s3":
        s3, client = fake_s3_backend()
        yield _service(s3), client.objects.get, lambda: client.puts
    else:
        mem = ContractOnlyBackend()
        yield _service(mem), mem.objects.get, lambda: mem.uploads


DATA = b"\x89PNG\r\n\x1a\n" + bytes(range(256)) * 4


def test_the_key_is_the_tenant_and_the_hash_of_the_bytes(store: StoreUnderTest) -> None:
    service, read, _writes = store
    tenant = uuid4()
    stored = service.put_content_addressed(DATA, ".png", PREFIX, tenant_id=tenant)
    digest = hashlib.sha256(DATA).hexdigest()
    assert stored.sha256 == digest
    assert stored.key == f"{PREFIX}/{tenant}/sha256/{digest[:2]}/{digest}.png"
    assert stored.size == len(DATA)
    assert stored.written is True
    assert read(stored.key) == DATA


def test_the_same_bytes_again_are_the_same_key_and_no_write(
    store: StoreUnderTest,
) -> None:
    service, read, writes = store
    tenant = uuid4()
    first = service.put_content_addressed(DATA, ".png", PREFIX, tenant_id=tenant)
    second = service.put_content_addressed(DATA, ".png", PREFIX, tenant_id=tenant)
    assert second.key == first.key
    assert second.sha256 == first.sha256
    assert (first.written, second.written) == (True, False)
    assert writes() == 1
    assert read(first.key) == DATA


def test_different_bytes_are_different_keys(store: StoreUnderTest) -> None:
    service, read, writes = store
    tenant = uuid4()
    one = service.put_content_addressed(DATA, ".png", PREFIX, tenant_id=tenant)
    two = service.put_content_addressed(
        DATA + b"\x00", ".png", PREFIX, tenant_id=tenant
    )
    assert one.key != two.key
    assert writes() == 2
    assert read(one.key) == DATA


def test_the_same_bytes_for_two_tenants_are_two_objects(store: StoreUnderTest) -> None:
    """Never shared: deleting tenant A's object leaves tenant B's intact."""
    service, read, writes = store
    tenant_a, tenant_b = uuid4(), uuid4()
    a = service.put_content_addressed(DATA, ".png", PREFIX, tenant_id=tenant_a)
    b = service.put_content_addressed(DATA, ".png", PREFIX, tenant_id=tenant_b)
    assert a.sha256 == b.sha256
    assert a.key != b.key
    assert str(tenant_a) in a.key and str(tenant_b) in b.key
    # B's write was NOT skipped because A already held the bytes: a skipped
    # write would be a signal that another tenant holds the image.
    assert (a.written, b.written) == (True, True)
    assert writes() == 2
    assert service.delete_file(a.key)
    assert read(b.key) == DATA


def test_a_torn_object_at_the_key_is_rewritten(store: StoreUnderTest) -> None:
    """An object of the wrong size at a content key can only be a torn
    earlier write; it is repaired, not trusted."""
    service, read, writes = store
    tenant = uuid4()
    key = content_addressed_key(
        PREFIX, tenant, hashlib.sha256(DATA).hexdigest(), ".png"
    )
    service.backend.upload_file(io.BytesIO(DATA[:10]), key)
    before = writes()
    stored = service.put_content_addressed(DATA, ".png", PREFIX, tenant_id=tenant)
    assert stored.written is True
    assert writes() == before + 1
    assert read(key) == DATA


def test_the_s3_object_is_typed_and_immutable_cacheable() -> None:
    """Through the real ``S3Backend.upload_file``: the sniffed type is the
    object's ContentType, and an ``image/*`` object is cached immutable —
    right for a content-addressed key, which never changes meaning."""
    s3, client = fake_s3_backend()
    service = _service(s3)
    stored = service.put_content_addressed(
        DATA, ".png", PREFIX, tenant_id=uuid4(), content_type="image/png"
    )
    args = client.extra_args[stored.key]
    assert args["ContentType"] == "image/png"
    assert args["CacheControl"] == "max-age=31536000, immutable"
    url = service.generate_presigned_url(stored.key, expiration=600)
    assert stored.key in url and "X-Amz-Expires=600" in url


@pytest.mark.parametrize(
    ("prefix", "ext"),
    [
        ("../escape", ".png"),
        ("/abs", ".png"),
        ("image-assets/", ".png"),
        ("Image-Assets", ".png"),
        ("image-assets", "png"),
        ("image-assets", ".png/../x"),
        ("image-assets", ".PNG"),
        ("image-assets", ""),
    ],
)
def test_a_malformed_prefix_or_extension_is_refused(prefix: str, ext: str) -> None:
    service = _service(ContractOnlyBackend())
    with pytest.raises(ValueError):
        service.put_content_addressed(DATA, ext, prefix, tenant_id=uuid4())
    assert service.backend.objects == {}  # type: ignore[attr-defined]


def test_the_key_function_refuses_a_non_digest() -> None:
    with pytest.raises(ValueError):
        content_addressed_key(PREFIX, UUID(int=1), "ABC", ".png")
    with pytest.raises(ValueError):
        content_addressed_key(PREFIX, UUID(int=1), "a" * 63, ".png")
