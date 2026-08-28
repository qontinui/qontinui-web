"""Session Repository — decoder, CRUD and HTTP tests.

Phase 4 of ``2026-08-26-claude-code-session-repository-in-qontinui-web``.

Three layers, mirroring ``tests/test_plan_library_api.py``:

* **Layer 0 — pure unit.** The transcript decoder and the two honesty
  predicates. No database, so these never skip.
* **Layer 1 — CRUD against the shared async session.** The upsert's
  two-writer merge contract, the filters, and the full-text predicate.
* **Layer 2 — full HTTP.** ``httpx.AsyncClient`` + ``ASGITransport`` (NOT
  ``TestClient``) so the handler runs in the SAME asyncio loop as the shared
  session, with the db, auth and object-store dependencies overridden.

The tests that matter most are not the happy paths. They are the four
invariants Phase 4 exists to enforce, each asserted against the MECHANISM
rather than the intention:

* ``organization_id`` has no request field and is not upsertable.
* tenancy is never derived from the caller — an unattributed upsert stays
  ``unknown``/``NULL`` rather than inheriting the principal's organization.
* the ``?q=`` predicate is the model's own index constant, verbatim.
* a ``coord_redacted`` body's digest is never reported as verifiable, and an
  unavailable coord degrades to a stated UNKNOWN rather than to silence.
"""

from __future__ import annotations

import base64
import hashlib
import json
from datetime import UTC, datetime, timedelta
from typing import Any
from unittest.mock import patch
from uuid import UUID, uuid4

import httpx
import pytest
import pytest_asyncio
from fastapi import FastAPI
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.endpoints import session_repository as api
from app.crud import session_artifact as crud
from app.models.session_artifact import (
    SESSION_SEARCH_TSVECTOR_SQL,
    SessionArtifact,
)
from app.schemas.session_repository import SessionArtifactUpsert

API_PREFIX = "/api/v1/session-repository"

pytestmark = pytest.mark.asyncio


def _sid(stem: str = "s") -> str:
    """A unique Claude session id — the session rolls back, but be
    independent anyway."""
    return f"{stem}-{uuid4().hex}"


def _transcript(*turns: dict[str, Any]) -> bytes:
    """A minimal Claude Code JSONL transcript."""
    return ("\n".join(json.dumps(t) for t in turns) + "\n").encode("utf-8")


def _user_turn(text: str) -> dict[str, Any]:
    return {
        "type": "user",
        "uuid": uuid4().hex,
        "timestamp": "2026-08-26T10:00:00Z",
        "message": {"role": "user", "content": text},
    }


def _assistant_turn(*blocks: dict[str, Any]) -> dict[str, Any]:
    return {
        "type": "assistant",
        "uuid": uuid4().hex,
        "timestamp": "2026-08-26T10:00:01Z",
        "message": {"role": "assistant", "content": list(blocks)},
    }


# ===========================================================================
# Layer 0 — the decoder and the honesty predicates (no database)
# ===========================================================================


class TestTranscriptDecoder:
    def test_blank_lines_are_structure_not_turns(self) -> None:
        raw = b'{"type":"user"}\n\n\n{"type":"assistant"}\n'
        turns, total = api._decode_turns(raw, offset=0, limit=10, include_raw=False)
        assert total == 2
        # The ORIGINAL line numbers survive, so a turn can still be pointed
        # back at its place in the file.
        assert [t.line_number for t in turns] == [1, 4]

    def test_a_malformed_line_becomes_an_error_turn_not_a_gap(self) -> None:
        """A dropped line is indistinguishable from a session saying nothing."""
        raw = b'{"type":"user"}\nnot json at all\n{"type":"assistant"}\n'
        turns, total = api._decode_turns(raw, offset=0, limit=10, include_raw=False)
        assert total == 3, "the malformed line is still a line"
        assert turns[1].parse_error is not None
        assert turns[1].line_number == 2
        assert turns[1].text is None

    def test_a_non_object_line_is_reported_rather_than_coerced(self) -> None:
        raw = b"[1, 2, 3]\n"
        turns, _ = api._decode_turns(raw, offset=0, limit=10, include_raw=False)
        assert turns[0].parse_error is not None
        assert "list" in turns[0].parse_error

    def test_non_text_blocks_are_summarised_in_place_not_dropped(self) -> None:
        """A turn that was three tool calls is still a turn that did something."""
        raw = _transcript(
            _assistant_turn(
                {"type": "text", "text": "running it"},
                {"type": "tool_use", "name": "Bash", "input": {}},
                {"type": "tool_result", "content": "ok"},
            )
        )
        turns, _ = api._decode_turns(raw, offset=0, limit=10, include_raw=False)
        assert turns[0].text is not None
        assert "running it" in turns[0].text
        assert "[tool_use: Bash]" in turns[0].text
        assert "[tool_result]" in turns[0].text

    def test_a_summary_record_carries_its_text_at_the_top_level(self) -> None:
        raw = _transcript({"type": "summary", "summary": "did the thing"})
        turns, _ = api._decode_turns(raw, offset=0, limit=10, include_raw=False)
        assert turns[0].text == "did the thing"

    def test_only_the_requested_window_is_parsed(self) -> None:
        raw = _transcript(*[_user_turn(f"turn {i}") for i in range(50)])
        turns, total = api._decode_turns(raw, offset=10, limit=5, include_raw=False)
        assert total == 50
        assert [t.index for t in turns] == [10, 11, 12, 13, 14]
        assert turns[0].text == "turn 10"

    def test_raw_is_omitted_unless_asked_for(self) -> None:
        raw = _transcript(_user_turn("hi"))
        without, _ = api._decode_turns(raw, offset=0, limit=1, include_raw=False)
        withit, _ = api._decode_turns(raw, offset=0, limit=1, include_raw=True)
        assert without[0].raw is None
        assert withit[0].raw is not None


class TestDigestHonesty:
    """``body_source`` is what stops a redacted digest reading as verified."""

    def test_disk_verbatim_with_a_digest_is_verifiable(self) -> None:
        row = SessionArtifact(
            claude_session_id="x", body_source="disk_verbatim", content_sha256="a" * 64
        )
        assert api._digest_verifiable(row) is True

    def test_coord_redacted_is_never_verifiable_even_with_a_digest(self) -> None:
        row = SessionArtifact(
            claude_session_id="x",
            body_source="coord_redacted",
            content_sha256="a" * 64,
        )
        assert api._digest_verifiable(row) is False

    def test_no_digest_is_not_verifiable(self) -> None:
        row = SessionArtifact(
            claude_session_id="x", body_source="disk_verbatim", content_sha256=None
        )
        assert api._digest_verifiable(row) is False


