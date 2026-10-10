#!/usr/bin/env python3
"""Generate the build-record scanner parity fixture from web's own scanner.

    python -I backend/scripts/gen_build_record_scan_vectors.py          # write
    python -I backend/scripts/gen_build_record_scan_vectors.py --check  # diff

Writes ``backend/tests/fixtures/build_record_scan_vectors.json``. Every
expected value in it is computed HERE, by calling
``app.services.build_record_allowlist`` (``build_record_violations``,
``normalize_for_scan``) — nothing is hand-written — so the fixture is web's
scanner, frozen. qontinui-coord's port of the scanner copies the fixture
verbatim and must reproduce every vector;
``tests/test_build_records.py::test_the_scan_vector_fixture_is_current``
regenerates it and fails CI when the committed copy is stale, so a web
scanner change cannot land without a regenerated fixture (and an
``ALLOWLIST_VERSION`` bump, which the fixture also carries).

``category_overrides`` — which of the two options the parity contract offered
this takes: web does NOT fetch Unicode 17's ``UnicodeData.txt`` (a test that
needs the network is not a test CI can run). Instead it emits, as compact
inclusive ``[first, last]`` ranges over U+0000..U+10FFFF, every code point that
web's Python (``unidata_version``) puts in each category the scanner treats
specially — refused (``Cc Cf Cn Co Cs``) or stripped (``Mn Me``) — plus the
default-ignorable and overlay tables. coord diffs those ranges against its own
Unicode tables; any difference is a code point the two scanners classify
differently.

``unidata_version`` matters: category membership comes from the
interpreter's Unicode database, so the fixture must be generated on the
CI-pinned Python (``PYTHON_VERSION`` in ``.github/workflows/backend-ci.yml``,
3.12 -> Unicode 15.0.0). Without that interpreter locally:
``docker run --rm -u "$(id -u):$(id -g)" -v "$PWD/backend:/backend" -w /
python:3.12-slim python -I /backend/scripts/gen_build_record_scan_vectors.py``
(the generator needs only the standard library).

``-I`` (isolated mode): the script puts ``backend/`` on ``sys.path`` itself
and reads no ``PYTHON*`` variable, so the output depends only on the tree and
the interpreter's Unicode database.
"""

from __future__ import annotations

import argparse
import copy
import json
import sys
import unicodedata
from pathlib import Path
from typing import Any

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

from app.services import build_record_allowlist as al  # noqa: E402

GENERATOR = "backend/scripts/gen_build_record_scan_vectors.py"
FIXTURE = BACKEND / "tests" / "fixtures" / "build_record_scan_vectors.json"
CATEGORIES = ("Cc", "Cf", "Cn", "Co", "Cs", "Me", "Mn")


def _compress(points: list[int]) -> list[list[int]]:
    ranges: list[list[int]] = []
    for point in points:
        if ranges and ranges[-1][1] == point - 1:
            ranges[-1][1] = point
        else:
            ranges.append([point, point])
    return ranges


def category_ranges() -> dict[str, list[list[int]]]:
    members: dict[str, list[int]] = {cat: [] for cat in CATEGORIES}
    for point in range(0x110000):
        cat = unicodedata.category(chr(point))
        if cat in members:
            members[cat].append(point)
    return {cat: _compress(points) for cat, points in members.items()}


def base_document() -> dict[str, Any]:
    """A valid, deterministic ``build-record/1`` document (no clock reads)."""
    return {
        "schema": al.BUILD_RECORD_SCHEMA,
        "generated_at": "2026-10-09T12:00:00Z",
        "product": {
            "slug": "demo",
            "title": "Demo",
            "repos": ["acme/public-app"],
            "window_start": None,
            "window_end": None,
        },
        "work_units": [
            {
                "slug": "2026-10-01-demo",
                "title": "Demo work",
                "status": "shipped",
                "vetted_at": None,
                "shipped_at": None,
            }
        ],
        "timeline": [
            {
                "at": "2026-10-01T00:00:00Z",
                "work_unit": "2026-10-01-demo",
                "from_status": None,
                "to_status": "shipped",
            }
        ],
        "prs": [
            {
                "repo": "acme/public-app",
                "number": 1,
                "title": "feat: demo",
                "opened_at": None,
                "landed_at": None,
                "ci_duration_secs": None,
                "attempts": None,
            }
        ],
        "gates": {"registered": 0, "cleared": 0},
        "sessions": {
            "count": None,
            "unknown_reason": "sessions.count: census_provisional",
        },
        "wall_clock_secs": None,
        "self_corrections": {
            "red_ci_fixed": None,
            "review_findings_fixed": None,
            "gate_reopens": None,
        },
        "unknowns": ["sessions.count: census_provisional"],
    }


def _title(text: str) -> Any:
    def apply(doc: dict[str, Any]) -> None:
        doc["work_units"][0]["title"] = text

    return apply


def _product_slug(slug: str) -> Any:
    def apply(doc: dict[str, Any]) -> None:
        doc["product"]["slug"] = slug

    return apply


def _add_unknown(text: str) -> Any:
    def apply(doc: dict[str, Any]) -> None:
        doc["unknowns"].append(text)

    return apply


def _public_repo(repo: str) -> Any:
    def apply(doc: dict[str, Any]) -> None:
        doc["product"]["repos"] = [repo]
        doc["prs"][0]["repo"] = repo

    return apply


