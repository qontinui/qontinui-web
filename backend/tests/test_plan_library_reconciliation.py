"""Plan & Prompt Library — ``GET /plan-library/reconciliation`` (Phase 4).

Plan ``2026-09-03-plan-status-three-way-reconciler-surface``. Three writers
share one fact — "is this plan done?" — and none of them reads the others:

* **axis A** — coord ``work_units.status``, the STORED column.
* **axis B** — the plan document's status stamp. On THIS surface that is the
  ARTIFACT STORE, not a git ref, and every response says so.
* **axis C** — coord's DERIVED ``delivery`` verdict, forwarded verbatim.

Two things these tests exist to hold, and they are not the same thing:

1. **The vendored spec must not drift.** The classifier and its vectors are
   COPIES of qontinui-dev-notes' ``scripts/`` originals — two repos cannot
   share a file — so ``TestVendoredSpec`` pins both digests and replays every
   vector through the vendored cascade. A divergence on either side reds this
   suite on the next run (D7).
2. **A sparse or frozen document layer must never read as agreement.**
   ``agent.work_artifacts`` fills only under an opt-in body sync
   (``QONTINUI_PLAN_LIBRARY_SYNC`` / the tenant ``plan_capture`` dial), and a
   store frozen weeks ago is indistinguishable from an empty one. A comparator
   that read that as "all three axes agree" would manufacture fleet-wide FALSE
   AGREEMENT — the exact defect the plan exists to close. ``TestFrozenDocument
   Layer`` is that assertion, and ``test_a_document_backed_row_can_agree``
   sits beside it so the claim is not vacuously true.

Coord is mocked at ``_proxy_coord_get`` — the same seam
``test_plan_library_candidates.py`` mocks — so no live coord is needed and each
degradation mode is reproducible exactly. Nothing here reads coord's Postgres;
``tests/test_coord_schema_boundary_guard.py`` enforces that separately.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta
from typing import Any
from unittest.mock import AsyncMock, patch
from uuid import UUID, uuid4

import httpx
import pytest
import pytest_asyncio
from fastapi import FastAPI
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.endpoints.plan_library import (
    _ADAPTER_STATUS_PREFIX,
    _AXIS_C_OFF_PAGE,
    _DOC_ABSENT_CLASS,
    _adapter_reads_status_block,
    _document_classification,
    _reconcile_verdict,
    _reconciliation_contract_violations,
)
from app.crud import work_artifact as crud
from app.models.work_artifact import WorkArtifact
from app.schemas.plan_library import ReconciliationFacets, ReconciliationRow
from app.services import plan_status

API_PREFIX = "/api/v1/plan-library"
RECONCILIATION = f"{API_PREFIX}/reconciliation"

#: Applied per CLASS rather than per module: half the suite below is
#: SYNCHRONOUS (the vendored-spec replay and the pure contract checks need no
#: event loop), and a module-level asyncio mark would tag those too.
_ASYNC = pytest.mark.asyncio

#: The three verdict groups, spelled once. Exhaustive by contract.
_VERDICTS = ("agree", "disagree", "unknown")


#: A body the runner adapter can actually read a status off — its test is
#: byte-exact (``line.lstrip().startswith("> **Status:")``), so a body without
#: this line is a ``DOC_STAMP_UNREADABLE_BY_ADAPTER`` finding rather than a
#: neutral fixture detail.
def _body(status: str) -> str:
    return f"# A plan\n\n{_ADAPTER_STATUS_PREFIX}** {status}\n\nBody.\n"


def _stem(name: str) -> str:
    """A plan-shaped stem: coord only admits ``YYYY-MM-DD-``-prefixed slugs."""
    return f"2026-09-03-{name}-{uuid4().hex[:10]}"


# ===========================================================================
# Layer 0 — the vendored spec (D6 + D7)
# ===========================================================================


class TestVendoredSpec:
    """The copy must be DETECTABLE when it drifts. That is the whole point."""

    def test_vectors_file_hashes_to_the_pinned_digest(self) -> None:
        assert plan_status.vectors_digest() == plan_status.VENDORED_VECTORS_SHA256

    def test_the_vendored_module_carries_the_same_pin(self) -> None:
        """The module's own constant and web's independent one must agree.

        Two constants rather than one on purpose: the module's travels WITH the
        copy, so a wholesale re-vendor of a drifted pair would update both the
        file and its pin and assert nothing.
        """
        assert plan_status.VECTORS_SHA256 == plan_status.VENDORED_VECTORS_SHA256

    def test_classifier_file_hashes_to_its_pinned_digest(self) -> None:
        """Beyond D7's letter, in its spirit: the ORDER is spec too.

        The vectors alone cannot detect a reworded reason or a re-ordered arm
        that still satisfies them, and the cascade order is as much of the
        shared contract as the vectors are.
        """
        assert plan_status.classifier_digest() == (
            plan_status.VENDORED_CLASSIFIER_SHA256
        )

    def test_every_vector_classifies_exactly_as_the_spec_says(self) -> None:
        data = plan_status.load_vectors()
        vectors = data["vectors"]
        assert vectors, "the vector file carried no vectors"
        for vector in vectors:
            name = vector["name"]
            got_class, got_reason = plan_status.classify(
                vector["axis_a"], vector["axis_b"], vector["axis_c"]
            )
            assert got_class == vector["expect_class"], (
                f"{name}: expected {vector['expect_class']}, got {got_class} "
                f"({got_reason})"
            )
            for fragment in vector.get("expect_reason_contains", ()):
                assert fragment in got_reason, (
                    f"{name}: reason did not carry {fragment!r} — got {got_reason!r}"
                )

    def test_every_cascade_member_has_at_least_one_vector(self) -> None:
        """A member added without a vector is the likelier drift than a missing one."""
        data = plan_status.load_vectors()
        covered = {vector["expect_class"] for vector in data["vectors"]}
        missing = sorted(set(plan_status.CLASS_ORDER) - covered)
        assert not missing, f"cascade members with no vector: {missing}"
        stray = sorted(covered - set(plan_status.CLASS_ORDER))
        assert not stray, (
            f"vectors expecting a class the cascade does not have: {stray}"
        )

    def test_the_cascade_order_matches_the_vector_file(self) -> None:
        """FIRST-MATCH-WINS, and the ORDER is part of the spec (D6).

        Several members match one row at once, so without a stated order the
        two implementations pick different winners on the same input — which
        defeats the shared-vector mitigation exactly where it matters.
        """
        data = plan_status.load_vectors()
        assert list(plan_status.CLASS_ORDER) == list(data["cascade_order"])

    def test_agreement_is_last_so_an_unreadable_axis_cannot_fall_into_it(self) -> None:
        order = list(plan_status.CLASS_ORDER)
        assert set(order[-2:]) == set(plan_status.AGREE_CLASSES)
        # And every UNKNOWN member precedes both of them.
        for unknown in plan_status.UNKNOWN_CLASSES:
            assert order.index(unknown) < order.index("AGREE_TERMINAL")
            assert order.index(unknown) < order.index("AGREE_OPEN")

    def test_the_document_absence_class_this_route_renames_is_a_real_member(
        self,
    ) -> None:
        """The route rewrites that class's REASON; it must never rename the class."""
        assert _DOC_ABSENT_CLASS in plan_status.CLASS_ORDER


