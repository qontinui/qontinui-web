"""pdtier_03 - drop `agent_writable`, reconciling instead of re-backfilling.

Drops ``agent_writable`` from ``coord.prompt_documents`` and
``coord.prompt_document_versions``, closing the shim ``pdtier_02`` opened.

Plan: ``2026-08-29-pdtier-03-drop-agent-writable-after-deploy``.


The deploy gate this revision rests on - MEASURED, not assumed
==============================================================

``pdtier_01`` dropped this column while the deployed coord build still read it,
and every agent policy write in the fleet failed closed within minutes.
``pdtier_02`` restored it as an explicitly short-lived shim and wrote the rule
this revision had to satisfy first:

    An ADD lands before its consumer. A DROP lands after its last reader is
    gone - and "gone" means DEPLOYED, not merged.

Evidence recorded at authoring time (2026-08-31):

* Production coord reported ``build_sha aa140cc15a146538fda99d25ac19cf4925d7fef9``,
  built ``2026-08-30T19:20:21Z`` (``GET https://coord.qontinui.io/health``).
* The tier consumer - ``44da411a`` "feat(prompt-documents): three-state agent
  authorship tier resolver" - is an ANCESTOR of that deployed commit, so the
  build that is live reads ``agent_write_tier``.
* At that exact deployed commit ``agent_writable`` appears 44 times across six
  files in ``crates/coord/src`` and **not once in SQL**: DTO fields, doc
  comments, the derived ``AgentWriteTier::legacy_bool`` projection, the legacy
  PATCH input, and test fixtures. The whole read surface was enumerated, not
  spot-checked.

The legacy API field survives this drop untouched: coord projects
``agent_writable`` from the tier on read and accepts it as ``TierWrite::Legacy``
on write, so the console keeps working with no client change.


Why this is NOT `pdtier_02`'s prescribed re-backfill
====================================================

``pdtier_02``'s docstring instructed ``pdtier_03`` to re-backfill the tier from
the boolean before dropping::

    UPDATE coord.prompt_documents
       SET agent_write_tier = CASE WHEN agent_writable THEN 'allow' ELSE 'deny' END
     WHERE agent_writable IS NOT NULL

That was correct **for the world it was written in**, where the deployed build
wrote only the boolean and the tier went stale. It is wrong now, and running it
today would be data loss: once the tier build is deployed the deployed build
writes only the TIER, so the boolean is the stale column. That blanket ``UPDATE``
would revert every authority decision made since the deploy, and would collapse
every ``allow_with_notification`` - a value the boolean cannot even express -
down to ``deny``.

So this revision narrows it. The four classes below exhaust the state space,
and each gets the only disposition that cannot lose information.

===== ================================================= ======================
Class Predicate                                         Disposition
===== ================================================= ======================
A     compatible (incl. the NULL/NULL pair, and BOTH     drop is lossless;
      ('allow_with_notification', FALSE) and             no action
      ('allow_with_notification', TRUE) - see below)
B     tier IS NULL AND boolean IS NOT NULL               backfill the tier
                                                        from the boolean
C     both set and CONTRADICTORY, which is exactly       REFUSE - see below
      ('allow', FALSE) and ('deny', TRUE)
D     tier IS NOT NULL AND boolean IS NULL               no action
===== ================================================= ======================

**``allow_with_notification`` is compatible with EITHER boolean, and that is not
a concession - it is the only reading that does not abort a production deploy.**
The two authorities project it differently, both deliberately:

* ``pdtier_02``'s backfill wrote ``agent_writable = (agent_write_tier = 'allow')``,
  so it put ``FALSE`` on those rows.
* coord's live ``AgentWriteTier::legacy_bool()`` is ``permits_write()``, i.e.
  ``!matches!(self, Deny)``, so it reports ``TRUE`` - documented there as "a
  client reading the old boolean is asking 'may an agent write this', and the
  answer is yes".

Both pairs therefore occur in production by design, and the ``TRUE`` one is not
exotic: a legacy client reads ``agent_writable: true`` off such a document and
PATCHes it straight back, which coord's ``TierWrite::Legacy(true)`` arm preserves
as ``allow_with_notification`` rather than widening to ``allow``. Treating that
as a two-opinion conflict would refuse on a state coord builds on purpose - and
since alembic wraps the whole run in ONE transaction, that refusal rolls back
every pending revision in the deploy.

Class B is information-preserving by construction: it writes only where there is
no tier to overwrite. It stays in the migration - not merely in the plan's
out-of-band reconciliation - so the revision remains correct if it is ever
replayed against a database that skipped that step: a fresh environment, or a
restored backup.

**Class C refuses rather than guessing.** Two columns disagree, one write each,
and the migration cannot know which was later. ``updated_at`` cannot arbitrate -
it is bumped by any PATCH including a body-only edit - and baking a version-log
join into DDL would put a silent, irreversible judgement call inside a
migration. The plan resolves Class C out of band, through coord's own PATCH
door, so the resolution lands as an attributable operator decision with a
version snapshot; this ``RAISE EXCEPTION`` is the net that proves it happened.
It names the class, the offending keys, and the remediation door.

Hand-authored; never ``alembic revision --autogenerate`` (served policy
``production-and-cost`` ``alembic-sole-authorship``).
"""

