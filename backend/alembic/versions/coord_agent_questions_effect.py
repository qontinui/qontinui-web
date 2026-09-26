"""coord.agent_questions — effect_kind / effect_ref: the decision a question mirrors

Revision ID: coord_agent_questions_effect
Revises: coord_iops_idx_01
Create Date: 2026-09-26

Phase 1 (schema half) of plan
``2026-09-12-one-decision-row-one-inbox-clause-model-is-the-home-for-proposed-policy``
(decisions D2 and D6, vet correction V6).

Adds two columns, one CHECK, and three partial indices to
``coord.agent_questions``:

- ``effect_kind TEXT NOT NULL DEFAULT 'none'`` with the named CHECK
  ``coord_agent_questions_effect_kind_check``
  (``effect_kind IN ('none','clause','proposal','gate')``).
- ``effect_ref JSONB NULL`` — the effect's identity (shape below).
- ``idx_agent_questions_open_effect`` — ``(tenant_id) WHERE responded_at IS
  NULL AND effect_kind <> 'none'``: the "which open rows carry an effect" read.
- ``uq_agent_questions_open_effect`` — UNIQUE ``(tenant_id, effect_kind,
  (effect_ref->>'id')) WHERE effect_kind <> 'none' AND responded_at IS NULL AND
  withdrawn_at IS NULL``: at most ONE open, un-withdrawn mirror row per effect.
- ``idx_agent_questions_effect_ref`` — ``(tenant_id, effect_kind,
  (effect_ref->>'id')) WHERE effect_kind <> 'none'``: every mirror row,
  answered or not, so coord's "has this effect been mirrored?" anti-joins stay
  index-driven instead of scanning the whole table.

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
        WHERE effect_kind <> 'none' AND responded_at IS NULL AND withdrawn_at IS NULL
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

Why ``withdrawn_at IS NULL`` is in the predicate
===============================================

``coord_agent_questions_withdrawn`` has landed: a withdrawn question keeps
``responded_at`` NULL. Without the third conjunct a withdrawn MIRROR row would
stay in this index while its effect stayed open (the gate still pending, the
proposal still queued), and that effect could then never be mirrored again —
a permanent, silent hole in the inbox. The same hazard is spelled out for
``uq_agent_questions_open_alert_episode``. So the predicate excludes withdrawn
rows, and coord's mirror writer WILL use exactly this three-conjunct conflict
target (decided by the implementing session, robustness). That writer ships in
the same plan but is not yet on coord's ``main`` at authoring time — it is an
open, unmerged coord PR — so this is the contract it is written against, not a
description of code that already runs.

The non-unique ``idx_agent_questions_open_effect``
==================================================

``(tenant_id) WHERE responded_at IS NULL AND effect_kind <> 'none'``. It serves
"the open decisions that carry an effect, for this tenant" — the console's chip
counts and coord's reconcile of mirrors against their effects — without walking
the whole pending pile. The concrete query it is shaped for is coord's
operator pending read, ``agent_questions::get_pending`` (``GET
/coord/agent-questions/pending``), in the read tier that PREDATES
``withdrawn_at``: its ``WHERE responded_at IS NULL … AND tenant_id = $4``
narrowed by ``AND effect_kind <> 'none'``. The predicate is ``responded_at IS
NULL`` rather than the post-``withdrawn`` pending predicate so that it serves
that older tier AND the newer one (a query adding ``AND withdrawn_at IS NULL``
still implies this predicate). Leading ``tenant_id`` for
the reason the sibling indices give: coord's pending read filters it
unconditionally, and it is ``NOT NULL`` on this table.

The non-unique ``idx_agent_questions_effect_ref``
=================================================

``(tenant_id, effect_kind, (effect_ref->>'id')) WHERE effect_kind <> 'none'``.
It serves coord's "has this effect been mirrored?" anti-joins — the per-insert
``NOT EXISTS`` its mirror writer runs before asking, and the reconcile backfill
that looks for effects with no mirror at all. Both must see ANSWERED mirrors as
well as open ones (an effect whose mirror was answered has been mirrored), and
the two indices above cover open rows only: each requires ``responded_at IS
NULL``, so neither can serve a probe that may match an answered row.

It does not replace the unique index. That index is a constraint — the
``ON CONFLICT`` arbiter that keeps one OPEN mirror per effect — and its
open-only predicate is what lets answering a mirror free the key. This one is
only an access path over the same key with the open-row conjuncts dropped; it
constrains nothing.

The precedent is the alert-episode pair on this same table:
``uq_agent_questions_open_alert_episode`` (the open-row dedupe arbiter) and
``idx_agent_questions_tenant_alert`` (revision
``agent_questions_alert_id_idx_01``), a plain partial index over the same key
added because coord's alert reads also probe answered rows.

Without it, the per-insert anti-join has no index on the effect key and falls
back to ``idx_agent_questions_tenant_id``, reading the tenant's whole question
history — the ~24k-row pending pile included — once per mirror insert; the
backfill, which runs across tenants, reads the whole table. Answered questions
only accumulate, so both costs only grow. ``effect_kind <> 'none'`` keeps every
ordinary question out, so the index stays the size of the mirror population.

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

All three indices are built ``CONCURRENTLY`` inside ``autocommit_block()``,
exactly as ``uq_agent_questions_open_alert_episode`` is, so no build holds the
SHARE lock that would block the producers' INSERTs. A failed earlier
CONCURRENTLY build leaves an INVALID index that ``IF NOT EXISTS`` would keep,
so each build first drops an INVALID index of its own name. On first
application every row is ``'none'``, so each build indexes nothing; a
CONCURRENTLY build still makes two passes over the table (build, then
validate), both cheap here. A rebuild after an INVALID leftover runs once
mirror rows exist and indexes them.
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

Downgrade drops all three indices, the CHECK and both columns. Nothing is lost
that was not introduced here: every non-``none`` effect is written by the coord
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
    """Add ``effect_kind`` + CHECK + ``effect_ref``, then the three partial indices."""
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
        # At most one OPEN, un-withdrawn mirror row per effect. Coord's mirror
        # writers (an unmerged coord PR at authoring time) will insert with
        # `ON CONFLICT (tenant_id, effect_kind, (effect_ref->>'id')) WHERE
        # effect_kind <> 'none' AND responded_at IS NULL AND withdrawn_at IS
        # NULL DO NOTHING`.
        op.execute(
            """
            CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS
                uq_agent_questions_open_effect
            ON coord.agent_questions (tenant_id, effect_kind, (effect_ref->>'id'))
            WHERE effect_kind <> 'none' AND responded_at IS NULL
                AND withdrawn_at IS NULL
            """
        )
        if _index_is_invalid("idx_agent_questions_effect_ref"):
            op.execute(
                "DROP INDEX CONCURRENTLY IF EXISTS coord.idx_agent_questions_effect_ref"
            )
        # EVERY effect row, answered or not: coord's "does this effect already
        # have a mirror?" anti-joins (the per-insert NOT EXISTS and the reconcile
        # backfill) must see answered mirrors too, and the two indices above
        # cover open rows only.
        op.execute(
            """
            CREATE INDEX CONCURRENTLY IF NOT EXISTS
                idx_agent_questions_effect_ref
            ON coord.agent_questions (tenant_id, effect_kind, (effect_ref->>'id'))
            WHERE effect_kind <> 'none'
            """
        )


def downgrade() -> None:
    """Drop the three indices, the CHECK and both columns. The questions survive."""
    with op.get_context().autocommit_block():
        op.execute(
            "DROP INDEX CONCURRENTLY IF EXISTS coord.idx_agent_questions_effect_ref"
        )
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
