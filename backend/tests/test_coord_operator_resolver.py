"""Unit tests for `app.services.coord_operator_resolver`.

Covers the contracted resolution (posture C — **sub-only + fail-closed**):

1. Operator match in ``coord.operators`` keyed solely on the Cognito
   subject (``sso_subject = :cognito_sub``).
2. A sub miss (no operator row) or a NULL ``cognito_sub`` fails closed
   with 403 ``tenant_not_resolved`` — there is no email arm and no
   ``personal-jspinak`` bootstrap-slug resolution fallback.

The operator match is a single ``db.execute`` round-trip; on a miss the
resolver raises immediately (no second bootstrap query).
"""

from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest
from fastapi import HTTPException

from app.services.coord_operator_resolver import (
    PERSONAL_BOOTSTRAP_SLUG,
    resolve_tenant_for_user,
    resolve_tenants_for_user,
)


def _mock_user(
    email: str = "tenant.user@example.com",
    cognito_sub: str | None = None,
) -> MagicMock:
    user = MagicMock()
    user.id = uuid4()
    user.email = email
    # Explicit so the `getattr(user, "cognito_sub", None)` read is a real
    # value (None by default) rather than an auto-attribute MagicMock.
    user.cognito_sub = cognito_sub
    return user


class _StubResult:
    def __init__(self, row, rows=None):
        self._row = row
        self._rows = rows if rows is not None else ([] if row is None else [row])

    def first(self):
        return self._row

    def fetchall(self):
        return self._rows


def _stub_db_session(*results):
    """Build an AsyncSession.execute stub returning ``results`` in order.

    Each element is a ``_StubResult``. Sub-only resolution issues exactly
    ONE operator query and then either returns or raises, so a single
    result is sufficient for these tests.
    """
    db = MagicMock()
    db.execute = AsyncMock(side_effect=list(results))
    return db


@pytest.mark.asyncio
async def test_resolves_via_operator_sub_match():
    """Operator row matched by Cognito sub → returns its tenant_id.

    Sub-only: a single round-trip, no bootstrap query.
    """
    user = _mock_user(email="josh@qontinui.io", cognito_sub="cognito-sub-123")
    tenant_id = uuid4()
    db = _stub_db_session(_StubResult((str(tenant_id),)))

    out = await resolve_tenant_for_user(user, db)

    assert out == tenant_id
    assert db.execute.await_count == 1
    # Only the Cognito sub is bound — no email param.
    bound = db.execute.await_args_list[0].args[1]
    assert bound["cognito_sub"] == "cognito-sub-123"
    assert "email" not in bound


@pytest.mark.asyncio
async def test_raises_403_when_sub_misses():
    """No operator row for the sub → 403 ``tenant_not_resolved`` (fail-closed).

    There is no email fallback and no bootstrap-slug fallback, so a single
    operator query that misses raises immediately.
    """
    user = _mock_user(email="other.user@example.com", cognito_sub="sub-x")
    db = _stub_db_session(_StubResult(None))

    with pytest.raises(HTTPException) as exc_info:
        await resolve_tenant_for_user(user, db)

    assert exc_info.value.status_code == 403
    assert exc_info.value.detail == "tenant_not_resolved"
    # No second (bootstrap) query was issued.
    assert db.execute.await_count == 1


@pytest.mark.asyncio
async def test_raises_403_when_cognito_sub_null():
    """cognito_sub is NULL → 403 (no email fallback under sub-only).

    The bind param is None so the ``sso_subject = :cognito_sub`` predicate
    can never match; the resolver fails closed.
    """
    user = _mock_user(email="legacy@qontinui.io", cognito_sub=None)
    db = _stub_db_session(_StubResult(None))

    with pytest.raises(HTTPException) as exc_info:
        await resolve_tenant_for_user(user, db)

    assert exc_info.value.status_code == 403
    assert exc_info.value.detail == "tenant_not_resolved"
    bound = db.execute.await_args_list[0].args[1]
    assert bound["cognito_sub"] is None


@pytest.mark.asyncio
async def test_resolve_tenants_via_sub_match():
    """resolve_tenants_for_user returns the membership set on a sub match."""
    user = _mock_user(email="josh@qontinui.io", cognito_sub="cognito-sub-123")
    t1 = uuid4()
    t2 = uuid4()
    rows = [(str(t1), "acme", str(t1)), (str(t2), "beta", str(t1))]
    db = _stub_db_session(_StubResult(None, rows=rows))

    out = await resolve_tenants_for_user(user, db)

    assert out == [t1, t2]
    assert db.execute.await_count == 1
    bound = db.execute.await_args_list[0].args[1]
    assert bound["cognito_sub"] == "cognito-sub-123"
    assert "email" not in bound


@pytest.mark.asyncio
async def test_resolve_tenants_raises_403_on_sub_miss():
    """resolve_tenants_for_user fails closed (403) when the sub misses."""
    user = _mock_user(email="ghost@example.com", cognito_sub="sub-none")
    db = _stub_db_session(_StubResult(None, rows=[]))

    with pytest.raises(HTTPException) as exc_info:
        await resolve_tenants_for_user(user, db)

    assert exc_info.value.status_code == 403
    assert exc_info.value.detail == "tenant_not_resolved"
    # Sub-only: single membership query, no bootstrap query.
    assert db.execute.await_count == 1


def test_personal_bootstrap_slug_is_stable():
    """``PERSONAL_BOOTSTRAP_SLUG`` is retained ONLY for the
    ``user_is_coord_tenant_admin`` bootstrap-parity admin safety net
    (resolution no longer uses it). Lockstep with alembic
    ``coord_tenant_scope_columns._PERSONAL_SLUG``.
    """
    assert PERSONAL_BOOTSTRAP_SLUG == "personal-jspinak"
