"""coord.agent_sessions account + name stamp — which Claude account a session ran on

Revision ID: coord_agent_sessions_identity_01
Revises: wuverif_02
Create Date: 2026-11-02

Phase 1 (qontinui-web half) of plan
``2026-10-19-session-lookup-by-name-shows-claude-account-in-web``
(design decisions "Resolved: C" and D2).

coord authors zero ``coord.*`` DDL (``[policy: alembic-sole-authorship]``), so
the columns coord's session-identity stamp writes land here, and this revision
must be APPLIED in production before the coord PR that reads or writes them
deploys. That coord side degrades on a missing column
(``pg_error::is_missing_column_error``): the stamp door answers
``503 session_identity_unavailable`` and the list read drops only these
columns, so a coord build that lands first fails open.

Why
===

The operator asked "what account was the session ``spaceship-latency`` on?"
and the answer was a hand grep on one box. ``coord.session_census`` carries an
``account`` column, but it is a per-device snapshot of LIVE processes (the
harness deletes ``<config_dir>/sessions/<pid>.json`` when the process exits),
so it cannot answer for an ended session. The durable identity row the
``/sessions`` console reads, ``coord.agent_sessions``, has no account at all,
and none of a session's human names (the Claude Code registry name, the fleet
tag name behind the ``Session-Name`` trailer) is stored on it.

The five columns
================

* ``account`` -- the census account label: the Claude config-dir basename
  minus ``.claude-``, ``default`` for the bare ``.claude`` home. NOT a roster
  id from ``accounts.json`` (the roster maps some bare homes to a named
  account; coord does not read the roster).
* ``config_dir`` -- the account root (the Claude config dir) that holds the
  session's NEWEST turn. A migrated session (its transcript copied to another
  account and resumed under the same id) is stamped with the root ``--resume``
  must use.
* ``account_observed_at`` -- when that newest turn happened (the runner's
  ``last_acted_at``, else the post's ``observed_at``). It is the stamp's
  newest-observation-wins predicate: an older root reported later never
  overwrites a newer one, and a reader shows it beside the account so the
  fact's age is visible.
* ``registry_name`` -- the Claude Code registry ``name`` from a LIVE registry
  row whose ``nameSource`` is not ``derived``.
* ``tag_name`` -- the fleet tag name from ``~/.qontinui/session-names/<id>``,
  the ``Session-Name`` commit-trailer source.

The two name columns are separate on purpose (plan D2): they are different
sources that can disagree, and one last-write-wins column would flap between
them. Both are projected by coord into the existing ``search_text`` blob and
matched by the ``/coord/agent-sessions/<id>`` name resolver.

What writes and reads them
==========================

Written ONLY by coord's ``POST /coord/session-identity/<device_id>`` door
(``crates/coord/src/session_identity_stamp.rs``), fed by the runner's
session-identity reporter, which posts names and account labels for every
session id the box can still resolve -- never transcript content. The write
never touches ``last_seen`` / ``closed_at``, so stamping an ended session does
not make it read live.

Read by coord's ``GET /coord/agent-sessions`` list (both column arms) and the
``:id`` card, which the qontinui-web ``/sessions`` console's Account column
and session detail card render.

Semantics
=========

``NULL`` means no runner has reported the session -- every existing row, and
any session no runner on any box can resolve. The reader renders it UNKNOWN
with the reporting device named, never blank and never a default (served
policy ``verification-and-evidence`` ``unknown-must-not-render-as-a-default``).
So: no default and no backfill. A backfill here could only guess, and a
guessed account is worse than an UNKNOWN one.

No index
========

Deliberate (plan Phase 1, "No separate name index"): name search already runs
on the projected ``search_text`` blob through the existing GIN full-text
expression index (``coord_session_identity_01``), and a session-id search
matches the primary key. A second index on a table coord writes on every
session heartbeat would be pure write amplification.

Head choice
===========

``down_revision`` is the single head of ``origin/main`` at authoring time
(``scripts/ci/count_alembic_heads.py``: ``HEAD_COUNT=1``). Re-point rule: if
another alembic revision lands first, coord re-points ``down_revision`` at land
time; the companion test reads the parent from this file, so it moves with it.

Safety
======

All five columns are nullable with no default, so each ADD is catalogue-only
and rewrites no row. ``coord.agent_sessions`` is written on every session
heartbeat, so the ACCESS EXCLUSIVE wait is bounded with
``SET LOCAL lock_timeout = '3s'`` and restored afterwards -- env.py runs the
whole upgrade batch in one transaction, so an unrestored ``SET LOCAL`` would
impose the ceiling on every later revision (the
``coord_agent_sessions_context_01`` bracket). Every SQL string is a static
literal, so the revision renders unchanged in offline ``--sql`` mode, and no
comment body carries a ``:word`` sequence, which SQLAlchemy ``text()`` would
read as a bind parameter. Downgrade drops the five columns ``IF EXISTS``; the
data does not return.

``ADD COLUMN IF NOT EXISTS`` matches on NAME only; acceptable because no
earlier revision in this chain spells any of these five columns on this table.

Merge-train classifier disposition
==================================

The lock bracket makes ``upgrade()`` unclassifiable to coord's migration
classifier (``SET ...`` matches no branch of ``classify_sql_statement``), so an
``auto_if_provably_safe`` escalate policy covering this glob returns Blocked
rather than clearing. That is the known price of the guard, the same one
``coord_agent_sessions_context_01`` and ``coord_pr_state_observed_at_01``
document, not a defect.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coord_agent_sessions_identity_01"
down_revision: str | Sequence[str] | None = "wuverif_02"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add the five nullable account-stamp and name columns, with comments."""
    op.execute("SET LOCAL lock_timeout = '3s'")

    # IF NOT EXISTS matches on NAME only; acceptable because no revision in
    # this chain spells any of these columns on this table.
    op.execute(
        """
        ALTER TABLE coord.agent_sessions
            ADD COLUMN IF NOT EXISTS account TEXT,
            ADD COLUMN IF NOT EXISTS config_dir TEXT,
            ADD COLUMN IF NOT EXISTS account_observed_at TIMESTAMPTZ,
            ADD COLUMN IF NOT EXISTS registry_name TEXT,
            ADD COLUMN IF NOT EXISTS tag_name TEXT
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.agent_sessions.account IS
            'Claude account label the session ran on: the config-dir basename '
            'minus .claude-, default for the bare .claude home; not a roster id. '
            'Written only by the coord session-identity stamp door '
            'POST /coord/session-identity/<device_id> (session_identity_stamp.rs), '
            'fed by the runner session-identity reporter. Read by the coord '
            'agent-sessions list and card for the /sessions console Account column '
            '(plan 2026-10-19-session-lookup-by-name-shows-claude-account-in-web). '
            'NULL = no runner has reported this session; read as UNKNOWN, never as a default.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.agent_sessions.config_dir IS
            'Claude config dir (account root) holding the newest turn of the '
            'session; for a migrated session, the root a resume must use. '
            'Written only by the coord session-identity stamp door '
            'POST /coord/session-identity/<device_id> (session_identity_stamp.rs), '
            'fed by the runner session-identity reporter. Read by the coord '
            'agent-sessions list and card for the /sessions console '
            '(plan 2026-10-19-session-lookup-by-name-shows-claude-account-in-web). '
            'NULL = no runner has reported this session; read as UNKNOWN, never as a default.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.agent_sessions.account_observed_at IS
            'When the newest turn behind account and config_dir happened (the '
            'runner last_acted_at, else the post observed_at). The stamp is '
            'newest-observation-wins on this value, so an older root reported '
            'later never overwrites a newer one. '
            'Written only by the coord session-identity stamp door '
            'POST /coord/session-identity/<device_id> (session_identity_stamp.rs), '
            'fed by the runner session-identity reporter. Read by the coord '
            'agent-sessions list and card for the /sessions console '
            '(plan 2026-10-19-session-lookup-by-name-shows-claude-account-in-web). '
            'NULL = no runner has reported this session; read as UNKNOWN, never as a default.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.agent_sessions.registry_name IS
            'Claude Code registry name of the session, taken only from a live '
            'registry row whose nameSource is not derived. Projected into '
            'search_text and matched by the agent-sessions name resolver. '
            'Written only by the coord session-identity stamp door '
            'POST /coord/session-identity/<device_id> (session_identity_stamp.rs), '
            'fed by the runner session-identity reporter. Read by the coord '
            'agent-sessions list and card for the /sessions console '
            '(plan 2026-10-19-session-lookup-by-name-shows-claude-account-in-web). '
            'NULL = no runner has reported this session; read as UNKNOWN, never as a default.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.agent_sessions.tag_name IS
            'Fleet tag name of the session from ~/.qontinui/session-names/<id>, '
            'the Session-Name commit-trailer source. Projected into search_text '
            'and matched by the agent-sessions name resolver. '
            'Written only by the coord session-identity stamp door '
            'POST /coord/session-identity/<device_id> (session_identity_stamp.rs), '
            'fed by the runner session-identity reporter. Read by the coord '
            'agent-sessions list and card for the /sessions console '
            '(plan 2026-10-19-session-lookup-by-name-shows-claude-account-in-web). '
            'NULL = no runner has reported this session; read as UNKNOWN, never as a default.'
        """
    )

    # env.py runs the whole batch in one transaction, so leaving this set would
    # silently impose a 3 s ceiling on the next revision's DDL too.
    op.execute("SET LOCAL lock_timeout = DEFAULT")


def downgrade() -> None:
    """Drop the five columns (a catalogue inverse; the data does not return)."""
    op.execute("SET LOCAL lock_timeout = '3s'")

    op.execute(
        """
        ALTER TABLE coord.agent_sessions
            DROP COLUMN IF EXISTS tag_name,
            DROP COLUMN IF EXISTS registry_name,
            DROP COLUMN IF EXISTS account_observed_at,
            DROP COLUMN IF EXISTS config_dir,
            DROP COLUMN IF EXISTS account
        """
    )

    op.execute("SET LOCAL lock_timeout = DEFAULT")
