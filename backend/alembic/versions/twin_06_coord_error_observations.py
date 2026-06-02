"""twin 06 coord.error_observations — Ξ_Log windowed error-rollup oplog

Revision ID: twin_06_coord_error_observations
Revises: twin_05_coord_health_observations
Create Date: 2026-06-02

Phase 3 of the digital-twin Runtime Health & Error/Log layer plan
(``D:/qontinui-root/plans/2026-05-31-twin-health-and-log-layer.md`` §3).

Creates ``coord.error_observations`` — an **append-only oplog** of *windowed
rollups* of the per-surface Ξ_Log (error / 5xx event stream). Each row is one
``(surface, release, fingerprint)`` bucket over a ``[window_start, window_end)``
window: the dedup ``fingerprint`` (normalized class + top frames + route +
status), a rolled-up ``count``, and ONE scrubbed exemplar (``sample_event``).
The D6 ``coverage`` / ``credibility`` columns carry the observation-space
confidence pair (both in ``[0,1]``).

Design notes (mirrors ``twin_05_coord_health_observations`` /
``twin_03_coord_release_observations`` conventions):

* This is a **windowed rollup**, NOT raw-on-pull (plan §3): the CloudWatch-Logs
  observer tails the log groups on a cadence and writes one bucket row per
  ``(surface, release, fingerprint)`` per window — never a raw log line per
  row. ``coord_recent_errors`` reads these rollups; tailing CloudWatch on every
  MCP call would be slow + rate-limited.
* **Allowlist-not-denylist scrubbing** (plan §2.2 / §3, Q5 resolved): the
  ``sample_event`` JSONB carries ONLY the normalized error class + symbol frames
  + route template (the allowlisted fields). Raw request/response bodies are
  DROPPED at the observer before this row is built. The fingerprint is the v1
  dedup key; message-template clustering is deferred.
* **down = blind-spot** invariant (plan §1.3) is load-bearing: a log-group read
  that FAILS (IAM denied / throttled / unreachable) is recorded as a window with
  ``coverage<1`` — NEVER "0 errors". An empty SUCCESSFUL read is genuinely zero
  errors at ``coverage=1``. These are different and must stay distinguishable;
  the column shape supports both (a blind window is a row with ``count=0`` and
  ``coverage<1`` whose ``fingerprint`` names the gap, vs a clean window which
  simply has no error rows).
* No unique constraint — this is intentionally a history oplog; the same
  ``(surface, fingerprint, …)`` tuple recurs across windows.
* ``release`` is the deployed SHA / release the errors belong to (nullable —
  the observer may not always resolve it), so a rollup can be attributed to the
  release in flight (the ``rate_vs_baseline`` consumer keys on it).
* ``sample_event`` is JSONB holding the single scrubbed exemplar; ``http_status``
  / ``error_class`` / ``route_template`` are denormalized out of it for cheap
  filtering in the rollup read.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "twin_06_coord_error_observations"
down_revision: str = "twin_05_coord_health_observations"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


# The Ξ_Log surfaces this observer rolls up — keep in sync with the coord-side
# ``error_observer`` Surface enum (built against this same contract). Documented
# here (not a CHECK) because the surface set is open-ended (new log groups may
# be added) and an over-tight CHECK would block a forward-compatible observer.
_ERROR_SURFACES = (
    "coord",
    "web",
    "migrator",
)


def upgrade() -> None:
    op.create_table(
        "error_observations",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        # The rollup window [window_start, window_end). Both NOT NULL — every
        # row is a windowed bucket, never an instantaneous event.
        sa.Column("window_start", sa.DateTime(timezone=True), nullable=False),
        sa.Column("window_end", sa.DateTime(timezone=True), nullable=False),
        # Ξ_Log surface: 'coord' | 'web' | 'migrator' (the CloudWatch log group).
        sa.Column("surface", sa.Text(), nullable=False),
        # The deployed SHA / release the errors belong to. NULL when the observer
        # could not resolve it for the window.
        sa.Column("release", sa.Text(), nullable=True),
        # The dedup key: (surface, release, error_class_norm, top_frames,
        # route_template, http_status?) hashed/serialized. NOT NULL — every
        # bucket has a fingerprint (a blind window uses a sentinel fingerprint
        # naming the coverage gap).
        sa.Column("fingerprint", sa.Text(), nullable=False),
        # The normalized error class (e.g. 'pg_error', 'panic', 'http_5xx').
        # NULL when not classifiable.
        sa.Column("error_class", sa.Text(), nullable=True),
        # The matched route template (e.g. '/api/v1/sessions/{id}'). NULL when
        # the event carries no route.
        sa.Column("route_template", sa.Text(), nullable=True),
        # The HTTP status, when the event is a response error. NULL otherwise.
        sa.Column("http_status", sa.Integer(), nullable=True),
        # The rolled-up count for this (surface, release, fingerprint) bucket in
        # the window. A blind window carries count=0 + coverage<1.
        sa.Column("count", sa.BigInteger(), nullable=False),
        # ONE scrubbed exemplar — allowlisted fields only (normalized class +
        # symbol frames + route template). NO raw bodies (plan §2.2 / §3).
        sa.Column("sample_event", postgresql.JSONB(), nullable=True),
        # D6 coverage in [0,1]. <1 when the log-group read was blind/partial
        # (down=blind-spot — never "0 errors").
        sa.Column(
            "coverage",
            sa.Float(precision=53),
            nullable=False,
            server_default=sa.text("1.0"),
        ),
        # Observer identity, e.g. 'cloudwatch_filter_log_events',
        # 'error_observations_oplog_fallback'.
        sa.Column("provenance", sa.Text(), nullable=False),
        # D6 credibility in [0,1].
        sa.Column(
            "credibility",
            sa.Float(precision=53),
            nullable=False,
            server_default=sa.text("0.0"),
        ),
        sa.Column(
            "source",
            sa.Text(),
            nullable=False,
            server_default=sa.text("'coord_error_observer'"),
        ),
        schema="coord",
    )

    # Hot lookup (plan §3 names this index): the recent windows per surface,
    # newest-first (``WHERE surface = $1 [AND window_start >= $since]
    # ORDER BY window_start DESC`` — the coord_recent_errors rollup read +
    # the rate_vs_baseline trailing-window scan).
    op.create_index(
        "idx_error_observations_surface_window",
        "error_observations",
        ["surface", sa.text("window_start DESC")],
        schema="coord",
    )


def downgrade() -> None:
    op.drop_index(
        "idx_error_observations_surface_window",
        table_name="error_observations",
        schema="coord",
    )
    op.drop_table("error_observations", schema="coord")


# Touch the unused-symbol constant so linters don't complain — mirrors the
# pattern in twin_05_coord_health_observations / twin_03_coord_release_observations.
_ = _ERROR_SURFACES
