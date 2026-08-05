"""Data-semantics test for the ``memrestore_01`` revision, plus the bind-param
guard whose absence let it ship un-appliable.

``memrestore_01_synthesis_superseded_documents`` restores the 597 topic-file
documents that the 2026-07-28 consolidation sweep superseded onto its own
syntheses. Like its ``memhold_*`` siblings it authors **no schema**, so its
whole contract is which rows it touches and what it writes — and it had no test
at all, which is how it reached prod's migrator broken.

What broke, and why a test would have caught it
===============================================

The revision recorded each row's prior lifecycle state with::

    to_jsonb(:prior_valid_until::text)

``sa.text()`` finds binds with ``(?<![\\w:\\\\]):(\\w+)(?!:)``. That trailing
``(?!:)`` is there to leave PostgreSQL's ``::`` cast operator alone — but the
regex **backtracks** instead of failing: it registers a bind named
``prior_valid_unti`` (one character short) and emits the original
``:prior_valid_until::text`` into the compiled SQL. The ``:name`` then reaches
PostgreSQL literally (``syntax error at or near ":"``) while the value silently
never binds. Run 30947022520 died exactly there, at the first of 597 rows, and
because ``touches_migration`` defers every ``alembic/versions/`` PR while the
stamped head and the chain head differ, it wedged the whole merge train.

The fix is ``CAST(:prior_valid_until AS text)`` — the same idiom this file's own
fixture INSERT uses, and the one the sibling migration tests already use.

Coverage here
=============

:func:`test_no_revision_binds_a_param_adjacent_to_a_cast` is the guard for the
CLASS. It needs no database, so it never skips, and it sweeps **every** revision
rather than this one: for each ``sa.text()`` literal it compares the binds
SQLAlchemy actually registers against the ``:name`` tokens the author plainly
wrote, and fails on either a bind SQLAlchemy invented (the truncation above) or
one it will not substitute. It would have failed on this revision as authored.

:func:`test_memrestore_01_restores_only_the_synthesis_superseded` is the
data-semantics walk, over four fixtures chosen as the distinct branches:

1. **A synthesis-superseded topic-file document** — restored, held, and its
   REAL prior ``valid_until`` / ``superseded_by`` recorded. Asserting those are
   the seeded values (and not ``null``) is the point: the statement nulls both
   columns in the same breath that records them, so a fix that only repaired
   the syntax and left the values unbound would write nulls and destroy exactly
   the provenance the block exists for.
2. **A document whose content_hash is already held by a LIVE row** — skipped,
   because restoring it would violate ``uq_memory_records_tenant_content_hash_live``.
   Left fully untouched, not partially written.
3. **A topic-file document superseded by another topic-file row** — ordinary
   dedup from a repeated import. Out of scope by predicate; must not move.
4. **A tombstoned row** that otherwise matches — excluded by ``is_tombstone``.

Then downgrade, which must put fixture 1 back to the microsecond and leave no
residue, and a re-run, which must be a no-op.

Substrate comes from ``_alembic_harness``: an ephemeral database inside the
test Postgres, skipped when none is reachable. ⚠️ A skip proves nothing — point
it at a live instance with ``DATABASE_URL`` if 5432 is not the one accepting
the test credentials.
"""

from __future__ import annotations

import ast
import hashlib
import json
import re
import uuid
from typing import Any

import pytest
import sqlalchemy as sa
from sqlalchemy import text
from sqlalchemy.engine import Engine

from tests._alembic_harness import (
    admin_database_url,
    backend_root,
    can_connect,
    ephemeral_database,
    run_alembic,
)

# Pinned explicitly rather than "head" so a later migration landing on top
# cannot silently change what this test walks.
_REVISION_ID = "memrestore_01_synthesis_superseded_documents"
_PARENT_REVISION_ID = "coord_memory_obs_access_distribution"

_TOPIC = "topic-file"
_PROV_KEY = "restore_2026_08_04"

# Microseconds on purpose: the provenance round-trips through jsonb TEXT and
# back through ``::timestamptz`` in downgrade(), and a truncating cast would
# only show up below second resolution.
_PRIOR_VALID_UNTIL = "2026-07-28T04:20:31.123456+00:00"
_OTHER_VALID_UNTIL = "2026-07-28T04:20:36.654321+00:00"

_EMBEDDING_DIMS = 384


