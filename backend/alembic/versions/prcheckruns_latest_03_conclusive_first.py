"""coord.pr_check_runs_latest — prefer the latest CONCLUSIVE attempt per (repo, head_sha, name)

Revision ID: prcheckruns_latest_03
Revises: atu_02_atu_provenance
Create Date: 2026-09-02

Plan: 2026-09-02-coord-cancelled-check-row-scores-red-prefer-latest-conclusive-attempt

Symptom
-------
A check row whose ``conclusion`` is ``cancelled`` scores as a verdict of
FAILURE in coord's shared CI verdict core (``pr_state::rollup_check_rows``:
``cancelled`` is in neither the pass set nor the incomplete arm), although a
cancel reached no verdict. Any fail-fast matrix yields ``[failure,
cancelled…]``; any manually cancelled re-run of a previously green check flips
a head from green to red.

Root cause
----------
The view's dedup KEY is right — ``(repo, head_sha, name)`` — and its tiebreak
is wrong: recency alone. ``prcheckruns_headbranch_02_latest_view`` orders
``started_at DESC NULLS LAST, check_id DESC``, so a cancelled attempt that is
the NEWEST row for its name survives the ``DISTINCT ON`` whether it was never
re-run or it cancelled a re-run of an older conclusive attempt. GitHub's own
``filter=latest`` has the same flaw, which is why ``ci_baseline`` had to add a
supersession rule at write time (``is_supersession_conclusion``: ``cancelled``
/ ``stale`` never overwrite a conclusive baseline verdict). Per-row check
evidence had no equivalent.

Fix
---
One extra ORDER BY term: a superseded attempt (``conclusion IN ('cancelled',
'stale')``) sorts AFTER every non-superseded attempt for the same name; within
a rank, newest first, exactly as before.

The term is ``COALESCE(conclusion IN (...), FALSE)``, not the bare ``IN``: a
live re-run has ``conclusion`` NULL, ``NULL IN (...)`` is NULL, and PostgreSQL's
``ASC`` default is ``NULLS LAST`` — so the bare form ranks a live re-run AFTER
the corpse it is replacing and the view would serve the corpse. Verified on PG
16 before this landed: ``[in_progress@t2 (NULL), cancelled@t1]`` served
``cancelled`` under the bare ``IN`` and ``in_progress`` under ``COALESCE``. The
``COALESCE`` makes "non-superseded" a definite FALSE for a row that has not
concluded, which is the rank it belongs in.

Resulting semantics per ``(repo, head_sha, name)``::

    rows present                                     served row       verdict
    [cancelled@t2, success@t1]                       success@t1       green  — last CONCLUSIVE verdict
    [cancelled@t2, failure@t1]                       failure@t1       red    — a real failure is never masked
    [in_progress@t2 (conclusion NULL), cancelled@t1] in_progress@t2   pending — a live re-run outranks the corpse
    [cancelled@t2] alone                             cancelled@t2     red, unchanged — nothing conclusive to prefer
    [success@t2, cancelled@t1]                       success@t2       green  — identical to before

The lone-``cancelled`` row stays RED deliberately: uncertainty never
fabricates green, and the head is recoverable (the red-head re-list arm) rather
than a wedge.

Why the view and not Rust
-------------------------
The view is the one choke point every reader already goes through — the five
Rust consumers of ``rollup_check_rows`` AND the two SQL-side ``conclusion IN
('failure','cancelled')`` predicates in ``gates.rs`` /
``gate_harvester_watcher.rs``, which a Rust helper cannot reach. The base table
and the repair paths (which reap by ``check_id`` and MUST read raw) are
untouched.

Shape
-----
``CREATE OR REPLACE VIEW`` over the same ``SELECT DISTINCT ON (...) *`` — no
new column, no new object name, no change to the projection, so a coord
binary's SQL is byte-identical before and after and either deploy order is
safe. Keeping ``SELECT *`` keeps ``check_id``, ``details_url``, ``updated_at``
and ``head_branch`` flowing to every existing reader. Idempotent: re-applying
rebuilds the same definition.

Downgrade restores ``prcheckruns_headbranch_02_latest_view``'s ``_LATEST_VIEW``
text verbatim (recency-only tiebreak).
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "prcheckruns_latest_03"
down_revision: str | Sequence[str] | None = "lasac_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Supersession-aware tiebreak: non-superseded attempts first (a NULL conclusion
# is a live attempt, hence the COALESCE to FALSE — see the module docstring),
# then newest first, exactly as the previous definition ordered within a rank.
_LATEST_VIEW_CONCLUSIVE_FIRST = """
    CREATE OR REPLACE VIEW coord.pr_check_runs_latest AS
        SELECT DISTINCT ON (repo, head_sha, name) *
        FROM coord.pr_check_runs
        ORDER BY repo, head_sha, name,
                 COALESCE(conclusion IN ('cancelled', 'stale'), FALSE) ASC,
                 started_at DESC NULLS LAST, check_id DESC
"""

# Verbatim from prcheckruns_headbranch_02_latest_view.py — the recency-only
# tiebreak this revision replaces. Kept here so downgrade cannot drift from
# what it restores.
_LATEST_VIEW_RECENCY_ONLY = """
    CREATE OR REPLACE VIEW coord.pr_check_runs_latest AS
        SELECT DISTINCT ON (repo, head_sha, name) *
        FROM coord.pr_check_runs
        ORDER BY repo, head_sha, name, started_at DESC NULLS LAST, check_id DESC
"""


def upgrade() -> None:
    """Prefer the latest CONCLUSIVE attempt per ``(repo, head_sha, name)``."""
    op.execute(_LATEST_VIEW_CONCLUSIVE_FIRST)


def downgrade() -> None:
    """Restore the recency-only tiebreak from ``prcheckruns_headbranch_02``."""
    op.execute(_LATEST_VIEW_RECENCY_ONLY)
