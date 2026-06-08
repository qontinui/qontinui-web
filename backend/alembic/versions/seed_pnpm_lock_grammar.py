"""seed coord.hot_file_grammars — register qontinui-runner's pnpm-lock.yaml (pnpm_lock)

Revision ID: seed_pnpm_lock_grammar
Revises: resq_01_migration_reservations
Create Date: 2026-06-07

Addendum to ``2026-06-03-coord-seed-hot-file-grammar-registry.md`` (SHIPPED),
which seeded the alembic_versions + two cargo_lock rows but audited only
qontinui-web for a pnpm lockfile (none — web frontend uses npm
``package-lock.json``). A 3.7-day shadow-meter watch (2026-06-07) found
qontinui-runner's repo-root ``pnpm-lock.yaml`` churns regularly via dependency
bumps with NO grammar row activating it, so the ``pnpm_lock`` fragment grammar
(which ships and passes its ``round_trip_ok`` gate in
``qontinui-coord/src/hot_file_grammars.rs``) stays inert for runner lockfile
co-edits — the batch classifier (``merge_scheduler`` ``is_batch_compatible`` /
``form_batch``) and conflict-path predictor (``file_conflicts::classify_pair``)
fall through to whole-file classification.

This pure-UPSERT migration adds the activating row:
  - ``qontinui-runner`` / ``pnpm-lock.yaml`` / ``pnpm_lock``

The path is the repo-root lockfile (verified: ``qontinui-runner/pnpm-lock.yaml``);
``grammar_for_path`` exact-matches it at root. No CHECK change — ``semres_02``
already widened ``hot_file_grammars_kind_chk`` to include ``pnpm_lock``.
``load_registered_grammars`` re-checks each row against the grammar's round-trip
gate at load, so a raw INSERT is safe (a faithless row is skipped, never trusted).

Forward-only / expand-contract: additive UPSERT, trivially reversible.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "seed_pnpm_lock_grammar"
down_revision: str | Sequence[str] | None = "resq_01_migration_reservations"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        "INSERT INTO coord.hot_file_grammars (repo, path, grammar_kind) "
        "VALUES ('qontinui-runner', 'pnpm-lock.yaml', 'pnpm_lock') "
        "ON CONFLICT (repo, path) DO UPDATE SET grammar_kind = EXCLUDED.grammar_kind"
    )


def downgrade() -> None:
    op.execute(
        "DELETE FROM coord.hot_file_grammars "
        "WHERE repo = 'qontinui-runner' AND path = 'pnpm-lock.yaml'"
    )
