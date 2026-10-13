"""coord expedited-land lever — request store, review log, worker liveness, dials

Revision ID: expedite_01
Revises: escalation_verdicts_01
Create Date: 2026-10-13

Phase 1 of plan ``2026-10-13-coord-expedited-land-lever-for-agents``
(qontinui-dev-notes/plans). coord authors **zero** DDL
(``[policy: alembic-sole-authorship]``), so every relation the lever's coord
code reads lands here first and must be applied in production BEFORE the coord
door/worker that reads it is deployed. ``down_revision`` is this repo's single
alembic head at authoring time; if another revision lands first, re-point it at
the new head (``alembic-graph-pr.yml`` serialises alembic PRs). Do NOT author an
``alembic merge`` revision.

What the lever is
=================

An agent ASKS coord to land one PR on an expedited path
(``coord_request_expedited_land`` / ``POST
/pr-merge/repos/:repo/pulls/:number/agent/expedite``) when coord can re-derive a
closed reason — ``red_main_remedy`` or ``coord_stall``. coord re-checks every
trigger and safety condition itself and lands through its own scheduler, or
refuses with a typed code. Nothing here lets an agent merge.

Relations
=========

1. ``coord.expedited_land_requests`` — one row per request (and per coord-side
   child request). The request's ``state`` is STORED (plan §3.5) so the per-PR
   partial unique index can release when a request ends. Every state change is a
   compare-and-swap in coord; the CHECK below is the closed state set. A
   ``refused`` / ``proposal_voided`` / ``proposal_failed`` row carries its typed
   code (and cause/class) in ``refusal`` JSONB — the code set is closed in Rust
   (the refusal enum with ``code()`` / ``retryable()``), not by a CHECK here, so a
   new code needs no migration.

   Indexes, all excluding the passive shadow sweep's rows (``shadow = true``,
   plan §3.5 "Shadow rows"):

   * ``uq_expedited_land_requests_idem`` — UNIQUE ``(tenant_id,
     idempotency_key, attempt)`` over CALLER rows only (``parent_request_id IS
     NULL``): idempotent replay and ``attempt + 1`` after a retryable refusal
     (plan §5.4). A coord-side child request (plan §3.1) inherits its parent's
     key and is not a caller request, so it is outside this index.
   * ``uq_expedited_land_requests_live_per_pr`` — UNIQUE ``(tenant_id, repo,
     pr_number)`` WHERE ``state`` is non-terminal: at most one live request per
     PR (S14; ``pr_busy``).
   * ``uq_expedited_land_requests_child`` — UNIQUE ``(parent_request_id,
     child_seq)``: the conflict-path hook and the reconciler can never both open
     the same coord-side child (plan §3.1, vet round 9 #12).
   * ``ix_expedited_land_requests_due`` — the worker's ``FOR UPDATE SKIP
     LOCKED`` claim over ``pending`` / ``evaluating`` rows by ``retry_at``.
   * ``ix_expedited_land_requests_reconcile`` — the reconciler's scan over
     ``admitted`` / ``land_unconfirmed`` / ``land_unknown`` / ``landed`` /
     ``expired`` rows (an expired request's proposal may still land, §3.5).
     ``landed_at`` dates a land for the 7-day ``land_rolled_back`` scan.
   * ``ix_expedited_land_requests_device_window`` /
     ``ix_expedited_land_requests_repo_window`` /
     ``ix_expedited_land_requests_head`` — the durable rate-limit counts (S14)
     and the held-refusal lookup on ``(tenant, repo, pr, head)`` (plan §5.4).
     The two window indexes cover caller rows only: retries and children never
     count against S14 (plan §3.1).

2. ``coord.merge_proposals`` — a partial UNIQUE index on
   ``(metadata->>'expedite_request_id')``: a second proposal stamped for one
   request is impossible, whichever leader inserts it (plan §4.4 Failover).

3. ``coord.expedite_independence_reviews`` + ``coord.expedite_independence_verdicts``
   — the S13 falsifier: sampled landed expedites queued for a fresh-context
   review, and an APPEND-ONLY verdict log keyed on the review gate. The log is a
   MEASUREMENT with no effect on any session (plan §3.3 S13, vet round 24 #1).
   Append-only is coord's convention; no trigger enforces it.
   Neither table is readable through any device tool (vet round 33 #9).

4. ``coord.expedite_worker_heartbeat`` — the worker's and the reconciler's own
   progress heartbeat, keyed ``(leader_term, task)`` so neither overwrites the
   other (plan §4.5). ``seed_failed`` marks a best-effort failed seed, which is
   stale by definition. Indexed by ``boot_id`` for the confirmed-dead test; one
   row per leader term, pruned by the reconciler.

5. ``coord.expedite_clean_shutdowns`` — boot ids that shut down gracefully, so a
   deploy failover's re-claim is never counted toward ``poison_row``.

6. ``coord.notifications`` — ``request_id`` (nullable) / ``event`` / ``coord_retries``
   (both NOT NULL with a constant default, a metadata-only add) plus a partial
   UNIQUE ``(request_id, kind, event, coord_retries)``: each expedite notice is
   written ``INSERT … ON CONFLICT DO NOTHING``, so two leaders can never send one
   notice twice (plan §4.4, §7). Because ``event`` and ``coord_retries`` cannot be
   NULL, no NULL can make two copies of one notice distinct. NULL ``request_id``
   rows (every existing producer) are outside the index. Notices the plan routes
   to ``coord.pr_events`` only are deduplicated in coord code (a lookup under the
   request's advisory lock); this revision adds no index to ``pr_events``.

7. Dials on ``coord.tenant_merge_settings`` and ``coord.tenant_repo_profiles``
   (all nullable; NULL = inherit the next tier up):

   * ``expedited_land TEXT`` CHECK ``('on', 'shadow', 'off')`` — the tenant/repo
     off-switch. coord resolves it most-restrictive across the fleet switch,
     EVERY owning tenant and the repo (plan §6). ``DialClass::KillSwitch`` in
     coord: agents can never write it.
   * ``expedite_max_files INTEGER`` / ``expedite_max_changed_lines INTEGER``
     (CHECK > 0) — the S11 size overrides, operator-only.
   * ``expedite_review_arm BOOLEAN`` — the S13 review arm's in-product
     off-switch (``agent-spawn-authorization``).

The new ``eval_attempt`` reasons (``absent_enqueue_error``,
``expedite_eval_deadline``) need no DDL: ``coord.pr_events`` payloads are not
CHECK-constrained.

Locking. The new tables are created and indexed in the migration transaction
(zero rows). Columns on the live ``notifications`` / ``tenant_merge_settings`` /
``tenant_repo_profiles`` tables are metadata-only adds under ``SET LOCAL
lock_timeout = '3s'``. The two indexes on live tables (``merge_proposals``,
``notifications``) are built ``CONCURRENTLY`` in an autocommit block.

Recovering a failed concurrent build. A cancelled or failed ``CONCURRENTLY``
build leaves an INVALID index that ``IF NOT EXISTS`` then keeps on every re-run.
After deploy, check ``SELECT indexrelid::regclass, indisvalid FROM pg_index
WHERE indexrelid IN ('coord.uq_merge_proposals_expedite_request_id'::regclass,
'coord.uq_notifications_request_event'::regclass)``. If either reads ``false``:
``DROP INDEX CONCURRENTLY`` it, ``alembic stamp escalation_verdicts_01``, and
re-run ``alembic upgrade head`` (every other statement here is idempotent).

Writer obligation (coord). ``event`` defaults to ``''``: a coord writer must set
a non-empty ``event`` on every expedite notice, or two different notices for one
``(request_id, kind, coord_retries)`` collide and the second is dropped as
"already sent".

Writes **no rows**.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "expedite_01"
down_revision: str | Sequence[str] | None = "escalation_verdicts_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None



# Every op.execute argument below is a plain string LITERAL, never an f-string or
# a loop over table names: coord's migration classifier admits only a static
# op.execute argument, and the `alembic-schema-arg-gate` pre-commit hook parses
# the raw SQL to prove every statement names its schema.


def upgrade() -> None:
    """Create the expedite relations, indexes and dial columns. No rows."""
    # 1. The request store. A NEW table: its indexes are built on zero rows.
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.expedited_land_requests (
            id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            attempt                     INTEGER NOT NULL DEFAULT 1,
            tenant_id                   UUID NOT NULL,
            device_id                   UUID NULL,
            repo                        TEXT NOT NULL,
            pr_number                   INTEGER NOT NULL,
            head_sha                    TEXT NOT NULL,
            reason                      TEXT NOT NULL,
            disclosure                  TEXT NOT NULL DEFAULT '',
            independence                JSONB NULL,
            requester                   JSONB NOT NULL DEFAULT '{}'::jsonb,
            remedies_jobs               JSONB NOT NULL DEFAULT '[]'::jsonb,
            idempotency_key             TEXT NOT NULL,
            head_session_id             UUID NULL,
            author_session_id           UUID NULL,
            requester_session_id        UUID NULL,
            requester_is_author         BOOLEAN NULL,
            state                       TEXT NOT NULL DEFAULT 'pending',
            shadow                      BOOLEAN NOT NULL DEFAULT false,
            shadow_verdict              TEXT NULL,
            episode_key                 JSONB NULL,
            alert_id                    UUID NULL,
            trigger_evidence            JSONB NULL,
            refusal                     JSONB NULL,
            retry_at                    TIMESTAMPTZ NULL,
            coord_retries               INTEGER NOT NULL DEFAULT 0,
            parent_request_id           UUID NULL,
            child_seq                   INTEGER NULL,
            proposal_id                 UUID NULL,
            rebased_tip                 TEXT NULL,
            pushed_tip                  TEXT NULL,
            main_sha_before             TEXT NULL,
            land_sha                    TEXT NULL,
            landed_at                   TIMESTAMPTZ NULL,
            verified_at                 TIMESTAMPTZ NULL,
            post_land                   JSONB NULL,
            siblings_in_flight          INTEGER NULL,
            parked_behind_sibling_secs  INTEGER NULL,
            notification_id             UUID NULL,
            pr_comment_id               BIGINT NULL,
            pr_comment_state            TEXT NOT NULL DEFAULT 'none',
            pr_comment_reserved_at      TIMESTAMPTZ NULL,
            lease_fenced_token          BIGINT NULL,
            claimed_at                  TIMESTAMPTZ NULL,
            claimed_by_boot_id          UUID NULL,
            panic_count                 INTEGER NOT NULL DEFAULT 0,
            admitted_at                 TIMESTAMPTZ NULL,
            created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT ck_expedited_land_requests_reason
                CHECK (reason IN ('red_main_remedy', 'coord_stall')),
            CONSTRAINT ck_expedited_land_requests_state
                CHECK (state IN ('pending', 'evaluating', 'admitted',
                                 'land_unconfirmed', 'land_unknown', 'landed',
                                 'landed_unattributed', 'land_rolled_back',
                                 'refused', 'proposal_voided',
                                 'proposal_cancelled', 'proposal_failed',
                                 'expired')),
            CONSTRAINT ck_expedited_land_requests_shadow_verdict
                CHECK (shadow_verdict IS NULL
                       OR shadow_verdict IN ('would_land', 'would_refuse',
                                             'unknown')),
            CONSTRAINT ck_expedited_land_requests_pr_comment_state
                CHECK (pr_comment_state IN ('none', 'creating', 'created')),
            CONSTRAINT ck_expedited_land_requests_attempt_positive
                CHECK (attempt >= 1),
            CONSTRAINT ck_expedited_land_requests_coord_retries_nonneg
                CHECK (coord_retries >= 0),
            CONSTRAINT ck_expedited_land_requests_panic_count_nonneg
                CHECK (panic_count >= 0),
            CONSTRAINT ck_expedited_land_requests_child_pair
                CHECK ((parent_request_id IS NULL) = (child_seq IS NULL)),
            CONSTRAINT ck_expedited_land_requests_remedies_jobs_is_array
                CHECK (jsonb_typeof(remedies_jobs) = 'array'),
            CONSTRAINT fk_expedited_land_requests_parent
                FOREIGN KEY (parent_request_id)
                REFERENCES coord.expedited_land_requests (id)
                ON DELETE NO ACTION
        )
        """
    )
    op.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS uq_expedited_land_requests_idem
            ON coord.expedited_land_requests (tenant_id, idempotency_key, attempt)
         WHERE NOT shadow AND parent_request_id IS NULL
        """
    )
    op.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS uq_expedited_land_requests_live_per_pr
            ON coord.expedited_land_requests (tenant_id, repo, pr_number)
         WHERE NOT shadow
           AND state IN ('pending', 'evaluating', 'admitted',
                         'land_unconfirmed', 'land_unknown')
        """
    )
    op.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS uq_expedited_land_requests_child
            ON coord.expedited_land_requests (parent_request_id, child_seq)
         WHERE NOT shadow AND parent_request_id IS NOT NULL
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_expedited_land_requests_due
            ON coord.expedited_land_requests (retry_at, created_at)
         WHERE NOT shadow AND state IN ('pending', 'evaluating')
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_expedited_land_requests_reconcile
            ON coord.expedited_land_requests (state, updated_at)
         WHERE NOT shadow
           AND state IN ('admitted', 'land_unconfirmed', 'land_unknown',
                         'landed', 'expired')
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_expedited_land_requests_device_window
            ON coord.expedited_land_requests (tenant_id, device_id, created_at)
         WHERE NOT shadow AND parent_request_id IS NULL
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_expedited_land_requests_repo_window
            ON coord.expedited_land_requests (tenant_id, repo, created_at)
         WHERE NOT shadow AND parent_request_id IS NULL
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_expedited_land_requests_head
            ON coord.expedited_land_requests (tenant_id, repo, pr_number, head_sha)
         WHERE NOT shadow
        """
    )
    op.execute(
        """
        COMMENT ON TABLE coord.expedited_land_requests IS
            'Agent requests for an expedited land (plan '
            '2026-10-13-coord-expedited-land-lever-for-agents). state is stored '
            'and moved only by compare-and-swap; terminal states never reopen '
            'except landed -> land_rolled_back. shadow=true rows are the passive '
            'shadow sweep''s and are excluded from every partial index, the '
            'rate limits and the reconciler.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.expedited_land_requests.refusal IS
            'The typed refusal for refused / proposal_voided / proposal_failed '
            'rows, and the code of a would_refuse shadow verdict: {code, '
            'cause|class, retryable, retry_after_secs, detail, last_code}. The '
            'code set is closed in Rust, not by a CHECK here.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.expedited_land_requests.shadow_verdict IS
            'Shadow sweep / shadow-mode verdict. would_refuse carries its code in '
            'refusal; unknown is the sweep''s shadow_unknown{input} (an input '
            'was not fetched or was paced), excluded from the false-accept metric.'
        """
    )

    # 2. The S13 independence sampler: items + verdict log. New tables.
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.expedite_independence_reviews (
            id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id        UUID NOT NULL,
            request_id       UUID NOT NULL,
            review_gate_ids  UUID[] NOT NULL DEFAULT '{}'::uuid[],
            escalation_seq   INTEGER NOT NULL DEFAULT 0,
            state            TEXT NOT NULL DEFAULT 'sampled',
            created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT ck_expedite_independence_reviews_state
                CHECK (state IN ('sampled', 'dispatched', 'agreed', 'disputed',
                                 'unreviewed')),
            CONSTRAINT ck_expedite_independence_reviews_escalation_seq
                CHECK (escalation_seq IN (0, 1)),
            CONSTRAINT fk_expedite_independence_reviews_request
                FOREIGN KEY (request_id)
                REFERENCES coord.expedited_land_requests (id)
                ON DELETE NO ACTION
        )
        """
    )
    op.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS uq_expedite_independence_reviews_request
            ON coord.expedite_independence_reviews (request_id)
        """
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.expedite_independence_verdicts (
            id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            review_id            UUID NOT NULL,
            gate_id              UUID NOT NULL,
            verdict              TEXT NOT NULL,
            reason               TEXT NOT NULL DEFAULT '',
            reviewer_principal   TEXT NOT NULL,
            reviewer_device_id   UUID NULL,
            reviewer_session_id  UUID NULL,
            from_claimant_device BOOLEAN NOT NULL,
            created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT ck_expedite_independence_verdicts_verdict
                CHECK (verdict IN ('agree', 'dispute')),
            CONSTRAINT fk_expedite_independence_verdicts_review
                FOREIGN KEY (review_id)
                REFERENCES coord.expedite_independence_reviews (id)
                ON DELETE NO ACTION
        )
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_expedite_independence_verdicts_review
            ON coord.expedite_independence_verdicts (review_id, gate_id, created_at)
        """
    )
    op.execute(
        """
        COMMENT ON TABLE coord.expedite_independence_verdicts IS
            'Verdict log for the expedite independence sampler, append-only BY '
            'CONVENTION (coord never UPDATEs or DELETEs it; no trigger enforces '
            'it). A MEASUREMENT only: no verdict restricts a session or lands '
            'anything. Only from_claimant_device rows count toward resolution.'
        """
    )

    # 3. Worker / reconciler progress heartbeat, and graceful shutdowns. New.
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.expedite_worker_heartbeat (
            leader_term    BIGINT NOT NULL,
            task           TEXT NOT NULL,
            boot_id        UUID NOT NULL,
            heartbeat_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
            last_progress  TEXT NULL,
            seed_failed    BOOLEAN NOT NULL DEFAULT false,
            PRIMARY KEY (leader_term, task),
            CONSTRAINT ck_expedite_worker_heartbeat_task
                CHECK (task IN ('worker', 'reconciler'))
        )
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_expedite_worker_heartbeat_boot
            ON coord.expedite_worker_heartbeat (boot_id, heartbeat_at)
        """
    )
    op.execute(
        """
        COMMENT ON TABLE coord.expedite_worker_heartbeat IS
            'One row per (leader_term, task). Grows by one row per leader term; '
            'the expedite reconciler prunes terms older than 7 days.'
        """
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.expedite_clean_shutdowns (
            boot_id  UUID PRIMARY KEY,
            at       TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """
    )

    # 4. Columns on EXISTING live tables. Metadata-only adds (nullable, or NOT
    # NULL with a constant default), under a short lock_timeout so a queued
    # ACCESS EXCLUSIVE lock fails the deploy fast instead of stalling the train.
    op.execute("SET LOCAL lock_timeout = '3s'")
    op.execute(
        """
        ALTER TABLE coord.notifications
            ADD COLUMN IF NOT EXISTS request_id UUID NULL,
            ADD COLUMN IF NOT EXISTS event TEXT NOT NULL DEFAULT '',
            ADD COLUMN IF NOT EXISTS coord_retries INTEGER NOT NULL DEFAULT 0
        """
    )
    op.execute(
        """
        ALTER TABLE coord.tenant_merge_settings
            ADD COLUMN IF NOT EXISTS expedited_land TEXT NULL
                CONSTRAINT ck_tenant_merge_settings_expedited_land
                CHECK (expedited_land IS NULL
                       OR expedited_land IN ('on', 'shadow', 'off')),
            ADD COLUMN IF NOT EXISTS expedite_max_files INTEGER NULL
                CONSTRAINT ck_tenant_merge_settings_expedite_max_files
                CHECK (expedite_max_files IS NULL OR expedite_max_files > 0),
            ADD COLUMN IF NOT EXISTS expedite_max_changed_lines INTEGER NULL
                CONSTRAINT ck_tenant_merge_settings_expedite_max_changed_lines
                CHECK (expedite_max_changed_lines IS NULL
                       OR expedite_max_changed_lines > 0),
            ADD COLUMN IF NOT EXISTS expedite_review_arm BOOLEAN NULL
        """
    )
    op.execute(
        """
        ALTER TABLE coord.tenant_repo_profiles
            ADD COLUMN IF NOT EXISTS expedited_land TEXT NULL
                CONSTRAINT ck_tenant_repo_profiles_expedited_land
                CHECK (expedited_land IS NULL
                       OR expedited_land IN ('on', 'shadow', 'off')),
            ADD COLUMN IF NOT EXISTS expedite_max_files INTEGER NULL
                CONSTRAINT ck_tenant_repo_profiles_expedite_max_files
                CHECK (expedite_max_files IS NULL OR expedite_max_files > 0),
            ADD COLUMN IF NOT EXISTS expedite_max_changed_lines INTEGER NULL
                CONSTRAINT ck_tenant_repo_profiles_expedite_max_changed_lines
                CHECK (expedite_max_changed_lines IS NULL
                       OR expedite_max_changed_lines > 0),
            ADD COLUMN IF NOT EXISTS expedite_review_arm BOOLEAN NULL
        """
    )
    # SET LOCAL is transaction-scoped and env.py wraps the whole run in one
    # transaction, so put it back or it leaks into every later revision.
    op.execute("SET LOCAL lock_timeout = DEFAULT")

    # 5. Indexes on EXISTING live tables: CONCURRENTLY, outside the transaction.
    with op.get_context().autocommit_block():
        # One stamped proposal per request, whichever leader inserts it.
        op.execute(
            """
            CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS
                uq_merge_proposals_expedite_request_id
            ON coord.merge_proposals ((metadata->>'expedite_request_id'))
            WHERE metadata ? 'expedite_request_id'
            """
        )
        # Notice dedup: event and coord_retries are NOT NULL, so no NULL can
        # make two otherwise-identical notices distinct.
        op.execute(
            """
            CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS
                uq_notifications_request_event
            ON coord.notifications (request_id, kind, event, coord_retries)
            WHERE request_id IS NOT NULL
            """
        )


