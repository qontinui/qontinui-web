"""Data-semantics test for the ``memhold_adjudicate_02`` revision.

The final step of plan
``D:/qontinui-root/plans/2026-07-28-adjudicate-the-67-sync-conflict-sidecars-now-in-coord.md``:
``memhold_adjudicate_01`` landed the operator's dispositions but touched no
``content``, so it left the 11 ``'topic-file'`` winners and the 12
``merged``/``loser`` sidecars HELD. This revision writes the adjudicated text
onto the winners from a JSON payload shipped beside it, NULLs their embeddings
for the re-index sweep to heal, and releases both remaining holds.

Like its two siblings the revision authors **no schema**, so its whole contract
is which rows it touches and what it writes. This test seeds the parent
revision with one fixture per branch, walks one step up, and asserts the
resulting rows — then re-runs, downgrades and re-upgrades.

⚠️ **The fixture is keyed on the SHIPPED payload**, not on a parallel one: it
seeds a sidecar + winner for each of the six real ``(project, base_file)``
pairs, taken from ``memhold_adjudicate_01``'s own ``_CONTENT_DECISIONS``. So
these assertions exercise the bytes that will actually be written to prod, and
a payload edit that breaks resolution fails here.

Cases covered (each a distinct branch of the revision's SQL)
============================================================

1. **A resolvable winner per disposition** — five ``merged`` records and the
   one ``loser``. Content + ``content_hash`` written, ``embedding`` and
   ``embedding_model`` NULLed, the pre-image stashed in
   ``source.adjudication.prior_content`` / ``prior_content_hash``.
2. **Two sidecars for one base file with different dispositions** — the real
   ``project_runner_as_ci_node_migration.md`` pair. Both resolve to the SAME
   winner, so the record must resolve to exactly ONE row, not two. The
   ``winner``-dispositioned one already reads ``lifecycle_hold = false``
   (``memhold_adjudicate_01`` released it) and must stay that way.
3. **A dead duplicate winner** — the Phase-4a import ran twice. The tombstoned,
   OLDER row must not receive the text (liveness ranks ahead of ``created_at``)
   but must still have its hold released: it is in the contested set.
4. **A NULL-project ``topic-file`` decoy for a base file in another project
   directory** — live and OLDER, so liveness and ``created_at`` alone would
   pick it. Only the project-exactness key ahead of them lands the text on the
   right row. This is the ranking term ``memhold_adjudicate_01`` introduced,
   and it is what keeps ~78 KB of adjudicated text out of an unrelated
   project's record.
5. **A sidecar with a NULL ``source.project``** — resolved from the
   ``[sync-conflict sidecar] <project>/<file>`` title. 80 of the 138 prod rows
   are this shape.
6. **A second tenant** — holds a ``'topic-file'`` row for one of the payload's
   base files, exact project, live, and OLDER than tenant 1's, so it WINS the
   ranking if ``s.tenant_id = w.tenant_id`` were dropped. It must be untouched:
   ``source.file`` is a bare filename, and a payload record carries no tenant
   of its own, so the tenant equality is the only thing keeping one tenant's
   adjudicated text out of another's corpus. Its hold must NOT be released
   either — no sidecar in that tenant means it is not in the contested set.
7. **A colliding live row** — another live row in the same tenant already
   holding the adjudicated text's ``content_hash``.
   ``uq_memory_records_tenant_content_hash_live`` is a partial UNIQUE index on
   ``(tenant_id, content_hash)`` over exactly the live rows, so the write would
   raise a ``UniqueViolation`` whose message names the index and not the
   record. The revision must SKIP that record, name both ids at ERROR, and
   count it into the partition invariant.
8. **An already-updated row** — its ``content_hash`` is already the payload's,
   so the ``IS DISTINCT FROM`` guard must skip the whole UPDATE: no rowcount,
   no re-stash (a re-stash would overwrite ``prior_content`` with the NEW text
   and turn the downgrade into a lie) and no embedding NULLing.

Then three walks:

* **re-run** (``stamp`` back to the parent, upgrade again) — nothing moves,
  every written/released count reports 0, and ``landed`` still reports the full
  5 because it is counted from the END state rather than from the rowcount.
* **downgrade** — content + ``content_hash`` restored from the stash, the stamp
  gone, both hold sets back to ``true``.
* **re-upgrade** — the selection is re-derivable.

Substrate comes from ``_alembic_harness`` (shared with the other migration
tests): an ephemeral DB inside the test Postgres, skipped when none is
reachable. ⚠️ A skip proves nothing — point it at a live instance with
``QONTINUI_TEST_PG=localhost:5433`` if 5432 is not the one accepting the test
credentials.

The four guard tests need no database and therefore never skip: they cover the
checks whose whole job is to abort a forward-only production apply before it
writes.
"""

from __future__ import annotations

import hashlib
import importlib.util
import json
import os
import subprocess
import uuid
from pathlib import Path
from types import ModuleType
from typing import Any

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

# Pinned explicitly rather than "head" so a later migration landing on top
# cannot silently change what this test walks.
_REVISION_ID = "memhold_adjudicate_02"
_PARENT_REVISION_ID = "memhold_adjudicate_01"
_REVISION_FILENAME = "memhold_adjudicate_02_texts.py"

_SIDECAR_ORIGIN = "sync-conflict-sidecar"
_WINNER_ORIGIN = "topic-file"

_ROOT_PROJECT = "D--qontinui-root"
_COORD_PROJECT = "D--qontinui-root-qontinui-coord"
_RUNNER_PROJECT = "D--qontinui-root-qontinui-runner"
_OTHER_PROJECT = "D--qontinui-root-qontinui-supervisor"

