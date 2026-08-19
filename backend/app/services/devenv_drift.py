"""Drift computation for the ``devenv`` digital-twin feature.

Given the **canonical** machine's config envelope and a **target**
machine's envelope, :func:`diff_envelopes` produces a
:class:`MachineDriftReport` describing — section by section, key by key —
how the target differs from canonical.

Severity heuristic
------------------

* A ``removed`` delta (a key present on canonical but MEASURED-AND-ABSENT
  on the target) is ``"critical"`` by default — a missing piece of required
  topology is the most dangerous drift — **unless the section overrides it**
  via ``_REMOVED_SEVERITY_OVERRIDE``. ``repos`` does: a repository the box has
  not cloned is that section's ordinary case, and one the developer cannot
  clone is unclearable, so a blanket ``critical`` would pin the rollup there
  forever. A key the target never measured is not ``removed`` at all; see the
  unmeasured-key rule below.
* Otherwise the base severity is derived from the section name:

  ===================  ==========  ===============
  section              base sev    removed sev
  ===================  ==========  ===============
  ``db_schema``        critical    critical
  ``versions``         critical    critical
  ``services``         warning     critical
  ``env_contract``     warning     critical
  ``claude_accounts``  warning     critical
  ``repos``            warning     **warning**
  (unknown)            info        critical
  ===================  ==========  ===============

* A ``schema_version`` mismatch between the two envelopes forces the
  overall report severity to ``"critical"`` regardless of per-key deltas.

Honesty rules (per-key / per-section)
-------------------------------------

The base severity table above is per-SECTION, but whether a difference is
real *machine* drift is per-KEY. Two corrections apply, so the report does
not assert drift the box cannot have:

* **Repo-derived keys are not machine drift.** ``runner_crate_version``,
  ``node_dep_*`` and friends are parsed from the manifest next to the
  capturing binary, so they say which source tree captured the config, not
  what the box is. They are reported with ``derived=True`` at ``"info"``
  severity (even when ``removed``, which is otherwise always critical) and
  are excluded from ``in_sync`` — a machine differing ONLY in derived keys
  is in sync. They stay visible: the difference is real and worth seeing,
  it just converges by pulling the repo, never by an apply.
* **``env_contract`` is process-scoped, and is LABELLED, not suppressed.**
  Its values come from the capturing process's own environment, so a
  runner-supervisor capture and a plain-shell capture disagree on the same
  machine. Server-side that is indistinguishable from a genuinely missing
  value, so the section is flagged ``process_scoped=True`` and its severity
  and ``in_sync`` contribution are left untouched. Suppressing it would hide
  real missing configuration; labelling lets the UI caveat it.
* **An UNMEASURED key is ``unknown``, never ``removed``.** A capture probe that
  exceeds the runner's budget makes the runner omit the key rather than guess,
  and it names the omission in the envelope's ``unknown_keys``
  (``section -> [key, ...]``, a sibling of ``sections``). Diffing such a key as
  ``removed`` would assert the box lacks a toolchain nobody looked for — and
  ``removed`` is always critical, so a slow probe alone could drive an install
  of a version that is already correct. Those keys are emitted with
  ``status="unknown"`` at ``"info"`` severity and are excluded from
  ``in_sync``. The severity follows the heuristic's own logic rather than the
  section table: the table ranks CONFIRMED drift by blast radius, and this is
  not confirmed drift at all — it is an information gap, exactly the category
  the derived-key rule already reports at ``"info"``. Anything higher would let
  the capture budget, which is a property of the measuring process and not of
  the box, decide a machine's reported severity — the nondeterminism this rule
  exists to remove. The gap is still fully visible in the report; it just does
  not masquerade as a finding. This applies symmetrically: a key CANONICAL
  could not measure would otherwise read as ``added`` on every peer that did
  measure it, which is the same false claim inverted.

  An envelope with **no** ``unknown_keys`` key at all comes from a runner
  predating the field; nothing is treated as unknown and the diff behaves
  exactly as it did before. An explicit ``{}`` means every probe completed.

* **An UNMEASURED INSTALLED INVENTORY is never "in sync" — silence is not
  success.** The runner's installed-inventory capture emits
  ``python_installed_probe`` in ``versions``: ``measured`` when it genuinely
  read the environment, otherwise the REASON it could not (``scope_unusable``,
  ``python_absent``, ``probe_failed``, ``probe_timeout``,
  ``unparseable_output``), in which case it omits
  ``python_installed_count``/``python_installed_digest`` rather than reporting
  zero packages. That honesty leaves one hole the arms above cannot close,
  because every one of them keys on a DIFFERENCE: two boxes that both failed to
  measure **for the same reason** are byte-identical on every installed key,
  produce no delta at all, and the report calls them in sync. It would be
  asserting parity from two identical notes saying nobody looked.

  So a ``python_installed_probe`` value that is anything OTHER than
  ``measured`` — on EITHER side, symmetrically, since an unmeasured canonical
  is just as unusable as an unmeasured target — produces its own delta and
  **prevents** ``in_sync``. See ``_attests_unmeasured_inventory``.

  Two properties of that rule matter to the next reader:

  - It is polarised on ``measured`` (the one value that means *measured*)
    rather than on a list of known failure reasons, so a reason a future runner
    invents blocks ``in_sync`` on arrival instead of silently reading as clean.
  - The key being ABSENT entirely is NOT the unmeasured case — it means the
    capturing runner predates the inventory probe. The rule is inert there, so
    every box in the field today keeps reporting exactly as it does now.

  The delta gets its own status, ``unverified`` — NOT ``unknown``, which would
  claim the box never measured ``python_installed_probe`` when in fact it
  measured and reported it; what went unmeasured is the inventory its sibling
  keys describe. The two statuses also carry opposite verdicts (``unknown``
  must not flip ``in_sync``, ``unverified`` must), and every consumer that
  distinguishes them — the remediation plan, the drift matrix's delta count,
  the "not counted as drift" caveat it renders — needs to read that off the
  status rather than re-derive it. Severity is ``warning``: above the
  budget-unknown rule's ``info``, because this is stated by the box about
  itself and clears by a concrete local action (install Python, repair the
  interpreter, re-capture) rather than by the box being less busy; below the
  ``versions`` table's ``critical``, because nothing here is CONFIRMED drift —
  we do not know that the two boxes differ, only that nobody can say they agree.

* **INCOMPARABLE inventories are not drift either — the mirror failure.** The
  same capture carries three comparability markers,
  ``python_installed_env_kind`` (``venv`` | ``not_venv`` | ``unknown``),
  ``python_installed_scope_kind`` and ``python_installed_interpreter`` (the
  interpreter's ``MAJOR.MINOR``). They exist because the digest is a function
  of WHICH environment was inventoried: the interpreter comes off the inherited
  PATH, so one box captured from an activated venv and captured again from a
  plain shell produces two different digests with nothing wrong on either side.
  Comparing digests across differing markers manufactures a permanent
  ``in_sync: false`` with no apply path and no local action that converges it —
  the exact inverse of the rule above, inventing drift instead of inventing
  agreement.

  So when a marker is present on both sides with different values, the
  measurement keys (``python_installed_count`` / ``python_installed_digest``)
  are reported ``unverified`` at ``warning`` instead of ``changed``, and
  ``in_sync`` is blocked. The report therefore reads "these two inventories are
  not comparable" — never "clean", never "drifted". The markers THEMSELVES stay
  ordinary deltas: they are real measured differences with a real operator
  action (align how the two runners resolve their interpreter), and the runner
  emits them un-derived precisely so they cannot be swallowed at ``info``. See
  ``_inventory_incomparable``.

* **A key that is a MEASUREMENT is never an apply action.** All six
  ``python_installed_*`` keys are real box state (so a difference IS drift and
  DOES break ``in_sync``, at full severity) but none of them is settable —
  ``python_installed_digest`` is a sha256 over the installed packages, and the
  box converges by installing packages, not by setting a digest. They are
  flagged ``observation_only=True`` so the apply surfaces skip them while the
  drift stays visible and counted. This is a SEPARATE flag from ``derived`` on
  purpose: derived also means "not drift", and reusing it here would drop the
  inventory out of ``in_sync`` — undoing the rule immediately above. See
  ``devenv_section_policy.is_observation_only_key``.

The overall report severity is the max severity across all deltas (and the
schema-version override). :func:`rollup_environment` aggregates multiple
machine reports into an environment-level rollup.
"""

