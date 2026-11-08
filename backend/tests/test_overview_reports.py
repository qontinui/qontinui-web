"""Stakeholder reports — the Phase 1 resources, end to end against Postgres.

Plan ``2026-11-07-interactive-stakeholder-reports-in-the-project-overview``
Phase 1. Pins, for ``reports`` and ``report_snapshots``:

* **the contract**, hand-written for both resources as
  ``test_overview_documents.py`` does for pages: tenant isolation, role gating,
  ``If-Match`` (428 absent, 409 stale with the server's copy), idempotent
  create, versions and revert, and the change-log rows;
* **cardinality**, enumerated: a report with 0, 1, 48 and 49 stops (the view's
  ``truncated``, ``total`` and ``before=`` page), and two concurrent snapshot
  creates on one report;
* **time order**: a stop posted with an earlier ``as_of`` takes its place, and
  its neighbours' changes are recomputed;
* **the allowlist**: the contract's key set written out by hand, each
  cross-field rule refused and accepted, each string scanner (mutation-checked
  by hand: disabling it turns its case here red), the link rule, re-validation
  of an older allowlist version, a confidential term added after the write,
  and the 503 a write gets while the scope reads UNKNOWN;
* **strictness**: a body that omits a key or leans on a coercion is refused,
  so the stored document re-serializes to the publisher's sha;
* **the view**: withdrawn stops hidden, ``changes_since_previous`` with
  ``method_changed`` and unknown-to-known transitions;
* **agents**: a paired device publishes for ``editing_roles``, and re-posting
  a snapshot file is a no-op while changing it is 409
  ``snapshot_changed_at_source``.

Every test enters over HTTP — never through ``ReportStore`` directly. What is
stood in for is only what lives outside this process: coord's caller
resolution, and for a device its JWKS verdict and membership door (as
``test_overview_agent_publishing.py`` does). The presentation scope row is
written directly as setup; its own door needs a signed-in admin and coord.

Synthetic names only (this repository is public): the confidential term is
``Northwind Mutual``, the first-party owner ``example-org``.
"""

from __future__ import annotations

import asyncio
import copy
import hashlib
import json
import types
from collections.abc import AsyncIterator, Callable
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import UUID, uuid4

import httpx
import pytest
import pytest_asyncio
from fastapi import FastAPI, HTTPException
from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

API = "/api/v1/overview"

pytestmark = pytest.mark.asyncio

TENANT_A = UUID("aaaaaaaa-0000-4000-8000-0000000000f1")
TENANT_B = UUID("bbbbbbbb-0000-4000-8000-0000000000f2")
TERM = "Northwind Mutual"
OWNER = "example-org"
PR_LINK = f"https://github.com/{OWNER}/widgets/pull/12"
COMMIT_LINK = f"https://github.com/{OWNER}/widgets/commit/{'ab12' * 10}"

#: A complete, valid ``report-snapshot/v1`` document. Tests deep-copy it.
DOC: dict[str, Any] = {
    "schema": "report-snapshot/v1",
    "label": "Baseline review",
    "as_of": "2026-10-13T12:00:00Z",
    "method": {"kind": "full_review", "label": "Full review", "note": None},
    "summary": "Where the platform stood at the first review.",
    "groups": [
        {
            "id": "recommendations",
            "label": "Recommendations",
            "help": "What the review asked for.",
            "due": "2026-11-30",
        }
    ],
    "tables": [
        {
            "id": "scorecard",
            "title": "Scorecard",
            "caption": "Each aspect scored from 1 to 5.",
            "row_header": "Aspect",
            "scale": {"min": 1, "max": 5, "target": 5, "better": "higher"},
            "columns": [
                {
                    "id": "leanness",
                    "label": "Leanness",
                    "help": "How little it carries.",
                },
                {
                    "id": "operability",
                    "label": "Operability",
                    "help": "How easy it is to run.",
                },
            ],
            "rows": [
                {
                    "id": "scheduler",
                    "label": "Scheduler",
                    "help": None,
                    "cells": {
                        "leanness": {"value": 2, "unknown_reason": None},
                        "operability": {
                            "value": None,
                            "unknown_reason": "Not measured at this stop.",
                        },
                    },
                }
            ],
            "summary_rows": [
                {
                    "id": "average",
                    "label": "Average",
                    "cells": {
                        "leanness": {"value": 2, "unknown_reason": None},
                        "operability": {
                            "value": None,
                            "unknown_reason": "Not measured at this stop.",
                        },
                    },
                }
            ],
        }
    ],
    "figures": [
        {
            "id": "lead-time",
            "label": "Lead time",
            "help": "Days from plan to land.",
            "unit": "days",
            "value": 9.5,
            "unknown_reason": None,
            "baseline": 12,
            "target": 5,
            "better": "lower",
            "verdict": "missed",
            "source": "Merge ledger",
            "measured_at": "2026-10-13T00:00:00Z",
        }
    ],
    "items": [
        {
            "id": "split-scheduler",
            "group": "recommendations",
            "label": "Split the scheduler",
            "help": None,
            "status": "planned",
            "status_note": None,
            "events": [],
            "links": [],
        }
    ],
    "notes": [
        {
            "title": "How this was measured",
            "body_md": "A full review.\n\nEvery aspect was scored.",
        }
    ],
}


def _doc(**top: Any) -> dict[str, Any]:
    doc = copy.deepcopy(DOC)
    doc.update(top)
    return doc


def _canonical_sha(doc: Any) -> str:
    """What a publisher computes from its file — independent of the server."""
    return hashlib.sha256(
        json.dumps(
            doc, sort_keys=True, separators=(",", ":"), ensure_ascii=False
        ).encode("utf-8")
    ).hexdigest()


# ===========================================================================
# Harness
# ===========================================================================


@pytest_asyncio.fixture()
async def api_user(async_db_session: AsyncSession):
    from app.models.user import User

    user = User(
        email=f"reports_{uuid4().hex[:8]}@example.com",
        username=f"reports_{uuid4().hex[:8]}",
        full_name="Reports Tester",
        is_active=True,
        is_verified=True,
    )
    async_db_session.add(user)
    await async_db_session.commit()
    await async_db_session.refresh(user)
    return user


def _app(db: AsyncSession, user, tenant: UUID, roles: tuple[str, ...]) -> FastAPI:
    from app.api.deps import (
        current_active_user,
        current_active_user_optional,
        get_async_db,
    )
    from app.api.v1.endpoints.overview import router as overview_router
    from app.overview.permissions import OverviewCaller, get_overview_caller
    from app.overview.router import router as authoring_router

    app = FastAPI()
    app.dependency_overrides[current_active_user] = app.dependency_overrides[
        current_active_user_optional
    ] = lambda: user

    async def _db():
        yield db

    app.dependency_overrides[get_async_db] = _db
    app.dependency_overrides[get_overview_caller] = lambda: OverviewCaller(
        tenant_id=tenant, roles=roles
    )
    app.include_router(overview_router, prefix=API)
    app.include_router(authoring_router, prefix=API)
    return app


def _client(app: FastAPI) -> httpx.AsyncClient:
    return httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://test",
        headers={"X-Overview-Source": "ui"},
    )


@pytest_asyncio.fixture()
async def admin(async_db_session, api_user):
    async with _client(_app(async_db_session, api_user, TENANT_A, ("admin",))) as c:
        yield c


@pytest_asyncio.fixture()
async def operator(async_db_session, api_user):
    async with _client(_app(async_db_session, api_user, TENANT_A, ("operator",))) as c:
        yield c


@pytest_asyncio.fixture()
async def other_project(async_db_session, api_user):
    async with _client(_app(async_db_session, api_user, TENANT_B, ("admin",))) as c:
        yield c


async def _set_scope(
    db: AsyncSession,
    tenant: UUID = TENANT_A,
    *,
    owners: list[str] | None = None,
    terms: list[str] | None = None,
) -> int:
    """Write the tenant's presentation scope row (moving its version, as the
    scope door does) and return the version. ``owners=None`` configures no
    first-party owners."""
    from app.models.presentation_scope import PresentationScope

    row = await db.get(PresentationScope, tenant)
    if row is None:
        row = PresentationScope(
            tenant_id=tenant,
            first_party_owners=owners,
            confidential_terms=terms or [],
            version=1,
        )
        db.add(row)
    else:
        row.first_party_owners = owners
        row.confidential_terms = terms or []
        row.version += 1
    await db.commit()
    return row.version


async def _report(client: httpx.AsyncClient, **body: Any) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "title": "Platform review progress",
        "summary": "How the platform has improved since the review.",
        "body_md": "# Progress\n\n```report-timeline\n```",
    }
    payload.update(body)
    response = await client.post(f"{API}/reports", json=payload)
    assert response.status_code == 201, response.text
    return response.json()["item"]


async def _post(
    client: httpx.AsyncClient,
    report_id: str,
    data: dict[str, Any],
    *,
    source_path: str | None = None,
    key: str | None = None,
) -> httpx.Response:
    body: dict[str, Any] = {"report_id": report_id, "data": data}
    if source_path is not None:
        body["source_path"] = source_path
    headers = {"Idempotency-Key": key} if key else None
    return await client.post(f"{API}/report-snapshots", json=body, headers=headers)


async def _snapshot(
    client: httpx.AsyncClient, report_id: str, data: dict[str, Any], **kw: Any
) -> dict[str, Any]:
    response = await _post(client, report_id, data, **kw)
    assert response.status_code == 201, response.text
    return response.json()["item"]


async def _view(
    client: httpx.AsyncClient, report_id: str, **params: Any
) -> dict[str, Any]:
    response = await client.get(f"{API}/reports/{report_id}/view", params=params)
    assert response.status_code == 200, response.text
    return response.json()


async def _log(db: AsyncSession, resource: str, tenant: UUID = TENANT_A) -> list[Any]:
    from app.models.overview import ChangeLog

    rows = await db.execute(
        select(ChangeLog)
        .where(ChangeLog.tenant_id == tenant, ChangeLog.resource == resource)
        .order_by(ChangeLog.created_at, ChangeLog.id)
    )
    return list(rows.scalars().all())


def _violations(response: httpx.Response) -> list[dict[str, str]]:
    body = response.json()
    assert response.status_code == 422, response.text
    assert body["error"] == "snapshot_rejected", body
    return body["violations"]


def _names_term(payload: Any) -> bool:
    """Whether ``payload`` (a body, or its text) names the confidential term
    in ANY spelling the scan folds together: compared on ``match_key``-folded
    text, so ``northwind-mutual`` or ``NORTHWIND_mutual`` is a leak of it."""
    from app.services.presentation_scope import match_key

    text = (
        payload if isinstance(payload, str) else json.dumps(payload, ensure_ascii=False)
    )
    return match_key(TERM) in match_key(text)


def _stop(day: int, **top: Any) -> dict[str, Any]:
    """A valid stop measured ``day`` days after 2026-01-01."""
    moment = datetime(2026, 1, 1, tzinfo=UTC) + timedelta(days=day)
    return _doc(
        label=f"Stop {day}",
        as_of=moment.isoformat().replace("+00:00", "Z"),
        **top,
    )


def _with(
    doc: dict[str, Any], mutate: Callable[[dict[str, Any]], None]
) -> dict[str, Any]:
    out = copy.deepcopy(doc)
    mutate(out)
    return out


# ===========================================================================
# Reports — the contract
# ===========================================================================


