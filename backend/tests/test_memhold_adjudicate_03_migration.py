"""Data-semantics test for the ``memhold_adjudicate_03`` revision.

The revision authors **no schema**. Its whole contract is WHICH rows it revives
and which it refuses to touch — and the refusals are the interesting half,
because the loose shape it is derived from ("a non-live part-N of a live
multi-part document") matches rows that must be left exactly where they are.
Measured against prod on 2026-08-05 the loose shape matched 8 rows and the
correct answer was 4; the four seeded negatives below are the other four.

Cases covered (each a distinct branch of ``_TARGETS``)
=====================================================

1. **Orphaned part superseded onto a DIFFERENT document** — revived and held.
   This is ``4a14e94e…``'s shape and the reason the revision exists.
2. **Orphan whose superseder is ITSELF not live** — revived. ``4a14e94e…``'s
   real chain is part 1/2 → a dead sidecar → the live part 2/2, so a predicate
   that required a live superseder would have missed the actual casualty.
3. **Orphan superseded onto the SAME document** (a later re-import, identical
   title and file) — NOT revived. Ordinary dedup; reviving it resurrects a
   duplicate. This is ``f689235f…``'s shape.
4. **Orphan whose superseder carries ``source.synthesis_job``** — NOT revived.
   Owned by ``memrestore_01``, this revision's parent, which restores all 597.
5. **Non-live part with NO live sibling** — NOT revived. A wholly retired
   document is not an orphaned half.
6. **A live part** — untouched.
7. **Orphan that would COLLIDE with a live row on ``content_hash``** — skipped
   and reported, NOT aborted. A migration that raises blocks every coord deploy
   fleet-wide (qontinui-web#904, ~25h).
8. **A supersede 2-cycle present in the corpus** — the migration ABORTS. This is
   the one genuine-corruption condition, and it is asserted separately because
   it must fail the run rather than skip a row.

Then the round trip is asserted:

* **downgrade** — restores each revived row's exact prior ``valid_until`` /
  ``superseded_by``, and restores ``lifecycle_hold`` to its RECORDED prior value
  (an explicit ``false`` survives; an absent key stays absent).
* **re-upgrade** — the selection is re-derivable.

The classifier :func:`classify_winner_liveness` (Change 3) is tested separately
and without a database where it can be, since its whole point is that a future
revision can distinguish an organic supersession from corruption.

Substrate comes from ``_alembic_harness``: an ephemeral DB inside the test
Postgres, skipped when none is reachable.
"""

from __future__ import annotations

import hashlib
import importlib.util
import json
import uuid
from types import ModuleType

import pytest
from sqlalchemy import text
from sqlalchemy.engine import Engine

from tests._alembic_harness import (
    admin_database_url,
    backend_root,
    can_connect,
    ephemeral_database,
    run_alembic,
)

_REVISION_ID = "memhold_adjudicate_03"
_PARENT_REVISION_ID = "memrestore_01_synthesis_superseded_documents"

_ORIGIN = "topic-file"

# ---------------------------------------------------------------------------
# Fixture titles. A "(part i/n)" suffix is what makes a row a document PART, so
# every fixture that must be considered carries one.
# ---------------------------------------------------------------------------
_ORPHAN_CROSS_DOC = "alpha-doc (part 1/2)"
_ORPHAN_CROSS_DOC_LIVE_SIB = "alpha-doc (part 2/2)"
_OTHER_DOC = "beta-doc (part 1/2)"

_ORPHAN_DEAD_TARGET = "gamma-doc (part 1/2)"
_ORPHAN_DEAD_TARGET_SIB = "gamma-doc (part 2/2)"
_DEAD_SIDECAR = "gamma-sidecar (part 1/1)"

_REIMPORT_OLD = "delta-doc (part 1/2)"
# Same DOCUMENT identity as _REIMPORT_OLD — "delta-doc" once the part suffix is
# stripped — which is the property that marks this as re-import dedup rather
# than cross-document supersession. Given a different part number only so the
# two rows stay individually addressable by title in the assertions; in prod
# (``f689235f`` → ``18ec67bb``) the two carried the identical title.
_REIMPORT_NEW = "delta-doc (part 1/5)"
_REIMPORT_SIB = "delta-doc (part 2/2)"

_SYNTH_ORPHAN = "epsilon-doc (part 1/2)"
_SYNTH_ORPHAN_SIB = "epsilon-doc (part 2/2)"
_SYNTH_SUMMARY = "epsilon summary"

_NO_LIVE_SIB = "zeta-doc (part 1/2)"
_NO_LIVE_SIB_DEAD = "zeta-doc (part 2/2)"
_ZETA_TARGET = "zeta-target (part 1/1)"

