"""Schema + semantics test for ``strategy_p3_01_drafts_edit_sessions``.

Phase 3.1 of ``plans/2026-09-10-strategy-phase-3.md`` creates
``strategy.drafts`` and ``strategy.edit_sessions``. Nothing reads them yet, so
there is no runtime behaviour to observe — which is precisely why the contract
has to be pinned here. Every property this file asserts is one a later phase
DEPENDS ON and cannot re-derive:

* **``drafts.author_id`` is nullable.** The FK is ``ON DELETE SET NULL``, and a
  ``SET NULL`` onto a ``NOT NULL`` column is unreachable — the delete raises
  instead. Phase 2's ``threads.created_by`` / ``posts.author_id`` ship exactly
  that pairing, so "copy the neighbouring table" is the likely regression and
  it is invisible until someone deletes a user in production. Asserted twice:
  once on the catalog, once by actually deleting the user and reading the row
  back. The behavioural half is the one that can fail for the right reason.
* **``base_commit_sha`` is NOT NULL.** It is the merge base 3.5 resolves
  against and the staleness signal 3.4 refuses a publish on. A nullable column
  here defers that failure from insert time to publish time, where the draft's
  author is no longer present to answer for it.
* **The four ON DELETE actions.** ``drafts.doc_id`` CASCADE,
  ``drafts.author_id`` SET NULL, ``edit_sessions.draft_id`` CASCADE,
  ``edit_sessions.user_id`` CASCADE. Read off ``pg_constraint.confdeltype``,
  not off the migration source, so the test observes the database rather than
  restating the file it is testing.
* **``uq_edit_sessions_doc_user``.** One live session per (doc, user). Without
  it a user who re-enters the editor races a second lock against themselves and
  the "who is editing this" answer becomes non-deterministic. Asserted by
  attempting the duplicate insert, not by reading the catalog: a unique index
  that exists but is deferred or partial would pass a catalog check.
* **The downgrade leaves ``strategy`` and its Phase 1/2 tables alone.** A
  downgrade that dropped the schema would take ``spaces``, ``documents``,
  ``threads``, ``posts`` and ``mentions`` with it. That is the single most
  expensive mistake available in this revision and it is one CASCADE keyword
  away, so the downgrade walk asserts the survivors explicitly.

Substrate is ``tests/_alembic_harness`` — an ephemeral database inside the test
Postgres, skipped when none is reachable. CI provisions one at the default
``localhost:5432``; locally, point ``QONTINUI_TEST_PG`` at a reachable
instance.
"""

from __future__ import annotations

import json
import re
import uuid
from collections.abc import Iterator
from datetime import UTC, datetime

import pytest
from sqlalchemy import text
from sqlalchemy.engine import Connection, Engine
from sqlalchemy.exc import IntegrityError

from tests._alembic_harness import (
    admin_database_url,
    backend_root,
    can_connect,
    ephemeral_database,
    index_exists,
    run_alembic,
    table_exists,
)

# Pinned explicitly rather than walked from "head", so a later revision landing
# on top cannot silently change what this test exercises. The parent pin is
# enforced against the revision's own `down_revision` by the first test below.
_REVISION_ID = "strategy_p3_01_drafts_edit_sessions"
_PARENT_REVISION_ID = "ptbe_01_primary_tree_branch_events"
_REVISION_FILENAME = "strategy_p3_01_drafts_edit_sessions.py"

_SCHEMA = "strategy"

# Phase 1 + Phase 2 tables that MUST survive this revision's downgrade.
_INHERITED_TABLES = ("spaces", "documents", "threads", "posts", "mentions")

_BASE_SHA = "0" * 40
_HEAD_SHA = "1" * 40


