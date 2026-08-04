"""merge rollout retirement 01 — merge_enabled + merge_paused columns

Revision ID: merge_enabled_01
Revises: memhold_adjudicate_02
Create Date: 2026-08-04

Phase 1 of the plan
``D:/qontinui-root/plans/2026-07-29-retire-merge-rollout-tristate-and-fix-the-dead-kill-switch.md``
(VETTED 2026-08-04). Alembic is the sole author of ``coord.*`` schema, so the
column change lands here and must be verified in prod BEFORE any coord read of
it [policy: ``alembic-sole-authorship``; see the 2026-07-13 missing-column
incident].

Two schema deltas
-----------------

1. **``coord.tenant_repo_profiles.merge_enabled``** (BOOLEAN, NULLABLE). The
   per-(tenant, repo) enablement flag that replaces the ``rollout_state``
   tri-state. ``NULL`` means "inherit the default" — deliberately the same way
   ``rollout_state`` expresses inherit, so the resolver's tier structure is
   unchanged and only the token narrows. The product default is ``true``
   (``settings.rs::Defaults``); a NULL row therefore resolves to enabled.

2. **``coord.tenant_merge_settings.merge_paused``** (BOOLEAN NOT NULL DEFAULT
   false). The tenant-wide **pause** — the one tier Phase 2 makes DOMINANT over
   any per-repo value. NOT NULL because a pause is unambiguously on or off:
   there is no "inherit" for a stop, and a NULL-means-maybe here is exactly the
   ambiguity that made the old kill switch untrustworthy.

No ``merge_enabled`` column is added to ``coord.tenant_merge_settings``. The
tenant tier survives only as the pause; a tenant-wide "on" is what the default
already means.

Why ``merge_enabled`` is nullable and ``merge_paused`` is not
--------------------------------------------------------------
They are not the same kind of flag. ``merge_enabled`` is a three-valued
override (yes / no / inherit) sitting in an override table where every other
column already spells inherit as NULL. ``merge_paused`` is a latch on the
tenant row: it is either engaged or it is not, and Phase 2 lets it outrank
everything below it. Giving the latch a NULL state would create a third
posture ("paused is unset") that the dominance rule has no answer for.

The backfill rule (rewritten by the 2026-08-04 vet — F4 resolved)
------------------------------------------------------------------

=============================  ================  =================================
Existing ``rollout_state``     ``merge_enabled``  Why
=============================  ================  =================================
``live``                       ``true``           already merging
``shadow``                     ``true``           the soak never produced an exit
                                                  (plan F2: 3 shadow decisions in
                                                  30 days, no auto-graduation,
                                                  promotion bar unsatisfiable)
``dry_run``, unmarked          ``true``           the F3 enrollment artifact —
                                                  records "nobody touched it",
                                                  not "somebody stopped it"
``dry_run``, operator-marked   ``false``          a deliberate operator stop,
                                                  honoured
``NULL``                       ``NULL``           inherit, left alone
=============================  ================  =================================

"Operator-marked" means EITHER of two independent discriminators — a repo-scoped
``coord.user_overrides`` audit row, or ``profile_source = 'manual'``. Two are
needed because the two operator surfaces that can stop a repo do not leave the
same trace, and neither trace alone covers both. See the next two sections.

The whole difficulty is that ``dry_run`` is a homograph. Plan F3 establishes
that ``rollout_state='dry_run'`` is what ENROLLMENT writes automatically
(``qontinui-coord/src/github_accounts.rs::persist_preset_profile``, the
``rollout_state: Option<String> = Some("dry_run")`` binding), and F1's
histogram is the receipt that no repo escaped it: 44 of 44
``tenant_repo_profiles`` rows carry a non-NULL ``rollout_state``, zero inherit.
So a flat ``dry_run → false`` would grandfather exactly the damage this plan
exists to undo — new enrollments would get the ``true`` default while the
existing never-touched fleet stayed off. ``rollout_state`` alone cannot
separate a stop from an artifact; the AUDIT TRAIL is where they differ.

Matching the audit rows — the column spelling the plan could not confirm
-------------------------------------------------------------------------

⚠️ **The plan's proposed ``o.repo = p.repo`` join would have matched ZERO rows,
always.** The plan flagged the column spelling as unverified; it was read from
the writer before this revision was written, and the writer does not populate
``repo`` at all.

``rollout_routes::insert_rollout_override`` (qontinui-coord,
``src/pr_merge/rollout_routes.rs:306-344``) inserts exactly::

    INSERT INTO coord.user_overrides
        (tenant_id, override_kind, override_subject, decided_by, rationale, payload)
    VALUES ($1, $2, $3, $4, $5, $6)

``repo``, ``pr_number`` and ``decision_id`` are left NULL. The scope lives in
``override_subject``, which is ``format!("scope:{scope_label}")`` where
``scope_label`` is ``"tenant"`` or ``format!("repo:{repo}")``
(``rollout_routes.rs:224``, ``:270``, ``:327``). So the per-repo audit rows read
``override_subject = 'scope:repo:<owner>/<name>'`` and the tenant-wide ones read
``'scope:tenant'``.

The two ``override_kind`` values are confirmed verbatim from the same file:
``'kill_switch_activated'`` (``rollout_routes.rs:382``) and
``'rollout_promote'`` (``:583``). Both flow through the same shared
``apply_rollout_state``; only the kind distinguishes them.

Matching on ``override_subject = 'scope:repo:' || p.repo`` therefore does
double duty, and the second half is the safety property the plan asked for: a
tenant-wide kill switch writes ``'scope:tenant'`` and cannot mark every repo
``false``. That exclusion is not merely conservative, it is provably correct —
a tenant-scoped ``apply_rollout_state`` only UPSERTs
``tenant_merge_settings.rollout_state`` and never touches
``tenant_repo_profiles`` (``rollout_routes.rs:186-225``), which is precisely
plan F1's finding that the tenant kill switch is a no-op. So a ``dry_run`` in
``tenant_repo_profiles`` can only have come from enrollment or from a
REPO-scoped operator write.

Both kinds count, not just the kill switch: the row set is narrowed to repos
whose CURRENT ``rollout_state`` is ``dry_run``, and enrollment deliberately
excludes ``rollout_state`` from its ``ON CONFLICT … DO UPDATE`` arm
(``github_accounts.rs:466-473``) so a re-enrollment cannot demote a promotion.
A repo sitting at ``dry_run`` with any repo-scoped audit row is therefore a
repo whose last write through ``rollout_routes`` was ``dry_run`` — a stop.

The second discriminator: ``profile_source = 'manual'``
--------------------------------------------------------

⚠️ **The audit trail alone is NOT sufficient, because one operator stop path
writes no audit row at all.** ``coord_onboard_set_repo_rollout``
(``qontinui-coord/src/mcp/tools.rs:3512-3578``) UPSERTs
``tenant_repo_profiles.rollout_state`` DIRECTLY and inserts nothing into
``coord.user_overrides``. It is ``strategy_admin``-gated (``:3531``) and its own
description calls it the remediation knob for forcing a mis-enrolled repo back
to dry-run — i.e. squarely the deliberate-stop population the ``false`` arm
exists to honour. An MCP-issued stop is therefore invisible to the audit
subquery, and there is no other record of it anywhere in the schema.

What it does leave is a provenance marker: its INSERT arm stamps
``profile_source = 'manual'`` (``mcp/tools.rs:3548``). Verified against the
whole coord tree — among PRODUCTION writers of ``coord.tenant_repo_profiles``,
that is the only one that writes ``'manual'``:

* ``mcp/tools.rs:3548``          → ``'manual'``   (the MCP rollout tool)
* ``rollout_routes.rs:259``      → ``'user_edit'``
* ``settings_routes.rs:366``     → ``'user_edit'`` (the profile PATCH)
* ``fleet_policy.rs:586``        → ``'user_edit'``
* ``github_accounts.rs:974``     → ``'preset'``   (enrollment)

(``next_step.rs:4111`` and ``merge_scheduler.rs:41502`` also write ``'manual'``
but both sit inside ``#[cfg(test)]`` modules — ``next_step.rs`` from ``:3562``,
``merge_scheduler.rs`` from ``:30586`` — so neither reaches a production row.
Note also that ``profile_source``'s column DEFAULT is ``'manual'``
(``pr_merge_02_tenant_settings.py:160``), so ``'manual'`` doubles as the
"nobody said" value; every writer above names the column explicitly, so that
default is latent rather than active.)

So the ``false`` arm is ``dry_run AND (audit row EXISTS OR profile_source =
'manual')``. Only ``dry_run`` **and** ``manual`` together are caught, which is
the correct semantic: the marker says the last row-creating write was the
manual remediation knob, and ``rollout_state`` says where it left the repo. A
``'manual'`` row sitting at ``live`` is an operator who turned it ON and is
untouched by this arm.

⚠️ **This is LOSSY IN ONE DIRECTION, and the loss is not small.** The marker
records only who created the row, not who last wrote it, and three things erase
or pre-empt it:

* **The MCP tool's own ``ON CONFLICT`` arm leaves ``profile_source``
  untouched** (``mcp/tools.rs:3538``, deliberately). So it stamps ``'manual'``
  only when it CREATES the row.
* **Enrollment always creates the row first.** ``persist_preset_profile`` runs
  at step (c) of ``enroll_repos_for_tenant`` (``github_accounts.rs:1079``),
  before the ``tenant_repos`` row. Every enrolled repo therefore already holds a
  ``'preset'`` row, so an MCP stop against it takes the UPDATE arm and stays
  ``'preset'`` — NOT ``'manual'``. Per plan F1 (44/44 profile rows, all the
  enrollment artifact) that is the dominant population, so this discriminator
  catches the MCP path only for a repo with no prior profile row.
* **Two writers actively re-stamp over it**: enrollment's ``ON CONFLICT`` arm
  sets ``profile_source = 'preset'`` (``github_accounts.rs:981``) and the
  settings PATCH sets ``'user_edit'`` (``settings_routes.rs:369``). An MCP stop
  followed by either loses the marker entirely. (``rollout_routes``' UPDATE arm
  does not re-stamp, so it does not erase it.)

The honest summary is that the two discriminators together cover the
``rollout_routes`` path completely and the MCP path partially, and no available
column covers the residue. That residue is why :func:`upgrade` logs the
``true`` arm row-by-row (below) rather than only counting it: for a repo the
markers miss, the migrator log is the only reconstruction available.

What gets logged, and why the ``true`` arm matters more
--------------------------------------------------------

**The ``false`` arm is expected to match zero or near-zero rows.** The
population that can match is "repo-scoped operator writes", and the plan's
evidence points at that set being empty or tiny: F1 measured all 44 profile
rows as the enrollment artifact and found the operator's one tenant row at
``live``; F2 found 24 repos parked in ``shadow`` with no promotion path, i.e.
operators were not driving this control. The exact ``(tenant_id, repo)`` set
was NOT enumerated against prod at authoring time — a prod read was
deliberately not taken for a migration that is about to read the same rows.

📌 **So the arm that actually changes production behaviour is ``dry_run →
true``.** It is the one that turns currently-STOPPED repos ON, and once Phase 2
converts the land seam those repos begin real-pushing to ``main``. A count in a
histogram is not enough for that: if something merges after Phase 2 that should
not have, the identity of the rows this migration flipped is the only way back.
It also compounds the coverage gap above — the one population that can contain
a missed operator stop is exactly this one.

:func:`upgrade` therefore enumerates BOTH arms at apply time, before the UPDATE:

* every ``dry_run`` row about to become ``true``, at WARNING, by
  ``(tenant_id, repo, profile_source)`` — ``profile_source`` included because it
  is the marker whose absence let the row through, so it is what a later
  investigation needs;
* every row about to become ``false``, at WARNING, by ``(tenant_id, repo)``
  plus the discriminator that justified it.

That is strictly better than a docstring list frozen days before the apply, and
it stays correct if an operator stops a repo between now and the apply.

📌 **A flat ``true`` would have been indistinguishable from ignoring the
question.** If both discriminators match zero rows the UPDATE is numerically
identical to ``SET merge_enabled = true`` — and that is exactly why the clause
is written rather than dropped. Someone reading a flat-true migration cannot
tell whether the author established that no deliberate stop exists or never
looked; someone reading this one can, and the apply-time log settles it with a
count instead of an argument.

What is deliberately NOT backfilled
------------------------------------

⚠️ **``merge_paused`` is left ``false`` for every tenant, including a tenant
whose ``tenant_merge_settings.rollout_state`` currently reads ``'dry_run'``.**

That looks like a lost signal and is not. Plan F1 proves the tenant-wide kill
switch is INERT today: the per-repo tier resolves unconditionally above the
tenant tier (``settings::fetch_profile``), and all 44 profile rows are non-NULL,
so a tenant ``'dry_run'`` currently stops nothing. Phase 2 makes ``merge_paused``
DOMINANT. Copying an inert value into a dominant column would take a control
that has never once stopped a merge and, at deploy time, freeze a whole
tenant's fleet — the exact inverse of this plan's goal, arriving as a side
effect of a schema migration rather than as an operator decision. A pause is
one click to re-apply and is loud when applied (Phase 2 keeps the issue-#776
alerting on the disabled arm); a fleet silently frozen by a backfill is not.

Idempotency, and the one thing the guard does NOT protect
-----------------------------------------------------------
``ADD COLUMN IF NOT EXISTS`` on both tables, and the backfill is guarded on
``merge_enabled IS NULL AND rollout_state IS NOT NULL``, so re-applying writes
nothing new.

Two honest caveats about that guard.

**It is vacuous for the only re-run alembic can actually produce.**
:func:`downgrade` DROPS ``merge_enabled``, so a downgrade/upgrade cycle sees an
all-NULL column and re-derives every row from scratch. That is correct — the
values are a pure function of ``rollout_state`` + the two markers, all of which
survive the drop — but it means the guard earns nothing on that path. It bites
only for an upgrade run twice without an intervening downgrade, which alembic
does not do on its own.

⚠️ **NULL does double duty here — "inherit" and "not yet backfilled" — and the
guard cannot tell them apart.** If a row is ever left with ``merge_enabled IS
NULL`` while ``rollout_state`` still holds a value, this UPDATE MATCHES it and
re-derives a value over it. For the rows this revision creates that is
harmless, because the rows it deliberately leaves NULL are exactly the
``rollout_state IS NULL`` ones and the second conjunct excludes them. But it
means a later "clear this repo back to inherit" that NULLs ``merge_enabled``
ALONE would be silently undone by any re-apply, resurrecting a stale ``true``
over an operator's deliberate inherit.

📌 **That makes a requirement for Phase 3, which does not hold yet:** the
clear-to-inherit form must NULL ``merge_enabled`` **and** ``rollout_state``
together, so a cleared row leaves this UPDATE's WHERE clause entirely. It is
stated here as the contract Phase 3 has to carry, not as something already
true — nothing in the current schema or code enforces it, and this revision
cannot enforce it either.
"""