def downgrade() -> None:
    """Drop everything upgrade() created, in reverse order. Idempotent."""
    with op.get_context().autocommit_block():
        op.execute(
            "DROP INDEX CONCURRENTLY IF EXISTS coord.uq_notifications_request_event"
        )
        op.execute(
            "DROP INDEX CONCURRENTLY IF EXISTS "
            "coord.uq_merge_proposals_expedite_request_id"
        )

    op.execute("SET LOCAL lock_timeout = '3s'")
    op.execute(
        """
        ALTER TABLE coord.tenant_repo_profiles
            DROP CONSTRAINT IF EXISTS ck_tenant_repo_profiles_expedite_max_changed_lines,
            DROP CONSTRAINT IF EXISTS ck_tenant_repo_profiles_expedite_max_files,
            DROP CONSTRAINT IF EXISTS ck_tenant_repo_profiles_expedited_land,
            DROP COLUMN IF EXISTS expedite_review_arm,
            DROP COLUMN IF EXISTS expedite_max_changed_lines,
            DROP COLUMN IF EXISTS expedite_max_files,
            DROP COLUMN IF EXISTS expedited_land
        """
    )
    op.execute(
        """
        ALTER TABLE coord.tenant_merge_settings
            DROP CONSTRAINT IF EXISTS ck_tenant_merge_settings_expedite_max_changed_lines,
            DROP CONSTRAINT IF EXISTS ck_tenant_merge_settings_expedite_max_files,
            DROP CONSTRAINT IF EXISTS ck_tenant_merge_settings_expedited_land,
            DROP COLUMN IF EXISTS expedite_review_arm,
            DROP COLUMN IF EXISTS expedite_max_changed_lines,
            DROP COLUMN IF EXISTS expedite_max_files,
            DROP COLUMN IF EXISTS expedited_land
        """
    )
    op.execute(
        """
        ALTER TABLE coord.notifications
            DROP COLUMN IF EXISTS coord_retries,
            DROP COLUMN IF EXISTS event,
            DROP COLUMN IF EXISTS request_id
        """
    )
    op.execute("SET LOCAL lock_timeout = DEFAULT")

    op.execute("DROP TABLE IF EXISTS coord.expedite_clean_shutdowns")
    op.execute("DROP TABLE IF EXISTS coord.expedite_worker_heartbeat")
    op.execute("DROP TABLE IF EXISTS coord.expedite_independence_verdicts")
    op.execute("DROP TABLE IF EXISTS coord.expedite_independence_reviews")
    op.execute("DROP TABLE IF EXISTS coord.expedited_land_requests")
