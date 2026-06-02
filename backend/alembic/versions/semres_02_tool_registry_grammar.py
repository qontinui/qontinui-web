"""semres 02 — register the tool_registry hot-file grammar (Phase 4)

Revision ID: semres_02_tool_registry_grammar
Revises: semres_01_down_revisions
Create Date: 2026-06-02

Phase 4 of the semantic-resource conflict-prevention plan
(``2026-06-02-coord-semantic-resource-conflict-prevention.md``).

coord gained a ``GrammarKind::ToolRegistry`` fragment grammar that parses its
own ``src/mcp/tools.rs`` ``ToolRegistry`` body so two PRs each adding a DISTINCT
tool batch cleanly while two PRs bumping the count assertion Contend. But
grammars are loaded from ``coord.hot_file_grammars`` at runtime
(``hot_file_grammars.rs::load_registered_grammars``) — the Rust grammar is
inert until a ``(repo, path, grammar_kind)`` row activates it, and the
``hot_file_grammars_kind_chk`` CHECK (the table's only production authority now
that coord no longer self-heals ``coord.*`` schema) does not yet allow the new
kind. This migration does both, so the preventive path is LIVE, not dormant
(the whole point of the plan).

1. Widen ``hot_file_grammars_kind_chk`` to include ``tool_registry``. Keep the
   value list in sync with ``GrammarKind::as_str`` in
   ``qontinui-coord/src/hot_file_grammars.rs``. Text+CHECK (not a PG ENUM) per
   the house pattern, so widening is a plain DROP/ADD CONSTRAINT — no
   ``ALTER TYPE``.
2. UPSERT the activating row ``(qontinui-coord, src/mcp/tools.rs, tool_registry)``.
   ``load_registered_grammars`` re-checks each row against the grammar's
   round-trip gate at load time, so a raw INSERT here is safe — a faithless
   grammar would be skipped, never trusted.

Expand-only: widening a CHECK is backward-compatible with a rolled-back prior
app (which simply never writes ``tool_registry``); per the expand/contract
discipline the value is added now and only removed in a later contract.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "semres_02_tool_registry_grammar"
down_revision: str | Sequence[str] | None = "semres_01_down_revisions"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


# Allowed grammar kinds — keep in sync with
# ``qontinui-coord/src/hot_file_grammars.rs::GrammarKind::as_str``.
_KINDS_WIDE = (
    "cargo_lock",
    "alembic_versions",
    "pnpm_lock",
    "pg_schema_sql",
    "tool_registry",
)
_KINDS_PRIOR = (
    "cargo_lock",
    "alembic_versions",
    "pnpm_lock",
    "pg_schema_sql",
)


def _check_sql(kinds: Sequence[str]) -> str:
    values = ",".join(f"'{k}'" for k in kinds)
    return (
        "ALTER TABLE coord.hot_file_grammars "
        "DROP CONSTRAINT IF EXISTS hot_file_grammars_kind_chk; "
        "ALTER TABLE coord.hot_file_grammars "
        "ADD CONSTRAINT hot_file_grammars_kind_chk "
        f"CHECK (grammar_kind IN ({values}))"
    )


def upgrade() -> None:
    op.execute(_check_sql(_KINDS_WIDE))
    op.execute(
        "INSERT INTO coord.hot_file_grammars (repo, path, grammar_kind) "
        "VALUES ('qontinui-coord', 'src/mcp/tools.rs', 'tool_registry') "
        "ON CONFLICT (repo, path) DO UPDATE SET grammar_kind = EXCLUDED.grammar_kind"
    )


def downgrade() -> None:
    # Remove the activating row first so the narrowed CHECK can re-apply.
    op.execute(
        "DELETE FROM coord.hot_file_grammars "
        "WHERE grammar_kind = 'tool_registry'"
    )
    op.execute(_check_sql(_KINDS_PRIOR))
