"""Pure-logic tests for the Phase 3b session archiver.

Plan ``2026-08-26-claude-code-session-repository-in-qontinui-web``, Phase 3.
No DB and no HTTP: every seam of :mod:`app.jobs.session_archiver` is injected
(``CoordReader`` / ``ArtifactStore`` / the object store), which is exactly why
they exist.

The load-bearing suites, in the order the plan cares about them:

* :class:`TestContentSha256Verifies` — **the phase's exit criterion.** No row
  may carry a ``content_sha256`` that does not verify against its stored body.
* :class:`TestMetadataOnlyBoundary` — the archiver never writes a body over one
  the runner wrote, and never stamps a verbatim body source.
* :class:`TestCloseoutDerivation` — ``closeout_state`` is a pure function of
  three independent signals and defaults toward UNKNOWN, never toward clean.
* :class:`TestTenancy` — this writer can never produce ``declared``.
* :class:`TestCoordUnavailableIsUnknown` — an unreachable coord is UNKNOWN,
  explicitly flagged, never "no sessions".
* :class:`TestConsent` — default off; the gate is enforced per row.
* :class:`TestGcHorizonSignal` — the known race is countable, not silent.

⚠️ One thing this file deliberately does NOT test, because it cannot: that
this job's org-less write and the runner's authenticated ``POST`` converge on
ONE row. That is a property of ``uq_session_artifacts_identity`` and of
``crud.session_artifact.upsert_artifact``, so it is asserted against a real
database in ``tests/test_session_repository_api.py``
(``TestTheTwoWritersConvergeOnOneRow``). What lives here is the half that IS
pure: this writer must never invent an ``organization_id`` for itself, and the
one remaining cause of ``ambiguous_identity`` is two ACCOUNT HOMES — not the
org fork, which the identity change retired.
"""

from __future__ import annotations

import base64
import hashlib
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import UUID, uuid4

import pytest

from app.jobs import session_archiver as archiver
from app.jobs.session_archiver import (
    BODY_SOURCE_COORD,
    Candidate,
    ComplianceSignal,
    CoordUnavailable,
    DispositionSignal,
    ExistingRow,
    OpenWorkSignal,
    Promotion,
    artifact_state_for,
    at_gc_risk,
    closeout_signals,
    consented_tenants,
    derive_closeout_state,
    materialize_body,
    plan_promotions,
    restore_record_fields,
    retention_days,
    tenant_source_for,
    transcript_bytes,
)

NOW = datetime(2026, 8, 26, 12, 0, 0, tzinfo=UTC)
TENANT = UUID("11111111-1111-4111-8111-111111111111")
OTHER_TENANT = UUID("22222222-2222-4222-8222-222222222222")


# ---------------------------------------------------------------------------
# Fakes
# ---------------------------------------------------------------------------


class FakeStorage:
    """Stands in for ``ObjectStorageService``, keeping what it was handed.

    Records the EXACT bytes per key so a test can recompute the digest over
    what was actually stored rather than over what the caller meant to store —
    which is the whole point of the exit-criterion test.
    """

    def __init__(self) -> None:
        self.objects: dict[str, bytes] = {}

    def upload_bytes(
        self,
        data: bytes,
        prefix: str,
        filename: str,
        content_type: str | None = None,
        metadata: dict | None = None,
        generate_unique_name: bool = True,
    ) -> tuple[str, str]:
        key = f"{prefix}/{filename}"
        self.objects[key] = data
        return key, f"memory://{key}"


class FakeStore:
    """In-memory :class:`ArtifactStore`. Rows are plain dicts of written fields."""

    def __init__(self, rows: dict[str, list[ExistingRow]] | None = None) -> None:
        self.existing = rows or {}
        self.applied: list[Promotion] = []

    async def snapshot(self, claude_session_ids: Any) -> dict[str, list[ExistingRow]]:
        return {
            sid: rows
            for sid, rows in self.existing.items()
            if sid in set(claude_session_ids)
        }

    async def apply(self, promotion: Promotion) -> str:
        self.applied.append(promotion)
        return "updated" if promotion.target_id is not None else "inserted"


