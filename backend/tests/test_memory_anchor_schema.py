"""The memory write door's anchor vocabulary, rule for rule — no DB.

Plan ``2026-11-21-web-memory-write-schema-refuses-anchor-types-coord-resolves``
Phase 1. ``POST /api/v1/memory/records`` is the only writer of memory records
(coord's ``coord_memory_record`` proxies to it), so the ``Anchor`` union in
``app/schemas/memory.py`` is the gate every anchor passes. It must admit
exactly what coord's ``parse_memory_anchor`` resolves on a memory record
(``qontinui-coord@010dfa1b5d5b`` ``crates/coord/src/anchor_observer.rs``) and
refuse what coord refuses, for the same reasons:

* per variant, a minimal coord-valid shape is ACCEPTED, and dumps back as
  exactly what was sent (anchor identity is the whole JSON object);
* per rule, a shape violating ONLY that rule is refused, at that field —
  "only" is asserted as "exactly one error", so a test cannot pass on some
  other rule's refusal;
* ``sql_count`` and ``worker`` — coord types, refused on memory records on
  purpose — are refused naming the tag;
* an unknown extra key is refused on every variant;
* the coord constants the schema copies are pinned by value.

Validation runs through ``TypeAdapter(Anchor).validate_python``, which is the
mode FastAPI validates a parsed JSON body in. Errors are located relative to
the anchor: ``("region", "digest")``, ``("run_outcome", "metric", "ref")``.
"""

from __future__ import annotations

import math
from collections.abc import AsyncGenerator
from typing import Any
from unittest.mock import MagicMock
from uuid import uuid4

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import TypeAdapter, ValidationError

from app.api.deps import get_async_db
from app.api.v1.endpoints.memory import MemoryPrincipal, get_memory_tenant, router
from app.schemas import memory as schema
from app.schemas.memory import (
    Anchor,
    MemoryRecordIn,
    RunOutcomeAnchor,
    WriteRecordsRequest,
)

_ANCHOR: TypeAdapter[Any] = TypeAdapter(Anchor)

_SHA40 = "0123456789abcdef0123456789abcdef01234567"
_DIGEST = "0f" * 32
_REPO = "qontinui/qontinui-web"
_PATH = "backend/app/schemas/memory.py"

# Sentinel for ``_with``: drop the key rather than set it.
_DROP = object()

# One minimal coord-valid shape per variant (both ``run_outcome`` arms).
_MINIMAL: dict[str, dict[str, Any]] = {
    "blob": {"type": "blob", "repo": _REPO, "path": _PATH, "sha": "a" * 40},
    "region": {
        "type": "region",
        "repo": _REPO,
        "path": _PATH,
        "start_line": 1,
        "end_line": 1,
        "digest": _DIGEST,
    },
    "pr": {"type": "pr", "repo": _REPO, "number": 2322},
    "migration": {"type": "migration", "revision": "coord_memory_anchors"},
    "schema": {"type": "schema", "object": "coord.memory_records.anchors"},
    "flag": {"type": "flag", "name": "merge_rollout"},
    "flag_state": {
        "type": "flag_state",
        "name": "COORD_SPECULATIVE_DISABLED",
        "expect": {"armed": True},
    },
    "content": {
        "type": "content",
        "repo": _REPO,
        "path": _PATH,
        "pattern": "class ContentAnchor",
    },
    "run_outcome/conclusion": {
        "type": "run_outcome",
        "repo": _REPO,
        "workflow": "backend-ci.yml",
        "ref": "main",
        "expect": "success",
    },
    "run_outcome/metric": {
        "type": "run_outcome",
        "source": "eval",
        "subject": "memory-recall",
        "task": "anchored",
        "metric": "recall_at_8",
        "at_least": 0.9,
        "min_cases": 1,
    },
    "publication": {
        "type": "publication",
        "kind": "policy",
        "name": "coordination",
        "min_version": 1,
    },
}

_NEW_VARIANTS = (
    "region",
    "flag_state",
    "content",
    "run_outcome/conclusion",
    "run_outcome/metric",
    "publication",
)


