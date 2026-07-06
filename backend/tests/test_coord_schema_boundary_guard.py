"""Web↔coord schema-boundary guard — the read-vs-write split (Phase 4).

Plan: ``D:/qontinui-root/plans/2026-05-30-web-coord-schema-boundary-decoupling.md``.

The boundary invariant has TWO halves with different lifecycles, and this
guard expresses them as two distinct sets so the invariant stays honest:

READ boundary — **CLOSED, and must stay closed.**
    Web makes **zero direct reads** of coord's Postgres ``coord.*`` schema.
    Everything web needs to *read* from coord comes over coord's HTTP API,
    authorized on the forwarded Cognito bearer (``coord_identity.py`` for
    identity, ``coord_device.py`` for device routing/list/get, the
    ``agent_sessions`` proxy for session lineage). After Phases 1-3 there
    is **no** ``coord.<table>`` token left in any SQL **read** string literal
    anywhere under ``backend/app``. ``READ_BOUNDARY_CLOSED`` is therefore the
    EMPTY set, and its emptiness IS the invariant: any newly-introduced
    ``coord.*`` read SQL (a ``SELECT ... FROM coord.x`` / ``JOIN coord.x``
    string literal) lands the offending file in this set and fails CI.

WRITE path + cross-schema FKs — a **named, scoped follow-up** (still open).
    Web keeps direct WRITE access to ``coord.*`` for the device
    register/heartbeat/delete + WS-lifecycle path (the ``Device`` /
    ``DeviceConnection`` ORM models bound with ``{"schema": "coord"}``), plus
    the cross-schema FOREIGN KEY targets on web-owned tables that point at
    ``coord.devices`` / ``coord.device_connections``. These are NOT reads and
    NOT a boundary breach — they are the explicitly out-of-scope device-write
    follow-up that a *later* plan removes (when the device-write path also
    moves onto coord HTTP). They are enumerated in ``WRITE_PATH_FOLLOWUP``,
    each with the reason it is still here. **``WRITE_PATH_FOLLOWUP`` shrinks
    to the empty set when the device-write migration ships** — at which point
    the entire web→coord boundary (read AND write) is closed and this guard
    permits no ``coord.*`` binding at all.

What counts (AST-based, so prose is never flagged):

* A ``coord.<table>`` token inside a **non-docstring** string literal — raw
  read SQL (``"SELECT ... FROM coord.devices"``) or a ``ForeignKey(
  "coord.devices...")`` target / a DDL ``comment=`` mentioning a coord table.
* A SQLAlchemy ORM schema binding ``{"schema": "coord"}`` / ``schema="coord"``.

Docstrings/comments that merely *mention* ``coord.operators`` etc. (history,
not a live binding) are intentionally excluded — only executable string
literals and ORM bindings count.

Fail conditions (see the three test functions below):

(a) **read set non-empty** — any ``coord.`` SQL read literal in a file that
    is NOT a ``WRITE_PATH_FOLLOWUP`` write-path file (a reintroduced read).
(b) **new write coupling** — a ``{"schema":"coord"}`` / FK binding in a file
    that is NOT listed in ``WRITE_PATH_FOLLOWUP`` (an unsanctioned new write
    site, e.g. someone bolting another coord-schema ORM model onto web).
(c) **stale allowlist** — a ``WRITE_PATH_FOLLOWUP`` entry that no longer
    actually contains a coord binding (the follow-up partially shipped but
    the entry wasn't pruned — keeps the allowlist from rotting and masking a
    future reintroduction).

Mirror of coord's ``tests/coord_schema_authorship.rs`` allowlist pattern.
"""

from __future__ import annotations

import ast
import re
from pathlib import Path

# ---------------------------------------------------------------------------
# READ_BOUNDARY_CLOSED — the read-boundary invariant.
#
# This set is EMPTY and MUST stay empty. It is the list of files still
# carrying a ``coord.<table>`` token inside a SQL **read** string literal.
# After Phases 1-3, no such file exists: identity reads moved to
# ``coord_identity.py`` (coord ``GET /admin/coord/me``), device routing/list/
# get reads moved to ``coord_device.py`` (coord ``GET /coord/devices/*``), and
# the agent-session reads moved to the ``agent_sessions`` coord proxy. Its
# emptiness is the boundary: any new ``coord.*`` read SQL repopulates it and
# fails ``test_read_boundary_is_closed``.
# ---------------------------------------------------------------------------
READ_BOUNDARY_CLOSED: frozenset[str] = frozenset()