class TestOrganizationIsNotARequestField:
    """Invariant 1, asserted against the two mechanisms that enforce it."""

    def test_the_upsert_schema_has_nowhere_to_put_an_organization(self) -> None:
        assert "organization_id" not in SessionArtifactUpsert.model_fields

    def test_the_column_is_not_upsertable(self) -> None:
        assert "organization_id" not in crud.UPSERTABLE_COLUMNS

    def test_an_extra_organization_id_key_is_not_carried_into_the_write(
        self,
    ) -> None:
        """Even if a caller sends one, it cannot reach ``setattr``."""
        payload = SessionArtifactUpsert.model_validate(
            {"claude_session_id": "s", "organization_id": str(uuid4())}
        )
        assert "organization_id" not in payload.model_fields_set


class TestUpsertValidation:
    """The cross-field rules, each stopping one specific silent lie."""

    def test_two_body_spellings_are_rejected(self) -> None:
        with pytest.raises(ValueError, match="never both"):
            SessionArtifactUpsert(
                claude_session_id="s",
                body="a",
                body_base64=base64.b64encode(b"a").decode(),
                body_source="disk_verbatim",
            )

    def test_a_body_with_no_source_is_rejected(self) -> None:
        with pytest.raises(ValueError, match="body_source is required"):
            SessionArtifactUpsert(claude_session_id="s", body="a")

    def test_a_tenant_with_no_provenance_is_rejected(self) -> None:
        with pytest.raises(ValueError, match="tenant_source is required"):
            SessionArtifactUpsert(claude_session_id="s", tenant_id=uuid4())

    def test_declared_with_no_tenant_declares_nothing(self) -> None:
        with pytest.raises(ValueError, match="declares nothing"):
            SessionArtifactUpsert(claude_session_id="s", tenant_source="declared")

    def test_a_derived_tenant_needs_no_apology(self) -> None:
        """The weak labels are legal — that is the whole point of the column."""
        payload = SessionArtifactUpsert(
            claude_session_id="s",
            tenant_id=uuid4(),
            tenant_source="derived_sole_binding",
        )
        assert payload.tenant_source == "derived_sole_binding"


class TestSearchPredicateMatchesTheIndex:
    """The documented index-usability trap, asserted rather than trusted."""

    def test_the_q_predicate_is_built_from_the_model_constant(self) -> None:
        stmt = crud._apply_filters(
            __import__("sqlalchemy").select(SessionArtifact),
            org_id=None,
            q="hello",
        )
        sql = str(stmt.compile(compile_kwargs={"literal_binds": False}))
        assert SESSION_SEARCH_TSVECTOR_SQL in sql, (
            "the ?q= predicate no longer spells the indexed expression "
            "verbatim — it will still return the right rows, it will just "
            "silently stop using ix_session_artifacts_search"
        )


# ===========================================================================
# Layer 1 — CRUD
# ===========================================================================


async def _make(
    db: AsyncSession, *, org_id: UUID | None = None, **fields: Any
) -> SessionArtifact:
    claude_session_id = fields.pop("claude_session_id", None) or _sid()
    account_label = fields.pop("account_label", None)
    row, _created, _changed = await crud.upsert_artifact(
        db,
        org_id=org_id,
        claude_session_id=claude_session_id,
        account_label=account_label,
        fields=fields,
    )
    return row


class TestUpsertMergeContract:
    """Two writers, one row — plan §5's contract, which is where the archive
    is lost if it is broken."""

    async def test_metadata_only_write_does_not_erase_the_archived_body(
        self, async_db_session: AsyncSession
    ) -> None:
        sid = _sid()
        row = await _make(
            async_db_session,
            claude_session_id=sid,
            body_object_key="k/1.jsonl",
            content_sha256="a" * 64,
            byte_count=123,
            body_source="disk_verbatim",
        )
        # The archiver's metadata promotion: lifecycle only, no body fields.
        row2, created, changed = await crud.upsert_artifact(
            async_db_session,
            org_id=None,
            claude_session_id=sid,
            account_label=None,
            fields={"closeout_state": "unfinished", "state": "closed"},
        )
        assert created is False and changed is True
        assert row2.id == row.id
        assert row2.body_object_key == "k/1.jsonl", (
            "the archiver's metadata pass erased the runner's archived body"
        )
        assert row2.content_sha256 == "a" * 64
        assert row2.byte_count == 123
        assert row2.closeout_state == "unfinished"

    async def test_an_unchanged_write_reports_changed_false(
        self, async_db_session: AsyncSession
    ) -> None:
        sid = _sid()
        await _make(async_db_session, claude_session_id=sid, repo="qontinui-web")
        _row, created, changed = await crud.upsert_artifact(
            async_db_session,
            org_id=None,
            claude_session_id=sid,
            account_label=None,
            fields={"repo": "qontinui-web"},
        )
        assert created is False
        assert changed is False

    async def test_unknown_keys_never_reach_the_row(
        self, async_db_session: AsyncSession
    ) -> None:
        row = await _make(
            async_db_session,
            repo="qontinui-web",
            **{"organization_id": uuid4(), "not_a_column": "x"},
        )
        assert row.organization_id is None
        assert not hasattr(row, "not_a_column") or (
            getattr(row, "not_a_column", None) != "x"
        )

    async def test_account_label_is_part_of_identity(
        self, async_db_session: AsyncSession
    ) -> None:
        """The same session id under two account homes is two sessions."""
        sid = _sid()
        a = await _make(async_db_session, claude_session_id=sid, account_label="paktis")
        b = await _make(async_db_session, claude_session_id=sid, account_label="jspin")
        assert a.id != b.id

    async def test_a_null_label_and_an_empty_label_are_one_identity(
        self, async_db_session: AsyncSession
    ) -> None:
        """Mirrors the index's ``coalesce(account_label, '')``."""
        sid = _sid()
        a = await _make(async_db_session, claude_session_id=sid, account_label=None)
        found = await crud.get_by_identity(
            async_db_session, claude_session_id=sid, account_label=""
        )
        assert found is not None and found.id == a.id

    async def test_the_identity_lookup_is_organization_blind(
        self, async_db_session: AsyncSession
    ) -> None:
        """``get_by_identity`` addresses a SESSION, not a session-per-org.

        This is the mechanism the fork fix rests on: the web archiver has no
        calling principal and can only write ``organization_id = NULL``, so an
        org-scoped identity lookup could never find the runner's row (or vice
        versa) and every session written by both writers became two rows.
        """
        sid = _sid()
        owner = uuid4()
        row = await _make(
            async_db_session, org_id=owner, claude_session_id=sid, account_label="p"
        )
        found = await crud.get_by_identity(
            async_db_session, claude_session_id=sid, account_label="p"
        )
        assert found is not None and found.id == row.id
        assert found.organization_id == owner