# ===========================================================================
# Layer 1 — the pure helpers this surface adds on top of the vendored cascade
# ===========================================================================


class TestDocumentAxisReaders:
    def test_the_adapter_status_test_is_byte_exact(self) -> None:
        assert _adapter_reads_status_block("> **Status:** Shipped")
        assert _adapter_reads_status_block("intro\n   > **Status:** Draft\nmore")
        # The looser spellings a human (and the linter) accept, which the
        # adapter does NOT — each is a real disagreement, not a fixture quirk.
        assert not _adapter_reads_status_block("**Status:** Shipped")
        assert not _adapter_reads_status_block("> Status: Shipped")
        assert not _adapter_reads_status_block("## Status\n\nShipped")
        assert not _adapter_reads_status_block("")

    def test_classification_uses_the_rust_nine_not_the_linters_eleven(self) -> None:
        """``in_progress`` is the adapter's OUTPUT form, never an INPUT phrase."""
        assert _document_classification("in progress") == "ok"
        assert _document_classification("in_progress") == "off_vocabulary"
        assert _document_classification("not started") == "ok"
        assert _document_classification("not_started") == "off_vocabulary"
        assert _document_classification("shipped") == "ok"
        assert _document_classification("marinating") == "off_vocabulary"
        assert _document_classification("") == "no_status_block"
        assert _document_classification("   ") == "no_status_block"
        assert _document_classification(None) == "no_status_block"

    def test_unknown_is_read_off_the_vendored_set_never_computed_as_a_residual(
        self,
    ) -> None:
        for member in plan_status.CLASS_ORDER:
            verdict = _reconcile_verdict(member)
            assert verdict in _VERDICTS
            if member in plan_status.UNKNOWN_CLASSES:
                assert verdict == "unknown"
            elif member in plan_status.AGREE_CLASSES:
                assert verdict == "agree"
            else:
                assert verdict == "disagree"


# ===========================================================================
# Layer 2 — HTTP, with coord mocked
# ===========================================================================


