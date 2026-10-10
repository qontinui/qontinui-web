"""coord.ci_repo_read_token_requests — the OIDC broker's jti ledger and audit

Revision ID: ci_read_token_01
Revises: plan_library_10_keyset_walk_indexes
Create Date: 2026-10-10

Phase 4 of plan ``2026-10-10-repo-onboarding-is-agent-actionable-end-to-end``.

Coord gains ``POST /coord/ci/repo-read-token``: a CI job presents its GitHub
Actions OIDC token, and when the target repo's default-branch
``.qontinui/ci.toml`` grants the job's repo under ``[[ci_readers]]``, coord mints
a read-only installation token on exactly that target repo. This table is the
broker's one durable store, and it carries two properties at once:

* **Replay refusal.** ``jti`` is the PRIMARY KEY. Coord inserts the row for a
  VERIFIED OIDC token before any grant decision; a second request carrying the
  same ``jti`` hits the key and is refused. Coord runs as more than one
  replica, so an in-process replay cache would let a token replayed against a
  sibling replica through; the key is what makes the refusal hold fleet-wide.
* **One audit row per request.** The same row records which consumer asked for
  which target from which run (``run_id``, ``job_workflow_ref``, ``ref``,
  ``event_name``), the decision (``outcome`` — ``pending`` until decided, then
  ``minted`` or the typed refusal code coord answered), the installation the
  token was minted on, and the token's expiry. The token VALUE is never stored.

Only verified tokens get a row: a request whose signature, issuer, audience or
expiry fails is refused before the insert, so an unauthenticated caller cannot
grow this table.

``outcome`` is TEXT without a CHECK on purpose: its vocabulary is coord's typed
refusal set, which grows with the broker, and a CHECK here would make every new
refusal code a cross-repo migration. Coord pins the vocabulary in its tests.

No foreign keys: ``tenant_id`` is NULL when the token's ``repository_owner``
maps to no tenant (the row still records the refused attempt), and the row's
lifecycle is the audit trail's, not the tenant's.

Hand-authored; ``alembic revision --autogenerate`` was not run and is never run
against ``coord.*``. coord authors **zero** DDL
(``[policy: alembic-sole-authorship]``), so this revision must merge **before**
the coord PR that reads and writes the table. Until it has applied, coord's
broker fails CLOSED (a typed 503): minting without a replay ledger would drop
the replay refusal silently.

Idempotency: ``IF NOT EXISTS`` / ``IF EXISTS`` throughout, matching the
``coord.*`` migration house style.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "ci_read_token_01"
down_revision: str | Sequence[str] | None = "plan_library_10_keyset_walk_indexes"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.ci_repo_read_token_requests (
            jti              TEXT        PRIMARY KEY,
            tenant_id        UUID        NULL,
            consumer_repo    TEXT        NOT NULL,
            target_repo      TEXT        NOT NULL,
            run_id           TEXT        NULL,
            job_workflow_ref TEXT        NULL,
            ref              TEXT        NULL,
            event_name       TEXT        NULL,
            outcome          TEXT        NOT NULL DEFAULT 'pending',
            installation_id  BIGINT      NULL,
            token_expires_at TIMESTAMPTZ NULL,
            oidc_expires_at  TIMESTAMPTZ NOT NULL,
            created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
            decided_at       TIMESTAMPTZ NULL
        )
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_ci_repo_read_token_requests_consumer
            ON coord.ci_repo_read_token_requests (consumer_repo, created_at DESC)
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_ci_repo_read_token_requests_target
            ON coord.ci_repo_read_token_requests (target_repo, created_at DESC)
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS coord.idx_ci_repo_read_token_requests_target")
    op.execute("DROP INDEX IF EXISTS coord.idx_ci_repo_read_token_requests_consumer")
    op.execute("DROP TABLE IF EXISTS coord.ci_repo_read_token_requests")
