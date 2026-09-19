"""Data-semantics test for the ``coordnotif_02_prune_non_agent_kinds`` revision.

The revision is a one-shot prune of ``coord.notifications``. It authors no
schema, so its whole contract is *data*: which rows go, which stay, what
happens to their read marks, and whether a re-run is safe. CI's
upgrade/downgrade walk runs against an EMPTY database, so a WHERE clause that
deleted the wrong rows, or every row, would pass there. This test is the only
thing that reads the predicates.

Cases (every class the revision deletes, and the rows each class must spare)
=============================================================================

Deleted:

* ``alert_paged`` rows, including one with a read mark (the mark must go with
  it through ``ON DELETE CASCADE``) and a bulk of more rows than one batch, so
  the cursor loop must go round more than once.
* ``policy_document_changed`` by ``operator:<uuid>`` and
  ``autonomy_dial_changed`` by the degraded ``operator:`` spelling.
* A SEED notification (actor ``system:``) whose ``(tenant, document,
  document_kind, to_version)`` joins a version row edited by ``system:seed``.
* A pre-widening seed notification with no ``document_kind`` key, which must
  match a ``kind = 'policy'`` document.
* A seed notification for a non-policy kind (``initiative``).
* ``pr_landed`` and ``worktree_went_stale`` rows.

Kept:

* A ``system:upstream`` adoption — stored with the SAME ``system:`` actor as a
  seed, and told apart only by its version row's ``edited_by``.
* Agent-authored prompt-document changes (``session:<uuid>``,
  ``agent:unattributed``).
* A ``system:`` row whose seed version belongs to ANOTHER tenant.
* A ``system:`` row naming a document that does not exist (an unknown is never
  pruned).
* A ``system:`` row whose ``document_kind`` matches no document of that name.
* A REINCARNATED document: an old ``system:upstream`` notification at v3,
  written 30 days ago, whose ``to_version`` now names a seed rewrite of a
  recreated document of the same name. The version is younger than the
  notification, so the migration's ``occurred_at`` bound keeps the row.
* An ``upstream_policy_update_available`` row (actor ``system:``) whose
  ``to_version`` names a seed version. It is not a prompt-document-change
  kind, so no class touches it.
* The agent-action kinds the feed exists for.

Then a re-run (the prod-repair scenario and the idempotency claim), a re-run
after a still-old coord wrote one more ``alert_paged`` (it must be removed), a
downgrade (a documented no-op) and a re-upgrade.

Substrate comes from ``_alembic_harness``: an ephemeral database inside the
test Postgres, skipped when none is reachable (``QONTINUI_TEST_PG`` points it
at a non-default host:port).
"""

from __future__ import annotations

import json
import uuid

import pytest
from sqlalchemy import text
from sqlalchemy.engine import Connection, Engine

from tests._alembic_harness import (
    admin_database_url,
    backend_root,
    can_connect,
    ephemeral_database,
    load_revision_module,
    run_alembic,
)

# Pinned rather than "head" so a later revision cannot change what this walks.
_REVISION_ID = "coordnotif_02_prune_non_agent_kinds"
_PARENT_REVISION_ID = "agent_questions_alert_episode_01"

# More alert_paged rows than one batch. The test asserts this against the
# migration module's own BATCH_ROWS, so a later batch-size bump cannot quietly
# turn the multi-batch case into a single-batch one.
_BULK_ALERT_PAGED = 6_500

_EXPECTED_DELETED = {
    "alert-paged-read",
    "alert-paged-unread",
    "operator-policy",
    "operator-dial-degraded",
    "seed-policy-v2",
    "seed-policy-pre-widening",
    "seed-initiative-v2",
    "pr-landed",
    "worktree-went-stale",
}

_EXPECTED_SURVIVORS = {
    "upstream-policy-v3",
    "session-policy-v4",
    "agent-unattributed-policy-v5",
    "seed-version-other-tenant",
    "system-unknown-document",
    "system-kind-mismatch",
    "agent-irreversible",
    "agent-sensitive-gate",
    "reincarnated-upstream-v3",
    "upstream-update-available-seed-version",
}


def _revision_batch_rows() -> int:
    module = load_revision_module(
        backend_root() / "alembic" / "versions" / f"{_REVISION_ID}.py",
        f"_test_{_REVISION_ID}",
    )
    return int(module.BATCH_ROWS)


