"""coord prompt documents — publish_mode, the one judgement kept for a person

Revision ID: pdpub_03
Revises: plan_library_07_plan_difficulty
Create Date: 2026-09-20

Phase 1 (the only qontinui-web migration) of plan
``2026-09-19-policy-publish-all-and-auto-publish``, design decision **D2**.

Hand-authored, never ``alembic revision --autogenerate`` — served policy
``production-and-cost`` ``alembic-sole-authorship``. coord authors zero DDL, so
every ``coord.*`` column its resolver reads lands here first.

What this adds
==============

One column, on **both** ``coord.prompt_documents`` and
``coord.prompt_document_versions``:

=============  ===============================================================
value          meaning
=============  ===============================================================
``auto``       the auto-publisher publishes settled versions of this document
               to every tenant, with no human action in the loop.
``manual``     only a click publishes it. It still appears in publish-all.
``never``      it is never published. publish-all leaves it out.
``NULL``       UNDECIDED — nobody has ruled on this document yet. The
               auto-publisher decides at its first pass, and defaults to
               ``manual`` when the body carries lint hits OR the document is an
               upstream carve-out.
=============  ===============================================================

``TEXT NULL``, with a named CHECK restricting it to the three values, no
default and **no backfill**. Every existing row arrives ``NULL``, which is the
undecided state, which is the state that does not distribute itself.

Why a STORED column here, when ``pdpub_02`` says derive on read
===============================================================

``pdpub_02``'s docstring states the principle this family works under —
everything beyond the two lineage columns is *"derived on read, never stored,
because staleness in a stored flag is the failure mode this design is
avoiding"*. That principle is intact, and this column is its **legitimate
exception**, not a hole in it.

The difference is that everything ``pdpub_02`` refused to store had a
computable source. ``local_modified`` is a digest comparison; ``update_available``
is a ``MAX(publication_version)`` against a tracked version. Each could be
recomputed at any moment, so storing it could only ever be a chance to be
wrong. ``publish_mode`` has **no computable source at all**. It is an operator
judgement about whether a document is fit to leave this tenant — the one
judgement the 2026-09-04 plan's D2 kept for a person, and the one this plan
keeps. There is nothing to derive it from and nothing for it to go stale
against, so the staleness failure mode simply does not arise. A column is the
only place it can live.

Stating that here is the point. A later reader who sees a third stored column
on these tables and concludes the derive-on-read rule was abandoned would start
storing the derivable ones too, and those are exactly the ones that go stale
and silently authorise an overwrite.

Why the snapshot table gets it too
==================================

Because ``publish_mode`` takes the **versioning** path, and because
``coord.prompt_document_versions``' own ``COMMENT ON TABLE`` (written by
``fleet_res_tel_02``) makes it a standing rule:

    *"Any migration that adds a payload column to the parent must add it here
    too, in the same migration - a partial snapshot is an audit trail that lies
    while still reporting as versioned."*

D2 resolves that setting the mode is an **authority** change, the same class as
``agent_write_tier``, whose ``PatchDocumentRequest`` field says so in as many
words (*"Unlike attrs, supplying this takes the VERSIONING path — a flip of who
may write a policy document is authority, and it must leave an immutable
record"*). Flipping a document to ``auto`` decides that it distributes itself to
every tenant in the fleet with no human in the loop; an authority flip with no
immutable record is precisely what the version table exists to prevent. So the
snapshot carries it, exactly as ``pdaw_01``, ``pdtier_01`` and ``pdpub_02``
carry theirs, and a restore of version N restores what version N was — including
who had decided this document could publish itself.

Both tables are widened in one loop from one list. That is the SQL half of the
"widen both together" rule; having only one list is the cheapest way to make a
partial widening unrepresentable.

⚠️ One consequence, recorded where the column lives, because a worker in the
NEXT repo depends on it: a ``publish_mode`` PATCH cuts a version whose body is
**identical to its predecessor's**. The auto-publisher's settle clock therefore
keys on *"the newest version whose body differs from its predecessor's"*, never
on the newest version outright — otherwise an operator setting ``auto`` would
silently reset the very timer they were asking to let run out.

Nullable, no default, NO BACKFILL — the three-state rule, carried forward again
==============================================================================

``NULL`` is a real third state meaning *"no operator opinion about this
document"*, the same as ``agent_write_tier``'s. It is what routes the decision
to the auto-publisher's first-pass default, which is deliberately conservative.

``NOT NULL DEFAULT 'never'`` would freeze the channel shut and hide the fact
that nobody had decided. ``DEFAULT 'auto'`` would, in one statement, opt the
entire corpus — including this fleet's own autonomy policy — into publishing
itself to every tenant. Neither is representable here: there is no default, and
no existing row is written.

The CHECK is written as ``IS NULL OR IN (…)`` even though a bare ``IN`` already
admits NULL (``NULL IN (…)`` is NULL, and a CHECK passes on NULL). Same reason
``pdtier_01`` writes it that way - "unset is legal" is a contract, and a
contract a reader has to reconstruct from SQL's three-valued logic is a contract
a reader gets wrong.

Constraint names
================

Explicit, stable, keyed off the bare table name, matching ``pdtier_01`` and
``pdpub_02``, so the drop-then-add pair is re-runnable and the constraint is
addressable by hand:

* ``ck_prompt_documents_publish_mode``
* ``ck_prompt_document_versions_publish_mode``

Locking and idempotency
=======================

``ADD COLUMN ... NULL`` with no default is a catalog-only change, so the
``ACCESS EXCLUSIVE`` lock is held for the catalog update alone. ``lock_timeout``
is set anyway so the migration fails fast rather than queueing that lock in
front of every reader behind a slow in-flight query.

* The column adds use ``ADD COLUMN IF NOT EXISTS``.
* Each CHECK is added as ``DROP CONSTRAINT IF EXISTS`` + ``ADD CONSTRAINT``
  under an explicit name. PostgreSQL has no ``ADD CONSTRAINT IF NOT EXISTS``,
  and the drop-then-add pair is the only re-runnable spelling. Declaring the
  CHECK inline on the ``ADD COLUMN`` would inherit ``IF NOT EXISTS``'s no-op and
  be unfixable by re-upgrade.
* Order is deliberate - columns on both tables first, then the CHECKs. Running
  the CHECK afterwards means a junk value that somehow survived into the column
  fails here, loudly, rather than being locked in behind a constraint added
  while the column was still uniformly NULL.

⚠️ ``ADD COLUMN IF NOT EXISTS`` is **type-blind** — it matches on name alone, so
a pre-existing ``publish_mode`` of some other type makes the ADD a silent no-op.
Repair a wrong-typed column with an explicit ``ALTER COLUMN … TYPE`` in a new
revision; re-running ``upgrade()`` will not fix it. The CHECK add is not
type-blind and fails loudly on a non-text column, which is the backstop.

⚠️ No ``:word`` tokens in any plain-string SQL below. alembic routes
``op.execute`` of a plain string through SQLAlchemy's ``text()``, which reads
``:kind`` as a BIND PARAMETER and then dies demanding a value for it.
``pdaw_01`` was bitten by exactly that and the reversibility gate caught it.

Deploy order
============

This revision lands BEFORE the coord build that reads the column, which is the
standing order for every ``coord.*`` column (the 2026-07-13 missing-column
incident). Either order is in fact survivable here: every coord **read** of this
surface degrades on ``42703`` through ``pg_error::is_missing_schema_object``,
matching the existing sites in ``prompt_document_publications.rs``. What must
never happen is a read of this column on ``publish_document``'s own path — that
function returns raw errors and has no degrade arm at all.

Downgrade
=========

Drops the two CHECKs and then the two columns, on both tables. **Lossy, stated
rather than pretended away:** every operator judgement recorded in it is gone,
and a re-upgrade brings the column back empty. That is a return to UNDECIDED for
the whole corpus, which is the conservative direction — an undecided document
publishes nothing until somebody or the auto-publisher's own conservative
default rules on it again. It is a visible, re-doable loss rather than an
invisible grant, which is the same trade ``pdtier_01``'s lossy arm takes.

The drop statements are built inside ``downgrade()`` rather than from a
module-level template on purpose, exactly as ``pdpub_02`` does it:
``scripts/ci/check_coord_column_drops.py`` scans the whole module *minus the
``downgrade()`` body* for ``coord.*`` removals, so a hoisted template would be
read as an upgrade-path drop and would demand a ``COORD_SCHEMA_DROPS``
declaration for a drop the upgrade never makes.

The reversal is exercised by ``migration-reversal.yml`` ("Migration Reversal
Gate"), which runs upgrade -> ``downgrade -1`` -> upgrade against a real
PostgreSQL, and — for the claims an empty database cannot reach — by
``backend/tests/test_pdpub_03_publish_mode_migration.py``.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "pdpub_03"
down_revision: str | Sequence[str] | None = "plan_library_07_plan_difficulty"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Parent first, snapshot second — but both, always, from one list. Same list
# `pdaw_01`, `pdtier_01` and `pdpub_02` used; see "Why the snapshot table gets
# it too".
_TABLES: tuple[str, ...] = (
    "coord.prompt_documents",
    "coord.prompt_document_versions",
)

_PUBLISH_MODE_COLUMN = "publish_mode"

# The publish-mode vocabulary, spelled ONCE, so the two CHECKs cannot drift into
# disagreeing about what a legal value is.
_PUBLISH_MODES: tuple[str, ...] = ("auto", "manual", "never")
_PUBLISH_MODE_LITERALS = ", ".join(f"'{mode}'" for mode in _PUBLISH_MODES)

# Explicit, stable CHECK names keyed off the bare table name. Fixed by the plan.
_PUBLISH_MODE_CHECKS: dict[str, str] = {
    "coord.prompt_documents": "ck_prompt_documents_publish_mode",
    "coord.prompt_document_versions": "ck_prompt_document_versions_publish_mode",
}

# Plain string literals, schema-qualified, never f-strings — written out per
# table rather than formatted from `_TABLES` so the `alembic-schema-arg-gate`
# pre-commit hook can read them statically. It skips any `op.execute` whose
# argument is not a constant, so a formatted ALTER is a statement that gate
# never audits. Keyed BY `_TABLES` entry so a table without its statement is a
# loud KeyError rather than a silently half-widened pair.
_ADD_COLUMN_SQL: dict[str, str] = {
    "coord.prompt_documents": (
        "ALTER TABLE coord.prompt_documents "
        "ADD COLUMN IF NOT EXISTS publish_mode TEXT NULL"
    ),
    "coord.prompt_document_versions": (
        "ALTER TABLE coord.prompt_document_versions "
        "ADD COLUMN IF NOT EXISTS publish_mode TEXT NULL"
    ),
}


def _publish_mode_check_expression(column: str) -> str:
    """``column IS NULL OR column IN (…)`` — the nullable-mode CHECK body.

    The ``IS NULL`` arm is redundant under SQL's three-valued logic (a CHECK
    passes when its expression is NULL) and is written anyway, as ``pdtier_01``
    writes it: "unset is legal" is a contract, and a contract a reader has to
    derive is a contract a reader gets wrong. Here the unset state is the one
    that decides whether an undecided document can publish itself, so it is
    worth two extra words.
    """
    return f"{column} IS NULL OR {column} IN ({_PUBLISH_MODE_LITERALS})"


def upgrade() -> None:
    """Add ``publish_mode`` to both tables, then constrain the vocabulary."""
    # Catalog-only (nullable, no default), so the ACCESS EXCLUSIVE lock is held
    # for the catalog update alone. Fail fast rather than queueing it in front
    # of every reader.
    op.execute("SET LOCAL lock_timeout = '3s'")
    for table in _TABLES:
        op.execute(_ADD_COLUMN_SQL[table])

    # Drop-then-add so a re-upgrade repairs a constraint that was added under an
    # earlier, different definition — and so the vocabulary can be widened later
    # by a revision that re-runs this pair rather than by hand.
    for table in _TABLES:
        constraint = _PUBLISH_MODE_CHECKS[table]
        op.execute(f"ALTER TABLE {table} DROP CONSTRAINT IF EXISTS {constraint}")
        op.execute(
            f"ALTER TABLE {table} ADD CONSTRAINT {constraint} "
            f"CHECK ({_publish_mode_check_expression(_PUBLISH_MODE_COLUMN)})"
        )

    # The contracts a reader of the catalog cannot derive from the type: that
    # NULL is a third state and not "manual", that the column is only meaningful
    # on system-tenant rows, and that writing it cuts a version whose body did
    # not change. Re-applied unconditionally so a re-upgrade over an
    # already-present column still installs them.
    op.execute(
        """
        COMMENT ON COLUMN coord.prompt_documents.publish_mode IS
        'Whether this document may publish itself to every other tenant. '
        'auto = the auto-publisher publishes settled versions with no human '
        'action in the loop; manual = only an operator click publishes it, and '
        'it still appears in publish-all; never = it is never published and '
        'publish-all leaves it out. NULL = UNDECIDED, which is NOT manual and '
        'NOT a missing value — nobody has ruled on this document, and the '
        'auto-publisher decides at its first pass, defaulting to manual when '
        'the body carries publish-lint hits OR the document is an upstream '
        'carve-out. Meaningful ONLY on system-tenant rows; every other tenant '
        'ignores it. Operator-set only, through the admin-gated PATCH — the '
        'agent write tool carries no metadata key, and which documents may be '
        'shared across tenants is the one judgement this design keeps for a '
        'person. A STORED column rather than a derived one because, unlike '
        'local_modified and update_available, it has no computable source to '
        'go stale against.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.prompt_document_versions.publish_mode IS
        'Snapshot of the parent''s publish_mode at this version, so restoring '
        'version N restores WHO HAD DECIDED this document could publish '
        'itself, not merely its body. Setting the mode takes the VERSIONING '
        'path deliberately (the same rule agent_write_tier follows) because '
        'letting a document distribute itself to the fleet is authority, and '
        'an authority flip with no immutable record is what this table exists '
        'to prevent. CONSEQUENCE for any settle timer read off these rows — a '
        'publish_mode change cuts a version whose body is IDENTICAL to its '
        'predecessor''s, so a clock keyed on the newest version would let an '
        'operator flipping the mode to auto silently reset the very wait they '
        'were asking to let run out. Key it on the newest version whose body '
        'DIFFERS from its predecessor''s. Same carry-forward rule as '
        'agent_write_tier and upstream_tracking - widen or change the parent '
        'column and this one together.'
        """
    )


def downgrade() -> None:
    """Drop the CHECKs and the column from both tables.

    LOSSY, in the conservative direction: every operator judgement recorded in
    ``publish_mode`` is gone, and a re-upgrade brings the column back empty. The
    whole corpus returns to UNDECIDED, and an undecided document distributes
    nothing until it is ruled on again — by a person, or by the auto-publisher's
    own conservative first-pass default. A downgrade that somehow preserved a
    stale ``auto`` would point the other way, at a document publishing itself
    under a decision nobody could see any more.

    The statements are constructed here rather than from a module-level template
    so ``check_coord_column_drops.py`` (which scans everything except this
    function body) does not read them as upgrade-path drops.
    """
    # CHECKs first. PostgreSQL would drop them with the column anyway; doing it
    # explicitly means a half-applied upgrade (constraint added, column somehow
    # absent) also reverses.
    for table in _TABLES:
        op.execute(
            f"ALTER TABLE {table} "
            f"DROP CONSTRAINT IF EXISTS {_PUBLISH_MODE_CHECKS[table]}"
        )

    op.execute("SET LOCAL lock_timeout = '3s'")
    # Dropped in the inverse of the upgrade's add order.
    for table in reversed(_TABLES):
        op.execute(
            f"ALTER TABLE {table} DROP COLUMN IF EXISTS {_PUBLISH_MODE_COLUMN}"
        )