_PLAN_SLUG = "2026-07-28-adjudicate-the-67-sync-conflict-sidecars-now-in-coord"
_GATE_ID = "925c3ab3-9d05-429b-b218-0d1c97262c54"

# The six payload targets, and — for the two-sidecars case — the real
# `.conflict-<account>-<stamp>.md` names from memhold_adjudicate_01's manifest
# table. Base files first: they are what the payload is keyed on.
_RUNNER_CI_BASE = "project_runner_as_ci_node_migration.md"
_NONCE_BASE = "reference_coord_mcp_client_caches_stale_nonce_across_runner_restart.md"
_RECONCILER_BASE = (
    "reference_coord_reconciler_freeze_reeval_lookready_and_missing_rows.md"
)
_REPAIR_BASE = "pr-repair-session-is-read-only.md"
_WORKTREE_BASE = "repair-worktree-tool-gating.md"
_DEP_EDGE_BASE = "pr-754-stale-cross-repo-dep-edge.md"

# (project, base_file) → the winner fixture's title. Titles double as the
# fixture names in every assertion below.
_WINNER_RUNNER_CI = "winner: project_runner_as_ci_node_migration"
_WINNER_RUNNER_CI_DEAD = "winner: project_runner_as_ci_node_migration (dead duplicate)"
_WINNER_NONCE = "winner: reference_coord_mcp_client_caches_stale_nonce"
_WINNER_RECONCILER = "winner: reference_coord_reconciler_freeze_reeval"
_WINNER_RECONCILER_DECOY = (
    "winner: reference_coord_reconciler_freeze_reeval (NULL project, older)"
)
_WINNER_REPAIR = "winner: pr-repair-session-is-read-only"
_WINNER_WORKTREE = "winner: repair-worktree-tool-gating (already updated)"
_WINNER_DEP_EDGE = "winner: pr-754-stale-cross-repo-dep-edge"

_SIDECAR_RUNNER_CI_MERGED = (
    f"[sync-conflict sidecar] {_ROOT_PROJECT}/"
    f"{_RUNNER_CI_BASE}.conflict-tiohorst-2026-07-23T02-50-41Z.md"
)
_SIDECAR_RUNNER_CI_WINNER = (
    f"[sync-conflict sidecar] {_ROOT_PROJECT}/"
    f"{_RUNNER_CI_BASE}.conflict-tiohorst-2026-07-21T05-24-53Z.md"
)
_SIDECAR_NONCE = (
    f"[sync-conflict sidecar] {_ROOT_PROJECT}/"
    f"{_NONCE_BASE}.conflict-qontinui-2026-07-21T05-24-48Z.md"
)
_SIDECAR_RECONCILER = (
    f"[sync-conflict sidecar] {_ROOT_PROJECT}/"
    f"{_RECONCILER_BASE}.conflict-qontinui-2026-07-16T01-41-10Z.md"
)
_SIDECAR_REPAIR = (
    f"[sync-conflict sidecar] {_COORD_PROJECT}/"
    f"{_REPAIR_BASE}.conflict-hotmail-2026-07-16T01-41-05Z.md"
)
_SIDECAR_WORKTREE = (
    f"[sync-conflict sidecar] {_RUNNER_PROJECT}/"
    f"{_WORKTREE_BASE}.conflict-paktis-2026-07-21T05-24-45Z.md"
)
_SIDECAR_DEP_EDGE = (
    f"[sync-conflict sidecar] {_RUNNER_PROJECT}/"
    f"{_DEP_EDGE_BASE}.conflict-paktis-2026-07-21T05-24-45Z.md"
)

# Out of scope entirely.
_COLLIDING_ROW = "an unrelated live row already holding the loser's text"
_UNRELATED = "topic_unrelated"
_T2_WINNER_REPAIR = "tenant-2 winner: pr-repair-session-is-read-only"

# The winners that must receive the payload text.
_EXPECT_WRITTEN = {
    (_ROOT_PROJECT, _RUNNER_CI_BASE): _WINNER_RUNNER_CI,
    (_ROOT_PROJECT, _NONCE_BASE): _WINNER_NONCE,
    (_ROOT_PROJECT, _RECONCILER_BASE): _WINNER_RECONCILER,
    (_COORD_PROJECT, _REPAIR_BASE): _WINNER_REPAIR,
}
# Resolved, but SKIPPED: another live row in the tenant already holds the hash.
_EXPECT_COLLIDED = (_RUNNER_PROJECT, _DEP_EDGE_BASE)
# Resolved, but already carrying the payload text — the idempotency guard.
_EXPECT_ALREADY_UPDATED = (_RUNNER_PROJECT, _WORKTREE_BASE)

# Every sidecar the revision releases, and the one it must leave alone.
_EXPECT_SIDECARS_RELEASED = (
    _SIDECAR_RUNNER_CI_MERGED,
    _SIDECAR_NONCE,
    _SIDECAR_RECONCILER,
    _SIDECAR_REPAIR,
    _SIDECAR_WORKTREE,
    _SIDECAR_DEP_EDGE,
)
# Already released by memhold_adjudicate_01 — this revision must neither
# re-release it (rowcount) nor re-hold it on downgrade.
_EXPECT_SIDECAR_UNTOUCHED = _SIDECAR_RUNNER_CI_WINNER