from __future__ import annotations

from typing import Any

from app.schemas.devenv import (
    ENV_CONTRACT_SECTION,
    EnvironmentDriftResponse,
    KeyDelta,
    MachineDriftReport,
    SectionDrift,
    SeverityT,
)
from app.services.devenv_section_policy import (
    is_derived_key,
    is_observation_only_key,
)

# Severity ordering for max() comparisons.
_SEVERITY_RANK: dict[SeverityT, int] = {"info": 0, "warning": 1, "critical": 2}
_RANK_TO_SEVERITY: dict[int, SeverityT] = {0: "info", 1: "warning", 2: "critical"}

# Base severity per known section. Unknown sections default to "info".
_SECTION_BASE_SEVERITY: dict[str, SeverityT] = {
    "db_schema": "critical",
    "versions": "critical",
    "services": "warning",
    "env_contract": "warning",
    "claude_accounts": "warning",
    # A missing repository blocks SOME work, not the box's ability to run, and
    # `db_schema`-grade severity would drown the signal — see
    # ``_REMOVED_SEVERITY_OVERRIDE`` for the half of this that actually decides
    # the motivating case.
    "repos": "warning",
}

# Per-section override of the ``removed``-delta severity.
#
# A ``removed`` delta is ``"critical"`` by default because a missing piece of
# required topology is the most dangerous drift. That default is wrong for at
# least one section, and the difference is not cosmetic: for ``repos``, "canonical
# has it and the target does not" is the ORDINARY case the section exists to
# report, not an emergency. Worse, a box whose developer lacks access to a private
# repository can never clear it — so a blanket ``critical`` pins the whole
# environment rollup to ``critical`` permanently on a condition the box cannot
# act on. A rollup that is always critical is not a louder signal, it is a dead
# one, which is the "drift signal rots" failure the repos plan names as a risk.
#
# Sections absent here keep the blanket ``"critical"``, so this table changes
# nothing that existed before it.
_REMOVED_SEVERITY_OVERRIDE: dict[str, SeverityT] = {
    "repos": "warning",
}