def test_the_pinned_parent_matches_the_revisions_down_revision() -> None:
    """`_PARENT_REVISION_ID` names the revision's real parent — no DB needed.

    The walks below rewind to `_PARENT_REVISION_ID` and upgrade forward, which
    exercises THIS revision only while the pin is accurate. Let the two drift —
    which is exactly what re-pointing a stale PR onto a new main head does, since
    that edits the migration and not this file — and the rewind lands further
    back, `upgrade` replays a stretch of unrelated non-idempotent revisions, and
    the failure surfaces as a `DuplicateTable` from a migration this test never
    meant to touch.
    """
    source = (backend_root() / "alembic" / "versions" / _REVISION_FILENAME).read_text(
        encoding="utf-8"
    )
    match = re.search(
        r'^down_revision[^=]*=\s*["\'](?P<parent>[^"\']+)["\']',
        source,
        re.MULTILINE,
    )
    assert match is not None, f"no down_revision found in {_REVISION_FILENAME}"
    assert match.group("parent") == _PARENT_REVISION_ID, (
        f"{_REVISION_FILENAME} declares down_revision="
        f"{match.group('parent')!r} but this test pins "
        f"_PARENT_REVISION_ID={_PARENT_REVISION_ID!r}. Re-point both together."
    )


def _fk_delete_action(
    engine: Engine, table: str, column: str, schema: str = _SCHEMA
) -> str:
    """``pg_constraint.confdeltype`` for the FK on ``schema.table(column)``.

    One of ``a`` (NO ACTION), ``r`` (RESTRICT), ``c`` (CASCADE), ``n`` (SET
    NULL), ``d`` (SET DEFAULT). Read from the catalog rather than parsed out of
    the revision source: a test that reads the file it is testing cannot catch a
    migration that ran differently from how it reads.
    """
    sql = text(
        """
        SELECT con.confdeltype
          FROM pg_constraint con
          JOIN pg_class rel ON rel.oid = con.conrelid
          JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
          JOIN pg_attribute att
            ON att.attrelid = con.conrelid
           AND att.attnum = ANY (con.conkey)
         WHERE con.contype = 'f'
           AND nsp.nspname = :schema
           AND rel.relname = :table
           AND att.attname = :column
           AND array_length(con.conkey, 1) = 1
        """
    )
    with engine.connect() as conn:
        row = conn.execute(
            sql, {"schema": schema, "table": table, "column": column}
        ).scalar_one_or_none()
    # scalar_one_or_none, not scalar_one: a dropped FK yields NO ROW, and
    # `NoResultFound` from inside a helper reads as a broken test rather than
    # as the missing constraint it actually is.
    assert row is not None, (
        f"no single-column foreign key on {schema}.{table}({column})"
    )
    return str(row)


def _is_nullable(engine: Engine, table: str, column: str) -> bool:
    sql = text(
        """
        SELECT is_nullable
          FROM information_schema.columns
         WHERE table_schema = :schema
           AND table_name = :table
           AND column_name = :column
        """
    )
    with engine.connect() as conn:
        row = conn.execute(
            sql, {"schema": _SCHEMA, "table": table, "column": column}
        ).scalar_one_or_none()
    assert row is not None, f"no column {_SCHEMA}.{table}.{column}"
    return row == "YES"


def _placeholder(data_type: str) -> object:
    """A type-appropriate value for a NOT NULL, defaultless column.

    The seed helper below fills every such column generically so it survives
    ``auth.users`` or ``strategy.spaces`` gaining one — but generically does NOT
    mean "a string for everything". The first draft of this helper did exactly
    that and died on ``auth.users.is_beta`` with *invalid input syntax for type
    boolean*, which is a fixture failure wearing a migration failure's clothes.
    """
    t = data_type.lower()
    if t in {"boolean"}:
        return False
    if t in {"integer", "bigint", "smallint"}:
        return 0
    if t in {"numeric", "real", "double precision"}:
        return 0
    if t.startswith("timestamp") or t == "date":
        return datetime.now(UTC)
    if t in {"json", "jsonb"}:
        # A bare "{}" str binds as text and dies with *column is of type jsonb
        # but expression is of type text* — the same class of failure the
        # boolean branch above exists for, one type along.
        return json.dumps({})
    if t == "array":
        return []
    if t == "uuid":
        return uuid.uuid4()
    return f"p3-01-{uuid.uuid4().hex[:8]}"


