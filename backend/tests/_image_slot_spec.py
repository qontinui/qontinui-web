"""Validate qontinui-web's image-slot specs, and compute their content hash.

Phase 14 of plan ``2026-10-13-image-generation-and-visual-judgment``. Every
image placement in the frontend is a *slot*, declared as one YAML file under
``frontend/image-slots/<slot>.yaml`` and rendered by ``<SlotImage>``. The
contract is qontinui-schemas' ``ImageSlotSpec`` (``rust/src/image_slot.rs``);
the TypeScript binding the frontend imports is declarations only, so it cannot
refuse a malformed YAML file. This module is where that file is refused, and
``tests/test_image_slot_specs.py`` runs it over every spec in CI.

A spec is valid iff BOTH layers the Rust type defines accept it:

1. **The schema layer**, enforced by the generated pydantic model
   (``qontinui_schemas.generated.ImageSlotSpec``): required fields, closed
   enums and objects, patterns, ranges, ``minItems``. It validates the YAML's
   JSON form STRICTLY (``model_validate_json(..., strict=True)``), because
   pydantic's lax mode coerces scalars serde refuses, such as ``"yes"`` for a
   boolean.
2. **The cross-field rules** JSON Schema cannot express, which
   ``ImageSlotSpec::validate`` checks in Rust and which, by that module's own
   statement, "a validator in another language must mirror by hand":
   :func:`rule_problems` below. Each problem names the same path and the same
   rule as the Rust ``ImageSlotProblem`` variant it mirrors.

The YAML is read as YAML 1.2 (core schema), as serde_yaml_ng reads it. PyYAML
alone reads YAML 1.1, which turns an unquoted ``yes`` / ``no`` / ``on`` /
``off`` into a boolean and ``4:3`` into the base-60 integer 243 before any
validator sees it, and keeps the last of two duplicate keys silently. The
loader here resolves only the 1.2 core scalars and refuses a duplicate key.

:func:`content_sha256` is the spec's content address, the value an asset
binding records as ``provenance.spec_sha256``: sha256 of the spec's RFC 8785
canonical JSON with ``provenance`` left out and every absent optional field
omitted (never ``null``). Every valid fixture in qontinui-schemas
``rust/tests/fixtures/image_slot/valid/`` pins the Rust value on a
``# content-sha256:`` line, and the test checks this implementation against
each of them. Whether a binding is CURRENT (its ``spec_sha256`` is the spec's
own hash) decides whether the binding obligations apply, exactly as in Rust:
a stale binding is checked only for its own consistency.
"""

from __future__ import annotations

import decimal
import hashlib
import json
import math
import re
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import yaml
from pydantic import ValidationError
from qontinui_schemas.generated import ImageSlotSpec

# ---------------------------------------------------------------------------
# YAML 1.2 (core schema) loading
# ---------------------------------------------------------------------------


class DuplicateKeyError(yaml.constructor.ConstructorError):
    """A mapping names the same key twice. serde_yaml_ng refuses it; PyYAML
    would keep the last value without a word."""


class _Yaml12CoreLoader(yaml.SafeLoader):
    """SafeLoader narrowed to the YAML 1.2 core schema's implicit scalars."""

    def construct_mapping(
        self, node: yaml.MappingNode, deep: bool = False
    ) -> dict[Any, Any]:
        seen: set[Any] = set()
        for key_node, _ in node.value:
            key = self.construct_object(key_node, deep=deep)
            if key in seen:
                raise DuplicateKeyError(
                    "while constructing a mapping",
                    node.start_mark,
                    f"found duplicate key {key!r}",
                    key_node.start_mark,
                )
            seen.add(key)
        mapping: dict[Any, Any] = super().construct_mapping(node, deep=deep)
        return mapping

    def construct_yaml12_int(self, node: yaml.ScalarNode) -> int:
        text = str(self.construct_scalar(node))
        if text.startswith("0o"):
            return int(text[2:], 8)
        if text.startswith("0x"):
            return int(text[2:], 16)
        # A 1.2 decimal: a leading zero is NOT octal, as it is in YAML 1.1.
        return int(text, 10)


