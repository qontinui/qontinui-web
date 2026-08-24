"""coord.session_policy_reads — record that a session actually read a policy document

Revision ID: coord_polread_01
Revises: coord_tenant_fk_01
Create Date: 2026-08-19

Phase 2 of plan
``D:/qontinui-root/qontinui-dev-notes/plans/2026-08-08-runner-enforced-policy-pull.md``.

coord authors **zero** DDL (``[policy: alembic-sole-authorship]``), so the table
lands here, in qontinui-web, and must merge BEFORE the coord PR that writes to
it. ``down_revision`` is set to this repo's LOCAL alembic head at authoring time
(``coord_tenant_fk_01``, the single head of the 495-revision chain); coord
re-points it at land time and ``alembic-graph-pr.yml`` enforces the single
chain — do NOT hand-order this with coord dependency labels.

The gap
=======

``policy/session-protocol`` Step 0 tells every session to pull the policy
documents fresh at turn one, because they version frequently and a stale read
has already produced a duplicate gap report. That instruction is entirely
**voluntary**, and nothing checks it.

The motivating incident: a session ran a full vet → implement → ship cycle,
merged two PRs, and never pulled the policy documents once. Nothing objected.
Every downstream miss descended from that one unenforced step, and the omission
was found only because the operator happened to ask.

The reason nothing objected is that coord records **nothing** when a policy
document is read. Verified absent as of 2026-08-19:

* ``mcp_metrics`` is a process-local in-memory counter that deliberately carries
  no caller identity in its labels, so it can say "``coord_get_prompt_document``
  was called 4000 times" and never "session S called it".
* The ``mcp_tool_call`` tracing lines carry ``device_id``/``tenant_id``/
  ``agent_id`` but omitted the session entirely (that gap is closed in the same
  coord PR, but a log line is not a queryable audit trail).
* ``coord.prompt_documents`` / ``coord.prompt_document_versions`` are written
  only on the edit and seed paths — reading a document leaves no trace at all.

So the question the whole plan turns on — *"did session S pull policy?"* — is
not merely unanswered, it is **unanswerable**. This table is the instrumentation
that makes it answerable, and Phase 3's compliance signal reads it.

What this migration does
========================

Creates ``coord.session_policy_reads``: one **append-only** row per observed
read of a prompt document, written best-effort off the read path.

Column contract
===============

The column set is a shared contract with the coord Rust code
(``crates/coord/src/prompt_documents.rs::record_policy_read``) — the names must
not drift from this list, same rule as ``coord_sesscompl_01``.

``read_id UUID PRIMARY KEY``
    Server-side ``gen_random_uuid()`` default. Nothing addresses a read row by
    identity — it exists so an append-only log has a stable primary key and so a
    duplicate insert is impossible to confuse with an update.

``tenant_id UUID NOT NULL``
    Every prompt document is addressed by ``(tenant_id, kind, name)`` and every
    read is tenant-scoped at the source (the tenant comes from the caller's
    verified JWT, never from an argument). A read that cannot name its tenant is
    not a read of anything, so this is NOT NULL — unlike the session column
    below, there is no honest "unknown tenant" state to represent.

    Deliberately **no FK to** ``coord.tenants``. This is an observation log on a
    hot read path: a best-effort insert must never fail because of referential
    bookkeeping, and the two existing observation tables in this schema family
    made the same call.

``claude_session_id UUID NULL``  ← **the important one**
    Which Claude session did the reading. **Nullable, and NULL is a first-class
    value meaning "coord could not PROVE which session this was".**

    Why it must be nullable, at length, because getting this wrong is the exact
    failure the vet of this plan caught:

    The session id arrives as the caller-supplied ``X-Coord-Caller-Session``
    header. ``provenance_session_from_headers`` parses a UUID out of it and does
    nothing else — no device binding, no lookup. The raw header value is
    therefore **spoofable**: any caller holding any valid JWT can name any
    session id it likes. Writing that raw value into this column would put an
    attacker-chosen (or, far more likely, simply wrong) id into a durable
    provenance column that the Phase 3 reconciler then reads as **fact**.

    So coord validates it fail-closed before persisting, via
    ``provenance_session_for_device`` → ``agent_sessions::session_on_device``:
    the header id counts only when coord can confirm that session is bound to
    the device the verified JWT names. Two cases survive that gate with no
    proven id, and BOTH write NULL here:

    1. the calling token has no ``device_id`` claim at all (a non-device token
       — there is nothing to bind the session to); and
    2. the header named a session that is not bound to the calling device
       (absent header, malformed header, or a real fail-closed rejection).

    The rejected alternative was a ``(device, tenant) → most-recent-session``
    bridge to fill those NULLs in. coord's own source rejects it in terms:
    *"it names the WRONG parent under concurrent sessions — this fleet's normal
    state"*. A confidently wrong attribution is strictly worse than an honest
    absence, because the honest absence is legible downstream and the wrong one
    is not.

    **Consumers must read NULL as ``Unavailable``, never as ``Absent``.** That
    distinction is already modelled in the compliance framework
    (``SignalResult::{Found,Absent,Unavailable,Error}``). "We cannot attribute
    this read" must never render as "this session did not read policy" — that
    would manufacture non-compliance verdicts out of a transport limitation, and
    it would do so for exactly the populations this plan most needs to see
    honestly.

``kind TEXT NOT NULL``
    The document kind read (``policy``, ``response_prompt``,
    ``continuation_rules``, ``agent_playbook``, ``prompt_template``). For a LIST
    read this carries the kind FILTER the caller supplied, or the literal
    ``'all'`` when the caller listed every kind — a list is a read of a
    *set*, and the set is what the filter names.

    Not CHECK-constrained against the kind vocabulary on purpose: ``'all'`` is
    not a document kind, the vocabulary lives in coord's ``KINDS`` constant and
    grows there (``prompt_template`` was added by a later migration), and a
    constraint here would turn a vocabulary extension into a schema migration
    that must land first. This is an observation log; it records what happened.

``name TEXT NOT NULL``
    The document name read. For a LIST read this is the literal ``'*'`` — the
    caller learned what exists without reading any single body. The sentinel is
    NOT a NULL: NULL in this table means "unknown/unprovable" (see
    ``claude_session_id``), and a list read's name is neither unknown nor
    unprovable, it is precisely and knowably "all of them".

``version INTEGER NULL``
    The document's ``current_version`` at read time — what Phase 3's
    version-awareness comparison needs. A read of a superseded version is weaker
    than no read at all, because the session acted on stale policy while
    believing it was current; that is only detectable if the version read is
    recorded next to the version now current.

    NULL for a LIST read, which returns summaries and no body: the caller
    learned the versions but consumed none of them, so stamping any single
    number here would be a fabrication.

``source TEXT NOT NULL``
    Which door the read came through. A closed vocabulary of exactly three,
    CHECK-constrained because unlike ``kind`` this one is coord's own and is not
    expected to grow without a schema change:

    * ``mcp`` — ``coord_list_prompt_documents`` / ``coord_get_prompt_document``,
      the MCP tool pair. The path that works when the MCP proxy is healthy.
    * ``http_door`` — ``GET /coord/agent-prompt-documents{,/{kind}/{name}}``,
      the device-authed HTTP read. ``session-protocol`` Step 0 names this as an
      EQUAL-AUTHORITY canonical read for a session whose MCP tools are masked,
      so a read here counts exactly as much as an ``mcp`` one.
    * ``session_start_injection`` — the runner's Phase 1 SessionStart hook
      fetching policy **on the session's behalf** and injecting it into the
      session's context. Physically the same HTTP door; semantically a different
      event, and it must count as the session having pulled policy, because
      under Phase 1 that is precisely what happened. The runner distinguishes it
      with an explicit ``?via=session_start_injection`` marker; coord maps only
      that exact literal and ignores anything else rather than storing arbitrary
      caller-supplied text in a CHECK-constrained column.

``read_at TIMESTAMPTZ NOT NULL DEFAULT now()``
    When. Defaulted server-side so a client clock can never skew the ordering
    the reconciler depends on.

Indexes
=======

* ``(tenant_id, claude_session_id)`` — the Phase 3 lookup: "what did session S
  read?". Tenant-first because every query is tenant-scoped.
* ``(tenant_id, read_at DESC)`` — the reconciler asks for the MOST RECENT read
  for a session, and it also sweeps a tenant's recent reads when reconciling a
  batch of sessions. A DESC index makes both a backwards-free scan.

Append-only
===========

Nothing updates or deletes a row here. There is no ``updated_at``, no upsert
key, and no unique constraint on ``(session, kind, name)``: reading the same
document twice is two events, and collapsing them would destroy the timeline
that makes "read v5, then v6 shipped, then acted" distinguishable from "read v6
after it shipped". Retention, if it ever matters, is a later prune migration —
the sibling ``coord_alerts_retention_01`` is the template.

Write posture (stated here so a reader of the schema knows what to expect)
=========================================================================

The insert is **best-effort and off the critical path**: a failure to record a
read must never fail the read itself, mirroring the fail-soft
``ensure_prompt_document_seeds`` arm that already sits in both MCP handlers. A
warn line and carry on. That also means this table can UNDER-count (coord down,
table absent during a deploy-ordering window, PG pool exhausted) but can never
over-count, which is the right direction for a signal whose false-positive
consequence is telling a compliant session it was non-compliant.
"""