_COLLIDER_ORPHAN = "eta-doc (part 1/2)"
_COLLIDER_ORPHAN_SIB = "eta-doc (part 2/2)"
_COLLIDER_LIVE = "eta-live-twin (part 1/1)"
_ETA_TARGET = "eta-target (part 1/1)"

_EXPECT_REVIVED = {_ORPHAN_CROSS_DOC, _ORPHAN_DEAD_TARGET}
_EXPECT_NOT_REVIVED = {
    _REIMPORT_OLD,
    _SYNTH_ORPHAN,
    _NO_LIVE_SIB,
    _COLLIDER_ORPHAN,
}

_COLLIDING_HASH = hashlib.sha256(b"eta shared body").hexdigest()


def _load_revision() -> ModuleType:
    """Import the revision module directly, for the classifier tests."""
    path = (
        backend_root()
        / "alembic"
        / "versions"
        / "memhold_adjudicate_03_revive_orphaned_parts.py"
    )
    spec = importlib.util.spec_from_file_location("_memhold03", path)
    assert spec and spec.loader
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _row(
    title: str,
    *,
    tenant_id: uuid.UUID,
    memory_id: uuid.UUID | None = None,
    source: dict[str, object] | None = None,
    superseded_by: uuid.UUID | None = None,
    valid_until: str | None = None,
    content_hash: str | None = None,
) -> dict[str, object]:
    body = f"body of {title}"
    return {
        "memory_id": memory_id or uuid.uuid4(),
        "tenant_id": tenant_id,
        "kind": "observation",
        "title": title,
        "content": body,
        "content_hash": content_hash or hashlib.sha256(body.encode()).hexdigest(),
        "source": json.dumps(source if source is not None else {"origin": _ORIGIN}),
        "superseded_by": superseded_by,
        "valid_until": valid_until,
    }


_PAST = "2026-07-28T16:20:00+00:00"