import logging
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# Same channel the sibling data migrations report on, so the migrator
# container's logs carry this revision's blast radius.
logger = logging.getLogger("alembic.runtime.migration")

# revision identifiers, used by Alembic.
revision: str = "merge_enabled_01"
down_revision: str = "memhold_adjudicate_02"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


# ---------------------------------------------------------------------------
# The audit-row predicate — a repo-scoped operator write on THIS (tenant, repo).
# ---------------------------------------------------------------------------
#
# `override_subject` is the scope carrier, NOT `user_overrides.repo` (which
# this writer never populates — see the module docstring). The literal prefix
# mirrors `rollout_routes.rs:327`'s `format!("scope:{scope_label}")` over
# `rollout_routes.rs:270`'s `format!("repo:{repo}")`.
#
# `'scope:tenant'` cannot match this concatenation, which is what keeps a
# tenant-wide kill switch from marking every repo `false`.
_REPO_SCOPED_OVERRIDE_EXISTS = """
        EXISTS (
            SELECT 1
              FROM coord.user_overrides o
             WHERE o.tenant_id = p.tenant_id
               AND o.override_kind IN ('rollout_promote', 'kill_switch_activated')
               AND o.override_subject = 'scope:repo:' || p.repo
        )
"""

# The SECOND discriminator: the MCP remediation knob
# (`coord_onboard_set_repo_rollout`, mcp/tools.rs:3512-3578) UPSERTs
# rollout_state directly and writes NO user_overrides row, so the audit
# subquery alone would backfill an MCP-issued stop as `true`. Its INSERT arm
# stamps profile_source='manual' (mcp/tools.rs:3548) — the only PRODUCTION
# writer of that value in the coord tree (rollout_routes / settings_routes /
# fleet_policy write 'user_edit'; enrollment writes 'preset'; the two other
# 'manual' writes are #[cfg(test)] fixtures).
#
# Lossy in one direction, deliberately accepted — see the module docstring:
# the marker records who CREATED the row, and enrollment always creates it
# first, so an MCP stop against an already-enrolled repo keeps 'preset'.
# The `true`-arm logging below is what covers that residue.
_MANUAL_PROFILE_SOURCE = "p.profile_source = 'manual'"

