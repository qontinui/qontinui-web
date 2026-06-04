"""commit obs gin 01 changed_files GIN index

Revision ID: commit_obs_gin_01
Revises: merge_bypass_audit_01
Create Date: 2026-06-04

Adds a GIN index on ``coord.commit_observations.changed_files`` (JSONB,
the per-commit array of ``{path, status}`` forwarded by the runner
``git_watcher``; created in ``commit_effect_01_coord_commit_tables``).

Motivation: coord's Tier-7 authorship attribution
(``credibility_scorer.rs::load_attributed_authorship``) probes, on every
PR-merge credibility eval,

    changed_files @> jsonb_build_array(jsonb_build_object('path', <p>))

to find which observed commits touched a given file. Without an index this
is a sequential scan of ``coord.commit_observations`` per probe. The GIN
index turns each containment probe into an index lookup.

``jsonb_path_ops`` (not the default ``jsonb_ops``): only the ``@>``
containment operator is probed, so the smaller, faster ``jsonb_path_ops``
opclass is the correct choice (it indexes hashed paths and supports only
``@>``, which is all coord needs). Mirrors the existing ``jsonb_path_ops``
GIN indexes elsewhere in the schema (e.g. ``951df6f04439`` /
``c3a2b1d4e5f6`` / the squashed initial schema).

Plain transactional ``CREATE INDEX`` (no ``CONCURRENTLY``): the table is
young/small, so a brief build-time lock is fine and we keep the migration
inside the alembic transaction.

Closes the GIN open item of the run-tests effect-signatures plan. Deploy
order is independent of the coord query change — coord's containment query
is correct (just slower) without the index, so this can ship before or
after the coord-side change.
"""

from typing import Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "commit_obs_gin_01"
down_revision: Union[str, None] = "merge_bypass_audit_01"
branch_labels: Union[str, None] = None
depends_on: Union[str, None] = None


def upgrade() -> None:
    op.create_index(
        "ix_commit_observations_changed_files_gin",
        "commit_observations",
        ["changed_files"],
        schema="coord",
        postgresql_using="gin",
        postgresql_ops={"changed_files": "jsonb_path_ops"},
    )


def downgrade() -> None:
    op.drop_index(
        "ix_commit_observations_changed_files_gin",
        table_name="commit_observations",
        schema="coord",
    )
