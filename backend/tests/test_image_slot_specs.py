"""Every image-slot spec in ``frontend/image-slots/`` is a valid ``ImageSlotSpec``.

Plan ``2026-10-13-image-generation-and-visual-judgment``, Phase 14 step 3: the
specs are YAML, the frontend's TypeScript binding is declarations only, so the
CI gate that refuses a malformed spec is this module, through the generated
pydantic model plus the hand-mirrored cross-field rules in
:mod:`tests._image_slot_spec`.

The validator itself is held to qontinui-schemas' own golden fixtures
(``rust/tests/fixtures/image_slot/``, read from the sibling checkout the
``qontinui-schemas`` path dependency resolves to): every ``valid/`` fixture
must pass and hash to the ``# content-sha256:`` value Rust pinned on it, and
every ``invalid/`` fixture must be refused by the layer its
``# refused-by:`` header names, a ``rule`` fixture at exactly the path named.
So a rule this mirror forgets, or a hash it computes differently, fails here
rather than letting a spec through that Rust would refuse.
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any

import pytest
import qontinui_schemas
import yaml

from tests._image_slot_spec import (
    DuplicateKeyError,
    UnhashableSpec,
    _es_number,
    check_spec_file,
    content_sha256,
    load_yaml12,
    rule_problems,
    schema_errors,
)

# backend/tests/x.py -> parents[2] == repo root.
_REPO_ROOT = Path(__file__).resolve().parents[2]
_SPEC_DIR = _REPO_ROOT / "frontend" / "image-slots"
_BACKEND_CI = _REPO_ROOT / ".github" / "workflows" / "backend-ci.yml"

# <qontinui-schemas>/src/qontinui_schemas/__init__.py -> parents[2] == that repo.
_SCHEMAS_ROOT = Path(qontinui_schemas.__file__).resolve().parents[2]
_FIXTURES = _SCHEMAS_ROOT / "rust" / "tests" / "fixtures" / "image_slot"


def _spec_files() -> list[Path]:
    return sorted(_SPEC_DIR.glob("*.yaml"))


def _fixtures(kind: str) -> list[Path]:
    # May be empty: an absent fixture directory is reported by ONE test,
    # test_the_schemas_fixtures_are_present, rather than an import-time error
    # that would break collection for the whole backend suite.
    return sorted((_FIXTURES / kind).glob("*.yaml"))


def _header(path: Path, key: str) -> str | None:
    for line in path.read_text(encoding="utf-8").splitlines():
        match = re.match(rf"^#\s*{re.escape(key)}:\s*(.+?)\s*$", line)
        if match:
            return match.group(1)
    return None


# ---------------------------------------------------------------------------
# The frontend's own specs
# ---------------------------------------------------------------------------


def test_the_frontend_declares_at_least_one_slot() -> None:
    # An empty directory would pass every check below vacuously.
    assert _spec_files(), f"no image-slot specs under {_SPEC_DIR}"


@pytest.mark.parametrize("path", _spec_files(), ids=lambda p: p.stem)
def test_frontend_spec_is_valid(path: Path) -> None:
    verdict = check_spec_file(path)
    assert verdict.valid, verdict.describe()


@pytest.mark.parametrize("path", _spec_files(), ids=lambda p: p.stem)
def test_frontend_spec_is_named_after_its_slot(path: Path) -> None:
    """``<SlotImage>`` and the inventory key on the slot id, and the file name
    is how a person finds a slot's spec."""
    spec = load_yaml12(path.read_text(encoding="utf-8"))
    assert isinstance(spec, dict) and spec.get("slot") == path.stem, (
        f"{path.name} declares slot {spec.get('slot') if isinstance(spec, dict) else spec!r}; "
        f"a spec file is named <slot>.yaml"
    )


def test_backend_ci_runs_this_module_on_a_spec_only_change() -> None:
    """A PR touching only ``frontend/image-slots/`` must still run this gate."""
    workflow = yaml.safe_load(_BACKEND_CI.read_text(encoding="utf-8"))
    triggers = workflow.get("on", workflow.get(True))
    for trigger in ("pull_request", "push"):
        paths = triggers[trigger]["paths"]
        assert "frontend/image-slots/**" in paths, (
            f"frontend/image-slots/** is not in backend-ci.yml `on.{trigger}.paths`, "
            "so a spec-only change never runs the gate that validates it"
        )