# A deliberate operator stop, by EITHER discriminator. Used verbatim by both
# the pre-UPDATE enumeration and the UPDATE's `false` arm so the two cannot
# disagree about which rows they mean.
_OPERATOR_STOPPED = f"""
        ({_REPO_SCOPED_OVERRIDE_EXISTS.strip()}
         OR {_MANUAL_PROFILE_SOURCE})
"""

# The rows about to be set false, read BEFORE the UPDATE so they can be named
# individually in the migrator log. Same predicate as the UPDATE's `false` arm.
_AUDITED_DRY_RUN_ROWS_SQL = f"""
    SELECT p.tenant_id,
           p.repo,
           p.profile_source,
           (SELECT string_agg(DISTINCT o.override_kind, ',' ORDER BY o.override_kind)
              FROM coord.user_overrides o
             WHERE o.tenant_id = p.tenant_id
               AND o.override_kind IN ('rollout_promote', 'kill_switch_activated')
               AND o.override_subject = 'scope:repo:' || p.repo) AS kinds
      FROM coord.tenant_repo_profiles p
     WHERE p.merge_enabled IS NULL
       AND p.rollout_state = 'dry_run'
       AND {_OPERATOR_STOPPED}
     ORDER BY p.tenant_id, p.repo
"""

# The rows about to be TURNED ON — the arm that actually changes production
# behaviour once Phase 2 converts the land seam. `profile_source` is carried
# because it is the marker whose absence let the row through, so it is what a
# later "why did this repo start merging" investigation needs.
_ENABLED_DRY_RUN_ROWS_SQL = f"""
    SELECT p.tenant_id,
           p.repo,
           p.profile_source
      FROM coord.tenant_repo_profiles p
     WHERE p.merge_enabled IS NULL
       AND p.rollout_state = 'dry_run'
       AND NOT {_OPERATOR_STOPPED}
     ORDER BY p.tenant_id, p.repo
"""

