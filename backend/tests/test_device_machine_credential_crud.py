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


# ===========================================================================
# Layer 2b — the self-mint guards, evaluated under mint()'s row lock
#
# Plan ``2026-09-24-runner-coord-credential-stranded-after-outage`` Phase 3:
# ``POST /devices/{id}/machine-credential/self-mint`` passes
# ``refuse_if_revoked=True`` + ``refuse_if_usable_beyond=7 days``.
# ===========================================================================

_WINDOW = timedelta(days=7)


async def _set_row(session: AsyncSession, device_id, **values) -> None:
    """Change the stored row with a Core UPDATE that bypasses the ORM
    identity map — the in-memory object goes STALE, which is exactly what a
    concurrent writer looks like to this session."""
    from sqlalchemy import update

    await session.execute(
        update(DeviceMachineCredential)
        .where(DeviceMachineCredential.device_id == device_id)
        .values(**values)
        .execution_options(synchronize_session=False)
    )


async def _self_mint(session: AsyncSession, device_id):
    return await dmk_crud.mint(
        session,
        device_id=device_id,
        owner_user_id=None,
        refuse_if_revoked=True,
        refuse_if_usable_beyond=_WINDOW,
    )


@pytest.mark.asyncio
class TestMintSelfGuards:
    async def test_no_key_mints(self, async_db_session: AsyncSession) -> None:
        plaintext, cred = await _self_mint(async_db_session, uuid4())
        assert plaintext.startswith("dmk_")
        assert cred.expires_at is not None

    async def test_usable_key_is_refused_and_untouched(
        self, async_db_session: AsyncSession
    ) -> None:
        device_id = uuid4()
        _, first = await dmk_crud.mint(
            async_db_session, device_id=device_id, owner_user_id=None
        )
        first_hash = first.dmk_hash
        with pytest.raises(dmk_crud.DeviceMachineKeyStillUsableError):
            await _self_mint(async_db_session, device_id)
        assert (await dmk_crud.get_by_hash(async_db_session, first_hash)) is not None

    async def test_key_without_expiry_is_refused(
        self, async_db_session: AsyncSession
    ) -> None:
        device_id = uuid4()
        await dmk_crud.mint(async_db_session, device_id=device_id, owner_user_id=None)
        await _set_row(async_db_session, device_id, expires_at=None)
        with pytest.raises(dmk_crud.DeviceMachineKeyStillUsableError):
            await _self_mint(async_db_session, device_id)

    async def test_key_within_window_is_rotated(
        self, async_db_session: AsyncSession
    ) -> None:
        device_id = uuid4()
        _, first = await dmk_crud.mint(
            async_db_session, device_id=device_id, owner_user_id=None
        )
        first_hash = first.dmk_hash
        await _set_row(
            async_db_session,
            device_id,
            expires_at=datetime.now(UTC) + timedelta(days=3),
        )
        _, second = await _self_mint(async_db_session, device_id)
        assert second.dmk_hash != first_hash
        assert second.expires_at is not None
        assert second.expires_at > datetime.now(UTC) + timedelta(days=50)

    async def test_expired_key_is_rotated(self, async_db_session: AsyncSession) -> None:
        device_id = uuid4()
        _, first = await dmk_crud.mint(
            async_db_session, device_id=device_id, owner_user_id=None
        )
        first_hash = first.dmk_hash
        await _set_row(
            async_db_session,
            device_id,
            expires_at=datetime.now(UTC) - timedelta(days=1),
        )
        _, second = await _self_mint(async_db_session, device_id)
        assert second.dmk_hash != first_hash

    async def test_revoked_key_is_refused_even_when_identity_map_is_stale(
        self, async_db_session: AsyncSession
    ) -> None:
        """The revoke lands via a Core UPDATE, so the session's cached object
        still says ``revoked_at is None``. The guard must read the locked,
        freshly loaded row (``populate_existing``), not the cache."""
        device_id = uuid4()
        _, cred = await dmk_crud.mint(
            async_db_session, device_id=device_id, owner_user_id=None
        )
        await _set_row(async_db_session, device_id, revoked_at=datetime.now(UTC))
        with pytest.raises(dmk_crud.DeviceMachineKeyRevokedError):
            await _self_mint(async_db_session, device_id)
        assert cred.revoked_at is not None  # refreshed, and NOT cleared

    async def test_owner_mint_still_rotates_over_revoked_and_usable(
        self, async_db_session: AsyncSession
    ) -> None:
        """Guards default off: the user-bearer /mint path is unchanged."""
        device_id = uuid4()
        await dmk_crud.mint(async_db_session, device_id=device_id, owner_user_id=None)
        # usable key -> rotated
        _, cred = await dmk_crud.mint(
            async_db_session, device_id=device_id, owner_user_id=None
        )
        await dmk_crud.revoke(async_db_session, device_id)
        # revoked key -> un-revoked by the owner's re-mint
        _, cred = await dmk_crud.mint(
            async_db_session, device_id=device_id, owner_user_id=None
        )
        assert cred.revoked_at is None


