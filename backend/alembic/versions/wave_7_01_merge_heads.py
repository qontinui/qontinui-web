"""wave 7 01 merge sibling heads — strategy P1 + wave 6 batching/phase-1b

Revision ID: wave_7_01_merge_heads
Revises: 5874f5af0e4b, wave_6_02_merge_heads
Create Date: 2026-05-16

Empty bookkeeping revision joining the two sibling heads that were
left on ``main`` after Strategy Phase 1 (web #125) and the Wave 6
bors-batching / phase-1b work landed concurrently:

* ``5874f5af0e4b`` — merge of ``row_9_phase_4_01_coord_alerts`` and
  ``strategy_p1_02_seed`` (Strategy Phase 1 schema + seed).
* ``wave_6_02_merge_heads`` — merge of
  ``coord_phase_1b_01_declared_overlap_paths`` and
  ``wave_6_01_coord_merge_batches`` (bors-style batching state).

Neither of those two merge revisions authored a further sibling-head
merge against the other (Strategy Phase 1 #125 was admin-merged
through the ``alembic-heads-pr`` gate per the Row 14 tracker), so
``origin/main`` carried 2 heads. This revision closes the chain back
to a single head.

Per [[feedback_alembic_sibling_head_merge]]: a Wave PR adding an
alembic migration off a then-single head must, when a sibling head
exists, author an empty merge revision joining both heads — otherwise
the ``alembic-heads-pr`` gate fails and the canonical-stack migrator
container refuses to start (``migrator: service_completed_successfully``
gates ``coord``). Authored by the canonical-PG reconcile-then-stamp
program (Session B, plan
``2026-05-15-canonical-pg-upgrade-discovery.md`` §8 step 1) — it is a
hard prerequisite for clean single-head alembic operation against the
canonical DB and additionally ungates ``alembic-heads-pr`` for future
Strategy-Phase-2 work. Shape mirrors ``wave_6_02_merge_heads`` and
``5874f5af0e4b_merge_strategy_p1_row9_phase4_heads``.

Nothing happens at upgrade time beyond stamping the new head.
"""

from collections.abc import Sequence

revision: str = "wave_7_01_merge_heads"
# Single-line tuple is intentional — the `alembic-graph-pr.yml` gate's
# offline parser regex matches `^down_revision: ... = (...)$` on one
# physical line. A multi-line tuple defeats the parser and the gate
# fails with "N heads" even though alembic itself accepts the merge.
# See [[feedback_alembic_merge_revision_single_line_tuple]].
down_revision: tuple[str, str] = ("5874f5af0e4b", "wave_6_02_merge_heads")
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
