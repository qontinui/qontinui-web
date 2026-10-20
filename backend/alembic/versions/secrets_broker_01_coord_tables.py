"""coord: the secrets broker's twin tables, and the tenant's broker device on fleet policy

Phase 3 of plan
``qontinui-dev-notes/plans/2026-10-20-secrets-broker-agents-act-on-secrets-never-see-them.md``
(design decision D4, "twin state lives in coord tables").

WHY THIS EXISTS
---------------
The secrets broker (a new, stateless service on one TRUSTED box) performs
allowlisted operations that need a token or a password, so that an agent is not
handed one. Everything the broker does is reported into coord, and coord serves it as
the ``secrets_broker`` digital-twin subspace. These four tables are where those
reports land, and the new fleet-policy column is how coord decides which device
is allowed to send them.

TWIN REDACTION IS A REQUIREMENT, AND THIS SCHEMA ENFORCES IT BY CONSTRUCTION
---------------------------------------------------------------------------
coord, web and the page receive only **references**
(``ssm:eu-central-1:/qontinui/operator/password``), **metadata** (type, scopes,
rotation and expiry dates from describe calls) and **keyed fingerprints**
(HMAC-SHA256 under a broker-local key, truncated to 16 lowercase hex). No column
in this revision is free text, and none is shaped to hold a secret value:

* every reference column is CHECKed against the broker's reference grammar
  (``ssm:<region>:/<path>``, ``ssm:<region>:<name>`` for a non-hierarchical
  parameter, ``sm:<region>:<name>[#json-key]``), the same grammar the
  broker's ``reference`` crate rejects everything else by;
* every fingerprint is CHECKed to be exactly 16 lowercase hex characters, and
  an op carries at most 2 (``cardinality(fingerprints) <= 2``): the plan's
  ops resolve at most two values each (``qontinui.test_login_state`` reads an
  email and a password; ``github.set_actions_secret`` the App key and the
  secret it seals; ``github.git_credential``, ``github.exec`` and
  ``tailscale.auth_key`` one credential each);
* every array column (``secret_refs``, ``fingerprints``, ``scopes``) is
  validated ELEMENT BY ELEMENT (a strict jsonpath over ``to_jsonb``). That
  makes each element's rule hold for each element; it does NOT stop a value
  being split across elements (see the residual);
* ``op`` (dotted lowercase, <= 96), ``refusal_rule`` (lowercase, <= 96) and
  ``action`` (``ssm`` | ``secretsmanager`` | ``kms`` then a letters-only
  PascalCase IAM action) are this system's own vocabulary, so ``op`` and
  ``refusal_rule`` also refuse a run of 12 digits and a run of 16 hex
  characters;
* ``principal`` is ``user/[<path>/]<name>`` or ``role/[<path>/]<name>`` in
  IAM's own charset (``[A-Za-z0-9+=,.@_-]``, name <= 64), refusing ``arn:`` in
  any case. It deliberately does NOT refuse digit or hex runs: real IAM names
  carry them (SSO roles end in a 16-hex suffix, Terraform ``name_prefix``
  roles in a long digit run), and a refused exposure row would silently
  vanish from Phase 9's "agent principals that can read = 0" count;
* the inventory's ``scopes`` elements come from a closed prefix set:
  ``kms:alias/<name>``, ``tier:standard|advanced|intelligent-tiering``,
  ``rotation:enabled|disabled``, ``user/…`` / ``role/…`` (the consumers, the
  principal rule above), ``ecs:<cluster>/<service>`` and ``tag:<key>`` (AWS's
  tag-key charset including spaces, <= 128). Every element refuses ``arn:``;
  the non-principal ones also refuse a 12-digit and a 16-hex run;
* a mint's ``scope`` is a JSON object whose keys are fixed per ``kind``, with
  a size cap, and every nested value is constrained too (``jsonb_path_exists``
  over ``like_regex``): for a GitHub installation token, ``repos`` is 1..100
  ``owner/name`` strings (owner <= 39, name <= 100) and ``permissions`` maps
  ``^[a-z_]{1,64}$`` keys to ``read`` | ``write`` | ``admin``; for a Tailscale
  auth key, ``tags`` is 1..32 ``tag:<name>`` strings (name <= 64),
  ``ephemeral`` a boolean and ``reusable`` an optional boolean.

**The residual, stated completely.** The schema refuses a value by SHAPE; it
cannot refuse a value spelled to look like a legitimate entry, and two classes
of that are coord ingest's to refuse:

1. **A value that fits a name grammar.** ``principal`` (``user/<base64>`` and
   ``role/ghp_…`` are accepted, and IAM names may contain digit runs, so an
   account id embedded in a name is accepted too), the ``user/``, ``role/``,
   ``tag:``, ``kms:alias/`` and ``ecs:`` scopes, ``op``, ``refusal_rule``,
   ``action``, the references (an ``ssm:`` or ``sm:`` name may be an
   alphanumeric token; an ``sm:`` name may also contain ``+``, ``=`` and
   ``/``, as base64 does), the ``repos`` elements (``x/ghp_<36>`` fits), the
   permission keys and the mint tags.
2. **A value chunked into fingerprint- or uuid-shaped pieces.** Each
   ``fingerprints`` element and each ``fingerprint16`` is 16 hex, so the two
   fingerprints an op may carry hold 32 hex of anything, and every ``uuid``
   column (``id``, ``tenant_id``, ``device_id``, ``agent_session_id``,
   ``op_id``, ``secrets_broker_device_id``) holds 32 hex. The cardinality cap
   bounds the fingerprint channel; it does not close it.

Shape cannot refuse those without also refusing real entries, so the schema
does not try: coord's ingest route owns refusing them (its value-shape guard
rejects a high-entropy field) and must REJECT LOUDLY, a 422 naming the column
plus a coord finding, never drop a refused row silently. The schema is the
second, independent door for everything else, and the test pins every member
of the residual with an accept test so it cannot be mistaken for coverage.
``tests/test_secrets_broker_01_migration.py`` asserts the absence of any
value-shaped column and plants the canary in five raw forms (the literal, its
JSON-escaped form, base64, hex, and a 12-digit run) into every text column
(``secret_refs``, ``ref``, ``secret_ref``, ``fingerprints``, ``fingerprint16``,
``op``, ``refusal_rule``, ``scopes``, ``principal``, ``action``, and the six
closed-vocabulary columns ``outcome``, ``kind``, ``delivered_to``, ``store``,
``type``, ``decision``) and every
nested mint-scope position (``repos`` element, ``permissions`` key and value,
``tags`` element), asserting the named CHECK refuses each. It plants wrapped
forms only where a column carries its own digit/hex refusal (``op``,
``refusal_rule``, the ``tag:``/``kms:alias/``/``ecs:`` scopes) plus ``action``,
plants a separator inside one element of every array column, and refuses a
third fingerprint, so these guards are a test that can fail rather than a
comment.

NO ARN IN COORD
---------------
Matching qontinui-coord ``agent_placement.rs`` (the credential vocabulary
refuses ARNs) and plan
``2026-10-09-coord-knows-which-box-holds-which-credential`` D1, an exposure
row's principal stores ``user/`` or ``role/`` names, never an ARN (the CHECK
refuses ``arn:`` in any case). IAM names may contain digit runs, so refusing an
account id embedded in a name is coord ingest's job (residual); the broker
asserts the account itself, outside coord.

WHAT THIS ADDS
--------------

``coord.secrets_broker_ops`` — the broker's audit log, one row per operation it
was asked to perform:

* ``id`` — broker-generated, so a retried outbox drain is idempotent
  (``ON CONFLICT (id) DO NOTHING`` on coord's side) rather than a duplicate;
* ``tenant_id`` — from the CALLER's verified coord JWT;
* ``device_id`` / ``agent_session_id`` — the caller (who asked), from the
  same verified claims. ``agent_session_id`` is NULL for a device-level call;
* ``op`` — the allowlisted operation name (``github.set_actions_secret``);
* ``secret_refs`` — the references the operation touched;
* ``outcome`` — ``ok`` | ``refused`` | ``error``; ``refusal_rule`` names the
  rule that refused, and is present exactly when ``outcome = 'refused'``;
* ``fingerprints`` — the keyed fingerprints of the values the op resolved;
* ``at`` — when the broker performed it; ``ingested_at`` — when coord stored
  it. Two clocks on purpose: an outbox that drains late must not rewrite when
  the operation happened, and an operator reading the drain lag needs both.

``coord.secrets_broker_mints`` — one row per short-lived credential the broker
minted and delivered to a child process, never to a model (D2). ``op_id``
references the op that minted it through a COMPOSITE key ``(op_id,
tenant_id)``, so a mint can never be attributed to another tenant's operation.
Deleting an op deletes its mints.

``coord.secrets_broker_inventory`` — the credential inventory, built from
``describe-parameters`` / ``describe-secret`` only: at most one row per
``(tenant_id, ref)``, upserted on each observation. ``fingerprint16`` is NULL
until an operation has resolved the value (the inventory build reads no value).

``coord.secrets_broker_exposure`` — the principal x secret matrix from
``iam simulate-principal-policy``: the CURRENT decision for each
``(tenant, principal, secret_ref, action)``, upserted on each observation.
``decision`` uses AWS's own ``EvalDecision`` spellings. Plan Phase 9 anchors
``agent-principal-cannot-decrypt-census-secrets`` as a ``sql_count`` over this
table, which is why it is current state rather than an append log.

``secrets_broker_device_id UUID NULL`` on ``coord.fleet_runtime_policy`` AND on
``coord.fleet_runtime_policy_versions`` — the device the operator designated as
this tenant's broker. coord's ingest route admits a broker report only from a
device JWT that passes ``admits_as_sod_actor()`` AND whose ``device_id`` equals
this value; a self-claimed capability is not enough (finding ``935d7d1c``).
It is carried on the tenant-band row of the ``secrets_broker`` domain. It is a
typed, versioned column, not an ``attrs`` side-channel, for the same reason as
``fleet_res_tel_03``'s controls: the versions table's own ``COMMENT ON TABLE``
says a snapshot missing a payload column is an audit trail that lies, so both
tables are widened together. NULL means "no broker designated", and coord then
refuses every broker report for the tenant (fail closed). There is no foreign
key to ``coord.devices``: an ``ON DELETE SET NULL`` would change the
authorization with no version snapshot, and a restricting key would make a
device's deregistration fail for a reason the deregistering path cannot name.
The write doors (qontinui-web's admin field and coord's PUT) validate that the
device is bound to the tenant instead.

TENANCY AND PRIVILEGES
----------------------
Every new table carries ``tenant_id`` with ``ON DELETE CASCADE`` to
``coord.tenants`` and an index leading on it. There is no ``GRANT`` and no
``REVOKE``: coord's fail-closed migration classifier rejects both, and
``coordrls_01``'s default privileges apply to these tables as to every other
coord table. Their row-level-security shape is for plan
``2026-10-15-coord-tenant-isolation-has-no-database-enforcement`` to decide
when its waves classify ``tenant_id``-carrying tables. Every table has a
primary key, which is its replica identity (``replident_01``).

CLASSIFIER SHAPE
----------------
Every statement on the upgrade path is one static, ``coord``-qualified string:
four ``CREATE TABLE IF NOT EXISTS``, indexes on those new tables only (a
new-table claim the merge train discharges against trunk), two ``ADD COLUMN IF
NOT EXISTS`` of a nullable column with no default (metadata-only on a
populated table), and ``COMMENT ON``. No ``DROP``, ``GRANT``, ``REVOKE``,
``CONCURRENTLY``, data DML or f-string.

ORDERING
--------
alembic is the sole author of ``coord.*`` schema (served policy
``production-and-cost`` ``alembic-sole-authorship``); hand-authored, never
``--autogenerate``d. This revision lands BEFORE the qontinui-coord change that
reads or writes any of it, and that change degrades a missing table or column
structurally (SQLSTATE 42P01 / 42703) rather than failing.

If another revision lands on ``kernel_gauges_01`` first, re-point
``down_revision`` (and the ``Revises:`` line below), and the parent pinned in
``tests/test_secrets_broker_01_migration.py``.

Downgrade drops the four tables (mints first, then the ops it references) and
the two columns, discarding every broker report and the tenant's designated
broker device.

Revision ID: secrets_broker_01
Revises: kernel_gauges_01
Create Date: 2026-10-20
"""

