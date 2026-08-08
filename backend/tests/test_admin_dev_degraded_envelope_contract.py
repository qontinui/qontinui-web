"""Contract guard: the hand-written degraded envelopes vs the frontend types.

When coord is unreachable, ``admin_dev`` does not re-raise the 5xx — it returns
a hand-written "shape matches coord's contract" envelope annotated with
``coord_error`` so the dashboard renders a degraded state instead of a broken
page (:func:`_empty_overview`, :func:`_empty_prs`).

**Those fallbacks are wire consumers too, and nothing typechecked them against
the real contract.** That gap produced four of the six defects found reviewing
plan ``2026-07-29-retire-merge-rollout-tristate-and-fix-the-dead-kill-switch``
Phase 5, and it produced them *twice in the same PR*:

* ``_empty_overview()`` still emitted the retired ``{live, shadow, dry_run}``
  rollout buckets after coord switched to ``{enabled, disabled}``, so the
  components read ``undefined.length`` and **white-screened**
  ``/admin/coord/gates`` on exactly the coord-down path the last-known-good
  apparatus exists to keep alive.
* After that was fixed, the same envelope was found **one key short** again
  (``counts.would_reap``, rendered unguarded by ``SummaryCards``) — caught only
  because a second review round went back to the envelope rather than trusting
  the first fix.

Neither ``tsc`` nor vitest can catch this class: the TS interface describes
coord's payload over an unvalidated JSON cast, and a vitest fixture that still
carries the old shape passes green while the real page breaks. The only thing
that closes it is comparing the fallback against the declared contract
mechanically — which is what this module does.

The contract is the frontend's own TypeScript, since the frontend is the
consumer that breaks:

* ``frontend/src/services/admin-dev-service.ts`` — ``DevOverview``,
  ``GateCounts``, ``RolloutOverview``, ``AutoMergeRollout``, ``PrListResponse``

A property without ``?`` is REQUIRED and may be rendered unguarded, so the
fallback must supply it. Optional (``?``) properties are the frontend's own
"may be absent" contract and are not required here.

Pattern mirrors the other static guards in this suite
(:mod:`test_coord_schema_boundary_guard`, :mod:`test_no_celery_import`): parse a
source file, assert an invariant, and **fail closed** — an unreadable or
unparseable contract file fails the test rather than silently passing, because a
guard that quietly finds nothing is indistinguishable from a guard that is
broken.

Not pinned here, deliberately: :func:`admin_dev._empty_release_verdict`. Its
consumer contract (``frontend/src/app/(app)/admin/coord/prs/_components/
release-verdict.ts``) types **every** field optional/nullable on purpose — the
deploy-status strip is written to "degrade gracefully if coord adds/omits a
field, and never throw on a shape it doesn't recognise". There are no required
keys to pin, so a guard over it would assert nothing. If that file ever gains a
non-optional property, add a guard for that envelope here.
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any

import pytest

# backend/tests/x.py -> parents[1] == backend, parents[2] == repo root.
_REPO_ROOT = Path(__file__).resolve().parents[2]
_ADMIN_DEV_CONTRACT = (
    _REPO_ROOT / "frontend" / "src" / "services" / "admin-dev-service.ts"
)

# `export interface <Name> {` ... up to the first `}` at column 0. Every
# interface pinned here is flat (no nested object literals), so a
# column-0 close is an exact body delimiter.
_INTERFACE_BODY = r"^export\s+interface\s+{name}\s*\{{\s*$(?P<body>.*?)^\}}\s*$"

# A top-level property line inside an interface body: two-space indent, a
# name, an optional `?`, then `:`. Excludes JSDoc lines (` * ...`), which
# can otherwise contain colons.
_PROPERTY = re.compile(r"^  (?P<name>[A-Za-z_][A-Za-z0-9_]*)(?P<optional>\?)?\s*:")


def _read_contract(path: Path) -> str:
    """Read a TS contract file, failing closed if it is missing/empty."""
    if not path.is_file():
        pytest.fail(
            f"Contract file not found: {path}\n"
            "This guard compares the backend's hand-written degraded envelopes "
            "against the frontend interfaces that consume them. A missing "
            "contract file means the guard cannot run — treated as a failure, "
            "not a pass, so the check can never silently become a no-op. If the "
            "file moved, update _ADMIN_DEV_CONTRACT."
        )
    src = path.read_text(encoding="utf-8")
    if not src.strip():
        pytest.fail(f"Contract file is empty: {path}")
    return src


def _interface_properties(src: str, name: str, path: Path) -> dict[str, bool]:
    """Return ``{property_name: is_optional}`` for one ``export interface``.

    Fails closed when the interface is absent or yields no properties — both
    mean the guard has stopped measuring what it claims to measure.
    """
    match = re.search(
        _INTERFACE_BODY.format(name=re.escape(name)),
        src,
        re.MULTILINE | re.DOTALL,
    )
    if match is None:
        pytest.fail(
            f"`export interface {name}` not found in {path}.\n"
            "It was renamed, removed, or reformatted (this guard expects the "
            "declaration and its closing brace at column 0). Retarget the "
            "guard rather than deleting it — the envelope it protects is still "
            "hand-written."
        )
    props: dict[str, bool] = {}
    for line in match.group("body").splitlines():
        prop = _PROPERTY.match(line)
        if prop is not None:
            props[prop.group("name")] = prop.group("optional") == "?"
    if not props:
        pytest.fail(
            f"Parsed zero properties out of `interface {name}` in {path}. "
            "The guard would vacuously pass, so it fails instead."
        )
    return props


def _required(src: str, name: str, path: Path = _ADMIN_DEV_CONTRACT) -> set[str]:
    """The non-optional (no `?`) property names of a TS interface."""
    return {
        prop
        for prop, optional in _interface_properties(src, name, path).items()
        if not optional
    }


@pytest.fixture(scope="module")
def contract() -> str:
    return _read_contract(_ADMIN_DEV_CONTRACT)


def _assert_supplies(envelope: dict[str, Any], required: set[str], what: str) -> None:
    """Assert ``envelope`` carries every required key of its contract."""
    missing = sorted(required - set(envelope))
    assert not missing, (
        f"{what} omits required key(s) {missing}.\n"
        "The frontend declares them non-optional and may render them "
        "unguarded, so on the coord-down path this produces `undefined` in the "
        "UI — a white screen for an array/object, or `NaN%` for a number. Add "
        "the key(s) to the fallback envelope."
    )


# ---------------------------------------------------------------------------
# The parser itself — if it silently stopped matching, every guard below would
# pass vacuously. Pin what it extracts from a known-stable interface.
# ---------------------------------------------------------------------------


def test_parser_distinguishes_required_from_optional(contract: str):
    """Sanity-check the extractor against hand-read facts about the contract.

    Asserted as a SUBSET, not an exact match: adding a new optional property to
    ``PrListResponse`` is a legitimate contract change, and a guard that reds on
    it would train the next reader to delete the guard.
    """
    props = _interface_properties(contract, "PrListResponse", _ADMIN_DEV_CONTRACT)
    # `prs` / `total` are declared bare; `coord_error` carries a `?`. Covering
    # both kinds is what proves the `?` detection works — without an optional
    # example the parser could be treating every property as required and every
    # guard below would still pass.
    for prop, expected_optional in (
        ("prs", False),
        ("total", False),
        ("coord_error", True),
    ):
        assert prop in props, (
            f"`{prop}` missing from parsed `PrListResponse` — the parser or the "
            "contract moved; retarget this sanity check."
        )
        assert props[prop] is expected_optional


# ---------------------------------------------------------------------------
# /admin-dev/overview — the envelope that broke twice.
# ---------------------------------------------------------------------------


def test_empty_overview_supplies_every_required_top_level_key(contract: str):
    from app.api.v1.endpoints.admin_dev import _empty_overview

    envelope = _empty_overview("coord unavailable")
    _assert_supplies(envelope, _required(contract, "DevOverview"), "_empty_overview()")


def test_empty_overview_counts_supplies_every_required_gate_count(contract: str):
    """``counts`` is the sub-object that shipped one key short (``would_reap``)."""
    from app.api.v1.endpoints.admin_dev import _empty_overview

    counts = _empty_overview("coord unavailable")["counts"]
    _assert_supplies(
        counts, _required(contract, "GateCounts"), "_empty_overview()['counts']"
    )
    # Every count is rendered as a number; `undefined`/`None` reaches the tile
    # as `NaN`. Booleans are excluded explicitly (`bool` is an `int` subclass).
    non_numeric = sorted(
        key
        for key, value in counts.items()
        if isinstance(value, bool) or not isinstance(value, int)
    )
    assert not non_numeric, (
        f"_empty_overview()['counts'] has non-numeric value(s) for {non_numeric}; "
        "SummaryCards renders these directly."
    )


def test_empty_overview_rollouts_supplies_required_keys_and_both_buckets(
    contract: str,
):
    """The rollout block whose retired buckets white-screened the page."""
    from app.api.v1.endpoints.admin_dev import _empty_overview

    rollouts = _empty_overview("coord unavailable")["rollouts"]
    _assert_supplies(
        rollouts,
        _required(contract, "RolloutOverview"),
        "_empty_overview()['rollouts']",
    )
    _assert_supplies(
        rollouts["auto_merge"],
        _required(contract, "AutoMergeRollout"),
        "_empty_overview()['rollouts']['auto_merge']",
    )
    # `.length`/`.map` are called on these unguarded.
    assert isinstance(rollouts["auto_merge"]["enabled"], list)
    assert isinstance(rollouts["auto_merge"]["disabled"], list)
    assert isinstance(rollouts["features"], list)


def test_empty_overview_gates_is_a_list(contract: str):
    from app.api.v1.endpoints.admin_dev import _empty_overview

    assert isinstance(_empty_overview("coord unavailable")["gates"], list)


def test_coord_down_auto_merge_enabled_is_unknown_not_false():
    """`null` = unknown; `false` would assert a fact during an outage.

    Semantic rule from the same plan (review defect 5): an all-``disabled``
    board is causeless from the UI unless the tenant's ``auto_merge_enabled``
    opt-in is surfaced alongside it — but on the coord-down path its value is
    genuinely UNKNOWN. Emitting ``false`` there would render "this tenant never
    opted in" as though it had been measured.

    Pinned separately from the key-coverage guards because the *presence* of
    this key is optional in the contract while its *value* is not free.
    """
    from app.api.v1.endpoints.admin_dev import _empty_overview

    rollouts = _empty_overview("coord unavailable")["rollouts"]
    assert "auto_merge_enabled" in rollouts, (
        "_empty_overview()['rollouts'] omits `auto_merge_enabled`. The contract "
        "marks it optional, but dropping it from THIS envelope leaves an "
        "all-`disabled` board with no visible cause during an outage — which is "
        "the blind spot it was added to close."
    )
    assert rollouts["auto_merge_enabled"] is None


# ---------------------------------------------------------------------------
# /admin-dev/prs
# ---------------------------------------------------------------------------


def test_empty_prs_supplies_every_required_key(contract: str):
    from app.api.v1.endpoints.admin_dev import _empty_prs

    envelope = _empty_prs("coord unavailable")
    _assert_supplies(envelope, _required(contract, "PrListResponse"), "_empty_prs()")
    assert isinstance(envelope["prs"], list)
    assert isinstance(envelope["total"], int)


# ---------------------------------------------------------------------------
# The stale-while-revalidate path — a *third* shape the frontend consumes.
# ---------------------------------------------------------------------------


def test_degraded_with_last_good_carries_the_data_keys_through(contract: str):
    """The SWR envelope must not drop the keys it is wrapping.

    ``_degraded_with_last_good`` spreads a cached successful envelope and adds
    staleness markers. It satisfies the contract only as long as the spread is
    preserved — a future refactor that whitelisted fields would reintroduce the
    same missing-key breakage on the same coord-down path.
    """
    from app.api.v1.endpoints.admin_dev import (
        _degraded_with_last_good,
        _empty_overview,
    )

    # A stand-in for a cached coord success: the fallback shape (already
    # contract-complete per the guards above) minus the degradation marker.
    last_good = {
        key: value
        for key, value in _empty_overview("unused").items()
        if key != "coord_error"
    }
    degraded = _degraded_with_last_good("timeout waiting for coord", last_good)

    _assert_supplies(
        degraded,
        _required(contract, "DevOverview"),
        "_degraded_with_last_good()",
    )
    for key in ("gates", "counts", "rollouts"):
        assert degraded[key] == last_good[key], (
            f"_degraded_with_last_good() altered `{key}`; the last-known-good "
            "data must pass through unchanged — that is the whole point of the "
            "stale-while-revalidate path."
        )
    # The markers the page branches on to pick the soft hint over the hard banner.
    assert degraded["coord_reconnecting"] is True
    assert degraded["last_good_generated_at"] == last_good["generated_at"]
