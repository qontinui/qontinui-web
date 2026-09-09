"""coord prompt documents — upstream lineage on the parent AND the snapshot

Revision ID: pdpub_02
Revises: pdpub_01
Create Date: 2026-09-04

Phase 1 (second of two revisions) of plan
``2026-09-04-cross-tenant-policy-publishing``, design decision **D3**.

What this adds
==============

Two columns, on **both** ``coord.prompt_documents`` and
``coord.prompt_document_versions``:

===============================  ==============================================
column                           meaning
===============================  ==============================================
``upstream_publication_version``  ``INTEGER NULL`` — the
                                  ``coord.prompt_document_publications``
                                  version this body was last derived from.
                                  ``NULL`` means *no upstream* (hand-authored,
                                  or seeded from a compiled constant before any
                                  publication existed).
``upstream_tracking``             ``TEXT NOT NULL DEFAULT 'track'``, CHECK
                                  ``IN ('track', 'pinned')`` — whether this
                                  document accepts upstream publications at all.
===============================  ==============================================

``pdpub_01`` created the channel; this revision is the receiving end's
bookkeeping.

Two stored columns, and only two
================================

D3 is explicit that everything else is **derived on read, never stored**,
because staleness in a stored flag is the failure mode this design is avoiding:

* ``local_modified`` = ``body_sha256 <> (SELECT content_sha256 FROM
  coord.prompt_document_publications WHERE (kind, name, publication_version) =
  (this row's kind, name, upstream_publication_version))``. ``SUMMARY_COLS``
  already selects ``encode(sha256(convert_to(body,'UTF8')),'hex') AS
  body_sha256`` and the list read never selects ``body``, so this costs nothing
  new on either side.
* ``update_available`` = ``MAX(publication_version) >
  upstream_publication_version``, served by
  ``ix_prompt_document_publications_latest``.

Neither gets a column here. A stored ``local_modified`` would have to be
invalidated by every body write in the system, including the ones that arrive
through ``restore_version``, and the first one that forgot would silently
authorise an overwrite.

⚠️ The degrade polarity, restated where the columns live
========================================================

An **unresolvable** baseline digest — ``upstream_publication_version`` naming a
publication row that is not there, the column unreadable, a degraded read — is
UNKNOWN and MUST read ``local_modified = true``, so the fan-out **notifies
instead of adopting**.

This is the OPPOSITE polarity to the helper it resembles.
``is_unedited_seed_by_digest`` takes ``body_sha256_hex: Option<&str>`` and reads
its body arm as ``false`` on ``None`` — conservative for *its* question, which
is "never over-claim *unedited*". Copying that convention here inverts the
safety: a digest that could not be read would make a document look **clean**,
and a clean document is auto-overwritten. Same reading as served policy
``verification-and-evidence`` ``silent-empty-is-unknown``. The two helpers agree
in intent and differ in sign, so they cannot share a default.

``upstream_publication_version IS NULL`` is likewise UNKNOWN, not "up to date":
such a row is offered an *adoption* the first time a publication appears for its
``(kind, name)``, and is treated as ``local_modified`` unless its body matches
that publication byte for byte.

Why the snapshot table gets them too
====================================

Same reason ``agent_writable`` (``pdaw_01``) and ``agent_write_tier``
(``pdtier_01``) went on both: ``coord.prompt_document_versions`` is an
append-only immutable snapshot of what the parent looked like at that version,
and a restore that did not carry the upstream lineage forward would silently
reset a document's tracked publication to whatever the parent happens to hold —
turning a one-click revert into an untracked or mis-tracked document. Restoring
version N must restore *what version N was*, including where its body came from.

Both tables are widened in one loop from one list. That is the SQL half of the
"widen both together" rule; having only one list is the cheapest way to make a
partial widening unrepresentable.

Constraint names
================

Fixed by the plan and matching ``pdtier_01``'s scheme (explicit, stable, keyed
off the bare table name, so the drop-then-add pair is re-runnable and the
constraint is addressable by hand):

* ``ck_prompt_documents_upstream_tracking``
* ``ck_prompt_document_versions_upstream_tracking``

Both are ``NOT NULL DEFAULT 'track'`` columns, so — unlike ``pdtier_01``'s
nullable tier — the CHECK carries no ``IS NULL`` arm. There is no "no opinion"
state to represent: a document either accepts upstream publications or it is
pinned, and every existing row is defaulted to ``'track'``, which is the
behaviour those rows already have (nothing has ever pinned them).

``'track'`` as the default is the schema half of D6's ``auto`` default. The
*dial* — ``policy_upstream``, per tenant, ``auto | notify | off`` — is a
code-only change to ``coord.fleet_runtime_policy`` and lands in Phase 5; this
column is the per-**document** opt-out that sits under it. ``'pinned'`` wins
over any dial level; the dial cannot un-pin a document.

Locking
=======

``ADD COLUMN ... NOT NULL DEFAULT 'track'`` is a **catalog-only** change in
PG11+ — the constant default is recorded in ``pg_attribute.atthasmissing`` /
``attmissingval`` and no table rewrite happens — so the ``ACCESS EXCLUSIVE``
lock is held for the catalog update alone. ``lock_timeout`` is set anyway so the
migration fails fast rather than queueing that lock in front of every reader
behind a slow in-flight query. Adding the CHECK afterwards scans the table to
validate it; on these two tables (one row per document, one per version) that is
trivial, and doing it as a separate statement rather than inline keeps it
re-runnable — an inline CHECK inherits ``ADD COLUMN IF NOT EXISTS``'s no-op and
would be unfixable by re-upgrade.

Order is deliberate: columns on both tables first, then the CHECKs. Running the
CHECK **after** means a junk value that somehow survived into the column fails
here, loudly, instead of being locked in behind a constraint added while the
column was still uniformly ``'track'``.

Downgrade
=========

Drops the two CHECKs and then the two columns, on both tables. **Lossy in one
direction, stated rather than pretended away:** a document the operator had
``'pinned'`` comes back ``'track'`` on re-upgrade, and every row's
``upstream_publication_version`` is gone — so a re-upgraded fleet reads every
document as having no upstream, which under the polarity above means
``local_modified = true`` for all of them. That degrades to *notify*, never to
*adopt*, which is the safe direction and the reason the degrade rule is written
into the column comment rather than left to the reader.

The drop statements are built inside ``downgrade()`` rather than from a
module-level template on purpose: ``scripts/ci/check_coord_column_drops.py``
scans the whole module *minus the ``downgrade()`` body* for ``coord.*``
removals, so a shared template would be read as an upgrade-path drop and would
demand a ``COORD_SCHEMA_DROPS`` declaration for a drop the upgrade never makes.

The reversal is exercised by ``migration-reversal.yml`` ("Migration Reversal
Gate"), which runs upgrade -> ``downgrade -1`` -> upgrade against a real
PostgreSQL.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "pdpub_02"
down_revision: str | Sequence[str] | None = "pdpub_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Parent first, snapshot second — but both, always, from one list. Same list
# `pdaw_01` and `pdtier_01` used; see "Why the snapshot table gets them too".
_TABLES: tuple[str, ...] = (
    "coord.prompt_documents",
    "coord.prompt_document_versions",
)

# Explicit, stable CHECK names keyed off the bare table name. Fixed by the plan.
_TRACKING_CHECKS: dict[str, str] = {
    "coord.prompt_documents": "ck_prompt_documents_upstream_tracking",
    "coord.prompt_document_versions": "ck_prompt_document_versions_upstream_tracking",
}

# The tracking vocabulary, spelled ONCE, so the two CHECKs cannot drift into
# disagreeing about what a legal value is.
_TRACKING_VALUES: tuple[str, ...] = ("track", "pinned")
_TRACKING_LITERALS = ", ".join(f"'{value}'" for value in _TRACKING_VALUES)

_VERSION_COLUMN = "upstream_publication_version"
_TRACKING_COLUMN = "upstream_tracking"

# Plain string literals, schema-qualified, never f-strings — the
# `alembic-schema-arg-gate` pre-commit hook analyses these statically and skips
# any `op.execute` whose argument it cannot read as a constant. Written out per
# table rather than formatted from `_TABLES` for exactly that reason.
_ADD_COLUMNS = (
    "ALTER TABLE coord.prompt_documents "
    "ADD COLUMN IF NOT EXISTS upstream_publication_version INTEGER NULL",
    "ALTER TABLE coord.prompt_documents "
    "ADD COLUMN IF NOT EXISTS upstream_tracking TEXT NOT NULL DEFAULT 'track'",
    "ALTER TABLE coord.prompt_document_versions "
    "ADD COLUMN IF NOT EXISTS upstream_publication_version INTEGER NULL",
    "ALTER TABLE coord.prompt_document_versions "
    "ADD COLUMN IF NOT EXISTS upstream_tracking TEXT NOT NULL DEFAULT 'track'",
)


def upgrade() -> None:
    """Add the two upstream columns to both tables, then constrain the tracking."""
    # Catalog-only (nullable, or NOT NULL with a constant default), so the
    # ACCESS EXCLUSIVE lock is held for the catalog update alone. Fail fast
    # rather than queueing it in front of every reader.
    op.execute("SET LOCAL lock_timeout = '3s'")
    for statement in _ADD_COLUMNS:
        op.execute(statement)

    # Drop-then-add so a re-upgrade repairs a constraint that was added under
    # an earlier, different definition. No `IS NULL` arm: the column is
    # NOT NULL, and there is no "no opinion" state to represent.
    for table in _TABLES:
        constraint = _TRACKING_CHECKS[table]
        op.execute(f"ALTER TABLE {table} DROP CONSTRAINT IF EXISTS {constraint}")
        op.execute(
            f"ALTER TABLE {table} ADD CONSTRAINT {constraint} "
            f"CHECK ({_TRACKING_COLUMN} IN ({_TRACKING_LITERALS}))"
        )

    # The contracts a reader of the catalog cannot derive from the types — the
    # degrade polarity above all. Re-applied unconditionally so a re-upgrade
    # over already-present columns still installs them.
    op.execute(
        """
        COMMENT ON COLUMN coord.prompt_documents.upstream_publication_version IS
        'The coord.prompt_document_publications version this body was last '
        'derived from. NULL means NO UPSTREAM (hand-authored, or seeded from a '
        'compiled constant before any publication existed) — which is UNKNOWN, '
        'NOT "up to date". Advanced by an adopt AND by a "Keep mine" decline, '
        'which records "reviewed publication N" without touching the body; '
        'that is what clears the update badge. local_modified and '
        'update_available are DERIVED from this on read and are deliberately '
        'not stored: an UNRESOLVABLE baseline digest is UNKNOWN and must read '
        'local_modified = true, so the fan-out notifies instead of adopting. '
        'That is the OPPOSITE polarity to is_unedited_seed_by_digest''s None '
        'arm, because over-claiming clean here causes an automatic overwrite.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.prompt_documents.upstream_tracking IS
        'track = this document accepts upstream publications (subject to the '
        'per-tenant policy_upstream dial and to never overwriting a locally '
        'modified body); pinned = it never does, at any dial level. Defaults '
        'to track, which is the behaviour every pre-existing row already had. '
        'The dial cannot un-pin a document.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN
        coord.prompt_document_versions.upstream_publication_version IS
        'Snapshot of the parent''s upstream_publication_version at this '
        'version, so restoring version N restores WHERE ITS BODY CAME FROM as '
        'well as the body. Without it a one-click revert would leave the '
        'document tracking whatever publication the parent happened to hold.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.prompt_document_versions.upstream_tracking IS
        'Snapshot of the parent''s upstream_tracking at this version. Same '
        'carry-forward rule as upstream_publication_version and as '
        'agent_write_tier before it: widen or change the parent column and '
        'this one together.'
        """
    )


def downgrade() -> None:
    """Drop the CHECKs and the two columns from both tables.

    LOSSY: a ``'pinned'`` document returns as ``'track'`` on re-upgrade and
    every row's ``upstream_publication_version`` is gone, so a re-upgraded
    fleet reads every document as having no upstream. Under this revision's
    degrade polarity that means ``local_modified = true`` everywhere, which
    resolves to *notify*, never to *adopt* — the safe direction.

    The statements are constructed here rather than from a module-level
    template so ``check_coord_column_drops.py`` (which scans everything except
    this function body) does not read them as upgrade-path drops.
    """
    # CHECKs first. PostgreSQL would drop them with the column anyway; doing it
    # explicitly means a half-applied upgrade (constraint added, column somehow
    # absent) also reverses.
    for table in _TABLES:
        op.execute(
            f"ALTER TABLE {table} DROP CONSTRAINT IF EXISTS {_TRACKING_CHECKS[table]}"
        )

    op.execute("SET LOCAL lock_timeout = '3s'")
    # Dropped in the inverse of the upgrade's add order.
    for table in reversed(_TABLES):
        for column in (_TRACKING_COLUMN, _VERSION_COLUMN):
            op.execute(f"ALTER TABLE {table} DROP COLUMN IF EXISTS {column}")
