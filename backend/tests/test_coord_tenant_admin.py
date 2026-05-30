"""Unit tests for ``user_is_coord_tenant_admin`` in
``app.services.coord_operator_resolver``.

Covers the four key decision branches (sub-only operator lookup):

1. Admin-role row present (matched by Cognito sub) → True.
2. Operator exists but NO admin role → False.
3. No operator row, tenant_id matches personal-jspinak bootstrap → True
   (bootstrap-parity admin safety net — deliberately PRESERVED).
4. No operator row, tenant_id does NOT match personal-jspinak → False.

All database I/O is replaced with ``AsyncMock`` stubs so no live DB is
required. The operator lookup is keyed SOLELY on the Cognito identity
(``o.sso_subject = :cognito_sub``); there is no email fallback. The
bootstrap-parity branch (#3) is an authz safety net, not a tenant
resolution fallback — resolution itself is sub-only / fail-closed.
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


def _mock_user(
    email: str = "user@example.com",
    cognito_sub: str | None = None,
) -> MagicMock:
    user = MagicMock()
    user.id = uuid4()
    user.email = email
    user.cognito_sub = cognito_sub
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
# Tests — Step 1: direct admin-role check (sub-only)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_admin_role_row_present_via_sub_returns_true():
    """operator matched by Cognito sub with role='admin' → True."""
    user = _mock_user(email="admin@qontinui.io", cognito_sub="sub-admin-1")
    tenant_id = uuid4()
    # First execute: admin-role JOIN query returns a row.
    db = _stub_db((1,))

    result = await user_is_coord_tenant_admin(user, tenant_id, db)

    assert result is True
    # Only the admin-role query fired; bootstrap sub-queries stay unfired.
    assert db.execute.await_count == 1
    # Only the Cognito sub is bound — no email param.
    call_kwargs = db.execute.await_args_list[0].args[1]
    assert call_kwargs["cognito_sub"] == "sub-admin-1"
    assert "email" not in call_kwargs
    assert call_kwargs["tid"] == str(tenant_id)


@pytest.mark.asyncio
async def test_admin_check_null_sub_falls_through_to_bootstrap():
    """cognito_sub NULL → admin-role query misses (no email arm); falls
    through to the operator-exists + bootstrap-parity checks.

    With no operator row and a non-bootstrap tenant, the result is False —
    confirming there is no email fallback keeping a NULL-sub user admin.
    """
    user = _mock_user(email="legacy.admin@qontinui.io", cognito_sub=None)
    tenant_id = uuid4()
    bootstrap_tenant_id = uuid4()  # different → not the bootstrap tenant
    # Query 1: admin-role JOIN → miss (sub is NULL).
    # Query 2: operator-exists → miss.
    # Query 3: bootstrap tenant → a DIFFERENT uuid.
    db = _stub_db(None, None, (str(bootstrap_tenant_id),))

    result = await user_is_coord_tenant_admin(user, tenant_id, db)

    assert result is False
    assert db.execute.await_count == 3
    call_kwargs = db.execute.await_args_list[0].args[1]
    assert call_kwargs["cognito_sub"] is None
    assert "email" not in call_kwargs


# ---------------------------------------------------------------------------
# Tests — Step 1 miss → Step 2: operator-exists check
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_operator_exists_no_admin_role_returns_false():
    """Operator row exists (for a different role) → deny (no bootstrap bypass)."""
    user = _mock_user(email="member@qontinui.io", cognito_sub="sub-member")
    tenant_id = uuid4()
    # Query 1: admin-role JOIN → miss.
    # Query 2: operator-exists check → row found (operator IS registered).
    db = _stub_db(None, (1,))

    result = await user_is_coord_tenant_admin(user, tenant_id, db)

    assert result is False
    # Both queries fired; bootstrap tenant lookup was NOT issued.
    assert db.execute.await_count == 2


# ---------------------------------------------------------------------------
# Tests — Step 2: no operator row → bootstrap-parity check (PRESERVED)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_no_operator_matching_bootstrap_tenant_returns_true():
    """No operator row AND tenant_id matches personal-jspinak → True
    (bootstrap-parity admin safety net: the sole pre-SSO user is owner)."""
    user = _mock_user(email="bootstrap@example.com", cognito_sub="sub-fresh")
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
    user = _mock_user(email="ghost@example.com", cognito_sub="sub-ghost")
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
    user = _mock_user(email="nobody@example.com", cognito_sub="sub-nobody")
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