def _embedding(seed: int) -> str:
    """A distinct 384-dim unit vector per row, so "never touched" is per-row."""
    values = ["0"] * _EMBEDDING_DIMS
    values[seed % _EMBEDDING_DIMS] = "1"
    return "[" + ",".join(values) + "]"


# --------------------------------------------------------------------------
# The guard. No database, so it never skips.
# --------------------------------------------------------------------------

# What a reader sees as a bind parameter. Deliberately NOT SQLAlchemy's regex —
# the whole point is to disagree with it where SQLAlchemy is surprising.
_AUTHOR_BIND = re.compile(r"(?<![\w:\\]):(\w+)")


def _text_literals(tree: ast.Module) -> list[tuple[int, str]]:
    """Every string that reaches ``text()`` — inline or via a module constant."""
    consts: dict[str, tuple[str, int]] = {}
    for node in tree.body:
        if isinstance(node, ast.Assign) and isinstance(node.value, ast.Constant):
            if isinstance(node.value.value, str):
                for target in node.targets:
                    if isinstance(target, ast.Name):
                        consts[target.id] = (node.value.value, node.value.lineno)

    found: list[tuple[int, str]] = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call) or not node.args:
            continue
        func = node.func
        name = func.id if isinstance(func, ast.Name) else getattr(func, "attr", None)
        if name != "text":
            continue
        arg = node.args[0]
        if isinstance(arg, ast.Constant) and isinstance(arg.value, str):
            found.append((arg.lineno, arg.value))
        elif isinstance(arg, ast.Name) and arg.id in consts:
            sql, lineno = consts[arg.id]
            found.append((lineno, sql))
    return found


def test_no_revision_binds_a_param_adjacent_to_a_cast() -> None:
    """No ``sa.text()`` in any revision may disagree with SQLAlchemy about binds.

    ``:name::text`` is the shape that bites: SQLAlchemy registers a bind one
    character short of what was written and leaves the literal ``:name`` in the
    SQL, so PostgreSQL raises a syntax error at apply time and the value never
    binds. Spell casts ``CAST(:name AS text)`` instead.

    Swept across every revision rather than just ``memrestore_01`` — the defect
    is a property of the idiom, not of one author, and a migration that fails
    this way is only discoverable in the migrator, against production.
    """
    versions = backend_root() / "alembic" / "versions"
    scanned = 0
    problems: list[str] = []

    for path in sorted(versions.rglob("*.py")):
        if "__pycache__" in str(path):
            continue
        try:
            tree = ast.parse(path.read_text(encoding="utf-8", errors="replace"))
        except SyntaxError:  # pragma: no cover - a broken revision fails elsewhere
            continue
        for lineno, sql in _text_literals(tree):
            if ":" not in sql:
                continue
            scanned += 1
            written = set(_AUTHOR_BIND.findall(sql))
            try:
                registered = set(sa.text(sql)._bindparams.keys())
            except Exception:  # pragma: no cover - not a bind-detection failure
                continue
            phantom = sorted(registered - written)
            lost = sorted(written - registered)
            if phantom or lost:
                problems.append(
                    f"{path.name}:{lineno} — SQLAlchemy registered {phantom or '[]'} "
                    f"but the SQL writes {lost or '[]'}. A `:name` immediately "
                    f"followed by `::` is not bound; use CAST(:name AS type)."
                )

    assert scanned > 0, "swept no SQL literals — the AST walk is broken, not clean"
    assert not problems, "bind parameters that will not bind:\n  " + "\n  ".join(
        problems
    )


def test_memrestore_01_uses_cast_not_the_colon_operator() -> None:
    """The specific regression: this revision's provenance casts stay ``CAST``.

    The class guard above would also catch a relapse, but this names the file
    and the reason so a future reader tempted to "simplify" it back sees why.
    """
    path = (
        backend_root()
        / "alembic"
        / "versions"
        / "memrestore_01_synthesis_superseded_documents.py"
    )
    # Read the SQL through the AST, not the file text: the revision's own
    # comment quotes the broken form to explain it, and a substring check
    # against the whole file would trip over the explanation.
    tree = ast.parse(path.read_text(encoding="utf-8"))
    update = [sql for _, sql in _text_literals(tree) if "jsonb_build_object" in sql]
    assert len(update) == 1, f"expected one provenance UPDATE, found {len(update)}"
    sql = update[0]
    assert "CAST(:prior_valid_until AS text)" in sql
    assert "CAST(:prior_superseded_by AS text)" in sql
    assert "::text" not in sql, "a `::` cast on a bind parameter will not bind"


