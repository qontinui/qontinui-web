"""measurement dispatch — coord.ci_dispatches.measurement, and the third run_outcomes lane

Revision ID: ci_measure_01_dispatch_measurement
Revises: coord_maint_agent_req_01
Create Date: 2026-11-22

Phase 4 (web DDL half) of plan
``2026-11-22-phase1-envelope-frozen-and-measurement-dispatch-proven``
(decisions D3 and D5). Coord's ``ci_measurement`` module will read and write
this column (the plan's Phase 5, qontinui-coord ``crates/coord/src/ci_measurement.rs``,
not yet written), so this revision lands and applies first (served policy
``production-and-cost`` ``alembic-sole-authorship``).

The column
==========================================================================

* ``measurement JSONB NULL`` — the declaration snapshot at dispatch time for a
  measurement dispatch (``check_name = 'qontinui-measurement'``): the entry of
  the measured repo's ``.qontinui/measurements.toml`` that was dispatched
  (``name``, ``source``, ``subject``, ``task``; grammar in ``qontinui-types``
  ``measurement_decl``, Phase 4, qontinui-schemas) plus ``evidence_grade``,
  and the ``executed_case_count`` the first result POST will parse and store
  BEFORE it writes the derived ``coord.run_outcomes`` row, so a retried POST
  re-derives the same row rather than losing it or writing 0 cases. Coord
  will label that row from this snapshot, never from a request body.

  For a measurement dispatch ``proposal_id`` (``NOT NULL``) will hold a
  deterministic UUIDv5 over ``(tenant, repo, measurement name)``, so the
  existing single-flight index ``uq_ci_dispatches_active_proposal`` and the
  supersede logic in ``claim_dispatch`` allow at most one live dispatch per
  measurement.

  NULL for every pre-existing row and every non-measurement dispatch. The
  inline CHECK keeps a non-NULL value a JSON object.

The same revision extends the comments on ``coord.run_outcomes`` and its
``check_name`` column to name ``qontinui-measurement`` as the third lane
beside ``qontinui-ci-node`` and ``qontinui-ci-node/shadow`` (they were written
by ``run_outcomes_01`` naming two). The existing text is kept; ``downgrade()``
restores it verbatim.

Shape: additive ONLY, for coord's merge-time classifier
==========================================================================

Shaped like ``cinode_05_dispatch_model_access_and_ledger``: ``ADD COLUMN IF
NOT EXISTS`` of a nullable column with no default, static ``op.execute``
literals, and a ``lock_timeout`` put back with ``SET LOCAL lock_timeout =
DEFAULT`` so it does not leak into later revisions (``env.py`` runs the whole
upgrade in one transaction). The inline CHECK's validation scan is over a
column that is NULL on every existing row; the last measurement of the table's
size is ``cinode_03``'s (read-only on prod, 2026-09-28: 1984 rows, 2.1 MB in
total by ``pg_total_relation_size``). It has not been re-measured for this
revision.

``down_revision`` chains off main's single head when this was authored
(``coord_maint_agent_req_01``; ``scripts/ci/count_alembic_heads.py`` read
HEAD_COUNT=1). Coord re-points it at land time if main moves again.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "ci_measure_01_dispatch_measurement"
down_revision: str | Sequence[str] | None = "coord_maint_agent_req_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add the nullable JSONB column, comment it, extend the lane comments. Idempotent."""
    # Bound the ALTER's ACCESS EXCLUSIVE wait: coord writes the ledger on
    # every dispatch, and a queued exclusive lock blocks everyone behind it.
    op.execute("SET LOCAL lock_timeout = '3s'")
    # Plain literals, never f-strings: coord's classifier admits only a STATIC
    # op.execute argument, and the `alembic-schema-arg-gate` pre-commit hook
    # parses the raw SQL to prove every statement names its schema.
    op.execute(
        """
        ALTER TABLE coord.ci_dispatches
            ADD COLUMN IF NOT EXISTS measurement JSONB NULL
                CONSTRAINT ci_dispatches_measurement_is_object
                CHECK (measurement IS NULL OR jsonb_typeof(measurement) = 'object')
        """
    )
    op.execute("SET LOCAL lock_timeout = DEFAULT")
    op.execute(
        """
        COMMENT ON COLUMN coord.ci_dispatches.measurement IS
            'Declaration snapshot at dispatch time for a measurement dispatch '
            '(check_name qontinui-measurement): the dispatched entry of the repo''s '
            '.qontinui/measurements.toml (name, source, subject, task labels) plus '
            'evidence_grade, and executed_case_count as recorded by the first result POST '
            'before the derived coord.run_outcomes row is written. For a measurement '
            'dispatch proposal_id holds a deterministic UUIDv5 over (tenant, repo, '
            'measurement name), so at most one dispatch per measurement is live. '
            'NULL = not a measurement dispatch.'
        """
    )
    op.execute(
        """
        COMMENT ON TABLE coord.run_outcomes IS
            'Measured evaluation-run outcomes: the store behind the metric arm of coord''s run_outcome anchor. The anchor resolves against the latest row, by run_completed_at, for (tenant_id, source, subject, task) and optionally ref, within one lane (check_name): the authoritative lane when it has any row, else the shadow lane. It is confirmed when the named metric is at least at_least and executed_case_count is at least min_cases, contradicted when either is missed, unknown when there is no row. Written by coord''s CI result door (POST /coord/ci/dispatches/{dispatch_id}/result) with attribution taken from the dispatch row, never from the request body. A third lane, qontinui-measurement, is read only when neither CI lane has a row for the lookup; its rows are derived by coord from a measurement dispatch, labelled from the declaration snapshot in coord.ci_dispatches.measurement.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.run_outcomes.check_name IS
            'Dispatch lane the run was recorded from, copied from coord.ci_dispatches.check_name: qontinui-ci-node (authoritative), qontinui-ci-node/shadow, or qontinui-measurement (a measurement dispatch). The resolver prefers authoritative rows, reads shadow rows only when no authoritative row exists, and reads measurement rows only when neither CI lane has one; the lanes never interleave into one latest.'
        """
    )


def downgrade() -> None:
    """Drop the column (its CHECK goes with it) and restore the two-lane comments."""
    op.execute(
        """
        COMMENT ON TABLE coord.run_outcomes IS
            'Measured evaluation-run outcomes: the store behind the metric arm of coord''s run_outcome anchor. The anchor resolves against the latest row, by run_completed_at, for (tenant_id, source, subject, task) and optionally ref, within one lane (check_name): the authoritative lane when it has any row, else the shadow lane. It is confirmed when the named metric is at least at_least and executed_case_count is at least min_cases, contradicted when either is missed, unknown when there is no row. Written by coord''s CI result door (POST /coord/ci/dispatches/{dispatch_id}/result) with attribution taken from the dispatch row, never from the request body.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.run_outcomes.check_name IS
            'Dispatch lane the run was recorded from, copied from coord.ci_dispatches.check_name: qontinui-ci-node (authoritative) or qontinui-ci-node/shadow. The resolver prefers authoritative rows and reads shadow rows only when no authoritative row exists; the lanes never interleave into one latest.'
        """
    )
    op.execute("SET LOCAL lock_timeout = '3s'")
    op.execute(
        """
        ALTER TABLE coord.ci_dispatches
            DROP COLUMN IF EXISTS measurement
        """
    )
    op.execute("SET LOCAL lock_timeout = DEFAULT")
