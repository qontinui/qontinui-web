"""coord.success_metric_history — one row per executed metric measurement

Revision ID: coord_smhist_01_success_metric_history
Revises: coord_pdclaims_02_claim_lifecycle
Create Date: 2026-09-22

Phase 2 of plan
``qontinui-dev-notes/plans/2026-09-20-nothing-measures-the-product-against-its-declared-intent.md``
(§3, "``success_metric`` becomes probeable, with a typed ``source_query``"),
**schema half only**. The resolver that writes these rows — the ``sql:`` /
``http:`` / ``manual:`` typed-prefix executor and the three-valued target
verdict — is a separate ``qontinui-coord`` PR that cannot be written until
this one lands. See "Deploy ordering" below.

This is also the divergence plan's
(``2026-09-06-domain-spec-divergences-decay-with-no-re-probe``) Phase 4,
written down there and explicitly *"not scheduled"*, now scheduled.
``prompt_document_claims.rs`` already names ``success_metric`` as *"the
natural second"* probed kind; today ``PROBED_KINDS`` contains only
``KIND_DOMAIN_SPEC``, so every metric's *actual* is permanently UNKNOWN and
the authored metrics on this tenant cannot answer whether the thing they
measure is moving.

No table like this exists: ``git grep metric_history`` over qontinui-web
returns nothing.

Why a HISTORY, when the sibling claim table is current-row-only
===============================================================
``coord.prompt_document_claim_states`` is deliberately *"one CURRENT row per
claim, not an oplog"*, because its consumer (the served document read) needs
the latest verdict and nothing older. This table's consumer is the opposite
shape, and it is the same distinction ``coord.memory_anchor_observations``
draws against that same sibling: a metric's whole point is the SERIES. *"Is
this moving, and in which direction"* is unanswerable from a single current
value, and the plan's own §3 says each run **appends**. So: append-only, no
UNIQUE key over the document address, one row per executed measurement.

Retention is not expressed here. Unlike
``coord.gate_progress_samples`` — whose ~2 h prune window is part of its
contract because it fits a rate over a short horizon — a metric series is
meant to outlive a cycle so a baseline stays comparable. If coord later wants
a prune, that is a coord-side policy and a separate migration, not an
unstated assumption in this one.

Columns
=======

* ``tenant_id``       — ``UUID NOT NULL`` carrying **no FK**, the same posture
                        as ``coord.prompt_document_claim_states`` and
                        ``coord.memory_anchor_observations``: observer rows
                        must never block a tenant delete and are pruned by the
                        observer, not by cascade.
* ``kind`` / ``name`` — the document address, the ``coord.prompt_documents``
                        ``(kind, name)`` pair, not an FK to that row's ``id``.
                        ``kind`` is ``'success_metric'`` for every row this
                        resolver writes today and is stored anyway, on
                        purpose: it keeps the address shape byte-identical to
                        the claim table's, so §4's gap door joins the claim
                        half and the metric half on one key rather than on two
                        different ones. It is deliberately **not**
                        CHECK-constrained — ``PROBED_KINDS`` is explicitly an
                        extension point.
* ``metric``          — the document's own ``metric:`` frontmatter field (the
                        human name of the thing measured). Nullable, and
                        denormalised on purpose: it makes a series
                        self-describing if the document is later renamed or
                        deleted, which is exactly when a historical value is
                        most likely to be misread.
* ``value``           — ``DOUBLE PRECISION NULL``; what the query actually
                        returned. NULL **only** when nothing was measured —
                        a ``manual:`` query (never executed), an untyped one
                        (never executed), or a probe that errored.
                        ``ck_success_metric_history_value_present`` makes the
                        half that matters structural — no on/off-target
                        verdict without a value. It does **not** make the
                        converse structural, and deliberately so: an
                        ``unknown`` row may carry a value (the
                        ``no_direction`` case measures fine and only fails to
                        reach a verdict), and refusing that would throw away
                        the most useful thing such a row has. Whether a
                        measurement was *attempted* is carried by
                        ``source_query_type`` and ``detail``, not by the
                        nullability of this column. ``DOUBLE PRECISION`` rather than
                        ``NUMERIC``: these are counts, ratios and durations
                        read by a Rust ``f64``, and exact decimal arithmetic
                        is not a property any consumer here needs — the
                        precedent is ``coord.gate_progress_samples.
                        current_value``, the closest existing coord series.
* ``unit``            — the document's ``unit:`` field, the one OPTIONAL field
                        of the seven. Copied through so a value can be
                        rendered without re-reading the document, and so a
                        unit change is visible in the series instead of
                        silently re-scaling it.
* ``observed_at``     — ``TIMESTAMPTZ NOT NULL DEFAULT now()``; when this
                        measurement was taken. The series clock, and what the
                        read's staleness budget compares against.

The provenance half — what makes a value non-re-attributable
=============================================================

* ``source_query_type``   — ``'sql'`` / ``'http'`` / ``'manual'`` /
                            ``'untyped'`` / ``'absent'``, CHECK-constrained.
                            The typed prefix §3 mandates, recorded as its own
                            column rather than left implicit in the digest.
                            That is what turns *"an untyped legacy
                            ``source_query`` is a visible, countable migration
                            backlog"* into a one-line ``GROUP BY`` instead of
                            a scan that has to re-parse documents. ``absent``
                            is the malformed-document case: a
                            ``success_metric`` carrying no ``source_query``
                            at all, which is not the same fact as one carrying
                            an untyped string.
* ``source_query_digest`` — a hex digest of the ``source_query`` text that
                            produced this value. **This is the load-bearing
                            column of the table.** Without it, editing a
                            document's query silently re-attributes every
                            historical value to the new query, and a series
                            that mixes two definitions of the same metric is
                            worse than no series — it looks like a trend.
                            Nullable **only** for ``source_query_type =
                            'absent'``, and that is enforced
                            (``ck_success_metric_history_digest_present``)
                            rather than left to the writer — the one column
                            the docstring calls load-bearing must not be the
                            one invariant kept by convention. The digest
                            algorithm is coord's to choose and is stored as
                            text so changing it is not a migration; a digest
                            is an identity token here, never a security
                            boundary.

The verdict half — three-valued, never inferred
================================================

* ``target_state``    — ``'on_target'`` / ``'off_target'`` / ``'unknown'``,
                        ``NOT NULL``, CHECK-constrained on the same discipline
                        as ``prompt_document_claim_states.state``: a fourth
                        spelling must not be able to creep in from the writer,
                        and **UNKNOWN must never render as the stronger
                        answer**.
* ``unknown_reason``  — why, when the verdict is ``unknown``. §4 and §6 make
                        the *reason* load-bearing because the reasons route
                        differently — each names a **different remedy and a
                        different owner**:

                        ``manual``               wants a human to go and look
                        ``probe_error``         wants the probe fixed
                        ``untyped_source_query`` wants the document's query
                                                 given a typed prefix
                        ``absent_source_query``  wants the document given a
                                                 query at all
                        ``no_direction``        wants the document given a
                                                 ``direction:``
                        ``no_target``           wants the document given a
                                                 ``target:``

                        Collapsing them into one UNKNOWN is the same defect
                        class as the ``live_row_count`` / ``query_echo``
                        retraction pair in memory search: an answer that
                        cannot say why it is empty.

                        ``no_direction`` and ``no_target`` are a PAIR, and
                        the second is not decoration.
                        ``ck_success_metric_history_verdict_inputs`` makes a
                        document with a ``direction:`` but no ``target:`` a
                        **guaranteed** ``unknown`` row — before that
                        constraint the combination was merely possible; now
                        it is mandatory. A vocabulary with only
                        ``no_direction`` would force that row to claim "no
                        direction" while carrying one, routing §4 to *"give
                        this document a direction"* against a document that
                        already has one. Exactly the ``absent`` mistake below,
                        one column over.

                        ``absent_source_query`` exists because without it the
                        two columns fight each other. ``source_query_type``
                        separates ``absent`` from ``untyped`` precisely
                        because they are different facts — and if the reason
                        vocabulary then has no member for ``absent``, the
                        catch-all below re-collapses it into ``probe_error``,
                        which routes to *"fix the probe"* when the real
                        remedy is *"the document is incomplete"*. §4's routing
                        reads ``unknown_reason``, not ``source_query_type``,
                        so the split has to survive in this column or it does
                        not survive at all.

                        The six values are CHECK-constrained, and the set is
                        deliberately **tight**: those are the six conditions
                        a row in THIS table can be written under. §4's door
                        also serves ``unprobed`` and ``stale``, and neither
                        can occur here — ``unprobed`` means no row exists, and
                        ``stale`` is computed at read time from
                        ``observed_at`` rather than stored. A condition
                        outside the six (an unparseable frontmatter number, a
                        query that ran and returned nothing usable) is written
                        as ``probe_error`` with the specifics in ``detail``;
                        coord must never invent a seventh spelling, because
                        the routing in §4 reads this column. Adding a reason
                        later is one ``ALTER ... DROP CONSTRAINT`` / ``ADD
                        CONSTRAINT`` pair, deliberately not free — which is
                        the argument for getting the set right here rather
                        than later.

                        **Precedence, left to coord deliberately.** A document
                        can be missing more than one thing at once — a
                        ``manual:`` query with no ``direction:``, say. Nothing
                        in this schema picks between the applicable reasons,
                        and that is on purpose: a precedence encoded as a
                        CHECK would reject coord's row at the observer tick
                        rather than at compile time, which is the expensive
                        place to learn it. §3's own wording points at the
                        answer — a ``manual:`` query is *"never executed …
                        always UNKNOWN + ``manual``, and says so"* — so the
                        reason describing why nothing RAN outranks one
                        describing why a value could not be JUDGED. Coord
                        picks; this column only refuses spellings it does not
                        recognise.

The comparison inputs — ``baseline_as_of`` is the one that gets missed
=======================================================================
``baseline``, ``baseline_as_of``, ``target`` and ``direction`` are copied from
the document's frontmatter onto every row, so the verdict this row carries can
be re-derived from the row alone.

That is a guarantee for a row whose verdict is ``on_target`` or
``off_target``, not for every row:
``ck_success_metric_history_verdict_inputs`` makes ``target`` and
``direction`` mandatory exactly there, which is where re-derivability is
claimed. An ``unknown`` row may legitimately be missing any of the four — that
is frequently *why* it is unknown — and its ``unknown_reason`` is what it
carries instead. ``baseline`` and ``baseline_as_of`` stay optional on every
row: they are inputs to *"is it moving"*, not to *"is it on target"*, so
requiring them for a verdict would refuse a metric that is genuinely on target
before anyone set a baseline.

``baseline_as_of`` is called out by name because it is the field a resolver
skips: without it a baseline is a bare number with no date, so "moved 12%
since baseline" is uncheckable and a baseline silently re-dated by a document
edit re-writes history. It is what makes a baseline comparable **at all**.

``direction`` is nullable and free text. Null is the ``no_direction`` case —
a metric with no direction cannot distinguish improvement from regression, so
its verdict resolves ``unknown`` rather than guessing. It is NOT
CHECK-constrained: the vocabulary is coord's, and pinning a guess at it here
would break the writer for no benefit.

* ``detail``          — ``JSONB NOT NULL DEFAULT '{}'::jsonb``; the resolver's
                        finding — the error text for a ``probe_error``, the
                        person and method for a ``manual:`` query, the raw
                        response for an ``http:`` one. Object, not array,
                        because it describes ONE measurement. The ``::jsonb``
                        cast on the default is load-bearing, as it is in every
                        sibling: an untyped ``'{}'`` leaves the literal's type
                        unresolved where a ``jsonb`` one is required.

The eight CHECK constraints, and what each catches
===================================================

One entry per named ``CONSTRAINT`` in the ``CREATE TABLE`` below, in the order
that block declares them, and the count is the count. A reader auditing
constraint coverage reads this list rather than the DDL, so a list that groups
two constraints into one item, quietly omits one, or presents them in a
different order than the DDL sends that reader away with the wrong picture.

1. ``ck_success_metric_history_source_query_type`` — the closed five-value
   prefix vocabulary.
2. ``ck_success_metric_history_digest_present`` — a digest is present **iff**
   the type is not ``absent``. This is the invariant that keeps the
   load-bearing column load-bearing; without it a ``sql`` row with a NULL
   digest is storable, and such a row is a value with no query identity.
3. ``ck_success_metric_history_target_state`` — the closed three-valued
   verdict vocabulary.
4. ``ck_success_metric_history_unknown_reason`` — the reason is present
   **iff** the verdict is ``unknown``, and is one of the six. Written as an
   equality between two booleans, which is total because ``target_state`` is
   ``NOT NULL``. It catches both halves of the defect at once: an ``unknown``
   with no reason (the uninformative UNKNOWN §4 exists to prevent) and an
   ``on_target`` row carrying a stale reason from a previous code path.
5. ``ck_success_metric_history_value_present`` — a row cannot be ``on_target``
   or ``off_target`` without a ``value``. You cannot be on target for a
   measurement that was never taken.
6. ``ck_success_metric_history_verdict_inputs`` — nor without a ``target``
   and a non-empty ``direction``. A verdict reached without the two inputs it
   is computed from was **guessed**, and the plan's rule is that such a
   metric resolves ``unknown`` instead — with ``no_target`` or
   ``no_direction`` naming which input was missing, since they are different
   documents to go and fix.

   The ``direction <> ''`` clause is there because the rest of the constraint
   is a presence test, and an empty string is present. The column's
   *vocabulary* is deliberately coord's (see ``direction`` below), so this
   claims only that the field is non-blank — it cannot and does not claim the
   value is meaningful.
7. ``ck_success_metric_history_reason_matches_type`` — the two
   ``unknown_reason`` values that make a claim ABOUT ``source_query_type``
   must agree with it. ``absent_source_query`` requires
   ``source_query_type = 'absent'`` and ``untyped_source_query`` requires
   ``'untyped'``, so a document that HAS a query cannot be routed to *"give
   this document a query"*, nor one that has none to *"type its query"*.
   Both combinations were storable before this constraint.
8. ``ck_success_metric_history_reason_matches_inputs`` — the same rule for
   the two reasons that name a verdict INPUT rather than the query.
   ``no_target`` requires ``target IS NULL``; ``no_direction`` requires a
   ``direction`` that is NULL or blank. Without it, constraint 6 guarantees
   a ``direction``-without-``target`` row exists and nothing stops it being
   written ``no_direction`` — a row that lies about its own remedy, on the
   column §4 routes on.

7 and 8 together say one thing: **a reason that makes a checkable claim about
another column of its own row must agree with that column.** Four of the six
reasons make such a claim; ``manual`` and ``probe_error`` name no other column,
so there is nothing for them to disagree with and they are left alone.

⚠️ **``manual`` is the one that looks like a counter-example and is not.**
``source_query_type`` has a member spelled ``manual`` too, so the reason reads
at a glance like a claim about that column — it is not. The reason names a
**remedy** ("a human has to go and look"), the type names **how the query is
executed**, and the two are independent: coord may legitimately want a human to
look at an ``http:`` metric. Both spellings are accepted today and should stay
that way.

The trap this closes is the CONVERSE. §3 couples them in one direction only —
a ``manual:`` query is *"never executed … always UNKNOWN + ``manual``"*, i.e.
``type = 'manual'`` ⇒ ``reason = 'manual'`` — and it is easy to read that as
licence to add ``reason = 'manual'`` ⇒ ``type = 'manual'`` to constraint 7.
§3 does not support that, and it would reject rows this schema accepts today.
Do not add it.

Neither is a precedence rule, and the distinction is what makes them safe. A
one-directional implication forbids an **inapplicable** reason; it never picks
between applicable ones. A ``manual:`` metric whose document also lacks a
target stays free to be written ``manual`` **or** ``no_target`` — coord keeps
that judgement, and the "Precedence" paragraph under ``unknown_reason`` above
is what points it at the answer. So these add no new way for coord's row to
be rejected at the observer tick over a call this schema should not be making.

Constraints 5 and 6 are the two halves of one property — "a non-UNKNOWN
verdict was actually computed" — and together they make *never inferred*
structural rather than a convention the resolver is trusted to keep. They are
declared separately, rather than as one conjunction, so a violation names
which half failed.

Note what is deliberately **not** constrained. ``value`` may be present on an
``unknown`` row — that is the ``no_direction`` case, where the measurement
succeeded and only the verdict could not be reached, and losing that value
would throw away the most useful thing the row has. So the value rule is
one-directional by design, and the schema records nothing about whether a
measurement was *attempted*; ``source_query_type`` and ``detail`` carry that.
``baseline`` and ``baseline_as_of`` are likewise unconstrained: a metric can
be on target before anyone has set a baseline, and a baseline is an input to
"is it moving", not to "is it on target".

Index shape is the read's shape
================================
``idx_success_metric_history_metric_observed`` on
``(tenant_id, kind, name, observed_at DESC)`` serves both reads:

* the SERIES for one metric — ``WHERE tenant_id = $1 AND kind = $2 AND
  name = $3 ORDER BY observed_at DESC``;
* the LATEST value per metric for the §6 rollup and §4's gap door —
  ``DISTINCT ON (tenant_id, kind, name) ... ORDER BY tenant_id, kind, name,
  observed_at DESC``.

The ``DESC`` is not decoration. That second query's ORDER BY is ascending on
the three address columns and descending on the clock; an all-ASC index
scanned backwards yields the address columns in DESC order too, which does not
match, so Postgres would sort. Declared DESC, the index matches the ORDER BY
exactly and the rollup is an index scan.

``tenant_id`` leads both the index and the table, as in every sibling, because
every read and write here is tenant-scoped and a leading tenant column is what
keeps one tenant's metric-heavy corpus cheap for every other tenant.

Idempotency
===========
``CREATE TABLE IF NOT EXISTS`` / ``CREATE INDEX IF NOT EXISTS`` /
``DROP ... IF EXISTS`` throughout, so a re-run against an already-applied
database is a no-op. The CHECK constraints are declared inline in the
``CREATE TABLE`` so they ride that guard rather than needing an
``ADD CONSTRAINT`` that has no ``IF NOT EXISTS`` form.

Deploy ordering (load-bearing)
===============================
Per ``production-and-cost`` ``alembic-sole-authorship``: alembic is the sole
author of ``coord.*`` schema, and a coord read of a new ``coord.*`` object
needs its qontinui-web migration to land FIRST — the 2026-07-13 missing-column
incident. This migration lands and deploys **before** the coord PR that reads
this table.

One coord-side decision this migration deliberately does NOT make for its
reader, because the two shipped precedents in this directory go opposite ways
and the choice belongs with the code that reads the table:

* ``coord_pdclaims_01_claim_states`` adds its table to coord's
  ``schema_manifest::ALEMBIC_OWNED_TABLES`` — the boot ``require_table``
  gate — and pairs that with a ``42P01 undefined_table`` degrade
  (``claims_state_source: "table_absent"``, every claim UNKNOWN).
* ``coord_overlap_detections`` is **deliberately not** in that list, precisely
  so coord and the migration may deploy in EITHER order without a boot-gate
  crash-loop, and reads fail-open instead.

Those two are in tension: a table inside the boot gate makes a read-time
degrade unreachable, because coord never boots far enough to perform it.
Whichever the coord PR picks, it must pick ONE — and if it takes the boot-gate
route it inherits this migration as a hard deploy-order dependency rather than
a soft one. Either edit lives in the coord repo and is not made here. What
this migration guarantees is only its own half: the table exists before that
PR merges.

Hand-written rather than autogenerated: ``alembic revision --autogenerate`` is
banned in this repo (served policy ``production-and-cost``
``alembic-sole-authorship``).
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coord_smhist_01_success_metric_history"
down_revision: str | Sequence[str] | None = "coord_pdclaims_02_claim_lifecycle"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Index name, stated once so upgrade and downgrade cannot drift — the same
# convention as coord_pdclaims_01_claim_states.
_IX_METRIC = "idx_success_metric_history_metric_observed"


def upgrade() -> None:
    """Create coord.success_metric_history + its per-metric series index."""
    # The schema exists by this point in the chain; CREATE SCHEMA IF NOT
    # EXISTS is kept for the same collision-safety reason the sibling
    # coord.* revisions keep it.
    op.execute("CREATE SCHEMA IF NOT EXISTS coord")

    # ----------------------------------------------------------------
    # 1. The append-only series. Raw SQL rather than op.create_table for
    #    the same reason as every sibling coord.* revision: the
    #    IF NOT EXISTS guard, the '{}'::jsonb default and the eight
    #    named CHECKs all want to be stated literally.
    # ----------------------------------------------------------------
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.success_metric_history (
            id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id            UUID NOT NULL,
            kind                 TEXT NOT NULL,
            name                 TEXT NOT NULL,
            metric               TEXT NULL,
            value                DOUBLE PRECISION NULL,
            unit                 TEXT NULL,
            observed_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

            source_query_type    TEXT NOT NULL,
            source_query_digest  TEXT NULL,

            target_state         TEXT NOT NULL,
            unknown_reason       TEXT NULL,

            baseline             DOUBLE PRECISION NULL,
            baseline_as_of       TIMESTAMPTZ NULL,
            target               DOUBLE PRECISION NULL,
            direction            TEXT NULL,

            detail               JSONB NOT NULL DEFAULT '{}'::jsonb,

            CONSTRAINT ck_success_metric_history_source_query_type
                CHECK (source_query_type IN
                       ('sql', 'http', 'manual', 'untyped', 'absent')),

            -- A digest is present IFF there was a source_query to
            -- digest. Without this the column the docstring calls
            -- load-bearing is the one invariant left to convention: a
            -- 'sql' row with a NULL digest is a value with no query
            -- identity, indistinguishable in the series from a value
            -- produced by a different query -- the exact silent
            -- re-attribution this table exists to prevent.
            CONSTRAINT ck_success_metric_history_digest_present
                CHECK ((source_query_digest IS NOT NULL)
                       = (source_query_type <> 'absent')),

            CONSTRAINT ck_success_metric_history_target_state
                CHECK (target_state IN
                       ('on_target', 'off_target', 'unknown')),

            -- A reason is present IFF the verdict is unknown. Total,
            -- because target_state is NOT NULL: both sides are plain
            -- booleans, so this never evaluates to NULL and never
            -- passes by omission.
            CONSTRAINT ck_success_metric_history_unknown_reason
                CHECK ((target_state = 'unknown') = (unknown_reason IS NOT NULL)
                       AND (unknown_reason IS NULL
                            OR unknown_reason IN ('manual',
                                                  'untyped_source_query',
                                                  'absent_source_query',
                                                  'probe_error',
                                                  'no_direction',
                                                  'no_target'))),

            -- You cannot be on or off target for a measurement that was
            -- never taken.
            CONSTRAINT ck_success_metric_history_value_present
                CHECK (target_state = 'unknown' OR value IS NOT NULL),

            -- Nor without the two inputs the comparison is made from.
            -- A verdict reached with no target, or with no direction to
            -- read the target against, was GUESSED -- and the plan's
            -- rule is that it must resolve unknown instead, carrying
            -- no_target or no_direction to say which one was missing.
            --
            -- btrim(direction) <> '' because the rest of this is a
            -- presence test and a blank string is present. It stays
            -- total on a NULL direction: `direction IS NOT NULL` is
            -- already FALSE there, and FALSE AND NULL is FALSE, never
            -- NULL. The column's VOCABULARY is deliberately coord's, so
            -- this claims non-blank and nothing more.
            --
            -- btrim, not `<> ''`: a WHITESPACE-ONLY direction is a
            -- direction nobody can read, so it must be treated exactly
            -- as an empty one. With the bare `<> ''` test this clause
            -- ACCEPTED `direction = '   '` beside an on_target verdict
            -- (a verdict derived from a direction no reader can
            -- interpret) while constraint 8 REJECTED the honest
            -- no_direction row for the same value -- so the schema
            -- refused the correct row and admitted the guess. Both
            -- sides are btrim'd, and they must stay symmetric.
            CONSTRAINT ck_success_metric_history_verdict_inputs
                CHECK (target_state = 'unknown'
                       OR (target IS NOT NULL
                           AND direction IS NOT NULL
                           AND btrim(direction) <> '')),

            -- A reason that names source_query_type must agree with it,
            -- so a document that HAS a query can never be routed to
            -- "give this document a query", nor one that has none to
            -- "type its query". IS DISTINCT FROM keeps each arm total
            -- across a NULL reason.
            CONSTRAINT ck_success_metric_history_reason_matches_type
                CHECK ((unknown_reason IS DISTINCT FROM 'absent_source_query'
                        OR source_query_type = 'absent')
                       AND (unknown_reason IS DISTINCT FROM 'untyped_source_query'
                            OR source_query_type = 'untyped')),

            -- And a reason that names one of the verdict INPUTS must
            -- agree with that column: 'no_target' on a row carrying a
            -- target, or 'no_direction' on one carrying a direction, is
            -- a row that lies about its own remedy -- and it is the
            -- remedy §4 routes on.
            --
            -- This is a one-directional implication, NOT a precedence
            -- rule: it forbids an INAPPLICABLE reason, it never picks
            -- between applicable ones. A 'manual:' metric that also
            -- lacks a target stays free to be either 'manual' or
            -- 'no_target' -- coord keeps that judgement, which is the
            -- one this schema deliberately does not make (see
            -- "Precedence" in the module docstring).
            --
            -- 'manual' and 'probe_error' are absent from this list
            -- because they name no other column, so there is nothing to
            -- disagree with.
            CONSTRAINT ck_success_metric_history_reason_matches_inputs
                CHECK ((unknown_reason IS DISTINCT FROM 'no_target'
                        OR target IS NULL)
                       AND (unknown_reason IS DISTINCT FROM 'no_direction'
                            OR direction IS NULL
                            OR btrim(direction) = ''))
        )
        """
    )

    # ----------------------------------------------------------------
    # 2. The series read and the latest-per-metric rollup read, both.
    #    The DESC on observed_at is load-bearing for the second one —
    #    see "Index shape is the read's shape" in the module docstring.
    # ----------------------------------------------------------------
    op.execute(
        f"""
        CREATE INDEX IF NOT EXISTS {_IX_METRIC}
            ON coord.success_metric_history
               (tenant_id, kind, name, observed_at DESC)
        """
    )


def downgrade() -> None:
    """Reverse: drop the index, then the table.

    ``DROP TABLE`` would take the index and the CHECK constraints with it,
    but the index is dropped explicitly first for symmetry with its explicit
    CREATE — and so a partially-applied upgrade downgrades cleanly either
    way. The index name is schema-qualified: an index lives in its table's
    schema, and ``DROP INDEX`` does not resolve through ``search_path`` the
    way the table reference does. Nothing references this table, so a plain
    ``DROP TABLE`` suffices.
    """
    op.execute(f"DROP INDEX IF EXISTS coord.{_IX_METRIC}")
    op.execute("DROP TABLE IF EXISTS coord.success_metric_history")