def _excluded_names(repos: list[str]) -> list[str]:
    """Exactly how web's publish route derives names from excluded repos
    (``_excluded_names`` in ``app/api/v1/endpoints/build_records.py``):
    lower-cased, the segment after the first ``/``."""
    return sorted(
        {r.lower().split("/", 1)[1] for r in repos if "/" in r and r.split("/", 1)[1]}
    )


#: ``(id, mutation, excluded repos)`` — the mutation is applied to
#: :func:`base_document`; the expected violations are computed by web.
DOCUMENT_CASES: list[tuple[str, Any, list[str]]] = [
    ("baseline", None, []),
    ("title_u1fae9", _title("Ship it \U0001fae9"), []),
    ("title_u1ccd6", _title("Ship it \U0001ccd6"), []),
    (
        "excluded_name_through_u1171e",
        _title("port secret-a\U0001171epi"),
        ["acme/secret-api"],
    ),
    ("excluded_name_overlapping", _title("yx-x-x"), ["acme/x-x"]),
    (
        "excluded_name_upper_case_in_text",
        _title("sync SECRET-ENGINE now"),
        ["acme/Secret-Engine"],
    ),
    ("greek_confusables_repo_token", _title("port αcme/sεcret"), []),
    ("minus_sign_uuid", _title("id 1b4e28ba−2fa1−11d2−883f−0016d3cca427"), []),
    ("minus_sign_between_words", _title("acme−secret"), []),
    ("spaced_double_slash", _title("a / / b"), []),
    ("braille_blank_split_repo_token", _title("acme\u2800/\u2800secret"), []),
    (
        "f3_product_slug_equals_excluded_name",
        _product_slug("design-tokens"),
        ["acme/design-tokens"],
    ),
    ("f3_unknown_names_excluded_sessions", None, ["acme/sessions"]),
    (
        "f3_unknown_names_excluded_review",
        _add_unknown("self_corrections.review_findings_fixed: not_established"),
        ["acme/review"],
    ),
    ("f3_title_is_still_scanned", _title("tokens for review"), ["acme/review"]),
    (
        "public_repo_name_contains_excluded_name",
        _public_repo("acme/qontinui-design-tokens"),
        ["acme/design-tokens"],
    ),
]

#: Strings whose normalised scan form is pinned.
NORMALIZE_CASES: list[tuple[str, str]] = [
    ("spaced_double_slash", "a / / b"),
    ("division_slash_spaced", "acme ∕ secret"),
    ("greek_alpha_epsilon", "αcme/sεcret"),
    ("minus_sign", "x−y"),
    ("ahom_mark_stripped", "secret-a\U0001171epi"),
    ("upper_case_kept", "SECRET-ENGINE"),
    ("middle_dot_infix", "acme·secret"),
    ("fullwidth", "ａcme／secret"),
    ("combining_acute", "secrét"),
]


def build() -> dict[str, Any]:
    vectors = []
    for case_id, mutate, excluded_repos in DOCUMENT_CASES:
        doc = base_document()
        if mutate is not None:
            mutate(doc)
        names = _excluded_names(excluded_repos)
        vectors.append(
            {
                "id": case_id,
                "document": copy.deepcopy(doc),
                "excluded_repos": excluded_repos,
                "excluded_names": names,
                "violations": al.build_record_violations(doc, excluded_names=names),
            }
        )
    normalize = [
        {"id": case_id, "input": text, "normalized": al.normalize_for_scan(text)}
        for case_id, text in NORMALIZE_CASES
    ]
    return {
        "generator": GENERATOR,
        "generator_command": f"python -I {GENERATOR}",
        "allowlist_version": al.ALLOWLIST_VERSION,
        "unidata_version": unicodedata.unidata_version,
        "excluded_name_exempt_paths": list(al.EXCLUDED_NAME_EXEMPT_PATHS),
        "max_scanned_string_chars": al.MAX_SCANNED_STRING_CHARS,
        "max_nfkd_expansion": al.MAX_NFKD_EXPANSION,
        "max_document_bytes": al.MAX_DOCUMENT_BYTES,
        "refused_categories": sorted(al._REFUSED_CATEGORIES),
        "stripped_categories": sorted(al._STRIPPED_CATEGORIES),
        "default_ignorable_ranges": [list(r) for r in al.DEFAULT_IGNORABLE_RANGES],
        "overlay_marks": sorted(ord(c) for c in al._OVERLAY_MARKS),
        "blank_rendering_glyphs": sorted(ord(c) for c in al.BLANK_RENDERING_GLYPHS),
        "category_overrides": {
            "method": (
                "web's own category membership as inclusive code point ranges "
                "(no Unicode 17 UnicodeData.txt is fetched); diff against your tables"
            ),
            "ranges": category_ranges(),
        },
        "document_vectors": vectors,
        "normalize_vectors": normalize,
    }


def render() -> str:
    return json.dumps(build(), indent=1, ensure_ascii=True) + "\n"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument(
        "--check",
        action="store_true",
        help="exit 1 if the committed fixture differs from a fresh generation",
    )
    args = parser.parse_args(argv)
    fresh = render()
    if args.check:
        current = FIXTURE.read_text(encoding="utf-8") if FIXTURE.exists() else ""
        if current != fresh:
            print(
                f"{FIXTURE.relative_to(BACKEND.parent)} is stale: regenerate it "
                f"with `python -I {GENERATOR}` and commit the result",
                file=sys.stderr,
            )
            return 1
        print("build-record scan vectors: fixture is current")
        return 0
    FIXTURE.parent.mkdir(parents=True, exist_ok=True)
    FIXTURE.write_text(fresh, encoding="utf-8")
    print(f"wrote {FIXTURE.relative_to(BACKEND.parent)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