def _insert_with_required_columns(
    conn: Connection, schema: str, table: str, **given: object
) -> None:
    """INSERT into ``schema.table`` filling every NOT NULL defaultless column.

    ``given`` supplies the columns this test actually cares about; everything
    else NOT NULL without a default gets a ``_placeholder``. Written this way so
    a column added to ``auth.users`` or ``strategy.spaces`` by unrelated work
    does not turn this file red — the alternative is a hard-coded column list,
    which is a second copy of a schema this test does not own.
    """
    required = (
        conn.execute(
            text(
                """
                SELECT column_name, data_type
                  FROM information_schema.columns
                 WHERE table_schema = :schema
                   AND table_name = :table
                   AND is_nullable = 'NO'
                   AND column_default IS NULL
                   AND is_generated = 'NEVER'
                   -- GENERATED ALWAYS AS IDENTITY reports is_generated
                   -- 'NEVER' and a NULL default, so it survives the two
                   -- filters above and would then raise *cannot insert a
                   -- non-DEFAULT value into column*.
                   AND is_identity = 'NO'
                """
            ),
            {"schema": schema, "table": table},
        )
        .mappings()
        .all()
    )
    params: dict[str, object] = dict(given)
    for row in required:
        name = row["column_name"]
        if name not in params:
            params[name] = _placeholder(row["data_type"])
    names = ", ".join(params)
    values = ", ".join(f":{c}" for c in params)
    conn.execute(
        text(f"INSERT INTO {schema}.{table} ({names}) VALUES ({values})"), params
    )


def _seed_user_space_doc(engine: Engine) -> tuple[uuid.UUID, uuid.UUID]:
    """Insert one ``auth.users`` row, one space and one document.

    Returns ``(user_id, doc_id)``. Only the columns this file asserts on are
    named explicitly; the rest are filled by ``_insert_with_required_columns``.
    """
    user_id = uuid.uuid4()
    space_id = uuid.uuid4()
    doc_id = uuid.uuid4()
    with engine.begin() as conn:
        _insert_with_required_columns(conn, "auth", "users", id=user_id)
        _insert_with_required_columns(
            conn,
            "strategy",
            "spaces",
            space_id=space_id,
            name=f"p3-01-{space_id.hex[:8]}",
            git_repo="qontinui-dev-notes",
        )
        _insert_with_required_columns(
            conn,
            "strategy",
            "documents",
            doc_id=doc_id,
            space_id=space_id,
            relative_path=f"p3-01/{doc_id.hex[:8]}.md",
            title="Phase 3.1 fixture",
            head_commit_sha=_HEAD_SHA,
        )
    return user_id, doc_id


@pytest.fixture(scope="module")
def upgraded() -> Iterator[Engine]:
    """An ephemeral database walked to ``_REVISION_ID``.

    Module-scoped: the chain is 500+ revisions and re-walking it per test would
    dominate the suite's runtime for no additional coverage. Tests that MUTATE
    the walk (the downgrade one) take their own database.
    """
    admin_url = admin_database_url()
    if not can_connect(admin_url):
        pytest.skip("no test Postgres reachable")
    with ephemeral_database(admin_url, "strategy_p3_01") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        yield engine


def test_upgrade_creates_both_tables(upgraded: Engine) -> None:
    assert table_exists(upgraded, _SCHEMA, "drafts")
    assert table_exists(upgraded, _SCHEMA, "edit_sessions")


def _indexdef(engine: Engine, index_name: str) -> str:
    """The full ``CREATE INDEX`` text PostgreSQL reconstructs for an index."""
    with engine.connect() as conn:
        row = conn.execute(
            text(
                """
                SELECT indexdef
                  FROM pg_indexes
                 WHERE schemaname = :schema AND indexname = :idx
                """
            ),
            {"schema": _SCHEMA, "idx": index_name},
        ).scalar_one_or_none()
    assert row is not None, f"no index {_SCHEMA}.{index_name}"
    return str(row)


def test_indexes_exist(upgraded: Engine) -> None:
    for name in (
        "idx_strategy_drafts_doc_open",
        "idx_strategy_drafts_doc_id",
        "idx_strategy_drafts_author",
        "idx_strategy_edit_sessions_doc",
        "idx_strategy_edit_sessions_draft",
        "idx_strategy_edit_sessions_user",
    ):
        assert index_exists(upgraded, name, schema=_SCHEMA), f"missing index {name}"


