"""``GET /plan-library/vocabulary`` — the write vocabulary, derived, never retyped.

Phase 3 of plan
``2026-09-20-nothing-checks-that-an-agent-writable-evidence-store-ships-its-vocabulary-and-a-correction-verb``.
DB-free: the route reads no table, and the device JWT is stubbed at
``deps._verify_device_jwt`` exactly as ``test_plan_library_device_auth.py``
does — coord's JWKS is not under test, the admission wiring is.

Proved by mutation when this landed (recorded in the PR): M7 — an eighth
member added to ``WorkArtifactRelation`` only →
``test_vocabulary_equals_model_relations`` red.
"""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any, get_args
from uuid import uuid4

import httpx
import pytest
from fastapi import FastAPI, HTTPException, status

from app.core.evidence_posture import ROUTE_POSTURE, Evidence, gaps
from app.models.work_artifact import (
    WORK_ARTIFACT_CAPTURE_SOURCES,
    WORK_ARTIFACT_KINDS,
    WORK_ARTIFACT_RELATIONS,
)
from app.schemas.plan_library import (
    CapturedBy,
    DifficultyLevel,
    DifficultySource,
    WorkArtifactKind,
    WorkArtifactRelation,
)
from app.schemas.plan_library_scan_roots import ScanRootState, SlugCensusSource
from app.services import plan_library_vocabulary as vocab
from app.services.plan_difficulty import MODEL_TIERS

API_PREFIX = "/api/v1/plan-library"
DEVICE_BEARER = "a-coord-issued-device-jwt"

#: Field → the schema ``Literal`` it must equal, and the meanings dict.
_LITERALS: dict[str, tuple[Any, dict[str, str]]] = {
    "kind": (WorkArtifactKind, vocab.KIND_MEANINGS),
    "captured_by": (CapturedBy, vocab.CAPTURED_BY_MEANINGS),
    "relation": (WorkArtifactRelation, vocab.RELATION_MEANINGS),
    "difficulty": (DifficultyLevel, vocab.DIFFICULTY_LEVEL_MEANINGS),
    "difficulty_source": (DifficultySource, vocab.DIFFICULTY_SOURCE_MEANINGS),
    "state": (ScanRootState, vocab.SCAN_ROOT_STATE_MEANINGS),
    "censuses[].source": (SlugCensusSource, vocab.SLUG_CENSUS_SOURCE_MEANINGS),
}


def _served() -> dict[str, list[str]]:
    return {
        f.field: [t.value for t in f.values] for f in vocab.build_vocabulary().fields
    }


# ───────────────────────────── derivation ─────────────────────────────


def test_vocabulary_equals_schema_literals() -> None:
    """Every served field is exactly its ``Literal``, in declaration order,
    and every value carries a meaning — so widening a ``Literal`` without
    explaining the new value is a red test, not a silent blank."""
    response = vocab.build_vocabulary()
    assert response.count == len(response.fields)
    assert _served() == {
        name: list(get_args(lit)) for name, (lit, _) in _LITERALS.items()
    }
    for f in response.fields:
        for term in f.values:
            assert term.meaning.strip(), (f.field, term.value)
        # A server-set field names no door; every other field names one.
        assert bool(f.accepted_by) != f.server_set, f.field
    for name, (literal, meanings) in _LITERALS.items():
        assert set(meanings) == set(get_args(literal)), (
            f"{name}: meanings for values the Literal no longer has",
            sorted(set(meanings) - set(get_args(literal))),
        )


def test_every_plan_library_closed_field_is_served() -> None:
    """Each plan-library write door's declared ``closed_fields`` (the posture
    table, whose own test holds them equal to the body schema's enums) must
    each be served for THAT door — so a closed field added to a write door
    cannot drift out of ``/vocabulary`` silently."""
    served_by_door: dict[str, set[str]] = {}
    for f in vocab.build_vocabulary().fields:
        for door in f.accepted_by:
            served_by_door.setdefault(door, set()).add(f.field)
    for (method, path), posture in ROUTE_POSTURE.items():
        if not isinstance(posture, Evidence):
            continue
        if path != API_PREFIX and not path.startswith(f"{API_PREFIX}/"):
            continue
        door = f"{method} {path}"
        missing = set(posture.closed_fields) - served_by_door.get(door, set())
        assert not missing, (
            f"{door}: closed field(s) not on /vocabulary: {sorted(missing)}"
        )


def test_difficulty_meanings_name_the_served_model_tiers() -> None:
    for level, tier in MODEL_TIERS.items():
        assert tier in vocab.DIFFICULTY_LEVEL_MEANINGS[level], level


def test_vocabulary_equals_model_relations() -> None:
    """The served relations are the Python constant the model pins.

    (The constant-vs-CHECK parity is the migration tests' job: the model
    declares no ``ck_work_artifact_edges_relation`` — alembic
    ``plan_library_01``/``_03``/``_04`` create it.)
    """
    assert set(_served()["relation"]) == set(WORK_ARTIFACT_RELATIONS)