from alembic import op

# revision identifiers, used by Alembic.
revision = "coord_polread_01"
down_revision = "cmpaxis_01_comparison_computed_axis"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Raw ``op.execute`` with IF NOT EXISTS throughout — the convention the
    # sibling coord observation tables use, and what keeps a re-run harmless.
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.session_policy_reads (
            read_id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id         UUID NOT NULL,
            claude_session_id UUID NULL,
            kind              TEXT NOT NULL,
            name              TEXT NOT NULL,
            version           INTEGER NULL,
            source            TEXT NOT NULL,
            read_at           TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """
    )
    # Named so the drop below can be idempotent, and so a violation names the
    # invariant rather than an autogenerated string. Dropped-then-added so a
    # re-run against a table created by an earlier form of this revision
    # converges on the current vocabulary.
    op.execute(
        """
        ALTER TABLE coord.session_policy_reads
            DROP CONSTRAINT IF EXISTS ck_session_policy_reads_source
        """
    )
    op.execute(
        """
        ALTER TABLE coord.session_policy_reads
            ADD CONSTRAINT ck_session_policy_reads_source
            CHECK (source IN ('mcp', 'session_start_injection', 'http_door'))
        """
    )
    # Phase 3's primary lookup: "what did session S read?" Tenant-first because
    # every query is tenant-scoped, and a NULL session id simply does not match
    # (which is correct — an unattributable read answers for no session).
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_session_policy_reads_tenant_session
            ON coord.session_policy_reads (tenant_id, claude_session_id)
        """
    )
    # "Most recent read" — the reconciler's other access shape. DESC so both the
    # per-session recency probe and the per-tenant recent sweep scan forwards.
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_session_policy_reads_tenant_read_at
            ON coord.session_policy_reads (tenant_id, read_at DESC)
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS coord.ix_session_policy_reads_tenant_read_at")
    op.execute("DROP INDEX IF EXISTS coord.ix_session_policy_reads_tenant_session")
    # No separate constraint drop: DROP TABLE takes the CHECK constraint with
    # it, and an ``ALTER TABLE IF EXISTS`` here would trip the repo's
    # alembic schema= gate, whose raw-SQL parser reads the token after
    # ``ALTER TABLE`` as the (then unqualified) identifier.
    op.execute("DROP TABLE IF EXISTS coord.session_policy_reads")
