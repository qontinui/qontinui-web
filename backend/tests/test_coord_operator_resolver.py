"""Unit tests for `app.services.coord_operator_resolver`.

Covers the re-keyed resolution (posture C — key on the Cognito identity):

1. Sub-preferred operator match in ``coord.operators``
   (``sso_subject = :cognito_sub``), with ``LOWER(email) = :email`` as a
   transitional fallback when ``cognito_sub`` is NULL or the sub misses.
2. Bootstrap fallback by ``coord.tenants.slug = 'personal-jspinak'``.

The sub + email predicates are evaluated in ONE SQL query (sub-preferred
ORDER BY), so the operator match is a single ``db.execute`` round-trip.
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
    def __init__(self, row):
        self._row = row

    def first(self):
        return self._row


def _stub_db_session(*, op_row=None, tenant_row=None):
    """Build an AsyncSession.execute stub that returns op_row then tenant_row.

    The resolver issues at most two queries (the combined sub/email
    operator match, then the bootstrap-slug lookup); this stub satisfies
    them in order.
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
async def test_resolves_via_operator_sub_match():
    """Operator row matched by Cognito sub → returns its tenant_id.

    The sub + email predicates run in ONE query, so the operator match is
    a single round-trip and the bootstrap query stays unfired.
    """
    user = _mock_user(email="josh@qontinui.io", cognito_sub="cognito-sub-123")
    tenant_id = uuid4()
    db = _stub_db_session(op_row=(str(tenant_id),))

    out = await resolve_tenant_for_user(user, db)

    assert out == tenant_id
    assert db.execute.await_count == 1
    # Both identity params are bound; sub is preferred in the predicate.
    bound = db.execute.await_args_list[0].args[1]
    assert bound["cognito_sub"] == "cognito-sub-123"
    assert bound["email"] == "josh@qontinui.io"


@pytest.mark.asyncio
async def test_resolves_via_email_fallback_when_sub_null():
    """cognito_sub is NULL → operator still resolves via the email arm.

    No 403 regression for an un-backfilled user. The combined query still
    fires once; cognito_sub is bound as None so the sub predicate is
    unsatisfiable and only the email arm contributes.
    """
    user = _mock_user(email="legacy@qontinui.io", cognito_sub=None)
    tenant_id = uuid4()
    db = _stub_db_session(op_row=(str(tenant_id),))

    out = await resolve_tenant_for_user(user, db)

    assert out == tenant_id
    assert db.execute.await_count == 1
    bound = db.execute.await_args_list[0].args[1]
    assert bound["cognito_sub"] is None
    assert bound["email"] == "legacy@qontinui.io"


@pytest.mark.asyncio
async def test_resolves_via_bootstrap_fallback():
    """No operator-row match → falls through to ``personal-jspinak`` tenant."""
    user = _mock_user(email="other.user@example.com", cognito_sub="sub-x")
    fallback_id = uuid4()
    db = _stub_db_session(op_row=None, tenant_row=(str(fallback_id),))

    out = await resolve_tenant_for_user(user, db)

    assert out == fallback_id
    # Both queries fired (operator miss → bootstrap).
    assert db.execute.await_count == 2


@pytest.mark.asyncio
async def test_raises_403_when_both_paths_miss():
    """No operator + no bootstrap tenant → 403 ``tenant_not_resolved``."""
    user = _mock_user(email="ghost@example.com", cognito_sub=None)
    db = _stub_db_session(op_row=None, tenant_row=None)

    with pytest.raises(HTTPException) as exc_info:
        await resolve_tenant_for_user(user, db)

    assert exc_info.value.status_code == 403
    assert exc_info.value.detail == "tenant_not_resolved"


@pytest.mark.asyncio
async def test_email_lowercased_for_fallback_match():
    """User email's case shouldn't matter — match runs LOWER() on both sides."""
    user = _mock_user(email="JOSH@QONTINUI.IO", cognito_sub=None)
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
