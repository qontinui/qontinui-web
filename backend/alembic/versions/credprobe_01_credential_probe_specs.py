"""coord.credential_probe_specs — the tenant's regional credential-probe catalogue

Revision ID: credprobe_01
Revises: plan_library_10_keyset_walk_indexes
Create Date: 2026-10-09

Phase 3 (qontinui-web half) of plan
``2026-10-09-coord-knows-which-box-holds-which-credential``, design decision
D3. Authored by alembic in ``qontinui-web`` — coord authors zero ``coord.*``
DDL (served policy ``production-and-cost`` ``alembic-sole-authorship``).

What the table is
=================

Runners advertise ``cred:<service>[:<scope>]`` capability tokens, each the
result of a probe the runner itself runs (plan D2). ``cred:gh`` and
``cred:aws-sts`` need no input. A REGIONAL probe does: it needs to know which
read-only, value-free call proves the scope it names. This table is that
catalogue — tenant data served by coord through
``GET /coord/devices/credential-probes``, never a per-box runner setting and
never a secret (D3).

One row per ``(tenant_id, token)``. Columns are exactly D3's:

``token``
    The capability token the probe earns, e.g. ``cred:aws-ssm:eu-central-1``.
``probe_kind``
    Which call the runner makes. A CLOSED enum (Phase 3):
    ``aws_ssm_get_parameter`` (``aws ssm get-parameter --name <canary>``,
    never ``--with-decryption``) and ``aws_ecs_list_clusters``
    (``aws ecs list-clusters --max-items 1``). A new probe ADDS a value to the
    CHECK; it needs no new schema shape.
``region``
    The AWS region the probe runs against. A region is not
    account-identifying, which is why it is the only scope a token carries.
``canary_parameter``
    For ``aws_ssm_get_parameter`` only: the NAME of a tenant-configured,
    non-secret ``String`` SSM parameter. A successful read scopes the token to
    the right account without coord ever learning the account id (D2). NULL
    for every other probe kind.
``enabled``
    The runner runs only enabled specs.
``updated_by`` / ``updated_at``
    Audit of the operator write (``PUT /coord/credential-probe-specs/:token``).

What the database enforces (builtins only)
==========================================

Coord's write route is the validator of record (D1 grammar, D3 secret-shaped
refusal, closed ``probe_kind`` enum). These CHECKs are the floor beneath it,
so a hand DML or a buggy writer cannot put an account id, an ARN or a
secret-shaped canary into coord:

* ``token`` — D1 grammar: ``cred:<service>[:<scope>]``, lowercase
  ``[a-z0-9-]``, at most 3 segments; no 12-digit run (an AWS account id); no
  ``arn:``. ``/``, ``\\``, ``~`` and ``@`` are already outside the charset.
* ``probe_kind`` — the closed enum above.
* ``region`` — AWS region shape (``eu-central-1``, ``us-gov-west-1``).
* The token PROVES THE SCOPE IT NAMES (D2): ``aws_ssm_get_parameter`` rows
  carry exactly ``cred:aws-ssm:<region>``, ``aws_ecs_list_clusters`` rows
  exactly ``cred:aws-ecs:<region>``. A spec whose token names one region and
  whose probe runs in another would advertise a scope nobody measured.
* ``canary_parameter`` — required for ``aws_ssm_get_parameter`` and NULL for
  every other kind; SSM parameter-name charset and length; and it must not
  match the D3 secret-shaped list (``password|secret|token|key|credential``,
  case-insensitive), because a secret-shaped canary would push the probe
  toward reading a SecureString.

``UNIQUE (tenant_id, token)`` is the plan's key and the conflict target for
the operator upsert. Both columns are NOT NULL, so it is the table's key; no
surrogate id is added, because D3 names none and nothing references a row.

Idempotency / authorship posture
================================

* Every statement is ``coord.``-qualified (``alembic-schema-arg-gate``).
* ONE ``CREATE TABLE IF NOT EXISTS`` with every constraint inline (a new table
  holds no rows, so coord's migration classifier reads it as additive) plus a
  ``COMMENT``. No secondary index: the unique key's index leads with
  ``tenant_id``, which is the only read shape (own-tenant list).
* Seeds no rows: the ``cred:aws-ssm:eu-central-1`` seed is an operator act
  through coord's write route (plan Phase 3), never hand DML here.
* This revision was **HAND-AUTHORED**; ``alembic revision --autogenerate`` is
  never run here. Pure DDL, no app imports — the prod migrator lacks app deps.

Ordering
========

This revision must be APPLIED to the serving database before the coord build
that reads ``coord.credential_probe_specs`` deploys (served policy
``production-and-cost`` ``alembic-sole-authorship``). Done-when is
``coord_query_schema_object(table, "credential_probe_specs")`` reading
``existence: present`` — not the merge.

``down_revision``
=================

The single head on qontinui-web ``origin/main`` when this branch was cut
(``plan_library_10_keyset_walk_indexes``). If another revision lands first,
re-point the token below AND the ``Revises:`` line above at the merged head. Do
not author an ``alembic merge`` revision.

Downgrade drops the table.
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "credprobe_01"
down_revision: str | Sequence[str] | None = "plan_library_10_keyset_walk_indexes"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create coord.credential_probe_specs with its D1/D2/D3 CHECKs."""
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.credential_probe_specs (
            tenant_id         UUID NOT NULL
                REFERENCES coord.tenants(tenant_id) ON DELETE CASCADE,
            token             TEXT NOT NULL,
            probe_kind        TEXT NOT NULL,
            region            TEXT NOT NULL,
            canary_parameter  TEXT,
            enabled           BOOLEAN NOT NULL DEFAULT true,
            updated_by        TEXT NOT NULL,
            updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT uq_credential_probe_specs_tenant_token
                UNIQUE (tenant_id, token),
            CONSTRAINT ck_credential_probe_specs_token_grammar
                CHECK (token ~ '^cred:[a-z0-9-]+(:[a-z0-9-]+)?$'),
            CONSTRAINT ck_credential_probe_specs_token_no_account_id
                CHECK (token !~ '[0-9]{12}'),
            CONSTRAINT ck_credential_probe_specs_token_no_arn
                CHECK (strpos(token, 'arn:') = 0),
            CONSTRAINT ck_credential_probe_specs_probe_kind
                CHECK (probe_kind IN ('aws_ssm_get_parameter', 'aws_ecs_list_clusters')),
            CONSTRAINT ck_credential_probe_specs_region_shape
                CHECK (region ~ '^[a-z]{2}(-[a-z]+)+-[0-9]{1,2}$'),
            CONSTRAINT ck_credential_probe_specs_token_names_probe_scope
                CHECK (
                    (probe_kind = 'aws_ssm_get_parameter'
                     AND token = 'cred:aws-ssm:' || region)
                    OR (probe_kind = 'aws_ecs_list_clusters'
                        AND token = 'cred:aws-ecs:' || region)
                ),
            CONSTRAINT ck_credential_probe_specs_canary_iff_ssm
                CHECK ((probe_kind = 'aws_ssm_get_parameter')
                       = (canary_parameter IS NOT NULL)),
            CONSTRAINT ck_credential_probe_specs_canary_charset
                CHECK (canary_parameter IS NULL
                       OR canary_parameter ~ '^[A-Za-z0-9_./-]{1,2048}$'),
            CONSTRAINT ck_credential_probe_specs_canary_not_secret_shaped
                CHECK (canary_parameter IS NULL
                       OR canary_parameter !~* '(password|secret|token|key|credential)'),
            CONSTRAINT ck_credential_probe_specs_updated_by_nonempty
                CHECK (length(btrim(updated_by)) > 0)
        )
        """
    )
    op.execute(
        """
        COMMENT ON TABLE coord.credential_probe_specs IS
        'Tenant catalogue of regional credential probes (plan '
        '2026-10-09-coord-knows-which-box-holds-which-credential D3). One row per '
        '(tenant, cred: token): the closed-enum probe_kind, the region it proves, '
        'and for SSM the NAME of a non-secret String canary parameter. Never a '
        'secret; served to runners by GET /coord/devices/credential-probes and '
        'written only through the coord operator route.'
        """
    )


def downgrade() -> None:
    """Reverse exactly this revision: drop the table."""
    op.execute("DROP TABLE IF EXISTS coord.credential_probe_specs")
