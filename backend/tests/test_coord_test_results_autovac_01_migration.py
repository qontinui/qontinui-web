"""Behaviour test for ``coord_test_results_autovac_01``.

The revision sets two autovacuum storage parameters on ``coord.test_results``.

What is asserted
================

1. At the parent revision ``coord.test_results`` carries no ``reloptions``.
2. After upgrade it carries exactly
   ``autovacuum_vacuum_scale_factor=0.01`` and
   ``autovacuum_vacuum_threshold=10000`` — nothing else.
3. Downgrade RESETs both, leaving no ``reloptions`` at all.
"""

from __future__ import annotations

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

_PARENT_REVISION_ID = "coord_smckpt_01_success_metric_checkpoint_results"
_AUTOVAC_REVISION_ID = "coord_test_results_autovac_01"


def _test_results_reloptions(engine: Engine) -> list[str] | None:
    with engine.connect() as conn:
        return conn.execute(
            text(
                "SELECT reloptions FROM pg_class WHERE oid = 'coord.test_results'::regclass"
            )
        ).scalar()


@pytest.mark.skipif(
    not can_connect(admin_database_url()),
    reason=(
        "Postgres not reachable at the conftest URL. CI provisions a "
        "postgres service; locally, bring up a backend Postgres before "
        "running this test."
    ),
)
def test_coord_test_results_autovac_01() -> None:
    root = backend_root()

    with ephemeral_database(admin_database_url(), "coord_autovac_test") as (
        engine,
        url,
    ):
        # Claim 1 — parent: no reloptions.
        run_alembic(root, url, "upgrade", _PARENT_REVISION_ID)
        assert _test_results_reloptions(engine) is None

        # Claim 2 — upgrade sets exactly the two parameters.
        run_alembic(root, url, "upgrade", _AUTOVAC_REVISION_ID)
        assert sorted(_test_results_reloptions(engine) or []) == [
            "autovacuum_vacuum_scale_factor=0.01",
            "autovacuum_vacuum_threshold=10000",
        ]

        # Claim 3 — downgrade RESETs both.
        run_alembic(root, url, "downgrade", _PARENT_REVISION_ID)
        assert _test_results_reloptions(engine) is None, (
            "downgrade must RESET the two parameters, leaving no reloptions"
        )
