"""coord.topics + topic_members + topic_aliases + subproject_vectors — subproject topics

Phase 1 (the qontinui-web half, which lands FIRST) of plan
``2026-11-16-subproject-topics-agents-and-coord-group-subprojects-into-topics-without-the-operator``.
Creates four new, empty tables, their table comments and their uniques in ONE
transaction, then one plain index on ``coord.topics`` concurrently (see
"Indexes")::

    coord.topics (id, tenant_id, slug, title, summary, next_steps, status,
                  parent_topic_id, intent_ref, created_by, created_by_session,
                  merged_into, last_rollup, last_rollup_as_of, created_at,
                  updated_at)
        uq_topics_tenant_slug     UNIQUE (tenant_id, slug)
        idx_topics_tenant_status  (tenant_id, status)

    coord.topic_members (id, tenant_id, topic_id, subproject_id, weight, state,
                         basis, decided_by, decided_by_session, created_at,
                         updated_at, removed_at)
        uq_topic_members_live_topic_subproject  UNIQUE (topic_id, subproject_id)
            WHERE removed_at IS NULL
        idx_topic_members_live_subproject       (tenant_id, subproject_id)
            WHERE removed_at IS NULL

    coord.topic_aliases (tenant_id, topic_id, alias, created_at)
        topic_aliases_pkey                  PRIMARY KEY (tenant_id, alias)
        uq_topic_aliases_tenant_lower_alias UNIQUE (tenant_id, lower(alias))

    coord.subproject_vectors (tenant_id, subproject_id, doc_digest, model,
                              vector, submitted_by_session, submitted_at)
        subproject_vectors_pkey  PRIMARY KEY (tenant_id, subproject_id)

Every name, type, default, CHECK and unique is the one the plan's shared
implementation contract fixes (as amended by the plan's "Vet amendments"
B3 and B10), which the coord phases of the same plan are built against in
parallel. A shape change here is a contract change there.

Why these tables exist
======================

Subprojects (``coord.subprojects``) group one piece of work's sessions, gates,
work units and PRs. Many subprojects pursue one standing concern ("Overlord",
"Priorities"), and nothing groups them, so the operator curates that grouping
by hand. A topic is that grouping, maintained by agents and coord with no
operator curation: every membership carries the evidence that put it there
(``basis``) and every topic rolls up its subprojects' health
(``last_rollup``).

Column authority — ``coord.topics``
===================================

* ``id uuid PRIMARY KEY DEFAULT gen_random_uuid()``; ``tenant_id uuid NOT
  NULL`` (no foreign key, as for ``coord.subprojects``); ``slug text NOT NULL``
  unique per tenant; ``title text NOT NULL``; ``summary`` / ``next_steps``
  (text, NULL until written).
* ``status text NOT NULL DEFAULT 'proposed'`` — ``proposed`` | ``active`` |
  ``dormant`` | ``retired``.
* ``parent_topic_id uuid`` -> ``coord.topics (id)`` — topics nest.
* ``intent_ref jsonb`` — the Intent prompt document the topic serves, if any.
* ``created_by text NOT NULL`` — ``agent`` | ``coord`` | ``steward`` |
  ``operator``; ``created_by_session uuid`` — the harness session that created
  it, when an agent did.
* ``merged_into uuid`` -> ``coord.topics (id)`` — set when a topic is merged
  into another; the row stays.
* ``last_rollup jsonb`` / ``last_rollup_as_of timestamptz`` — the health
  rollup cache over CONFIRMED members, written only by coord. NULL means never
  rolled up, which the list door serves as headline ``null`` — never a default.
* ``created_at`` / ``updated_at timestamptz NOT NULL DEFAULT now()``.

Column authority — ``coord.topic_members``
==========================================

A durable LEDGER of topic <-> subproject memberships (a subproject may belong
to several topics, each with its own weight).

* ``topic_id uuid NOT NULL`` -> ``coord.topics (id)``; ``subproject_id uuid NOT
  NULL`` (no foreign key: like every ledger key in ``coord.subproject_members``
  it may outlive its referent, and the B5 carry-over re-homes it in coord).
* ``weight real NOT NULL DEFAULT 0``, CHECK ``0 <= weight <= 1``.
* ``state text NOT NULL`` — ``proposed`` | ``confirmed`` | ``rejected``.
* ``basis jsonb NOT NULL DEFAULT '[]'`` — an array of ``{signal, ref, score,
  note?}``, every piece of evidence for the membership. ``signal`` is one of
  ``plan_family`` | ``pr_edge`` | ``gate_chain`` | ``files`` | ``semantic`` |
  ``declared`` | ``intent``; a family that could not be read is recorded as
  ``{signal, ref: "could_not_read", score: null}``. The element shape is coord's
  to enforce, not a CHECK's.
* ``decided_by text NOT NULL`` — ``coord`` | ``agent`` | ``steward`` |
  ``operator``; ``decided_by_session uuid``.
* ``created_at`` / ``updated_at timestamptz NOT NULL DEFAULT now()``,
  ``removed_at timestamptz`` — NULL is a LIVE membership; a removal stamps it,
  so the history stays in the ledger and the live unique releases.

Column authority — ``coord.topic_aliases``
==========================================

``tenant_id``, ``topic_id`` -> ``coord.topics (id)``, ``alias text``,
``created_at``. An alias resolves to one topic per tenant, case-insensitively:
``UNIQUE (tenant_id, lower(alias))`` as a unique index.

The contract gives this table no key of its own. It gets ``PRIMARY KEY
(tenant_id, alias)``, which the case-insensitive unique already implies (two
rows equal on ``alias`` are equal on ``lower(alias)``), so it refuses no row
the contract admits. It is there for the replica identity: the
logical-replication publication covers schema ``coord`` and PostgreSQL refuses
UPDATE/DELETE on a published table with none, which
``tests/test_replica_identity_published_schemas.py`` guards at head. An
expression index cannot serve as ``REPLICA IDENTITY USING INDEX``, and an
``ALTER TABLE … REPLICA IDENTITY FULL`` is a statement coord's migration
classifier refuses, so a primary key is the only identity that keeps this
revision auto-landable.

Column authority — ``coord.subproject_vectors``
===============================================

Created now and written only once the plan's Phase 4 lands (vet B3).
``tenant_id``, ``subproject_id`` (``PRIMARY KEY (tenant_id, subproject_id)``),
``doc_digest text`` — the digest of the subproject document the vector was
computed from (coord ignores a vector whose digest no longer matches),
``model text``, ``vector vector(384)`` (pgvector, the same dimension as
``coord.memory_records.embedding``; coord reads it as ``::real[]``),
``submitted_by_session uuid``, ``submitted_at timestamptz NOT NULL DEFAULT
now()``. No vector index: coord computes cosine in process over the open rows.

pgvector
--------

``vector(384)`` needs the ``vector`` extension. It is NOT created here:
``coord_memory_records`` (an ancestor of this revision in the chain) runs
``CREATE EXTENSION IF NOT EXISTS vector`` and asserts pgvector >= 0.5.0, so the
type exists whenever this revision runs. Repeating that guard here would make
the revision unlandable by coord's merge train: its migration classifier
refuses any ``CREATE EXTENSION`` ("unrecognized CREATE statement") and any
SQL executed through ``op.get_bind()``, while every statement below is a shape
it admits.

Constraints
===========

* Vocabularies: ``ck_topics_status``, ``ck_topics_created_by``,
  ``ck_topic_members_state`` and ``ck_topic_members_decided_by``;
  ``ck_topic_members_weight`` pins ``weight`` to ``[0, 1]``.
* Foreign keys: ``fk_topics_parent_topic``, ``fk_topics_merged_into``,
  ``fk_topic_members_topic`` and ``fk_topic_aliases_topic``, all NO ACTION.
  A topic is retired or merged, never deleted, so a DELETE that would orphan a
  member, an alias, a child or a merge pointer is refused.
* Uniques: ``uq_topics_tenant_slug``; the partial
  ``uq_topic_members_live_topic_subproject`` (one LIVE membership of a
  subproject in a topic; a coord upsert naming it as its ``ON CONFLICT``
  arbiter must restate ``WHERE removed_at IS NULL``); the expression unique
  ``uq_topic_aliases_tenant_lower_alias``.

Indexes
=======

The uniques and ``idx_topic_members_live_subproject`` are built in the SAME
transaction as the tables — a plain ``CREATE [UNIQUE] INDEX IF NOT EXISTS``,
never ``CONCURRENTLY`` — so the tables and every unique that guards them
become visible in one commit. coord's migration classifier admits each such
build as a new-table CLAIM (the table was created earlier in this file), which
the merge engine discharges by proving trunk has never named the table
(``pr_merge::migration_new_table_proof``: a case-insensitive ``git grep`` of
the whole tree for the bare table name, a ``git log -S`` history read over the
versions directory, and a live ``to_regclass`` read of coord's catalog).
``topic_members`` and ``topic_aliases`` pass both git reads on ``origin/main``
at authoring time; the catalog read is settled only at merge time. Because the
grep covers the whole tree, a sibling web PR naming either table must land
AFTER this one.
``topics`` cannot: the bare word already appears in trunk
(``coord.correlation_topics`` and others), so a claim on ``coord.topics``
would be refuted and the revision blocked. ``coord.topics`` therefore carries
no in-transaction index build: its one plain index,
``idx_topics_tenant_status``, is built ``CONCURRENTLY IF NOT EXISTS`` in an
``autocommit_block()`` AFTER the table transaction commits (the table is empty,
so the build is instant), and its ``UNIQUE (tenant_id, slug)`` is a table
constraint inside ``CREATE TABLE``. That index is not a unique, so a killed
build leaving it INVALID costs only a plan choice; recovery is ``DROP INDEX
CONCURRENTLY coord.idx_topics_tenant_status`` and a re-run.

Lock posture
============

Nothing here touches an existing table: every foreign key points at
``coord.topics``, which this transaction creates; ``tenant_id`` and
``subproject_id`` carry no key; every in-transaction index is on a table this
transaction created, and the one concurrent build runs on the just-created,
still-empty ``coord.topics`` (``SHARE UPDATE EXCLUSIVE``, which blocks no
reader or writer). The upgrade requests no lock a live reader or writer of an
existing table holds and needs no ``lock_timeout``. The downgrade drops only these four tables.

Idempotency / authorship posture
================================

* ``CREATE TABLE IF NOT EXISTS`` / ``CREATE [UNIQUE] INDEX IF NOT EXISTS`` /
  ``COMMENT ON``, one transaction, then the one concurrent index; a symmetric ``downgrade()`` drops the
  indexes, then the tables that reference ``coord.topics``, then
  ``coord.topics``.
* **alembic is the SOLE author of the ``coord.*`` schema** (served policy
  ``production-and-cost`` ``alembic-sole-authorship``). coord only INSERTs,
  UPDATEs and SELECTs these tables. The plan's Phase 2 registers them in
  coord's ``schema_manifest::ALEMBIC_OWNED_TABLES`` as non-critical, so coord's
  topic doors answer ``503 schema_migration_pending`` until this applies.
* Privileges for the ``coord_tenant`` / ``coord_tenant_preflight`` roles come
  from ``coordrls_01``'s ``ALTER DEFAULT PRIVILEGES``.
* No backfill: this revision writes no rows.
* Every SQL string is a static literal with no ``:word`` sequence and no
  ``%``.

Chaining
========

``down_revision = "contproof_01_gates_continuation_start_proof"`` — ``main``'s
single alembic head, measured 2026-11-20 at ``origin/main`` ``1f4023674``. A
re-point is three coupled edits: ``down_revision``, the ``Revises:`` line
below, and ``_PARENT_REVISION_ID`` in
``tests/test_coord_topics_01_migration.py``.

Revision ID: coord_topics_01
Revises: design_refs_split_intake_01
Create Date: 2026-11-20

"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coord_topics_01"
down_revision: str | None = "design_refs_split_intake_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create the tables, comments and uniques in ONE transaction, then one index."""
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.topics (
            id                  uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id           uuid         NOT NULL,
            slug                text         NOT NULL,
            title               text         NOT NULL,
            summary             text,
            next_steps          text,
            status              text         NOT NULL DEFAULT 'proposed',
            parent_topic_id     uuid,
            intent_ref          jsonb,
            created_by          text         NOT NULL,
            created_by_session  uuid,
            merged_into         uuid,
            -- written only by coord's rollup (plan D7, vet B9)
            last_rollup         jsonb,
            last_rollup_as_of   timestamptz,
            created_at          timestamptz  NOT NULL DEFAULT now(),
            updated_at          timestamptz  NOT NULL DEFAULT now(),
            CONSTRAINT uq_topics_tenant_slug UNIQUE (tenant_id, slug),
            CONSTRAINT fk_topics_parent_topic
                FOREIGN KEY (parent_topic_id) REFERENCES coord.topics (id),
            CONSTRAINT fk_topics_merged_into
                FOREIGN KEY (merged_into) REFERENCES coord.topics (id),
            CONSTRAINT ck_topics_status CHECK (status IN
                ('proposed', 'active', 'dormant', 'retired')),
            CONSTRAINT ck_topics_created_by CHECK (created_by IN
                ('agent', 'coord', 'steward', 'operator'))
        )
        """
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.topic_members (
            id                  uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id           uuid         NOT NULL,
            topic_id            uuid         NOT NULL,
            subproject_id       uuid         NOT NULL,
            weight              real         NOT NULL DEFAULT 0,
            state               text         NOT NULL,
            -- an array of {signal, ref, score, note?}
            basis               jsonb        NOT NULL DEFAULT '[]',
            decided_by          text         NOT NULL,
            decided_by_session  uuid,
            created_at          timestamptz  NOT NULL DEFAULT now(),
            updated_at          timestamptz  NOT NULL DEFAULT now(),
            -- NULL = a live membership
            removed_at          timestamptz,
            CONSTRAINT fk_topic_members_topic
                FOREIGN KEY (topic_id) REFERENCES coord.topics (id),
            CONSTRAINT ck_topic_members_weight CHECK (
                weight >= 0 AND weight <= 1),
            CONSTRAINT ck_topic_members_state CHECK (state IN
                ('proposed', 'confirmed', 'rejected')),
            CONSTRAINT ck_topic_members_decided_by CHECK (decided_by IN
                ('coord', 'agent', 'steward', 'operator'))
        )
        """
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.topic_aliases (
            tenant_id   uuid         NOT NULL,
            topic_id    uuid         NOT NULL,
            alias       text         NOT NULL,
            created_at  timestamptz  NOT NULL DEFAULT now(),
            -- implied by the case-insensitive unique below; it is the
            -- replica identity the coord publication requires
            CONSTRAINT topic_aliases_pkey PRIMARY KEY (tenant_id, alias),
            CONSTRAINT fk_topic_aliases_topic
                FOREIGN KEY (topic_id) REFERENCES coord.topics (id)
        )
        """
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.subproject_vectors (
            tenant_id             uuid         NOT NULL,
            subproject_id         uuid         NOT NULL,
            doc_digest            text         NOT NULL,
            model                 text         NOT NULL,
            vector                vector(384)  NOT NULL,
            submitted_by_session  uuid,
            submitted_at          timestamptz  NOT NULL DEFAULT now(),
            CONSTRAINT subproject_vectors_pkey PRIMARY KEY (tenant_id, subproject_id)
        )
        """
    )
    op.execute(
        """
        COMMENT ON TABLE coord.topics IS
            'One row per topic, a named group of subprojects pursuing one standing '
            'concern (plan '
            '2026-11-16-subproject-topics-agents-and-coord-group-subprojects-into-topics-without-the-operator). '
            'Rows are written by coord only, and alembic authors the DDL. '
            'last_rollup and last_rollup_as_of are written only by coord, and NULL '
            'there means never rolled up. A merged topic keeps its row, with '
            'merged_into naming the target.'
        """
    )
    op.execute(
        """
        COMMENT ON TABLE coord.topic_members IS
            'Durable ledger of topic to subproject memberships (plan '
            '2026-11-16-subproject-topics-agents-and-coord-group-subprojects-into-topics-without-the-operator). '
            'basis is an array of evidence entries {signal, ref, score, note}. '
            'removed_at NULL is a live membership, and a subproject is a live '
            'member of a topic at most once.'
        """
    )
    op.execute(
        """
        COMMENT ON TABLE coord.topic_aliases IS
            'Alternative names of a coord.topics row, unique per tenant '
            'case-insensitively (plan '
            '2026-11-16-subproject-topics-agents-and-coord-group-subprojects-into-topics-without-the-operator).'
        """
    )
    op.execute(
        """
        COMMENT ON TABLE coord.subproject_vectors IS
            'One semantic vector per subproject, computed by an agent from the '
            'subproject document whose digest is doc_digest (plan '
            '2026-11-16-subproject-topics-agents-and-coord-group-subprojects-into-topics-without-the-operator, '
            'Phase 4). A vector whose digest no longer matches is ignored, never '
            'used stale.'
        """
    )
    # The uniques (and the live-subproject index) are built here, in the
    # transaction that created their table, so the tables and every unique that
    # guards them commit together. Never CONCURRENTLY: coord's migration
    # classifier admits these builds as new-table claims.
    #
    # A subproject is a live member of a topic at most once.
    op.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS uq_topic_members_live_topic_subproject
            ON coord.topic_members (topic_id, subproject_id)
            WHERE removed_at IS NULL
        """
    )
    # A subproject's live topic memberships.
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_topic_members_live_subproject
            ON coord.topic_members (tenant_id, subproject_id)
            WHERE removed_at IS NULL
        """
    )
    # An alias names one topic per tenant, whatever its case.
    op.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS uq_topic_aliases_tenant_lower_alias
            ON coord.topic_aliases (tenant_id, lower(alias))
        """
    )
    # The list door's read: a tenant's topics by status. Built CONCURRENTLY
    # after the commit above, so coord.topics is not a new-table claim: the
    # merge engine's trunk proof greps for the bare name "topics", which
    # unrelated trunk files (coord.correlation_topics, ...) already contain.
    # Not a unique, so an INVALID leftover from a killed build loses no
    # guarantee; recovery is DROP INDEX CONCURRENTLY and a re-run.
    with op.get_context().autocommit_block():
        op.execute(
            """
            CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_topics_tenant_status
                ON coord.topics (tenant_id, status)
            """
        )


def downgrade() -> None:
    """Drop the indexes, then the tables that reference ``coord.topics``, then it."""
    op.execute("DROP INDEX IF EXISTS coord.uq_topic_aliases_tenant_lower_alias")
    op.execute("DROP INDEX IF EXISTS coord.idx_topic_members_live_subproject")
    op.execute("DROP INDEX IF EXISTS coord.uq_topic_members_live_topic_subproject")
    op.execute("DROP INDEX IF EXISTS coord.idx_topics_tenant_status")
    op.execute("DROP TABLE IF EXISTS coord.subproject_vectors")
    op.execute("DROP TABLE IF EXISTS coord.topic_aliases")
    op.execute("DROP TABLE IF EXISTS coord.topic_members")
    op.execute("DROP TABLE IF EXISTS coord.topics")