class TestFilters:
    async def test_tenant_source_is_filterable(
        self, async_db_session: AsyncSession
    ) -> None:
        """Plan §3.6 rule 2: a guessed attribution must be SEPARABLE."""
        tid = uuid4()
        await _make(
            async_db_session, tenant_id=tid, tenant_source="declared", repo="r1"
        )
        await _make(
            async_db_session, tenant_id=tid, tenant_source="ambiguous", repo="r1"
        )
        rows, total = await crud.list_artifacts(
            async_db_session, org_id=None, repo="r1", tenant_source="ambiguous"
        )
        assert total == 1
        assert rows[0].tenant_source == "ambiguous"

    async def test_secret_finding_filters_select_but_never_hide(
        self, async_db_session: AsyncSession
    ) -> None:
        await _make(
            async_db_session,
            repo="r2",
            secret_finding_count=2,
            secret_finding_kinds=["aws_access_key_id", "pem_block"],
        )
        await _make(async_db_session, repo="r2", secret_finding_kinds=[])
        await _make(async_db_session, repo="r2")  # detector never ran

        _rows, with_findings = await crud.list_artifacts(
            async_db_session, org_id=None, repo="r2", has_secret_findings=True
        )
        assert with_findings == 1

        _rows, by_kind = await crud.list_artifacts(
            async_db_session,
            org_id=None,
            repo="r2",
            secret_finding_kind="pem_block",
        )
        assert by_kind == 1

        # NULL (never scanned) and '{}' (scanned, clean) stay distinguishable.
        _rows, scanned = await crud.list_artifacts(
            async_db_session, org_id=None, repo="r2", detector_ran=True
        )
        _rows, unscanned = await crud.list_artifacts(
            async_db_session, org_id=None, repo="r2", detector_ran=False
        )
        assert scanned == 2
        assert unscanned == 1

        # And the unfiltered read still returns all three: the signal is an
        # audit filter, not a visibility gate.
        _rows, everything = await crud.list_artifacts(
            async_db_session, org_id=None, repo="r2"
        )
        assert everything == 3

    async def test_since_excludes_a_row_with_no_recorded_activity(
        self, async_db_session: AsyncSession
    ) -> None:
        now = datetime.now(UTC)
        await _make(async_db_session, repo="r3", last_activity_at=now)
        await _make(async_db_session, repo="r3", last_activity_at=None)
        _rows, total = await crud.list_artifacts(
            async_db_session,
            org_id=None,
            repo="r3",
            since=now - timedelta(minutes=1),
        )
        assert total == 1

    async def test_full_text_search_hits_the_indexed_columns(
        self, async_db_session: AsyncSession
    ) -> None:
        await _make(
            async_db_session,
            repo="r4",
            ai_title="Refactor the merge train predicate",
            first_prompt="please look at the scheduler",
        )
        await _make(async_db_session, repo="r4", ai_title="Something else entirely")

        _rows, hits = await crud.list_artifacts(
            async_db_session, org_id=None, repo="r4", q="scheduler"
        )
        assert hits == 1

    async def test_closeout_counts_report_every_bucket(
        self, async_db_session: AsyncSession
    ) -> None:
        await _make(async_db_session, closeout_state="unfinished")
        await _make(async_db_session, closeout_state="clean")
        counts = await crud.closeout_state_counts(async_db_session, org_id=None)
        assert counts.get("unfinished", 0) >= 1
        assert counts.get("clean", 0) >= 1


class TestOrgScope:
    async def test_a_row_in_another_org_is_invisible(
        self, async_db_session: AsyncSession
    ) -> None:
        other = uuid4()
        row = await _make(async_db_session, org_id=other, repo="r5")
        assert await crud.get_artifact(async_db_session, row.id, org_id=None) is None
        assert (
            await crud.get_artifact(async_db_session, row.id, org_id=other)
        ) is not None

    async def test_reads_stay_org_scoped_although_identity_is_not(
        self, async_db_session: AsyncSession
    ) -> None:
        """Dropping the org from the KEY must not widen what a caller can READ.

        The two predicates are separate on purpose: one row per real session,
        but only its owner's bucket lists it.
        """
        owner = uuid4()
        await _make(async_db_session, org_id=owner, repo="r6")
        _rows, mine = await crud.list_artifacts(
            async_db_session, org_id=owner, repo="r6"
        )
        _rows, theirs = await crud.list_artifacts(
            async_db_session, org_id=uuid4(), repo="r6"
        )
        _rows, nullbucket = await crud.list_artifacts(
            async_db_session, org_id=None, repo="r6"
        )
        assert mine == 1
        assert theirs == 0
        assert nullbucket == 0