# Every topic-file winner in the contested set: all of them lose the hold,
# including the two that never receive any text.
_EXPECT_WINNERS_RELEASED = (
    _WINNER_RUNNER_CI,
    _WINNER_RUNNER_CI_DEAD,
    _WINNER_NONCE,
    _WINNER_RECONCILER,
    _WINNER_RECONCILER_DECOY,
    _WINNER_REPAIR,
    _WINNER_WORKTREE,
    _WINNER_DEP_EDGE,
)
# Rows outside the contested set entirely: not one column, not one JSON key.
_EXPECT_UNTOUCHED = (_COLLIDING_ROW, _UNRELATED)
# In the contested set, so the hold DOES come off — but no text may reach them:
# the dead duplicate and the NULL-project decoy lost the ranking, the `loser`
# winner was skipped on a hash collision, and the worktree winner already
# carried the payload text.
_EXPECT_CONTENT_UNCHANGED = (
    _WINNER_RUNNER_CI_DEAD,
    _WINNER_RECONCILER_DECOY,
    _WINNER_DEP_EDGE,
    _WINNER_WORKTREE,
)
# Everything `_state` reports except the hold, which the release legitimately
# moves on every row in the contested set.
_CONTENT_COLUMNS = (
    "content",
    "content_hash",
    "embedding",
    "embedding_model",
    "is_tombstone",
    "superseded_by",
    "valid_until",
    "adjudication",
)

_EMBEDDING_DIMS = 384
_EMBEDDING_TAG = "MiniLM-L6-v2"


def _embedding(seed: int) -> str:
    """A distinct 384-dim unit vector per row.

    Distinct per row so "the revision NULLed exactly these embeddings" is
    asserted per record rather than satisfied by every row happening to carry
    the same value.
    """
    values = ["0"] * _EMBEDDING_DIMS
    values[seed % _EMBEDDING_DIMS] = "1"
    return "[" + ",".join(values) + "]"


def _load_revision_module() -> ModuleType:
    """Import the revision by path — alembic version files are not a package."""
    path = backend_root() / "alembic" / "versions" / _REVISION_FILENAME
    spec = importlib.util.spec_from_file_location(
        "_memhold_adjudicate_02_under_test", path
    )
    assert spec is not None and spec.loader is not None, path
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _payload_by_key() -> dict[tuple[str, str], Any]:
    """The shipped payload, indexed by ``(project, base_file)``."""
    module = _load_revision_module()
    return {
        (record.project, record.base_file): record for record in module._load_payload()
    }


# ---------------------------------------------------------------------------
# Guards — no database, so these never skip.
# ---------------------------------------------------------------------------


def test_payload_hashes_match_the_apps_own_content_hash_rule() -> None:
    """Every shipped record hashes to its declared sha, by the app's rule.

    This is the whole reason a migration is allowed to write ``content_hash``
    at all: ``memory_store._content_hash`` is imported here and applied to the
    shipped bytes, so what lands in the column is demonstrably the value the
    write API would have produced rather than a re-implementation that happens
    to agree today.
    """
    from app.services.memory_store import _content_hash

    module = _load_revision_module()
    records = module._load_payload()
    assert len(records) == 6, "the plan adjudicated 6 texts"
    for record in records:
        assert _content_hash(record.content) == record.content_sha256, (
            f"{record.project}/{record.base_file} would land a content_hash the "
            "write API would not have produced"
        )
        assert record.disposition in ("merged", "loser")
    # The re-chunk assumption: every record is a whole file, so it maps to one
    # row rather than to a `(part i/n)` series.
    assert max(record.byte_length for record in records) < 30_000


def test_payload_integrity_rejects_corruption() -> None:
    """A payload whose bytes moved in transit must ABORT, not be written.

    The declared sha is the only thing standing between "the operator's
    adjudicated text" and "whatever bytes happen to be in the file", and this
    revision overwrites ``content`` on a production row from those bytes.
    """
    import dataclasses

    module = _load_revision_module()
    records = module._load_payload()
    module._assert_payload_integrity(records)  # the shipped payload: no raise

    # A SAME-LENGTH edit — the shape a transcoding or newline-normalising step
    # produces. The byte-count check cannot see it, so only recomputing the sha
    # catches it.
    flipped = records[0].content.replace("e", "3", 1)
    assert len(flipped.encode("utf-8")) == records[0].byte_length, (
        "the corruption fixture must be invisible to the byte-count check, or "
        "it proves nothing about the sha recomputation"
    )
    corrupted = dataclasses.replace(records[0], content=flipped)
    with pytest.raises(RuntimeError, match="declares content_sha256"):
        module._assert_payload_integrity((corrupted, *records[1:]))

    # And a length change on its own, which the byte-count check names.
    truncated = records[0].content[:-1]
    shortened = dataclasses.replace(
        records[0],
        content=truncated,
        content_sha256=hashlib.sha256(truncated.encode("utf-8")).hexdigest(),
    )
    with pytest.raises(RuntimeError, match="byte"):
        module._assert_payload_integrity((shortened, *records[1:]))

    # Two records aimed at one row: the second overwrites the first, and only
    # the second is reversible.
    duplicate = dataclasses.replace(
        records[1],
        project=records[0].project,
        base_file=records[0].base_file,
    )
    with pytest.raises(RuntimeError, match="appear more than once"):
        module._assert_payload_integrity((records[0], duplicate, *records[2:]))

    # A record at or over the import chunk threshold does not map to one row.
    oversize_text = "x" * 30_000
    oversize = dataclasses.replace(
        records[0],
        content=oversize_text,
        content_sha256=hashlib.sha256(oversize_text.encode("utf-8")).hexdigest(),
        byte_length=30_000,
    )
    with pytest.raises(RuntimeError, match="chunk threshold"):
        module._assert_payload_integrity((oversize, *records[1:]))


