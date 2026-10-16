"""runner-as-CI-node — coord.ci_dispatches.model_access / model_ledger

Revision ID: cinode_05_dispatch_model_access_and_ledger
Revises: cpu_temp_01
Create Date: 2026-10-13

Phase 3 item 1 (web DDL half) of plan
``2026-10-13-ci-node-runs-model-dependent-eval-steps``. The coord half,
``crates/coord/src/ci_model_access.rs`` in qontinui-coord (landing separately),
reads and writes these two columns and degrades to ``schema_pending`` while
they are absent, so this revision must land first (served policy
``production-and-cost`` ``alembic-sole-authorship``).

The two columns
==========================================================================

* ``model_access JSONB NULL`` — coord's per-dispatch grant for brokered
  model calls (plan D7): ``{granted, reason, basis, dial}``. Coord computes it
  in ``create_and_dispatch``, sends the same object in the
  ``build_requested`` payload, and stores it here for audit. Coord's
  cross-dispatch bound (plan D6, ``rate_capped``) counts a repo's rows whose
  ``model_access ->> 'granted' = 'true'`` in a rolling 24 h.
* ``model_ledger JSONB NULL`` — the per-dispatch model-call ledger the CI
  node reports with its result (plan D10). It has its own column because
  ``summary`` is capped at 64 KiB and replaced wholesale with an oversize
  marker past that cap, so a few hundred call rows would erase the step
  summary. Coord bounds a ledger at 1 MiB and REJECTS an oversize one rather
  than truncating it, so a stored ledger is always complete. It carries no
  attribution (tenant, repo, sha, lane come from the row itself).

Both are NULL for every pre-existing row and for every dispatch whose job
declares no ``[model]``. NULL means "not recorded", never "refused" — the
refusal is a ``model_access`` object with ``granted: false`` and a reason.

No index: the ``rate_capped`` probe filters on ``repo`` first, which the
existing ``idx_ci_dispatches_repo_head_sha (repo, head_sha)`` prefix serves,
and the ledger is small (1984 rows, 2.1 MB in total, measured read-only on
prod 2026-09-28 for ``cinode_03``). A partial index on the grant can be added
by a later revision if a reading shows the probe matters.

Shape: additive ONLY, for coord's merge-time classifier
==========================================================================

Shaped like ``cinode_03_dispatch_pr_head_base_sha`` so coord's
``pr_merge/migration_classifier.rs`` admits it: ``ADD COLUMN IF NOT EXISTS``
of nullable columns with no default (a catalog-only change, no table
rewrite), static ``op.execute`` literals, and a ``lock_timeout`` that is put
back with ``SET LOCAL lock_timeout = DEFAULT`` so it does not leak into later
revisions (``env.py`` runs the whole upgrade in one transaction).

``down_revision`` chains off main's single head when this was rebased
(``cpu_temp_01``; ``scripts/ci/count_alembic_heads.py`` read
HEAD_COUNT=1). Coord re-points it at land time if main moves again.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "cinode_05_dispatch_model_access_and_ledger"
down_revision: str | Sequence[str] | None = "cpu_temp_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add the two nullable JSONB columns and comment them. Idempotent."""
    # Bound the ALTER's ACCESS EXCLUSIVE wait: coord writes the ledger on
    # every dispatch, and a queued exclusive lock blocks everyone behind it.
    op.execute("SET LOCAL lock_timeout = '3s'")
    # Plain literals, never f-strings: coord's classifier admits only a STATIC
    # op.execute argument, and the `alembic-schema-arg-gate` pre-commit hook
    # parses the raw SQL to prove every statement names its schema.
    op.execute(
        """
        ALTER TABLE coord.ci_dispatches
            ADD COLUMN IF NOT EXISTS model_access JSONB NULL,
            ADD COLUMN IF NOT EXISTS model_ledger JSONB NULL
        """
    )
    op.execute("SET LOCAL lock_timeout = DEFAULT")
    op.execute(
        """
        COMMENT ON COLUMN coord.ci_dispatches.model_access IS
            'Coord grant for brokered model calls: {granted, reason, basis, dial}. '
            'Sent in the build_requested payload. NULL = not recorded.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.ci_dispatches.model_ledger IS
            'Per-dispatch model-call ledger reported with the result (<= 1 MiB, rejected '
            'not truncated; no attribution keys). NULL = none reported.'
        """
    )


def downgrade() -> None:
    """Drop the two columns. Idempotent."""
    op.execute("SET LOCAL lock_timeout = '3s'")
    op.execute(
        """
        ALTER TABLE coord.ci_dispatches
            DROP COLUMN IF EXISTS model_ledger,
            DROP COLUMN IF EXISTS model_access
        """
    )
    op.execute("SET LOCAL lock_timeout = DEFAULT")