def _with(variant: str, /, **changes: Any) -> dict[str, Any]:
    """A copy of ``_MINIMAL[variant]`` with ``changes`` applied (``_DROP`` removes).

    ``variant`` is positional-only so a ``name=`` field override (``flag_state``,
    ``publication``) can never collide with it.
    """
    anchor = dict(_MINIMAL[variant])
    for key, value in changes.items():
        if value is _DROP:
            anchor.pop(key, None)
        else:
            anchor[key] = value
    return anchor


def _dump(anchor: dict[str, Any]) -> dict[str, Any]:
    """Validate, then dump exactly as the endpoint does before storing."""
    dumped: dict[str, Any] = _ANCHOR.validate_python(anchor).model_dump(mode="json")
    return dumped


def _errors(anchor: dict[str, Any]) -> list[Any]:
    with pytest.raises(ValidationError) as exc:
        _ANCHOR.validate_python(anchor)
    return exc.value.errors()


def _refused_at(anchor: dict[str, Any], *field: str) -> Any:
    """Exactly one error, located at ``field`` (the loc's tail)."""
    errors = _errors(anchor)
    assert len(errors) == 1, errors
    (err,) = errors
    assert tuple(err["loc"][-len(field) :]) == field, err
    return err


# ---------------------------------------------------------------------------
# The vocabulary
# ---------------------------------------------------------------------------


class TestTheVocabularyIsCoordsMemoryAdmissibleSet:
    def test_the_union_tags_are_exactly_coords_memory_admissible_set(self) -> None:
        """Every type ``parse_memory_anchor`` admits, and nothing else.

        coord's ``Anchor`` enum minus ``SqlCount`` and ``Worker``. A tag added
        here without coord learning it — or dropped while coord still
        resolves it — reds this test.
        """
        mapping = _ANCHOR.json_schema()["discriminator"]["mapping"]
        assert set(mapping) == {
            "blob",
            "region",
            "pr",
            "migration",
            "schema",
            "flag",
            "flag_state",
            "content",
            "run_outcome",
            "publication",
        }

    @pytest.mark.parametrize("name", sorted(_MINIMAL))
    def test_a_minimal_coord_valid_shape_is_accepted_and_dumps_unchanged(
        self, name: str
    ) -> None:
        assert _dump(_MINIMAL[name]) == _MINIMAL[name]

    @pytest.mark.parametrize(
        "anchor",
        [
            # Coord-VALID shapes of both types: the refusal is the tag's, not
            # some field's.
            {"type": "sql_count", "query_id": "open_alerts", "op": "gte", "n": 1},
            {"type": "worker", "name": "prompt_document_auto_publish.pass"},
        ],
        ids=["sql_count", "worker"],
    )
    def test_coord_types_refused_on_memory_records_are_refused_naming_the_tag(
        self, anchor: dict[str, Any]
    ) -> None:
        (err,) = _errors(anchor)
        assert err["type"] == "union_tag_invalid"
        assert err["ctx"]["tag"] == anchor["type"]
        assert anchor["type"] in err["msg"]

    @pytest.mark.parametrize("name", sorted(_MINIMAL))
    def test_an_unknown_extra_key_is_refused(self, name: str) -> None:
        err = _refused_at(_with(name, provenance="vet"), "provenance")
        assert err["type"] == "extra_forbidden"


def _client() -> TestClient:
    """The real router; the DB is never reached because validation fails first."""
    app = FastAPI()
    app.include_router(router, prefix="/api/v1/memory")
    principal = MemoryPrincipal(tenant_id=uuid4(), device_id=None, actor="device")
    app.dependency_overrides[get_memory_tenant] = lambda: principal

    async def _stub_db() -> AsyncGenerator[MagicMock, None]:
        yield MagicMock()

    app.dependency_overrides[get_async_db] = _stub_db
    return TestClient(app)


