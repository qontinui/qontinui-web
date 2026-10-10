"""coord work-unit verifications — one row per independent post-ship verification

Revision ID: wuverif_01
Revises: census_idx_01_device_repo_path_observed
Create Date: 2026-09-30

Phase 1 (storage) of the work-unit verification plan. DDL ONLY: no route, no
query, no coord change. Coord's half — the table name in
``schema_manifest::ALEMBIC_OWNED_TABLES`` (best-effort, NOT a critical boot
table) and a ``TableMissing`` tri-state read — lives in qontinui-coord and is
NOT made here.

What this revision stands up
============================

``coord.work_unit_verifications`` — one row per verification a verifier
session ran against a shipped work unit. A row records the verdict
(``survived`` / ``refuted`` / ``unverifiable``), what was checked
(``criteria``), what it was checked against (``verified_against``), the
independence evidence (``independence``, ``author_sessions``,
``author_resolution``), and how the unit was chosen (``selection``,
``effective_rate_bp``).

Design notes
============

* **``unverifiable_reason`` iff ``verdict = 'unverifiable'``.** Enforced by a
  table CHECK, so a reader never meets an unverifiable row with no reason, nor
  a survived/refuted row carrying one. ``unverifiable`` is a verdict about the
  verifier's reach, never about the unit, and the reason is what makes it
  actionable.
* **Idempotency key ``(work_unit_id, verifier_session_id,
  plan_content_sha256)``** as a unique INDEX with ``NULLS NOT DISTINCT``
  (PG15+; CI and prod RDS are pg16, and the house already relies on it in
  ``uq_work_unit_pr_citations_dedupe`` / ``uq_work_unit_phase_attestations_dedupe``).
  Without the clause a NULL sha (plan body unreadable) would never collide and
  a retried write would accumulate duplicates. A unique INDEX rather than a
  constraint so ``ON CONFLICT`` can bind to it.
* **Supersession is two self-FKs, not a DELETE.** A recheck writes a new row
  whose ``supersedes`` names the old one and sets the old row's
  ``superseded_by``; the history survives. Both FKs are ``ON DELETE NO
  ACTION``: nothing deletes a verification row except the ``ON DELETE
  CASCADE`` from ``coord.work_units``, which removes every row of a unit in one
  statement (NO ACTION is checked at statement end, so the cascade succeeds as
  long as supersession stays within one unit — which is how it is written).
* **The live-refutation partial index** — ``(work_unit_id) WHERE verdict =
  'refuted' AND superseded_by IS NULL`` — is the demotion reader's lookup: a
  unit with an unsuperseded refutation.
* Closed vocabularies are DB CHECKs (verdict, unverifiable_reason,
  author_resolution, selection). Widening one is a web migration ordered ahead
  of the coord deploy that writes the new value.
* **``effective_rate_bp`` is CHECKed to 1..10000.** A calibration reader
  re-weights sampled rows by it, so a zero or negative rate would divide by
  zero or flip a sign rather than fail loudly.
* **A ``disjoint`` claim needs a non-empty ``author_sessions``.** Disjointness
  from an empty set is vacuous — every claim has at least one landed commit, so
  an empty author set means authorship was NOT resolved, which is ``unknown``.
  The CHECK (``author_resolution = 'unknown' OR cardinality(author_sessions) >
  0``) keeps an unresolved claim from being recorded as independence.

Idempotency / authorship posture
================================

* Every DDL statement uses ``IF NOT EXISTS`` / ``IF EXISTS`` and raw
  ``op.execute`` (not ``op.create_table``), matching the ``coord.*`` house
  style (``vetev_01``, ``phaseatt_01``). Constraints are declared INLINE in the
  ``CREATE TABLE IF NOT EXISTS`` with explicit names, so a re-run against an
  already-applied DB is a no-op as a whole.
* SQL is written as plain string literals (no f-strings) so
  ``.pre-commit-hooks/check_alembic_schema_args.py``'s raw-SQL audit actually
  inspects it — that audit silently skips any non-literal argument.
* Hand-written. ``alembic revision --autogenerate`` is never run in this repo
  — served policy ``production-and-cost`` ``alembic-sole-authorship``.
* alembic is the SOLE author of ``coord.*``. Coord only SELECTs / INSERTs /
  UPDATEs this table.

Deploy order — load-bearing
===========================

This web migration MUST be applied to prod RDS **BEFORE** the coord image
carrying the reads/writes deploys (the 2026-07-13 missing-column incident
class). Coord's ``schema_read_contract`` scanner enforces it against the pinned
migrator head (``MIGRATOR_ALEMBIC_HEAD`` in qontinui-coord
``.github/workflows/ci.yml``); the coord PR carries ``coord:downstream-of`` on
this one.

Head resolution
===============

``down_revision = "census_idx_01_device_repo_path_observed"`` — the single
head of qontinui-web ``origin/main`` @ ``243794513`` on
2026-10-10 (re-chained from ``cmtland_01``, the head this was authored on),
resolved by AST-parsing every file in ``backend/alembic/versions`` and taking
the one ``revision`` no file names as ``down_revision``. If main moves before
this lands, re-chain onto the live head (prove ONE head with
``ScriptDirectory.from_config(...).get_heads()``), and re-point the
``Revises:`` line above in the same edit. Do not author an ``alembic merge``.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "wuverif_01"
down_revision: str | Sequence[str] | None = "census_idx_01_device_repo_path_observed"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create coord.work_unit_verifications, its CHECKs and its four indexes."""
    op.execute("CREATE SCHEMA IF NOT EXISTS coord")

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.work_unit_verifications (
            id                   UUID NOT NULL DEFAULT gen_random_uuid(),
            tenant_id            UUID NOT NULL,
            work_unit_id         UUID NOT NULL,
            verdict              TEXT NOT NULL,
            unverifiable_reason  TEXT,
            criteria             JSONB NOT NULL,
            verified_against     JSONB NOT NULL,
            independence         JSONB NOT NULL,
            verifier_session_id  UUID NOT NULL,
            author_sessions      UUID[] NOT NULL,
            author_resolution    TEXT NOT NULL,
            selection            TEXT NOT NULL,
            effective_rate_bp    INTEGER NOT NULL,
            plan_content_sha256  TEXT,
            supersedes           UUID,
            superseded_by        UUID,
            side_effects         JSONB NOT NULL DEFAULT '{}'::jsonb,
            created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),

            CONSTRAINT work_unit_verifications_pkey PRIMARY KEY (id),
            CONSTRAINT work_unit_verifications_work_unit_id_fkey
                FOREIGN KEY (work_unit_id)
                REFERENCES coord.work_units(id) ON DELETE CASCADE,
            CONSTRAINT work_unit_verifications_supersedes_fkey
                FOREIGN KEY (supersedes)
                REFERENCES coord.work_unit_verifications(id),
            CONSTRAINT work_unit_verifications_superseded_by_fkey
                FOREIGN KEY (superseded_by)
                REFERENCES coord.work_unit_verifications(id),
            CONSTRAINT work_unit_verifications_verdict_check
                CHECK (verdict IN ('survived', 'refuted', 'unverifiable')),
            CONSTRAINT work_unit_verifications_unverifiable_reason_check
                CHECK (
                    unverifiable_reason IS NULL
                    OR unverifiable_reason IN (
                        'no_stated_criteria',
                        'surface_unreachable',
                        'credential_absent',
                        'plan_body_unreadable',
                        'budget_exhausted',
                        'criteria_not_observable',
                        'other'
                    )
                ),
            CONSTRAINT work_unit_verifications_reason_iff_unverifiable_check
                CHECK ((verdict = 'unverifiable') = (unverifiable_reason IS NOT NULL)),
            CONSTRAINT work_unit_verifications_author_resolution_check
                CHECK (author_resolution IN ('disjoint', 'unknown')),
            CONSTRAINT work_unit_verifications_selection_check
                CHECK (selection IN ('sampled', 'surge', 'requested', 'recheck')),
            CONSTRAINT work_unit_verifications_effective_rate_bp_check
                CHECK (effective_rate_bp BETWEEN 1 AND 10000),
            CONSTRAINT work_unit_verifications_disjoint_needs_authors_check
                CHECK (
                    author_resolution = 'unknown'
                    OR cardinality(author_sessions) > 0
                )
        )
        """
    )

    # Idempotency key. NULLS NOT DISTINCT so a verification whose plan body was
    # unreadable (plan_content_sha256 IS NULL) still dedupes on retry.
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS "
        "uq_work_unit_verifications_idempotency "
        "ON coord.work_unit_verifications "
        "(work_unit_id, verifier_session_id, plan_content_sha256) "
        "NULLS NOT DISTINCT"
    )
    # Per-tenant time-ordered read (calibration / rate accounting).
    op.execute(
        "CREATE INDEX IF NOT EXISTS "
        "idx_work_unit_verifications_tenant_created "
        "ON coord.work_unit_verifications (tenant_id, created_at)"
    )
    # Per-unit history, newest first.
    op.execute(
        "CREATE INDEX IF NOT EXISTS "
        "idx_work_unit_verifications_unit_created "
        "ON coord.work_unit_verifications (work_unit_id, created_at DESC)"
    )
    # The demotion reader's lookup: units carrying a live (unsuperseded)
    # refutation. Partial because that set is tiny against the whole store.
    op.execute(
        "CREATE INDEX IF NOT EXISTS "
        "idx_work_unit_verifications_live_refuted "
        "ON coord.work_unit_verifications (work_unit_id) "
        "WHERE verdict = 'refuted' AND superseded_by IS NULL"
    )

    op.execute(
        """
        COMMENT ON TABLE coord.work_unit_verifications IS
        'One row per independent verification of a shipped work unit. Owned by '
        'coord. Supersession MARKS (supersedes / superseded_by), it never '
        'deletes: the audit trail is the point of this table.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.work_unit_verifications.unverifiable_reason IS
        'Set iff verdict = unverifiable (table CHECK). unverifiable is a verdict '
        'about the verifier''s reach, never about the unit.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.work_unit_verifications.author_resolution IS
        'disjoint = the verifier session was positively resolved to be none of '
        'author_sessions; unknown = authorship could not be resolved. unknown is '
        'NOT disjoint and must never be read as independence.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.work_unit_verifications.effective_rate_bp IS
        'The sampling rate (basis points, 1..10000) in force when this unit was '
        'selected, so a calibration reader can re-weight sampled rows.'
        """
    )


def downgrade() -> None:
    """Reverse: indexes first, then the table (its CHECKs and FKs go with it).

    Index names are schema-qualified so the drop is explicit about which
    schema it touches rather than depending on ``search_path``.
    """
    op.execute("DROP INDEX IF EXISTS coord.idx_work_unit_verifications_live_refuted")
    op.execute("DROP INDEX IF EXISTS coord.idx_work_unit_verifications_unit_created")
    op.execute("DROP INDEX IF EXISTS coord.idx_work_unit_verifications_tenant_created")
    op.execute("DROP INDEX IF EXISTS coord.uq_work_unit_verifications_idempotency")
    op.execute("DROP TABLE IF EXISTS coord.work_unit_verifications")
