"""coord prompt documents — three-state agent-authorship tier

Revision ID: pdtier_01
Revises: ffland_headsync_01
Create Date: 2026-08-27

Phase 1 (qontinui-web half) of plan
``D:/qontinui-root/plans/2026-08-27-tenant-level-agent-authorable-stores.md``.

Hand-authored, never ``alembic revision --autogenerate`` — served policy
``production-and-cost`` ``alembic-sole-authorship``. coord authors zero DDL, so
every ``coord.*`` column its resolver reads lands here first; the 2026-07-13
missing-column incident is why that ordering is a rule rather than a preference.

What this adds
==============

The authorship verdict stops being a boolean and becomes a **three-state tier**,
settable per document and — new — per ``(tenant, kind)``:

===========================  ============================================
tier                         meaning
===========================  ============================================
``deny``                     server-side refusal (today's ``false``)
``allow``                    agent writes land unannounced (today's ``true``)
``allow_with_notification``  agent writes land **only** with a valid
                             notification reference
===========================  ============================================

Three DDL changes:

1. ``agent_write_tier TEXT NULL`` on ``coord.prompt_documents`` **and**
   ``coord.prompt_document_versions``, each with a CHECK restricting it to the
   three values above (``NULL`` still permitted — see the three-state rule
   below).
2. The rows of ``agent_writable`` are migrated into it —
   ``TRUE -> 'allow'``, ``FALSE -> 'deny'``, ``NULL -> NULL`` — and
   ``agent_writable`` is then **dropped from both tables**, in the same guarded
   block that migrated it.
3. A new table ``coord.prompt_document_kind_tiers``, keyed
   ``(tenant_id, kind)``, carrying the per-kind tenant setting.

Why REPLACE the column rather than convert it in place
======================================================

Two shapes were available: ``ALTER COLUMN agent_writable TYPE TEXT USING …``
(keep the name, widen the type), or add ``agent_write_tier`` and drop
``agent_writable``. This revision takes the second, for three reasons.

**The name would lie.** ``agent_writable`` asks a yes/no question. A column of
that name holding ``'allow_with_notification'`` is a field whose name contradicts
its contents, and the next reader resolves the contradiction by guessing.

**An in-place retype fails SILENTLY-then-VIOLENTLY on the existing reader.**
``pdaw_01``'s own docstring records that coord reads this column as
``Option<bool>`` straight off the row via ``tokio_postgres::Row::get``, which
**panics** on a type mismatch rather than raising a SQLSTATE there is a degrade
path for. Keeping the name and changing the type hands every un-upgraded coord a
panic. Dropping the name instead produces 42703 ``undefined_column`` — which
``pg_error::is_missing_schema_object`` already recognises and coord's
``FlagRead::SchemaMissing`` arm already resolves to **deny**, with the
purpose-written message *"coord is serving ahead of its migration, retrying will
not clear it"*. Fail-closed and self-describing beats fail-loud-and-fatal.

**Delete-over-deprecate is the standing policy, and the plan spells the specific
form of it here**: *"the per-document tier WIDENS ``agent_writable`` rather than
adding a sibling column, so there is one place to read and no two-column
disagreement to resolve."* Two columns meaning almost-the-same thing is exactly
how ``is_kind_wide_agent_deny`` came to need a doc comment explaining which of
its two consumers it must not fire in. So both columns must not survive this
revision, and they do not.

The deploy window this opens, stated in full
============================================

Between this revision landing in production and the coord build that reads
``agent_write_tier`` deploying, a running coord reads a column that is gone.
That is **three** different behaviours, not one, and only naming all three makes
the window's real shape visible:

=========================================  ==========================================
coord path                                 behaviour during the window
=========================================  ==========================================
enforcement read                           → **deny**. ``FlagRead::SchemaMissing``
(``policy_proposals.rs:365,406``)          resolves a failed read to refusal, which
                                           is the direction ``pdaw_01`` chose
                                           deliberately.
admin list + detail read                   → access reads **UNKNOWN** in the
(``prompt_documents.rs:1442,1505``)        dashboard, logged at INFO. Not an error,
                                           and not a claim that the document is open.
operator ``PATCH`` carrying                → **hard 42703**. That is deliberate on
``agent_writable``                         coord's side — *"you cannot record an
(``prompt_documents.rs:3142``)             authority decision the schema cannot
                                           hold"*.
=========================================  ==========================================

The third row is the one worth planning around: during the window **the
operator's escape hatch closes at the same moment as the grant**. Nobody can set
a per-document tier until the coord build deploys, so "just flip the flag by hand
if something goes wrong" is not available. That is why the plan orders the coord
PR held in DRAFT behind this one rather than shipped alongside it.

What keeps WORKING through the window, stated so nobody assumes the worst:
coord's ``SELECT_COLS`` (``prompt_documents.rs:1358``) does not include the
column, and the version carry-forward probes ``information_schema`` before using
it (``:3227``) — so agent ``append``, operator body edits, clause edits and
restore are all unaffected.

Why the versions table is widened in the SAME migration
=======================================================

Because ``fleet_res_tel_02`` wrote it into the database as a standing rule, in
``coord.prompt_document_versions``'s own ``COMMENT ON TABLE``:

    *"Any migration that adds a payload column to the parent must add it here
    too, in the same migration: a partial snapshot is an audit trail that lies
    while still reporting as versioned."*

``pdaw_01`` put ``agent_writable`` on both tables under that rule. Replacing it
on only one would leave a snapshot table that can hold a payload the parent
cannot (or vice versa) — the same defect, mirrored. Both tables, one list.

Nullable, no default, NO BACKFILL — ``pdaw_01``'s three-state rule, carried
forward
===================================================================

``NULL`` is still a third state meaning *"no operator opinion about this
document"*, and it is still what routes the decision down the resolution order to
the per-kind tenant setting and then to coord's compile-time default. ``NOT NULL
DEFAULT 'deny'`` would collapse "unset" into "protected" and silently freeze the
whole corpus; ``DEFAULT 'allow'`` would silently open the three meta-policies.
And no row that was ``NULL`` becomes non-NULL here: the data migration is scoped
``WHERE agent_writable IS NOT NULL``, so the compile-time constant stays the
authority for every document no operator has ruled on.

The CHECK is written as ``IS NULL OR IN (…)`` even though a bare ``IN`` already
admits NULL (``NULL IN (…)`` is NULL, and a CHECK passes on NULL). The redundant
clause costs nothing at runtime and stops the next reader from having to
reconstruct SQL's three-valued logic to answer "is unset legal here?".

``coord.prompt_document_kind_tiers`` — the per-kind tenant setting
==================================================================

The per-document flag structurally cannot cover an open namespace: it is set on
a row, so it can only be set on a document that already exists. Under a kind-wide
deny with an open namespace — which is every intent kind — a new name has nothing
to flip. That is the gap this table closes, and it is why the setting is keyed on
``kind`` rather than on a document id.

* Composite ``PRIMARY KEY (tenant_id, kind)`` — the natural key, and the exact
  shape of the resolver's read. No surrogate id, and therefore no way to store
  two conflicting tiers for one ``(tenant, kind)``.
* ``tenant_id`` carries **no** foreign key to ``coord.tenants``, matching
  ``coord.prompt_documents`` and its ancestors, whose migration states the
  reason: coord-side seeding is warn-and-continue, and an FK re-introduces the
  inert-feature class.
* ``tier TEXT NOT NULL`` — unlike the per-document column there is no third
  state to express. A row means the tenant has an opinion about this kind;
  absence of a row means it does not, and absence is representable by having no
  row. A nullable ``tier`` would add a second, redundant spelling of "no
  opinion".
* ``updated_at TIMESTAMPTZ NOT NULL DEFAULT now()`` and ``updated_by TEXT`` —
  who last moved a tenant-wide authorship setting, and when. ``DEFAULT now()``
  is the house convention here (there is not one ``CREATE TRIGGER`` in the whole
  revision chain), which means **the writer must set ``updated_at = now()``
  explicitly in its UPSERT** or the column silently reports the moment the row
  was first inserted. The ``COMMENT ON COLUMN`` says so, because a column that
  quietly lies about recency is worse than one that is absent.

Why ``kind`` gets NO CHECK constraint here
==========================================

``kind`` is a plain ``TEXT`` column. It deliberately does **not** repeat the
thirteen-value vocabulary that ``ck_prompt_documents_kind`` carries
(``coord_prompt_docs_05_intent_kinds``, the current head of that constraint).

That is not laziness, it is the drift argument. ``coord_prompt_docs_0{1..5}``
widen the kind vocabulary by *discovering and dropping every CHECK on
``coord.prompt_documents.kind``* and re-adding a wider one — a loop whose
``pg_attribute`` join is scoped to that one table's ``kind`` column. A sibling
list on a **different** table is invisible to it. So the fourteenth kind would be
admitted by the document store and rejected by its own tier table, and the
symptom would be a 23514 on the setting rather than on the document — the
tier silently unsettable for exactly the newest kind, which is the case the
operator most wants to configure.

One vocabulary, one owner. A ``COMMENT ON COLUMN`` points the next reader at
that owner. If a future revision wants referential enforcement, the correct
shape is a real ``coord.prompt_document_kinds`` lookup table that BOTH the
document CHECK and this column key off — one list, two consumers — not a second
copy of the list.

Downgrade — hand-authored, and LOSSY in one documented direction
================================================================

``coord_prompt_docs_05`` records what a careless downgrade costs (restoring the
wrong constraint set silently drops rows). This one restores
``agent_writable BOOLEAN`` on both tables with the inverse mapping:

======================================  =============
``agent_write_tier``                    ``agent_writable``
======================================  =============
``'allow'``                             ``TRUE``
``'deny'``                              ``FALSE``
``'allow_with_notification'``           ``FALSE``  ← **LOSSY**
``NULL``                                ``NULL``
======================================  =============

**``allow_with_notification`` collapses to ``FALSE`` and cannot be recovered by
re-upgrading.** A boolean has no third state, so there is no lossless inverse and
none is pretended. The collapse direction is chosen deliberately: mapping it to
``TRUE`` would restore an *unconditional* grant where the operator had asked for
a grant conditioned on disclosure — a downgrade that silently widens authority.
Mapping it to ``FALSE`` restores a refusal, which is the conservative half of the
pair and matches every other fail-closed decision in this column's history.
An operator who downgrades and re-upgrades gets ``deny`` back for those
documents and must re-set them; that is a visible, re-doable loss rather than an
invisible permission grant.

The downgrade also restores ``pdaw_01``'s two ``COMMENT ON COLUMN`` bodies —
dropping a column drops its comment, so a bare re-``ADD`` would leave the
restored column undocumented and quietly lose the "NULL is NOT false" warning
that migration exists to carry — and drops
``coord.prompt_document_kind_tiers`` outright, since this revision created it.
Those rows have no representation at all in the older schema, which is the
second and larger half of the downgrade's loss.

``migration-reversal.yml`` ("Migration Reversal Gate") executes upgrade →
``downgrade -1`` → upgrade against a real PostgreSQL, so none of the above is
decorative.

Idempotency
===========

* Column adds use ``ADD COLUMN IF NOT EXISTS``.
* Every CHECK — the two column constraints AND the new table's ``tier`` CHECK —
  is added as ``DROP CONSTRAINT IF EXISTS`` + ``ADD CONSTRAINT`` under an
  explicit, stable name. PostgreSQL has no ``ADD CONSTRAINT IF NOT EXISTS``, and
  the drop-then-add pair is the only re-runnable spelling. The new table's CHECK
  is deliberately **not** declared inline in the ``CREATE TABLE``: an inline
  constraint inherits ``IF NOT EXISTS``'s no-op, so on a database where the
  table already exists in some other shape the CHECK would never be added and
  re-running ``upgrade()`` could not repair it — exactly the failure the
  drop-then-add rule exists to prevent.
* ``CREATE TABLE IF NOT EXISTS`` for the new table.
* Each ``(migrate, drop)`` pair runs inside ONE ``DO`` block, under ONE
  ``pg_catalog`` predicate. That is not tidiness: a guard on the migrate with an
  unconditional drop beside it can disagree — the guard evaluates false, the
  drop fires anyway, and every operator opinion is gone with no error and no log
  line. One predicate, one block, so guard and drop cannot come apart.
* The predicate reads ``pg_attribute``/``to_regclass`` rather than
  ``information_schema.columns``. ``information_schema`` is
  **privilege-filtered** (it hides columns the current role holds no privilege
  on), which makes it a false-negative source for exactly the question a
  destructive branch is asking. ``coord_prompt_docs_05`` also reads
  ``pg_catalog``, but for its own unrelated reason (it has to *discover*
  constraint names) — the justification here stands on privilege filtering
  alone, not on that precedent.

⚠️ ``ADD COLUMN IF NOT EXISTS`` is **type-blind** — it matches on name alone, so
a pre-existing ``agent_write_tier`` of some other type makes the ADD a silent
no-op. The same applies to the downgrade's re-``ADD`` of the ``BOOLEAN``: a
wrong-typed survivor makes that a no-op too, and the ``UPDATE`` that follows then
fails on the type rather than on the schema. Repair a wrong-typed column with an
explicit ``ALTER COLUMN … TYPE`` in a new revision; re-running ``upgrade()`` will
not fix it. The CHECK add is not type-blind and fails loudly on a non-text
column, which is the backstop for the upgrade half.

⚠️ ``CREATE TABLE IF NOT EXISTS`` is **shape-blind**, which is the strictly
larger hazard: it matches on name alone, so a pre-existing
``coord.prompt_document_kind_tiers`` with a different primary key, a missing
column, or a wrong-typed ``tier`` is accepted in silence. Only the ``tier``
CHECK is repairable by re-running (it is added separately, above); everything
else needs an explicit ``ALTER TABLE`` in a new revision.

⚠️ No ``:word`` tokens in any plain-string SQL below. alembic routes
``op.execute`` of a plain string through SQLAlchemy's ``text()``, which treats
``:kind`` as a BIND PARAMETER — so spelling a route as
``/coord/prompt-documents/:kind/:name`` in a comment body makes the statement
demand values for parameters that do not exist. Braces are used instead. (A
``::`` cast is safe: the bind-param regex excludes it on both sides. The rule is
written as the stricter "no ``:word``" because the exception is easy to
mis-remember and the cost of the stricter form is nil.)
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "pdtier_01"
down_revision: str | Sequence[str] | None = "ffland_headsync_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_TIER_COLUMN = "agent_write_tier"
_TIER_SQL_TYPE = "TEXT"
_LEGACY_COLUMN = "agent_writable"
_LEGACY_SQL_TYPE = "BOOLEAN"

_KIND_TIER_TABLE = "coord.prompt_document_kind_tiers"
_KIND_TIER_CHECK = "ck_prompt_document_kind_tiers_tier"

# The tier vocabulary, spelled ONCE. Every CHECK in this revision — parent,
# snapshot, and the new table — is built from this tuple, so the three cannot
# drift into disagreeing about what a legal tier is.
_TIERS: tuple[str, ...] = ("deny", "allow", "allow_with_notification")

# Parent first, snapshot second — but both, always, from one list. This is the
# SQL half of the "widen both together" rule the versions table's
# COMMENT ON TABLE states; having only one list is the cheapest way to make a
# partial widening unrepresentable. Same list `pdaw_01` used.
_TABLES: tuple[str, ...] = (
    "coord.prompt_documents",
    "coord.prompt_document_versions",
)

# Explicit, stable CHECK names keyed off the bare table name, so the
# drop-then-add pair is re-runnable and the constraint is addressable by hand.
_TIER_CHECKS: dict[str, str] = {
    "coord.prompt_documents": "ck_prompt_documents_agent_write_tier",
    "coord.prompt_document_versions": "ck_prompt_document_versions_agent_write_tier",
}

_TIER_LITERALS = ", ".join(f"'{tier}'" for tier in _TIERS)


def _tier_check_expression(column: str) -> str:
    """``column IS NULL OR column IN (…)`` — the nullable-tier CHECK body.

    The ``IS NULL`` arm is redundant under SQL's three-valued logic (a CHECK
    passes when its expression is NULL) and is written anyway: "unset is legal"
    is a contract, and a contract a reader has to derive is a contract a reader
    gets wrong.
    """
    return f"{column} IS NULL OR {column} IN ({_TIER_LITERALS})"


# `pg_catalog`, not `information_schema`: the latter is privilege-filtered and
# would answer "no such column" for a column the role merely cannot see —
# a false negative in front of a DROP.
# `{doomed_column}`, not `{column}`: this template is shared by BOTH blocks
# below, and in each one the SAME placeholder names the column the block
# GUARDS on *and* the column it DROPS. A call site that passes the wrong one
# therefore produces a block that guards on a column and then drops that very
# column — during `upgrade()` that silently drops `agent_write_tier` moments
# after populating it, and the migration still reports success. The name is
# the only thing that makes the two call sites self-checking, so it says what
# happens to the column rather than merely which column it is.
#
# ⚠️ The two halves of the rendered string obey DIFFERENT brace rules. This
# template is a PLAIN string, so its braces survive the outer f-string intact
# and are consumed by the later `.format()`. The f-string templates below are
# interpolated once at import, so a literal brace there must be DOUBLED. Add a
# brace to the wrong half and it is either eaten early or left behind.
_COLUMN_EXISTS = """
        SELECT 1
          FROM pg_attribute att
         WHERE att.attrelid = to_regclass('{table}')
           AND att.attname = '{doomed_column}'
           AND att.attnum > 0
           AND NOT att.attisdropped
