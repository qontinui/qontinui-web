"""Unit tests for the coord gate-action notification webhook (N2 + N3).

Covers:
  (a) endpoint rejects missing/wrong secret (401);
  (b) valid payload -> resolves + creates one notification per user;
  (c) dedup: a second identical webhook does not re-notify;
  (d) honesty: graph_available=false / coverage<1 produce the labelled message;
  (e) opt-out: a user whose prefs disable GATE_ACTION gets no notification;
  (f) tenant-fallback privacy: only admin/owner users notified.

No live Postgres or coord needed — the DB is a fake async session.
"""

from __future__ import annotations

import os
from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import UUID

import pytest

# Ensure env vars are set before the app is imported.
os.environ.setdefault("SECRET_KEY", "test-secret-key-for-testing-only-minimum-32-chars")
os.environ.setdefault("DATABASE_URL", "postgresql://u:p@localhost/test")
os.environ.setdefault("COORD_WEB_SERVICE_SECRET", "correct-secret")

# ============================================================
# Shared fixtures / helpers
# ============================================================

VALID_SECRET = "correct-secret"
WRONG_SECRET = "wrong-secret"

USER_A = UUID("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")
USER_B = UUID("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb")
FALLBACK_ADMIN = UUID("cccccccc-cccc-cccc-cccc-cccccccccccc")
FALLBACK_PLAIN = UUID("dddddddd-dddd-dddd-dddd-dddddddddddd")

_BASE_BODY: dict[str, Any] = {
    "repo": "owner/my-repo",
    "pr_number": 42,
    "block_reason_code": "blast_radius",
    "head_sha": "deadbeef1234",
    "evidence": None,
    "coverage": None,
    "graph_available": True,
    "responsible_context": {
        "tenant_id": None,
        "github_author_id": 98765,
        "agent_id": None,
        "device_owner_user_id": None,
        "tenant_fallback_user_ids": [],
    },
}


def _body(**overrides: Any) -> dict[str, Any]:
    """Return a copy of the base body with top-level overrides applied."""
    import copy

    b = copy.deepcopy(_BASE_BODY)
    b.update(overrides)
    return b


def _body_rc(**rc_overrides: Any) -> dict[str, Any]:
    """Return a copy of the base body with responsible_context overrides."""
    import copy

    b = copy.deepcopy(_BASE_BODY)
    b["responsible_context"].update(rc_overrides)
    return b


# ============================================================
# (a) Auth — missing / wrong secret => 401
# ============================================================


def test_missing_secret_returns_401(monkeypatch: pytest.MonkeyPatch) -> None:
    """No X-Coord-Service-Secret header (None) -> 401, even when configured."""
    from fastapi import HTTPException

    from app.api.v1.endpoints.internal import _require_coord_secret
    from app.core.config import settings

    # Configure a secret explicitly — the settings singleton may have been
    # built (with the default empty value) before this module set the env
    # var, so we never rely on import ordering for the secret's value.
    monkeypatch.setattr(settings, "COORD_WEB_SERVICE_SECRET", VALID_SECRET)

    with pytest.raises(HTTPException) as exc_info:
        _require_coord_secret(x_coord_service_secret=None)
    assert exc_info.value.status_code == 401


def test_wrong_secret_returns_401(monkeypatch: pytest.MonkeyPatch) -> None:
    """A wrong value against a CONFIGURED secret -> 401."""
    from fastapi import HTTPException

    from app.api.v1.endpoints.internal import _require_coord_secret
    from app.core.config import settings

    monkeypatch.setattr(settings, "COORD_WEB_SERVICE_SECRET", VALID_SECRET)

    with pytest.raises(HTTPException) as exc_info:
        _require_coord_secret(x_coord_service_secret=WRONG_SECRET)
    assert exc_info.value.status_code == 401


def test_correct_secret_does_not_raise(monkeypatch: pytest.MonkeyPatch) -> None:
    """The correct secret passes without raising.

    Monkeypatches the settings singleton directly: relying on the module-top
    ``os.environ.setdefault`` is order-fragile — when another test module has
    already imported ``settings``, the env var is read too late and the
    secret is cached empty (CI collection order surfaced this; the local
    order happened to import this module first)."""
    from app.api.v1.endpoints.internal import _require_coord_secret
    from app.core.config import settings

    monkeypatch.setattr(settings, "COORD_WEB_SERVICE_SECRET", VALID_SECRET)

    # Should not raise.
    result = _require_coord_secret(x_coord_service_secret=VALID_SECRET)
    assert result is None


