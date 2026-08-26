"""agent.session_artifacts — the Claude Code Session Repository head row

Revision ID: session_repo_01_session_artifacts
Revises: projdash_01_stf_prefix_idx
Create Date: 2026-08-26

Phase 3a of ``2026-08-26-claude-code-session-repository-in-qontinui-web``:
give qontinui-web a PERMANENT, tenant-visible home for the Claude Code
sessions coord only keeps operationally.

Why this table exists at all
============================

coord is the live coordination substrate and is sized for it: a leader-gated
task deletes ``coord.sessions`` rows 7 days after close, and
``coord.session_output`` / ``coord.session_events`` cascade with them; the S3
cold object carries a 90-day lifecycle rule. So today the maximum life of a
finished session's transcript is 90 days and of its metadata 7 days — after
which *the record that the session ever existed* is gone. A repository whose
purpose is "find the work I never finished" cannot live behind a 7-day
horizon, so the archive goes on the web side of the seam, exactly as the plan
library did.

One table, in the **web-owned** ``agent`` schema (created by
``consolidation_phase1_01_infrastructure``; the ``CREATE SCHEMA IF NOT
EXISTS`` below is defensive only). Its shape is copied deliberately from
``agent.work_artifacts`` (``plan_library_01_work_artifacts``) so the identity,
search and soft-link idioms are already proven.

Design notes
============

* **Identity is a FUNCTIONAL unique index** over ``(claude_session_id,
  coalesce(account_label, ''))``. ``account_label`` is nullable and in
  PostgreSQL ``NULL <> NULL``, so a plain UNIQUE over the raw column would
  admit unlimited duplicates for exactly the rows a scan of an unlabelled
  account home produces. The session id alone is NOT the key: a Claude Code
  session id is unique per account home, not globally, and a resume rotation
  can hand two account homes the same id.

  **``organization_id`` is NOT in the key**, and that is the one place this
  table deliberately departs from ``agent.work_artifacts``, which does key on
  it. Plans are per-organization; sessions are not, and this row has two
  legitimate writers that disagree about the value: the runner POSTs
  authenticated (so it has one) while the web archiver is a scheduled job with
  no calling principal (so it can only write NULL). Keying on it made those two
  writers fork one real session into two rows that no later cycle could
  reconcile. The organization stays on the row as the read-scoping axis; it is
  not part of what makes a row unique.

* **Bodies are NOT a column.** ``agent.work_artifacts.body`` is TEXT because
  plans are kilobytes; this corpus is 8,238 transcripts / ~3.5 GB with a 4 MB
  p99. Only ``body_object_key`` (a key into ``app/services/storage/``),
  ``content_sha256``, ``byte_count`` live here.

* **``body_source`` is what keeps ``content_sha256`` honest.** Two ingest
  paths exist and they do NOT produce the same bytes for the same session.
  The runner reads the JSONL off disk and uploads it verbatim
  (``disk_verbatim``) — that digest verifies against the original file. The
  web archiver's fallback, for a machine that is gone and never uploaded,
  reads coord's transcript stream, whose contents passed through
  ``redact_secrets`` unconditionally on the way in; a digest over redacted
  bytes can never be verified against the original, so such a row is stamped
  ``coord_redacted`` and the API must never present it as verified. The CHECK
  is NULL-tolerant because a metadata-only head row has no body at all and
  must not be forced to claim a source.

* **``tenant_source`` records HOW the tenancy was established**, not just the
  value. The transcript carries no tenant — Claude Code's JSONL has ``cwd``,
  ``gitBranch`` and ``sessionId`` and has never heard of tenants — so
  attribution is always external, and for historical sessions every source is
  degraded. An interactive pane's coord row holds a tenant coord *derived by
  sole-binding*, because ``register_sniffed_session`` omits ``tenant_id`` on
  purpose; only an explicit spawn input earns ``declared``. A guessed tenant
  that renders identically to a declared one is the defect this column
  prevents. NOT NULL with an ``'unknown'`` default so no row can be silent
  about it.

* **``coord_session_id`` / ``work_unit_slug`` / ``task_run_id`` / ``device_id``
  carry NO foreign key** and are ALLOWED TO DANGLE. coord owns those rows, in
  its own schema in its own deployment, and it deletes them on the 7-day
  horizon described above — a cross-schema FK would both re-couple what the
  web↔coord schema-boundary decoupling separated and make the archive
  cascade-delete itself. Readers join them as nullable and never 404.

* **``closeout_state`` is DERIVED and RECOMPUTABLE**, never hand-set: it is
  reduced from ``coord.session_compliance``, the ``/unattended`` taxonomy, and
  open gates/PRs attributable to the session. It defaults to ``'unknown'``
  rather than ``'clean'`` — a session nobody has evaluated has not been *shown*
  to be closed out, and the other default would report unfinished work as
  finished.

* **``secret_finding_*`` is an audit signal, not a gate and not a mask.**
  Bodies are archived verbatim: measured over a 41 MB sample of this corpus
  the shipped line-oriented redactor produced 207 matches of which 118 (57%)
  were false positives (``token: String,``, ``TOKEN: ***``, "bearer
  fallback"), while missing JWT/``AKIA``/PEM/connection-string shapes
  entirely. Masking would corrupt the corpus this store exists to make
  searchable without delivering the safety property. ``secret_finding_kinds``
  is nullable and the NULL is meaningful: NULL = never scanned, ``'{}'`` =
  scanned clean.

* **Search** is a GIN index over ``to_tsvector('english', …)`` with the
  expression spelled ONCE (``_SEARCH_TSVECTOR_SQL`` below, byte-identical to
  ``app.models.session_artifact.SESSION_SEARCH_TSVECTOR_SQL``) so the ``?q=``
  predicate matches the index expression verbatim and the index is actually
  usable. The regconfig is explicit because the one-argument
  ``to_tsvector(text)`` reads ``default_text_search_config``, is only STABLE,
  and cannot be indexed.

Idempotency: every statement uses ``IF NOT EXISTS`` / ``IF EXISTS``, so a
partially-applied run re-runs cleanly and the downgrade → upgrade round-trip
is a no-op on a fresh database.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "session_repo_01_session_artifacts"
down_revision: str = "projdash_01_stf_prefix_idx"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# ⚠️ Byte-identical to ``SESSION_SEARCH_TSVECTOR_SQL`` in
# ``app/models/session_artifact.py``, and guarded by
# ``tests/test_session_artifacts_model.py``. The index expression and the
# ``?q=`` predicate must be the SAME string or the planner will not use this
# index and the search silently degrades to a sequential scan.
_SEARCH_TSVECTOR_SQL = (
    "to_tsvector('english', "
    "coalesce(ai_title, '') || ' ' || "
    "coalesce(session_name, '') || ' ' || "
    "coalesce(first_prompt, '') || ' ' || "
    "coalesce(last_prompt, ''))"
)

_TABLE = "agent.session_artifacts"

_INDEXES = (
    "uq_session_artifacts_identity",
    "ix_session_artifacts_tenant_id",
    "ix_session_artifacts_state",
    "ix_session_artifacts_closeout_state",
    "ix_session_artifacts_last_activity_at",
    "ix_session_artifacts_repo",
    "ix_session_artifacts_account_label",
    "ix_session_artifacts_search",
)


def upgrade() -> None:
    """Create the session-archive head-row table and its indexes."""
    # Defensive only — consolidation_phase1_01_infrastructure created it.
    op.execute("CREATE SCHEMA IF NOT EXISTS agent")

    op.execute(
        f"""
        CREATE TABLE IF NOT EXISTS {_TABLE} (
            id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),

            -- Ownership: the read-scoping axis, NOT part of identity ---
            organization_id      UUID,

            -- Identity ------------------------------------------------
            claude_session_id    TEXT NOT NULL,
            account_label        TEXT,

            -- Tenancy (recorded WITH its provenance) ------------------
            tenant_id            UUID,
            tenant_source        TEXT NOT NULL DEFAULT 'unknown'
                CONSTRAINT ck_session_artifacts_tenant_source CHECK (
                    tenant_source IN (
                        'declared',
                        'derived_repo',
                        'derived_sole_binding',
                        'ambiguous',
                        'unknown'
                    )
                ),
            device_id            UUID,
            machine_hostname     TEXT,

            -- Soft links into coord. NO FK by design; may dangle. -----
            coord_session_id     UUID,
            work_unit_slug       TEXT,
            task_run_id          TEXT,

            -- Provenance / relaunch -----------------------------------
            config_dir           TEXT,
            working_dir          TEXT,
            repo                 TEXT,
            git_branch           TEXT,
            provider             TEXT,
            launch_command       TEXT,
            restore_tier         TEXT,
            machine_id           TEXT,
            permission_mode      TEXT,

            -- Content (the bytes live in the object store) ------------
            body_object_key      TEXT,
            content_sha256       TEXT,
            byte_count           BIGINT,
            turn_count           INTEGER,
            first_prompt         TEXT,
            last_prompt          TEXT,
            ai_title             TEXT,
            session_name         TEXT,
            name_source          TEXT,
            -- NULL-tolerant: a metadata-only row has no body to source.
            body_source          TEXT
                CONSTRAINT ck_session_artifacts_body_source CHECK (
                    body_source IS NULL
                    OR body_source IN ('disk_verbatim', 'coord_redacted')
                ),

            -- Lifecycle -----------------------------------------------
            started_at           TIMESTAMPTZ,
            last_activity_at     TIMESTAMPTZ,
            ended_at             TIMESTAMPTZ,
            state                TEXT NOT NULL DEFAULT 'open'
                CONSTRAINT ck_session_artifacts_state CHECK (
                    state IN ('open', 'closed', 'abandoned')
                ),
            closeout_state       TEXT NOT NULL DEFAULT 'unknown'
                CONSTRAINT ck_session_artifacts_closeout_state CHECK (
                    closeout_state IN ('clean', 'unfinished', 'unknown')
                ),

            -- Exposure (audit signal, never a gate) -------------------
            secret_finding_count INTEGER NOT NULL DEFAULT 0,
            -- NULL = never scanned; '{{}}' = scanned clean.
            secret_finding_kinds TEXT[],

            created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """
    )

    # Identity. NULL-collapsing so the constraint bites on label-less rows
    # (see the docstring). This is the upsert conflict target — and note the
    # absence of ``organization_id``: it is the read-scoping axis, not part of
    # what makes a session row unique, because the web archiver never has one
    # to supply.
    op.execute(
        f"""
        CREATE UNIQUE INDEX IF NOT EXISTS uq_session_artifacts_identity
            ON {_TABLE} (
                claude_session_id,
                coalesce(account_label, '')
            )
        """
    )

    # Serves `?tenant=` and the owner-visible-only filtering of the
    # `ambiguous` / `unknown` attribution buckets.
    op.execute(
        f"""
        CREATE INDEX IF NOT EXISTS ix_session_artifacts_tenant_id
            ON {_TABLE} (tenant_id)
        """
    )

    op.execute(
        f"""
        CREATE INDEX IF NOT EXISTS ix_session_artifacts_state
            ON {_TABLE} (state)
        """
    )

    # Serves `GET /unfinished`.
    op.execute(
        f"""
        CREATE INDEX IF NOT EXISTS ix_session_artifacts_closeout_state
            ON {_TABLE} (closeout_state)
        """
    )

    # Serves `?since=` and the default recency ordering.
    op.execute(
        f"""
        CREATE INDEX IF NOT EXISTS ix_session_artifacts_last_activity_at
            ON {_TABLE} (last_activity_at)
        """
    )

    op.execute(
        f"""
        CREATE INDEX IF NOT EXISTS ix_session_artifacts_repo
            ON {_TABLE} (repo)
        """
    )

    op.execute(
        f"""
        CREATE INDEX IF NOT EXISTS ix_session_artifacts_account_label
            ON {_TABLE} (account_label)
        """
    )

    # Serves `?q=` — full-text over the titles and the first/last prompts.
    # The expression is the module constant, verbatim.
    op.execute(
        f"""
        CREATE INDEX IF NOT EXISTS ix_session_artifacts_search
            ON {_TABLE} USING GIN ({_SEARCH_TSVECTOR_SQL})
        """
    )


def downgrade() -> None:
    """Drop the store. Indexes first, explicitly, then the table."""
    for index_name in reversed(_INDEXES):
        op.execute(f"DROP INDEX IF EXISTS agent.{index_name}")
    op.execute(f"DROP TABLE IF EXISTS {_TABLE}")
