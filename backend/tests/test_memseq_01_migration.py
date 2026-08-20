"""Data-semantics test for the ``memseq_01`` revision.

``memseq_01_memory_records_seq`` adds ``coord.memory_records.seq``, the
monotone write-order key that ``facets``, ``list_records_page`` (and its keyset
cursor) and ``anchored_search`` now break ``created_at`` ties on. The column is
schema, but its whole VALUE is in three properties that a plain ``upgrade``
exercises without asserting:

* the **backfill order** — existing rows are numbered by
  ``(created_at, memory_id)``, a reconstruction of write order rather than the
  true one, which is the best available approximation and must not silently
  become heap order (which is what ``ADD COLUMN … GENERATED … AS IDENTITY`` in
  one step would have produced);
* the **handoff to the identity** — ``attidentity`` must be ``'d'``
  (``BY DEFAULT``), and the sequence must have been advanced PAST the backfilled
  maximum, or the first real insert collides with a reconstructed value;
* the **uniqueness guard** — ``seq`` carries a UNIQUE index because the keyset
  predicate ``(created_at, seq) < (…)`` is only correct while the sort key is a
  total order, and ``BY DEFAULT`` deliberately admits the explicit write that
  could otherwise mint a duplicate.

``migration-reversal.yml`` already walks up -> down -> up on any PR touching
``backend/alembic/versions/**``, so reversibility alone is covered. None of the
three properties above are, and each is a silent-wrong-answer failure rather
than an error: a heap-ordered backfill, an un-advanced sequence and a duplicate
``seq`` all APPLY cleanly and then hand a paging cursor the wrong rows. Hence
this file, matching the convention its ``memhold_*`` / ``memrestore_01``
siblings set for revisions over this same table.

Substrate comes from ``_alembic_harness``: an ephemeral database inside the
test Postgres, skipped when none is reachable. ⚠️ A skip proves nothing — point
it at a live instance with ``QONTINUI_TEST_PG=host:port`` (or ``DATABASE_URL``)
if 5432 is not the one accepting the test credentials.
"""

from __future__ import annotations

from uuid import UUID, uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.engine import Engine
from sqlalchemy.exc import IntegrityError

from tests._alembic_harness import (
    admin_database_url,
    backend_root,
    can_connect,
    ephemeral_database,
    index_exists,
    run_alembic,
)

_REVISION_ID = "memseq_01"
_PARENT_REVISION_ID = "coord_tenant_fk_01"

_UQ_INDEX = "uq_memory_records_seq"

_TENANT_ID = UUID("11111111-1111-1111-1111-111111111111")

# Two batches, seeded BEFORE the revision so the backfill is what numbers them.
#
# Batch A shares ONE created_at across three rows — the shape
# `insert_records_batch` produces (one INSERT … FROM unnest(…), one
# transaction) and the shape the whole plan exists for. Its internal order is
# unknowable, so the backfill must fall back to `memory_id`, which is why the
# ids are spelled out literally: they are chosen so that ASCENDING memory_id
# does NOT coincide with the seeding order, and a backfill that numbered rows
# by insertion (heap) order would disagree with the expected numbering instead
# of accidentally matching it.
#
# Batch B is two rows with distinct, LATER timestamps, so `created_at` alone
# decides them and they must sort after everything in batch A.
_BATCH_A_OFFSET_SECONDS = 120
_BATCH_A = [
    # (memory_id, title) — seeded in this order, numbered by memory_id ASC.
    (UUID("cccccccc-0000-0000-0000-000000000003"), "tied-c"),
    (UUID("aaaaaaaa-0000-0000-0000-000000000001"), "tied-a"),
    (UUID("bbbbbbbb-0000-0000-0000-000000000002"), "tied-b"),
]
# Expected seq order for batch A: memory_id ascending, i.e. a, b, c.
_BATCH_A_EXPECTED_TITLES = ["tied-a", "tied-b", "tied-c"]

_BATCH_B_OFFSET_SECONDS = 60
_BATCH_B = [
    (UUID("dddddddd-0000-0000-0000-000000000004"), "later-d"),
    (UUID("eeeeeeee-0000-0000-0000-000000000005"), "later-e"),
]