class TestReports:
    async def test_create_derives_the_slug_records_version_one_and_logs_no_body(
        self, admin: httpx.AsyncClient, async_db_session: AsyncSession
    ) -> None:
        from app.models.overview import ReportVersion

        report = await _report(admin, title="Platform Review: Progress")
        assert report["slug"] == "platform-review-progress"
        assert report["version"] == 1 and report["body_md"].startswith("# Progress")
        versions = (
            (
                await async_db_session.execute(
                    select(ReportVersion).where(
                        ReportVersion.report_id == UUID(report["id"])
                    )
                )
            )
            .scalars()
            .all()
        )
        assert [v.version for v in versions] == [1]
        (row,) = await _log(async_db_session, "reports")
        assert row.action == "create" and row.source == "ui"
        assert "body_md" not in row.after and row.after["summary"].startswith("How")

    async def test_each_write_is_a_version_and_a_revert_writes_a_new_one(
        self, admin: httpx.AsyncClient, async_db_session: AsyncSession
    ) -> None:
        report = await _report(admin)
        url = f"{API}/reports/{report['id']}"
        edited = await admin.patch(
            url, json={"body_md": "# Revised"}, headers={"If-Match": '"1"'}
        )
        assert edited.status_code == 200 and edited.headers["ETag"] == '"2"'
        listing = (await admin.get(f"{url}/versions")).json()
        assert [v["version"] for v in listing["versions"]] == [2, 1]
        assert listing["current_version"] == 2
        v1 = (await admin.get(f"{url}/versions/1")).json()
        assert v1["body_md"].startswith("# Progress") and v1["summary"].startswith(
            "How"
        )
        assert (await admin.get(f"{url}/versions/9")).status_code == 404
        reverted = await admin.post(
            f"{url}/versions/1/revert", headers={"If-Match": '"2"'}
        )
        assert reverted.status_code == 200, reverted.text
        item = reverted.json()["item"]
        assert item["version"] == 3 and item["body_md"].startswith("# Progress")
        rows = await _log(async_db_session, "reports")
        assert rows[-1].after["reverted_to_version"] == 1
        assert "body_md" not in rows[-1].after
        stale = await admin.post(
            f"{url}/versions/1/revert", headers={"If-Match": '"2"'}
        )
        assert stale.status_code == 409
        assert stale.json()["current"]["version"] == 3

    async def test_a_revert_to_a_version_the_scan_now_refuses_is_422(
        self, admin: httpx.AsyncClient, async_db_session: AsyncSession
    ) -> None:
        """A revert writes the old narrative as a NEW version, scanned as any
        write is: one naming a term added since is refused 422
        report_rejected, naming the field and never the value, and nothing
        is written."""
        await _set_scope(async_db_session, terms=[])
        report = await _report(admin, body_md=f"# Progress\n\nWork for {TERM}.")
        url = f"{API}/reports/{report['id']}"
        rewritten = "# Progress\n\nRewritten."
        edited = await admin.patch(
            url, json={"body_md": rewritten}, headers={"If-Match": '"1"'}
        )
        assert edited.status_code == 200, edited.text
        await _set_scope(async_db_session, terms=[TERM])
        refused = await admin.post(
            f"{url}/versions/1/revert", headers={"If-Match": '"2"'}
        )
        assert refused.status_code == 422, refused.text
        body = refused.json()
        assert body["error"] == "report_rejected"
        assert {"slot": "body_md", "kind": "confidential_term"} in body["violations"]
        assert not _names_term(refused.text)
        got = (await admin.get(url)).json()["item"]
        assert (got["version"], got["body_md"]) == (2, rewritten)
        assert [r.action for r in await _log(async_db_session, "reports")] == [
            "create",
            "update",
        ]

    async def test_if_match_is_required_and_a_stale_write_gets_the_servers_copy(
        self, admin: httpx.AsyncClient
    ) -> None:
        report = await _report(admin)
        url = f"{API}/reports/{report['id']}"
        assert (await admin.patch(url, json={"title": "B"})).status_code == 428
        assert (await admin.delete(url)).status_code == 428
        await admin.patch(url, json={"title": "Second"}, headers={"If-Match": '"1"'})
        stale = await admin.patch(
            url, json={"title": "Third"}, headers={"If-Match": '"1"'}
        )
        assert stale.status_code == 409
        assert stale.json()["current"]["title"] == "Second"
        assert stale.headers["ETag"] == '"2"'

    async def test_an_unchanged_write_is_not_a_version(
        self, admin: httpx.AsyncClient, async_db_session: AsyncSession
    ) -> None:
        report = await _report(admin)
        same = await admin.patch(
            f"{API}/reports/{report['id']}",
            json={"title": report["title"]},
            headers={"If-Match": '"1"'},
        )
        assert same.status_code == 200 and same.json()["item"]["version"] == 1
        assert [r.action for r in await _log(async_db_session, "reports")] == ["create"]

    async def test_a_keyed_create_replays_and_a_taken_slug_is_409(
        self, admin: httpx.AsyncClient, async_db_session: AsyncSession
    ) -> None:
        body = {"title": "Quarterly progress"}
        first = await admin.post(
            f"{API}/reports", json=body, headers={"Idempotency-Key": "r1"}
        )
        assert first.status_code == 201
        retry = await admin.post(
            f"{API}/reports", json=body, headers={"Idempotency-Key": "r1"}
        )
        assert retry.status_code == 200
        assert retry.headers["Idempotent-Replayed"] == "true"
        assert retry.json()["item"]["id"] == first.json()["item"]["id"]
        clash = await admin.post(f"{API}/reports", json=body)
        assert clash.status_code == 409 and clash.json()["error"] == "name_taken"
        assert [r.action for r in await _log(async_db_session, "reports")] == ["create"]

    @pytest.mark.parametrize(
        "body",
        [
            {"title": "   "},
            {"title": "***"},
            {"title": "T", "summary": "x" * 2001},
            {"title": "T", "source_repo": f"{OWNER}/x"},
            {"title": "T", "source_sha": "a" * 40},
        ],
    )
    async def test_invalid_reports_are_422(
        self, admin: httpx.AsyncClient, body: dict[str, Any]
    ) -> None:
        response = await admin.post(f"{API}/reports", json=body)
        assert response.status_code == 422, response.text

    async def test_the_narrative_cannot_be_cleared(
        self, admin: httpx.AsyncClient
    ) -> None:
        report = await _report(admin)
        for patch in ({"title": None}, {"body_md": None}, {"summary": None}, {}):
            response = await admin.patch(
                f"{API}/reports/{report['id']}", json=patch, headers={"If-Match": '"1"'}
            )
            assert response.status_code == 422, patch

    async def test_the_narrative_is_scanned_at_write_naming_the_field(
        self, admin: httpx.AsyncClient, async_db_session: AsyncSession
    ) -> None:
        await _set_scope(async_db_session, terms=[TERM])
        cases = [
            (
                {"title": "Review", "body_md": f"Work for {TERM}."},
                "body_md",
                "confidential_term",
            ),
            ({"title": "Review", "summary": "Ask ops@example.com"}, "summary", "email"),
            ({"title": "Review at 192.0.2.40"}, "title", "ip_address"),
            ({"title": "Billing 123456789012"}, "title", "account_id"),
            (
                {"title": "Review", "summary": "In my-bucket-123456789012-logs."},
                "summary",
                "account_id",
            ),
            (
                {"title": "Review", "body_md": "Account 1234-5678-9012."},
                "body_md",
                "account_id",
            ),
            (
                {"title": "Review", "body_md": "Work for northwind-mutual."},
                "body_md",
                "confidential_term",
            ),
            (
                {"title": "Review", "summary": "Only IPv6:2001:db8::5"},
                "summary",
                "ip_address",
            ),
            ({"title": "Host ip-192-0-2-40.ec2.internal"}, "title", "ip_address"),
            (
                {"title": "Review", "body_md": "Billed acct-1234-5678-9012."},
                "body_md",
                "account_id",
            ),
            (
                {"title": "Review", "summary": "In 1234-5678-9012-logs."},
                "summary",
                "account_id",
            ),
        ]
        for body, slot, kind in cases:
            response = await admin.post(f"{API}/reports", json=body)
            assert response.status_code == 422, response.text
            refused = response.json()
            assert refused["error"] == "report_rejected"
            assert {"slot": slot, "kind": kind} in refused["violations"]
            assert not _names_term(response.text)
            for value in (
                "ops@example.com",
                "192.0.2.40",
                "123456789012",
                "1234-5678-9012",
                "2001:db8::5",
                "ip-192-0-2-40",
            ):
                assert value not in response.text
        # A UUID in a body is allowed: block arguments are slugs, not ids. One
        # whose last group is twelve digits is a UUID, not an account id.
        await _report(admin, body_md="Ref aaaaaaaa-0000-4000-8000-000000000123.")
        # An edit is scanned too, as the whole version it writes.
        report = await _report(admin, title="Clean")
        refused = await admin.patch(
            f"{API}/reports/{report['id']}",
            json={"summary": f"About {TERM.upper()}"},
            headers={"If-Match": '"1"'},
        )
        assert refused.status_code == 422
        assert {"slot": "summary", "kind": "confidential_term"} in refused.json()[
            "violations"
        ]

    async def test_a_published_report_follows_the_pages_source_rules(
        self, admin: httpx.AsyncClient
    ) -> None:
        source = {
            "source_repo": f"{OWNER}/progress-notes",
            "source_path": "reports/platform/report.md",
            "source_sha": "c" * 40,
        }
        body = {
            "title": "Platform",
            "summary": "Progress.",
            "body_md": "# One",
            **source,
        }
        created = await admin.post(f"{API}/reports", json=body)
        assert created.status_code == 201, created.text
        report = created.json()["item"]
        url = f"{API}/reports/{report['id']}"
        # A lost answer converges on identical content; anything else does not.
        again = await admin.post(
            f"{API}/reports", json=body, headers={"Idempotency-Key": uuid4().hex}
        )
        assert again.status_code == 200 and again.json()["item"]["id"] == report["id"]
        other = await admin.post(
            f"{API}/reports",
            json={**body, "body_md": "# Two"},
            headers={"Idempotency-Key": uuid4().hex},
        )
        assert other.status_code == 409 and other.json()["error"] == "name_taken"
        mismatch = await admin.patch(
            url,
            json={
                "body_md": "# Two",
                "source_repo": f"{OWNER}/progress-notes",
                "source_path": "reports/other/report.md",
            },
            headers={"If-Match": '"1"'},
        )
        assert mismatch.status_code == 409
        assert mismatch.json()["error"] == "source_mismatch"
        # A new commit is content even when the body is unchanged.
        moved = await admin.patch(
            url,
            json={
                "source_repo": source["source_repo"],
                "source_path": source["source_path"],
                "source_sha": "d" * 40,
            },
            headers={"If-Match": '"1"'},
        )
        assert moved.status_code == 200 and moved.json()["item"]["version"] == 2
        # A hand edit no longer mirrors the commit.
        hand = await admin.patch(
            url, json={"body_md": "# Hand edit"}, headers={"If-Match": '"2"'}
        )
        assert hand.json()["item"]["source_sha"] is None

    async def test_delete_takes_the_versions_and_the_snapshots(
        self, admin: httpx.AsyncClient, async_db_session: AsyncSession
    ) -> None:
        report = await _report(admin)
        snap = await _snapshot(admin, report["id"], _doc())
        url = f"{API}/reports/{report['id']}"
        assert (await admin.delete(url, headers={"If-Match": '"1"'})).status_code == 204
        assert (await admin.get(url)).status_code == 404
        assert (await admin.get(f"{url}/versions")).status_code == 404
        assert (
            await admin.get(f"{API}/report-snapshots/{snap['id']}")
        ).status_code == 404
        rows = await _log(async_db_session, "reports")
        assert rows[-1].action == "delete" and rows[-1].before["body_md"]

    async def test_an_operator_reads_but_writes_only_once_editing_roles_allow_it(
        self, admin: httpx.AsyncClient, operator: httpx.AsyncClient
    ) -> None:
        report = await _report(admin)
        snap = await _snapshot(admin, report["id"], _doc())
        assert (await operator.get(f"{API}/reports/{report['id']}")).status_code == 200
        assert (
            await operator.get(f"{API}/reports/{report['id']}/view")
        ).status_code == 200
        assert (
            await operator.get(f"{API}/report-snapshots/{snap['id']}")
        ).status_code == 200
        assert (
            await operator.post(f"{API}/reports", json={"title": "Mine"})
        ).status_code == 403
        assert (await _post(operator, report["id"], _stop(3))).status_code == 403
        denied = await operator.patch(
            f"{API}/report-snapshots/{snap['id']}",
            json={"withdrawn": True, "withdrawn_reason": "Wrong numbers"},
            headers={"If-Match": '"1"'},
        )
        assert denied.status_code == 403
        await admin.put(
            f"{API}/settings", json={"editing_roles": ["admin", "operator"]}
        )
        assert (
            await operator.post(f"{API}/reports", json={"title": "Mine"})
        ).status_code == 201
        assert (await _post(operator, report["id"], _stop(3))).status_code == 201

    async def test_another_project_sees_nothing(
        self, admin: httpx.AsyncClient, other_project: httpx.AsyncClient
    ) -> None:
        report = await _report(admin)
        snap = await _snapshot(admin, report["id"], _doc())
        url = f"{API}/reports/{report['id']}"
        assert (await other_project.get(f"{API}/reports")).json()["items"] == []
        assert (await other_project.get(f"{API}/report-snapshots")).json()[
            "items"
        ] == []
        for response in (
            await other_project.get(url),
            await other_project.get(f"{url}/view"),
            await other_project.get(f"{url}/versions"),
            await other_project.get(f"{url}/versions/1"),
            await other_project.patch(
                url, json={"title": "x"}, headers={"If-Match": '"1"'}
            ),
            await other_project.post(
                f"{url}/versions/1/revert", headers={"If-Match": '"1"'}
            ),
            await other_project.delete(url, headers={"If-Match": '"1"'}),
            await other_project.get(f"{API}/report-snapshots/{snap['id']}"),
            await other_project.patch(
                f"{API}/report-snapshots/{snap['id']}",
                json={"withdrawn": True, "withdrawn_reason": "x"},
                headers={"If-Match": '"1"'},
            ),
        ):
            assert response.status_code == 404, response.text
        # Its report id names nothing in the other project.
        foreign = await _post(other_project, report["id"], _doc())
        assert (
            foreign.status_code == 422 and foreign.json()["error"] == "unknown_report"
        )


# ===========================================================================
# Snapshots — the contract
# ===========================================================================


