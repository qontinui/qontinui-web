"""``GET /api/v1/overview/objectives`` — the objectives read, behind a fake coord.

Plan ``2026-10-06-overview-objectives-view`` Phase 1. Failure arms come first:
the whole point of the read is that a gap upstream renders as UNKNOWN with its
reason, never as "no results" and never as an error page. The success path
then uses the merge-train metric's real v2 frontmatter
(``tests/fixtures/objectives/merge_train_throughput_v2.md``) and the live
initiative's real frontmatter shape.

The ``metric-checkpoint/v1`` validator runs every golden case in
``tests/fixtures/metric_checkpoint_v1/cases.json`` — the same file Phase 3
(coord) copies.

Phase 4 (web half): every verdict row comes from coord's checkpoint results
door, faked here by :class:`FakeFindings` the way coord's insert path fills
it (one row per row of a block that passes the shape check). The door's
failure arms — 404, ``available: false``, an error, a full page — come before
the rows arms.

No database: the access dependency is stubbed, and only the coord transports
(prompt documents, findings, checkpoint results) are faked.
"""

from __future__ import annotations

import copy
import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from uuid import UUID

import httpx
import pytest
from fastapi import FastAPI, HTTPException

from app.overview.intent_documents import IntentDocumentStore
from app.overview.metric_checkpoint import validate_metric_checkpoint
from app.overview.objectives import build_objectives
from app.overview.objectives_frontmatter import (
    parse_frontmatter,
    source_query_type,
    title_of_document,
)
from app.overview.objectives_join import (
    FINDINGS_PAGE_LIMIT,
    MAX_RESULT_ID_READS,
    ProxiedCoordFindings,
)
from app.overview.objectives_models import ObjectivesRead
from app.overview.objectives_results import CHECKPOINT_RESULTS_LIMIT
from app.overview.permissions import OverviewAccess
from app.overview.resource import StoreContext

API = "/api/v1/overview"

pytestmark = pytest.mark.asyncio
TENANT = UUID("aaaaaaaa-0000-4000-8000-00000000000a")
FIXTURES = Path(__file__).parent / "fixtures"
MERGE_TRAIN = "merge-train-throughput-2026-10"
DOC_KEY = f"prompt_document:success_metric/{MERGE_TRAIN}"
#: Before checkpoint 2's window, after checkpoint 1's due day.
NOW = datetime(2026, 10, 9, 12, 0, tzinfo=UTC)

MERGE_TRAIN_BODY = (
    FIXTURES / "objectives" / "merge_train_throughput_v2.md"
).read_text()

#: `initiative/current-initiative` v10's frontmatter shape: unquoted dates.
INITIATIVE_BODY = """---
status: live
starts: 2026-08-31
ends: 2027-02-28
new_work_bar: 7
score_scale: "0-10"
in_scope:
  - id: remote-session-access
    text: "remote runner session access (Merytshost)"
  - id: coord-reachability
    text: "coord reachability from a session"
  - id: merge-train-d1
    text: "merge-train D1 re-measurement under armed chaining"
out_of_scope:
  - mobile app
success_metrics:
  - development-speed
  - remote-session-interactivity
  - published-runner-parity-defects
---

# Current initiative — parity and reachability first, then the roadmap they unblock

This initiative began on 2026-08-31.
"""

DEV_SPEED_BODY = """---
metric: development-speed
source_query: >-
  SELECT round(count(*)::numeric / 4, 1) FROM coord.work_units;
baseline: 50.2
baseline_as_of: 2026-08-27
target: null
direction: increase
unit: shipped work units per week (trailing 4 complete weeks, restamp-excluded)
serves: [remote-session-access, coord-reachability]
---

# Development speed

The operator's stated primary metric.
"""

REMOTE_BODY = """---
metric: remote-session-interactivity
source_query: "named: remote_session_interactivity"
baseline: null
target: 100
direction: increase
unit: percent of sessions
---

# Remote session interactivity
"""

#: `github-actions-monthly-spend` v1, verbatim frontmatter.
SPEND_BODY = """---
metric: github-actions-monthly-spend
unit: USD (net, after GitHub's included-minutes discount)
direction: lower_is_better
ceiling: 750
baseline: 3867.34 (2026-09, org net)
last_reviewed: 2026-10-03
---

# GitHub Actions monthly spend
"""

VOID_BODY = """---
mispublished: true
belongs_to_tenant: meryts-2-0
last_reviewed: 2026-09-23
---

# MISPUBLISHED — not a Qontinui document
"""

SKELETON_BODY = "---\nmetric: <name>\ntarget: null\n---\n\n# Example metric\n"


# ===========================================================================
# Fakes
# ===========================================================================


class FakeDocs:
    """Coord's prompt-document list/get, as far as the store's list uses them."""

    def __init__(self) -> None:
        self.docs: dict[tuple[str, str], dict[str, Any]] = {}
        self.fail_get: set[tuple[str, str]] = set()
        self.list_error: Exception | None = None
        self.degraded: str | None = None

    def seed(
        self,
        kind: str,
        name: str,
        body: str,
        *,
        version: int = 2,
        skeleton: bool = False,
    ) -> None:
        self.docs[(kind, name)] = {
            "kind": kind,
            "name": name,
            "description": None,
            "default_source": f"prompt_doc/{kind}/{name}/v1" if skeleton else None,
            "current_version": 1 if skeleton else version,
            "unedited_seed": skeleton,
            "updated_at": "2026-10-06T20:05:39Z",
            "updated_by": "session:a96e1981",
            "body": body,
            "attrs": None,
        }

    async def list(self, tenant_id: UUID) -> dict[str, Any]:
        if self.list_error is not None:
            raise self.list_error
        rows = [
            {k: v for k, v in d.items() if k not in ("body", "attrs")}
            for d in self.docs.values()
        ]
        return {"documents": rows, "total": len(rows), "degraded": self.degraded}

    async def get(self, tenant_id: UUID, kind: str, name: str) -> dict[str, Any]:
        if (kind, name) in self.fail_get:
            raise HTTPException(status_code=500, detail="boom")
        return copy.deepcopy(self.docs[(kind, name)])

    async def patch(self, *a: Any, **k: Any) -> dict[str, Any]:  # pragma: no cover
        raise AssertionError("the objectives read never writes")

    async def create(self, *a: Any, **k: Any) -> dict[str, Any]:  # pragma: no cover
        raise AssertionError("the objectives read never writes")


class FakeFindings:
    """Coord's ``GET /coord/findings`` for the two reads the join makes, and
    its ``GET /coord/success-metric-checkpoint-results`` door.

    Faithful where it matters: a list read hides expired and superseded rows
    and caps at ``limit``; a by-id read serves an expired row but hides a
    superseded one, and answers an unknown id with an empty page. The results
    door behaves like coord's insert path: a finding whose block passes the
    shape-only validator (coord's Phase 3 check) has one row per block row,
    whatever its age; a superseded report's rows are not served. ``unrecorded``
    finding ids have no rows (an insert skipped on 42P01, or a report that
    predates the insert path); ``markers`` adds backfill marker rows.
    """

    def __init__(self) -> None:
        self.rows: list[dict[str, Any]] = []
        self.list_calls: list[tuple[list[str], int]] = []
        self.by_id_calls: list[str] = []
        #: metric name → an exception to raise, or a page to answer with.
        self.list_override: dict[str, Any] = {}
        self.by_id_error: Exception | None = None
        #: An exception to raise, or a page to answer, for the results door.
        self.results_override: Any = None
        self.results_calls: list[tuple[list[str], int]] = []
        #: Finding ids whose rows coord's table does not hold.
        self.unrecorded: set[str] = set()
        #: finding id → (metric name, checkpoint, prose_only|invalid_block, text).
        self.markers: dict[str, tuple[str, str, str, str | None]] = {}

    def add(
        self,
        finding_id: str,
        *,
        title: str = "A note",
        topic: str = "merge-train-metrics",
        keys: list[str] | None = None,
        block: dict[str, Any] | None = None,
        created_at: str = "2026-10-08T16:10:00Z",
        expired: bool = False,
        supersedes: str | None = None,
    ) -> dict[str, Any]:
        refs: dict[str, Any] = {}
        if block is not None:
            refs["metric_checkpoint"] = block
        row = {
            "finding_id": finding_id,
            "kind": "status",
            "topic": topic,
            "title": title,
            "body": f"body of {title}",
            "resource_keys": keys if keys is not None else [DOC_KEY],
            "artifact_refs": refs,
            "created_at": created_at,
            "expires_at": "2026-10-01T00:00:00Z" if expired else "2026-10-22T16:10:00Z",
            "supersedes": supersedes,
            "author_session": "s",
        }
        self.rows.append(row)
        return row

    def _superseded(self) -> set[str]:
        return {r["supersedes"] for r in self.rows if r.get("supersedes")}

    async def list_for_keys(
        self, tenant_id: UUID, resource_keys: list[str], limit: int
    ) -> dict[str, Any]:
        self.list_calls.append((list(resource_keys), limit))
        name = resource_keys[0].rsplit("/", 1)[1]
        override = self.list_override.get(name)
        if isinstance(override, Exception):
            raise override
        if override is not None:
            return override
        hidden = self._superseded()
        hits = [
            copy.deepcopy(r)
            for r in self.rows
            if set(r["resource_keys"]) & set(resource_keys)
            and r["expires_at"] > "2026-10-06"
            and r["finding_id"] not in hidden
        ][:limit]
        return {
            "available": True,
            "count": len(hits),
            "findings": hits,
            "limit": limit,
            "resource_keys_truncated": False,
        }

    async def get_by_id(self, tenant_id: UUID, finding_id: str) -> dict[str, Any]:
        self.by_id_calls.append(finding_id)
        if self.by_id_error is not None:
            raise self.by_id_error
        hits = [
            copy.deepcopy(r)
            for r in self.rows
            if r["finding_id"] == finding_id and finding_id not in self._superseded()
        ]
        return {"available": True, "count": len(hits), "findings": hits, "limit": 20}

    def table_rows(self) -> list[dict[str, Any]]:
        """What coord's results table holds, as its door serves a row."""
        hidden = self._superseded()
        out: list[dict[str, Any]] = []
        for f in self.rows:
            fid = f["finding_id"]
            if fid in hidden or fid in self.unrecorded:
                continue
            block = f["artifact_refs"].get("metric_checkpoint")
            if (
                block is None
                or not validate_metric_checkpoint(
                    block, resource_keys=f["resource_keys"]
                ).ok
            ):
                continue
            for row in block["rows"]:
                window = row.get("window") or {}
                out.append(
                    {
                        "kind": "success_metric",
                        "name": block["document"]["name"],
                        "document_version": block["document"]["version"],
                        "checkpoint": block["checkpoint"],
                        "criterion": row["id"],
                        "verdict": row["verdict"],
                        "value": row.get("value"),
                        "unit": row.get("unit"),
                        "value_text": row.get("value_text"),
                        "unknown_reason": row.get("unknown_reason"),
                        "method": row.get("method"),
                        "door": row.get("door"),
                        "cause": row.get("cause"),
                        "action": row.get("action"),
                        "window_from": window.get("from"),
                        "window_to": window.get("to"),
                        "gate_id": block.get("gate_id"),
                        "measured_at": block["measured_at"],
                        "evidence_finding_id": fid,
                        "recorded_at": "2026-10-08T16:10:01Z",
                    }
                )
        for fid, (name, cp, reason, text) in self.markers.items():
            if fid in hidden:
                continue
            created = next(
                (f["created_at"] for f in self.rows if f["finding_id"] == fid),
                "2026-10-08T16:10:00Z",
            )
            out.append(
                {
                    "kind": "success_metric", "name": name, "document_version": None,
                    "checkpoint": cp, "criterion": "*", "verdict": "unknown",
                    "value": None, "unit": None, "value_text": text,
                    "unknown_reason": reason, "method": None, "door": None,
                    "cause": None, "action": None, "window_from": None,
                    "window_to": None, "gate_id": None, "measured_at": created,
                    "evidence_finding_id": fid, "recorded_at": created,
                }
            )  # fmt: skip
        out.sort(key=lambda r: (r["name"], r["criterion"]))
        return out

    async def list_checkpoint_results(
        self, tenant_id: UUID, names: list[str], limit: int
    ) -> dict[str, Any]:
        self.results_calls.append((list(names), limit))
        if isinstance(self.results_override, Exception):
            raise self.results_override
        if self.results_override is not None:
            return self.results_override
        rows = [r for r in self.table_rows() if r["name"] in names]
        return {"available": True, "rows": rows[:limit], "truncated": len(rows) > limit}