def test_the_open_drafts_index_is_actually_partial(upgraded: Engine) -> None:
    """Names alone would pass with ``postgresql_where`` deleted.

    The revision spends its longest paragraph justifying this predicate — and
    the deliberate ABSENCE of one on the edit-session index — so both halves are
    read out of ``pg_indexes.indexdef`` rather than assumed from the name.
    """
    assert "WHERE (status = 'open'::text)" in _indexdef(
        upgraded, "idx_strategy_drafts_doc_open"
    )
    # The cascade-support index must NOT be partial, or it cannot serve the
    # cascade it exists for.
    assert "WHERE" not in _indexdef(upgraded, "idx_strategy_drafts_doc_id")
    # now() is not IMMUTABLE, so this one is deliberately unconditional too.
    assert "WHERE" not in _indexdef(upgraded, "idx_strategy_edit_sessions_doc")


def test_author_id_is_nullable_so_set_null_is_reachable(upgraded: Engine) -> None:
    """The catalog half of the Phase 2 divergence. See the behavioural half below."""
    assert _is_nullable(upgraded, "drafts", "author_id"), (
        "drafts.author_id is NOT NULL while its FK is ON DELETE SET NULL — the "
        "SET NULL can never fire; deleting the author raises instead. This is "
        "the exact pairing strategy_p2_01_collab_tables ships and the reason "
        "this revision deliberately diverges from it."
    )


def test_base_commit_sha_is_not_nullable(upgraded: Engine) -> None:
    assert not _is_nullable(upgraded, "drafts", "base_commit_sha"), (
        "base_commit_sha is the merge base 3.5 resolves against and the "
        "staleness signal 3.4 refuses a publish on; a NULL defers that failure "
        "to publish time"
    )


@pytest.mark.parametrize(
    ("table", "column", "expected"),
    [
        ("drafts", "doc_id", "c"),
        ("drafts", "author_id", "n"),
        ("edit_sessions", "doc_id", "c"),
        # edit_sessions.draft_id is deliberately NOT here — its FK is the
        # COMPOSITE fk_edit_sessions_draft, asserted by name below.
        ("edit_sessions", "user_id", "c"),
    ],
)
def test_on_delete_actions(
    upgraded: Engine, table: str, column: str, expected: str
) -> None:
    assert _fk_delete_action(upgraded, table, column) == expected


def test_the_composite_draft_fk_cascades_and_targets_both_columns(
    upgraded: Engine,
) -> None:
    """``fk_edit_sessions_draft`` is (draft_id, doc_id) → drafts, ON DELETE CASCADE.

    Asserted by NAME and by arity, because the single-column reader above
    deliberately cannot see it: a regression that replaced the composite FK with
    a single-column one on ``draft_id`` would satisfy every other test in this
    file — the cascade would still work, and only the cross-document row that
    ``test_an_edit_session_cannot_point_at_another_documents_draft`` inserts
    would start being accepted.
    """
    with upgraded.connect() as conn:
        row = conn.execute(
            text(
                """
                SELECT con.confdeltype,
                       array_length(con.conkey, 1) AS n_cols,
                       reftbl.relname AS target_table
                  FROM pg_constraint con
                  JOIN pg_class rel ON rel.oid = con.conrelid
                  JOIN pg_class reftbl ON reftbl.oid = con.confrelid
                  JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
                 WHERE con.contype = 'f'
                   AND nsp.nspname = :schema
                   AND rel.relname = 'edit_sessions'
                   AND con.conname = 'fk_edit_sessions_draft'
                """
            ),
            {"schema": _SCHEMA},
        ).fetchone()
    assert row is not None, "fk_edit_sessions_draft is missing"
    assert row[0] == "c", "the composite draft FK is not ON DELETE CASCADE"
    assert row[1] == 2, (
        "fk_edit_sessions_draft is not composite — a single-column FK on "
        "draft_id lets a session claim one document while pointing at "
        "another document's draft"
    )
    assert row[2] == "drafts"