def test_empty_secret_config_rejects_all(monkeypatch: pytest.MonkeyPatch) -> None:
    """When COORD_WEB_SERVICE_SECRET is empty the feature is OFF: always 401."""
    from app.core.config import settings

    monkeypatch.setattr(settings, "COORD_WEB_SERVICE_SECRET", "")

    # Import the dependency directly and verify it raises.
    from fastapi import HTTPException

    from app.api.v1.endpoints.internal import _require_coord_secret

    with pytest.raises(HTTPException) as exc_info:
        _require_coord_secret(x_coord_service_secret="anything")
    assert exc_info.value.status_code == 401


# ============================================================
# (b) Valid payload -> resolves + creates one notification per resolved user
# ============================================================


@pytest.mark.asyncio
async def test_valid_payload_notifies_resolved_user() -> None:
    """Valid webhook with a resolved github-author notifies that user (count=1)."""
    from app.api.v1.endpoints.internal import (
        CoordNotificationRequest,
        receive_coord_notification,
    )

    body = CoordNotificationRequest(**_body())

    responsible_user = SimpleNamespace(user_id=USER_A, source="github-author")
    mock_db = AsyncMock()

    # Dedup check: no existing notification found.
    mock_scan = MagicMock()
    mock_scan.scalars.return_value.all.return_value = []
    mock_db.execute = AsyncMock(return_value=mock_scan)

    mock_notification = MagicMock()

    with (
        patch(
            "app.api.v1.endpoints.internal.identity_resolver.coord_context_from_responsible_context"
        ) as mock_ctx,
        patch(
            "app.api.v1.endpoints.internal.identity_resolver.resolve_responsible_users_from_context",
            new_callable=AsyncMock,
            return_value=[responsible_user],
        ),
        patch(
            "app.api.v1.endpoints.internal._user_ids_admin_or_owner",
            new_callable=AsyncMock,
            return_value=set(),  # no fallback users, so this doesn't matter
        ),
        patch(
            "app.api.v1.endpoints.internal.notification_service.create_notification",
            new_callable=AsyncMock,
            return_value=mock_notification,
        ) as mock_create,
    ):
        mock_ctx.return_value = MagicMock()
        response = await receive_coord_notification(body=body, db=mock_db)

    assert response.notified_user_count == 1
    mock_create.assert_awaited_once()
    call_kwargs = mock_create.call_args.kwargs
    assert call_kwargs["notification_type"].value == "gate_action"
    assert call_kwargs["resource_type"] == "pull_request"
    assert call_kwargs["resource_id"] == "owner/my-repo#42"
    assert call_kwargs["send_email"] is True


@pytest.mark.asyncio
async def test_404_from_resolver_returns_zero() -> None:
    """When the resolver raises 404 (no responsible user), return count=0 not 500."""
    from fastapi import HTTPException

    from app.api.v1.endpoints.internal import (
        CoordNotificationRequest,
        receive_coord_notification,
    )

    body = CoordNotificationRequest(**_body())
    mock_db = AsyncMock()

    with (
        patch(
            "app.api.v1.endpoints.internal.identity_resolver.coord_context_from_responsible_context"
        ),
        patch(
            "app.api.v1.endpoints.internal.identity_resolver.resolve_responsible_users_from_context",
            new_callable=AsyncMock,
            side_effect=HTTPException(status_code=404, detail="no user"),
        ),
    ):
        response = await receive_coord_notification(body=body, db=mock_db)

    assert response.notified_user_count == 0


# ============================================================
# (c) Dedup: second identical webhook does not re-notify
# ============================================================


