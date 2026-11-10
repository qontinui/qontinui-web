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

import argparse
import base64
import hashlib
import importlib.util
import json
import subprocess
import sys
import time
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

# The real request path, captured before any test replaces it.
REAL_HTTP_JSON = seeder.http_json

# The tests that build a throwaway repository (with a local bare `origin`) and
# run the seeder's real git against it. Every other test reaches git only
# through a fake it passes in.
REAL_GIT_TESTS = frozenset(
    {
        "test_retire_orphans_sends_nothing_from_a_checkout_off_origin_main",
        "test_retire_orphans_judges_origin_main_not_the_shared_checkouts_branch",
    }
)


@pytest.fixture(autouse=True)
def _hermetic(request, monkeypatch, tmp_path_factory):
    """Nothing in this module reaches the network, real git, or the
    developer's own credentials unless a test patches that seam in itself.

    `http_json` raises until a test replaces it, and so does `run_git`
    outside REAL_GIT_TESTS; the home directory is an empty temporary one
    (`Path.home()` itself is replaced: on Windows it ignores `$HOME`); the
    variables the seeder reads are unset; and git runs with no global or
    system config, so a developer's `commit.gpgsign` or `url.*.insteadOf`
    cannot reach a test repository. (`raising=False`: the suite also runs
    against a seeder that predates `run_git`, for the arming proof.)
    """
    home = tmp_path_factory.mktemp("home")
    monkeypatch.setattr(Path, "home", classmethod(lambda cls: home))
    for var in (
        "COORD_DEVICE_JWT",
        "COORD_HTTP_URL",
        "COORD_OPERATOR_JWT",
        "QONTINUI_TENANT_ID",
        "QONTINUI_SPAWN_CONTRACT_FILE",
    ):
        monkeypatch.delenv(var, raising=False)
    monkeypatch.setenv("GIT_CONFIG_GLOBAL", str(home / "no-global-gitconfig"))
    monkeypatch.setenv("GIT_CONFIG_NOSYSTEM", "1")

    def unstubbed(name):
        def refuse(*_args, **_kwargs):
            raise AssertionError(
                f"this test reached the real {name} without stubbing it"
            )

        return refuse

    monkeypatch.setattr(seeder, "http_json", unstubbed("http_json"))
    if request.node.originalname not in REAL_GIT_TESTS:
        monkeypatch.setattr(seeder, "run_git", unstubbed("run_git"), raising=False)


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
        answer = http(method, url, body)
        if isinstance(answer, Exception):
            raise answer
        return answer

    monkeypatch.setattr(seeder, "http_json", fake_http_json)
    # The seed path now reports orphans, which reads the pinned spawn contract;
    # a fixture keeps these tests off the filesystem and git. (`raising=False`:
    # the same tests also run against a seeder that predates the report.)
    monkeypatch.setattr(seeder, "load_spawn_contract", lambda: CONTRACT, raising=False)
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


# --------------------------------------------------------------------------
# Orphans and `--retire-orphans` (plan
# 2026-11-06-what-the-fleet-records-and-advertises-matches-what-actually-ran,
# Phase 6). An orphan is a role row whose definition is gone; retiring one
# goes through coord's narrowing-only `POST /coord/agent-registry/retire`.
# The two guarantees pinned here: a spawn-contract row is NEVER an orphan
# (disabling `operator_spawn` vetoes every operator spawn), and nothing is
# sent unless every source the decision rests on was PROVEN.
# --------------------------------------------------------------------------

# The shape of `qontinui-schemas/rust/src/spawn_authorization.json`, trimmed to
# what the seeder reads.
CONTRACT = {
    "spawn_paths": ["in_session_subagent", "parallel_fanout", "standing_continuation"],
    "kind_seeds": [
        {
            "agent_name": "operator_spawn",
            "spawn_path": "in_session_subagent",
            "purpose": "p",
        },
        {
            "agent_name": "gate_continuation",
            "spawn_path": "standing_continuation",
            "purpose": "p",
        },
    ],
    "class_seeds": [
        {
            "spawn_path": "in_session_subagent",
            "seeded": False,
            "reason": "r",
            "purpose": "p",
        },
        {
            "spawn_path": "parallel_fanout",
            "seeded": True,
            "reason": None,
            "purpose": "p",
        },
        {
            "spawn_path": "standing_continuation",
            "seeded": True,
            "reason": None,
            "purpose": "p",
        },
    ],
}

LIVE_MAIN = "a" * 40
TENANT = "0b1e8c6e-5a51-4c55-9a3d-7a2f6f1c2d3e"
OTHER_TENANT = "9f9f9f9f-1111-4222-8333-444455556666"
CONFIG_URL = "https://github.com/qontinui/qontinui-claude-config.git"
OWNERSHIP_PATH = "/pr-merge/qontinui%2Fqontinui-claude-config/0/author-session"
OWNED = (200, {"repo": "qontinui/qontinui-claude-config", "pr": 0, "resolved": False})


def _jwt(exp: int, **claims) -> str:
    payload = (
        base64.urlsafe_b64encode(json.dumps({"exp": exp, **claims}).encode())
        .decode()
        .rstrip("=")
    )
    return f"h.{payload}.s"


def _fresh_jwt(tenant_id: str | None = TENANT) -> str:
    claims = {} if tenant_id is None else {"tenant_id": tenant_id}
    return _jwt(int(time.time()) + 3600, **claims)


def _source():
    """The fixture definitions source. A function, not a module constant, so
    this file still COLLECTS against a seeder that predates the orphan code:
    the arming prover runs these tests at the base, and a module-level name
    the base lacks would fail the whole file at import instead of failing the
    tests that need it."""
    return seeder.DefinitionSource(
        names={"code-reviewer", "debugging-specialist"},
        commit=LIVE_MAIN,
        described="fixture definitions at origin main",
    )


def _row(name, spawn_path="in_session_subagent", policy_required=False):
    """A row as `GET /coord/agent-registry/effective` serves it."""
    return {
        "agent_name": name,
        "spawn_path": spawn_path,
        "policy_required": policy_required,
        "enabled": True,
        "source": "default",
    }