class FakeReader:
    """Scriptable :class:`CoordReader`."""

    def __init__(
        self,
        *,
        agent_rows: list[dict[str, Any]] | None = None,
        coord_rows: list[dict[str, Any]] | None = None,
        compliance: list[dict[str, Any]] | None = None,
        outstanding: list[dict[str, Any]] | None = None,
        transcripts: dict[str, bytes] | None = None,
        restore: dict[str, dict[str, Any]] | None = None,
        fail: bool = False,
    ) -> None:
        self.agent_rows = agent_rows or []
        self.coord_rows = coord_rows or []
        self.compliance = compliance or []
        self.outstanding = outstanding or []
        self.transcripts = transcripts or {}
        self.restore = restore or {}
        self.fail = fail

    def _guard(self) -> None:
        if self.fail:
            raise CoordUnavailable("coord is not reachable")

    async def list_agent_sessions(
        self, *, since: datetime, limit: int
    ) -> list[dict[str, Any]]:
        self._guard()
        return self.agent_rows

    async def list_coord_sessions(self, *, since: datetime) -> list[dict[str, Any]]:
        self._guard()
        return self.coord_rows

    async def resolve_output(
        self, claude_session_id: str, *, tier: str, limit: int
    ) -> dict[str, Any] | None:
        self._guard()
        row = next(
            (r for r in self.coord_rows if r.get("_claude_id") == claude_session_id),
            None,
        )
        if row is None:
            return None
        data = self.transcripts.get(claude_session_id, b"")
        chunks = (
            [
                {
                    "chunk_offset": 0,
                    "payload_b64": base64.b64encode(data).decode("ascii"),
                }
            ]
            if data
            else []
        )
        if tier == "cold" and not data:
            chunks = []
        return {
            "session_id": row["id"],
            "tier": tier,
            "stream": "transcript",
            "chunks": chunks if limit > 1 else chunks[:1],
            "count": len(chunks),
        }

    async def list_compliance(self, *, limit: int) -> list[dict[str, Any]]:
        self._guard()
        return self.compliance

    async def list_outstanding(self) -> list[dict[str, Any]]:
        self._guard()
        return self.outstanding

    async def read_restore_record(
        self, claude_session_id: str
    ) -> dict[str, Any] | None:
        self._guard()
        return self.restore.get(claude_session_id)


def _session(
    claude_id: str,
    *,
    tenant: UUID = TENANT,
    closed_days_ago: float | None = None,
    kind: str = "terminal_claude",
    state: str | None = None,
) -> tuple[dict[str, Any], dict[str, Any]]:
    """One coord session, as the two rows the archiver joins."""
    coord_id = str(uuid4())
    closed_at = (
        (NOW - timedelta(days=closed_days_ago)).isoformat()
        if closed_days_ago is not None
        else None
    )
    agent_row = {
        "id": claude_id,
        "device_id": str(uuid4()),
        "first_seen": (NOW - timedelta(days=10)).isoformat(),
        "last_seen": (NOW - timedelta(days=1)).isoformat(),
        "label": "a session",
        "derived_name": "brave-otter",
        "closed_at": closed_at,
    }
    coord_row = {
        "id": coord_id,
        "_claude_id": claude_id,
        "tenant_id": str(tenant),
        "device_id": agent_row["device_id"],
        "session_kind": kind,
        "state": state or ("closed" if closed_at else "active"),
        "started_at": agent_row["first_seen"],
        "closed_at": closed_at,
        "repo": "qontinui-web",
        "branch": "main",
        "provider": "claude",
        "work_unit_slug": "some-plan",
        "task_run_id": "tr-1",
    }
    return agent_row, coord_row


async def _run(
    reader: FakeReader,
    store: FakeStore,
    *,
    storage: FakeStorage | None = None,
    consented: frozenset[UUID] = frozenset({TENANT}),
    now: datetime = NOW,
    days: int = 7,
    **kwargs: Any,
) -> dict[str, Any]:
    return await archiver.archive_tenant_once(
        tenant_id=TENANT,
        reader=reader,
        store=store,
        consented=consented,
        now=now,
        days=days,
        storage=storage or FakeStorage(),
        **kwargs,
    )


# ---------------------------------------------------------------------------


