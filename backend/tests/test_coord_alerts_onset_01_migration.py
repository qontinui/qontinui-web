"""Behaviour test for the ``coord_alerts_onset_01`` revision.

The revision adds three nullable columns to ``coord.alerts`` (``onset_at``,
``onset_basis``, ``visible_at``) and two ``NOT VALID`` CHECK constraints:
``onset_basis`` is NULL or one of a closed five-value vocabulary, and an
``onset_at`` may not be stored without a basis.

What is asserted
================

1. Nothing exists at the parent revision.
2. After upgrade the three columns exist, are NULLable, have no default, and
   carry the declared types — an existing row reads as onset UNKNOWN (all
   NULL), never as a substituted ``first_seen_at``.
3. Both constraints exist as CHECKs and are ``NOT VALID`` (catalog-only on a
   1.47 M-row table; a validated CHECK would scan it under ACCESS EXCLUSIVE).
4. Every vocabulary value is accepted with an onset, ``'none'`` is accepted
   with a NULL onset, and an all-NULL row is accepted.
5. **The constraints bite on new writes despite NOT VALID:** an unknown basis
   is refused, and an ``onset_at`` with no basis is refused.
6. Downgrade removes the constraints and the columns; rows survive.
7. **Idempotency against a column that already exists** (the
   ``ADD COLUMN IF NOT EXISTS`` guard): after the downgrade, a schema that
   already carries ``onset_at`` re-upgrades cleanly with both constraints.

Substrate comes from ``_alembic_harness``: an ephemeral database inside the
test Postgres, skipped when none is reachable.
"""

from __future__ import annotations

import pytest
from sqlalchemy import text
from sqlalchemy.engine import Engine
from sqlalchemy.exc import IntegrityError

from tests._alembic_harness import (
    admin_database_url,
    backend_root,
    can_connect,
    column_info,
    ephemeral_database,
    run_alembic,
)

_REVISION_ID = "coord_alerts_onset_01"
_PARENT_REVISION_ID = "coord_ci_pool_observations_01"

_COLUMNS = {
    "onset_at": "timestamp with time zone",
    "onset_basis": "text",
    "visible_at": "timestamp with time zone",
}

_CONSTRAINTS = ("alerts_onset_basis_check", "alerts_onset_basis_required_check")

_BASES = (
    "last_healthy_sample",
    "last_heartbeat",
    "runner_reported",
    "claim_last_held",
    "none",
)

_SKIP_REASON = (
    "Postgres not reachable at the conftest URL. CI provisions a postgres "
    "service; locally, bring up a backend Postgres before running this test."
)


def _constraints(engine: Engine) -> dict[str, tuple[str, bool]]:
    """``{name: (contype, convalidated)}`` for this revision's constraints."""
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                """
                SELECT c.conname, c.contype, c.convalidated
                  FROM pg_constraint c
                  JOIN pg_class t ON t.oid = c.conrelid
                  JOIN pg_namespace n ON n.oid = t.relnamespace
                 WHERE n.nspname = 'coord' AND t.relname = 'alerts'
                   AND c.conname = ANY(:names)
                """
            ),
            {"names": list(_CONSTRAINTS)},
        ).all()
    return {str(r[0]): (str(r[1]), bool(r[2])) for r in rows}


def _insert_alert(
    engine: Engine,
    key: str,
    onset_basis: str | None,
    with_onset: bool,
) -> None:
    with engine.begin() as conn:
        conn.execute(
            text(
                """
                INSERT INTO coord.alerts
                    (alert_key, severity, kind, summary,
                     onset_at, onset_basis, visible_at)
                VALUES
                    (:key, 'warning', 'pr_merge_stuck', 'onset test',
                     CASE WHEN :with_onset THEN now() - interval '5 minutes' END,
                     :basis, now())
                """
            ),
            {"key": key, "basis": onset_basis, "with_onset": with_onset},
        )


def _alert_count(engine: Engine) -> int:
    with engine.connect() as conn:
        return int(conn.execute(text("SELECT count(*) FROM coord.alerts")).scalar_one())