class TestSnapshots:
    async def test_create_stores_the_document_verbatim_under_its_canonical_sha(
        self, admin: httpx.AsyncClient, async_db_session: AsyncSession
    ) -> None:
        version = await _set_scope(async_db_session, owners=[OWNER])
        report = await _report(admin)
        doc = _doc()
        response = await _post(admin, report["id"], doc)
        assert response.status_code == 201, response.text
        assert response.headers["ETag"] == '"1"'
        item = response.json()["item"]
        assert item["data"] is None  # a write's answer carries no document
        assert (item["seq"], item["version"], item["withdrawn"]) == (1, 1, False)
        assert (
            item["label"] == "Baseline review" and item["method_kind"] == "full_review"
        )
        assert item["content_sha256"] == _canonical_sha(doc)
        assert (item["allowlist_version"], item["scope_version"]) == (1, version)
        got = (await admin.get(f"{API}/report-snapshots/{item['id']}")).json()["item"]
        assert got["data"] == doc and got["withheld"] == []
        assert _canonical_sha(got["data"]) == item["content_sha256"]
        (row,) = await _log(async_db_session, "report_snapshots")
        assert row.action == "create" and "data" not in row.after

    async def test_withdraw_and_restore_ride_if_match_and_are_logged(
        self, admin: httpx.AsyncClient, async_db_session: AsyncSession
    ) -> None:
        report = await _report(admin)
        snap = await _snapshot(admin, report["id"], _doc())
        url = f"{API}/report-snapshots/{snap['id']}"
        withdraw = {"withdrawn": True, "withdrawn_reason": "The numbers were wrong."}
        assert (await admin.patch(url, json=withdraw)).status_code == 428
        done = await admin.patch(url, json=withdraw, headers={"If-Match": '"1"'})
        assert done.status_code == 200 and done.headers["ETag"] == '"2"'
        item = done.json()["item"]
        assert (
            item["withdrawn"]
            and item["withdrawn_reason"] == withdraw["withdrawn_reason"]
        )
        stale = await admin.patch(
            url, json={"withdrawn": False}, headers={"If-Match": '"1"'}
        )
        assert stale.status_code == 409 and stale.json()["current"]["withdrawn"] is True
        # The same withdrawal again changes nothing.
        same = await admin.patch(url, json=withdraw, headers={"If-Match": '"2"'})
        assert same.status_code == 200 and same.json()["item"]["version"] == 2
        restored = await admin.patch(
            url, json={"withdrawn": False}, headers={"If-Match": '"2"'}
        )
        assert restored.status_code == 200
        assert restored.json()["item"]["version"] == 3
        assert restored.json()["item"]["withdrawn_reason"] is None
        for bad in (
            {"withdrawn": True},
            {"withdrawn": True, "withdrawn_reason": "  "},
            {"withdrawn": False, "withdrawn_reason": "why"},
            {},
        ):
            refused = await admin.patch(url, json=bad, headers={"If-Match": '"3"'})
            assert refused.status_code == 422, bad
        rows = await _log(async_db_session, "report_snapshots")
        assert [r.action for r in rows] == ["create", "update", "update"]
        assert (
            rows[1].before["withdrawn"] is False and rows[1].after["withdrawn"] is True
        )
        assert "data" not in rows[1].after

    async def test_a_withdrawal_reason_is_scanned_naming_the_field(
        self, admin: httpx.AsyncClient, async_db_session: AsyncSession
    ) -> None:
        """The reason is served on every read and kept in the change log, so
        it gets the narrative's scans: refused naming the field, never the
        value, and nothing is written."""
        await _set_scope(async_db_session, terms=[TERM])
        report = await _report(admin)
        snap = await _snapshot(admin, report["id"], _doc())
        url = f"{API}/report-snapshots/{snap['id']}"
        for value, kind in (
            ("NORTHWIND-mutual", "confidential_term"),
            ("ops@example.com", "email"),
            ("192.0.2.7", "ip_address"),
            ("123456789012", "account_id"),
        ):
            refused = await admin.patch(
                url,
                json={"withdrawn": True, "withdrawn_reason": f"Wrong: {value}"},
                headers={"If-Match": '"1"'},
            )
            assert refused.status_code == 422, refused.text
            body = refused.json()
            assert body["error"] == "snapshot_rejected"
            assert body["violations"] == [{"slot": "withdrawn_reason", "kind": kind}]
            assert value not in refused.text and not _names_term(refused.text)
        got = (await admin.get(url)).json()["item"]
        assert (got["withdrawn"], got["version"]) == (False, 1)
        assert [r.action for r in await _log(async_db_session, "report_snapshots")] == [
            "create"
        ]
        # A UUID is allowed, as in a narrative.
        done = await admin.patch(
            url,
            json={
                "withdrawn": True,
                "withdrawn_reason": "See aaaaaaaa-0000-4000-8000-000000000123",
            },
            headers={"If-Match": '"1"'},
        )
        assert done.status_code == 200, done.text

    async def test_a_source_path_is_scanned_naming_the_field(
        self, admin: httpx.AsyncClient, async_db_session: AsyncSession
    ) -> None:
        """The file's path is served on every read, so it gets the narrative's
        scans: refused naming the field, never the value, nothing stored."""
        await _set_scope(async_db_session, terms=[TERM])
        report = await _report(admin)
        for path, value, kind in (
            (
                "reports/northwind-mutual/1.json",
                "northwind-mutual",
                "confidential_term",
            ),
            ("reports/ops@example.com/1.json", "ops@example.com", "email"),
            ("reports/192.0.2.7/1.json", "192.0.2.7", "ip_address"),
            ("reports/123456789012/1.json", "123456789012", "account_id"),
        ):
            refused = await _post(admin, report["id"], _doc(), source_path=path)
            assert {"slot": "source_path", "kind": kind} in _violations(refused)
            assert value not in refused.text and not _names_term(refused.text)
        listed = (
            await admin.get(
                f"{API}/report-snapshots", params={"report_id": report["id"]}
            )
        ).json()
        assert listed["items"] == []
        assert await _log(async_db_session, "report_snapshots") == []
        # A UUID is allowed, as in a narrative.
        await _snapshot(
            admin,
            report["id"],
            _doc(),
            source_path="snapshots/aaaaaaaa-0000-4000-8000-000000000123.json",
        )

    async def test_a_snapshot_is_never_deleted_or_edited(
        self, admin: httpx.AsyncClient
    ) -> None:
        report = await _report(admin)
        snap = await _snapshot(admin, report["id"], _doc())
        url = f"{API}/report-snapshots/{snap['id']}"
        assert (await admin.delete(url, headers={"If-Match": '"1"'})).status_code == 405
        edit = await admin.patch(
            url, json={"data": _doc(label="Edited")}, headers={"If-Match": '"1"'}
        )
        assert edit.status_code == 422  # the update takes withdrawn only
        got = (await admin.get(url)).json()["item"]
        assert got["data"]["label"] == "Baseline review"

    async def test_a_keyed_create_replays(
        self, admin: httpx.AsyncClient, async_db_session: AsyncSession
    ) -> None:
        report = await _report(admin)
        first = await _post(admin, report["id"], _doc(), key="s1")
        retry = await _post(admin, report["id"], _doc(), key="s1")
        assert first.status_code == 201
        assert (
            retry.status_code == 200 and retry.headers["Idempotent-Replayed"] == "true"
        )
        assert retry.json()["item"]["id"] == first.json()["item"]["id"]
        assert [r.action for r in await _log(async_db_session, "report_snapshots")] == [
            "create"
        ]

    async def test_a_list_carries_no_documents_and_filters_exactly(
        self, admin: httpx.AsyncClient
    ) -> None:
        one = await _report(admin, title="One")
        two = await _report(admin, title="Two")
        a = await _snapshot(admin, one["id"], _stop(1), source_path="snapshots/a.json")
        b = await _snapshot(admin, one["id"], _stop(2))
        await _snapshot(admin, two["id"], _stop(3))
        await admin.patch(
            f"{API}/report-snapshots/{b['id']}",
            json={"withdrawn": True, "withdrawn_reason": "Superseded."},
            headers={"If-Match": '"1"'},
        )

        async def ids(**params: Any) -> list[str]:
            listed = (await admin.get(f"{API}/report-snapshots", params=params)).json()
            assert all(item["data"] is None for item in listed["items"])
            return [item["id"] for item in listed["items"]]

        assert await ids(report_id=one["id"]) == [a["id"], b["id"]]
        assert await ids(report_id=one["id"], withdrawn="true") == [b["id"]]
        assert await ids(report_id=one["id"], withdrawn="false") == [a["id"]]
        assert await ids(source_path="snapshots/a.json") == [a["id"]]
        assert await ids(report_id="not-a-uuid") == []
        assert await ids(withdrawn="maybe") == []


# ===========================================================================
# Cardinality and time order
# ===========================================================================


class TestCardinality:
    async def test_a_report_with_no_stops_has_an_empty_series_not_an_error(
        self, admin: httpx.AsyncClient
    ) -> None:
        report = await _report(admin)
        view = await _view(admin, report["id"])
        assert view["report"]["id"] == report["id"]
        assert view["report"]["body_md"].startswith("# Progress")
        assert (view["snapshots"], view["withheld"]) == ([], [])
        assert (view["shown"], view["total"], view["truncated"]) == (0, 0, False)

    async def test_one_stop_has_no_changes_since_previous(
        self, admin: httpx.AsyncClient
    ) -> None:
        report = await _report(admin)
        await _snapshot(admin, report["id"], _doc())
        view = await _view(admin, report["id"])
        (stop,) = view["snapshots"]
        assert stop["changes_since_previous"] is None
        assert stop["data"]["label"] == "Baseline review"
        assert (view["shown"], view["total"], view["truncated"]) == (1, 1, False)

    async def test_48_stops_fit_and_49_are_truncated_with_a_before_page(
        self, admin: httpx.AsyncClient
    ) -> None:
        report = await _report(admin)
        seqs = [
            (await _snapshot(admin, report["id"], _stop(day)))["seq"]
            for day in range(48)
        ]
        view = await _view(admin, report["id"])
        assert (view["shown"], view["total"], view["truncated"]) == (48, 48, False)
        assert [s["seq"] for s in view["snapshots"]] == seqs
        assert view["snapshots"][0]["changes_since_previous"] is None

        newest = await _snapshot(admin, report["id"], _stop(48))
        view = await _view(admin, report["id"])
        assert (view["shown"], view["total"], view["truncated"]) == (48, 49, True)
        shown = [s["seq"] for s in view["snapshots"]]
        assert shown == [*seqs[1:], newest["seq"]]
        # The first stop shown still compares with the one the cap left out.
        assert view["snapshots"][0]["changes_since_previous"]["previous_seq"] == seqs[0]

        older = await _view(admin, report["id"], before=shown[0])
        assert [s["seq"] for s in older["snapshots"]] == [seqs[0]]
        assert (older["shown"], older["total"], older["truncated"]) == (1, 49, False)
        assert older["snapshots"][0]["changes_since_previous"] is None
        missing = await admin.get(
            f"{API}/reports/{report['id']}/view", params={"before": 999}
        )
        assert missing.status_code == 404

    async def test_a_stop_withheld_whole_just_before_the_page_edge_is_skipped(
        self, admin: httpx.AsyncClient, async_db_session: AsyncSession
    ) -> None:
        """The page's first stop compares with the nearest stop BEFORE the
        page that a reader is shown. When the one just before the 48-stop
        edge is withheld whole, the comparison skips past it, and only the
        older page, which holds it, lists it as withheld."""
        report = await _report(admin)
        stops = []
        for day in range(50):
            doc = _stop(day)
            if day == 1:
                # Its id names a term the project adds later: withheld whole.
                doc["items"][0]["id"] = "northwind-mutual-pilot"
            stops.append(await _snapshot(admin, report["id"], doc))
        await _set_scope(async_db_session, terms=[TERM])
        view = await _view(admin, report["id"])
        # The newest 48 are stops 2..49; stop 1 sits just before the edge.
        assert [s["seq"] for s in view["snapshots"]] == [s["seq"] for s in stops[2:]]
        assert (view["shown"], view["total"], view["truncated"]) == (48, 50, True)
        assert view["withheld"] == []
        first = view["snapshots"][0]["changes_since_previous"]
        assert first["previous_seq"] == stops[0]["seq"]
        older = await _view(admin, report["id"], before=stops[2]["seq"])
        assert [s["seq"] for s in older["snapshots"]] == [stops[0]["seq"]]
        assert older["withheld"] == [
            {
                "seq": stops[1]["seq"],
                "slot": "items[0].id",
                "reason": "confidential_term",
            }
        ]
        assert (older["shown"], older["total"], older["truncated"]) == (1, 50, False)

    async def test_a_stop_backfilled_with_an_earlier_as_of_takes_its_place(
        self, admin: httpx.AsyncClient
    ) -> None:
        def scored(day: int, value: float) -> dict[str, Any]:
            def set_value(doc: dict[str, Any]) -> None:
                doc["tables"][0]["rows"][0]["cells"]["leanness"]["value"] = value

            return _with(_stop(day), set_value)

        report = await _report(admin)
        first = await _snapshot(admin, report["id"], scored(10, 2))
        third = await _snapshot(admin, report["id"], scored(30, 4))
        view = await _view(admin, report["id"])
        assert [s["seq"] for s in view["snapshots"]] == [first["seq"], third["seq"]]

        second = await _snapshot(admin, report["id"], scored(20, 3))
        assert second["seq"] > third["seq"]  # created last, measured in between
        view = await _view(admin, report["id"])
        stops = view["snapshots"]
        assert [s["seq"] for s in stops] == [first["seq"], second["seq"], third["seq"]]

        def leanness(stop: dict[str, Any]) -> tuple[Any, Any, int]:
            changes = stop["changes_since_previous"]
            (cell,) = [
                c
                for c in changes["cells"]
                if (c["row_id"], c["column_id"]) == ("scheduler", "leanness")
            ]
            return cell["from"], cell["to"], changes["previous_seq"]

        assert leanness(stops[1]) == (2, 3, first["seq"])
        # Its neighbour now compares with the stop inserted before it.
        assert leanness(stops[2]) == (3, 4, second["seq"])


