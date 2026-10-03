"""coord.findings — dossier generated columns + partial indexes

Revision ID: findings_dossier_cols_01
Revises: coord_agent_sessions_context_01
Create Date: 2026-10-03

Phase 2 of plan ``2026-10-03-dossier-query-door-filters-sort-cursor``. Adds six
``GENERATED ALWAYS ... STORED`` columns over ``artifact_refs`` / ``topic`` so
the dossier query door (``GET /coord/agent-dossiers``, Phase 3) can filter,
sort and keyset-page ``kind = 'dossier'`` heads without unindexed JSONB
extracts. ``artifact_refs`` stays the single ledger; the columns cannot drift
from it, and every one is NULL for ``kind <> 'dossier'``.

Columns (the SQL is the Phase 1 ACCEPTED form, plan section "Measured" 4,
verified on PostgreSQL 16 against adversarial rows):

- ``dossier_slug`` — ``artifact_refs.dossier_slug``, falling back to the
  ``topic`` suffix of ``dossier:<slug>``: 91 of 265 live heads carry the slug
  only in the topic.
- ``dossier_readiness`` — text, only when the JSON value is a string.
- ``dossier_recurrence_count`` — int, only for a bare 1-9 digit integer string;
  ``"abc"`` / ``99999999999`` / ``-3`` / ``1.5`` are NULL, never an error.
- ``dossier_first_seen`` / ``dossier_last_seen`` — date. text->date casts and
  ``to_date`` are only STABLE and are rejected in a generation expression, so
  the date is built IMMUTABLY: prefix regex (``last_seen`` is a full ISO
  timestamp on 80 live heads, so the pattern is NOT end-anchored), a real
  calendar guard (month length + leap year; a range-only guard throws
  ``date field value out of range`` on ``2026-02-30`` at INSERT time), and
  ``make_date``.
- ``dossier_has_open_remediation`` — boolean, ledger-derived. The
  ``jsonb_typeof(...) = 'array'`` guard is required: jsonpath lax mode wraps a
  scalar, so a string-valued ``remediations`` would otherwise read ``true``.
  Never ``jsonb_path_exists_tz`` (STABLE, rejected).

Partial indexes ``WHERE kind = 'dossier'``:
``(dossier_readiness, dossier_last_seen DESC, finding_id)``,
``(dossier_recurrence_count DESC, finding_id)``, ``(dossier_slug)``.

House form of ``findings_triage_01``: raw ``op.execute`` with ``ADD COLUMN IF
NOT EXISTS`` / ``CREATE INDEX CONCURRENTLY IF NOT EXISTS`` in an
``autocommit_block()``, schema-qualified, rerunnable. ``ADD COLUMN ... STORED``
rewrites the table (11.3k rows / 43 MB at Phase 1; ~10 ms on a same-shaped
scratch table) under a brief ACCESS EXCLUSIVE lock behind ``lock_timeout``.
A killed CONCURRENTLY build leaves an INVALID index that ``IF NOT EXISTS``
would skip, so the upgrade drops any invalid one of these names first.

alembic is the sole author of ``coord.*`` schema (served policy
``production-and-cost`` ``alembic-sole-authorship``); this revision is
hand-authored. coord must not READ these columns before it is deployed.
``down_revision`` is the single live head at authoring time
(``alembic heads`` on web ``33db3ea0a``).
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "findings_dossier_cols_01"
down_revision: str | Sequence[str] | None = "coord_agent_sessions_context_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _date_expr(key: str) -> str:
    """Immutable text->date for ``artifact_refs->>key`` (NULL when not a real date)."""
    v = f"(artifact_refs->>'{key}')"
    return (
        "CASE WHEN kind = 'dossier'"
        f" AND {v} ~ '^[0-9]{{4}}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])([T ].*)?$'"
        f" AND substr({v},1,4)::int >= 1"
        f" AND substr({v},9,2)::int <= CASE substr({v},6,2)::int"
        f" WHEN 2 THEN CASE WHEN (substr({v},1,4)::int % 4 = 0"
        f" AND substr({v},1,4)::int % 100 <> 0)"
        f" OR substr({v},1,4)::int % 400 = 0 THEN 29 ELSE 28 END"
        " WHEN 4 THEN 30 WHEN 6 THEN 30 WHEN 9 THEN 30 WHEN 11 THEN 30 ELSE 31 END"
        f" THEN make_date(substr({v},1,4)::int, substr({v},6,2)::int,"
        f" substr({v},9,2)::int) END"
    )


_COLUMNS: tuple[tuple[str, str, str], ...] = (
    (
        "dossier_slug",
        "text",
        "CASE WHEN kind = 'dossier' THEN"
        " COALESCE(NULLIF(artifact_refs->>'dossier_slug', ''),"
        " CASE WHEN left(topic, 8) = 'dossier:'"
        " THEN NULLIF(substr(topic, 9), '') END) END",
    ),
    (
        "dossier_readiness",
        "text",
        "CASE WHEN kind = 'dossier'"
        " AND jsonb_typeof(artifact_refs->'readiness') = 'string'"
        " THEN artifact_refs->>'readiness' END",
    ),
    (
        "dossier_recurrence_count",
        "integer",
        "CASE WHEN kind = 'dossier'"
        " AND (artifact_refs->>'recurrence_count') ~ '^[0-9]{1,9}$'"
        " THEN (artifact_refs->>'recurrence_count')::int END",
    ),
    ("dossier_first_seen", "date", _date_expr("first_seen")),
    ("dossier_last_seen", "date", _date_expr("last_seen")),
    (
        "dossier_has_open_remediation",
        "boolean",
        "CASE WHEN kind = 'dossier'"
        " AND jsonb_typeof(artifact_refs->'remediations') = 'array'"
        " THEN jsonb_path_exists(artifact_refs,"
        " '$.remediations[*] ? (!(@.status like_regex"
        ' "^(shipped|landed|superseded|obsolete)" flag "i"))\')'
        " END",
    ),
)

_INDEXES: tuple[tuple[str, str], ...] = (
    (
        "idx_findings_dossier_readiness_last_seen",
        "(dossier_readiness, dossier_last_seen DESC, finding_id)",
    ),
    (
        "idx_findings_dossier_recurrence",
        "(dossier_recurrence_count DESC, finding_id)",
    ),
    ("idx_findings_dossier_slug", "(dossier_slug)"),
)


def upgrade() -> None:
    """Additive: six generated columns plus three partial indexes. Idempotent."""
    op.execute("SET LOCAL lock_timeout = '3s'")
    for name, sql_type, expr in _COLUMNS:
        op.execute(
            f"ALTER TABLE coord.findings ADD COLUMN IF NOT EXISTS {name} "
            f"{sql_type} GENERATED ALWAYS AS ({expr}) STORED"
        )

    # CONCURRENTLY cannot run in a transaction; entering the block commits the
    # ALTERs, which is why each is individually idempotent.
    with op.get_context().autocommit_block():
        for name, key in _INDEXES:
            # A killed CONCURRENTLY build leaves an INVALID index that
            # IF NOT EXISTS would skip forever: drop only an invalid one.
            op.execute(
                f"""
                DO $$
                BEGIN
                  IF EXISTS (
                    SELECT 1 FROM pg_index i
                      JOIN pg_class c ON c.oid = i.indexrelid
                      JOIN pg_namespace n ON n.oid = c.relnamespace
                     WHERE n.nspname = 'coord' AND c.relname = '{name}'
                       AND NOT i.indisvalid
                  ) THEN
                    DROP INDEX coord.{name};
                  END IF;
                END $$
                """
            )
            op.execute(
                f"CREATE INDEX CONCURRENTLY IF NOT EXISTS {name} "
                f"ON coord.findings {key} WHERE kind = 'dossier'"
            )


def downgrade() -> None:
    """Reverse exactly this revision: the indexes, then the six columns."""
    with op.get_context().autocommit_block():
        for name, _key in _INDEXES:
            op.execute(f"DROP INDEX CONCURRENTLY IF EXISTS coord.{name}")

    op.execute("SET LOCAL lock_timeout = '3s'")
    for name, _type, _expr in reversed(_COLUMNS):
        op.execute(f"ALTER TABLE coord.findings DROP COLUMN IF EXISTS {name}")