class TestContentSha256Verifies:
    """Phase 3's exit criterion, asserted rather than promised."""

    @pytest.mark.asyncio
    async def test_written_digest_matches_the_stored_bytes(self) -> None:
        payload = b'{"type":"user","text":"hello"}\n{"type":"assistant"}\n'
        storage = FakeStorage()
        body = await materialize_body(
            payload,
            tenant_id=TENANT,
            claude_session_id="11111111-2222-4333-8444-555555555555",
            storage=storage,
        )
        assert body is not None
        stored = storage.objects[body.object_key]
        assert hashlib.sha256(stored).hexdigest() == body.content_sha256
        assert body.byte_count == len(stored)

    @pytest.mark.asyncio
    async def test_every_body_a_cycle_writes_verifies(self) -> None:
        """End-to-end: no promotion may carry an unverifiable digest."""
        payload = b'{"turn":1}\n{"turn":2}\n'
        agent_row, coord_row = _session(
            "aaaa1111-2222-4333-8444-555555555555", closed_days_ago=6
        )
        reader = FakeReader(
            agent_rows=[agent_row],
            coord_rows=[coord_row],
            transcripts={agent_row["id"]: payload},
        )
        storage = FakeStorage()
        store = FakeStore()
        stats = await _run(reader, store, storage=storage)

        assert stats["bodies_written"] == 1
        written = [p for p in store.applied if p.body is not None]
        assert written, "the fallback should have produced a body"
        for promotion in written:
            assert promotion.body is not None
            stored = storage.objects[promotion.body.object_key]
            assert hashlib.sha256(stored).hexdigest() == promotion.body.content_sha256
            assert promotion.body.byte_count == len(stored)

    @pytest.mark.asyncio
    async def test_no_digest_is_recorded_without_bytes(self) -> None:
        """An empty transcript records NO body — not a digest of nothing."""
        assert (
            await materialize_body(
                b"",
                tenant_id=TENANT,
                claude_session_id="x",
                storage=FakeStorage(),
            )
            is None
        )

    def test_transcript_bytes_reassembles_in_offset_order(self) -> None:
        envelope = {
            "chunks": [
                {
                    "chunk_offset": 10,
                    "payload_b64": base64.b64encode(b"world").decode(),
                },
                {
                    "chunk_offset": 0,
                    "payload_b64": base64.b64encode(b"hello ").decode(),
                },
            ]
        }
        assert transcript_bytes(envelope) == b"hello world"

    def test_transcript_bytes_tolerates_a_bad_chunk(self) -> None:
        envelope = {
            "chunks": [
                {"chunk_offset": 0, "payload_b64": base64.b64encode(b"ok").decode()},
                {"chunk_offset": 1, "payload_b64": "!!!not base64!!!"},
                {"chunk_offset": 2, "payload_b64": None},
            ]
        }
        assert transcript_bytes(envelope) == b"ok"