# ---------------------------------------------------------------------------
# The validator against qontinui-schemas' golden fixtures
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("kind", ["valid", "invalid"])
def test_the_schemas_fixtures_are_present(kind: str) -> None:
    """Without them every fixture case below is an empty parameter set and the
    module would read green having checked nothing."""
    assert _fixtures(kind), (
        f"no {kind} fixtures under {_FIXTURES}: the qontinui-schemas checkout the "
        "path dependency resolves to does not carry the image-slot fixtures, so "
        "the validator's agreement with Rust is UNKNOWN"
    )


@pytest.mark.parametrize("path", _fixtures("valid"), ids=lambda p: p.stem)
def test_valid_fixture_passes_and_hashes_as_rust_pinned(path: Path) -> None:
    verdict = check_spec_file(path)
    assert verdict.valid, verdict.describe()
    pinned = _header(path, "content-sha256")
    assert pinned, f"{path.name} pins no content hash"
    assert content_sha256(verdict.spec) == pinned


@pytest.mark.parametrize("path", _fixtures("valid"), ids=lambda p: p.stem)
def test_bound_fixture_binding_currency_matches_rust(path: Path) -> None:
    """A bound fixture's binding is current unless it says ``binding: stale``;
    the binding obligations apply only to a current one."""
    spec = load_yaml12(path.read_text(encoding="utf-8"))
    binding = spec.get("provenance")
    if binding is None:
        assert _header(path, "binding") is None
        return
    current = binding["spec_sha256"] == content_sha256(spec)
    assert current is (_header(path, "binding") != "stale")


@pytest.mark.parametrize("path", _fixtures("invalid"), ids=lambda p: p.stem)
def test_invalid_fixture_is_refused_by_the_named_layer(path: Path) -> None:
    refused_by = _header(path, "refused-by")
    assert refused_by, f"{path.name} names no refused-by layer"
    layer, _, detail = refused_by.partition(" ")
    verdict = check_spec_file(path)
    if layer in ("serde", "schema"):
        # The generated model carries every serde and schema rule.
        assert verdict.schema, f"{path.name} was accepted by the schema layer"
    elif layer == "rule":
        assert not verdict.schema, verdict.describe()
        assert [p.path for p in verdict.rules] == [detail], verdict.describe()
    else:
        pytest.fail(f"{path.name}: unknown refused-by layer {layer!r}")


# ---------------------------------------------------------------------------
# The pieces the fixtures cannot isolate
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        # ECMAScript Number::toString, the layout RFC 8785 prescribes.
        (0, "0"),
        (0.0, "0"),
        (-0.0, "0"),
        (1, "1"),
        (2.0, "2"),
        (123.0, "123"),
        (1.5, "1.5"),
        (-0.5, "-0.5"),
        (0.45, "0.45"),
        (0.000001, "0.000001"),
        (1e-7, "1e-7"),
        (1.25e-7, "1.25e-7"),
        (1e20, "100000000000000000000"),
        (1e21, "1e+21"),
        (1.5e21, "1.5e+21"),
        (float(2**60), "1152921504606847000"),
        (2**53 - 1, "9007199254740991"),
    ],
)
def test_es_number_layout(value: int | float, expected: str) -> None:
    assert _es_number(value) == expected


@pytest.mark.parametrize("value", [2**53, float("inf"), float("nan")])
def test_a_number_rfc_8785_cannot_carry_has_no_hash(value: int | float) -> None:
    with pytest.raises(UnhashableSpec):
        _es_number(value)


def test_yaml_is_read_as_yaml_1_2() -> None:
    data: Any = load_yaml12(
        "a: yes\nb: 4:3\nc: 017\nd: true\ne: off\nf: 0x1F\ng: 0o17\nh: ~\ni: 1.5\nj: .inf\n"
    )
    assert data == {
        "a": "yes",
        "b": "4:3",
        "c": 17,
        "d": True,
        "e": "off",
        "f": 31,
        "g": 15,
        "h": None,
        "i": 1.5,
        "j": float("inf"),
    }


