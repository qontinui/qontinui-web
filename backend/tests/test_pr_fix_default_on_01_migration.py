"""Row-level round-trip test for the ``pr_fix_default_on_01`` DATA revision.

Plan ``2026-09-12-pr-fixer-spawns-default-on-bounded-and-coordinated-with-the-author``
Phase 4c seeds the SYSTEM tenant's ``coord.policy_rules`` row for
``decision_domain='pr_fix'`` to ``autonomy_level='auto_decide'`` in
``mode='guidance'`` (``kind`` NULL — a deterministic row would need a reserved
v1 ``kind``; see the revision docstring). The revision is only DDL-light — its contract is which
row it touches, what it writes, and that ``downgrade`` puts every byte back.
None of that is visible from a green ``alembic upgrade``.

What is asserted, and why each one can break silently:

1. **INSERT case** — no system ``pr_fix`` row exists: exactly one row is
   created with the seeded values, in the shape coord's next-step settings
   façade authors (``kind`` NULL, ``condition``/``action`` ``{}``). Downgrade
   removes it; re-upgrade re-creates it.
2. **UPDATE case** — a system ``pr_fix`` row exists: the row coord's resolver
   would select is updated IN PLACE (no duplicate), and every distractor —
   a turned-off row, a tombstoned row, a repo-scoped row, and another tenant's
   row — is byte-identical afterwards. Downgrade restores the target's
   ``autonomy_level``, ``mode``, ``updated_at`` and ``updated_by`` exactly —
   including a prior DETERMINISTIC row carrying a reserved ``kind``, which the
   upgrade moves to guidance and the downgrade must move back.
3. **Idempotency** — re-running ``upgrade`` over a database whose undo ledger
   already names this revision neither double-inserts nor overwrites the
   recorded prior values.
4. **No system tenant** — the revision is a no-op rather than an error or a row
   keyed to a guessed tenant.

Substrate comes from ``_alembic_harness``: an ephemeral database inside the
test Postgres, skipped when none is reachable. A skip proves nothing — point it
at a live instance with ``QONTINUI_TEST_PG=host:port`` / ``DATABASE_URL``.
"""

from __future__ import annotations

import re
import uuid

import pytest
from sqlalchemy import text
from sqlalchemy.engine import Engine

from tests._alembic_harness import (
    admin_database_url,
    backend_root,
    can_connect,
    ephemeral_database,
    run_alembic,
    table_exists,
)

_REVISION_ID = "pr_fix_default_on_01"
_PARENT_REVISION_ID = "remote_create_01"
_REVISION_FILENAME = "pr_fix_default_on_01_system_policy_auto_decide.py"

# Literals the revision must write. Spelled out here, never imported from the
# revision, so a change to the revision's constants reddens this test.
_ACTOR = "alembic:pr_fix_default_on_01"


# ---------------------------------------------------------------------------
# Guards — no database, so these never skip.
# ---------------------------------------------------------------------------


def _revision_source() -> str:
    return (backend_root() / "alembic" / "versions" / _REVISION_FILENAME).read_text(
        encoding="utf-8"
    )


def test_the_pinned_parent_matches_the_revisions_down_revision() -> None:
    match = re.search(
        r'^down_revision[^=]*=\s*["\'](?P<parent>[^"\']+)["\']',
        _revision_source(),
        re.MULTILINE,
    )
    assert match is not None, f"no down_revision found in {_REVISION_FILENAME}"
    assert match.group("parent") == _PARENT_REVISION_ID, (
        f"{_REVISION_FILENAME} declares down_revision={match.group('parent')!r} "
        f"but this test pins {_PARENT_REVISION_ID!r}. Re-point both together."
    )


# ---------------------------------------------------------------------------
# Fixtures and helpers.
# ---------------------------------------------------------------------------


@pytest.fixture(scope="module")
def _admin_url() -> str:
    url = admin_database_url()
    if not can_connect(url):
        pytest.skip(f"no test Postgres reachable at {url}")
    return url


_ROW_COLUMNS = (
    "policy_id, tenant_id, repo, name, kind, decision_domain, mode, "
    "autonomy_level, condition, action, payload, priority, enabled, "
    "expires_at, deleted_at, created_by, updated_by, created_at, updated_at, "
    "rationale"
)


def _system_tenant(engine: Engine) -> uuid.UUID:
    with engine.connect() as conn:
        value = conn.execute(
            text("SELECT tenant_id FROM coord.tenants WHERE is_system")
        ).scalar_one()
    return uuid.UUID(str(value))


