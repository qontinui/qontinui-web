"""Enable ``pg_stat_statements`` — a one-line CREATE EXTENSION, not a reboot.

Three consecutive plans recorded that turning this on requires adding
``pg_stat_statements`` to ``shared_preload_libraries`` and therefore a database
**reboot**, and each deferred it on that basis. **That is false, and the
correction is measured**, against coord prod (``qontinui_db``, PG 16.13,
instance ``qontinui-staging``) on 2026-08-07 via a read-only throwaway ECS
probe:

* ``shared_preload_libraries`` is already
  ``rdsutils,pg_tle,pg_stat_statements,rds_casts`` — the library is **loaded**.
* ``pg_stat_statements.max = 5000`` and ``pg_stat_statements.track = top`` are
  live GUCs, so the collector has been accumulating statistics all along.
* What is missing is only the SQL-level extension:
  ``pg_available_extensions`` reports ``default_version = 1.10`` with
  ``installed_version = NULL``, and ``pg_extension`` holds no row.

So the shared-memory half — the half that genuinely needs a reboot — is already
in place. This revision creates the SQL objects that expose it. **No reboot, no
parameter-group change, no downtime.**

Why it is worth a migration
==============================================================================

Its absence has already cost real time twice. Two separate production
query-attribution phases had to substitute ``pg_stat_activity`` sampling and
``pg_stat_user_tables`` counter deltas for it, each turning into a multi-hour
throwaway-ECS expedition to recover numbers ``pg_stat_statements`` reports
directly. With the extension present, the same attribution is a ~5-minute
query.

Privileges — VERIFIED, not assumed
==============================================================================

``pg_stat_statements`` is **not** a trusted extension
(``pg_available_extension_versions.trusted = false``,
``superuser = true``), so stock PostgreSQL would require a superuser. On RDS the
migrator role ``qontinui_user`` is ``rolsuper = false`` but **is a member of
``rds_superuser``**, and RDS permits members of that role to install any
extension named in the ``rds.extensions`` parameter.
``pg_stat_statements`` is on that list and ``rds.allowed_extensions`` is ``*``.

That inference was then **confirmed empirically** rather than trusted: a probe
ran ``CREATE EXTENSION pg_stat_statements`` as ``qontinui_user`` against prod
inside an explicit transaction and rolled it back. The create SUCCEEDED (the
extension appeared, schema ``public``, version 1.10) and the post-rollback
catalog showed no trace. So this revision will not fail on apply.

Substrate note — this applies cleanly in CI too
==============================================================================

``backend-ci.yml`` and ``migration-reversal.yml`` run this chain on
``pgvector/pgvector:pg16``, whose ``shared_preload_libraries`` is **empty** —
which raises the obvious worry that ``CREATE EXTENSION`` would fail there and
red the chain. It does not, and this was checked by running it against that
exact image: ``pg_stat_statements`` ships in the image's contrib set
(``pg_available_extensions`` → 1.10) and ``CREATE EXTENSION`` **succeeds**
without preloading, because the module's ``_PG_init`` returns early rather than
erroring when it was not preloaded. Only *reading the view* fails there, with
``pg_stat_statements must be loaded via shared_preload_libraries``. Creating the
extension is therefore substrate-independent; only its usefulness is not.

Three further workflows (``e2e-tests.yml``, ``cross-browser-survey.yml``,
``style-gate.yml``) ran the chain on ``pgvector/pgvector:pg15`` when this
revision was written, so that image was checked too rather than assumed from
the pg16 result: it also reports ``pg_stat_statements`` 1.10 available, and
``CREATE EXTENSION`` succeeds. Those three were moved to
``pgvector/pgvector:pg16`` on 2026-08-30 to match production (RDS
``qontinui-staging``, engine 16.13), so every workflow that runs this chain is
now on the substrate the paragraph above measured. The pg15 result is kept
because it is a measurement that was actually taken, and because it is what
makes the extension's availability substrate-independent rather than a fact
about one image.

Blast radius, stated because it is wider than a one-line diff suggests: this
revision is the parent of ``coord_alerts_dropmachineidx_01``, so a
``CREATE EXTENSION`` failure on any substrate would take out both migration
tests and every local ``alembic upgrade head``, not just this revision.

Deliberately NOT guarded on availability
==============================================================================

The house has an idiom for "skip when the substrate lacks the thing" (the
``pg_roles`` DO-block in ``consolidation_phase1_01_infrastructure``), and it is
deliberately **not** used here. Availability is *measured* on both substrates
this chain runs against — prod and the CI image — so an availability guard
would buy nothing and would convert an unexpected substrate into a silent skip:
a vacuous green that reports success while leaving the extension absent. An
unguarded statement fails loudly instead, which is the correct behaviour for a
condition already proven to hold.

Schema placement
==============================================================================

Unqualified, matching every other extension this repo creates
(``CREATE EXTENSION IF NOT EXISTS vector`` in
``consolidation_phase1_01_infrastructure`` and ``coord_memory_records``,
``pgcrypto`` in ``coord_tasks_identity_hash``). The extension is relocatable and
lands in the first schema on ``search_path`` — ``public`` on prod, where
``vector`` and ``pgcrypto`` already live. This is emphatically NOT ``coord.*``
schema: an extension is database-scoped, so alembic's sole-authorship rule over
``coord.*`` is not what makes this alembic's job — the fact that alembic is the
only thing that issues DDL to this database is.

Revision ID: coord_pgss_ext_01
Revises: coord_alerts_pagedidx_01
Create Date: 2026-08-07

"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coord_pgss_ext_01"
down_revision: str | None = "coord_alerts_pagedidx_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create the extension. Idempotent via ``IF NOT EXISTS``."""
    op.execute("CREATE EXTENSION IF NOT EXISTS pg_stat_statements")


def downgrade() -> None:
    """Drop the extension — it blinds the reader; it does NOT reset the counters.

    This is worth stating precisely, because the intuitive claim ("dropping
    discards every accumulated statistic") is **wrong**, and an earlier draft of
    this docstring asserted it. It was checked by measurement rather than
    argument, on a ``pgvector/pgvector:pg15`` container started with
    ``-c shared_preload_libraries=pg_stat_statements``: a marker statement was
    executed three times (``calls = 3``), then ``DROP EXTENSION`` and
    ``CREATE EXTENSION`` were issued, and the marker row came back with
    ``calls = 3`` still intact.

    The reason: the counters live in a shared-memory hash allocated by the
    *preloaded module* in its ``shmem_startup_hook``. The extension's catalog
    entries are only a SQL-level window onto that hash. ``DROP EXTENSION``
    removes the window — it does not call ``pg_stat_statements_reset()`` and
    does not touch shared memory. The collector keeps running throughout,
    which is exactly why this migration has value in the first place: prod has
    been accumulating statistics for the whole time the extension was absent.

    So the real cost of a downgrade is narrower than it looks. Nothing is reset;
    what is lost is only what the ``pg_stat_statements.max = 5000`` cap evicts
    during the window in which nobody could read the view — and, of course, the
    ability to read it at all until a later upgrade re-opens the window.

    Written as a real drop rather than a no-op: the sibling
    ``consolidation_phase1_01_infrastructure`` deliberately leaves ``vector``
    in place on downgrade because application tables depend on the ``vector``
    TYPE, so dropping it would orphan columns. Nothing depends on
    ``pg_stat_statements`` — it is a pure observability surface with no column,
    index, or constraint referencing it — so the reversal is clean and the
    revision is genuinely reversible.
    """
    op.execute("DROP EXTENSION IF EXISTS pg_stat_statements")
