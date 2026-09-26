"""coord.agent_questions — effect_kind / effect_ref: the decision a question mirrors

Revision ID: coord_agent_questions_effect
Revises: coord_iops_idx_01
Create Date: 2026-09-26

Phase 1 (schema half) of plan
``2026-09-12-one-decision-row-one-inbox-clause-model-is-the-home-for-proposed-policy``
(decisions D2 and D6, vet correction V6).

Adds two columns, one CHECK, and two partial indices to
``coord.agent_questions``:

- ``effect_kind TEXT NOT NULL DEFAULT 'none'`` with the named CHECK
  ``coord_agent_questions_effect_kind_check``
  (``effect_kind IN ('none','clause','proposal','gate')``).
- ``effect_ref JSONB NULL`` — the effect's identity (shape below).
- ``idx_agent_questions_open_effect`` — ``(tenant_id) WHERE responded_at IS
  NULL AND effect_kind <> 'none'``: the "which open rows carry an effect" read.
- ``uq_agent_questions_open_effect`` — UNIQUE ``(tenant_id, effect_kind,
  (effect_ref->>'id')) WHERE effect_kind <> 'none' AND responded_at IS NULL``:
  at most ONE open mirror row per effect.

Why the columns exist
=====================

The operator has four decision surfaces for what is one kind of act — a
question in ``coord.agent_questions``, a policy proposal in
``coord.prompt_document_proposals``, an ``operator_approval`` gate in
``coord.gates``, and (Phase 1b, deferred) a proposed clause in
``coord.policy_clauses``. The plan keeps those tables separate — a proposal is
an executable, version-pinned mutation and a gate is a predicate with a
continuation, and folding either into this table would give a tagged union with
half its columns NULL on every row (D1) — but gives them ONE inbox: the
question row, generalised with an **effect**.

A question with ``effect_kind <> 'none'`` is a MIRROR of a decision owned by
another table. Deciding it is routed by coord through that effect's own core —
``decide_core`` for a proposal, the gate approve/attest/reject cores for a gate,
a clause status transition for a clause — and the question row only records
the outcome. **One writer per effect**: the question row never applies anything
itself (D2). ``'none'`` is every question that exists today, which is why it is
the DDL default and why no backfill runs here.

``effect_ref`` — the shape, and why ``id`` is always flat
=========================================================

JSONB, NULL exactly when ``effect_kind = 'none'``. Every non-``none`` row
carries a flat string ``id`` — the effect's primary key as text — beside
kind-specific keys::

    effect_kind = 'clause'    {"id": <clause_id>, "kind": <doc kind>,
                               "name": <doc name>, "clause_id": <clause_id>}
    effect_kind = 'proposal'  {"id": <proposal_id>, "proposal_id": <proposal_id>,
                               ...any further proposal keys coord records}
    effect_kind = 'gate'      {"id": <gate_id>, "gate_id": <gate_id>,
                               "work_unit_id": <work unit>, "phase_name": <phase>}

``id`` is duplicated rather than derived per kind so that ONE expression —
``effect_ref->>'id'`` — keys the idempotency index across all three kinds. A
per-kind expression (``COALESCE(effect_ref->>'gate_id', effect_ref->>'proposal_id',
…)``) would have to change every time a kind is added, and a unique index whose
key expression changes is a drop-and-rebuild. The console reads the
kind-specific keys for display (the gate's work unit and phase, the proposal's
drill-down link) and must tolerate any of them being absent.

Nothing in the DDL enforces the shape — not ``id``'s presence, nor the
``'none'`` ⇔ NULL pairing. That is deliberate: the shape is coord's write
contract and it moves with coord's code, while a JSON-shape CHECK would pin it
in alembic and turn every additive key into a migration. The one property the
database DOES have to own is idempotency, below.

Why the partial UNIQUE index (vet correction V6)
================================================

``create_agent_question`` is a bare INSERT with no idempotency (coord finding
``30363443``). A gate REFRESH or a proposal re-queue would therefore mint a
second mirror row for the same decision, and the operator would answer the same
gate twice. The in-table precedent is the alert-episode writer and its partial
unique index ``uq_agent_questions_open_alert_episode``
(``agent_questions_alert_episode_01_open_question_per_alert_episode``), whose
shape this copies: tenant-leading, restricted to OPEN rows, so answering the
mirror frees the key and a later, genuinely new decision on the same effect can
be asked again.

How coord should write against it — the arbiter form, never catch-the-23505
(a unique violation aborts the enclosing transaction)::

    INSERT INTO coord.agent_questions (..., effect_kind, effect_ref)
    VALUES (...)
    ON CONFLICT (tenant_id, effect_kind, (effect_ref->>'id'))
        WHERE effect_kind <> 'none' AND responded_at IS NULL
    DO NOTHING
    RETURNING question_id

No row returned means the effect already has an open mirror. The ``WHERE`` of
the conflict target must IMPLY the index predicate or Postgres refuses the
statement with 42P10 ("no unique or exclusion constraint matching the ON
CONFLICT specification") — so if coord ever narrows the predicate below, the
writer and this index move in the same change.

``effect_kind <> 'none'`` keeps every ordinary question out of the index, so
the ~24k-row pending pile adds nothing to it and ordinary asks are never
constrained. A row with ``effect_kind <> 'none'`` and a NULL ``effect_ref`` (or
one without ``id``) indexes a NULL key, and NULLs never collide — such a row is
unconstrained rather than refused. That is coord's contract to never write, not
something this index can catch.

⚠️ Withdrawal — recorded for the phase that owns the writer
==========================================================

``coord_agent_questions_withdrawn`` has landed: a withdrawn question keeps
``responded_at`` NULL, so it still satisfies this predicate and stays in the
index. If coord ever withdraws a MIRROR row while its effect stays open (the
gate still pending, the proposal still queued), that effect can never be
mirrored again until something sets ``responded_at`` on the withdrawn row. The
same consequence is spelled out for ``uq_agent_questions_open_alert_episode``
in that revision's docstring, and the same conclusion holds: the fix is ``AND
withdrawn_at IS NULL`` on the predicate, and it belongs with the coord code
that decides mirror rows are withdrawable, because the writer's conflict target
has to change in the same step. The predicate here is the one the plan and the
coord writer were specified against.

The non-unique ``idx_agent_questions_open_effect``
==================================================

``(tenant_id) WHERE responded_at IS NULL AND effect_kind <> 'none'``. It serves
"the open decisions that carry an effect, for this tenant" — the console's chip
counts and coord's reconcile of mirrors against their effects — without walking
the whole pending pile. Its predicate is ``responded_at IS NULL`` rather than
the post-``withdrawn`` pending predicate so that it serves both coord's
pre-``withdrawn_at`` pending read and the newer one (a query adding ``AND
withdrawn_at IS NULL`` still implies this predicate). Leading ``tenant_id`` for
the reason the sibling indices give: coord's pending read filters it
unconditionally, and it is ``NOT NULL`` on this table.

Why a CHECK constraint
======================

``effect_kind`` selects which core decides the row — an authorization-bearing
dispatch, not an open vocabulary. A typo'd kind would be a row coord cannot
route, silently undecidable. Same reasoning as the sibling
``coord_agent_questions_audience`` CHECK, and added the same idempotent way
(``DROP CONSTRAINT IF EXISTS`` then ``ADD CONSTRAINT``). Widening it for a new
kind is a new revision, by design.

Locking
=======

``ADD COLUMN`` with a constant default is catalog-only on PG 11+ (ACCESS
EXCLUSIVE, no rewrite); ``ADD CONSTRAINT … CHECK`` takes ACCESS EXCLUSIVE plus
one validation scan. Both are bounded with ``SET LOCAL lock_timeout = '3s'`` —
a queued ACCESS EXCLUSIVE request blocks every reader and writer behind it, and
~16 autonomous producers write this table continuously — then ``RESET`` before
the index builds, because ``env.py`` runs every revision in ONE transaction and
an unreset ``SET LOCAL`` leaks into every revision after this one.

Both indices are built ``CONCURRENTLY`` inside ``autocommit_block()``, exactly
as ``uq_agent_questions_open_alert_episode`` is, so neither build holds the
SHARE lock that would block the producers' INSERTs. A failed earlier
CONCURRENTLY build leaves an INVALID index that ``IF NOT EXISTS`` would keep,
so each build first drops an INVALID index of its own name. Both indices store
no entries at creation (every row is ``'none'``), so each build is one scan.
Plain SQL literals, never f-strings, so the ``alembic-schema-arg-gate``
pre-commit hook can see the schema on every ``CREATE``/``DROP``.

Ordering and chain
==================

Served policy ``production-and-cost`` ``alembic-sole-authorship``: this
revision lands and is verified applied on production BEFORE coord's PR that
reads ``effect_kind``/``effect_ref`` (coord appends them to ``COLS`` behind a
``COLS_PRE_EFFECT`` degrade tier, D6/V5). Coord's ``schema_read_contract`` CI
gate enforces the order against the pinned migrator image.

``down_revision`` is ``coord_iops_idx_01``, the single head of the chain on
qontinui-web ``origin/main`` ``9927fddce`` at authoring time, computed from the
chain rather than reserved (the sibling ``coord_agent_questions_audience``
records why coord refuses to reserve an alembic head). Open PR #1461 adds
another ``coord.agent_questions`` revision
(``coord_agent_questions_operator_pending_idx``) off an older head; whichever
of the two lands second re-points its ``down_revision`` — the required
``alembic-heads-pr`` check owns the chain, and no ``coord:stacked-on`` label
belongs on either PR.

Downgrade drops both indices, the CHECK and both columns. Nothing is lost that
was not introduced here: every non-``none`` effect is written by the coord
phases this revision unblocks, and the questions themselves survive.
"""