def _build_app(*, db_session: AsyncSession, user: Any) -> FastAPI:
    # Both Cognito dependencies: this read resolves its principal through the
    # dual-auth ``get_audit_actor_principal`` (which reads the OPTIONAL one),
    # so overriding only the strict one would 401 every request.
    from app.api.deps import (
        current_active_user,
        current_active_user_optional,
        get_async_db,
    )
    from app.api.v1.endpoints.plan_library import router as plan_library_router

    app = FastAPI()
    app.dependency_overrides[current_active_user] = lambda: user
    app.dependency_overrides[current_active_user_optional] = lambda: user

    async def _db_override():
        yield db_session

    app.dependency_overrides[get_async_db] = _db_override
    app.include_router(plan_library_router, prefix=API_PREFIX)
    return app


@pytest_asyncio.fixture()
async def api_user(async_db_session: AsyncSession):
    from app.models.user import User

    user = User(
        email=f"recon_{uuid4().hex[:8]}@example.com",
        username=f"recon_{uuid4().hex[:8]}",
        full_name="Reconciliation Tester",
        is_active=True,
        is_verified=True,
    )
    async_db_session.add(user)
    await async_db_session.commit()
    await async_db_session.refresh(user)
    return user


@pytest_asyncio.fixture()
async def client(async_db_session: AsyncSession, api_user):
    app = _build_app(db_session=async_db_session, user=api_user)
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(
        transport=transport, base_url="http://test"
    ) as http_client:
        yield http_client


@pytest.fixture(autouse=True)
def _no_live_tenant_resolution():
    """Never let the tenant resolver reach a real coord (or pay its timeout)."""
    with patch(
        "app.api.v1.endpoints.plan_library._soft_tenant_id",
        new=AsyncMock(return_value=uuid4()),
    ):
        yield


async def _plan_artifact(
    db: AsyncSession,
    *,
    org_id: UUID | None,
    slug: str,
    status: str,
    body: str | None = None,
    work_unit_slug: str | None = None,
    source_path: str | None = None,
) -> WorkArtifact:
    row, _, _ = await crud.upsert_artifact(
        db,
        org_id=org_id,
        user_id=None,
        kind="plan",
        slug=slug,
        title=f"Plan {slug}",
        status=status,
        body=body if body is not None else _body(status),
        source_path=source_path,
        source_repo="qontinui-dev-notes",
        work_unit_slug=work_unit_slug,
        repos=[],
        authored_at=None,
        captured_by="agent",
        change_description=None,
        created_by="test",
    )
    return row


def _unit(
    slug: str,
    *,
    status: str,
    source_path: str | None = None,
    title: str | None = None,
) -> dict[str, Any]:
    """One row of coord's work-unit list, shaped the way coord shapes it."""
    now = datetime.now(UTC) - timedelta(days=3)
    return {
        "slug": slug,
        "status": status,
        "title": title or f"Unit {slug}",
        "metadata": ({"source_path": source_path} if source_path else {}),
        "created_at": now.isoformat().replace("+00:00", "Z"),
        "updated_at": now.isoformat().replace("+00:00", "Z"),
    }


def _delivery(
    *,
    shipped: bool,
    evidence_complete: bool,
    evidence_gaps: list[str] | None = None,
) -> dict[str, Any]:
    return {
        "shipped": shipped,
        "evidence_complete": evidence_complete,
        "evidence_gaps": list(evidence_gaps or []),
    }


def _coord(
    units: list[dict[str, Any]],
    *,
    by_slug: dict[str, dict[str, Any]] | None = None,
    default_delivery: dict[str, Any] | None = None,
    default_citations: list[dict[str, Any]] | None = None,
) -> AsyncMock:
    """A coord that answers, on the OPERATOR door tier the test user opens.

    The list door returns ``{work_units: [...]}``; the by-slug door returns the
    unit plus — because the route asks with ``?with_citations=true`` — the
    inline ``citations`` and the derived ``delivery`` verdict, which is exactly
    the shape ``by_slug_response`` emits under that flag.
    """
    index = {unit["slug"]: unit for unit in units}
    per_slug = by_slug or {}

    async def _fake(path: str, **_: Any) -> Any:
        if path in ("/coord/work-units", "/coord/agent-work-units"):
            return {"work_units": units, "limit": 500, "offset": 0}
        slug = path.rsplit("/", 1)[-1]
        if slug not in index:
            raise AssertionError(f"unexpected coord by-slug read for {slug!r}")
        body: dict[str, Any] = {
            "work_unit": index[slug],
            "recent_history": [],
            "citations": list(default_citations or []),
        }
        body.update(per_slug.get(slug, {}))
        if "delivery" not in body and "delivery_error" not in body:
            body["delivery"] = default_delivery or _delivery(
                shipped=False, evidence_complete=True
            )
        return body

    return AsyncMock(side_effect=_fake)