def test_drift_guard_covers_the_imported_and_the_local_fragments() -> None:
    """The drift guard must watch every fragment this revision's DML runs.

    Resolution is imported wholesale from ``memhold_adjudicate_01``, so an edit
    THERE silently changes where ~78 KB of adjudicated text lands. The atoms
    are therefore asserted against the imported constants AND the local
    restriction, and the RANKING atoms — which no earlier revision guarded —
    are asserted too.
    """
    module = _load_revision_module()
    module._assert_no_drift()  # the shipped fragments agree: no raise

    # The project-exactness key: without it a same-named file from another
    # project directory can outrank the right row on created_at alone.
    module._WINNER_LINK_CTE = module._WINNER_LINK_CTE.replace(
        "(w.source->>'project' = s.project) DESC NULLS LAST,", ""
    )
    with pytest.raises(RuntimeError, match="winner ranking"):
        module._assert_no_drift()

    # The tenant equality on the JOINable winner predicate.
    module = _load_revision_module()
    module._WINNER_JOIN_ON = module._WINNER_JOIN_ON.replace(
        "AND s.tenant_id = w.tenant_id", ""
    )
    with pytest.raises(RuntimeError, match="_WINNER_JOIN_ON"):
        module._assert_no_drift()

    # The project fallback in the per-row sidecar CTE, which this revision
    # interpolates whole into its own restricted CTE.
    module = _load_revision_module()
    module._SIDECAR_MATCH_CTE = module._SIDECAR_MATCH_CTE.replace(
        "source->>'project',", "NULL,"
    )
    with pytest.raises(RuntimeError, match="_SIDECAR_MATCH_CTE"):
        module._assert_no_drift()

    # The restriction itself: without it every payload record resolves against
    # every sidecar in the corpus.
    module = _load_revision_module()
    module._SIDECAR_MATCH_CTE = module._SIDECAR_MATCH_CTE.replace(
        "AND sc.base_file = :base_file", ""
    )
    with pytest.raises(RuntimeError, match="payload restriction"):
        module._assert_no_drift()


def test_disposition_coverage_partitions_the_two_revisions() -> None:
    """Every disposition's hold must come off in exactly one revision.

    An overlap is two revisions fighting over one row's hold; a gap is a row
    held out of EVERY automatic lifecycle sweep forever. Both are silent
    without this check, because a held row simply never appears again.
    """
    module = _load_revision_module()
    module._assert_disposition_coverage()  # shipped: no raise

    module._ADJUDICATED_DISPOSITIONS = ("merged", "loser", "winner")
    with pytest.raises(RuntimeError, match="released by BOTH"):
        module._assert_disposition_coverage()

    module = _load_revision_module()
    module._ADJUDICATED_DISPOSITIONS = ("merged",)
    with pytest.raises(RuntimeError, match="released by neither revision"):
        module._assert_disposition_coverage()


def test_content_invariants_raise_when_violated() -> None:
    """``_assert_content_invariants`` must ABORT, not log, on each violation.

    The migration applies to prod unattended and forward-only, so "the deploy
    fails while the transaction can still roll back" is the only useful
    behaviour when the writes and the payload disagree. These conditions cannot
    be produced from fixture data — that is what makes them invariants — so
    they are exercised directly.
    """
    module = _load_revision_module()
    healthy = {
        "payload_records": 6,
        "landed": 5,
        "collided": 1,
        "unresolved": 0,
        "chunked": 0,
        "stray_content_rows": 0,
    }
    module._assert_content_invariants(**healthy)  # the partition holds

    with pytest.raises(RuntimeError, match="import chunks"):
        module._assert_content_invariants(**{**healthy, "chunked": 1})
    with pytest.raises(RuntimeError, match="did not resolve to exactly one"):
        module._assert_content_invariants(**{**healthy, "unresolved": 1})
    with pytest.raises(RuntimeError, match="do not partition the payload"):
        module._assert_content_invariants(**{**healthy, "landed": 4})
    with pytest.raises(RuntimeError, match="do not partition the payload"):
        module._assert_content_invariants(**{**healthy, "payload_records": 7})
    with pytest.raises(RuntimeError, match="OUTSIDE the resolved winners"):
        module._assert_content_invariants(**{**healthy, "stray_content_rows": 1})


# ---------------------------------------------------------------------------
# The database walk.
# ---------------------------------------------------------------------------