class TestTheHttpDoor:
    @pytest.mark.parametrize("tag", ["sql_count", "worker"])
    def test_refused_tags_answer_422_naming_the_tag(self, tag: str) -> None:
        resp = _client().post(
            "/api/v1/memory/records",
            json={
                "records": [
                    {
                        "title": "a population claim",
                        "content": "belongs in a domain_spec probe block",
                        "kind": "fact",
                        "anchors": [{"type": tag, "name": "x"}],
                    }
                ]
            },
        )
        assert resp.status_code == 422, resp.text
        assert f"'{tag}'" in resp.text

    def test_a_rule_refusal_answers_422_at_the_field(self) -> None:
        resp = _client().post(
            "/api/v1/memory/records",
            json={
                "records": [
                    {
                        "title": "a region claim",
                        "content": "with a digest that can never match",
                        "kind": "fact",
                        "anchors": [_with("region", digest="not-a-digest")],
                    }
                ]
            },
        )
        assert resp.status_code == 422, resp.text
        (detail,) = resp.json()["detail"]
        assert detail["loc"] == [
            "body",
            "records",
            0,
            "anchors",
            0,
            "region",
            "digest",
        ]


# ---------------------------------------------------------------------------
# The mirrored constants
# ---------------------------------------------------------------------------


class TestMirroredConstantsArePinned:
    """Copies of coord values at ``010dfa1b5d5b``; the comments cite the files."""

    def test_region_max_lines(self) -> None:
        # anchor_observer.rs `REGION_MAX_LINES`.
        assert schema.REGION_MAX_LINES == 2_000

    def test_publishable_kinds(self) -> None:
        # prompt_document_publications.rs `PUBLISHABLE_KINDS`, each KIND_*
        # resolved in prompt_documents.rs — same order.
        assert schema.PUBLISHABLE_KINDS == (
            "policy",
            "response_prompt",
            "continuation_rules",
            "agent_playbook",
            "prompt_template",
            "session_briefing",
            "claude_settings",
        )

    def test_content_pattern_max_bytes(self) -> None:
        # gates.rs `MAX_PATTERN_LEN`.
        assert schema.CONTENT_PATTERN_MAX_BYTES == 512

    def test_run_conclusions(self) -> None:
        # anchor_observer.rs `RUN_CONCLUSIONS`.
        assert schema.RUN_CONCLUSIONS == (
            "success",
            "failure",
            "cancelled",
            "skipped",
            "neutral",
            "timed_out",
            "action_required",
            "stale",
        )

    def test_run_outcome_label_and_metric_name_caps(self) -> None:
        # anchor_observer.rs `RUN_OUTCOME_LABEL_MAX_BYTES` /
        # `RUN_OUTCOME_METRIC_NAME_MAX_BYTES`.
        assert schema.RUN_OUTCOME_LABEL_MAX_BYTES == 200
        assert schema.RUN_OUTCOME_METRIC_NAME_MAX_BYTES == 128

    def test_run_outcome_arm_keys(self) -> None:
        # anchor_observer.rs `RUN_CONCLUSION_KEYS` / `RUN_METRIC_KEYS`.
        assert schema.RUN_CONCLUSION_KEYS == ("repo", "workflow", "expect")
        assert schema.RUN_METRIC_KEYS == (
            "source",
            "subject",
            "task",
            "metric",
            "at_least",
            "min_cases",
        )


# ---------------------------------------------------------------------------
# region
# ---------------------------------------------------------------------------