class _GoneAfterKeys:
    """The test session, except that right after the view reads its stops'
    keys the given snapshots are deleted — another request deleting their
    report between the view's reads."""

    def __init__(self, session: AsyncSession, gone: list[UUID]) -> None:
        self._session = session
        self._gone = gone
        self.fired = False

    def __getattr__(self, name: str) -> Any:
        return getattr(self._session, name)

    async def execute(self, statement: Any, *args: Any, **kwargs: Any) -> Any:
        from app.models.overview import ReportSnapshot

        result = await self._session.execute(statement, *args, **kwargs)
        columns = [c.name for c in getattr(statement, "selected_columns", [])]
        if self.fired or columns != ["id", "seq", "as_of"]:
            return result
        self.fired = True
        keys = result.all()
        await self._session.execute(
            delete(ReportSnapshot).where(ReportSnapshot.id.in_(self._gone))
        )
        return types.SimpleNamespace(all=lambda: keys)


class TestRowsGoneMidRead:
    async def test_a_stop_gone_between_the_views_reads_is_skipped(
        self, admin: httpx.AsyncClient, async_db_session: AsyncSession, api_user
    ) -> None:
        """The view reads its stops' keys, then loads the page and the stop
        before it. A row gone in between is skipped, never a server error."""
        report = await _report(admin)
        stops = [await _snapshot(admin, report["id"], _stop(day)) for day in range(49)]
        # Gone: the stop just before the page (the first stop's comparison)
        # and one on the page.
        gone = _GoneAfterKeys(
            async_db_session, [UUID(stops[0]["id"]), UUID(stops[10]["id"])]
        )
        async with _client(_app(gone, api_user, TENANT_A, ("admin",))) as client:
            view = await _view(client, report["id"])
        assert gone.fired
        assert [s["seq"] for s in view["snapshots"]] == [
            s["seq"] for index, s in enumerate(stops) if index not in (0, 10)
        ]
        assert view["snapshots"][0]["changes_since_previous"] is None
        assert (view["shown"], view["truncated"]) == (47, True)


class TestConcurrentCreates:
    """Two snapshot creates racing on one report, each on its OWN connection
    and committing for real — what the rolled-back single-session fixtures
    above cannot show."""

    TENANT = UUID("cccccccc-0000-4000-8000-0000000000f3")

    @pytest_asyncio.fixture()
    async def separate_connections(self, test_engine):
        from sqlalchemy.ext.asyncio import async_sessionmaker

        from app.api.deps import (
            current_active_user,
            current_active_user_optional,
            get_async_db,
        )
        from app.models.overview import ChangeLog, Report
        from app.overview.permissions import OverviewCaller, get_overview_caller
        from app.overview.router import router as authoring_router

        sessions = async_sessionmaker(test_engine, expire_on_commit=False)

        async def _clear() -> None:
            # Before as well as after: a run killed mid-test leaves committed
            # rows in a test database kept between runs. Snapshots and
            # versions go with their report.
            async with sessions() as session:
                await session.execute(
                    ChangeLog.__table__.delete().where(
                        ChangeLog.tenant_id == self.TENANT
                    )
                )
                await session.execute(
                    Report.__table__.delete().where(Report.tenant_id == self.TENANT)
                )
                await session.commit()

        await _clear()

        async def _fresh_session():
            async with sessions() as session:
                yield session

        app = FastAPI()
        app.dependency_overrides[current_active_user] = app.dependency_overrides[
            current_active_user_optional
        ] = lambda: types.SimpleNamespace(id=uuid4(), email="racer@example.com")
        app.dependency_overrides[get_async_db] = _fresh_session
        app.dependency_overrides[get_overview_caller] = lambda: OverviewCaller(
            tenant_id=self.TENANT, roles=("admin",)
        )
        app.include_router(authoring_router, prefix=API)
        try:
            async with _client(app) as client:
                yield client, sessions
        finally:
            await _clear()

    async def test_two_concurrent_creates_are_both_stored_with_distinct_seqs(
        self, separate_connections
    ) -> None:
        from app.models.overview import ReportSnapshot

        client, sessions = separate_connections
        report = await _report(client)
        responses = await asyncio.gather(
            _post(client, report["id"], _stop(1)),
            _post(client, report["id"], _stop(2)),
        )
        assert [r.status_code for r in responses] == [201, 201], [
            r.text for r in responses
        ]
        async with sessions() as session:
            seqs = (
                (
                    await session.execute(
                        select(ReportSnapshot.seq).where(
                            ReportSnapshot.report_id == UUID(report["id"])
                        )
                    )
                )
                .scalars()
                .all()
            )
        assert sorted(seqs) == [1, 2]
        assert sorted(r.json()["item"]["seq"] for r in responses) == [1, 2]


# ===========================================================================
# The allowlist — key set, strictness, cross-field rules
# ===========================================================================


class TestAllowlist:
    def test_key_set_is_exactly_the_contract(self) -> None:
        """The ``report-snapshot/v1`` key list, written out by hand: a key
        added to the contract without this list changing fails here."""
        from app.overview.report_snapshot_contract import REPORT_SNAPSHOT_PATHS

        assert REPORT_SNAPSHOT_PATHS == {
            "schema",
            "label",
            "as_of",
            "method",
            "method.kind",
            "method.label",
            "method.note",
            "summary",
            "groups",
            "groups[].id",
            "groups[].label",
            "groups[].help",
            "groups[].due",
            "tables",
            "tables[].id",
            "tables[].title",
            "tables[].caption",
            "tables[].row_header",
            "tables[].scale",
            "tables[].scale.min",
            "tables[].scale.max",
            "tables[].scale.target",
            "tables[].scale.better",
            "tables[].columns",
            "tables[].columns[].id",
            "tables[].columns[].label",
            "tables[].columns[].help",
            "tables[].rows",
            "tables[].rows[].id",
            "tables[].rows[].label",
            "tables[].rows[].help",
            "tables[].rows[].cells",
            "tables[].rows[].cells{}.value",
            "tables[].rows[].cells{}.unknown_reason",
            "tables[].summary_rows",
            "tables[].summary_rows[].id",
            "tables[].summary_rows[].label",
            "tables[].summary_rows[].cells",
            "tables[].summary_rows[].cells{}.value",
            "tables[].summary_rows[].cells{}.unknown_reason",
            "figures",
            "figures[].id",
            "figures[].label",
            "figures[].help",
            "figures[].unit",
            "figures[].value",
            "figures[].unknown_reason",
            "figures[].baseline",
            "figures[].target",
            "figures[].better",
            "figures[].verdict",
            "figures[].source",
            "figures[].measured_at",
            "items",
            "items[].id",
            "items[].group",
            "items[].label",
            "items[].help",
            "items[].status",
            "items[].status_note",
            "items[].events",
            "items[].events[].at",
            "items[].events[].label",
            "items[].links",
            "items[].links[].label",
            "items[].links[].url",
            "notes",
            "notes[].title",
            "notes[].body_md",
        }

    async def test_an_unlisted_key_is_refused_at_any_depth_without_echoing_it(
        self, admin: httpx.AsyncClient
    ) -> None:
        report = await _report(admin)
        leak = "operator-at-hostname"
        for mutate, slot in (
            (lambda d: d.update({leak: 1}), "<unlisted key>"),
            (lambda d: d["method"].update({leak: 1}), "method.<unlisted key>"),
            (
                lambda d: d["tables"][0]["rows"][0]["cells"]["leanness"].update(
                    {leak: 1}
                ),
                "tables[0].rows[0].cells[columns[0]].<unlisted key>",
            ),
        ):
            response = await _post(admin, report["id"], _with(_doc(), mutate))
            assert {"slot": slot, "kind": "unlisted_key"} in _violations(response)
            assert leak not in response.text

    async def test_a_body_that_omits_a_key_is_refused(
        self, admin: httpx.AsyncClient
    ) -> None:
        report = await _report(admin)
        for mutate, slot in (
            (lambda d: d.pop("notes"), "notes"),
            (lambda d: d["items"][0].pop("help"), "items[0].help"),
            (lambda d: d["figures"][0].pop("measured_at"), "figures[0].measured_at"),
        ):
            response = await _post(admin, report["id"], _with(_doc(), mutate))
            assert {"slot": slot, "kind": "missing"} in _violations(response)

    @pytest.mark.parametrize(
        ("mutate", "slot"),
        [
            (lambda d: d["figures"][0].update(value="9.5"), "figures[0].value"),
            (lambda d: d["figures"][0].update(value=True), "figures[0].value"),
            (lambda d: d["items"][0].update(status="Done"), "items[0].status"),
            (lambda d: d.update(as_of=1760356800), "as_of"),
            (lambda d: d.update(as_of="2026-10-13T12:00:00"), "as_of"),
            (
                lambda d: d["groups"][0].update(due="2026-11-30T00:00:00Z"),
                "groups[0].due",
            ),
            (lambda d: d["tables"][0]["scale"].update(min="1"), "tables[0].scale.min"),
        ],
    )
    async def test_a_body_that_relies_on_a_coercion_is_refused(
        self, admin: httpx.AsyncClient, mutate: Any, slot: str
    ) -> None:
        report = await _report(admin)
        response = await _post(admin, report["id"], _with(_doc(), mutate))
        assert slot in {v["slot"] for v in _violations(response)}

    async def test_the_stored_document_re_serializes_to_the_publishers_sha(
        self, admin: httpx.AsyncClient
    ) -> None:
        """Every key present and nothing coerced: the server's sha is the one
        the publisher computes from its file, and so is the stored copy's."""
        report = await _report(admin)
        doc = _doc()
        doc["figures"][0]["value"] = 0.1  # a float, kept as written
        doc["notes"][0]["body_md"] = "Ünïcode stays as written — no escapes."
        item = await _snapshot(admin, report["id"], doc)
        assert item["content_sha256"] == _canonical_sha(doc)
        got = (await admin.get(f"{API}/report-snapshots/{item['id']}")).json()["item"]
        assert _canonical_sha(got["data"]) == _canonical_sha(doc)

    async def test_a_number_the_database_would_respell_is_refused(
        self, admin: httpx.AsyncClient
    ) -> None:
        """jsonb stores ``1e+16`` as the integer it equals, so the stored copy
        would no longer hash to the publisher's sha: refused, nothing kept."""
        report = await _report(admin)
        doc = _with(_doc(), lambda d: d["figures"][0].update(value=1e16))
        response = await _post(admin, report["id"], doc)
        assert {"slot": "figures[0].value", "kind": "not_storable"} in _violations(
            response
        )
        listed = (
            await admin.get(
                f"{API}/report-snapshots", params={"report_id": report["id"]}
            )
        ).json()
        assert listed["items"] == []

    async def test_a_cell_the_database_would_respell_is_named_by_its_column(
        self, admin: httpx.AsyncClient
    ) -> None:
        """The not_storable slot names a cell by its column's position, as
        every other slot does — never by the key the writer chose."""
        report = await _report(admin)

        def respelled_cell(d: dict[str, Any]) -> None:
            d["tables"][0]["scale"]["max"] = 10**17  # an integer: stored as sent
            _cell(d).update(value=1e16)

        response = await _post(admin, report["id"], _with(_doc(), respelled_cell))
        assert {
            "slot": "tables[0].rows[0].cells[columns[0]].value",
            "kind": "not_storable",
        } in _violations(response)
        assert "leanness" not in response.text

    async def test_an_oversized_document_is_refused(
        self, admin: httpx.AsyncClient
    ) -> None:
        report = await _report(admin)
        doc = _doc()
        doc["notes"] = [
            {"title": f"Note {n}", "body_md": "x" * 4000} for n in range(10)
        ]
        doc["items"] = [
            {
                **copy.deepcopy(DOC["items"][0]),
                "id": f"item-{n}",
                "help": "y" * 400,
                "label": "z" * 160,
                "status_note": "w" * 300,
            }
            for n in range(300)
        ]
        response = await _post(admin, report["id"], doc)
        assert {"slot": "<root>", "kind": "too_large"} in _violations(response)


def _cell(doc: dict[str, Any], column: str = "leanness") -> dict[str, Any]:
    cell: dict[str, Any] = doc["tables"][0]["rows"][0]["cells"][column]
    return cell


def _undeclared_column(d: dict[str, Any]) -> None:
    d["tables"][0]["rows"][0]["cells"]["agility"] = {"value": 1, "unknown_reason": None}


def _missing_cell(d: dict[str, Any]) -> None:
    del d["tables"][0]["rows"][0]["cells"]["operability"]


def _duplicate_row(d: dict[str, Any]) -> None:
    d["tables"][0]["summary_rows"][0]["id"] = "scheduler"


def _duplicate_item(d: dict[str, Any]) -> None:
    d["items"].append(copy.deepcopy(d["items"][0]))