class TestMetadataOnlyBoundary:
    """The runner is the sole writer of verbatim bodies (plan §5)."""

    @pytest.mark.asyncio
    async def test_never_overwrites_a_body_the_runner_wrote(self) -> None:
        agent_row, coord_row = _session(
            "bbbb1111-2222-4333-8444-555555555555", closed_days_ago=6
        )
        existing = ExistingRow(
            id=uuid4(),
            claude_session_id=agent_row["id"],
            coord_session_id=UUID(coord_row["id"]),
            has_body=True,
        )
        reader = FakeReader(
            agent_rows=[agent_row],
            coord_rows=[coord_row],
            transcripts={agent_row["id"]: b'{"turn":1}\n'},
        )
        store = FakeStore({agent_row["id"]: [existing]})
        stats = await _run(reader, store)

        assert stats["bodies_written"] == 0
        assert stats["updated"] == 1
        assert store.applied[0].body is None
        assert store.applied[0].wants_body_fallback is False

    @pytest.mark.asyncio
    async def test_fallback_stamps_coord_redacted(self) -> None:
        agent_row, coord_row = _session(
            "cccc1111-2222-4333-8444-555555555555", closed_days_ago=6
        )
        reader = FakeReader(
            agent_rows=[agent_row],
            coord_rows=[coord_row],
            transcripts={agent_row["id"]: b'{"turn":1}\n'},
        )
        store = FakeStore()
        await _run(reader, store)
        body = store.applied[0].body
        assert body is not None
        assert body.body_source == BODY_SOURCE_COORD
        assert body.body_source != "disk_verbatim"

    @pytest.mark.asyncio
    async def test_normal_path_writes_no_body_field_at_all(self) -> None:
        """A session that is nowhere near the horizon is metadata-only."""
        agent_row, coord_row = _session(
            "dddd1111-2222-4333-8444-555555555555", closed_days_ago=1
        )
        reader = FakeReader(
            agent_rows=[agent_row],
            coord_rows=[coord_row],
            transcripts={agent_row["id"]: b'{"turn":1}\n'},
        )
        store = FakeStore()
        stats = await _run(reader, store)
        assert stats["bodies_written"] == 0
        promotion = store.applied[0]
        assert promotion.body is None
        assert not any(
            key in promotion.fields
            for key in (
                "body_object_key",
                "content_sha256",
                "byte_count",
                "body_source",
                "turn_count",
                "first_prompt",
                "last_prompt",
                "ai_title",
                "secret_finding_count",
                "secret_finding_kinds",
            )
        ), "the archiver must promote metadata only"

    @pytest.mark.asyncio
    async def test_relaunch_fields_ride_the_fallback_only(self) -> None:
        agent_row, coord_row = _session(
            "eeee1111-2222-4333-8444-555555555555", closed_days_ago=6
        )
        reader = FakeReader(
            agent_rows=[agent_row],
            coord_rows=[coord_row],
            transcripts={agent_row["id"]: b"x"},
            restore={
                agent_row["id"]: {
                    "cwd": "D:/qontinui-root/qontinui-web",
                    "launch_command": "claude --resume",
                    "restore_tier": "full",
                    "machine_id": "box-1",
                }
            },
        )
        store = FakeStore()
        await _run(reader, store)
        fields = store.applied[0].fields
        assert fields["working_dir"] == "D:/qontinui-root/qontinui-web"
        assert fields["restore_tier"] == "full"
        assert fields["machine_id"] == "box-1"

    @pytest.mark.asyncio
    async def test_every_field_the_archiver_emits_is_a_real_column(self) -> None:
        """A typo'd key would `setattr` onto the instance and never persist.

        Silent, and invisible in any test that only checks the promotion dict —
        so the whole emitted vocabulary is checked against the mapped columns
        once, on the path that produces the widest set (fallback + restore
        record).
        """
        from app.models.session_artifact import SessionArtifact

        columns = {c.key for c in SessionArtifact.__table__.columns}
        agent_row, coord_row = _session(
            "aaaa5555-2222-4333-8444-555555555555", closed_days_ago=6
        )
        reader = FakeReader(
            agent_rows=[agent_row],
            coord_rows=[coord_row],
            transcripts={agent_row["id"]: b"x"},
            restore={
                agent_row["id"]: {
                    "cwd": "D:/repo",
                    "launch_command": "claude",
                    "restore_tier": "full",
                    "machine_id": "m",
                    "provider": "claude",
                }
            },
        )
        store = FakeStore()
        await _run(reader, store)
        emitted = {k for p in store.applied for k in p.fields}
        assert emitted, "the cycle should have emitted fields"
        assert emitted <= columns, f"not columns: {sorted(emitted - columns)}"

    @pytest.mark.asyncio
    async def test_the_archiver_never_emits_an_organization(self) -> None:
        """It has no calling principal, so it has nothing honest to write.

        Worth its own assertion now that ``organization_id`` is no longer part
        of the identity key: the temptation the change creates is to have this
        job "helpfully" fill the column in from the tenant or from whatever
        credential it authenticated to coord with. Both would be a guess, and
        plan §3.6 rule 1 forbids exactly that class of invention. The column is
        filled in by the runner's authenticated POST instead
        (``crud.session_artifact.upsert_artifact``), which actually knows.
        """
        rows = [_session(f"7777{i}111-2222-4333-8444-55555555555{i}") for i in range(3)]
        reader = FakeReader(
            agent_rows=[a for a, _ in rows], coord_rows=[c for _, c in rows]
        )
        store = FakeStore()
        await _run(reader, store)
        assert store.applied
        assert not any("organization_id" in p.fields for p in store.applied)

    def test_apply_fields_cannot_reach_organization_id(self) -> None:
        """The write rule, at the setattr site rather than at the producer.

        ``_apply_fields`` copies whatever ``Promotion.fields`` holds, so the
        guarantee above is only as strong as the producer unless the column is
        absent from every path. This pins the shape a future edit would have to
        break deliberately.
        """
        agent_row, coord_row = _session("8888ffff-2222-4333-8444-555555555555")
        promotion = archiver.build_promotion(
            Candidate(
                claude_session_id=agent_row["id"],
                agent_row=agent_row,
                coord_row=coord_row,
                coord_session_id=UUID(coord_row["id"]),
                coord_holds_transcript=False,
            ),
            signals={},
            existing=None,
            now=NOW,
            days=7,
        )
        assert promotion is not None
        assert "organization_id" not in promotion.fields

    def test_restore_record_projection_drops_blanks(self) -> None:
        assert restore_record_fields({"cwd": "  ", "restore_tier": "full"}) == {
            "restore_tier": "full"
        }
        assert restore_record_fields(None) == {}