from collections.abc import Sequence

from alembic import op

revision: str = "secrets_broker_01"
down_revision: str | Sequence[str] | None = "kernel_gauges_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create the four broker tables and widen both fleet-policy tables."""
    # ------------------------------------------------------------------
    # coord.secrets_broker_ops — the audit log.
    #
    # The array CHECKs validate EACH ELEMENT with a strict jsonpath over
    # `to_jsonb(<array>)` rather than matching the elements joined into one
    # string: a joined match cannot see element boundaries, so one element
    # carrying the separator (four 16-hex fingerprints comma-joined into ONE
    # element) would pass. This makes the rule hold per element only: a value
    # split ACROSS elements is the documented residual, bounded for
    # fingerprints by the cardinality cap. Per element, a NULL is a JSON null and
    # a nested array a JSON array, so `@.type() != "string"` refuses both; the
    # `array_position` / `array_ndims` guards stay as a second statement of
    # the same rule. A jsonpath error counts as a refusal (COALESCE to true).
    # ------------------------------------------------------------------
    op.execute(
        r"""
        CREATE TABLE IF NOT EXISTS coord.secrets_broker_ops (
            id               UUID        PRIMARY KEY,
            tenant_id        UUID        NOT NULL
                REFERENCES coord.tenants(tenant_id) ON DELETE CASCADE,
            device_id        UUID        NOT NULL,
            agent_session_id UUID        NULL,
            op               TEXT        NOT NULL,
            secret_refs      TEXT[]      NOT NULL DEFAULT '{}',
            outcome          TEXT        NOT NULL,
            refusal_rule     TEXT        NULL,
            fingerprints     TEXT[]      NOT NULL DEFAULT '{}',
            at               TIMESTAMPTZ NOT NULL,
            ingested_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT uq_secrets_broker_ops_id_tenant UNIQUE (id, tenant_id),
            CONSTRAINT ck_secrets_broker_ops_op CHECK (
                length(op) <= 96
                AND op ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$'
                AND op !~ '[0-9]{12}'
                AND op !~ '[0-9a-f]{16}'
            ),
            CONSTRAINT ck_secrets_broker_ops_outcome CHECK (
                outcome IN ('ok', 'refused', 'error')
            ),
            CONSTRAINT ck_secrets_broker_ops_refusal_rule CHECK (
                (outcome = 'refused') = (refusal_rule IS NOT NULL)
                AND (
                    refusal_rule IS NULL
                    OR (
                        length(refusal_rule) <= 96
                        AND refusal_rule ~ '^[a-z][a-z0-9_.-]*$'
                        AND refusal_rule !~ '[0-9]{12}'
                        AND refusal_rule !~ '[0-9a-f]{16}'
                    )
                )
            ),
            CONSTRAINT ck_secrets_broker_ops_secret_refs CHECK (
                cardinality(secret_refs) <= 64
                AND (array_ndims(secret_refs) IS NULL OR array_ndims(secret_refs) = 1)
                AND array_position(secret_refs, NULL) IS NULL
                AND octet_length(secret_refs::text) <= 32768
                AND NOT COALESCE(
                    jsonb_path_exists(
                        to_jsonb(secret_refs),
                        'strict $[*] ? (@.type() != "string" || !(@ like_regex "^(ssm:[a-z]{2}(-[a-z]+)+-[0-9]+:(/[A-Za-z0-9_./-]+|[A-Za-z0-9_.-]+)|sm:[a-z]{2}(-[a-z]+)+-[0-9]+:[A-Za-z0-9/_+=.@-]+(#[A-Za-z0-9_.-]+)?)$"))',
                        '{}',
                        true
                    ),
                    true
                )
            ),
            CONSTRAINT ck_secrets_broker_ops_fingerprints CHECK (
                cardinality(fingerprints) <= 2
                AND (array_ndims(fingerprints) IS NULL OR array_ndims(fingerprints) = 1)
                AND array_position(fingerprints, NULL) IS NULL
                AND NOT COALESCE(
                    jsonb_path_exists(
                        to_jsonb(fingerprints),
                        'strict $[*] ? (@.type() != "string" || !(@ like_regex "^[0-9a-f]{16}$"))',
                        '{}',
                        true
                    ),
                    true
                )
            )
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_secrets_broker_ops_tenant_at "
        "ON coord.secrets_broker_ops (tenant_id, at DESC)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_secrets_broker_ops_tenant_session_at "
        "ON coord.secrets_broker_ops (tenant_id, agent_session_id, at DESC) "
        "WHERE agent_session_id IS NOT NULL"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_secrets_broker_ops_secret_refs "
        "ON coord.secrets_broker_ops USING gin (secret_refs)"
    )

    # ------------------------------------------------------------------
    # coord.secrets_broker_mints — short-lived credentials delivered to a
    # child process. The composite key pins a mint to its op's tenant.
    # ------------------------------------------------------------------
    op.execute(
        r"""
        CREATE TABLE IF NOT EXISTS coord.secrets_broker_mints (
            id           UUID        PRIMARY KEY,
            tenant_id    UUID        NOT NULL
                REFERENCES coord.tenants(tenant_id) ON DELETE CASCADE,
            op_id        UUID        NOT NULL,
            kind         TEXT        NOT NULL,
            scope        JSONB       NOT NULL,
            minted_at    TIMESTAMPTZ NOT NULL,
            expires_at   TIMESTAMPTZ NOT NULL,
            delivered_to TEXT        NOT NULL,
            CONSTRAINT fk_secrets_broker_mints_op FOREIGN KEY (op_id, tenant_id)
                REFERENCES coord.secrets_broker_ops (id, tenant_id) ON DELETE CASCADE,
            CONSTRAINT ck_secrets_broker_mints_kind CHECK (
                kind IN ('github_installation', 'tailscale_auth_key')
            ),
            CONSTRAINT ck_secrets_broker_mints_delivered_to CHECK (
                delivered_to IN ('git-helper', 'exec', 'file')
            ),
            CONSTRAINT ck_secrets_broker_mints_scope CHECK (
                jsonb_typeof(scope) = 'object'
                AND octet_length(scope::text) <= 8192
                AND CASE kind
                    WHEN 'github_installation' THEN
                        scope ?& ARRAY['repos', 'permissions']
                        AND (scope - ARRAY['repos', 'permissions']) = '{}'::jsonb
                        AND jsonb_typeof(scope -> 'repos') = 'array'
                        AND COALESCE(
                            jsonb_path_exists(scope, 'strict $.repos ? (@.size() >= 1 && @.size() <= 100)', '{}', true),
                            false
                        )
                        AND NOT COALESCE(
                            jsonb_path_exists(
                                scope,
                                'strict $.repos[*] ? (@.type() != "string" || !(@ like_regex "^[A-Za-z0-9_.-]{1,39}/[A-Za-z0-9_.-]{1,100}$"))',
                                '{}',
                                true
                            ),
                            true
                        )
                        AND jsonb_typeof(scope -> 'permissions') = 'object'
                        AND NOT COALESCE(
                            jsonb_path_exists(
                                scope,
                                'strict $.permissions.keyvalue() ? (!(@.key like_regex "^[a-z_]{1,64}$") || @.value.type() != "string" || !(@.value == "read" || @.value == "write" || @.value == "admin"))',
                                '{}',
                                true
                            ),
                            true
                        )
                    WHEN 'tailscale_auth_key' THEN
                        scope ?& ARRAY['tags', 'ephemeral']
                        AND (scope - ARRAY['tags', 'ephemeral', 'reusable']) = '{}'::jsonb
                        AND jsonb_typeof(scope -> 'tags') = 'array'
                        AND COALESCE(
                            jsonb_path_exists(scope, 'strict $.tags ? (@.size() >= 1 && @.size() <= 32)', '{}', true),
                            false
                        )
                        AND NOT COALESCE(
                            jsonb_path_exists(
                                scope,
                                'strict $.tags[*] ? (@.type() != "string" || !(@ like_regex "^tag:[a-z0-9-]{1,64}$"))',
                                '{}',
                                true
                            ),
                            true
                        )
                        AND jsonb_typeof(scope -> 'ephemeral') = 'boolean'
                        AND (
                            NOT (scope ? 'reusable')
                            OR jsonb_typeof(scope -> 'reusable') = 'boolean'
                        )
                    ELSE false
                END
            )
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_secrets_broker_mints_op "
        "ON coord.secrets_broker_mints (op_id, tenant_id)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_secrets_broker_mints_tenant_minted "
        "ON coord.secrets_broker_mints (tenant_id, minted_at DESC)"
    )

    # ------------------------------------------------------------------
    # coord.secrets_broker_inventory — metadata only, from describe calls.
    # ------------------------------------------------------------------
    op.execute(
        r"""
        CREATE TABLE IF NOT EXISTS coord.secrets_broker_inventory (
            tenant_id       UUID        NOT NULL
                REFERENCES coord.tenants(tenant_id) ON DELETE CASCADE,
            ref             TEXT        NOT NULL,
            store           TEXT        NOT NULL,
            type            TEXT        NOT NULL,
            scopes          TEXT[]      NOT NULL DEFAULT '{}',
            last_rotated_at TIMESTAMPTZ NULL,
            expires_at      TIMESTAMPTZ NULL,
            rotation_due_at TIMESTAMPTZ NULL,
            fingerprint16   TEXT        NULL,
            observed_at     TIMESTAMPTZ NOT NULL,
            CONSTRAINT pk_secrets_broker_inventory PRIMARY KEY (tenant_id, ref),
            CONSTRAINT ck_secrets_broker_inventory_ref CHECK (
                length(ref) <= 2200
                AND ref ~ '^(ssm:[a-z]{2}(-[a-z]+)+-[0-9]+:(/[A-Za-z0-9_./-]+|[A-Za-z0-9_.-]+)|sm:[a-z]{2}(-[a-z]+)+-[0-9]+:[A-Za-z0-9/_+=.@-]+(#[A-Za-z0-9_.-]+)?)$'
            ),
            CONSTRAINT ck_secrets_broker_inventory_store CHECK (
                store IN ('ssm', 'sm') AND split_part(ref, ':', 1) = store
            ),
            CONSTRAINT ck_secrets_broker_inventory_type CHECK (
                (store = 'ssm' AND type IN ('String', 'StringList', 'SecureString'))
                OR (store = 'sm' AND type = 'secret')
            ),
            CONSTRAINT ck_secrets_broker_inventory_scopes CHECK (
                cardinality(scopes) <= 64
                AND (array_ndims(scopes) IS NULL OR array_ndims(scopes) = 1)
                AND array_position(scopes, NULL) IS NULL
                AND octet_length(scopes::text) <= 16384
                AND NOT COALESCE(
                    jsonb_path_exists(
                        to_jsonb(scopes),
                        'strict $[*] ? (@.type() != "string" || !(@ like_regex "^(kms:alias/[A-Za-z0-9/_-]{1,128}|tier:(standard|advanced|intelligent-tiering)|rotation:(enabled|disabled)|(user|role)/([A-Za-z0-9+=,.@_-]+/)*[A-Za-z0-9+=,.@_-]{1,64}|ecs:[A-Za-z0-9_-]{1,128}/[A-Za-z0-9_-]{1,128}|tag:[A-Za-z0-9 _.:/=+@-]{1,128})$") || @ like_regex "arn:" flag "i" || (!(@ like_regex "^(user|role)/") && (@ like_regex "[0-9]{12}" || @ like_regex "[0-9a-f]{16}" flag "i")))',
                        '{}',
                        true
                    ),
                    true
                )
            ),
            CONSTRAINT ck_secrets_broker_inventory_fingerprint16 CHECK (
                fingerprint16 IS NULL OR fingerprint16 ~ '^[0-9a-f]{16}$'
            )
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_secrets_broker_inventory_rotation_due "
        "ON coord.secrets_broker_inventory (tenant_id, rotation_due_at) "
        "WHERE rotation_due_at IS NOT NULL"
    )

    # ------------------------------------------------------------------
    # coord.secrets_broker_exposure — current simulate-principal-policy
    # decision per (principal, secret, action). principal stores user/ or
    # role/ names, never an ARN; an account id embedded in a name is coord
    # ingest's to refuse (residual).
    # ------------------------------------------------------------------
    op.execute(
        r"""
        CREATE TABLE IF NOT EXISTS coord.secrets_broker_exposure (
            tenant_id   UUID        NOT NULL
                REFERENCES coord.tenants(tenant_id) ON DELETE CASCADE,
            principal   TEXT        NOT NULL,
            secret_ref  TEXT        NOT NULL,
            action      TEXT        NOT NULL,
            decision    TEXT        NOT NULL,
            observed_at TIMESTAMPTZ NOT NULL,
            CONSTRAINT pk_secrets_broker_exposure
                PRIMARY KEY (tenant_id, principal, secret_ref, action),
            CONSTRAINT ck_secrets_broker_exposure_principal CHECK (
                length(principal) <= 600
                AND principal ~ '^(user|role)/([A-Za-z0-9+=,.@_-]+/)*[A-Za-z0-9+=,.@_-]{1,64}$'
                AND principal !~* 'arn:'
            ),
            CONSTRAINT ck_secrets_broker_exposure_secret_ref CHECK (
                length(secret_ref) <= 2200
                AND secret_ref ~ '^(ssm:[a-z]{2}(-[a-z]+)+-[0-9]+:(/[A-Za-z0-9_./-]+|[A-Za-z0-9_.-]+)|sm:[a-z]{2}(-[a-z]+)+-[0-9]+:[A-Za-z0-9/_+=.@-]+(#[A-Za-z0-9_.-]+)?)$'
            ),
            CONSTRAINT ck_secrets_broker_exposure_action CHECK (
                length(action) <= 80
                AND action ~ '^(ssm|secretsmanager|kms):([A-Z][a-z]+){1,8}$'
                AND action !~ '[0-9]{12}'
                AND action !~* '[0-9a-f]{16}'
            ),
            CONSTRAINT ck_secrets_broker_exposure_decision CHECK (
                decision IN ('allowed', 'implicitDeny', 'explicitDeny')
            )
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_secrets_broker_exposure_allowed "
        "ON coord.secrets_broker_exposure (tenant_id, principal) "
        "WHERE decision = 'allowed'"
    )

    # ------------------------------------------------------------------
    # The tenant's designated broker device — parent AND snapshot, together.
    # ------------------------------------------------------------------
    op.execute(
        "ALTER TABLE coord.fleet_runtime_policy "
        "ADD COLUMN IF NOT EXISTS secrets_broker_device_id UUID"
    )
    op.execute(
        "ALTER TABLE coord.fleet_runtime_policy_versions "
        "ADD COLUMN IF NOT EXISTS secrets_broker_device_id UUID"
    )

    op.execute(
        """
        COMMENT ON TABLE coord.secrets_broker_ops IS
            'Secrets broker audit log: one row per operation an agent asked the broker '
            'to perform: references, outcomes and keyed 16-hex fingerprints (plan '
            '2026-10-20-secrets-broker, D4). id is broker-generated so a retried '
            'outbox drain is idempotent. '
            'Shaped to refuse a value, and the residual (value-shaped names, '
            'fingerprint/uuid chunking) is coord ingest''s to refuse, see revision '
            'secrets_broker_01.'
        """
    )
    op.execute(
        """
        COMMENT ON TABLE coord.secrets_broker_mints IS
            'Short-lived credentials the secrets broker minted and delivered to one '
            'child process (git-helper, exec or file). scope is a fixed-key object '
            'per kind, and no column is meant for the token. '
            'Shaped to refuse a value, and the residual (value-shaped names, '
            'fingerprint/uuid chunking) is coord ingest''s to refuse, see revision '
            'secrets_broker_01.'
        """
    )
    op.execute(
        """
        COMMENT ON TABLE coord.secrets_broker_inventory IS
            'Secrets broker credential inventory, built from describe-parameters / '
            'describe-secret: reference, metadata, rotation dates and the keyed '
            'fingerprint once an operation has resolved the value. '
            'Shaped to refuse a value, and the residual (value-shaped names, '
            'fingerprint/uuid chunking) is coord ingest''s to refuse, see revision '
            'secrets_broker_01.'
        """
    )
    op.execute(
        """
        COMMENT ON TABLE coord.secrets_broker_exposure IS
            'Current iam simulate-principal-policy decision per (principal, secret, '
            'action). principal stores user/ or role/ names, never an ARN. IAM names '
            'may contain digit runs, so refusing an account id embedded in a name is '
            'coord ingest''s job (residual).'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.fleet_runtime_policy.secrets_broker_device_id IS
            'The device the operator designated as this tenant''s secrets broker, on '
            'the tenant-band row of the secrets_broker domain. coord admits a broker '
            'report only from a device JWT that passes admits_as_sod_actor() AND whose '
            'device_id equals this value. NULL = no broker designated: every broker '
            'report for the tenant is refused (fail closed). Set by the operator only.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.fleet_runtime_policy_versions.secrets_broker_device_id IS
            'Snapshot of coord.fleet_runtime_policy.secrets_broker_device_id, see that '
            'column for its meaning. Snapshot rows written BEFORE revision '
            'secrets_broker_01 carry NULL here: no broker could have been designated. '
            'Immutable: never UPDATE or DELETE a row here.'
        """
    )


def downgrade() -> None:
    """Drop the four tables and both columns. Reverse of upgrade()."""
    op.execute("DROP TABLE IF EXISTS coord.secrets_broker_mints")
    op.execute("DROP TABLE IF EXISTS coord.secrets_broker_ops")
    op.execute("DROP TABLE IF EXISTS coord.secrets_broker_inventory")
    op.execute("DROP TABLE IF EXISTS coord.secrets_broker_exposure")
    op.execute(
        "ALTER TABLE coord.fleet_runtime_policy_versions "
        "DROP COLUMN IF EXISTS secrets_broker_device_id"
    )
    op.execute(
        "ALTER TABLE coord.fleet_runtime_policy "
        "DROP COLUMN IF EXISTS secrets_broker_device_id"
    )
