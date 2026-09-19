"""coord.notifications: one-shot prune of every row that is not an agent action.

Phase 3 item 4 of plan
``qontinui-dev-notes/plans/2026-09-18-notifications-are-agent-actions-and-alerts-are-agent-work.md``.

The operator's notifications feed is meant to carry one class of event: an
AGENT did something significant, permanent or sensitive. Measured when the plan
was written, it held 2,503 rows, all unread, and 91% of them were
``alert_paged`` — alert pages copied into the feed, burying the 125 rows of the
intended class. The coord side of the plan stops the inflow: Phase 1 stops
emitting operator-authored and seed prompt-document changes and deletes the
``pr_landed`` / ``worktree_went_stale`` kinds, and Phase 3 moves pages to the
agent queue and deletes ``alert_paged``. This revision removes what is already
stored. It authors no schema at all — it is pure DML, same as
``coord_alerts_retention_01``, whose batching it copies.

What is deleted, by class
==========================================================================

(a) ``kind = 'alert_paged'`` — every row. Pages now go to the agent queue.

(b) ``kind IN ('policy_document_changed', 'autonomy_dial_changed')`` with
    ``actor LIKE 'operator:%'`` — the operator being told about his own edits.
    coord stores the actor through ``prompt_documents::principal_label_only``,
    which keeps ``operator:<uuid>`` and degrades a non-UUID second segment to
    ``operator:``; both match the prefix.

    This class also covers an operator APPROVING an agent's proposal: the
    decide path records the approver as ``operator:<email>``, stored as the
    degraded ``operator:``, so those rows are deleted too. That is intended
    under the plan's D6: approving a proposal is the operator's own act, and
    the feed need not tell him about it.

(c) The same two kinds, written by a SEED. The ``actor`` column cannot tell a
    seed apart: ``principal_label_only("system:seed")`` and
    ``principal_label_only("system:upstream")`` both store ``system:``
    (pinned by coord's own test ``assert_eq!(principal_label_only(
    UPSTREAM_ADOPT_ACTOR), "system:")``), and an upstream adoption is a change
    the operator did NOT author and still wants to see. So a seed is identified
    by the VERSION it announces: the notification names its document and the
    version it moved to, and ``coord.prompt_document_versions.edited_by`` keeps
    the UNtruncated author (``apply_document_edit_tx`` binds the raw
    ``updated_by``, and the seed reconciler passes ``"system:seed"``). A row is
    a seed notification iff it joins to a version row with
    ``edited_by = 'system:seed'`` on:

        n.tenant_id                                = d.tenant_id
        n.detail->>'document'                      = d.name
        COALESCE(n.detail->>'document_kind', 'policy') = d.kind
        n.detail->>'to_version'                    = v.version_number::text
        v.document_id                              = d.id
        n.occurred_at                             >= v.created_at - interval '1 hour'

    These are the payload keys ``policy_change_notification`` writes
    (``"document"``, ``"to_version"``, ``"document_kind"``), and this is the
    exact match coord's own reconciler uses to decide whether a version already
    has its notification (the ``NOT EXISTS`` in ``CANDIDATES_SQL``,
    ``prompt_document_notification_reconcile.rs``), including its three
    details:

    * ``to_version`` is compared as TEXT because ``->>`` extracts a jsonb
      number in its textual form (and a text compare cannot raise on a
      malformed value where an ``::int`` cast would);
    * a pre-widening event carried no ``document_kind`` because only
      ``kind = 'policy'`` emitted then, hence the ``COALESCE``;
    * the ``occurred_at`` bound. A document that is deleted and recreated
      under the same ``(tenant, kind, name)`` restarts its version numbers, so
      an OLD notification (say a ``system:upstream`` adoption at v3) can name
      the same ``to_version`` as a LATER seed rewrite of the new document's v3.
      A notification cannot announce a version written after it, so requiring
      it to be no older than the version (with coord's one-hour allowance for
      clock and commit ordering) keeps that old row.

    A ``system:`` row that matches no seed version — an upstream adoption, or
    a row whose document has since been deleted — STAYS: an unknown is never
    pruned. The upstream kinds themselves (``upstream_policy_update_available``,
    ``upstream_policy_adopted``) are not in this class at all, whatever version
    they name.

(d) ``kind IN ('pr_landed', 'worktree_went_stale')`` — kinds Phase 1 deleted
    from ``NotificationKind``. They never had an emitter, so this is expected to
    delete nothing; it is here so no row of a kind coord can no longer render
    survives the migration.

Everything else stays, in particular agent-authored prompt-document changes
(``session:``, ``agent:``, ``device:``), upstream adoptions, and the
agent-action kinds this feed exists for.

``coord.notification_reads`` rows go with their parents through the
``ON DELETE CASCADE`` foreign key ``coordnotif_01`` declared; nothing prunes
them separately.

Ordering: run ONLY after coord plan Phases 1, 3 and 4 are DEPLOYED
==========================================================================

This revision must run only once the coord PRs for plan Phases 1, 3 and 4 are
DEPLOYED, not merely merged. The coordinator sequences that
(``coord:downstream-of``). Each phase stops one inflow this revision drains:

* Phase 3 deletes ``alert_paged`` and moves pages to the agent queue. Before
  it deploys, coord keeps writing new ``alert_paged`` rows.
* Phase 1 stops the operator and seed prompt-document notifications at the
  emitter, AND gives the reconciler the same actor predicate.
* Phase 4 is what ``coordnotif_03``, the next revision in the same PR, needs:
  the coord parser that reads the renamed kind.

The reconciler is the costly early-run hazard. On coord ``origin/main`` today,
``prompt_document_notification_reconcile``'s candidate SELECT has NO actor
filter: every tick (default 15 minutes) it finds each version above v1 from
the last 7 days that has no notification, and re-emits one. So a
class (b) or (c) row deleted before Phase 1 deploys does not stay deleted. Within
15 minutes it comes back as a NEW row, stamped with a fresh ``occurred_at`` and
UNREAD, at the TOP of the operator's feed. The early run would make the feed
worse, not cleaner.

Repairing that is not a plain re-run either. Once ``alembic_version`` names a
revision above this one, ``alembic upgrade head`` skips it. A second pass needs
a manual ``alembic stamp agent_questions_alert_episode_01`` followed by
``alembic upgrade head``, which also re-runs ``coordnotif_03``. That is safe,
because both revisions are idempotent, but it is an operator action.

Why the delete is BATCHED, and how the cursor works
==========================================================================

Same reasoning as the ``coord_alerts_retention_01`` template: ``env.py`` wraps
the migration run in ONE transaction, so the delete runs inside
``autocommit_block()`` in bounded batches, each its own transaction — progress
survives an interruption and a re-run finishes the job. The table is small
today (thousands of rows), but the revision must be safe to run at any later
time, against whatever has accumulated by then.

Each class walks the primary key with a high-water cursor rather than a bare
``LIMIT``, so already-deleted index entries are not re-traversed batch after
batch. The key is ``notification_id``, a UUID. The cursor advances to the
highest id the batch SELECTED (the ``doomed`` CTE), not to the highest id it
DELETED: a row a concurrent writer (coord's retention sweep, say) removed
between the select and the delete is absent from ``RETURNING``, and a
``RETURNING``-driven loop would read a fully raced batch as "done" and stop
early. It is carried as TEXT and cast back to uuid in the next batch.
Termination is structural: a batch that selects rows always advances the cursor
past them, and a batch that selects none ends that class.

The batch ceiling (``MAX_BATCHES``) is checked BEFORE each batch runs, so it
bounds the work actually done.

Idempotency / authorship posture
==========================================================================

* alembic is the sole author of ``coord.*``; coord issues zero DDL. This
  revision authors no schema.
* Re-running is a no-op once the prune set is empty (every WHERE clause simply
  matches nothing), so a partially-applied run is repaired by re-running.
* ``downgrade()`` is a deliberate no-op: the deleted rows are unrecoverable by
  design, as in the template.

Revision ID: coordnotif_02_prune_non_agent_kinds
Revises: agent_questions_alert_episode_01
Create Date: 2026-09-19

"""