def _seed(engine: Engine) -> dict[str, uuid.UUID]:
    """Seed two tenants and their records, at the PARENT revision.

    Seeding must happen before the revision runs: it is one-shot DML, so a row
    inserted afterwards would never be reached. The fixture also carries the
    state ``memhold_backfill_01`` and ``memhold_adjudicate_01`` would have left
    (the hold, and the ``source.adjudication`` stamp) rather than relying on
    those one-shot steps to reach rows that did not exist when they ran.
    """
    payload = _payload_by_key()
    tenant_id = uuid.uuid4()
    tenant2_id = uuid.uuid4()
    ids: dict[str, uuid.UUID] = {}
    rows: list[dict[str, Any]] = []

    def record(
        title: str,
        source: dict[str, object],
        *,
        content: str | None = None,
        is_tombstone: bool = False,
        created_at: str = "2026-07-05T00:00:00Z",
        tenant: uuid.UUID | None = None,
        embedding: bool = True,
    ) -> uuid.UUID:
        memory_id = uuid.uuid4()
        body = content if content is not None else f"pre-adjudication body of {title}"
        rows.append(
            {
                "memory_id": memory_id,
                "tenant_id": tenant or tenant_id,
                "kind": "reference",
                "title": title,
                "content": body,
                "content_hash": hashlib.sha256(body.encode("utf-8")).hexdigest(),
                "source": json.dumps(source),
                "is_tombstone": is_tombstone,
                "created_at": created_at,
                "embedding": _embedding(len(rows)) if embedding else None,
                "embedding_model": _EMBEDDING_TAG if embedding else None,
            }
        )
        ids[title] = memory_id
        return memory_id

    def sidecar_source(
        sidecar_file: str,
        disposition: str,
        *,
        project: str | None,
        hold: bool,
    ) -> dict[str, object]:
        """A sidecar exactly as ``memhold_adjudicate_01`` leaves it."""
        source: dict[str, object] = {
            "origin": _SIDECAR_ORIGIN,
            "file": sidecar_file,
            "lifecycle_hold": hold,
            "adjudication": {
                "disposition": disposition,
                "decided": "2026-08-01",
                "plan": _PLAN_SLUG,
                "gate": _GATE_ID,
                "prior_superseded_by": None,
                "prior_is_tombstone": False,
                "prior_valid_until": None,
            },
        }
        if project is not None:
            source["project"] = project
        return source

    def winner_source(base_file: str, project: str | None) -> dict[str, object]:
        source: dict[str, object] = {
            "origin": _WINNER_ORIGIN,
            "file": base_file,
            "lifecycle_hold": True,
        }
        if project is not None:
            source["project"] = project
        return source

    # -- 1 + 2 + 3. project_runner_as_ci_node_migration.md ------------------
    # TWO sidecars, different dispositions (the real manifest pair), and TWO
    # winners. The dead duplicate is OLDER, so only the liveness key ahead of
    # `created_at` puts the text on the live one.
    record(
        _WINNER_RUNNER_CI_DEAD,
        winner_source(_RUNNER_CI_BASE, _ROOT_PROJECT),
        is_tombstone=True,
        created_at="2026-07-01T00:00:00Z",
    )
    record(
        _WINNER_RUNNER_CI,
        winner_source(_RUNNER_CI_BASE, _ROOT_PROJECT),
        created_at="2026-07-02T00:00:00Z",
    )
    record(
        _SIDECAR_RUNNER_CI_MERGED,
        sidecar_source(
            _SIDECAR_RUNNER_CI_MERGED.split("/", 1)[1],
            "merged",
            project=_ROOT_PROJECT,
            hold=True,
        ),
    )
    record(
        _SIDECAR_RUNNER_CI_WINNER,
        sidecar_source(
            _SIDECAR_RUNNER_CI_WINNER.split("/", 1)[1],
            "winner",
            project=_ROOT_PROJECT,
            hold=False,
        ),
    )

    # -- 5. NULL source.project on the sidecar — resolved from the title ----
    record(_WINNER_NONCE, winner_source(_NONCE_BASE, _ROOT_PROJECT))
    record(
        _SIDECAR_NONCE,
        sidecar_source(
            _SIDECAR_NONCE.split("/", 1)[1], "merged", project=None, hold=True
        ),
    )

    # -- 4. the NULL-project decoy from another project directory ----------
    # Live and OLDER than the exact-project winner, so liveness + created_at
    # alone rank it first. In prod this is the row that would swallow another
    # project's adjudicated text.
    record(
        _WINNER_RECONCILER_DECOY,
        winner_source(_RECONCILER_BASE, None),
        created_at="2026-07-01T00:00:00Z",
    )
    record(_WINNER_RECONCILER, winner_source(_RECONCILER_BASE, _ROOT_PROJECT))
    record(
        _SIDECAR_RECONCILER,
        sidecar_source(
            _SIDECAR_RECONCILER.split("/", 1)[1],
            "merged",
            project=_ROOT_PROJECT,
            hold=True,
        ),
    )

    # -- 6. the second tenant's claim on this base file ---------------------
    record(_WINNER_REPAIR, winner_source(_REPAIR_BASE, _COORD_PROJECT))
    record(
        _SIDECAR_REPAIR,
        sidecar_source(
            _SIDECAR_REPAIR.split("/", 1)[1],
            "merged",
            project=_COORD_PROJECT,
            hold=True,
        ),
    )

    # -- 8. already updated: the row already carries the payload text -------
    record(
        _WINNER_WORKTREE,
        winner_source(_WORKTREE_BASE, _RUNNER_PROJECT),
        content=payload[(_RUNNER_PROJECT, _WORKTREE_BASE)].content,
    )
    record(
        _SIDECAR_WORKTREE,
        sidecar_source(
            _SIDECAR_WORKTREE.split("/", 1)[1],
            "merged",
            project=_RUNNER_PROJECT,
            hold=True,
        ),
    )

    # -- 7. the colliding live row ------------------------------------------
    record(_WINNER_DEP_EDGE, winner_source(_DEP_EDGE_BASE, _RUNNER_PROJECT))
    record(
        _SIDECAR_DEP_EDGE,
        sidecar_source(
            _SIDECAR_DEP_EDGE.split("/", 1)[1],
            "loser",
            project=_RUNNER_PROJECT,
            hold=True,
        ),
    )
    # Live, same tenant, already holding the adjudicated text of the `loser`
    # record. Out of the contested set (no `origin`), so nothing but the
    # collision guard stops the UPDATE from tripping the partial unique index.
    record(
        _COLLIDING_ROW,
        {"file": "some_other_note.md", "project": _OTHER_PROJECT},
        content=payload[(_RUNNER_PROJECT, _DEP_EDGE_BASE)].content,
    )

    # Out of scope entirely.
    record(
        _UNRELATED,
        {
            "origin": _WINNER_ORIGIN,
            "file": "topic_unrelated.md",
            "project": _ROOT_PROJECT,
        },
    )

    # Tenant 2: an exact-project, LIVE, OLDER `topic-file` row for one of the
    # payload's base files, with NO sidecar of its own. It wins the ranking if
    # `s.tenant_id = w.tenant_id` is dropped, and it is outside the contested
    # set, so neither its text nor its hold may move.
    record(
        _T2_WINNER_REPAIR,
        winner_source(_REPAIR_BASE, _COORD_PROJECT),
        created_at="2026-06-01T00:00:00Z",
        tenant=tenant2_id,
    )

    with engine.begin() as conn:
        for slug_tenant, label in ((tenant_id, "one"), (tenant2_id, "two")):
            conn.execute(
                text(
                    """
                    INSERT INTO coord.tenants (tenant_id, slug, display_name)
                    VALUES (:tenant_id, :slug, :display_name)
                    """
                ),
                {
                    "tenant_id": slug_tenant,
                    "slug": f"memadj2-{slug_tenant.hex[:12]}",
                    "display_name": f"memhold adjudicate 02 test tenant {label}",
                },
            )
        for row in rows:
            conn.execute(
                text(
                    """
                    INSERT INTO coord.memory_records
                        (memory_id, tenant_id, kind, title, content,
                         content_hash, source, is_tombstone, created_at,
                         embedding, embedding_model)
                    VALUES
                        (:memory_id, :tenant_id, :kind, :title, :content,
                         :content_hash, CAST(:source AS jsonb), :is_tombstone,
                         CAST(:created_at AS timestamptz),
                         CAST(:embedding AS vector), :embedding_model)
                    """
                ),
                row,
            )

    ids["__tenant__"] = tenant_id
    ids["__tenant2__"] = tenant2_id
    return ids


