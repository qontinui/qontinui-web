"""coord.schema_read_surfaces — the durable ``main`` half of the column-drop guard

Revision ID: schrs_01
Revises: cciobs_01
Create Date: 2026-09-07

Phase 1b of plan ``2026-09-03-coord-column-drop-guard-on-web-migrations``,
adopting the storage design vetted in the peer plan
``2026-09-06-devops-coord-column-drop-guard-has-no-served-manifest`` (§5b, and
its Phase 3 row). The table is created here, in qontinui-web, because Alembic
is the sole author of the ``coord.*`` schema — coord (Rust) cannot author DDL
[policy: ``alembic-sole-authorship``].

Why the table exists
====================

The ``coord-column-drop-guard`` CI check refuses to land a qontinui-web
revision that drops or renames a ``coord.*`` column while any coord still reads
it. "Any coord" is two halves, unioned: the **deployed** binary (served from a
compiled-in constant plus its build sha) and the code that has **landed on
``main``**, which may be ahead of what is serving. The ``main`` half has to be
pushed by coord's CI on every land and read back by the guard's route,
``GET /coord/schema/read-surfaces``, so it needs a store that survives a coord
restart and a deploy. A Redis key was considered and rejected as
**fail-random**: an eviction or a flush would make the half vanish with no
reason attached, and the guard would then have to choose between blocking every
drop and silently checking against nothing. A row in Postgres either exists or
does not, and its absence can be named (``main_unavailable_reason``).

Semantics: latest row per ``(repo, branch)``, not a history
===========================================================

**One row per ``(repo, branch)``, replaced on every land.** The primary key is
``(repo, branch)`` and the ingest UPSERTs on it. The only reader ever asks
"what does ``main`` read right now"; a sha-keyed history would grow without
bound behind a query that is always ``WHERE branch = 'main'`` and would need a
retention policy nobody asked for. Historical reconstruction ("what did main
read at sha X") is served by the guard's ``--manifest-json`` reading a file,
not by this table.

Columns, verbatim from §5b of the peer plan (the coord route that consumes them
is written from that same text, so the names are part of the interface):

==============  =========================  ===============================================
column          type                       meaning
==============  =========================  ===============================================
``repo``        ``TEXT NOT NULL``          GitHub ``full_name`` (``qontinui/qontinui-coord``)
                                           — the ``coord.repo_branches.repo`` spelling, so
                                           the ingest's staleness rule can join on it.
``branch``      ``TEXT NOT NULL``          Branch the surfaces were extracted on.
``sha``         ``TEXT NOT NULL``          Full 40-hex commit the surfaces were extracted
                                           at; the guard's contract, checked on write.
``surfaces``    ``JSONB NOT NULL``         ``[[table, column, source], …]``, non-empty.
``pushed_at``   ``TIMESTAMPTZ NOT NULL``   ``DEFAULT now()`` — when this row last landed.
==============  =========================  ===============================================

Two CHECKs make the two write-side contracts durable rather than advisory:
``sha`` must be exactly 40 lowercase hex characters, and ``surfaces`` must be a
JSON **array** with at least one element. The ingest validates both before it
writes (and additionally rejects a ``sha`` that is not
``coord.repo_branches.head_sha``, which only the ingest can know); the CHECKs
are the floor beneath it, so a hand-written row cannot serve the guard a
malformed manifest.

No secondary index: the primary key already answers the one query the reader
makes, and a table with one row per branch of a handful of repos has nothing
to index.

Deploy ordering — the ADD direction of ``alembic-sole-authorship``
================================================================

This revision lands **first**. coord's ingest (``POST
/coord/schema/read-surfaces-snapshot``) and the ``main`` arm of
``GET /coord/schema/read-surfaces`` read and write this table, so the coord PR
that ships them is held until this migration has been applied in production —
a coord read of a ``coord.*`` object needs its qontinui-web migration applied
FIRST, and a dependency label does not order the merge train. Until then the
route serves ``main: null`` with a reason, and the guard fails closed.

Downgrade
=========

Drops the table. Lossy by definition — the row is a projection of coord CI's
last push and is rebuilt by the next land on each branch, so nothing of record
is lost. The drop is written **literally inside ``downgrade()``** — a direct
``op.drop_table`` call in the function body, no helper, no module-level
string — because ``scripts/ci/check_coord_column_drops.py`` scans the whole
module minus the ``downgrade()`` body for ``coord.*`` removals. Hoisting the
drop into a template would make this revision block on the very gate the table
exists to serve. ``pdpub_02`` is the worked example of the same shape.

The reversal is exercised by ``migration-reversal.yml`` ("Migration Reversal
Gate"), which runs upgrade -> ``downgrade -1`` -> upgrade against a real
PostgreSQL.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "schrs_01"
down_revision: str | Sequence[str] | None = "cciobs_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_TABLE = "schema_read_surfaces"

# Explicit, stable constraint names so each is addressable by hand and the
# CHECKs cannot be re-created anonymously under a drifted definition.
_PK_NAME = "schema_read_surfaces_pkey"
_CK_SHA = "ck_schema_read_surfaces_sha_40hex"
_CK_SURFACES = "ck_schema_read_surfaces_nonempty_array"


def upgrade() -> None:
    """Create ``coord.schema_read_surfaces``: one replaced row per ``(repo, branch)``."""
    op.create_table(
        _TABLE,
        # GitHub full_name (qontinui/qontinui-coord) — the coord.repo_branches
        # spelling, so the ingest's staleness rule joins on it directly.
        sa.Column(
            "repo",
            sa.Text(),
            nullable=False,
            comment=(
                "GitHub full_name of the producing repo (e.g. qontinui/qontinui-coord), "
                "in the coord.repo_branches.repo spelling so the ingest can join on it. "
                "Half of the primary key: one row per (repo, branch), replaced on every "
                "land — NOT a sha-keyed history."
            ),
        ),
        sa.Column(
            "branch",
            sa.Text(),
            nullable=False,
            comment=(
                "Branch the read surfaces were extracted on. The guard's reader always "
                "asks for 'main'; other branches are permitted but nothing reads them."
            ),
        ),
        # Full 40-hex git sha; the guard's contract, checked on write.
        sa.Column(
            "sha",
            sa.Text(),
            nullable=False,
            comment=(
                "Full 40-hex commit the surfaces were extracted at. The ingest rejects a "
                "push whose sha is not coord.repo_branches.head_sha for this (repo, "
                "branch), so a stored row is never stale relative to what coord knows "
                "has landed; the reader still serves main: null plus a reason rather "
                "than a stale 200 if they disagree at read time."
            ),
        ),
        # [[table, column, source], …] — the manifest the guard unions.
        sa.Column(
            "surfaces",
            postgresql.JSONB(),
            nullable=False,
            comment=(
                "JSON array of [table, column, source] triples naming every coord.* "
                "column the code at `sha` reads; `source` is file:line. Non-empty by "
                "CHECK: an empty manifest would read as 'main reads nothing' and "
                "authorise every drop."
            ),
        ),
        sa.Column(
            "pushed_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
            comment=(
                "When this row was last written by coord CI's main-push workflow. "
                "Plain column default, evaluated per row at INSERT; the ingest's "
                "UPSERT sets it explicitly on conflict."
            ),
        ),
        sa.PrimaryKeyConstraint("repo", "branch", name=_PK_NAME),
        sa.CheckConstraint("sha ~ '^[0-9a-f]{40}$'", name=_CK_SHA),
        sa.CheckConstraint(
            "jsonb_typeof(surfaces) = 'array' AND jsonb_array_length(surfaces) > 0",
            name=_CK_SURFACES,
        ),
        schema="coord",
        comment=(
            "The durable `main` half of the coord column-drop guard: for each "
            "(repo, branch), the coord.* columns the code at `sha` reads, pushed by "
            "coord CI on every land and served by GET /coord/schema/read-surfaces. "
            "Latest row per (repo, branch), replaced on every land; not a history. "
            "Authored by qontinui-web alembic (schrs_01); coord reads and UPSERTs "
            "it but never authors DDL against it."
        ),
    )


def downgrade() -> None:
    """Drop ``coord.schema_read_surfaces``.

    Lossy only in the sense that the next land on each branch rebuilds the row.
    The drop is a literal call in this body on purpose: the column-drop guard
    scans everything EXCEPT ``downgrade()``, and a hoisted template would read
    as an upgrade-path drop of the very table this gate is served from.
    """
    op.drop_table(_TABLE, schema="coord")