# What the effective door serves a tenant: coord's own contract rows on every
# path, two role rows with definitions, and one role row whose definition is
# gone. `operator_spawn` is the trap: in-session, enabled, not policy-required
# and with no definition, row-for-row the shape of `test-generator`.
EFFECTIVE = [
    _row("operator_spawn"),
    _row("gate_continuation", "standing_continuation"),
    _row("standing_continuation", "standing_continuation"),
    _row("parallel_fanout", "parallel_fanout"),
    _row("code-reviewer", policy_required=True),
    _row("debugging-specialist"),
    _row("test-generator"),
]


def _run_retire(
    monkeypatch,
    http,
    *argv,
    contract=CONTRACT,
    source=None,
    token=None,
):
    """Run `main()` with `--retire-orphans`, every seam replaced. A seam given
    an Exception raises it, which is how an unproven source is simulated. The
    default token acts in TENANT; the default coord proves TENANT owns the
    config repository."""
    calls: list[tuple[str, str, dict | None]] = []

    def fake_http_json(url, tok, method="GET", body=None):
        calls.append((method, url, body))
        answer = http(method, url, body)
        if isinstance(answer, Exception):
            raise answer
        return answer

    def seam(value):
        def call(*_args, **_kwargs):
            if isinstance(value, Exception):
                raise value
            return value

        return call

    monkeypatch.setattr(seeder, "http_json", fake_http_json)
    monkeypatch.setattr(seeder, "load_spawn_contract", seam(contract))
    monkeypatch.setattr(
        seeder, "resolve_definitions", seam(_source() if source is None else source)
    )
    monkeypatch.setattr(
        seeder, "resolve_device_token", seam(_fresh_jwt() if token is None else token)
    )
    monkeypatch.setattr(
        sys, "argv", ["seed_agent_registry.py", "--retire-orphans", *argv]
    )
    return calls


def _coord(
    effective=EFFECTIVE,
    retire=(200, {"retired": True, "changed": True}),
    owner=OWNED,
):
    def http(method, url, body):
        if method == "GET" and url.endswith(OWNERSHIP_PATH):
            return owner
        if method == "GET" and url.endswith("/coord/agent-registry/effective"):
            return 200, {"agents": effective, "user_scoped": True}
        if method == "POST" and url.endswith("/coord/agent-registry/retire"):
            return retire
        raise AssertionError(f"unexpected {method} {url}")

    return http


def _posted(calls):
    return [body["agent_name"] for method, _, body in calls if method == "POST"]


def test_contract_rows_are_never_orphans_and_never_sent(monkeypatch, capsys):
    """`operator_spawn`, `standing_continuation` and `parallel_fanout` are
    never ORPHAN and never sent. Only the definition-less role row is."""
    calls = _run_retire(monkeypatch, _coord())
    assert seeder.main() == 0
    assert _posted(calls) == ["test-generator"]
    out = capsys.readouterr().out
    assert "ORPHAN test-generator (no definition)" in out
    for name in (
        "operator_spawn",
        "standing_continuation",
        "parallel_fanout",
        "gate_continuation",
    ):
        assert f"ORPHAN {name}" not in out, name


def test_a_definition_less_role_row_is_retired_through_the_agent_door(
    monkeypatch, capsys
):
    """It goes to the narrowing-only door with the device JWT, never the admin
    PUT, and its reason names the origin-main commit it was judged against."""
    calls = _run_retire(monkeypatch, _coord())
    assert seeder.main() == 0
    [(method, url, body)] = [c for c in calls if c[0] == "POST"]
    assert url == "https://coord.qontinui.io/coord/agent-registry/retire"
    assert set(body) == {"agent_name", "reason"}
    assert body["agent_name"] == "test-generator"
    assert LIVE_MAIN in body["reason"]
    assert not [c for c in calls if c[0] == "PUT"], (
        "the retire path never uses the admin door"
    )
    out = capsys.readouterr().out
    assert "RETIRED test-generator" in out
    assert f"tenant     : {TENANT}" in out


@pytest.mark.parametrize(
    ("row", "is_orphan"),
    [
        (_row("test-generator"), True),
        (_row("code-reviewer"), False),  # it has a definition
        (_row("operator_spawn"), False),  # a kind seed on the role path
        (_row("in_session_subagent"), False),  # an unseeded class row
        (_row("custom-standing", "standing_continuation"), False),  # off the role path
        (_row("custom-future", "a_future_path"), False),  # an unknown path, fail closed
    ],
)
def test_find_orphans_enumerates_every_arm(row, is_orphan):
    orphans = seeder.find_orphans(
        [row], {"code-reviewer"}, seeder.contract_names(CONTRACT)
    )
    assert (orphans == [row]) is is_orphan


def test_a_policy_required_orphan_is_reported_and_not_sent(monkeypatch, capsys):
    """The door refuses it, and only an operator may disable it choosing a
    disposition, so the seeder says so instead of sending a doomed request —
    and its summary says one was left in place."""
    effective = [_row("retired-reviewer", policy_required=True), _row("test-generator")]
    calls = _run_retire(monkeypatch, _coord(effective=effective))
    assert seeder.main() == 0
    assert _posted(calls) == ["test-generator"]
    out = capsys.readouterr().out
    assert "ORPHAN retired-reviewer (no definition) - policy_required, not sent" in out
    assert "1 policy-required orphan(s) left in place" in out


@pytest.mark.parametrize(
    "unproven",
    ["contract", "source", "token"],
)
def test_an_unproven_source_sends_nothing(monkeypatch, capsys, unproven):
    """An unreadable contract, a definitions source not proven to be origin
    main, or no fresh credential: exit 3 (UNKNOWN) with nothing read or sent."""
    failure = seeder.UnprovenError(f"the {unproven} could not be proven")
    kwargs = {unproven: failure}
    calls = _run_retire(monkeypatch, _coord(), **kwargs)
    assert seeder.main() == seeder.EXIT_UNPROVEN
    assert calls == [], "nothing may be read or sent on an unproven source"
    assert "nothing sent" in capsys.readouterr().err


def test_an_unreadable_registry_sends_nothing(monkeypatch):
    def http(method, url, body):
        assert method == "GET", "nothing may be sent"
        if url.endswith(OWNERSHIP_PATH):
            return OWNED
        return 503, {"error": "registry_not_provisioned"}

    calls = _run_retire(monkeypatch, http)
    assert seeder.main() == seeder.EXIT_UNPROVEN
    assert _posted(calls) == []