def _seed(engine: Engine) -> tuple[uuid.UUID, dict[str, uuid.UUID]]:
    """Seed one tenant with every branch of the selection, at the PARENT."""
    tenant_id = uuid.uuid4()
    ids = {
        name: uuid.uuid4()
        for name in (
            _ORPHAN_CROSS_DOC,
            _ORPHAN_CROSS_DOC_LIVE_SIB,
            _OTHER_DOC,
            _ORPHAN_DEAD_TARGET,
            _ORPHAN_DEAD_TARGET_SIB,
            _DEAD_SIDECAR,
            _REIMPORT_OLD,
            _REIMPORT_NEW,
            _REIMPORT_SIB,
            _SYNTH_ORPHAN,
            _SYNTH_ORPHAN_SIB,
            _SYNTH_SUMMARY,
            _NO_LIVE_SIB,
            _NO_LIVE_SIB_DEAD,
            _ZETA_TARGET,
            _COLLIDER_ORPHAN,
            _COLLIDER_ORPHAN_SIB,
            _COLLIDER_LIVE,
            _ETA_TARGET,
        )
    }

    rows = [
        # 1 — cross-document orphan. Carries an explicit lifecycle_hold:false,
        # mirroring 4a14e94e's real state, so the downgrade's restore-to-prior
        # (rather than drop-the-key) behaviour is exercised.
        _row(
            _ORPHAN_CROSS_DOC,
            tenant_id=tenant_id,
            memory_id=ids[_ORPHAN_CROSS_DOC],
            source={"origin": _ORIGIN, "lifecycle_hold": False},
            superseded_by=ids[_OTHER_DOC],
            valid_until=_PAST,
        ),
        _row(
            _ORPHAN_CROSS_DOC_LIVE_SIB,
            tenant_id=tenant_id,
            memory_id=ids[_ORPHAN_CROSS_DOC_LIVE_SIB],
        ),
        _row(_OTHER_DOC, tenant_id=tenant_id, memory_id=ids[_OTHER_DOC]),
        # 2 — orphan whose superseder is itself NOT live.
        _row(
            _ORPHAN_DEAD_TARGET,
            tenant_id=tenant_id,
            memory_id=ids[_ORPHAN_DEAD_TARGET],
            superseded_by=ids[_DEAD_SIDECAR],
            valid_until=_PAST,
        ),
        _row(
            _ORPHAN_DEAD_TARGET_SIB,
            tenant_id=tenant_id,
            memory_id=ids[_ORPHAN_DEAD_TARGET_SIB],
        ),
        _row(
            _DEAD_SIDECAR,
            tenant_id=tenant_id,
            memory_id=ids[_DEAD_SIDECAR],
            superseded_by=ids[_ORPHAN_DEAD_TARGET_SIB],
            valid_until=_PAST,
        ),
        # 3 — re-import dedup: superseded onto the SAME document.
        _row(
            _REIMPORT_OLD,
            tenant_id=tenant_id,
            memory_id=ids[_REIMPORT_OLD],
            superseded_by=ids[_REIMPORT_NEW],
            valid_until=_PAST,
        ),
        _row(_REIMPORT_NEW, tenant_id=tenant_id, memory_id=ids[_REIMPORT_NEW]),
        _row(_REIMPORT_SIB, tenant_id=tenant_id, memory_id=ids[_REIMPORT_SIB]),
        # 4 — synthesis-superseded: memrestore_01's territory.
        _row(
            _SYNTH_ORPHAN,
            tenant_id=tenant_id,
            memory_id=ids[_SYNTH_ORPHAN],
            superseded_by=ids[_SYNTH_SUMMARY],
            valid_until=_PAST,
        ),
        _row(_SYNTH_ORPHAN_SIB, tenant_id=tenant_id, memory_id=ids[_SYNTH_ORPHAN_SIB]),
        _row(
            _SYNTH_SUMMARY,
            tenant_id=tenant_id,
            memory_id=ids[_SYNTH_SUMMARY],
            source={"synthesis_job": str(uuid.uuid4())},
        ),
        # 5 — no live sibling: a wholly retired document.
        _row(
            _NO_LIVE_SIB,
            tenant_id=tenant_id,
            memory_id=ids[_NO_LIVE_SIB],
            superseded_by=ids[_ZETA_TARGET],
            valid_until=_PAST,
        ),
        _row(
            _NO_LIVE_SIB_DEAD,
            tenant_id=tenant_id,
            memory_id=ids[_NO_LIVE_SIB_DEAD],
            superseded_by=ids[_ZETA_TARGET],
            valid_until=_PAST,
        ),
        _row(_ZETA_TARGET, tenant_id=tenant_id, memory_id=ids[_ZETA_TARGET]),
        # 7 — collision: reviving would violate the live-dedup unique index.
        _row(
            _COLLIDER_ORPHAN,
            tenant_id=tenant_id,
            memory_id=ids[_COLLIDER_ORPHAN],
            content_hash=_COLLIDING_HASH,
            superseded_by=ids[_ETA_TARGET],
            valid_until=_PAST,
        ),
        _row(
            _COLLIDER_ORPHAN_SIB,
            tenant_id=tenant_id,
            memory_id=ids[_COLLIDER_ORPHAN_SIB],
        ),
        _row(
            _COLLIDER_LIVE,
            tenant_id=tenant_id,
            memory_id=ids[_COLLIDER_LIVE],
            content_hash=_COLLIDING_HASH,
        ),
        _row(_ETA_TARGET, tenant_id=tenant_id, memory_id=ids[_ETA_TARGET]),
    ]

    with engine.begin() as conn:
        conn.execute(
            text(
                "INSERT INTO coord.tenants (tenant_id, slug, display_name) "
                "VALUES (:t, :s, 'memhold adjudicate 03 test')"
            ),
            {"t": tenant_id, "s": f"memhold03-{tenant_id.hex[:12]}"},
        )
        # Two passes, because ``superseded_by`` is a self-FK and several
        # fixtures point at rows defined later in the list (a supersede chain
        # is the whole point of case 2). ``valid_until`` is set in the FIRST
        # pass, not the second: it is what takes a row OUT of
        # ``uq_memory_records_tenant_content_hash_live``, and the collision
        # fixture deliberately shares a content_hash with a live row — so
        # inserting it live, even transiently, trips the index before the
        # revision ever runs.
        for row in rows:
            conn.execute(
                text(
                    """
                    INSERT INTO coord.memory_records
                        (memory_id, tenant_id, kind, title, content,
                         content_hash, source, valid_until)
                    VALUES
                        (:memory_id, :tenant_id, :kind, :title, :content,
                         :content_hash, CAST(:source AS jsonb),
                         CAST(:valid_until AS timestamptz))
                    """
                ),
                {k: v for k, v in row.items() if k != "superseded_by"},
            )
        for row in rows:
            if row["superseded_by"] is None:
                continue
            conn.execute(
                text(
                    "UPDATE coord.memory_records SET superseded_by = :s "
                    "WHERE memory_id = :m"
                ),
                {"m": row["memory_id"], "s": row["superseded_by"]},
            )
    return tenant_id, ids