# Replace (not extend) the inherited YAML 1.1 resolvers: copying the class
# attribute keeps SafeLoader itself untouched.
_Yaml12CoreLoader.yaml_implicit_resolvers = {}
_Yaml12CoreLoader.add_implicit_resolver(
    "tag:yaml.org,2002:null",
    re.compile(r"^(?:~|null|Null|NULL|)$"),
    ["~", "n", "N", ""],
)
_Yaml12CoreLoader.add_implicit_resolver(
    "tag:yaml.org,2002:bool",
    re.compile(r"^(?:true|True|TRUE|false|False|FALSE)$"),
    list("tTfF"),
)
_Yaml12CoreLoader.add_implicit_resolver(
    "tag:yaml.org,2002:int",
    re.compile(r"^(?:[-+]?[0-9]+|0o[0-7]+|0x[0-9a-fA-F]+)$"),
    list("-+0123456789"),
)
_Yaml12CoreLoader.add_implicit_resolver(
    "tag:yaml.org,2002:float",
    re.compile(
        r"^(?:[-+]?(?:\.[0-9]+|[0-9]+(?:\.[0-9]*)?)(?:[eE][-+]?[0-9]+)?"
        r"|[-+]?\.(?:inf|Inf|INF)|\.(?:nan|NaN|NAN))$"
    ),
    list("-+.0123456789"),
)
_Yaml12CoreLoader.add_constructor(
    "tag:yaml.org,2002:int", _Yaml12CoreLoader.construct_yaml12_int
)


def load_yaml12(text: str) -> Any:
    """Parse one YAML document under the 1.2 core schema."""
    return yaml.load(text, Loader=_Yaml12CoreLoader)  # noqa: S506 — a SafeLoader subclass


# ---------------------------------------------------------------------------
# RFC 8785 canonical JSON and the content hash
# ---------------------------------------------------------------------------

#: Largest integer RFC 8785 (I-JSON) carries exactly, 2^53 − 1.
MAX_SAFE_INTEGER = 2**53 - 1


class UnhashableSpec(ValueError):
    """The spec holds a number RFC 8785 cannot carry exactly. Rust's
    ``content_sha256`` refuses the same spec (``ImageSlotHashError``)."""


def _es_number(value: int | float) -> str:
    """ECMAScript ``Number::toString`` of ``value``, which RFC 8785 §3.2.2.3
    prescribes for every JSON number."""
    if isinstance(value, int):
        if abs(value) > MAX_SAFE_INTEGER:
            raise UnhashableSpec(f"integer {value} is above 2^53 - 1")
        return str(value)
    if not math.isfinite(value):
        raise UnhashableSpec(f"{value!r} is not a finite number")
    if value == 0:
        return "0"
    # repr() is the shortest digit string that round-trips, as ES requires;
    # only its layout differs, so take its digits and exponent and lay them
    # out by the ES rules.
    _, digit_tuple, exponent = decimal.Decimal(repr(abs(value))).as_tuple()
    if not isinstance(exponent, int):  # 'n' / 'N' / 'F': excluded by isfinite above
        raise UnhashableSpec(f"{value!r} is not a finite number")
    digits = "".join(map(str, digit_tuple)).rstrip("0")
    exponent += len(digit_tuple) - len(digits)
    k = len(digits)
    n = exponent + k  # value = 0.<digits> × 10^n
    prefix = "-" if value < 0 else ""
    if k <= n <= 21:
        return prefix + digits + "0" * (n - k)
    if 0 < n <= 21:
        return prefix + digits[:n] + "." + digits[n:]
    if -6 < n <= 0:
        return prefix + "0." + "0" * (-n) + digits
    e = n - 1
    mantissa = digits if k == 1 else digits[0] + "." + digits[1:]
    return f"{prefix}{mantissa}e{'+' if e >= 0 else '-'}{abs(e)}"


def _canonical(value: Any) -> str:
    if value is None:
        return "null"
    if value is True:
        return "true"
    if value is False:
        return "false"
    if isinstance(value, int | float):
        return _es_number(value)
    if isinstance(value, str):
        return json.dumps(value, ensure_ascii=False)
    if isinstance(value, list):
        return "[" + ",".join(_canonical(item) for item in value) + "]"
    if isinstance(value, dict):
        keys = sorted(value, key=lambda k: k.encode("utf-16-be"))
        return (
            "{"
            + ",".join(
                f"{json.dumps(k, ensure_ascii=False)}:{_canonical(value[k])}"
                for k in keys
            )
            + "}"
        )
    raise UnhashableSpec(f"{type(value).__name__} is not a JSON value")


