"""coord.prompt_documents.agent_writable — per-document agent write access

Revision ID: pdaw_01
Revises: cisplit_01_devices_max_concurrent_ci_jobs
Create Date: 2026-08-14

P0 of plan
``D:/qontinui-root/plans/2026-08-04-per-document-agent-write-access.md``.

coord authors **zero** DDL (``[policy: alembic-sole-authorship]``), so the column
its P1 code will read lands here, in qontinui-web. This revision must be merged
**and present in the production database** before that coord reader deploys —
the 2026-07-13 incident (coord reading a column whose migration had not landed)
is the reason that ordering is a rule rather than a preference.

What this adds, and to what
===========================

One column, added to **both** ``coord.prompt_documents`` and
``coord.prompt_document_versions``:

```text
agent_writable  BOOLEAN  NULL
```

It answers "may an agent write this document?" for a single ``(kind, name)``,
replacing the compile-time-only answer coord gives today.

Why NOT ``coord.prompt_documents.attrs``
========================================

``attrs`` is the obvious home — it is an existing, generic, nullable JSONB
column on this very table, and using it would need no migration at all. The
plan originally specified exactly that. It is the wrong home, for the reason
coord's own module docs record (``prompt_documents.rs:23-35``): an attrs-only
PATCH takes a dedicated **non-versioning** branch — no
``prompt_document_versions`` snapshot, no ``current_version`` bump — so *"anything
that needs versioning cannot live in attrs"*. Two revisions in this same
directory already applied that rule and declined ``attrs`` for the same class of
setting: ``coord_sesscompl_02`` (*"Enforcement config changes agent-visible
behaviour and must be auditable … so it gets its own versioned rows rather than a
JSONB side-channel"*) and ``fleet_res_tel_02``/``_03``, which name it *"the
forbidden attrs side-channel"*.

There is also a concrete defect, not merely a principle. The only attribution an
attrs write leaves is ``prompt_documents.updated_by``, and
``apply_document_edit_tx`` — the writer behind **``append``**, the one operation
agents are granted — sets ``updated_by`` on every call. So on an
agent-*writable* document, where agent appends are the expected traffic, the
operator's record of who opened the document would be overwritten by the first
agent that used the permission it granted. That is an audit trail that lies,
which ``fleet_res_tel_02`` already ranks as worse than one that is absent.

Versioning it instead means a flip creates a
``prompt_document_versions`` row whose ``edited_by`` is immutable, and the
existing ``/versions`` and ``/versions/:version/restore`` routes describe and
revert the authorization state with machinery that already exists.

Why the versions table is widened in the SAME migration
=======================================================

Because ``fleet_res_tel_02`` wrote it into the database as a standing rule, in
the versions table's own ``COMMENT ON TABLE``:

    *"Any migration that adds a payload column to the parent must add it here
    too, in the same migration: a partial snapshot is an audit trail that lies
    while still reporting as versioned."*

A snapshot table missing a payload column does not fail, does not warn, and does
not stop reporting ``current_version`` — it goes on looking versioned while
silently dropping the column an operator actually changed. Splitting this into
"parent now, snapshot later" would open exactly that window.

Nullable, no default, NO BACKFILL — the three-state rule
========================================================

``NULL`` is a **third state**, not ``false``. It means *"no operator has expressed
an opinion about this document"*, and it is what routes the decision to coord's
compile-time default (``AGENT_UNWRITABLE_DOCUMENTS``: the three meta-policies
deny, everything else allows). Concretely:

* ``NOT NULL DEFAULT false`` would collapse "unset" into "protected" and silently
  protect the entire corpus.
* ``NOT NULL DEFAULT true`` would silently open the three meta-policies.
* A **backfill** — writing ``false`` onto today's three protected documents —
  would freeze the compile-time default into data, so a later edit to the
  constant would no longer take effect and the const would look inert to the
  next reader. The whole point of the fallback design is that the code stays the
  authority for unconfigured documents.

Same reasoning ``fleet_res_tel_03`` gives for its own nullable controls: *"NULL
means 'no override', not zero … Those are different facts and the schema must be
able to tell them apart."*

So this revision adds a column and writes no rows. Every existing document keeps
today's behaviour on the day it lands, which is also what makes it safe to land
ahead of the coord reader.

Read-failure handling is coord's, and it is NOT the usual degrade
================================================================

``pg_error::is_missing_schema_object`` catches 42703 (undefined_column) as well
as 42P01, and ``prompt_documents.rs`` uses it to degrade several reads to a
tolerant "no value". **coord's P1 reader must not do that for this column.** A
degraded read falls back to the compile-time default, which *allows* every
ordinary document — byte-identical to correct behaviour on a corpus where nobody
has set a flag yet. An operator could mark a document protected, see it rendered
protected, and have agents keep writing it indefinitely with nothing surfaced.
A typo'd column name would present the same way, forever.

P1 therefore resolves a failed read to **deny** and asserts this column's
existence at startup. This note lives here because the column is the contract's
other half: if a future revision renames or retypes it, that assertion is what
turns the mistake into a loud failure instead of a silent permission grant.

Idempotency: raw ``op.execute`` with ``ADD COLUMN IF NOT EXISTS`` — the house
convention for ``coord.*`` tables. The column is nullable with no default, so
each ADD is a catalogue update with no table rewrite.

``IF NOT EXISTS`` is type-BLIND. It matches on name alone, so a pre-existing
``agent_writable`` of some other type makes the ADD a silent no-op and leaves the
wrong type in place. coord reads this as ``Option<bool>`` via ``row.get(...)``,
which **panics** on a type mismatch rather than raising a SQLSTATE — there is no
degrade path for it. Repair a wrong-typed column with an explicit
``ALTER COLUMN … TYPE`` in a new revision; re-running ``upgrade()`` will not fix
it.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "pdaw_01"
down_revision: str | Sequence[str] | None = "cisplit_01_devices_max_concurrent_ci_jobs"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_COLUMN = "agent_writable"
_SQL_TYPE = "BOOLEAN"

# Parent first, snapshot second — but both, always, from one list. This is the
# SQL half of the "widen both together" rule the versions table's
# COMMENT ON TABLE states; having only one list is the cheapest way to make a
# partial widening unrepresentable.
_TABLES: tuple[str, ...] = (
    "coord.prompt_documents",
    "coord.prompt_document_versions",
)


def upgrade() -> None:
    """Add ``agent_writable`` to the parent AND the versions table."""
    for table in _TABLES:
        op.execute(
            f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS {_COLUMN} {_SQL_TYPE}"
        )

    # The comment carries the fact the name cannot: that NULL is a third state.
    # A reader who takes NULL for `false` writes a migration that protects the
    # whole corpus, or a UI checkbox that reports every unconfigured document as
    # explicitly open.
    op.execute(
        """
        COMMENT ON COLUMN coord.prompt_documents.agent_writable IS
        'May an agent write this document via coord_write_prompt_document? '
        'TRUE = allow, FALSE = deny, NULL = no operator opinion — fall back to '
        'coord''s compile-time AGENT_UNWRITABLE_DOCUMENTS default (the three '
        'meta-policies deny, every other document allows). NULL is NOT false. '
        'Operator-settable only, via the admin-gated PATCH '
        '/coord/prompt-documents/:kind/:name; coord_write_prompt_document has no '
        'argument that can reach it, which is what keeps the control '
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


def downgrade() -> None:
    """Exact inverse — drop the column from both tables."""
    for table in _TABLES:
        op.execute(f"ALTER TABLE {table} DROP COLUMN IF EXISTS {_COLUMN}")
