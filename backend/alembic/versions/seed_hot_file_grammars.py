"""seed coord.hot_file_grammars — activate the dormant commutation/auto-rewrite layer

Revision ID: seed_hot_file_grammars
Revises: merge_clienttel_routing_heads
Create Date: 2026-06-03

Plan: ``2026-06-03-coord-seed-hot-file-grammar-registry.md``.

coord's hot-file grammars (``qontinui-coord/src/hot_file_grammars.rs``) parse
structured hot files (Cargo.lock, alembic versions) into commuting fragments so
the merge scheduler can (a) BATCH disjoint-key co-edits instead of serializing
them and (b) AUTO-REWRITE a mechanically-reconcilable collision (alembic
``down_revision`` re-point). The Rust grammars are complete and pass their
``round_trip_ok`` registration gates, but every consumer loads the active
grammar set from ``coord.hot_file_grammars`` at runtime
(``load_registered_grammars``) — and that table held only the lone
``tool_registry`` row from ``semres_02``. So the batch classifier
(``merge_scheduler.rs`` ``is_batch_compatible`` / ``form_batch``), the
conflict-path auto-rewrite (``conflict_engine.rs`` ``classify_auto_rewritable``),
and the proactive auto-rebase (``restack_engine.rs``
``proactively_repoint_stale_siblings``) have all been dormant since inception.

This migration seeds the real ``(repo, path, grammar_kind)`` rows for the repos
that actually have these hot files, turning the fully-built layer on.

``load_registered_grammars`` re-checks each row against the grammar's
round-trip gate at load time, so a raw INSERT here is safe — a faithless
grammar row would be skipped, never trusted.

Pure UPSERT — no CHECK change. ``semres_02`` already widened
``hot_file_grammars_kind_chk`` to ``{cargo_lock, alembic_versions, pnpm_lock,
pg_schema_sql, tool_registry}``, so both kinds seeded here are already allowed.

Row rationale:
  - ``qontinui-web`` / ``backend/alembic/versions/`` / ``alembic_versions`` —
    the highest-value row. ``proactively_repoint_stale_siblings`` derives the
    versions dir from this path and feeds it to ``git ls-tree -r <sha> <dir>``,
    which is a REPO-ROOT pathspec — so the value MUST be the full
    ``backend/alembic/versions/`` (web migrations live there), not a loose
    suffix, or the proactive re-point silently lists zero files.
  - ``qontinui-coord`` / ``Cargo.lock`` / ``cargo_lock`` — coord has a
    repo-root ``Cargo.lock``; lets two PRs adding distinct crates batch.
  - ``qontinui-runner`` / ``Cargo.lock`` / ``cargo_lock`` — runner is a cargo
    workspace with the lockfile at the repo root; exact-matches ``Cargo.lock``.

Forward-only / expand-contract: additive UPSERTs, trivially reversible.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "seed_hot_file_grammars"
down_revision: str | Sequence[str] | None = "merge_clienttel_routing_heads"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


# (repo, path, grammar_kind) — keep grammar_kind values in sync with
# ``qontinui-coord/src/hot_file_grammars.rs::GrammarKind::as_str``.
_ROWS = (
    ("qontinui-web", "backend/alembic/versions/", "alembic_versions"),
    ("qontinui-coord", "Cargo.lock", "cargo_lock"),
    ("qontinui-runner", "Cargo.lock", "cargo_lock"),
)


def upgrade() -> None:
    for repo, path, kind in _ROWS:
        op.execute(
            "INSERT INTO coord.hot_file_grammars (repo, path, grammar_kind) "
            f"VALUES ('{repo}', '{path}', '{kind}') "
            "ON CONFLICT (repo, path) DO UPDATE SET grammar_kind = EXCLUDED.grammar_kind"
        )


def downgrade() -> None:
    for repo, path, _kind in _ROWS:
        op.execute(
            "DELETE FROM coord.hot_file_grammars "
            f"WHERE repo = '{repo}' AND path = '{path}'"
        )
