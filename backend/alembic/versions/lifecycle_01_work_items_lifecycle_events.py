"""coord lifecycle ledgers, work items, and the question contract columns

Phase 17 of plan ``2026-10-28-one-session-lifecycle-authority`` (node P7).
Schema objects only: nothing writes them until Phases 18, 20, 26, 28, 42, 50
and 56 land in coord, and nothing reads them until Phase 74. Every name, type,
CHECK, UNIQUE and index below is the one that phase fixes; the coord writers are
built against it, so a shape change here is a contract change there.

What this adds
==========================================================================

Six new tables (none with a foreign key to ``coord.sessions``: a session row is
pruned 7 days after it closes, coord ``COORD_SESSION_RETENTION_DAYS``, and
these records must outlive it)::

    coord.lifecycle_events         C3's decision record (Phase 18 ingests it)
    coord.work_items               one row per owed item, identity
                                   (tenant_id, kind, subject)
    coord.work_item_events         a work item's transition log; coord_seq is
                                   the gap-detection sequence
    coord.work_ledger_arming       append-only shadow -> live record; the
                                   current mode is the latest row
    coord.lifecycle_close_latches  Phase 20's false-close latch
    coord.session_message_leases   Phase 26's delivery lease

Columns on existing tables, every one nullable or constant-defaulted, so each
ADD is catalog-only (no rewrite, no scan)::

    coord.sessions.pane_id                    TEXT NULL
    coord.session_messages.delivered_evidence TEXT NULL
                                   + CHECK (IN ('pty_inject','transcript'))
    coord.session_census_device.complete      BOOLEAN NOT NULL DEFAULT false
    coord.agent_questions.basis               JSONB
                         .documents_read      JSONB
                         .dedupe_key          TEXT
                         .clear_predicate     JSONB
                         .why_none_decides    TEXT
                         .policy_gap_finding_id UUID

The agent-question columns are TRAILING and in this order. That is append-only
for consistency with the existing column order, not a decoding requirement:
coord's ``agent_questions.rs`` reads through its own explicit ``COLS``
projection, never by table position. ``policy_gap_finding_id`` carries no foreign key to
``coord.findings`` (the ``alert_id`` precedent: the question outlives the row
it cites).

Three indexes on existing, continuously written tables, built
``CONCURRENTLY``::

    uq_sessions_active_pane         coord.sessions (tenant_id, device_id, pane_id)
        WHERE pane_id IS NOT NULL AND state <> 'closed'
    uq_agent_questions_open_dedupe  coord.agent_questions (tenant_id, dedupe_key)
        WHERE dedupe_key IS NOT NULL AND responded_at IS NULL
          AND withdrawn_at IS NULL
    idx_agent_questions_open_typed  coord.agent_questions (tenant_id, created_at DESC)
        WHERE basis IS NOT NULL AND responded_at IS NULL AND withdrawn_at IS NULL

Why ``state <> 'closed'`` and not ``state = 'active'``
==========================================================================

``coord.sessions.state`` is ``expected | active | pending_resolution | stale |
closed`` (``sessions_state_check``), and coord sets ``stale`` on rows that are
still open. Every OPEN row holds its pane. A ``state = 'active'`` predicate
would let a stale row's pane register a twin, and the revive of the stale row
would then 23505. Only ``closed`` frees a pane.

Why the dedupe index has THREE conjuncts
==========================================================================

A withdrawn question keeps ``responded_at`` NULL
(``coord_agent_questions_withdrawn``). The two-conjunct shape of
``uq_agent_questions_open_alert_episode`` therefore wedges a key once its
question is withdrawn. This index takes the three-conjunct shape of the landed
``uq_agent_questions_open_effect``, so a withdrawn question frees its
``dedupe_key``. Producers write with the identical conflict target, each
namespacing ``dedupe_key`` by its basis variant::

    INSERT INTO coord.agent_questions (..., dedupe_key)
    VALUES (...)
    ON CONFLICT (tenant_id, dedupe_key)
        WHERE dedupe_key IS NOT NULL AND responded_at IS NULL
          AND withdrawn_at IS NULL
    DO NOTHING
    RETURNING question_id

Locking
==========================================================================

All table and column DDL runs in ONE transaction under
``SET LOCAL lock_timeout = '3s'``: it takes ACCESS EXCLUSIVE on the shared
``coord.sessions``, ``coord.session_messages``, ``coord.session_census_device``
and ``coord.agent_questions``, and a queued exclusive request blocks every
reader and writer behind it. The statements are ordered so the hottest lock is
held for the shortest time: the five brand-new tables first, then
``coord.session_message_leases``, then the ALTERs on
``coord.session_messages``, ``coord.session_census_device`` and
``coord.agent_questions``, and LAST ``coord.sessions ADD COLUMN pane_id``.

The new tables are not lock-free. Every ``REFERENCES coord.tenants`` takes
SHARE ROW EXCLUSIVE on ``coord.tenants`` until commit (it blocks writes to
tenants, not reads), and the leases table's foreign key takes the same lock on
``coord.session_messages``. ``coord.tenants`` is rarely written, so that is
the cheapest lock to hold longest.

The known risk of one transaction (the plan prescribes one, so this keeps
one) is the message bus. Each lock wait is bounded by the 3 s
``lock_timeout``, and once a lock on ``coord.session_messages`` is requested it
stays held (or queued) until commit, through every later wait:

* WRITERS to ``coord.session_messages`` are blocked from the leases foreign
  key's SHARE ROW EXCLUSIVE request onward: that request (up to 3 s), the
  ``ADD COLUMN``'s ACCESS EXCLUSIVE request (3 s), then the ALTERs of
  ``session_census_device``, ``agent_questions`` and ``sessions`` (3 s each) —
  about 15 s in the worst case.
* READERS are blocked from the ``ADD COLUMN``'s queued ACCESS EXCLUSIVE
  request onward — about 12 s in the worst case.

A live transaction that holds one of the later tables while waiting on
``coord.session_messages`` can also deadlock with this one. Either way
PostgreSQL aborts the migration (lock_timeout or deadlock detection), never the
application, and the whole transaction rolls back. That is acceptable because
the upgrade is idempotent: a re-run simply starts over.

These bounds describe this revision alone. ``env.py`` runs a whole pending
upgrade batch in one transaction, so in a multi-revision deploy the locks
taken by earlier revisions since the batch's last commit (any earlier
``autocommit_block()`` commits it) are also held until this revision's
``autocommit_block()`` commits, so readers and writers of those tables stall
through this revision's waits too.

There is no ``RESET lock_timeout``: the ``autocommit_block()`` commit ends the
``SET LOCAL``, and ``env.py``'s ``on_version_apply`` hook resets
``lock_timeout`` after every revision anyway.

``delivered_evidence``'s CHECK is added ``NOT VALID``, the
``coord_alerts_onset_01`` posture: the column is brand new, so every existing
row holds NULL and satisfies it trivially, and a validating scan of
``coord.session_messages`` under ACCESS EXCLUSIVE could find nothing. The CHECK
is enforced for every row written from now on either way.

Indexes on the NEW tables are built in that same transaction with a plain
``CREATE INDEX IF NOT EXISTS``: the tables are invisible to every other
session until it commits, so there is nothing to block. That includes
``ix_session_message_leases_message_id``, a plain index on ``message_id``: the
``ON DELETE CASCADE`` from ``coord.session_messages`` looks leases up by
``message_id`` alone, which the two partial ``scope = 'message'`` indexes
cannot serve.

The three indexes on existing tables are built ``CONCURRENTLY`` inside
``op.get_context().autocommit_block()``, which commits the DDL transaction
first. A killed or failed CONCURRENTLY build leaves an INVALID index of the same
name that ``IF NOT EXISTS`` would keep and the planner never uses, so each build
first looks its name up in ``pg_index`` and, if INVALID, drops it
(CONCURRENTLY) and rebuilds it — the ``agent_questions_alert_episode_01``
guard. A re-run ends with a valid index or a loud failure, never a silent
invalid one. On first apply every new column is NULL, so each build indexes
nothing it could collide on.

Idempotency
==========================================================================

Because ``autocommit_block()`` commits the DDL before the version stamp, a
failed index build leaves the tables and columns in place with the revision
unstamped. Every statement is therefore re-runnable: ``CREATE ... IF NOT
EXISTS``, ``ADD COLUMN IF NOT EXISTS``, and a ``pg_constraint`` lookup run
from Python guarding the one ``ADD CONSTRAINT`` (PostgreSQL has no ``IF NOT
EXISTS`` for it).

Retention
==========================================================================

None in this revision. Coord implements the 90-day retention of
``lifecycle_events`` (Phase 18) and ``work_item_events`` (Phase 56) as
leader-gated prunes; this revision provides the time-column indexes they delete
by (``idx_lifecycle_events_received_at``, ``idx_work_item_events_occurred_at``).
Message-scope ``session_message_leases`` rows go with their message
(``ON DELETE CASCADE``). Session-scope leases (``message_id IS NULL``) have NO
retention owner yet: Phase 26 defines the lease store and its reads but no
prune, so expired session-scope leases accumulate until one is added (recorded
as coord finding 65b61ea6-332d-44d6-a441-5226efcee03e). The
``(session_id, expires_at) WHERE scope = 'session'`` index is what such a
prune would delete by.
``work_ledger_arming`` and ``lifecycle_close_latches`` are never pruned.

Downgrade
==========================================================================

The three concurrent indexes are dropped CONCURRENTLY in an autocommit block.
Then, under ``SET LOCAL lock_timeout = '3s'``, the plain
``ix_session_message_leases_message_id`` index, then the added columns:
the six ``coord.agent_questions`` columns, ``coord.session_census_device.complete``,
the ``delivered_evidence`` CHECK with its column, and ``coord.sessions.pane_id``.
Last come the six tables: ``work_item_events``, ``work_items`` (events before
items), ``lifecycle_events``, ``work_ledger_arming``,
``lifecycle_close_latches`` and ``session_message_leases``. Every row in the
new tables and new columns is lost; the pre-existing rows survive.

How it lands: authorship and chaining
==========================================================================

This file lands through coord's migrations ESCALATE path, not the classifier's
auto-land. coord's migration classifier rejects it: the upgrade-path
``DROP INDEX CONCURRENTLY`` of an INVALID leftover (C9) and the
``op.get_bind()`` catalog probes (``forbid_unclassifiable_code``) are outside
what it can classify. ``RESET`` and dollar-quoted SQL, which it also refuses,
are avoided all the same.

Hand-authored; ``alembic revision --autogenerate`` was not run. alembic is the
sole author of ``coord.*`` schema (served policy ``production-and-cost``
``alembic-sole-authorship``). Every ``op.execute`` argument is a static,
schema-qualified literal (the ``alembic-schema-arg-gate`` pre-commit hook), and
none carries a ``:word`` sequence, which SQLAlchemy ``text()`` would read as a
bind parameter. The two catalog probes (``_index_is_invalid``,
``_constraint_exists``) are the exception on purpose: they run through
``op.get_bind()`` and DO use ``:idx`` / ``:tbl`` / ``:con`` bind parameters.

``down_revision`` is the single alembic head at authoring, measured 2026-11-24
with ``alembic heads`` and ``scripts/ci/count_alembic_heads.py``
(``HEAD_COUNT=1``). A re-point is two
coupled edits: ``down_revision`` and the ``Revises:`` line below (the test
parses its parent from this file).

Revision ID: lifecycle_01_work_items_lifecycle_events
Revises: coord_subprojects_05_note_events
Create Date: 2026-11-24

"""