def test_deleting_a_draft_cascades_its_edit_session(upgraded: Engine) -> None:
    """The behavioural half of the composite FK's ON DELETE CASCADE."""
    user_id, doc_id = _seed_user_space_doc(upgraded)
    with upgraded.begin() as conn:
        draft_id = conn.execute(
            text(
                """
                INSERT INTO strategy.drafts (doc_id, body, base_commit_sha)
                VALUES (:doc_id, 'body', :sha)
                RETURNING draft_id
                """
            ),
            {"doc_id": doc_id, "sha": _BASE_SHA},
        ).scalar_one()
        conn.execute(
            text(
                """
                INSERT INTO strategy.edit_sessions
                       (doc_id, draft_id, user_id, expires_at)
                VALUES (:doc_id, :draft_id, :user_id,
                        now() + interval '15 minutes')
                """
            ),
            {"doc_id": doc_id, "draft_id": draft_id, "user_id": user_id},
        )
        conn.execute(
            text("DELETE FROM strategy.drafts WHERE draft_id = :draft_id"),
            {"draft_id": draft_id},
        )
    with upgraded.connect() as conn:
        remaining = conn.execute(
            text(
                "SELECT count(*) FROM strategy.edit_sessions WHERE draft_id = :draft_id"
            ),
            {"draft_id": draft_id},
        ).scalar_one()
    assert remaining == 0


def test_status_check_constraint_rejects_an_unknown_value(upgraded: Engine) -> None:
    user_id, doc_id = _seed_user_space_doc(upgraded)
    with pytest.raises(IntegrityError) as excinfo:
        with upgraded.begin() as conn:
            conn.execute(
                text(
                    """
                    INSERT INTO strategy.drafts
                           (doc_id, author_id, body, base_commit_sha, status)
                    VALUES (:doc_id, :author_id, 'body', :sha, 'nonsense')
                    """
                ),
                {"doc_id": doc_id, "author_id": user_id, "sha": _BASE_SHA},
            )
    assert "ck_strategy_drafts_status" in str(excinfo.value)


def test_deleting_the_author_nulls_the_column_and_keeps_the_body(
    upgraded: Engine,
) -> None:
    """The behavioural half: the delete must SUCCEED and the draft must survive.

    A NOT NULL ``author_id`` fails here with a NotNullViolation, which is the
    regression this pair of tests exists to catch. Asserting the catalog alone
    would pass against a column that is nullable but whose FK was written
    ``ON DELETE CASCADE`` — that would delete the draft instead, which is also
    wrong and also caught here.
    """
    user_id, doc_id = _seed_user_space_doc(upgraded)
    with upgraded.begin() as conn:
        draft_id = conn.execute(
            text(
                """
                INSERT INTO strategy.drafts
                       (doc_id, author_id, body, base_commit_sha)
                VALUES (:doc_id, :author_id, 'draft body', :sha)
                RETURNING draft_id
                """
            ),
            {"doc_id": doc_id, "author_id": user_id, "sha": _BASE_SHA},
        ).scalar_one()

    with upgraded.begin() as conn:
        conn.execute(text("DELETE FROM auth.users WHERE id = :id"), {"id": user_id})

    with upgraded.connect() as conn:
        row = conn.execute(
            text(
                """
                SELECT author_id, body
                  FROM strategy.drafts
                 WHERE draft_id = :draft_id
                """
            ),
            {"draft_id": draft_id},
        ).fetchone()
    assert row is not None, "the draft was deleted with its author — FK is CASCADE"
    assert row[0] is None
    assert row[1] == "draft body"


def test_deleting_the_document_cascades_its_drafts(upgraded: Engine) -> None:
    user_id, doc_id = _seed_user_space_doc(upgraded)
    with upgraded.begin() as conn:
        conn.execute(
            text(
                """
                INSERT INTO strategy.drafts
                       (doc_id, author_id, body, base_commit_sha)
                VALUES (:doc_id, :author_id, 'body', :sha)
                """
            ),
            {"doc_id": doc_id, "author_id": user_id, "sha": _BASE_SHA},
        )
        conn.execute(
            text("DELETE FROM strategy.documents WHERE doc_id = :doc_id"),
            {"doc_id": doc_id},
        )
    with upgraded.connect() as conn:
        remaining = conn.execute(
            text("SELECT count(*) FROM strategy.drafts WHERE doc_id = :doc_id"),
            {"doc_id": doc_id},
        ).scalar_one()
    assert remaining == 0