def _state(engine: Engine, tenant_id: uuid.UUID) -> dict[str, dict[str, object]]:
    """title → the fields this revision writes."""
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                """
                SELECT title, superseded_by, valid_until,
                       source->'lifecycle_hold' AS hold,
                       (source ? 'memhold_adjudicate_03') AS stamped
                  FROM coord.memory_records
                 WHERE tenant_id = :tenant_id
                """
            ),
            {"tenant_id": tenant_id},
        ).mappings()
        return {r["title"]: dict(r) for r in rows}


_SKIP = pytest.mark.skipif(
    not can_connect(admin_database_url()),
    reason="no test Postgres reachable",
)


@_SKIP
def test_memhold_adjudicate_03_revives_only_cross_document_orphans() -> None:
    root = backend_root()
    with ephemeral_database(admin_database_url(), "memhold03_test") as (engine, url):
        run_alembic(root, url, "upgrade", _PARENT_REVISION_ID)
        tenant_id, _ids = _seed(engine)

        run_alembic(root, url, "upgrade", _REVISION_ID)
        after = _state(engine, tenant_id)

        # -- revived -------------------------------------------------------
        for title in sorted(_EXPECT_REVIVED):
            assert after[title]["superseded_by"] is None, f"{title} must be revived"
            assert after[title]["valid_until"] is None, f"{title} must be live"
            assert after[title]["hold"] is True, (
                f"{title} must be HELD by the revision that revived it — an "
                "unheld revived row re-enters fetch_cluster_candidates and is "
                "re-consumed within 10 minutes"
            )
            assert after[title]["stamped"] is True, (
                f"{title} must carry source.memhold_adjudicate_03 so a "
                "successor's uncovered-held check can subtract it by key"
            )

        # -- refused -------------------------------------------------------
        for title in sorted(_EXPECT_NOT_REVIVED):
            assert after[title]["superseded_by"] is not None, (
                f"{title} must NOT be revived"
            )
            assert after[title]["stamped"] is False

        assert after[_REIMPORT_OLD]["superseded_by"] is not None, (
            "a part superseded onto a LATER RE-IMPORT of the same document is "
            "ordinary dedup — reviving it resurrects a duplicate"
        )
        assert after[_SYNTH_ORPHAN]["superseded_by"] is not None, (
            "the synthesis-superseded set belongs to memrestore_01"
        )
        assert after[_NO_LIVE_SIB]["superseded_by"] is not None, (
            "a document with no live part is retired, not orphaned"
        )
        assert after[_COLLIDER_ORPHAN]["superseded_by"] is not None, (
            "a colliding revive is SKIPPED, not applied"
        )

        # -- untouched live rows ------------------------------------------
        assert after[_ORPHAN_CROSS_DOC_LIVE_SIB]["hold"] is None
        assert after[_OTHER_DOC]["stamped"] is False


@_SKIP
def test_memhold_adjudicate_03_skips_collision_without_aborting() -> None:
    """A live-dedup collision must not fail the deploy.

    The whole reason this revision skips rather than raises: a raising
    migration fails coord's pre-deploy drift gate and blocks EVERY coord
    deploy fleet-wide.
    """
    root = backend_root()
    with ephemeral_database(admin_database_url(), "memhold03_collide") as (engine, url):
        run_alembic(root, url, "upgrade", _PARENT_REVISION_ID)
        tenant_id, _ = _seed(engine)

        proc = run_alembic(root, url, "upgrade", _REVISION_ID)
        assert proc.returncode == 0, "a collision must not fail the migration"

        after = _state(engine, tenant_id)
        assert after[_COLLIDER_ORPHAN]["valid_until"] is not None
        # and the run still did its real work
        assert after[_ORPHAN_CROSS_DOC]["valid_until"] is None


@_SKIP
def test_memhold_adjudicate_03_aborts_on_a_supersede_cycle() -> None:
    """Genuine corruption is the ONE thing that fails the run."""
    root = backend_root()
    with ephemeral_database(admin_database_url(), "memhold03_cycle") as (engine, url):
        run_alembic(root, url, "upgrade", _PARENT_REVISION_ID)
        tenant_id, ids = _seed(engine)

        # Point _OTHER_DOC back at _ORPHAN_CROSS_DOC, forming A→B ∧ B→A.
        with engine.begin() as conn:
            conn.execute(
                text(
                    "UPDATE coord.memory_records SET superseded_by = :a, "
                    "valid_until = CAST(:v AS timestamptz) WHERE memory_id = :b"
                ),
                {"a": ids[_ORPHAN_CROSS_DOC], "b": ids[_OTHER_DOC], "v": _PAST},
            )

        # `run_alembic` asserts a zero exit itself, so a failing migration
        # surfaces as AssertionError carrying both streams.
        with pytest.raises(AssertionError) as excinfo:
            run_alembic(root, url, "upgrade", _REVISION_ID)
        message = str(excinfo.value)
        assert "supersede 2-cycle" in message, message
        assert "SUPERSEDE CYCLE" in message, message

        # Nothing was written: the abort happens before any revive.
        after = _state(engine, tenant_id)
        assert after[_ORPHAN_DEAD_TARGET]["stamped"] is False


