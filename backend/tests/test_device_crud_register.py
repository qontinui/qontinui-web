"""Tests for ``app.crud.device_crud.register_device`` — device-id keying.

Background:

Prior to this change, ``register_device`` upserted on ``(user_id, name)``
and ignored any JWT-asserted ``device_id``. That broke the
unified-devices contract — coord's pair-cli inserts a row with
``device_id = <machine.json uuid>``, and the WS handshake (which has
the JWT-asserted ``token_device_id``) would create a SEPARATE row with
a web-generated UUID. Surfaced 2026-05-21 as the
``devices_ws_token_device_id_mismatch`` warning firing alongside every
successful WS connection.

This file pins the new behavior:

* When ``device_id`` is supplied, the upsert is keyed on it; a
  freshly-created row gets exactly that ``device_id`` (the model's
  ``default=uuid4`` is overridden).
* When ``device_id`` is ``None`` (legacy test-only callers), the
  upsert falls back to ``(user_id, name)`` and the resulting row gets
  a server-generated UUID — preserving backward compatibility for
  test fixtures that don't go through coord pairing.
"""

from __future__ import annotations

from uuid import uuid4

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.crud import device_crud
from app.models.device import Device

# ---------------------------------------------------------------------------
# When device_id is supplied (WS handshake path)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_creates_row_with_supplied_device_id(
    async_db_session: AsyncSession, test_user
) -> None:
    """The JWT-asserted device_id must end up as the row's PK, not a
    fresh server-generated UUID."""
    coord_device_id = uuid4()
    record = await device_crud.register_device(
        async_db_session,
        device_id=coord_device_id,
        user_id=test_user.id,
        name="test-runner",
        hostname="spaceship",
        port=9877,
        capabilities=["gui_automation"],
        restate_enabled=False,
        restate_healthy=False,
    )
    assert record.device_id == coord_device_id, (
        f"row's device_id must equal the supplied coord_device_id; "
        f"got {record.device_id!r} vs supplied {coord_device_id!r}"
    )
    assert record.name == "test-runner"
    assert record.user_id == test_user.id
    assert record.capability_user_paired is True
    assert record.derived_status == "healthy"
    # disk_reserved_gb must default to 0 (the device-model parity fix
    # from #186 made this load-bearing).
    assert record.disk_reserved_gb == 0


@pytest.mark.asyncio
async def test_re_register_with_same_device_id_finds_existing_row(
    async_db_session: AsyncSession, test_user
) -> None:
    """Second call with the same device_id must refresh the SAME row,
    not create a duplicate. This is what unified-devices needs — every
    reconnect from the same physical machine hits one canonical row."""
    coord_device_id = uuid4()

    first = await device_crud.register_device(
        async_db_session,
        device_id=coord_device_id,
        user_id=test_user.id,
        name="test-runner",
        hostname="spaceship",
        port=9877,
        capabilities=["gui_automation"],
        restate_enabled=False,
        restate_healthy=False,
    )

    second = await device_crud.register_device(
        async_db_session,
        device_id=coord_device_id,
        user_id=test_user.id,
        name="test-runner",
        hostname="spaceship-renamed",  # the runner may rebrand itself
        port=9878,
        capabilities=["gui_automation", "accessibility"],
        restate_enabled=True,
        restate_healthy=True,
    )

    assert second.device_id == coord_device_id
    assert second.device_id == first.device_id, "must be the SAME row"
    # Metadata refreshed
    assert second.hostname == "spaceship-renamed"
    assert second.port == 9878
    assert second.capabilities == ["gui_automation", "accessibility"]
    assert second.restate_enabled is True

    # Only one row total for this device_id
    result = await async_db_session.execute(
        select(Device).where(Device.device_id == coord_device_id)
    )
    rows = result.scalars().all()
    assert len(rows) == 1


@pytest.mark.asyncio
async def test_supplied_device_id_supersedes_name_match(
    async_db_session: AsyncSession, test_user
) -> None:
    """Edge case: two different physical machines happen to share a
    name (e.g. both temp runners spawn with name='test-9877'). With
    ``device_id`` supplied, each gets its own row keyed on its own
    coord-asserted identity. Without ``device_id``, they'd collide
    on (user_id, name) — which was the pre-fix bug."""
    device_a = uuid4()
    device_b = uuid4()
    assert device_a != device_b

    row_a = await device_crud.register_device(
        async_db_session,
        device_id=device_a,
        user_id=test_user.id,
        name="test-9877",  # same name as below
        hostname="machine-a",
        port=9877,
        capabilities=[],
        restate_enabled=False,
        restate_healthy=False,
    )

    row_b = await device_crud.register_device(
        async_db_session,
        device_id=device_b,
        user_id=test_user.id,
        name="test-9877",  # same name as above
        hostname="machine-b",
        port=9877,
        capabilities=[],
        restate_enabled=False,
        restate_healthy=False,
    )

    assert row_a.device_id != row_b.device_id
    assert row_a.hostname == "machine-a"
    assert row_b.hostname == "machine-b"


@pytest.mark.asyncio
async def test_refresh_overwrites_user_id_and_name_from_jwt(
    async_db_session: AsyncSession, test_user
) -> None:
    """Coord is the identity authority — when the JWT carries new
    user_id / name (e.g. a device was re-paired to a different user
    or renamed), the row must reflect that on the next handshake."""
    coord_device_id = uuid4()

    first = await device_crud.register_device(
        async_db_session,
        device_id=coord_device_id,
        user_id=test_user.id,
        name="original-name",
        hostname="spaceship",
        port=9877,
        capabilities=[],
        restate_enabled=False,
        restate_healthy=False,
    )
    assert first.name == "original-name"
    assert first.user_id == test_user.id

    # JWT comes back with a different name (display-name change)
    second = await device_crud.register_device(
        async_db_session,
        device_id=coord_device_id,
        user_id=test_user.id,
        name="renamed",
        hostname="spaceship",
        port=9877,
        capabilities=[],
        restate_enabled=False,
        restate_healthy=False,
    )
    assert second.device_id == coord_device_id
    assert second.name == "renamed"


# ---------------------------------------------------------------------------
# When device_id is None (legacy test-only path)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_legacy_path_keys_on_user_id_name(
    async_db_session: AsyncSession, test_user
) -> None:
    """``device_id=None`` preserves the pre-unified-devices behavior:
    upsert on ``(user_id, name)`` with a server-generated UUID for new
    rows. Kept for test fixtures via ``runner_crud.register_runner``."""
    first = await device_crud.register_device(
        async_db_session,
        user_id=test_user.id,
        name="legacy-runner",
        hostname="spaceship",
        port=9877,
        capabilities=[],
        restate_enabled=False,
        restate_healthy=False,
    )
    # device_id is server-generated
    assert first.device_id is not None

    # Second call with same (user_id, name) refreshes the same row
    second = await device_crud.register_device(
        async_db_session,
        user_id=test_user.id,
        name="legacy-runner",
        hostname="spaceship-new",
        port=9878,
        capabilities=[],
        restate_enabled=False,
        restate_healthy=False,
    )
    assert second.device_id == first.device_id
    assert second.hostname == "spaceship-new"
