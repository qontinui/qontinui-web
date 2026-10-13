"""coord.ci_dispatch_read_tokens — the Local-lane sibling-read door's audit and mint cap

Revision ID: ci_read_token_02
Revises: notif_producerless_02_drop_dead_prefs
Create Date: 2026-10-13

Phase 3 of plan
``2026-10-13-local-lane-ci-reads-a-private-sibling-through-a-dispatch-scoped-door``
(its D4 and D7).

Coord gains a dispatch-scoped door: a runner holding a live Local-lane CI
dispatch asks for a read-only installation token on ONE private sibling repo
that the consumer's ``.qontinui/ci.toml`` declares. This table is that door's
one durable store, and it carries two properties at once:

* **One audit row per request.** Which device, on which dispatch, for which
  consumer, asked to read which target; the decision (``outcome`` —
  ``pending`` until decided, then ``minted`` or the typed refusal code coord
  answered); the installation the token was minted on; and the token's expiry.
  The token VALUE is never stored.
* **The mint cap.** At most 4 mints per ``(dispatch_id, target_repo)``. Coord
  counts rows with ``outcome IN ('pending','minted')`` and inserts in ONE
  statement (``INSERT … SELECT … WHERE (SELECT count(*) …) < 4``) under a
  transaction advisory lock keyed on the pair, so a refused retry never
  consumes the cap and concurrent requests cannot race past it. Hence
  ``idx_ci_dispatch_read_tokens_dispatch_target``.

Why not reuse ``coord.ci_repo_read_token_requests`` (``ci_read_token_01``):
its primary key is the OIDC ``jti`` and ``oidc_expires_at`` is NOT NULL, and a
dispatch request has neither. Synthetic values would hide two principals in one
ledger (plan D7).

Retention: coord's ``table_retention`` sweep deletes rows whose ``created_at``
is more than 90 days old (the ``ci_read_token_01`` precedent) — hence
``idx_ci_dispatch_read_tokens_created_at``.

``outcome`` is TEXT without a CHECK on purpose: its vocabulary is coord's typed
refusal set, which grows with the door, and a CHECK here would make every new
refusal code a cross-repo migration. Coord pins the vocabulary in its tests.

No foreign keys: the row's lifecycle is the audit trail's, not the dispatch's
or the tenant's — a dispatch row retired before the audit window closes must
not take its audit rows with it.

Hand-authored; ``alembic revision --autogenerate`` was not run and is never run
against ``coord.*``. coord authors **zero** DDL
(``[policy: alembic-sole-authorship]``), so this revision must merge **before**
the coord PR that reads and writes the table. Until it has applied, coord's
door answers ``503 schema_migration_pending`` and never mints: with no audit
row, there is no mint.

Idempotency: ``IF NOT EXISTS`` / ``IF EXISTS`` throughout, matching the
``coord.*`` migration house style. Creating a new table and its indexes takes
no lock on any existing relation, so no ``lock_timeout`` is set (the
``ci_read_token_01`` precedent).
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "ci_read_token_02"
down_revision: str | Sequence[str] | None = "notif_producerless_02_drop_dead_prefs"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.ci_dispatch_read_tokens (
            id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
            dispatch_id      UUID        NOT NULL,
            tenant_id        UUID        NOT NULL,
            device_id        UUID        NOT NULL,
            consumer_repo    TEXT        NOT NULL,
            target_repo      TEXT        NOT NULL,
            outcome          TEXT        NOT NULL DEFAULT 'pending',
            installation_id  BIGINT      NULL,
            token_expires_at TIMESTAMPTZ NULL,
            created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_ci_dispatch_read_tokens_dispatch_target
            ON coord.ci_dispatch_read_tokens (dispatch_id, target_repo)
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_ci_dispatch_read_tokens_created_at
            ON coord.ci_dispatch_read_tokens (created_at)
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS coord.idx_ci_dispatch_read_tokens_created_at")
    op.execute("DROP INDEX IF EXISTS coord.idx_ci_dispatch_read_tokens_dispatch_target")
    op.execute("DROP TABLE IF EXISTS coord.ci_dispatch_read_tokens")
