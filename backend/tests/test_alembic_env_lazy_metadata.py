"""`alembic/env.py` must not import the model tree for commands that ignore it.

`target_metadata` exists solely for ``--autogenerate``, which this repo
PROHIBITS (env.py says so itself, and .github/PULL_REQUEST_TEMPLATE.md).
Building it costs ~1.9s — it pulls ``app.models``,
``qontinui_schemas.generated``, ``fastapi_users_db_sqlalchemy`` and
``sqlalchemy.ext.asyncio`` — and it was paid at module scope on EVERY alembic
invocation.

That is ~285 subprocess invocations per Backend CI run (each migration test
reaches its revision through ``alembic upgrade``), plus every production deploy
migration. Measured end-to-end with ``alembic stamp head --sql``: 2.71s before,
0.64s after.

The guard is an ALLOWLIST, and these tests pin that direction specifically. A
denylist would make an unrecognised or future command skip the import and hand
``--autogenerate`` empty metadata — which, per env.py's own note, would propose
DROPPING the ~75 coord tables that have no SQLAlchemy model. The failure mode
here must always be "slower than necessary", never "silently diffed against
nothing".
"""

from __future__ import annotations

import types
from pathlib import Path

import pytest
from alembic.config import CommandLine, Config

ENV_PY = Path(__file__).resolve().parents[1] / "alembic" / "env.py"


def _load_guard() -> dict:
    """Exec just the guard block from env.py.

    env.py cannot be imported whole — at module scope it calls
    ``context.configure()``, which needs a live alembic migration context. The
    slice is delimited by markers that exist in the file, so a rename or a move
    fails this helper loudly rather than silently testing nothing.
    """
    src = ENV_PY.read_text()
    start = src.index("_METADATA_FREE_COMMANDS")
    end = src.index("# Atlas-owned tables")
    namespace: dict = {"Base": types.SimpleNamespace(metadata="<METADATA>")}
    exec(compile(src[start:end], str(ENV_PY), "exec"), namespace)  # noqa: S102
    return namespace


def _guard_for(argv: list[str] | None) -> tuple[dict, Config]:
    cfg = Config()
    if argv is not None:
        cfg.cmd_opts = CommandLine().parser.parse_args(argv)
    ns = _load_guard()
    ns["config"] = cfg
    return ns, cfg


@pytest.mark.parametrize(
    "argv",
    [
        ["upgrade", "head"],
        ["downgrade", "-1"],
        ["stamp", "abcdef"],
        ["current"],
    ],
)
def test_metadata_free_commands_skip_the_model_import(argv: list[str]) -> None:
    """The hot path: the commands CI and deploys actually run."""
    ns, _ = _guard_for(argv)
    assert ns["_target_metadata"]() is None, (
        f"`alembic {argv[0]}` does not read target_metadata, so env.py must not "
        "pay the ~1.9s model-tree import for it"
    )


@pytest.mark.parametrize("argv", [["revision", "--autogenerate", "-m", "x"], ["check"]])
def test_metadata_consuming_commands_still_load(argv: list[str]) -> None:
    """The commands that DO diff against metadata must still get it."""
    ns, _ = _guard_for(argv)
    assert ns["_invoked_command"]() not in ns["_METADATA_FREE_COMMANDS"], (
        f"`alembic {argv[0]}` compares against target_metadata; skipping the "
        "import would diff the schema against nothing"
    )


def test_an_unresolvable_command_fails_safe_by_loading() -> None:
    """No ``cmd_opts`` at all — a programmatic ``alembic.command.*`` call.

    This is the allowlist's whole point: unknown routes to LOADING.
    """
    ns, _ = _guard_for(None)
    assert ns["_invoked_command"]() is None
    assert ns["_invoked_command"]() not in ns["_METADATA_FREE_COMMANDS"]


def test_the_allowlist_contains_no_metadata_consuming_command() -> None:
    """``revision`` and ``check`` must never be added to the allowlist.

    Pinned as a named assertion because adding one would be a silent,
    schema-destroying change rather than a failing test somewhere else.
    """
    ns, _ = _guard_for(["current"])
    forbidden = {"revision", "check", "merge"}
    assert not (forbidden & set(ns["_METADATA_FREE_COMMANDS"])), (
        "a metadata-consuming command is in the skip allowlist — "
        "autogenerate would diff against empty metadata and propose dropping "
        "every unmodeled coord table"
    )