class TestCloseoutDerivation:
    """``closeout_state`` — derived from three signals, defaults to UNKNOWN."""

    def test_open_gate_beats_a_clean_footer(self) -> None:
        assert (
            derive_closeout_state(
                ComplianceSignal(verdict="verified"),
                DispositionSignal(item_states=("landed",)),
                OpenWorkSignal(open_gate_ids=("gate-1",)),
            )
            == "unfinished"
        )

    def test_unlanded_pr_beats_a_clean_footer(self) -> None:
        assert (
            derive_closeout_state(
                ComplianceSignal(verdict="verified"),
                DispositionSignal(item_states=("landed",)),
                OpenWorkSignal(contradicted_refs=("phase-2",)),
            )
            == "unfinished"
        )

    def test_absent_footer_reads_unfinished(self) -> None:
        signal = ComplianceSignal(verdict="unverified", reason="absent")
        assert signal.footer_absent is True
        assert (
            derive_closeout_state(signal, DispositionSignal(), OpenWorkSignal())
            == "unfinished"
        )

    def test_unreconciled_footer_reads_unfinished(self) -> None:
        assert (
            derive_closeout_state(
                ComplianceSignal(verdict="unverified", unreconciled_count=2),
                DispositionSignal(item_states=("landed",)),
                OpenWorkSignal(),
            )
            == "unfinished"
        )

    def test_no_compliance_row_reads_unknown(self) -> None:
        assert derive_closeout_state(None, None, OpenWorkSignal()) == "unknown"

    def test_not_applicable_reads_unknown_not_clean(self) -> None:
        assert (
            derive_closeout_state(
                ComplianceSignal(verdict="not_applicable", reason="enforcement off"),
                DispositionSignal(item_states=("landed",)),
                OpenWorkSignal(),
            )
            == "unknown"
        )

    def test_verified_without_a_disposition_reads_unknown(self) -> None:
        """Plan §3.4 signal 2: closed without a taxonomy is unknown, not clean."""
        assert (
            derive_closeout_state(
                ComplianceSignal(verdict="verified"),
                DispositionSignal(item_states=()),
                OpenWorkSignal(),
            )
            == "unknown"
        )

    def test_clean_requires_all_three_signals_to_agree(self) -> None:
        assert (
            derive_closeout_state(
                ComplianceSignal(verdict="verified"),
                DispositionSignal(item_states=("landed", "surfaced")),
                OpenWorkSignal(),
            )
            == "clean"
        )

    def test_an_unknown_future_verdict_never_reads_clean(self) -> None:
        assert (
            derive_closeout_state(
                ComplianceSignal(verdict="probationary"),
                DispositionSignal(item_states=("landed",)),
                OpenWorkSignal(),
            )
            == "unknown"
        )

    def test_derivation_is_pure_and_repeatable(self) -> None:
        args = (
            ComplianceSignal(verdict="verified"),
            DispositionSignal(item_states=("landed",)),
            OpenWorkSignal(),
        )
        assert derive_closeout_state(*args) == derive_closeout_state(*args) == "clean"

    def test_signals_are_indexed_by_claude_session_id(self) -> None:
        sid = "ffff1111-2222-4333-8444-555555555555"
        signals = closeout_signals(
            compliance_rows=[
                {
                    "claude_session_id": sid,
                    "verdict": "verified",
                    "unreconciled_count": 0,
                    "report": {
                        "items": [
                            {"ref": "a", "state": "landed"},
                            {"ref": "b", "state": "gated"},
                        ]
                    },
                    "reconciliation": {
                        "items": [{"ref": "a", "outcome": "contradicted"}]
                    },
                }
            ],
            outstanding_rows=[{"claude_session_id": sid, "ref": "b", "gate_id": "g-1"}],
        )
        compliance, disposition, open_work = signals[sid]
        assert compliance.verdict == "verified"
        assert disposition.item_states == ("landed", "gated")
        assert open_work.open_gate_ids == ("g-1",)
        assert open_work.contradicted_refs == ("a",)
        assert derive_closeout_state(compliance, disposition, open_work) == "unfinished"

    def test_an_unrecognised_item_state_reads_open_not_finished(self) -> None:
        """A state a future coord invents must fail toward ``unfinished``.

        The finished set is enumerated (``landed``/``surfaced``) precisely so
        an unknown state cannot slip a session into ``clean``.
        """
        sid = "cccc4444-2222-4333-8444-555555555555"
        signals = closeout_signals(
            compliance_rows=[
                {
                    "claude_session_id": sid,
                    "verdict": "verified",
                    "report": {"items": [{"ref": "a", "state": "quarantined"}]},
                }
            ],
            outstanding_rows=[],
        )
        compliance, disposition, open_work = signals[sid]
        assert open_work.open_refs == ("a",)
        assert derive_closeout_state(compliance, disposition, open_work) == "unfinished"

    def test_a_fully_landed_report_has_no_open_work(self) -> None:
        sid = "dddd4444-2222-4333-8444-555555555555"
        signals = closeout_signals(
            compliance_rows=[
                {
                    "claude_session_id": sid,
                    "verdict": "verified",
                    "report": {
                        "items": [
                            {"ref": "a", "state": "landed"},
                            {"ref": "b", "state": "surfaced"},
                        ]
                    },
                }
            ],
            outstanding_rows=[],
        )
        assert signals[sid][2].any_open is False
        assert derive_closeout_state(*signals[sid]) == "clean"

    def test_outstanding_without_a_verdict_still_reads_unfinished(self) -> None:
        sid = "aaaa2222-2222-4333-8444-555555555555"
        signals = closeout_signals(
            compliance_rows=[],
            outstanding_rows=[{"claude_session_id": sid, "ref": "x", "gate_id": "g"}],
        )
        assert derive_closeout_state(*signals[sid]) == "unfinished"

    def test_newest_compliance_verdict_wins(self) -> None:
        sid = "bbbb2222-2222-4333-8444-555555555555"
        signals = closeout_signals(
            compliance_rows=[
                {
                    "claude_session_id": sid,
                    "verdict": "verified",
                    "report": {"items": [{"ref": "a", "state": "landed"}]},
                },
                {"claude_session_id": sid, "verdict": "unverified", "reason": "absent"},
            ],
            outstanding_rows=[],
        )
        assert signals[sid][0].verdict == "verified"


