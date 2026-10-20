"""coord.claude_account_usage — a stable, opaque per-ACCOUNT identity

Revision ID: coord_claude_acct_usage_04
Revises: pr_fix_ctx_head_sha_01
Create Date: 2026-10-20

Phase 1 of plan
``2026-10-14-mobile-account-usage-iter5-claude-dir-alias-duplicate``.

Adds ``account_hash TEXT NULL`` to ``coord.claude_account_usage`` (the table
created by ``coord_claude_acct_usage_01_account_usage``) and a non-unique index
``ix_claude_account_usage_tenant_account_hash`` on ``(tenant_id, account_hash)``.

## Why

The roster's only account identity is ``account_label``, which the runner
derives from the Claude config-dir BASENAME. One Claude account lives under
different dir names on different OSes (``~/.claude`` on a POSIX box,
``.claude-gmail`` on a Windows one), so the same account is reported as two
labels and every consumer — the mobile account-usage card above all — counts
it twice. Nothing on the wire says the two rows are one account.

``account_hash`` is that identity: lowercase hex SHA-256 of the home's
``.claude.json`` ``oauthAccount.accountUuid`` (trimmed, lowercased). It is
equal across every device and every dir name for the same account, different
for different accounts, and carries no email or path. The runner computes it
(plan Phase 3); coord stores and serves it (Phase 2); consumers group by it.

## Nullable, no default, no backfill (deliberate)

NULL means **no identity was readable** — no ``.claude.json``, a home that is
not logged in, or a runner build that predates the field. It is UNKNOWN, and
two NULLs are never "the same account": consumers fall back to label grouping
for them. There is nothing to backfill from, since the hash exists only on the
reporting device.

## Not part of the row key

The unique key stays ``uq_claude_account_usage_identity`` =
``(tenant_id, device_id, account_label)``: two homes on one device signed into
one account are still two homes. The index added here is therefore NON-unique;
it serves the tenant-scoped read that consumers group by hash.

## Head choice

``down_revision`` is the repo's single alembic head on ``origin/main`` at
authoring time (``scripts/ci/count_alembic_heads.py``: ``HEAD_COUNT=1``,
``HEAD=pr_fix_ctx_head_sha_01``, 2026-10-20). The single-head discipline is
enforced by that script; a sibling revision landing first means re-pointing
this one onto the new head.

## Two-repo ordering — this schema half lands FIRST

alembic in qontinui-web is the SOLE author of ``coord.*`` schema; the
``qontinui-coord`` binary authors none. The coord change that writes and reads
this column is downstream of this one, so this migration must be applied in
production BEFORE that coord binary ships.

## Safety

The nullable ``ADD COLUMN`` with no default is metadata-only on PG >= 11. Every
statement is a static literal guarded on absence (``IF NOT EXISTS`` /
``IF EXISTS``), so the column step re-runs cleanly and the file stays
offline-safe (no ``op.get_bind()``). The index is built ``CONCURRENTLY`` inside
``autocommit_block()`` because the table is live and pre-existing — coord's
``migration_classifier`` rejects a non-concurrent index on a table this file
does not create.

A killed ``CONCURRENTLY`` build leaves an INVALID index that ``IF NOT EXISTS``
skips, so a re-run does NOT repair it. Recovery is a follow-up revision doing
``DROP INDEX CONCURRENTLY IF EXISTS`` then this CREATE again, never a re-run.
Verify after deploy (must read ``indisvalid = true``)::

    SELECT c.relname, i.indisvalid
      FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
     WHERE c.relname = 'ix_claude_account_usage_tenant_account_hash';
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coord_claude_acct_usage_04"
# KEEP THIS ASSIGNMENT ON ONE LINE: coord's alembic-graph parser is line-scoped.
down_revision: str = "pr_fix_ctx_head_sha_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add the nullable hash column, then its tenant-scoped non-unique index."""
    # Plain literals, never f-strings: the `alembic-schema-arg-gate` pre-commit
    # hook and coord's migration_classifier both read the raw SQL statically.
    # SET LOCAL ends at the commit the autocommit_block below performs.
    op.execute("SET LOCAL lock_timeout = '3s'")
    op.execute(
        """
        ALTER TABLE coord.claude_account_usage
            ADD COLUMN IF NOT EXISTS account_hash TEXT
        """
    )

    with op.get_context().autocommit_block():
        op.execute(
            """
            CREATE INDEX CONCURRENTLY IF NOT EXISTS
                ix_claude_account_usage_tenant_account_hash
            ON coord.claude_account_usage (tenant_id, account_hash)
            """
        )


def downgrade() -> None:
    """Drop the index, then the column. Roll back the coord build that writes it first."""
    with op.get_context().autocommit_block():
        op.execute(
            "DROP INDEX CONCURRENTLY IF EXISTS "
            "coord.ix_claude_account_usage_tenant_account_hash"
        )
    op.execute("SET LOCAL lock_timeout = '3s'")
    op.execute(
        "ALTER TABLE coord.claude_account_usage DROP COLUMN IF EXISTS account_hash"
    )