@pytest.mark.asyncio
async def test_dedup_skips_already_notified_user() -> None:
    """If a matching GATE_ACTION notification already exists, skip the user."""
    from app.api.v1.endpoints.internal import (
        _already_notified,
    )
    from app.models.notification import NotificationType

    repo = "owner/my-repo"
    pr_number = 42
    head_sha = "deadbeef1234"
    block_reason_code = "blast_radius"

    # Build a fake existing notification with matching metadata.
    existing = MagicMock()
    existing.notification_metadata = {
        "repo": repo,
        "pr_number": pr_number,
        "head_sha": head_sha,
        "block_reason_code": block_reason_code,
    }
    existing.type = NotificationType.GATE_ACTION

    mock_scan = MagicMock()
    mock_scan.scalars.return_value.all.return_value = [existing]
    mock_db = AsyncMock()
    mock_db.execute = AsyncMock(return_value=mock_scan)

    result = await _already_notified(
        mock_db,
        user_id=USER_A,
        repo=repo,
        pr_number=pr_number,
        head_sha=head_sha,
        block_reason_code=block_reason_code,
    )
    assert result is True


@pytest.mark.asyncio
async def test_dedup_allows_different_sha() -> None:
    """A different head_sha is NOT a duplicate."""
    from app.api.v1.endpoints.internal import _already_notified

    existing = MagicMock()
    existing.notification_metadata = {
        "repo": "owner/my-repo",
        "pr_number": 42,
        "head_sha": "DIFFERENT_SHA",
        "block_reason_code": "blast_radius",
    }

    mock_scan = MagicMock()
    mock_scan.scalars.return_value.all.return_value = [existing]
    mock_db = AsyncMock()
    mock_db.execute = AsyncMock(return_value=mock_scan)

    result = await _already_notified(
        mock_db,
        user_id=USER_A,
        repo="owner/my-repo",
        pr_number=42,
        head_sha="deadbeef1234",
        block_reason_code="blast_radius",
    )
    assert result is False


@pytest.mark.asyncio
async def test_full_flow_dedup_skips_on_second_call() -> None:
    """End-to-end: second delivery of same webhook => count=0 (all deduped)."""
    from app.api.v1.endpoints.internal import (
        CoordNotificationRequest,
        receive_coord_notification,
    )
    from app.models.notification import NotificationType

    body = CoordNotificationRequest(**_body())
    responsible_user = SimpleNamespace(user_id=USER_A, source="github-author")

    # Build a fake existing notification matching the body's dedup key.
    existing = MagicMock()
    existing.notification_metadata = {
        "repo": "owner/my-repo",
        "pr_number": 42,
        "head_sha": "deadbeef1234",
        "block_reason_code": "blast_radius",
    }
    existing.type = NotificationType.GATE_ACTION

    mock_scan = MagicMock()
    mock_scan.scalars.return_value.all.return_value = [existing]
    mock_db = AsyncMock()
    mock_db.execute = AsyncMock(return_value=mock_scan)

    with (
        patch(
            "app.api.v1.endpoints.internal.identity_resolver.coord_context_from_responsible_context"
        ),
        patch(
            "app.api.v1.endpoints.internal.identity_resolver.resolve_responsible_users_from_context",
            new_callable=AsyncMock,
            return_value=[responsible_user],
        ),
        patch(
            "app.api.v1.endpoints.internal._user_ids_admin_or_owner",
            new_callable=AsyncMock,
            return_value=set(),
        ),
        patch(
            "app.api.v1.endpoints.internal.notification_service.create_notification",
            new_callable=AsyncMock,
        ) as mock_create,
    ):
        response = await receive_coord_notification(body=body, db=mock_db)

    assert response.notified_user_count == 0
    mock_create.assert_not_awaited()


# ============================================================
# (d) Honesty labels in the builder
# ============================================================


def test_builder_no_graph_includes_non_authoritative_label() -> None:
    """graph_available=False -> message includes 'non-authoritative'."""
    from app.services.notifications.builders import build_gate_action_notification

    result = build_gate_action_notification(
        repo="owner/repo",
        pr_number=1,
        block_reason_code="blast_radius",
        head_sha="abc",
        coverage=None,
        graph_available=False,
    )
    assert "non-authoritative" in result.message
    assert result.metadata["graph_available"] is False