class TestRegion:
    @pytest.mark.parametrize(
        "changes",
        [
            {"digest": "sha256:" + _DIGEST},
            {"on_ref": _SHA40},
            {"on_ref": "main"},
            {"on_ref": "refs/heads/main"},
            {"on_ref": "release/2026.11_rc-1"},
            {"start_line": 10, "end_line": 10 + 2_000 - 1},
            {"start_line": 2**32 - 1, "end_line": 2**32 - 1},
        ],
    )
    def test_accepted(self, changes: dict[str, Any]) -> None:
        anchor = _with("region", **changes)
        assert _dump(anchor) == anchor

    @pytest.mark.parametrize(
        ("field", "value"),
        [
            ("repo", _DROP),
            ("repo", ""),
            ("path", _DROP),
            ("path", ""),
            ("digest", _DROP),
        ],
    )
    def test_required_non_empty_strings(self, field: str, value: Any) -> None:
        _refused_at(_with("region", **{field: value}), field)

    @pytest.mark.parametrize("value", [_DROP, 0, -1, 1.0, 1.5, "1", True, None])
    def test_start_line_is_a_strict_integer_at_least_1(self, value: Any) -> None:
        _refused_at(_with("region", start_line=value), "start_line")

    def test_start_line_fits_u32(self) -> None:
        # end_line is in range, so start_line is the only violation.
        anchor = _with("region", start_line=2**32, end_line=2**32 - 1)
        _refused_at(anchor, "start_line")

    @pytest.mark.parametrize("value", [_DROP, 0, 1.0, "1", True, 2**32])
    def test_end_line_is_a_strict_integer_at_least_1(self, value: Any) -> None:
        _refused_at(_with("region", end_line=value), "end_line")

    def test_end_line_before_start_line_is_refused(self) -> None:
        err = _refused_at(_with("region", start_line=5, end_line=4), "end_line")
        assert "start_line" in err["msg"]

    def test_a_span_over_region_max_lines_is_refused(self) -> None:
        anchor = _with("region", start_line=10, end_line=10 + 2_000)
        err = _refused_at(anchor, "end_line")
        assert "REGION_MAX_LINES" in err["msg"]

    @pytest.mark.parametrize(
        "digest",
        [
            "",
            _DIGEST.upper(),  # uppercase is refused, never normalized
            _DIGEST[:-1],
            _DIGEST + "0",
            "g" * 64,
            "sha256:",
            "sha256:" + _DIGEST.upper(),
            "SHA256:" + _DIGEST,
            "sha1:" + _DIGEST,  # another algorithm's tag is not stripped
            " " + _DIGEST,
        ],
    )
    def test_digest_is_64_lowercase_hex_optionally_sha256_prefixed(
        self, digest: str
    ) -> None:
        _refused_at(_with("region", digest=digest), "digest")

    @pytest.mark.parametrize(
        "on_ref",
        ["", "-main", "main..other", "has space", "main~1", "main:path", "ü", 5],
    )
    def test_on_ref_is_a_safe_git_ref(self, on_ref: Any) -> None:
        _refused_at(_with("region", on_ref=on_ref), "on_ref")

    @pytest.mark.parametrize(
        ("field", "value"),
        [("repo", "r" * 257), ("path", "p" * 1025), ("on_ref", "r" * 257)],
    )
    def test_storage_caps(self, field: str, value: str) -> None:
        _refused_at(_with("region", **{field: value}), field)

    def test_an_omitted_or_null_on_ref_is_not_serialised(self) -> None:
        """``{"on_ref": null}`` and no ``on_ref`` are one anchor to coord."""
        assert "on_ref" not in _dump(_MINIMAL["region"])
        assert _dump(_with("region", on_ref=None)) == _MINIMAL["region"]
        assert _dump(_with("region", on_ref="main"))["on_ref"] == "main"


# ---------------------------------------------------------------------------
# flag_state
# ---------------------------------------------------------------------------


class TestFlagState:
    @pytest.mark.parametrize("armed", [True, False])
    def test_accepted(self, armed: bool) -> None:
        anchor = _with("flag_state", expect={"armed": armed})
        assert _dump(anchor) == anchor

    @pytest.mark.parametrize("value", [_DROP, ""])
    def test_name_is_a_required_non_empty_string(self, value: Any) -> None:
        _refused_at(_with("flag_state", name=value), "name")

    @pytest.mark.parametrize("value", [_DROP, None, True, "armed", ["armed"]])
    def test_expect_is_a_required_object(self, value: Any) -> None:
        _refused_at(_with("flag_state", expect=value), "expect")

    @pytest.mark.parametrize("armed", [_DROP, None, "true", 1, 0, 1.0])
    def test_expect_armed_is_a_real_boolean(self, armed: Any) -> None:
        expect = {} if armed is _DROP else {"armed": armed}
        _refused_at(_with("flag_state", expect=expect), "expect", "armed")

    def test_expect_forbids_extra_keys(self) -> None:
        expect = {"armed": True, "because": "the kill switch is unset"}
        _refused_at(_with("flag_state", expect=expect), "expect", "because")