def _pr_fix_rows(engine: Engine) -> list[dict]:
    """Every ``pr_fix`` row on every tenant, keyed by all its columns."""
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                f"SELECT {_ROW_COLUMNS} FROM coord.policy_rules "  # noqa: S608 — module constant
                "WHERE COALESCE(decision_domain, kind) = 'pr_fix' "
                "ORDER BY created_at, policy_id"
            )
        ).mappings()
        return [dict(r) for r in rows]


def _insert_rule(
    engine: Engine,
    *,
    tenant_id: uuid.UUID,
    repo: str | None = None,
    autonomy_level: str = "guidance_only",
    mode: str = "guidance",
    kind: str | None = None,
    enabled: bool = True,
    deleted: bool = False,
    priority: int = 100,
    action: str = "{}",
) -> uuid.UUID:
    policy_id = uuid.uuid4()
    with engine.begin() as conn:
        conn.execute(
            text(
                """
                INSERT INTO coord.policy_rules
                    (policy_id, tenant_id, repo, name, kind, decision_domain,
                     mode, autonomy_level, condition, action, priority, enabled,
                     deleted_at, created_by, updated_by, created_at, updated_at)
                VALUES
                    (:p, :t, :repo, :name, :kind, 'pr_fix', :mode, :level,
                     '{}'::jsonb, CAST(:action AS jsonb), :prio, :enabled,
                     CASE WHEN :deleted THEN now() ELSE NULL END,
                     'operator:fixture', 'operator:fixture',
                     now() - interval '3 days', now() - interval '2 days')
                """
            ),
            {
                "p": str(policy_id),
                "t": str(tenant_id),
                "repo": repo,
                "name": f"fixture {policy_id.hex[:8]}",
                "kind": kind,
                "mode": mode,
                "level": autonomy_level,
                "action": action,
                "prio": priority,
                "enabled": enabled,
                "deleted": deleted,
            },
        )
    return policy_id


def _insert_tenant(engine: Engine) -> uuid.UUID:
    tenant_id = uuid.uuid4()
    with engine.begin() as conn:
        conn.execute(
            text(
                "INSERT INTO coord.tenants (tenant_id, slug, display_name) "
                "VALUES (:t, :s, 'pr_fix_default_on_01 fixture')"
            ),
            {"t": str(tenant_id), "s": f"prfixdefault-{tenant_id.hex[:12]}"},
        )
    return tenant_id


def _by_id(rows: list[dict]) -> dict[uuid.UUID, dict]:
    return {uuid.UUID(str(r["policy_id"])): r for r in rows}


def _assert_seeded(row: dict) -> None:
    assert row["autonomy_level"] == "auto_decide"
    assert row["mode"] == "guidance"
    assert row["repo"] is None
    assert row["enabled"] is True
    assert row["deleted_at"] is None
    assert row["updated_by"] == _ACTOR


# ---------------------------------------------------------------------------
# Live walks.
# ---------------------------------------------------------------------------


def test_insert_case_creates_one_row_and_downgrade_removes_it(_admin_url: str) -> None:
    with ephemeral_database(_admin_url, "prfixdefault_insert") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _PARENT_REVISION_ID)
        system = _system_tenant(engine)
        assert _pr_fix_rows(engine) == [], "fixture precondition: no pr_fix row yet"

        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        rows = _pr_fix_rows(engine)
        assert len(rows) == 1, f"expected exactly one seeded row, got {rows}"
        seeded = rows[0]
        assert uuid.UUID(str(seeded["tenant_id"])) == system
        assert seeded["decision_domain"] == "pr_fix"
        assert seeded["kind"] is None, (
            "policy_rules_mode_kind_check lets a guidance row carry NULL kind; a "
            "reserved kind would enrol the row in coord's v1 per-kind loader"
        )
        assert seeded["condition"] == {}
        assert seeded["action"] == {}
        assert seeded["payload"] is None
        assert seeded["created_by"] == _ACTOR
        _assert_seeded(seeded)

        run_alembic(backend_root(), db_url, "downgrade", "-1")
        assert _pr_fix_rows(engine) == [], "downgrade must remove the inserted row"
        assert not table_exists(engine, "coord", "policy_rule_seed_undo"), (
            "downgrade must drop the undo ledger"
        )

        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        again = _pr_fix_rows(engine)
        assert len(again) == 1
        _assert_seeded(again[0])