from collections.abc import Sequence

from sqlalchemy import text

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coord_agent_questions_effect"
down_revision: str | Sequence[str] | None = "coord_iops_idx_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _index_is_invalid(index_name: str) -> bool:
    """True when ``coord.<index_name>`` exists and is INVALID (a failed build)."""
    return bool(
        op.get_bind()
        .execute(
            text(
                """
                SELECT NOT i.indisvalid
                  FROM pg_index i
                  JOIN pg_class c ON c.oid = i.indexrelid
                  JOIN pg_namespace n ON n.oid = c.relnamespace
                 WHERE n.nspname = 'coord' AND c.relname = :idx
                """
            ),
            {"idx": index_name},
        )
        .scalar()
    )


def upgrade() -> None:
    """Add ``effect_kind`` + CHECK + ``effect_ref``, then both partial indices."""
    # Bound the DDL's lock wait; see the docstring's Locking section.
    op.execute("SET LOCAL lock_timeout = '3s'")
    op.execute(
        """
        ALTER TABLE coord.agent_questions
            ADD COLUMN IF NOT EXISTS effect_kind TEXT NOT NULL DEFAULT 'none',
            ADD COLUMN IF NOT EXISTS effect_ref  JSONB
        """
    )
    op.execute(
        """
        ALTER TABLE coord.agent_questions
            DROP CONSTRAINT IF EXISTS coord_agent_questions_effect_kind_check
        """
    )
    op.execute(
        """
        ALTER TABLE coord.agent_questions
            ADD CONSTRAINT coord_agent_questions_effect_kind_check
            CHECK (effect_kind IN ('none', 'clause', 'proposal', 'gate'))
        """
    )
    # SET LOCAL is transaction-scoped and env.py wraps the WHOLE run in one
    # transaction, so without this reset the 3s timeout leaks into every
    # revision that lands after this one.
    op.execute("RESET lock_timeout")

    with op.get_context().autocommit_block():
        # A failed earlier CONCURRENTLY build leaves an INVALID index that
        # IF NOT EXISTS would keep. Drop it so the CREATE below rebuilds it.
        if _index_is_invalid("idx_agent_questions_open_effect"):
            op.execute(
                "DROP INDEX CONCURRENTLY IF EXISTS "
                "coord.idx_agent_questions_open_effect"
            )
        op.execute(
            """
            CREATE INDEX CONCURRENTLY IF NOT EXISTS
                idx_agent_questions_open_effect
            ON coord.agent_questions (tenant_id)
            WHERE responded_at IS NULL AND effect_kind <> 'none'
            """
        )
        if _index_is_invalid("uq_agent_questions_open_effect"):
            op.execute(
                "DROP INDEX CONCURRENTLY IF EXISTS coord.uq_agent_questions_open_effect"
            )
        # At most one OPEN mirror row per effect. Coord's mirror writers
        # insert with `ON CONFLICT (tenant_id, effect_kind, (effect_ref->>'id'))
        # WHERE effect_kind <> 'none' AND responded_at IS NULL DO NOTHING`.
        op.execute(
            """
            CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS
                uq_agent_questions_open_effect
            ON coord.agent_questions (tenant_id, effect_kind, (effect_ref->>'id'))
            WHERE effect_kind <> 'none' AND responded_at IS NULL
            """
        )


def downgrade() -> None:
    """Drop both indices, the CHECK and both columns. The questions survive."""
    with op.get_context().autocommit_block():
        op.execute(
            "DROP INDEX CONCURRENTLY IF EXISTS coord.uq_agent_questions_open_effect"
        )
        op.execute(
            "DROP INDEX CONCURRENTLY IF EXISTS coord.idx_agent_questions_open_effect"
        )
    op.execute("SET LOCAL lock_timeout = '3s'")
    op.execute(
        """
        ALTER TABLE coord.agent_questions
            DROP CONSTRAINT IF EXISTS coord_agent_questions_effect_kind_check
        """
    )
    op.execute(
        """
        ALTER TABLE coord.agent_questions
            DROP COLUMN IF EXISTS effect_ref,
            DROP COLUMN IF EXISTS effect_kind
        """
    )
    op.execute("RESET lock_timeout")
