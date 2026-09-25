"""coord.gate_corrections — the forward-only annotation store for a mis-predicated gate

Revision ID: gatecorr_01_coord_gate_corrections
Revises: coord_pr_files_head_sha_01
Create Date: 2026-09-21

Phase 7 (web slice) of plan
``2026-09-21-a-cleared-gate-is-uncorrectable-and-every-repair-mints-another-false-green-row``.
Hand-authored; ``alembic revision --autogenerate`` was NOT run and is never run
against ``coord.*`` — no SQLAlchemy models back that schema, so autogenerate
emits spurious drops (served policy ``production-and-cost``
``alembic-sole-authorship``). coord authors zero ``coord.*`` DDL; it only reads
and writes rows.

## What this table is for

A coord gate that reaches a terminal verdict is **uncorrectable**. Measured on
this tenant 2026-09-20: two gates named *"deploy gate: phaseatt_01 applied to
the serving database"* sit ``cleared`` while their predicate
(``migration_at_head{schema:"coord"}``) asks only whether coord's alembic chain
shows drift — and ``coord_query_schema_object`` reports the table those gates
assert exists as ``existence: "absent"`` against the live RDS catalog. The
second of the two rows exists ONLY because a session tried to repair the first,
86 minutes later: every repair verb coord ships either refuses a terminal
verdict outright (``withdraw``/``mute``/``snooze``/``repoint``/``attest``/
``reject``), or — ``reopen`` — clones the SAME predicate, so the clone
re-clears on the next sweep tick and one false-green row becomes two.

``coord.gate_corrections`` is the substrate for correcting such a row
**forward**: a later coord phase adds a ``coord_correct_gate`` verb that
appends an annotation saying *this cleared row asked the wrong question*,
optionally naming the gate that replaces it. Nothing about ``coord.gates``
changes, no row is rewritten, and no row is deleted — the audit record the
defect exists to preserve stays byte-identical.

## Why a new table rather than a column or a new verdict

Both alternatives were measured and rejected in the plan's D3:

* **Reusing the existing free-text lineage column** (``continuation_deferred_reason``,
  which ``followup_supersession`` already parses for a ``superseded_by:``
  prefix) is rejected because that column has a second, UNAUTHENTICATED writer
  — ``POST /coord/gates/{gate_id}/continuation-deferred`` is documented as an
  *"Unauthenticated device-keyed data-plane write"* with no writer-identity
  check. A forgeable correction is worse than none.
* **A new ``verdict`` value** (e.g. ``'corrected'``) is rejected because coord's
  ``work_unit_derive_worker`` deliberately writes its withdrawal test as
  ``verdict <> 'withdrawn'`` rather than an allow-list, so a NEW value lands in
  ``total`` and never in ``cleared`` — it would permanently and SILENTLY strand
  every work unit carrying a corrected gate at ``vetted``. It would also rewrite
  the audit record.

A separate table is append-only by construction (there is no UPDATE path to
write), holds N corrections per gate, carries its own author and timestamp,
never touches ``coord.gates``, and — the load-bearing property — is a table that
**no blocking query joins**. Nothing coord decides with can be changed by a row
here; a correction annotates, it never gates.

## ⚠️ APPEND-ONLY IS NOT A DATABASE GUARANTEE HERE

Postgres cannot express "append-only" in this DDL. There is no ``REVOKE`` to
issue (coord connects as the owning role, which GRANTs cannot constrain), and a
rule/trigger that raised on UPDATE/DELETE would block the very migrations that
may one day have to reshape this table. **So the property WILL BE enforced on
coord's side**, by a source-scanning test in the coord phase that adds the
``coord_correct_gate`` verb: it asserts coord's SQL contains no ``UPDATE`` and
no ``DELETE`` against ``coord.gate_corrections``. The same idiom coord already
uses to pin ``register_gate_core``'s guard placement.

Note the tense, because it matters: between this migration landing and that
phase landing, enforcement is **zero**. That is harmless only because there are
no writers yet — this table has no producer until ``coord_correct_gate``
exists. The phase that adds the verb MUST add the test in the same change;
a verb shipped without it leaves an append-only store that is append-only by
convention alone.

**Do not read this schema as guaranteeing immutability.** A direct
``UPDATE coord.gate_corrections`` from psql will succeed. If you are reviewing a
change that makes coord write one, the source-scanning test is the thing that
must fail — and if it does not, that is the bug.

## Columns

* ``correction_id``          — UUID PK, ``gen_random_uuid()`` default (same
                               precedent as ``coord.gates.gate_id``, which is
                               built-in from PG13 and needs no ``pgcrypto``).
* ``gate_id``                — the gate being annotated. **Deliberately FK-FREE**
                               (see below).
* ``tenant_id``              — the tenant, denormalized so the read path filters
                               without joining ``coord.gates``. NOT NULL: every
                               gate carries one, and a NULL here would make a
                               correction invisible to a tenant-scoped read
                               rather than merely misfiled.
* ``relation``               — CHECK-constrained vocabulary:
                               ``mispredicated`` (this gate asked the wrong
                               question), ``reopened_from`` and
                               ``repointed_from`` (the lineage a later phase
                               migrates out of coord's unindexed, unparsed
                               ``verdict_reason`` free text, where *"what
                               superseded gate X?"* is answerable only by a
                               ``LIKE`` scan). The vocabulary is CHECKed rather
                               than free text precisely so a typo in a writer is
                               an IntegrityError here and not a word the console
                               silently paints.
* ``reason``                 — the human-readable correction. NOT NULL: a
                               correction with no stated reason is the shape
                               this plan exists to stop being minted.
* ``replacement_gate_id``    — NULL-able. The gate that supersedes this one,
                               when there is one. NULL means *"corrected, with
                               no replacement"*, which is a real and common
                               case (the gate simply should never have been
                               registered).
* ``corrected_by_device_id`` — NULL-able attribution.
* ``corrected_by_agent_id``  — NULL-able attribution. Both are nullable because
                               ``coord.gates.registered_by`` is nullable on
                               existing rows and a correction must not be harder
                               to write than the row it corrects.
* ``created_at``             — TIMESTAMPTZ NOT NULL DEFAULT ``now()``. Insert
                               clock. Not used in any partial-index predicate.

## Why ``gate_id`` carries no foreign key

coord's gate rows are **never deleted in production** — the only ``DELETE``
statements against ``coord.gates`` anywhere in the coord tree are
``#[cfg(test)]`` fixture cleanup (10 sites, in ``orphan_reconciler.rs``,
``branch_reap_worker.rs`` and ``gate_class_backfill.rs``, all inside test
modules), so there is no production deletion path. The doctor's 21,896-row
population on this tenant is the whole history, not a live set.

An earlier draft of this paragraph said "no code path anywhere", which is
refutable with one grep and would have undermined the decision it supports.
The decision stands on the narrower, true claim.

**One integrity contract the schema cannot express, recorded here because the
verb that will write these rows has to honour it.** ``tenant_id`` is
denormalized onto this table and is constrained against nothing — not against
``coord.gates.tenant_id``, and (being FK-free) not against the gate row at all.
So a correction written with the wrong ``tenant_id`` is invisible to the
tenant-scoped read, or visible to the wrong tenant, and nothing here catches
it. The whole burden therefore falls on ``coord_correct_gate``: it MUST derive
``tenant_id`` (and the tenant check on ``gate_id``) **from the gate row it is
correcting, never from caller arguments**. Written down now so it is a contract
for that phase rather than a discovery after rows exist. An FK would therefore buy nothing at
runtime while coupling this annotation's lifetime to a table this plan must not
constrain: an ``ON DELETE CASCADE`` would make a hypothetical future gate
cleanup silently erase corrections (the exact class of loss the table exists to
prevent), and an ``ON DELETE RESTRICT`` would make this table able to BLOCK a
``coord.gates`` migration. A correction is an observation ABOUT a gate, not a
part of it.

## Index

``idx_gate_corrections_tenant_gate`` on ``(tenant_id, gate_id)`` — the only
read shape the correction block on coord's gate read surfaces needs: *"what
corrections exist for these gates, in this tenant"*. Tenant first because every
coord read is tenant-scoped, so it is the selective prefix and the same index
also serves a whole-tenant sweep.

## Idempotency and reversal

DDL is emitted as raw ``op.execute`` with ``IF NOT EXISTS`` so a re-apply
against a partially-migrated database is a no-op, matching the posture of the
surrounding ``coord.*`` revisions. ``downgrade()`` drops the index and the
table — a real reversal, because ``migration-reversal.yml``'s required
*"Migration Reversal Gate"* actually exercises
upgrade -> ``downgrade -1`` -> upgrade and a no-op downgrade fails it. The
downgrade IS destructive of correction rows, which is correct: this revision is
the only thing that created them, and nothing else reads the table.

## Head resolution

Chains off the single head computed from ``origin/main`` on 2026-09-21 by the
repo's own gate (``python scripts/ci/count_alembic_heads.py --baseline-ref
origin/main`` -> ``HEAD_COUNT=1``, ``HEAD=merge_20260920_ci_contspawn_pdpub_rsslocal``,
582 revisions parsed). The plan recorded the same id at authoring time and this
revision re-resolved it rather than trusting that record. coord re-points
``down_revision`` at land time if the head moves — no head reservation or
stacked-on label needed.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "gatecorr_01_coord_gate_corrections"
# Single parent, so a plain string. Were this ever re-pointed at a MERGE node
# with several parents, the parents must stay inside ONE parenthesised group:
# the head gate's offline parser (`scripts/ci/_alembic_graph.py` `DOWN_RE`)
# reads the right-hand side as `(\([^)]*\)|[^\n]+)`, so a parenthesised list may
# wrap across lines but a bare tuple spilling past a `)` cannot.
down_revision: str | Sequence[str] | None = "coord_pr_files_head_sha_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create the append-only correction annotation store."""
    # The coord schema is created by earlier coord revisions; guard anyway so
    # this file is self-contained and idempotent.
    op.execute("CREATE SCHEMA IF NOT EXISTS coord")

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.gate_corrections (
            correction_id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            gate_id                UUID NOT NULL,
            tenant_id              UUID NOT NULL,
            relation               TEXT NOT NULL,
            reason                 TEXT NOT NULL,
            replacement_gate_id    UUID,
            corrected_by_device_id UUID,
            corrected_by_agent_id  UUID,
            created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT gate_corrections_relation_chk
                CHECK (relation IN (
                    'mispredicated', 'reopened_from', 'repointed_from'
                ))
        )
        """
    )

    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_gate_corrections_tenant_gate
            ON coord.gate_corrections (tenant_id, gate_id)
        """
    )


def downgrade() -> None:
    """Drop the index and the table. Destroys any correction rows written."""
    op.execute("DROP INDEX IF EXISTS coord.idx_gate_corrections_tenant_gate")
    op.execute("DROP TABLE IF EXISTS coord.gate_corrections")