# ---------------------------------------------------------------------------
# The installed-inventory attestation (see the docstring's "silence is not
# success" rule)
# ---------------------------------------------------------------------------
#
# WHY THIS LIVES IN THE ORACLE and not in ``devenv_section_policy``: that module
# answers "what may a pulling box DO with this key" — appliability — and its
# whole classification is shipped to every box as apply policy. This rule
# answers a different question, one only the comparison can ask: "is these two
# captures AGREEING actually evidence of anything?" It reads a VALUE to decide
# whether an equality means what it appears to mean, which no other rule in
# either module does, and it changes ``in_sync`` rather than what a box may
# apply. Putting it in the policy module would also be actively dangerous: the
# per-key hook there is ``is_derived_key``, and registering an installed key as
# derived DROPS it from ``in_sync`` — the exact inversion of this rule's
# purpose. ``devenv_section_policy`` says so at ``_DERIVED_KEY_PREFIXES``, which
# must keep only ``node_dep_`` / ``python_dep_``.
_INSTALLED_INVENTORY_SECTION = "versions"

# The runner's WHY/HOW field for the installed-inventory capture.
_INSTALLED_PROBE_KEY = "python_installed_probe"

# The ONE value of that field which means the environment was actually read.
# Everything else is a stated reason it could not be — as of the capturing
# runner: ``scope_unusable``, ``python_absent``, ``probe_failed``,
# ``probe_timeout``, ``unparseable_output``. That list is documentation, NOT the
# test: see ``_attests_unmeasured_inventory`` for why the rule is polarised on
# the single success value instead.
#
# Verified against the runner's own wire contract
# (``env_agent/collectors.rs``, ``PythonInventoryProbe::wire``) rather than
# against a plan or a summary — an earlier draft of this change keyed on
# ``"pip_list"``, the string the probe emitted before it stopped shelling ``pip``
# in favour of a stdlib ``importlib.metadata`` script. A stale success marker
# here does not fail loudly: it silently marks EVERY box unverified forever,
# which reads exactly like a fleet that never measures anything.
_INSTALLED_PROBE_MEASURED = "measured"