#: (name, how to break the document, the violation, how to make it valid again)
CROSS_FIELD: list[tuple[str, Any, tuple[str, str], Any]] = [
    (
        "undeclared_column",
        _undeclared_column,
        ("tables[0].rows[0].cells[<undeclared>]", "undeclared_column"),
        lambda d: None,
    ),
    (
        "missing_cell",
        _missing_cell,
        ("tables[0].rows[0].cells[columns[1]]", "missing_cell"),
        lambda d: None,
    ),
    (
        "duplicate_row_id",
        _duplicate_row,
        ("tables[0].summary_rows[0].id", "duplicate_id"),
        lambda d: d["tables"][0]["summary_rows"][0].update(id="average"),
    ),
    (
        "duplicate_item_id",
        _duplicate_item,
        ("items[1].id", "duplicate_id"),
        lambda d: d["items"][1].update(id="second-item"),
    ),
    (
        "value_above_scale",
        lambda d: _cell(d).update(value=5.5),
        ("tables[0].rows[0].cells[columns[0]].value", "out_of_scale"),
        lambda d: _cell(d).update(value=5),
    ),
    (
        "value_below_scale",
        lambda d: _cell(d).update(value=0.5),
        ("tables[0].rows[0].cells[columns[0]].value", "out_of_scale"),
        lambda d: _cell(d).update(value=1),
    ),
    (
        "scale_inverted",
        lambda d: d["tables"][0]["scale"].update(min=5, max=1),
        ("tables[0].scale", "scale_inverted"),
        lambda d: d["tables"][0]["scale"].update(min=1, max=5),
    ),
    (
        "target_outside_scale",
        lambda d: d["tables"][0]["scale"].update(target=6),
        ("tables[0].scale.target", "target_out_of_scale"),
        lambda d: d["tables"][0]["scale"].update(target=None),
    ),
    (
        "null_value_without_reason",
        lambda d: _cell(d).update(value=None, unknown_reason=None),
        (
            "tables[0].rows[0].cells[columns[0]].unknown_reason",
            "unknown_reason_required",
        ),
        lambda d: _cell(d).update(unknown_reason="Not measured yet."),
    ),
    (
        "null_figure_without_reason",
        lambda d: d["figures"][0].update(value=None, verdict="unknown"),
        ("figures[0].unknown_reason", "unknown_reason_required"),
        lambda d: d["figures"][0].update(unknown_reason="No data this month."),
    ),
    (
        "value_with_reason",
        lambda d: _cell(d).update(unknown_reason="Contradicts the value."),
        (
            "tables[0].rows[0].cells[columns[0]].unknown_reason",
            "unknown_reason_forbidden",
        ),
        lambda d: _cell(d).update(unknown_reason=None),
    ),
    (
        "verdict_without_value",
        lambda d: d["figures"][0].update(
            value=None, unknown_reason="Not measured.", verdict="met"
        ),
        ("figures[0].verdict", "verdict_needs_value"),
        lambda d: d["figures"][0].update(verdict="unknown"),
    ),
    (
        "undeclared_group",
        lambda d: d["items"][0].update(group="roadmap"),
        ("items[0].group", "undeclared_group"),
        lambda d: d["items"][0].update(group=None),
    ),
]


class TestCrossFieldRules:
    @pytest.mark.parametrize(
        ("break_it", "violation", "fix_it"),
        [case[1:] for case in CROSS_FIELD],
        ids=[case[0] for case in CROSS_FIELD],
    )
    async def test_each_rule_is_refused_and_its_fix_accepted(
        self,
        admin: httpx.AsyncClient,
        break_it: Any,
        violation: tuple[str, str],
        fix_it: Any,
    ) -> None:
        report = await _report(admin)
        broken = _with(_doc(), break_it)
        slot, kind = violation
        assert {"slot": slot, "kind": kind} in _violations(
            await _post(admin, report["id"], broken)
        )
        fixed = _with(broken, fix_it)
        if kind in ("undeclared_column", "missing_cell"):
            fixed = _doc()  # the valid document IS the fix
        accepted = await _post(admin, report["id"], fixed)
        assert accepted.status_code == 201, accepted.text


# ===========================================================================
# The string scanners and the link rule
# ===========================================================================

#: (kind, the planted string, the slot it is planted in) — every scanner, and
#: each of its spellings. Mutation-checked by hand (see the session notes):
#: disabling the scanner turns its cases red.
PLANTS: list[tuple[str, str, str]] = [
    ("uuid", "Ref aaaaaaaa-0000-4000-8000-000000000042 here", "items[0].label"),
    ("uuid", "Ref aaaaaaaa000040008000000000000042", "notes[0].body_md"),
    ("email", "Ask ops@example.com", "items[0].label"),
    ("email", "ping release-bot@buildhost", "tables[0].caption"),
    ("ip_address", "Reached 192.0.2.40 at noon", "items[0].label"),
    ("ip_address", "Bound to 2001:db8::42 only", "notes[0].body_md"),
    # Behind a label: the colon before the address is no guard.
    ("ip_address", "IPv6:2001:db8::5", "method.note"),
    ("ip_address", "IP:2001:db8::1", "tables[0].columns[0].help"),
    # The IPv4 address an EC2 host name carries.
    ("ip_address", "ip-192-0-2-40.ec2.internal", "groups[0].label"),
    ("account_id", "Billed to 123456789012", "items[0].label"),
    ("account_id", "Billed to 1234-5678-9012", "figures[0].source"),
    # Between dashes, as bucket names carry them.
    ("account_id", "cdk-hnb659fds-assets-123456789012-us-east-1", "groups[0].help"),
    ("account_id", "my-bucket-123456789012-logs", "tables[0].title"),
    ("account_id", "acct-1234-5678-9012", "items[0].status_note"),
    ("account_id", "1234-5678-9012-logs", "notes[0].title"),
    ("confidential_term", f"Migration for {TERM}", "items[0].label"),
    ("confidential_term", "Migration for NORTHWIND-mutual", "notes[0].title"),
    ("confidential_term", "Migration for Nörthwind  Mutual", "summary"),
    ("confidential_term", "northwind_mutual pilot", "figures[0].help"),
    ("hidden_character", "Split\u200bthe scheduler", "items[0].label"),
]


def _plant(doc: dict[str, Any], slot: str, text: str) -> None:
    target: Any = doc
    parts = slot.replace("]", "").replace("[", ".").split(".")
    for part in parts[:-1]:
        target = target[int(part)] if part.isdigit() else target[part]
    target[parts[-1]] = text


#: Ordinary text no scanner may refuse — in a snapshot string, or where the
#: narrative's scans read: times, durations and versions; Rust paths, whose
#: ``::`` joins no IPv6 address; words around ``ip-`` that name no EC2 host;
#: and digits in fours that are no account id.
ORDINARY_TEXT: list[str] = [
    "CI/CD for the 12:30:45 build, std::vector, MAC 00:1a:2b:3c:4d:5e",
    "Version 1.2.3, 2026-10-13, 12345678901 and 1234567890123",
    "North wind and a mutual friend",
    "Measured at 2026-10-13T01:20:00Z, as of 2026-10-13T12:00:00+00:00",
    "Read at 2026-10-13T12:00:00.123456-05:00 and 2026-10-13T12:00:00.123+05:30",
    "Lead time 85.8 h, standup at 10:30, build at 12:30:45",
    "Released v1.2.3, then v1.2.3-rc.1 and 1.2.3+build.5",
    # Sixteen digits in fours: no twelve-digit form fits inside it.
    "Order 1234-5678-9012-3456",
    "crate::abc::def",
    "self::db::add",
    "Foo::A::B",
    "use crate::db::fee;",
    "ip-address",
    "zip-1-2-3-4-5",
    "ip-300-1-1-1",
]


class TestScanners:
    @pytest.mark.parametrize(
        ("kind", "text", "slot"), PLANTS, ids=[f"{k}-{s}" for k, _t, s in PLANTS]
    )
    async def test_each_scanner_refuses_its_plant_naming_the_slot_never_the_value(
        self,
        admin: httpx.AsyncClient,
        async_db_session: AsyncSession,
        kind: str,
        text: str,
        slot: str,
    ) -> None:
        await _set_scope(async_db_session, terms=[TERM])
        report = await _report(admin)
        doc = _doc()
        _plant(doc, slot, text)
        response = await _post(admin, report["id"], doc)
        assert {"slot": slot, "kind": kind} in _violations(response)
        assert text not in response.text
        listed = (
            await admin.get(
                f"{API}/report-snapshots", params={"report_id": report["id"]}
            )
        ).json()
        assert listed["items"] == []

    async def test_a_cell_is_named_by_its_column_position(
        self, admin: httpx.AsyncClient
    ) -> None:
        report = await _report(admin)
        doc = _with(
            _doc(),
            lambda d: _cell(d, "operability").update(
                unknown_reason="Ask ops@example.com"
            ),
        )
        assert {
            "slot": "tables[0].rows[0].cells[columns[1]].unknown_reason",
            "kind": "email",
        } in _violations(await _post(admin, report["id"], doc))

    @pytest.mark.parametrize("text", ORDINARY_TEXT)
    async def test_ordinary_text_passes(
        self, admin: httpx.AsyncClient, async_db_session: AsyncSession, text: str
    ) -> None:
        await _set_scope(async_db_session, terms=[TERM])
        report = await _report(admin)
        doc = _doc()
        doc["notes"][0]["body_md"] = text
        await _snapshot(admin, report["id"], doc)

    @pytest.mark.parametrize(
        "text", [*ORDINARY_TEXT, "Ref aaaaaaaa-1234-5678-9012-bbbbbbbbbbbb"]
    )
    async def test_ordinary_text_passes_where_the_narrative_scans_read(
        self, admin: httpx.AsyncClient, async_db_session: AsyncSession, text: str
    ) -> None:
        """The narrative's scans read a report's title, summary and body (and
        the slug its title gives), a snapshot's file path and a withdrawal's
        reason; none of them refuses ordinary text either. A UUID is allowed
        there, so a dashed account id lying inside one (middle groups all
        digits, first group ending in a letter) is allowed with it."""
        await _set_scope(async_db_session, terms=[TERM])
        report = await _report(admin, title=text, summary=text, body_md=text)
        snap = await _snapshot(admin, report["id"], _doc(), source_path=text)
        withdrawn = await admin.patch(
            f"{API}/report-snapshots/{snap['id']}",
            json={"withdrawn": True, "withdrawn_reason": text},
            headers={"If-Match": '"1"'},
        )
        assert withdrawn.status_code == 200, withdrawn.text

    @pytest.mark.parametrize(
        "moment",
        [
            "2026-10-13T01:20:00Z",
            "2026-10-13T12:00:00+00:00",
            "2026-10-13T12:00:00.123+05:30",
            "2026-10-13T12:00:00.123456-05:00",
            "2026-10-13T12:00:00.123456789-05:00",
        ],
    )
    async def test_timestamps_in_their_own_slots_pass(
        self, admin: httpx.AsyncClient, moment: str
    ) -> None:
        """``as_of`` and ``measured_at`` are strings too, and every string is
        scanned: no ISO 8601 spelling of a moment reads as an address or an
        account id."""
        report = await _report(admin)
        doc = _with(
            _doc(as_of=moment),
            lambda d: d["figures"][0].update(measured_at=moment),
        )
        await _snapshot(admin, report["id"], doc)