class TestOrganizationFillIn:
    """The one asymmetric write ``upsert_artifact`` is allowed to make.

    Identity no longer carries the organization, so an org-less row written by
    the principal-less archiver and an authenticated runner POST are the SAME
    row. Fill-in is what turns that row from unowned into properly scoped;
    refusing the other two directions is what stops the same door being a way
    to take a row off its owner.
    """

    async def test_an_org_less_row_is_filled_in_by_an_authenticated_caller(
        self, async_db_session: AsyncSession
    ) -> None:
        sid = _sid()
        row = await _make(async_db_session, org_id=None, claude_session_id=sid)
        assert row.organization_id is None

        owner = uuid4()
        filled, created, changed = await crud.upsert_artifact(
            async_db_session,
            org_id=owner,
            claude_session_id=sid,
            account_label=None,
            fields={"repo": "qontinui-web"},
        )
        assert created is False, "the fill-in must UPDATE, never fork a second row"
        assert changed is True
        assert filled.id == row.id
        assert filled.organization_id == owner

    async def test_the_fill_in_alone_counts_as_a_change(
        self, async_db_session: AsyncSession
    ) -> None:
        """A caller re-POSTing identical metadata still needs to hear that the
        row moved — it just changed owner, which is not nothing."""
        sid = _sid()
        await _make(async_db_session, org_id=None, claude_session_id=sid, repo="r7")
        _row, created, changed = await crud.upsert_artifact(
            async_db_session,
            org_id=uuid4(),
            claude_session_id=sid,
            account_label=None,
            fields={"repo": "r7"},
        )
        assert created is False
        assert changed is True

    async def test_a_different_org_never_moves_the_row(
        self, async_db_session: AsyncSession
    ) -> None:
        """Fill-in only. A second caller's organization does not take the row."""
        sid = _sid()
        owner = uuid4()
        interloper = uuid4()
        row = await _make(async_db_session, org_id=owner, claude_session_id=sid)

        same, created, _changed = await crud.upsert_artifact(
            async_db_session,
            org_id=interloper,
            claude_session_id=sid,
            account_label=None,
            fields={"repo": "somewhere-else"},
        )
        assert created is False, "a second org must not fork the row either"
        assert same.id == row.id
        assert same.organization_id == owner, (
            "the row was moved to another organization — fill-in must be fill-in ONLY"
        )

    async def test_an_unauthenticated_writer_never_blanks_an_organization(
        self, async_db_session: AsyncSession
    ) -> None:
        """The archiver's own next cycle passes ``org_id=None``; that must not
        un-scope a row the runner already claimed."""
        sid = _sid()
        owner = uuid4()
        await _make(async_db_session, org_id=owner, claude_session_id=sid)

        row, _created, _changed = await crud.upsert_artifact(
            async_db_session,
            org_id=None,
            claude_session_id=sid,
            account_label=None,
            fields={"closeout_state": "unfinished"},
        )
        assert row.organization_id == owner
        assert row.closeout_state == "unfinished"

    async def test_organization_id_is_still_not_upsertable_from_a_payload(
        self, async_db_session: AsyncSession
    ) -> None:
        """The fill-in is derived from the principal — it is not a payload path."""
        assert "organization_id" not in crud.UPSERTABLE_COLUMNS
        sid = _sid()
        owner = uuid4()
        await _make(async_db_session, org_id=owner, claude_session_id=sid)
        row, _created, _changed = await crud.upsert_artifact(
            async_db_session,
            org_id=owner,
            claude_session_id=sid,
            account_label=None,
            fields={"organization_id": uuid4()},
        )
        assert row.organization_id == owner


# ===========================================================================
# Layer 2 — HTTP
# ===========================================================================


class _FakeStore:
    """An in-memory stand-in for the object store.

    The real backend is exercised by the storage service's own tests; what
    matters here is the endpoint's contract with it — that bytes go in
    verbatim and come back verbatim, and that a missing object is reported
    rather than rendered as an empty transcript.
    """

    def __init__(self) -> None:
        self.objects: dict[str, bytes] = {}

    async def store(self, key: str, data: bytes) -> None:
        self.objects[key] = data

    async def load(self, key: str) -> bytes:
        return self.objects[key]


def _build_app(*, db_session: AsyncSession, user, tenant_id: UUID) -> FastAPI:
    """Mount the router with db + both auth arms + the admin gate overridden.

    ``current_active_user_optional`` is overridden because every dual-auth
    route resolves through it; ``require_coord_tenant_admin`` because the one
    admin-gated route would otherwise try to reach coord for an ``is_admin``
    verdict. The auth WIRING is not what these tests are about — the handlers
    are.
    """
    from app.api.deps import (
        current_active_user,
        current_active_user_optional,
        get_async_db,
    )

    app = FastAPI()
    app.dependency_overrides[current_active_user] = lambda: user
    app.dependency_overrides[current_active_user_optional] = lambda: user
    app.dependency_overrides[api.require_coord_tenant_admin] = lambda: tenant_id

    async def _db_override():
        yield db_session

    app.dependency_overrides[get_async_db] = _db_override
    app.include_router(api.router, prefix=API_PREFIX)
    return app


@pytest_asyncio.fixture()
async def api_user(async_db_session: AsyncSession):
    """A real ``auth.users`` row to authenticate as."""
    from app.models.user import User

    user = User(
        email=f"sessrepo_{uuid4().hex[:8]}@example.com",
        username=f"sessrepo_{uuid4().hex[:8]}",
        full_name="Session Repository Tester",
        is_active=True,
        is_verified=True,
    )
    async_db_session.add(user)
    await async_db_session.commit()
    await async_db_session.refresh(user)
    return user


@pytest_asyncio.fixture()
async def personal_org(async_db_session: AsyncSession, api_user):
    """A real personal organization owned by ``api_user``.

    Needed by the tenancy invariant test: without one the principal resolves
    to the NULL org bucket, and ``organization_id is None`` would be
    indistinguishable from ``tenant_id is None`` — so the test that tenancy is
    NOT derived from the org would pass for the wrong reason.
    """
    from app.models.organization import Organization

    org = Organization(
        name=f"Personal {uuid4().hex[:6]}",
        slug=f"personal-{uuid4().hex[:10]}",
        owner_id=api_user.id,
        settings={"is_personal": True},
    )
    async_db_session.add(org)
    await async_db_session.commit()
    await async_db_session.refresh(org)
    return org


@pytest_asyncio.fixture()
async def store():
    """Patch the endpoint's two object-store helpers with an in-memory store."""
    fake = _FakeStore()
    with (
        patch.object(api, "_store_body", fake.store),
        patch.object(api, "_load_body", fake.load),
    ):
        yield fake


@pytest_asyncio.fixture()
async def client(async_db_session: AsyncSession, api_user, store):
    app = _build_app(db_session=async_db_session, user=api_user, tenant_id=uuid4())
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(
        transport=transport, base_url="http://test"
    ) as http_client:
        yield http_client


@pytest_asyncio.fixture()
async def client_with_org(
    async_db_session: AsyncSession, api_user, personal_org, store
):
    """The same client, but authenticating as a principal that HAS an org."""
    app = _build_app(db_session=async_db_session, user=api_user, tenant_id=uuid4())
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(
        transport=transport, base_url="http://test"
    ) as http_client:
        yield http_client


def _payload(**overrides: Any) -> dict[str, Any]:
    body = {
        "claude_session_id": _sid(),
        "account_label": "paktis",
        "body": _transcript(
            _user_turn("hello"), _assistant_turn({"type": "text", "text": "hi"})
        ).decode("utf-8"),
        "body_source": "disk_verbatim",
    }
    body.update(overrides)
    return body