# The COMPARABILITY GATE keys. Each states a property of HOW the inventory was
# taken, and two captures whose values differ did not measure the same thing:
#
# * ``python_installed_env_kind`` (``venv`` | ``not_venv`` | ``unknown``) —
#   whether the interpreter was inside a virtualenv. The interpreter comes off
#   the inherited PATH, so the SAME box inventoried from an activated venv and
#   from a plain shell yields different digests with nothing wrong on either
#   side. The runner sources this from the interpreter itself
#   (``sys.prefix != sys.base_prefix``), never from ``VIRTUAL_ENV``. Note the
#   value is ``not_venv``, NOT ``system``: the test only establishes "not a
#   venv", which conda envs, pyenv installs and any second system python all
#   satisfy — so this marker alone is a WEAK claim, which is why the runner
#   added the interpreter key below.
# * ``python_installed_scope_kind`` — which probe scope the inventory ran in.
#   The non-derived twin of ``probe_scope_kind``; the runner emits it precisely
#   so a scope difference cannot be swallowed as ``info`` the way the derived
#   one is.
# * ``python_installed_interpreter`` — the interpreter's ``MAJOR.MINOR``, read
#   in the SAME invocation that produced the digest (so it cannot disagree with
#   what it certifies). It gates for the reason the whole gate exists: two boxes
#   on 3.12 and 3.13 are not measuring the same thing, yet both report
#   ``not_venv`` and would otherwise pass on ``env_kind`` alone and have their
#   digests compared — the exact class this rule catches. ``MAJOR.MINOR`` and
#   not the patch, deliberately: a patch bump does not change which packages are
#   installed, so gating on it would manufacture incomparability.
#
# All three are ordinary drift in their own right (real, measured differences an
# operator can act on), so they keep their normal delta. What they gate is the
# READING of the digest/count keys below.
#
# The gate NARROWS incomparability rather than closing it, and the runner says
# so: two boxes on different conda envs of the same minor version still compare,
# ``PYTHONPATH``/``.pth`` extend ``sys.path`` invisibly to all three markers,
# and two different venvs both report ``venv``. Every residual leaves this rule
# reporting drift that may be incomparable — never the reverse — so it fails in
# the direction that stays visible.
_INSTALLED_COMPARABILITY_KEYS = (
    "python_installed_env_kind",
    "python_installed_scope_kind",
    "python_installed_interpreter",
)

# The keys whose comparison the gate governs: the inventory measurement itself.
_INSTALLED_MEASUREMENT_KEYS = (
    "python_installed_count",
    "python_installed_digest",
)

# Severity for an inventory that could not be measured or could not be compared.
# Not the ``versions`` section's ``critical``: that table ranks CONFIRMED drift
# by blast radius and neither of these is confirmed drift. Not ``info`` either,
# unlike the budget-unknown rule: both are stated by the boxes about themselves
# and clear by a local action, so a rollup that renders them green would be the
# "reports clean while measuring nothing" failure the inventory capture exists
# to remove.
_UNVERIFIED_INVENTORY_SEVERITY: SeverityT = "warning"


def _inventory_incomparable(
    section: str, canon_kv: dict[str, str], actual_kv: dict[str, str]
) -> bool:
    """Whether the two captures' inventories may be compared at all.

    True when a comparability marker is present on BOTH sides with DIFFERENT
    values. Both-sides-present is required: a marker only one side reports is a
    version skew between the two capturing runners, and refusing to compare on
    that would let an old runner mute a real digest difference — the
    over-suppression this rule must not become.

    Why refusing matters as much as the unmeasured rule it sits beside: it is
    the mirror failure. Reporting an unmeasured box as clean invents agreement;
    reporting a digest difference across a venv/system split invents DRIFT — a
    finding with no apply path, on a box where nothing is wrong, which the
    operator can only clear by aligning how the two runners were launched. Both
    ways round, the report must say what it actually knows.
    """
    if section != _INSTALLED_INVENTORY_SECTION:
        return False
    return any(
        marker in canon_kv
        and marker in actual_kv
        and canon_kv[marker] != actual_kv[marker]
        for marker in _INSTALLED_COMPARABILITY_KEYS
    )