# --------------------------------------------------------------------------
# The data-semantics walk.
# --------------------------------------------------------------------------


def _seed(engine: Engine) -> dict[str, Any]:
    """Seed one tenant and the four branch fixtures, at the PARENT revision.

    Seeding must happen before the revision runs: it is one-shot DML, so a row
    inserted afterwards would never be reached.
    """
    tenant_id = uuid.uuid4()
    ids: dict[str, Any] = {"__tenant__": tenant_id}
    rows: list[dict[str, Any]] = []

    def record(
        key: str,
        *,
        kind: str = "observation",
        source: dict[str, object],
        valid_until: str | None = None,
        superseded_by: uuid.UUID | None = None,
        is_tombstone: bool = False,
        content_hash: str | None = None,
    ) -> uuid.UUID:
        memory_id = uuid.uuid4()
        content = f"body of {key}"
        rows.append(
            {
                "memory_id": memory_id,
                "tenant_id": tenant_id,
                "kind": kind,
                "title": key,
                "content": content,
                "content_hash": content_hash
                or hashlib.sha256(content.encode()).hexdigest(),
                "source": json.dumps(source),
                "valid_until": valid_until,
                "superseded_by": superseded_by,
                "is_tombstone": is_tombstone,
                "embedding": _embedding(len(rows)),
            }
        )
        ids[key] = memory_id
        return memory_id

    synthesis = {"origin": "synthesis", "synthesis_job": "consolidate-2026-07-28"}

    # 1 — the restorable document and the synthesis that displaced it.
    summary = record("summary", kind="mental_model", source=synthesis)
    record(
        "document",
        source={"origin": _TOPIC, "file": "reference_thing.md"},
        valid_until=_PRIOR_VALID_UNTIL,
        superseded_by=summary,
    )

    # 2 — same shape, but a LIVE row already holds its content_hash. Both carry
    # the same hash and only the live one is live, so the fixture itself is
    # legal under the partial unique index; restoring the dead one would not be.
    collide_hash = hashlib.sha256(b"contested content").hexdigest()
    collide_summary = record("collide_summary", kind="mental_model", source=synthesis)
    record(
        "collide_document",
        source={"origin": _TOPIC, "file": "reference_contested.md"},
        valid_until=_OTHER_VALID_UNTIL,
        superseded_by=collide_summary,
        content_hash=collide_hash,
    )
    record(
        "collide_live_twin",
        source={"origin": _TOPIC, "file": "reference_contested.md"},
        content_hash=collide_hash,
    )

    # 3 — topic-file superseded by topic-file: ordinary dedup, out of scope.
    dedup_winner = record(
        "dedup_winner", kind="reference", source={"origin": _TOPIC, "file": "dup.md"}
    )
    record(
        "dedup_loser",
        source={"origin": _TOPIC, "file": "dup.md"},
        valid_until=_PRIOR_VALID_UNTIL,
        superseded_by=dedup_winner,
    )

    # 4 — matches on every other clause but is tombstoned.
    tombstone_summary = record(
        "tombstone_summary", kind="mental_model", source=synthesis
    )
    record(
        "tombstoned_document",
        source={"origin": _TOPIC, "file": "reference_gone.md"},
        valid_until=_PRIOR_VALID_UNTIL,
        superseded_by=tombstone_summary,
        is_tombstone=True,
    )

    with engine.begin() as conn:
        conn.execute(
            text(
                """
                INSERT INTO coord.tenants (tenant_id, slug, display_name)
                VALUES (:tenant_id, :slug, :display_name)
                """
            ),
            {
                "tenant_id": tenant_id,
                "slug": f"memrestore-{tenant_id.hex[:12]}",
                "display_name": "memrestore_01 test tenant",
            },
        )
        for row in rows:
            conn.execute(
                text(
                    """
                    INSERT INTO coord.memory_records
                        (memory_id, tenant_id, kind, title, content, content_hash,
                         source, valid_until, superseded_by, is_tombstone, embedding)
                    VALUES
                        (:memory_id, :tenant_id, :kind, :title, :content, :content_hash,
                         CAST(:source AS jsonb), CAST(:valid_until AS timestamptz),
                         :superseded_by, :is_tombstone, CAST(:embedding AS vector))
                    """
                ),
                row,
            )
    return ids


