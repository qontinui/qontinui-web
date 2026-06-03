"""twin auth 01 coord.auth_observations — Ξ_Auth observation oplog

Revision ID: twin_auth_01_coord_auth_observations
Revises: coord_conflict_res_auto_rewrite_method
Create Date: 2026-06-03

Phase 2 of the digital-twin auth/tenancy/identity-layer plan
(``D:/qontinui-root/plans/2026-05-31-twin-auth-identity-layer.md``, §4.1).

Creates ``coord.auth_observations`` — an **append-only oplog** of the Ξ_Auth
(auth / tenancy / identity) declared-vs-actual observations. Each row is one
observation of one auth surface: an IdP, an app client, a callback, a
group→role mapping, or a tenancy membership. The coord-side auth observer
writes these rows (tenancy-table SQL read + declared-mapping parse in Phase 2;
the live Cognito describe dimension lands in Phase 3). The hot queries are
"the latest observation per ``kind``" and "stale surfaces" (``observed_at``
window).

**Value-safety (plan §4.1 / §5 — binding):** this table carries NO
secret-bearing column. Only *names*, *config shape*, and *verdicts* are stored
— never a token string, a Cognito client secret, an IdP ``ProviderDetails``
secret, or an SSM value. The coord-side ``persist_observations`` write boundary
hard-asserts that no ``components`` / ``provenance`` field carries a
secret-bearing key (mirror of ``config_observation_watcher::persist_observations``).
The schema below is intentionally name/config/verdict-only so there is nowhere
for a secret value to land.

Design notes (mirrors ``twin_04_coord_config_observations`` /
``twin_02_coord_infra_drift_observations`` conventions):

* ``kind`` is TEXT + CHECK rather than a PG enum — same rationale as the sibling
  observation tables (``coord.infra_drift_observations.drift_class`` /
  ``coord.alerts.severity``): text+CHECK evolves without ``ALTER TYPE``
  acrobatics. ``kind`` is the closed, contract-bound set; keep it in sync with
  the coord-side auth observer (built against this same contract).
* ``drift_class`` and ``d3_outcome`` are left as free TEXT (no CHECK): they are
  NULL for pure-observation (Nature B) rows, and their vocabularies (the §3.3
  construct drift enum and the D3 five-outcome enum) are derived/calibrated on
  the coord side via the ``DriftVerdict`` envelope rather than constrained here.
* ``components`` / ``carve_out`` / ``provenance`` / ``credibility`` are JSONB —
  the classified declared↔actual deltas (NAMES/CONFIG only), the auditable
  carve-out C, the ``{actual_observer, declared_observer, source}`` provenance,
  and the ``(causal, authorial, boundary)`` credibility triple, respectively.
* No unique constraint — this is intentionally a history oplog; the same
  ``kind`` recurs every observation tick.
* Two indexes mirror the sibling query patterns: a btree on
  ``(kind, observed_at DESC)`` for the latest-per-kind lookup, and one on
  ``observed_at DESC`` for the latest-observation / staleness window.
* A CREATE TABLE is pure-expand (forward-only / expand-contract safe).
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "twin_auth_01_coord_auth_observations"
down_revision: str = "agent_tool_access_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


# Allowed observation kinds — keep in sync with the coord-side auth observer
# (built against this same contract).
_KINDS = ("idp", "client", "callback", "group_mapping", "membership")


def upgrade() -> None:
    op.create_table(
        "auth_observations",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column(
            "observed_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        # One of 'idp' / 'client' / 'callback' / 'group_mapping' / 'membership'.
        sa.Column("kind", sa.Text(), nullable=False),
        # §3.3 construct enum: none|benign_add|in_place|active_negation|
        # divergent|unknown. NULL for pure-observation (Nature B) rows.
        sa.Column("drift_class", sa.Text(), nullable=True),
        # D3 outcome: Confirmed|Surprise|Failure|Contradiction|Partial.
        # NULL for pure-observation rows.
        sa.Column("d3_outcome", sa.Text(), nullable=True),
        # Classified declared↔actual deltas (NAMES/CONFIG only, never secrets).
        sa.Column(
            "components",
            postgresql.JSONB(),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
        # Auditable carve-out C (expected-to-differ fields).
        sa.Column(
            "carve_out",
            postgresql.JSONB(),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
        # D6 coverage in [0,1].
        sa.Column("coverage", postgresql.REAL(), nullable=True),
        # Staleness of the underlying observation, in seconds.
        sa.Column("staleness_seconds", sa.Integer(), nullable=True),
        # {actual_observer, declared_observer, source} — observer identity.
        sa.Column(
            "provenance",
            postgresql.JSONB(),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        # (causal, authorial, boundary) credibility triple.
        sa.Column(
            "credibility",
            postgresql.JSONB(),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        sa.CheckConstraint(
            "kind IN ('idp','client','callback','group_mapping','membership')",
            name="auth_observations_kind_chk",
        ),
        schema="coord",
    )

    # Latest-per-kind lookup: ``ORDER BY observed_at DESC LIMIT 1`` per kind.
    op.create_index(
        "idx_auth_observations_kind_observed_at",
        "auth_observations",
        ["kind", sa.text("observed_at DESC")],
        schema="coord",
    )

    # Latest-observation / staleness window
    # (``ORDER BY observed_at DESC LIMIT 1``).
    op.create_index(
        "idx_auth_observations_observed_at",
        "auth_observations",
        [sa.text("observed_at DESC")],
        schema="coord",
    )


def downgrade() -> None:
    op.drop_index(
        "idx_auth_observations_observed_at",
        table_name="auth_observations",
        schema="coord",
    )
    op.drop_index(
        "idx_auth_observations_kind_observed_at",
        table_name="auth_observations",
        schema="coord",
    )
    op.drop_table("auth_observations", schema="coord")


# Touch the unused-symbol import so linters don't complain — mirrors the
# pattern in twin_04_coord_config_observations.
_ = _KINDS
