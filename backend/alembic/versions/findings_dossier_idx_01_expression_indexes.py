"""coord.findings — partial expression indexes for the dossier query door

Revision ID: findings_dossier_idx_01
Revises: mdroles_01
Create Date: 2026-10-03

Phase 2 of plan ``2026-10-03-dossier-query-door-filters-sort-cursor``. Adds
three partial indexes ``WHERE kind = 'dossier'`` over IMMUTABLE expressions of
``artifact_refs`` / ``topic`` so the dossier query door (``GET
/coord/agent-dossiers``, Phase 3) can filter, sort and keyset-page dossier heads
without scanning and re-parsing JSONB for every row.

No columns are added, deliberately. The first form of this revision added six
``GENERATED ALWAYS ... STORED`` columns; coord's migration classifier
(``crates/coord/src/pr_merge/migration_classifier.rs``) rejects those
unconditionally (a table rewrite, and it is size-blind), so such a revision can
never auto-land. Indexes over the same expressions give the same results with
no rewrite and no ACCESS EXCLUSIVE lock: ``CREATE INDEX CONCURRENTLY`` takes
only SHARE UPDATE EXCLUSIVE and blocks neither reads nor writes.

Indexes, and what each serves:

- ``idx_findings_dossier_slug`` — ``((slug_expr))``: slug lookup and the
  newest-per-slug dedup. The slug is ``artifact_refs.dossier_slug`` (string or
  number; an array/object ref is ignored), falling back to the suffix of
  ``topic = 'dossier:<slug>'`` (91 of 265 live heads carry the slug only
  there); an empty value or suffix is NULL.
- ``idx_findings_dossier_readiness_last_seen`` — ``((readiness_expr),
  (last_seen_expr) DESC, finding_id)``: readiness filter with newest-seen
  order. Readiness is read only when the JSON value is a string.
  ``last_seen`` is built IMMUTABLY (text->date casts and ``to_date`` are only
  STABLE, and an index expression must be IMMUTABLE): a prefix regex (the value
  is a full ISO timestamp on many heads, so it is NOT end-anchored), a real
  calendar guard (month length and leap year, in a nested ``CASE`` so no cast
  is evaluated on a non-matching value) and ``make_date``. A bad date is NULL,
  never an error: an index evaluates its expression at INSERT time, so a
  throwing expression would fail the write.
- ``idx_findings_dossier_recurrence`` — ``((recurrence_expr) DESC,
  finding_id)``: recurrence sort. Only a bare 1-9 digit integer (number or
  string, ``^[0-9]{1,9}$``) is read; anything else is NULL.

THE EXPRESSION TEXT IS THE CONTRACT WITH THE COORD DOOR. PostgreSQL uses an
expression index only when the query's expression matches the index's, so the
door's SQL must repeat these expressions exactly (one shared constant in
coord; keep the two in sync, and keep ``WHERE kind = 'dossier'`` in the query).
A mismatch degrades to a scan, never to a wrong answer. ``first_seen``,
``updated`` and open-remediation have no index (they scan the small dossier
subset).

House form: raw ``op.execute`` of literal SQL (the classifier requires every
argument to be adjacent plain string literals), schema-qualified, ``CREATE
INDEX CONCURRENTLY IF NOT EXISTS`` inside ``autocommit_block()``, rerunnable.
There is no ALTER, so no ``lock_timeout`` is set, and the concurrent builds are
deliberately NOT bounded: they legitimately wait on in-flight transactions, and
a ``lock_timeout`` there fails the deploy on a busy table and leaves an INVALID
index behind.

RECOVERY from a killed build. A killed ``CREATE INDEX CONCURRENTLY`` leaves an
INVALID index, and ``IF NOT EXISTS`` then skips it forever. This revision does
not repair that itself (a repairing ``DO $$`` block cannot be proven safe by the
classifier). THE TRAP: after the kill the upgrade raised, so ``alembic_version``
was not advanced; re-running the deploy skips the INVALID index, succeeds, and
STAMPS this revision applied, a "successful" migration with a broken index.
Detect it (any row = broken)::

    SELECT c.relname FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
     WHERE NOT i.indisvalid AND c.relname LIKE 'idx_findings_dossier_%';

Repair: drop the invalid index (``DROP INDEX CONCURRENTLY IF EXISTS
coord.<name>``; the names are ``idx_findings_dossier_slug``,
``idx_findings_dossier_readiness_last_seen`` and
``idx_findings_dossier_recurrence``), then, if ``alembic_version`` is already
``findings_dossier_idx_01``, step it back, because ``upgrade head`` is a no-op
from the stamped state: ``alembic stamp mdroles_01`` (or ``alembic
downgrade -1``, safe because the downgrade is ``DROP ... IF EXISTS`` on all
three). Then ``alembic upgrade head`` rebuilds the dropped index. That is only
right while this revision is the head: once a descendant revision exists,
stamping back to the parent would make ``upgrade head`` re-run the descendants
too, so stamp back to the parent and run ``alembic upgrade
findings_dossier_idx_01`` (this revision only), then continue to head.

Every expression is total: it returns a value or NULL for any JSONB shape and
never raises, because an index evaluates it at INSERT time (a throw would fail
the write, or the build, which leaves an INVALID index). That includes size: a
btree entry over ~2.7 KB errors, so the slug (both the ``dossier_slug`` ref and
the ``topic`` suffix) and the readiness are read only when at most 64
characters long (the longest measured readiness is 37), else NULL.

alembic is the sole author of ``coord.*`` schema (served policy
``production-and-cost`` ``alembic-sole-authorship``); this revision is
hand-authored. ``down_revision`` is the single live head at authoring time
(``alembic heads`` on web ``e53886894``).
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "findings_dossier_idx_01"
down_revision: str | Sequence[str] | None = "mdroles_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Additive: three partial expression indexes, built concurrently."""
    # CONCURRENTLY cannot run in a transaction.
    with op.get_context().autocommit_block():
        op.execute(
            "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_findings_dossier_slug ON coord.findings "
            "((CASE WHEN kind = 'dossier' THEN COALESCE(CASE WHEN "
            "jsonb_typeof(artifact_refs->'dossier_slug') NOT IN ('array', 'object') AND "
            "length(artifact_refs->>'dossier_slug') <= 64 THEN "
            "NULLIF(artifact_refs->>'dossier_slug', '') END, CASE WHEN left(topic, 8) = "
            "'dossier:' AND length(substr(topic, 9)) <= 64 THEN NULLIF(substr(topic, 9), '') END) "
            "END)) WHERE kind = 'dossier'"
        )
        op.execute(
            "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_findings_dossier_readiness_last_seen ON "
            "coord.findings ((CASE WHEN kind = 'dossier' AND "
            "jsonb_typeof(artifact_refs->'readiness') = 'string' AND "
            "length(artifact_refs->>'readiness') <= 64 THEN artifact_refs->>'readiness' END), "
            "(CASE WHEN kind = 'dossier' AND (artifact_refs->>'last_seen') ~ "
            "'^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])([T ].*)?$' THEN CASE WHEN "
            "substr((artifact_refs->>'last_seen'),1,4)::int >= 1 AND "
            "substr((artifact_refs->>'last_seen'),9,2)::int <= CASE "
            "substr((artifact_refs->>'last_seen'),6,2)::int WHEN 2 THEN CASE WHEN "
            "(substr((artifact_refs->>'last_seen'),1,4)::int % 4 = 0 AND "
            "substr((artifact_refs->>'last_seen'),1,4)::int % 100 <> 0) OR "
            "substr((artifact_refs->>'last_seen'),1,4)::int % 400 = 0 THEN 29 ELSE 28 END WHEN 4 "
            "THEN 30 WHEN 6 THEN 30 WHEN 9 THEN 30 WHEN 11 THEN 30 ELSE 31 END THEN "
            "make_date(substr((artifact_refs->>'last_seen'),1,4)::int, "
            "substr((artifact_refs->>'last_seen'),6,2)::int, "
            "substr((artifact_refs->>'last_seen'),9,2)::int) END END) DESC, finding_id) WHERE "
            "kind = 'dossier'"
        )
        op.execute(
            "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_findings_dossier_recurrence ON "
            "coord.findings ((CASE WHEN kind = 'dossier' AND (artifact_refs->>'recurrence_count') "
            "~ '^[0-9]{1,9}$' THEN (artifact_refs->>'recurrence_count')::int END) DESC, "
            "finding_id) WHERE kind = 'dossier'"
        )


def downgrade() -> None:
    """Reverse exactly this revision: the three indexes."""
    with op.get_context().autocommit_block():
        op.execute("DROP INDEX CONCURRENTLY IF EXISTS coord.idx_findings_dossier_slug")
        op.execute(
            "DROP INDEX CONCURRENTLY IF EXISTS "
            "coord.idx_findings_dossier_readiness_last_seen"
        )
        op.execute(
            "DROP INDEX CONCURRENTLY IF EXISTS coord.idx_findings_dossier_recurrence"
        )