class TestUpsertHttp:
    async def test_create_stores_the_body_and_computes_the_digest(
        self, client: httpx.AsyncClient, store: _FakeStore
    ) -> None:
        payload = _payload()
        created = await client.post(API_PREFIX, json=payload)
        assert created.status_code == 201, created.text
        body = created.json()
        assert body["created"] is True
        assert body["body_written"] is True

        artifact = body["artifact"]
        raw = payload["body"].encode("utf-8")
        assert artifact["content_sha256"] == hashlib.sha256(raw).hexdigest()
        assert artifact["byte_count"] == len(raw)
        assert artifact["body_object_key"] in store.objects
        assert store.objects[artifact["body_object_key"]] == raw

    async def test_the_object_key_is_deterministic_across_rescans(
        self, client: httpx.AsyncClient, store: _FakeStore
    ) -> None:
        """An idempotent backfill must not orphan an object per run."""
        payload = _payload()
        first = await client.post(API_PREFIX, json=payload)
        second = await client.post(API_PREFIX, json=payload)
        assert second.status_code == 200, second.text
        assert second.headers.get("X-Session-Unchanged") == "true"
        assert (
            first.json()["artifact"]["body_object_key"]
            == second.json()["artifact"]["body_object_key"]
        )
        assert len(store.objects) == 1

    async def test_base64_carries_bytes_a_json_string_cannot(
        self, client: httpx.AsyncClient, store: _FakeStore
    ) -> None:
        raw = b'{"type":"user"}\n\xff\xfe not utf-8 \n'
        resp = await client.post(
            API_PREFIX,
            json=_payload(
                body=None,
                body_base64=base64.b64encode(raw).decode(),
            ),
        )
        assert resp.status_code == 201, resp.text
        key = resp.json()["artifact"]["body_object_key"]
        assert store.objects[key] == raw
        assert (
            resp.json()["artifact"]["content_sha256"] == hashlib.sha256(raw).hexdigest()
        )

    async def test_a_disagreeing_client_digest_is_rejected(
        self, client: httpx.AsyncClient
    ) -> None:
        resp = await client.post(API_PREFIX, json=_payload(content_sha256="b" * 64))
        assert resp.status_code == 422
        assert "content_sha256 does not match" in resp.text

    async def test_a_metadata_only_promotion_keeps_the_body(
        self, client: httpx.AsyncClient
    ) -> None:
        """Plan §5's two writers, over HTTP this time."""
        payload = _payload()
        created = await client.post(API_PREFIX, json=payload)
        key = created.json()["artifact"]["body_object_key"]

        promoted = await client.post(
            API_PREFIX,
            json={
                "claude_session_id": payload["claude_session_id"],
                "account_label": payload["account_label"],
                "closeout_state": "unfinished",
            },
        )
        assert promoted.status_code == 200, promoted.text
        assert promoted.json()["body_written"] is False
        artifact = promoted.json()["artifact"]
        assert artifact["body_object_key"] == key
        assert artifact["closeout_state"] == "unfinished"

    async def test_tenancy_is_never_invented_for_an_unattributed_session(
        self, client_with_org: httpx.AsyncClient, personal_org
    ) -> None:
        """Invariant 2 — the correctness requirement this phase turns on.

        The caller here HAS a personal organization, which is exactly the
        condition under which copying the plan library's ``_resolve_org_id``
        idiom for tenancy would fire: every shared-tenant session would be
        filed under whichever operator's personal org happened to POST it.

        The assertion is therefore a pair, and both halves matter:

        * ``organization_id`` IS the principal's personal organization — the
          org axis is derived from the caller, and invariant 1 still holds.
        * ``tenant_id`` is NULL and ``tenant_source`` is ``unknown`` — the
          tenant axis was NOT derived from that same principal. An
          unattributed session stays unattributed and says so.
        """
        resp = await client_with_org.post(API_PREFIX, json=_payload())
        assert resp.status_code == 201, resp.text
        artifact = resp.json()["artifact"]

        assert artifact["organization_id"] == str(personal_org.id)
        assert artifact["tenant_id"] is None, (
            "tenancy was derived from the caller — this is plan §3.6 rule 1, "
            "the single correctness requirement Phase 4 exists to hold"
        )
        assert artifact["tenant_source"] == "unknown"

    async def test_a_supplied_tenant_is_stored_verbatim_with_its_provenance(
        self, client: httpx.AsyncClient
    ) -> None:
        tid = str(uuid4())
        resp = await client.post(
            API_PREFIX,
            json=_payload(tenant_id=tid, tenant_source="derived_repo"),
        )
        artifact = resp.json()["artifact"]
        assert artifact["tenant_id"] == tid
        assert artifact["tenant_source"] == "derived_repo"

    async def test_a_caller_supplied_organization_id_is_ignored(
        self, client_with_org: httpx.AsyncClient, personal_org
    ) -> None:
        """Invariant 1 over the wire: the org comes from the principal.

        Run against a principal that HAS an organization, so the assertion is
        "it took the RIGHT one" rather than the weaker "it did not take the
        forged one" — which a NULL-bucket principal would satisfy by accident.
        """
        forged = str(uuid4())
        resp = await client_with_org.post(
            API_PREFIX, json=_payload(organization_id=forged)
        )
        assert resp.status_code == 201, resp.text
        assert resp.json()["artifact"]["organization_id"] == str(personal_org.id)

    async def test_a_body_with_no_source_is_a_422_not_a_500(
        self, client: httpx.AsyncClient
    ) -> None:
        resp = await client.post(API_PREFIX, json=_payload(body_source=None))
        assert resp.status_code == 422

    async def test_a_bad_tenant_source_is_a_422_not_an_integrity_error(
        self, client: httpx.AsyncClient
    ) -> None:
        resp = await client.post(
            API_PREFIX,
            json=_payload(tenant_id=str(uuid4()), tenant_source="vibes"),
        )
        assert resp.status_code == 422

    async def test_a_failed_body_write_records_nothing(
        self, client: httpx.AsyncClient, async_db_session: AsyncSession
    ) -> None:
        """A head row pointing at bytes that are not there is worse than none."""
        payload = _payload()

        async def _boom(key: str, data: bytes) -> None:
            raise RuntimeError("bucket on fire")

        with patch.object(api, "_store_body", _boom):
            resp = await client.post(API_PREFIX, json=payload)
        assert resp.status_code == 502
        assert (
            await crud.get_by_identity(
                async_db_session,
                claude_session_id=payload["claude_session_id"],
                account_label=payload["account_label"],
            )
            is None
        )