def test_a_non_200_registry_read_is_unknown_even_when_it_lists_agents(monkeypatch):
    """The status decides, not the body's shape: a 503 that still carries an
    `agents` list is not a registry read, so the rows are UNKNOWN and nothing
    is sent."""

    def http(method, url, body):
        assert method == "GET", "nothing may be sent"
        if url.endswith(OWNERSHIP_PATH):
            return OWNED
        return 503, {"agents": EFFECTIVE, "error": "registry_degraded"}

    calls = _run_retire(monkeypatch, http)
    assert seeder.main() == seeder.EXIT_UNPROVEN
    assert _posted(calls) == []


def test_the_dry_run_proves_everything_and_sends_nothing(monkeypatch, capsys):
    calls = _run_retire(monkeypatch, _coord(), "--dry-run")
    assert seeder.main() == 0
    assert _posted(calls) == []
    assert "ORPHAN test-generator (no definition)" in capsys.readouterr().out


def test_an_already_retired_row_is_not_a_failure(monkeypatch, capsys):
    calls = _run_retire(
        monkeypatch, _coord(retire=(200, {"retired": True, "changed": False}))
    )
    assert seeder.main() == 0
    assert _posted(calls) == ["test-generator"]
    assert "RETIRED test-generator (already retired)" in capsys.readouterr().out


def test_a_200_that_does_not_say_retired_is_a_failure(monkeypatch):
    """Only `retired: true` is success: a 200 that does not say it (a proxy
    page, a door that changed its body) is not read as a retirement."""
    calls = _run_retire(monkeypatch, _coord(retire=(200, {"changed": True})))
    assert seeder.main() == 1
    assert _posted(calls) == ["test-generator"]


@pytest.mark.parametrize(
    "answer",
    [
        (403, {"error": "presenter_not_write_authority"}),
        # A coord that predates the door: its admin `PUT /:agent_name` route
        # captures the path and `require_role` answers a device JWT with 401.
        (401, {"error": "unauthorized"}),
        (502, "<html>bad gateway</html>"),  # no typed answer at all
    ],
)
def test_a_fatal_answer_stops_the_run(monkeypatch, answer):
    """A refused credential, a coord predating the door, or an untyped answer
    is the same for every row, so the rest are not attempted and the run exits 1."""
    effective = [_row("orphan-a"), _row("orphan-b")]
    calls = _run_retire(monkeypatch, _coord(effective=effective, retire=answer))
    assert seeder.main() == 1
    assert _posted(calls) == ["orphan-a"]


def test_a_refused_row_does_not_stop_the_others(monkeypatch):
    """A typed per-row refusal (say a row that became policy-required) fails
    that row only; the run still exits 1."""
    effective = [_row("orphan-a"), _row("orphan-b")]
    calls = _run_retire(
        monkeypatch,
        _coord(effective=effective, retire=(422, {"error": "policy_required"})),
    )
    assert seeder.main() == 1
    assert _posted(calls) == ["orphan-a", "orphan-b"]


def test_retire_orphans_and_apply_are_mutually_exclusive(monkeypatch):
    """Every seam is stubbed, so a regressed group still reaches nothing real."""

    def http(method, url, body):
        raise AssertionError(f"argparse must refuse before any request: {method} {url}")

    _run_retire(monkeypatch, http, "--apply")
    with pytest.raises(SystemExit) as exc:
        seeder.main()
    assert exc.value.code == 2


def test_the_device_token_is_never_taken_from_argv(monkeypatch):
    """A bearer on argv is visible in `ps` and shell history: there is no flag."""

    def http(method, url, body):
        raise AssertionError(f"argparse must refuse before any request: {method} {url}")

    _run_retire(monkeypatch, http, "--device-token", _fresh_jwt())
    with pytest.raises(SystemExit) as exc:
        seeder.main()
    assert exc.value.code == 2


def test_the_seed_run_reports_orphans_and_writes_nothing_for_them(
    monkeypatch, agents_dir, capsys
):
    """The default dry run reports what it read; it never retires."""
    stored = {
        "agents": [_row("code-reviewer"), _row("retired-agent"), _row("operator_spawn")]
    }
    calls = _run(
        monkeypatch,
        agents_dir,
        lambda method, url, body: (200, stored),
        "--token",
        "an-admin-bearer",
    )
    assert seeder.main() == 0
    out = capsys.readouterr().out
    assert "ORPHAN retired-agent (no definition)" in out
    assert "ORPHAN operator_spawn" not in out
    assert [m for m, _, _ in calls] == ["GET"], "a report writes nothing"


def test_the_seed_run_says_unknown_when_the_registry_was_not_read(
    monkeypatch, agents_dir, capsys
):
    """An unread registry is no orphans UNKNOWN, never `orphans: 0`."""
    _run(
        monkeypatch,
        agents_dir,
        lambda method, url, body: (403, {"error": "forbidden"}),
    )
    assert seeder.main() == 0
    out = capsys.readouterr().out
    assert "orphans    : UNKNOWN - the registry was not read" in out
    assert "orphans    : 0" not in out


def test_the_seed_run_says_unknown_when_the_contract_is_unproven(
    monkeypatch, agents_dir, capsys
):
    stored = {"agents": [_row("code-reviewer"), _row("retired-agent")]}
    _run(monkeypatch, agents_dir, lambda method, url, body: (200, stored))

    def unproven():
        raise seeder.UnprovenError("the pin is unreadable")

    monkeypatch.setattr(seeder, "load_spawn_contract", unproven)
    assert seeder.main() == 0
    out = capsys.readouterr().out
    assert "orphans    : UNKNOWN - the pin is unreadable" in out
    assert "ORPHAN retired-agent" not in out


def test_an_unreachable_coord_on_the_seed_path_exits_1(monkeypatch, agents_dir):
    calls = _run(
        monkeypatch,
        agents_dir,
        lambda method, url, body: seeder.CoordUnreachableError(
            f"cannot reach coord at {url}: refused"
        ),
    )
    assert seeder.main() == 1
    assert [m for m, _, _ in calls] == ["GET"]


# ---- the acting tenant -----------------------------------------------------