class TestTenancy:
    """Plan §3.6 — provenance is recorded, and never overstated."""

    def test_terminal_claude_is_never_declared(self) -> None:
        assert tenant_source_for("terminal_claude") == "derived_sole_binding"

    @pytest.mark.parametrize("kind", ["agentic", "workflow", "something_new"])
    def test_no_session_kind_earns_declared(self, kind: str) -> None:
        assert tenant_source_for(kind) != "declared"

    def test_unknown_kind_records_unknown(self) -> None:
        assert tenant_source_for(None) == "unknown"

    @pytest.mark.asyncio
    async def test_a_cycle_never_writes_declared(self) -> None:
        rows = [_session(f"1111{i}111-2222-4333-8444-55555555555{i}") for i in range(3)]
        reader = FakeReader(
            agent_rows=[a for a, _ in rows], coord_rows=[c for _, c in rows]
        )
        store = FakeStore()
        await _run(reader, store)
        assert store.applied
        assert all(p.fields["tenant_source"] != "declared" for p in store.applied)

    @pytest.mark.asyncio
    async def test_an_unattributable_session_is_skipped_not_guessed(self) -> None:
        """No coord row → no tenant → skipped, never filed under a guess."""
        agent_row, _ = _session("cccc2222-2222-4333-8444-555555555555")
        reader = FakeReader(agent_rows=[agent_row], coord_rows=[])
        store = FakeStore()
        stats = await _run(reader, store)
        assert store.applied == []
        assert stats["skipped"]["no_tenant"] == 1

    def test_apply_fields_never_weakens_tenant_source(self) -> None:
        class Row:
            tenant_source = "declared"
            body_object_key = None
            content_sha256 = None
            byte_count = None
            body_source = None

        row = Row()
        archiver._apply_fields(
            row,  # type: ignore[arg-type]
            Promotion(
                claude_session_id="s",
                tenant_id=TENANT,
                fields={"tenant_source": "derived_sole_binding"},
            ),
        )
        assert row.tenant_source == "declared"

    def test_apply_fields_fills_an_unknown_tenant_source(self) -> None:
        class Row:
            tenant_source = "unknown"
            body_object_key = None
            content_sha256 = None
            byte_count = None
            body_source = None

        row = Row()
        archiver._apply_fields(
            row,  # type: ignore[arg-type]
            Promotion(
                claude_session_id="s",
                tenant_id=TENANT,
                fields={"tenant_source": "derived_sole_binding"},
            ),
        )
        assert row.tenant_source == "derived_sole_binding"

    def test_apply_fields_never_blanks_an_existing_value(self) -> None:
        class Row:
            tenant_source = "unknown"
            launch_command = "claude --resume abc"
            body_object_key = None
            content_sha256 = None
            byte_count = None
            body_source = None

        row = Row()
        archiver._apply_fields(
            row,  # type: ignore[arg-type]
            Promotion(
                claude_session_id="s",
                tenant_id=TENANT,
                fields={"launch_command": None},
            ),
        )
        assert row.launch_command == "claude --resume abc"


class TestCoordUnavailableIsUnknown:
    """An unreachable coord is UNKNOWN, explicitly flagged — never empty."""

    @pytest.mark.asyncio
    async def test_cycle_reports_unreachable_and_writes_nothing(self) -> None:
        store = FakeStore()
        stats = await _run(FakeReader(fail=True), store)
        assert stats["coord_reachable"] is False
        assert "coord_error" in stats
        assert store.applied == []

    @pytest.mark.asyncio
    async def test_unreachable_is_not_reported_as_zero_candidates(self) -> None:
        """The honest shape: `candidates` stays 0 but `coord_reachable` is the
        field that says the 0 means nothing."""
        stats = await _run(FakeReader(fail=True), FakeStore())
        assert stats["candidates"] == 0
        assert stats["coord_reachable"] is False

    @pytest.mark.asyncio
    async def test_a_reachable_coord_with_nothing_to_do_is_distinguishable(
        self,
    ) -> None:
        stats = await _run(FakeReader(), FakeStore())
        assert stats["coord_reachable"] is True
        assert stats["candidates"] == 0