def test_one_edit_session_per_doc_and_user(upgraded: Engine) -> None:
    """The uniqueness is asserted by COLLIDING, not by reading the catalog.

    A unique index that exists but is partial, or deferred, satisfies a catalog
    read and still lets a user race a second lock against themselves.
    """
    user_id, doc_id = _seed_user_space_doc(upgraded)
    insert = text(
        """
        INSERT INTO strategy.edit_sessions (doc_id, user_id, expires_at)
        VALUES (:doc_id, :user_id, now() + interval '15 minutes')
        """
    )
    with upgraded.begin() as conn:
        conn.execute(insert, {"doc_id": doc_id, "user_id": user_id})

    with pytest.raises(IntegrityError) as excinfo:
        with upgraded.begin() as conn:
            conn.execute(insert, {"doc_id": doc_id, "user_id": user_id})
    assert "uq_edit_sessions_doc_user" in str(excinfo.value)


def test_published_at_is_check_tied_to_status(upgraded: Engine) -> None:
    """A row is published exactly when it carries a publish timestamp.

    Both directions are exercised: ``published`` with no timestamp, and a
    timestamp on a row that is still ``open``. A one-directional CHECK would
    pass the first and fail only the second.
    """
    user_id, doc_id = _seed_user_space_doc(upgraded)
    base = {"doc_id": doc_id, "author_id": user_id, "sha": _BASE_SHA}

    with pytest.raises(IntegrityError) as published_without_stamp:
        with upgraded.begin() as conn:
            conn.execute(
                text(
                    """
                    INSERT INTO strategy.drafts
                           (doc_id, author_id, body, base_commit_sha, status)
                    VALUES (:doc_id, :author_id, 'b', :sha, 'published')
                    """
                ),
                base,
            )
    assert "ck_strategy_drafts_published_at" in str(published_without_stamp.value)

    with pytest.raises(IntegrityError) as stamped_while_open:
        with upgraded.begin() as conn:
            conn.execute(
                text(
                    """
                    INSERT INTO strategy.drafts
                           (doc_id, author_id, body, base_commit_sha,
                            status, published_at)
                    VALUES (:doc_id, :author_id, 'b', :sha, 'open', now())
                    """
                ),
                base,
            )
    assert "ck_strategy_drafts_published_at" in str(stamped_while_open.value)


def test_an_edit_session_cannot_point_at_another_documents_draft(
    upgraded: Engine,
) -> None:
    """The composite FK. A single-column FK on draft_id would accept this row.

    Without it a session claims ``doc_id = A`` while its draft belongs to B, and
    3.2's "who is editing this doc" join on ``doc_id`` surfaces it as a session
    on A — wrong, with nothing anywhere to catch it.
    """
    user_a, doc_a = _seed_user_space_doc(upgraded)
    _, doc_b = _seed_user_space_doc(upgraded)
    with upgraded.begin() as conn:
        draft_on_b = conn.execute(
            text(
                """
                INSERT INTO strategy.drafts (doc_id, body, base_commit_sha)
                VALUES (:doc_id, 'body', :sha)
                RETURNING draft_id
                """
            ),
            {"doc_id": doc_b, "sha": _BASE_SHA},
        ).scalar_one()

    with pytest.raises(IntegrityError) as excinfo:
        with upgraded.begin() as conn:
            conn.execute(
                text(
                    """
                    INSERT INTO strategy.edit_sessions
                           (doc_id, draft_id, user_id, expires_at)
                    VALUES (:doc_id, :draft_id, :user_id,
                            now() + interval '15 minutes')
                    """
                ),
                {"doc_id": doc_a, "draft_id": draft_on_b, "user_id": user_a},
            )
    assert "fk_edit_sessions_draft" in str(excinfo.value)


