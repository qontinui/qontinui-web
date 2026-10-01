"""coord.prompt_document_claim_states — add the claim ``lifecycle``

Revision ID: coord_pdclaims_02_claim_lifecycle
Revises: overlord_01_interventions
Create Date: 2026-09-22

Phase 1 of plan
``qontinui-dev-notes/plans/2026-09-20-nothing-measures-the-product-against-its-declared-intent.md``
(§1, "A claim's lifecycle is separate from its verdict"), **schema half only**.
The coord code that reads these columns — the one-way promotion in the anchor
observer and the ``established``-only alerting key — is a separate
``qontinui-coord`` PR that cannot be written until this one lands. See
"Deploy ordering" below.

Why a column and not a derivation
==================================
``coord_pdclaims_01_claim_states`` is explicit that this table holds
*"one CURRENT row per claim, not an oplog"* — the observer UPSERTs on
``UNIQUE (tenant_id, kind, name, claim_id)`` and nothing older survives. So
*"has this claim ever resolved CONFIRMED?"* cannot be recovered from this
table's own history, because it keeps none. It has to be stored.

What the lifecycle is for
=========================
Today a claim has a verdict and nothing else, so ``state = 'contradicted'``
means two incompatible things and the engine cannot tell them apart:

======================  ============================  =========================
``lifecycle``           meaning                       CONTRADICTED then means
======================  ============================  =========================
``aspirational``        has never resolved CONFIRMED  **not built yet** — this
                                                      is backlog, and it must
                                                      raise no alert
``established``         has resolved CONFIRMED at     **regression** — it
                        least once                    worked and stopped, so
                                                      it alerts exactly as
                                                      today
======================  ============================  =========================

That distinction is what lets the shipped claim engine be pointed at a *goal*
rather than only at an already-built subsystem. A derived goal spec resolves
CONTRADICTED on day one — correctly, because the thing is not built — and
without this column every such claim would fire
``AlertKind::PromptDocumentClaimContradicted`` and turn a backlog into an
alert storm.

Why promotion is ONE-WAY, when the neighbouring engine deliberately demotes
===========================================================================
``work_unit_derive_worker.rs`` is total-not-monotonic: it *withdraws*
``shipped`` when the predicate stops holding, because *"is this shipped"* is a
question about the present. Lifecycle is not a question about the present. It
records whether a behaviour has **ever** demonstrably worked, which is a
historical fact and cannot become false. So the first CONFIRMED promotes
``aspirational`` → ``established`` permanently, and nothing ever demotes it.

The VERDICT still demotes — that demotion is precisely the regression signal.
Collapsing the two is what makes an unbuilt goal indistinguishable from a
broken feature, which is the defect this column exists to remove.

Nothing but coord's observer writes these columns, so the lifecycle cannot be
gamed by editing a document: promotion is evidence-driven, produced by an
anchor resolver that never read the author's reasoning.

**One-wayness is a WRITER property, not a schema-enforced one — stated
plainly so nobody reads the paragraphs above as a guarantee the database
makes.** ``UPDATE ... SET lifecycle = 'aspirational', established_at = NULL``
on an established row is accepted by these constraints; what the invariant
below guards is the *pairing* of the two columns, never the *direction* of
the transition. Making the direction structural would need a trigger, and a
behavioural object in ``coord.*`` authored from alembic is a larger move than
this migration should make unilaterally — coord owns the writer, coord is the
only writer, and that is where the plan locates the guarantee. If the
property is ever wanted in the database rather than in the writer, that is a
deliberate follow-up with its own reversibility story, not a line to slip in
here.

⛔ **And the unguarded shape named above is the WRONG one. Nothing issues that
``UPDATE``. The path that actually demotes an established row is
DELETE-then-reinsert, and it is shipped and runs every tick** (found by
independent review 2026-09-22, reproduced against PostgreSQL 16):

    -- qontinui-coord/crates/coord/src/prompt_document_claims.rs:470
    const PRUNE_CLAIMS_SQL: &str = "DELETE FROM coord.prompt_document_claim_states \\
     WHERE tenant_id = $1 AND kind = $2 AND name = $3 AND claim_id <> ALL($4)";

It runs FIRST, on every tick, unconditionally — including with an empty id
list, which ``persist_claim_states`` does deliberately (``:488-492``). So a
document edit that renames a claim id, a frontmatter typo, or one short claim
list from an exhausted GitHub fetch budget deletes the row; the next tick
re-inserts it at the ``aspirational`` default. Reproduced end state for a row
that was ``(state=contradicted, lifecycle=established)`` — an ACTIVELY ALERTING
regression::

    claim_id |    state     |  lifecycle   | established_by
    c1       | contradicted | aspirational |

Under the ``established``-only alerting rule this column exists to enable, that
silently reclassifies a live regression as backlog and raises nothing. It is
the same loss ``downgrade()`` warns about, except in STEADY-STATE operation
with no downgrade involved.

**This is a THIRD requirement the coord PR inherits** (see "Deploy ordering"),
and it cannot be fixed in SQL here. Candidate remedies, all coord-side:
exclude ``lifecycle = 'established'`` rows from the prune; make the prune a
soft ``retired_at`` stamp; or re-assert the pair from a pre-delete read.

Columns
=======

* ``lifecycle``       — ``TEXT DEFAULT 'aspirational'``, CHECK-constrained
                        to NON-NULL and to the two-value vocabulary for the
                        same reason ``state`` is: a third spelling must not be
                        able to creep in from the writer. Non-NULL is a CHECK
                        rather than a catalog ``NOT NULL`` because coord's
                        migration classifier rejects ``ADD COLUMN … NOT
                        NULL``; the CHECK refuses exactly the same writes. The default is
                        ``aspirational`` because "has never resolved CONFIRMED"
                        is exactly the state of a claim nothing has observed
                        yet, and UNKNOWN must never render as the stronger
                        answer (``verification-and-evidence``
                        ``unknown-must-not-render-as-a-default``).
* ``established_at``  — ``TIMESTAMPTZ NULL``; when the promotion was
                        recorded. NULL iff the claim is still
                        ``aspirational``. This is what makes the promotion
                        auditable rather than merely asserted — roughly *when*
                        a behaviour first demonstrably worked, which is the
                        fact a rollup and a regression post-mortem both need.

                        ⚠️ **On a row the catch-up promote backfills it is an
                        UPPER BOUND, not the first confirmation.** That
                        backfill has
                        only ``observed_at`` to work from, and on a
                        current-row-only table ``observed_at`` is the LAST
                        tick, not the first — coord's upsert overwrites it
                        every cycle (``observed_at = EXCLUDED.observed_at``).
                        So for a claim that has been confirmed on every tick
                        for six months, the backfilled ``established_at`` is
                        the most recent tick, not the day it started working.
                        That is the best this table's own contents can
                        support, and ``established_by`` is what tells the two
                        apart: the catch-up promote must stamp an actor of its
                        own, distinct from the observer's, so an inferred
                        upper bound is never confused with a witnessed
                        promotion.
* ``established_by``  — ``TEXT NULL``; the actor that recorded the promotion,
                        following the derived-state precedent in
                        ``work_unit_derive_worker.rs`` (every derived state in
                        coord is stamped ``by_actor="coord::derive_worker"``).
                        Coord's observer stamps its own actor here; the
                        catch-up promote stamps a different one, so an
                        inferred promotion is distinguishable forever from
                        one coord actually observed.

The two nullable columns are a deliberate pair rather than a JSONB blob:
``established_at`` is a rollup denominator ("claims CONFIRMED and fresh" in
§6) and wants to stay cheaply comparable, not buried behind a ``->>`` cast.

Two CHECK constraints, and what each catches
=============================================

1. ``ck_prompt_document_claim_states_lifecycle`` — the closed two-value
   vocabulary, the same discipline ``state`` already has on this table: a
   third spelling must not be able to creep in from the writer.
2. ``ck_prompt_document_claim_states_established_at`` — the promotion
   invariant, ``lifecycle = 'established'`` **iff** ``established_at IS NOT
   NULL``. Written as an equality between two booleans, which is total
   because constraint 1 makes ``lifecycle`` non-NULL, so it never evaluates
   to NULL and
   never passes by omission. It catches both halves of the defect: an
   ``established`` row with no promotion date — which would break the §6
   rollup and defeat the auditability this column exists for — and an
   ``aspirational`` row carrying a leftover date from a reverted write.

``established_by`` is deliberately NOT tied to the invariant. An unknown
actor is conceivable (a promotion recorded by a build that predates the
actor stamp); an unknown promotion *time* is not, because a promotion always
happens at a moment.

The backfill, and why it is NOT in this migration
==================================================
``DEFAULT 'aspirational'`` is **wrong for the rows that already exist**. A row
sitting at ``state = 'confirmed'`` right now has, by the lifecycle's own
definition, resolved CONFIRMED at least once: its current verdict IS that
evidence. Leaving it ``aspirational`` once the ``established``-only alerting
rule is armed would mean a genuine regression on an already-working claim
raises no alert — a silent weakening of shipped alerting behaviour, which this
plan explicitly does not do (§1: *"alert volume does not change for any spec
that exists today"*).

The first form of this revision promoted those rows with an ``UPDATE``. It is
REMOVED, because coord's merge-train migration classifier
(``qontinui-coord/crates/coord/src/pr_merge/migration_classifier.rs``)
rejects every DML statement on the upgrade path, and this PR must land without
an operator override. Removing it loses nothing, for a reason that is
structural rather than hopeful:

* **Nothing reads ``lifecycle`` until the coord PR deploys.** The column is
  inert before then, so an unpromoted row before then is not yet a defect.
* **That coord PR must ALREADY carry a catch-up promote** (requirement 1 under
  "Deploy ordering"), with exactly the predicate the removed ``UPDATE`` used —
  ``state = 'confirmed' AND lifecycle = 'aspirational'`` — run once before the
  alerting rule is armed. Because the coord in the meantime inserts every newly
  confirmed claim at the ``aspirational`` default (``UPSERT_CLAIM_SQL`` does
  not name ``lifecycle``), that catch-up was required regardless of any
  migration backfill, and it is a superset of it: it reaches the rows that
  existed when this migration ran AND the ones confirmed afterwards.

So the coord PR's catch-up promote is now the ONLY backfill, and it must:
stamp ``established_at`` from the row's own ``observed_at`` (never ``now()``,
which would assert a promotion time nobody witnessed — and see the
upper-bound caveat under ``established_at``), assign ``lifecycle`` and
``established_at`` in one statement (requirement 2), and stamp an
``established_by`` actor distinct from the observer's.

Rows at ``state = 'contradicted'`` or ``'unknown'`` must NOT be promoted by it.
They may well have been CONFIRMED at some point in the past, but this table
kept no record of it and inventing one would be exactly the
absence-reads-as-evidence failure the plan is about. They stay
``aspirational`` until an observer tick confirms them, which promotes them on
evidence. That is an honest under-count, not a guess.

Why no new index
================
The two reads that touch these columns are already covered.
``idx_prompt_document_claim_states_doc`` on ``(tenant_id, kind, name)`` serves
the per-document rollup in §6 (count by ``state`` × ``lifecycle`` for one
document), and the alerting path reads ``lifecycle`` off the row it has
already fetched by the UNIQUE key. A per-tenant ``(tenant_id, state,
lifecycle)`` index would serve the project-level sum, but on this tenant's
whole claim corpus — tens of rows across four authored ``domain_spec``
documents — it would be pure cost. Add it when a measurement says so, not
before.

Idempotency
===========
``ADD COLUMN IF NOT EXISTS`` / ``DROP COLUMN IF EXISTS`` for the three
columns, and the single-column ``lifecycle`` CHECK rides its column's guard,
so it cannot be added twice.

The two-column promotion invariant cannot ride a column: it is an ``ADD
CONSTRAINT``, which has no ``IF NOT EXISTS`` form. The first form of this
revision guarded it with a ``DO $$`` block over ``pg_constraint``; coord's
migration classifier admits no ``DO`` block, so it is now a bare
``ADD CONSTRAINT … NOT VALID``. That costs idempotency only in a state that
cannot arise: this revision contains no ``autocommit_block`` and its version
stamp lands inside the same transaction as its DDL (the next revision,
``coord_smhist_01``, commits only after that), so it is never partially
applied, and ``downgrade()`` drops the constraint. A re-run
over a database that somehow has it fails LOUDLY on ``DuplicateObject`` rather
than silently.

``NOT VALID`` skips only the validation scan of existing rows, and at this
point every existing row is ``('aspirational', NULL)``, which satisfies the
invariant — so nothing is left unchecked. Every write from here on is checked
exactly as by a validated constraint. ``pg_constraint.convalidated`` reads
``false``; nothing reads that flag.

Deploy ordering (load-bearing)
===============================
Per ``production-and-cost`` ``alembic-sole-authorship``: alembic is the sole
author of ``coord.*`` schema, and a coord read of a new ``coord.*`` column
needs its qontinui-web migration to land FIRST — the 2026-07-13 missing-column
incident. This migration therefore lands and deploys **before** the coord PR
that reads ``lifecycle``. That coord PR should carry a targeted
missing-column degrade of its own (``pg_error::is_missing_column_error``,
the posture ``coord_pdclaims_01`` already takes for a missing TABLE) so a
coord deploy racing ahead degrades rather than fails — that is a coord-side
concern and is not made here.

Two requirements this migration hands the coord PR, both cheaper to read here
than to discover at runtime:

1. **The catch-up promote** described under "The backfill" above — now the
   ONLY backfill. Without it, every claim already confirmed when this lands,
   and every claim first confirmed between this landing and that deploy,
   stays unpromoted and its later regression is silent.
2. **``lifecycle`` and ``established_at`` must be written in the SAME
   statement.** The promotion invariant spans both columns, so an
   ``ON CONFLICT DO UPDATE SET lifecycle = CASE WHEN ... THEN 'established'
   ... END`` that does not also assign ``established_at`` is REJECTED by
   ``ck_prompt_document_claim_states_established_at`` — and it would be
   rejected on the observer tick, not at compile time. Assign the pair
   together, or not at all.

Hand-written rather than autogenerated: ``alembic revision --autogenerate`` is
banned in this repo (served policy ``production-and-cost``
``alembic-sole-authorship``).
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coord_pdclaims_02_claim_lifecycle"
down_revision: str | Sequence[str] | None = "overlord_01_interventions"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add the lifecycle columns and the promotion invariant. No backfill."""
    # ----------------------------------------------------------------
    # 1. The lifecycle itself. Raw SQL rather than op.add_column for the
    #    same reason as the sibling coord.* revisions: the
    #    IF NOT EXISTS guard and the inline CHECK want to be stated
    #    literally, and the CHECK must ride that guard rather than
    #    needing an ADD CONSTRAINT that has no IF NOT EXISTS form.
    #    Non-NULL is enforced by the CHECK, not a catalog NOT NULL,
    #    which coord's migration classifier rejects (module docstring).
    # ----------------------------------------------------------------
    op.execute(
        """
        ALTER TABLE coord.prompt_document_claim_states
            ADD COLUMN IF NOT EXISTS lifecycle TEXT
                DEFAULT 'aspirational'
                CONSTRAINT ck_prompt_document_claim_states_lifecycle
                CHECK (lifecycle IS NOT NULL
                       AND lifecycle IN ('aspirational', 'established'))
        """
    )

    # ----------------------------------------------------------------
    # 2. When the one-way promotion happened, and who recorded it.
    #    Separate statements: one statement per column keeps each
    #    IF NOT EXISTS independently meaningful.
    # ----------------------------------------------------------------
    op.execute(
        """
        ALTER TABLE coord.prompt_document_claim_states
            ADD COLUMN IF NOT EXISTS established_at TIMESTAMPTZ NULL
        """
    )
    op.execute(
        """
        ALTER TABLE coord.prompt_document_claim_states
            ADD COLUMN IF NOT EXISTS established_by TEXT NULL
        """
    )

    # ----------------------------------------------------------------
    # 3. The promotion invariant, enforced rather than trusted:
    #    lifecycle = 'established'  IFF  established_at IS NOT NULL.
    #
    #    Total, because step 1's CHECK makes lifecycle non-NULL — both
    #    sides are plain booleans, so this never evaluates to NULL and
    #    never passes by omission.
    #
    #    NOT VALID skips only the scan of existing rows, every one of
    #    which is ('aspirational', NULL) here and so satisfies it. No
    #    DO-block idempotency guard: coord's classifier admits none, and
    #    the revision is never partially applied (module docstring).
    # ----------------------------------------------------------------
    op.execute(
        """
        ALTER TABLE coord.prompt_document_claim_states
            ADD CONSTRAINT ck_prompt_document_claim_states_established_at
            CHECK ((lifecycle = 'established')
                   = (established_at IS NOT NULL)) NOT VALID
        """
    )

    # No backfill here: coord's catch-up promote is the only one — see
    # "The backfill, and why it is NOT in this migration".