class TestReadsHttp:
    async def test_list_filters_and_returns_the_two_honesty_columns(
        self, client: httpx.AsyncClient
    ) -> None:
        await client.post(
            API_PREFIX,
            json=_payload(
                repo="qontinui-web",
                ai_title="the merge train predicate",
                tenant_id=str(uuid4()),
                tenant_source="ambiguous",
            ),
        )
        resp = await client.get(API_PREFIX, params={"q": "predicate"})
        assert resp.status_code == 200, resp.text
        page = resp.json()
        assert page["total"] == 1
        row = page["items"][0]
        assert row["tenant_source"] == "ambiguous"
        assert row["body_source"] == "disk_verbatim"

        filtered = await client.get(API_PREFIX, params={"tenant_source": "declared"})
        assert filtered.json()["total"] == 0

    async def test_detail_carries_a_bounded_turn_index(
        self, client: httpx.AsyncClient
    ) -> None:
        raw = _transcript(*[_user_turn(f"turn {i}") for i in range(10)])
        created = await client.post(API_PREFIX, json=_payload(body=raw.decode("utf-8")))
        artifact_id = created.json()["artifact"]["id"]

        full = await client.get(f"{API_PREFIX}/{artifact_id}")
        assert full.status_code == 200, full.text
        body = full.json()
        assert body["turn_index_state"] == "present"
        assert body["decoded_turn_count"] == 10
        assert len(body["turn_index"]) == 10
        assert body["digest_verifiable"] is True

        truncated = await client.get(
            f"{API_PREFIX}/{artifact_id}", params={"turn_index_limit": 3}
        )
        assert truncated.json()["turn_index_state"] == "truncated"
        assert len(truncated.json()["turn_index"]) == 3

        skipped = await client.get(
            f"{API_PREFIX}/{artifact_id}", params={"include_turn_index": "false"}
        )
        assert skipped.json()["turn_index_state"] == "not_requested"
        assert skipped.json()["turn_index"] is None

    async def test_a_metadata_only_row_reports_unavailable_not_empty(
        self, client: httpx.AsyncClient
    ) -> None:
        created = await client.post(
            API_PREFIX,
            json={"claude_session_id": _sid(), "account_label": "paktis"},
        )
        artifact_id = created.json()["artifact"]["id"]
        resp = await client.get(f"{API_PREFIX}/{artifact_id}")
        body = resp.json()
        assert body["turn_index_state"] == "unavailable"
        assert body["turn_index_unavailable_reason"]
        assert body["turn_index"] is None

    async def test_turns_pages_and_reports_the_total(
        self, client: httpx.AsyncClient
    ) -> None:
        raw = _transcript(*[_user_turn(f"turn {i}") for i in range(30)])
        created = await client.post(API_PREFIX, json=_payload(body=raw.decode("utf-8")))
        artifact_id = created.json()["artifact"]["id"]

        resp = await client.get(
            f"{API_PREFIX}/{artifact_id}/turns", params={"from": 25, "limit": 10}
        )
        assert resp.status_code == 200, resp.text
        page = resp.json()
        assert page["total"] == 30
        assert len(page["items"]) == 5
        assert page["items"][0]["text"] == "turn 25"
        assert page["items"][0]["raw"] is None
        assert page["digest_verifiable"] is True

    async def test_turns_on_a_bodyless_row_is_409_not_404(
        self, client: httpx.AsyncClient
    ) -> None:
        """The SESSION exists; it is the body that does not."""
        created = await client.post(API_PREFIX, json={"claude_session_id": _sid()})
        artifact_id = created.json()["artifact"]["id"]
        resp = await client.get(f"{API_PREFIX}/{artifact_id}/turns")
        assert resp.status_code == 409

    async def test_export_is_byte_verbatim_with_a_matching_digest(
        self, client: httpx.AsyncClient
    ) -> None:
        raw = _transcript(_user_turn("hello"), _user_turn("goodbye"))
        created = await client.post(API_PREFIX, json=_payload(body=raw.decode("utf-8")))
        artifact_id = created.json()["artifact"]["id"]

        resp = await client.get(f"{API_PREFIX}/{artifact_id}/export")
        assert resp.status_code == 200, resp.text
        assert resp.content == raw
        assert resp.headers["X-Content-Sha256"] == hashlib.sha256(raw).hexdigest()
        assert resp.headers["X-Content-Sha256-Match"] == "true"
        assert resp.headers["X-Digest-Verifiable"] == "true"
        assert resp.headers["X-Body-Source"] == "disk_verbatim"

    async def test_a_coord_redacted_export_is_never_reported_as_verifiable(
        self, client: httpx.AsyncClient
    ) -> None:
        """Plan §5: a digest over redacted bytes cannot be checked against the
        original, and the API must not present it as if it could."""
        raw = _transcript(_user_turn("hello"))
        created = await client.post(
            API_PREFIX,
            json=_payload(body=raw.decode("utf-8"), body_source="coord_redacted"),
        )
        artifact_id = created.json()["artifact"]["id"]

        resp = await client.get(f"{API_PREFIX}/{artifact_id}/export")
        assert resp.status_code == 200
        # The digest of the SERVED bytes is still true and still matches the
        # stored one — what is false is that it proves anything about the
        # transcript on disk.
        assert resp.headers["X-Content-Sha256-Match"] == "true"
        assert resp.headers["X-Digest-Verifiable"] == "false"
        assert resp.headers["X-Body-Source"] == "coord_redacted"

    async def test_a_row_with_secret_findings_is_neither_hidden_nor_masked(
        self, client: httpx.AsyncClient
    ) -> None:
        """An audit signal, not a gate (plan §4 Phase 1 / §5)."""
        raw = _transcript(_user_turn("AKIAIOSFODNN7EXAMPLE"))
        created = await client.post(
            API_PREFIX,
            json=_payload(
                body=raw.decode("utf-8"),
                secret_finding_count=1,
                secret_finding_kinds=["aws_access_key_id"],
            ),
        )
        artifact_id = created.json()["artifact"]["id"]

        listed = await client.get(API_PREFIX)
        assert any(r["id"] == artifact_id for r in listed.json()["items"])

        exported = await client.get(f"{API_PREFIX}/{artifact_id}/export")
        assert exported.content == raw, "the export was masked"

        audited = await client.get(API_PREFIX, params={"has_secret_findings": "true"})
        assert audited.json()["total"] == 1

    async def test_export_reports_a_digest_disagreement_rather_than_hiding_it(
        self, client: httpx.AsyncClient, store: _FakeStore
    ) -> None:
        raw = _transcript(_user_turn("hello"))
        created = await client.post(API_PREFIX, json=_payload(body=raw.decode("utf-8")))
        artifact_id = created.json()["artifact"]["id"]
        key = created.json()["artifact"]["body_object_key"]

        # Corrupt the stored object behind the row's back.
        store.objects[key] = b'{"type":"user"}\n'

        resp = await client.get(f"{API_PREFIX}/{artifact_id}/export")
        assert resp.status_code == 200
        assert resp.headers["X-Content-Sha256-Match"] == "false"
        assert (
            resp.headers["X-Content-Sha256"]
            == hashlib.sha256(b'{"type":"user"}\n').hexdigest()
        ), "X-Content-Sha256 must describe the bytes actually served"

    async def test_a_row_in_another_org_is_a_404(
        self, client: httpx.AsyncClient, async_db_session: AsyncSession
    ) -> None:
        row = await _make(async_db_session, org_id=uuid4())
        resp = await client.get(f"{API_PREFIX}/{row.id}")
        assert resp.status_code == 404


