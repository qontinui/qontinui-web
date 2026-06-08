"""add github_user_id + github_login to auth.users

Identity-contract I1. Denormalize a durable GitHub identity onto
``auth.users`` so a PR's GitHub author (numeric id) can resolve to a
qontinui user with a single indexed lookup, instead of a slow Cognito
``ListUsers``-by-attribute scan per PR.

Two columns (mirroring ``app/models/user.py``)::

    github_user_id: Mapped[str | None] = mapped_column(
        String, index=True, nullable=True
    )
    github_login: Mapped[str | None] = mapped_column(String, nullable=True)

* ``github_user_id`` — the canonical, **stable** key: GitHub's numeric
  user id (the GitHub OIDC ``sub``), surfaced as a string. Indexed,
  nullable, NOT column-unique. Nullable because only users who opt into
  linking GitHub carry it; non-unique because the column-level uniqueness
  guarantee buys nothing the link flow doesn't already enforce (a GitHub
  identity links to exactly one canonical Cognito account via
  ``AdminLinkProviderForUser``) and a partial-unique would complicate the
  best-effort backfill. The resolver keys on the id, never the login.
* ``github_login`` — a mutable display alias (GitHub logins can be renamed
  / transferred), populated best-effort. Never a join key.

Backfill (data step)
====================
For users who already have a linked GitHub federated identity, populate
``github_user_id`` from Cognito using the SAME admin path the link flow
reads (``cognito_admin.list_user_identities`` keyed by the existing
``cognito_sub`` -> pool Username). The current user set is small, so an
inline data step is fine.

The backfill is **best-effort and fail-open**: if Cognito is unreachable
or unconfigured (e.g. a CI ``alembic upgrade`` against an ephemeral
Postgres with no AWS creds), it logs and continues — the schema change
must never be blocked on AWS. New links populate the columns at link
time regardless (see ``identities.py::link_identity``); the backfill only
covers pre-existing links.

Revision ID: github_id_01_add_github_identity
Revises: lineage_recorded_at_idx_01
Create Date: 2026-06-07
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "github_id_01_add_github_identity"
down_revision: str | Sequence[str] | None = "layering_gate_cols_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# The GitHub federated provider name as it appears in Cognito's
# ``identities`` claim / attribute. Matches the link-hook guard in
# ``identities.py``.
_GITHUB_PROVIDER = "GitHub"


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("github_user_id", sa.String(), nullable=True),
        schema="auth",
    )
    op.add_column(
        "users",
        sa.Column("github_login", sa.String(), nullable=True),
        schema="auth",
    )
    op.create_index(
        "ix_auth_users_github_user_id",
        "users",
        ["github_user_id"],
        unique=False,
        schema="auth",
    )
    _backfill_github_ids()


def downgrade() -> None:
    op.drop_index(
        "ix_auth_users_github_user_id",
        table_name="users",
        schema="auth",
    )
    op.drop_column("users", "github_login", schema="auth")
    op.drop_column("users", "github_user_id", schema="auth")


def _backfill_github_ids() -> None:
    """Populate ``github_user_id`` for pre-existing linked GitHub users.

    Best-effort + fail-open: any failure (Cognito unconfigured / unreachable,
    import-time error) is swallowed so the schema migration always completes.
    Idempotent: only updates rows whose ``github_user_id`` is still NULL.
    """
    import structlog

    logger = structlog.get_logger(__name__)

    try:
        from app.services import cognito_admin
    except Exception as exc:  # pragma: no cover - import guard
        logger.warning("github_backfill_skipped_import", error=str(exc))
        return

    bind = op.get_bind()
    rows = bind.execute(
        sa.text(
            "SELECT id, cognito_sub FROM auth.users "
            "WHERE cognito_sub IS NOT NULL AND github_user_id IS NULL"
        )
    ).fetchall()
    if not rows:
        return

    updated = 0
    for user_id, cognito_sub in rows:
        try:
            username = cognito_admin.resolve_username_for_sub(cognito_sub)
            if not username:
                continue
            identities = cognito_admin.list_user_identities(username)
        except Exception as exc:  # pragma: no cover - AWS / network failure
            # Fail-open per row: one bad lookup (or no AWS at all) must not
            # abort the whole migration.
            logger.warning(
                "github_backfill_lookup_failed",
                user_id=str(user_id),
                error=str(exc),
            )
            continue

        github_id = next(
            (
                i.get("user_id")
                for i in identities
                if isinstance(i, dict)
                and (i.get("provider") or "").lower() == _GITHUB_PROVIDER.lower()
                and i.get("user_id")
            ),
            None,
        )
        if not github_id:
            continue
        bind.execute(
            sa.text(
                "UPDATE auth.users SET github_user_id = :gid "
                "WHERE id = :uid AND github_user_id IS NULL"
            ),
            {"gid": str(github_id), "uid": str(user_id)},
        )
        updated += 1

    logger.info("github_backfill_done", updated=updated, candidates=len(rows))
