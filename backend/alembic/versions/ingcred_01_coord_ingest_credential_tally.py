"""coord.ingest_credential_tally — which credential authorized each CI ingest request

Revision ID: ingcred_01
Revises: coordmem_01
Create Date: 2026-10-16

Phase 1 of plan ``2026-10-16-coord-ingest-doors-take-the-tenant-from-the-request-body``
(coord finding bf23ce8f, review item SE-4).

coord's eleven CI ingest doors authenticate with one shared ``COORD_INGEST_TOKEN``
and take the tenant and the repo from the request body, so any holder of the token
can write merge-gate inputs for any repo of any tenant. The plan binds each ingest
write to the credential that made it (a GitHub Actions OIDC token bound to its
repository), keeps the shared token working unchanged while callers move, and
retires it only after a measured window shows no caller still presents it.

This table is that measurement: a daily rollup, one row per key, which coord
UPSERTs once per ingest request that presented a VALID credential. ``requests``
counts the requests that fell on the key that day: coord inserts ``1`` and adds
``1`` on conflict, so a row never holds less than one (``CHECK (requests >= 1)``,
and no default, so a writer that forgets the count is refused).

What a row says
===============

* ``door``: the route template the request reached (``/coord/test-results/ingest``).
* ``credential_class``: what authorized it (``github_oidc`` or ``shared_token``).
* ``verdict`` / ``reason``: ``accepted`` with ``reason = ''``, or ``refused`` with
  the typed refusal code coord answered. A CHECK holds the two together.
* ``credential_repository``: the OIDC token's ``repository`` claim; ``''`` for the
  shared token, which names no repository.
* ``body_repository``: the repo the body names, stored as the canonical
  ``owner/name`` of the one ``coord.tenant_repos`` owner row it resolves to (a bare
  name, or another letter case, is stored in that row's spelling). When it does
  not resolve to one owner row: ``<unresolved>`` if owner rows exist but do not
  name one repo with one owner (a co-owned repo, or a bare name under two owners),
  or if a body names several repos that resolve differently; ``<unknown>`` if no
  owner row names it. ``''`` when the door takes no repo.
  coord never stores a caller's arbitrary string here, so the key's cardinality is
  bounded.
* ``agreement``: whether the body tenant agrees with the tenant the credential
  resolves (for the shared token, the tenant the body repo's owner resolves, which
  is what the OIDC rule would derive): ``agree`` when the body tenant is absent or
  equal, ``disagree`` when it differs, ``unresolved`` when the body repo does not
  resolve, and ``not_applicable`` on a platform door.
* ``derived_tenant_id`` / ``body_tenant_id``: the last values seen for the key.
  ``derived_tenant_id`` is NULL when the body repo does not resolve to one owner:
  it is a UUID column, so it carries no marker string. On a platform door it is
  the owner tenant of the door's producer repository instead, NULL only when that
  pin does not resolve.
* ``ref_class`` / ``runner_environment``: from the OIDC claims; ``''`` otherwise.
  Phase 4 maps a ``runner_environment`` claim value outside the CHECK's set to
  ``''`` rather than storing it.

Who can add a row
=================

Only a request that presented a valid credential: the shared token, or a GitHub
Actions OIDC token that verified, whose owner is bound to a tenant and whose owner
id matches that binding. An unproven identity (no bearer, a wrong token, a token
that fails verification, an unbound owner, a mismatched owner id) writes nothing;
coord counts it in a process-local counter instead. GitHub signs a token for
coord's audience for any Actions job on github.com, so this is what keeps internet
traffic from turning into database writes.

The CHECKs
==========

They pin closed vocabularies that coord writes and that are complete for the
plan's whole life. ``reason`` already lists ``shared_ingest_token_retired`` (the
plan's Phase 6), so retiring the shared token needs no migration. The reasons an
unproven identity gets never reach this table, so they are not listed.
``ci_read_token_01`` left its ``outcome`` unchecked because that broker's refusal
set grows with it; this set does not.

Owner-only
==========

The table is a cross-tenant ledger: one row can name any tenant's repository and
tenant id, and there is no ``tenant_id`` column. So it is ``system_only``, the way
r10's D5 classes such ledgers and coordrls_01 treats ``coord.db_scope_census``.
coordrls_01's ``ALTER DEFAULT PRIVILEGES`` gives ``coord_tenant`` and
``coord_tenant_preflight`` DML on every coord table created after it, and with no
``tenant_id`` column neither r10's oracle nor ``coord_tenant_tables_unenforced``
would ever revisit this one, so upgrade() revokes both roles here, exactly as
coordrls_01 revoked its census tables. coord itself connects as the owning
migrator role, so its reads and writes are unaffected. No foreign keys: a row's
lifecycle is the measurement's, not a tenant's.

Retention
=========

coord's ``table_retention`` sweep deletes rows by the whole ten-column PRIMARY KEY
(``prune_sql_keyed``), oldest ``day`` first in bounded batches; the key leads on
``day``, so its index serves the batch subquery. The window is 90 days by default
and is floored at 9 days, so the 7-day series coord derives from the table is
never cut short.

Hand-authored; ``alembic revision --autogenerate`` was not run and is never run
against ``coord.*``. coord authors zero DDL (``[policy: alembic-sole-authorship]``),
so this revision merges before the coord change that writes the table. Until it
has applied, coord's tally write fails, is counted, and changes no response, and
the gauges are omitted rather than reporting zero.

Idempotency: ``IF NOT EXISTS`` / ``IF EXISTS`` throughout, matching the
``coord.*`` migration house style; the REVOKE and the COMMENT are idempotent.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "ingcred_01"
down_revision: str | Sequence[str] | None = "coordmem_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.ingest_credential_tally (
            day                   DATE        NOT NULL,
            door                  TEXT        NOT NULL,
            credential_class      TEXT        NOT NULL,
            verdict               TEXT        NOT NULL,
            reason                TEXT        NOT NULL DEFAULT '',
            credential_repository TEXT        NOT NULL DEFAULT '',
            body_repository       TEXT        NOT NULL DEFAULT '',
            agreement             TEXT        NOT NULL,
            ref_class             TEXT        NOT NULL DEFAULT '',
            runner_environment    TEXT        NOT NULL DEFAULT '',
            derived_tenant_id     UUID        NULL,
            body_tenant_id        UUID        NULL,
            requests              BIGINT      NOT NULL,
            first_seen_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
            last_seen_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT ingest_credential_tally_pkey PRIMARY KEY (
                day, door, credential_class, verdict, reason,
                credential_repository, body_repository, agreement,
                ref_class, runner_environment
            ),
            CONSTRAINT ingest_credential_tally_credential_class_check
                CHECK (credential_class IN ('github_oidc', 'shared_token')),
            CONSTRAINT ingest_credential_tally_verdict_check
                CHECK (verdict IN ('accepted', 'refused')),
            CONSTRAINT ingest_credential_tally_reason_check
                CHECK (reason IN (
                    '',
                    'pull_request_target_refused',
                    'ingest_repository_not_tenant_owned',
                    'ingest_repo_mismatch',
                    'ingest_tenant_mismatch',
                    'ingest_producer_mismatch',
                    'ingest_ref_not_allowed',
                    'shared_ingest_token_retired'
                )),
            CONSTRAINT ingest_credential_tally_verdict_reason_check
                CHECK ((verdict = 'accepted') = (reason = '')),
            CONSTRAINT ingest_credential_tally_agreement_check
                CHECK (agreement IN ('agree', 'disagree', 'unresolved', 'not_applicable')),
            CONSTRAINT ingest_credential_tally_ref_class_check
                CHECK (ref_class IN ('', 'default_branch', 'other')),
            CONSTRAINT ingest_credential_tally_runner_environment_check
                CHECK (runner_environment IN ('', 'github-hosted', 'self-hosted')),
            CONSTRAINT ingest_credential_tally_requests_check
                CHECK (requests >= 1)
        )
        """
    )
    # system_only: undo the DML coordrls_01's default privileges just gave the
    # tenant roles on this new table (module docs, "Owner-only").
    op.execute(
        "REVOKE ALL ON coord.ingest_credential_tally FROM coord_tenant, coord_tenant_preflight"
    )
    op.execute(
        """
        COMMENT ON TABLE coord.ingest_credential_tally IS
            'Daily count of CI ingest requests per key: which credential authorized '
            'them, the verdict, and whether the body tenant agrees with the tenant '
            'the credential resolves. Writer: coord ingest_credential tally (plan '
            '2026-10-16-coord-ingest-doors-take-the-tenant-from-the-request-body, '
            'Phase 2). A cross-tenant ledger, system_only: the tenant roles hold no '
            'privilege on it.'
        """
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS coord.ingest_credential_tally")
