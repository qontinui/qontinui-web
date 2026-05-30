"""Unit tests for `app.services.coord_operator_resolver`.

Covers the expand/contract resolution (sub primary, email fallback):

1. PRIMARY — Cognito sub match on ``coord.operators.sso_subject``
   (when ``user.cognito_sub`` is set).
2. FALLBACK — direct email match in ``coord.operators`` (when the user
   has no Cognito sub, or its sub doesn't match an operator row).
3. Bootstrap fallback by ``coord.tenants.slug = 'personal-jspinak'``.

All arms return a UUID; the all-miss path raises 403
``tenant_not_resolved``.
"""

from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest
from fastapi import HTTPException

from app.services.coord_operator_resolver import (
    PERSONAL_BOOTSTRAP_SLUG,
    resolve_tenant_for_user,
)


def _mock_user(
    email: str = "tenant.user@example.com",
    cognito_sub: str | None = None,
) -> MagicMock:
    user = MagicMock()
    user.id = uuid4()
    user.email = email
    # Default to None so the resolver's `if sub is not None` skips the
    # sub-primary query unless a test explicitly opts in (a bare MagicMock
    # attribute would be truthy and fire the sub branch unintentionally).
    user.cognito_sub = cognito_sub
    return user


class _StubResult:
    def __init__(self, row):
        self._row = row

    def first(self):
        return self._row


def _stub_db_results(*rows):
    """Build an AsyncSession whose ``execute`` returns ``rows`` in order.

    Each element is the value the corresponding ``.first()`` returns;
    pass ``None`` for "no row." The resolver issues its queries in a
    deterministic order (sub → email → bootstrap when a sub is present;
    email → bootstrap otherwise) so call-count is asserted implicitly.
    """
    db = MagicMock()
    db.execute = AsyncMock(side_effect=[_StubResult(r) for r in rows])
    return db


def _stub_db_session(*, op_row=None, tenant_row=None):
    """Email-fallback stub: email query then bootstrap query (no sub).

    Used by the no-cognito-sub tests where the resolver issues at most
    two queries.
    """
    return _stub_db_results(op_row, tenant_row)


@pytest.mark.asyncio
async def test_resolves_via_cognito_sub_match():
    """User with cognito_sub → primary sub query on sso_subject hits first."""
    user = _mock_user(email="josh@qontinui.io", cognito_sub="cognito-sub-123")
    tenant_id = uuid4()
    # First (and only) query is the sub-primary lookup.
    db = _stub_db_results((str(tenant_id),))

    out = await resolve_tenant_for_user(user, db)

    assert out == tenant_id
    # Only the sub query ran; email + bootstrap stay unfired.
    assert db.execute.await_count == 1
    # The sub query binds :sub (NOT :email).
    bound = db.execute.await_args_list[0].args[1]
    assert bound == {"sub": "cognito-sub-123"}


@pytest.mark.asyncio
async def test_sub_miss_falls_back_to_email_match():
    """cognito_sub present but no sso_subject row → email fallback hits."""
    user = _mock_user(email="josh@qontinui.io", cognito_sub="unbackfilled-sub")
    tenant_id = uuid4()
    # Query 1: sub lookup → miss. Query 2: email lookup → hit.
    db = _stub_db_results(None, (str(tenant_id),))

    out = await resolve_tenant_for_user(user, db)

    assert out == tenant_id
    assert db.execute.await_count == 2
    # Query 1 bound :sub, query 2 bound :email.
    assert db.execute.await_args_list[0].args[1] == {"sub": "unbackfilled-sub"}
    assert db.execute.await_args_list[1].args[1] == {"email": "josh@qontinui.io"}


@pytest.mark.asyncio
async def test_resolves_via_operator_email_match():
    """No cognito_sub → email fallback is the primary path; operator row hits."""
    user = _mock_user(email="josh@qontinui.io")
    tenant_id = uuid4()
    db = _stub_db_session(op_row=(str(tenant_id),))

    out = await resolve_tenant_for_user(user, db)

    assert out == tenant_id
    # No sub → sub query skipped; only the email query ran.
    assert db.execute.await_count == 1
    assert db.execute.await_args_list[0].args[1] == {"email": "josh@qontinui.io"}


@pytest.mark.asyncio
async def test_resolves_via_bootstrap_fallback():
    """No operator-row match → falls through to ``personal-jspinak`` tenant."""
    user = _mock_user(email="other.user@example.com")
    fallback_id = uuid4()
    db = _stub_db_session(op_row=None, tenant_row=(str(fallback_id),))

    out = await resolve_tenant_for_user(user, db)

    assert out == fallback_id
    # Both queries fired.
    assert db.execute.await_count == 2


@pytest.mark.asyncio
async def test_raises_403_when_both_paths_miss():
    """No operator + no bootstrap tenant → 403 ``tenant_not_resolved``."""
    user = _mock_user(email="ghost@example.com")
    db = _stub_db_session(op_row=None, tenant_row=None)

    with pytest.raises(HTTPException) as exc_info:
        await resolve_tenant_for_user(user, db)

    assert exc_info.value.status_code == 403
    assert exc_info.value.detail == "tenant_not_resolved"


@pytest.mark.asyncio
async def test_email_lowercased_for_match():
    """User email's case shouldn't matter — match runs LOWER() on both sides."""
    user = _mock_user(email="JOSH@QONTINUI.IO")
    tenant_id = uuid4()
    db = _stub_db_session(op_row=(str(tenant_id),))

    out = await resolve_tenant_for_user(user, db)

    assert out == tenant_id
    # The query bound `:email` should be the lowercased form.
    call = db.execute.await_args_list[0]
    bound_email = call.args[1]["email"]
    assert bound_email == "josh@qontinui.io"


def test_personal_bootstrap_slug_is_stable():
    """Lockstep with alembic ``coord_tenant_scope_columns._PERSONAL_SLUG``.

    The alembic migration's ``_PERSONAL_SLUG = "personal-jspinak"`` and
    this module's ``PERSONAL_BOOTSTRAP_SLUG`` must always match — the
    resolver's fallback query uses the latter to look up the row the
    former inserted.
    """
    assert PERSONAL_BOOTSTRAP_SLUG == "personal-jspinak"