class TestConsent:
    """Plan §3.7 — default off, per tenant, enforced per row."""

    def test_unset_means_inert(self) -> None:
        assert consented_tenants(None) == frozenset()
        assert consented_tenants("") == frozenset()
        assert consented_tenants("   ") == frozenset()

    def test_parses_a_list(self) -> None:
        raw = f"{TENANT}, {OTHER_TENANT} ,"
        assert consented_tenants(raw) == frozenset({TENANT, OTHER_TENANT})

    def test_a_bad_entry_narrows_rather_than_raises(self) -> None:
        assert consented_tenants(f"not-a-uuid,{TENANT}") == frozenset({TENANT})

    @pytest.mark.asyncio
    async def test_inert_run_makes_no_coord_call(self, monkeypatch) -> None:
        monkeypatch.delenv(archiver.ENV_CONSENTED_TENANTS, raising=False)

        def _boom(*args: Any, **kwargs: Any) -> None:
            raise AssertionError("an inert archiver must not touch coord")

        monkeypatch.setattr(archiver, "ProxyCoordReader", _boom)
        result = await archiver.archive_all(_boom)  # type: ignore[arg-type]
        assert result == {"tenants": 0, "inert": True}

    @pytest.mark.asyncio
    async def test_a_non_consented_tenants_session_is_skipped(self) -> None:
        agent_row, coord_row = _session(
            "dddd2222-2222-4333-8444-555555555555", tenant=OTHER_TENANT
        )
        reader = FakeReader(agent_rows=[agent_row], coord_rows=[coord_row])
        store = FakeStore()
        stats = await _run(reader, store, consented=frozenset({TENANT}))
        assert store.applied == []
        assert stats["skipped"]["no_consent"] == 1


class TestPromotionPlanning:
    """The pure planner: ordering, identity, and the skip vocabulary."""

    def _candidate(self, claude_id: str, *, closed_days_ago: float | None) -> Candidate:
        agent_row, coord_row = _session(claude_id, closed_days_ago=closed_days_ago)
        return Candidate(
            claude_session_id=claude_id,
            agent_row=agent_row,
            coord_row=coord_row,
            coord_session_id=UUID(coord_row["id"]),
            coord_holds_transcript=False,
        )

    def test_nearest_the_horizon_is_promoted_first(self) -> None:
        near = self._candidate(
            "aaaa3333-2222-4333-8444-555555555555", closed_days_ago=6.5
        )
        far = self._candidate("bbbb3333-2222-4333-8444-555555555555", closed_days_ago=1)
        openish = self._candidate(
            "cccc3333-2222-4333-8444-555555555555", closed_days_ago=None
        )
        promotions, counts = plan_promotions(
            [openish, far, near],
            signals={},
            existing={},
            consented=frozenset({TENANT}),
            now=NOW,
            days=7,
            budget=1,
        )
        assert [p.claude_session_id for p in promotions] == [near.claude_session_id]
        assert counts["budget"] == 2

    def test_two_account_homes_are_ambiguous_and_neither_is_touched(self) -> None:
        """The ONLY surviving cause of ``ambiguous_identity``.

        Two stored rows sharing one ``claude_session_id`` can now differ by
        exactly one thing — the account home — because
        ``uq_session_artifacts_identity`` is
        ``(claude_session_id, coalesce(account_label, ''))`` and nothing else
        may duplicate. It used to ALSO fire for a fork this job caused itself:
        an org-less insert here plus the runner's org-carrying POST were two
        rows under the old org-keyed identity, and every later cycle then
        declined to touch either. That cause is gone; this one cannot be — no
        coord read exposes an account home, and guessing would corrupt a row.
        """
        candidate = self._candidate(
            "dddd3333-2222-4333-8444-555555555555", closed_days_ago=1
        )
        existing = {
            candidate.claude_session_id: [
                ExistingRow(id=uuid4(), claude_session_id=candidate.claude_session_id),
                ExistingRow(id=uuid4(), claude_session_id=candidate.claude_session_id),
            ]
        }
        promotions, counts = plan_promotions(
            [candidate],
            signals={},
            existing=existing,
            consented=frozenset({TENANT}),
            now=NOW,
            days=7,
        )
        assert promotions == []
        assert counts["ambiguous_identity"] == 1

    def test_a_matching_coord_session_id_disambiguates(self) -> None:
        candidate = self._candidate(
            "eeee3333-2222-4333-8444-555555555555", closed_days_ago=1
        )
        wanted = ExistingRow(
            id=uuid4(),
            claude_session_id=candidate.claude_session_id,
            coord_session_id=candidate.coord_session_id,
        )
        existing = {
            candidate.claude_session_id: [
                ExistingRow(id=uuid4(), claude_session_id=candidate.claude_session_id),
                wanted,
            ]
        }
        promotions, counts = plan_promotions(
            [candidate],
            signals={},
            existing=existing,
            consented=frozenset({TENANT}),
            now=NOW,
            days=7,
        )
        assert [p.target_id for p in promotions] == [wanted.id]
        assert counts["ambiguous_identity"] == 0

    @pytest.mark.asyncio
    async def test_soft_links_are_promoted(self) -> None:
        agent_row, coord_row = _session(
            "ffff3333-2222-4333-8444-555555555555", closed_days_ago=1
        )
        reader = FakeReader(agent_rows=[agent_row], coord_rows=[coord_row])
        store = FakeStore()
        await _run(reader, store)
        fields = store.applied[0].fields
        assert fields["coord_session_id"] == UUID(coord_row["id"])
        assert fields["work_unit_slug"] == "some-plan"
        assert fields["task_run_id"] == "tr-1"
        assert fields["tenant_id"] == TENANT
        assert fields["repo"] == "qontinui-web"
        assert fields["git_branch"] == "main"
        assert fields["state"] == "closed"
        assert fields["session_name"] == "a session"
        assert fields["name_source"] == "coord_label"