class TestLinkRule:
    async def test_first_party_github_links_and_overview_paths_are_accepted(
        self, admin: httpx.AsyncClient, async_db_session: AsyncSession
    ) -> None:
        await _set_scope(async_db_session, owners=[OWNER])
        report = await _report(admin)
        links = [
            {"label": "The pull request", "url": PR_LINK},
            {"label": "The commit", "url": COMMIT_LINK},
            {"label": "The plan", "url": "/overview/documents/split-plan"},
            {"label": "This report", "url": "/overview/reports/progress?at.progress=2"},
        ]
        doc = _with(_doc(), lambda d: d["items"][0].update(links=links))
        item = await _snapshot(admin, report["id"], doc)
        got = (await admin.get(f"{API}/report-snapshots/{item['id']}")).json()["item"]
        assert got["data"]["items"][0]["links"] == links and got["withheld"] == []

    async def test_a_foreign_owner_is_refused(
        self, admin: httpx.AsyncClient, async_db_session: AsyncSession
    ) -> None:
        await _set_scope(async_db_session, owners=[OWNER])
        report = await _report(admin)
        url = "https://github.com/another-org/widgets/pull/7"
        doc = _with(
            _doc(), lambda d: d["items"][0].update(links=[{"label": "PR", "url": url}])
        )
        response = await _post(admin, report["id"], doc)
        assert {
            "slot": "items[0].links[0].url",
            "kind": "link_owner_not_first_party",
        } in _violations(response)
        assert "another-org" not in response.text

    @pytest.mark.parametrize(
        "url",
        [
            f"https://github.com/{OWNER}/widgets/issues/7",
            f"http://github.com/{OWNER}/widgets/pull/7",
            f"https://github.com/{OWNER}/widgets/pull/7/files",
            "https://example.com/overview/x",
            "javascript:alert(1)",
            "//evil.example/overview/",
            "/admin/coord/alerts",
            "/overview/../admin/coord",
        ],
    )
    async def test_every_other_link_form_is_refused(
        self, admin: httpx.AsyncClient, async_db_session: AsyncSession, url: str
    ) -> None:
        await _set_scope(async_db_session, owners=[OWNER])
        report = await _report(admin)
        doc = _with(
            _doc(),
            lambda d: d["items"][0].update(links=[{"label": "Link", "url": url}]),
        )
        assert {"slot": "items[0].links[0].url", "kind": "link_not_allowed"} in (
            _violations(await _post(admin, report["id"], doc))
        )

    async def test_the_registered_repositories_owners_apply_when_none_are_configured(
        self, admin: httpx.AsyncClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from app.overview import reports
        from app.services.presentation_scope import OwnersRead

        async def identity(request: Any) -> Any:
            return types.SimpleNamespace(home_tenant_id=TENANT_A)

        async def registered(identity: Any, tenant_id: UUID) -> OwnersRead:
            assert tenant_id == TENANT_A
            return OwnersRead(owners=(OWNER,), unknown_reason=None)

        monkeypatch.setattr(reports, "get_coord_identity", identity)
        monkeypatch.setattr(reports, "read_registered_repo_owners", registered)
        report = await _report(admin)
        ok = _with(
            _doc(),
            lambda d: d["items"][0].update(links=[{"label": "PR", "url": PR_LINK}]),
        )
        await _snapshot(admin, report["id"], ok)
        foreign = _with(
            _doc(),
            lambda d: d["items"][0].update(
                links=[
                    {"label": "PR", "url": "https://github.com/another-org/x/pull/1"}
                ]
            ),
        )
        assert {
            "slot": "items[0].links[0].url",
            "kind": "link_owner_not_first_party",
        } in (_violations(await _post(admin, report["id"], foreign)))

    async def test_a_write_while_the_scope_reads_unknown_is_503_and_writes_nothing(
        self, admin: httpx.AsyncClient, async_db_session: AsyncSession
    ) -> None:
        """No owners configured, and coord cannot be asked (no identity here):
        the link rule cannot be evaluated, so the write is refused whole."""
        report = await _report(admin)
        doc = _with(
            _doc(),
            lambda d: d["items"][0].update(links=[{"label": "PR", "url": PR_LINK}]),
        )
        response = await _post(admin, report["id"], doc, source_path="snapshots/1.json")
        assert response.status_code == 503, response.text
        assert response.json()["error"] == "presentation_scope_unknown"
        listed = (
            await admin.get(
                f"{API}/report-snapshots", params={"report_id": report["id"]}
            )
        ).json()
        assert listed["items"] == []
        assert await _log(async_db_session, "report_snapshots") == []
        # A document with no GitHub link needs no owners, so it is checkable.
        await _snapshot(admin, report["id"], _doc())

    async def test_links_are_checked_again_on_every_read(
        self, admin: httpx.AsyncClient, async_db_session: AsyncSession
    ) -> None:
        await _set_scope(async_db_session, owners=[OWNER])
        report = await _report(admin)
        links = [
            {"label": "PR", "url": PR_LINK},
            {"label": "Plan", "url": "/overview/documents/plan"},
        ]
        doc = _with(_doc(), lambda d: d["items"][0].update(links=links))
        item = await _snapshot(admin, report["id"], doc)
        url = f"{API}/report-snapshots/{item['id']}"
        # The owner leaves the scope: its link is withheld at once.
        await _set_scope(async_db_session, owners=["another-org"])
        got = (await admin.get(url)).json()["item"]
        assert got["data"]["items"][0]["links"] == [links[1]]
        assert got["withheld"] == [
            {"slot": "items[0].links[0].url", "reason": "link_owner_not_first_party"}
        ]
        view = await _view(admin, report["id"])
        assert view["snapshots"][0]["data"]["items"][0]["links"] == [links[1]]
        # No owners configured and none readable: every link is withheld.
        await _set_scope(async_db_session, owners=None)
        got = (await admin.get(url)).json()["item"]
        assert got["data"]["items"][0]["links"] == []
        assert {w["reason"] for w in got["withheld"]} == {"presentation_scope_unknown"}
        view = await _view(admin, report["id"])
        assert view["snapshots"][0]["data"]["items"][0]["links"] == []
        assert {(w["seq"], w["reason"]) for w in view["withheld"]} == {
            (item["seq"], "presentation_scope_unknown")
        }


# ===========================================================================
# Reading a stored snapshot again
# ===========================================================================


class TestReadTimeChecks:
    async def test_a_snapshot_under_an_older_allowlist_version_is_checked_again(
        self, admin: httpx.AsyncClient, async_db_session: AsyncSession
    ) -> None:
        from app.models.overview import ReportSnapshot

        report = await _report(admin)
        passing = await _snapshot(admin, report["id"], _stop(1))
        failing = await _snapshot(admin, report["id"], _stop(2))
        # As stored by an older contract that let a UUID through.
        leaked = _with(
            _stop(2),
            lambda d: d["items"][0].update(
                label="Ref aaaaaaaa-0000-4000-8000-0000000000aa"
            ),
        )
        await async_db_session.execute(
            update(ReportSnapshot)
            .where(ReportSnapshot.id == UUID(failing["id"]))
            .values(allowlist_version=0, data=leaked)
        )
        await async_db_session.execute(
            update(ReportSnapshot)
            .where(ReportSnapshot.id == UUID(passing["id"]))
            .values(allowlist_version=0)
        )
        await async_db_session.commit()
        view = await _view(admin, report["id"])
        # The one that still passes is served; the other is withheld WHOLE.
        assert [s["seq"] for s in view["snapshots"]] == [passing["seq"]]
        assert view["withheld"] == [
            {"seq": failing["seq"], "slot": "items[0].label", "reason": "uuid"}
        ]
        assert (view["shown"], view["total"]) == (1, 2)
        got = (await admin.get(f"{API}/report-snapshots/{failing['id']}")).json()[
            "item"
        ]
        assert got["data"] is None
        assert got["withheld"] == [{"slot": "items[0].label", "reason": "uuid"}]
        assert "aaaaaaaa-0000-4000-8000-0000000000aa" not in json.dumps(view)

    async def test_a_term_added_after_the_write_is_withheld_at_read(
        self, admin: httpx.AsyncClient, async_db_session: AsyncSession
    ) -> None:
        await _set_scope(async_db_session, terms=[])
        report = await _report(admin)
        doc = _with(
            _doc(label=f"{TERM} checkpoint"),
            lambda d: d["items"][0].update(status_note=f"Waiting on {TERM}"),
        )
        item = await _snapshot(admin, report["id"], doc)
        version = await _set_scope(async_db_session, terms=[TERM])
        assert version > item["scope_version"]
        view = await _view(admin, report["id"])
        (stop,) = view["snapshots"]
        assert stop["label"] == "[withheld]"
        assert stop["data"]["items"][0]["status_note"] == "[withheld]"
        assert stop["data"]["items"][0]["label"] == "Split the scheduler"
        assert {(w["slot"], w["reason"]) for w in view["withheld"]} == {
            ("label", "confidential_term"),
            ("items[0].status_note", "confidential_term"),
        }
        assert TERM not in json.dumps(view)
        got = (await admin.get(f"{API}/report-snapshots/{item['id']}")).json()["item"]
        assert got["label"] == "[withheld]" and TERM not in json.dumps(got)
        listed = (await admin.get(f"{API}/report-snapshots")).json()["items"]
        assert [i["label"] for i in listed] == ["[withheld]"]

    async def test_an_allowlist_change_alone_scans_for_the_terms_again(
        self, admin: httpx.AsyncClient, async_db_session: AsyncSession
    ) -> None:
        """D4: strings are scanned again at read "when the allowlist version
        or the tenant's confidential terms changed" — either one. A snapshot
        stored under an older allowlist, checked against the scope version
        that is still current, has its strings checked for the terms too."""
        from app.models.overview import ReportSnapshot

        version = await _set_scope(async_db_session, terms=[TERM])
        report = await _report(admin)
        item = await _snapshot(admin, report["id"], _stop(1))
        assert item["scope_version"] == version

        def leak(d: dict[str, Any]) -> None:
            d["label"] = f"{TERM} checkpoint"
            d["items"][0]["status_note"] = f"Waiting on {TERM}"

        # As stored by an older contract whose term scan missed both.
        leaked = _with(_stop(1), leak)
        await async_db_session.execute(
            update(ReportSnapshot)
            .where(ReportSnapshot.id == UUID(item["id"]))
            .values(allowlist_version=0, data=leaked, label=leaked["label"])
        )
        await async_db_session.commit()
        expected = {
            ("label", "confidential_term"),
            ("items[0].status_note", "confidential_term"),
        }
        view = await _view(admin, report["id"])
        (stop,) = view["snapshots"]
        assert stop["label"] == "[withheld]"
        assert stop["data"]["items"][0]["status_note"] == "[withheld]"
        assert {(w["slot"], w["reason"]) for w in view["withheld"]} == expected
        got = (await admin.get(f"{API}/report-snapshots/{item['id']}")).json()["item"]
        assert got["label"] == "[withheld]"
        assert {(w["slot"], w["reason"]) for w in got["withheld"]} == expected
        listed = (
            await admin.get(
                f"{API}/report-snapshots", params={"report_id": report["id"]}
            )
        ).json()
        assert [(i["label"], i["withheld"]) for i in listed["items"]] == [
            ("[withheld]", [{"slot": "label", "reason": "confidential_term"}])
        ]
        for served in (view, got, listed):
            assert TERM not in json.dumps(served)

    async def test_a_term_added_after_the_write_withholds_a_path_and_a_reason(
        self, admin: httpx.AsyncClient, async_db_session: AsyncSession
    ) -> None:
        """A snapshot's file path and withdrawal reason are served under the
        CURRENT terms in every read — a single read, the list, the view and a
        write's answer — while the stored path stays the snapshot's identity:
        the filter matches it."""
        from app.models.overview import ReportSnapshot

        await _set_scope(async_db_session, terms=[])
        report = await _report(admin)
        path = "snapshots/northwind-mutual-checkpoint.json"
        named = await _snapshot(admin, report["id"], _stop(1), source_path=path)
        reasoned = await _snapshot(
            admin, report["id"], _stop(2), source_path="snapshots/second.json"
        )
        gone_url = f"{API}/report-snapshots/{reasoned['id']}"
        reason = f"Superseded: {TERM} sent new numbers."
        withdrawn = await admin.patch(
            gone_url,
            json={"withdrawn": True, "withdrawn_reason": reason},
            headers={"If-Match": '"1"'},
        )
        assert withdrawn.status_code == 200, withdrawn.text
        plain = await _snapshot(
            admin, report["id"], _stop(3), source_path="snapshots/third.json"
        )
        await _set_scope(async_db_session, terms=[TERM])
        path_hidden = {"slot": "source_path", "reason": "confidential_term"}
        reason_hidden = {"slot": "withdrawn_reason", "reason": "confidential_term"}

        got = (await admin.get(f"{API}/report-snapshots/{named['id']}")).json()["item"]
        assert got["source_path"] == "[withheld]" and path_hidden in got["withheld"]
        gone = (await admin.get(gone_url)).json()["item"]
        assert gone["withdrawn_reason"] == "[withheld]"
        assert reason_hidden in gone["withheld"]
        assert gone["source_path"] == "snapshots/second.json"
        listing = (
            await admin.get(
                f"{API}/report-snapshots", params={"report_id": report["id"]}
            )
        ).json()
        listed = {item["id"]: item for item in listing["items"]}
        assert listed[named["id"]]["source_path"] == "[withheld]"
        assert listed[reasoned["id"]]["withdrawn_reason"] == "[withheld]"
        filtered = (
            await admin.get(f"{API}/report-snapshots", params={"source_path": path})
        ).json()
        assert [item["id"] for item in filtered["items"]] == [named["id"]]
        view = await _view(admin, report["id"])
        stops = {stop["id"]: stop for stop in view["snapshots"]}
        assert stops[named["id"]]["source_path"] == "[withheld]"
        assert {
            "seq": named["seq"],
            "slot": "source_path",
            "reason": "confidential_term",
        } in view["withheld"]
        answer = await admin.patch(
            f"{API}/report-snapshots/{named['id']}",
            json={"withdrawn": True, "withdrawn_reason": "Replaced."},
            headers={"If-Match": '"1"'},
        )
        assert answer.status_code == 200, answer.text
        assert answer.json()["item"]["source_path"] == "[withheld]"
        # No match: served byte for byte.
        clean = (await admin.get(f"{API}/report-snapshots/{plain['id']}")).json()[
            "item"
        ]
        assert (clean["source_path"], clean["withheld"]) == ("snapshots/third.json", [])
        for served in (got, gone, listing, filtered, view, answer.json()):
            assert not _names_term(served)
        stored = dict(
            (
                await async_db_session.execute(
                    select(ReportSnapshot.id, ReportSnapshot.withdrawn_reason).where(
                        ReportSnapshot.id == UUID(reasoned["id"])
                    )
                )
            ).all()
        )
        assert stored == {UUID(reasoned["id"]): reason}

    async def test_a_new_term_matching_structure_withholds_the_whole_stop(
        self, admin: httpx.AsyncClient, async_db_session: AsyncSession
    ) -> None:
        """An id cannot be replaced by a marker — changes and cells are keyed
        by it — so a stop whose id names a new term is withheld whole."""
        report = await _report(admin)
        doc = _with(_doc(), lambda d: d["items"][0].update(id="northwind-mutual-pilot"))
        item = await _snapshot(admin, report["id"], doc)
        await _set_scope(async_db_session, terms=[TERM])
        view = await _view(admin, report["id"])
        assert view["snapshots"] == []
        assert view["withheld"] == [
            {"seq": item["seq"], "slot": "items[0].id", "reason": "confidential_term"}
        ]


class TestNarrativeAtRead:
    async def test_a_term_added_after_the_write_withholds_the_field_in_every_read(
        self, admin: httpx.AsyncClient, async_db_session: AsyncSession
    ) -> None:
        """Departure extending D4 (the plan author's decision): a report's
        title, summary and body are served under the CURRENT confidential
        terms. A field naming a term added after the write reads [withheld]
        — the whole field — and withheld names it, never the value. The
        stored row is unchanged, and a field with no match is served byte
        for byte."""
        from app.models.overview import Report

        await _set_scope(async_db_session, terms=[])
        body = f"# Progress\n\nThe migration for {TERM} is on track."
        report = await _report(admin, body_md=body)
        titled = await _report(
            admin, title=f"{TERM} rollout", slug="rollout", summary=f"For {TERM}."
        )
        clean = {
            "title": "Clean report",
            "summary": "Nothing to hide.",
            "body_md": "# Fine\n\nAll clear.",
        }
        tidy = await _report(admin, **clean)
        await _set_scope(async_db_session, terms=[TERM])
        hidden_body = [{"slot": "body_md", "reason": "confidential_term"}]
        url = f"{API}/reports/{report['id']}"

        got = (await admin.get(url)).json()["item"]
        assert (got["body_md"], got["withheld"]) == ("[withheld]", hidden_body)
        assert (got["title"], got["summary"]) == (report["title"], report["summary"])
        view = await _view(admin, report["id"])
        assert (view["report"]["body_md"], view["report"]["withheld"]) == (
            "[withheld]",
            hidden_body,
        )
        v1 = (await admin.get(f"{url}/versions/1")).json()
        assert (v1["body_md"], v1["withheld"]) == ("[withheld]", hidden_body)
        assert v1["summary"] == report["summary"]
        # A stale write's server copy and a no-op write's answer serve it too.
        stale = await admin.patch(
            url, json={"title": "Other"}, headers={"If-Match": '"9"'}
        )
        assert stale.status_code == 409
        assert stale.json()["current"]["body_md"] == "[withheld]"
        same = await admin.patch(
            url, json={"title": report["title"]}, headers={"If-Match": '"1"'}
        )
        assert same.status_code == 200
        assert same.json()["item"]["body_md"] == "[withheld]"

        listing = (await admin.get(f"{API}/reports")).json()
        listed = {item["id"]: item for item in listing["items"]}
        assert (listed[titled["id"]]["title"], listed[titled["id"]]["summary"]) == (
            "[withheld]",
            "[withheld]",
        )
        assert {(w["slot"], w["reason"]) for w in listed[titled["id"]]["withheld"]} == {
            ("title", "confidential_term"),
            ("summary", "confidential_term"),
        }
        versions = (await admin.get(f"{API}/reports/{titled['id']}/versions")).json()
        assert [(v["title"], v["withheld"]) for v in versions["versions"]] == [
            ("[withheld]", [{"slot": "title", "reason": "confidential_term"}])
        ]
        # No match: served byte for byte, with nothing withheld.
        assert listed[tidy["id"]]["withheld"] == []
        assert (listed[tidy["id"]]["title"], listed[tidy["id"]]["summary"]) == (
            clean["title"],
            clean["summary"],
        )
        fine = (await admin.get(f"{API}/reports/{tidy['id']}")).json()["item"]
        assert {k: fine[k] for k in clean} == clean and fine["withheld"] == []
        for served in (got, view, v1, stale.json(), same.json(), listing, versions):
            assert TERM not in json.dumps(served)
        # What is stored is unchanged.
        stored = (
            await async_db_session.execute(
                select(Report.body_md).where(Report.id == UUID(report["id"]))
            )
        ).scalar_one()
        assert stored == body

    async def test_a_term_added_after_the_write_withholds_the_source_in_every_read(
        self, admin: httpx.AsyncClient, async_db_session: AsyncSession
    ) -> None:
        """A report's source_repo and source_path are served under the
        CURRENT terms too — in a read, the list, the view, a write's answer, a
        stale write's server copy and a source_mismatch refusal — while the
        stored source stays the report's identity: the filter matches it."""
        from app.models.overview import Report

        await _set_scope(async_db_session, terms=[])
        sourced = {
            "source_repo": f"{OWNER}/northwind-mutual-notes",
            "source_path": "reports/northwind-mutual/report.md",
            "source_sha": "c" * 40,
        }
        report = await _report(admin, title="Progress", slug="progress", **sourced)
        plain = {
            "source_repo": f"{OWNER}/progress-notes",
            "source_path": "reports/progress/report.md",
        }
        tidy = await _report(admin, title="Tidy", **plain)
        await _set_scope(async_db_session, terms=[TERM])
        hidden = [
            {"slot": "source_repo", "reason": "confidential_term"},
            {"slot": "source_path", "reason": "confidential_term"},
        ]

        def withheld_source(item: dict[str, Any]) -> bool:
            served = (item["source_repo"], item["source_path"], item["withheld"])
            return served == ("[withheld]", "[withheld]", hidden)

        url = f"{API}/reports/{report['id']}"
        got = (await admin.get(url)).json()["item"]
        assert withheld_source(got)
        view = await _view(admin, report["id"])
        assert withheld_source(view["report"])
        listing = (await admin.get(f"{API}/reports")).json()
        listed = {item["id"]: item for item in listing["items"]}
        assert withheld_source(listed[report["id"]])
        filtered = (
            await admin.get(
                f"{API}/reports",
                params={
                    "source_repo": sourced["source_repo"],
                    "source_path": sourced["source_path"],
                },
            )
        ).json()
        assert [item["id"] for item in filtered["items"]] == [report["id"]]
        assert withheld_source(filtered["items"][0])
        edited = await admin.patch(
            url, json={"body_md": "# Revised"}, headers={"If-Match": '"1"'}
        )
        assert edited.status_code == 200, edited.text
        assert withheld_source(edited.json()["item"])
        stale = await admin.patch(
            url, json={"body_md": "# Again"}, headers={"If-Match": '"1"'}
        )
        assert stale.status_code == 409 and withheld_source(stale.json()["current"])
        mismatch = await admin.patch(
            url,
            json={
                "body_md": "# Elsewhere",
                "source_repo": f"{OWNER}/other-notes",
                "source_path": "reports/other.md",
            },
            headers={"If-Match": '"2"'},
        )
        assert mismatch.status_code == 409, mismatch.text
        assert mismatch.json()["error"] == "source_mismatch"
        # No match: served byte for byte.
        clean = (await admin.get(f"{API}/reports/{tidy['id']}")).json()["item"]
        assert (clean["source_repo"], clean["source_path"], clean["withheld"]) == (
            plain["source_repo"],
            plain["source_path"],
            [],
        )
        for served in (got, view, listing, filtered, edited.json(), stale.json()):
            assert not _names_term(served)
        assert not _names_term(mismatch.text)
        stored = (
            await async_db_session.execute(
                select(Report.source_repo, Report.source_path).where(
                    Report.id == UUID(report["id"])
                )
            )
        ).one()
        assert tuple(stored) == (sourced["source_repo"], sourced["source_path"])

    async def test_replay_and_adopt_answers_are_served_under_the_current_terms(
        self, admin: httpx.AsyncClient, async_db_session: AsyncSession
    ) -> None:
        """A replayed create and an adopted re-post answer with the stored
        record as a read serves it, under the terms as they stand now."""
        await _set_scope(async_db_session, terms=[])
        body = {"title": "Progress", "body_md": f"Work for {TERM}."}
        first = await admin.post(
            f"{API}/reports", json=body, headers={"Idempotency-Key": "report-1"}
        )
        assert first.status_code == 201, first.text
        report = first.json()["item"]
        sourced = {
            "title": "Sourced",
            "body_md": f"Also for {TERM}.",
            "source_repo": f"{OWNER}/notes",
            "source_path": "reports/sourced.md",
        }
        assert (await admin.post(f"{API}/reports", json=sourced)).status_code == 201
        path = "snapshots/northwind-mutual.json"
        keyed = await _post(
            admin, report["id"], _stop(1), source_path=path, key="snap-1"
        )
        assert keyed.status_code == 201, keyed.text
        filed = await _snapshot(
            admin, report["id"], _stop(2), source_path="snapshots/two.json"
        )
        withdrawn = await admin.patch(
            f"{API}/report-snapshots/{filed['id']}",
            json={"withdrawn": True, "withdrawn_reason": f"Wrong for {TERM}."},
            headers={"If-Match": '"1"'},
        )
        assert withdrawn.status_code == 200, withdrawn.text
        await _set_scope(async_db_session, terms=[TERM])

        replay = await admin.post(
            f"{API}/reports", json=body, headers={"Idempotency-Key": "report-1"}
        )
        assert replay.status_code == 200 and replay.headers["Idempotent-Replayed"]
        assert replay.json()["item"]["body_md"] == "[withheld]"
        snap_replay = await _post(
            admin, report["id"], _stop(1), source_path=path, key="snap-1"
        )
        assert snap_replay.status_code == 200, snap_replay.text
        assert snap_replay.json()["item"]["source_path"] == "[withheld]"
        adopted = await _post(
            admin, report["id"], _stop(2), source_path="snapshots/two.json"
        )
        assert adopted.status_code == 200, adopted.text
        assert adopted.headers["Idempotent-Replayed"] == "true"
        assert adopted.json()["item"]["withdrawn_reason"] == "[withheld]"
        for answer in (replay, snap_replay, adopted):
            assert not _names_term(answer.text)
        # A report's adopt answer is the payload's own content, which the
        # create scans first: an identical keyed create is refused instead.
        again = await admin.post(
            f"{API}/reports", json=sourced, headers={"Idempotency-Key": "report-2"}
        )
        assert again.status_code == 422, again.text
        assert again.json()["error"] == "report_rejected"


class TestChangeLogAtRead:
    async def test_report_and_snapshot_rows_are_served_under_the_current_terms(
        self, admin: httpx.AsyncClient, async_db_session: AsyncSession
    ) -> None:
        """Any member reads the change log, so its copies are served as the
        records' own reads serve them: a field naming a term added after the
        write reads [withheld] in ``before`` and ``after``, withheld names
        the copy and the field, and the logged rows are unchanged."""
        await _set_scope(async_db_session, terms=[])
        report = await _report(
            admin, title=f"{TERM} rollout", slug="rollout", summary=f"For {TERM}."
        )
        url = f"{API}/reports/{report['id']}"
        renamed = await admin.patch(
            url,
            json={"title": "Rollout", "summary": "Plain."},
            headers={"If-Match": '"1"'},
        )
        assert renamed.status_code == 200, renamed.text
        doomed = await _report(admin, title="Doomed", body_md=f"Body for {TERM}.")
        deleted = await admin.delete(
            f"{API}/reports/{doomed['id']}", headers={"If-Match": '"1"'}
        )
        assert deleted.status_code == 204, deleted.text
        snap = await _snapshot(
            admin,
            report["id"],
            _doc(label=f"{TERM} checkpoint"),
            source_path="snapshots/northwind-mutual.json",
        )
        withdrawn = await admin.patch(
            f"{API}/report-snapshots/{snap['id']}",
            json={"withdrawn": True, "withdrawn_reason": f"Wrong numbers from {TERM}"},
            headers={"If-Match": '"1"'},
        )
        assert withdrawn.status_code == 200, withdrawn.text
        await _set_scope(async_db_session, terms=[TERM])

        def entries(resource: str) -> Any:
            return admin.get(
                f"{API}/change-log", params={"resource": resource, "limit": 100}
            )

        reports_log = (await entries("reports")).json()
        rows = {(e["record_id"], e["action"]): e for e in reports_log["entries"]}

        def slots(entry: dict[str, Any]) -> set[tuple[str, str]]:
            return {(w["slot"], w["reason"]) for w in entry["withheld"]}

        created = rows[(report["id"], "create")]
        assert (created["after"]["title"], created["after"]["summary"]) == (
            "[withheld]",
            "[withheld]",
        )
        assert created["after"]["slug"] == "rollout"
        assert slots(created) == {
            ("after.title", "confidential_term"),
            ("after.summary", "confidential_term"),
        }
        updated = rows[(report["id"], "update")]
        assert updated["before"]["title"] == "[withheld]"
        assert (updated["after"]["title"], updated["after"]["summary"]) == (
            "Rollout",
            "Plain.",
        )
        assert {slot for slot, _ in slots(updated)} == {
            "before.title",
            "before.summary",
        }
        removed = rows[(doomed["id"], "delete")]
        assert removed["before"]["body_md"] == "[withheld]"
        assert removed["before"]["title"] == "Doomed"
        assert slots(removed) == {("before.body_md", "confidential_term")}

        snaps_log = (await entries("report_snapshots")).json()
        logged = {e["action"]: e for e in snaps_log["entries"]}
        made = logged["create"]
        assert (made["after"]["label"], made["after"]["source_path"]) == (
            "[withheld]",
            "[withheld]",
        )
        assert {slot for slot, _ in slots(made)} == {"after.label", "after.source_path"}
        pulled = logged["update"]
        assert pulled["after"]["withdrawn_reason"] == "[withheld]"
        assert pulled["before"]["withdrawn_reason"] is None
        assert ("after.withdrawn_reason", "confidential_term") in slots(pulled)
        for page in (reports_log, snaps_log):
            assert not _names_term(page)
        # The logged rows themselves are unchanged.
        assert any(
            (row.after or {}).get("title") == f"{TERM} rollout"
            for row in await _log(async_db_session, "reports")
        )


# ===========================================================================
# The view: withdrawn stops and the changes between stops
# ===========================================================================


class TestView:
    async def test_a_withdrawn_snapshot_is_hidden_from_the_view(
        self, admin: httpx.AsyncClient
    ) -> None:
        report = await _report(admin)
        first = await _snapshot(admin, report["id"], _stop(1))
        wrong = await _snapshot(admin, report["id"], _stop(2))
        third = await _snapshot(admin, report["id"], _stop(3))
        url = f"{API}/report-snapshots/{wrong['id']}"
        await admin.patch(
            url,
            json={"withdrawn": True, "withdrawn_reason": "Measured the wrong build."},
            headers={"If-Match": '"1"'},
        )
        view = await _view(admin, report["id"])
        assert [s["seq"] for s in view["snapshots"]] == [first["seq"], third["seq"]]
        assert (view["shown"], view["total"]) == (2, 2)
        # The next stop compares with the previous one a reader is shown.
        assert (
            view["snapshots"][1]["changes_since_previous"]["previous_seq"]
            == first["seq"]
        )
        await admin.patch(url, json={"withdrawn": False}, headers={"If-Match": '"2"'})
        view = await _view(admin, report["id"])
        assert [s["seq"] for s in view["snapshots"]] == [
            first["seq"],
            wrong["seq"],
            third["seq"],
        ]

    async def test_a_withdrawn_snapshot_serves_no_document_until_restored(
        self, admin: httpx.AsyncClient
    ) -> None:
        """A withdrawn snapshot is history: its row is listed and read, so it
        can be restored, but no read serves its document — data is null and
        withheld names data, withdrawn. The database keeps the document, so a
        restore serves it again, unchanged."""
        report = await _report(admin)
        doc = _doc()
        snap = await _snapshot(admin, report["id"], doc)
        url = f"{API}/report-snapshots/{snap['id']}"
        hidden = [{"slot": "data", "reason": "withdrawn"}]
        done = await admin.patch(
            url,
            json={"withdrawn": True, "withdrawn_reason": "The numbers were wrong."},
            headers={"If-Match": '"1"'},
        )
        assert done.status_code == 200, done.text
        assert done.json()["item"]["withheld"] == hidden
        got = (await admin.get(url)).json()["item"]
        assert (got["withdrawn"], got["data"], got["withheld"]) == (True, None, hidden)
        assert got["label"] == "Baseline review"  # the row stays readable
        listed = (
            await admin.get(
                f"{API}/report-snapshots", params={"report_id": report["id"]}
            )
        ).json()["items"]
        assert [(i["id"], i["data"], i["withheld"]) for i in listed] == [
            (snap["id"], None, hidden)
        ]
        restored = await admin.patch(
            url, json={"withdrawn": False}, headers={"If-Match": '"2"'}
        )
        assert restored.status_code == 200, restored.text
        assert restored.json()["item"]["withheld"] == []
        got = (await admin.get(url)).json()["item"]
        assert got["data"] == doc and got["withheld"] == []
        assert _canonical_sha(got["data"]) == snap["content_sha256"]

    async def test_changes_since_previous_name_every_move_in_plain_terms(
        self, admin: httpx.AsyncClient
    ) -> None:
        report = await _report(admin)
        before = _doc()
        before["items"].append(
            {
                **copy.deepcopy(DOC["items"][0]),
                "id": "faster-ci",
                "label": "Faster CI",
                "status": "in_progress",
            }
        )
        after = copy.deepcopy(before)
        after["as_of"] = "2026-10-29T12:00:00Z"
        after["label"] = "Checkpoint 1"
        after["method"] = {"kind": "light_check", "label": "Light check", "note": None}
        cells = after["tables"][0]["rows"][0]["cells"]
        cells["leanness"]["value"] = 3  # moved
        cells["operability"] = {"value": 4, "unknown_reason": None}  # unknown → known
        after["tables"][0]["rows"].append(
            {
                "id": "merge-train",
                "label": "Merge train",
                "help": None,
                "cells": {
                    "leanness": {"value": 4, "unknown_reason": None},
                    "operability": {"value": None, "unknown_reason": "Not run."},
                },
            }
        )
        after["figures"][0].update(
            value=None, unknown_reason="Ledger offline.", verdict="unknown"
        )
        after["figures"].append(
            {
                **copy.deepcopy(DOC["figures"][0]),
                "id": "cycle-time",
                "value": 3.0,
                "verdict": "met",
            }
        )
        after["items"][0].update(
            status="done",
            events=[
                {"at": "2026-10-13", "label": "On the day of the last stop"},
                {"at": "2026-10-20", "label": "Plan approved"},
                {"at": "2026-10-29", "label": "Shipped"},
                {"at": "2026-10-30", "label": "After this stop"},
            ],
        )
        after["items"].append(
            {
                **copy.deepcopy(DOC["items"][0]),
                "id": "new-dashboard",
                "status": "planned",
            }
        )
        first = await _snapshot(admin, report["id"], before)
        await _snapshot(admin, report["id"], after)
        view = await _view(admin, report["id"])
        changes = view["snapshots"][1]["changes_since_previous"]
        assert changes["previous_seq"] == first["seq"]
        assert changes["method_changed"] is True
        cells_by = {(c["row_id"], c["column_id"]): c for c in changes["cells"]}
        assert cells_by[("scheduler", "leanness")] == {
            "table_id": "scorecard",
            "row_id": "scheduler",
            "column_id": "leanness",
            "from": 2,
            "to": 3,
            "new": False,
        }
        assert (
            cells_by[("scheduler", "operability")]["from"],
            cells_by[("scheduler", "operability")]["to"],
        ) == (None, 4)
        assert cells_by[("merge-train", "leanness")]["new"] is True
        assert cells_by[("merge-train", "operability")] == {
            "table_id": "scorecard",
            "row_id": "merge-train",
            "column_id": "operability",
            "from": None,
            "to": None,
            "new": True,
        }
        # The summary row did not move, so it is not listed.
        assert ("average", "leanness") not in cells_by
        figures = {f["figure_id"]: f for f in changes["figures"]}
        assert figures["lead-time"] == {
            "figure_id": "lead-time",
            "from": 9.5,
            "to": None,
            "verdict_from": "missed",
            "verdict_to": "unknown",
            "new": False,
        }
        assert figures["cycle-time"]["new"] is True
        assert figures["cycle-time"]["verdict_from"] is None
        items = {i["item_id"]: i for i in changes["items"]}
        assert items["split-scheduler"] == {
            "item_id": "split-scheduler",
            "from_status": "planned",
            "to_status": "done",
            "new": False,
        }
        assert items["new-dashboard"]["new"] is True
        assert "faster-ci" not in items  # unchanged
        assert [(e["at"], e["label"]) for e in changes["events"]] == [
            ("2026-10-20", "Plan approved"),
            ("2026-10-29", "Shipped"),
        ]

    async def test_the_same_method_is_not_a_method_change(
        self, admin: httpx.AsyncClient
    ) -> None:
        report = await _report(admin)
        await _snapshot(admin, report["id"], _stop(1))
        await _snapshot(admin, report["id"], _stop(2))
        view = await _view(admin, report["id"])
        changes = view["snapshots"][1]["changes_since_previous"]
        assert changes["method_changed"] is False
        assert (changes["cells"], changes["figures"], changes["items"]) == ([], [], [])


# ===========================================================================
# Agents: device publishing and the idempotent re-post
# ===========================================================================

DEVICE = UUID("dddddddd-0000-4000-8000-0000000000f9")
ADMIN_TOKEN = "report-device-admin"
VIEWER_TOKEN = "report-device-viewer"
SESSION = "eeeeeeee-0000-4000-8000-0000000000f8"


class _FakeCoord:
    """coord's device-membership door. No other coord door may see a device
    bearer: the handler fails the test if one is asked anything else."""

    def __init__(self, user_id: str) -> None:
        self.user_id = user_id
        self.memberships = {
            ADMIN_TOKEN: [(TENANT_A, ["admin"])],
            VIEWER_TOKEN: [(TENANT_A, ["viewer"])],
        }

    def handler(self, request: httpx.Request) -> httpx.Response:
        if request.url.path != "/coord/devices/me/memberships":
            raise AssertionError(
                f"a device request reached coord at {request.url.path}"
            )
        bearer = request.headers.get("Authorization", "").removeprefix("Bearer ")
        answer = self.memberships.get(bearer)
        if answer is None:
            return httpx.Response(403, json={"error": "device_token_required"})
        return httpx.Response(
            200,
            json={
                "device_id": str(DEVICE),
                "user_id": self.user_id,
                "memberships": [
                    {"tenant_id": str(t), "slug": "t", "roles": r} for t, r in answer
                ],
            },
        )


@pytest_asyncio.fixture()
async def device(
    async_db_session: AsyncSession, api_user, monkeypatch: pytest.MonkeyPatch
) -> AsyncIterator[Callable[[str], httpx.AsyncClient]]:
    """A client factory: ``device(token)`` speaks as that paired device."""
    from app.api import deps
    from app.api.deps import current_active_user_optional, get_async_db
    from app.overview.router import router as authoring_router
    from app.services import coord_device_memberships

    fake = _FakeCoord(str(api_user.id))
    real = httpx.AsyncClient

    def client_with_fake_coord(*args: Any, **kwargs: Any) -> httpx.AsyncClient:
        kwargs["transport"] = httpx.MockTransport(fake.handler)
        return real(*args, **kwargs)

    patched = types.SimpleNamespace(**{k: getattr(httpx, k) for k in dir(httpx)})
    patched.AsyncClient = client_with_fake_coord
    monkeypatch.setattr(coord_device_memberships, "httpx", patched)

    async def verify(token: str) -> tuple[dict[str, Any], Any]:
        if token not in fake.memberships:
            raise HTTPException(status_code=401, detail="Invalid token.")
        claims = {
            "sub_type": "device",
            "mint_provenance": "paired",
            "device_id": str(DEVICE),
            "user_id": str(api_user.id),
        }
        return claims, api_user

    monkeypatch.setattr(deps, "_verify_device_jwt", verify)
    app = FastAPI()
    app.dependency_overrides[current_active_user_optional] = lambda: None

    async def _db() -> AsyncIterator[AsyncSession]:
        yield async_db_session

    app.dependency_overrides[get_async_db] = _db
    app.include_router(authoring_router, prefix=API)
    clients: list[httpx.AsyncClient] = []

    def make(token: str) -> httpx.AsyncClient:
        c = real(
            transport=httpx.ASGITransport(app=app),
            base_url="http://test",
            headers={
                "Authorization": f"Bearer {token}",
                "X-Qontinui-Active-Tenant": str(TENANT_A),
                "X-Overview-Session": SESSION,
            },
        )
        clients.append(c)
        return c

    yield make
    for c in clients:
        await c.aclose()


class TestAgents:
    async def test_a_device_publishes_a_report_and_its_snapshots_for_editing_roles(
        self, device, async_db_session: AsyncSession, api_user
    ) -> None:
        agent = device(ADMIN_TOKEN)
        report = await _report(agent)
        assert report["via_device"] == str(DEVICE) and report["via_session"] == SESSION
        item = await _snapshot(
            agent, report["id"], _doc(), source_path="snapshots/1.json"
        )
        assert item["via_device"] == str(DEVICE) and item["via_session"] == SESSION
        (row,) = await _log(async_db_session, "report_snapshots")
        assert row.via_device == DEVICE and row.actor == api_user.email
        # A device's user without an editing role reads but cannot write.
        viewer = device(VIEWER_TOKEN)
        assert (
            await viewer.get(f"{API}/reports/{report['id']}/view")
        ).status_code == 200
        denied = await _post(viewer, report["id"], _stop(5))
        assert denied.status_code == 403

    async def test_a_device_needs_configured_owners_to_publish_a_github_link(
        self, device, async_db_session: AsyncSession
    ) -> None:
        """A device's bearer never reaches coord's operator routes, so the
        registered repositories cannot be read for it: without configured
        owners a GitHub link is UNKNOWN (503); with them it is checked."""
        agent = device(ADMIN_TOKEN)
        report = await _report(agent)
        doc = _with(
            _doc(),
            lambda d: d["items"][0].update(links=[{"label": "PR", "url": PR_LINK}]),
        )
        unknown = await _post(agent, report["id"], doc)
        assert unknown.status_code == 503
        assert unknown.json()["error"] == "presentation_scope_unknown"
        await _set_scope(async_db_session, owners=[OWNER])
        await _snapshot(agent, report["id"], doc)

    async def test_reposting_the_same_file_is_a_no_op_that_answers_the_stored_snapshot(
        self, admin: httpx.AsyncClient, async_db_session: AsyncSession
    ) -> None:
        report = await _report(admin)
        path = "reports/platform/snapshots/2026-10-13.json"
        first = await _post(admin, report["id"], _doc(), source_path=path)
        assert first.status_code == 201
        for key in (None, uuid4().hex):
            again = await _post(admin, report["id"], _doc(), source_path=path, key=key)
            assert again.status_code == 200, again.text
            assert again.headers["Idempotent-Replayed"] == "true"
            assert again.json()["item"]["id"] == first.json()["item"]["id"]
            assert again.json()["item"]["content_sha256"] == _canonical_sha(_doc())
        listed = (
            await admin.get(
                f"{API}/report-snapshots", params={"report_id": report["id"]}
            )
        ).json()
        assert len(listed["items"]) == 1
        assert [r.action for r in await _log(async_db_session, "report_snapshots")] == [
            "create"
        ]
        # The same path on another report is another snapshot.
        other = await _report(admin, title="Another report")
        assert (
            await _post(admin, other["id"], _doc(), source_path=path)
        ).status_code == 201

    async def test_the_same_file_with_other_content_is_409_snapshot_changed_at_source(
        self, admin: httpx.AsyncClient, async_db_session: AsyncSession
    ) -> None:
        report = await _report(admin)
        path = "reports/platform/snapshots/2026-10-13.json"
        await _snapshot(admin, report["id"], _doc(), source_path=path)
        for key in (None, uuid4().hex):
            changed = await _post(
                admin, report["id"], _doc(label="Corrected"), source_path=path, key=key
            )
            assert changed.status_code == 409, changed.text
            assert changed.json()["error"] == "snapshot_changed_at_source"
        listed = (
            await admin.get(
                f"{API}/report-snapshots", params={"report_id": report["id"]}
            )
        ).json()
        assert [i["label"] for i in listed["items"]] == ["Baseline review"]
        assert len(await _log(async_db_session, "report_snapshots")) == 1