def _document(
    conn: Connection, tenant_id: uuid.UUID, kind: str, name: str, versions: list[str]
) -> None:
    """Insert one prompt document with ``versions[i]`` as version ``i+1``'s author."""
    doc_id = conn.execute(
        text(
            """
            INSERT INTO coord.prompt_documents
                (tenant_id, kind, name, body, current_version)
            VALUES (:t, :kind, :name, 'body', :cv)
            RETURNING id
            """
        ),
        {"t": tenant_id, "kind": kind, "name": name, "cv": len(versions)},
    ).scalar_one()
    for number, edited_by in enumerate(versions, start=1):
        conn.execute(
            text(
                """
                INSERT INTO coord.prompt_document_versions
                    (document_id, version_number, body, edited_by)
                VALUES (:d, :n, 'body', :by)
                """
            ),
            {"d": doc_id, "n": number, "by": edited_by},
        )


def _notification(
    conn: Connection,
    tenant_id: uuid.UUID,
    label: str,
    kind: str,
    actor: str | None,
    detail: dict[str, object] | None = None,
    occurred_days_ago: int = 0,
) -> uuid.UUID:
    """Insert one notification; ``summary`` carries the case label.

    ``occurred_at`` is computed by the server, like the version rows'
    ``created_at``, so the reincarnation case cannot be perturbed by clock skew.
    """
    return conn.execute(
        text(
            """
            INSERT INTO coord.notifications
                (tenant_id, kind, summary, detail, actor, occurred_at)
            VALUES (:t, :kind, :label, CAST(:detail AS jsonb), :actor,
                    now() - make_interval(days => CAST(:ago AS int)))
            RETURNING notification_id
            """
        ),
        {
            "t": tenant_id,
            "kind": kind,
            "label": label,
            "detail": json.dumps(detail or {}),
            "actor": actor,
            "ago": occurred_days_ago,
        },
    ).scalar_one()


def _seed(engine: Engine) -> tuple[uuid.UUID, uuid.UUID]:
    """Seed every case. Returns the two notification ids that carry read marks."""
    tenant = uuid.uuid4()
    other_tenant = uuid.uuid4()
    operator = uuid.uuid4()
    session = uuid.uuid4()

    with engine.begin() as conn:
        # Version authors are the RAW `updated_by` coord binds, not the
        # truncated notification actor.
        _document(
            conn,
            tenant,
            "policy",
            "engineering-priorities",
            [
                "system:seed",
                "system:seed",
                "system:upstream",
                f"session:{session}",
                "agent:unattributed",
            ],
        )
        _document(conn, tenant, "policy", "testing", ["system:seed", "system:seed"])
        _document(
            conn, tenant, "initiative", "north-star", ["system:seed", "system:seed"]
        )
        # The seed version lives in the OTHER tenant only.
        _document(
            conn,
            other_tenant,
            "policy",
            "git-operations",
            ["system:seed", "system:seed"],
        )

        def doc_change(
            label: str,
            actor: str,
            document: str,
            to_version: int,
            document_kind: str | None = "policy",
            kind: str = "policy_document_changed",
            on_tenant: uuid.UUID = tenant,
            occurred_days_ago: int = 0,
        ) -> uuid.UUID:
            detail: dict[str, object] = {
                "document": document,
                "from_version": to_version - 1,
                "to_version": to_version,
                "loosening": False,
            }
            if document_kind is not None:
                detail["document_kind"] = document_kind
            return _notification(
                conn, on_tenant, label, kind, actor, detail, occurred_days_ago
            )

        # --- deleted ---
        read_deleted = _notification(
            conn, tenant, "alert-paged-read", "alert_paged", None
        )
        _notification(conn, tenant, "alert-paged-unread", "alert_paged", None)
        doc_change(
            "operator-policy", f"operator:{operator}", "engineering-priorities", 2
        )
        doc_change(
            "operator-dial-degraded",
            "operator:",
            "security-and-autonomy",
            7,
            kind="autonomy_dial_changed",
        )
        doc_change("seed-policy-v2", "system:", "engineering-priorities", 2)
        doc_change(
            "seed-policy-pre-widening", "system:", "testing", 2, document_kind=None
        )
        doc_change(
            "seed-initiative-v2", "system:", "north-star", 2, document_kind="initiative"
        )
        _notification(conn, tenant, "pr-landed", "pr_landed", "agent:x")
        _notification(conn, tenant, "worktree-went-stale", "worktree_went_stale", None)

        # --- kept ---
        read_kept = doc_change(
            "upstream-policy-v3", "system:", "engineering-priorities", 3
        )
        doc_change(
            "session-policy-v4", f"session:{session}", "engineering-priorities", 4
        )
        doc_change(
            "agent-unattributed-policy-v5",
            "agent:unattributed",
            "engineering-priorities",
            5,
        )
        # The version row is a seed, but in another tenant.
        doc_change("seed-version-other-tenant", "system:", "git-operations", 2)
        doc_change("system-unknown-document", "system:", "no-such-document", 2)
        doc_change(
            "system-kind-mismatch", "system:", "north-star", 2, document_kind="policy"
        )
        _notification(
            conn,
            tenant,
            "agent-irreversible",
            "agent_took_irreversible_action",
            f"session:{session}",
        )
        _notification(
            conn,
            tenant,
            "agent-sensitive-gate",
            "agent_took_sensitive_gate_action",
            "agent:y",
        )

        # Reincarnation: the "handbook" document was deleted and recreated. Its
        # current v3 is a seed rewrite written now; the notification is an
        # upstream adoption of the OLD document's v3, from 30 days ago.
        _document(
            conn,
            tenant,
            "policy",
            "handbook",
            ["system:seed", "system:seed", "system:seed"],
        )
        doc_change(
            "reincarnated-upstream-v3",
            "system:",
            "handbook",
            3,
            occurred_days_ago=30,
        )
        # Not a prompt-document-change kind, although it names a seed version.
        doc_change(
            "upstream-update-available-seed-version",
            "system:",
            "engineering-priorities",
            2,
            kind="upstream_policy_update_available",
        )

        # Bulk: more alert_paged rows than one batch.
        conn.execute(
            text(
                """
                INSERT INTO coord.notifications (tenant_id, kind, summary)
                SELECT :t, 'alert_paged', 'bulk-alert-paged'
                  FROM generate_series(1, :n)
                """
            ),
            {"t": tenant, "n": _BULK_ALERT_PAGED},
        )

        for notification_id in (read_deleted, read_kept):
            conn.execute(
                text(
                    """
                    INSERT INTO coord.notification_reads (notification_id, actor_key)
                    VALUES (:n, :who)
                    """
                ),
                {"n": notification_id, "who": f"operator:{operator}"},
            )

    return read_deleted, read_kept