def test_the_tenant_is_proven_before_any_row_is_read(monkeypatch):
    calls = _run_retire(monkeypatch, _coord())
    assert seeder.main() == 0
    gets = [url for method, url, _ in calls if method == "GET"]
    assert gets[0].endswith(OWNERSHIP_PATH), "ownership is proven FIRST"
    assert gets[1].endswith("/coord/agent-registry/effective")


@pytest.mark.parametrize(
    "owner",
    [
        (404, {"error": "no author session"}),  # this tenant does not own it
        (500, {"error": "tenant repo resolution failed"}),  # UNKNOWN
        (200, {"repo": "someone/qontinui-claude-config", "pr": 0}),  # not about it
    ],
)
def test_a_tenant_not_proven_to_own_the_config_repo_reads_and_sends_nothing(
    monkeypatch, capsys, owner
):
    """On a device bound to several tenants a token for another tenant would
    judge THAT tenant's role rows against these definitions: refused, exit 3,
    no row read."""
    calls = _run_retire(monkeypatch, _coord(owner=owner))
    assert seeder.main() == seeder.EXIT_UNPROVEN
    assert [url for _, url, _ in calls if not url.endswith(OWNERSHIP_PATH)] == []
    assert "nothing sent" in capsys.readouterr().err


def test_a_token_naming_no_tenant_reads_and_sends_nothing(monkeypatch):
    calls = _run_retire(monkeypatch, _coord(), token=_fresh_jwt(tenant_id=None))
    assert seeder.main() == seeder.EXIT_UNPROVEN
    assert calls == []


@pytest.mark.parametrize("named_by", ["flag", "env"])
def test_a_named_tenant_the_token_does_not_act_in_reads_and_sends_nothing(
    monkeypatch, named_by
):
    argv = ("--tenant", OTHER_TENANT) if named_by == "flag" else ()
    if named_by == "env":
        monkeypatch.setenv("QONTINUI_TENANT_ID", OTHER_TENANT)
    # The token acts in TENANT, stated rather than inherited from the helper's
    # default: the mismatch with the named OTHER_TENANT is what is under test.
    calls = _run_retire(monkeypatch, _coord(), *argv, token=_fresh_jwt(TENANT))
    assert seeder.main() == seeder.EXIT_UNPROVEN
    assert calls == []


def test_the_named_tenant_is_matched_case_insensitively(monkeypatch):
    calls = _run_retire(monkeypatch, _coord(), "--tenant", TENANT.upper())
    assert seeder.main() == 0
    assert _posted(calls) == ["test-generator"]


def test_a_malformed_named_tenant_is_refused(monkeypatch, capsys):
    # A well-formed token acting in TENANT, stated: only the named value is bad.
    calls = _run_retire(
        monkeypatch, _coord(), "--tenant", "qontinui", token=_fresh_jwt(TENANT)
    )
    assert seeder.main() == seeder.EXIT_UNPROVEN
    assert calls == []
    # Refused as MALFORMED, not as a tenant mismatch: the claim comparison would
    # refuse it too, but only this reason tells the caller what to fix.
    assert "is not a UUID" in capsys.readouterr().err


def test_an_unreachable_coord_while_proving_sends_nothing_and_exits_3(monkeypatch):
    def http(method, url, body):
        return seeder.CoordUnreachableError(f"cannot reach coord at {url}: refused")

    calls = _run_retire(monkeypatch, http)
    assert seeder.main() == seeder.EXIT_UNPROVEN
    assert _posted(calls) == []


def test_an_unreachable_coord_mid_run_stops_and_exits_1(monkeypatch):
    effective = [_row("orphan-a"), _row("orphan-b")]
    inner = _coord(effective=effective)

    def http(method, url, body):
        if method == "POST":
            return seeder.CoordUnreachableError(f"cannot reach coord at {url}: reset")
        return inner(method, url, body)

    calls = _run_retire(monkeypatch, http)
    assert seeder.main() == 1
    assert _posted(calls) == ["orphan-a"], "the rest are not attempted"


# ---- the sources, each proven or refused ----------------------------------


def _git(responses):
    """A fake `run_git`: `responses` maps an argument tuple's leading words to
    the bytes git would print, or None for a failure. Records every call."""
    seen: list[tuple[str, ...]] = []

    def git(repo, *args):
        seen.append(args)
        for prefix, out in responses.items():
            if args[: len(prefix)] == prefix:
                return out(args) if callable(out) else out
        return None

    git.seen = seen
    return git


def _listing(*names: str) -> bytes:
    """`git ls-tree -z --name-only` output for these `.claude/agents/` entries."""
    return b"".join(f".claude/agents/{n}\0".encode() for n in names)


def _origin_git(overrides=None):
    responses = {
        ("config",): f"{CONFIG_URL}\n".encode(),
        ("ls-remote",): f"{LIVE_MAIN}\trefs/heads/main\n".encode(),
        ("cat-file",): b"",
        ("ls-tree",): _listing("code-reviewer.md", "README.txt"),
    }
    responses.update(overrides or {})
    return _git(responses)


def test_origin_main_definitions_come_from_the_live_commit_not_the_working_tree(
    tmp_path,
):
    git = _origin_git()
    source = seeder.definitions_from_origin_main(tmp_path, git)
    assert source.names == {"code-reviewer"}
    assert source.commit == LIVE_MAIN
    assert ("ls-tree", "-z", "--name-only", LIVE_MAIN, ".claude/agents/") in git.seen


def test_origin_main_fetches_missing_objects_then_refuses(tmp_path):
    git = _git(
        {
            ("config",): f"{CONFIG_URL}\n".encode(),
            ("ls-remote",): f"{LIVE_MAIN}\trefs/heads/main\n".encode(),
            ("fetch",): b"",
        }
    )
    with pytest.raises(seeder.UnprovenError, match="even after a fetch"):
        seeder.definitions_from_origin_main(tmp_path, git)
    assert (
        "fetch",
        "--quiet",
        "--no-write-fetch-head",
        "--no-auto-gc",
        "--refmap=",
        "origin",
        "main",
    ) in git.seen, (
        "it must try a fetch first, and one that moves no ref, writes no "
        "FETCH_HEAD and starts no gc in the shared checkout"
    )


