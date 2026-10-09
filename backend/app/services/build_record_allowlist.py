"""The D3 allowlist for a public build record, and the validator that enforces it.

Plan ``2026-10-09-factory-built-product-portfolio-and-launch-kit``, design
decision D3 ("public redaction is explicit, not implied") and Phase 1.

coord's ``coord_build_record`` composer applies this allowlist at its one exit.
qontinui-web applies it AGAIN before a document is frozen into
``web.build_record_snapshots`` — defence in depth, so a coord regression that
starts emitting a new field cannot reach the unauthenticated public route. The
key set here is the binding cross-repo contract's ``build-record/1`` schema,
key for key; ``tests/test_build_records.py`` pins it.

What the validator refuses
==========================

* any key not in :data:`BUILD_RECORD_ALLOWLIST`, at any depth;
* a container where a scalar belongs (a dict in a scalar slot could carry
  arbitrary unvetted keys) and a scalar where a container belongs;
* a ``schema`` other than :data:`BUILD_RECORD_SCHEMA`;
* a PR whose ``repo`` is not one of ``product.repos``. coord lists only repos
  POSITIVELY known public there, so a PR from any other repo is a private repo
  name leaking through the PR list.

A key the allowlist names but the document omits is NOT a violation: absence
leaks nothing, and the publish path stores what coord sent.
"""

from __future__ import annotations

from typing import Any, Final

#: The one schema id this allowlist describes.
BUILD_RECORD_SCHEMA: Final = "build-record/1"


class _Scalar:
    """Marker for a slot that must hold a JSON scalar (str/int/float/bool/null)."""

    def __repr__(self) -> str:
        return "SCALAR"


SCALAR: Final = _Scalar()

#: The allowlist as a shape: a dict maps each allowed key to the shape of its
#: value, a one-element list means "a list whose items all have this shape",
#: and :data:`SCALAR` is a leaf.
BUILD_RECORD_ALLOWLIST: Final[dict[str, Any]] = {
    "schema": SCALAR,
    "generated_at": SCALAR,
    "product": {
        "slug": SCALAR,
        "title": SCALAR,
        "repos": [SCALAR],
        "window_start": SCALAR,
        "window_end": SCALAR,
    },
    "work_units": [
        {
            "slug": SCALAR,
            "title": SCALAR,
            "status": SCALAR,
            "vetted_at": SCALAR,
            "shipped_at": SCALAR,
        }
    ],
    "timeline": [
        {
            "at": SCALAR,
            "work_unit": SCALAR,
            "from_status": SCALAR,
            "to_status": SCALAR,
        }
    ],
    "prs": [
        {
            "repo": SCALAR,
            "number": SCALAR,
            "title": SCALAR,
            "opened_at": SCALAR,
            "landed_at": SCALAR,
            "ci_duration_secs": SCALAR,
            "attempts": SCALAR,
        }
    ],
    "gates": {"registered": SCALAR, "cleared": SCALAR},
    "sessions": {"count": SCALAR, "unknown_reason": SCALAR},
    "wall_clock_secs": SCALAR,
    "self_corrections": {
        "red_ci_fixed": SCALAR,
        "review_findings_fixed": SCALAR,
        "gate_reopens": SCALAR,
    },
    "unknowns": [SCALAR],
}


def _key_paths(shape: Any, prefix: str) -> list[str]:
    if isinstance(shape, dict):
        paths: list[str] = []
        for key, sub in shape.items():
            path = f"{prefix}.{key}" if prefix else key
            paths.append(path)
            paths.extend(_key_paths(sub, path))
        return paths
    if isinstance(shape, list):
        return _key_paths(shape[0], f"{prefix}[]")
    return []


#: Every allowed key, as a dotted path with ``[]`` for list items
#: (``prs[].repo``). The flat form a test pins against the contract.
BUILD_RECORD_ALLOWED_PATHS: Final[frozenset[str]] = frozenset(
    _key_paths(BUILD_RECORD_ALLOWLIST, "")
)

_SCALAR_TYPES = (str, int, float, bool, type(None))


class BuildRecordRejected(ValueError):
    """The document failed the D3 allowlist. ``violations`` names every failure."""

    def __init__(self, violations: list[str]) -> None:
        super().__init__("; ".join(violations))
        self.violations = violations


def _walk(value: Any, shape: Any, path: str, out: list[str]) -> None:
    where = path or "<root>"
    if isinstance(shape, dict):
        if not isinstance(value, dict):
            out.append(f"{where}: expected an object, got {type(value).__name__}")
            return
        for key, sub in value.items():
            child = f"{path}.{key}" if path else str(key)
            if key not in shape:
                out.append(f"{child}: key is not in the build-record allowlist")
                continue
            _walk(sub, shape[key], child, out)
        return
    if isinstance(shape, list):
        if not isinstance(value, list):
            out.append(f"{where}: expected a list, got {type(value).__name__}")
            return
        for index, item in enumerate(value):
            _walk(item, shape[0], f"{path}[{index}]", out)
        return
    if not isinstance(value, _SCALAR_TYPES):
        out.append(f"{where}: expected a scalar, got {type(value).__name__}")


def build_record_violations(document: Any) -> list[str]:
    """Every way ``document`` breaks the allowlist; empty when it is publishable."""
    out: list[str] = []
    _walk(document, BUILD_RECORD_ALLOWLIST, "", out)
    if not isinstance(document, dict):
        return out

    if document.get("schema") != BUILD_RECORD_SCHEMA:
        out.append(
            f"schema: expected {BUILD_RECORD_SCHEMA!r}, got {document.get('schema')!r}"
        )

    product = document.get("product")
    repos = product.get("repos") if isinstance(product, dict) else None
    public_repos = (
        {r for r in repos if isinstance(r, str)} if isinstance(repos, list) else set()
    )
    prs = document.get("prs")
    if isinstance(prs, list):
        for index, pr in enumerate(prs):
            if not isinstance(pr, dict):
                continue
            repo = pr.get("repo")
            if repo not in public_repos:
                out.append(
                    f"prs[{index}].repo: not one of product.repos, so not known public"
                )
    return out


def validate_build_record(document: Any) -> dict[str, Any]:
    """Return ``document`` unchanged when it passes; raise :class:`BuildRecordRejected`."""
    violations = build_record_violations(document)
    if violations:
        raise BuildRecordRejected(violations)
    assert isinstance(document, dict)  # guaranteed by an empty violation list
    return document