def _without_absent(value: Any) -> Any:
    """The spec's JSON form: an absent optional field is omitted, never null."""
    if isinstance(value, dict):
        return {k: _without_absent(v) for k, v in value.items() if v is not None}
    if isinstance(value, list):
        return [_without_absent(v) for v in value]
    return value


def content_sha256(spec: dict[str, Any]) -> str:
    """The spec's content address: sha256 of its RFC 8785 canonical JSON with
    ``provenance`` left out. Mirrors ``ImageSlotSpec::content_sha256``."""
    authored = {k: v for k, v in spec.items() if k != "provenance"}
    canonical = _canonical(_without_absent(authored))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


# ---------------------------------------------------------------------------
# The cross-field rules ``ImageSlotSpec::validate`` checks beyond the schema
# ---------------------------------------------------------------------------

#: The Rust ``ImageSlotProblem`` variants a non-Rust validator mirrors by hand
#: (``is_schema_rule() == false``), with the message Rust displays for each.
RULES: dict[str, str] = {
    "NotAscending": "must be strictly ascending",
    "Duplicate": "repeats an earlier entry",
    "Contradictory": "is listed in both `must` and `must_not`",
    "RegionOutsideBox": "has no area, or passes the edge of its box",
    "NoOverride": "names no threshold",
    "MinAboveMax": "min_effective_resolution is above max_effective_resolution",
    "UnmarkedModelAsset": "a model-made asset is not marked ai_generated",
    "MissingInputDigest": "the binding lacks an input digest it must record",
    "MissingAltText": "a current binding of an `alt: required` slot records no alt_text",
    "AiGeneratedLogo": "a current binding of a logo slot is ai_generated",
    "UncapturedScreenshot": "a current binding of a screenshot slot was not captured",
}

_MODEL_MADE_SOURCES = frozenset({"generated", "edited"})

_THRESHOLD_FIELDS = (
    "min_effective_resolution",
    "max_effective_resolution",
    "max_aspect_delta",
    "max_bytes",
    "max_palette_delta_e",
    "min_palette_coverage",
    "min_text_over_image_contrast",
    "text_over_image_percentile",
    "min_transparent_edge_contrast",
)


@dataclass(frozen=True)
class Problem:
    """One broken rule, at the dotted path Rust reports it at."""

    path: str
    rule: str

    def __str__(self) -> str:
        detail = RULES.get(self.rule, self.rule)
        return f"{self.path}: {detail} ({self.rule})"


def _ascending(values: list[Any]) -> bool:
    return all(a < b for a, b in zip(values, values[1:], strict=False))