import logging
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coordnotif_02_prune_non_agent_kinds"
down_revision: str | Sequence[str] | None = "agent_questions_alert_episode_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

logger = logging.getLogger("alembic.runtime.migration")

# The two kinds `notify_document_version_change` emits.
PROMPT_DOCUMENT_KINDS: tuple[str, ...] = (
    "policy_document_changed",
    "autonomy_dial_changed",
)

# Kinds deleted from `NotificationKind` by plan Phase 1 (no emitter ever).
DELETED_KINDS: tuple[str, ...] = ("pr_landed", "worktree_went_stale")

# The version-row author a seed writes. The UNtruncated form: the notification's
# own `actor` column holds only `system:`, which an upstream adoption shares.
SEED_EDITED_BY: str = "system:seed"

# Rows per transaction.
BATCH_ROWS: int = 5_000

# Ceiling per class, checked BEFORE each batch. The cursor already guarantees
# termination, so this is a bound on work, not a loop guard: 2,000 batches is
# 10 M rows. A legitimately enormous class CAN trip it. Every committed batch
# stays committed, so the fix is to re-run (stamp back, then upgrade), which
# resumes where this run stopped.
MAX_BATCHES: int = 2_000

# The lowest possible uuid, as text: the cursor's starting point.
_CURSOR_START: str = "00000000-0000-0000-0000-000000000000"