def test_builder_partial_coverage_includes_percentage_label() -> None:
    """coverage < 1.0 -> message includes 'partial coverage (NN%)'."""
    from app.services.notifications.builders import build_gate_action_notification

    result = build_gate_action_notification(
        repo="owner/repo",
        pr_number=1,
        block_reason_code="blast_radius",
        head_sha="abc",
        coverage=0.72,
        graph_available=True,
    )
    assert "partial coverage (72%)" in result.message
    assert result.metadata["coverage"] == 0.72


def test_builder_full_coverage_no_partial_label() -> None:
    """coverage == 1.0 -> no partial-coverage caveat in message."""
    from app.services.notifications.builders import build_gate_action_notification

    result = build_gate_action_notification(
        repo="owner/repo",
        pr_number=1,
        block_reason_code="blast_radius",
        head_sha="abc",
        coverage=1.0,
        graph_available=True,
    )
    assert "partial" not in result.message


def test_builder_both_caveats_present() -> None:
    """graph_available=False + coverage<1 -> both caveats in message."""
    from app.services.notifications.builders import build_gate_action_notification

    result = build_gate_action_notification(
        repo="owner/repo",
        pr_number=99,
        block_reason_code="coverage_drop",
        head_sha="xyz",
        coverage=0.5,
        graph_available=False,
    )
    assert "non-authoritative" in result.message
    assert "partial coverage (50%)" in result.message


def test_builder_title_contains_repo_pr_and_reason() -> None:
    """Title names the PR and the gate reason."""
    from app.services.notifications.builders import build_gate_action_notification

    result = build_gate_action_notification(
        repo="owner/repo",
        pr_number=55,
        block_reason_code="blast_radius",
        head_sha="sha",
        coverage=None,
        graph_available=True,
    )
    assert "owner/repo#55" in result.title
    assert (
        "blast radius" in result.title.lower()
        or "large blast radius" in result.title.lower()
    )


def test_builder_metadata_has_dedup_keys_and_deeplinks() -> None:
    """Metadata must contain dedup keys and deep-link URLs."""
    from app.services.notifications.builders import build_gate_action_notification

    result = build_gate_action_notification(
        repo="owner/repo",
        pr_number=7,
        block_reason_code="blast_radius",
        head_sha="sha7",
        coverage=0.8,
        graph_available=True,
    )
    meta = result.metadata
    assert meta["repo"] == "owner/repo"
    assert meta["pr_number"] == 7
    assert meta["head_sha"] == "sha7"
    assert meta["block_reason_code"] == "blast_radius"
    assert "https://github.com/owner/repo/pull/7" in meta["pr_url"]
    assert meta["operations_panel"] == "/operations"


# ============================================================
# (e) Opt-out: create_notification returns None -> not counted
# ============================================================


@pytest.mark.asyncio
async def test_opted_out_user_not_counted() -> None:
    """When create_notification returns None (user opted out), count stays 0."""
    from app.api.v1.endpoints.internal import (
        CoordNotificationRequest,
        receive_coord_notification,
    )

    body = CoordNotificationRequest(**_body())
    responsible_user = SimpleNamespace(user_id=USER_A, source="github-author")

    mock_scan = MagicMock()
    mock_scan.scalars.return_value.all.return_value = []
    mock_db = AsyncMock()
    mock_db.execute = AsyncMock(return_value=mock_scan)

    with (
        patch(
            "app.api.v1.endpoints.internal.identity_resolver.coord_context_from_responsible_context"
        ),
        patch(
            "app.api.v1.endpoints.internal.identity_resolver.resolve_responsible_users_from_context",
            new_callable=AsyncMock,
            return_value=[responsible_user],
        ),
        patch(
            "app.api.v1.endpoints.internal._user_ids_admin_or_owner",
            new_callable=AsyncMock,
            return_value=set(),
        ),
        patch(
            "app.api.v1.endpoints.internal.notification_service.create_notification",
            new_callable=AsyncMock,
            return_value=None,  # prefs gate says no
        ),
    ):
        response = await receive_coord_notification(body=body, db=mock_db)

    assert response.notified_user_count == 0


# ============================================================
# (f) Tenant-fallback privacy: only admin/owner users notified
# ============================================================