def _labels(engine: Engine) -> dict[str, int]:
    with engine.connect() as conn:
        return {
            str(label): int(count)
            for label, count in conn.execute(
                text(
                    "SELECT summary, count(*) FROM coord.notifications GROUP BY summary"
                )
            )
        }


def _reads(engine: Engine) -> set[uuid.UUID]:
    with engine.connect() as conn:
        return {
            uuid.UUID(str(r[0]))
            for r in conn.execute(
                text("SELECT notification_id FROM coord.notification_reads")
            )
        }


@pytest.mark.skipif(
    not can_connect(admin_database_url()),
    reason=(
        "Postgres not reachable at the conftest URL. CI provisions a postgres "
        "service; locally, set QONTINUI_TEST_PG to a reachable host:port."
    ),
)
def test_coordnotif_02_prunes_exactly_the_non_agent_classes() -> None:
    root = backend_root()

    with ephemeral_database(admin_database_url(), "coordnotif_02_test") as (
        engine,
        url,
    ):
        assert _BULK_ALERT_PAGED > _revision_batch_rows(), (
            "the bulk case must exceed one batch to exercise the cursor loop"
        )
        run_alembic(root, url, "upgrade", _PARENT_REVISION_ID)
        read_deleted, read_kept = _seed(engine)

        before = _labels(engine)
        assert set(before) == _EXPECTED_DELETED | _EXPECTED_SURVIVORS | {
            "bulk-alert-paged"
        }
        assert before["bulk-alert-paged"] == _BULK_ALERT_PAGED

        # Apply.
        run_alembic(root, url, "upgrade", _REVISION_ID)
        after = _labels(engine)
        assert set(after) == _EXPECTED_SURVIVORS, (
            f"deleted {sorted(set(before) - set(after))}, kept {sorted(set(after))}"
        )
        assert all(count == 1 for count in after.values()), after

        # The read mark of a deleted row cascaded; the survivor's stayed.
        assert _reads(engine) == {read_kept}
        assert read_deleted not in _reads(engine)

        # Re-run over its own output: a no-op.
        run_alembic(root, url, "stamp", _PARENT_REVISION_ID)
        run_alembic(root, url, "upgrade", _REVISION_ID)
        assert _labels(engine) == after
        assert _reads(engine) == {read_kept}

        # A still-old coord wrote one more page: a re-run removes it and only it.
        with engine.begin() as conn:
            conn.execute(
                text(
                    """
                    INSERT INTO coord.notifications (tenant_id, kind, summary)
                    VALUES (:t, 'alert_paged', 'late-alert-paged')
                    """
                ),
                {"t": uuid.uuid4()},
            )
        run_alembic(root, url, "stamp", _PARENT_REVISION_ID)
        run_alembic(root, url, "upgrade", _REVISION_ID)
        assert _labels(engine) == after

        # Downgrade is a documented no-op; the re-upgrade applies cleanly.
        run_alembic(root, url, "downgrade", _PARENT_REVISION_ID)
        assert _labels(engine) == after
        run_alembic(root, url, "upgrade", _REVISION_ID)
        assert _labels(engine) == after