# ---------------------------------------------------------------------------
# content
# ---------------------------------------------------------------------------


class TestContent:
    @pytest.mark.parametrize(
        "changes",
        [
            {"on_ref": "main"},
            {"on_ref": _SHA40},
            {"pattern": "p" * 512},  # exactly the cap, in bytes
            {"pattern": "é" * 256},  # 512 bytes, 256 characters
            # coord holds content's on_ref to NO ref grammar (it is
            # percent-encoded into the contents API query, never put on an
            # argv), so neither does this door — unlike region's.
            {"on_ref": "main..other"},
            {"on_ref": "-leading-dash"},
        ],
    )
    def test_accepted(self, changes: dict[str, Any]) -> None:
        anchor = _with("content", **changes)
        assert _dump(anchor) == anchor

    @pytest.mark.parametrize("field", ["repo", "path", "pattern"])
    @pytest.mark.parametrize("value", [_DROP, ""])
    def test_required_non_empty_strings(self, field: str, value: Any) -> None:
        _refused_at(_with("content", **{field: value}), field)

    @pytest.mark.parametrize(
        "pattern",
        [
            "p" * 513,
            "é" * 257,  # 514 bytes but only 257 characters: the cap is BYTES
        ],
    )
    def test_pattern_is_within_coords_byte_cap(self, pattern: str) -> None:
        _refused_at(_with("content", pattern=pattern), "pattern")

    @pytest.mark.parametrize("on_ref", ["", 5, "r" * 257])
    def test_on_ref_is_a_non_empty_string(self, on_ref: Any) -> None:
        _refused_at(_with("content", on_ref=on_ref), "on_ref")

    def test_an_omitted_or_null_on_ref_is_not_serialised(self) -> None:
        assert "on_ref" not in _dump(_MINIMAL["content"])
        assert _dump(_with("content", on_ref=None)) == _MINIMAL["content"]


# ---------------------------------------------------------------------------
# run_outcome — conclusion arm
# ---------------------------------------------------------------------------

_CONCLUSION = "run_outcome/conclusion"
_METRIC = "run_outcome/metric"


class TestRunOutcomeConclusionArm:
    @pytest.mark.parametrize(
        "ref",
        [
            "main",
            "refs/heads/main",
            "release/2026.11",
            _SHA40,
            _SHA40.upper(),  # coord lowercases a sha at parse
            "refs/heads/" + _SHA40,
        ],
    )
    def test_accepted_refs(self, ref: str) -> None:
        anchor = _with(_CONCLUSION, ref=ref)
        assert _dump(anchor) == anchor

    @pytest.mark.parametrize("expect", schema.RUN_CONCLUSIONS)
    def test_every_github_conclusion_is_accepted(self, expect: str) -> None:
        assert _dump(_with(_CONCLUSION, expect=expect))["expect"] == expect

    @pytest.mark.parametrize("field", ["repo", "workflow", "ref", "expect"])
    @pytest.mark.parametrize("value", [_DROP, ""])
    def test_required_non_empty_fields(self, field: str, value: Any) -> None:
        _refused_at(_with(_CONCLUSION, **{field: value}), "conclusion", field)

    def test_a_bare_run_outcome_is_refused_as_the_conclusion_arm(self) -> None:
        """No metric key selects the conclusion arm, exactly as in coord."""
        locs = {tuple(e["loc"]) for e in _errors({"type": "run_outcome"})}
        assert locs == {
            ("run_outcome", "conclusion", field)
            for field in ("repo", "workflow", "ref", "expect")
        }

    @pytest.mark.parametrize(
        "ref",
        [
            "abc1234",  # abbreviated sha
            _SHA40[:-1],
            _SHA40 + "0",
            "cafe",  # all-hex, so a sha to coord, and too short
            "refs/heads/",  # nothing left after the strip
            "refs/heads/" + _SHA40[:12],
            "-main",
            "main..other",
            "has space",
        ],
    )
    def test_ref_can_match_a_run(self, ref: str) -> None:
        _refused_at(_with(_CONCLUSION, ref=ref), "conclusion", "ref")

    @pytest.mark.parametrize("expect", ["succeeded", "SUCCESS", "green", True])
    def test_expect_is_a_github_conclusion(self, expect: Any) -> None:
        _refused_at(_with(_CONCLUSION, expect=expect), "conclusion", "expect")

    @pytest.mark.parametrize(
        ("field", "value"),
        [("repo", "r" * 257), ("workflow", "w" * 257), ("ref", "r" * 257)],
    )
    def test_storage_caps(self, field: str, value: str) -> None:
        _refused_at(_with(_CONCLUSION, **{field: value}), "conclusion", field)


