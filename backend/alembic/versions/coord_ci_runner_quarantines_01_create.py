"""coord.ci_runner_quarantines + coord.ci_runner_probes — the poison-runner decision ledger and its restore probes

Revision ID: coord_ci_runner_quarantines_01
Revises: coord_ci_job_observations_01
Create Date: 2026-09-15

Phase 2a of plan
``2026-09-14-a-poison-ci-runner-takes-every-job-and-no-detector-sees-it``.

Two tables, both additive, both coord-only:

1. ``coord.ci_runner_quarantines`` — one row per DECISION the poison-runner
   detector takes about a host. In Phase 2 every row is a shadow row
   (``shadow_would_act`` or ``shadow_refused``): the detector evaluates the
   quarantine guards as a dry run and records what it would have done, with
   no GitHub write path compiled in. Phase 4 adds the write path and the
   ``active`` state, and its PR is admissible only with the graduation numbers
   read from this ledger. The adjudicator writes ``adjudication`` once a
   decision is 24h old, from later observations.
2. ``coord.ci_runner_probes`` — one row per canary dispatch against a host's
   coord-owned probe label. Unused until Phase 3; it rides this migration so
   Phase 3 needs none.

## What writes them

``qontinui-coord`` ``ci_runner_poison`` (Phase 2b) owns
``ci_runner_quarantines``: a leader-gated ledger worker that evaluates each
host over a 2h window of ``coord.ci_job_observations`` against its peers,
raises the ``ci_runner_poison_suspected`` alert, and on every ``Suspected``
transition writes one decision row. ``qontinui-coord`` ``ci_runner_probe``
(Phase 3) owns ``ci_runner_probes``: it dispatches the canary workflow against
the probe label, then resolves the row from the observation the sampler lands
for the canary job.

## Column shape of coord.ci_runner_quarantines

* ``id`` UUID PRIMARY KEY DEFAULT gen_random_uuid().
* ``tenant_id`` UUID NOT NULL — the tenant whose repos the evidence came from.
* ``runner_name`` TEXT NOT NULL — the host (a GitHub ``runner_name``), the
  unit of detection. Evidence is pooled across the tenant's repos.
* ``routing_label`` TEXT NOT NULL — the label real jobs require (``qontinui``
  today). A quarantine removes only this label, per registration, through
  the existing ``ci_runner_admin`` lever.
* ``state`` TEXT NOT NULL — ``shadow_would_act`` | ``shadow_refused`` |
  ``active`` | ``restored`` | ``released_by_operator`` |
  ``released_out_of_band`` | ``abandoned``. No CHECK (see below).
* ``refusal`` TEXT — which guard refused, for ``shadow_refused`` and for a
  refused act.
* ``alert_key`` TEXT NOT NULL — the ``coord.alerts`` key of the
  ``ci_runner_poison_suspected`` alert this decision answers.
* ``evidence`` JSONB NOT NULL — the detector inputs: n, k, share, peers,
  paired keys, bands, job ids.
* ``repos`` TEXT[] NOT NULL DEFAULT '{}' — the registrations the act fanned
  out to, or would have.
* ``decided_at`` TIMESTAMPTZ NOT NULL DEFAULT now(); ``acted_at``,
  ``restored_at`` TIMESTAMPTZ; ``restored_by`` TEXT.
* ``requarantine_count`` INTEGER NOT NULL DEFAULT 0.
* ``adjudication`` TEXT NOT NULL DEFAULT 'pending' — ``pending`` |
  ``confirmed`` | ``false_positive`` | ``unknown``; ``adjudicated_at``
  TIMESTAMPTZ; ``adjudication_basis`` JSONB.
* ``updated_at`` TIMESTAMPTZ NOT NULL DEFAULT now(). The default covers
  INSERT only; there is no trigger in this chain, so every writer sets it on
  UPDATE.

``ux_ci_rq_active`` is a UNIQUE partial index on
``(tenant_id, runner_name, routing_label) WHERE state = 'active'``: at most
one active quarantine per registration label per host. Keyed on the routing
label and enforced by the database, so a leader change between the GitHub
write and the ledger write cannot open a second active quarantine. The
predicate is a pure equality over a column, with no non-IMMUTABLE function.

## Column shape of coord.ci_runner_probes

* ``id`` UUID PRIMARY KEY DEFAULT gen_random_uuid().
* ``tenant_id`` UUID NOT NULL; ``runner_name`` TEXT NOT NULL; ``repo`` TEXT
  NOT NULL — the repo whose canary workflow was dispatched.
* ``probe_label`` TEXT NOT NULL — the coord-owned label only the canary
  requires (``coord-probe-<runner-slug>``).
* ``quarantine_id`` UUID — the decision this probe serves; NULL for a
  calibration probe. A plain column, no FK: a probe outlives a deleted
  decision harmlessly, and coord-only tables stay out of the ORM graph.
* ``dispatched_at`` TIMESTAMPTZ NOT NULL DEFAULT now(); ``run_id`` /
  ``job_id`` BIGINT once the dispatched run is identified.
* ``outcome`` TEXT NOT NULL DEFAULT 'dispatched' — ``dispatched`` | ``pass``
  | ``infra_shaped`` | ``content_fail`` | ``inconclusive`` | ``not_acquired``
  | ``wrong_runner`` | ``dispatch_failed`` | ``host_offline``.
* ``duration_secs`` INTEGER; ``resolved_at`` TIMESTAMPTZ.

## Why the vocabularies are text with no CHECK

``state``, ``adjudication`` and ``outcome`` are text with NO CHECK, the same
choice ``coord.notifications.kind`` makes: the closed set lives in the Rust
enum that writes it, and a new class is a Rust PR rather than a migration.
The vocabularies are recorded on the column comments so psql describe output
carries them.

## No tenant FK, no ORM model

``tenant_id`` is a plain column on both tables, the ``coord_findings`` and
``coordnotif_01`` side of the mixed house practice, not the
``coord_ci_pool_baselines_01`` side. These rows are an audit ledger of routing
decisions and probe dispatches; a cascade on tenant delete would erase the
record of what coord did to a real GitHub runner, and the plan states the
shape without one. No SQLAlchemy model: coord-only tables stay out of the ORM
graph, and web is their schema author, never a reader.

## Two-repo ordering: this schema half lands and is APPLIED first

alembic in qontinui-web is the SOLE author of ``coord.*`` schema; the
``qontinui-coord`` binary authors zero ``coord.*`` DDL and boot-gates on each
table through ``state::require_table``. The coord PRs that read and write
these tables (Phases 2b and 3) land after this revision is applied in
production.

## Head choice

``down_revision`` is ``coord_ci_job_observations_01``, Phase 1a of the same
plan, which itself chains off ``coord_ci_pool_baselines_01``, the single head
of ``origin/main`` at ``72cd8e4f0`` when both were written. If main has moved
before they land, re-point the Phase 1a revision (not this one) at the new
single head; this one keeps its parent. Do not add an ``alembic merge``: this
repo keeps strict single-head discipline.

## Merge-train classifier disposition

coord's migration classifier (``qontinui-coord``
``crates/coord/src/pr_merge/migration_classifier.rs``) is expected to classify
this revision Reject: it rejects a non-concurrent ``CREATE UNIQUE INDEX`` and
does not recognise ``COMMENT ON``, and it scans ``downgrade()`` too, where it
rejects every ``DROP``. Every SQL string is a static literal, so it is not
rejected for being dynamic. The landed precedents ``coord_ci_pool_baselines_01``
and ``coord_expectation_probes_01`` classify Reject the same way.

## Safety

``CREATE TABLE IF NOT EXISTS``, ``CREATE UNIQUE INDEX IF NOT EXISTS`` and
re-runnable ``COMMENT ON``, so a partial apply re-runs cleanly. No existing
table is touched, so no lock bound is needed. ``downgrade()`` drops the index
and both tables, all ``IF EXISTS``; the comments go with them. Both directions
are pure SQL execution with no bind or inspection, so they work under
``alembic ... --sql`` offline mode.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coord_ci_runner_quarantines_01"
down_revision: str | Sequence[str] | None = "coord_ci_job_observations_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Every SQL string below is a STATIC literal. The coord merge-train migration
# classifier extracts string literals from each execute call and rejects a call
# with none as dynamic. Keep these comments free of apostrophes and of the
# op-dot-call spelling: the classifier lexer does not skip Python comments.


def upgrade() -> None:
    """Create coord.ci_runner_quarantines and coord.ci_runner_probes, document both."""
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.ci_runner_quarantines (
            id                 UUID        NOT NULL DEFAULT gen_random_uuid(),
            tenant_id          UUID        NOT NULL,
            runner_name        TEXT        NOT NULL,
            routing_label      TEXT        NOT NULL,
            state              TEXT        NOT NULL,
            refusal            TEXT,
            alert_key          TEXT        NOT NULL,
            evidence           JSONB       NOT NULL,
            repos              TEXT[]      NOT NULL DEFAULT '{}',
            decided_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
            acted_at           TIMESTAMPTZ,
            restored_at        TIMESTAMPTZ,
            restored_by        TEXT,
            requarantine_count INTEGER     NOT NULL DEFAULT 0,
            adjudication       TEXT        NOT NULL DEFAULT 'pending',
            adjudicated_at     TIMESTAMPTZ,
            adjudication_basis JSONB,
            updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT ci_runner_quarantines_pkey PRIMARY KEY (id)
        )
        """
    )

    # At most one ACTIVE quarantine per (tenant, host, routing label), enforced
    # by the database so a leader change mid-act cannot open a second one.
    op.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS ux_ci_rq_active
            ON coord.ci_runner_quarantines (tenant_id, runner_name, routing_label)
            WHERE state = 'active'
        """
    )

    op.execute(
        """
        COMMENT ON TABLE coord.ci_runner_quarantines IS
            'Decision ledger of the poison-runner detector: one row per decision about a host, written by the coord module ci_runner_poison. Phase 2 writes shadow rows only (shadow_would_act, shadow_refused) with no GitHub write path; Phase 4 adds active and the restore states. ux_ci_rq_active keeps at most one active row per (tenant_id, runner_name, routing_label). Plan 2026-09-14-a-poison-ci-runner-takes-every-job-and-no-detector-sees-it, Phase 2.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.ci_runner_quarantines.state IS
            'shadow_would_act | shadow_refused | active | restored | released_by_operator | released_out_of_band | abandoned. Text with no CHECK, as coord.notifications.kind is; the closed set lives in the Rust enum that writes it.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.ci_runner_quarantines.refusal IS
            'Which guard refused, for shadow_refused and for a refused act. NULL when nothing refused.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.ci_runner_quarantines.evidence IS
            'The detector inputs behind the decision: n, k, share, peer share, paired keys, duration bands and the job ids they came from.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.ci_runner_quarantines.adjudication IS
            'pending | confirmed | false_positive | unknown, written by the adjudicator once the decision is 24h old, from later observations; the basis is in adjudication_basis. No CHECK. Unknowns are reported and excluded from the false-positive denominator.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.ci_runner_quarantines.updated_at IS
            'The default covers INSERT only; there is no trigger, so every UPDATE must set it explicitly.'
        """
    )

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.ci_runner_probes (
            id              UUID        NOT NULL DEFAULT gen_random_uuid(),
            tenant_id       UUID        NOT NULL,
            runner_name     TEXT        NOT NULL,
            repo            TEXT        NOT NULL,
            probe_label     TEXT        NOT NULL,
            quarantine_id   UUID,
            dispatched_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
            run_id          BIGINT,
            job_id          BIGINT,
            outcome         TEXT        NOT NULL DEFAULT 'dispatched',
            duration_secs   INTEGER,
            resolved_at     TIMESTAMPTZ,
            CONSTRAINT ci_runner_probes_pkey PRIMARY KEY (id)
        )
        """
    )

    op.execute(
        """
        COMMENT ON TABLE coord.ci_runner_probes IS
            'One row per canary dispatch against a host probe label, written by the coord module ci_runner_probe: it dispatches the coord-runner-canary workflow against probe_label and resolves the row from the observation ci_job_sampler lands for the canary job. Unused until Phase 3 of plan 2026-09-14-a-poison-ci-runner-takes-every-job-and-no-detector-sees-it; created here so that phase needs no migration.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.ci_runner_probes.quarantine_id IS
            'The coord.ci_runner_quarantines decision this probe serves. NULL = a calibration probe. Plain column, no FK.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.ci_runner_probes.outcome IS
            'dispatched | pass | infra_shaped | content_fail | inconclusive | not_acquired | wrong_runner | dispatch_failed | host_offline. Text with no CHECK; the closed set lives in the Rust enum that writes it.'
        """
    )


def downgrade() -> None:
    """Drop the active-quarantine index and both tables. Their comments go with them."""
    op.execute("DROP INDEX IF EXISTS coord.ux_ci_rq_active")
    op.execute("DROP TABLE IF EXISTS coord.ci_runner_probes")
    op.execute("DROP TABLE IF EXISTS coord.ci_runner_quarantines")