"""

# Migrate-then-drop, in ONE block under ONE predicate, so the guard and the
# destructive half can never disagree (see the Idempotency section). The
# statements go through EXECUTE because the block also drops the column it
# names: a static reference would have to resolve against a schema this very
# block changes. The `IF` alone would already keep an un-taken branch unplanned
# — this is the belt to that suspender, not a substitute for it.
_MIGRATE_AND_DROP_LEGACY = f"""
DO $$
BEGIN
    IF EXISTS (
{_COLUMN_EXISTS}
    ) THEN
        EXECUTE $sql$
            UPDATE {{table}}
               SET {{tier}} = CASE WHEN {{doomed_column}} THEN 'allow' ELSE 'deny' END
             WHERE {{doomed_column}} IS NOT NULL
        $sql$;
        EXECUTE $sql$ ALTER TABLE {{table}} DROP COLUMN {{doomed_column}} $sql$;
    END IF;
END
$$
"""

# The inverse, same shape: restore the boolean from the tier, then drop the
# tier, under the single predicate that says the tier is there to read.
_UNMIGRATE_AND_DROP_TIER = f"""
DO $$
BEGIN
    IF EXISTS (
{_COLUMN_EXISTS}
    ) THEN
        EXECUTE $sql$
            UPDATE {{table}}
               SET {{legacy}} = ({{doomed_column}} = 'allow')
             WHERE {{doomed_column}} IS NOT NULL
        $sql$;
        EXECUTE $sql$ ALTER TABLE {{table}} DROP COLUMN {{doomed_column}} $sql$;
    END IF;
