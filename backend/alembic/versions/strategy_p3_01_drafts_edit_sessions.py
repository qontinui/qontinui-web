"""strategy editing substrate — Phase 3.1

Revision ID: strategy_p3_01_drafts_edit_sessions
Revises: ptbe_01_primary_tree_branch_events
Create Date: 2026-09-10

Phase 3.1 of the Strategy Collaboration plan
(``plans/2026-09-10-strategy-phase-3.md`` §3.1; source design
``plans/2026-05-15-strategy-collaboration-design.md`` §7 Phase 3). Adds the
two tables that make the strategy surface writable, on top of Phase 1's
read-only documents (``strategy.spaces`` + ``strategy.documents``) and
Phase 2's collaboration tables (``threads`` / ``posts`` / ``mentions``):

- ``strategy.drafts``        — an unpublished body for a document
- ``strategy.edit_sessions`` — a TTL'd advisory "who is editing what"

Nothing reads these yet. 3.1 is deliberately the smallest landable unit, the
same shape as Phase 2.1 (``strategy_p2_01_collab_tables``), so the substrate
lands before the coord API (3.2) and the editor UI (3.3) that need it.

PK naming follows the Phase 1/2 convention (``space_id`` / ``doc_id`` /
``thread_id`` → ``draft_id`` / ``edit_session_id``), NOT a generic ``id``.
FK targets are verified live on ``origin/main``:

- ``strategy.documents(doc_id)`` — Phase 1 PK (``strategy_p1_01_schema.py``)
- ``auth.users(id)``             — precedent ``strategy.documents.last_edited_by``

ON DELETE semantics:

- ``drafts.doc_id``              → ``CASCADE``  (doc gone → its drafts gone)
- ``drafts.author_id``           → ``SET NULL`` (preserve the body on user delete)
- ``edit_sessions.doc_id``       → ``CASCADE``
- ``edit_sessions.draft_id``     → ``CASCADE``  (draft gone → its edit session gone)
- ``edit_sessions.user_id``      → ``CASCADE``  (a session IS the user's; nothing
                                                 survives them worth keeping)

**``author_id`` is NULLABLE, and that is a deliberate divergence from Phase 2.**
``strategy_p2_01_collab_tables`` declares ``threads.created_by`` and
``posts.author_id`` as ``nullable=False`` *with* ``ondelete="SET NULL"``. Those
two disagree: deleting an ``auth.users`` row raises a NOT NULL violation instead
of nulling the column, so the SET NULL is unreachable. Copying the shape here
would propagate that. A draft body must outlive its author (it is the pending
content of a shared document), so ``SET NULL`` is the intent and the column is
nullable to match. The Phase 2 pair is a separate defect with its own fix — an
ALTER in a later revision — and is NOT touched here.

``base_commit_sha`` is the ``documents.head_commit_sha`` the draft was forked
from. It is what makes a stale draft *detectable* at publish time (3.4 refuses a
publish whose base is behind the doc's head) and is the merge base the
three-way conflict view (3.5) resolves against. It is NOT nullable: a draft with
no base cannot be safely published, and permitting one would defer the failure
to publish time.

``status`` is CHECK-constrained rather than a PG enum. The strategy schema uses
no enums today, and a CHECK is alterable in one statement where an enum needs a
type migration — the parent design expects this vocabulary to grow (a review
state is already anticipated for 3.2).

``published_at`` is CHECK-tied to ``status``: a row is published exactly when
it carries a publish timestamp. Without that tie the state machine lives only in
3.4's code, where a partial write leaves a row that reads ``published`` with no
commit behind it — the shape a reader cannot distinguish from a bug in git.

``edit_sessions`` references ``drafts`` by the COMPOSITE key ``(draft_id,
doc_id)``, not by ``draft_id`` alone. A single-column FK lets a row claim
``doc_id = A`` while its draft belongs to document B, and 3.2's "who is editing
this doc" query joins on ``doc_id`` — so it would surface a session attached to a
foreign draft, with no constraint anywhere to catch it. The composite target
needs ``uq_drafts_draft_doc`` on ``drafts``: redundant against the PK for
uniqueness, required as an FK target. MATCH SIMPLE (the default) means the FK is
not enforced while ``draft_id`` is NULL, which is exactly the "session precedes
its draft" case this column is nullable for.

``updated_at`` is maintained by a TRIGGER, not left to the application. Both
draft indexes order by ``updated_at DESC``, so an unmaintained column would make
"newest first" silently mean "created first" — a wrong answer that looks like a
right one. Phase 2 sidestepped this by ordering on ``created_at``; here the sort
key is genuinely mutable, so the column needs an author. The trigger function is
schema-local (``strategy.set_updated_at``) and the downgrade drops it
explicitly — ``DROP TABLE`` takes a table's triggers but never the function
behind them.

Indexes are chosen for the read paths 3.2 will actually issue, AND for the three
FK cascade paths. PostgreSQL does not index the referencing side of a foreign key
automatically and cannot use a PARTIAL index to enforce one, so a cascade with
only a partial index behind it seq-scans:

- ``idx_strategy_drafts_doc_open``: partial — list the OPEN drafts on a doc,
  which is the only listing the editor entry point makes. Published and
  abandoned drafts are history and are read by id. Being partial, it does NOT
  support the cascade from ``strategy.documents``, which is why the next one
  exists.
- ``idx_strategy_drafts_doc_id``: unconditional, purely for that cascade.
- ``idx_strategy_drafts_author``: per-author drafts, newest first (the
  "my drafts" surface), and ``author_id`` leads it so the ``auth.users`` SET NULL
  path uses it too.
- ``idx_strategy_edit_sessions_doc``: who is editing this doc. Liveness is a
  query-time ``expires_at > now()`` compare and deliberately NOT in the index
  predicate — ``now()`` is not IMMUTABLE, so PostgreSQL refuses it in a partial
  index, and a partial index on a frozen timestamp would be worse than none.
- ``idx_strategy_edit_sessions_draft``: ``(draft_id, doc_id)`` — the composite
  FK's cascade path.
- ``idx_strategy_edit_sessions_user``: the ``auth.users`` cascade path.
  ``uq_edit_sessions_doc_user`` does not serve it — ``user_id`` is not its
  leading column.
- ``uq_edit_sessions_doc_user``: at most one session row per (doc, user).

  **It is UNCONDITIONAL, and that is a contract on 3.2 rather than a bug.** The
  "live" qualifier cannot be pushed into a partial predicate for the same
  ``now()``-is-not-IMMUTABLE reason as above, and nothing reaps expired rows —
  ``expires_at`` is data precisely so a dead sweep cannot wedge a document. So
  once a user has ever held a session on a doc, that row persists and a plain
  ``INSERT`` for the pair fails forever. **3.2 must UPSERT** (``ON CONFLICT ON
  CONSTRAINT uq_edit_sessions_doc_user DO UPDATE`` setting ``heartbeat_at`` /
  ``expires_at``), never insert. Written here because it is load-bearing for the
  next sub-phase and invisible from the DDL alone.

``CREATE SCHEMA IF NOT EXISTS strategy`` is intentionally omitted — Phase 1's
``strategy_p1_01_schema`` creates it and this revision runs after.

The ``.pre-commit-hooks/check_alembic_schema_args.py`` ALLOWED_SCHEMAS list
already contains ``strategy`` (added by Phase 1).
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "strategy_p3_01_drafts_edit_sessions"
down_revision: str = "ptbe_01_primary_tree_branch_events"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


DRAFT_STATUSES = ("open", "published", "abandoned")


def upgrade() -> None:
    # ------------------------------------------------------------------
    # strategy.drafts — an unpublished body for a document, forked from a
    # known commit so staleness is detectable before publish rather than
    # after.
    # ------------------------------------------------------------------
    op.create_table(
        "drafts",
        sa.Column(
            "draft_id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "doc_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("strategy.documents.doc_id", ondelete="CASCADE"),
            nullable=False,
        ),
        # Nullable so the SET NULL above is reachable — see the module
        # docstring on the Phase 2 divergence.
        sa.Column(
            "author_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("auth.users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("base_commit_sha", sa.Text(), nullable=False),
        # Optional title override. NULL = inherit strategy.documents.title.
        sa.Column("title", sa.Text(), nullable=True),
        sa.Column(
            "status",
            sa.Text(),
            nullable=False,
            server_default=sa.text("'open'"),
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        # Maintained by trg_strategy_drafts_updated_at below, NOT by the
        # application — both draft indexes sort on it.
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("published_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("published_commit_sha", sa.Text(), nullable=True),
        sa.CheckConstraint(
            "status IN ('open', 'published', 'abandoned')",
            name="ck_strategy_drafts_status",
        ),
        # Published iff there is a publish timestamp. Keeps 3.4's state
        # machine in the database rather than only in its code path.
        sa.CheckConstraint(
            "(status = 'published') = (published_at IS NOT NULL)",
            name="ck_strategy_drafts_published_at",
        ),
        # Redundant against the PK for uniqueness; required as the target of
        # edit_sessions' composite FK.
        sa.UniqueConstraint("draft_id", "doc_id", name="uq_drafts_draft_doc"),
        schema="strategy",
    )
    op.create_index(
        "idx_strategy_drafts_doc_open",
        "drafts",
        ["doc_id", sa.text("updated_at DESC")],
        schema="strategy",
        postgresql_where=sa.text("status = 'open'"),
    )
    # Unconditional: the partial index above cannot serve the CASCADE from
    # strategy.documents.
    op.create_index(
        "idx_strategy_drafts_doc_id",
        "drafts",
        ["doc_id"],
        schema="strategy",
    )
    op.create_index(
        "idx_strategy_drafts_author",
        "drafts",
        ["author_id", sa.text("updated_at DESC")],
        schema="strategy",
    )

    # updated_at's author. A BEFORE UPDATE trigger rather than an ORM
    # onupdate: the writers here are coord (Rust, no SQLAlchemy) as well as
    # the web backend, so a Python-side default would be maintained by one
    # of the two writers and not the other.
    op.execute(
        """
        CREATE FUNCTION strategy.set_updated_at() RETURNS trigger AS $$
        BEGIN
            NEW.updated_at = now();
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql
        """
    )
    op.execute(
        """
        CREATE TRIGGER trg_strategy_drafts_updated_at
        BEFORE UPDATE ON strategy.drafts
        FOR EACH ROW EXECUTE FUNCTION strategy.set_updated_at()
        """
    )

    # ------------------------------------------------------------------
    # strategy.edit_sessions — advisory, TTL'd. Never a hard lock: a stale
    # session must not be able to wedge a document, so expiry is data
    # (expires_at) rather than a background process's promise.
    # ------------------------------------------------------------------
    op.create_table(
        "edit_sessions",
        sa.Column(
            "edit_session_id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "doc_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("strategy.documents.doc_id", ondelete="CASCADE"),
            nullable=False,
        ),
        # NULL while a session precedes its draft: the editor acquires the
        # session on entry and creates the draft on first keystroke. MATCH
        # SIMPLE leaves the composite FK below unenforced while it is NULL,
        # which is exactly that case.
        sa.Column(
            "draft_id",
            postgresql.UUID(as_uuid=True),
            nullable=True,
        ),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("auth.users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "started_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "heartbeat_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "expires_at",
            sa.DateTime(timezone=True),
            nullable=False,
        ),
        # Composite, so a session cannot claim one document while pointing at
        # another document's draft.
        sa.ForeignKeyConstraint(
            ["draft_id", "doc_id"],
            ["strategy.drafts.draft_id", "strategy.drafts.doc_id"],
            name="fk_edit_sessions_draft",
            ondelete="CASCADE",
        ),
        sa.UniqueConstraint("doc_id", "user_id", name="uq_edit_sessions_doc_user"),
        schema="strategy",
    )
    op.create_index(
        "idx_strategy_edit_sessions_doc",
        "edit_sessions",
        ["doc_id", sa.text("expires_at DESC")],
        schema="strategy",
    )
    # The composite FK's cascade path.
    op.create_index(
        "idx_strategy_edit_sessions_draft",
        "edit_sessions",
        ["draft_id", "doc_id"],
        schema="strategy",
    )
    # The auth.users cascade path — uq_edit_sessions_doc_user does not serve
    # it, user_id is not its leading column.
    op.create_index(
        "idx_strategy_edit_sessions_user",
        "edit_sessions",
        ["user_id"],
        schema="strategy",
    )


def downgrade() -> None:
    # edit_sessions first: it FKs drafts, so dropping drafts first would
    # need a CASCADE that would also take the FK's own table with it.
    op.drop_table("edit_sessions", schema="strategy")
    op.drop_table("drafts", schema="strategy")
    # DROP TABLE takes the trigger but NOT the function behind it, so a
    # downgrade that stopped above would leave strategy.set_updated_at
    # orphaned and the next upgrade would fail on CREATE FUNCTION.
    op.execute("DROP FUNCTION IF EXISTS strategy.set_updated_at()")
    # Leave the `strategy` schema in place — Phase 1 owns it, and dropping
    # it here would cascade spaces/documents/threads/posts/mentions.
