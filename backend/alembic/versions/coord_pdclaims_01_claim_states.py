"""coord prompt_document_claim_states — one current row per probed claim

Revision ID: coord_pdclaims_01
Revises: plan_library_04_diagnostic_refutes
Create Date: 2026-09-06

Phase 2 of plan ``2026-09-06-domain-spec-divergences-decay-with-no-re-probe``
(``qontinui-dev-notes/plans/2026-09-06-domain-spec-divergences-decay-with-no-re-probe.md``,
decisions D2 and D3; the wire and row shape are the shared probe-grammar
contract that plan's Phase 2 authors against).

A ``domain_spec`` prompt document may carry fenced ``probe`` blocks — one per
claim the document makes about the world, each naming a typed anchor coord's
``anchor_observer`` can resolve (``flag_state``, ``content``, and the existing
``blob`` / ``pr`` / ``migration`` / ``schema`` / ``flag`` types). Every
observer tick re-resolves each claim and lands the verdict here, so the served
read (``coord_get_prompt_document``, ``GET /coord/prompt-documents/:kind/:name``
and the operator proxy the console reads) can carry a ``claims`` array beside
``document`` — and a claim whose document has not been re-probed within the
staleness budget renders UNKNOWN rather than silently keeping the last answer.

Columns
=======

* ``tenant_id``       — ``UUID NOT NULL`` carrying **no FK**, the same posture
                        as ``coord.memory_anchor_observations``: observer rows
                        must never block a tenant delete and are pruned by the
                        observer, not by cascade.
* ``kind`` / ``name`` — the document address, ``coord.prompt_documents``'
                        ``(kind, name)`` pair. Not an FK to that row's ``id``
                        either: the address is what the probe block is parsed
                        out of and what the read is keyed by, and a document
                        restored, re-seeded or re-created under the same
                        address keeps its claim history rather than orphaning
                        it on a surrogate key.
* ``claim_id``        — the probe block's ``claim:`` id, kebab-case and unique
                        within the document.
* ``anchor``          — the block's ``anchor`` JSON object, verbatim, so the
                        served row can name ``anchor_type`` without re-parsing
                        the body.
* ``state``           — ``'confirmed'`` / ``'contradicted'`` / ``'unknown'``,
                        the plan's three-valued verdict, CHECK-constrained so a
                        fourth spelling cannot creep in from the writer. The
                        mapping from the observer's ``Resolution`` is
                        Unchanged → confirmed, Moved | Gone → contradicted,
                        Unresolved → unknown; **UNKNOWN never renders as
                        CONFIRMED**.
* ``observed_at``     — when the observer last resolved this claim. The
                        staleness rule on the served read compares the NEWEST
                        ``observed_at`` for the document against 3× the observer
                        tick, exactly as ``migration_at_head`` does.
* ``verified_at`` /
  ``verified_against`` — the block's own ``verified_at:`` / ``verified_against:``
                        lines (RFC 3339 UTC; ``<repo>@<sha-prefix>``), copied
                        through so the read can show what the AUTHOR verified
                        against beside what the observer just saw. Nullable:
                        a block missing either is malformed but still tracked.
* ``detail``          — ``JSONB NOT NULL DEFAULT '{}'::jsonb``; the observer's
                        finding for this claim (``reason``, the resolved value,
                        ``stale`` when the read applies the budget). Object,
                        not array, because it describes ONE claim.

Design notes
============

* **One CURRENT row per claim, not an oplog.** ``UNIQUE (tenant_id, kind,
  name, claim_id)`` and the observer UPSERTs on it. The sibling
  ``coord.memory_anchor_observations`` is an append-only history because its
  consumer (the shadow-window comparison) reads a rate over time; this table's
  consumer is the served document read, which needs the LATEST state per
  claim and nothing older — the staleness rule reads the newest
  ``observed_at``, the row render reads the current ``state``. History of a
  claim flipping is the observer's ALERT stream (one ``coord.alerts`` row per
  CONTRADICTED claim, ``prompt-document-claim:<kind>/<name>/<claim_id>``),
  which is where a "when did this go wrong" question is answered. An oplog
  here would make every read a ``DISTINCT ON`` over rows that grow by the
  claim count every tick, for a question nobody asks of this table.
* **Index shape is the read's shape.** ``idx_prompt_document_claim_states_doc``
  on ``(tenant_id, kind, name)`` serves "every claim row for this document",
  which is the only read the served envelope makes; the UNIQUE constraint's
  own index serves the observer's upsert.
* **``tenant_id`` first in both**, because every read and write on this table
  is tenant-scoped, and a leading tenant column is what lets one tenant's
  probe-heavy document stay cheap for every other tenant.
* **The ``::jsonb`` cast on the default is load-bearing**, as it is in every
  sibling: an untyped ``'{}'`` leaves the literal's type unresolved where a
  ``jsonb`` one is required.
* Idempotency: every DDL uses ``IF NOT EXISTS`` / ``IF EXISTS`` so a re-run
  against an already-applied DB is a no-op. The UNIQUE constraint is declared
  inline in the ``CREATE TABLE`` so it rides that guard rather than needing an
  ``ADD CONSTRAINT`` that has no ``IF NOT EXISTS`` form.

Hand-written rather than autogenerated: ``alembic revision --autogenerate`` is
banned in this repo (served policy ``production-and-cost``
``alembic-sole-authorship``).

*Deploy order:* this migration must land and deploy **BEFORE** the coord
build that reads the table — the same ordering ``coord.memory_anchor_observations``
followed and the 2026-07-13 missing-column incident class. Coord is written to
DEGRADE rather than fail until then: a ``42P01 undefined_table`` on this
relation serves ``claims_state_source: "table_absent"`` with every claim
UNKNOWN, never an empty ``claims`` array. The table name must also be added to
coord's ``schema_manifest::ALEMBIC_OWNED_TABLES``; that edit lives in the coord
repo and is not made here.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coord_pdclaims_01"
down_revision: str | Sequence[str] | None = "plan_library_04_diagnostic_refutes"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Index name, stated once so upgrade and downgrade cannot drift.
_IX_DOC = "idx_prompt_document_claim_states_doc"


def upgrade() -> None:
    """Create coord.prompt_document_claim_states + its per-document index."""
    # ----------------------------------------------------------------
    # 1. The current-state table. Raw SQL rather than op.create_table
    #    for the same reason as the sibling observer tables: the
    #    IF NOT EXISTS guard, the '{}'::jsonb default and the inline
    #    CHECK / UNIQUE all want to be stated literally.
    # ----------------------------------------------------------------
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.prompt_document_claim_states (
            id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id         UUID NOT NULL,
            kind              TEXT NOT NULL,
            name              TEXT NOT NULL,
            claim_id          TEXT NOT NULL,
            anchor            JSONB NOT NULL,
            state             TEXT NOT NULL
                              CHECK (state IN ('confirmed', 'contradicted', 'unknown')),
            observed_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
            verified_at       TIMESTAMPTZ NULL,
            verified_against  TEXT NULL,
            detail            JSONB NOT NULL DEFAULT '{}'::jsonb,
            UNIQUE (tenant_id, kind, name, claim_id)
        )
        """
    )

    # ----------------------------------------------------------------
    # 2. "Every claim for this document" — the served read's only shape.
    # ----------------------------------------------------------------
    op.execute(
        f"""
        CREATE INDEX IF NOT EXISTS {_IX_DOC}
            ON coord.prompt_document_claim_states (tenant_id, kind, name)
        """
    )


def downgrade() -> None:
    """Reverse: drop the index, then the table.

    ``DROP TABLE`` would take the index with it, but it is dropped
    explicitly first for symmetry with its explicit CREATE — and so a
    partially-applied upgrade downgrades cleanly either way. The index
    name is schema-qualified: an index lives in its table's schema, and
    ``DROP INDEX`` does not resolve through ``search_path`` the way the
    table reference does. Nothing references this table, so a plain
    ``DROP TABLE`` suffices.
    """
    op.execute(f"DROP INDEX IF EXISTS coord.{_IX_DOC}")
    op.execute("DROP TABLE IF EXISTS coord.prompt_document_claim_states")