def _reduced_ratio(ratio: str) -> tuple[int, int]:
    w, h = (int(t) for t in ratio.split("/"))
    g = math.gcd(w, h)
    return (w // g, h // g)


def _content_key(entry: str) -> str:
    return entry.strip().lower()


def _rect_problem(path: str, rect: dict[str, Any]) -> Iterator[Problem]:
    x, y, width, height = rect["x"], rect["y"], rect["width"], rect["height"]
    if width <= 0 or height <= 0 or x + width > 1 or y + height > 1:
        yield Problem(path, "RegionOutsideBox")


def rule_problems(spec: dict[str, Any]) -> list[Problem]:
    """Every cross-field rule ``spec`` breaks. ``spec`` must already satisfy
    the schema layer (:func:`schema_errors` empty): these rules read values
    whose types and ranges the schema guarantees."""
    out: list[Problem] = []
    contexts = spec["contexts"]
    for field in ("breakpoints", "dpr"):
        if not _ascending(contexts[field]):
            out.append(Problem(f"contexts.{field}", "NotAscending"))
    themes = contexts["themes"]
    for i, theme in enumerate(themes):
        if theme in themes[:i]:
            out.append(Problem(f"contexts.themes[{i}]", "Duplicate"))

    aspect = spec["aspect"]
    seen = [_reduced_ratio(aspect["preferred"])]
    for i, ratio in enumerate(aspect["allowed"]):
        value = _reduced_ratio(ratio)
        if value in seen:
            out.append(Problem(f"aspect.allowed[{i}]", "Duplicate"))
        else:
            seen.append(value)

    safe_areas = spec["safe_areas"]
    if safe_areas["kind"] == "explicit":
        for i, region in enumerate(safe_areas["regions"]):
            out.extend(_rect_problem(f"safe_areas.regions[{i}]", region))
    out.extend(_rect_problem("focal.region", spec["focal"]["region"]))

    content = spec["content"]
    for field in ("must", "must_not"):
        entries = content[field]
        for i, entry in enumerate(entries):
            if any(_content_key(e) == _content_key(entry) for e in entries[:i]):
                out.append(Problem(f"content.{field}[{i}]", "Duplicate"))
    required = {_content_key(e) for e in content["must"]}
    for i, entry in enumerate(content["must_not"]):
        if _content_key(entry) in required:
            out.append(Problem(f"content.must_not[{i}]", "Contradictory"))

    thresholds = spec["thresholds"]
    if thresholds["kind"] == "overrides":
        if all(thresholds.get(name) is None for name in _THRESHOLD_FIELDS):
            out.append(Problem("thresholds", "NoOverride"))
        low = thresholds.get("min_effective_resolution")
        high = thresholds.get("max_effective_resolution")
        if low is not None and high is not None and low > high:
            out.append(Problem("thresholds", "MinAboveMax"))

    binding = spec.get("provenance")
    if binding is not None:
        out.extend(_binding_problems(spec, binding))
    return out


def _binding_problems(
    spec: dict[str, Any], binding: dict[str, Any]
) -> Iterator[Problem]:
    model_made = binding["source"] in _MODEL_MADE_SOURCES
    if model_made:
        if not binding["ai_generated"]:
            yield Problem("provenance.ai_generated", "UnmarkedModelAsset")
        for digest in ("recipe_sha256", "imagery_sha256"):
            if binding.get(digest) is None:
                yield Problem(f"provenance.{digest}", "MissingInputDigest")
    try:
        current = content_sha256(spec) == binding["spec_sha256"]
    except UnhashableSpec:
        # Rust: "A spec without a content hash has a number its range rules
        # already refuse, so its binding's currency is not decided."
        current = False
    if not current:
        return
    if spec["alt"]["kind"] == "required" and binding.get("alt_text") is None:
        yield Problem("provenance.alt_text", "MissingAltText")
    style = spec["style"]
    if style.get("exemplars") is not None and binding.get("exemplars_sha256") is None:
        yield Problem("provenance.exemplars_sha256", "MissingInputDigest")
    if (
        style.get("lora") is not None
        and model_made
        and binding.get("lora_sha256") is None
    ):
        yield Problem("provenance.lora_sha256", "MissingInputDigest")
    if spec["role"] == "logo" and binding["ai_generated"]:
        yield Problem("provenance.ai_generated", "AiGeneratedLogo")
    if spec["role"] == "screenshot" and binding["source"] != "captured":
        yield Problem("provenance.source", "UncapturedScreenshot")


# ---------------------------------------------------------------------------
# The whole verdict for one spec file
# ---------------------------------------------------------------------------


def schema_errors(spec: Any) -> list[str]:
    """What the generated pydantic model refuses, validating strictly. Empty
    when the schema layer accepts ``spec``."""
    try:
        text = json.dumps(spec, allow_nan=True)
    except (TypeError, ValueError) as exc:  # a YAML type JSON has no form for
        return [f"not representable as JSON: {exc}"]
    try:
        ImageSlotSpec.model_validate_json(text, strict=True)
    except ValidationError as exc:
        return [
            f"{'.'.join(str(p) for p in err['loc']) or '<root>'}: {err['msg']}"
            for err in exc.errors()
        ]
    return []


@dataclass(frozen=True)
class SpecVerdict:
    """The verdict on one spec file."""

    path: Path
    spec: Any
    schema: list[str]
    rules: list[Problem]

    @property
    def valid(self) -> bool:
        return not self.schema and not self.rules

    def describe(self) -> str:
        lines = [f"{self.path}:"]
        lines += [f"  schema: {e}" for e in self.schema]
        lines += [f"  rule: {p}" for p in self.rules]
        return "\n".join(lines)


def check_spec_file(path: Path) -> SpecVerdict:
    """Read ``path`` as YAML 1.2 and run both validation layers on it."""
    try:
        spec = load_yaml12(path.read_text(encoding="utf-8"))
    except yaml.YAMLError as exc:
        return SpecVerdict(path, None, [f"not readable as YAML 1.2: {exc}"], [])
    schema = schema_errors(spec)
    rules = rule_problems(spec) if not schema else []
    return SpecVerdict(path, spec, schema, rules)
