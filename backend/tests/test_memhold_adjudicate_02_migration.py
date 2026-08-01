"""Data-semantics test for the ``memhold_adjudicate_02`` revision.

The final step of plan
``D:/qontinui-root/plans/2026-07-28-adjudicate-the-67-sync-conflict-sidecars-now-in-coord.md``:
``memhold_adjudicate_01`` landed the operator's dispositions but touched no
``content``, so it left the 11 ``'topic-file'`` winners and the 12
``merged``/``loser`` sidecars HELD. This revision writes the adjudicated text
onto the winners from a JSON payload shipped beside it, NULLs their embeddings
for the re-index sweep to heal, and releases both remaining holds — but only
over the set that payload COVERS.

Like its two siblings the revision authors **no schema**, so its whole contract
is which rows it touches and what it writes. This test seeds the parent
revision with one fixture per branch, walks one step up, and asserts the
resulting rows — then re-runs, downgrades and re-upgrades. Five further tests
seed one DEFECT each and assert the deploy ABORTS and rolls back.

⚠️ **The fixture is keyed on the SHIPPED payload**, not on a parallel one: it
seeds a sidecar + winner for each of the six real ``(project, base_file)``
pairs, taken from ``memhold_adjudicate_01``'s own ``_CONTENT_DECISIONS``, and
seeds each winner with that record's shipped ``prior_content``. So these
assertions exercise the bytes that will actually be written to prod, a payload
edit that breaks resolution fails here, and the downgrade's sha-verified
restore is exercised against real pre-images rather than placeholder text.

Cases covered (each a distinct branch of the revision's SQL)
============================================================

1. **A resolvable winner per disposition** — five ``merged`` records and the
   one ``loser``. Content + ``content_hash`` written, ``embedding`` and
   ``embedding_model`` NULLed, the pre-image HASH stamped into
   ``source.adjudication.prior_content_hash`` — and the pre-image TEXT
   deliberately NOT stamped anywhere, because ``source`` is returned verbatim
   to every memory-API caller.
2. **Two sidecars for one base file with different dispositions** — the real
   ``project_runner_as_ci_node_migration.md`` pair. Both resolve to the SAME
   winner, so the record must resolve to exactly ONE row, not two. The
   ``winner``-dispositioned one already reads ``lifecycle_hold = false``
   (``memhold_adjudicate_01`` released it) and must stay that way.
3. **A dead duplicate winner** — the Phase-4a import ran twice. The tombstoned,
   OLDER row must not receive the text (liveness ranks ahead of ``created_at``)
   but must still have its hold released: nothing merged/loser is left pending
   against it.
4. **A NULL-project ``topic-file`` decoy for a base file in another project
   directory** — live and OLDER, so liveness and ``created_at`` alone would
   pick it. Only the project-exactness key ahead of them lands the text on the
   right row.
5. **A sidecar with a NULL ``source.project``** — resolved from the
   ``[sync-conflict sidecar] <project>/<file>`` title. 80 of the 138 prod rows
   are this shape.
6. **A second tenant** — holds a ``'topic-file'`` row for one of the payload's
   base files, exact project, live, and OLDER than tenant 1's, so it WINS the
   ranking if ``s.tenant_id = w.tenant_id`` were dropped. It must be untouched,
   hold included: no sidecar in that tenant means it is not in the contested
   set.
7. **An already-updated row** — its ``content_hash`` is already the payload's,
   so the ``IS DISTINCT FROM`` guard must skip the whole UPDATE: no rowcount,
   no stamp and no embedding NULLing.
8. **A winner that already read ``lifecycle_hold = false``** — this revision
   never released it, so its downgrade must NOT re-hold it. The re-hold is
   keyed on the ``hold_released_by`` marker the release writes, not on the hold
   reading ``false``.
9. **A DRIFTED row** — the ``loser`` winner's body is not the payload's
   declared pre-image, so the adjudicated text is still written (the operator's
   decision is authoritative) but the downgrade has no recoverable pre-image
   for it and must say so and leave it alone rather than write bytes that were
   never on the row.

Then three walks:

* **re-run** (``stamp`` back to the parent, upgrade again) — nothing moves,
  every written/released count reports 0, and ``landed`` still reports the full
  6 because it is counted from the END state rather than from the rowcount.
* **downgrade** — content + ``content_hash`` restored from the shipped
  payload, sha-verified against the stamped ``prior_content_hash``; the stamp
  gone; exactly the released rows re-held.
* **re-upgrade** — the selection is re-derivable.

And five aborts, each on its own ephemeral database:

* a content-hash **collision** — no longer a survivable skip, because this
  revision also releases the holds;
* an **uncovered** ``merged`` sidecar + its winner — the rows a payload that
  does not mention them would otherwise free;
* a **not-live** resolved winner;
* a winner that **disagrees** with the ``superseded_by`` pointer
  ``memhold_adjudicate_01`` already wrote;
* an unresolvable record and a **chunked** winner.

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

# A base file NO payload record covers — the uncovered-sidecar fixture.
_UNCOVERED_BASE = "reference_pr_merged_gate_fails_on_coord_rebase_land.md"

# (project, base_file) → the winner fixture's title. Titles double as the
# fixture names in every assertion below.
_WINNER_RUNNER_CI = "winner: project_runner_as_ci_node_migration"
_WINNER_RUNNER_CI_DEAD = "winner: project_runner_as_ci_node_migration (dead duplicate)"
_WINNER_NONCE = "winner: reference_coord_mcp_client_caches_stale_nonce"
_WINNER_NONCE_PRE_RELEASED = (
    "winner: reference_coord_mcp_client_caches_stale_nonce (already released)"
)
_WINNER_RECONCILER = "winner: reference_coord_reconciler_freeze_reeval"
_WINNER_RECONCILER_DECOY = (
    "winner: reference_coord_reconciler_freeze_reeval (NULL project, older)"
)
_WINNER_REPAIR = "winner: pr-repair-session-is-read-only"
_WINNER_WORKTREE = "winner: repair-worktree-tool-gating (already updated)"
_WINNER_DEP_EDGE = "winner: pr-754-stale-cross-repo-dep-edge (drifted)"

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

# The uncovered pair — a `merged` sidecar (and its winner) for a base file the
# payload says nothing about. `memhold_adjudicate_01` dispositioned this real
# base file `winner`, not `merged`, so a `merged` row for it is precisely the
# shape a payload that fell behind the manifest would leave behind.
_SIDECAR_UNCOVERED = (
    f"[sync-conflict sidecar] {_ROOT_PROJECT}/"
    f"{_UNCOVERED_BASE}.conflict-qontinui-2026-07-21T05-24-49Z.md"
)
_WINNER_UNCOVERED = "winner: reference_pr_merged_gate_fails_on_coord_rebase_land"

# The marker the releases write, and the re-hold keys on.
_HOLD_MARKER = {"hold_released_by": _REVISION_ID}

# The winners that must receive the payload text this run.
_EXPECT_WRITTEN = {
    (_ROOT_PROJECT, _RUNNER_CI_BASE): _WINNER_RUNNER_CI,
    (_ROOT_PROJECT, _NONCE_BASE): _WINNER_NONCE,
    (_ROOT_PROJECT, _RECONCILER_BASE): _WINNER_RECONCILER,
    (_COORD_PROJECT, _REPAIR_BASE): _WINNER_REPAIR,
    (_RUNNER_PROJECT, _DEP_EDGE_BASE): _WINNER_DEP_EDGE,
}
# Resolved, but already carrying the payload text — the idempotency guard.
_EXPECT_ALREADY_UPDATED = (_RUNNER_PROJECT, _WORKTREE_BASE)
# Written AND seeded with the payload's declared pre-image, so the downgrade
# can restore them byte-for-byte from the shipped JSON.
_EXPECT_RESTORED = (
    _WINNER_RUNNER_CI,
    _WINNER_NONCE,
    _WINNER_RECONCILER,
    _WINNER_REPAIR,
)
# Written, but seeded with a body that is NOT the payload's declared pre-image.
# The upgrade writes it anyway and warns; the downgrade has no pre-image for it.
_EXPECT_UNRESTORABLE = _WINNER_DEP_EDGE

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

# Every topic-file winner whose hold this revision lifts: no uncovered
# merged/loser sidecar is pending against any of them, including the two that
# never receive any text.
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
# Already reading `false` before this revision ran, so it is neither released
# (nothing to lift) nor re-held by the downgrade (nothing was lifted).
_EXPECT_WINNER_PRE_RELEASED = _WINNER_NONCE_PRE_RELEASED
# Rows outside the contested set entirely: not one column, not one JSON key.
_EXPECT_UNTOUCHED = (_UNRELATED,)
# In the contested set, so the hold DOES come off — but no text may reach them:
# the dead duplicate and the NULL-project decoy lost the ranking, and the
# worktree winner already carried the payload text.
_EXPECT_CONTENT_UNCHANGED = (
    _WINNER_RUNNER_CI_DEAD,
    _WINNER_RECONCILER_DECOY,
    _WINNER_WORKTREE,
)
# Everything `_state` reports except the hold (which the release legitimately
# moves on every row in the contested set) and `adjudication` (which the
# release's marker legitimately adds — asserted explicitly instead).
_CONTENT_COLUMNS = (
    "content",
    "content_hash",
    "embedding",
    "embedding_model",
    "is_tombstone",
    "superseded_by",
    "valid_until",
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

    ``prior_content`` gets the same treatment for a different reason: it is the
    ONLY copy of the text each record overwrites — the pre-image is
    deliberately not stashed in the row — so the downgrade's fidelity rests
    entirely on these bytes.
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
        assert _content_hash(record.prior_content) == record.prior_content_sha256, (
            f"{record.project}/{record.base_file} ships a prior_content that is "
            "not the pre-image its declared sha names — the downgrade would "
            "write the wrong bytes"
        )
        assert record.disposition in ("merged", "loser")
    # The re-chunk assumption: every record is a whole file, so it maps to one
    # row rather than to a `(part i/n)` series.
    assert max(record.byte_length for record in records) < 30_000


def test_payload_carries_the_pre_image_and_the_row_never_does() -> None:
    """The pre-adjudication text ships in the JSON, NOT in ``source``.

    ``coord.memory_records.source`` is returned verbatim to every memory-API
    caller — the record projection selects ``r.source`` and the API hands it
    back on ``/memory/query`` hits, ``/memory/records`` listings and graph
    nodes. A stashed pre-image would therefore put the losing text straight
    back into the retrieval path this adjudication exists to clean, unlabelled
    and in the same hit as the adjudicated text. Only the HASH may be stamped.
    """
    module = _load_revision_module()
    assert "'prior_content', to_jsonb" not in module._APPLY_TEXT_SQL, (
        "the write must not stash the pre-image TEXT in source.adjudication — "
        "source is returned to every memory-API caller"
    )
    assert "'prior_content_hash', to_jsonb(m.content_hash)" in module._APPLY_TEXT_SQL, (
        "the pre-image HASH must still be stamped: it is not a leak and it is "
        "what matches each row to its payload record on downgrade"
    )
    records = module._load_payload()
    assert all(record.prior_content for record in records), (
        "every record must ship its pre-image text, or the downgrade has "
        "nothing to restore from"
    )


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

    # The same for the PRE-image, which the downgrade writes back over a
    # production row and which nothing else in the system holds a copy of.
    prior_flipped = records[0].prior_content.replace("e", "3", 1)
    assert len(prior_flipped.encode("utf-8")) == records[0].prior_byte_length
    prior_corrupted = dataclasses.replace(records[0], prior_content=prior_flipped)
    with pytest.raises(RuntimeError, match="declares prior_content_sha256"):
        module._assert_payload_integrity((prior_corrupted, *records[1:]))

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

    # The same base file under two DIFFERENT projects. `_WINNER_JOIN_ON`
    # accepts a NULL-project winner, so both records can resolve to that one
    # row and the second write silently overwrites the first.
    other_project = next(
        record for record in records[1:] if record.project != records[0].project
    )
    cross_project = dataclasses.replace(other_project, base_file=records[0].base_file)
    assert cross_project.project != records[0].project, (
        "the fixture must differ in PROJECT, or it is caught by the "
        "(project, base_file) duplicate check instead"
    )
    with pytest.raises(RuntimeError, match="under more than one project"):
        module._assert_payload_integrity((records[0], cross_project))

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
        "landed": 6,
        "collided": 0,
        "unresolved": 0,
        "chunked": 0,
        "not_live": 0,
        "pointer_mismatched": 0,
        "stray_content_rows": 0,
    }
    module._assert_content_invariants(**healthy)  # the partition holds

    with pytest.raises(RuntimeError, match="import chunks"):
        module._assert_content_invariants(**{**healthy, "chunked": 1})
    with pytest.raises(RuntimeError, match="did not resolve to exactly one"):
        module._assert_content_invariants(**{**healthy, "unresolved": 1})
    # A collision is NOT a survivable skip: this revision also releases the
    # holds, so a skipped record means freeing rows that still carry the
    # losing text while the winner keeps its pre-adjudication body.
    with pytest.raises(RuntimeError, match="SKIPPED on a content-hash collision"):
        module._assert_content_invariants(**{**healthy, "collided": 1, "landed": 5})
    with pytest.raises(RuntimeError, match="NOT live"):
        module._assert_content_invariants(**{**healthy, "not_live": 1, "landed": 5})
    with pytest.raises(RuntimeError, match="superseded_by pointer"):
        module._assert_content_invariants(
            **{**healthy, "pointer_mismatched": 1, "landed": 5}
        )
    with pytest.raises(RuntimeError, match="do not partition the payload"):
        module._assert_content_invariants(**{**healthy, "landed": 4})
    with pytest.raises(RuntimeError, match="do not partition the payload"):
        module._assert_content_invariants(**{**healthy, "payload_records": 7})
    with pytest.raises(RuntimeError, match="OUTSIDE the resolved winners"):
        module._assert_content_invariants(**{**healthy, "stray_content_rows": 1})


# ---------------------------------------------------------------------------
# The database walk.
# ---------------------------------------------------------------------------

_PG_SKIP = pytest.mark.skipif(
    not can_connect(admin_database_url()),
    reason=(
        "Postgres not reachable at the conftest URL. CI provisions a "
        "postgres service; locally, set QONTINUI_TEST_PG=localhost:5433 (or "
        "bring up a backend Postgres) before running this test."
    ),
)


def _insert_rows(engine: Engine, rows: list[dict[str, Any]]) -> None:
    with engine.begin() as conn:
        for row in rows:
            conn.execute(
                text(
                    """
                    INSERT INTO coord.memory_records
                        (memory_id, tenant_id, kind, title, content,
                         content_hash, source, is_tombstone, created_at,
                         embedding, embedding_model, superseded_by)
                    VALUES
                        (:memory_id, :tenant_id, :kind, :title, :content,
                         :content_hash, CAST(:source AS jsonb), :is_tombstone,
                         CAST(:created_at AS timestamptz),
                         CAST(:embedding AS vector), :embedding_model,
                         :superseded_by)
                    """
                ),
                row,
            )


def _seed(engine: Engine) -> dict[str, uuid.UUID]:
    """Seed two tenants and their records, at the PARENT revision.

    Seeding must happen before the revision runs: it is one-shot DML, so a row
    inserted afterwards would never be reached. The fixture also carries the
    state ``memhold_backfill_01`` and ``memhold_adjudicate_01`` would have left
    (the hold, the ``source.adjudication`` stamp, and the ``superseded_by``
    pointer onto the adjudicated winner) rather than relying on those one-shot
    steps to reach rows that did not exist when they ran.
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
        superseded_by: uuid.UUID | None = None,
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
                "superseded_by": superseded_by,
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

    def winner_source(
        base_file: str, project: str | None, *, hold: bool = True
    ) -> dict[str, object]:
        source: dict[str, object] = {
            "origin": _WINNER_ORIGIN,
            "file": base_file,
            "lifecycle_hold": hold,
        }
        if project is not None:
            source["project"] = project
        return source

    def prior(project: str, base_file: str) -> str:
        """The payload's declared PRE-image for a pair.

        Seeding the real pre-image is what makes the downgrade assertion
        meaningful: the restore now comes from the shipped JSON, matched by the
        stamped hash, so a fixture body that is not the declared pre-image is
        not restorable at all (see `_EXPECT_UNRESTORABLE`).
        """
        return str(payload[(project, base_file)].prior_content)

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
    runner_ci_id = record(
        _WINNER_RUNNER_CI,
        winner_source(_RUNNER_CI_BASE, _ROOT_PROJECT),
        content=prior(_ROOT_PROJECT, _RUNNER_CI_BASE),
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
        superseded_by=runner_ci_id,
    )
    record(
        _SIDECAR_RUNNER_CI_WINNER,
        sidecar_source(
            _SIDECAR_RUNNER_CI_WINNER.split("/", 1)[1],
            "winner",
            project=_ROOT_PROJECT,
            hold=False,
        ),
        superseded_by=runner_ci_id,
    )

    # -- 5 + 8. NULL source.project on the sidecar, and a winner duplicate
    # that already reads `lifecycle_hold = false`. The revision never releases
    # that one, so its downgrade must not re-hold it.
    nonce_id = record(
        _WINNER_NONCE,
        winner_source(_NONCE_BASE, _ROOT_PROJECT),
        content=prior(_ROOT_PROJECT, _NONCE_BASE),
    )
    record(
        _WINNER_NONCE_PRE_RELEASED,
        winner_source(_NONCE_BASE, _ROOT_PROJECT, hold=False),
        is_tombstone=True,
        created_at="2026-07-09T00:00:00Z",
    )
    record(
        _SIDECAR_NONCE,
        sidecar_source(
            _SIDECAR_NONCE.split("/", 1)[1], "merged", project=None, hold=True
        ),
        superseded_by=nonce_id,
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
    reconciler_id = record(
        _WINNER_RECONCILER,
        winner_source(_RECONCILER_BASE, _ROOT_PROJECT),
        content=prior(_ROOT_PROJECT, _RECONCILER_BASE),
    )
    record(
        _SIDECAR_RECONCILER,
        sidecar_source(
            _SIDECAR_RECONCILER.split("/", 1)[1],
            "merged",
            project=_ROOT_PROJECT,
            hold=True,
        ),
        superseded_by=reconciler_id,
    )

    # -- 6. the second tenant's claim on this base file ---------------------
    repair_id = record(
        _WINNER_REPAIR,
        winner_source(_REPAIR_BASE, _COORD_PROJECT),
        content=prior(_COORD_PROJECT, _REPAIR_BASE),
    )
    record(
        _SIDECAR_REPAIR,
        sidecar_source(
            _SIDECAR_REPAIR.split("/", 1)[1],
            "merged",
            project=_COORD_PROJECT,
            hold=True,
        ),
        superseded_by=repair_id,
    )

    # -- 7. already updated: the row already carries the payload text -------
    worktree_id = record(
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
        superseded_by=worktree_id,
    )

    # -- 9. the DRIFTED winner: its body is not the payload's pre-image -----
    # The text is written anyway (the operator's decision is authoritative) and
    # the drift is logged, but the downgrade has no pre-image for it.
    dep_edge_id = record(
        _WINNER_DEP_EDGE, winner_source(_DEP_EDGE_BASE, _RUNNER_PROJECT)
    )
    record(
        _SIDECAR_DEP_EDGE,
        sidecar_source(
            _SIDECAR_DEP_EDGE.split("/", 1)[1],
            "loser",
            project=_RUNNER_PROJECT,
            hold=True,
        ),
        superseded_by=dep_edge_id,
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
    _insert_rows(engine, rows)

    ids["__tenant__"] = tenant_id
    ids["__tenant2__"] = tenant2_id
    return ids


def _add_row(
    engine: Engine,
    tenant_id: uuid.UUID,
    title: str,
    source: dict[str, object],
    content: str,
    *,
    superseded_by: uuid.UUID | None = None,
) -> uuid.UUID:
    """Insert one extra row into an already-seeded fixture."""
    memory_id = uuid.uuid4()
    _insert_rows(
        engine,
        [
            {
                "memory_id": memory_id,
                "tenant_id": tenant_id,
                "kind": "reference",
                "title": title,
                "content": content,
                "content_hash": hashlib.sha256(content.encode("utf-8")).hexdigest(),
                "source": json.dumps(source),
                "is_tombstone": False,
                "created_at": "2026-07-05T00:00:00Z",
                "embedding": None,
                "embedding_model": None,
                "superseded_by": superseded_by,
            }
        ],
    )
    return memory_id


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


@_PG_SKIP
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
        assert before[_EXPECT_WINNER_PRE_RELEASED]["hold"] is False, (
            "the pre-released fixture must start reading false, or it proves "
            "nothing about a downgrade that re-holds what it never released"
        )

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
            assert stamp is not None, f"{title} must carry the stamp"
            assert "prior_content" not in stamp, (
                "the pre-image TEXT must never reach source: it is returned "
                "verbatim to every memory-API caller, which would put the "
                "losing text back into the retrieval path"
            )
            assert stamp["prior_content_hash"] == before[title]["content_hash"], (
                "the pre-image HASH is what matches the row to its payload "
                "record on downgrade"
            )
            assert stamp["disposition"] == record.disposition
            assert stamp["plan"] == _PLAN_SLUG
            assert stamp["gate"] == _GATE_ID
            assert stamp["revision"] == _REVISION_ID
            assert stamp["hold_released_by"] == _REVISION_ID

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

        # -- 7. the already-updated row is not rewritten ------------------
        # Everything but the hold and the marker, which the release moves.
        assert {
            column: after[_WINNER_WORKTREE][column] for column in _CONTENT_COLUMNS
        } == {
            column: before[_WINNER_WORKTREE][column] for column in _CONTENT_COLUMNS
        }, (
            "the IS DISTINCT FROM guard must skip the WHOLE update — a stamp "
            "would claim a write that did not happen, and the embedding must "
            "survive because the text did not change"
        )
        assert after[_WINNER_WORKTREE]["adjudication"] == _HOLD_MARKER, (
            "the only thing the release may add to a row it did not write is "
            "the marker its own downgrade keys on"
        )

        # -- 5. both hold sets come off, over the covered set only --------
        for title in _EXPECT_WINNERS_RELEASED:
            assert after[title]["hold"] is False, (
                f"{title} is a topic-file winner with no uncovered merged/loser "
                "sidecar pending against it, so its hold is released"
            )
            assert after[title]["adjudication"]["hold_released_by"] == _REVISION_ID
        for title in _EXPECT_SIDECARS_RELEASED:
            assert after[title]["hold"] is False, (
                f"{title} is a merged/loser sidecar whose (project, base_file) "
                "the payload covers — its body was the INPUT to the text just "
                "written, so it is finally free"
            )
            assert after[title]["adjudication"]["hold_released_by"] == _REVISION_ID
            assert after[title]["adjudication"]["disposition"] in ("merged", "loser"), (
                "the Phase-3.3 stamp must survive the marker merge"
            )
        assert after[_EXPECT_SIDECAR_UNTOUCHED] == before[_EXPECT_SIDECAR_UNTOUCHED], (
            "memhold_adjudicate_01 already released this one; re-writing it "
            "would make the downgrade re-hold a row this revision never freed"
        )
        assert (
            after[_EXPECT_WINNER_PRE_RELEASED] == before[_EXPECT_WINNER_PRE_RELEASED]
        ), (
            "a winner that already read false is not this revision's to "
            "release, so it takes no marker and moves not one key"
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
            and "prior_content_hash" in row["adjudication"]
            and title not in _EXPECT_WRITTEN.values()
        ]
        assert stray == [], f"only the written winners may carry a stash; got {stray}"

        # -- 10. the migrator log is the only record of the blast radius --
        log = applied.stdout + applied.stderr
        assert "6 payload record(s)" in log, log
        assert "wrote 5 row(s) this run" in log, log
        assert "6 landed in total" in log, log
        assert "0 skipped on a content-hash collision" in log, log
        assert "0 unresolved" in log, log
        assert "1 row(s) had drifted from the payload's prior hash" in log, log
        assert "hold on 8 topic-file winner(s)" in log, log
        assert "6 'merged/loser' sidecar(s)" in log, log
        assert "0 row(s) in the contested set are still held" in log, log
        assert "UNCOVERED ROW STILL HELD" not in log, log

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
        assert "6 landed in total" in rerun_log, rerun_log
        assert "0 row(s) in the contested set are still held" in rerun_log, rerun_log

        # ----------------------------------------------------------------
        # Downgrade — restores the text from the SHIPPED PAYLOAD, matched to
        # each row by the pre-image hash the upgrade stamped.
        # ----------------------------------------------------------------
        reverse = run_alembic(root, url, "downgrade", _PARENT_REVISION_ID)
        reverted = _state(engine, tenant_id)
        reverse_log = reverse.stdout + reverse.stderr

        for title in _EXPECT_RESTORED:
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
        assert "restored content + content_hash on 4 row(s)" in reverse_log, reverse_log

        # The drifted row: no pre-image in the payload, so it is NAMED and left
        # alone rather than overwritten with bytes that were never on it.
        assert "1 row(s) had no recoverable pre-image" in reverse_log, reverse_log
        assert "NO PRE-IMAGE for memory_id" in reverse_log, reverse_log
        assert (
            reverted[_EXPECT_UNRESTORABLE]["content"]
            == (after[_EXPECT_UNRESTORABLE]["content"])
        ), "an unrestorable row keeps the adjudicated text rather than losing it"
        assert reverted[_EXPECT_UNRESTORABLE]["adjudication"] is not None, (
            "and it keeps its stamp, which is the evidence of what happened"
        )

        for title in (*_EXPECT_WINNERS_RELEASED, *_EXPECT_SIDECARS_RELEASED):
            assert reverted[title]["hold"] is True, f"{title} is held again"
            adjudication = reverted[title]["adjudication"]
            assert adjudication is None or "hold_released_by" not in adjudication, (
                "the marker is dropped with the re-hold"
            )
        assert reverted[_EXPECT_SIDECAR_UNTOUCHED]["hold"] is False, (
            "memhold_adjudicate_01 released this one, so this revision's "
            "downgrade must leave that decision standing"
        )
        assert reverted[_EXPECT_WINNER_PRE_RELEASED]["hold"] is False, (
            "this winner already read false BEFORE the revision ran, so the "
            "revision never released it — re-holding it would be a rollback of "
            "something that never happened. The re-hold keys on the marker the "
            "release writes, not on the hold reading false."
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


@_PG_SKIP
def test_a_content_hash_collision_aborts_the_deploy() -> None:
    """A record skipped on the live-dedup index must ABORT, not be passed over.

    The reasoning is verbatim the one that already aborts on an unresolved
    record: this revision RELEASES the holds, so completing the deploy after a
    skip frees the ``merged``/``loser`` sidecars whose bodies are the losing
    text while the winner keeps its PRE-adjudication content — and, once
    ``decay_prune`` collects those sidecars, the provenance for re-doing the
    work is gone. The skip itself is right; carrying on is not.
    """
    root = backend_root()
    payload = _payload_by_key()

    with ephemeral_database(
        admin_database_url(), "memhold_adjudicate_02_collision"
    ) as (engine, url):
        run_alembic(root, url, "upgrade", _PARENT_REVISION_ID)
        ids = _seed(engine)
        tenant_id = ids["__tenant__"]

        # Live, same tenant, already holding the adjudicated text of the
        # `loser` record. Out of the contested set (no `origin`), so nothing
        # but the collision probe stops the UPDATE tripping the partial unique
        # index.
        _add_row(
            engine,
            tenant_id,
            _COLLIDING_ROW,
            {"file": "some_other_note.md", "project": _OTHER_PROJECT},
            payload[(_RUNNER_PROJECT, _DEP_EDGE_BASE)].content,
        )
        before = _state(engine, tenant_id)

        failed = _run_alembic_expecting_failure(root, url, "upgrade", _REVISION_ID)
        log = failed.stdout + failed.stderr

        assert "SKIPPED on a content-hash collision" in log, log
        assert _DEP_EDGE_BASE in log, log
        assert "INVARIANT VIOLATED" in log, log
        assert "SKIPPED on a content-hash collision" in log, log

        after = _state(engine, tenant_id)
        assert after == before, (
            "alembic wraps the run in one transaction, so the abort must roll "
            "back every write AND every hold release"
        )
        assert after[_WINNER_DEP_EDGE]["hold"] is True
        assert after[_SIDECAR_DEP_EDGE]["hold"] is True


@_PG_SKIP
def test_a_hash_another_record_is_about_to_vacate_is_not_a_collision() -> None:
    """The collision probe must read the END state, not the state mid-loop.

    Fixture: the LAST payload record's winner currently carries the FIRST
    record's adjudicated text. Probed one record at a time against live state,
    record 1 sees that hash already taken and is skipped — against a row record
    6 is about to vacate. Nothing about that is a real collision; it is purely
    the order the records happen to be listed in, and (since a collision now
    aborts) it fails the whole deploy.

    Two things together make it a non-event: every resolved target is excluded
    from the probe, AND the writes are ordered so no intermediate state trips
    the index — the index is enforced per statement, so "it will not hold that
    hash at commit" is not on its own enough.
    """
    root = backend_root()
    payload = _payload_by_key()

    with ephemeral_database(admin_database_url(), "memhold_adjudicate_02_vacate") as (
        engine,
        url,
    ):
        run_alembic(root, url, "upgrade", _PARENT_REVISION_ID)
        ids = _seed(engine)
        tenant_id = ids["__tenant__"]

        # The `loser` record is LAST in the payload; give its winner the text
        # the FIRST record is about to write.
        squatted = payload[(_ROOT_PROJECT, _RUNNER_CI_BASE)].content
        with engine.begin() as conn:
            conn.execute(
                text(
                    """
                    UPDATE coord.memory_records
                       SET content = :content, content_hash = :content_hash
                     WHERE memory_id = :memory_id
                    """
                ),
                {
                    "content": squatted,
                    "content_hash": hashlib.sha256(
                        squatted.encode("utf-8")
                    ).hexdigest(),
                    "memory_id": ids[_WINNER_DEP_EDGE],
                },
            )

        applied = run_alembic(root, url, "upgrade", _REVISION_ID)
        log = applied.stdout + applied.stderr
        assert "SKIPPED on a content-hash collision" not in log, (
            "no live row will still hold that hash at COMMIT, so this is not a "
            f"collision — it is the iteration order:\n{log}"
        )
        assert "0 skipped on a content-hash collision" in log, log
        assert "6 landed in total" in log, log

        after = _state(engine, tenant_id)
        for key, title in _EXPECT_WRITTEN.items():
            assert after[title]["content"] == payload[key].content, (
                f"{title} must still receive its own adjudicated text"
            )


@_PG_SKIP
def test_an_uncovered_merged_sidecar_aborts_instead_of_being_freed() -> None:
    """A ``merged`` pair the payload does not cover must NOT lose its hold.

    Keyed on the disposition alone, the release frees every ``merged``/``loser``
    sidecar and every ``topic-file`` winner in the corpus — including a pair no
    payload record mentions. That leaves a winner carrying PRE-adjudication
    text with its hold gone and ``decay_prune`` armed on the sidecars that are
    its only provenance, and the run exits 0 with nothing logged. Both rows
    must instead be named and the deploy must stop.
    """
    root = backend_root()

    with ephemeral_database(
        admin_database_url(), "memhold_adjudicate_02_uncovered"
    ) as (engine, url):
        run_alembic(root, url, "upgrade", _PARENT_REVISION_ID)
        ids = _seed(engine)
        tenant_id = ids["__tenant__"]

        winner_id = _add_row(
            engine,
            tenant_id,
            _WINNER_UNCOVERED,
            {
                "origin": _WINNER_ORIGIN,
                "file": _UNCOVERED_BASE,
                "project": _ROOT_PROJECT,
                "lifecycle_hold": True,
            },
            "the pre-adjudication body of an unadjudicated winner",
        )
        _add_row(
            engine,
            tenant_id,
            _SIDECAR_UNCOVERED,
            {
                "origin": _SIDECAR_ORIGIN,
                "file": _SIDECAR_UNCOVERED.split("/", 1)[1],
                "project": _ROOT_PROJECT,
                "lifecycle_hold": True,
                "adjudication": {"disposition": "merged"},
            },
            "the losing body nobody wrote a payload record for",
            superseded_by=winner_id,
        )
        before = _state(engine, tenant_id)

        failed = _run_alembic_expecting_failure(root, url, "upgrade", _REVISION_ID)
        log = failed.stdout + failed.stderr

        assert log.count("UNCOVERED ROW STILL HELD") == 2, (
            "both the sidecar and its winner must be named individually, with "
            f"their memory_id / project / base_file; got:\n{log}"
        )
        assert "merged/loser sidecar" in log, log
        assert "topic-file winner" in log, log
        assert _UNCOVERED_BASE in log, log
        assert "INVARIANT VIOLATED" in log, log

        after = _state(engine, tenant_id)
        assert after == before, "the abort must roll back the whole run"
        assert after[_WINNER_UNCOVERED]["hold"] is True, (
            "a winner whose adjudicated text was never written must keep its "
            "hold — that hold is the only thing keeping decay_prune off its "
            "provenance"
        )
        assert after[_SIDECAR_UNCOVERED]["hold"] is True


@_PG_SKIP
def test_a_not_live_winner_aborts_the_deploy() -> None:
    """The resolved winner must be LIVE, or the text lands where nothing reads.

    The ranking PREFERS a live row but does not require one: with a single
    candidate it returns that candidate whatever its state. A tombstoned /
    superseded / validity-ended winner is outside the live-dedup index and
    outside every retrieval selector, so the write would report ``landed``
    while putting the operator's decision somewhere unreachable — with the hold
    released on top of it.
    """
    root = backend_root()

    with ephemeral_database(admin_database_url(), "memhold_adjudicate_02_dead") as (
        engine,
        url,
    ):
        run_alembic(root, url, "upgrade", _PARENT_REVISION_ID)
        ids = _seed(engine)
        tenant_id = ids["__tenant__"]

        with engine.begin() as conn:
            conn.execute(
                text(
                    """
                    UPDATE coord.memory_records
                       SET valid_until = now()
                     WHERE memory_id = :memory_id
                    """
                ),
                {"memory_id": ids[_WINNER_REPAIR]},
            )
        before = _state(engine, tenant_id)

        failed = _run_alembic_expecting_failure(root, url, "upgrade", _REVISION_ID)
        log = failed.stdout + failed.stderr

        assert "NOT-LIVE winner row" in log, log
        assert _REPAIR_BASE in log, log
        assert "INVARIANT VIOLATED" in log, log

        after = _state(engine, tenant_id)
        assert after == before, "the abort must roll back the whole run"


@_PG_SKIP
def test_a_winner_that_disagrees_with_the_landed_pointer_aborts() -> None:
    """The re-derived ranking must agree with ``memhold_adjudicate_01``.

    That revision superseded each ``merged``/``loser`` sidecar ONTO its
    adjudicated winner — the authoritative answer, landed in prod by a human's
    decision. This revision only re-derives the same ranking, so a
    disagreement means the corpus moved between the two applies and ~25 KB of
    content would be sent to a row the adjudication did not choose.
    """
    root = backend_root()

    with ephemeral_database(admin_database_url(), "memhold_adjudicate_02_pointer") as (
        engine,
        url,
    ):
        run_alembic(root, url, "upgrade", _PARENT_REVISION_ID)
        ids = _seed(engine)
        tenant_id = ids["__tenant__"]

        # Point the sidecar at the NULL-project decoy instead of the winner the
        # ranking resolves. Nothing else changes, so the ONLY thing that can
        # catch it is the cross-check.
        with engine.begin() as conn:
            conn.execute(
                text(
                    """
                    UPDATE coord.memory_records
                       SET superseded_by = :decoy
                     WHERE memory_id = :memory_id
                    """
                ),
                {
                    "decoy": ids[_WINNER_RECONCILER_DECOY],
                    "memory_id": ids[_SIDECAR_RECONCILER],
                },
            )
        before = _state(engine, tenant_id)

        failed = _run_alembic_expecting_failure(root, url, "upgrade", _REVISION_ID)
        log = failed.stdout + failed.stderr

        assert "WINNER POINTER MISMATCH" in log, log
        assert _RECONCILER_BASE in log, log
        assert "INVARIANT VIOLATED" in log, log

        after = _state(engine, tenant_id)
        assert after == before, "the abort must roll back the whole run"


@_PG_SKIP
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
