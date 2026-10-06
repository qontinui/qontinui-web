"""Seed contract test for the ``gate_arming_02`` revision.

``gate_arming_02_seed_phase_coverage_promotion`` writes the
``phase_coverage_promotion`` row of ``coord.gate_arming_instants`` — the data
half of Phase 1 of plan
``2026-09-23-phase-gate-armed-at-is-a-compiled-guess-at-its-own-deploy-time``
(``gate_arming_01`` is the schema half).

What this file pins:

1. **The seed equals coord's live interim literal exactly**
   (``2026-09-27T00:00:00Z``, ``phase_gate_armed_at()`` in coord's
   ``delivery_view.rs``). Any other value applies cleanly and silently moves a
   gate that is already enforcing: later grandfathers units shipped under it,
   earlier withholds units that were exempt. Asserted from what ``upgrade()``
   actually executes (no database, never skips) and from the row it writes.
2. **Re-running the seed never overwrites an existing instant**
   (``ON CONFLICT DO NOTHING``): an armed instant is immutable once written.
3. **Downgrading the seed is a no-op** — the instant survives.
"""

from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path

import pytest

from tests._alembic_harness import (
    admin_database_url,
    backend_root,
    can_connect,
    ephemeral_database,
    load_revision_module,
    run_alembic,
    scalar,
    upgrade_execute_calls,
)

_REVISION_ID = "gate_arming_02"
_SCHEMA_REVISION_ID = "gate_arming_01"
_REVISION_PATH = (
    Path(__file__).resolve().parents[1]
    / "alembic"
    / "versions"
    / "gate_arming_02_seed_phase_coverage_promotion.py"
)

# coord's interim compiled literal, live since this instant.
_LIVE_ARMED_AT = datetime(2026, 9, 27, 0, 0, 0, tzinfo=UTC)

_READ_SEED = (
    "SELECT armed_at FROM coord.gate_arming_instants "
    "WHERE gate_key = 'phase_coverage_promotion'"
)


def _seed_sql() -> str:
    calls = upgrade_execute_calls(_REVISION_PATH)
    assert len(calls) == 1, calls
    assert calls[0].sql is not None, "op.execute arg must be a static literal"
    return " ".join(calls[0].sql.split())


def test_revision_source_seeds_the_live_instant() -> None:
    """No database: upgrade() inserts the key at the exact live instant."""
    module = load_revision_module(_REVISION_PATH, "gate_arming_02_under_test")
    assert module.revision == _REVISION_ID
    assert module.down_revision == _SCHEMA_REVISION_ID

    seed = _seed_sql()
    assert "VALUES ('phase_coverage_promotion', '2026-09-27T00:00:00Z')" in seed, seed
    assert "ON CONFLICT DO NOTHING" in seed, seed
    # The seed must NOT be stamped with now(): that would re-arm a live gate.
    assert "now()" not in seed.lower(), seed


@pytest.mark.skipif(
    not can_connect(admin_database_url()),
    reason=(
        "Postgres not reachable at the conftest URL. CI provisions a "
        "postgres service; locally, bring up a backend Postgres before "
        "running this test."
    ),
)
def test_seed_writes_the_live_instant_once() -> None:
    """upgrade → exact instant → re-seed no-op → downgrade keeps it → up."""
    root = backend_root()

    with ephemeral_database(admin_database_url(), "gate_arming_02_test") as (
        engine,
        url,
    ):
        run_alembic(root, url, "upgrade", _SCHEMA_REVISION_ID)
        assert scalar(engine, "SELECT count(*) FROM coord.gate_arming_instants") == 0

        run_alembic(root, url, "upgrade", _REVISION_ID)
        assert scalar(engine, _READ_SEED) == _LIVE_ARMED_AT

        with engine.begin() as conn:
            conn.exec_driver_sql(_seed_sql())
        assert (
            scalar(
                engine,
                "SELECT count(*) FROM coord.gate_arming_instants "
                "WHERE gate_key = 'phase_coverage_promotion'",
            )
            == 1
        )
        assert scalar(engine, _READ_SEED) == _LIVE_ARMED_AT

        run_alembic(root, url, "downgrade", _SCHEMA_REVISION_ID)
        assert scalar(engine, _READ_SEED) == _LIVE_ARMED_AT

        run_alembic(root, url, "upgrade", _REVISION_ID)
        assert scalar(engine, _READ_SEED) == _LIVE_ARMED_AT
