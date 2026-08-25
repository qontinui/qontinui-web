"""Regression guard — nothing under ``app/`` may raw-write ``is_superuser``.

Plan: ``2026-08-01-web-bootstrap-superuser-routes-are-live-http-surface``
(follow-up to ``2026-07-29-web-put-users-me-self-privilege-escalation``,
PR #900).

PR #900 split ``crud.user.update_user`` into ``update_user_self`` /
``update_user_privileged`` so the self-service writer can no longer set
``auth.users.is_superuser``. That closed the CRUD path — but two HTTP routes
were writing the flag *directly on the ORM object*, bypassing the CRUD layer
entirely:

* ``POST /api/v1/auth/bootstrap-first-admin`` — **no auth dependency at all**,
  mounted on the public internet, promoting an attacker-supplied ``?email=``.
* ``POST /api/v1/users/me/claim-admin`` — any authenticated user.

Both are deleted. This test makes "no raw writer" a pinned property rather
than a point-in-time grep, using the same "ban the dead pattern" AST-scan
idiom as :mod:`tests.test_no_celery_import` (and
``test_no_fastembed_import`` / ``test_coord_schema_boundary_guard``).

**Reads are fine.** ``if not current_user.is_superuser: ...``,
``select(User).where(User.is_superuser == True)`` and
``{"is_superuser": user.is_superuser}`` are comparisons/reads, not grants —
only *writes* fail.

The allow-list is deliberately tiny and each entry is a non-HTTP trust
boundary:

* ``app/crud/user.py`` — the single privileged CRUD writer
  (``update_user_privileged``), gated on ``get_current_superuser_async``.
* ``app/db/init_db.py`` — the startup seed from ``FIRST_SUPERUSER_EMAIL``
  (DB/env access is its trust boundary, not HTTP).
* ``app/services/cognito_provision.py`` — provisions new users with
  ``is_superuser=False``; it never grants.
"""

from __future__ import annotations

import ast
from pathlib import Path

APP_ROOT = Path(__file__).resolve().parent.parent / "app"

FLAG = "is_superuser"

# Repo-relative (POSIX) paths permitted to write the flag. Adding to this
# list is a security decision: the new entry must not be reachable from an
# HTTP handler without a superuser dependency.
ALLOWED = {
    # NOTE: the detector never actually flags this file. Its write is
    # ``setattr(user, field, value)`` with a VARIABLE attribute name
    # (``app/crud/user.py`` ~L47), and the ``setattr`` arm below only matches an
    # ``ast.Constant`` name. The entry is kept deliberately: the write is real,
    # so the file belongs on a security allow-list even though this particular
    # scanner cannot see it. Do not read its presence as "the scanner cleared
    # this file".
    "app/crud/user.py",
    "app/db/init_db.py",
    "app/services/cognito_provision.py",
}

# Structured-logging levels. ``logger.info(..., is_superuser=user.is_superuser)``
# passes the flag as log CONTEXT — it reads the value, it does not set one, so
# it is not a writer. ``app/api/v1/endpoints/annotations.py:46`` is the only
# instance today. The exemption is deliberately narrow (the callee must be a
# ``*log*``-named object) so a real writer cannot hide behind it.
_LOG_LEVELS = {
    "debug",
    "info",
    "warning",
    "warn",
    "error",
    "exception",
    "critical",
    "bind",
}


def _is_logging_call(call: ast.Call) -> bool:
    """True for ``logger.info(...)``-shaped calls (structlog / stdlib)."""
    func = call.func
    return (
        isinstance(func, ast.Attribute)
        and func.attr in _LOG_LEVELS
        and isinstance(func.value, ast.Name)
        and "log" in func.value.id.lower()
    )


def _targets_the_flag(target: ast.expr) -> bool:
    """True if ``target`` is an assignment target naming the flag.

    Covers ``user.is_superuser = ...`` (attribute) and
    ``row["is_superuser"] = ...`` (constant string subscript). A bare
    ``is_superuser: Mapped[bool] = mapped_column(...)`` in
    ``app/models/user.py`` is the COLUMN DECLARATION, not a row write, so
    plain ``ast.Name`` targets are intentionally not matched.
    """
    if isinstance(target, ast.Attribute):
        return target.attr == FLAG
    if isinstance(target, ast.Subscript):
        index = target.slice
        return isinstance(index, ast.Constant) and index.value == FLAG
    if isinstance(target, ast.Tuple | ast.List):
        return any(_targets_the_flag(el) for el in target.elts)
    return False


