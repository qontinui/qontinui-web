"""twin clienttel 01 coord.client_telemetry_observations — Ξ_ClientTelemetry DriftVerdict oplog

Revision ID: twin_clienttel_01_coord_client_telemetry_observations
Revises: bridge_audit_log_02
Create Date: 2026-06-03

NOTE: chains linearly off ``bridge_audit_log_02``. ``origin/main`` had a
pre-existing 2-head fork (``bridge_audit_log_02`` + ``twin_auth_01_coord_auth_observations``,
both off the shared ``agent_tool_access_01`` parent). A separate standard
``alembic merge`` revision (``merge_clienttel_auth_heads``) reconciles this
migration's head with ``twin_auth_01`` back to a single head — kept separate
because the verify-claim / alembic-heads gates parse ``down_revision``
textually and don't support a multi-parent tuple on a content migration.

Phase 3 of the digital-twin Production Client Telemetry layer plan
(``D:/qontinui-root/plans/2026-05-31-twin-client-telemetry-layer.md`` §3 / §4.3).

Creates ``coord.client_telemetry_observations`` — an **append-only oplog** of the
per-surface Ξ_ClientTelemetry DriftVerdict evaluations. Each row is ONE
observation of a ``(surface, origin, release, invariant)`` declared-vs-actual
pair, evaluated by the leader-gated coord observer (plan §4.3) against the
windowed aggregate the *bought* client-telemetry backend exposes (plan §3.5 —
the §3.1 event schema is the read contract we consume, NOT an ingest path we
author here). The D6 ``coverage`` / ``credibility`` columns carry the
observation-space confidence pair (both in ``[0,1]``).

This is the **client-side sibling of ``coord.error_observations``** (the
server-side Ξ_Log oplog, ``twin_06``): the production browser runtime on real
user networks is the new executor boundary no other observer reaches (plan §1.1
— proven by the ``proj_prod_frontend_api_url_was_web_staging`` worked example).
Where ``error_observations`` rolls up server-side 5xx/error windows, this rolls
up the *structural* drift verdicts (host-integrity / cors-health /
auth-callback-health / error-budget) the browser-sourced telemetry yields.

Design notes (mirrors ``twin_06_coord_error_observations`` /
``twin_05_coord_health_observations`` conventions):

* ``drift_class`` / ``invariant`` / ``d3_outcome`` are TEXT + CHECK rather than
  PG enums — same rationale as ``coord.release_observations.drift_class`` /
  ``coord.health_observations.health_class``: text+CHECK evolves without
  ``ALTER TYPE`` acrobatics. ``drift_class`` uses the **canonical**
  declared-vs-actual taxonomy (``twin_verdict.rs`` ``CanonicalDriftClass``);
  ``drift_subclass`` carries the namespaced ``client:*`` sub-class (plan §4.1 —
  never a new top-level class). ``d3_outcome`` is the effect-calculus five-way
  outcome.
* **down = blind-spot** invariant (plan §4.2 "credibility-gates-the-gate") is
  load-bearing: low traffic / a beacon that itself cannot reach ingest is
  ``drift_class='unknown'`` with ``coverage<1`` (→ ``d3_outcome='Partial'``,
  degrade to surface/Escalate) — NEVER a confident ``'none'`` "all clear". A
  clean high-coverage observation is ``drift_class='none'`` at ``coverage>=1``.
  These are different and stay distinguishable.
* No unique constraint — this is intentionally a history oplog; the same
  ``(surface, origin, release, invariant)`` tuple recurs every observation tick.
* ``release`` is the bundle build-id / deploy SHA the observation belongs to
  (nullable — low-traffic / unresolved release), so the continuous post-deploy
  gate (plan §4.3) can key the new release's verdicts against the prior baseline.
* ``carve_out`` / ``components`` are the DriftVerdict envelope's JSONB members
  (plan §4.1 / ``twin_verdict.rs``): ``carve_out`` is the first-class admitted
  exclusions (third-party hosts, below-sample routes), ``components`` the raw
  sub-verdict breakdown (e.g. per-host cors rates).
* One index: ``(surface, origin, observed_at DESC)`` — the hot query (the latest
  verdict per surface+origin, used by the MCP tool + the post-deploy gate's
  per-release scan).
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "twin_clienttel_01_coord_client_telemetry_observations"
down_revision: str = "bridge_audit_log_02"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


# Canonical declared-vs-actual drift taxonomy — keep in sync with the coord-side
# ``twin_verdict.rs`` ``CanonicalDriftClass``. The namespaced ``client:*``
# sub-class lives in the separate ``drift_subclass`` column (plan §4.1).
_DRIFT_CLASSES = (
    "none",
    "benign_add",
    "pending",
    "in_place",
    "active_negation",
    "divergent",
    "unknown",
)

# The declared-vs-actual invariant pairs (plan §4.1). Keep in sync with the
# coord-side ``client_telemetry_observer`` Invariant enum.
_INVARIANTS = (
    "host_integrity",
    "cors_health",
    "auth_callback_health",
    "error_budget",
)

# The effect-calculus five-way outcome (plan §4.1 / declared-vs-actual §3.2).
_D3_OUTCOMES = (
    "Confirmed",
    "Surprise",
    "Failure",
    "Contradiction",
    "Partial",
)


def upgrade() -> None:
    op.create_table(
        "client_telemetry_observations",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column(
            "observed_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        # Telemetry surface: 'web' (v1). Forward-compat seam (plan §7 Q7):
        # 'mobile_webview' / runner-webviews land later without a re-design.
        sa.Column("surface", sa.Text(), nullable=False),
        # The page origin the bundle is running ON, e.g. 'https://qontinui.io'.
        sa.Column("origin", sa.Text(), nullable=False),
        # The bundle build-id / deploy SHA. NULL when the observer could not
        # resolve it for the window (unknown / low-traffic).
        sa.Column("release", sa.Text(), nullable=True),
        # The declared-vs-actual invariant evaluated (plan §4.1).
        sa.Column("invariant", sa.Text(), nullable=False),
        # Canonical drift class (twin_verdict.rs CanonicalDriftClass).
        sa.Column("drift_class", sa.Text(), nullable=False),
        # The namespaced client:* sub-class (plan §4.1 drift taxonomy). NULL for
        # the no-drift / unknown cases that have no sub-class.
        sa.Column("drift_subclass", sa.Text(), nullable=True),
        # The effect-calculus five-way outcome.
        sa.Column("d3_outcome", sa.Text(), nullable=False),
        # D6 posterior in [0,1] — the drift probability.
        sa.Column("posterior", sa.Float(precision=53), nullable=False),
        # D6 coverage in [0,1]. <1 when low-traffic / blind (down=blind-spot —
        # never a confident 'none' all-clear).
        sa.Column(
            "coverage",
            sa.Float(precision=53),
            nullable=False,
            server_default=sa.text("1.0"),
        ),
        # Aggregation lag (plan §4.2): how stale the windowed aggregate is, in
        # seconds. NULL when not applicable / unknown.
        sa.Column("staleness_seconds", sa.BigInteger(), nullable=True),
        # Observer identity, e.g. 'coord_client_telemetry_observer',
        # 'client_telemetry_observations_oplog_fallback'.
        sa.Column("provenance", sa.Text(), nullable=False),
        # D6 credibility in [0,1].
        sa.Column(
            "credibility",
            sa.Float(precision=53),
            nullable=False,
            server_default=sa.text("0.0"),
        ),
        # DriftVerdict envelope: the first-class carve-out (admitted exclusions —
        # third-party hosts, below-sample routes). plan §4.1.
        sa.Column(
            "carve_out",
            postgresql.JSONB(),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
        # DriftVerdict envelope: the raw sub-verdict component breakdown.
        sa.Column(
            "components",
            postgresql.JSONB(),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        sa.CheckConstraint(
            "drift_class IN ('none','benign_add','pending','in_place',"
            "'active_negation','divergent','unknown')",
            name="client_telemetry_observations_drift_class_chk",
        ),
        sa.CheckConstraint(
            "invariant IN ('host_integrity','cors_health',"
            "'auth_callback_health','error_budget')",
            name="client_telemetry_observations_invariant_chk",
        ),
        sa.CheckConstraint(
            "d3_outcome IN ('Confirmed','Surprise','Failure',"
            "'Contradiction','Partial')",
            name="client_telemetry_observations_d3_chk",
        ),
        schema="coord",
    )

    # Hot lookup: the latest verdict per surface+origin, newest-first
    # (``WHERE surface = $1 AND origin = $2 ORDER BY observed_at DESC`` — the MCP
    # tool's per-(release,surface,origin) read + the post-deploy gate scan).
    op.create_index(
        "idx_client_telemetry_observations_surface_origin_observed_at",
        "client_telemetry_observations",
        ["surface", "origin", sa.text("observed_at DESC")],
        schema="coord",
    )


def downgrade() -> None:
    op.drop_index(
        "idx_client_telemetry_observations_surface_origin_observed_at",
        table_name="client_telemetry_observations",
        schema="coord",
    )
    op.drop_table("client_telemetry_observations", schema="coord")


# Touch the unused-symbol constants so linters don't complain — mirrors the
# pattern in twin_06_coord_error_observations / twin_05_coord_health_observations.
_ = (_DRIFT_CLASSES, _INVARIANTS, _D3_OUTCOMES)