END
$$
"""


def upgrade() -> None:
    """Add the tier column + per-kind table, migrate, then drop the boolean."""
    # 1. The tier column, on the parent AND the snapshot, from one list.
    for table in _TABLES:
        op.execute(
            f"ALTER TABLE {table} "
            f"ADD COLUMN IF NOT EXISTS {_TIER_COLUMN} {_TIER_SQL_TYPE}"
        )

    # 2. Carry every operator opinion across, then drop the boolean — one block,
    #    one predicate. NULL stays NULL (the UPDATE is scoped
    #    `WHERE agent_writable IS NOT NULL`): coord's compile-time default
    #    remains the authority for documents nobody has ruled on, exactly as
    #    `pdaw_01` intended.
    for table in _TABLES:
        op.execute(
            _MIGRATE_AND_DROP_LEGACY.format(
                table=table,
                tier=_TIER_COLUMN,
                doomed_column=_LEGACY_COLUMN,
            )
        )

    # 3. Constrain the vocabulary. Order relative to step 2 is not load-bearing
    #    — a boolean can only produce 'allow', 'deny' or NULL, all three legal —
    #    but running it AFTER means a junk-VALUED `agent_write_tier` that
    #    survived step 1's type-blind ADD fails here, loudly, instead of being
    #    locked in behind a constraint that was added while the column was
    #    still empty. (A wrong-TYPED survivor never reaches this point: step 2
    #    assigns text into it and fails there.)
    for table in _TABLES:
        constraint = _TIER_CHECKS[table]
        op.execute(f"ALTER TABLE {table} DROP CONSTRAINT IF EXISTS {constraint}")
        op.execute(
            f"ALTER TABLE {table} ADD CONSTRAINT {constraint} "
            f"CHECK ({_tier_check_expression(_TIER_COLUMN)})"
        )

    # 4. The per-kind tenant setting. No FK on tenant_id (matching
    #    coord.prompt_documents), no CHECK on kind (one vocabulary, one owner —
    #    see the module docstring).
    op.execute(
        f"""
        CREATE TABLE IF NOT EXISTS {_KIND_TIER_TABLE} (
            tenant_id  UUID NOT NULL,
            kind       TEXT NOT NULL,
            tier       TEXT NOT NULL,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_by TEXT,
            PRIMARY KEY (tenant_id, kind)
        )
        """
    )

    # Separately, so re-running repairs it — an inline CHECK would inherit
    # CREATE TABLE IF NOT EXISTS's no-op and be unfixable by re-upgrade.
    op.execute(
        f"ALTER TABLE {_KIND_TIER_TABLE} DROP CONSTRAINT IF EXISTS {_KIND_TIER_CHECK}"
    )
    op.execute(
        f"ALTER TABLE {_KIND_TIER_TABLE} ADD CONSTRAINT {_KIND_TIER_CHECK} "
        f"CHECK (tier IN ({_TIER_LITERALS}))"
    )

    op.execute(
        f"""
        COMMENT ON TABLE {_KIND_TIER_TABLE} IS
        'Per-(tenant, kind) agent-authorship tier for coord prompt documents. '
        'A row means the tenant has an opinion about this kind; NO ROW means it '
        'does not — there is deliberately no NULL tier, because absence already '
        'spells absence. Consulted at step 3 of coord''s resolution order: '
        'compiled-in FLOOR (AgentUnwritable::Kind) first and unliftable, then '
        'the per-document coord.prompt_documents.agent_write_tier, then this '
        'table, then the compiled-in default, then allow.'
        """
    )
    op.execute(
        f"""
        COMMENT ON COLUMN {_KIND_TIER_TABLE}.kind IS
        'Deliberately unconstrained TEXT. The kind vocabulary is owned by '
        'ck_prompt_documents_kind on coord.prompt_documents (thirteen values as '
        'of coord_prompt_docs_05_intent_kinds). A second copy here would be '
        'invisible to the discover-and-drop loop those revisions use to widen '
        'it, so the next kind added would be accepted by the document store and '
        'rejected by its own tier table. One vocabulary, one owner.'
        """
    )
    op.execute(
        f"""
        COMMENT ON COLUMN {_KIND_TIER_TABLE}.tier IS
        'One of deny / allow / allow_with_notification. deny = server-side '
        'refusal; allow = agent writes land unannounced; '
        'allow_with_notification = agent writes land ONLY when accompanied by a '
        'valid notification reference. Same vocabulary as '
        'coord.prompt_documents.agent_write_tier.'
        """
    )
    op.execute(
        f"""
        COMMENT ON COLUMN {_KIND_TIER_TABLE}.updated_at IS
        'When this tenant-wide setting last moved. DEFAULT now() fires on INSERT '
        'ONLY — there is no trigger anywhere in this schema — so the writer MUST '
        'set updated_at = now() in its UPSERT. Left to the default, an updated '
        'row reports the moment it was first created, which is a column that '
        'lies about recency rather than one that is merely absent.'
        """
    )

    # 5. Column comments carrying what the names cannot: the third state, and
    #    which table owns the snapshot half.
    op.execute(
        """
        COMMENT ON COLUMN coord.prompt_documents.agent_write_tier IS
        'May an agent write this document via coord_write_prompt_document, and '
        'on what terms? deny / allow / allow_with_notification, or NULL = no '
        'operator opinion — fall through to the per-(tenant, kind) setting in '
        'coord.prompt_document_kind_tiers, then to coord''s compile-time '
        'AGENT_UNWRITABLE_DOCUMENTS default. NULL is NOT deny. Replaces the '
        'agent_writable BOOLEAN (pdaw_01), whose true/false map to allow/deny. '
        'Operator-settable only, via the admin-gated PATCH '
        '/coord/prompt-documents/{kind}/{name}; coord_write_prompt_document has '
        'no argument that can reach it, which is what keeps the control '
        'non-circular. It cannot lift the compiled-in kind-wide FLOOR '
        '(is_kind_wide_agent_deny), which sits ABOVE it in the resolution '
        'order — claude_settings stays denied whatever this column says.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.prompt_document_versions.agent_write_tier IS
        'Snapshot of the parent''s agent_write_tier at this version. Carried '
        'forward by every version write including append, so a tier change is '
        'attributable to the operator via this row''s edited_by — which the '
        'parent''s mutable updated_by cannot be, since the next agent append '
        'overwrites it. A record, not a restore source: restoring an old body '
        'deliberately does not restore that version''s tier.'
        """
    )


def downgrade() -> None:
    """Restore ``agent_writable BOOLEAN`` (LOSSILY) and drop the new table."""
    # 1. Bring the boolean back on both tables before anything writes to it.
    for table in _TABLES:
        op.execute(
            f"ALTER TABLE {table} "
            f"ADD COLUMN IF NOT EXISTS {_LEGACY_COLUMN} {_LEGACY_SQL_TYPE}"
        )

    # 2. Restore `pdaw_01`'s comments verbatim — DROP COLUMN took them with the
    #    column, and a re-ADD without them loses the "NULL is NOT false"
    #    warning that revision exists to carry.
    op.execute(
        """
        COMMENT ON COLUMN coord.prompt_documents.agent_writable IS
        'May an agent write this document via coord_write_prompt_document? '
        'TRUE = allow, FALSE = deny, NULL = no operator opinion — fall back to '
        'coord''s compile-time AGENT_UNWRITABLE_DOCUMENTS default (the three '
        'meta-policies deny, every other document allows). NULL is NOT false. '
        'Operator-settable only, via the admin-gated PATCH '
        '/coord/prompt-documents/{kind}/{name}; coord_write_prompt_document has '
        'no argument that can reach it, which is what keeps the control '
        'non-circular.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.prompt_document_versions.agent_writable IS
        'Snapshot of the parent''s agent_writable at this version. Carried '
        'forward by every version write including append, so a flip is '
        'attributable to the operator via this row''s edited_by — which the '
        'parent''s mutable updated_by cannot be, since the next agent append '
        'overwrites it.'
        """
    )

    # 3. Drop the tier's CHECK first. PostgreSQL would drop it with the column
    #    anyway; doing it explicitly means a half-applied upgrade (constraint
    #    added, column somehow absent) also reverses.
    for table in _TABLES:
        op.execute(
            f"ALTER TABLE {table} DROP CONSTRAINT IF EXISTS {_TIER_CHECKS[table]}"
        )

    # 4. Inverse mapping, then drop the tier — one block, one predicate, same
    #    reason as the upgrade. `tier = 'allow'` is TRUE and everything else is
    #    FALSE, so `allow_with_notification` -> FALSE. That collapse is LOSSY
    #    and unrecoverable by re-upgrading; FALSE rather than TRUE because a
    #    downgrade must never silently widen authority. See the module
    #    docstring.
    for table in _TABLES:
        op.execute(
            _UNMIGRATE_AND_DROP_TIER.format(
                table=table,
                legacy=_LEGACY_COLUMN,
                doomed_column=_TIER_COLUMN,
            )
        )

    # 5. The per-kind table is this revision's own creation; it goes with it.
    #    Its rows have no boolean representation at all — there is nowhere to
    #    put a per-kind setting in the pre-pdtier_01 schema — so this drop is
    #    the second, larger half of the downgrade's documented loss.
    op.execute(f"DROP TABLE IF EXISTS {_KIND_TIER_TABLE}")
