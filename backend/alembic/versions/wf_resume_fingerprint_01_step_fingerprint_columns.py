"""project workflow journals: add the non-key ``step_fingerprint`` column

Revision ID: wf_resume_fingerprint_01
Revises: coord_prompt_docs_03_session_briefing_kind
Create Date: 2026-08-20

Plan ``2026-08-20-workflow-resume-reexecutes-and-rebills``, Phase 3a (the
qontinui-web half). Phase 3b — the runner-side producer/consumer of the value
— MUST NOT ship until this revision has landed AND deployed, because a runner
build that selects ``step_fingerprint`` against a production database without
this column fails outright.

Why the DDL lives in qontinui-web and not in the runner
------------------------------------------------------------------------------
Both workflow durability journals are ``project.*`` tables authored by this
repo's alembic chain, not by the runner:

* ``project.workflow_step_checkpoints`` — created by
  ``consolidation_phase1_04_workflows`` (the unified-workflow resume journal).
* ``project.workflow_event_log`` — created by
  ``consolidation_phase2_v_18_workflow_event_log`` (the DAG replay journal).

The runner contains no ``CREATE TABLE`` for either and its Atlas pilot
explicitly excludes them (``qontinui-runner/atlas/exclude.txt``), so this is
the only place the columns can be added.

The defect being closed
------------------------------------------------------------------------------
Neither journal's resume key is content-addressed:

* DAG replay keys on ``(execution_id, node_id)``
  (``qontinui-runner/src-tauri/src/.../event_log.rs``).
* Unified checkpoints key on a POSITIONAL 5-tuple — the real uniqueness
  constraint is ``workflow_step_checkpoints_uniq`` =
  ``(execution_id, phase, iteration, step_index, stage_index)``, with the
  runner's matching ``ON CONFLICT`` in
  ``src-tauri/src/database/pg/workflow_state.rs``.

Neither key incorporates prompt text, model id, upstream step outputs, or the
workflow-definition version. Two consequences, both observed:

1. Edit a node's prompt and re-run under the same ``execution_id`` and the
   resume path serves the STALE cached output — the edit is silently ignored
   while the run is still billed as a resume.
2. Change the step list between runs and the positional key silently
   MISALIGNS: step 3's cached result is served for what is now a different
   step 3.

``step_fingerprint`` carries a hash of the inputs that actually determine a
step's output, so resume can compare rather than assume.

Design decisions encoded here
------------------------------------------------------------------------------
**1. This is a NON-KEY validation column.** ``step_fingerprint`` is
deliberately NOT added to ``workflow_step_checkpoints_uniq``. Putting it in the
uniqueness key would make the table grow one row per edit per step and would
turn the existing ``ON CONFLICT (execution_id, phase, iteration, step_index,
stage_index)`` upsert into an append-only log. Looking the row up by the
existing key and THEN comparing the fingerprint yields the same
miss-on-mismatch behaviour with no change to the table's semantics and no
migration of existing rows.

**2. Nullable, and NULL means MISS — never "matches anything".** Every row
that exists today has no fingerprint, so the column must be nullable; there is
no honest value to backfill, because the inputs that produced those cached
outputs were never recorded. The CONSUMER CONTRACT is therefore explicit and
load-bearing:

    A checkpoint or event row whose ``step_fingerprint`` IS NULL is a CACHE
    MISS. The step is re-executed and the row is rewritten with a fingerprint.
    It is NEVER treated as matching the fingerprint being looked for.

This is stated here rather than only in the runner because the opposite reading
of a nullable column — "NULL is unconstrained, so it matches" — is the natural
SQL instinct (``NULL = x`` is UNKNOWN, and a comparison written carelessly as
``fingerprint IS NULL OR fingerprint = $1`` reads as a match). That reading
would serve exactly the stale results this change exists to prevent, so a
lookup MUST be written as ``step_fingerprint = $1`` (fingerprint supplied and
equal), with every other outcome — NULL, mismatch, or no row — a miss.

**3. No index on the new column, deliberately.** The access pattern is: locate
the row by the EXISTING key (``workflow_step_checkpoints_uniq`` /
``idx_wsc_lookup`` for checkpoints, ``idx_event_log_node`` for the event log),
then compare the fingerprint on that already-located row. That is a comparison,
not a search — no read path filters, joins or sorts on ``step_fingerprint``
alone, and a hex digest has no useful selectivity as a standalone predicate
anyway. Both journals are hot, append-heavy tables under live write load, so a
b-tree here would buy write amplification and storage for zero read benefit.
An index is a follow-up IF a query that actually searches by fingerprint ever
appears; it is not added reflexively now.

Locking / safety
------------------------------------------------------------------------------
Adding a NULLABLE column with NO default is a catalog-only operation in
PostgreSQL 11+ — no table rewrite and no scan of existing rows — so the brief
``ACCESS EXCLUSIVE`` lock is taken and released immediately even on large
journals. Nothing is backfilled and no existing row changes.

Both statements are collision-safe raw ``IF NOT EXISTS`` / ``IF EXISTS`` and
fully schema-qualified (no ``search_path`` mutation to leak into later
revisions in the same alembic session) — same convention as
``coord_workunits_05_status_history_lookup``. Re-running either direction is a
no-op.

``downgrade`` drops both columns. That is genuinely lossy — the fingerprints
are not recoverable — but it restores exactly the pre-revision schema, and by
contract (2) a consumer that finds the column absent or NULL re-executes, which
is the safe direction.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "wf_resume_fingerprint_01"
down_revision: str | Sequence[str] | None = "coord_prompt_docs_03_session_briefing_kind"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add the nullable ``step_fingerprint`` column to both workflow journals.

    Idempotent. Nullable with no default, so this is catalog-only on PG 11+:
    no rewrite, no backfill, no change to any existing row. NOT added to
    ``workflow_step_checkpoints_uniq`` — see the module docstring, decision 1.
    """
    op.execute(
        """
        ALTER TABLE project.workflow_step_checkpoints
            ADD COLUMN IF NOT EXISTS step_fingerprint TEXT
        """
    )
    op.execute(
        """
        ALTER TABLE project.workflow_event_log
            ADD COLUMN IF NOT EXISTS step_fingerprint TEXT
        """
    )
    # Document the NULL-means-MISS contract in the database itself, so an
    # operator reading \d+ sees it without having to find this revision.
    op.execute(
        """
        COMMENT ON COLUMN project.workflow_step_checkpoints.step_fingerprint IS
            'Content hash of the inputs that determine this step''s output '
            '(prompt text, model, upstream outputs, workflow-definition '
            'version). NON-KEY: not part of workflow_step_checkpoints_uniq. '
            'NULL means CACHE MISS - re-execute; it never matches a lookup.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN project.workflow_event_log.step_fingerprint IS
            'Content hash of the inputs that determine this node''s output. '
            'NON-KEY validation column alongside (execution_id, node_id). '
            'NULL means CACHE MISS - re-execute; it never matches a lookup.'
        """
    )


def downgrade() -> None:
    """Drop both ``step_fingerprint`` columns, restoring the prior schema.

    Lossy by nature (the fingerprints cannot be reconstructed), but safe in
    direction: a consumer that finds no fingerprint re-executes rather than
    serving a stale cached result. The column comments go with the columns.
    """
    op.execute(
        """
        ALTER TABLE project.workflow_event_log
            DROP COLUMN IF EXISTS step_fingerprint
        """
    )
    op.execute(
        """
        ALTER TABLE project.workflow_step_checkpoints
            DROP COLUMN IF EXISTS step_fingerprint
        """
    )