def _state(engine: Engine, tenant_id: uuid.UUID) -> dict[str, dict[str, Any]]:
    """title → the columns this revision may move, plus the ones it may not."""
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                """
                SELECT title, valid_until, superseded_by, source,
                       is_tombstone, content, content_hash
                  FROM coord.memory_records
                 WHERE tenant_id = :tenant_id
                """
            ),
            {"tenant_id": tenant_id},
        ).mappings()
        return {r["title"]: dict(r) for r in rows}


@pytest.mark.skipif(
    not can_connect(admin_database_url()),
    reason="no test Postgres reachable — set DATABASE_URL to an instance that accepts the test credentials",
)
def test_memrestore_01_restores_only_the_synthesis_superseded() -> None:
    root = backend_root()
    with ephemeral_database(admin_database_url(), "memrestore_test") as (engine, url):
        run_alembic(root, url, "upgrade", _PARENT_REVISION_ID)
        ids = _seed(engine)
        tenant_id = ids["__tenant__"]
        before = _state(engine, tenant_id)

        applied = run_alembic(root, url, "upgrade", _REVISION_ID)
        log = applied.stdout + applied.stderr
        assert "2 synthesis-superseded topic-file document(s) in scope" in log
        assert "restored 1 document(s), skipped 1 on live-dedup collision" in log

        after = _state(engine, tenant_id)

        # --- 1: restored, held, and its REAL prior state recorded -----------
        doc = after["document"]
        assert doc["valid_until"] is None
        assert doc["superseded_by"] is None
        # A real JSON boolean, not the string "true" — `_not_lifecycle_held`
        # tolerates the string, but `set_lifecycle_hold` writes a boolean.
        assert doc["source"]["lifecycle_hold"] is True

        prov = doc["source"][_PROV_KEY]
        assert prov["reason"] == "synthesis job superseded its own source document"
        assert prov["held_pending"] == "reclassification out of kind=observation"
        # The whole point of the block: these must be the values the row HAD,
        # not the nulls the same statement writes into the columns.
        assert prov["prior_valid_until"] not in (None, "None", "null", "")
        assert prov["prior_superseded_by"] == str(ids["summary"])
        recorded = sa.text("SELECT CAST(:v AS timestamptz)")
        with engine.connect() as conn:
            parsed = conn.execute(
                recorded, {"v": prov["prior_valid_until"]}
            ).scalar_one()
        assert parsed.isoformat() == _PRIOR_VALID_UNTIL

        # --- 2: collision skipped, and skipped WHOLLY -----------------------
        collided = after["collide_document"]
        assert collided["valid_until"] == before["collide_document"]["valid_until"]
        assert collided["superseded_by"] == before["collide_document"]["superseded_by"]
        assert _PROV_KEY not in collided["source"]
        assert "lifecycle_hold" not in collided["source"]
        assert (
            after["collide_live_twin"]["source"]
            == before["collide_live_twin"]["source"]
        )

        # --- 3 and 4: out of scope by predicate -----------------------------
        for title in ("dedup_loser", "tombstoned_document"):
            assert after[title] == before[title], f"{title} must not move"

        # Nothing may rewrite content, hashes or embeddings: those go through
        # the memory API so they get redaction and re-embedding.
        for title, row in after.items():
            assert row["content"] == before[title]["content"]
            assert row["content_hash"] == before[title]["content_hash"]

        # --- downgrade: exact restore, no residue ---------------------------
        run_alembic(root, url, "downgrade", _PARENT_REVISION_ID)
        reverted = _state(engine, tenant_id)
        assert reverted["document"]["valid_until"] == before["document"]["valid_until"]
        assert (
            reverted["document"]["superseded_by"] == before["document"]["superseded_by"]
        )
        assert reverted["document"]["source"] == before["document"]["source"]

        # --- re-run: same outcome, not a compounding one --------------------
        rerun = run_alembic(root, url, "upgrade", _REVISION_ID)
        rerun_log = rerun.stdout + rerun.stderr
        assert "2 synthesis-superseded topic-file document(s) in scope" in rerun_log
        assert "restored 1 document(s), skipped 1 on live-dedup collision" in rerun_log
        assert _state(engine, tenant_id)["document"] == after["document"]