@pytest.mark.skipif(not can_connect(admin_database_url()), reason=_SKIP_REASON)
def test_coord_alerts_onset_01_adds_columns_and_not_valid_checks() -> None:
    """Add the onset/visibility columns and prove both CHECKs bite."""
    root = backend_root()

    with ephemeral_database(admin_database_url(), "coord_alerts_onset_test") as (
        engine,
        url,
    ):
        # 1. Parent revision — nothing yet. Seed a pre-existing alert so the
        #    upgrade runs against a non-empty table.
        run_alembic(root, url, "upgrade", _PARENT_REVISION_ID)
        for column in _COLUMNS:
            assert column_info(engine, "alerts", column) is None, (
                f"coord.alerts.{column} must be added by this revision"
            )
        assert _constraints(engine) == {}
        with engine.begin() as conn:
            conn.execute(
                text(
                    """
                    INSERT INTO coord.alerts (alert_key, severity, kind, summary)
                    VALUES ('pre-existing', 'warning', 'pr_merge_stuck', 'pre')
                    """
                )
            )

        # 2. Apply — nullable, default-less, correctly typed; the existing row
        #    reads as onset UNKNOWN rather than inheriting first_seen_at.
        run_alembic(root, url, "upgrade", _REVISION_ID)
        for column, data_type in _COLUMNS.items():
            info = column_info(engine, "alerts", column)
            assert info == (data_type, "YES", None), (
                f"coord.alerts.{column}: expected nullable {data_type} with no "
                f"default, got {info!r}"
            )
        with engine.connect() as conn:
            pre = conn.execute(
                text(
                    """
                    SELECT onset_at, onset_basis, visible_at
                      FROM coord.alerts WHERE alert_key = 'pre-existing'
                    """
                )
            ).one()
        assert tuple(pre) == (None, None, None), (
            "existing rows must read onset-unknown, never a substituted value"
        )

        # 3. Both constraints are CHECKs, added NOT VALID (no table scan).
        assert _constraints(engine) == dict.fromkeys(_CONSTRAINTS, ("c", False))

        # 4. The whole vocabulary is accepted with an onset; 'none' with a
        #    NULL onset (the UNKNOWN case); an all-NULL row (a pre-Phase-4
        #    coord writer).
        for basis in _BASES:
            _insert_alert(engine, f"with-onset-{basis}", basis, with_onset=True)
        _insert_alert(engine, "basis-none-no-onset", "none", with_onset=False)
        _insert_alert(engine, "no-basis-no-onset", None, with_onset=False)

        # 5. NOT VALID still enforces on new writes.
        with pytest.raises(IntegrityError, match="alerts_onset_basis_check"):
            _insert_alert(engine, "bad-basis", "first_seen_at", with_onset=True)
        with pytest.raises(IntegrityError, match="alerts_onset_basis_required_check"):
            _insert_alert(engine, "onset-without-basis", None, with_onset=True)
        with pytest.raises(IntegrityError, match="alerts_onset_basis_required_check"):
            with engine.begin() as conn:
                conn.execute(
                    text(
                        """
                        UPDATE coord.alerts SET onset_at = now()
                         WHERE alert_key = 'pre-existing'
                        """
                    )
                )

        # 6. Downgrade removes constraints + columns; rows survive.
        rows_before = _alert_count(engine)
        run_alembic(root, url, "downgrade", _PARENT_REVISION_ID)
        for column in _COLUMNS:
            assert column_info(engine, "alerts", column) is None, (
                f"downgrade must drop coord.alerts.{column}"
            )
        assert _constraints(engine) == {}
        assert _alert_count(engine) == rows_before, "downgrade must not delete alerts"

        # 7. A column that already exists (a self-heal mirror, a partial
        #    hand-apply) does not break the upgrade: ADD COLUMN IF NOT EXISTS.
        with engine.begin() as conn:
            conn.execute(
                text("ALTER TABLE coord.alerts ADD COLUMN onset_at TIMESTAMPTZ")
            )
        run_alembic(root, url, "upgrade", _REVISION_ID)
        for column, data_type in _COLUMNS.items():
            assert column_info(engine, "alerts", column) == (data_type, "YES", None)
        assert _constraints(engine) == dict.fromkeys(_CONSTRAINTS, ("c", False))
