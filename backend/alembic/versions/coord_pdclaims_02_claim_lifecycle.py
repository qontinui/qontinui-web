"""coord.prompt_document_claim_states — add the claim ``lifecycle``

Revision ID: coord_pdclaims_02_claim_lifecycle
Revises: coord_wu_authored_at_02
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

* ``lifecycle``       — ``TEXT NOT NULL DEFAULT 'aspirational'``,
                        CHECK-constrained to the two-value vocabulary for the
                        same reason ``state`` is: a third spelling must not be
                        able to creep in from the writer. The default is
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

                        ⚠️ **On a row this migration backfills it is an UPPER
                        BOUND, not the first confirmation.** The backfill has
                        only ``observed_at`` to work from, and on a
                        current-row-only table ``observed_at`` is the LAST
                        tick, not the first — coord's upsert overwrites it
                        every cycle (``observed_at = EXCLUDED.observed_at``).
                        So for a claim that has been confirmed on every tick
                        for six months, the backfilled ``established_at`` is
                        the most recent tick, not the day it started working.
                        That is the best this table's own contents can
                        support, and ``established_by`` is what tells the two
                        apart: a row stamped with this revision carries an
                        upper bound, a row stamped by coord's observer carries
                        the moment coord actually witnessed the promotion.
* ``established_by``  — ``TEXT NULL``; the actor that recorded the promotion,
                        following the derived-state precedent in
                        ``work_unit_derive_worker.rs`` (every derived state in
                        coord is stamped ``by_actor="coord::derive_worker"``).
                        Coord's observer stamps its own actor here; the
                        backfill below stamps this revision, so a promotion
                        inferred by this migration is distinguishable forever
                        from one coord actually observed.

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
   because ``lifecycle`` is ``NOT NULL``, so it never evaluates to NULL and
   never passes by omission. It catches both halves of the defect: an
   ``established`` row with no promotion date — which would break the §6
   rollup and defeat the auditability this column exists for — and an
   ``aspirational`` row carrying a leftover date from a reverted write.

``established_by`` is deliberately NOT tied to the invariant. An unknown
actor is conceivable (a promotion recorded by a build that predates the
actor stamp); an unknown promotion *time* is not, because a promotion always
happens at a moment.

The backfill, and why this migration HAS one
=============================================
Unlike ``tenant_policies_02_transcript_sync_enabled`` — where the column
DEFAULT alone reaches every existing row and a follow-up ``UPDATE`` would be a
no-op — ``DEFAULT 'aspirational'`` is **wrong for the rows that already
exist**. A row sitting at ``state = 'confirmed'`` right now has, by the
lifecycle's own definition, resolved CONFIRMED at least once: its current
verdict IS that evidence. Leaving it ``aspirational`` would mean a genuine
regression on an already-working claim raises no alert — a silent weakening of
shipped alerting behaviour, which this plan explicitly does not do (§1:
*"alert volume does not change for any spec that exists today"*).

So the ``UPDATE`` below promotes exactly those rows, evidence-first, and
stamps ``established_at`` from the row's own ``observed_at`` rather than from
``now()``, which would assert a promotion time this migration did not witness.
(What ``observed_at`` does and does not mean on this table is the upper-bound
caveat under ``established_at`` above.)

⚠️ **The backfill does NOT close the window, and it is not this migration's
to close.** The exposure is not "until the next observer tick" — it is
**until the coord PR that writes ``lifecycle`` deploys**, which is longer, and
the coord running in the meantime actively widens it. ``UPSERT_CLAIM_SQL``
(``qontinui-coord/crates/coord/src/prompt_document_claims.rs``) inserts with
an explicit column list that does not include ``lifecycle``, so **every claim
that first resolves CONFIRMED during that window lands ``aspirational``** —
confirmed, but unpromoted. If such a claim then regresses before the new
observer re-confirms it, the ``established``-only alerting rule reads it as
backlog and raises nothing on a real regression.

No SQL in this migration can fix that, because the rows do not exist yet when
it runs. **The coord PR must therefore carry a catch-up promote** — the same
predicate as the backfill below (``state = 'confirmed' AND lifecycle =
'aspirational'``), run once at startup before the alerting rule is armed, or
folded into the upsert itself. This is recorded here so the coord PR inherits
it as a requirement rather than discovering it as an incident.

Rows at ``state = 'contradicted'`` or ``'unknown'`` are deliberately NOT
promoted. They may well have been CONFIRMED at some point in the past, but
this table kept no record of it and inventing one would be exactly the
absence-reads-as-evidence failure the plan is about. They stay
``aspirational`` until an observer tick confirms them, which promotes them on
evidence. That is an honest under-count, not a guess.

Per ``production-and-cost`` ``pipeline-deploys-are-not-adhoc-mutation`` the
``UPDATE`` rides the normal migration pipeline and reaches every existing row
without any separate ad-hoc mutation step.

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
``ADD COLUMN IF NOT EXISTS`` / ``DROP COLUMN IF EXISTS``, and the backfill is
itself idempotent: its ``WHERE`` clause excludes rows that are already
promoted, so a second run re-stamps nothing it already stamped. **It does not
follow that a second run is always ``UPDATE 0``**, and the earlier wording here
claimed that: the filter is ``lifecycle = 'aspirational' AND state =
'confirmed'``, so a row that reached ``confirmed`` through coord's own upsert
BETWEEN the two runs is promoted by the second one — measured, ``UPDATE 1``
then ``UPDATE 1``, not ``UPDATE 0``. That behaviour is correct and is in fact
better than the property the docstring used to assert; what is idempotent is
the per-row effect, not the statement's row count. It does **not** re-derive
the same values on
a re-run — it does not touch those rows at all, which is the stronger
property and the one that matters, since ``observed_at`` may have moved on
under it. A re-run against an already-applied database is a no-op.

The single-column ``lifecycle`` CHECK rides the ``IF NOT EXISTS`` guard on
its own column, so it cannot be added twice. The two-column promotion
invariant cannot: it spans ``lifecycle`` and ``established_at``, so it has to
be an ``ADD CONSTRAINT``, which has no ``IF NOT EXISTS`` form. Its
idempotency comes from a ``pg_constraint`` lookup instead — a narrower
question than a blanket ``EXCEPTION WHEN duplicate_object``, which would also
swallow whatever else the statement might have raised.

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

1. **The catch-up promote** described under "The backfill" above. Without it,
   every claim first confirmed between this landing and that deploy stays
   unpromoted and its later regression is silent.
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
down_revision: str | Sequence[str] | None = "coord_wu_authored_at_02"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# The actor stamped into ``established_by`` for rows this migration promotes
# is the literal ``alembic::coord_pdclaims_02_claim_lifecycle``, written
# inline in the UPDATE below so a promotion INFERRED from a current verdict
# stays distinguishable forever from one coord's observer actually witnessed.
#
# It is deliberately NOT a module constant interpolated into the SQL. The
# sibling revisions' f-strings interpolate an object NAME (an index, e.g.
# ``{_IX_DOC}`` in coord_pdclaims_01_claim_states.py), where no parameter form
# exists; this would be a VALUE inside a string literal, which is the form
# that breaks silently the day the constant grows an apostrophe. One fixed
# literal in one place has neither problem, and ruff flags neither, so the
# difference has to be made by hand.


def upgrade() -> None:
    """Add the lifecycle columns, then promote the already-CONFIRMED rows."""
    # ----------------------------------------------------------------
    # 1. The lifecycle itself. Raw SQL rather than op.add_column for the
    #    same reason as the sibling coord.* revisions: the
    #    IF NOT EXISTS guard and the inline CHECK want to be stated
    #    literally, and the CHECK must ride that guard rather than
    #    needing an ADD CONSTRAINT that has no IF NOT EXISTS form.
    # ----------------------------------------------------------------
    op.execute(
        """
        ALTER TABLE coord.prompt_document_claim_states
            ADD COLUMN IF NOT EXISTS lifecycle TEXT NOT NULL
                DEFAULT 'aspirational'
                CONSTRAINT ck_prompt_document_claim_states_lifecycle
                CHECK (lifecycle IN ('aspirational', 'established'))
        """
    )

    # ----------------------------------------------------------------
    # 2. When the one-way promotion happened, and who recorded it.
    #    Separate statements: a single ALTER with three ADD COLUMN
    #    clauses is atomic either way, and one statement per column
    #    keeps each IF NOT EXISTS independently meaningful on a
    #    partially-applied database.
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
    #    Total, because lifecycle is NOT NULL — both sides are plain
    #    booleans, so this never evaluates to NULL and never passes by
    #    omission. It catches both halves: an 'established' row with no
    #    promotion date (which would break the §6 rollup and the
    #    auditability this column exists for) and an 'aspirational' row
    #    carrying a leftover date from a reverted write.
    #
    #    This one spans two columns, so unlike the lifecycle CHECK it
    #    cannot ride an ADD COLUMN IF NOT EXISTS. ADD CONSTRAINT has no
    #    IF NOT EXISTS form, so idempotency comes from the catalog
    #    lookup instead. A plain `EXCEPTION WHEN duplicate_object` would
    #    also work but would abort the surrounding subtransaction on any
    #    OTHER error it happened to catch; asking pg_constraint is the
    #    narrower question.
    #
    #    Added BEFORE the backfill so the backfill is itself validated
    #    by it. Ordering is otherwise free: at this point every row is
    #    ('aspirational', NULL), which satisfies it.
    # ----------------------------------------------------------------
    op.execute(
        """
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1
                  FROM pg_constraint
                 WHERE conname = 'ck_prompt_document_claim_states_established_at'
                   AND conrelid = 'coord.prompt_document_claim_states'::regclass
            ) THEN
                ALTER TABLE coord.prompt_document_claim_states
                    ADD CONSTRAINT ck_prompt_document_claim_states_established_at
                    CHECK ((lifecycle = 'established')
                           = (established_at IS NOT NULL));
            END IF;
        END $$
        """
    )

    # ----------------------------------------------------------------
    # 4. Backfill — see "The backfill, and why this migration HAS one".
    #    A row currently CONFIRMED has, by definition, resolved
    #    CONFIRMED at least once. Its observed_at is the LAST tick
    #    rather than the first, so the established_at written here is
    #    an upper bound — see the established_at entry in the module
    #    docstring. Rows that are contradicted or unknown are left
    #    aspirational on purpose: this table kept no history, so any
    #    promotion for them would be invented rather than observed.
    #
    #    The lifecycle predicate in the WHERE clause makes a re-run a
    #    no-op: it matches nothing the second time, rather than
    #    re-stamping established_at from a moved observed_at.
    # ----------------------------------------------------------------
    op.execute(
        """
        UPDATE coord.prompt_document_claim_states
           SET lifecycle      = 'established',
               established_at = observed_at,
               established_by = 'alembic::coord_pdclaims_02_claim_lifecycle'
         WHERE state = 'confirmed'
           AND lifecycle = 'aspirational'
        """
    )


def downgrade() -> None:
    """Remove the promotion invariant, then the three lifecycle columns.

    ⚠️ **This is LOSSY, and the loss is not symmetric with the upgrade.**
    Dropping ``lifecycle`` / ``established_at`` destroys every promotion coord
    recorded, and a later ``upgrade()`` re-derives promotions only from each
    row's CURRENT verdict. So a claim that coord promoted and that has since
    regressed — ``state = 'contradicted'``, ``lifecycle = 'established'``,
    i.e. exactly the rows that are actively alerting — comes back
    ``aspirational`` and stops alerting, silently. A down/up cycle therefore
    disarms the live regression alerts while leaving the backlog intact, which
    is the precise inversion of what this column is for.

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
    added it, and so a partially-applied upgrade downgrades cleanly whatever
    it managed to create. The single-column ``lifecycle`` CHECK needs no such
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
