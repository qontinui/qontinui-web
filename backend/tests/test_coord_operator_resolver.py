"""Unit tests for `app.services.coord_operator_resolver`.

Covers the two-step resolution:

1. Direct email match in ``coord.operators``.
2. Bootstrap fallback by ``coord.tenants.slug = 'personal-jspinak'``.

Both arms return a UUID; both-miss path raises 403 ``tenant_not_resolved``.
"""

from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest
from fastapi import HTTPException

from app.services.coord_operator_resolver import (
    PERSONAL_BOOTSTRAP_SLUG,
    resolve_tenant_for_user,
)


def _mock_user(email: str = "tenant.user@example.com") -> MagicMock:
    user = MagicMock()
    user.id = uuid4()
    user.email = email
    return user


class _StubResult:
    def __init__(self, row):
        self._row = row

    def first(self):
        return self._row


def _stub_db_session(*, op_row=None, tenant_row=None):
    """Build an AsyncSession.execute stub that returns op_row then tenant_row.

    The resolver issues at most two queries; this stub satisfies them in
    order so the call-count assertion is implicit (no Mock framework
    surprise when the second query goes missing).
    """
    db = MagicMock()
    db.execute = AsyncMock(
        side_effect=[
            _StubResult(op_row),
            _StubResult(tenant_row),
        ]
    )
    return db


@pytest.mark.asyncio
async def test_resolves_via_operator_email_match():
    """Operator row with matching email → returns its tenant_id."""
    user = _mock_user(email="josh@qontinui.io")
    tenant_id = uuid4()
    db = _stub_db_session(op_row=(str(tenant_id),))

    out = await resolve_tenant_for_user(user, db)

    assert out == tenant_id
    # Only the email query ran; bootstrap query stays unfired.
    assert db.execute.await_count == 1


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