def _attests_unmeasured_inventory(
    section: str, key: str, expected: str | None, actual: str | None
) -> bool:
    """Whether either side's value DECLARES its installed inventory unmeasured.

    True when ``key`` is the installed-probe field and the value present on
    canonical or on the target is anything other than ``measured``.

    Polarity matters: the test is "not the measured marker", never "one of the
    known failure reasons". A runner that grows a fifth reason must block
    ``in_sync`` the day it ships, not the day someone remembers to extend a list
    here — an unrecognised reason silently reading as *measured* is precisely
    the failure this rule exists to prevent.

    A side with NO value is not consulted: an absent key means the capturing
    runner predates the probe entirely (inert — see the module docstring), and a
    key omitted via ``unknown_keys`` stays under the budget-unknown rule, which
    is not a shape this runner produces since it names a reason instead of
    omitting.
    """
    if section != _INSTALLED_INVENTORY_SECTION or key != _INSTALLED_PROBE_KEY:
        return False
    return any(
        value is not None and value != _INSTALLED_PROBE_MEASURED
        for value in (actual, expected)
    )


def _max_severity(severities: list[SeverityT]) -> SeverityT:
    """Return the highest-ranked severity, defaulting to ``"info"``."""
    if not severities:
        return "info"
    return _RANK_TO_SEVERITY[max(_SEVERITY_RANK[s] for s in severities)]


def _section_base_severity(section: str) -> SeverityT:
    """Base severity for a section name (``"info"`` for unknown sections)."""
    return _SECTION_BASE_SEVERITY.get(section, "info")


def _removed_severity(section: str) -> SeverityT:
    """Severity for a ``removed`` delta in ``section``.

    ``"critical"`` unless the section opts out — see
    ``_REMOVED_SEVERITY_OVERRIDE`` for why an opt-out exists at all.
    """
    return _REMOVED_SEVERITY_OVERRIDE.get(section, "critical")


def _extract_sections(envelope: dict[str, Any]) -> dict[str, dict[str, str]]:
    """Pull the ``sections`` map out of a stored config envelope."""
    sections = envelope.get("sections", {})
    if not isinstance(sections, dict):
        return {}
    out: dict[str, dict[str, str]] = {}
    for name, body in sections.items():
        if isinstance(body, dict):
            out[str(name)] = {str(k): str(v) for k, v in body.items()}
    return out


def _extract_unknown_keys(envelope: dict[str, Any]) -> dict[str, set[str]]:
    """Pull ``unknown_keys`` (``section -> {key}``) out of a stored envelope.

    Returns an empty mapping both when the field is absent (a runner predating
    it) and when it is an explicit ``{}``. The two ARE different claims — "we
    were never told" vs "everything was measured" — but they are different
    claims about the same empty set of unmeasured keys, so the diff behaves
    identically either way. The distinction is preserved in the store (see
    ``ConfigEnvelope.to_stored_config``) for readers that need it.

    A malformed value is ignored rather than raised on: this reads envelopes
    that were persisted long ago, and refusing to diff a machine because one
    advisory field is misshapen would lose the real drift signal too.
    """
    raw = envelope.get("unknown_keys")
    if not isinstance(raw, dict):
        return {}
    out: dict[str, set[str]] = {}
    for name, keys in raw.items():
        if isinstance(keys, str) or not isinstance(keys, list | tuple | set):
            continue
        out[str(name)] = {str(k) for k in keys}
    return out


def _schema_version(envelope: dict[str, Any]) -> int | None:
    """Pull ``schema_version`` from an envelope, if present and int-ish."""
    raw = envelope.get("schema_version")
    if isinstance(raw, bool):
        return None
    if isinstance(raw, int):
        return raw
    try:
        return int(raw)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None