def _block(
    checkpoint: str = "checkpoint-1",
    rows: list[dict[str, Any]] | None = None,
    measured_at: str = "2026-10-08T16:05:00Z",
) -> dict[str, Any]:
    rows = rows or [
        {"id": "1.2", "verdict": "met", "value": 14, "unit": "lands/day",
         "value_text": "14 lands in the 24 h to 2026-10-08T16:00Z", "method": "M1",
         "door": "coord_query_train_health", "window": None, "unknown_reason": None,
         "cause": None, "action": None},
    ]  # fmt: skip
    tally = {
        v: sum(1 for r in rows if r["verdict"] == v)
        for v in ("met", "missed", "unknown")
    }
    return {
        "schema": "metric-checkpoint/v1",
        "document": {"kind": "success_metric", "name": MERGE_TRAIN, "version": 2},
        "checkpoint": checkpoint,
        "measured_at": measured_at,
        "gate_id": "672148a4-9acd-4c4b-ad81-172d04addfc0",
        "rows": rows,
        "tally": tally,
    }


def _with_results(body: str, entries: list[tuple[str, str]]) -> str:
    """Appendix B Step B, applied: the document records report ids."""
    items = "".join(
        f'  - checkpoint: "{cp}"\n    finding_id: "{fid}"\n'
        f'    posted_at: "2026-10-08T16:10:00Z"\n'
        for cp, fid in entries
    )
    assert body.count("\nresults: []\n") == 1
    return body.replace("\nresults: []\n", "\nresults:\n" + items, 1)


def _id(n: int) -> str:
    return f"00000000-0000-4000-8000-{n:012d}"


@pytest.fixture()
def docs() -> FakeDocs:
    fake = FakeDocs()
    fake.seed("initiative", "current-initiative", INITIATIVE_BODY, version=10)
    fake.seed("success_metric", MERGE_TRAIN, MERGE_TRAIN_BODY)
    fake.seed("success_metric", "development-speed", DEV_SPEED_BODY, version=3)
    fake.seed("success_metric", "remote-session-interactivity", REMOTE_BODY)
    fake.seed("success_metric", "github-actions-monthly-spend", SPEND_BODY, version=1)
    fake.seed("success_metric", "citation-groundedness", VOID_BODY)
    fake.seed("success_metric", "example-metric", SKELETON_BODY, skeleton=True)
    return fake


@pytest.fixture()
def findings() -> FakeFindings:
    return FakeFindings()


def _access() -> OverviewAccess:
    return OverviewAccess(
        tenant_id=TENANT,
        roles=("operator",),
        editing_roles=("admin",),
        qontinui_staff=False,
        user_id=None,
        actor="reader@example.com",
    )


async def _read(
    docs: FakeDocs, findings: FakeFindings, now: datetime = NOW
) -> ObjectivesRead:
    ctx = StoreContext(access=_access(), db=None, request=None)  # type: ignore[arg-type]
    return await build_objectives(ctx, IntentDocumentStore(docs), findings, now=now)


def _metric(read: ObjectivesRead, name: str = MERGE_TRAIN) -> Any:
    return next(m for m in read.metrics if m.name == name)


def _checkpoint(read: ObjectivesRead, cp: str, name: str = MERGE_TRAIN) -> Any:
    return next(c for c in _metric(read, name).checkpoint_results if c.id == cp)


def _criterion(read: ObjectivesRead, cid: str, name: str = MERGE_TRAIN) -> Any:
    return next(c for c in _metric(read, name).criteria_latest if c.id == cid)


# ===========================================================================
# The route — mounted on the overview prefix, readable by any member
# ===========================================================================


def _app(docs: FakeDocs, findings: FakeFindings) -> FastAPI:
    from app.api.deps import get_async_db
    from app.overview.intent_documents import intent_document_store
    from app.overview.objectives_join import coord_findings
    from app.overview.permissions import get_overview_access
    from app.overview.router import router as authoring_router

    app = FastAPI()

    async def _db():
        yield None

    app.dependency_overrides[get_async_db] = _db
    app.dependency_overrides[get_overview_access] = _access
    app.dependency_overrides[intent_document_store] = lambda: IntentDocumentStore(docs)
    app.dependency_overrides[coord_findings] = lambda: findings
    app.include_router(authoring_router, prefix=API)
    return app


async def _get(docs: FakeDocs, findings: FakeFindings) -> httpx.Response:
    transport = httpx.ASGITransport(app=_app(docs, findings))
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
        return await c.get(f"{API}/objectives")


class TestRoute:
    async def test_a_plain_member_reads_the_objectives(
        self, docs: FakeDocs, findings: FakeFindings
    ) -> None:
        response = await _get(docs, findings)
        assert response.status_code == 200, response.text
        body = response.json()
        assert body["tenant_id"] == str(TENANT)
        assert {m["name"] for m in body["metrics"]} == {
            MERGE_TRAIN,
            "development-speed",
            "remote-session-interactivity",
            "github-actions-monthly-spend",
        }
        assert body["sources"]["findings"]["status"] == "ok"

    async def test_a_window_serializes_under_its_wire_name(
        self, docs: FakeDocs, findings: FakeFindings
    ) -> None:
        rows = [
            {"id": "1.2", "verdict": "met", "value_text": "14 lands",
             "window": {"from": "2026-10-07T16:00:00Z", "to": "2026-10-08T16:00:00Z"}},
        ]  # fmt: skip
        findings.add(_id(1), keys=[DOC_KEY, "checkpoint-1"], block=_block(rows=rows))
        body = (await _get(docs, findings)).json()
        metric = next(m for m in body["metrics"] if m["name"] == MERGE_TRAIN)
        row = metric["checkpoint_results"][0]["report"]["rows"][0]
        assert row["window"] == {
            "from": "2026-10-07T16:00:00Z",
            "to": "2026-10-08T16:00:00Z",
        }

    async def test_a_document_list_coord_did_not_answer_is_unavailable_not_empty(
        self, docs: FakeDocs, findings: FakeFindings
    ) -> None:
        docs.list_error = HTTPException(
            status_code=502, detail="coord is not reachable"
        )
        response = await _get(docs, findings)
        assert response.status_code == 200
        body = response.json()
        assert body["sources"]["intent_documents"]["status"] == "unavailable"
        assert body["objectives_readable"] is False
        assert findings.list_calls == []
        assert body["sources"]["checkpoint_results"]["status"] == "unavailable"
        assert findings.results_calls == []


# ===========================================================================
# Failure arms
# ===========================================================================


class TestDocumentListFailures:
    async def test_a_non_http_list_failure_is_unavailable_not_a_500(
        self, docs: FakeDocs, findings: FakeFindings
    ) -> None:
        docs.list_error = ValueError("not JSON")
        read = await _read(docs, findings)
        assert read.sources.intent_documents.status == "unavailable"
        assert "ValueError" in (read.sources.intent_documents.reason or "")
        assert read.objectives_readable is False

    async def test_only_void_initiatives_says_so(
        self, docs: FakeDocs, findings: FakeFindings
    ) -> None:
        docs.seed("initiative", "current-initiative",
                  "---\nmispublished: true\n---\n\n# Void\n")  # fmt: skip
        read = await _read(docs, findings)
        assert read.objectives_readable is False
        assert "wrong project" in (read.sources.intent_documents.reason or "")