from collections.abc import Sequence

from sqlalchemy import text

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "lifecycle_01_work_items_lifecycle_events"
down_revision: str | Sequence[str] | None = "coord_subprojects_05_note_events"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _index_is_invalid(index_name: str) -> bool:
    """True when ``coord.<index_name>`` exists and is INVALID (a failed build)."""
    return bool(
        op.get_bind()
        .execute(
            text(
                """
                SELECT NOT i.indisvalid
                  FROM pg_index i
                  JOIN pg_class c ON c.oid = i.indexrelid
                  JOIN pg_namespace n ON n.oid = c.relnamespace
                 WHERE n.nspname = 'coord' AND c.relname = :idx
                """
            ),
            {"idx": index_name},
        )
        .scalar()
    )


def _constraint_exists(table: str, constraint: str) -> bool:
    """True when ``coord.<table>`` already carries ``constraint``."""
    return bool(
        op.get_bind()
        .execute(
            text(
                """
                SELECT 1
                  FROM pg_constraint k
                  JOIN pg_class t ON t.oid = k.conrelid
                  JOIN pg_namespace n ON n.oid = t.relnamespace
                 WHERE n.nspname = 'coord' AND t.relname = :tbl
                   AND k.conname = :con
                """
            ),
            {"tbl": table, "con": constraint},
        )
        .scalar()
    )