def _patched(fake: AsyncMock):
    return patch("app.api.v1.endpoints.plan_library._proxy_coord_get", new=fake)


def _by_slug(payload: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {row["slug"]: row for row in payload["items"]}


# ---------------------------------------------------------------------------


@_ASYNC
class TestFrozenDocumentLayer:
    """The plan's central claim on this side. If this can pass while the route
    reports agreement, the route is wrong."""

    async def test_a_frozen_artifact_store_yields_unknown_never_agreement(
        self, client: httpx.AsyncClient, async_db_session: AsyncSession
    ) -> None:
        # coord knows about four plans. The artifact store holds NOTHING —
        # exactly what a body sync that was never switched on looks like, and
        # indistinguishable from a corpus with no plans in it.
        units = [
            _unit(_stem("frozen-a"), status="shipped", source_path="plans/a.md"),
            _unit(_stem("frozen-b"), status="vetted", source_path="plans/b.md"),
            _unit(_stem("frozen-c"), status="in_progress"),
            _unit(_stem("frozen-d"), status=""),
        ]
        fake = _coord(units)
        with _patched(fake):
            resp = await client.get(RECONCILIATION, params={"limit": 100})
        assert resp.status_code == 200
        payload = resp.json()

        assert payload["total"] == 4
        assert payload["document_axis_source"] == "artifact_store"
        assert payload["document_axis_complete"] is False
        assert payload["document_present_count"] == 0
        assert payload["document_missing_count"] == 4

        # NOT ONE row may agree — and every one must say why.
        assert payload["facets"]["by_verdict"]["agree"] == 0
        assert payload["facets"]["by_verdict"]["unknown"] == 4
        assert payload["facets"]["by_verdict"]["disagree"] == 0
        for row in payload["items"]:
            assert row["verdict"] == "unknown"
            assert row["document_axis_complete"] is False
            assert row["classification"] == _DOC_ABSENT_CLASS
            assert row["axis_b"]["source"] == "artifact_store"
            assert row["axis_b"]["present"] is False
            # The reason must describe THIS surface's axis B, not the
            # git-side reconciler's.
            assert "artifact store" in row["reason"]
            assert "origin/main" not in row["reason"]

        assert payload["facets"]["corpus_complete"] is False
        assert any(
            "no plan body" in reason
            for reason in payload["facets"]["corpus_incomplete_reasons"]
        )

    async def test_unsynced_and_absent_each_classify_unknown(
        self, client: httpx.AsyncClient, async_db_session: AsyncSession
    ) -> None:
        """Two different facts, both UNKNOWN, and they stay distinguishable."""
        unsynced = _stem("unsynced")
        absent = _stem("absent")
        units = [
            _unit(unsynced, status="shipped", source_path="plans/unsynced.md"),
            _unit(absent, status="shipped"),
        ]
        with _patched(_coord(units)):
            resp = await client.get(RECONCILIATION, params={"limit": 100})
        rows = _by_slug(resp.json())

        assert rows[unsynced]["document_state"] == "unsynced"
        assert rows[absent]["document_state"] == "absent"
        for row in rows.values():
            assert row["verdict"] == "unknown"
            assert row["classification"] == _DOC_ABSENT_CLASS
            assert row["document_axis_complete"] is False
            assert row["classification"] not in plan_status.AGREE_CLASSES

    async def test_a_document_backed_row_can_agree(
        self, client: httpx.AsyncClient, async_db_session: AsyncSession, api_user
    ) -> None:
        """The control. Without it, the two tests above are vacuously true."""
        open_stem = _stem("agree-open")
        done_stem = _stem("agree-terminal")
        await _plan_artifact(
            async_db_session, org_id=None, slug=open_stem, status="draft"
        )
        await _plan_artifact(
            async_db_session, org_id=None, slug=done_stem, status="shipped"
        )
        units = [
            _unit(open_stem, status="vetted"),
            _unit(done_stem, status="shipped"),
        ]
        fake = _coord(
            units,
            by_slug={
                open_stem: {
                    "delivery": _delivery(shipped=False, evidence_complete=True),
                    "citations": [],
                },
                done_stem: {
                    "delivery": _delivery(shipped=True, evidence_complete=True),
                    "citations": [{"repo": "qontinui/qontinui-web", "pr_number": 1}],
                },
            },
        )
        with _patched(fake):
            resp = await client.get(RECONCILIATION, params={"limit": 100})
        payload = resp.json()
        rows = _by_slug(payload)

        assert rows[open_stem]["classification"] == "AGREE_OPEN"
        assert rows[open_stem]["verdict"] == "agree"
        assert rows[done_stem]["classification"] == "AGREE_TERMINAL"
        assert rows[done_stem]["verdict"] == "agree"
        assert payload["document_axis_complete"] is True
        assert payload["document_missing_count"] == 0


@_ASYNC
class TestEvidenceIsReadBeforeShipped:
    """``evidence_complete: false`` makes ``shipped`` un-observable, either way."""

    async def test_evidence_incomplete_classifies_and_carries_gaps_verbatim(
        self, client: httpx.AsyncClient, async_db_session: AsyncSession
    ) -> None:
        stem = _stem("evidence-gap")
        await _plan_artifact(async_db_session, org_id=None, slug=stem, status="draft")
        gaps = [
            "qontinui/qontinui-runner#164 reads unmerged on a STALE cached row "
            'that could not be re-read live — cannot tell "not landed" from "we '
            'did not look"',
            "the `merged` predicate is running DEGRADED",
        ]
        fake = _coord(
            [_unit(stem, status="shipped")],
            by_slug={
                stem: {
                    "delivery": _delivery(
                        shipped=False, evidence_complete=False, evidence_gaps=gaps
                    ),
                    "citations": [
                        {"repo": "qontinui/qontinui-runner", "pr_number": 164}
                    ],
                }
            },
        )
        with _patched(fake):
            resp = await client.get(RECONCILIATION, params={"limit": 100})
        row = _by_slug(resp.json())[stem]

        # Arm 5 wins over the ``shipped``-reading arm 7 AND over DOC_UNDERSTATES.
        assert row["classification"] == "EVIDENCE_INCOMPLETE"
        assert row["verdict"] == "disagree"
        # VERBATIM. Not summarised, not counted, not truncated.
        assert row["axis_c"]["evidence_gaps"] == gaps
        assert row["axis_c"]["shipped"] is False
        assert row["axis_c"]["evidence_complete"] is False
        for gap in gaps:
            assert gap in row["reason"]

    async def test_evidence_incomplete_wins_even_when_shipped_is_true(
        self, client: httpx.AsyncClient, async_db_session: AsyncSession
    ) -> None:
        """The arm is above every ``shipped``-reading arm, not only the false one."""
        stem = _stem("evidence-gap-true")
        await _plan_artifact(async_db_session, org_id=None, slug=stem, status="shipped")
        fake = _coord(
            [_unit(stem, status="shipped")],
            by_slug={
                stem: {
                    "delivery": _delivery(
                        shipped=True,
                        evidence_complete=False,
                        evidence_gaps=["a gap"],
                    ),
                    "citations": [{"repo": "r", "pr_number": 9}],
                }
            },
        )
        with _patched(fake):
            resp = await client.get(RECONCILIATION, params={"limit": 100})
        row = _by_slug(resp.json())[stem]
        assert row["classification"] == "EVIDENCE_INCOMPLETE"
        assert row["axis_c"]["evidence_gaps"] == ["a gap"]

    async def test_a_delivery_error_is_unknown_never_a_negative_verdict(
        self, client: httpx.AsyncClient, async_db_session: AsyncSession
    ) -> None:
        stem = _stem("delivery-error")
        await _plan_artifact(async_db_session, org_id=None, slug=stem, status="draft")
        fake = _coord(
            [_unit(stem, status="draft")],
            by_slug={
                stem: {
                    "delivery_error": {
                        "error": "db_error",
                        "pg_code": "42P01",
                        "op": "work_unit.citations.read",
                        # Free text coord logs but must never forward.
                        "message": "Key (tenant_id)=(abc) is not present",
                    },
                    "citations": [],
                }
            },
        )
        with _patched(fake):
            resp = await client.get(RECONCILIATION, params={"limit": 100})
        row = _by_slug(resp.json())[stem]

        assert row["classification"] == "UNKNOWN_AXIS_UNREADABLE"
        assert row["verdict"] == "unknown"
        assert row["axis_c"]["readable"] is False
        reason = row["axis_c"]["unreadable_reason"]
        assert "db_error" in reason and "42P01" in reason
        # The whitelist holds: only the structured identifiers cross.
        assert "tenant_id" not in reason


@_ASYNC
class TestTheOtherDisagreementClasses:
    async def test_the_headline_row_a_shipped_unit_over_a_draft_document(
        self, client: httpx.AsyncClient, async_db_session: AsyncSession
    ) -> None:
        """Stored ``shipped``, live predicate ``shipped: false``, evidence COMPLETE."""
        stem = _stem("contradicts")
        await _plan_artifact(async_db_session, org_id=None, slug=stem, status="shipped")
        fake = _coord(
            [_unit(stem, status="shipped")],
            by_slug={
                stem: {
                    "delivery": _delivery(shipped=False, evidence_complete=True),
                    "citations": [{"repo": "r", "pr_number": 5}],
                }
            },
        )
        with _patched(fake):
            resp = await client.get(RECONCILIATION, params={"limit": 100})
        row = _by_slug(resp.json())[stem]
        assert row["classification"] == "UNIT_STATUS_CONTRADICTS_DELIVERY"
        assert row["verdict"] == "disagree"

    async def test_an_empty_stored_status_is_its_own_class(
        self, client: httpx.AsyncClient, async_db_session: AsyncSession
    ) -> None:
        """410 units held it on 2026-09-03; coord accepts it silently."""
        stem = _stem("empty-status")
        await _plan_artifact(async_db_session, org_id=None, slug=stem, status="draft")
        with _patched(_coord([_unit(stem, status="")])):
            resp = await client.get(RECONCILIATION, params={"limit": 100})
        row = _by_slug(resp.json())[stem]
        assert row["classification"] == "UNKNOWN_UNIT_STATUS_EMPTY"
        assert row["verdict"] == "unknown"

    async def test_a_body_the_adapter_cannot_read_is_a_finding(
        self, client: httpx.AsyncClient, async_db_session: AsyncSession
    ) -> None:
        """The adapter silently substitutes ``draft`` and pushes it over coord."""
        stem = _stem("unreadable-stamp")
        await _plan_artifact(
            async_db_session,
            org_id=None,
            slug=stem,
            status="draft",
            body="# A plan\n\n**Status:** Draft\n",  # not the byte-exact form
        )
        with _patched(_coord([_unit(stem, status="draft")])):
            resp = await client.get(RECONCILIATION, params={"limit": 100})
        row = _by_slug(resp.json())[stem]
        assert row["classification"] == "DOC_STAMP_UNREADABLE_BY_ADAPTER"
        assert row["axis_b"]["adapter_readable"] is False

    async def test_an_artifact_with_no_work_unit_is_unknown_not_a_disagreement(
        self, client: httpx.AsyncClient, async_db_session: AsyncSession
    ) -> None:
        stem = _stem("no-unit")
        await _plan_artifact(async_db_session, org_id=None, slug=stem, status="draft")
        with _patched(_coord([])):
            resp = await client.get(RECONCILIATION, params={"limit": 100})
        row = _by_slug(resp.json())[stem]
        assert row["classification"] == "UNKNOWN_NO_UNIT"
        assert row["verdict"] == "unknown"
        # Axis C was not asked about: there is no unit to derive a verdict from.
        assert row["axis_c"]["present"] is False
        assert row["axis_c"]["readable"] is True


@_ASYNC
class TestAxisCIsPerPage:
    async def test_off_page_rows_are_counted_not_omitted(
        self, client: httpx.AsyncClient, async_db_session: AsyncSession
    ) -> None:
        """A request cannot make ~1500 sequential coord calls (Phase 0.1).

        So axis C is derived for the page — and every other row is classified
        ``UNKNOWN_AXIS_UNREADABLE`` and kept in the denominator, never dropped.
        """
        stems = sorted(_stem(f"page{i}") for i in range(5))
        for stem in stems:
            await _plan_artifact(
                async_db_session, org_id=None, slug=stem, status="draft"
            )
        fake = _coord([_unit(stem, status="vetted") for stem in stems])
        with _patched(fake):
            resp = await client.get(RECONCILIATION, params={"limit": 2, "offset": 0})
        payload = resp.json()

        assert payload["total"] == 5
        assert len(payload["items"]) == 2
        assert payload["axis_c_scope"] == "page"
        assert payload["axis_c_computed_count"] == 2
        # Denominator is the POPULATION, and the off-page rows are in it.
        assert payload["facets"]["denominator"] == 5
        assert payload["facets"]["by_class"]["UNKNOWN_AXIS_UNREADABLE"] == 3
        assert payload["facets"]["corpus_complete"] is False
        assert any(
            "axis C was derived for 2 of 5" in reason
            for reason in payload["facets"]["corpus_incomplete_reasons"]
        )

        # And exactly the page's slugs were asked about — one hop each.
        asked = [
            call.args[0]
            for call in fake.await_args_list
            if call.args[0] not in ("/coord/work-units", "/coord/agent-work-units")
        ]
        assert len(asked) == 2
        assert [path.rsplit("/", 1)[-1] for path in asked] == stems[:2]

    async def test_the_off_page_reason_names_axis_c(
        self, client: httpx.AsyncClient, async_db_session: AsyncSession
    ) -> None:
        stems = sorted(_stem(f"reason{i}") for i in range(3))
        for stem in stems:
            await _plan_artifact(
                async_db_session, org_id=None, slug=stem, status="draft"
            )
        with _patched(_coord([_unit(s, status="vetted") for s in stems])):
            resp = await client.get(RECONCILIATION, params={"limit": 1, "offset": 2})
        payload = resp.json()
        assert [row["slug"] for row in payload["items"]] == [stems[2]]
        assert payload["offset"] == 2
        assert payload["ordering"] == "slug_asc"
        # The returned row IS on the page, so its axis C was derived.
        assert payload["items"][0]["axis_c"]["computed"] is True
        assert _AXIS_C_OFF_PAGE.startswith("axis C")


@_ASYNC
class TestCoordDegradation:
    async def test_an_unreadable_coord_makes_every_row_unknown(
        self, client: httpx.AsyncClient, async_db_session: AsyncSession
    ) -> None:
        """UNKNOWN, never "coord holds no work units" and never agreement."""
        stem = _stem("coord-down")
        await _plan_artifact(async_db_session, org_id=None, slug=stem, status="draft")
        fake = AsyncMock(side_effect=RuntimeError("connection refused"))
        with _patched(fake):
            resp = await client.get(RECONCILIATION, params={"limit": 100})
        payload = resp.json()

        assert payload["work_unit_population_state"] == "unavailable"
        assert payload["work_unit_population_reason"]
        assert payload["coord_available"] is False
        assert payload["facets"]["by_verdict"]["agree"] == 0
        row = payload["items"][0]
        assert row["classification"] == "UNKNOWN_AXIS_UNREADABLE"
        assert row["axis_a"]["readable"] is False
        assert row["axis_c"]["readable"] is False

    async def test_include_coord_false_is_a_stated_unknown_not_an_agreement(
        self, client: httpx.AsyncClient, async_db_session: AsyncSession
    ) -> None:
        stem = _stem("no-coord")
        await _plan_artifact(async_db_session, org_id=None, slug=stem, status="draft")
        fake = AsyncMock(side_effect=AssertionError("coord must not be called"))
        with _patched(fake):
            resp = await client.get(
                RECONCILIATION, params={"include_coord": "false", "limit": 100}
            )
        payload = resp.json()
        assert fake.await_count == 0
        assert payload["work_unit_population_state"] == "unavailable"
        assert "include_coord=false" in payload["work_unit_population_reason"]
        assert payload["items"][0]["classification"] == "UNKNOWN_AXIS_UNREADABLE"
        assert payload["facets"]["by_verdict"]["agree"] == 0


@_ASYNC
class TestFacetContract:
    async def test_facets_are_exhaustive_including_zeros_and_sum_to_the_denominator(
        self, client: httpx.AsyncClient, async_db_session: AsyncSession
    ) -> None:
        stem = _stem("facets")
        await _plan_artifact(async_db_session, org_id=None, slug=stem, status="draft")
        with _patched(_coord([_unit(stem, status="vetted")])):
            resp = await client.get(RECONCILIATION, params={"limit": 100})
        facets = resp.json()["facets"]

        # EVERY member, including the zeros: "no rows of class X" is a stated
        # fact here, not an absence.
        assert set(facets["by_class"]) == set(plan_status.CLASS_ORDER)
        assert sorted(facets["by_class"].values())[0] == 0
        assert set(facets["by_verdict"]) == set(_VERDICTS)
        assert sum(facets["by_class"].values()) == facets["denominator"]
        assert sum(facets["by_verdict"].values()) == facets["denominator"]
        assert facets["denominator"] == resp.json()["total"]

    async def test_an_empty_corpus_still_carries_every_facet(
        self, client: httpx.AsyncClient, async_db_session: AsyncSession
    ) -> None:
        with _patched(_coord([])):
            resp = await client.get(RECONCILIATION)
        payload = resp.json()
        assert payload["total"] == 0
        assert set(payload["facets"]["by_class"]) == set(plan_status.CLASS_ORDER)
        assert set(payload["facets"]["by_verdict"]) == set(_VERDICTS)
        assert payload["facets"]["denominator"] == 0
        # Nothing was blind: an empty corpus is complete, not incomplete.
        assert payload["facets"]["corpus_complete"] is True
        assert payload["facets"]["corpus_incomplete_reasons"] == []
        assert payload["document_axis_complete"] is True


class TestFacetContractRefusals:
    """The contract check itself, exercised directly on a doctored body."""

    def test_the_contract_refuses_a_non_exhaustive_facet_block(self) -> None:
        """coord's ``overview_contract_check``, applied here for the same reason."""
        facets = ReconciliationFacets(
            denominator=1,
            by_class={"AGREE_OPEN": 1},
            by_verdict={"agree": 1, "disagree": 0, "unknown": 0},
            corpus_complete=True,
        )
        violations = _reconciliation_contract_violations([], facets, 1)
        assert any("not exhaustive" in violation for violation in violations)

    def test_the_contract_refuses_a_denominator_that_does_not_match(self) -> None:
        by_class = dict.fromkeys(plan_status.CLASS_ORDER, 0)
        by_class["AGREE_OPEN"] = 1
        facets = ReconciliationFacets(
            denominator=2,
            by_class=by_class,
            by_verdict={"agree": 1, "disagree": 0, "unknown": 0},
            corpus_complete=True,
        )
        violations = _reconciliation_contract_violations([], facets, 2)
        assert any("sum(by_class)" in violation for violation in violations)

    def test_the_contract_refuses_agreement_on_an_incomplete_document_axis(
        self,
    ) -> None:
        """The belt to the cascade's braces, and the plan's central claim."""
        row = ReconciliationRow(
            slug="2026-09-03-fabricated",
            document_state="absent",
            document_axis_complete=False,
            axis_a={"readable": True, "present": True, "status": "shipped"},
            axis_b={
                "readable": True,
                "present": False,
                "document_state": "absent",
                "complete": False,
            },
            axis_c={"readable": True, "present": True},
            classification="AGREE_TERMINAL",
            verdict="agree",
            reason="fabricated for the test",
        )
        by_class = dict.fromkeys(plan_status.CLASS_ORDER, 0)
        by_class["AGREE_TERMINAL"] = 1
        facets = ReconciliationFacets(
            denominator=1,
            by_class=by_class,
            by_verdict={"agree": 1, "disagree": 0, "unknown": 0},
            corpus_complete=True,
        )
        violations = _reconciliation_contract_violations([row], facets, 1)
        assert any("incomplete document axis" in violation for violation in violations)

    def test_the_contract_refuses_an_inconsistent_completeness_flag(self) -> None:
        by_class = dict.fromkeys(plan_status.CLASS_ORDER, 0)
        facets = ReconciliationFacets(
            denominator=0,
            by_class=by_class,
            by_verdict={"agree": 0, "disagree": 0, "unknown": 0},
            corpus_complete=False,
            corpus_incomplete_reasons=[],
        )
        assert any(
            "no blind spot was named" in violation
            for violation in _reconciliation_contract_violations([], facets, 0)
        )


@_ASYNC
class TestStrictQuery:
    async def test_an_undeclared_query_parameter_is_a_typed_422(
        self, client: httpx.AsyncClient
    ) -> None:
        """A discarded filter corrupts a count, which is what this read returns."""
        with _patched(_coord([])):
            resp = await client.get(RECONCILIATION, params={"verdict": "agree"})
        assert resp.status_code == 422
        body = resp.json()
        assert json.dumps(body).count("unknown_query_parameter") >= 1

    async def test_the_declared_parameters_are_accepted(
        self, client: httpx.AsyncClient
    ) -> None:
        with _patched(_coord([])):
            resp = await client.get(
                RECONCILIATION,
                params={"offset": 0, "limit": 10, "include_coord": "true"},
            )
        assert resp.status_code == 200


@_ASYNC
class TestThisSurfaceNeverWrites:
    async def test_the_read_leaves_every_stored_status_untouched(
        self, client: httpx.AsyncClient, async_db_session: AsyncSession
    ) -> None:
        """``shipped`` is DERIVED. Nothing here writes a status (D5).

        The reconciler adds no writer at all: where it finds drift the
        correction path is the existing ``plan-steward``, and a direct
        ``shipped`` write is a ``422 status_is_derived`` on coord's side.
        """
        stem = _stem("readonly")
        artifact = await _plan_artifact(
            async_db_session, org_id=None, slug=stem, status="draft"
        )
        before = (artifact.status, artifact.updated_at, artifact.current_version)

        fake = _coord(
            [_unit(stem, status="shipped")],
            by_slug={
                stem: {
                    "delivery": _delivery(shipped=True, evidence_complete=True),
                    "citations": [{"repo": "r", "pr_number": 3}],
                }
            },
        )
        with _patched(fake):
            resp = await client.get(RECONCILIATION, params={"limit": 100})
        assert resp.status_code == 200
        assert _by_slug(resp.json())[stem]["classification"] == "DOC_UNDERSTATES"

        await async_db_session.refresh(artifact)
        assert (
            artifact.status,
            artifact.updated_at,
            artifact.current_version,
        ) == before

        # And coord was only ever READ.
        for call in fake.await_args_list:
            assert "params" in call.kwargs or call.args