class TestFindingsReadFailures:
    async def test_findings_404_is_unavailable_and_every_result_reads_unknown(
        self, docs: FakeDocs, findings: FakeFindings
    ) -> None:
        findings.list_override[MERGE_TRAIN] = HTTPException(status_code=404, detail="")
        read = await _read(docs, findings)
        assert read.sources.findings.status == "unavailable"
        assert MERGE_TRAIN in read.sources.findings.affected
        assert "404" in (read.sources.findings.details[MERGE_TRAIN])
        metric = _metric(read)
        assert metric.findings_read == "unavailable"
        for cp in metric.checkpoint_results:
            assert cp.status == "unreadable", cp.id
        assert {c.unknown_reason for c in metric.criteria_latest} == {
            "results_unreadable"
        }
        assert all(c.verdict == "unknown" for c in metric.criteria_latest)

    async def test_findings_available_false_is_unavailable_never_empty(
        self, docs: FakeDocs, findings: FakeFindings
    ) -> None:
        findings.list_override[MERGE_TRAIN] = {
            "available": False,
            "count": 0,
            "findings": [],
        }
        read = await _read(docs, findings)
        assert read.sources.findings.status == "unavailable"
        assert "available: false" in read.sources.findings.details[MERGE_TRAIN]
        assert _checkpoint(read, "checkpoint-1").status == "unreadable"
        assert _checkpoint(read, "checkpoint-2").status == "unreadable"

    async def test_a_full_page_truncates_only_that_metric(
        self, docs: FakeDocs, findings: FakeFindings
    ) -> None:
        rows = [
            {"finding_id": _id(500 + i), "topic": "other", "title": "n",
             "resource_keys": [DOC_KEY], "created_at": "2026-10-07T00:00:00Z"}
            for i in range(FINDINGS_PAGE_LIMIT)
        ]  # fmt: skip
        findings.list_override[MERGE_TRAIN] = {
            "available": True,
            "count": FINDINGS_PAGE_LIMIT,
            "findings": rows,
            "limit": FINDINGS_PAGE_LIMIT,
        }
        read = await _read(docs, findings)
        assert read.sources.findings.status == "truncated"
        assert read.sources.findings.affected == [MERGE_TRAIN]
        metric = _metric(read)
        assert metric.findings_read == "truncated"
        assert {c.unknown_reason for c in metric.criteria_latest} == {
            "results_not_fully_read"
        }
        assert _checkpoint(read, "checkpoint-1").status == "not_fully_read"
        # Every other metric read its own page in full.
        assert _metric(read, "development-speed").findings_read == "ok"

    async def test_resource_keys_truncated_also_marks_the_metric(
        self, docs: FakeDocs, findings: FakeFindings
    ) -> None:
        findings.list_override[MERGE_TRAIN] = {
            "available": True,
            "count": 0,
            "findings": [],
            "limit": 100,
            "resource_keys_truncated": True,
        }
        read = await _read(docs, findings)
        assert _metric(read).findings_read == "truncated"

    async def test_each_metric_is_one_read_of_its_two_key_spellings(
        self, docs: FakeDocs, findings: FakeFindings
    ) -> None:
        await _read(docs, findings)
        assert sorted(findings.list_calls) == sorted(
            [
                (
                    [f"prompt_document:success_metric/{n}", f"success_metric/{n}"],
                    FINDINGS_PAGE_LIMIT,
                )
                for n in (
                    MERGE_TRAIN,
                    "development-speed",
                    "remote-session-interactivity",
                    "github-actions-monthly-spend",
                )
            ]
        )

    async def test_the_proxy_sends_resource_keys_and_limit_and_no_cursor_or_topic(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from app.overview import objectives_join

        calls: list[dict[str, Any]] = []

        async def fake_get(path: str, **kwargs: Any) -> dict[str, Any]:
            calls.append({"path": path, **kwargs})
            return {"available": True, "count": 0, "findings": []}

        monkeypatch.setattr(objectives_join, "_proxy_coord_get", fake_get)
        proxied = ProxiedCoordFindings()
        await proxied.list_for_keys(TENANT, ["a", "b"], 100)
        await proxied.get_by_id(TENANT, _id(1))
        assert calls == [
            {
                "path": "/coord/findings",
                "params": {"resource_keys": ["a", "b"], "limit": 100},
                "tenant_id": TENANT,
            },
            {
                "path": "/coord/findings",
                "params": {"finding_id": _id(1)},
                "tenant_id": TENANT,
            },
        ]

    async def test_a_non_http_failure_degrades_instead_of_failing_the_page(
        self, docs: FakeDocs, findings: FakeFindings
    ) -> None:
        findings.list_override[MERGE_TRAIN] = ValueError("not JSON")
        read = await _read(docs, findings)
        assert _metric(read).findings_read == "unavailable"
        assert "ValueError" in read.sources.findings.details[MERGE_TRAIN]
        assert _metric(read, "development-speed").findings_read == "ok"

    async def test_unavailable_and_full_pages_are_both_named(
        self, docs: FakeDocs, findings: FakeFindings
    ) -> None:
        findings.list_override[MERGE_TRAIN] = HTTPException(status_code=404, detail="")
        findings.list_override["development-speed"] = {
            "available": True,
            "count": 0,
            "findings": [],
            "truncated": True,
        }
        read = await _read(docs, findings)
        assert read.sources.findings.status == "unavailable"
        assert set(read.sources.findings.affected) == {MERGE_TRAIN, "development-speed"}
        assert "development-speed" in (read.sources.findings.reason or "")
        assert _metric(read, "development-speed").findings_read == "truncated"


def _table_row(
    fid: str,
    criterion: str,
    verdict: str = "met",
    *,
    name: str = MERGE_TRAIN,
    checkpoint: str = "checkpoint-1",
    measured_at: str = "2026-10-08T16:05:00Z",
    value_text: str | None = "as served by the table",
    unknown_reason: str | None = None,
) -> dict[str, Any]:
    """One row as coord's checkpoint-results door serves it."""
    return {
        "kind": "success_metric", "name": name, "document_version": 2,
        "checkpoint": checkpoint, "criterion": criterion, "verdict": verdict,
        "value": None, "unit": None, "value_text": value_text,
        "unknown_reason": unknown_reason, "method": "M1", "door": "d",
        "cause": None, "action": None, "window_from": None, "window_to": None,
        "gate_id": None, "measured_at": measured_at, "evidence_finding_id": fid,
        "recorded_at": measured_at,
    }  # fmt: skip


def _every_criterion(read: ObjectivesRead) -> list[Any]:
    """Every criterion the page shows, per checkpoint and latest-wins, of
    every metric."""
    return [
        c
        for m in read.metrics
        for c in [
            *m.criteria_latest,
            *(x for cp in m.checkpoint_results for x in cp.criteria),
        ]
    ]


class TestCheckpointResultsDoorFailures:
    """Phase 4: every verdict row comes from coord's results table. A read of
    it that did not answer is never "rows not yet recorded" and never
    ``not_reported`` — every criterion of every metric reads "results can't be
    read", with the reason, in ``sources.checkpoint_results``."""

    @pytest.mark.parametrize(
        ("override", "said"),
        [
            (HTTPException(status_code=404, detail="Not Found"), "HTTP 404"),
            ({"available": False, "reason": "table missing"}, "available: false"),
            (HTTPException(status_code=502, detail="bad gateway"), "HTTP 502"),
            (RuntimeError("socket closed"), "RuntimeError"),
            ({"available": True}, "no rows list"),
            (["not", "an", "object"], "not an object"),
        ],
        ids=["door_404", "available_false", "http_error", "transport_error",
             "no_rows", "not_an_object"],
    )  # fmt: skip
    async def test_an_unanswered_read_makes_every_criterion_unknown_cant_be_read(
        self, docs: FakeDocs, findings: FakeFindings, override: Any, said: str
    ) -> None:
        # A report with a VALID block, found by its key: with the table
        # unread it must not say "rows not yet recorded".
        findings.add(_id(1), keys=[DOC_KEY, "checkpoint-1"], block=_block())
        findings.results_override = override
        read = await _read(docs, findings)

        source = read.sources.checkpoint_results
        assert source.status == "unavailable"
        assert said in (source.reason or "")
        assert MERGE_TRAIN in source.affected
        criteria = _every_criterion(read)
        assert criteria, "the merge-train metric declares criteria"
        for item in criteria:
            assert item.verdict == "unknown"
            assert item.unknown_reason == "checkpoint_results_unreadable"
        metric = _metric(read)
        assert metric.checkpoint_results_read == "unavailable"
        cp1 = _checkpoint(read, "checkpoint-1")
        assert cp1.report is not None and cp1.report.shape == "rows_unread"
        assert cp1.status == "checkpoint_results_unreadable"
        # A checkpoint with no report found cannot claim "no report found":
        # the table also finds reports the 14-day list read does not.
        cp3 = _checkpoint(read, "checkpoint-3")
        assert cp3.status == "checkpoint_results_unreadable"
        assert "no_report_found" not in {c.status for c in metric.checkpoint_results}
        assert "reported_rows_not_recorded" not in {
            c.status for c in metric.checkpoint_results
        }

    async def test_the_door_is_asked_once_for_every_readable_metric(
        self, docs: FakeDocs, findings: FakeFindings
    ) -> None:
        await _read(docs, findings)
        assert len(findings.results_calls) == 1
        names, limit = findings.results_calls[0]
        assert set(names) == {
            MERGE_TRAIN,
            "development-speed",
            "remote-session-interactivity",
            "github-actions-monthly-spend",
        }
        assert limit == CHECKPOINT_RESULTS_LIMIT

    async def test_the_proxied_read_names_the_door_kind_names_and_limit(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        import app.overview.objectives_results as results

        calls: list[dict[str, Any]] = []

        async def fake_get(path: str, **kw: Any) -> Any:
            calls.append({"path": path, **kw})
            return {"available": True, "rows": [], "truncated": False}

        monkeypatch.setattr(results, "_proxy_coord_get", fake_get)
        await ProxiedCoordFindings().list_checkpoint_results(TENANT, ["a", "b"], 50)
        assert calls == [
            {
                "path": "/coord/success-metric-checkpoint-results",
                "params": {"kind": "success_metric", "names": "a,b", "limit": 50},
                "tenant_id": TENANT,
            }
        ]

    async def test_a_page_flagged_truncated_leaves_unresulted_criteria_not_fully_read(
        self, docs: FakeDocs, findings: FakeFindings
    ) -> None:
        findings.add(_id(1), keys=[DOC_KEY, "checkpoint-1"], block=_block())
        findings.results_override = {
            "available": True,
            "rows": [_table_row(_id(1), "1.2", value_text="14 lands")],
            "truncated": True,
        }
        read = await _read(docs, findings)
        assert read.sources.checkpoint_results.status == "truncated"
        assert MERGE_TRAIN in read.sources.checkpoint_results.affected
        assert _metric(read).checkpoint_results_read == "truncated"
        # The row that WAS read keeps its verdict…
        assert _criterion(read, "1.2").verdict == "met"
        # …and every criterion without one is not fully read — never
        # "not reported".
        for cid in ("1.1", "2.1", "3.4"):
            item = _criterion(read, cid)
            assert item.verdict == "unknown"
            assert item.unknown_reason == "results_not_fully_read"
        assert _checkpoint(read, "checkpoint-3").status == "not_fully_read"

    async def test_a_full_page_cuts_only_the_last_name_and_names_absent_from_it(
        self, docs: FakeDocs, findings: FakeFindings, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        import app.overview.objectives_results as results

        monkeypatch.setattr(results, "CHECKPOINT_RESULTS_LIMIT", 2)
        findings.results_override = {
            "available": True,
            "rows": [
                _table_row(_id(7), "a", name="development-speed"),
                _table_row(_id(1), "1.1", name=MERGE_TRAIN),
            ],
            "truncated": False,
        }
        read = await _read(docs, findings)
        source = read.sources.checkpoint_results
        assert source.status == "truncated"
        # development-speed's run ended before the page's last name: complete.
        assert "development-speed" not in source.affected
        assert MERGE_TRAIN in source.affected
        assert "remote-session-interactivity" in source.affected
        assert _metric(read, "development-speed").checkpoint_results_read == "ok"
        assert _metric(read).checkpoint_results_read == "truncated"

    async def test_an_unreadable_row_is_named_not_dropped(
        self, docs: FakeDocs, findings: FakeFindings
    ) -> None:
        findings.results_override = {
            "available": True,
            "rows": [{**_table_row(_id(1), "1.1"), "verdict": "great"}],
            "truncated": False,
        }
        read = await _read(docs, findings)
        source = read.sources.checkpoint_results
        assert source.status == "degraded"
        assert source.affected == [MERGE_TRAIN]
        assert _criterion(read, "1.1").unknown_reason == "results_not_fully_read"
        assert _metric(read, "development-speed").checkpoint_results_read == "ok"


class TestCheckpointResultsRows:
    async def test_a_valid_block_with_no_rows_is_reported_rows_not_recorded(
        self, docs: FakeDocs, findings: FakeFindings
    ) -> None:
        findings.add(_id(1), keys=[DOC_KEY, "checkpoint-1"], block=_block())
        findings.unrecorded.add(_id(1))  # the insert was skipped (42P01)
        read = await _read(docs, findings)
        assert read.sources.checkpoint_results.status == "ok"
        cp = _checkpoint(read, "checkpoint-1")
        assert cp.report is not None
        assert cp.report.shape == "rows_not_recorded"
        assert cp.status == "reported_rows_not_recorded"
        assert cp.report.rows == []
        for item in cp.criteria:
            assert item.verdict == "unknown"
            assert item.unknown_reason == "rows_not_recorded"
        assert _criterion(read, "1.2").unknown_reason == "rows_not_recorded"

    async def test_the_block_never_becomes_rows_the_table_does(
        self, docs: FakeDocs, findings: FakeFindings
    ) -> None:
        # The block says MET; the table (coord's durable record) says MISSED.
        findings.add(_id(1), keys=[DOC_KEY, "checkpoint-1"], block=_block())
        findings.results_override = {
            "available": True,
            "rows": [_table_row(_id(1), "1.2", "missed", value_text="3 lands")],
            "truncated": False,
        }
        read = await _read(docs, findings)
        item = _criterion(read, "1.2")
        assert item.verdict == "missed"
        assert item.row is not None and item.row.value_text == "3 lands"

    async def test_an_invalid_block_marker_is_a_result_that_could_not_be_read(
        self, docs: FakeDocs, findings: FakeFindings
    ) -> None:
        block = _block()
        block["tally"]["met"] = 5
        findings.add(_id(1), keys=[DOC_KEY, "checkpoint-1"], block=block)
        findings.markers[_id(1)] = (
            MERGE_TRAIN,
            "checkpoint-1",
            "invalid_block",
            "tally.met: is 5 but 1 row says met",
        )
        read = await _read(docs, findings)
        cp = _checkpoint(read, "checkpoint-1")
        assert cp.status == "reported_unreadable"
        assert cp.report.shape == "unreadable_block"
        assert cp.report.block_error == "tally.met: is 5 but 1 row says met"
        assert cp.status_reason == "tally.met: is 5 but 1 row says met"
        assert "table" in cp.report.placed_by
        for item in cp.criteria:
            assert item.unknown_reason == "report_unreadable"

    async def test_an_invalid_block_before_the_backfill_is_unreadable_not_unrecorded(
        self, docs: FakeDocs, findings: FakeFindings
    ) -> None:
        block = _block()
        block["tally"]["met"] = 5
        findings.add(_id(1), keys=[DOC_KEY, "checkpoint-1"], block=block)
        read = await _read(docs, findings)  # no rows, no marker yet
        cp = _checkpoint(read, "checkpoint-1")
        assert cp.report.shape == "unreadable_block"
        assert cp.status == "reported_unreadable"
        assert "tally" in (cp.report.block_error or "")

    async def test_a_prose_only_marker_places_its_report_in_prose_only(
        self, docs: FakeDocs, findings: FakeFindings
    ) -> None:
        # No checkpoint key, not recorded: only coord's table places it.
        findings.add(
            _id(1), title="Merge-train checkpoint 1: unblocked", keys=[DOC_KEY]
        )
        findings.markers[_id(1)] = (MERGE_TRAIN, "checkpoint-1", "prose_only", None)
        read = await _read(docs, findings)
        cp = _checkpoint(read, "checkpoint-1")
        assert cp.status == "reported_prose_only"
        assert cp.report.shape == "prose_only"
        assert cp.report.placed_by == ["table"]
        assert cp.report.body == "body of Merge-train checkpoint 1: unblocked"
        for item in cp.criteria:
            assert item.unknown_reason == "reported_prose_only"
        assert not any(n.finding_id == _id(1) for n in _metric(read).related_notes)

    async def test_latest_wins_over_table_rows(
        self, docs: FakeDocs, findings: FakeFindings
    ) -> None:
        findings.add(_id(1), keys=[DOC_KEY, "checkpoint-1"],
                     created_at="2026-10-08T16:10:00Z")  # fmt: skip
        findings.add(_id(2), keys=[DOC_KEY, "checkpoint-2"],
                     created_at="2026-10-13T16:10:00Z")  # fmt: skip
        findings.results_override = {
            "available": True,
            "rows": [
                _table_row(_id(2), "1.2", "met", checkpoint="checkpoint-2",
                           measured_at="2026-10-13T16:05:00Z"),
                _table_row(_id(1), "1.2", "missed",
                           measured_at="2026-10-08T16:05:00Z"),
            ],
            "truncated": False,
        }  # fmt: skip
        read = await _read(docs, findings, now=datetime(2026, 10, 14, tzinfo=UTC))
        item = _criterion(read, "1.2")
        assert item.verdict == "met"
        assert item.reported_checkpoint == "checkpoint-2"
        assert [(e.checkpoint, e.verdict) for e in item.earlier] == [
            ("checkpoint-1", "missed")
        ]

    async def test_a_same_instant_tie_goes_to_the_later_checkpoint(
        self, docs: FakeDocs, findings: FakeFindings
    ) -> None:
        at = "2026-10-13T16:05:00Z"
        findings.add(_id(1), keys=[DOC_KEY, "checkpoint-1"])
        findings.add(_id(2), keys=[DOC_KEY, "checkpoint-2"])
        findings.results_override = {
            "available": True,
            "rows": [
                _table_row(_id(1), "1.2", "missed", measured_at=at),
                _table_row(_id(2), "1.2", "met", checkpoint="checkpoint-2",
                           measured_at=at),
            ],
            "truncated": False,
        }  # fmt: skip
        read = await _read(docs, findings, now=datetime(2026, 10, 14, tzinfo=UTC))
        assert _criterion(read, "1.2").reported_checkpoint == "checkpoint-2"

    async def test_a_superseded_reports_rows_are_absent_so_its_head_wins(
        self, docs: FakeDocs, findings: FakeFindings
    ) -> None:
        findings.add(_id(1), keys=[DOC_KEY, "checkpoint-1"], block=_block())
        corrected = _block(rows=[
            {"id": "1.2", "verdict": "missed", "value_text": "3 lands",
             "cause": "c", "action": None}])  # fmt: skip
        findings.add(_id(2), keys=[DOC_KEY, "checkpoint-1"], block=corrected,
                     supersedes=_id(1))  # fmt: skip
        assert {r["evidence_finding_id"] for r in findings.table_rows()} == {_id(2)}
        read = await _read(docs, findings)
        item = _criterion(read, "1.2")
        assert item.verdict == "missed" and item.finding_id == _id(2)
        assert item.earlier == []

    async def test_by_id_supplies_the_body_of_a_report_only_the_table_finds(
        self, docs: FakeDocs, findings: FakeFindings
    ) -> None:
        # Past its list expiry and never recorded in `results:`: only the
        # table finds it, and the by-id read supplies its body.
        findings.add(_id(1), keys=[DOC_KEY, "checkpoint-1"], block=_block(),
                     title="Merge-train checkpoint 1", expired=True)  # fmt: skip
        read = await _read(docs, findings)
        assert findings.by_id_calls == [_id(1)]
        cp = _checkpoint(read, "checkpoint-1")
        assert cp.status == "reported"
        assert cp.report.body == "body of Merge-train checkpoint 1"
        assert cp.report.body_unavailable is None
        assert _criterion(read, "1.2").verdict == "met"

    async def test_rows_whose_report_cannot_be_read_by_id_still_show(
        self, docs: FakeDocs, findings: FakeFindings
    ) -> None:
        findings.add(_id(1), keys=[DOC_KEY, "checkpoint-1"], block=_block(),
                     expired=True)  # fmt: skip
        findings.by_id_error = HTTPException(status_code=503, detail="down")
        read = await _read(docs, findings)
        cp = _checkpoint(read, "checkpoint-1")
        assert cp.status == "reported"
        assert cp.report.body is None
        assert "HTTP 503" in (cp.report.body_unavailable or "")
        assert _criterion(read, "1.2").verdict == "met"
        assert read.sources.findings_by_id.status == "degraded"

    async def test_rows_under_an_undeclared_checkpoint_are_a_note_not_lost(
        self, docs: FakeDocs, findings: FakeFindings
    ) -> None:
        findings.add(_id(1), keys=[DOC_KEY], expired=True)
        findings.results_override = {
            "available": True,
            "rows": [_table_row(_id(1), "1.2", checkpoint="checkpoint-9")],
            "truncated": False,
        }
        read = await _read(docs, findings)
        notes = {n.finding_id: n for n in _metric(read).related_notes}
        assert "checkpoint-9" in (notes[_id(1)].note or "")
        assert _criterion(read, "1.2").verdict == "unknown"


class TestMalformedBlocks:
    @pytest.mark.parametrize(
        ("mutate", "field"),
        [
            (lambda b: b["tally"].update(met=2), "tally"),
            (lambda b: b["rows"][0].update(verdict="partial"), "rows[0].verdict"),
            (lambda b: b["rows"][0].update(value_text=None), "rows[0].value_text"),
            # Unhashable values: a refusal, never a TypeError (review round 1).
            (lambda b: b["rows"][0].update(verdict=[]), "rows[0].verdict"),
            (
                lambda b: b["rows"][0].update(
                    verdict="unknown",
                    unknown_reason={},
                    cause="c",
                    action={"kind": "pr", "ref": "x#1"},
                ),
                "rows[0].unknown_reason",
            ),  # fmt: skip
            (
                lambda b: b["rows"][0].update(action={"kind": [], "ref": "x"}),
                "rows[0].action.kind",
            ),
        ],
        ids=[
            "tally_mismatch",
            "bad_enum",
            "met_without_value_text",
            "verdict_a_list",
            "unknown_reason_an_object",
            "action_kind_a_list",
        ],
    )
    async def test_a_malformed_block_is_reported_but_unreadable(
        self, docs: FakeDocs, findings: FakeFindings, mutate: Any, field: str
    ) -> None:
        block = _block()
        mutate(block)
        findings.add(_id(1), keys=[DOC_KEY, "checkpoint-1"], block=block)
        read = await _read(docs, findings)
        cp = _checkpoint(read, "checkpoint-1")
        assert cp.status == "reported_unreadable"
        assert cp.report is not None and cp.report.shape == "unreadable_block"
        assert field in (cp.report.block_error or "")
        assert cp.report.rows == []  # never partly trusted
        assert {c.unknown_reason for c in cp.criteria} == {"report_unreadable"}
        assert _criterion(read, "1.2").verdict == "unknown"

    async def test_an_undeclared_row_is_flagged_not_a_refused_block(
        self, docs: FakeDocs, findings: FakeFindings
    ) -> None:
        """D5: one extra re-reported row must not blank every verdict."""
        rows = [
            {"id": "1.2", "verdict": "met", "value_text": "14 lands"},
            {"id": "9.9", "verdict": "missed", "value_text": "x",
             "cause": "c", "action": {"kind": "pr", "ref": "x#1"}},
        ]  # fmt: skip
        findings.add(_id(1), keys=[DOC_KEY, "checkpoint-1"], block=_block(rows=rows))
        read = await _read(docs, findings)
        cp = _checkpoint(read, "checkpoint-1")
        report = cp.report
        assert report.shape == "structured"
        assert cp.status == "reported"
        assert [(r.id, r.declared) for r in report.rows] == [
            ("1.2", True),
            ("9.9", False),
        ]
        assert any(w.startswith("rows[1].id:") for w in report.block_warnings)
        # The undeclared row counts toward no declared criterion.
        assert cp.tally.model_dump() == {"met": 1, "missed": 0, "unknown": 6}
        assert _criterion(read, "1.2").verdict == "met"
        assert "9.9" not in {c.id for c in _metric(read).criteria_latest}
        assert _metric(read).tally_latest.missed == 0

    async def test_an_unhashable_value_leaves_the_page_200_and_other_metrics_intact(
        self, docs: FakeDocs, findings: FakeFindings
    ) -> None:
        docs.seed("success_metric", "remote-session-interactivity",
                  REMOTE_BODY.replace("unit: percent of sessions\n",
                                      "unit: percent of sessions\n"
                                      "checkpoints:\n  - id: \"checkpoint-1\"\n"
                                      "    due: \"2026-10-08\"\n"))  # fmt: skip
        remote_block = _block()
        remote_block["document"]["name"] = "remote-session-interactivity"
        findings.add(
            _id(2),
            keys=["prompt_document:success_metric/remote-session-interactivity"],
            block=remote_block,
        )
        block = _block()
        block["rows"][0]["verdict"] = []
        findings.add(_id(1), keys=[DOC_KEY, "checkpoint-1"], block=block)
        response = await _get(docs, findings)
        assert response.status_code == 200, response.text
        body = response.json()
        merge = next(m for m in body["metrics"] if m["name"] == MERGE_TRAIN)
        cp = next(c for c in merge["checkpoint_results"] if c["id"] == "checkpoint-1")
        assert cp["report"]["shape"] == "unreadable_block"
        assert "rows[0].verdict" in cp["report"]["block_error"]
        remote = next(
            m for m in body["metrics"] if m["name"] == "remote-session-interactivity"
        )
        assert remote["checkpoint_results"][0]["status"] == "reported"
        assert len(body["metrics"]) == 4

    async def test_a_validator_crash_marks_only_that_report_unreadable(
        self, docs: FakeDocs, findings: FakeFindings, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        import app.overview.objectives_join as join

        real = join.validate_metric_checkpoint

        def flaky(block: Any, **kw: Any) -> Any:
            if block.get("checkpoint") == "checkpoint-2":
                raise RuntimeError("unexpected")
            return real(block, **kw)

        monkeypatch.setattr(join, "validate_metric_checkpoint", flaky)
        findings.add(_id(1), keys=[DOC_KEY, "checkpoint-1"], block=_block())
        findings.add(_id(2), keys=[DOC_KEY, "checkpoint-2"],
                     block=_block("checkpoint-2", rows=[
                         {"id": "2.1", "verdict": "met", "value_text": "ok"}]))  # fmt: skip
        # Before the backfill: no table rows, so the web validator decides.
        findings.unrecorded.add(_id(2))
        read = await _read(docs, findings)
        bad = _checkpoint(read, "checkpoint-2")
        assert bad.status == "reported_unreadable"
        assert bad.report.shape == "unreadable_block"
        assert "RuntimeError" in (bad.report.block_error or "")
        assert _checkpoint(read, "checkpoint-1").status == "reported"

    async def test_a_placement_crash_is_a_note_not_a_500(
        self, docs: FakeDocs, findings: FakeFindings, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        import app.overview.objectives_join as join

        real = join._place

        def flaky(finding: dict[str, Any], *a: Any) -> Any:
            if finding["finding_id"] == _id(2):
                raise KeyError("boom")
            return real(finding, *a)

        monkeypatch.setattr(join, "_place", flaky)
        findings.add(_id(1), keys=[DOC_KEY, "checkpoint-1"], block=_block())
        findings.add(_id(2), keys=[DOC_KEY, "checkpoint-2"], block=_block())
        read = await _read(docs, findings)
        assert _checkpoint(read, "checkpoint-1").status == "reported"
        notes = _metric(read).related_notes
        assert [n.finding_id for n in notes] == [_id(2)]
        assert "KeyError" in (notes[0].note or "")

    async def test_one_metrics_join_crash_degrades_only_that_metric(
        self, docs: FakeDocs, findings: FakeFindings, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        import app.overview.objectives as objectives

        real = objectives.join_results
        calls: list[str] = []

        def flaky(metric: Any, *a: Any) -> None:
            calls.append(metric.name)
            if metric.name == MERGE_TRAIN and calls.count(MERGE_TRAIN) == 1:
                raise TypeError("unhashable")
            real(metric, *a)

        monkeypatch.setattr(objectives, "join_results", flaky)
        findings.add(_id(1), keys=[DOC_KEY, "checkpoint-1"], block=_block())
        read = await _read(docs, findings)
        merge = _metric(read)
        assert merge.findings_read == "unavailable"
        assert all(c.report is None for c in merge.checkpoint_results)
        assert {c.verdict for c in merge.criteria_latest} == {"unknown"}
        assert read.sources.findings.status == "unavailable"
        assert MERGE_TRAIN in read.sources.findings.affected
        assert "TypeError" in read.sources.findings.details[MERGE_TRAIN]
        assert _metric(read, "development-speed").findings_read == "ok"

    async def test_a_join_crash_reports_recorded_results_as_read_failed(
        self, docs: FakeDocs, findings: FakeFindings, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """The fallback names the crash, never an over-the-limit skip."""
        import app.overview.objectives as objectives

        real = objectives.join_results
        calls: list[str] = []

        def flaky(metric: Any, *a: Any) -> None:
            calls.append(metric.name)
            if metric.name == MERGE_TRAIN and calls.count(MERGE_TRAIN) == 1:
                raise TypeError("unhashable")
            real(metric, *a)

        monkeypatch.setattr(objectives, "join_results", flaky)
        docs.seed("success_metric", MERGE_TRAIN,
                  _with_results(MERGE_TRAIN_BODY, [("checkpoint-1", _id(1))]))  # fmt: skip
        findings.add(_id(1), keys=[DOC_KEY, "checkpoint-1"], block=_block())
        read = await _read(docs, findings)
        cp = _checkpoint(read, "checkpoint-1")
        assert [u.reason for u in cp.unresolved_results] == ["read_failed"]
        assert "TypeError" in cp.unresolved_results[0].detail
        assert "at most" not in cp.unresolved_results[0].detail

    async def test_a_crashing_fallback_still_shows_every_criterion_unknown(
        self, docs: FakeDocs, findings: FakeFindings, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        import app.overview.objectives as objectives

        real = objectives.join_results

        def broken(metric: Any, *a: Any) -> None:
            if metric.name == MERGE_TRAIN:
                raise TypeError("unhashable")
            real(metric, *a)

        monkeypatch.setattr(objectives, "join_results", broken)
        findings.add(_id(1), keys=[DOC_KEY, "checkpoint-1"], block=_block())
        read = await _read(docs, findings)
        merge = _metric(read)
        assert merge.findings_read == "unavailable"
        assert len(merge.criteria_latest) == 17
        assert {c.verdict for c in merge.criteria_latest} == {"unknown"}
        assert {c.unknown_reason for c in merge.criteria_latest} == {
            "results_unreadable"
        }
        assert merge.tally_latest.unknown == 17
        assert merge.tally_latest.met == 0
        assert _metric(read, "development-speed").findings_read == "ok"

    async def test_an_undeclared_checkpoint_still_refuses_the_block(
        self, docs: FakeDocs, findings: FakeFindings
    ) -> None:
        """It cannot be placed, so the block is unreadable (Appendix A)."""
        findings.add(
            _id(1),
            keys=[DOC_KEY, "checkpoint-1"],
            topic="merge-train-metrics",
            block=_block("checkpoint-9"),
        )
        read = await _read(docs, findings)
        report = _checkpoint(read, "checkpoint-1").report
        assert report.shape == "unreadable_block"
        assert "checkpoint" in report.block_error


class TestPlacement:
    async def test_a_prose_only_report_is_placed_by_topic_and_checkpoint_key(
        self, docs: FakeDocs, findings: FakeFindings
    ) -> None:
        findings.add(
            _id(1),
            title="Merge-train checkpoint 1 (2 MET / 1 MISSED)",
            keys=[DOC_KEY, "merge-train-metrics", "checkpoint-1"],
        )
        read = await _read(docs, findings)
        cp = _checkpoint(read, "checkpoint-1")
        assert cp.status == "reported_prose_only"
        assert cp.report.placed_by == ["checkpoint_key"]
        assert cp.report.body == "body of Merge-train checkpoint 1 (2 MET / 1 MISSED)"
        assert {c.unknown_reason for c in cp.criteria} == {"reported_prose_only"}
        assert cp.tally.unknown == 7
        assert _metric(read).related_notes == []

    async def test_a_notification_finding_lands_in_related_notes_never_as_a_report(
        self, docs: FakeDocs, findings: FakeFindings
    ) -> None:
        findings.add(_id(1), title="Announcing v2 of the metric", keys=[DOC_KEY])
        read = await _read(docs, findings)
        metric = _metric(read)
        assert [n.finding_id for n in metric.related_notes] == [_id(1)]
        assert all(c.report is None for c in metric.checkpoint_results)

    async def test_a_refusal_notice_keyed_only_by_the_document_is_a_note(
        self, docs: FakeDocs, findings: FakeFindings
    ) -> None:
        findings.add(
            _id(1),
            title="results: write refused for checkpoint-1 (policy_write_disabled)",
            topic="merge-train-metrics",
            keys=[DOC_KEY],
        )
        read = await _read(docs, findings)
        assert [n.finding_id for n in _metric(read).related_notes] == [_id(1)]
        assert _checkpoint(read, "checkpoint-1").report is None

    async def test_the_gate_anchor_key_does_not_place_by_rule_c(
        self, docs: FakeDocs, findings: FakeFindings
    ) -> None:
        findings.add(
            _id(1),
            title="Checkpoint result",
            keys=[DOC_KEY, f"{MERGE_TRAIN}:checkpoint-1"],
        )
        read = await _read(docs, findings)
        assert _checkpoint(read, "checkpoint-1").report is None
        assert [n.finding_id for n in _metric(read).related_notes] == [_id(1)]

    async def test_two_checkpoint_keys_place_nothing_by_rule_c(
        self, docs: FakeDocs, findings: FakeFindings
    ) -> None:
        findings.add(_id(1), keys=[DOC_KEY, "checkpoint-1", "checkpoint-2"])
        read = await _read(docs, findings)
        assert _checkpoint(read, "checkpoint-1").report is None
        assert _checkpoint(read, "checkpoint-2").report is None

    async def test_the_block_wins_over_a_disagreeing_key_and_the_card_flags_it(
        self, docs: FakeDocs, findings: FakeFindings
    ) -> None:
        findings.add(
            _id(1), keys=[DOC_KEY, "checkpoint-2"], block=_block("checkpoint-1")
        )
        read = await _read(docs, findings)
        report = _checkpoint(read, "checkpoint-1").report
        assert report.placed_by == ["table", "block"]
        assert "checkpoint-2" in (report.checkpoint_mismatch or "")
        assert _checkpoint(read, "checkpoint-2").report is None

    async def test_several_reports_newest_is_the_report_the_rest_history(
        self, docs: FakeDocs, findings: FakeFindings
    ) -> None:
        findings.add(_id(1), keys=[DOC_KEY, "checkpoint-1"], block=_block(),
                     created_at="2026-10-08T16:10:00Z")  # fmt: skip
        findings.add(_id(2), keys=[DOC_KEY, "checkpoint-1"], block=_block(),
                     created_at="2026-10-08T18:10:00Z")  # fmt: skip
        read = await _read(docs, findings)
        cp = _checkpoint(read, "checkpoint-1")
        assert cp.report.finding_id == _id(2)
        assert [h.finding_id for h in cp.history] == [_id(1)]

    async def test_a_block_for_another_metric_is_not_this_metrics_result(
        self, docs: FakeDocs, findings: FakeFindings
    ) -> None:
        block = _block()
        block["document"]["name"] = "development-speed"
        findings.add(_id(1), keys=[DOC_KEY], block=block)
        read = await _read(docs, findings)
        assert _checkpoint(read, "checkpoint-1").report is None
        assert [n.finding_id for n in _metric(read).related_notes] == [_id(1)]

    async def test_a_nameless_block_keyed_under_two_metrics_is_placed_by_a_under_neither(
        self, docs: FakeDocs, findings: FakeFindings
    ) -> None:
        block = _block()
        del block["document"]["name"]
        findings.add(
            _id(1),
            keys=[DOC_KEY, "prompt_document:success_metric/development-speed"],
            block=block,
        )
        read = await _read(docs, findings)
        assert _checkpoint(read, "checkpoint-1").report is None
        assert _metric(read, "development-speed").checkpoint_results == []
        for name in (MERGE_TRAIN, "development-speed"):
            notes = _metric(read, name).related_notes
            assert [n.finding_id for n in notes] == [_id(1)]
            assert "result block" in (notes[0].note or "")

    async def test_a_nameless_block_placed_by_its_key_is_an_unreadable_report(
        self, docs: FakeDocs, findings: FakeFindings
    ) -> None:
        block = _block()
        del block["document"]["name"]
        findings.add(_id(1), keys=[DOC_KEY, "checkpoint-1"], block=block)
        read = await _read(docs, findings)
        report = _checkpoint(read, "checkpoint-1").report
        assert report.placed_by == ["checkpoint_key"]
        assert report.shape == "unreadable_block"
        assert "document.name" in (report.block_error or "")


class TestRecordedResults:
    async def test_an_expired_result_is_served_by_id_from_results(
        self, docs: FakeDocs, findings: FakeFindings
    ) -> None:
        docs.seed("success_metric", MERGE_TRAIN,
                  _with_results(MERGE_TRAIN_BODY, [("checkpoint-1", _id(1))]))  # fmt: skip
        # Expired, and with no checkpoint key: only the document finds it.
        findings.add(_id(1), keys=[DOC_KEY], block=_block(), expired=True)
        read = await _read(docs, findings)
        assert findings.by_id_calls == [_id(1)]
        cp = _checkpoint(read, "checkpoint-1")
        assert cp.status == "reported"
        assert cp.report.recorded is True
        assert cp.report.placed_by == ["table", "block", "results"]
        assert _criterion(read, "1.2").verdict == "met"

    async def test_an_empty_by_id_answer_reads_superseded_or_missing(
        self, docs: FakeDocs, findings: FakeFindings
    ) -> None:
        docs.seed("success_metric", MERGE_TRAIN,
                  _with_results(MERGE_TRAIN_BODY, [("checkpoint-1", _id(9))]))  # fmt: skip
        read = await _read(docs, findings)
        cp = _checkpoint(read, "checkpoint-1")
        assert cp.status == "unreadable"
        assert [u.reason for u in cp.unresolved_results] == ["superseded_or_missing"]
        assert _id(9) in read.sources.findings_by_id.details
        assert {c.unknown_reason for c in cp.criteria} == {"results_unreadable"}

    async def test_a_superseded_recorded_report_yields_to_its_live_head(
        self, docs: FakeDocs, findings: FakeFindings
    ) -> None:
        docs.seed("success_metric", MERGE_TRAIN,
                  _with_results(MERGE_TRAIN_BODY, [("checkpoint-1", _id(1))]))  # fmt: skip
        findings.add(_id(1), keys=[DOC_KEY, "checkpoint-1"])
        findings.add(_id(2), keys=[DOC_KEY, "checkpoint-1"], block=_block(),
                     supersedes=_id(1), created_at="2026-10-08T17:00:00Z")  # fmt: skip
        read = await _read(docs, findings)
        cp = _checkpoint(read, "checkpoint-1")
        assert cp.report.finding_id == _id(2)
        assert cp.status == "reported"
        assert [u.reason for u in cp.unresolved_results] == ["superseded_or_missing"]

    async def test_a_by_id_read_that_fails_is_named_in_sources(
        self, docs: FakeDocs, findings: FakeFindings
    ) -> None:
        docs.seed("success_metric", MERGE_TRAIN,
                  _with_results(MERGE_TRAIN_BODY, [("checkpoint-1", _id(9))]))  # fmt: skip
        findings.by_id_error = HTTPException(status_code=503, detail="down")
        read = await _read(docs, findings)
        assert read.sources.findings_by_id.status == "degraded"
        cp = _checkpoint(read, "checkpoint-1")
        assert cp.status == "unreadable"
        assert [u.reason for u in cp.unresolved_results] == ["read_failed"]

    async def test_a_non_http_by_id_failure_is_read_failed(
        self, docs: FakeDocs, findings: FakeFindings
    ) -> None:
        docs.seed("success_metric", MERGE_TRAIN,
                  _with_results(MERGE_TRAIN_BODY, [("checkpoint-1", _id(9))]))  # fmt: skip
        findings.by_id_error = ValueError("not JSON")
        read = await _read(docs, findings)
        cp = _checkpoint(read, "checkpoint-1")
        assert [u.reason for u in cp.unresolved_results] == ["read_failed"]
        assert "ValueError" in cp.unresolved_results[0].detail

    async def test_over_32_recorded_ids_truncates_the_by_id_source(
        self, docs: FakeDocs, findings: FakeFindings
    ) -> None:
        entries = [
            ("checkpoint-1", _id(100 + i)) for i in range(MAX_RESULT_ID_READS + 3)
        ]
        docs.seed(
            "success_metric", MERGE_TRAIN, _with_results(MERGE_TRAIN_BODY, entries)
        )
        read = await _read(docs, findings)
        assert len(findings.by_id_calls) == MAX_RESULT_ID_READS
        assert read.sources.findings_by_id.status == "truncated"
        assert len([a for a in read.sources.findings_by_id.affected
                    if "over the" in read.sources.findings_by_id.details[a]]) == 3  # fmt: skip
        reasons = {
            u.reason for u in _checkpoint(read, "checkpoint-1").unresolved_results
        }
        assert "not_read_over_limit" in reasons

    async def test_a_report_found_by_list_but_not_recorded_is_still_placed(
        self, docs: FakeDocs, findings: FakeFindings
    ) -> None:
        findings.add(_id(1), keys=[DOC_KEY, "checkpoint-1"], block=_block())
        read = await _read(docs, findings)
        cp = _checkpoint(read, "checkpoint-1")
        assert cp.status == "reported"
        assert cp.report.recorded is False
        assert findings.by_id_calls == []

    async def test_a_late_path_finding_is_a_possible_report_not_a_report(
        self, docs: FakeDocs, findings: FakeFindings
    ) -> None:
        findings.add(
            _id(1),
            title="Merge-train checkpoint 1 (3 MET)",
            keys=[DOC_KEY],
            created_at="2026-10-06T19:00:00Z",  # before structured_reporting_since
        )
        read = await _read(docs, findings)
        cp = _checkpoint(read, "checkpoint-1")
        assert cp.report is None
        assert cp.status == "possible_report_unrecorded"
        note = _metric(read).related_notes[0]
        assert note.possible_report_for == "checkpoint-1"

    async def test_a_late_title_after_the_cutoff_is_only_a_note(
        self, docs: FakeDocs, findings: FakeFindings
    ) -> None:
        findings.add(
            _id(1),
            title="Merge-train checkpoint 1 (3 MET)",
            keys=[DOC_KEY],
            created_at="2026-10-08T19:00:00Z",
        )
        read = await _read(docs, findings)
        assert _metric(read).related_notes[0].possible_report_for is None
        # Still inside checkpoint 1's due window at NOW.
        assert _checkpoint(read, "checkpoint-1").status == "awaiting"

    async def test_a_recorded_result_no_rule_places_is_a_note_not_hidden(
        self, docs: FakeDocs, findings: FakeFindings
    ) -> None:
        body = _with_results(MERGE_TRAIN_BODY, [("checkpoint-1", _id(1))])
        body = body.replace(
            '  - checkpoint: "checkpoint-1"\n', "  - checkpoint: null\n", 1
        )
        docs.seed("success_metric", MERGE_TRAIN, body)
        findings.add(_id(1), keys=[DOC_KEY], expired=True)
        read = await _read(docs, findings)
        notes = _metric(read).related_notes
        assert [n.finding_id for n in notes] == [_id(1)]
        assert "results list" in (notes[0].note or "")

    async def test_a_recorded_id_listed_under_another_metric_is_not_reread(
        self, docs: FakeDocs, findings: FakeFindings
    ) -> None:
        docs.seed("success_metric", MERGE_TRAIN,
                  _with_results(MERGE_TRAIN_BODY, [("checkpoint-1", _id(1))]))  # fmt: skip
        # A prose report keyed only to another metric: development-speed's
        # page returns it, and merge-train's results list places it.
        findings.add(_id(1), keys=["prompt_document:success_metric/development-speed"])
        read = await _read(docs, findings)
        assert findings.by_id_calls == []
        cp = _checkpoint(read, "checkpoint-1")
        assert cp.status == "reported_prose_only"
        assert cp.report.placed_by == ["results"]
        assert cp.unresolved_results == []

    async def test_a_keyed_finding_is_never_a_late_path_candidate(
        self, docs: FakeDocs, findings: FakeFindings
    ) -> None:
        findings.add(
            _id(1),
            title="Merge-train checkpoint 1 (3 MET)",
            keys=[DOC_KEY, "checkpoint-1", "checkpoint-2"],
            created_at="2026-10-06T19:00:00Z",
        )
        read = await _read(docs, findings)
        assert _metric(read).related_notes[0].possible_report_for is None

    async def test_an_undeclared_checkpoint_key_also_bars_the_late_path(
        self, docs: FakeDocs, findings: FakeFindings
    ) -> None:
        findings.add(
            _id(1),
            title="Merge-train checkpoint 1 (3 MET)",
            keys=[DOC_KEY, "checkpoint-7"],
            created_at="2026-10-06T19:00:00Z",
        )
        read = await _read(docs, findings)
        assert _metric(read).related_notes[0].possible_report_for is None
        assert _checkpoint(read, "checkpoint-1").status != "possible_report_unrecorded"

    async def test_a_results_entry_with_no_checkpoint_or_id_is_shown_on_the_metric(
        self, docs: FakeDocs, findings: FakeFindings
    ) -> None:
        body = MERGE_TRAIN_BODY.replace(
            "\nresults: []\n",
            "\nresults:\n"
            '  - finding_id: "not-a-uuid"\n'
            f'  - finding_id: "{_id(5)}"\n'
            '  - checkpoint: "checkpoint-1"\n',
            1,
        )
        docs.seed("success_metric", MERGE_TRAIN, body)
        read = await _read(docs, findings)
        metric = _metric(read)
        assert [(u.finding_id, u.reason) for u in metric.unresolved_results] == [
            ("not-a-uuid", "invalid_id"),
            (_id(5), "superseded_or_missing"),
        ]
        # The checkpoint-named entry still shows under its checkpoint.
        cp = _checkpoint(read, "checkpoint-1")
        assert [u.reason for u in cp.unresolved_results] == ["invalid_id"]
        error = metric.field_errors.get("results", "")
        assert "no checkpoint" in error and "no finding_id" in error

    async def test_a_duplicated_checkpoint_key_still_places_by_rule_c(
        self, docs: FakeDocs, findings: FakeFindings
    ) -> None:
        findings.add(_id(1), keys=[DOC_KEY, "checkpoint-1", "checkpoint-1"])
        read = await _read(docs, findings)
        assert _checkpoint(read, "checkpoint-1").status == "reported_prose_only"


class TestDocumentShapes:
    async def test_a_skeleton_is_hidden_counted_and_never_read(
        self, docs: FakeDocs, findings: FakeFindings
    ) -> None:
        read = await _read(docs, findings)
        assert read.skeletons_hidden == 1
        assert "example-metric" not in {m.name for m in read.metrics}
        assert all("example-metric" not in k[0][0] for k in findings.list_calls)

    async def test_a_mispublished_document_is_void_hidden_and_counted(
        self, docs: FakeDocs, findings: FakeFindings
    ) -> None:
        read = await _read(docs, findings)
        assert read.void_hidden == 1
        assert "citation-groundedness" not in {m.name for m in read.metrics}
        assert "citation-groundedness" not in read.other_metrics

    async def test_a_mispublished_initiative_is_void_hidden(
        self, docs: FakeDocs, findings: FakeFindings
    ) -> None:
        docs.seed("initiative", "wrong-project",
                  "---\nmispublished: true\nstatus: live\nin_scope:\n  - id: x\n"
                  "    text: x\n---\n\n# Void\n")  # fmt: skip
        read = await _read(docs, findings)
        assert read.void_hidden == 2
        assert [i.name for i in read.initiatives] == ["current-initiative"]

    async def test_an_unreadable_metric_is_shown_and_named_in_sources(
        self, docs: FakeDocs, findings: FakeFindings
    ) -> None:
        docs.fail_get.add(("success_metric", "development-speed"))
        read = await _read(docs, findings)
        metric = _metric(read, "development-speed")
        assert metric.state == "unreadable"
        assert metric.findings_read == "not_read"
        assert read.sources.intent_documents.status == "degraded"
        assert "development-speed" in read.sources.intent_documents.affected

    async def test_an_unreadable_initiative_degrades_and_never_empties_objectives(
        self, docs: FakeDocs, findings: FakeFindings
    ) -> None:
        docs.fail_get.add(("initiative", "current-initiative"))
        read = await _read(docs, findings)
        assert read.objectives_readable is False
        assert read.sources.intent_documents.status == "degraded"
        assert "can't be read" in (read.sources.intent_documents.reason or "")
        assert read.initiatives[0].state == "unreadable"
        assert len(read.metrics) == 4  # the measures still show

    async def test_no_initiative_written_is_readable_and_empty_not_unreadable(
        self, docs: FakeDocs, findings: FakeFindings
    ) -> None:
        del docs.docs[("initiative", "current-initiative")]
        read = await _read(docs, findings)
        assert read.objectives_readable is True
        assert read.initiatives == []
        assert read.sources.intent_documents.status == "ok"
        assert len(read.metrics) == 4

    async def test_no_initiative_on_a_degraded_listing_is_not_readable(
        self, docs: FakeDocs, findings: FakeFindings
    ) -> None:
        """A degraded list cannot vouch that no initiative exists."""
        del docs.docs[("initiative", "current-initiative")]
        docs.degraded = "the store answered a partial page"
        read = await _read(docs, findings)
        assert read.objectives_readable is False
        assert read.sources.intent_documents.status == "degraded"

    async def test_an_initiative_frontmatter_error_is_not_readable(
        self, docs: FakeDocs, findings: FakeFindings
    ) -> None:
        docs.seed("initiative", "current-initiative",
                  "---\nstarts: 2026-02-30\n---\n\n# I\n")  # fmt: skip
        read = await _read(docs, findings)
        assert read.objectives_readable is False
        assert "can't be read" in (read.sources.intent_documents.reason or "")

    async def test_a_skeleton_only_initiative_degrades(
        self, docs: FakeDocs, findings: FakeFindings
    ) -> None:
        docs.seed(
            "initiative", "current-initiative", "# Initiative skeleton\n", skeleton=True
        )
        read = await _read(docs, findings)
        assert read.objectives_readable is False
        assert "skeleton" in (read.sources.intent_documents.reason or "")

    async def test_a_document_with_no_frontmatter_is_all_null(
        self, docs: FakeDocs, findings: FakeFindings
    ) -> None:
        docs.seed(
            "success_metric", "development-speed", "# Development speed\n\nProse.\n"
        )
        read = await _read(docs, findings)
        metric = _metric(read, "development-speed")
        assert metric.frontmatter_error is None
        assert metric.target is None and metric.baseline is None
        assert metric.source_query_type == "absent"
        assert (
            metric.current_value.reason == "This measure has no source coord can run."
        )
        assert metric.title == "Development speed"

    @pytest.mark.parametrize(
        "frontmatter",
        [
            "metric: [unclosed\ntarget: : :\n",
            # PyYAML raises ValueError, not YAMLError, for an impossible date.
            "metric: dev\nbaseline_as_of: 2026-02-30\n",
            "metric: dev\nbaseline_as_of: 2026-10-08 25:00:00\n",
            # ...and RecursionError for nesting deeper than the stack.
            "metric: " + "[" * 3000 + "]" * 3000 + "\n",
        ],
        ids=["syntax", "impossible_date", "impossible_time", "too_deep"],
    )
    async def test_unparseable_yaml_never_fails_the_page(
        self, docs: FakeDocs, findings: FakeFindings, frontmatter: str
    ) -> None:
        docs.seed("success_metric", "development-speed",
                  f"---\n{frontmatter}---\n\n# Dev\n")  # fmt: skip
        read = await _read(docs, findings)
        metric = _metric(read, "development-speed")
        assert (
            metric.frontmatter_error
            and "could not be parsed" in metric.frontmatter_error
        )
        assert metric.metric is None
        assert "development-speed" in read.sources.intent_documents.affected

    async def test_free_text_bounds_and_a_ceiling_without_a_target(
        self, docs: FakeDocs, findings: FakeFindings
    ) -> None:
        read = await _read(docs, findings)
        spend = _metric(read, "github-actions-monthly-spend")
        # "Ceiling: 750", not "No target declared".
        assert spend.ceiling == 750.0 and spend.ceiling_text == "750"
        assert spend.target is None and spend.target_text is None
        assert spend.baseline is None
        assert spend.baseline_text == "3867.34 (2026-09, org net)"
        assert spend.direction == "decrease"
        assert any("lower_is_better" in w for w in spend.frontmatter_warnings)
        assert {(f.key, f.text) for f in spend.extra_fields} == {
            ("last_reviewed", "2026-10-03")
        }

    async def test_free_text_target_and_direction_are_text_with_a_warning(
        self, docs: FakeDocs, findings: FakeFindings
    ) -> None:
        docs.seed("success_metric", "development-speed",
                  "---\ntarget: about 60 a week\ndirection: up-ish\n---\n\n# Dev\n")  # fmt: skip
        read = await _read(docs, findings)
        metric = _metric(read, "development-speed")
        assert metric.target is None and metric.target_text == "about 60 a week"
        assert metric.direction is None and metric.direction_text == "up-ish"
        assert metric.frontmatter_warnings

    async def test_an_explicit_null_direction_carries_no_warning(
        self, docs: FakeDocs, findings: FakeFindings
    ) -> None:
        read = await _read(docs, findings)
        metric = _metric(read)
        assert metric.direction is None and metric.direction_text is None
        assert metric.frontmatter_warnings == []

    async def test_legacy_free_string_checkpoints_are_text_and_keys_are_notes(
        self, docs: FakeDocs, findings: FakeFindings
    ) -> None:
        docs.seed("success_metric", MERGE_TRAIN,
                  "---\nmetric: merge-train-throughput-2026-10\nreport_topic: merge-train-metrics\n"
                  "checkpoints: 2026-10-08 (unblocked), 2026-10-13 (keeping up)\n---\n\n# M\n")  # fmt: skip
        findings.add(_id(1), keys=[DOC_KEY, "checkpoint-1"])
        read = await _read(docs, findings)
        metric = _metric(read)
        assert metric.checkpoints == []
        assert (
            metric.checkpoints_text == "2026-10-08 (unblocked), 2026-10-13 (keeping up)"
        )
        assert any("free text" in w for w in metric.frontmatter_warnings)
        assert metric.checkpoint_results == []
        assert [n.finding_id for n in metric.related_notes] == [_id(1)]

    async def test_unquoted_dates_are_served_as_iso_strings(
        self, docs: FakeDocs, findings: FakeFindings
    ) -> None:
        read = await _read(docs, findings)
        assert _metric(read, "development-speed").baseline_as_of == "2026-08-27"
        initiative = read.initiatives[0]
        assert (initiative.starts, initiative.ends) == ("2026-08-31", "2027-02-28")

    async def test_serves_naming_an_unknown_item_is_noted_under_other_measures(
        self, docs: FakeDocs, findings: FakeFindings
    ) -> None:
        docs.seed("success_metric", "github-actions-monthly-spend",
                  "---\nserves: [cost-control]\n---\n\n# Spend\n")  # fmt: skip
        read = await _read(docs, findings)
        assert _metric(read, "github-actions-monthly-spend").serves_unknown == [
            "cost-control"
        ]
        assert "github-actions-monthly-spend" in read.other_metrics

    async def test_unquoted_criterion_ids_are_named_not_repaired(
        self, docs: FakeDocs, findings: FakeFindings
    ) -> None:
        docs.seed("success_metric", "development-speed",
                  "---\ncriteria:\n  - id: 1.1\n    checkpoint: c\n  - id: \"1.2\"\n---\n\n# D\n")  # fmt: skip
        read = await _read(docs, findings)
        metric = _metric(read, "development-speed")
        assert [c.id for c in metric.criteria] == ["1.2"]
        assert "quoted" in metric.field_errors["criteria"]


class TestVerdicts:
    async def test_a_declared_criterion_with_no_result_is_not_reported(
        self, docs: FakeDocs, findings: FakeFindings
    ) -> None:
        findings.add(_id(1), keys=[DOC_KEY, "checkpoint-1"], block=_block())
        read = await _read(docs, findings)
        cp = _checkpoint(read, "checkpoint-1")
        verdicts = {c.id: (c.verdict, c.unknown_reason) for c in cp.criteria}
        assert verdicts["1.2"] == ("met", None)
        assert verdicts["1.1"] == ("unknown", "not_reported")
        assert cp.tally.model_dump() == {"met": 1, "missed": 0, "unknown": 6}
        # The denominator is the declared criteria, all 17.
        assert len(_metric(read).criteria_latest) == 17

    async def test_rows_are_flagged_undeclared_when_the_document_declares_no_criteria(
        self, docs: FakeDocs, findings: FakeFindings
    ) -> None:
        docs.seed("success_metric", MERGE_TRAIN,
                  "---\ncheckpoints:\n  - id: \"checkpoint-1\"\n    due: \"2026-10-08\"\n"
                  "---\n\n# M\n")  # fmt: skip
        findings.add(_id(1), keys=[DOC_KEY], block=_block())
        read = await _read(docs, findings)
        report = _checkpoint(read, "checkpoint-1").report
        assert report.shape == "structured"
        assert [r.declared for r in report.rows] == [False]

    async def test_the_latest_row_wins_and_the_earlier_one_is_kept(
        self, docs: FakeDocs, findings: FakeFindings
    ) -> None:
        missed = [{"id": "1.2", "verdict": "missed", "value_text": "4 lands",
                   "cause": "red main", "action": {"kind": "pr", "ref": "x#1"}}]  # fmt: skip
        met = [{"id": "1.2", "verdict": "met", "value_text": "12 lands"}]
        findings.add(_id(1), keys=[DOC_KEY, "checkpoint-1"], block=_block(rows=missed))
        findings.add(
            _id(2),
            keys=[DOC_KEY, "checkpoint-2"],
            block=_block("checkpoint-2", met, measured_at="2026-10-13T10:00:00Z"),
            created_at="2026-10-13T10:05:00Z",
        )
        read = await _read(docs, findings, now=datetime(2026, 10, 14, tzinfo=UTC))
        latest = _criterion(read, "1.2")
        assert latest.verdict == "met"
        assert latest.reported_checkpoint == "checkpoint-2"
        assert [(e.checkpoint, e.verdict) for e in latest.earlier] == [
            ("checkpoint-1", "missed")
        ]
        # The checkpoint's own view keeps what ITS report said.
        own = next(
            c for c in _checkpoint(read, "checkpoint-1").criteria if c.id == "1.2"
        )
        assert own.verdict == "missed"

    async def test_a_later_prose_only_report_marks_earlier_verdicts(
        self, docs: FakeDocs, findings: FakeFindings
    ) -> None:
        findings.add(_id(1), keys=[DOC_KEY, "checkpoint-1"], block=_block())
        findings.add(
            _id(2),
            title="Merge-train checkpoint 2 (prose)",
            keys=[DOC_KEY, "checkpoint-2"],
            created_at="2026-10-13T10:05:00Z",
        )
        read = await _read(docs, findings, now=datetime(2026, 10, 14, tzinfo=UTC))
        notice = _criterion(read, "1.2").out_of_date_notice
        assert notice is not None
        assert (notice.checkpoint, notice.shape) == ("checkpoint-2", "prose_only")

    async def test_due_window_statuses(
        self, docs: FakeDocs, findings: FakeFindings
    ) -> None:
        # Inside checkpoint 1's window (due 8 Oct, closes 10 Oct 00:00Z).
        read = await _read(docs, findings, now=datetime(2026, 10, 9, 23, tzinfo=UTC))
        assert _checkpoint(read, "checkpoint-1").status == "awaiting"
        read = await _read(docs, findings, now=datetime(2026, 10, 10, tzinfo=UTC))
        cp = _checkpoint(read, "checkpoint-1")
        assert cp.status == "no_report_found"
        assert cp.window_closes_at == datetime(2026, 10, 10, tzinfo=UTC)
        assert all(c.unknown_reason == "not_reported" for c in cp.criteria)


class TestCurrentValue:
    @pytest.mark.parametrize(
        ("raw", "expected"),
        [
            (None, "absent"),
            ("manual: by hand", "manual"),
            ("named: development_speed", "named"),
            ("http: https://x/y", "http"),
            ({"named": "x"}, "named"),
            ("SELECT 1", "untyped"),
            ("sql: SELECT 1", "untyped"),
            (42, "untyped"),
        ],
    )
    def test_source_query_type(self, raw: Any, expected: str) -> None:
        assert source_query_type(raw) == expected

    async def test_every_metric_reads_not_measured_with_its_reason(
        self, docs: FakeDocs, findings: FakeFindings
    ) -> None:
        read = await _read(docs, findings)
        reasons = {
            m.name: (m.current_value.status, m.current_value.reason)
            for m in read.metrics
        }
        assert reasons[MERGE_TRAIN] == (
            "not_measured",
            "Measured by hand; no automatic reading.",
        )
        assert (
            reasons["development-speed"][1]
            == "This measure has no source coord can run."
        )
        assert (
            reasons["remote-session-interactivity"][1]
            == "Coord does not run measures yet."
        )


# ===========================================================================
# The success path — the merge-train document's real shape
# ===========================================================================


class TestSuccessPath:
    async def test_the_merge_train_metric_end_to_end(
        self, docs: FakeDocs, findings: FakeFindings
    ) -> None:
        docs.seed("success_metric", MERGE_TRAIN,
                  _with_results(MERGE_TRAIN_BODY, [("checkpoint-1", _id(1))]))  # fmt: skip
        rows = [
            {"id": "1.1", "verdict": "met", "value_text": "main green at abc123",
             "method": "M3", "door": "gh run list"},
            {"id": "1.2", "verdict": "missed", "value": 6, "unit": "lands/day",
             "value_text": "6 lands", "method": "M1", "door": "coord_query_train_health",
             "window": {"from": "2026-10-07T16:00:00Z", "to": "2026-10-08T16:00:00Z"},
             "cause": "ccfg queue still draining",
             "action": {"kind": "plan", "ref": "2026-10-08-ccfg-queue"}},
            {"id": "1.6", "verdict": "unknown", "unknown_reason": "probe_error",
             "cause": "coord_pr_status timed out", "action": None},
        ]  # fmt: skip
        findings.add(
            _id(1),
            title="Merge-train checkpoint 1 (1 MET / 1 MISSED / 1 UNKNOWN)",
            keys=[DOC_KEY, "merge-train-metrics", "checkpoint-1"],
            block=_block(rows=rows),
        )
        findings.add(_id(2), title="Announcing v2", keys=[DOC_KEY, "merge-train-metrics"],
                     created_at="2026-10-06T20:05:15Z")  # fmt: skip

        read = await _read(docs, findings)
        metric = _metric(read)
        assert metric.title == "Merge-train throughput — October 2026"
        assert metric.state == "authored" and metric.version == 2
        assert metric.report_topic == "merge-train-metrics"
        assert metric.structured_reporting_since == "2026-10-06T20:05:31Z"
        assert metric.source_query_type == "manual"
        assert [c.id for c in metric.checkpoints] == [
            "checkpoint-1",
            "checkpoint-2",
            "checkpoint-3",
        ]
        assert [c.due for c in metric.checkpoints] == [
            "2026-10-08",
            "2026-10-13",
            "2026-10-27",
        ]
        assert len(metric.criteria) == 17
        assert metric.criteria[0].method == "M3 (latest `main` CI conclusion)"
        assert {(f.key, f.text) for f in metric.extra_fields} >= {
            ("last_reviewed", "2026-10-06")
        }
        assert any(f.key == "notes" for f in metric.extra_fields)
        assert metric.field_errors == {}

        cp1 = _checkpoint(read, "checkpoint-1")
        assert cp1.status == "reported"
        assert cp1.report.placed_by == [
            "table",
            "block",
            "results",
            "checkpoint_key",
        ]
        assert cp1.report.recorded is True
        assert cp1.report.document_version == 2
        assert cp1.report.block_warnings == [
            "rows[2].action: a unknown row is expected to name an action"
        ]
        assert cp1.tally.model_dump() == {"met": 1, "missed": 1, "unknown": 5}
        assert _checkpoint(read, "checkpoint-2").status == "awaiting"
        assert _checkpoint(read, "checkpoint-3").status == "awaiting"
        assert [n.finding_id for n in metric.related_notes] == [_id(2)]
        assert metric.tally_latest.model_dump() == {
            "met": 1,
            "missed": 1,
            "unknown": 15,
        }
        assert _criterion(read, "1.6").unknown_reason == "probe_error"
        assert _criterion(read, "2.1").unknown_reason == "not_reported"
        assert read.sources.findings.status == "ok"
        assert read.sources.findings_by_id.status == "ok"

    async def test_initiative_grouping(
        self, docs: FakeDocs, findings: FakeFindings
    ) -> None:
        read = await _read(docs, findings)
        assert read.objectives_readable is True
        assert read.sources.intent_documents.status == "ok"
        initiative = read.initiatives[0]
        assert initiative.live is True
        assert initiative.title == (
            "Current initiative — parity and reachability first, then the roadmap they unblock"
        )
        by_id = {o.id: o.metric_names for o in initiative.objectives}
        assert by_id == {
            "remote-session-access": ["development-speed"],
            "coord-reachability": ["development-speed"],
            # No measure declared for this objective yet — not a blank group.
            "merge-train-d1": [],
        }
        assert read.initiative_named_metrics == ["remote-session-interactivity"]
        assert sorted(read.other_metrics) == [
            "github-actions-monthly-spend",
            MERGE_TRAIN,
        ]
        assert initiative.missing_metric_names == ["published-runner-parity-defects"]
        assert read.earlier_initiatives_count == 0

    async def test_a_non_live_initiative_is_listed_apart(
        self, docs: FakeDocs, findings: FakeFindings
    ) -> None:
        docs.seed("initiative", "q3-push",
                  "---\nstatus: done\nin_scope:\n  - id: old-goal\n    text: old\n---\n\n# Q3\n")  # fmt: skip
        read = await _read(docs, findings)
        assert [i.name for i in read.initiatives] == ["current-initiative", "q3-push"]
        assert read.earlier_initiatives_count == 1


# ===========================================================================
# Units — frontmatter, title, and the golden validator cases
# ===========================================================================


class TestFrontmatterUnits:
    def test_dates_at_any_depth_become_iso_strings(self) -> None:
        fm, error = parse_frontmatter(
            "---\na: 2026-10-08\nb:\n  - due: 2026-10-13\nc: 2026-10-06T20:05:31Z\n---\n"
        )
        assert error is None
        assert fm == {
            "a": "2026-10-08",
            "b": [{"due": "2026-10-13"}],
            "c": "2026-10-06T20:05:31Z",
        }

    def test_a_non_mapping_block_is_an_error(self) -> None:
        assert parse_frontmatter("---\n- a\n- b\n---\n")[1]

    def test_the_title_rule_matches_the_summary(self) -> None:
        assert title_of_document("vision", "# Vision — the *autonomy* ratchet\n") == (
            "Vision — the autonomy ratchet"
        )
        assert title_of_document("non-goals", "Plain prose first.\n") == "Non goals"
        assert title_of_document("x", "Setext Title\n=====\n\nbody") == "Setext Title"
        assert title_of_document("x-y", "# ***\n") == "X y"
        assert title_of_document("x", "- item\n===\n") == "X"


_CASES = json.loads((FIXTURES / "metric_checkpoint_v1" / "cases.json").read_text())


@pytest.mark.parametrize("case", _CASES["cases"], ids=lambda c: c["name"])
def test_metric_checkpoint_v1_golden_case(case: dict[str, Any]) -> None:
    result = validate_metric_checkpoint(
        case["block"],
        resource_keys=case["resource_keys"],
        declared_checkpoints=case.get("declared_checkpoints"),
        declared_criteria=case.get("declared_criteria"),
    )
    fields = [p.field for p in result.errors]
    if case["expect"] == "valid":
        assert result.ok, fields
    else:
        assert not result.ok
        assert case["error_field"] in fields, fields
    for warned in case.get("warning_fields", []):
        assert warned in [p.field for p in result.warnings]


@pytest.mark.parametrize(
    "case",
    [c for c in _CASES["cases"] if c["web_only"]],
    ids=lambda c: c["name"],
)
def test_web_only_cases_pass_without_the_documents_declarations(
    case: dict[str, Any],
) -> None:
    """What coord (which reads no document) sees: shape only."""
    result = validate_metric_checkpoint(
        case["block"], resource_keys=case["resource_keys"]
    )
    assert result.ok, [p.field for p in result.errors]