@pytest.mark.parametrize(
    ("overrides", "match"),
    [
        ({("ls-remote",): None}, "could not read the live origin main"),
        # Every later step would succeed, so only the sha check can refuse it.
        ({("ls-remote",): b"not-a-sha\trefs/heads/main\n"}, "live origin main"),
        (
            {("ls-remote",): f"{'A' * 40}\trefs/heads/main\n".encode()},
            "live origin main",
        ),
        ({("ls-tree",): b""}, "lists no agent definitions"),
        ({("ls-tree",): _listing("README.txt")}, "lists no agent definitions"),
        ({("ls-tree",): None}, "could not list"),
        ({("config",): None}, "is not a qontinui-claude-config checkout"),
        (
            {("config",): b"git@github.com:someone/qontinui-claude-config.git\n"},
            "is not a qontinui-claude-config checkout",
        ),
    ],
)
def test_origin_main_refuses_what_it_cannot_prove(tmp_path, overrides, match):
    with pytest.raises(seeder.UnprovenError, match=match):
        seeder.definitions_from_origin_main(tmp_path, _origin_git(overrides))


@pytest.mark.parametrize(
    "url",
    [
        "https://github.com/qontinui/qontinui-claude-config.git",
        "https://github.com/qontinui/qontinui-claude-config",
        "https://github.com/qontinui/qontinui-claude-config/",
        "git@github.com:qontinui/qontinui-claude-config.git",
        "ssh://git@github.com/qontinui/qontinui-claude-config.git",
        "https://x-access-token@github.com/qontinui/qontinui-claude-config.git",
    ],
)
def test_the_config_repo_is_recognised_by_its_github_origin(tmp_path, url):
    assert seeder.is_config_repo(tmp_path, _git({("config",): url.encode()}))


@pytest.mark.parametrize(
    "url",
    [
        "git@github.com:someone/qontinui-claude-config.git",  # a fork
        "https://evil.example/qontinui/qontinui-claude-config.git",  # a look-alike host
        "https://github.com/qontinui/qontinui-claude-config-fork.git",
        "/srv/mirrors/qontinui-claude-config.git",  # a local mirror
        "",
    ],
)
def test_anything_else_is_not_the_config_repo(tmp_path, url):
    assert not seeder.is_config_repo(tmp_path, _git({("config",): url.encode()}))


def _checkout(tmp_path):
    agents = tmp_path / ".claude" / "agents"
    agents.mkdir(parents=True)
    (agents / "code-reviewer.md").write_text(
        "---\nname: code-reviewer\n---\n", encoding="utf-8"
    )
    return agents


def _worktree_git(
    tmp_path,
    head=LIVE_MAIN,
    status=b"",
    url=f"{CONFIG_URL}\n".encode(),
    listing=_listing("code-reviewer.md"),
):
    return _git(
        {
            ("rev-parse", "--show-toplevel"): f"{tmp_path}\n".encode(),
            ("config",): url,
            ("ls-remote",): f"{LIVE_MAIN}\trefs/heads/main\n".encode(),
            ("rev-parse", "HEAD"): f"{head}\n".encode(),
            ("status",): status,
            ("ls-tree",): listing,
        }
    )


def test_an_explicit_agents_dir_at_origin_main_and_clean_is_proven(tmp_path):
    agents = _checkout(tmp_path)
    source = seeder.definitions_from_worktree(agents, _worktree_git(tmp_path))
    assert source.names == {"code-reviewer"}
    assert source.commit == LIVE_MAIN


def test_an_explicit_agents_dir_is_judged_by_its_commit_tree_not_its_files(tmp_path):
    """A skip-worktree or sparse definition is absent from disk and from
    `git status`, but present in the tree: it still counts as defined."""
    agents = _checkout(tmp_path)
    git = _worktree_git(tmp_path, listing=_listing("code-reviewer.md", "hidden.md"))
    source = seeder.definitions_from_worktree(agents, git)
    assert source.names == {"code-reviewer", "hidden"}


@pytest.mark.parametrize(
    ("overrides", "match"),
    [
        ({"head": "b" * 40}, "not qontinui-claude-config origin main"),  # stale or peer
        (
            {"status": b"?? .claude/agents/new-agent.md\n"},
            "uncommitted or untracked",
        ),  # an untracked definition
        ({"status": None}, "uncommitted or untracked"),  # git status itself failed
        (
            {"url": b"git@github.com:qontinui/qontinui-web.git\n"},
            "is not a qontinui-claude-config checkout",
        ),
        ({"listing": b""}, "lists no agent definitions"),
    ],
)
def test_an_explicit_agents_dir_not_proven_origin_main_is_refused(
    tmp_path, overrides, match
):
    agents = _checkout(tmp_path)
    with pytest.raises(seeder.UnprovenError, match=match):
        seeder.definitions_from_worktree(agents, _worktree_git(tmp_path, **overrides))


def test_an_agents_dir_that_is_not_the_checkouts_own_is_refused(tmp_path):
    """Any other directory of the checkout (`knowledge-base/`, say) would make
    every role an orphan; it holds a definition here so only the path check
    can refuse it."""
    elsewhere = tmp_path / "elsewhere"
    elsewhere.mkdir()
    (elsewhere / "code-reviewer.md").write_text("---\n---\n", encoding="utf-8")
    with pytest.raises(seeder.UnprovenError, match="must be <checkout>/.claude/agents"):
        seeder.definitions_from_worktree(elsewhere, _worktree_git(tmp_path))


# ---- the pinned spawn contract --------------------------------------------


def _pinned_repo(tmp_path, contract_bytes, sibling_bytes=None):
    """A repo root with a pin naming `contract_bytes`, and optionally a sibling
    qontinui-schemas checkout holding `sibling_bytes` in its tree."""
    repo = tmp_path / "qontinui-web"
    repo.mkdir()
    ref = "c" * 40
    digest = hashlib.sha256(contract_bytes).hexdigest()
    (repo / "spawn-contract.pin.toml").write_text(
        f'[spawn_contract]\nref = "{ref}"\nsha256 = "{digest}"\n', encoding="utf-8"
    )
    if sibling_bytes is not None:
        path = tmp_path / "qontinui-schemas" / "rust" / "src"
        path.mkdir(parents=True)
        (path / "spawn_authorization.json").write_bytes(sibling_bytes)
    return repo, ref


def test_the_contract_is_read_from_the_sibling_at_the_pinned_digest(tmp_path):
    data = json.dumps(CONTRACT).encode()
    repo, _ = _pinned_repo(tmp_path, data, sibling_bytes=data)
    git = _git({})
    assert seeder.load_spawn_contract(repo, env={}, git=git) == CONTRACT
    assert git.seen == [], "a sibling at the pinned digest needs no git"


