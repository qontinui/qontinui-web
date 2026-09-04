"""coord.prompt_document_publications — the tenant-agnostic distribution channel

Revision ID: pdpub_01
Revises: effect_calc_01_ui_bridge_effect_columns
Create Date: 2026-09-04

Phase 1 (first of two revisions) of plan
``2026-09-04-cross-tenant-policy-publishing``, design decision **D1**.

Why this table exists
=====================

The system tenant (``coord.tenants.is_system``) holds the policy corpus every
other tenant should be running, and today none of it can reach them:
``DEFAULT_PROMPT_DOCUMENTS`` is a compiled-in ``const`` array, and
``ensure_prompt_document_seeds`` inserts it ``ON CONFLICT (tenant_id, kind,
name) DO NOTHING`` — so a tenant seeded at ``policy/coordination`` v1 stays at
v1 forever while the system tenant moves to v18.

This revision adds the channel that fixes it: an **append-only, immutable,
tenant-agnostic** publication log. The system tenant publishes a body into it;
every other tenant reads *from the channel*, never across a tenant boundary.

**Rejected alternative, recorded so it is not re-proposed:** downstream tenants
reading the system tenant's live ``coord.prompt_documents`` row. Every query in
the prompt-document stack is tenant-pinned today (``get_document``,
``get_document_by_id``, ``list_summaries``, ``list_versions``, ``get_version``,
and the ``FOR UPDATE`` select inside ``apply_document_edit_tx``); a cross-tenant
read would be the first hole in that, shaped as a general capability rather than
one narrow channel. It would also ship the operator's in-progress edits the
instant he saves, and leave a customer with no immutable base to diff against.

Hand-authored
=============

``alembic revision --autogenerate`` is prohibited in this repo (see
``alembic/env.py`` and ``.github/PULL_REQUEST_TEMPLATE.md``) and, for
``coord.*``, by served policy ``production-and-cost``
``alembic-sole-authorship``: coord authors zero DDL, so every ``coord.*``
surface its reader touches lands here first. The 2026-07-13 missing-column
incident is why that ordering is a rule rather than a preference — and it is
why **this revision must be verified applied in production before the coord
build that reads the table deploys** (plan Phase 1, closing line).

The columns
===========

``publication_id UUID PK DEFAULT gen_random_uuid()``
    Surrogate key. ``gen_random_uuid()`` is the same builtin
    ``coord_prompt_docs_01`` uses for ``coord.prompt_documents.id``.

``kind TEXT NOT NULL`` / ``name TEXT NOT NULL``
    The ``(kind, name)`` pair addresses the *document*, tenant-independently.
    This is the read key, and it deliberately carries no ``tenant_id``.

``publication_version INTEGER NOT NULL``
    Monotonic **per ``(kind, name)``**, not global. Publication 3 of
    ``policy/testing`` is unrelated to publication 3 of ``policy/coordination``.
    Allocated by coord inside the publishing transaction; the unique index below
    is what makes a racing double-publish fail rather than fork the sequence.

``body TEXT NOT NULL``
    The published body, byte-verbatim. Immutable: a mistake is corrected by
    publishing again, never by rewriting or withdrawing a row — downstream
    tenants may already have adopted it offline.

``format TEXT NOT NULL DEFAULT 'markdown'``
    Mirrors ``coord.prompt_documents.format``. See "No CHECK on ``kind`` or
    ``format``" below for why no constraint is copied along with it.

``description TEXT``
    The document's ``description`` at publish time. NULL is legal (the parent
    column is nullable too).

``release_note TEXT``
    *Why this publication exists*, written by the publisher and shown to every
    downstream tenant in the update dialog and the adopt change-note. Nullable:
    the publish route may accept an empty note, and an absent note is not the
    same claim as an empty one.

``content_sha256 TEXT NOT NULL``
    Hex digest of ``body``. **This is the load-bearing column of D3.** The
    downstream ``local_modified`` predicate is
    ``body_sha256 <> content_sha256`` of the tracked publication, and
    ``SUMMARY_COLS`` already selects
    ``encode(sha256(convert_to(body,'UTF8')),'hex') AS body_sha256`` on the list
    read — so storing the digest here keeps the comparison free of a ``body``
    fetch on either side. Stored rather than computed on read so the digest of
    what was *published* survives any future change to how bodies are
    normalised.

    ⚠️ An **unresolvable** digest — this row absent, the column unreadable, a
    degraded read — is UNKNOWN and must read ``local_modified = true`` upstream,
    which is the OPPOSITE polarity to ``is_unedited_seed_by_digest``'s
    ``None`` arm. That helper must never over-claim *unedited*; this predicate
    must never over-claim *clean*, because a clean document is auto-overwritten.
    Same reading as ``verification-and-evidence`` ``silent-empty-is-unknown``.
    The two helpers agree in intent and differ in sign, so they cannot share a
    default. Recorded here because the column is the thing whose absence
    triggers it.

``source_tenant_id UUID NOT NULL``
    **Audit only; never a read key.** It records which tenant a publication came
    from so the log is attributable, and nothing may filter or join on it — the
    moment a downstream read binds it, this table stops being tenant-agnostic
    and becomes the cross-tenant read D1 rejected. No FK to ``coord.tenants``,
    matching ``coord.prompt_documents.tenant_id`` and its ancestors: coord-side
    seeding is warn-and-continue and an FK would re-introduce the inert-feature
    class documented in ``coord_policy_documents_default_source``.

``source_version INTEGER NOT NULL``
    The ``coord.prompt_documents.current_version`` that was published. Lets a
    reader tie a publication back to a specific version row in the source
    tenant's own history. Audit, like ``source_tenant_id``.

``published_by TEXT NOT NULL``
    Principal label of the publisher, same shape as ``updated_by`` /
    ``edited_by`` on the document tables.

``published_at TIMESTAMPTZ NOT NULL DEFAULT now()``
    Wall-clock publish time. Ordering is by ``publication_version``, not by
    this — two publications of the same document cannot share a version, but
    clocks are not a key.

The two indexes
===============

``uq_prompt_document_publications_kind_name_version`` — UNIQUE on
``(kind, name, publication_version)``. The plan's D1 requirement. It is the
integrity constraint that makes the per-document sequence a sequence: two
concurrent publishers cannot both claim version N. It also serves the
"fetch publication N of this document" read
(``GET /coord/prompt-document-publications/:kind/:name/:version``) and the
"list every publication of this document" scan, both on its leading columns.

``ix_prompt_document_publications_latest`` — on
``(kind, name, publication_version DESC)``. Serves the ``update_available``
derivation, ``MAX(publication_version) > upstream_publication_version``, which
runs once per document on every list read and again per tenant in the Phase 5
reconciler.

**Why a second index when the unique one has the same leading columns.** A
btree can be walked backwards, so PostgreSQL *can* answer the ``MAX()`` from the
unique index alone; the DESC index is not a correctness requirement and is not
claimed as one. It is written because the plan names it, and because the read it
serves is the hot one: the descending order makes the ``MAX()`` a plain
forward-scan first-row fetch, and — more usefully — a ``DISTINCT ON (kind, name)
… ORDER BY kind, name, publication_version DESC`` over the whole channel (the
shape the fan-out reconciler wants: *the latest publication of every document*)
reads straight off it in index order with no sort. The cost is one more index on
an append-only table nobody updates.

Both are ``CREATE INDEX``, not ``CONCURRENTLY``: the table is created empty in
this same revision, so there is nothing to lock out and no reason to leave the
transaction.

No CHECK on ``kind`` or ``format``
==================================

Deliberate, and it is the one place this revision reads as *narrower* than the
plan's DDL sketch, whose ``kind`` line carries the comment "same CHECK
vocabulary as ``prompt_documents``". That comment states the **vocabulary** —
which is true and unchanged — and this revision declines to store a **second
copy of the list**, for the reason its immediate sibling ``pdtier_01`` already
recorded when it made the same call for ``coord.prompt_document_kind_tiers``:

``coord_prompt_docs_02`` through ``_05`` widen the kind vocabulary by
*discovering and dropping every CHECK on ``coord.prompt_documents.kind``* and
re-adding a wider one — a loop whose ``pg_attribute`` join is scoped to that one
table's ``kind`` column. A sibling list on a **different** table is invisible to
it. A fourteenth kind would therefore be admitted by the document store and
rejected by this table, and the symptom would be a 23514 raised at *publish*
time on a document the store itself considers perfectly legal.

One vocabulary, one owner. The ``COMMENT ON COLUMN`` below points the next
reader at that owner. If a future revision wants referential enforcement, the
correct shape is a real ``coord.prompt_document_kinds`` lookup table that BOTH
the document CHECK and this column key off — one list, two consumers — not a
third copy of the list.

``format`` gets the same treatment for the additional reason
``coord_prompt_docs_05`` states about that column specifically: coord's
seed-time 23514 tolerance is scoped to constraints whose name contains
``kind``, so a ``format`` violation falls through to the bail-out arm. Nothing
is gained by adding a constraint whose only effect is to convert a widened
vocabulary into an unrecoverable failure.

What actually constrains what may be published is an **allowlist in coord**
(plan D2: the Behavior kinds only — the six Intent kinds and ``domain_spec``
are refused with a typed ``kind_not_publishable``). That is a judgement about
distribution, not about data validity, and it does not belong in a CHECK.

Idempotency and downgrade
=========================

``CREATE TABLE IF NOT EXISTS`` + ``CREATE ... INDEX IF NOT EXISTS``, so a
partially-applied run repairs itself on re-upgrade. ``COMMENT ON`` is
unconditionally re-applied, which is how the comments survive a re-run that
found the table already present.

The downgrade drops both indexes and then the table. It is **destructive and
not lossless** — the publication log has no representation in the pre-``pdpub_01``
schema, and the bodies it carries live nowhere else once the source tenant edits
past them. That is stated rather than mitigated: there is no boolean to collapse
into, as in ``pdtier_01``, and no earlier table to copy back to, as in
``coord_prompt_docs_01``. ``pdpub_02``'s ``upstream_publication_version``
survives a ``downgrade -1`` of *this* revision only because the two revisions
are downgraded in order; after both, the lineage is gone too.

The reversal is exercised by ``migration-reversal.yml`` ("Migration Reversal
Gate"), which runs upgrade -> ``downgrade -1`` -> upgrade against a real
PostgreSQL, so the drops have to be genuinely re-runnable.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "pdpub_01"
down_revision: str | Sequence[str] | None = "effect_calc_01_ui_bridge_effect_columns"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Plain string literals, schema-qualified, never f-strings — the
# `alembic-schema-arg-gate` pre-commit hook analyses these statically and skips
# any `op.execute` whose argument it cannot read as a constant.
_CREATE_TABLE = """
CREATE TABLE IF NOT EXISTS coord.prompt_document_publications (
    publication_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    kind                TEXT NOT NULL,
    name                TEXT NOT NULL,
    publication_version INTEGER NOT NULL,
    body                TEXT NOT NULL,
    format              TEXT NOT NULL DEFAULT 'markdown',
    description         TEXT,
    release_note        TEXT,
    content_sha256      TEXT NOT NULL,
    source_tenant_id    UUID NOT NULL,
    source_version      INTEGER NOT NULL,
    published_by        TEXT NOT NULL,
    published_at        TIMESTAMPTZ NOT NULL DEFAULT now()
)
"""

# The integrity constraint AND the by-document read path: two publishers cannot
# both claim version N of the same document.
_CREATE_UNIQUE_INDEX = """
CREATE UNIQUE INDEX IF NOT EXISTS uq_prompt_document_publications_kind_name_version
    ON coord.prompt_document_publications (kind, name, publication_version)