def downgrade() -> None:
    """Remove the promotion invariant, then the three lifecycle columns.

    ⚠️ **This is LOSSY, and the loss is not symmetric with the upgrade.**
    Dropping ``lifecycle`` / ``established_at`` destroys every promotion coord
    recorded, and a later ``upgrade()`` re-derives NOTHING: every row comes
    back ``aspirational``, including rows currently ``confirmed``, until
    coord's catch-up promote runs — and that re-derives promotions only from
    each row's CURRENT verdict. So a claim that coord promoted and that has
    since regressed — ``state = 'contradicted'``, ``lifecycle =
    'established'``, i.e. exactly the rows that are actively alerting — comes
    back ``aspirational`` and stops alerting, silently. A down/up cycle
    therefore disarms the live regression alerts while leaving the backlog
    intact, which is the precise inversion of what this column is for.

    That is unavoidable here: the promotion is a historical fact this table
    keeps nowhere else, so once the column is gone there is nothing to restore
    it from. It is recorded rather than fixed, because the honest remedy is
    not to roll this migration back on a database coord has been writing to.
    ``migration-reversal.yml`` proves up -> down -> up *runs*; it does not and
    cannot check this.

    ``DROP COLUMN`` already takes with it every constraint that depends on
    the column, so the explicit ``DROP CONSTRAINT`` below is belt-and-braces
    rather than load-bearing — it is here so the two-column invariant is
    reversed by a statement of its own, symmetric with the statement that
    added it. The single-column ``lifecycle`` CHECK needs no such
    statement: it rides its own column.

    Columns are dropped in reverse order of addition for symmetry; nothing
    depends on the order.
    """
    op.execute(
        """
        ALTER TABLE coord.prompt_document_claim_states
            DROP CONSTRAINT IF EXISTS
                ck_prompt_document_claim_states_established_at
        """
    )
    op.execute(
        """
        ALTER TABLE coord.prompt_document_claim_states
            DROP COLUMN IF EXISTS established_by
        """
    )
    op.execute(
        """
        ALTER TABLE coord.prompt_document_claim_states
            DROP COLUMN IF EXISTS established_at
        """
    )
    op.execute(
        """
        ALTER TABLE coord.prompt_document_claim_states
            DROP COLUMN IF EXISTS lifecycle
        """
    )