def _seed_pre_migration(engine: Engine) -> None:
    """Seed the tenant plus both batches, with no ``seq`` column in sight."""
    with engine.begin() as conn:
        conn.execute(
            text(
                """
                INSERT INTO coord.tenants (tenant_id, slug, display_name)
                VALUES (:t, 'memseq-test', 'memseq test tenant')
                ON CONFLICT DO NOTHING
                """
            ),
            {"t": _TENANT_ID},
        )
        # Batch A — one shared created_at, written in _BATCH_A order.
        for memory_id, title in _BATCH_A:
            conn.execute(
                text(
                    """
                    INSERT INTO coord.memory_records
                        (memory_id, tenant_id, scope, kind, title, content,
                         content_hash, created_at)
                    VALUES (:m, :t, 'tenant', 'fact', :title, :title, :title,
                            now() - make_interval(secs => :secs))
                    """
                ),
                {
                    "m": memory_id,
                    "t": _TENANT_ID,
                    "title": title,
                    "secs": _BATCH_A_OFFSET_SECONDS,
                },
            )
        # Batch B — distinct, later timestamps.
        for idx, (memory_id, title) in enumerate(_BATCH_B):
            conn.execute(
                text(
                    """
                    INSERT INTO coord.memory_records
                        (memory_id, tenant_id, scope, kind, title, content,
                         content_hash, created_at)
                    VALUES (:m, :t, 'tenant', 'fact', :title, :title, :title,
                            now() - make_interval(secs => :secs))
                    """
                ),
                {
                    "m": memory_id,
                    "t": _TENANT_ID,
                    "title": title,
                    "secs": _BATCH_B_OFFSET_SECONDS - idx * 10,
                },
            )


def _column_exists(engine: Engine, column: str) -> bool:
    with engine.connect() as conn:
        return bool(
            conn.execute(
                text(
                    """
                    SELECT EXISTS(
                        SELECT 1 FROM information_schema.columns
                        WHERE table_schema = 'coord'
                          AND table_name = 'memory_records'
                          AND column_name = :c
                    )
                    """
                ),
                {"c": column},
            ).scalar()
        )


def _seq_attributes(engine: Engine) -> tuple[str, bool]:
    """``(attidentity, attnotnull)`` for ``seq`` — 'd' is BY DEFAULT."""
    with engine.connect() as conn:
        row = conn.execute(
            text(
                """
                SELECT attidentity, attnotnull
                  FROM pg_attribute
                 WHERE attrelid = CAST('coord.memory_records' AS regclass)
                   AND attname = 'seq'
                """
            )
        ).one()
    return str(row[0]), bool(row[1])


def _titles_by_seq(engine: Engine) -> list[str]:
    with engine.connect() as conn:
        return [
            str(r[0])
            for r in conn.execute(
                text("SELECT title FROM coord.memory_records ORDER BY seq ASC")
            ).all()
        ]


def _insert_one(engine: Engine, title: str) -> int:
    """Insert WITHOUT naming ``seq`` and return the value the identity gave."""
    with engine.begin() as conn:
        return int(
            conn.execute(
                text(
                    """
                    INSERT INTO coord.memory_records
                        (memory_id, tenant_id, scope, kind, title, content,
                         content_hash)
                    VALUES (:m, :t, 'tenant', 'fact', :title, :title, :title)
                    RETURNING seq
                    """
                ),
                {"m": uuid4(), "t": _TENANT_ID, "title": title},
            ).scalar_one()
        )