# ---------------------------------------------------------------------------
# WRITE_PATH_FOLLOWUP — the still-open device-WRITE + cross-schema-FK sites.
#
# Each file below legitimately binds to ``coord.*`` for the device-write path
# or a cross-schema FK. This is the documented, out-of-scope device-write
# follow-up — NOT a read, NOT a breach. A later plan moves the device-write
# path onto coord HTTP and drains this set to empty (closing the write half of
# the boundary too). Paths are relative to ``backend/app``, POSIX-style.
# ---------------------------------------------------------------------------
WRITE_PATH_FOLLOWUP: frozenset[str] = frozenset(
    {
        # `{"schema": "coord"}` binding on the `Device` ORM model that still
        # carries the register / heartbeat / delete / WS-lifecycle WRITES to
        # `coord.devices` (device-write follow-up removes this).
        "models/device.py",
        # `{"schema": "coord"}` binding + FK to `coord.devices.device_id` for
        # the WS-lifecycle connection-history WRITES (device-write follow-up).
        "models/device_connection.py",
        # Cross-schema FK target → `coord.devices.device_id` on the web-owned
        # `phase_result` table (device-write follow-up drops the FK).
        "models/phase_result.py",
        # Cross-schema FK target → `coord.device_connections.id` on the
        # web-owned `software_test_run` table (device-write follow-up).
        "models/software_test_run.py",
        # `{"schema": "coord"}` binding on the `TestTarget` ORM model — the
        # fleet-fresh P5 test-host designation write path to `coord.test_targets`
        # (same shared-Postgres posture as `Device` against `coord.devices`;
        # a later plan moves this designation write onto coord HTTP and drains
        # this entry).
        "models/test_target.py",
    }
)
# NOTE: files that mention `coord.*` only in DOCSTRINGS/comments (e.g.
# `operations.py`, `crud/device_crud.py`, `services/coord_device_status.py`,
# `api/v1/endpoints/agent_sessions.py`, `api/v1/endpoints/devices.py`) are in
# NEITHER set — the guard does not flag prose, only executable SQL string
# literals and ORM schema bindings.

_APP_ROOT = Path(__file__).resolve().parents[1] / "app"

# A `coord.<table>` token. Lower-snake table names (matches coord's tables).
_COORD_TOKEN = re.compile(r"coord\.[a-z_]+")

# ORM schema binding, both spellings:
#   * dict literal   `{"schema": "coord"}`  → key is quoted, then `:`
#   * kwarg          `schema="coord"`        → bare `schema`, then `=`
# `schema['"]?` tolerates the closing quote of a quoted dict key; the
# separator is `:` (dict) or `=` (kwarg).
_SCHEMA_BINDING = re.compile(r"""schema['"]?\s*[:=]\s*['"]coord['"]""")

# A cross-schema FK target string `ForeignKey("coord.<table>...")`. This is a
# WRITE-path / structural binding, distinct from a read SQL literal.
_FK_BINDING = re.compile(r"""ForeignKey\(\s*['"]coord\.""")


def _docstring_constant_ids(tree: ast.AST) -> set[int]:
    """Return id()s of the string constants that are module/class/function
    docstrings — the first statement of each such body. These are prose,
    not live bindings, so the guard excludes them."""
    ids: set[int] = set()
    for node in ast.walk(tree):
        if isinstance(
            node,
            (ast.Module, ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef),
        ):
            body = getattr(node, "body", [])
            if (
                body
                and isinstance(body[0], ast.Expr)
                and isinstance(body[0].value, ast.Constant)
                and isinstance(body[0].value.value, str)
            ):
                ids.add(id(body[0].value))
    return ids


def _coord_string_literals(path: Path) -> list[tuple[int, str]]:
    """Return ``(lineno, token)`` for every ``coord.<table>`` token found in a
    NON-docstring string literal in ``path``. Covers read SQL, FK target
    strings, and DDL ``comment=`` strings alike — the caller classifies."""
    src = path.read_text(encoding="utf-8")
    tree = ast.parse(src, filename=str(path))
    doc_ids = _docstring_constant_ids(tree)
    hits: list[tuple[int, str]] = []
    for node in ast.walk(tree):
        if (
            isinstance(node, ast.Constant)
            and isinstance(node.value, str)
            and id(node) not in doc_ids
        ):
            for tok in sorted(set(_COORD_TOKEN.findall(node.value))):
                hits.append((getattr(node, "lineno", -1), tok))
    return hits


def _has_coord_binding(path: Path) -> bool:
    """True if ``path`` contains ANY live coord binding — an ORM
    ``schema="coord"``, a ``ForeignKey("coord...")`` target, or a
    ``coord.<table>`` token in a non-docstring string literal. Used to detect
    stale ``WRITE_PATH_FOLLOWUP`` entries."""
    src = path.read_text(encoding="utf-8")
    if _SCHEMA_BINDING.search(src) or _FK_BINDING.search(src):
        return True
    return bool(_coord_string_literals(path))


