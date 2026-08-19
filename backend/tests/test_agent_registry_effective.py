"""Unit tests for the agent-registry effective-view disposition fallback.

``disposition`` decides what happens when a POLICY-REQUIRED agent is
disabled, so it only becomes load-bearing once such an agent can be off —
which is exactly what seeding ``code-reviewer`` disabled introduces.

An unset disposition must read as ``degrade`` (keep the gate, do the work
inline), never ``block`` (refuse the gated action outright). That is the
documented contract in the ``agent_registry_01`` migration -- "NULL = unset
-> coord's degrade default" -- and the served policy's "a disable arriving
with NO recorded disposition falls back to degrade".
"""

from __future__ import annotations

from app.api.v1.endpoints.agent_registry import _merge_effective

_USER = "11111111-1111-1111-1111-111111111111"


def _row(**overrides):
    row = {
        "agent_name": "code-reviewer",
        "purpose": "Reviews code changes",
        "spawn_path": "in_session_subagent",
        "policy_required": True,
        "enabled": False,
        "disposition": None,
    }
    row.update(overrides)
    return row


def test_unset_disposition_falls_back_to_degrade():
    """The load-bearing case: policy-required, disabled, no recorded choice."""
    entries = _merge_effective([_row()], [], _USER)
    assert len(entries) == 1
    assert entries[0].disposition == "degrade"
    assert entries[0].enabled is False
    assert entries[0].source == "default"


def test_unset_disposition_is_not_block():
    """`block` would refuse the gated action entirely (never open the PR).

    Pinned separately from the positive assertion because this is the
    regression that matters: the two values differ in whether work stops.
    """
    assert _merge_effective([_row()], [], _USER)[0].disposition != "block"


def test_explicit_disposition_on_the_row_is_respected():
    entries = _merge_effective([_row(disposition="block")], [], _USER)
    assert entries[0].disposition == "block"


def test_user_pref_overrides_the_registry_default():
    prefs = [
        {
            "user_id": _USER,
            "agent_name": "code-reviewer",
            "enabled": True,
            "disposition": "warn_proceed",
        }
    ]
    entries = _merge_effective([_row()], prefs, _USER)
    assert entries[0].enabled is True
    assert entries[0].disposition == "warn_proceed"
    assert entries[0].source == "user_pref"


def test_another_users_pref_is_never_attributed_to_the_caller():
    prefs = [
        {
            "user_id": "22222222-2222-2222-2222-222222222222",
            "agent_name": "code-reviewer",
            "enabled": True,
            "disposition": "warn_proceed",
        }
    ]
    entries = _merge_effective([_row()], prefs, _USER)
    assert entries[0].enabled is False
    assert entries[0].disposition == "degrade"
    assert entries[0].source == "default"