@pytest.mark.asyncio
async def test_tenant_fallback_notifies_admin_not_plain_member() -> None:
    """Tenant-fallback source: admin is notified, plain member is filtered out."""
    from app.api.v1.endpoints.internal import (
        CoordNotificationRequest,
        receive_coord_notification,
    )

    # Resolve two fallback users: one admin, one plain member.
    fallback_admin_user = SimpleNamespace(
        user_id=FALLBACK_ADMIN, source="tenant-fallback"
    )
    fallback_plain_user = SimpleNamespace(
        user_id=FALLBACK_PLAIN, source="tenant-fallback"
    )

    body = CoordNotificationRequest(
        **_body_rc(
            github_author_id=None,
            tenant_fallback_user_ids=[str(FALLBACK_ADMIN), str(FALLBACK_PLAIN)],
        )
    )

    mock_scan = MagicMock()
    mock_scan.scalars.return_value.all.return_value = []
    mock_db = AsyncMock()
    mock_db.execute = AsyncMock(return_value=mock_scan)

    mock_notification = MagicMock()

    with (
        patch(
            "app.api.v1.endpoints.internal.identity_resolver.coord_context_from_responsible_context"
        ),
        patch(
            "app.api.v1.endpoints.internal.identity_resolver.resolve_responsible_users_from_context",
            new_callable=AsyncMock,
            return_value=[fallback_admin_user, fallback_plain_user],
        ),
        # _user_ids_admin_or_owner returns only the admin.
        patch(
            "app.api.v1.endpoints.internal._user_ids_admin_or_owner",
            new_callable=AsyncMock,
            return_value={FALLBACK_ADMIN},
        ),
        patch(
            "app.api.v1.endpoints.internal.notification_service.create_notification",
            new_callable=AsyncMock,
            return_value=mock_notification,
        ) as mock_create,
    ):
        response = await receive_coord_notification(body=body, db=mock_db)

    # Only the admin was notified.
    assert response.notified_user_count == 1
    called_user_ids = [call.kwargs["user_id"] for call in mock_create.call_args_list]
    assert FALLBACK_ADMIN in called_user_ids
    assert FALLBACK_PLAIN not in called_user_ids


@pytest.mark.asyncio
async def test_github_author_not_filtered_by_admin_check() -> None:
    """github-author and device-owner sources are NEVER filtered by admin check."""
    from app.api.v1.endpoints.internal import (
        CoordNotificationRequest,
        receive_coord_notification,
    )

    author_user = SimpleNamespace(user_id=USER_A, source="github-author")
    body = CoordNotificationRequest(**_body())

    mock_scan = MagicMock()
    mock_scan.scalars.return_value.all.return_value = []
    mock_db = AsyncMock()
    mock_db.execute = AsyncMock(return_value=mock_scan)

    with (
        patch(
            "app.api.v1.endpoints.internal.identity_resolver.coord_context_from_responsible_context"
        ),
        patch(
            "app.api.v1.endpoints.internal.identity_resolver.resolve_responsible_users_from_context",
            new_callable=AsyncMock,
            return_value=[author_user],
        ),
        patch(
            # Admin filter returns empty set — but github-author passes through anyway.
            "app.api.v1.endpoints.internal._user_ids_admin_or_owner",
            new_callable=AsyncMock,
            return_value=set(),
        ),
        patch(
            "app.api.v1.endpoints.internal.notification_service.create_notification",
            new_callable=AsyncMock,
            return_value=MagicMock(),
        ) as mock_create,
    ):
        response = await receive_coord_notification(body=body, db=mock_db)

    assert response.notified_user_count == 1
    assert mock_create.call_args.kwargs["user_id"] == USER_A


# ============================================================
# (g) GATE_ACTION preferences — default ON and per-column opt-out
# ============================================================


def test_gate_action_prefs_default_on_email_and_in_app() -> None:
    """A fresh NotificationPreferences (no explicit columns) sends GATE_ACTION by default."""
    from app.models.notification import NotificationPreferences, NotificationType

    prefs = NotificationPreferences(user_id=USER_A)
    assert prefs.should_send_in_app(NotificationType.GATE_ACTION) is True
    assert prefs.should_send_email(NotificationType.GATE_ACTION) is True