@pytest.mark.skipif(
    not can_connect(admin_database_url()),
    reason=(
        "Postgres not reachable at the conftest URL. CI provisions a "
        "postgres service; locally, bring up a backend Postgres before "
        "running this test."
    ),
)
def test_memseq_01_backfills_in_reconstructed_write_order() -> None:
    """Backfill order, identity handoff, uniqueness guard, and reversal."""
    root = backend_root()

    with ephemeral_database(admin_database_url(), "memseq_01_test") as (engine, url):
        # ----------------------------------------------------------------
        # 1. Parent revision — the column must not exist yet, and the rows
        #    that the backfill has to reconstruct are seeded HERE, before
        #    the identity could have numbered them.
        # ----------------------------------------------------------------
        run_alembic(root, url, "upgrade", _PARENT_REVISION_ID)
        assert not _column_exists(engine, "seq"), (
            "seq must be created by this revision, not an earlier one"
        )
        _seed_pre_migration(engine)

        # ----------------------------------------------------------------
        # 2. Apply. The backfill numbers by (created_at, memory_id): the
        #    older TIED batch first, ordered among itself by memory_id
        #    (NOT by the order it was inserted in), then the two later
        #    rows in timestamp order.
        # ----------------------------------------------------------------
        run_alembic(root, url, "upgrade", _REVISION_ID)

        expected = _BATCH_A_EXPECTED_TITLES + [t for _, t in _BATCH_B]
        assert _titles_by_seq(engine) == expected, (
            "seq must be backfilled in (created_at, memory_id) order — the "
            "reconstruction the revision documents. Heap order, or the "
            "insertion order of the tied batch, is the failure this asserts."
        )

        # ----------------------------------------------------------------
        # 3. The identity handoff. BY DEFAULT (not ALWAYS) and NOT NULL —
        #    a nullable seq would sort FIRST under `seq DESC` and hand
        #    every "newest" sample to rows with no write-order key at all.
        # ----------------------------------------------------------------
        identity, not_null = _seq_attributes(engine)
        assert identity == "d", (
            "seq must be GENERATED BY DEFAULT AS IDENTITY (attidentity 'd'); "
            f"got {identity!r}"
        )
        assert not_null, "seq must be NOT NULL"

        # ----------------------------------------------------------------
        # 4. setval ran PAST the backfilled maximum. Without it the first
        #    real insert reuses seq=1 and collides with a reconstructed
        #    row — silently, if the unique index were absent.
        # ----------------------------------------------------------------
        first_new = _insert_one(engine, "after-migration-1")
        assert first_new == len(expected) + 1, (
            f"first identity-served seq must be max(backfill)+1 = "
            f"{len(expected) + 1}; got {first_new} (setval did not advance)"
        )
        assert _insert_one(engine, "after-migration-2") == first_new + 1

        # ----------------------------------------------------------------
        # 5. The uniqueness guard the keyset cursor depends on. BY DEFAULT
        #    admits an explicit write; the UNIQUE index is what stops it
        #    from producing a duplicate sort key (and therefore a page
        #    boundary that skips or repeats a row).
        # ----------------------------------------------------------------
        assert index_exists(engine, _UQ_INDEX)
        with pytest.raises(IntegrityError):
            with engine.begin() as conn:
                conn.execute(
                    text(
                        """
                        INSERT INTO coord.memory_records
                            (memory_id, tenant_id, scope, kind, title, content,
                             content_hash, seq)
                        VALUES (:m, :t, 'tenant', 'fact', 'dup', 'dup', 'dup',
                                :seq)
                        """
                    ),
                    {"m": uuid4(), "t": _TENANT_ID, "seq": first_new},
                )

        # ----------------------------------------------------------------
        # 6. Downgrade drops the column and leaves no orphan sequence; the
        #    rows themselves survive. Then re-upgrade renumbers cleanly.
        # ----------------------------------------------------------------
        run_alembic(root, url, "downgrade", _PARENT_REVISION_ID)
        assert not _column_exists(engine, "seq")
        assert not index_exists(engine, _UQ_INDEX)
        with engine.connect() as conn:
            assert (
                conn.execute(
                    text(
                        """
                        SELECT count(*) FROM pg_sequences
                        WHERE schemaname = 'coord'
                          AND sequencename LIKE 'memory_records_seq%'
                        """
                    )
                ).scalar()
                == 0
            ), "dropping the column must take its identity sequence with it"
            assert (
                conn.execute(text("SELECT count(*) FROM coord.memory_records")).scalar()
                == len(expected) + 2
            )

        run_alembic(root, url, "upgrade", _REVISION_ID)
        with engine.connect() as conn:
            distinct_seqs = conn.execute(
                text("SELECT count(DISTINCT seq) FROM coord.memory_records")
            ).scalar()
        assert distinct_seqs == len(expected) + 2
