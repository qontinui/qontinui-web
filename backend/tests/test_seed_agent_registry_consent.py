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


def test_narrowed_allowed_dispositions_are_preserved():
    """The same consent rule as `default_enabled`, and it needs its own guard:
    coord REPLACES `allowed_dispositions` rather than merging it, so a seeder
    that always re-sent the full set would widen an operator's narrowed one
    back to all three without anyone deciding to."""
    body = seeder.build_body(
        _agent("code-reviewer"),
        POLICY_REQUIRED,
        {"default_enabled": True, "allowed_dispositions": ["degrade"]},
    )
    assert body["allowed_dispositions"] == ["degrade"]


def test_a_new_row_gets_the_full_disposition_set():
    body = seeder.build_body(_agent("code-reviewer"), POLICY_REQUIRED, None)
    assert body["allowed_dispositions"] == ["block", "degrade", "warn_proceed"]


# --------------------------------------------------------------------------
# `describe_change` — the dry run is the DEFAULT mode and the only safety
# surface this script has, so a plan that understates the write is the failure
# mode worth testing.
# --------------------------------------------------------------------------


def _stored(**overrides):
    """A registry row as coord would return it after a clean seed."""
    row = {
        "purpose": "",
        "spawn_path": "in_session_subagent",
        "model": None,
        "default_enabled": True,
        "policy_required": False,
        "allowed_dispositions": ["block", "degrade", "warn_proceed"],
        "fanout_bound": 1,
        "definition_body": "body",
    }
    row.update(overrides)
    return row


def test_a_round_trip_reports_unchanged():
    agent = seeder.AgentDef(
        agent_name="test-generator",
        purpose="p",
        model=None,
        body="body",
        source=_SEEDER,
    )
    stored = _stored(purpose="p")
    want = seeder.build_body(agent, POLICY_REQUIRED, stored)
    assert seeder.describe_change(stored, want) == "unchanged"


def test_an_edited_definition_body_is_reported():
    """The regression this derivation exists to prevent: `definition_body` is
    written on every run but was absent from the old hand-kept drift list, so
    editing an agent's markdown produced `unchanged` for the row the apply was
    about to rewrite."""
    want = _stored(definition_body="a new body")
    assert seeder.describe_change(_stored(), want) == "update: definition_body"


def test_a_changed_disposition_set_is_reported():
    want = _stored(allowed_dispositions=["degrade"])
    assert seeder.describe_change(_stored(), want) == "update: allowed_dispositions"


def test_a_none_text_field_does_not_read_as_drift():
    """coord COALESCEs the text columns to `''` rather than storing NULL, so a
    seeder-side `None` and a stored `''` are the same value. Comparing them raw
    reported permanent drift for every agent whose frontmatter omits
    `description`."""
    assert seeder.describe_change(_stored(), _stored(purpose=None)) == "unchanged"


def test_an_absent_row_is_new():
    assert seeder.describe_change(None, _stored()) == "new"


# --------------------------------------------------------------------------
# `--apply` — the preservation guarantee is only as good as the read it rests
# on, so the guard that refuses to write against an unread registry is tested
# through `main()` rather than around it. Nothing here touches the network:
# `http_json` is the single I/O seam and it is replaced wholesale.
# --------------------------------------------------------------------------

AGENT_MD = """---
name: {name}
description: {description}
---

# {name}
"""


@pytest.fixture
def agents_dir(tmp_path):
    d = tmp_path / "agents"
    d.mkdir()
    for name in ("code-reviewer", "test-generator"):
        (d / f"{name}.md").write_text(
            AGENT_MD.format(name=name, description=f"the {name}"), encoding="utf-8"
        )
    return d


def _run(monkeypatch, agents_dir, http, *argv):
    calls: list[tuple[str, str, dict | None]] = []

    def fake_http_json(url, token, method="GET", body=None):
        calls.append((method, url, body))
        return http(method, url, body)

    monkeypatch.setattr(seeder, "http_json", fake_http_json)
    monkeypatch.setattr(
        sys, "argv", ["seed_agent_registry.py", "--agents-dir", str(agents_dir), *argv]
    )
    return calls


def test_apply_refuses_when_the_registry_could_not_be_read(monkeypatch, agents_dir):
    """An unreadable registry is UNKNOWN, not empty.

    `default_enabled` is the one REQUIRED field of coord's upsert body, so a
    write built from rows this run never read would send the NEW-ROW default
    for every agent -- re-enabling one the operator had deselected. Refusing is
    the only behaviour that keeps the preserve-what-is-recorded promise honest.
    """
    calls = _run(
        monkeypatch,
        agents_dir,
        lambda method, url, body: (403, {"error": "forbidden"}),
        "--apply",
        "--token",
        "an-admin-bearer",
    )
    with pytest.raises(SystemExit) as exc:
        seeder.main()
    assert exc.value.code == 2
    assert [m for m, _, _ in calls] == ["GET"], "nothing may be written"


def test_apply_writes_every_row_when_the_read_succeeded(monkeypatch, agents_dir):
    calls = _run(
        monkeypatch,
        agents_dir,
        lambda method, url, body: (200, {"agents": []} if method == "GET" else {}),
        "--apply",
        "--token",
        "an-admin-bearer",
    )
    assert seeder.main() == 0
    puts = [url for method, url, _ in calls if method == "PUT"]
    assert len(puts) == 2
    assert puts[0].endswith("/coord/agent-registry/code-reviewer")


def test_apply_sends_the_recorded_value_not_the_new_row_default(
    monkeypatch, agents_dir
):
    """End-to-end on the guarantee: a row the operator turned ON stays on, even
    though `code-reviewer` is the agent whose NEW-row default is off."""
    stored = {
        "agents": [
            {"agent_name": "code-reviewer", "default_enabled": True},
        ]
    }
    calls = _run(
        monkeypatch,
        agents_dir,
        lambda method, url, body: (200, stored if method == "GET" else {}),
        "--apply",
        "--token",
        "an-admin-bearer",
    )
    assert seeder.main() == 0
    sent = {
        url.rsplit("/", 1)[-1]: body for method, url, body in calls if method == "PUT"
    }
    assert sent["code-reviewer"]["default_enabled"] is True
    assert sent["code-reviewer"]["policy_required"] is True
    assert sent["test-generator"]["default_enabled"] is True


def test_a_fatal_write_error_stops_and_says_what_was_never_attempted(
    monkeypatch, agents_dir, capsys
):
    """A credential the whole run shares cannot be wrong for one row and right
    for the next, so the loop breaks -- and the summary has to say the rest were
    untried rather than let `N of <total>` read as `the others succeeded`."""
    calls = _run(
        monkeypatch,
        agents_dir,
        lambda method, url, body: (
            (200, {"agents": []}) if method == "GET" else (403, {"error": "forbidden"})
        ),
        "--apply",
        "--token",
        "a-non-admin-bearer",
    )
    assert seeder.main() == 1
    assert len([m for m, _, _ in calls if m == "PUT"]) == 1
    assert "1 of 1 attempted rows failed" in capsys.readouterr().err


def test_an_unknown_policy_required_agent_is_bad_input(monkeypatch, agents_dir):
    """Exit 2, the documented bad-input code. `sys.exit("...")` exits 1, which
    made every usage error indistinguishable from a failed write."""
    _run(
        monkeypatch,
        agents_dir,
        lambda method, url, body: (200, {"agents": []}),
        "--policy-required",
        "no-such-agent",
    )
    with pytest.raises(SystemExit) as exc:
        seeder.main()
    assert exc.value.code == 2