def test_gate_action_in_app_opt_out_suppresses_in_app() -> None:
    """in_app_gate_action=False -> should_send_in_app(GATE_ACTION) is False."""
    from app.models.notification import NotificationPreferences, NotificationType

    prefs = NotificationPreferences(user_id=USER_A, in_app_gate_action=False)
    assert prefs.should_send_in_app(NotificationType.GATE_ACTION) is False
    # Email should remain unaffected (still on by default).
    assert prefs.should_send_email(NotificationType.GATE_ACTION) is True


def test_gate_action_email_opt_out_suppresses_email() -> None:
    """email_gate_action=False -> should_send_email(GATE_ACTION) is False."""
    from app.models.notification import NotificationPreferences, NotificationType

    prefs = NotificationPreferences(user_id=USER_A, email_gate_action=False)
    assert prefs.should_send_email(NotificationType.GATE_ACTION) is False
    # In-app should remain unaffected (still on by default).
    assert prefs.should_send_in_app(NotificationType.GATE_ACTION) is True


def test_gate_action_both_opt_out_suppresses_both() -> None:
    """Setting both columns False -> both delivery channels suppressed."""
    from app.models.notification import NotificationPreferences, NotificationType

    prefs = NotificationPreferences(
        user_id=USER_A, in_app_gate_action=False, email_gate_action=False
    )
    assert prefs.should_send_in_app(NotificationType.GATE_ACTION) is False
    assert prefs.should_send_email(NotificationType.GATE_ACTION) is False


def test_gate_action_explicit_true_sends() -> None:
    """Explicitly setting both True (re-opt-in) -> both channels send."""
    from app.models.notification import NotificationPreferences, NotificationType

    prefs = NotificationPreferences(
        user_id=USER_A, in_app_gate_action=True, email_gate_action=True
    )
    assert prefs.should_send_in_app(NotificationType.GATE_ACTION) is True
    assert prefs.should_send_email(NotificationType.GATE_ACTION) is True


def test_gate_action_opt_out_does_not_affect_other_types() -> None:
    """Opting out of GATE_ACTION does not affect other notification types.

    Note: legacy Column-based fields (email_mentions etc.) return None for
    in-memory instances (server_default only fires on DB INSERT). This test
    therefore uses explicit True values for the unrelated columns, asserting
    only that gate-action opt-out does not corrupt them.
    """
    from app.models.notification import NotificationPreferences, NotificationType

    # Explicitly set all fields to isolate the gate_action opt-out columns.
    prefs = NotificationPreferences(
        user_id=USER_A,
        in_app_gate_action=False,
        email_gate_action=False,
        in_app_mentions=True,
        email_mentions=True,
        in_app_comments=True,
        email_comments=True,
    )
    # GATE_ACTION opted out.
    assert prefs.should_send_in_app(NotificationType.GATE_ACTION) is False
    assert prefs.should_send_email(NotificationType.GATE_ACTION) is False
    # Other types are unaffected — their columns remain True.
    assert prefs.should_send_in_app(NotificationType.MENTION) is True
    assert prefs.should_send_email(NotificationType.MENTION) is True
    assert prefs.should_send_in_app(NotificationType.COMMENT) is True


def test_gate_action_prefs_schema_round_trips_opt_out() -> None:
    """NotificationPreferencesUpdate accepts and exposes gate_action fields."""
    from app.schemas.notification import (
        NotificationPreferencesUpdate,
    )

    # Partial update: only opt out of gate_action email.
    update = NotificationPreferencesUpdate(email_gate_action=False)
    dumped = update.model_dump(exclude_none=True)
    assert dumped == {"email_gate_action": False}

    # Partial update: opt out of gate_action in-app only.
    update2 = NotificationPreferencesUpdate(in_app_gate_action=False)
    dumped2 = update2.model_dump(exclude_none=True)
    assert dumped2 == {"in_app_gate_action": False}

    # Full opt-out: both channels.
    update3 = NotificationPreferencesUpdate(
        in_app_gate_action=False, email_gate_action=False
    )
    dumped3 = update3.model_dump(exclude_none=True)
    assert "in_app_gate_action" in dumped3
    assert "email_gate_action" in dumped3
    assert dumped3["in_app_gate_action"] is False
    assert dumped3["email_gate_action"] is False


