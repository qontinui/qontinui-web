"""Unit tests for the agent-registry seeder's CONSENT defaults.

Covers the seam that decides whether an agent spawn happens on the user's
own AI account without them ever choosing it:

* ``AgentDefinition.default_enabled`` — policy-required agents seed OFF,
  ordinary agents seed ON.
* ``_UPSERT_SQL`` — a re-run must never write ``default_enabled`` back over
  a tenant's recorded choice.

The full ``seed()`` orchestration touches the DB and is not covered here;
this is the pure derivation that decides what gets written.
"""

from __future__ import annotations

from scripts import seed_agent_registry as seeder


def _definition(name: str) -> seeder.AgentDefinition:
    return seeder.AgentDefinition(
        agent_name=name,
        purpose="",
        model=None,
        effort=None,
        definition_body="",
    )


def test_code_reviewer_seeds_disabled():
    """The policy-required review agent is opt-IN, never opt-out.

    It spawns from POLICY rather than from a per-use decision, so seeding it
    enabled would spend the user's quota on every PR without them choosing.
    """
    entry = _definition("code-reviewer")
    assert entry.policy_required is True
    assert entry.default_enabled is False


def test_ordinary_agents_seed_enabled():
    """A non-policy-required agent only ever spawns because a session
    deliberately invoked it for work the user asked for, so defaulting it
    off would break delegation rather than protect anyone."""
    for name in ("debugging-specialist", "test-generator", "repo-auditor"):
        entry = _definition(name)
        assert entry.policy_required is False, name
        assert entry.default_enabled is True, name


def test_default_enabled_is_derived_from_policy_required():
    """Guards the drift this derivation exists to prevent.

    ``default_enabled`` must stay a function of ``policy_required`` rather
    than a second hand-kept set — otherwise a future policy-required agent
    ships silently spawning because someone updated one list and not the
    other.
    """
    for name in seeder.POLICY_REQUIRED_AGENTS:
        assert _definition(name).default_enabled is False, name
    assert _definition("definitely-not-registered").default_enabled is True


def test_upsert_never_overwrites_recorded_consent():
    """Re-running the seeder refreshes DEFINITION columns only.

    ``default_enabled`` is a consent value, not a definition-derived one. If
    it ever appears in the ``DO UPDATE SET`` list, a routine re-seed would
    silently re-enable a spawn the tenant turned off.
    """
    sql = str(seeder._UPSERT_SQL)
    _, _, on_conflict = sql.partition("ON CONFLICT")
    assert on_conflict, "upsert lost its ON CONFLICT clause"
    assert "default_enabled" not in on_conflict
    # The definition-derived columns SHOULD refresh.
    for column in ("purpose", "model", "effort", "policy_required"):
        assert column in on_conflict, column