class TestUnfinishedHttp:
    async def test_it_reports_the_unevaluated_bucket_beside_the_answer(
        self, client: httpx.AsyncClient
    ) -> None:
        """An empty ``items`` beside a large ``unknown_count`` must not read
        as "everything was closed out"."""
        await client.post(API_PREFIX, json=_payload(closeout_state="unfinished"))
        await client.post(API_PREFIX, json=_payload(closeout_state="clean"))
        await client.post(API_PREFIX, json=_payload())  # defaults to unknown

        with patch.object(
            api, "_proxy_coord_get", side_effect=RuntimeError("coord is down")
        ):
            resp = await client.get(f"{API_PREFIX}/unfinished")
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["total"] == 1
        assert body["items"][0]["closeout_state"] == "unfinished"
        assert body["unknown_count"] == 1
        assert body["clean_count"] == 1

    async def test_an_unreachable_coord_is_unknown_not_empty(
        self, client: httpx.AsyncClient
    ) -> None:
        with patch.object(
            api, "_proxy_coord_get", side_effect=RuntimeError("coord is down")
        ):
            resp = await client.get(f"{API_PREFIX}/unfinished")
        signal = resp.json()["coord_outstanding"]
        assert signal["available"] is False
        assert signal["unavailable_reason"]
        assert "UNKNOWN" in signal["unavailable_reason"]
        assert signal["payload"] is None

    async def test_coords_ledger_is_attached_when_it_answers(
        self, client: httpx.AsyncClient
    ) -> None:
        async def _ok(path: str, **kwargs: Any) -> Any:
            assert path == "/coord/session-compliance/outstanding"
            return {"items": [{"session_id": "abc", "state": "deferred"}]}

        async def _tenant(_request: Any) -> UUID:
            return uuid4()

        with (
            patch.object(api, "_proxy_coord_get", _ok),
            patch.object(api, "get_tenant_id", _tenant),
        ):
            resp = await client.get(f"{API_PREFIX}/unfinished")
        signal = resp.json()["coord_outstanding"]
        assert signal["available"] is True
        assert signal["payload"]["items"][0]["session_id"] == "abc"


