"""coord.onboarding_connect_states (P0 — tenant-bound, single-use GitHub connect-state tokens)

Revision ID: coord_onboarding_connect_states
Revises: appid_01_co_occurrence_app_id
Create Date: 2026-07-28

P0 of ``2026-07-26-coord-onboarding-claim-caller-tenant-binding.md`` — the
migration ONLY. No proxy route, no frontend change, no coord change; those are
P1/P2 and must deploy AFTER this table exists (plan §5, producer-before-consumer).

The defect this table closes
============================

``POST /coord/onboarding/github-accounts/claim`` proves that the *code author*
administers the target GitHub org, then binds that org to the tenant taken from
the *caller's bearer* — two values that are never cross-checked. A never-bound
org is therefore claimable by any caller holding a valid OAuth code plus any
coord bearer. The remediation makes the destination tenant an intrinsic,
server-recorded property of the connect flow: the initiator mints a token under
its own authenticated identity, the token rides GitHub's ``state`` round-trip,
and the claim binds to the tenant recorded on the ROW rather than to whoever
presents the callback.

This migration stands up the store for that token. coord OWNS reads/writes;
web only authors the DDL. Per fleet policy coord authors ZERO ``coord.*`` DDL,
so THIS web migration is the sole DDL author.

Schema
======

* ``token_hash VARCHAR(64) PRIMARY KEY`` — lowercase **sha256 hex** of the
  opaque 256-bit token. The token itself is NEVER stored.
* ``tenant_id UUID NOT NULL``           — the initiating tenant. This is the
  authoritative bind target: the claim binds to *this* value, not to the
  caller's bearer tenant.
* ``created_at TIMESTAMPTZ NOT NULL``   — mint time.
* ``expires_at TIMESTAMPTZ NOT NULL``   — ~15 min TTL, set by the minting
  handler (not a column default — the TTL is the consumer's policy).
* ``consumed_at TIMESTAMPTZ NULL``      — single-use marker, NULL until the
  token is spent.

Why sha256 hex and NOT the repo's Argon2 convention
===================================================

The nearest existing precedent, ``runner_tokens.token_hash``
(``add_runner_tokens_and_runners.py``), is ``VARCHAR(255)`` holding an **Argon2**
hash — widened from the legacy SHA-256-hex ``VARCHAR(64)`` precisely to fit
Argon2. Copying that precedent here would break the design. Argon2 is salted, so
every verification is a per-row comparison: there is no ``WHERE token_hash = $1``,
and the atomic single-use consume the fix depends on —

    UPDATE coord.onboarding_connect_states
       SET consumed_at = now()
     WHERE token_hash = $1 AND consumed_at IS NULL
    RETURNING tenant_id

— degrades to a full-table scan plus a TOCTOU race. The affected-row count of
that statement IS the single-use gate, so an O(1) indexed equality lookup is
load-bearing.

Argon2 is correct for ``runner_tokens``: a long-lived, possibly low-entropy user
credential where slow hashing buys offline-brute-force resistance. It is wrong
here. This token is 256-bit CSPRNG output with a 15-minute TTL, so there is no
brute-force margin to buy. Unsalted sha256 hex, as the primary key.

Index
=====

* PK on ``token_hash`` — the mint INSERT and both halves of the consume
  (the step-0 ``SELECT`` and the atomic ``UPDATE``).
* ``idx_ocs_expires`` on ``(expires_at)`` — **load-bearing, not optional.** The
  plan resolved expiry to a *lazy delete-on-mint* rather than a background
  sweeper (a periodic task can silently become inert and still look healthy;
  lazy delete has no such state — if minting works the sweep ran). The mint
  handler therefore runs, in the same transaction as its INSERT, a bounded

      DELETE FROM coord.onboarding_connect_states
       WHERE token_hash IN (SELECT token_hash
                              FROM coord.onboarding_connect_states
                             WHERE expires_at < now()
                             LIMIT 1000)

  on the connect critical path. Without this index that reap is a sequential
  scan on every mint.

Retention is deliberate: the reap keys on ``expires_at < now()``, NOT on
``consumed_at IS NOT NULL``. Consumed-but-unexpired rows are kept for their full
TTL so a replayed token returns the single-use rejection rather than the
indistinguishable "unknown token".

Boot gate: this table is deliberately NOT added to coord's or the runner's
``require_table`` set — the mint endpoint is not load-bearing at startup, so a
missing table must not crash-loop a boot. The P1 consumer does pure DML
(``INSERT`` / ``SELECT`` / ``UPDATE`` / ``DELETE``), which keeps
``tests/coord_schema_authorship.rs`` (bans ALL Rust ``coord.*`` DDL, no
allowlist) green with zero changes.

Idempotency: ``CREATE TABLE/INDEX IF NOT EXISTS`` up, ``DROP INDEX/TABLE IF
EXISTS`` down — reversible for the ``migration-reversal`` gate.

Chains off ``appid_01_co_occurrence_app_id``, the single live head on ``main``
at authoring time (2026-07-28; the plan was written against
``memory_jobs_02_kind_aware_dedupe``, which has since been superseded). If a
concurrent head-race moves ``main``'s head before this lands, re-point
``down_revision`` onto the new head.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
# Keep ``down_revision`` on ONE physical line — the ``alembic-heads-pr`` CI gate
# parses it with a line-based regex.
revision: str = "coord_onboarding_connect_states"
down_revision: str | Sequence[str] | None = "appid_01_co_occurrence_app_id"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create ``coord.onboarding_connect_states`` + the expiry index. Idempotent."""
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.onboarding_connect_states (
            token_hash   VARCHAR(64) PRIMARY KEY,
            tenant_id    UUID NOT NULL,
            created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
            expires_at   TIMESTAMPTZ NOT NULL,
            consumed_at  TIMESTAMPTZ
        )
        """
    )
    # Lazy delete-on-mint reap scan; runs on the connect critical path.
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_ocs_expires
            ON coord.onboarding_connect_states (expires_at)
        """
    )


def downgrade() -> None:
    """Drop ``coord.onboarding_connect_states`` + the expiry index."""
    op.execute("DROP INDEX IF EXISTS coord.idx_ocs_expires")
    op.execute("DROP TABLE IF EXISTS coord.onboarding_connect_states")