class TestLifecycleMapping:
    def test_only_closed_maps_to_closed(self) -> None:
        assert artifact_state_for("closed") == "closed"

    @pytest.mark.parametrize("state", ["active", "stale", "expected", None, "weird"])
    def test_everything_else_is_open_and_never_abandoned(self, state) -> None:
        assert artifact_state_for(state) == "open"

    def test_retention_days_defaults_to_coords_own(self) -> None:
        assert retention_days(None) == 7
        assert retention_days("") == 7
        assert retention_days("nonsense") == 7
        assert retention_days("0") == 7
        assert retention_days("14") == 14


class TestGcHorizonSignal:
    """The known race is countable, not silent."""

    def test_open_sessions_are_never_at_risk(self) -> None:
        assert at_gc_risk(None, now=NOW, days=7) is False

    def test_inside_the_window_is_at_risk(self) -> None:
        assert at_gc_risk(NOW - timedelta(days=6), now=NOW, days=7) is True

    def test_outside_the_window_is_not(self) -> None:
        assert at_gc_risk(NOW - timedelta(days=1), now=NOW, days=7) is False

    @pytest.mark.asyncio
    async def test_unarchived_at_risk_sessions_are_counted(self) -> None:
        """A session inside the window that consent excluded is still counted —
        the operator must see what is about to be lost, not just what was
        skipped."""
        agent_row, coord_row = _session(
            "aaaa4444-2222-4333-8444-555555555555",
            tenant=OTHER_TENANT,
            closed_days_ago=6,
        )
        reader = FakeReader(agent_rows=[agent_row], coord_rows=[coord_row])
        stats = await _run(reader, FakeStore(), consented=frozenset({TENANT}))
        assert stats["at_risk_unarchived"] == 1
        assert stats["oldest_at_risk"] is not None

    @pytest.mark.asyncio
    async def test_archived_sessions_are_not_counted_as_at_risk(self) -> None:
        agent_row, coord_row = _session(
            "bbbb4444-2222-4333-8444-555555555555", closed_days_ago=6
        )
        reader = FakeReader(agent_rows=[agent_row], coord_rows=[coord_row])
        stats = await _run(reader, FakeStore())
        assert stats["at_risk_unarchived"] == 0


class TestSchedulerRegistration:
    def test_the_job_is_registered_with_a_kill_switch_name(self) -> None:
        from app.core.scheduler import SchedulerService, install_default_tasks

        service = SchedulerService()
        install_default_tasks(service)
        status = service.status()
        assert "session_archive" in status
        # Hourly, and it sweeps at boot so a sub-hourly redeploy cadence can
        # never starve it (the memory_reindex lesson).
        assert status["session_archive"]["cadence"] == "cron:35 * * * *"

    def test_registration_survives_a_second_install(self) -> None:
        from app.core.scheduler import SchedulerService, install_default_tasks

        service = SchedulerService()
        install_default_tasks(service)
        with pytest.raises(ValueError):
            install_default_tasks(service)