def test_vocabulary_equals_model_kinds_and_capture_sources() -> None:
    served = _served()
    assert set(served["kind"]) == set(WORK_ARTIFACT_KINDS)
    assert set(served["captured_by"]) == set(WORK_ARTIFACT_CAPTURE_SOURCES)


def test_relation_states_what_supersedes_asserts() -> None:
    """The fact the three wrong edges of 2026-09-20 turned on, in the payload."""
    relation = next(f for f in vocab.build_vocabulary().fields if f.field == "relation")
    assert relation.note is not None
    for needle in ("supersedes", "replaces", "spawned_followup", "depends_on"):
        assert needle in relation.note, needle
    supersedes = next(t for t in relation.values if t.value == "supersedes")
    assert "spawned_followup" in supersedes.meaning
    assert "depends_on" in supersedes.meaning


def test_write_doors_render_every_plan_library_row() -> None:
    """Each plan-library write door is described from the posture table, and
    each of its gaps is named with its owning plan."""
    doors = {(d.method, d.path): d for d in vocab.write_doors()}
    expected = {
        key
        for key in ROUTE_POSTURE
        if key[1] == API_PREFIX or key[1].startswith(f"{API_PREFIX}/")
    }
    assert set(doors) == expected
    for key, aspect, gap in gaps():
        if key in doors:
            assert gap.tracked_by in doors[key].tracked_by, (key, aspect)
            prefix = f"[{aspect}] " if aspect else ""
            assert any(
                s.startswith(f"{prefix}NO CORRECTION VERB TODAY")
                and f"(tracked: {gap.tracked_by})" in s
                for s in doors[key].corrections
            ), (key, aspect)


# ───────────────────────────── the route ─────────────────────────────


def _build_app(monkeypatch: pytest.MonkeyPatch, *, cognito_user: Any = None) -> FastAPI:
    """Mount the router with the Cognito arm pinned and the device JWT stubbed.

    Any token other than ``DEVICE_BEARER`` raises the verifier's own 401, so a
    test cannot pass by authenticating on a token it did not mean to present.
    """
    from app.api import deps
    from app.api.v1.endpoints.plan_library import router as plan_library_router

    owner = SimpleNamespace(id=uuid4(), email="owner@example.com", is_active=True)

    async def _fake_verify(token: str) -> tuple[dict, Any]:
        if token != DEVICE_BEARER:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid or expired device token.",
            )
        return ({"device_id": str(uuid4()), "user_id": str(owner.id)}, owner)

    monkeypatch.setattr(deps, "_verify_device_jwt", _fake_verify)
    app = FastAPI()
    app.dependency_overrides[deps.current_active_user_optional] = lambda: cognito_user
    app.include_router(plan_library_router, prefix=API_PREFIX)
    return app


async def _get(app: FastAPI, headers: dict[str, str] | None = None) -> httpx.Response:
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        return await client.get(f"{API_PREFIX}/vocabulary", headers=headers)


@pytest.mark.asyncio
async def test_device_bearer_reads_the_vocabulary(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The caller that needs it most holds only the runner's device JWT — and
    a 200 here also proves the literal path wins over ``/{artifact_id}``,
    which would otherwise 422 on ``vocabulary`` as a UUID."""
    resp = await _get(
        _build_app(monkeypatch), headers={"Authorization": f"Bearer {DEVICE_BEARER}"}
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert set(body) == {"fields", "count", "write_doors"}
    assert body["count"] == len(body["fields"]) == len(_LITERALS)
    by_field = {f["field"]: f for f in body["fields"]}
    assert [t["value"] for t in by_field["relation"]["values"]] == list(
        get_args(WorkArtifactRelation)
    )
    assert by_field["captured_by"]["default"] == "agent"
    assert by_field["difficulty_source"]["server_set"] is True
    assert by_field["difficulty_source"]["accepted_by"] == []
    for f in body["fields"]:
        assert set(f) == {
            "field",
            "written_as",
            "accepted_by",
            "server_set",
            "default",
            "values",
            "note",
        }
        for term in f["values"]:
            assert set(term) == {"value", "meaning"} and term["meaning"]
    edges = next(
        d
        for d in body["write_doors"]
        if d["path"] == f"{API_PREFIX}/{{artifact_id}}/edges"
    )
    assert edges["posture"] == "evidence"
    assert edges["tracked_by"] and edges["corrections"][0].startswith(
        "NO CORRECTION VERB TODAY"
    )


@pytest.mark.asyncio
async def test_cognito_user_reads_the_vocabulary(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    operator = SimpleNamespace(id=uuid4(), email="op@example.com", is_active=True)
    resp = await _get(_build_app(monkeypatch, cognito_user=operator))
    assert resp.status_code == 200, resp.text


@pytest.mark.asyncio
async def test_anonymous_caller_is_refused(monkeypatch: pytest.MonkeyPatch) -> None:
    resp = await _get(_build_app(monkeypatch))
    assert resp.status_code == 401, resp.text


@pytest.mark.asyncio
async def test_a_bad_bearer_is_refused(monkeypatch: pytest.MonkeyPatch) -> None:
    resp = await _get(
        _build_app(monkeypatch), headers={"Authorization": "Bearer not-the-device-jwt"}
    )
    assert resp.status_code == 401, resp.text
