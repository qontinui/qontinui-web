"""Tests for :mod:`app.crud.device_machine_credential_crud` (``dmk_``).

Two layers, mirroring ``test_devenv_environments.py``:

* **Layer 1 — pure unit tests (no DB):** key generation shape (``dmk_``
  prefix, sha256 hex hash, non-secret display prefix, uniqueness) and the
  :func:`is_usable` revoked/expired predicate.
* **Layer 2 — DB-backed CRUD (real Postgres):** ``mint`` (insert + UPSERT
  rotate), ``get_by_hash``, ``revoke``, ``bump_last_used`` sliding TTL, and
  the one-active-key-per-device uniqueness. ``owner_user_id`` is left NULL
  so the rows are self-contained (``device_id`` is a soft reference — no FK
  to satisfy).
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.crud import device_machine_credential_crud as dmk_crud
from app.models.devenv import DeviceMachineCredential

# ===========================================================================
# Layer 1 — pure unit tests (no DB)
# ===========================================================================


class TestDeviceMachineKeyGeneration:
    """:func:`generate_device_machine_key` — key material shape."""

    def test_key_prefix_hash_shape(self) -> None:
        """Generated key: dmk_ prefix, sha256 hex hash, non-secret prefix."""
        plaintext, dmk_hash, dmk_prefix = dmk_crud.generate_device_machine_key()

        assert plaintext.startswith("dmk_")
        assert dmk_hash == dmk_crud.hash_device_machine_key(plaintext)
        assert len(dmk_hash) == 64
        assert all(c in "0123456789abcdef" for c in dmk_hash)
        assert plaintext.startswith(dmk_prefix)
        assert dmk_prefix.startswith("dmk_")
        assert dmk_prefix != plaintext
        assert dmk_prefix != dmk_hash
        assert len(dmk_prefix) == dmk_crud.DEVICE_MACHINE_KEY_PREFIX_LEN

    def test_two_generations_differ(self) -> None:
        """Two generations yield distinct keys + hashes."""
        a_plain, a_hash, _ = dmk_crud.generate_device_machine_key()
        b_plain, b_hash, _ = dmk_crud.generate_device_machine_key()
        assert a_plain != b_plain
        assert a_hash != b_hash


class TestIsUsable:
    """:func:`is_usable` — revoked/expired predicate."""

    def test_fresh_key_usable(self) -> None:
        """A non-revoked key with a future expiry is usable."""
        cred = DeviceMachineCredential(
            device_id=uuid4(),
            dmk_hash="x",
            dmk_prefix="dmk_x",
            expires_at=datetime.now(UTC) + timedelta(days=1),
        )
        assert dmk_crud.is_usable(cred) is True

    def test_no_expiry_usable(self) -> None:
        """A NULL expiry never lapses."""
        cred = DeviceMachineCredential(
            device_id=uuid4(), dmk_hash="x", dmk_prefix="dmk_x", expires_at=None
        )
        assert dmk_crud.is_usable(cred) is True

    def test_expired_not_usable(self) -> None:
        """A past expiry is not usable."""
        cred = DeviceMachineCredential(
            device_id=uuid4(),
            dmk_hash="x",
            dmk_prefix="dmk_x",
            expires_at=datetime.now(UTC) - timedelta(seconds=1),
        )
        assert dmk_crud.is_usable(cred) is False

    def test_revoked_not_usable(self) -> None:
        """A revoked key is not usable even with a future expiry."""
        cred = DeviceMachineCredential(
            device_id=uuid4(),
            dmk_hash="x",
            dmk_prefix="dmk_x",
            expires_at=datetime.now(UTC) + timedelta(days=1),
            revoked_at=datetime.now(UTC),
        )
        assert dmk_crud.is_usable(cred) is False


# ===========================================================================
# Layer 2 — DB-backed CRUD (real Postgres via async_db_session)
# ===========================================================================


@pytest.mark.asyncio
class TestDeviceMachineCredentialCrud:
    """``mint`` / ``get_by_hash`` / ``revoke`` / ``bump_last_used``."""

    async def test_mint_then_get_by_hash(self, async_db_session: AsyncSession) -> None:
        """Minting stores hash+prefix+expiry and is resolvable by hash."""
        device_id = uuid4()
        plaintext, cred = await dmk_crud.mint(
            async_db_session, device_id=device_id, owner_user_id=None
        )

        assert plaintext.startswith("dmk_")
        assert cred.device_id == device_id
        assert cred.dmk_hash == dmk_crud.hash_device_machine_key(plaintext)
        assert cred.revoked_at is None
        assert cred.expires_at is not None

        found = await dmk_crud.get_by_hash(async_db_session, cred.dmk_hash)
        assert found is not None
        assert found.id == cred.id

        # Plaintext lookup resolves the same row.
        by_key = await dmk_crud.get_by_key(async_db_session, plaintext)
        assert by_key is not None
        assert by_key.id == cred.id

    async def test_remint_rotates_in_place(
        self, async_db_session: AsyncSession
    ) -> None:
        """Re-mint for the same device replaces the secret (UPSERT), one row."""
        device_id = uuid4()
        first_plain, first = await dmk_crud.mint(
            async_db_session, device_id=device_id, owner_user_id=None
        )
        first_id = first.id
        first_hash = first.dmk_hash

        second_plain, second = await dmk_crud.mint(
            async_db_session, device_id=device_id, owner_user_id=None
        )

        # Same row id (rotated in place), new secret.
        assert second.id == first_id
        assert second_plain != first_plain
        assert second.dmk_hash != first_hash

        # The OLD hash no longer resolves; the new one does.
        assert await dmk_crud.get_by_hash(async_db_session, first_hash) is None
        assert (
            await dmk_crud.get_by_hash(async_db_session, second.dmk_hash)
        ) is not None

    async def test_revoke_invalidates(self, async_db_session: AsyncSession) -> None:
        """Revoke stamps revoked_at and clears the hash so lookup fails."""
        device_id = uuid4()
        _, cred = await dmk_crud.mint(
            async_db_session, device_id=device_id, owner_user_id=None
        )
        original_hash = cred.dmk_hash

        revoked = await dmk_crud.revoke(async_db_session, device_id)
        assert revoked is not None
        assert revoked.revoked_at is not None
        assert dmk_crud.is_usable(revoked) is False
        # Hash cleared → the old key can no longer be resolved.
        assert (await dmk_crud.get_by_hash(async_db_session, original_hash)) is None

    async def test_revoke_absent_returns_none(
        self, async_db_session: AsyncSession
    ) -> None:
        """Revoking a device with no credential returns None."""
        assert await dmk_crud.revoke(async_db_session, uuid4()) is None

    async def test_bump_last_used_slides_expiry(
        self, async_db_session: AsyncSession
    ) -> None:
        """bump_last_used stamps usage and slides the expiry forward."""
        device_id = uuid4()
        _, cred = await dmk_crud.mint(
            async_db_session, device_id=device_id, owner_user_id=None, ttl_days=1
        )
        old_expiry = cred.expires_at
        assert cred.last_used_at is None

        await dmk_crud.bump_last_used(async_db_session, cred, slide_ttl_days=60)
        assert cred.last_used_at is not None
        assert cred.expires_at is not None
        assert cred.expires_at > old_expiry

    async def test_bump_last_used_no_slide(
        self, async_db_session: AsyncSession
    ) -> None:
        """slide_ttl_days=None bumps usage without extending the TTL."""
        device_id = uuid4()
        _, cred = await dmk_crud.mint(
            async_db_session, device_id=device_id, owner_user_id=None
        )
        old_expiry = cred.expires_at

        await dmk_crud.bump_last_used(async_db_session, cred, slide_ttl_days=None)
        assert cred.last_used_at is not None
        assert cred.expires_at == old_expiry