def test_a_moved_sibling_falls_back_to_the_pinned_blob(tmp_path):
    data = json.dumps(CONTRACT).encode()
    repo, ref = _pinned_repo(tmp_path, data, sibling_bytes=b'{"moved": true}')
    git = _git({("show",): data})
    assert seeder.load_spawn_contract(repo, env={}, git=git) == CONTRACT
    assert git.seen == [("show", f"{ref}:rust/src/spawn_authorization.json")]


@pytest.mark.parametrize("blob", [None, b'{"kind_seeds": []}'])
def test_a_contract_not_at_the_pinned_digest_is_unproven(tmp_path, blob):
    """The blob is unreadable, or readable at another digest: either way the
    seeder does not know every contract row, so it protects none of them."""
    repo, _ = _pinned_repo(tmp_path, json.dumps(CONTRACT).encode(), sibling_bytes=b"{}")
    with pytest.raises(seeder.UnprovenError):
        seeder.load_spawn_contract(repo, env={}, git=_git({("show",): blob}))


def test_the_override_is_digest_checked_with_no_fallback(tmp_path):
    """Set, the override is the ONLY source: a wrong file is refused even when
    the sibling would have matched, as spawnPathContract.test.ts does."""
    data = json.dumps(CONTRACT).encode()
    repo, _ = _pinned_repo(tmp_path, data, sibling_bytes=data)
    wrong = tmp_path / "override.json"
    wrong.write_bytes(b"{}")
    env = {"QONTINUI_SPAWN_CONTRACT_FILE": str(wrong)}
    with pytest.raises(seeder.UnprovenError, match="has sha256"):
        seeder.load_spawn_contract(repo, env=env, git=_git({}))
    right = tmp_path / "right.json"
    right.write_bytes(data)
    env = {"QONTINUI_SPAWN_CONTRACT_FILE": str(right)}
    assert seeder.load_spawn_contract(repo, env=env, git=_git({})) == CONTRACT


def test_under_ci_the_override_is_required(tmp_path):
    """spawnPathContract.test.ts's CI arm: under `$GITHUB_ACTIONS` there is no
    sibling or blob fallback, even with the sibling at the pinned digest."""
    data = json.dumps(CONTRACT).encode()
    repo, _ = _pinned_repo(tmp_path, data, sibling_bytes=data)
    git = _git({("show",): data})
    with pytest.raises(seeder.UnprovenError, match="it is unset"):
        seeder.load_spawn_contract(repo, env={"GITHUB_ACTIONS": "true"}, git=git)
    assert git.seen == []
    right = tmp_path / "right.json"
    right.write_bytes(data)
    env = {"GITHUB_ACTIONS": "true", "QONTINUI_SPAWN_CONTRACT_FILE": str(right)}
    assert seeder.load_spawn_contract(repo, env=env, git=git) == CONTRACT


def test_an_unreadable_contract_file_is_unproven_not_a_crash(tmp_path, monkeypatch):
    data = json.dumps(CONTRACT).encode()
    repo, _ = _pinned_repo(tmp_path, data)
    override = tmp_path / "override.json"
    override.write_bytes(data)
    real_read_bytes = Path.read_bytes

    def read_bytes(self):
        if self == override:
            raise PermissionError(13, "Permission denied", str(self))
        return real_read_bytes(self)

    monkeypatch.setattr(Path, "read_bytes", read_bytes)
    env = {"QONTINUI_SPAWN_CONTRACT_FILE": str(override)}
    with pytest.raises(seeder.UnprovenError, match="unreadable"):
        seeder.load_spawn_contract(repo, env=env, git=_git({}))


@pytest.mark.parametrize("missing", ["kind_seeds", "class_seeds", "spawn_paths"])
def test_a_contract_missing_a_list_protects_nothing_so_is_unproven(missing):
    contract = {k: v for k, v in CONTRACT.items() if k != missing}
    with pytest.raises(seeder.UnprovenError, match="missing"):
        seeder.contract_names(contract)


@pytest.mark.parametrize("emptied", ["kind_seeds", "class_seeds", "spawn_paths"])
def test_a_contract_with_an_empty_list_protects_nothing_so_is_unproven(emptied):
    contract = {**CONTRACT, emptied: []}
    with pytest.raises(seeder.UnprovenError, match="lists no"):
        seeder.contract_names(contract)


def test_contract_names_cover_kinds_classes_and_paths():
    names = seeder.contract_names(CONTRACT)
    assert {"operator_spawn", "gate_continuation"} <= names
    assert {"in_session_subagent", "parallel_fanout", "standing_continuation"} <= names


# ---- the credential --------------------------------------------------------


def test_an_expired_device_token_is_skipped_for_a_fresh_one(tmp_path):
    now = 1_000_000.0
    stale, fresh = _jwt(int(now) - 10), _jwt(int(now) + 3600)
    token_file = tmp_path / "coord-device-jwt"
    token_file.write_text(fresh, encoding="utf-8")
    assert (
        seeder.resolve_device_token(
            {"COORD_DEVICE_JWT": stale}, token_file, lambda: now
        )
        == fresh
    )
    assert (
        seeder.resolve_device_token(
            {"COORD_DEVICE_JWT": fresh}, tmp_path / "none", lambda: now
        )
        == fresh
    )


def test_no_fresh_device_token_is_unproven(tmp_path):
    now = 1_000_000.0
    nearly = _jwt(int(now) + 30)  # inside the freshness margin
    with pytest.raises(seeder.UnprovenError):
        seeder.resolve_device_token(
            {"COORD_DEVICE_JWT": nearly}, tmp_path / "none", lambda: now
        )
    with pytest.raises(seeder.UnprovenError):
        seeder.resolve_device_token(
            {"COORD_DEVICE_JWT": "not-a-jwt"}, tmp_path / "none", lambda: now
        )


