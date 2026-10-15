"""The taste inbox entered the way its two populations enter it.

Plan ``2026-10-13-image-generation-and-visual-judgment`` Phase 23. The inbox
has two populations:

* **studio**, a device holding a coord device JWT, which pushes pairs and
  reads the labels back (Phases 20 and 24);
* **the operator**, a person signed in to the console, who labels.

``tests/test_taste_api.py`` covers the routes in depth with every dependency
replaced. These tests keep the request's path real except where noted:

* the request goes through ``app.main.app`` — its middleware stack and its
  router;
* the device's tenant comes from the REAL ``get_memory_tenant``, given a
  device JWT; coord's signature check and the backend's device verification
  are stubbed, exactly as ``tests/test_image_assets_population.py`` stubs
  them;
* the operator's tenant and admin check come from the REAL
  ``require_coord_tenant_admin_target`` (and the ``require_coord_tenant_admin``
  it depends on). What is stubbed is who the operator IS: the signed-in user
  (``get_current_active_user_async``, a real ``auth.users`` row) and what
  coord's ``/admin/coord/me`` says about them (``get_coord_identity``, a real
  ``CoordIdentity``) — the admin decision itself runs as written;
* only the database session is the test's own.

They import nothing this phase added, so without the phase they fail on the
missing routes, not on an import — which is what makes them the phase's
arming tests (``qontinui-claude-config/scripts/arming-record.sh``).
"""

from __future__ import annotations

import io
from collections.abc import AsyncIterator, Callable
from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock, MagicMock
from uuid import UUID, uuid4

import httpx
import pytest
import pytest_asyncio
from fastapi.security import HTTPAuthorizationCredentials
from PIL import Image
from sqlalchemy.ext.asyncio import AsyncSession

from app.api import deps
from app.api.deps import get_async_db
from app.api.v1.endpoints import memory as memory_ep
from app.api.v1.endpoints import operations as operations_ep
from app.models.user import User
from app.services import storage as storage_module
from app.services.coord_identity import CoordIdentity, CoordTenant

pytestmark = pytest.mark.asyncio

ASSETS = "/api/v1/image-assets"
TASTE = "/api/v1/taste"
DEVICE_A = "taste-device-a"
DEVICE_B = "taste-device-b"


class World:
    """The real app, two devices of two tenants, and a switchable operator."""

    def __init__(self, client: httpx.AsyncClient, tenants: dict[str, UUID]) -> None:
        self.client = client
        self.tenants = tenants
        self.roles: tuple[str, ...] = ("admin",)


