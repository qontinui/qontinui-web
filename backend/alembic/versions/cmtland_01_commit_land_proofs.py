"""coord.commit_land_proofs — coord-proven commit land verdicts

Revision ID: cmtland_01
Revises: overview_02_authoring_core
Create Date: 2026-09-25

Phase 3 of plan
``plans/2026-09-24-agents-cannot-record-delivery-for-a-landed-plan-coord-never-saw-land.md``
(§4.3). Authored by alembic in ``qontinui-web`` — coord authors zero
``coord.*`` DDL (served policy ``production-and-cost``
``alembic-sole-authorship``).

Why a new table
===============

A plan whose code is provably on trunk can still never reach ``shipped`` when
coord never saw it land: the PR closed long before coord's land probe could
reach it, or the code landed with no PR at all. The plan's Phase 4 adds a
commit-only citation (``pr_number IS NULL``) whose land verdict coord proves
itself — by ancestry against the resolved trunk, or by a path-scoped
``patch_id`` twin. That verdict needs a home, and nothing existing fits:

* ``coord.pr_events.pr_number`` is ``NOT NULL``.
* ``coord.commit_lineage`` is attribution with an agent-reachable writer
  (runner-originated ``POST /coord/commits/report``), so it cannot hold proof.
* A verdict column on ``coord.work_unit_pr_citations`` would put coord-only
  proof on an agent-inserted row, one careless UPDATE away from a forged land.

So: one table, keyed on ``(repo, commit_sha)``, with **coord as the sole
writer**. No agent-facing door writes here; an agent can only NOMINATE a
commit, and coord's prover records what it found — ``landed`` (with its
``method``) or ``abstain`` (with its ``abstain_reason``). An abstention is a
row too, so "coord looked and could not prove it" is distinguishable from
"coord never looked".

Intentionally tenant-less
=========================

A land is a fact about ``owner/name`` and a commit; it says nothing about any
tenant. The table carries no ``tenant_id`` by design. It is read ONLY by
joining through a tenant's own citation row (which carries ``tenant_id``), so
no read exposes a verdict for a commit the tenant has not itself cited.

``touched_files`` is audit and the ``document_only`` disclosure (plan §4.5);
it is never a retirement input.

Idempotency / authorship posture
================================

* ``CREATE SCHEMA IF NOT EXISTS coord`` first, then ``CREATE TABLE IF NOT
  EXISTS`` through raw ``op.execute`` — matching ``coord_workunits_04`` and
  ``phaseatt_01``. Every statement is ``coord.``-qualified, which the
  ``alembic-schema-arg-gate`` pre-commit hook audits.
* No per-table GRANT: the ``coord`` schema's privileges are granted at the
  schema level and no sibling ``coord.*`` table migration issues per-table
  grants.
* This revision was **HAND-AUTHORED**; ``alembic revision --autogenerate`` is
  never run here. Pure DDL, no app imports — the prod migrator lacks app deps.

Ordering
========

This revision must be APPLIED to the serving database before any coord build
that names the table in SQL is proposed for merge (the plan's Phase 4 and 5
coord PRs carry a ``coord:downstream-of`` label naming this PR). Done-when is
``coord_query_schema_object(table, "commit_land_proofs")`` reading
``existence: present`` — not the merge.

``down_revision``
=================

The single head on qontinui-web ``origin/main`` ``9c2f490e1`` (596 revisions,
exactly one head, ``coord_wu_authored_at_02``). If another revision lands
first, re-point the token below AND the ``Revises:`` line above at the merged
head.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "cmtland_01"
down_revision: str | Sequence[str] | None = "overview_02_authoring_core"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create the coord-only commit land proof store."""
    op.execute("CREATE SCHEMA IF NOT EXISTS coord")
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.commit_land_proofs (
            repo            TEXT NOT NULL,
            commit_sha      TEXT NOT NULL,
            verdict         TEXT NOT NULL
                CHECK (verdict IN ('landed', 'abstain')),
            method          TEXT
                CHECK (method IN ('ancestor', 'patch_id')),
            landed_sha      TEXT,
            trunk           TEXT NOT NULL,
            trunk_tip       TEXT,
            patch_id        TEXT,
            changed_lines   INTEGER,
            touched_files   TEXT[],
            abstain_reason  TEXT,
            detail          TEXT,
            proven_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
            PRIMARY KEY (repo, commit_sha),
            -- A row is proof, so the verdict's dependents are enforced here,
            -- not only described in a comment.
            CONSTRAINT commit_land_proofs_method_iff_landed
                CHECK ((verdict = 'landed') = (method IS NOT NULL)),
            CONSTRAINT commit_land_proofs_landed_names_its_sha
                CHECK (verdict <> 'landed' OR landed_sha IS NOT NULL),
            -- Full lowercase 40-hex only: commit_sha is in the key, so an
            -- abbreviation or a case variant would be a second row for the
            -- same commit.
            CONSTRAINT commit_land_proofs_commit_sha_full_hex
                CHECK (commit_sha ~ '^[0-9a-f]{40}$'),
            CONSTRAINT commit_land_proofs_landed_sha_full_hex
                CHECK (landed_sha IS NULL OR landed_sha ~ '^[0-9a-f]{40}$'),
            CONSTRAINT commit_land_proofs_trunk_tip_full_hex
                CHECK (trunk_tip IS NULL OR trunk_tip ~ '^[0-9a-f]{40}$')
        )
        """
    )
    op.execute(
        """
        COMMENT ON TABLE coord.commit_land_proofs IS
        'coord-proven land verdicts for a single commit (repo, commit_sha): '
        'landed by ancestor or patch_id against the resolved trunk, or abstain '
        'with a reason. coord is the SOLE writer; no agent-reachable door writes '
        'here, so a row is proof rather than a claim. Intentionally tenant-less: '
        'a land is a fact about a repo and a commit, not a tenant, and the table '
        'is read only by joining through a tenant''s own citation row in '
        'coord.work_unit_pr_citations.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.commit_land_proofs.commit_sha IS
        'Full 40-hex commit sha as cited.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.commit_land_proofs.method IS
        'How the land was proven: ancestor (commit_sha is on trunk) or patch_id '
        '(a path-scoped twin with the same patch id is on trunk). NULL on abstain.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.commit_land_proofs.landed_sha IS
        'The sha actually on trunk: equals commit_sha for ancestor, the twin for '
        'patch_id.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.commit_land_proofs.touched_files IS
        'Audit and the document_only disclosure only; never a retirement input.'
        """
    )


def downgrade() -> None:
    """Reverse: drop the table."""
    op.execute("DROP TABLE IF EXISTS coord.commit_land_proofs")
