"""Consent defaults for the agent-registry seeder.

`build_body`'s `default_enabled` decides whether an agent spawn starts
happening on the USER'S OWN AI account without them ever choosing it, so it
gets a regression test even though the rest of the seeder is I/O.

The seeder lives at the REPO ROOT (`scripts/seed_agent_registry.py`), which a
plain `from scripts import ...` cannot reach: pytest's rootdir is `backend/`,
so that name binds to `backend/scripts/`. Hence the explicit path load. The
module imports stdlib only -- no DB, no app import -- so this is cheap.
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest

_SEEDER = Path(__file__).resolve().parents[2] / "scripts" / "seed_agent_registry.py"


def _load():
    spec = importlib.util.spec_from_file_location("_seed_agent_registry", _SEEDER)
    # assert, not pytest.skip: a seeder that cannot be imported is a real
    # failure, not a reason to quietly pass. It also narrows the Optionals for
    # the type checker, which `pytest.skip` does not.
    assert spec is not None and spec.loader is not None, f"cannot load {_SEEDER}"
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


seeder = _load()


def _agent(name: str):
    return seeder.AgentDef(
        agent_name=name,
        purpose="",
        model=None,
        body="",
        source=_SEEDER,
    )


POLICY_REQUIRED = {"code-reviewer"}


def test_policy_required_agent_seeds_disabled():
    """The one class that must be opted INTO.

    A policy-required agent is spawned by POLICY, with no per-use decision by
    the user, and the spawn runs on their own AI account.
    """
    body = seeder.build_body(_agent("code-reviewer"), POLICY_REQUIRED, None)
    assert body["policy_required"] is True
    assert body["default_enabled"] is False


def test_ordinary_agent_seeds_enabled():
    """Ordinary agents only spawn because a session deliberately invoked them
    for work the user asked for, so defaulting them off would break delegation
    rather than protect anyone."""
    for name in ("debugging-specialist", "test-generator", "repo-auditor"):
        body = seeder.build_body(_agent(name), POLICY_REQUIRED, None)
        assert body["policy_required"] is False, name
        assert body["default_enabled"] is True, name


def test_default_is_derived_from_policy_required_not_a_second_list():
    """Guards the drift this derivation exists to prevent: a future
    policy-required agent must not ship silently spawning because someone
    updated one list and not the other."""
    body = seeder.build_body(_agent("some-future-agent"), {"some-future-agent"}, None)
    assert body["policy_required"] is True
    assert body["default_enabled"] is False


@pytest.mark.parametrize("recorded", [True, False])
def test_existing_value_is_always_preserved(recorded: bool):
    """A re-run is not consent to change what an operator recorded -- in
    EITHER direction. Preserving only `False` would let a re-seed silently
    disable an agent the operator had turned on."""
    body = seeder.build_body(
        _agent("code-reviewer"),
        POLICY_REQUIRED,
        {"default_enabled": recorded},
    )
    assert body["default_enabled"] is recorded


def test_missing_default_enabled_on_an_existing_row_reads_as_enabled():
    """An existing row whose payload omits the field is treated as enabled --
    it is an already-seeded row, not a fresh one, so the new-row off-default
    must not retroactively disable it."""
    body = seeder.build_body(_agent("code-reviewer"), POLICY_REQUIRED, {})
    assert body["default_enabled"] is True
