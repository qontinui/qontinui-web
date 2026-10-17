"""coord.verification_runs - one row per Rust verification-wrapper invocation

Revision ID: fpl_03
Revises: replident_01
Create Date: 2026-10-17

Phase 4 of plan
``2026-10-17-fleet-work-placement-minimizes-time-to-merged-pr`` (D2 "Never
silent", D3 T4). DDL ONLY: no route, no query. coord's half - the write door
``POST /coord/verification-runs`` and the whitelisted named ``sql_count``
query ``verification_ran_share_7d`` - lives in qontinui-coord. The client half
- ``scripts/cargo-guard.sh`` and ``scripts/cargo-verify.sh`` emitting one
record per invocation, spooled under ``~/.qontinui/verification-outcomes/``
and flushed best-effort - lives in qontinui-claude-config.

What this revision stands up
============================

``coord.verification_runs`` - one row per invocation of a fleet Rust
verification wrapper, recording how the verification ENDED:

* ``outcome`` - the closed vocabulary of plan D2: ``local`` (ran here, no
  wait), ``local_after_queue`` (ran here after waiting for memory headroom,
  including the "building anyway" arm), ``offloaded`` (a ci_node ran it; Phase
  5), ``offload_failed_then_local`` (offload refused or lost, then ran here),
  ``skipped`` (the caller declared it skipped; plan D2 makes the wrappers'
  explicit ``--skip-verify-reason`` flag the only client path to it).
* ``skip_reason`` - set iff ``outcome = 'skipped'`` (table CHECK), so a skip
  is never recorded without a non-blank reason, and a non-skip never carries
  one.
* ``receiver_device_id`` - the ci_node that ran an offloaded invocation;
  only an ``offloaded`` / ``offload_failed_then_local`` row may carry one.
* ``wait_secs`` / ``duration_secs`` / ``memory_shortfall_mb`` - the queue
  wait, the wall-clock length of the whole invocation, and (on the "building
  anyway" arm) how far short of the memory floor the host still was.
* ``tree_sha`` / ``exit_code`` / ``tests_run`` - what was verified and how it
  ended. NULL is UNKNOWN (a cache hit compiles nothing and counts no tests),
  never zero.
* ``device_id`` / ``agent_id`` are written by coord's door from the
  VERIFIED coord JWT, never from the request body (a requirement on the coord
  Phase 4 PR, which carries the door). ``session_id`` is the client's
  claim about which Claude Code session ran the wrapper; NULL means "not
  proven", never "no session".
* ``client_run_id`` is minted by the wrapper and is the idempotency key: the
  spool is flushed at-least-once, so the same record may arrive twice and must
  land once. Unique per ``(tenant_id, client_run_id)``.
* ``observed_at`` is when the invocation finished (the client's clock;
  coord's door must bound it), ``recorded_at`` when coord stored it. A spooled record
  flushed a day late keeps its true ``observed_at``.

Design notes
============

* Closed vocabularies are DB CHECKs (``outcome``, ``wrapper``). Widening one
  is a web migration ordered ahead of the coord deploy that accepts the new
  value.
* Lengths are bounded by CHECKs (``repo``, ``subcommand``, ``skip_reason``)
  because every one of them is caller-supplied text; ``skip_reason`` must also
  carry a non-blank character, and ``tree_sha`` must be 7..64 lowercase hex.
* Deliberately left open: ``memory_shortfall_mb`` and ``wait_secs`` on any
  outcome (an offload that fell back may also have waited), and
  ``exit_code`` / ``duration_secs`` on a ``skipped`` row (the wrapper's own
  exit when it declined to build).
* No FK to ``coord.devices`` or ``coord.sessions``: the record must outlive a
  reaped device and the closed-session prune, and a NULL identity is honest.
* The ``(observed_at)`` index serves the fleet-wide 7-day named count; the
  ``(tenant_id, observed_at)`` index serves per-tenant reads.

Idempotency / authorship posture
================================

* Every DDL statement uses ``IF NOT EXISTS`` / ``IF EXISTS`` and raw
  ``op.execute`` with plain string literals, matching the ``coord.*`` house
  style (``wuverif_01``, ``overlord_01_interventions``), so a re-run against an
  already-applied database is a no-op and the raw-SQL audit inspects it.
* Hand-written. ``alembic revision --autogenerate`` is never run in this repo
  - served policy ``production-and-cost`` ``alembic-sole-authorship``.
* alembic is the SOLE author of ``coord.*``. coord only INSERTs into and
  SELECTs from this table.

Deploy order - load-bearing
===========================

This web migration MUST be applied to prod RDS **BEFORE** the coord image
carrying the write door deploys. As a second line, the coord door must answer
a typed ``503 schema_migration_pending`` while the table is absent (never a
500), and the client keeps a record spooled on any non-2xx, so an early coord
loses nothing. On the coord side the table also enters
``schema_manifest::ALEMBIC_OWNED_TABLES`` as best-effort, and its columns ride
``KNOWN_MISSING`` waivers until ``MIGRATOR_ALEMBIC_HEAD`` is bumped past this
revision.

Head resolution
===============

``down_revision = "replident_01"`` - the single head of
qontinui-web ``origin/main`` after the 2026-10-17 merge of ``replident_01`` (re-chained
from ``taste_inbox_01``, ``fpl_01`` and ``fpl_02`` as main moved), measured by parsing
every file in ``backend/alembic/versions`` (multi-line tuple
``down_revision`` values included) and taking the one ``revision`` no file
names as a parent. If main moves before this lands, re-chain onto the live
head and re-point the ``Revises:`` line above in the same edit. Do not author
an ``alembic merge``.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "fpl_03"
down_revision: str | Sequence[str] | None = "replident_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create coord.verification_runs, its CHECKs and its three indexes."""
    op.execute("CREATE SCHEMA IF NOT EXISTS coord")

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.verification_runs (
            id                   UUID NOT NULL DEFAULT gen_random_uuid(),
            tenant_id            UUID NOT NULL,
            client_run_id        UUID NOT NULL,
            device_id            UUID,
            agent_id             UUID,
            session_id           UUID,
            repo                 TEXT NOT NULL,
            wrapper              TEXT NOT NULL,
            subcommand           TEXT NOT NULL,
            outcome              TEXT NOT NULL,
            skip_reason          TEXT,
            wait_secs            INTEGER,
            duration_secs        INTEGER,
            memory_shortfall_mb  INTEGER,
            receiver_device_id   UUID,
            tree_sha             TEXT,
            exit_code            INTEGER,
            tests_run            INTEGER,
            observed_at          TIMESTAMPTZ NOT NULL,
            recorded_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

            CONSTRAINT verification_runs_pkey PRIMARY KEY (id),
            CONSTRAINT verification_runs_outcome_check
                CHECK (outcome IN (
                    'local',
                    'local_after_queue',
                    'offloaded',
                    'offload_failed_then_local',
                    'skipped'
                )),
            CONSTRAINT verification_runs_wrapper_check
                CHECK (wrapper IN ('cargo-guard', 'cargo-verify')),
            CONSTRAINT verification_runs_skip_reason_iff_skipped_check
                CHECK ((outcome = 'skipped') = (skip_reason IS NOT NULL)),
            CONSTRAINT verification_runs_skip_reason_length_check
                CHECK (skip_reason IS NULL
                       OR (char_length(skip_reason) <= 500
                           AND btrim(skip_reason) <> '')),
            CONSTRAINT verification_runs_receiver_only_when_offloaded_check
                CHECK (receiver_device_id IS NULL
                       OR outcome IN ('offloaded', 'offload_failed_then_local')),
            CONSTRAINT verification_runs_repo_length_check
                CHECK (char_length(repo) BETWEEN 1 AND 200),
            CONSTRAINT verification_runs_subcommand_length_check
                CHECK (char_length(subcommand) BETWEEN 1 AND 64),
            CONSTRAINT verification_runs_tree_sha_shape_check
                CHECK (tree_sha IS NULL OR tree_sha ~ '^[0-9a-f]{7,64}$'),
            CONSTRAINT verification_runs_nonnegative_check
                CHECK (
                    (wait_secs IS NULL OR wait_secs >= 0)
                    AND (duration_secs IS NULL OR duration_secs >= 0)
                    AND (memory_shortfall_mb IS NULL OR memory_shortfall_mb >= 0)
                    AND (tests_run IS NULL OR tests_run >= 0)
                )
        )
        """
    )

    # Idempotency key: the client spool is flushed at-least-once.
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS "
        "uq_verification_runs_tenant_client_run "
        "ON coord.verification_runs (tenant_id, client_run_id)"
    )
    # The fleet-wide 7-day named count (verification_ran_share_7d).
    op.execute(
        "CREATE INDEX IF NOT EXISTS "
        "idx_verification_runs_observed_at "
        "ON coord.verification_runs (observed_at)"
    )
    # Per-tenant time-ordered reads.
    op.execute(
        "CREATE INDEX IF NOT EXISTS "
        "idx_verification_runs_tenant_observed_at "
        "ON coord.verification_runs (tenant_id, observed_at)"
    )

    op.execute(
        """
        COMMENT ON TABLE coord.verification_runs IS
        'One row per Rust verification-wrapper invocation (cargo-guard.sh / '
        'cargo-verify.sh) and how it ended. Owned by coord; append-only.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.verification_runs.outcome IS
        'local | local_after_queue | offloaded | offload_failed_then_local | '
        'skipped. skipped = the caller declared the verification skipped; '
        'skip_reason is required iff skipped.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.verification_runs.tests_run IS
        'Tests the run executed, or NULL when UNKNOWN (no test run, a cache '
        'hit, an uncountable output). NULL is never zero.'
        """
    )


def downgrade() -> None:
    """Drop the indexes, then the table (its CHECKs go with it)."""
    op.execute("DROP INDEX IF EXISTS coord.idx_verification_runs_tenant_observed_at")
    op.execute("DROP INDEX IF EXISTS coord.idx_verification_runs_observed_at")
    op.execute("DROP INDEX IF EXISTS coord.uq_verification_runs_tenant_client_run")
    op.execute("DROP TABLE IF EXISTS coord.verification_runs")