@pytest_asyncio.fixture()
async def world(
    async_db_session: AsyncSession,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> AsyncIterator[World]:
    from app.main import app

    tenants = {DEVICE_A: uuid4(), DEVICE_B: uuid4()}
    claims = {
        device: {
            "user_id": str(uuid4()),
            "device_id": str(uuid4()),
            "tenant_id": str(tenant),
        }
        for device, tenant in tenants.items()
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
    monkeypatch.setattr(
        storage_module.object_storage,
        "backend",
        storage_module.LocalBackend(base_path=tmp_path),
    )

    operator = User(
        email=f"taste-operator-{uuid4().hex[:8]}@example.com",
        username=f"taste-operator-{uuid4().hex[:8]}",
        full_name="Taste Operator",
        is_active=True,
        is_verified=True,
        is_superuser=False,
    )
    async_db_session.add(operator)
    await async_db_session.flush()

    async def _db() -> AsyncIterator[AsyncSession]:
        yield async_db_session

    client = httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    )
    w = World(client, tenants)

    def _identity(*_args: Any, **_kwargs: Any) -> CoordIdentity:
        home = tenants[DEVICE_A]
        return CoordIdentity(
            operator_id=uuid4(),
            home_tenant_id=home,
            email=operator.email,
            roles=w.roles,
            tenants=(CoordTenant(tenant_id=home, slug="tenant-a", roles=w.roles),),
            is_admin="admin" in w.roles,
        )

    monkeypatch.setattr(
        operations_ep, "get_coord_identity", AsyncMock(side_effect=_identity)
    )

    saved = dict(app.dependency_overrides)
    app.dependency_overrides[get_async_db] = _db
    app.dependency_overrides[deps.get_current_active_user_async] = lambda: operator
    try:
        async with client:
            yield w
    finally:
        app.dependency_overrides.clear()
        app.dependency_overrides.update(saved)


async def _resolve(device: str) -> Any:
    """The principal a device's credential resolves to, through the dependency
    the push and the label read resolve it with."""
    return await memory_ep.get_memory_tenant(
        request=MagicMock(),
        user=None,
        credentials=HTTPAuthorizationCredentials(scheme="Bearer", credentials=device),
    )


async def _admin_target(roles: tuple[str, ...], user: User, home: UUID) -> UUID:
    """The tenant an operator's label lands in, through the admin gate the
    label door depends on — or the gate's refusal."""
    request = MagicMock()
    request.headers = {}
    identity = CoordIdentity(
        operator_id=uuid4(),
        home_tenant_id=home,
        email=user.email,
        roles=roles,
        tenants=(CoordTenant(tenant_id=home, slug="tenant-a", roles=roles),),
        is_admin="admin" in roles,
    )
    patched: Callable[..., Any] = AsyncMock(return_value=identity)
    original = operations_ep.get_coord_identity
    operations_ep.get_coord_identity = patched  # type: ignore[assignment]
    try:
        admin_home = await operations_ep.require_coord_tenant_admin(
            request=request, current_user=user
        )
        return await operations_ep.require_coord_tenant_admin_target(
            request=request, home_tenant_id=admin_home
        )
    finally:
        operations_ep.get_coord_identity = original  # type: ignore[assignment]


def _bearer(device: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {device}"}


def _png(rgb: tuple[int, int, int]) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (6, 4), rgb).save(buf, format="PNG")
    return buf.getvalue()


async def _upload(
    client: httpx.AsyncClient, device: str, rgb: tuple[int, int, int]
) -> str:
    resp = await client.post(
        ASSETS,
        headers=_bearer(device),
        data={"kind": "candidate"},
        files={"file": ("upload.bin", _png(rgb), "application/octet-stream")},
    )
    assert resp.status_code == 201, resp.text
    digest: str = resp.json()["sha256"]
    return digest


# Signatures stay on ONE line, unannotated: the arming check's Python reader
# ends a function at the first line indented no deeper than its `def`.


async def test_studio_pushes_the_operator_labels_studio_reads_it_back(world) -> None:
    """Device A pushes a pair over two of its images; device B of another
    tenant sees none of it; the operator — an admin of A's tenant — labels it
    through the admin door; device A reads the label, with its labeller, from
    the twin's read."""
    mine, theirs = await _resolve(DEVICE_A), await _resolve(DEVICE_B)
    assert mine.tenant_id != theirs.tenant_id

    left = await _upload(world.client, DEVICE_A, (200, 120, 40))
    right = await _upload(world.client, DEVICE_A, (40, 120, 200))
    pushed = await world.client.post(
        f"{TASTE}/pairs",
        headers=_bearer(DEVICE_A),
        json={
            "asset_a_sha256": left,
            "asset_b_sha256": right,
            "repo": "qontinui-web",
            "slot_id": "home.hero",
            "source": "active_learning",
            "uncertainty": 0.8,
            "context": {"panel": "split 2-2"},
        },
    )
    assert pushed.status_code == 201, pushed.text
    pair = pushed.json()["pair"]
    assert pair["pushed_by"] == "device" and pair["in_situ"] is False

    queue = await world.client.get(f"{TASTE}/inbox", headers=_bearer(DEVICE_A))
    assert queue.status_code == 200, queue.text
    assert [p["id"] for p in queue.json()["pairs"]] == [pair["id"]]
    assert queue.json()["can_label"] is False  # a device never labels
    other = await world.client.get(f"{TASTE}/inbox", headers=_bearer(DEVICE_B))
    assert other.json()["pending_total"] == 0

    # The operator's label lands in the tenant the admin gate resolves: A's.
    operator_tenant = await _admin_target(
        ("admin",), MagicMock(is_superuser=False), mine.tenant_id
    )
    assert operator_tenant == mine.tenant_id
    labelled = await world.client.put(
        f"{TASTE}/pairs/{pair['id']}/label",
        json={"choice": "b", "reasons": ["off_palette"], "comment": "B is calmer"},
    )
    assert labelled.status_code == 200, labelled.text
    assert labelled.json()["labeller_name"] == "Taste Operator"

    twin = await world.client.get(f"{TASTE}/labels", headers=_bearer(DEVICE_A))
    assert twin.status_code == 200, twin.text
    [row] = twin.json()["labels"]
    assert row["id"] == pair["id"] and row["label"] == "b"
    assert row["reasons"] == ["off_palette"] and row["comment"] == "B is calmer"
    assert (
        await world.client.get(f"{TASTE}/labels", headers=_bearer(DEVICE_B))
    ).json()["labels"] == []


async def test_a_member_who_is_not_admin_cannot_label(world) -> None:
    """The label door refuses an operator who holds no admin role in the
    tenant — through the real gate — and the pair stays unanswered."""
    mine = await _resolve(DEVICE_A)
    left = await _upload(world.client, DEVICE_A, (1, 2, 3))
    right = await _upload(world.client, DEVICE_A, (4, 5, 6))
    pushed = await world.client.post(
        f"{TASTE}/pairs",
        headers=_bearer(DEVICE_A),
        json={"asset_a_sha256": left, "asset_b_sha256": right, "source": "calibration"},
    )
    assert pushed.status_code == 201, pushed.text
    pair_id = pushed.json()["pair"]["id"]

    with pytest.raises(Exception) as refused:
        await _admin_target(
            ("developer",), MagicMock(is_superuser=False), mine.tenant_id
        )
    assert "not_coord_tenant_admin" in str(
        getattr(refused.value, "detail", refused.value)
    )

    world.roles = ("developer",)
    resp = await world.client.put(
        f"{TASTE}/pairs/{pair_id}/label", json={"choice": "a"}
    )
    assert resp.status_code == 403, resp.text
    still = await world.client.get(f"{TASTE}/inbox", headers=_bearer(DEVICE_A))
    assert [p["id"] for p in still.json()["pairs"]] == [pair_id]