# ---------------------------------------------------------------------------
# run_outcome — metric arm
# ---------------------------------------------------------------------------


class TestRunOutcomeMetricArm:
    @pytest.mark.parametrize(
        "changes",
        [
            {"at_least": 0.0},
            {"at_least": -2.5},
            {"at_least": 1e6},
            {"min_cases": 2**63 - 1},
            {"ref": _SHA40},
            {"ref": _SHA40.upper()},
            {"ref": "refs/heads/" + _SHA40},
            {"source": "s" * 200},  # exactly the cap
            {"subject": "é" * 100},  # 200 bytes
            {"task": "a task with inner spaces"},
            {"metric": "pass_rate:v2.1-x"},
            {"metric": "m" * 128},
        ],
    )
    def test_accepted(self, changes: dict[str, Any]) -> None:
        anchor = _with(_METRIC, **changes)
        assert _dump(anchor) == anchor

    def test_an_integer_threshold_is_accepted(self) -> None:
        # coord's `as_f64` reads any JSON number; the dump is the equal float.
        assert _dump(_with(_METRIC, at_least=1))["at_least"] == 1.0

    @pytest.mark.parametrize("field", ["source", "subject", "task"])
    @pytest.mark.parametrize(
        "value",
        [
            _DROP,
            "",
            " leading",
            "trailing ",
            "trailing\u3000",  # Unicode White_Space, as Rust's trim sees it
            "\xa0leading",
            "inner\x07bell",  # a control character anywhere
            "s" * 201,
            "é" * 101,  # 202 bytes, 101 characters: the cap is BYTES
            5,
        ],
    )
    def test_labels(self, field: str, value: Any) -> None:
        _refused_at(_with(_METRIC, **{field: value}), "metric", field)

    @pytest.mark.parametrize(
        "metric", [_DROP, "", "has space", "m" * 129, "ü", "a/b", 7]
    )
    def test_metric_name_grammar(self, metric: Any) -> None:
        # Dropping `metric` leaves other metric keys, so the arm is still
        # the metric arm and the refusal is the missing field.
        _refused_at(_with(_METRIC, metric=metric), "metric", "metric")

    @pytest.mark.parametrize(
        "at_least",
        [_DROP, "0.9", True, None, math.nan, math.inf, -math.inf],
    )
    def test_at_least_is_a_finite_number(self, at_least: Any) -> None:
        _refused_at(_with(_METRIC, at_least=at_least), "metric", "at_least")

    @pytest.mark.parametrize("min_cases", [_DROP, 0, -1, 1.0, "1", True, 2**63])
    def test_min_cases_is_a_strict_integer_at_least_1(self, min_cases: Any) -> None:
        _refused_at(_with(_METRIC, min_cases=min_cases), "metric", "min_cases")

    @pytest.mark.parametrize(
        "ref",
        [
            None,  # present-but-null is refused; omit it instead
            5,
            "main",  # a branch can never match an outcome row
            "refs/heads/main",
            "abc1234",
            _SHA40[:-1],
            "-" + _SHA40,
        ],
    )
    def test_a_present_ref_is_a_full_sha(self, ref: Any) -> None:
        _refused_at(_with(_METRIC, ref=ref), "metric", "ref")

    def test_an_omitted_ref_is_not_serialised(self) -> None:
        assert "ref" not in _dump(_MINIMAL[_METRIC])

    def test_ref_selects_neither_arm(self) -> None:
        """``ref`` is shared, so it never makes a metric anchor "mixed"."""
        assert "ref" not in schema.RUN_CONCLUSION_KEYS
        assert "ref" not in schema.RUN_METRIC_KEYS
        assert _dump(_with(_METRIC, ref=_SHA40))["ref"] == _SHA40


