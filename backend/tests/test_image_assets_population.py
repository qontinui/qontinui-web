"""The image store entered the way its population enters it.

Plan ``2026-10-13-image-generation-and-visual-judgment`` Phase 13. The store's
population is a device — ``studio compile`` (Phase 19) holding a coord device
JWT — calling the HTTP routes. ``tests/test_image_assets_api.py`` covers those
routes in depth with the tenant dependency replaced by a fixed principal. These
tests replace nothing on the request's path except coord itself:

* the request goes through ``app.main.app`` — its middleware stack, its router
  and the upload's real request-body cap;
* the tenant comes from the REAL ``get_memory_tenant``, given a device JWT
  whose coord signature check (``coord_jwks_client.verify_token``) and
  device-user lookup (``_verify_device_jwt``) are stubbed exactly as
  ``tests/test_memory_auth.py`` stubs them — so the principal a route sees is
  the one that dependency resolves, not one a test injected;
* only the database session and the object store's directory are the test's
  own.

They import nothing this phase added. Without the phase they therefore fail on
the missing routes, not on an import — which is what makes them the phase's
arming tests (``qontinui-claude-config/scripts/arming-record.sh``): green with
the change, red with the change reverted.
"""

from __future__ import annotations

import hashlib
import io
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import httpx
import pytest
import pytest_asyncio
from fastapi.security import HTTPAuthorizationCredentials
from PIL import Image
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_async_db
from app.api.v1.endpoints import memory as memory_ep
from app.services import storage as storage_module

pytestmark = pytest.mark.asyncio

API = "/api/v1/image-assets"
SLOTS = f"{API}/slot-candidates"

#: Two devices, each bound to its own tenant — as coord would sign them.
DEVICE_A = "population-device-a"
DEVICE_B = "population-device-b"


@pytest_asyncio.fixture()
async def population(
    async_db_session: AsyncSession,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> AsyncIterator[httpx.AsyncClient]:
    """An HTTP client on the real app, presenting device credentials coord
    would have signed. Only coord's two verification calls are stubbed."""
    from app.main import app

    claims = {
        device: {
            "user_id": str(uuid4()),
            "device_id": str(uuid4()),
            "tenant_id": str(uuid4()),
        }
        for device in (DEVICE_A, DEVICE_B)
    }
    monkeypatch.setattr(
        memory_ep.coord_jwks_client,
        "verify_token",
        AsyncMock(side_effect=lambda token: claims[token]),
    )
    monkeypatch.setattr(
        memory_ep,
        "_verify_device_jwt",
        AsyncMock(side_effect=lambda token: (claims[token], MagicMock())),
    )
    # The singleton the routes store through, pointed at this test's directory.
    monkeypatch.setattr(
        storage_module.object_storage,
        "backend",
        storage_module.LocalBackend(base_path=tmp_path),
    )

    async def _db() -> AsyncIterator[AsyncSession]:
        yield async_db_session

    saved = dict(app.dependency_overrides)
    app.dependency_overrides[get_async_db] = _db
    try:
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        ) as client:
            yield client
    finally:
        app.dependency_overrides.clear()
        app.dependency_overrides.update(saved)


async def _resolve(device: str) -> Any:
    """The principal a device's credential resolves to, through the same
    dependency every one of the routes resolves it with."""
    return await memory_ep.get_memory_tenant(
        request=MagicMock(),
        user=None,
        credentials=HTTPAuthorizationCredentials(scheme="Bearer", credentials=device),
    )


def _bearer(device: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {device}"}


def _png(rgb: tuple[int, int, int]) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (6, 4), rgb).save(buf, format="PNG")
    return buf.getvalue()


async def _upload(client: httpx.AsyncClient, device: str, data: bytes) -> str:
    """Upload as ``device``; the hash the store filed the bytes under."""
    resp = await client.post(
        API,
        headers=_bearer(device),
        data={"kind": "candidate"},
        files={"file": ("upload.bin", data, "application/octet-stream")},
    )
    assert resp.status_code == 201, resp.text
    digest: str = resp.json()["sha256"]
    return digest


# The two tests keep their signatures on ONE line, unannotated, on purpose:
# they are the arming tests, and the arming check's Python reader
# (qontinui-claude-config scripts/seam-reach.py, `_python_end`) ends a function
# at the first line indented no deeper than its `def` — a wrapped signature's
# closing `) -> None:` — so a wrapped signature would hide the whole body from
# it. Keep them short enough that the formatter never wraps them.


async def test_upload_is_filed_under_its_tenant_alone(population, tmp_path) -> None:
    """An upload by device A is filed under A's tenant key, readable by A through
    GET /{sha256}, and invisible (404) to device B of another tenant."""
    mine, theirs = await _resolve(DEVICE_A), await _resolve(DEVICE_B)
    assert mine.tenant_id != theirs.tenant_id

    data = _png((90, 40, 200))
    digest = await _upload(population, DEVICE_A, data)
    assert digest == hashlib.sha256(data).hexdigest()

    # Stored under the tenant the device's credential resolved to — and only
    # there: the key names that tenant.
    key = f"image-assets/{mine.tenant_id}/sha256/{digest[:2]}/{digest}.png"
    assert (tmp_path / key).read_bytes() == data

    read = await population.get(f"{API}/{digest}", headers=_bearer(DEVICE_A))
    assert read.status_code == 200, read.text
    assert read.json()["url"].endswith(key)

    foreign = await population.get(f"{API}/{digest}", headers=_bearer(DEVICE_B))
    assert foreign.status_code == 404


async def test_slot_candidates_chosen_listed_and_withdrawn(population) -> None:
    """Device A proposes, chooses, re-chooses (the first returns to candidate),
    lists and withdraws a slot candidate; device B's list of the slot is empty."""
    mine, theirs = await _resolve(DEVICE_A), await _resolve(DEVICE_B)
    assert mine.tenant_id != theirs.tenant_id

    first = await _upload(population, DEVICE_A, _png((1, 2, 3)))
    second = await _upload(population, DEVICE_A, _png((4, 5, 6)))
    slot = {"repo": "qontinui-web", "slot_id": "home.hero"}

    chosen = await population.put(
        SLOTS,
        headers=_bearer(DEVICE_A),
        json={**slot, "asset_sha256": first, "status": "chosen"},
    )
    assert chosen.status_code == 201, chosen.text
    rechosen = await population.put(
        SLOTS,
        headers=_bearer(DEVICE_A),
        json={**slot, "asset_sha256": second, "status": "chosen"},
    )
    assert rechosen.status_code == 201, rechosen.text
    assert [d["asset_sha256"] for d in rechosen.json()["demoted"]] == [first]

    listed = await population.get(SLOTS, params=slot, headers=_bearer(DEVICE_A))
    assert listed.status_code == 200, listed.text
    assert {c["asset_sha256"]: c["status"] for c in listed.json()["candidates"]} == {
        first: "candidate",
        second: "chosen",
    }
    # The other tenant's device sees none of it.
    other = await population.get(SLOTS, params=slot, headers=_bearer(DEVICE_B))
    assert other.status_code == 200 and other.json()["candidates"] == []

    withdrawn = await population.delete(
        SLOTS, params={**slot, "asset_sha256": second}, headers=_bearer(DEVICE_A)
    )
    assert withdrawn.status_code == 204, withdrawn.text
    after = await population.get(SLOTS, params=slot, headers=_bearer(DEVICE_A))
    assert [c["asset_sha256"] for c in after.json()["candidates"]] == [first]