def _state(engine: Engine, tenant_id: uuid.UUID) -> dict[str, dict[str, Any]]:
    """title → every column and JSON key this revision is allowed to move."""
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                """
                SELECT title,
                       content,
                       content_hash,
                       CAST(embedding AS text) AS embedding,
                       embedding_model,
                       is_tombstone,
                       superseded_by,
                       valid_until,
                       source->'lifecycle_hold' AS hold,
                       source->'adjudication'   AS adjudication
                  FROM coord.memory_records
                 WHERE tenant_id = :tenant_id
                """
            ),
            {"tenant_id": tenant_id},
        ).mappings()
        return {r["title"]: dict(r) for r in rows}


@pytest.mark.skipif(
    not can_connect(admin_database_url()),
    reason=(
        "Postgres not reachable at the conftest URL. CI provisions a "
        "postgres service; locally, set QONTINUI_TEST_PG=localhost:5433 (or "
        "bring up a backend Postgres) before running this test."
    ),
)
def test_memhold_adjudicate_02_writes_the_adjudicated_texts() -> None:
    """Seed the parent revision, apply the content follow-up, assert it all."""
    root = backend_root()
    payload = _payload_by_key()

    with ephemeral_database(admin_database_url(), "memhold_adjudicate_02_test") as (
        engine,
        url,
    ):
        run_alembic(root, url, "upgrade", _PARENT_REVISION_ID)
        ids = _seed(engine)
        tenant_id = ids["__tenant__"]
        tenant2_id = ids["__tenant2__"]

        before = _state(engine, tenant_id)
        before2 = _state(engine, tenant2_id)
        assert all(row["embedding"] for row in before.values()), (
            "every fixture row carries an embedding, so 'NULLed exactly these' "
            "is asserted rather than vacuously true"
        )
        assert before[_WINNER_WORKTREE]["content_hash"] == (
            payload[_EXPECT_ALREADY_UPDATED].content_sha256
        ), "the idempotency fixture must start ALREADY carrying the new text"

        # ----------------------------------------------------------------
        # Apply.
        # ----------------------------------------------------------------
        applied = run_alembic(root, url, "upgrade", _REVISION_ID)
        after = _state(engine, tenant_id)
        after2 = _state(engine, tenant2_id)

        # -- 1. the text lands on the right row ---------------------------
        for key, title in _EXPECT_WRITTEN.items():
            record = payload[key]
            row = after[title]
            assert row["content"] == record.content, (
                f"{title} must carry the adjudicated text for {key}"
            )
            assert row["content_hash"] == record.content_sha256, (
                "content_hash must be the app's own sha over the stored text"
            )
            assert row["embedding"] is None, (
                "the old vector describes text that no longer exists; NULL is "
                "what makes fetch_reindex_batch pick the row up"
            )
            assert row["embedding_model"] is None
            stamp = row["adjudication"]
            assert stamp is not None, f"{title} must carry the stash"
            assert stamp["prior_content"] == before[title]["content"], (
                "the overwritten text is what makes the downgrade real"
            )
            assert stamp["prior_content_hash"] == before[title]["content_hash"]
            assert stamp["disposition"] == record.disposition
            assert stamp["plan"] == _PLAN_SLUG
            assert stamp["gate"] == _GATE_ID
            assert stamp["revision"] == _REVISION_ID

        # -- 2/3/4. the ranking picked the right winner -------------------
        assert (
            after[_WINNER_RUNNER_CI_DEAD]["content"]
            == (before[_WINNER_RUNNER_CI_DEAD]["content"])
        ), (
            "of the two topic-file rows for this base file the LIVE one takes "
            "the text, even though the tombstoned one is older"
        )
        assert (
            after[_WINNER_RECONCILER_DECOY]["content"]
            == (before[_WINNER_RECONCILER_DECOY]["content"])
        ), (
            "the EXACT-project winner must outrank the NULL-project row for the "
            "same base file, even though the decoy is live and older — the "
            "join's project arm is permissive, so the RANKING is what stops "
            "~78 KB of text landing in another project's record"
        )

        # -- 7. the collision is skipped, not raised ----------------------
        collided_title = _WINNER_DEP_EDGE
        assert after[collided_title]["content"] == before[collided_title]["content"], (
            "another live row in this tenant already holds that content_hash; "
            "the write would have failed the partial unique index"
        )
        assert after[collided_title]["adjudication"] is None, (
            "a skipped record must not leave a stash behind"
        )
        assert after[collided_title]["embedding"] == before[collided_title]["embedding"]

        # -- 8. the already-updated row is not rewritten ------------------
        # Everything but the hold, which the release legitimately moves.
        assert {
            column: after[_WINNER_WORKTREE][column] for column in _CONTENT_COLUMNS
        } == {
            column: before[_WINNER_WORKTREE][column] for column in _CONTENT_COLUMNS
        }, (
            "the IS DISTINCT FROM guard must skip the WHOLE update — a re-stash "
            "would overwrite prior_content with the NEW text and make the "
            "downgrade a lie, and the embedding must survive because the text "
            "did not change"
        )

        # -- 5. both hold sets come off -----------------------------------
        for title in _EXPECT_WINNERS_RELEASED:
            assert after[title]["hold"] is False, (
                f"{title} is a topic-file winner in the contested set; its text "
                "is now adjudicated so its hold is explicitly released"
            )
        for title in _EXPECT_SIDECARS_RELEASED:
            assert after[title]["hold"] is False, (
                f"{title} is a merged/loser sidecar — its body was the INPUT to "
                "the text just written, so it is finally free"
            )
        assert after[_EXPECT_SIDECAR_UNTOUCHED] == before[_EXPECT_SIDECAR_UNTOUCHED], (
            "memhold_adjudicate_01 already released this one; re-writing it "
            "would make the downgrade re-hold a row this revision never freed"
        )

        # -- 6. tenant isolation ------------------------------------------
        assert after2[_T2_WINNER_REPAIR] == before2[_T2_WINNER_REPAIR], (
            "tenant 2's row is exact-project, live and OLDER, so it wins the "
            "ranking if the tenant equality is dropped — and a payload record "
            "carries no tenant of its own"
        )
        assert after2[_T2_WINNER_REPAIR]["hold"] is True, (
            "no sidecar in that tenant means it is not in the contested set, so "
            "its hold is not this revision's to release"
        )

        # -- 9. nothing else moved ----------------------------------------
        for title in _EXPECT_UNTOUCHED:
            assert after[title] == before[title], (
                f"{title} is outside the contested set entirely and must not move"
            )
        for title in _EXPECT_CONTENT_UNCHANGED:
            assert {column: after[title][column] for column in _CONTENT_COLUMNS} == {
                column: before[title][column] for column in _CONTENT_COLUMNS
            }, (
                f"{title} is in the contested set (so its hold comes off) but is "
                "not a resolved-and-written winner, so no text may reach it"
            )
        stray = [
            title
            for title, row in after.items()
            if row["adjudication"] is not None
            and "prior_content" in row["adjudication"]
            and title not in _EXPECT_WRITTEN.values()
        ]
        assert stray == [], f"only the written winners may carry a stash; got {stray}"

        # -- 10. the migrator log is the only record of the blast radius --
        log = applied.stdout + applied.stderr
        assert "6 payload record(s)" in log, log
        assert "wrote 4 row(s) this run" in log, log
        assert "5 landed in total" in log, log
        assert "1 skipped on a content-hash collision" in log, log
        assert "0 unresolved" in log, log
        assert "5 row(s) had drifted from the payload's prior hash" in log, log
        assert "hold on 8 topic-file winner(s)" in log, log
        assert "6 'merged/loser' sidecar(s)" in log, log
        assert "0 row(s) in the contested set are still held" in log, log
        assert "SKIPPED on a content-hash collision" in log, (
            f"the skipped record must be named loudly, with both ids; got:\n{log}"
        )
        assert _DEP_EDGE_BASE in log, log

        # ----------------------------------------------------------------
        # Re-run over its own output — the idempotency claim.
        # ----------------------------------------------------------------
        run_alembic(root, url, "stamp", _PARENT_REVISION_ID)
        rerun = run_alembic(root, url, "upgrade", _REVISION_ID)

        assert _state(engine, tenant_id) == after, "a re-run must change nothing"
        assert _state(engine, tenant2_id) == after2, "a re-run must change nothing"
        rerun_log = rerun.stdout + rerun.stderr
        assert "wrote 0 row(s) this run" in rerun_log, rerun_log
        assert "hold on 0 topic-file winner(s)" in rerun_log, rerun_log
        assert "0 'merged/loser' sidecar(s)" in rerun_log, rerun_log
        # `landed` is counted from the END state, not from the rowcount, so the
        # partition invariant still sees the full payload on a re-run.
        assert "5 landed in total" in rerun_log, rerun_log
        assert "0 row(s) in the contested set are still held" in rerun_log, rerun_log

        # ----------------------------------------------------------------
        # Downgrade — restores the text from the stash.
        # ----------------------------------------------------------------
        run_alembic(root, url, "downgrade", _PARENT_REVISION_ID)
        reverted = _state(engine, tenant_id)

        for title in _EXPECT_WRITTEN.values():
            assert reverted[title]["content"] == before[title]["content"], (
                f"{title} must round-trip its pre-adjudication text EXACTLY"
            )
            assert reverted[title]["content_hash"] == before[title]["content_hash"]
            assert reverted[title]["adjudication"] is None, (
                f"{title} had no adjudication stamp before this revision, so "
                "the downgrade must remove the whole object"
            )
            assert reverted[title]["embedding"] is None, (
                "the pre-image vector is not stashed; a NULL is unconditionally "
                "correct and the re-index sweep heals it"
            )
        for title in (*_EXPECT_WINNERS_RELEASED, *_EXPECT_SIDECARS_RELEASED):
            assert reverted[title]["hold"] is True, f"{title} is held again"
        assert reverted[_EXPECT_SIDECAR_UNTOUCHED]["hold"] is False, (
            "memhold_adjudicate_01 released this one, so this revision's "
            "downgrade must leave that decision standing"
        )
        for title in _EXPECT_SIDECARS_RELEASED:
            assert reverted[title]["adjudication"] == before[title]["adjudication"], (
                "the Phase-3.3 stamp is not this revision's to remove"
            )

        # ----------------------------------------------------------------
        # Re-upgrade — the selection is re-derivable.
        # ----------------------------------------------------------------
        run_alembic(root, url, "upgrade", _REVISION_ID)
        again = _state(engine, tenant_id)
        for title in _EXPECT_WRITTEN.values():
            assert again[title]["content"] == after[title]["content"]
            assert again[title]["content_hash"] == after[title]["content_hash"]
            assert again[title]["hold"] == after[title]["hold"]
        assert again[_WINNER_DEP_EDGE]["content"] == before[_WINNER_DEP_EDGE]["content"]