def test_a_duplicate_key_is_refused() -> None:
    with pytest.raises(DuplicateKeyError):
        load_yaml12("slot: a\nslot: b\n")


def test_lax_coercion_is_not_accepted() -> None:
    """``"yes"`` for a boolean is refused: the model validates strictly."""
    spec = load_yaml12(
        (_SPEC_DIR / "runs.active.idle.yaml").read_text(encoding="utf-8")
    )
    spec["focal"]["must_survive_crop"] = "yes"
    assert schema_errors(spec)


def test_each_cross_field_rule_reports_its_path() -> None:
    """Each spec-level rule, and each edge of a compound one, broken once on a
    valid spec and reported where Rust reports it. The obligations of a
    CURRENT binding (alt text, exemplar and LoRA digests, logo, screenshot)
    need a spec whose hash its binding records, and are covered by the
    qontinui-schemas ``rule`` fixtures above. Every rule's mutant, removed
    from the mirror, turns this module red (22 mutants, measured 2026-10-19)."""
    base = load_yaml12(
        (_SPEC_DIR / "runs.active.idle.yaml").read_text(encoding="utf-8")
    )

    def problems(mutate: Any) -> list[tuple[str, str]]:
        spec = load_yaml12(
            (_SPEC_DIR / "runs.active.idle.yaml").read_text(encoding="utf-8")
        )
        mutate(spec)
        assert not schema_errors(spec), schema_errors(spec)
        return [(p.path, p.rule) for p in rule_problems(spec)]

    assert rule_problems(base) == []
    assert problems(lambda s: s["contexts"].update(breakpoints=[768, 360])) == [
        ("contexts.breakpoints", "NotAscending")
    ]
    assert problems(lambda s: s["contexts"].update(themes=["dark", "dark"])) == [
        ("contexts.themes[1]", "Duplicate")
    ]
    assert problems(lambda s: s["aspect"].update(allowed=["2/2"])) == [
        ("aspect.allowed[0]", "Duplicate")
    ]
    assert problems(lambda s: s["focal"]["region"].update(x=0.5)) == [
        ("focal.region", "RegionOutsideBox")
    ]
    assert problems(
        lambda s: s.update(
            safe_areas={
                "kind": "explicit",
                "regions": [{"x": 0, "y": 0, "width": 0, "height": 1}],
            }
        )
    ) == [("safe_areas.regions[0]", "RegionOutsideBox")]
    assert problems(lambda s: s["content"]["must"].append("  PEOPLE ")) == [
        ("content.must_not[0]", "Contradictory")
    ]
    assert problems(lambda s: s.update(thresholds={"kind": "overrides"})) == [
        ("thresholds", "NoOverride")
    ]
    assert problems(
        lambda s: s.update(
            thresholds={
                "kind": "overrides",
                "min_effective_resolution": 2,
                "max_effective_resolution": 1,
            }
        )
    ) == [("thresholds", "MinAboveMax")]
    assert problems(lambda s: s["contexts"].update(dpr=[1, 1])) == [
        ("contexts.dpr", "NotAscending")
    ]
    assert problems(
        lambda s: s["content"]["must"].append(
            " A CALM, IDLE MOTIF, SUCH AS AN EMPTY TRAY OR A RESTING PIPELINE"
        )
    ) == [("content.must[1]", "Duplicate")]
    assert problems(lambda s: s["focal"]["region"].update(y=0.5)) == [
        ("focal.region", "RegionOutsideBox")
    ]
    assert problems(lambda s: s["focal"]["region"].update(height=0)) == [
        ("focal.region", "RegionOutsideBox")
    ]

    def generated_binding(missing: str) -> Any:
        binding = {
            "asset_sha256": "a" * 64,
            # Not this spec's hash: a STALE binding, so only the binding's own
            # consistency is checked and nothing else can report.
            "spec_sha256": "b" * 64,
            "source": "generated",
            "ai_generated": True,
            "recipe_sha256": "c" * 64,
            "imagery_sha256": "d" * 64,
        }
        del binding[missing]
        return lambda s: s.update(provenance=binding)

    for digest in ("recipe_sha256", "imagery_sha256"):
        assert problems(generated_binding(digest)) == [
            (f"provenance.{digest}", "MissingInputDigest")
        ]
