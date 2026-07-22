"""tag-purge 01 — delete phantom full-ref (``refs/*``) rows from coord.repo_branches

Revision ID: tagpurge_01_phantom_tag_branch_rows
Revises: pr_shepherd_retire_01
Create Date: 2026-07-22

One-time DATA cleanup (NO schema change — no DDL here at all).

Why these rows exist
------------------------------------------------------------------------------
coord's ``ingest_push`` (``qontinui-coord/src/data/repo_branches.rs``) derived
the branch name from the pushed ref with::

    let branch = ev.ref_.strip_prefix("refs/heads/").unwrap_or(&ev.ref_);

For a **tag** push the strip fails, so ``branch`` became the literal full ref
(``"refs/tags/v1.0.2"``) and flowed straight into the UPSERT, which hardcodes
``pr_state = 'open'`` and leaves ``pr_number`` NULL. Every tag push therefore
minted a row claiming to be an open PR branch.

Those rows are **permanent**: a tag is never PR-merged, so no state transition
ever closes them, and the only closing path (``mark_branch_closed``) fires only
on ref *deletion* — which for release tags never happens. Worse, the row is then
enriched with the tag's full diff against ``main``, so its ``touched_files``
covers a large fraction of the repo and matches almost any path query.

The result was false positives across every read surface that reads the open
branch set without a ``pr_number IS NOT NULL`` guard — most visibly
``coord_conflict_check``, which reported ``refs/tags/v1.0.2`` as a conflicting
open branch.

The **writer is fixed separately**, in ``qontinui-coord``: ``ingest_push`` now
rejects any non-``refs/heads/`` ref with a ``let-else`` (mirroring the existing
``ingest_branch`` and ``git_observer`` guards), while still recording tag pushes
in the ``coord.git_ref_events`` oplog. That fix stops NEW phantom rows; this
migration removes the ones already written.

Sizing: ~101 tags fleet-wide is the upper bound (ui-bridge 56, qontinui-schemas
26, qontinui-runner 16, three repos at 1, qontinui-mobile 0). The actual row
count is lower — only tags pushed while coord's webhook was live minted a row.

Authorship / gates
------------------------------------------------------------------------------
The ``coord.*`` schema is Alembic-owned (the Rust side asserts table presence at
boot and authors zero DDL), so a coord data fix belongs here — same precedent as
``commitlockfix_01_strip_lock_branches`` and ``twin_09_drop_qontinui_cloud_target``.
Schema-arg gate: no gated DDL (a single DELETE); ``coord.repo_branches`` is
schema-qualified. No table has a foreign key onto ``coord.repo_branches``, so the
delete needs no cascade handling. Idempotent: re-running deletes zero rows.
"""

import logging
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "tagpurge_01_phantom_tag_branch_rows"
down_revision: str = "pr_shepherd_retire_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

logger = logging.getLogger("alembic.runtime.migration")

# A phantom row is identified by its branch value still carrying a full ref
# prefix — the exact string ``ingest_push`` used to pass through unstripped.
#
# The predicate is ``refs/%``, NOT ``refs/tags/%``, so that it matches the
# writer fix it pairs with. That fix rejects EVERY non-``refs/heads/`` namespace
# (``refs/pull/*``, ``refs/notes/*`` and friends are equally not PR branches),
# so a tags-only purge would leave behind exactly the rows the writer now
# classifies as invalid. A correctly-ingested branch row can never match: a
# ``refs/heads/<name>`` push is stored stripped, as ``<name>``. In practice
# GitHub push webhooks deliver only branches and tags, so the non-tag residue is
# expected to be empty — this widening makes that *known* rather than assumed.
#
# Known, accepted imprecision: a branch literally named ``refs/tags/x`` is
# creatable (``git branch refs/tags/x`` → ``refs/heads/refs/tags/x``), and
# ``ingest_push`` strips it to ``refs/tags/x`` — indistinguishable from a
# phantom, so it would be deleted. Pathological and not worth guarding; note
# that ``AND pr_number IS NULL`` would NOT disambiguate, since a real never-PR'd
# branch also carries a NULL ``pr_number``.
_DELETE_PHANTOM_SQL = """
    DELETE FROM coord.repo_branches
     WHERE branch LIKE 'refs/%'
"""

_REMAINING_PHANTOM_SQL = """
    SELECT count(*) FROM coord.repo_branches
     WHERE branch LIKE 'refs/%'
"""


def upgrade() -> None:
    """Delete every full-ref row minted by the ``ingest_push`` namespace bug."""
    # rowcount off the DELETE itself — the number logged is the number that
    # actually happened, rather than a separate pre-count that could drift from
    # it under concurrency (precedent: commitlockfix_01_strip_lock_branches).
    deleted = op.get_bind().execute(sa.text(_DELETE_PHANTOM_SQL)).rowcount
    logger.info(
        "tagpurge: deleted %d phantom 'refs/%%' row(s) from coord.repo_branches",
        deleted,
    )

    # Post-condition: a silently-partial delete is worth failing loudly on.
    remaining = op.get_bind().execute(sa.text(_REMAINING_PHANTOM_SQL)).scalar() or 0
    assert remaining == 0, (
        f"tagpurge: {remaining} 'refs/%' row(s) still present in "
        "coord.repo_branches after the purge"
    )


def downgrade() -> None:
    # Deliberate no-op, and NOT an oversight.
    #
    # The deleted rows are garbage: a tag ref masquerading as an open PR branch,
    # with a hardcoded 'open' pr_state, a NULL pr_number and an enrichment payload
    # diffed against main. Nothing consumes them correctly, so there is nothing
    # worth restoring — and re-creating them would re-introduce exactly the false
    # conflicts this migration exists to remove. No backup is taken for the same
    # reason.
    #
    # Making this a no-op also keeps the chain downgradable past this revision
    # (same precedent as commitlockfix_01_strip_lock_branches).
    pass