from collections.abc import Sequence

from alembic import op

revision: str = "pdtier_03"
# `fleet_res_tel_05_socket_census` is an UNLANDED sibling (qontinui-web #1216),
# NOT a chain head - the one thing about this line a later reader must not
# mistake for the usual "the single head at authoring time".
#
# It used to be exactly that. `coordtouch_01` was the head measured on
# 2026-08-31, and by 2026-09-05 it was four revisions stale. On 2026-09-05 at
# 16:05Z `main` landed `coord_agent_questions_audience_backfill`, forking SIX
# open PRs that carried a revision. Alembic's single-head invariant is a TOTAL
# ORDER, so re-pointing all six at the live head does not fix it - they re-fork
# the instant the first lands. They were chained in a stated landing order:
#
#   #1210 -> #1218 -> #989 -> #1269 -> #1216 -> #1180 (this PR)
#
# This PR is LAST because it is a DRAFT and cannot land, so nothing may wait on
# it. Until the five ahead of it land, `alembic-heads-pr` here is RED BY
# CONSTRUCTION - the parent named exists in no tree yet - and it goes green on
# its own, with no further edit, as they land. That red is the safety property:
# it is what stops an out-of-order land leaving `main` with a dangling
# `down_revision`. Do NOT "fix" it by re-pointing at the live head; that
# dissolves the chain and restores the six-way fork.
#
# A re-point here is THREE edits, not one: this assignment, this comment, and
# `_PARENT_REVISION_ID` in `backend/tests/test_pdtier_03_drop_agent_writable_migration.py`,
# whose first test asserts the two agree.
down_revision: str | Sequence[str] | None = "fleet_res_tel_05_socket_census"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


# Both tables, from one list - `pdaw_01` put the boolean on the parent AND the
# version snapshot, so both carry it and both lose it here.
_TABLES = ("coord.prompt_documents", "coord.prompt_document_versions")

_LEGACY_COLUMN = "agent_writable"
_TIER_COLUMN = "agent_write_tier"

# `pdaw_01`'s comment bodies, restored by `downgrade()` with the column so the
# catalog reads the same as it did before this revision took them with the DROP.
# Byte-identical to `pdtier_02._COMMENTS` on purpose: this downgrade IS that
# revision's upgrade.
_COMMENTS = {
    "coord.prompt_documents": (
        "Operator-controlled per-document agent write access. NULL = no operator "
        "opinion (the compile-time default decides)."
    ),
    "coord.prompt_document_versions": (
        "Snapshot of the parent agent_writable at the time this version was written."
    ),
}

# How to name an offending row in the Class C refusal, per table. The parent is
# keyed by its unique (tenant_id, kind, name); the snapshot has no such tuple, so
# it is named by the FK plus the version number, which is its own uniqueness.
#
# Every non-text column is cast EXPLICITLY. Postgres has no `uuid || text`
# operator (nor `integer || text`), so an un-cast concatenation here would
# fail at runtime with 42883 - inside the very error path that exists to explain
# a refusal, which is the worst possible place to learn about it.
_ROW_KEY = {
    "coord.prompt_documents": "tenant_id::text || '/' || kind || '/' || name",
    "coord.prompt_document_versions": (
        "document_id::text || '#v' || version_number::text"
    ),
}