class TestRelaunchHttp:
    async def test_a_transfer_is_never_reported_as_a_resume(
        self, client: httpx.AsyncClient
    ) -> None:
        """Plan §3.5: a transfer is replay-as-context, and labelling it a
        resume is how state is silently lost."""
        raw = _transcript(*[_user_turn(f"turn {i}") for i in range(10)])
        created = await client.post(API_PREFIX, json=_payload(body=raw.decode("utf-8")))
        artifact_id = created.json()["artifact"]["id"]

        resp = await client.post(
            f"{API_PREFIX}/{artifact_id}/relaunch",
            json={"mode": "transfer", "context_turns": 3},
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["restore_tier"] == "replay_as_context"
        assert body["dispatched"] is False
        assert len(body["context_turns"]) == 3
        assert body["context_turns"][0]["text"] == "turn 7"
        joined = " ".join(body["notices"])
        assert "not a resume" in joined
        assert "auto-continue" in joined

    async def test_a_resume_without_a_coord_session_is_a_named_409(
        self, client: httpx.AsyncClient
    ) -> None:
        """coord prunes a closed session after 7 days — the archive outlives
        the handoff subject by design, so this is expected, not exceptional."""
        created = await client.post(API_PREFIX, json=_payload())
        artifact_id = created.json()["artifact"]["id"]

        resp = await client.post(
            f"{API_PREFIX}/{artifact_id}/relaunch",
            json={"mode": "resume", "target_device_id": str(uuid4())},
        )
        assert resp.status_code == 409
        detail = resp.json()["detail"]
        assert detail["error"] == "no_coord_session"
        # It hands back what a manual relaunch needs rather than a bare failure.
        assert "claude_session_id" in detail

    async def test_a_resume_needs_a_target_device(
        self, client: httpx.AsyncClient
    ) -> None:
        created = await client.post(
            API_PREFIX, json=_payload(coord_session_id=str(uuid4()))
        )
        artifact_id = created.json()["artifact"]["id"]
        resp = await client.post(
            f"{API_PREFIX}/{artifact_id}/relaunch", json={"mode": "resume"}
        )
        assert resp.status_code == 422
        assert "target_device_id is required" in resp.text

    async def test_a_resume_dispatches_through_the_shipped_handoff_subject(
        self, client: httpx.AsyncClient
    ) -> None:
        """No new spawn channel — the plan is explicit that one must not be
        built."""
        coord_session_id = str(uuid4())
        target = str(uuid4())
        created = await client.post(
            API_PREFIX, json=_payload(coord_session_id=coord_session_id)
        )
        artifact_id = created.json()["artifact"]["id"]

        seen: dict[str, Any] = {}

        async def _post(path: str, body: Any, **kwargs: Any) -> Any:
            seen["path"] = path
            seen["body"] = body
            return {"status": "queued"}

        with patch.object(api, "_proxy_coord_post", _post):
            resp = await client.post(
                f"{API_PREFIX}/{artifact_id}/relaunch",
                json={"mode": "resume", "target_device_id": target},
            )
        assert resp.status_code == 200, resp.text
        assert seen["path"] == f"/sessions/{coord_session_id}/handoff"
        assert seen["body"]["target_device_id"] == target
        body = resp.json()
        assert body["restore_tier"] == "full"
        assert body["dispatched"] is True
        assert body["coord_response"] == {"status": "queued"}


class TestTheTwoWritersConvergeOnOneRow:
    """The cross-phase regression this change exists for.

    Plan §5 gives ``agent.session_artifacts`` two legitimate writers:

    * ``app.jobs.session_archiver`` — a scheduled job with NO calling
      principal, so every row it writes carries ``organization_id = NULL``;
    * the runner — authenticated through ``POST /api/v1/session-repository``,
      so it always carries one.

    While ``organization_id`` was part of ``uq_session_artifacts_identity``,
    those two writers produced TWO rows for one real session — and it never
    healed: the archiver's next cycle saw two candidates for the session id,
    correctly refused to guess between them, and counted ``ambiguous_identity``
    forever. The tests below drive the REAL archiver store and the REAL HTTP
    door in that order and assert the corpus stays single.
    """

    async def test_the_archivers_row_and_the_runners_post_are_one_row(
        self,
        client_with_org: httpx.AsyncClient,
        async_db_session: AsyncSession,
        personal_org,
        store: _FakeStore,
    ) -> None:
        from sqlalchemy import func as sa_func
        from sqlalchemy import select as sa_select

        from app.jobs.session_archiver import Promotion, SqlArtifactStore

        sid = _sid()
        tenant_id = uuid4()
        coord_session_id = uuid4()

        # ── writer 1: the archiver, with no calling principal at all ──────
        archiver_store = SqlArtifactStore(async_db_session)
        outcome = await archiver_store.apply(
            Promotion(
                claude_session_id=sid,
                tenant_id=tenant_id,
                fields={
                    "tenant_id": tenant_id,
                    "tenant_source": "derived_sole_binding",
                    "coord_session_id": coord_session_id,
                    "closeout_state": "unfinished",
                    "state": "closed",
                    "session_name": "a session coord knew about",
                },
            )
        )
        await async_db_session.commit()
        assert outcome == "inserted"

        archived = await crud.get_by_identity(
            async_db_session, claude_session_id=sid, account_label=None
        )
        assert archived is not None
        assert archived.organization_id is None, (
            "the archiver has no principal; a non-NULL org here would mean it "
            "guessed one"
        )

        # ── writer 2: the runner, authenticated, with the verbatim bytes ──
        raw = _transcript(_user_turn("hello"), _user_turn("goodbye"))
        resp = await client_with_org.post(
            API_PREFIX,
            json={
                "claude_session_id": sid,
                "body": raw.decode("utf-8"),
                "body_source": "disk_verbatim",
                "repo": "qontinui-web",
            },
        )
        assert resp.status_code == 200, (
            "the runner's POST created a SECOND row (201) instead of updating "
            f"the archiver's: {resp.text}"
        )
        assert resp.json()["created"] is False

        # ── exactly one row, carrying BOTH writers' work ──────────────────
        total = (
            await async_db_session.execute(
                sa_select(sa_func.count())
                .select_from(SessionArtifact)
                .where(SessionArtifact.claude_session_id == sid)
            )
        ).scalar_one()
        assert total == 1, (
            f"the corpus forked: {total} rows for one (claude_session_id, "
            "account_label). This is the defect the identity change closes."
        )

        merged = await crud.get_by_identity(
            async_db_session, claude_session_id=sid, account_label=None
        )
        assert merged is not None
        assert merged.id == archived.id, (
            "the runner replaced the row instead of merging"
        )

        # The row is now properly scoped — the fill-in the archiver could
        # never do for itself.
        assert merged.organization_id == personal_org.id

        # The runner's body and digest survived...
        assert merged.body_object_key is not None
        assert store.objects[merged.body_object_key] == raw
        assert merged.content_sha256 == hashlib.sha256(raw).hexdigest()
        assert merged.byte_count == len(raw)
        assert merged.body_source == "disk_verbatim"
        assert merged.repo == "qontinui-web"

        # ...and so did the archiver's coord-side metadata, which nothing else
        # in the system can reproduce once coord prunes the session.
        assert merged.tenant_id == tenant_id
        assert merged.tenant_source == "derived_sole_binding"
        assert merged.coord_session_id == coord_session_id
        assert merged.closeout_state == "unfinished"
        assert merged.session_name == "a session coord knew about"

    async def test_the_archivers_next_cycle_finds_one_row_not_an_ambiguity(
        self,
        client_with_org: httpx.AsyncClient,
        async_db_session: AsyncSession,
    ) -> None:
        """The second half of the old defect: it did not self-heal.

        After the fork, ``SqlArtifactStore.snapshot`` returned two rows for one
        ``claude_session_id``, ``_resolve_target`` correctly declined to guess,
        and the session was counted ``ambiguous_identity`` on every cycle
        thereafter — permanently unarchivable. One row means the next cycle has
        a target again.
        """
        from app.jobs.session_archiver import (
            Promotion,
            SqlArtifactStore,
            _resolve_target,
        )

        sid = _sid()
        archiver_store = SqlArtifactStore(async_db_session)
        await archiver_store.apply(
            Promotion(
                claude_session_id=sid,
                tenant_id=uuid4(),
                fields={"state": "closed"},
            )
        )
        await async_db_session.commit()

        resp = await client_with_org.post(
            API_PREFIX, json={"claude_session_id": sid, "repo": "qontinui-web"}
        )
        assert resp.status_code == 200, resp.text

        snapshot = await archiver_store.snapshot([sid])
        rows = snapshot[sid]
        assert len(rows) == 1, (
            f"the archiver's next cycle sees {len(rows)} candidate rows for one "
            "session — that is the ambiguous_identity dead end"
        )

        target, ambiguous = _resolve_target(rows, None)
        assert ambiguous is False
        assert target is not None and target.id == rows[0].id

    async def test_two_account_homes_still_fork_and_that_is_correct(
        self,
        client_with_org: httpx.AsyncClient,
        async_db_session: AsyncSession,
    ) -> None:
        """The narrowing, asserted: ``account_label`` is STILL identity.

        Dropping the organization must not be over-read as "one row per session
        id". A resume rotation can hand two account homes the same session id,
        and those are two different sessions.
        """
        from sqlalchemy import func as sa_func
        from sqlalchemy import select as sa_select

        sid = _sid()
        for label in ("paktis-gmail", "jspin"):
            resp = await client_with_org.post(
                API_PREFIX, json={"claude_session_id": sid, "account_label": label}
            )
            assert resp.status_code == 201, resp.text

        total = (
            await async_db_session.execute(
                sa_select(sa_func.count())
                .select_from(SessionArtifact)
                .where(SessionArtifact.claude_session_id == sid)
            )
        ).scalar_one()
        assert total == 2