def test_a_session_may_precede_its_draft(upgraded: Engine) -> None:
    """MATCH SIMPLE: the composite FK must NOT fire while draft_id is NULL.

    The paired half of the test above. A composite FK declared MATCH FULL would
    reject this row, which would break the editor's entry sequence (acquire the
    session on entry, create the draft on first keystroke) — so this asserts the
    permissive direction is still permitted.
    """
    user_id, doc_id = _seed_user_space_doc(upgraded)
    with upgraded.begin() as conn:
        conn.execute(
            text(
                """
                INSERT INTO strategy.edit_sessions (doc_id, user_id, expires_at)
                VALUES (:doc_id, :user_id, now() + interval '15 minutes')
                """
            ),
            {"doc_id": doc_id, "user_id": user_id},
        )
    with upgraded.connect() as conn:
        count = conn.execute(
            text(
                """
                SELECT count(*) FROM strategy.edit_sessions
                 WHERE doc_id = :doc_id AND draft_id IS NULL
                """
            ),
            {"doc_id": doc_id},
        ).scalar_one()
    assert count == 1


def test_updating_a_draft_moves_updated_at(upgraded: Engine) -> None:
    """The trigger. Both draft indexes sort on this column.

    Without a maintainer the column keeps its insert-time value, so "newest
    first" silently means "created first" — a wrong ordering that looks right,
    which is why it is asserted rather than assumed. The UPDATE deliberately
    does NOT set updated_at, so only the trigger can move it.
    """
    user_id, doc_id = _seed_user_space_doc(upgraded)
    with upgraded.begin() as conn:
        draft_id, first = conn.execute(
            text(
                """
                INSERT INTO strategy.drafts
                       (doc_id, author_id, body, base_commit_sha)
                VALUES (:doc_id, :author_id, 'v1', :sha)
                RETURNING draft_id, updated_at
                """
            ),
            {"doc_id": doc_id, "author_id": user_id, "sha": _BASE_SHA},
        ).one()

    with upgraded.begin() as conn:
        second = conn.execute(
            text(
                """
                UPDATE strategy.drafts SET body = 'v2'
                 WHERE draft_id = :draft_id
                RETURNING updated_at
                """
            ),
            {"draft_id": draft_id},
        ).scalar_one()

    assert second > first, (
        "updated_at did not move on UPDATE — strategy.set_updated_at is not "
        "firing, and both draft indexes sort on this column"
    )


def test_downgrade_drops_only_this_revisions_tables() -> None:
    """Walk up, back and up again on a database of this test's own.

    The re-upgrade is not decoration: a downgrade that left an index, a
    constraint or a type behind passes the "tables are gone" assertion and then
    fails the second upgrade, which is where residue actually shows up.
    """
    admin_url = admin_database_url()
    if not can_connect(admin_url):
        pytest.skip("no test Postgres reachable")

    with ephemeral_database(admin_url, "strategy_p3_01_down") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        assert table_exists(engine, _SCHEMA, "drafts")
        assert table_exists(engine, _SCHEMA, "edit_sessions")

        run_alembic(backend_root(), db_url, "downgrade", _PARENT_REVISION_ID)
        assert not table_exists(engine, _SCHEMA, "drafts")
        assert not table_exists(engine, _SCHEMA, "edit_sessions")

        # DROP TABLE takes the trigger but not the function behind it. A
        # residual strategy.set_updated_at makes the re-upgrade below fail on
        # CREATE FUNCTION, which is the whole reason that walk is here — but
        # assert it directly too, so the diagnosis names the function rather
        # than arriving as an opaque alembic failure.
        with engine.connect() as conn:
            residual = conn.execute(
                text("SELECT to_regproc('strategy.set_updated_at')")
            ).scalar_one_or_none()
        assert residual is None, (
            "downgrade left strategy.set_updated_at behind; the next upgrade "
            "will fail on CREATE FUNCTION"
        )

        # The whole point of leaving `CREATE SCHEMA` out of upgrade(): the
        # downgrade must not take Phase 1 and Phase 2 with it.
        for table in _INHERITED_TABLES:
            assert table_exists(engine, _SCHEMA, table), (
                f"downgrade dropped strategy.{table}, which this revision does not own"
            )

        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        assert table_exists(engine, _SCHEMA, "drafts")
        assert table_exists(engine, _SCHEMA, "edit_sessions")