# What to tell the operator to DO about a Class C row, per table. These differ,
# and a single message would be wrong on one of them.
#
# The parent has an attributable door; the snapshot does not. Version rows are
# immutable history — a PATCH appends a NEW snapshot, it cannot rewrite an
# existing one — so the only way to reconcile a historical row is a direct
# UPDATE of the tier.
#
# And say the quiet part on BOTH: coord carries no SQL write of `agent_writable`
# (that is the same fact this revision's deploy gate rests on), so a PATCH moves
# the TIER only and leaves the boolean exactly where it was. An operator who
# PATCHes to the value they believe correct, without knowing that, gets a row
# that is still Class C and a migration that refuses forever.
_REMEDY = {
    "coord.prompt_documents": (
        "Resolve each row through coord: PATCH "
        "/coord/prompt-documents/<kind>/<name> carrying agent_write_tier, so the "
        "resolution lands attributably with a version snapshot. NOTE: coord "
        "writes no agent_writable, so a PATCH moves the TIER only and the stale "
        "boolean stays put - the row clears this check only when the tier you "
        "set agrees with that boolean (or is allow_with_notification, which is "
        "compatible with either). If the boolean is the value you consider "
        "wrong, it must be corrected directly."
    ),
    "coord.prompt_document_versions": (
        "These are IMMUTABLE history rows - a PATCH appends a new snapshot and "
        "cannot rewrite an existing one, so there is no attributable door here. "
        "Reconcile them directly: UPDATE coord.prompt_document_versions SET "
        "agent_write_tier = <value> WHERE document_id = <uuid> AND "
        "version_number = <n>, using the keys listed below."
    ),
}

# The Class C predicate, defined ONCE and used by both the census and the sample
# so they can never drift apart.
#
# ⚠️ `allow_with_notification` is EXCLUDED, and that exclusion is the difference
# between this migration running and this migration aborting a production
# deploy. The two authorities genuinely disagree about how that tier projects
# onto the boolean:
#
#   * `pdtier_02`'s backfill wrote `agent_writable = (agent_write_tier = 'allow')`,
#     i.e. `allow_with_notification -> FALSE`.
#   * coord's live projection is `AgentWriteTier::legacy_bool() = permits_write()
#     = !matches!(self, Deny)` (`policy_proposals.rs`), i.e.
#     `allow_with_notification -> TRUE` — deliberately, and documented there:
#     "a client reading the old boolean is asking 'may an agent write this', and
#     the answer is yes".
#
# So BOTH `('allow_with_notification', FALSE)` and
# `('allow_with_notification', TRUE)` are states the fleet produces on purpose,
# and the second one is not exotic: a legacy client reads `agent_writable: true`
# off an `awn` document and PATCHes it straight back, which coord's
# `TierWrite::Legacy(true)` arm preserves as `awn` rather than widening to
# `allow`. Flagging that pair as a two-opinion conflict would refuse on a state
# coord built deliberately — and because alembic wraps the whole run in ONE
# transaction, that refusal rolls back every pending revision in the deploy, not
# just this one.
#
# Switching wholesale to coord's mapping (`{tier} <> 'deny'`) is worse, not
# better: `pdtier_02` already wrote `awn -> FALSE` into production, so that form
# would flag every one of those rows instead. Excluding the tier is the only
# form that is a false positive under NEITHER mapping.
#
# What remains are the two pairs that are unambiguously contradictory under both
# mappings: ('allow', FALSE) and ('deny', TRUE).
_CLASS_C_PREDICATE = (
    "{legacy} IS NOT NULL "
    "AND {tier} IS NOT NULL "
    "AND {tier} <> 'allow_with_notification' "
    "AND {legacy} IS DISTINCT FROM ({tier} = 'allow')"
)