def _run_alembic_expecting_failure(
    cwd: Path, db_url: str, *args: str
) -> subprocess.CompletedProcess[str]:
    """``run_alembic``'s inverse: the run MUST fail, and both streams come back.

    The shared helper asserts a zero exit, which is exactly what this test
    needs to disprove — an aborting invariant is only useful if the deploy
    actually stops.
    """
    env = os.environ.copy()
    env["DATABASE_URL"] = db_url
    proc = subprocess.run(
        ["python", "-m", "alembic", "-x", f"db_url={db_url}", *args],
        cwd=str(cwd),
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )
    assert proc.returncode != 0, (
        "the migration was expected to ABORT\n"
        f"--- stdout ---\n{proc.stdout}\n--- stderr ---\n{proc.stderr}"
    )
    return proc


@pytest.mark.skipif(
    not can_connect(admin_database_url()),
    reason=(
        "Postgres not reachable at the conftest URL. CI provisions a "
        "postgres service; locally, set QONTINUI_TEST_PG=localhost:5433 (or "
        "bring up a backend Postgres) before running this test."
    ),
)
def test_memhold_adjudicate_02_aborts_and_rolls_back_on_a_defect() -> None:
    """An unresolvable record or a chunked winner must FAIL the deploy.

    Both are defects the migration cannot write through: an adjudicated text
    with nowhere to land is lost work, and writing a whole file over ``part 1
    of n`` corrupts the record. Because this revision also RELEASES the
    remaining holds, "log it and carry on" would free rows still carrying the
    losing text — so the only safe outcome is to abort while the transaction
    can still roll back.

    One fixture produces both: a single winner titled ``(part 1/3)`` for one
    payload record, and no rows at all for the other five. Both are reported
    at ERROR before the abort, so the operator sees every defect rather than
    the first one.
    """
    root = backend_root()
    payload = _payload_by_key()
    chunk_key = (_ROOT_PROJECT, _RUNNER_CI_BASE)
    chunked_title = f"{_RUNNER_CI_BASE} (part 1/3)"

    with ephemeral_database(admin_database_url(), "memhold_adjudicate_02_abort") as (
        engine,
        url,
    ):
        run_alembic(root, url, "upgrade", _PARENT_REVISION_ID)

        tenant_id = uuid.uuid4()
        original = f"part 1 of the chunked import of {_RUNNER_CI_BASE}"
        with engine.begin() as conn:
            conn.execute(
                text(
                    """
                    INSERT INTO coord.tenants (tenant_id, slug, display_name)
                    VALUES (:tenant_id, :slug, 'memhold adjudicate 02 abort')
                    """
                ),
                {"tenant_id": tenant_id, "slug": f"memadj2a-{tenant_id.hex[:12]}"},
            )
            for title, source, body in (
                (
                    chunked_title,
                    {
                        "origin": _WINNER_ORIGIN,
                        "file": _RUNNER_CI_BASE,
                        "project": _ROOT_PROJECT,
                        "lifecycle_hold": True,
                    },
                    original,
                ),
                (
                    f"[sync-conflict sidecar] {_ROOT_PROJECT}/"
                    f"{_RUNNER_CI_BASE}.conflict-tiohorst-2026-07-23T02-50-41Z.md",
                    {
                        "origin": _SIDECAR_ORIGIN,
                        "file": (
                            f"{_RUNNER_CI_BASE}"
                            ".conflict-tiohorst-2026-07-23T02-50-41Z.md"
                        ),
                        "project": _ROOT_PROJECT,
                        "lifecycle_hold": True,
                        "adjudication": {"disposition": "merged"},
                    },
                    "the merged sidecar body",
                ),
            ):
                conn.execute(
                    text(
                        """
                        INSERT INTO coord.memory_records
                            (memory_id, tenant_id, kind, title, content,
                             content_hash, source)
                        VALUES
                            (:memory_id, :tenant_id, 'reference', :title,
                             :content, :content_hash, CAST(:source AS jsonb))
                        """
                    ),
                    {
                        "memory_id": uuid.uuid4(),
                        "tenant_id": tenant_id,
                        "title": title,
                        "content": body,
                        "content_hash": hashlib.sha256(
                            body.encode("utf-8")
                        ).hexdigest(),
                        "source": json.dumps(source),
                    },
                )

        failed = _run_alembic_expecting_failure(root, url, "upgrade", _REVISION_ID)
        log = failed.stdout + failed.stderr

        assert "CHUNKED winner row" in log, log
        assert "(part 1/3)" in log, log
        assert log.count("UNRESOLVED payload record") == len(payload) - 1, (
            "every record with no row must be named individually at ERROR, not "
            f"just the first; got:\n{log}"
        )
        assert "INVARIANT VIOLATED" in log, log

        after = _state(engine, tenant_id)
        assert after[chunked_title]["content"] == original, (
            "the abort must roll back: alembic wraps the run in one "
            "transaction, and a released hold on un-adjudicated text is the "
            "one thing this revision must never leave behind"
        )
        assert after[chunked_title]["hold"] is True, "the hold must survive the abort"
        assert payload[chunk_key].content not in (after[chunked_title]["content"],)