def _writers(path: Path) -> list[str]:
    """Every place ``path`` WRITES the flag, as ``<path>:<line>: <why>``."""
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    rel = path.relative_to(APP_ROOT.parent).as_posix()
    hits: list[str] = []

    for node in ast.walk(tree):
        # ``user.is_superuser = True`` / ``|=`` / annotated assignment.
        if isinstance(node, ast.Assign):
            if any(_targets_the_flag(t) for t in node.targets):
                hits.append(f"{rel}:{node.lineno}: assignment to .{FLAG}")
        elif isinstance(node, ast.AugAssign | ast.AnnAssign):
            if _targets_the_flag(node.target):
                hits.append(f"{rel}:{node.lineno}: assignment to .{FLAG}")
        elif isinstance(node, ast.Call):
            # ``User(is_superuser=True)``, ``.values(is_superuser=...)``,
            # ``update(..., is_superuser=...)`` — a keyword grant.
            if not _is_logging_call(node):
                for kw in node.keywords:
                    if kw.arg == FLAG:
                        hits.append(f"{rel}:{node.lineno}: {FLAG}= keyword")
            # ``setattr(obj, "is_superuser", True)`` — the obvious evasion.
            if (
                isinstance(node.func, ast.Name)
                and node.func.id == "setattr"
                and len(node.args) >= 2
                and isinstance(node.args[1], ast.Constant)
                and node.args[1].value == FLAG
            ):
                hits.append(f"{rel}:{node.lineno}: setattr(..., {FLAG!r}, ...)")

    return hits


def _scan() -> tuple[int, list[str]]:
    """Walk ``app/`` once. Returns ``(files_scanned, writer_hits)``."""
    scanned = 0
    hits: list[str] = []
    for path in sorted(APP_ROOT.rglob("*.py")):
        if "__pycache__" in path.parts:
            continue
        scanned += 1
        hits.extend(_writers(path))
    return scanned, hits


def test_scan_actually_covers_the_app_package() -> None:
    """The walk must PROVE it walked — an empty scan reads like a pass.

    ``app/`` carried 675 modules when this test was written. The floor is
    deliberately far below that (so ordinary deletions don't fail it) and
    far above zero (so a broken ``APP_ROOT``, a moved package, or a scan
    that silently matched nothing fails loudly instead of passing green).
    """
    scanned, _hits = _scan()
    assert scanned >= 400, (
        f"only {scanned} modules scanned under {APP_ROOT} — the invariant "
        "scan is not covering app/, so its green result is meaningless"
    )


def test_the_known_good_writers_are_still_detected() -> None:
    """The detector must FIND the writers it is allowed to tolerate.

    Without this, a detector that stopped matching anything (a refactored
    AST shape, a typo in ``FLAG``) would report "no violations" forever.
    These two are the entire legitimate write surface under ``app/``:
    ``init_db`` seeds the first superuser, ``cognito_provision`` creates
    users with the flag off.
    """
    _scanned, hits = _scan()
    found = {hit.split(":")[0] for hit in hits}
    assert "app/db/init_db.py" in found, (
        "the seed writer app/db/init_db.py was not detected — the scanner "
        f"is blind. Detected writers: {sorted(found)}"
    )
    assert "app/services/cognito_provision.py" in found, (
        "app/services/cognito_provision.py was not detected — the scanner "
        f"is blind. Detected writers: {sorted(found)}"
    )


def test_no_raw_is_superuser_writer_outside_the_allow_list() -> None:
    """The invariant: no module under ``app/`` grants superuser raw."""
    _scanned, hits = _scan()
    offenders = [hit for hit in hits if hit.split(":")[0] not in ALLOWED]

    assert not offenders, (
        f"Raw {FLAG} writers are banned outside {sorted(ALLOWED)} — a route "
        "that sets the flag directly bypasses "
        "crud.user.update_user_privileged and its "
        "get_current_superuser_async gate (this is exactly how "
        "POST /api/v1/auth/bootstrap-first-admin and "
        "POST /api/v1/users/me/claim-admin escalated). Found:\n" + "\n".join(offenders)
    )


def test_the_deleted_bootstrap_module_stays_deleted() -> None:
    """``auth/bootstrap.py`` must not come back.

    It took no authentication whatsoever and was reachable from the public
    internet. The first-superuser capability lives in ``app/db/init_db.py``
    (startup, off the HTTP surface) — not in a route.
    """
    assert not (
        APP_ROOT / "api" / "v1" / "endpoints" / "auth" / "bootstrap.py"
    ).exists(), (
        "app/api/v1/endpoints/auth/bootstrap.py is back — the first-admin "
        "bootstrap belongs in app/db/init_db.py, not on an unauthenticated "
        "HTTP route."
    )