def test_update_case_touches_only_the_resolved_row_and_downgrade_restores_it(
    _admin_url: str,
) -> None:
    with ephemeral_database(_admin_url, "prfixdefault_update") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _PARENT_REVISION_ID)
        system = _system_tenant(engine)
        other = _insert_tenant(engine)

        # The prior target is DETERMINISTIC with a reserved kind and a real
        # action — the shape furthest from the seed, so a restore that forgets
        # any recorded column shows up.
        target = _insert_rule(
            engine,
            tenant_id=system,
            mode="deterministic",
            kind="escalation_rule",
            autonomy_level="always_escalate",
            action='{"type": "escalate", "escalation_message": "prior"}',
            priority=50,
        )
        # Distractors — none of them is what coord's resolver reads for the
        # system band, so none may change.
        lower_precedence = _insert_rule(engine, tenant_id=system, priority=200)
        turned_off = _insert_rule(engine, tenant_id=system, enabled=False, priority=1)
        tombstoned = _insert_rule(
            engine, tenant_id=system, enabled=False, deleted=True, priority=1
        )
        repo_scoped = _insert_rule(
            engine, tenant_id=system, repo="qontinui/qontinui-dev-notes", priority=1
        )
        foreign = _insert_rule(engine, tenant_id=other, priority=1)

        before = _by_id(_pr_fix_rows(engine))

        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        after = _by_id(_pr_fix_rows(engine))

        assert set(after) == set(before), "an UPDATE case must not insert a row"
        _assert_seeded(after[target])
        assert after[target]["kind"] == "escalation_rule", "kind is never rewritten"
        assert after[target]["action"] == before[target]["action"], (
            "action is never rewritten"
        )
        for untouched in (
            lower_precedence,
            turned_off,
            tombstoned,
            repo_scoped,
            foreign,
        ):
            assert after[untouched] == before[untouched], (
                f"row {untouched} is not the resolver's system-band pick and must "
                "be byte-identical after upgrade"
            )

        run_alembic(backend_root(), db_url, "downgrade", "-1")
        restored = _by_id(_pr_fix_rows(engine))
        assert restored == before, (
            "downgrade must restore every pr_fix row exactly — autonomy_level, "
            "mode, action, updated_at and updated_by of the target included"
        )

        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        reapplied = _by_id(_pr_fix_rows(engine))
        assert set(reapplied) == set(before)
        _assert_seeded(reapplied[target])


def test_rerun_over_a_populated_ledger_is_a_no_op(_admin_url: str) -> None:
    with ephemeral_database(_admin_url, "prfixdefault_rerun") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _PARENT_REVISION_ID)
        system = _system_tenant(engine)
        target = _insert_rule(engine, tenant_id=system)
        before = _by_id(_pr_fix_rows(engine))

        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        # Re-run upgrade() with the ledger still present: stamp back one step
        # WITHOUT running downgrade(), then upgrade again.
        run_alembic(backend_root(), db_url, "stamp", _PARENT_REVISION_ID)
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)

        rows = _by_id(_pr_fix_rows(engine))
        assert set(rows) == set(before), "a re-run must not insert a second row"
        with engine.connect() as conn:
            ledger = conn.execute(
                text(
                    "SELECT disposition, prior FROM coord.policy_rule_seed_undo "
                    "WHERE revision = :r"
                ),
                {"r": _REVISION_ID},
            ).all()
        assert len(ledger) == 1
        assert ledger[0].disposition == "updated"
        assert ledger[0].prior["autonomy_level"] == "guidance_only", (
            "a re-run must not overwrite the recorded prior values with the seeded ones"
        )

        run_alembic(backend_root(), db_url, "downgrade", "-1")
        assert _by_id(_pr_fix_rows(engine))[target] == before[target]


def test_no_system_tenant_is_a_no_op(_admin_url: str) -> None:
    with ephemeral_database(_admin_url, "prfixdefault_nosys") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _PARENT_REVISION_ID)
        with engine.begin() as conn:
            conn.execute(
                text(
                    "UPDATE coord.tenants SET is_system = false, "
                    "slug = 'renamed-' || left(tenant_id::text, 8) WHERE is_system "
                    "OR slug = 'personal-jspinak'"
                )
            )

        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        assert _pr_fix_rows(engine) == [], (
            "with no system tenant there is no system band to seed; the revision "
            "must not key a row to a guessed tenant"
        )

        run_alembic(backend_root(), db_url, "downgrade", "-1")
        assert _pr_fix_rows(engine) == []