# One WHERE clause per class, over `coord.notifications n`. Each is a
# self-contained predicate, so the classes are disjoint by kind or actor and a
# row is counted under exactly one of them.
_CLASS_PREDICATES: tuple[tuple[str, str], ...] = (
    ("alert_paged", "n.kind = 'alert_paged'"),
    (
        "operator_prompt_document_change",
        "n.kind = ANY(:doc_kinds) AND n.actor LIKE 'operator:%'",
    ),
    (
        "seed_prompt_document_change",
        """
        n.kind = ANY(:doc_kinds)
        AND n.actor LIKE 'system:%'
        AND EXISTS (
            SELECT 1
              FROM coord.prompt_document_versions v
              JOIN coord.prompt_documents d ON d.id = v.document_id
             WHERE d.tenant_id = n.tenant_id
               AND d.name = n.detail->>'document'
               AND d.kind = COALESCE(n.detail->>'document_kind', 'policy')
               AND v.version_number::text = n.detail->>'to_version'
               AND v.edited_by = :seed_edited_by
               AND n.occurred_at >= v.created_at - interval '1 hour'
        )
        """,
    ),
    ("deleted_kind", "n.kind = ANY(:deleted_kinds)"),
)

# One batch: select the next BATCH_ROWS doomed ids of one class strictly above
# the cursor in primary-key order, delete exactly those, and report the highest
# SELECTED id (the next cursor) and how many rows were actually deleted. The
# cursor comes from `doomed`, not from the DELETE's RETURNING, so a row removed
# concurrently between the two cannot stall or end the walk. `high_water` is
# NULL only when `doomed` is empty, which ends the class.
_DELETE_BATCH_SQL = """
WITH doomed AS (
    SELECT n.notification_id
      FROM coord.notifications n
     WHERE ({predicate})
       AND n.notification_id > CAST(:after_id AS uuid)
     ORDER BY n.notification_id
     LIMIT :batch
),
deleted AS (
    DELETE FROM coord.notifications t
          USING doomed d
          WHERE t.notification_id = d.notification_id
      RETURNING 1
)
SELECT (SELECT notification_id::text
          FROM doomed
         ORDER BY notification_id DESC
         LIMIT 1) AS high_water,
       (SELECT count(*) FROM deleted) AS deleted
"""


def _prune_class(bind: sa.engine.Connection, label: str, predicate: str) -> int:
    """Delete every row matching ``predicate`` in cursor-ordered batches."""
    sql = sa.text(_DELETE_BATCH_SQL.format(predicate=predicate))
    total = 0
    batches = 0
    after_id = _CURSOR_START

    while True:
        if batches >= MAX_BATCHES:
            raise RuntimeError(
                f"coordnotif_02: class {label} reached the {MAX_BATCHES}-batch "
                f"ceiling after deleting {total} row(s) (cursor at {after_id}). "
                "Committed batches stay committed; stamp back and upgrade again "
                "to resume."
            )

        high_water, deleted = bind.execute(
            sql,
            {
                "doc_kinds": list(PROMPT_DOCUMENT_KINDS),
                "deleted_kinds": list(DELETED_KINDS),
                "seed_edited_by": SEED_EDITED_BY,
                "after_id": after_id,
                "batch": BATCH_ROWS,
            },
        ).one()
        if high_water is None:
            break

        after_id = str(high_water)
        total += int(deleted)
        batches += 1

    logger.info(
        "coordnotif_02: deleted %d coord.notifications row(s) of class %s "
        "in %d batch(es).",
        total,
        label,
        batches,
    )
    return total


def upgrade() -> None:
    """Prune every non-agent-action notification class, in batches.

    Runs in an autocommit block so each batch commits independently: the work
    survives an interruption and a re-run completes it.
    """
    with op.get_context().autocommit_block():
        bind = op.get_bind()

        counts = {
            label: _prune_class(bind, label, predicate)
            for label, predicate in _CLASS_PREDICATES
        }
        total = sum(counts.values())
        logger.info(
            "coordnotif_02: deleted %d coord.notifications row(s) in total: %s. "
            "coord.notification_reads rows went with them (ON DELETE CASCADE).",
            total,
            counts,
        )

        if total:
            # Refresh the planner's row estimates now rather than whenever
            # autoanalyze fires: the prune can remove most of the table.
            op.execute("ANALYZE coord.notifications")


def downgrade() -> None:
    """Deliberate no-op: the deleted rows are unrecoverable by design.

    Mirrors ``coord_alerts_retention_01``. Making this raise would block
    downgrading the chain past this revision for no gain, since the deleted
    notifications cannot be recovered either way.
    """