def test_surrounding_whitespace_is_stripped_and_inner_whitespace_refused(tmp_path):
    """A CRLF file read with `$(cat …)` leaves a trailing CR in the variable:
    stripped, never sent. A value with whitespace INSIDE it is not a JWT."""
    now = 1_000_000.0
    fresh = _jwt(int(now) + 3600)
    none = tmp_path / "none"
    assert (
        seeder.resolve_device_token(
            {"COORD_DEVICE_JWT": fresh + "\r\n"}, none, lambda: now
        )
        == fresh
    )
    # Inside the SIGNATURE segment, so the payload still decodes to a fresh
    # `exp`: only the shape check stands between this value and a header.
    for broken in (fresh + "\rx", fresh[:-1] + " " + fresh[-1:]):
        with pytest.raises(seeder.UnprovenError):
            seeder.resolve_device_token({"COORD_DEVICE_JWT": broken}, none, lambda: now)


@pytest.mark.parametrize("unreadable", ["directory", "not-utf8"])
def test_an_unreadable_token_file_is_skipped_not_a_crash(tmp_path, unreadable):
    now = 1_000_000.0
    token_file = tmp_path / "coord-device-jwt"
    if unreadable == "directory":
        token_file.mkdir()
    else:
        token_file.write_bytes(b"\xff\xfe\x00")
    with pytest.raises(seeder.UnprovenError):
        seeder.resolve_device_token({}, token_file, lambda: now)
    fresh = _jwt(int(now) + 3600)
    assert (
        seeder.resolve_device_token(
            {"COORD_DEVICE_JWT": fresh}, token_file, lambda: now
        )
        == fresh
    )


def test_the_token_file_is_read_only_when_the_variable_does_not_answer(tmp_path):
    now = 1_000_000.0
    fresh = _jwt(int(now) + 3600)

    class Untouchable:
        def read_text(self, *args, **kwargs):
            raise AssertionError(
                "the token file was read although the variable answered"
            )

        def __str__(self):
            return "untouchable-token-file"

    assert (
        seeder.resolve_device_token(
            {"COORD_DEVICE_JWT": fresh}, Untouchable(), lambda: now
        )
        == fresh
    )


def test_a_request_carrying_a_control_character_never_echoes_the_bearer(monkeypatch):
    """http.client refuses such a header with an error that quotes the value;
    the seeder replaces that error, so the bearer reaches no traceback."""
    secret = "h.SECRETPAYLOAD.s\r"
    with pytest.raises(seeder.CoordUnreachableError) as exc:
        REAL_HTTP_JSON("http://127.0.0.1:9/never", secret)
    assert "SECRETPAYLOAD" not in str(exc.value)
    assert exc.value.__cause__ is None and exc.value.__suppress_context__


# ---- entering through `retire_orphans`, the production entry --------------
# Each test below calls the seeder's `retire_orphans` itself and names no other
# function the change added: what it observes is the guard as the entry point
# reaches it, with every source it does not stub proven for real (a git
# checkout with a local `origin`, a credential in the home directory, the
# pinned contract).


def _args(**overrides):
    values = {"agents_dir": None, "dry_run": False, "tenant": None}
    values.update(overrides)
    return argparse.Namespace(**values)


def _record_http(monkeypatch, effective=EFFECTIVE):
    calls: list[tuple[str, str, dict | None]] = []

    def fake_http_json(url, tok, method="GET", body=None):
        calls.append((method, url, body))
        return _coord(effective=effective)(method, url, body)

    monkeypatch.setattr(seeder, "http_json", fake_http_json)
    return calls


def _git_run(cwd, *args) -> str:
    return subprocess.run(
        [
            "git",
            "-c",
            "core.hooksPath=/dev/null",
            "-c",
            "commit.gpgsign=false",
            "-c",
            "tag.gpgsign=false",
            "-c",
            "user.name=t",
            "-c",
            "user.email=t@t",
            *args,
        ],
        cwd=cwd,
        check=True,
        capture_output=True,
        text=True,
    ).stdout


def _config_checkout(tmp_path):
    """A qontinui-claude-config clone at `<workspace>/qontinui-claude-config`.
    Its raw `origin` URL is the real GitHub one (what the seeder checks), and
    an `insteadOf` rewrites it to a local bare repository, so `git ls-remote
    origin` answers offline. HEAD starts AT origin main."""
    bare = tmp_path / "origin.git"
    _git_run(tmp_path, "init", "--bare", "-q", "-b", "main", str(bare))
    checkout = tmp_path / "workspace" / "qontinui-claude-config"
    _git_run(tmp_path, "clone", "-q", str(bare), str(checkout))
    _git_run(checkout, "remote", "set-url", "origin", CONFIG_URL)
    _git_run(checkout, "config", f"url.{bare.as_uri()}.insteadOf", CONFIG_URL)
    agents = checkout / ".claude" / "agents"
    agents.mkdir(parents=True)
    for name in ("code-reviewer", "debugging-specialist"):
        (agents / f"{name}.md").write_text(
            f"---\nname: {name}\n---\n", encoding="utf-8"
        )
    _git_run(checkout, "add", "-A")
    _git_run(checkout, "commit", "-q", "-m", "agents")
    _git_run(checkout, "push", "-q", "origin", "HEAD:refs/heads/main")
    return checkout, agents


def test_retire_orphans_never_sends_a_contract_row(monkeypatch):
    """The contract filter as the entry reaches it: of the effective rows only
    the definition-less ROLE row is sent, never `operator_spawn`."""
    monkeypatch.setattr(seeder, "load_spawn_contract", lambda: CONTRACT)
    monkeypatch.setattr(seeder, "resolve_definitions", lambda _dir: _source())
    monkeypatch.setenv("COORD_DEVICE_JWT", _fresh_jwt())
    calls = _record_http(monkeypatch)
    assert seeder.retire_orphans(_args(), "https://coord.example") == 0
    assert _posted(calls) == ["test-generator"]


def test_retire_orphans_sends_nothing_from_a_checkout_off_origin_main(
    monkeypatch, tmp_path
):
    """A real checkout one commit past its origin main is not proven, so
    nothing is read or sent; pushed, the same checkout is proven and the
    orphan goes out."""
    monkeypatch.setattr(seeder, "load_spawn_contract", lambda: CONTRACT)
    monkeypatch.setenv("COORD_DEVICE_JWT", _fresh_jwt())
    checkout, agents = _config_checkout(tmp_path)
    (agents / "local-only.md").write_text(
        "---\nname: local-only\n---\n", encoding="utf-8"
    )
    _git_run(checkout, "add", "-A")
    _git_run(checkout, "commit", "-q", "-m", "unpushed")
    calls = _record_http(monkeypatch)
    args = _args(agents_dir=str(agents))
    assert seeder.retire_orphans(args, "https://coord.example") == seeder.EXIT_UNPROVEN
    assert calls == []

    _git_run(checkout, "push", "-q", "origin", "HEAD:refs/heads/main")
    assert seeder.retire_orphans(args, "https://coord.example") == 0
    assert _posted(calls) == ["test-generator"]


