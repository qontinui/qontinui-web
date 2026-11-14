"""overview.* — stakeholder reports: reports, report_versions, report_snapshots

Revision ID: overview_reports_01_create
Revises: coord_test_result_runs_01
Create Date: 2026-11-08

Phase 1 of ``2026-11-07-interactive-stakeholder-reports-in-the-project-overview``:
a report is a versioned narrative plus a series of frozen data snapshots, each
one dated point on the report's timeline (the plan's D1).

``overview.reports``
    The narrative: a per-project unique ``slug``, a ``title``, a one-paragraph
    plain-language ``summary`` and a markdown ``body_md``, versioned like a
    page (``current_version`` is the version a write names in ``If-Match``).
    ``source_repo`` / ``source_path`` / ``source_sha`` say which repository
    file a published report mirrors and at which commit (D7): the partial
    unique index ``uq_overview_reports_source`` makes ``(tenant_id,
    source_repo, source_path)`` unique among reports that HAVE a source, which
    is what lets a re-publish find the report. The three source CHECKs mirror
    ``overview.pages``' (``overview_05_page_sources``): one lowercase spelling
    of a repository, both halves of a source or neither, a sha only beside a
    source.

``overview.report_versions``
    Append-only, as ``overview.page_versions``: every content write stores the
    narrative as it then stood, the commit it mirrored, and who wrote it beyond
    ``created_by`` — the coord device the write came through and the session
    the client reported.

``overview.report_snapshots``
    One stop on the timeline: a ``data`` document validated against the
    ``report-snapshot/v1`` allowlist contract, with its ``label``, ``as_of``
    and method copied out of it for ordering and listing, the canonical
    ``content_sha256``, and the ``allowlist_version`` and ``scope_version``
    (``web.presentation_scopes.version``, 0 for a tenant with no row) it was
    validated against, so a read knows when to validate it again (D4).
    ``seq`` is the creation order, unique per report; timeline order is
    ``(as_of, seq)``. A snapshot is never edited or deleted: a correction is
    a new snapshot, and the wrong one is WITHDRAWN (``withdrawn_at`` and
    ``withdrawn_reason``, set together or not at all —
    ``ck_overview_report_snapshots_withdrawn_pair``), which keeps it as history
    and hides it from readers. ``version`` starts at 1 and moves on every
    withdraw or restore, the version those writes name in ``If-Match``.
    ``uq_overview_report_snapshots_source`` makes ``(report_id, source_path)``
    unique among snapshots published from a file, so re-posting one is a no-op
    and a changed one is refused.

Written to be provably additive for coord's migration classifier
(``pr_merge/migration_classifier.rs``), which lands a migration unattended
only when every upgrade statement is one it can prove safe on a live database:
each table is a guarded ``CREATE TABLE IF NOT EXISTS`` with its constraints
inline (the tables are new, so no row exists to validate them against and no
existing table is locked), and the two partial unique indexes — which cannot
be inline constraints — are built ``CONCURRENTLY IF NOT EXISTS`` inside
``autocommit_block``, the only place the classifier admits that form. Nothing
in ``upgrade`` removes anything; every drop is in ``downgrade``.

Post-deploy verification (a concurrent build that is killed leaves its index
INVALID, and ``IF NOT EXISTS`` would then skip it by name)::

    SELECT c.relname, i.indisvalid
      FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
     WHERE c.relname IN ('uq_overview_reports_source',
                         'uq_overview_report_snapshots_source');

Both must read ``indisvalid = true``. The tables are new and empty when the
indexes are built, so the build is instant and a kill mid-build is unlikely;
the recovery is ``DROP INDEX CONCURRENTLY IF EXISTS`` on the invalid one and
this revision's CREATE again — never a plain ``DROP INDEX``.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "overview_reports_01_create"
down_revision: str | Sequence[str] | None = "coord_test_result_runs_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS overview.reports (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id uuid NOT NULL,
            slug text NOT NULL,
            title text NOT NULL,
            summary text NOT NULL DEFAULT '',
            body_md text NOT NULL DEFAULT '',
            source_repo text,
            source_path text,
            source_sha text,
            current_version integer NOT NULL DEFAULT 1,
            created_by text,
            updated_by text,
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now(),
            CONSTRAINT uq_overview_reports_slug UNIQUE (tenant_id, slug),
            CONSTRAINT ck_overview_reports_source_repo_lowercase
                CHECK (source_repo IS NULL OR source_repo = lower(source_repo)),
            CONSTRAINT ck_overview_reports_source_pair
                CHECK ((source_repo IS NULL) = (source_path IS NULL)),
            CONSTRAINT ck_overview_reports_source_sha_needs_source
                CHECK (source_sha IS NULL OR source_repo IS NOT NULL)
        )
        """
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS overview.report_versions (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id uuid NOT NULL,
            report_id uuid NOT NULL
                REFERENCES overview.reports (id) ON DELETE CASCADE,
            version integer NOT NULL,
            title text NOT NULL,
            summary text NOT NULL,
            body_md text NOT NULL,
            source_sha text,
            via_device uuid,
            via_session text,
            created_by text,
            created_at timestamptz NOT NULL DEFAULT now(),
            CONSTRAINT uq_overview_report_versions UNIQUE (report_id, version)
        )
        """
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS overview.report_snapshots (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id uuid NOT NULL,
            report_id uuid NOT NULL
                REFERENCES overview.reports (id) ON DELETE CASCADE,
            seq integer NOT NULL,
            version integer NOT NULL DEFAULT 1,
            label text NOT NULL,
            as_of timestamptz NOT NULL,
            method_kind text NOT NULL,
            method_label text NOT NULL,
            data jsonb NOT NULL,
            content_sha256 text NOT NULL,
            allowlist_version integer NOT NULL,
            scope_version integer NOT NULL,
            source_path text,
            withdrawn_at timestamptz,
            withdrawn_reason text,
            created_by text,
            via_device uuid,
            via_session text,
            created_at timestamptz NOT NULL DEFAULT now(),
            CONSTRAINT uq_overview_report_snapshots_seq UNIQUE (report_id, seq),
            CONSTRAINT ck_overview_report_snapshots_method_kind
                CHECK (
                    method_kind IN ('full_review', 'light_check', 'measured', 'manual')
                ),
            CONSTRAINT ck_overview_report_snapshots_withdrawn_pair
                CHECK ((withdrawn_at IS NULL) = (withdrawn_reason IS NULL))
        )
        """
    )
    # autocommit_block() commits the tables above first, so each index is built
    # in its own transaction; the classifier admits CONCURRENTLY only here.
    with op.get_context().autocommit_block():
        op.execute(
            "CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "
            "uq_overview_reports_source "
            "ON overview.reports (tenant_id, source_repo, source_path) "
            "WHERE source_repo IS NOT NULL"
        )
        op.execute(
            "CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "
            "uq_overview_report_snapshots_source "
            "ON overview.report_snapshots (report_id, source_path) "
            "WHERE source_path IS NOT NULL"
        )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS overview.report_snapshots")
    op.execute("DROP TABLE IF EXISTS overview.report_versions")
    op.execute("DROP TABLE IF EXISTS overview.reports")