@pytest.mark.asyncio
class TestMintSelfGuardsRaceAndBoundary:
    async def test_first_insert_race_maps_to_still_usable(
        self, async_db_session: AsyncSession, monkeypatch
    ) -> None:
        """Simulate the race: a concurrent mint's row exists, but this call's
        locked SELECT saw nothing (it ran before that INSERT committed). The
        unique violation must surface as the 409-mapped error, and the
        winner's key must survive."""
        from unittest.mock import MagicMock

        device_id = uuid4()
        _, winner = await dmk_crud.mint(
            async_db_session, device_id=device_id, owner_user_id=None
        )
        winner_hash = winner.dmk_hash
        async_db_session.expunge(winner)

        real_execute = async_db_session.execute
        calls = {"n": 0}

        async def execute(stmt, *args, **kwargs):
            calls["n"] += 1
            if calls["n"] == 1:  # the locked SELECT inside mint()
                empty = MagicMock()
                empty.scalar_one_or_none.return_value = None
                return empty
            return await real_execute(stmt, *args, **kwargs)

        monkeypatch.setattr(async_db_session, "execute", execute)
        with pytest.raises(dmk_crud.DeviceMachineKeyStillUsableError):
            await _self_mint(async_db_session, device_id)
        monkeypatch.undo()

        # Session still usable (savepoint), and the winner's key is intact.
        assert (await dmk_crud.get_by_hash(async_db_session, winner_hash)) is not None

    async def test_owner_mint_race_still_raises_integrity_error(
        self, async_db_session: AsyncSession, monkeypatch
    ) -> None:
        """The unguarded owner path keeps today's behaviour."""
        from unittest.mock import MagicMock

        from sqlalchemy.exc import IntegrityError

        device_id = uuid4()
        _, winner = await dmk_crud.mint(
            async_db_session, device_id=device_id, owner_user_id=None
        )
        async_db_session.expunge(winner)
        real_execute = async_db_session.execute
        calls = {"n": 0}

        async def execute(stmt, *args, **kwargs):
            calls["n"] += 1
            if calls["n"] == 1:
                empty = MagicMock()
                empty.scalar_one_or_none.return_value = None
                return empty
            return await real_execute(stmt, *args, **kwargs)

        monkeypatch.setattr(async_db_session, "execute", execute)
        with pytest.raises(IntegrityError):
            await dmk_crud.mint(
                async_db_session, device_id=device_id, owner_user_id=None
            )

    async def test_expiry_exactly_at_window_is_rotated(
        self, async_db_session: AsyncSession
    ) -> None:
        device_id = uuid4()
        _, first = await dmk_crud.mint(
            async_db_session, device_id=device_id, owner_user_id=None
        )
        first_hash = first.dmk_hash
        await _set_row(
            async_db_session, device_id, expires_at=datetime.now(UTC) + _WINDOW
        )
        _, second = await _self_mint(async_db_session, device_id)
        assert second.dmk_hash != first_hash

    async def test_expiry_one_second_past_window_is_refused(
        self, async_db_session: AsyncSession
    ) -> None:
        device_id = uuid4()
        await dmk_crud.mint(async_db_session, device_id=device_id, owner_user_id=None)
        await _set_row(
            async_db_session,
            device_id,
            expires_at=datetime.now(UTC) + _WINDOW + timedelta(seconds=1),
        )
        with pytest.raises(dmk_crud.DeviceMachineKeyStillUsableError):
            await _self_mint(async_db_session, device_id)


class TestViolatedConstraint:
    """``_violated_constraint`` prefers the driver's structured name."""

    @staticmethod
    def _exc(orig: BaseException):
        from sqlalchemy.exc import IntegrityError

        return IntegrityError("INSERT ...", {}, orig)

    def test_structured_name_on_cause(self) -> None:
        class _PgError(Exception):
            constraint_name = dmk_crud._DEVICE_UNIQUE_CONSTRAINT

        translated = Exception("unrelated message text")
        translated.__cause__ = _PgError()
        assert (
            dmk_crud._violated_constraint(self._exc(translated))
            == dmk_crud._DEVICE_UNIQUE_CONSTRAINT
        )

    def test_structured_name_wins_over_message_text(self) -> None:
        class _PgError(Exception):
            constraint_name = "some_other_constraint"

        translated = Exception(f"mentions {dmk_crud._DEVICE_UNIQUE_CONSTRAINT}")
        translated.__cause__ = _PgError()
        assert (
            dmk_crud._violated_constraint(self._exc(translated))
            == "some_other_constraint"
        )

    def test_text_fallback_and_unknown(self) -> None:
        text_only = Exception(f'duplicate key "{dmk_crud._DEVICE_UNIQUE_CONSTRAINT}"')
        assert (
            dmk_crud._violated_constraint(self._exc(text_only))
            == dmk_crud._DEVICE_UNIQUE_CONSTRAINT
        )
        assert dmk_crud._violated_constraint(self._exc(Exception("nope"))) is None


@pytest.mark.asyncio
class TestSelfMintOtherIntegrityError:
    async def test_other_integrity_error_is_reraised_not_mapped_to_409(
        self, async_db_session: AsyncSession, monkeypatch
    ) -> None:
        """A violation of some OTHER constraint on the guarded insert must
        propagate; only the device-id unique violation means "a concurrent
        mint won" (409)."""
        from sqlalchemy.exc import IntegrityError

        real_flush = async_db_session.flush
        raised = {"n": 0}

        async def flush(*args, **kwargs):
            # Fail only the INSERT's flush (a pending credential), not the
            # SELECT's autoflush, so the guarded except-branch is what runs.
            if any(
                isinstance(o, DeviceMachineCredential) for o in async_db_session.new
            ):
                raised["n"] += 1
                raise IntegrityError("INSERT ...", {}, Exception("other_constraint"))
            return await real_flush(*args, **kwargs)

        monkeypatch.setattr(async_db_session, "flush", flush)
        with pytest.raises(IntegrityError):
            await _self_mint(async_db_session, uuid4())
        assert raised["n"] == 1