def upgrade() -> None:
    """Tables, columns and new-table indexes in one transaction; then the
    three CONCURRENTLY indexes on existing tables. Idempotent."""
    # Bound every ACCESS EXCLUSIVE wait; see the docstring's Locking section.
    op.execute("SET LOCAL lock_timeout = '3s'")

    # ---- (1) coord.lifecycle_events ---------------------------------------
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.lifecycle_events (
            event_id                BIGINT       GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
            tenant_id               UUID         NOT NULL
                REFERENCES coord.tenants (tenant_id) ON DELETE CASCADE,
            -- the host epoch session row id; no FK (7-day session prune)
            session_id              UUID         NOT NULL,
            -- copied at write time so the record stays readable after the prune
            claude_code_session_id  UUID         NULL,
            -- from the writer token
            writer_device_id        UUID         NOT NULL,
            -- coord-minted, never caller-supplied
            decision_seq            BIGINT       NOT NULL,
            journal_id              TEXT         NOT NULL,
            event_kind              TEXT         NOT NULL DEFAULT 'lifecycle',
            phase                   TEXT         NOT NULL,
            action                  TEXT         NULL,
            rule                    TEXT         NULL,
            reasons                 JSONB        NOT NULL DEFAULT '[]',
            guards                  JSONB        NOT NULL DEFAULT '[]',
            unknowns                JSONB        NOT NULL DEFAULT '[]',
            owed_kinds              TEXT[]       NOT NULL DEFAULT '{}',
            caps                    TEXT[]       NOT NULL DEFAULT '{}',
            inputs_digest           TEXT         NOT NULL,
            fn_version              TEXT         NOT NULL,
            build_sha               TEXT         NULL,
            evaluated_at            TIMESTAMPTZ  NOT NULL,
            received_at             TIMESTAMPTZ  NOT NULL DEFAULT now(),
            CONSTRAINT uq_lifecycle_events_session_writer_seq
                UNIQUE (session_id, writer_device_id, decision_seq),
            CONSTRAINT uq_lifecycle_events_writer_journal
                UNIQUE (writer_device_id, journal_id)
        )
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_lifecycle_events_tenant_cc_session
            ON coord.lifecycle_events (tenant_id, claude_code_session_id, event_id DESC)
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_lifecycle_events_tenant_session
            ON coord.lifecycle_events (tenant_id, session_id, event_id DESC)
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_lifecycle_events_received_at
            ON coord.lifecycle_events (received_at)
        """
    )

    # ---- (1) coord.work_items ---------------------------------------------
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.work_items (
            item_id                       UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id                     UUID         NOT NULL
                REFERENCES coord.tenants (tenant_id) ON DELETE CASCADE,
            kind                          TEXT         NOT NULL
                CONSTRAINT work_items_kind_check CHECK (kind IN (
                    'ci_first_verdict', 'ci_red', 'pr_conflict', 'escalate_hit',
                    'pr_watch', 'wait_gate', 'question', 'custody',
                    'work_unit_scope', 'finding', 'resume'
                )),
            -- e.g. owner/repo#pr@head_sha
            subject                       TEXT         NOT NULL,
            repo                          TEXT         NULL,
            pr_number                     INTEGER      NULL,
            head_sha                      TEXT         NULL,
            first_seen_at                 TIMESTAMPTZ  NOT NULL,
            state                         TEXT         NOT NULL
                CONSTRAINT work_items_state_check CHECK (state IN (
                    'open', 'watched', 'pending', 'impeded', 'done',
                    'deferred', 'surfaced', 'unknown'
                )),
            state_detail                  JSONB        NOT NULL DEFAULT '{}',
            owner_kind                    TEXT         NULL
                CONSTRAINT work_items_owner_kind_check CHECK (owner_kind IN (
                    'author_session', 'resumed_author', 'fixer', 'main_fix',
                    'infra', 'ledger', 'operator'
                )),
            -- no FK to coord.sessions: an owner row is pruned 7 days after close
            owner_session_id              UUID         NULL,
            owner_claude_code_session_id  UUID         NULL,
            owner_device_id               UUID         NULL,
            attribution                   TEXT         NOT NULL DEFAULT 'unattributed'
                CONSTRAINT work_items_attribution_check
                CHECK (attribution IN ('attributed', 'unattributed')),
            corroboration                 JSONB        NULL,
            red_class                     TEXT         NULL,
            route                         TEXT         NULL,
            deadline_at                   TIMESTAMPTZ  NULL,
            handoff_gate_id               UUID         NULL,
            created_at                    TIMESTAMPTZ  NOT NULL DEFAULT now(),
            updated_at                    TIMESTAMPTZ  NOT NULL DEFAULT now(),
            CONSTRAINT uq_work_items_tenant_kind_subject
                UNIQUE (tenant_id, kind, subject)
        )
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_work_items_open_owner_cc_session
            ON coord.work_items (tenant_id, owner_claude_code_session_id)
            WHERE state NOT IN ('done', 'deferred', 'surfaced')
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_work_items_owner_device_state
            ON coord.work_items (owner_device_id, state)
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_work_items_tenant_repo_pr
            ON coord.work_items (tenant_id, repo, pr_number)
        """
    )

    # ---- (1) coord.work_item_events ---------------------------------------
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.work_item_events (
            -- the gap-detection sequence C7 reads
            coord_seq    BIGINT       GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
            tenant_id    UUID         NOT NULL,
            item_id      UUID         NOT NULL
                REFERENCES coord.work_items (item_id) ON DELETE CASCADE,
            event_kind   TEXT         NOT NULL,
            from_state   TEXT         NULL,
            to_state     TEXT         NULL,
            owner_kind   TEXT         NULL,
            route        TEXT         NULL,
            red_class    TEXT         NULL,
            actor        TEXT         NOT NULL,
            detail       JSONB        NOT NULL DEFAULT '{}',
            occurred_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
        )
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_work_item_events_tenant_occurred
            ON coord.work_item_events (tenant_id, occurred_at)
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_work_item_events_item_seq
            ON coord.work_item_events (item_id, coord_seq)
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_work_item_events_occurred_at
            ON coord.work_item_events (occurred_at)
        """
    )

    # ---- (1) coord.work_ledger_arming -------------------------------------
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.work_ledger_arming (
            transition_id    BIGINT       GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
            tenant_id        UUID         NOT NULL
                REFERENCES coord.tenants (tenant_id) ON DELETE CASCADE,
            mode             TEXT         NOT NULL
                CONSTRAINT work_ledger_arming_mode_check
                CHECK (mode IN ('shadow', 'live')),
            transitioned_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
            reason           TEXT         NOT NULL,
            evidence         JSONB        NOT NULL DEFAULT '{}'
        )
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_work_ledger_arming_tenant_transition
            ON coord.work_ledger_arming (tenant_id, transition_id DESC)
        """
    )

    # ---- (1b) coord.lifecycle_close_latches -------------------------------
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.lifecycle_close_latches (
            latch_id        UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id       UUID         NOT NULL
                REFERENCES coord.tenants (tenant_id) ON DELETE CASCADE,
            -- the tripping lifecycle_events.event_id; no FK, the latch
            -- outlives the 90-day events
            false_close_id  BIGINT       NOT NULL,
            fn_version      TEXT         NOT NULL,
            -- NULL = no clearing fixture yet
            fixture_id      TEXT         NULL,
            tripped_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
            CONSTRAINT uq_lifecycle_close_latches_tenant_false_close
                UNIQUE (tenant_id, false_close_id)
        )
        """
    )

    # ---- (1b) coord.session_message_leases --------------------------------
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.session_message_leases (
            lease_id     UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id    UUID         NOT NULL,
            session_id   UUID         NOT NULL,
            message_id   UUID         NULL
                REFERENCES coord.session_messages (message_id) ON DELETE CASCADE,
            holder       TEXT         NOT NULL,
            scope        TEXT         NOT NULL
                CONSTRAINT session_message_leases_scope_check
                CHECK (scope IN ('message', 'session')),
            acquired_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
            expires_at   TIMESTAMPTZ  NOT NULL,
            -- a message lease names its message; a session lease names none
            CONSTRAINT session_message_leases_scope_message_check
                CHECK ((scope = 'message') = (message_id IS NOT NULL))
        )
        """
    )
    # The two renewal arbiters: one lease per (message, holder) and one per
    # (tenant, session, holder), each within its scope.
    op.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS uq_session_message_leases_message_holder
            ON coord.session_message_leases (message_id, holder)
            WHERE scope = 'message'
        """
    )
    op.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS uq_session_message_leases_session_holder
            ON coord.session_message_leases (tenant_id, session_id, holder)
            WHERE scope = 'session'
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_session_message_leases_message_expires
            ON coord.session_message_leases (message_id, expires_at)
            WHERE scope = 'message'
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_session_message_leases_session_expires
            ON coord.session_message_leases (session_id, expires_at)
            WHERE scope = 'session'
        """
    )
    # The ON DELETE CASCADE from coord.session_messages looks leases up by
    # message_id alone; the partial scope = 'message' indexes cannot serve it.
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_session_message_leases_message_id
            ON coord.session_message_leases (message_id)
        """
    )

    # ---- (1b) coord.session_messages.delivered_evidence + its CHECK -------
    op.execute(
        """
        ALTER TABLE coord.session_messages
            ADD COLUMN IF NOT EXISTS delivered_evidence TEXT NULL
        """
    )
    # NOT VALID: the column is new, so every existing row is NULL and passes;
    # new writes are checked either way. ADD CONSTRAINT has no IF NOT EXISTS
    # and a failed index build below leaves this committed, so the catalog is
    # asked first, from Python rather than a dollar-quoted DO block.
    if not _constraint_exists(
        "session_messages", "session_messages_delivered_evidence_check"
    ):
        op.execute(
            """
            ALTER TABLE coord.session_messages
                ADD CONSTRAINT session_messages_delivered_evidence_check
                CHECK (delivered_evidence IN ('pty_inject', 'transcript'))
                NOT VALID
            """
        )

    # ---- (1b) coord.session_census_device.complete ------------------------
    op.execute(
        """
        ALTER TABLE coord.session_census_device
            ADD COLUMN IF NOT EXISTS complete BOOLEAN NOT NULL DEFAULT false
        """
    )

    # ---- (2) agent-question contract columns, trailing and in this order --
    op.execute(
        """
        ALTER TABLE coord.agent_questions
            ADD COLUMN IF NOT EXISTS basis                 JSONB,
            ADD COLUMN IF NOT EXISTS documents_read        JSONB,
            ADD COLUMN IF NOT EXISTS dedupe_key            TEXT,
            ADD COLUMN IF NOT EXISTS clear_predicate       JSONB,
            ADD COLUMN IF NOT EXISTS why_none_decides      TEXT,
            ADD COLUMN IF NOT EXISTS policy_gap_finding_id UUID
        """
    )

    # ---- (1) coord.sessions.pane_id — LAST, so the ACCESS EXCLUSIVE lock on
    # the shared coord.sessions is taken last and held for the shortest time.
    # Its index is built CONCURRENTLY below.
    op.execute(
        """
        ALTER TABLE coord.sessions
            ADD COLUMN IF NOT EXISTS pane_id TEXT NULL
        """
    )
    # No RESET: the autocommit_block commit below ends the SET LOCAL, and
    # env.py's on_version_apply hook resets lock_timeout after every revision.

    with op.get_context().autocommit_block():
        # A failed earlier CONCURRENTLY build leaves an INVALID index that
        # IF NOT EXISTS would keep. Drop it so the CREATE below rebuilds it.
        if _index_is_invalid("uq_sessions_active_pane"):
            op.execute(
                "DROP INDEX CONCURRENTLY IF EXISTS coord.uq_sessions_active_pane"
            )
        # Phase 28's dedupe key: every OPEN row (stale included) holds its pane.
        op.execute(
            """
            CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_sessions_active_pane
            ON coord.sessions (tenant_id, device_id, pane_id)
            WHERE pane_id IS NOT NULL AND state <> 'closed'
            """
        )

        if _index_is_invalid("uq_agent_questions_open_dedupe"):
            op.execute(
                "DROP INDEX CONCURRENTLY IF EXISTS coord.uq_agent_questions_open_dedupe"
            )
        # C8's dedupe: the three-conjunct shape, so a withdrawn question frees
        # its key.
        op.execute(
            """
            CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_agent_questions_open_dedupe
            ON coord.agent_questions (tenant_id, dedupe_key)
            WHERE dedupe_key IS NOT NULL AND responded_at IS NULL
                AND withdrawn_at IS NULL
            """
        )

        if _index_is_invalid("idx_agent_questions_open_typed"):
            op.execute(
                "DROP INDEX CONCURRENTLY IF EXISTS coord.idx_agent_questions_open_typed"
            )
        # Phase 42's server-side basis=typed pending filter.
        op.execute(
            """
            CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_agent_questions_open_typed
            ON coord.agent_questions (tenant_id, created_at DESC)
            WHERE basis IS NOT NULL AND responded_at IS NULL
                AND withdrawn_at IS NULL
            """
        )


def downgrade() -> None:
    """Drop the three concurrent indexes, then the columns, then the tables."""
    with op.get_context().autocommit_block():
        op.execute(
            "DROP INDEX CONCURRENTLY IF EXISTS coord.idx_agent_questions_open_typed"
        )
        op.execute(
            "DROP INDEX CONCURRENTLY IF EXISTS coord.uq_agent_questions_open_dedupe"
        )
        op.execute("DROP INDEX CONCURRENTLY IF EXISTS coord.uq_sessions_active_pane")

    op.execute("SET LOCAL lock_timeout = '3s'")
    op.execute("DROP INDEX IF EXISTS coord.ix_session_message_leases_message_id")
    op.execute(
        """
        ALTER TABLE coord.agent_questions
            DROP COLUMN IF EXISTS policy_gap_finding_id,
            DROP COLUMN IF EXISTS why_none_decides,
            DROP COLUMN IF EXISTS clear_predicate,
            DROP COLUMN IF EXISTS dedupe_key,
            DROP COLUMN IF EXISTS documents_read,
            DROP COLUMN IF EXISTS basis
        """
    )
    op.execute(
        """
        ALTER TABLE coord.session_census_device
            DROP COLUMN IF EXISTS complete
        """
    )
    op.execute(
        """
        ALTER TABLE coord.session_messages
            DROP CONSTRAINT IF EXISTS session_messages_delivered_evidence_check,
            DROP COLUMN IF EXISTS delivered_evidence
        """
    )
    op.execute(
        """
        ALTER TABLE coord.sessions
            DROP COLUMN IF EXISTS pane_id
        """
    )
    # Dependency order: events before items; leases (which reference
    # coord.session_messages) are independent of every other new table.
    op.execute("DROP TABLE IF EXISTS coord.work_item_events")
    op.execute("DROP TABLE IF EXISTS coord.work_items")
    op.execute("DROP TABLE IF EXISTS coord.lifecycle_events")
    op.execute("DROP TABLE IF EXISTS coord.work_ledger_arming")
    op.execute("DROP TABLE IF EXISTS coord.lifecycle_close_latches")
    op.execute("DROP TABLE IF EXISTS coord.session_message_leases")