# Guarded on BOTH columns, because every statement inside reads both. This is
# `pdtier_02:136-156`'s pattern and the lesson `pdtier_01` paid for: gate on what
# the statement READS, not on what it happens to be named after. After the DROP
# the guard is false, so a replay is a genuine no-op rather than an error.
#
# Order inside the block matters. The Class B backfill runs FIRST and touches
# only rows where the tier IS NULL, so it can never manufacture a Class C row for
# the check that follows.
_RECONCILE_AND_DROP = """
DO $$
DECLARE
    conflicting_keys TEXT;
    conflicting_count INTEGER;
BEGIN
    IF EXISTS (
        SELECT 1
          FROM pg_attribute att
         WHERE att.attrelid = to_regclass('{table}')
           AND att.attname = '{legacy}'
           AND att.attnum > 0
           AND NOT att.attisdropped
    ) AND EXISTS (
        SELECT 1
          FROM pg_attribute att
         WHERE att.attrelid = to_regclass('{table}')
           AND att.attname = '{tier}'
           AND att.attnum > 0
           AND NOT att.attisdropped
    ) THEN
        -- Class B: the boolean is the only opinion. Narrowed by
        -- `{tier} IS NULL` so it cannot clobber a tier the deployed build
        -- wrote. This is the one substantive divergence from `pdtier_02`'s
        -- prescribed blanket UPDATE, and the reason is in the docstring.
        EXECUTE $sql$
            UPDATE {table}
               SET {tier} = CASE WHEN {legacy} THEN 'allow' ELSE 'deny' END
             WHERE {tier} IS NULL
               AND {legacy} IS NOT NULL
        $sql$;

        -- Class C: both columns set and genuinely contradictory. Refuse.
        --
        -- The census and the sample are SEPARATE subqueries on purpose. Folding
        -- `count(*)` over a `LIMIT 50` subquery counts the LIMIT, not the
        -- population, so 500 conflicting rows would be reported as 50 - and the
        -- "(first 50)" wording beside it would corroborate that as a deliberate
        -- truncation of a complete set. In a refusal whose entire job is to let
        -- an operator size the remediation, under-reporting the blast radius by
        -- 10x is worse than not counting at all: they fix 50, re-run, and meet
        -- another 50.
        --
        -- `ORDER BY 1` inside the sample, not just inside `string_agg`: without
        -- it the 50 rows are an arbitrary set that can differ between runs, so
        -- an operator who resolves the listed keys can be handed a disjoint 50
        -- while some rows never surface at all.
        EXECUTE $sql$
            SELECT
              (SELECT count(*) FROM {table} WHERE {conflict}),
              (SELECT coalesce(string_agg(k, ', '), '')
                 FROM (
                       SELECT ({row_key})::text AS k
                         FROM {table}
                        WHERE {conflict}
                        ORDER BY 1
                        LIMIT 50
                      ) s)
        $sql$ INTO conflicting_count, conflicting_keys;

        IF conflicting_count > 0 THEN
            -- `USING MESSAGE =`, not a `%`-formatted literal, and deliberately.
            -- SQLAlchemy escapes a literal `%` to `%%` on its way to psycopg2,
            -- and with no bind parameters psycopg2 does not unescape it - so the
            -- server receives `%%`, PL/pgSQL reads that as ONE escaped percent
            -- with no substitution point, and RAISE dies with "too many
            -- parameters specified for RAISE". Measured here 2026-08-31: it
            -- fails ONLY on the Class C path, i.e. only in the refusal that
            -- exists to explain itself, and every other test still passes.
            -- Plain concatenation has no format string and cannot regress that
            -- way.
            RAISE EXCEPTION USING MESSAGE =
                'pdtier_03 refuses to drop {legacy} from {table}: '
                || conflicting_count::text
                || ' Class C row(s) hold two contradictory authority opinions '
                || '({legacy} is set AND {tier} is set and they disagree; '
                || 'allow_with_notification is NOT counted, because coord and '
                || 'pdtier_02 project it onto the boolean differently and either '
                || 'value is legitimate). The migration cannot know which write '
                || 'was later, and guessing would silently revert an operator '
                || 'decision. '
                || '{remedy}'
                || ' Then re-run. Showing up to 50 of '
                || conflicting_count::text
                || ' key(s), ordered: '
                || conflicting_keys;
        END IF;

        -- Only now, with Class B preserved and Class C proven empty, is the
        -- drop lossless.
        EXECUTE $sql$ ALTER TABLE {table} DROP COLUMN IF EXISTS {legacy} $sql$;
    END IF;
END
$$
"""