class TestRunOutcomeArmsAreExclusive:
    """coord refuses an element carrying keys of both arms, naming ``type``."""

    @staticmethod
    def _assert_mixed(anchor: dict[str, Any]) -> None:
        err = _refused_at(anchor, "run_outcome")
        assert err["type"] == "run_outcome_mixed_arms"
        assert err["msg"].startswith("type:")

    @pytest.mark.parametrize("key", schema.RUN_CONCLUSION_KEYS)
    def test_a_conclusion_key_on_a_metric_anchor(self, key: str) -> None:
        value = _MINIMAL[_CONCLUSION][key]
        self._assert_mixed(_with(_METRIC, **{key: value}))

    @pytest.mark.parametrize("key", schema.RUN_METRIC_KEYS)
    def test_a_metric_key_on_a_conclusion_anchor(self, key: str) -> None:
        value = _MINIMAL[_METRIC][key]
        self._assert_mixed(_with(_CONCLUSION, **{key: value}))

    def test_presence_decides_not_value(self) -> None:
        """coord tests ``contains_key``, so a null-valued key still counts."""
        self._assert_mixed(_with(_CONCLUSION, at_least=None))


# ---------------------------------------------------------------------------
# publication
# ---------------------------------------------------------------------------


class TestPublication:
    @pytest.mark.parametrize("kind", schema.PUBLISHABLE_KINDS)
    def test_every_publishable_kind_is_accepted(self, kind: str) -> None:
        anchor = _with("publication", kind=kind)
        assert _dump(anchor) == anchor

    def test_the_largest_version_is_accepted(self) -> None:
        anchor = _with("publication", min_version=2**31 - 1)
        assert _dump(anchor) == anchor

    @pytest.mark.parametrize(
        "kind",
        [
            _DROP,
            "",
            "Policy",
            # Real prompt-document kinds that are NOT publishable: the Intent
            # family and domain_spec describe the tenant's own product, so no
            # publication row can ever exist for them.
            "product_intent",
            "initiative",
            "success_metric",
            "audience_profile",
            "decision_record",
            "domain_spec",
        ],
    )
    def test_kind_is_publishable(self, kind: Any) -> None:
        _refused_at(_with("publication", kind=kind), "kind")

    @pytest.mark.parametrize("value", [_DROP, "", "n" * 257])
    def test_name_is_a_required_non_empty_string(self, value: Any) -> None:
        _refused_at(_with("publication", name=value), "name")

    @pytest.mark.parametrize("value", [_DROP, 0, -1, 1.0, 1.5, "1", True, 2**31])
    def test_min_version_is_a_publication_version(self, value: Any) -> None:
        _refused_at(_with("publication", min_version=value), "min_version")


# ---------------------------------------------------------------------------
# Through the record shapes
# ---------------------------------------------------------------------------


class TestThroughTheRecordShapes:
    def test_every_new_variant_validates_inside_a_write_request(self) -> None:
        anchors = [_MINIMAL[name] for name in _NEW_VARIANTS]
        request = WriteRecordsRequest.model_validate(
            {
                "records": [
                    {
                        "title": "an anchored claim",
                        "content": "asserted about six kinds of ground truth",
                        "kind": "fact",
                        "anchors": anchors,
                    }
                ]
            }
        )
        (record,) = request.records
        # Exactly the endpoint's serialisation before it binds the array.
        assert [a.model_dump(mode="json") for a in record.anchors] == anchors

    def test_a_built_run_outcome_anchor_revalidates(self) -> None:
        """A root model has no ``type`` field; the discriminator still finds it."""
        built = _ANCHOR.validate_python(_MINIMAL[_METRIC])
        assert isinstance(built, RunOutcomeAnchor)
        record = MemoryRecordIn(
            title="t", content="c", kind="fact", anchors=[built, _MINIMAL["region"]]
        )
        assert [a.model_dump(mode="json") for a in record.anchors] == [
            _MINIMAL[_METRIC],
            _MINIMAL["region"],
        ]
