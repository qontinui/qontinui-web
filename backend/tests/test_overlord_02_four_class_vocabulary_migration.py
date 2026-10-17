"""Behaviour test for the ``overlord_02_four_class_vocabulary`` migration.

Pins the contracts coord's Rust validator relies on:

1. **Legacy marking** — rows written under the A-F vocabulary that carry C, D or
   F are marked ``legacy_class`` and keep their letter; A/B/E/U rows are not
   marked. Existing labels are backfilled ``label_kind = 'class'`` /
   ``label_source = 'unknown'``.
2. **The new vocabulary is enforced** — C/D/F are refused unless the row is
   ``legacy_class``; ``operator_label`` admits A/B/E; ``outcome`` admits
   ``queued``, ``reopened`` and ``finished``.
3. **Label provenance constraints** — a label needs a kind, a class kind needs a
   label, a kind needs a source, ``false_finish`` never labels E, and no row
   observed after the cutoff can claim legacy status.
4. **The eight verbs** the ``verb`` CHECK admits are pinned, so the plan and the
   schema cannot drift apart again.
5. **Reversal** restores the Phase 2 vocabulary.
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from tests._alembic_harness import (
    admin_database_url,
    backend_root,
    can_connect,
    declared_parent_revision_id,
    ephemeral_database,
    run_alembic,
)

_REVISION_ID = "overlord_02_four_class_vocabulary"
_REVISION_FILENAME = "overlord_02_four_class_vocabulary.py"
_PRIOR_REVISION_ID = "overlord_01_interventions"

_TENANT = uuid.UUID("7e3c9a14-5b2f-4d81-9c06-2a8f1e4b7d93")

_VERBS = (
    "leave",
    "nudge",
    "handoff-prompt",
    "gate-register-nudge",
    "escalate",
    "finish+close",
    "spawn",
    "redirect",
)

_INSERT = text(
    """
    INSERT INTO coord.overlord_interventions
        (id, intervention_id, tenant_id, stop_class, verb, mode, outcome,
         operator_label, legacy_class, label_kind, label_source, observed_at)
    VALUES (:id, :id, :tid, :stop_class, :verb, 'live', :outcome,
            :label, :legacy, :kind, :source, :observed_at)
    """
)

_LEGACY_INSERT = text(
    """
    INSERT INTO coord.overlord_interventions
        (id, intervention_id, tenant_id, stop_class, verb, mode, operator_label)
    VALUES (:id, :id, :tid, :stop_class, 'nudge', 'live', :label)
    """
)


def _row(**overrides: object) -> dict[str, object]:
    params: dict[str, object] = {
        "id": uuid.uuid4(),
        "tid": _TENANT,
        "stop_class": "A",
        "verb": "nudge",
        "outcome": None,
        "label": None,
        "legacy": False,
        "kind": None,
        "source": None,
        "observed_at": "2026-10-20T00:00:00+00",
    }
    params.update(overrides)
    return params


def test_revision_chains_off_a_single_parent() -> None:
    source = (backend_root() / "alembic" / "versions" / _REVISION_FILENAME).read_text(
        encoding="utf-8"
    )
    assert declared_parent_revision_id(source, _REVISION_FILENAME)


@pytest.mark.skipif(
    not can_connect(admin_database_url()),
    reason="Postgres not reachable at the conftest URL.",
)
def test_overlord_02_marks_legacy_rows_and_enforces_the_four_class_vocabulary() -> None:
    root = backend_root()

    with ephemeral_database(admin_database_url(), "overlord02_test") as (engine, url):
        run_alembic(root, url, "upgrade", _PRIOR_REVISION_ID)

        legacy_d, legacy_labelled_c, plain_a = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
        with engine.begin() as conn:
            conn.execute(_LEGACY_INSERT, {"id": legacy_d, "tid": _TENANT, "stop_class": "D", "label": None})
            conn.execute(_LEGACY_INSERT, {"id": legacy_labelled_c, "tid": _TENANT, "stop_class": "A", "label": "C"})
            conn.execute(_LEGACY_INSERT, {"id": plain_a, "tid": _TENANT, "stop_class": "A", "label": "A"})

        run_alembic(root, url, "upgrade", _REVISION_ID)

        with engine.connect() as conn:
            rows = {
                r[0]: tuple(r[1:])
                for r in conn.execute(
                    text(
                        """
                        SELECT id, stop_class, legacy_class, operator_label,
                               label_kind, label_source
                          FROM coord.overlord_interventions
                        """
                    )
                )
            }
        assert rows[legacy_d] == ("D", True, None, None, None)
        assert rows[legacy_labelled_c] == ("A", True, "C", "class", "unknown")
        assert rows[plain_a] == ("A", False, "A", "class", "unknown")

        def refused(**kw: object) -> None:
            with pytest.raises(IntegrityError):
                with engine.begin() as conn:
                    conn.execute(_INSERT, _row(**kw))

        def accepted(**kw: object) -> None:
            with engine.begin() as conn:
                conn.execute(_INSERT, _row(**kw))

        # New rows speak the four-class vocabulary only.
        refused(stop_class="D")
        refused(stop_class="C")
        refused(stop_class="F")
        refused(label="D", kind="class", source="agent")
        accepted(stop_class="U")
        accepted(label="B", kind="class", source="operator_page")

        # A legacy row keeps its letter, but only before the cutoff.
        accepted(stop_class="D", legacy=True, observed_at="2026-10-05T00:00:00+00")
        refused(stop_class="D", legacy=True, observed_at="2026-10-20T00:00:00+00")

        # The new outcomes.
        for outcome in ("queued", "reopened", "finished"):
            accepted(outcome=outcome)
        refused(outcome="maybe")

        # Label provenance.
        refused(label="A")  # label without a kind
        refused(kind="class", source="agent")  # class kind without a label
        refused(label="A", kind="class")  # kind without a source
        refused(label="A", kind="class", source="robot")
        refused(label="A", kind="bogus", source="agent")
        accepted(kind="false_finish", source="recheck_gate", outcome="reopened")
        accepted(label="A", kind="false_finish", source="operator_page")
        refused(label="E", kind="false_finish", source="operator_page")

        # The eight verbs.
        for verb in _VERBS:
            accepted(verb=verb)
        refused(verb="shout")

        # Reversal restores the Phase 2 vocabulary. The new-vocabulary-only
        # rows must go first: downgrade is not lossless by design.
        with engine.begin() as conn:
            conn.execute(
                text(
                    "DELETE FROM coord.overlord_interventions "
                    "WHERE outcome IN ('queued','reopened','finished') "
                    "OR label_kind = 'false_finish'"
                )
            )
        run_alembic(root, url, "downgrade", _PRIOR_REVISION_ID)
        with engine.connect() as conn:
            cols = {
                r[0]
                for r in conn.execute(
                    text(
                        "SELECT column_name FROM information_schema.columns "
                        "WHERE table_schema='coord' AND table_name='overlord_interventions'"
                    )
                )
            }
        assert not cols & {"legacy_class", "label_kind", "label_source", "executed"}
