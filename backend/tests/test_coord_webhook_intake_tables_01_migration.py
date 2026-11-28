"""Structural test for the three revisions of R14 intake Phase 1.

``coord_webhook_deliveries_01`` -> ``coord_ci_job_queue_waits_01`` ->
``coord_stream_consumer_dedup_01``. No database needed: pins the chain, the
``coord.`` qualification of every DDL object, and that each table has a PK.
"""

from __future__ import annotations

import re
from pathlib import Path

_VERSIONS = Path(__file__).resolve().parents[1] / "alembic" / "versions"

_CHAIN = (
    (
        "coord_webhook_deliveries_01_create.py",
        "coord_webhook_deliveries_01",
        "coord_maint_agent_req_01",
    ),
    (
        "coord_ci_job_queue_waits_01_create.py",
        "coord_ci_job_queue_waits_01",
        "coord_webhook_deliveries_01",
    ),
    (
        "coord_stream_consumer_dedup_01_create.py",
        "coord_stream_consumer_dedup_01",
        "coord_ci_job_queue_waits_01",
    ),
)


def test_chain_is_linear_and_headers_agree() -> None:
    for filename, rev, parent in _CHAIN:
        src = (_VERSIONS / filename).read_text(encoding="utf-8")
        assert f'revision: str = "{rev}"' in src
        assert f'= "{parent}"' in src
        assert f"Revises: {parent}" in src
        assert (_VERSIONS / f"{parent}.py").exists() or any(
            f'revision: str = "{parent}"' in p.read_text(encoding="utf-8")
            for p in _VERSIONS.glob("*.py")
        )


def test_every_ddl_object_is_coord_qualified_and_tables_have_pk() -> None:
    for filename, _rev, _parent in _CHAIN:
        src = (_VERSIONS / filename).read_text(encoding="utf-8")
        for m in re.finditer(
            r"(?:CREATE TABLE IF NOT EXISTS|DROP TABLE IF EXISTS)\s+(\S+)", src
        ):
            assert m.group(1).startswith("coord."), m.group(0)
        for m in re.finditer(r"ON\s+(\S+)\s*\(", src):
            assert m.group(1).startswith("coord."), m.group(0)
        assert "PRIMARY KEY" in src
