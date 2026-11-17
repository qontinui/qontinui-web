"""coord.verification_judge_cases — labelled truth for measuring the verifier

Revision ID: wuverif_02
Revises: coord_retention_idx_01
Create Date: 2026-11-01

Phase 3 (web half) of plan
``2026-10-11-reverify-verdicts-are-source-bound-tree-checked-and-judge-agreement-is-measured``.
DDL ONLY: no route, no query, no ORM model — nothing in qontinui-web reads this
table. Coord's half (the ``POST /coord/verification/labels`` door, the
``judge_agreement`` block on ``GET /coord/verification/metrics`` and the
``verification_judge_cases_seeded`` gate query) lives in qontinui-coord and is
NOT made here.

What this revision stands up
============================

``coord.verification_judge_cases`` — one row per LABELLED case: a known truth
about a claim (``holds`` / ``fails`` / ``cannot_tell``) set beside the verdict
the verifier gave it (``survived`` / ``refuted`` / ``unverifiable``). Coord
reads the rows to report how often the verifier agrees with the truth (Cohen's
kappa on the binary sub-table), so a verifier is measured rather than trusted.

Three label sources (``label_source``):

* ``seeded`` — a case planted with a known truth (``seed_class`` names the
  kind of plant). It is not a verdict on a real unit, so it has NO
  ``verification_id``.
* ``operator`` — an operator's judgement of a real verdict row.
* ``consequence`` — coord's own later observation of what happened to a
  verdict (written in-process by a future sweep).

``operator`` and ``consequence`` rows each name the ``coord.work_unit_verifications``
row they judge, and the verifier's verdict/criteria are copied from it by coord.

Design notes
============

* **``verification_id`` is NULL iff the row is seeded.** Table CHECK
  ``(label_source = 'seeded') = (verification_id IS NULL)``: a seeded case
  that names a real verdict, or an operator/consequence label that names none,
  is refused.
* **``seed_class`` only on seeded rows.** CHECK ``(label_source = 'seeded') OR
  seed_class IS NULL``. A seeded row with no ``seed_class`` is NOT refused
  here — the label door requires a non-blank one; the DB pins only the
  direction a reader would misread (a real verdict wearing a plant's class).
* **One label per (verdict, source).** Partial unique index
  ``(verification_id, label_source) WHERE verification_id IS NOT NULL``: an
  operator and the consequence sweep may each label the same verdict once.
  Seeded rows (``verification_id`` NULL) are outside it — any number of plants.
  A unique INDEX rather than a constraint so ``ON CONFLICT`` can bind to it
  (with the same predicate).
* **``ON DELETE CASCADE`` to ``coord.work_unit_verifications``.** A label of a
  verdict that no longer exists measures nothing. That parent is itself only
  deleted by its own cascade from ``coord.work_units``.
* **``tenant_id`` is a bare ``UUID NOT NULL`` with no FK**, exactly as
  ``coord.work_unit_verifications`` types it (``wuverif_01``). Coord supplies
  it from the auth context, never the request body.
* Closed vocabularies are DB CHECKs (``label_source``, ``truth``,
  ``verifier_verdict``). ``verifier_verdict`` uses the same three values as
  ``work_unit_verifications.verdict``. Widening one is a web migration ordered
  ahead of the coord deploy that writes the new value.
* ``(tenant_id, label_source, created_at)`` serves the metrics window read and
  the per-tenant seeded-row count the gate query takes.

Idempotency / authorship posture
================================

* Every DDL statement uses ``IF NOT EXISTS`` / ``IF EXISTS`` and raw
  ``op.execute`` (not ``op.create_table``), matching ``wuverif_01`` and the
  ``coord.*`` house style. Constraints are declared INLINE in the ``CREATE
  TABLE IF NOT EXISTS`` with explicit names, so a re-run against an
  already-applied DB is a no-op as a whole.
* ``SET LOCAL lock_timeout = '3s'`` bounds the DDL's lock wait: the FK takes
  a ``SHARE ROW EXCLUSIVE`` lock on ``coord.work_unit_verifications``, so a
  queued request must fail fast rather than stall coord's verdict writes behind
  it. ``env.py``'s ``_reset_revision_settings`` hook restores it after this
  revision.
* SQL is written as plain string literals (no f-strings) so
  ``.pre-commit-hooks/check_alembic_schema_args.py``'s raw-SQL audit actually
  inspects it.
* Hand-written. ``alembic revision --autogenerate`` is never run in this repo
  — served policy ``production-and-cost`` ``alembic-sole-authorship``.
* alembic is the SOLE author of ``coord.*``. Coord only SELECTs / INSERTs this
  table.

Deploy order — load-bearing
===========================

This web migration MUST be applied to prod RDS **BEFORE** the coord image
carrying the label door / metrics read deploys (the 2026-07-13 missing-column
incident class). Coord's ``schema_read_contract`` scanner enforces it against
the pinned migrator head; the coord PR carries ``coord:downstream-of`` on this
one.

Head resolution
===============

``down_revision = "coord_retention_idx_01"`` — the single head of qontinui-web
``origin/main`` @ ``bb600961b``, measured 2026-11-01 by AST-parsing every file
in ``backend/alembic/versions`` and taking the one ``revision`` no file names
as ``down_revision``. If main moves before this lands, re-chain onto the live
head (prove ONE head with ``ScriptDirectory.from_config(...).get_heads()``),
and re-point the ``Revises:`` line above in the same edit. Do not author an
``alembic merge``.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "wuverif_02"
down_revision: str | Sequence[str] | None = "coord_retention_idx_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create coord.verification_judge_cases, its CHECKs and its two indexes."""
    op.execute("SET LOCAL lock_timeout = '3s'")
    op.execute("CREATE SCHEMA IF NOT EXISTS coord")

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.verification_judge_cases (
            id                 UUID NOT NULL DEFAULT gen_random_uuid(),
            tenant_id          UUID NOT NULL,
            label_source       TEXT NOT NULL,
            verification_id    UUID,
            seed_class         TEXT,
            truth              TEXT NOT NULL,
            verifier_verdict   TEXT NOT NULL,
            verifier_criteria  JSONB,
            labelled_by        TEXT NOT NULL,
            created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),

            CONSTRAINT verification_judge_cases_pkey PRIMARY KEY (id),
            CONSTRAINT verification_judge_cases_verification_id_fkey
                FOREIGN KEY (verification_id)
                REFERENCES coord.work_unit_verifications(id) ON DELETE CASCADE,
            CONSTRAINT verification_judge_cases_label_source_check
                CHECK (label_source IN ('seeded', 'operator', 'consequence')),
            CONSTRAINT verification_judge_cases_truth_check
                CHECK (truth IN ('holds', 'fails', 'cannot_tell')),
            CONSTRAINT verification_judge_cases_verifier_verdict_check
                CHECK (verifier_verdict IN ('survived', 'refuted', 'unverifiable')),
            CONSTRAINT verification_judge_cases_seeded_iff_no_verification_check
                CHECK ((label_source = 'seeded') = (verification_id IS NULL)),
            CONSTRAINT verification_judge_cases_seed_class_only_seeded_check
                CHECK ((label_source = 'seeded') OR seed_class IS NULL)
        )
        """
    )

    # One label per (verdict, source). Seeded rows carry no verification_id and
    # sit outside the predicate, so any number of plants may exist.
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS "
        "uq_verification_judge_cases_verification_source "
        "ON coord.verification_judge_cases (verification_id, label_source) "
        "WHERE verification_id IS NOT NULL"
    )
    # The metrics window read and the per-tenant seeded count.
    op.execute(
        "CREATE INDEX IF NOT EXISTS "
        "idx_verification_judge_cases_tenant_source_created "
        "ON coord.verification_judge_cases (tenant_id, label_source, created_at)"
    )

    op.execute(
        """
        COMMENT ON TABLE coord.verification_judge_cases IS
        'One labelled case per row: a known truth beside the verdict the verifier '
        'gave, read by coord to measure verifier agreement. Owned by coord.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.verification_judge_cases.verification_id IS
        'The coord.work_unit_verifications row an operator or consequence label '
        'judges. NULL iff label_source = seeded (table CHECK).'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.verification_judge_cases.labelled_by IS
        'Operator principal id or agent/device session id, derived by coord from '
        'the authenticated identity; coord::consequence for rows the in-process '
        'consequence sweep writes. Never a request body field.'
        """
    )


def downgrade() -> None:
    """Drop the two indexes, then the table (its CHECKs and FK go with it).

    Index names are schema-qualified so the drop is explicit about which schema
    it touches rather than depending on ``search_path``.
    """
    op.execute("SET LOCAL lock_timeout = '3s'")
    op.execute(
        "DROP INDEX IF EXISTS coord.idx_verification_judge_cases_tenant_source_created"
    )
    op.execute(
        "DROP INDEX IF EXISTS coord.uq_verification_judge_cases_verification_source"
    )
    op.execute("DROP TABLE IF EXISTS coord.verification_judge_cases")