"""

# DESC on the version so `MAX(publication_version)` — and the fan-out's
# `DISTINCT ON (kind, name) ... ORDER BY kind, name, publication_version DESC`
# — read in index order rather than sorting.
_CREATE_LATEST_INDEX = """
CREATE INDEX IF NOT EXISTS ix_prompt_document_publications_latest
    ON coord.prompt_document_publications (kind, name, publication_version DESC)
"""


def upgrade() -> None:
    """Create the append-only publication channel plus its two indexes."""
    op.execute(_CREATE_TABLE)
    op.execute(_CREATE_UNIQUE_INDEX)
    op.execute(_CREATE_LATEST_INDEX)

    # Re-applied unconditionally so a re-upgrade over an already-present table
    # still installs (or repairs) the commentary. These are the contracts a
    # reader of the catalog cannot derive from the column types.
    op.execute(
        """
        COMMENT ON TABLE coord.prompt_document_publications IS
        'Append-only, immutable, TENANT-AGNOSTIC distribution channel for '
        'prompt documents (plan 2026-09-04-cross-tenant-policy-publishing, D1). '
        'The system tenant publishes a body here; every other tenant reads '
        'from this table and NEVER across a tenant boundary. Rows are never '
        'updated, deleted or withdrawn — a downstream tenant may already have '
        'adopted one offline, so a mistake is corrected by publishing again. '
        'Addressed by (kind, name, publication_version); source_tenant_id is '
        'audit only and must never appear in a read predicate.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.prompt_document_publications.kind IS
        'Same vocabulary as coord.prompt_documents.kind, which is the SOLE '
        'owner of that list — see ck_prompt_documents_kind and Rust''s '
        'prompt_documents::KINDS, its order-contractual twin. Deliberately '
        'carries no CHECK of its own: coord_prompt_docs_02..05 widen the '
        'vocabulary by discovering CHECKs on that one table''s kind column, so '
        'a second copy here would be invisible to the widening and would '
        'reject a newly-legal kind at publish time. Which kinds may be '
        'PUBLISHED is a narrower, separate allowlist enforced in coord.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.prompt_document_publications.publication_version IS
        'Monotonic per (kind, name), NOT global. Allocated inside the '
        'publishing transaction; uq_prompt_document_publications_kind_name_version '
        'is what makes a racing double-publish fail instead of forking the '
        'sequence.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.prompt_document_publications.content_sha256 IS
        'Hex sha256 of body. The downstream local_modified predicate is '
        'prompt_documents.body_sha256 <> this, so the comparison never fetches '
        'a body on either side. An UNRESOLVABLE digest (row absent, column '
        'unreadable, degraded read) is UNKNOWN and MUST read local_modified = '
        'true — the OPPOSITE polarity to is_unedited_seed_by_digest''s None '
        'arm, because over-claiming clean here causes an automatic overwrite.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.prompt_document_publications.source_tenant_id IS
        'AUDIT ONLY — never a read key, never a join or filter predicate. The '
        'moment a downstream read binds it, this table stops being '
        'tenant-agnostic and becomes the cross-tenant read D1 rejected. No FK '
        'to coord.tenants, matching coord.prompt_documents.tenant_id.'
        """
    )


def downgrade() -> None:
    """Drop the channel. Destructive: publication bodies live nowhere else.

    Indexes first, then the table — PostgreSQL would drop them with it anyway,
    but doing it explicitly means a half-applied upgrade (indexes present,
    table somehow absent, or vice versa) also reverses cleanly, which is what
    the Migration Reversal Gate re-runs.
    """
    op.execute("DROP INDEX IF EXISTS coord.ix_prompt_document_publications_latest")
    op.execute(
        "DROP INDEX IF EXISTS coord.uq_prompt_document_publications_kind_name_version"
    )
    op.execute("DROP TABLE IF EXISTS coord.prompt_document_publications")