_BACKFILL_SQL = f"""
    UPDATE coord.tenant_repo_profiles p
       SET merge_enabled = CASE
           WHEN p.rollout_state <> 'dry_run' THEN true
           WHEN {_OPERATOR_STOPPED} THEN false
           ELSE true
       END
     WHERE p.merge_enabled IS NULL
       AND p.rollout_state IS NOT NULL
"""

_ENABLED_HISTOGRAM_SQL = """
    SELECT merge_enabled, count(*)
      FROM coord.tenant_repo_profiles
     GROUP BY merge_enabled
     ORDER BY 1 NULLS LAST
"""


def upgrade() -> None:
    """Add both columns, backfill ``merge_enabled``, and log the ``false`` set."""

    # ------------------------------------------------------------------
    # 1. coord.tenant_repo_profiles.merge_enabled
    # ------------------------------------------------------------------
    # NULLABLE on purpose: NULL = inherit the default, matching how
    # `rollout_state` on this same table expresses inherit. No CHECK
    # constraint — BOOLEAN is already the complete domain, which is the
    # entire point of collapsing the tri-state.
    op.execute(
        """
        ALTER TABLE coord.tenant_repo_profiles
            ADD COLUMN IF NOT EXISTS merge_enabled BOOLEAN
        """
    )

    # ------------------------------------------------------------------
    # 2. coord.tenant_merge_settings.merge_paused
    # ------------------------------------------------------------------
    # NOT NULL DEFAULT false: the pause is a latch, not an override, and
    # Phase 2 makes it dominate every tier below it. DEFAULT false
    # backfills existing rows in place — see the module docstring for why
    # a tenant sitting at rollout_state='dry_run' is NOT paused here.
    op.execute(
        """
        ALTER TABLE coord.tenant_merge_settings
            ADD COLUMN IF NOT EXISTS merge_paused BOOLEAN NOT NULL DEFAULT false
        """
    )

    # ------------------------------------------------------------------
    # 3. Name BOTH arms of the dry_run split, BEFORE the UPDATE claims
    #    them. Logged, never asserted: every outcome here is legitimate,
    #    so none of it is a reason to fail a deploy. What matters is that
    #    each flipped row is recoverable from the migrator log.
    # ------------------------------------------------------------------
    bind = op.get_bind()

    # 3a. The arm that CHANGES BEHAVIOUR: dry_run repos being turned on.
    #     Once Phase 2 converts the land seam these begin real-pushing to
    #     main, and the audit/profile_source markers do not cover every
    #     operator stop (module docstring), so this list is the only way
    #     back if one of them should not have been enabled.
    enabled = bind.execute(sa.text(_ENABLED_DRY_RUN_ROWS_SQL)).fetchall()
    if enabled:
        logger.warning(
            "merge_enabled_01: %d dry_run repo(s) carry no operator stop marker "
            "and will be backfilled merge_enabled=true — these are currently "
            "STOPPED and this TURNS THEM ON (plan F3: dry_run is the enrollment "
            "artifact). Recorded individually because the markers are not "
            "exhaustive:",
            len(enabled),
        )
        for tenant_id, repo, profile_source in enabled:
            logger.warning(
                "merge_enabled_01:   ENABLING tenant=%s repo=%s profile_source=%s",
                tenant_id,
                repo,
                profile_source,
            )
    else:
        logger.info(
            "merge_enabled_01: no dry_run row backfills true — nothing is being "
            "turned on by this migration."
        )

    # 3b. The arm that preserves a stop.
    audited = bind.execute(sa.text(_AUDITED_DRY_RUN_ROWS_SQL)).fetchall()
    if audited:
        logger.warning(
            "merge_enabled_01: %d dry_run repo(s) carry an operator stop marker "
            "and will be backfilled merge_enabled=false (a deliberate stop, "
            "honoured):",
            len(audited),
        )
        for tenant_id, repo, profile_source, kinds in audited:
            logger.warning(
                "merge_enabled_01:   PAUSED tenant=%s repo=%s profile_source=%s "
                "override_kinds=%s",
                tenant_id,
                repo,
                profile_source,
                kinds,
            )
    else:
        logger.info(
            "merge_enabled_01: no dry_run repo carries a repo-scoped audit row "
            "or profile_source='manual' — the false arm matched 0 rows. The "
            "clause is kept deliberately: a flat true would be indistinguishable "
            "from never having asked the question."
        )

    # ------------------------------------------------------------------
    # 4. The backfill. `rollout_state IS NULL` rows are untouched and stay
    #    NULL — inherit in, inherit out.
    # ------------------------------------------------------------------
    result = bind.execute(sa.text(_BACKFILL_SQL))
    logger.info(
        "merge_enabled_01: backfilled merge_enabled on %s tenant_repo_profiles "
        "row(s) from rollout_state.",
        result.rowcount,
    )
    for enabled, count in bind.execute(sa.text(_ENABLED_HISTOGRAM_SQL)).fetchall():
        logger.info(
            "merge_enabled_01: merge_enabled=%s → %d row(s)%s",
            enabled,
            count,
            " (inherit)" if enabled is None else "",
        )


def downgrade() -> None:
    """Drop both columns.

    ``rollout_state`` is untouched by this revision on either table and still
    carries the pre-collapse posture verbatim, so a downgrade returns to the
    tri-state resolver with no loss: nothing read ``merge_enabled`` before
    Phase 2, and Phase 2 cannot deploy until this has been verified in prod
    [policy: ``alembic-sole-authorship``].

    The backfilled ``merge_enabled`` values are not recoverable after the drop,
    which is correct rather than a gap — they are DERIVED from ``rollout_state``
    plus ``coord.user_overrides``, both of which survive, so re-applying this
    revision reproduces them.
    """
    op.execute(
        "ALTER TABLE coord.tenant_merge_settings "
        "DROP COLUMN IF EXISTS merge_paused"
    )
    op.execute(
        "ALTER TABLE coord.tenant_repo_profiles "
        "DROP COLUMN IF EXISTS merge_enabled"
    )