def _rel(path: Path) -> str:
    return path.relative_to(_APP_ROOT).as_posix()


def test_read_boundary_is_closed() -> None:
    """(a) NO ``coord.*`` read-SQL literal outside the write-path follow-up.

    The read boundary is closed: every ``coord.<table>`` token in a
    non-docstring string literal must live in a ``WRITE_PATH_FOLLOWUP`` file
    (where it is an FK target / DDL comment on the device-write path), never
    in any other file. A hit elsewhere is a reintroduced cross-schema read —
    web must read coord state over its HTTP API (``coord_identity`` /
    ``coord_device`` / the ``agent_sessions`` proxy), not ``coord.*``.
    """
    offenders: dict[str, list[str]] = {}
    for path in sorted(_APP_ROOT.rglob("*.py")):
        rel = _rel(path)
        if rel in WRITE_PATH_FOLLOWUP:
            continue
        hits = _coord_string_literals(path)
        if hits:
            offenders[rel] = [f"L{ln}: `{tok}`" for ln, tok in hits]

    # The read-boundary set is, by construction, the set of offenders here.
    # It must equal the declared (empty) invariant.
    assert set(offenders) == READ_BOUNDARY_CLOSED, (
        "Read-boundary breach — `coord.*` SQL literal(s) reappeared outside "
        "the device-write follow-up:\n"
        + "\n".join(
            f"  {rel}:\n" + "\n".join(f"    {v}" for v in found)
            for rel, found in offenders.items()
        )
        + "\n\nWeb must read coord state over its HTTP API (coord_identity / "
        "coord_device / the agent_sessions proxy), not the `coord.*` Postgres "
        "schema. READ_BOUNDARY_CLOSED is the invariant and must stay empty."
    )


def test_no_new_write_path_coupling() -> None:
    """(b) NO ``{"schema":"coord"}`` / FK binding outside WRITE_PATH_FOLLOWUP.

    A new ORM schema binding or cross-schema FK in any file not already
    sanctioned in ``WRITE_PATH_FOLLOWUP`` is an unsanctioned new write
    coupling (e.g. a new coord-schema ORM model bolted onto web). New coord
    couplings must be vetted into the follow-up set deliberately, not slip in.
    """
    offenders: dict[str, list[str]] = {}
    for path in sorted(_APP_ROOT.rglob("*.py")):
        rel = _rel(path)
        if rel in WRITE_PATH_FOLLOWUP:
            continue
        src = path.read_text(encoding="utf-8")
        found: list[str] = []
        for m in _SCHEMA_BINDING.finditer(src):
            ln = src.count("\n", 0, m.start()) + 1
            found.append(f"L{ln}: ORM schema binding `{m.group(0)}`")
        for m in _FK_BINDING.finditer(src):
            ln = src.count("\n", 0, m.start()) + 1
            found.append(f"L{ln}: cross-schema FK `{m.group(0)}...`")
        if found:
            offenders[rel] = found

    assert not offenders, (
        "New web→coord write coupling outside WRITE_PATH_FOLLOWUP:\n"
        + "\n".join(
            f"  {rel}:\n" + "\n".join(f"    {v}" for v in found)
            for rel, found in offenders.items()
        )
        + "\n\nIf this is a legitimate device-write site, add it to "
        "WRITE_PATH_FOLLOWUP with a comment naming the follow-up; otherwise "
        "the write should go through coord's HTTP API."
    )


def test_write_path_followup_entries_still_bind_coord() -> None:
    """(c) Every ``WRITE_PATH_FOLLOWUP`` entry still binds ``coord.*``.

    Once a follow-up file is drained (the device-write migration removes its
    coord binding), its entry MUST be pruned so the set monotonically shrinks
    toward empty — closing the write half of the boundary. A stale entry that
    no longer binds coord is a bookkeeping leak that would mask a future
    reintroduction in that file.
    """
    stale: list[str] = []
    for rel in sorted(WRITE_PATH_FOLLOWUP):
        path = _APP_ROOT / rel
        if not path.exists():
            stale.append(f"{rel} (file no longer exists)")
            continue
        if not _has_coord_binding(path):
            stale.append(f"{rel} (no coord.* binding remains — drain done)")
    assert not stale, (
        "WRITE_PATH_FOLLOWUP entries that no longer bind coord.* (prune them "
        "so the write-path follow-up shrinks toward empty): " + ", ".join(stale)
    )