@_SKIP
def test_memhold_adjudicate_03_downgrade_restores_prior_state() -> None:
    root = backend_root()
    with ephemeral_database(admin_database_url(), "memhold03_down") as (engine, url):
        run_alembic(root, url, "upgrade", _PARENT_REVISION_ID)
        tenant_id, ids = _seed(engine)
        before = _state(engine, tenant_id)

        run_alembic(root, url, "upgrade", _REVISION_ID)
        run_alembic(root, url, "downgrade", _PARENT_REVISION_ID)
        after = _state(engine, tenant_id)

        for title in sorted(_EXPECT_REVIVED):
            assert after[title]["superseded_by"] == before[title]["superseded_by"], (
                f"{title} must go back to the exact pointer it had"
            )
            assert after[title]["valid_until"] == before[title]["valid_until"]
            assert after[title]["stamped"] is False

        assert after[_ORPHAN_CROSS_DOC]["hold"] is False, (
            "an explicit lifecycle_hold:false predating this revision must be "
            "RESTORED, not dropped — it is Phase 3's record that a pair was "
            "adjudicated, and erasing it destroys that decision"
        )
        assert after[_ORPHAN_DEAD_TARGET]["hold"] is None, (
            "a row that carried no hold key must end with no hold key"
        )

        # re-upgrade: the selection is re-derivable
        run_alembic(root, url, "upgrade", _REVISION_ID)
        again = _state(engine, tenant_id)
        for title in sorted(_EXPECT_REVIVED):
            assert again[title]["valid_until"] is None
            assert again[title]["hold"] is True


# ---------------------------------------------------------------------------
# Change 3 — the winner-liveness classifier.
# ---------------------------------------------------------------------------


@_SKIP
def test_classify_winner_liveness_distinguishes_organic_from_corrupt() -> None:
    """The distinction `memhold_adjudicate_02`'s blanket invariant could not draw.

    `6cf34411…` was superseded onto a LIVE consolidation synthesis — correct,
    recurring behaviour — and `_02` aborted on it anyway, deferring every
    migration PR in the fleet for >5h. That case must classify as organic.
    """
    mod = _load_revision()
    root = backend_root()
    with ephemeral_database(admin_database_url(), "memhold03_classify") as (
        engine,
        url,
    ):
        run_alembic(root, url, "upgrade", _PARENT_REVISION_ID)
        tenant_id, ids = _seed(engine)

        with engine.connect() as conn:

            def verdict(title: str) -> str:
                return mod.classify_winner_liveness(conn, ids[title])[0]

            assert verdict(_OTHER_DOC) == mod.WINNER_LIVE

            # organic: superseded onto a LIVE record → skip and report
            assert verdict(_SYNTH_ORPHAN) == mod.WINNER_SUPERSEDED_ONTO_LIVE
            assert verdict(_ORPHAN_CROSS_DOC) == mod.WINNER_SUPERSEDED_ONTO_LIVE

            # corrupt: superseded onto a row that is itself NOT live
            assert verdict(_ORPHAN_DEAD_TARGET) == mod.WINNER_CORRUPT

            # corrupt: a row that does not exist
            assert (
                mod.classify_winner_liveness(conn, uuid.uuid4())[0]
                == mod.WINNER_CORRUPT
            )


@_SKIP
def test_classify_winner_liveness_calls_a_two_cycle_corrupt() -> None:
    mod = _load_revision()
    root = backend_root()
    with ephemeral_database(admin_database_url(), "memhold03_classify2") as (
        engine,
        url,
    ):
        run_alembic(root, url, "upgrade", _PARENT_REVISION_ID)
        tenant_id, ids = _seed(engine)
        with engine.begin() as conn:
            conn.execute(
                text(
                    "UPDATE coord.memory_records SET superseded_by = :a, "
                    "valid_until = CAST(:v AS timestamptz) WHERE memory_id = :b"
                ),
                {"a": ids[_ORPHAN_CROSS_DOC], "b": ids[_OTHER_DOC], "v": _PAST},
            )
        with engine.connect() as conn:
            v, reason = mod.classify_winner_liveness(conn, ids[_ORPHAN_CROSS_DOC])
            assert v == mod.WINNER_CORRUPT
            assert "cycle" in reason