def test_gate_action_prefs_response_schema_includes_gate_action_fields() -> None:
    """NotificationPreferencesResponse includes in_app_gate_action + email_gate_action."""
    from datetime import UTC, datetime
    from uuid import uuid4

    from app.schemas.notification import NotificationPreferencesResponse

    # Simulate a full ORM object response with gate_action fields.

    now = datetime.now(UTC)
    uid = uuid4()
    resp = NotificationPreferencesResponse(
        id=uid,
        user_id=USER_A,
        created_at=now.isoformat(),
        updated_at=now.isoformat(),
        email_mentions=True,
        email_comments=True,
        email_shares=True,
        email_replies=True,
        email_team_invites=True,
        email_gate_action=False,  # opted out
        in_app_mentions=True,
        in_app_comments=True,
        in_app_shares=True,
        in_app_replies=True,
        in_app_team_invites=True,
        in_app_project_updates=True,
        in_app_gate_action=False,  # opted out
    )
    assert resp.email_gate_action is False
    assert resp.in_app_gate_action is False
    assert resp.email_mentions is True  # unrelated field unaffected


# ============================================================
# (h) coord_context_from_responsible_context — int github_author_id coercion
# ============================================================


def test_coord_context_coerces_int_github_author_id() -> None:
    """coord_context_from_responsible_context converts int github_author_id to str."""
    from app.services.identity_resolver import coord_context_from_responsible_context

    ctx = coord_context_from_responsible_context(
        github_author_id=98765,
        tenant_id=None,
        device_owner_user_id=None,
        tenant_fallback_user_ids=[],
    )
    assert ctx.github_author_id == "98765"


def test_coord_context_handles_none_github_author_id() -> None:
    """None github_author_id stays None (not coerced to 'None' string)."""
    from app.services.identity_resolver import coord_context_from_responsible_context

    ctx = coord_context_from_responsible_context(
        github_author_id=None,
        tenant_id=None,
        device_owner_user_id=None,
        tenant_fallback_user_ids=[],
    )
    assert ctx.github_author_id is None


def test_coord_context_bad_uuid_dropped_from_fallback() -> None:
    """Malformed UUIDs in tenant_fallback_user_ids are silently dropped."""
    from app.services.identity_resolver import coord_context_from_responsible_context

    ctx = coord_context_from_responsible_context(
        github_author_id=None,
        tenant_id=None,
        device_owner_user_id=None,
        tenant_fallback_user_ids=["not-a-uuid", str(USER_A)],
    )
    assert len(ctx.tenant_fallback_user_ids) == 1
    assert ctx.tenant_fallback_user_ids[0] == USER_A


# ============================================================
# (i) Contract boundary: coord emits `evidence` as a LIST of
#     removed-export records for blast-radius blocks. The request
#     model MUST accept it (a `dict | None` typing 422-rejected it,
#     silently dropping the most important escalations). Regression.
# ============================================================


def test_request_accepts_list_evidence_from_coord() -> None:
    """coord's array-shaped evidence validates and round-trips opaquely."""
    from app.api.v1.endpoints.internal import CoordNotificationRequest

    coord_evidence = [
        {
            "name": "do_thing",
            "file": "src/lib.rs",
            "referenced_by": [{"file": "src/other.rs", "line": 12}],
        }
    ]
    req = CoordNotificationRequest(**_body(evidence=coord_evidence))
    assert req.evidence == coord_evidence


def test_request_accepts_dict_and_null_evidence() -> None:
    """Both a dict evidence and null still validate (back-compat with the
    documented opaque contract)."""
    from app.api.v1.endpoints.internal import CoordNotificationRequest

    assert CoordNotificationRequest(**_body(evidence={"k": "v"})).evidence == {"k": "v"}
    assert CoordNotificationRequest(**_body(evidence=None)).evidence is None


def test_builder_passes_list_evidence_through_to_metadata() -> None:
    """A list evidence is stored opaquely in metadata (no .get() assumed)."""
    from app.services.notifications.builders import build_gate_action_notification

    ev = [{"name": "x", "file": "a.rs", "referenced_by": []}]
    result = build_gate_action_notification(
        repo="o/r",
        pr_number=1,
        block_reason_code="blast_radius",
        head_sha="s",
        coverage=None,
        graph_available=True,
        evidence=ev,
    )
    assert result.metadata["evidence"] == ev