def diff_envelopes(
    canonical: dict[str, Any], actual: dict[str, Any]
) -> MachineDriftReport:
    """Diff a target ``actual`` envelope against the ``canonical`` envelope.

    Section-by-section, key-by-key. Produces a :class:`MachineDriftReport`
    with per-section + overall severity. Machine identity fields
    (``machine_id`` / ``machine_name``) are left ``None`` here; the caller
    fills them in (and the endpoint layer attaches them).
    """
    canon_sections = _extract_sections(canonical)
    actual_sections = _extract_sections(actual)
    canon_unknown = _extract_unknown_keys(canonical)
    actual_unknown = _extract_unknown_keys(actual)

    canon_sv = _schema_version(canonical)
    actual_sv = _schema_version(actual)
    schema_version_mismatch = (
        canon_sv is not None and actual_sv is not None and canon_sv != actual_sv
    )

    section_drifts: list[SectionDrift] = []
    all_delta_severities: list[SeverityT] = []
    # Derived-key deltas are reported but are not machine drift, so a machine
    # differing ONLY in derived keys stays in sync.
    has_real_drift = False
    # Tracked SEPARATELY from ``has_real_drift`` because it is a different
    # claim: not "these boxes differ" but "this comparison cannot say whether
    # they differ". Both block ``in_sync``; conflating them would put confirmed
    # drift and an evidence gap under one flag and lose the distinction the rest
    # of this module is built on.
    has_unverified_inventory = False

    all_section_names = sorted(set(canon_sections) | set(actual_sections))
    for section_name in all_section_names:
        canon_kv = canon_sections.get(section_name, {})
        actual_kv = actual_sections.get(section_name, {})
        canon_unmeasured = canon_unknown.get(section_name, set())
        actual_unmeasured = actual_unknown.get(section_name, set())
        base_sev = _section_base_severity(section_name)
        # Per-SECTION, not per-key: the gate is a property of the two captures
        # as a pair (do their comparability markers agree?), and the key it
        # governs — the digest — carries no trace of it. Computed once here
        # rather than re-derived inside the key loop.
        incomparable_inventory = _inventory_incomparable(
            section_name, canon_kv, actual_kv
        )

        deltas: list[KeyDelta] = []
        all_keys = sorted(set(canon_kv) | set(actual_kv))
        for key in all_keys:
            in_canon = key in canon_kv
            in_actual = key in actual_kv
            expected = canon_kv.get(key)
            actual_val = actual_kv.get(key)

            # Repo-derived keys measure the capturing binary's source tree, not
            # the box, so they are never machine drift at any status.
            derived = is_derived_key(section_name, key)
            # Observation-only keys ARE the box's state (so they stay full drift
            # at full severity) but no apply can set them — the flag exists so
            # the remediation surfaces can skip them without the diff having to
            # lie about the drift. Computed for every status: a `removed`
            # installed key is no more settable than a `changed` one.
            observation_only = is_observation_only_key(section_name, key)

            # A key the capturing box did not MEASURE. Checked before the
            # present/absent arms below because it is the reason the key is
            # absent, and the arms would otherwise read that absence as a
            # finding. Guarded on the key genuinely being absent on that side:
            # a runner naming a key it nevertheless reported a value for is
            # contradicting itself, and the measured value is the stronger
            # evidence.
            unmeasured_on_actual = not in_actual and key in actual_unmeasured
            unmeasured_on_canon = not in_canon and key in canon_unmeasured

            # Two independent reasons this key's comparison answers nothing,
            # collapsed into one delta because the verdict they produce is
            # identical: the capture SAYS it measured nothing, or the two
            # captures are not comparable with each other.
            unverified_inventory = _attests_unmeasured_inventory(
                section_name, key, expected, actual_val
            ) or (incomparable_inventory and key in _INSTALLED_MEASUREMENT_KEYS)

            if unverified_inventory:
                # Checked FIRST, ahead of every arm below, because all of them
                # key on a DIFFERENCE and neither of these cases is one. The
                # unmeasured case is two sides that are EQUAL — same probe key,
                # same failure reason, no delta, a report that says "in sync"
                # about an environment neither box looked at. The incomparable
                # case is the mirror: two digests taken over different
                # environments, whose difference the ``changed`` arm would
                # publish as drift no apply can clear, and whose EQUALITY would
                # be no more meaningful. Both also have to win over ``changed``
                # when the sides disagree — the headline is not "these values
                # differ", it is "this pair cannot answer".
                deltas.append(
                    KeyDelta(
                        key=key,
                        status="unverified",
                        expected=expected,
                        actual=actual_val,
                        severity=_UNVERIFIED_INVENTORY_SEVERITY,
                        derived=False,
                        observation_only=observation_only,
                    )
                )
                has_unverified_inventory = True
            elif unmeasured_on_actual or unmeasured_on_canon:
                # "We could not measure this" is not "you are missing this".
                # Always "info": this is an information gap, not confirmed
                # drift, so the per-section blast-radius table does not apply
                # (see the module docstring's unmeasured-key rule).
                deltas.append(
                    KeyDelta(
                        key=key,
                        status="unknown",
                        expected=expected,
                        actual=actual_val,
                        severity="info",
                        derived=derived,
                        observation_only=observation_only,
                    )
                )
            elif in_canon and not in_actual:
                # Canonical key measured-and-missing on target — critical unless
                # derived, or unless the section overrides it
                # (``_removed_severity``).
                deltas.append(
                    KeyDelta(
                        key=key,
                        status="removed",
                        expected=expected,
                        actual=None,
                        severity=(
                            "info" if derived else _removed_severity(section_name)
                        ),
                        derived=derived,
                        observation_only=observation_only,
                    )
                )
            elif in_actual and not in_canon:
                # Extra key on target — severity from the section.
                deltas.append(
                    KeyDelta(
                        key=key,
                        status="added",
                        expected=None,
                        actual=actual_val,
                        severity="info" if derived else base_sev,
                        derived=derived,
                        observation_only=observation_only,
                    )
                )
            elif expected != actual_val:
                deltas.append(
                    KeyDelta(
                        key=key,
                        status="changed",
                        expected=expected,
                        actual=actual_val,
                        severity="info" if derived else base_sev,
                        derived=derived,
                        observation_only=observation_only,
                    )
                )

        if deltas:
            section_severity = _max_severity([d.severity for d in deltas])
            section_drifts.append(
                SectionDrift(
                    section=section_name,
                    deltas=deltas,
                    severity=section_severity,
                    process_scoped=section_name == ENV_CONTRACT_SECTION,
                )
            )
            all_delta_severities.extend(d.severity for d in deltas)
            # ``unknown`` is excluded alongside ``derived``: ``in_sync`` is a
            # claim about the BOX, and a probe that ran out of budget is a fact
            # about the measuring process. Letting it flip the oracle would make
            # the verdict depend on how busy the machine was during capture —
            # the nondeterminism this whole change removes. The gap is still
            # reported, so it is visible rather than silently dropped.
            # ``unverified`` is excluded from THIS flag but not from the
            # verdict: it blocks ``in_sync`` through its own
            # ``has_unverified_inventory`` flag below. Both clear the same
            # verdict, and they are kept apart because they are different
            # claims — "these boxes differ" versus "nothing here can say
            # whether they differ" — and only the first one is drift a
            # remediation could act on.
            if any(
                not d.derived and d.status not in ("unknown", "unverified")
                for d in deltas
            ):
                has_real_drift = True

    overall = _max_severity(all_delta_severities)
    if schema_version_mismatch:
        overall = "critical"

    # ``in_sync`` is an ASSERTION, so every way of failing to earn it has to
    # clear it: confirmed drift, an incompatible schema version, or — the
    # inventory rule — a comparison with nothing behind it. "Silence is never
    # success": a machine that matches must report clean because it was measured
    # and matched, not because nothing was measured.
    in_sync = (
        not has_real_drift
        and not has_unverified_inventory
        and not schema_version_mismatch
    )

    return MachineDriftReport(
        machine_id=None,
        machine_name=None,
        sections=section_drifts,
        severity=overall,
        in_sync=in_sync,
        schema_version_mismatch=schema_version_mismatch,
        expected_schema_version=canon_sv,
        actual_schema_version=actual_sv,
        has_config=True,
    )


def missing_config_report() -> MachineDriftReport:
    """Report for a target machine that has reported no config at all.

    Treated as critical drift — the canonical contract is entirely
    unverified for this machine.
    """
    return MachineDriftReport(
        machine_id=None,
        machine_name=None,
        sections=[],
        severity="critical",
        in_sync=False,
        schema_version_mismatch=False,
        expected_schema_version=None,
        actual_schema_version=None,
        has_config=False,
    )


def rollup_environment(
    environment_id: Any,
    canonical_machine_id: Any | None,
    canonical_machine_name: str | None,
    reports: list[MachineDriftReport],
) -> EnvironmentDriftResponse:
    """Aggregate per-machine reports into an environment-level rollup.

    Overall severity is the max across all machine reports; ``in_sync`` is
    true only when every machine report is itself in sync.
    """
    severity = _max_severity([r.severity for r in reports])
    in_sync = all(r.in_sync for r in reports)
    return EnvironmentDriftResponse(
        environment_id=environment_id,
        canonical_machine_id=canonical_machine_id,
        canonical_machine_name=canonical_machine_name,
        reports=reports,
        severity=severity if reports else "info",
        in_sync=in_sync,
    )