# `pdtier_02.upgrade()`'s backfill, verbatim in effect - see `downgrade()`.
_RESTORE_BACKFILL = """
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
          FROM pg_attribute att
         WHERE att.attrelid = to_regclass('{table}')
           AND att.attname = '{tier}'
           AND att.attnum > 0
           AND NOT att.attisdropped
    ) THEN
        EXECUTE $sql$
            UPDATE {table}
               SET {legacy} = ({tier} = 'allow')
             WHERE {tier} IS NOT NULL
        $sql$;
    END IF;
END
$$
"""


def upgrade() -> None:
    """Reconcile the two columns, then drop the boolean, on both tables.

    Every step is a no-op on a second run: the whole block is guarded on the
    boolean column still existing, and after the DROP it does not.
    """
    for table in _TABLES:
        conflict = _CLASS_C_PREDICATE.format(tier=_TIER_COLUMN, legacy=_LEGACY_COLUMN)
        op.execute(
            _RECONCILE_AND_DROP.format(
                table=table,
                tier=_TIER_COLUMN,
                legacy=_LEGACY_COLUMN,
                row_key=_ROW_KEY[table],
                conflict=conflict,
                remedy=_REMEDY[table],
            )
        )


def downgrade() -> None:
    """Restore the boolean and backfill it from the tier - `pdtier_02.upgrade()`.

    This is deliberately that revision's upgrade in effect, including the
    restored column comments, so the pair is symmetric.

    THREE lossy directions, all of them stated because two of them are easy to
    miss and one of them contradicts the rule the other two follow:

    1. **``allow_with_notification`` restores as ``FALSE``.** The tier is
       three-state and the boolean is two-state. ``FALSE`` rather than ``TRUE``
       is the deliberate choice ``pdtier_01`` and ``pdtier_02`` both made - a
       restore can narrow authority but must never silently widen it.

       ⚠️ Note this DISAGREES with coord's own live projection, which maps
       ``allow_with_notification -> TRUE``
       (``AgentWriteTier::legacy_bool() = permits_write()``). The realistic
       reason to run this downgrade is a rollback to a pre-tier build that reads
       ONLY the boolean - and that build will therefore DENY agent writes to
       every document an operator deliberately set to ``allow_with_notification``,
       while coord's own answer to "may an agent write this" is yes. That is
       fail-closed, which is the safe direction, but it is not a no-op: expect
       those documents to need re-opening by hand after a rollback.

    2. **``NULL`` restores as ``TRUE`` for every ``allow`` row - a WIDENING.**
       This one breaks the rule in (1) and is called out rather than hidden.
       Class D (tier set, boolean ``NULL``) is the steady state after the tier
       build deployed, i.e. most production rows. ``pdaw_01`` defines ``NULL`` as
       "no operator opinion (the compile-time default decides)", and the backfill
       below - inherited verbatim from ``pdtier_02.upgrade()`` - turns that into
       an explicit ``TRUE``. If the compile-time default for a kind is deny, a
       rollback silently opens documents that were closed.

       It is irreducible here: by the time ``downgrade()`` runs the boolean is
       gone, so nothing distinguishes "was NULL" from "was TRUE". Narrowing the
       ``WHERE`` would only trade this for a different wrong answer. It is
       documented instead of fixed, deliberately.

    3. **``upgrade()``'s Class B backfill is NOT reverted.** A row that entered
       as ``(agent_writable = TRUE, agent_write_tier = NULL)`` leaves the round
       trip as ``(TRUE, 'allow')``: the tier has been permanently written. So the
       often-repeated line "``agent_write_tier`` is untouched by this revision"
       is FALSE in the forward direction and must not be relied on - Class B
       exists precisely to write it, and that write is what preserves the
       operator opinion the drop would otherwise discard.
    """
    for table in _TABLES:
        op.execute(
            f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS {_LEGACY_COLUMN} BOOLEAN"
        )
        op.execute(
            _RESTORE_BACKFILL.format(
                table=table, tier=_TIER_COLUMN, legacy=_LEGACY_COLUMN
            )
        )
        op.execute(
            f"COMMENT ON COLUMN {table}.{_LEGACY_COLUMN} IS '{_COMMENTS[table]}'"
        )
