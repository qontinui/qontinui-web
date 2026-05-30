"""Unit tests for ``user_is_coord_tenant_admin`` in
``app.services.coord_operator_resolver``.

Covers the four key decision branches:

1. Admin-role row present → True.
2. Operator exists but NO admin role → False.
3. No operator row, tenant_id matches personal-jspinak bootstrap → True
   (bootstrap-parity branch).
4. No operator row, tenant_id does NOT match personal-jspinak → False.

All database I/O is replaced with ``AsyncMock`` stubs so no live DB is
required. The mocking style mirrors ``test_coord_operator_resolver.py``:
a ``_StubResult`` wrapper that implements ``.first()`` so the resolver's
``(await db.execute(...)).first()`` call chain works correctly.
"""

from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest

from app.services.coord_operator_resolver import (
    PERSONAL_BOOTSTRAP_SLUG,
    user_is_coord_tenant_admin,
)

# ---------------------------------------------------------------------------
# Helpers (identical shape to test_coord_operator_resolver.py)
# ---------------------------------------------------------------------------


def _mock_user(email: str = "user@example.com") -> MagicMock:
    user = MagicMock()
    user.id = uuid4()
    user.email = email
    return user


class _StubResult:
    """Minimal AsyncSession.execute result stub.

    Implements only ``.first()`` — all the resolver uses.
    """

    def __init__(self, row):
        self._row = row

    def first(self):
        return self._row


def _stub_db(*rows):
    """Build an AsyncSession stub whose ``execute`` returns ``rows`` in order.

    Each element of *rows* is the value that will be returned by the
    corresponding ``.first()`` call.  Pass ``None`` to signal "no row."
    """
    db = MagicMock()
    db.execute = AsyncMock(side_effect=[_StubResult(r) for r in rows])
    return db


# ---------------------------------------------------------------------------
# Tests — Step 1: direct admin-role check
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_admin_role_row_present_returns_true():
    """operator row with role='admin' for the tenant → True."""
    user = _mock_user(email="admin@qontinui.io")
    tenant_id = uuid4()
    # First execute: admin-role JOIN query returns a row.
    db = _stub_db((1,))

    result = await user_is_coord_tenant_admin(user, tenant_id, db)

    assert result is True
    # Only the admin-role query fired; bootstrap sub-queries stay unfired.
    assert db.execute.await_count == 1


@pytest.mark.asyncio
async def test_email_lowercased_in_admin_check():
    """Email casing is normalised before the admin-role query."""
    user = _mock_user(email="ADMIN@QONTINUI.IO")
    tenant_id = uuid4()
    db = _stub_db((1,))

    await user_is_coord_tenant_admin(user, tenant_id, db)

    call_kwargs = db.execute.await_args_list[0].args[1]
    assert call_kwargs["email"] == "admin@qontinui.io"


# ---------------------------------------------------------------------------
# Tests — Step 1 miss → Step 2: operator-exists check
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_operator_exists_no_admin_role_returns_false():
    """Operator row exists (for a different role) → deny (no bootstrap bypass)."""
    user = _mock_user(email="member@qontinui.io")
    tenant_id = uuid4()
    # Query 1: admin-role JOIN → miss.
    # Query 2: operator-exists check → row found (operator IS registered).
    db = _stub_db(None, (1,))

    result = await user_is_coord_tenant_admin(user, tenant_id, db)

    assert result is False
    # Both queries fired; bootstrap tenant lookup was NOT issued.
    assert db.execute.await_count == 2


# ---------------------------------------------------------------------------
# Tests — Step 2: no operator row → bootstrap-parity check
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_no_operator_matching_bootstrap_tenant_returns_true():
    """No operator row AND tenant_id matches personal-jspinak → True
    (bootstrap-parity: the sole pre-SSO user is the owner)."""
    user = _mock_user(email="bootstrap@example.com")
    bootstrap_tenant_id = uuid4()
    # Query 1: admin-role JOIN → miss.
    # Query 2: operator-exists → miss (no operator row at all).
    # Query 3: bootstrap tenant by slug → returns the matching tenant_id.
    db = _stub_db(None, None, (str(bootstrap_tenant_id),))

    result = await user_is_coord_tenant_admin(user, bootstrap_tenant_id, db)

    assert result is True
    assert db.execute.await_count == 3
    # Confirm the slug passed to query 3 is the canonical sentinel.
    slug_arg = db.execute.await_args_list[2].args[1]["slug"]
    assert slug_arg == PERSONAL_BOOTSTRAP_SLUG


@pytest.mark.asyncio
async def test_no_operator_different_tenant_returns_false():
    """No operator row AND tenant_id does NOT match personal-jspinak → False."""
    user = _mock_user(email="ghost@example.com")
    caller_tenant_id = uuid4()  # the tenant the caller is asking about
    bootstrap_tenant_id = uuid4()  # different UUID returned by the slug query
    assert caller_tenant_id != bootstrap_tenant_id
    # Query 1: admin-role JOIN → miss.
    # Query 2: operator-exists → miss.
    # Query 3: bootstrap tenant → returns a DIFFERENT UUID.
    db = _stub_db(None, None, (str(bootstrap_tenant_id),))

    result = await user_is_coord_tenant_admin(user, caller_tenant_id, db)

    assert result is False


@pytest.mark.asyncio
async def test_no_operator_bootstrap_tenant_missing_returns_false():
    """No operator row AND no personal-jspinak tenant in DB → False."""
    user = _mock_user(email="nobody@example.com")
    tenant_id = uuid4()
    # Query 1: admin-role JOIN → miss.
    # Query 2: operator-exists → miss.
    # Query 3: bootstrap tenant → miss (fresh DB, slug not inserted yet).
    db = _stub_db(None, None, None)

    result = await user_is_coord_tenant_admin(user, tenant_id, db)

    assert result is False


# ---------------------------------------------------------------------------
# Sanity — bootstrap slug constant is stable
# ---------------------------------------------------------------------------


def test_personal_bootstrap_slug_stable():
    """Lockstep sentinel — same value as alembic migration constant."""
    assert PERSONAL_BOOTSTRAP_SLUG == "personal-jspinak"
