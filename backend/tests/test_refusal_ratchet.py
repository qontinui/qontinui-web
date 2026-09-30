"""D4 ratchet: bare-string HTTP error responses may fall, never rise.

Plan ``2026-09-20-the-published-product-works-without-knowing-a-development-environment-exists``,
Phase D4. Every operator-facing refusal should be built through
``app.core.refusal.refusal_error``, which cannot be called without a typed
next action. This test counts the error responses under ``app/`` that are
still constructed OUTSIDE it, as a free-text sentence only:

* an ``HTTPException`` (or any ``*HTTPException`` class, e.g. Starlette's or a
  local subclass — ``RefusalHTTPException`` excepted) whose ``detail`` is a
  bare string: a literal, an f-string, a ``+``/``%`` concatenation or a
  ``"...".format(...)``;
* a ``JSONResponse`` with a literal status of 400 or more whose ``content`` is
  a dict literal carrying a bare-string ``"detail"`` and NO ``refusal`` key
  (a route that returns its body by hand nests the envelope there — see
  ``app.core.refusal``).

The count must EQUAL :data:`BASELINE`. Above it, a new free-text refusal was
added — build it with ``refusal_error`` instead. Below it, a conversion
landed and the baseline is stale — lower :data:`BASELINE` to the new count in
the same change, so the floor it guards moves down with it.

Detection is syntactic (``ast``), so a string held in a variable and passed as
``detail=name`` is not counted: the ratchet measures the grep-detectable
shape the plan names, and says so rather than claiming more.
"""

from __future__ import annotations

import ast
from collections import Counter
from pathlib import Path

#: The exact count on the head that introduced this ratchet (846 before the
#: D2 conversions on the same change). Lower it when a conversion lands;
#: never raise it.
BASELINE = 808

APP_DIR = Path(__file__).resolve().parent.parent / "app"

_EXEMPT_CLASSES = frozenset({"RefusalHTTPException"})


def _is_bare_string(node: ast.AST) -> bool:
    if isinstance(node, ast.Constant):
        return isinstance(node.value, str)
    if isinstance(node, ast.JoinedStr):
        return True
    if isinstance(node, ast.BinOp) and isinstance(node.op, (ast.Add, ast.Mod)):
        return _is_bare_string(node.left)
    if (
        isinstance(node, ast.Call)
        and isinstance(node.func, ast.Attribute)
        and node.func.attr == "format"
    ):
        return _is_bare_string(node.func.value)
    return False


def _callee_name(call: ast.Call) -> str | None:
    if isinstance(call.func, ast.Name):
        return call.func.id
    if isinstance(call.func, ast.Attribute):
        return call.func.attr
    return None


def _kwarg(call: ast.Call, name: str) -> ast.AST | None:
    for kw in call.keywords:
        if kw.arg == name:
            return kw.value
    return None


def _is_bare_http_exception(call: ast.Call) -> bool:
    name = _callee_name(call)
    if not name or not name.endswith("HTTPException") or name in _EXEMPT_CLASSES:
        return False
    detail = _kwarg(call, "detail")
    if detail is None and len(call.args) >= 2:
        detail = call.args[1]
    return detail is not None and _is_bare_string(detail)


def _is_refusal_key(key: ast.AST | None) -> bool:
    """``REFUSAL_KEY`` or the literal ``"refusal"``: the body carries the
    typed envelope, so it is not a free-text refusal."""
    if isinstance(key, ast.Name):
        return key.id == "REFUSAL_KEY"
    return isinstance(key, ast.Constant) and key.value == "refusal"


def _is_bare_json_error(call: ast.Call) -> bool:
    if _callee_name(call) != "JSONResponse":
        return False
    status = _kwarg(call, "status_code")
    if not (
        isinstance(status, ast.Constant)
        and isinstance(status.value, int)
        and status.value >= 400
    ):
        return False
    content = _kwarg(call, "content")
    if not isinstance(content, ast.Dict):
        return False
    if any(_is_refusal_key(key) for key in content.keys):
        return False
    for key, value in zip(content.keys, content.values, strict=True):
        if (
            isinstance(key, ast.Constant)
            and key.value == "detail"
            and _is_bare_string(value)
        ):
            return True
    return False


def count_bare_refusals(root: Path = APP_DIR) -> Counter[str]:
    """Per-file count of free-text error constructions under ``root``."""
    per_file: Counter[str] = Counter()
    for path in sorted(root.rglob("*.py")):
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        for node in ast.walk(tree):
            if isinstance(node, ast.Call) and (
                _is_bare_http_exception(node) or _is_bare_json_error(node)
            ):
                per_file[str(path.relative_to(root))] += 1
    return per_file


def test_bare_refusal_count_matches_baseline() -> None:
    per_file = count_bare_refusals()
    total = sum(per_file.values())
    worst = ", ".join(f"{f}={n}" for f, n in per_file.most_common(5))
    assert total <= BASELINE, (
        f"{total - BASELINE} new free-text error response(s) under app/ "
        f"(count {total} > baseline {BASELINE}). Build operator-facing "
        "refusals with app.core.refusal.refusal_error, which requires a typed "
        f"next action. Largest files: {worst}"
    )
    assert total == BASELINE, (
        f"The count fell to {total} (baseline {BASELINE}): the baseline is "
        f"stale. Lower BASELINE in {Path(__file__).name} to {total} in this "
        "change so the ratchet holds the new floor."
    )


# --- the detector itself can fail -----------------------------------------


def _count_source(source: str, tmp_path: Path) -> int:
    (tmp_path / "mod.py").write_text(source, encoding="utf-8")
    return sum(count_bare_refusals(tmp_path).values())


def test_detector_counts_every_bare_shape(tmp_path: Path) -> None:
    source = """
from fastapi import HTTPException
from fastapi.responses import JSONResponse
from starlette import exceptions
x = 1
HTTPException(status_code=404, detail="gone")
HTTPException(404, "positional")
HTTPException(status_code=400, detail=f"bad {x}")
HTTPException(status_code=400, detail="a" + str(x))
HTTPException(status_code=400, detail="%s" % x)
HTTPException(status_code=400, detail="{}".format(x))
exceptions.HTTPException(status_code=401, detail="no")
JSONResponse(status_code=503, content={"detail": "down", "id": 1})
"""
    assert _count_source(source, tmp_path) == 8


def test_detector_ignores_structured_and_refusal_shapes(tmp_path: Path) -> None:
    source = """
from fastapi import HTTPException
from fastapi.responses import JSONResponse
msg = "held in a variable"
HTTPException(status_code=409, detail={"error": "E", "message": "m"})
HTTPException(status_code=502, detail=msg)
HTTPException(status_code=502)
RefusalHTTPException(502, refusal, message="x", error_code="E")
JSONResponse(status_code=200, content={"detail": "fine"})
JSONResponse(status_code=404, content={"error": "E"})
JSONResponse(status_code=503, content={"detail": "down", REFUSAL_KEY: {}})
JSONResponse(status_code=503, content={"detail": "down", "refusal": {}})
"""
    assert _count_source(source, tmp_path) == 0