def test_retire_orphans_judges_origin_main_not_the_shared_checkouts_branch(
    monkeypatch, tmp_path
):
    """No `--agents-dir`: the definitions are the config repository's live
    origin main, read from its objects. The workspace's checkout here sits on a
    peer branch that deletes `debugging-specialist.md` — walk-up discovery
    would read that working tree and retire a live agent. Origin main still
    defines it, so it is not sent, and the reason names origin main's commit."""
    monkeypatch.setattr(seeder, "load_spawn_contract", lambda: CONTRACT)
    monkeypatch.setenv("COORD_DEVICE_JWT", _fresh_jwt())
    checkout, agents = _config_checkout(tmp_path)
    live = _git_run(checkout, "rev-parse", "HEAD").strip()
    _git_run(checkout, "checkout", "-q", "-b", "peer")
    (agents / "debugging-specialist.md").unlink()
    _git_run(checkout, "commit", "-q", "-am", "a peer deletes a live definition")
    web = checkout.parent / "qontinui-web"
    web.mkdir()
    monkeypatch.setattr(seeder, "REPO_ROOT", web)
    monkeypatch.chdir(web)
    calls = _record_http(monkeypatch)

    assert seeder.retire_orphans(_args(), "https://coord.example") == 0
    assert _posted(calls) == ["test-generator"]
    [(_, _, body)] = [c for c in calls if c[0] == "POST"]
    assert live in body["reason"]
    assert _git_run(checkout, "rev-parse", "--abbrev-ref", "HEAD").strip() == "peer", (
        "the shared checkout's branch is left as found"
    )


def test_retire_orphans_sends_nothing_without_a_fresh_device_token(monkeypatch):
    """No fresh credential anywhere (an expired `$COORD_DEVICE_JWT`, no token
    file in the home directory): nothing is read or sent."""
    monkeypatch.setattr(seeder, "load_spawn_contract", lambda: CONTRACT)
    monkeypatch.setattr(seeder, "resolve_definitions", lambda _dir: _source())
    monkeypatch.setenv(
        "COORD_DEVICE_JWT", _jwt(int(time.time()) - 60, tenant_id=TENANT)
    )
    calls = _record_http(monkeypatch)
    assert (
        seeder.retire_orphans(_args(), "https://coord.example") == seeder.EXIT_UNPROVEN
    )
    assert calls == []

    token_dir = Path.home() / ".qontinui"
    token_dir.mkdir()
    (token_dir / "coord-device-jwt").write_text(_fresh_jwt(), encoding="utf-8")
    assert seeder.retire_orphans(_args(), "https://coord.example") == 0
    assert _posted(calls) == ["test-generator"]


def test_retire_orphans_sends_nothing_for_a_tenant_that_does_not_own_the_config_repo(
    monkeypatch,
):
    """The acting tenant as the entry reaches it: coord's ownership door
    answers 404 under the token, so no row is read and nothing is sent;
    answered 200 about the config repository, the same run retires."""
    monkeypatch.setattr(seeder, "load_spawn_contract", lambda: CONTRACT)
    monkeypatch.setattr(seeder, "resolve_definitions", lambda _dir: _source())
    monkeypatch.setenv("COORD_DEVICE_JWT", _fresh_jwt())
    owner = {"answer": (404, {"error": "no author session"})}
    calls: list[tuple[str, str, dict | None]] = []

    def fake_http_json(url, tok, method="GET", body=None):
        calls.append((method, url, body))
        return _coord(owner=owner["answer"])(method, url, body)

    monkeypatch.setattr(seeder, "http_json", fake_http_json)
    rc = seeder.retire_orphans(_args(), "https://coord.example")
    assert rc == seeder.EXIT_UNPROVEN
    assert [url for _, url, _ in calls] == [f"https://coord.example{OWNERSHIP_PATH}"], (
        "only the ownership door is asked"
    )

    owner["answer"] = OWNED
    assert seeder.retire_orphans(_args(), "https://coord.example") == 0
    assert _posted(calls) == ["test-generator"]


def test_retire_orphans_sends_nothing_when_the_token_acts_in_another_tenant(
    monkeypatch,
):
    """A named tenant (`--tenant`) the device JWT does not act in: refused
    before coord is asked anything; named to match, the same run retires."""
    monkeypatch.setattr(seeder, "load_spawn_contract", lambda: CONTRACT)
    monkeypatch.setattr(seeder, "resolve_definitions", lambda _dir: _source())
    monkeypatch.setenv("COORD_DEVICE_JWT", _fresh_jwt())
    calls = _record_http(monkeypatch)
    rc = seeder.retire_orphans(_args(tenant=OTHER_TENANT), "https://coord.example")
    assert rc == seeder.EXIT_UNPROVEN
    assert calls == []

    assert seeder.retire_orphans(_args(tenant=TENANT), "https://coord.example") == 0
    assert _posted(calls) == ["test-generator"]


def test_retire_orphans_sends_nothing_on_a_contract_off_its_pin(
    monkeypatch, tmp_path, capsys
):
    """The REAL pinned-contract read, through the override it honours with no
    fallback: a file at another digest is unproven, so nothing is sent."""
    wrong = tmp_path / "spawn_authorization.json"
    wrong.write_text(json.dumps(CONTRACT), encoding="utf-8")
    monkeypatch.setenv("QONTINUI_SPAWN_CONTRACT_FILE", str(wrong))
    monkeypatch.setattr(seeder, "resolve_definitions", lambda _dir: _source())
    monkeypatch.setenv("COORD_DEVICE_JWT", _fresh_jwt())
    calls = _record_http(monkeypatch)
    assert (
        seeder.retire_orphans(_args(), "https://coord.example") == seeder.EXIT_UNPROVEN
    )
    assert calls == []
    assert "has sha256" in capsys.readouterr().err
