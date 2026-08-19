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
  ``unparseable_output``), in which case it omits the three measurement keys
  (``python_installed_count`` / ``..._digest`` / ``..._interpreter``) rather
  than reporting zero packages. That honesty leaves one hole the arms above cannot close,
  because every one of them keys on a DIFFERENCE: two boxes that both failed to
  measure **for the same reason** are byte-identical on every installed key,
  produce no delta at all, and the report calls them in sync. It would be
  asserting parity from two identical notes saying nobody looked.

  So a ``python_installed_probe`` value that is anything OTHER than
  ``measured`` — on EITHER side, symmetrically, since an unmeasured canonical
  is just as unusable as an unmeasured target — produces its own delta and
  **prevents** ``in_sync``. The same treatment covers
  ``python_installed_env_kind == "unknown"``, which is the runner's not-measured
  SENTINEL rather than a third kind of environment (its capture test asserts
  ``env_kind != "unknown"`` iff measured): reporting ``venv`` -> ``unknown`` as
  a ``changed`` difference would claim the box's environment changed when what
  changed is whether anyone looked. See ``_value_attests_unmeasured``.

  A measurement key MISSING on one side gets the same verdict for the same
  reason. The runner emits count/digest/interpreter iff it measured, so their
  absence is never "you are missing this" — treating it as ``removed`` would
  assert a box lacks an interpreter when it merely never looked, at
  ``critical``, and unclearably, since these keys carry no remediation line.

  Two properties of that rule matter to the next reader:

  - It is polarised on ``measured`` (the one value that means *measured*)
    rather than on a list of known failure reasons, so a reason a future runner
    invents blocks ``in_sync`` on arrival instead of silently reading as clean.
  - The FAMILY being absent entirely is NOT the unmeasured case — it means
    the capturing runner predates the inventory probe. A capture is taken to
    speak the contract iff it carries ``python_installed_probe``, which the
    runner writes on every capture; when only one side does, the whole family is
    reported ``unknown`` at ``info`` and blocks nothing. That keeps the rollout
    window honest in both directions: today's boxes are unaffected, and a
    half-upgraded fleet does not pin every peer to ``critical`` on keys its
    runner was never asked for. The accepted residual — an un-upgraded peer's
    inventory stays UNKNOWN rather than drifted — is stated at
    ``_participates_in_inventory``.

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
  emits them un-derived precisely so they cannot be swallowed at ``info``. They
  are however capped at ``warning`` rather than the ``versions`` table's
  ``critical`` — see ``_INVENTORY_MARKER_SEVERITY``: at ``critical`` the rollup
  badge for "not comparable" is indistinguishable from real package drift, and
  the key has no remediation line to clear it with. See
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

Both installed-inventory rules are PARITY rules — they answer "may these two
boxes be called equal?". The same function also serves the config-history diff,
where the two envelopes are two captures of ONE machine and ``in_sync`` means
"nothing changed between them"; there, two identical captures are the honest
answer even when neither measured anything. That caller passes
``temporal=True`` and the inventory rules switch off. See :func:`diff_envelopes`.

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
# test: the rule is polarised on the single success value, which the runner's
# own contract now asks consumers to do ("match on ``measured`` and treat every
# other value — including one added later — as not-clean").
#
# Verified against the runner's own wire contract
# (``env_agent/collectors.rs``, ``PythonInventoryProbe::wire``) rather than
# against a plan or a summary — an earlier draft of this change keyed on
# ``"pip_list"``, the string the probe emitted before it stopped shelling ``pip``
# in favour of a stdlib ``importlib.metadata`` script. A stale success marker
# here does not fail loudly: it silently marks EVERY box unverified forever,
# which reads exactly like a fleet that never measures anything.
_INSTALLED_PROBE_MEASURED = "measured"

# The comparability marker whose "I measured nothing" value is a SENTINEL rather
# than an absence. ``venv``/``not_venv`` are real observations; ``unknown`` is
# what the runner writes on every failure path, and its own capture test asserts
# the biconditional ``env_kind != "unknown"`` iff measured. So a ``venv`` ->
# ``unknown`` difference is never "the environment changed" — it is "one side
# looked and the other did not".
_INSTALLED_ENV_KIND_KEY = "python_installed_env_kind"
_INSTALLED_ENV_KIND_UNMEASURED = "unknown"

# ---------------------------------------------------------------------------
# ONE declared inventory of the capture's keys, with the ROLE each plays here
# ---------------------------------------------------------------------------
#
# This table exists because the alternative failed in review. The oracle used to
# carry two hand-written tuples (markers, measurements) while
# ``devenv_section_policy`` classified the same family by PREFIX. The prefix
# absorbed the runner's sixth key (``python_installed_interpreter``) silently
# and correctly; the tuples absorbed nothing, so the new key fell through to the
# ``removed`` arm and the report asserted "canonical has an interpreter, this box
# does not" about a box that never looked — at ``critical``, and unclearable
# because the key is ``observation_only`` and gets no remediation line. That is
# the exact false claim this module's ``removed``-vs-``unknown`` rule exists to
# forbid, re-created by the fix for its sibling.
#
# A key added by a later runner round STILL lands here unclassified. What the
# table buys is that "unclassified" now means one thing in one place, and the
# consistency test in ``test_devenv_environments.py`` fails the moment this
# table and the policy module's prefix disagree about what the family contains.
#
# The roles:
#
# * ``attestation`` — the value itself can say "this side measured nothing".
#   Never a difference to report; always an evidence gap.
# * ``marker`` — a comparability gate. States a property of HOW the inventory
#   was taken, so two captures whose markers differ did not measure the same
#   thing and their digests may not be compared.
# * ``measurement`` — present IFF the inventory was actually read (the runner
#   asserts that biconditional in its own capture test). So a side missing one
#   of these did not measure; it is never "you are missing this".
#
# ``python_installed_interpreter`` holds TWO roles, which is the whole reason
# this is a set-valued table: it gates comparability (3.12 against 3.13 is not
# the same environment, though both report ``not_venv``) AND it is absent when
# unmeasured. Treating it as only a marker leaves the ``removed``-at-critical
# defect in place; treating it as only a measurement loses the gate.
_ROLE_ATTESTATION = "attestation"
_ROLE_MARKER = "marker"
_ROLE_MEASUREMENT = "measurement"

_INVENTORY_KEY_ROLES: dict[str, frozenset[str]] = {
    _INSTALLED_PROBE_KEY: frozenset({_ROLE_ATTESTATION}),
    "python_installed_scope_kind": frozenset({_ROLE_MARKER}),
    _INSTALLED_ENV_KIND_KEY: frozenset({_ROLE_ATTESTATION, _ROLE_MARKER}),
    "python_installed_interpreter": frozenset({_ROLE_MARKER, _ROLE_MEASUREMENT}),
    "python_installed_count": frozenset({_ROLE_MEASUREMENT}),
    "python_installed_digest": frozenset({_ROLE_MEASUREMENT}),
}

# Severity for an inventory that could not be measured or could not be compared.
# Not the ``versions`` section's ``critical``: that table ranks CONFIRMED drift
# by blast radius and neither of these is confirmed drift. Not ``info`` either,
# unlike the budget-unknown rule: both are stated by the boxes about themselves
# and clear by a local action, so a rollup that renders them green would be the
# "reports clean while measuring nothing" failure the inventory capture exists
# to remove.
_UNVERIFIED_INVENTORY_SEVERITY: SeverityT = "warning"

# Severity ceiling for a comparability MARKER difference (venv vs not_venv,
# 3.12 vs 3.13, one scope kind vs another).
#
# These stay ordinary ``changed`` deltas — they are real, measured differences
# and they DO break ``in_sync`` — but they must not be ``critical``. Two
# reasons, and the second is the one that matters:
#
# 1. There is no apply path. The key is ``observation_only``, so it never
#    appears in a remediation plan; ``critical`` here is unclearable through the
#    drift surface, which is precisely what ``_REMOVED_SEVERITY_OVERRIDE`` was
#    introduced to prevent for ``repos``.
# 2. At ``critical`` the rollup badge for "these two inventories are not
#    comparable" is IDENTICAL to the badge for real package drift. The rule's
#    whole point is that the pair reads as neither clean nor drifted, and a
#    severity a user cannot distinguish does not deliver that.
_INVENTORY_MARKER_SEVERITY: SeverityT = "warning"

# Verdicts ``_inventory_verdict`` can return.
_VERDICT_SKEW = "skew"
_VERDICT_UNVERIFIED = "unverified"
_VERDICT_MARKER = "marker"


def _value_attests_unmeasured(key: str, value: str) -> bool:
    """Whether ``value`` on one side DECLARES that side measured nothing.

    Two keys carry such a value, with deliberately different polarity:

    * ``python_installed_probe`` — anything that is not ``measured``. The test
      is never "one of the known failure reasons": a runner that grows a sixth
      reason must block ``in_sync`` the day it ships, not the day someone
      remembers to extend a list here, and an unrecognised reason silently
      reading as *measured* is exactly the failure this rule prevents.
    * ``python_installed_env_kind`` — exactly ``unknown``, because here the
      other two values (``venv`` / ``not_venv``) are genuine observations. The
      open polarity used for the probe would be wrong: it would classify a real
      venv reading as an evidence gap.
    """
    if key == _INSTALLED_PROBE_KEY:
        return value != _INSTALLED_PROBE_MEASURED
    if key == _INSTALLED_ENV_KIND_KEY:
        return value == _INSTALLED_ENV_KIND_UNMEASURED
    return False


def _inventory_incomparable(
    section: str, canon_kv: dict[str, str], actual_kv: dict[str, str]
) -> bool:
    """Whether the two captures' inventories may be compared at all.

    True when a comparability marker is present on BOTH sides, neither side's
    value is a not-measured sentinel, and the values DIFFER.

    Both-sides-present is required: a marker only one side reports is a version
    skew between the two capturing runners, and refusing to compare on that
    would let an old runner mute a real digest difference — the
    over-suppression this rule must not become. Sentinels are skipped because
    "one side did not measure" is a different finding with its own arm; letting
    it also read as incomparability would report the same fact twice under two
    names.

    Why refusing matters as much as the unmeasured rule it sits beside: it is
    the mirror failure. Reporting an unmeasured box as clean invents agreement;
    reporting a digest difference across a venv/not-venv split invents DRIFT — a
    finding with no apply path, on a box where nothing is wrong, which the
    operator can only clear by aligning how the two runners were launched. Both
    ways round, the report must say what it actually knows.
    """
    if section != _INSTALLED_INVENTORY_SECTION:
        return False
    for marker, roles in _INVENTORY_KEY_ROLES.items():
        if _ROLE_MARKER not in roles:
            continue
        canon_val = canon_kv.get(marker)
        actual_val = actual_kv.get(marker)
        if canon_val is None or actual_val is None:
            continue
        if _value_attests_unmeasured(marker, canon_val) or _value_attests_unmeasured(
            marker, actual_val
        ):
            continue
        if canon_val != actual_val:
            return True
    return False


def _inventory_verdict(
    section: str,
    key: str,
    expected: str | None,
    actual: str | None,
    *,
    canon_participates: bool,
    actual_participates: bool,
    canon_probe: str | None,
    actual_probe: str | None,
    incomparable: bool,
) -> str | None:
    """How this inventory key must be reported, or ``None`` for the normal arms.

    The ordering below is the rule, not an implementation detail:

    1. **Contract skew** wins over everything. If only ONE capture emits the
       inventory family at all, the other runner predates it — there is no
       comparison to make, in either direction.
    2. **An attestation value** wins over any difference. ``venv`` -> ``unknown``
       is not an environment that changed; it is one side that did not look.
    3. **A marker difference** wins over the measurement gate, so the report
       names the marker that made the pair incomparable instead of hiding it
       behind the digest it governs. This is why ``python_installed_interpreter``
       shows as ``changed`` when the minors differ, and as ``unverified`` when
       one side simply never measured.
    4. **The measurement gate** covers the rest: present on both but
       incomparable, or absent on one side. The two ways a measurement can be
       absent are told apart by that side's own probe value, using the runner's
       invariant that ``probe == "measured"`` iff every measurement key is
       present:

       * that capture did NOT measure -> an evidence gap (``unverified``);
       * that capture DID measure yet lacks the key -> its runner predates the
         key, which is contract skew (``unknown``, blocking nothing). Without
         this split, the interpreter key's own rollout would mark every
         mixed-version pair unverified for a key one side simply cannot emit.
    """
    if section != _INSTALLED_INVENTORY_SECTION:
        return None
    roles = _INVENTORY_KEY_ROLES.get(key)
    if roles is None:
        return None

    if not (canon_participates and actual_participates):
        return _VERDICT_SKEW

    if _ROLE_ATTESTATION in roles and any(
        value is not None and _value_attests_unmeasured(key, value)
        for value in (actual, expected)
    ):
        return _VERDICT_UNVERIFIED

    if (
        _ROLE_MARKER in roles
        and expected is not None
        and actual is not None
        and expected != actual
    ):
        return _VERDICT_MARKER

    if _ROLE_MEASUREMENT in roles:
        if incomparable:
            return _VERDICT_UNVERIFIED
        for value, probe in ((expected, canon_probe), (actual, actual_probe)):
            if value is not None:
                continue
            return (
                _VERDICT_SKEW
                if probe == _INSTALLED_PROBE_MEASURED
                else _VERDICT_UNVERIFIED
            )

    return _VERDICT_MARKER if _ROLE_MARKER in roles else None


def _participates_in_inventory(section_kv: dict[str, str]) -> bool:
    """Whether this capture speaks the installed-inventory contract at all.

    Witnessed by ``python_installed_probe``, which the runner writes on EVERY
    capture — measured or not — precisely so an unmeasured box is a stated
    observation rather than a silent one. A capture without it comes from a
    runner predating the whole family.

    This is what keeps the rollout window honest. Canonical on a new runner and
    a peer still on the old one share no inventory keys, and without this check
    all six read ``removed`` at ``critical`` on every unupgraded box: a false
    claim ("this box is missing an interpreter" — it never looked), unclearable
    (``observation_only``, so no remediation line), and pinned to the whole
    environment rollup for as long as the rollout takes. Compare the sibling
    ``python_dep_*`` change, which was harmless on arrival because ``derived``
    keys are dropped from ``in_sync``; ``observation_only`` deliberately gives no
    such protection, so the skew has to be handled here instead.

    The accepted residual, stated rather than hidden: while a peer runs the old
    runner, its inventory is UNKNOWN rather than drifted, so the family cannot
    detect anything on that box until it upgrades. That is the honest reading —
    an old capture contains no inventory evidence — and the rows stay visible in
    the report as ``unknown`` instead of vanishing.
    """
    return _INSTALLED_PROBE_KEY in section_kv


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
    canonical: dict[str, Any], actual: dict[str, Any], *, temporal: bool = False
) -> MachineDriftReport:
    """Diff a target ``actual`` envelope against the ``canonical`` envelope.

    Section-by-section, key-by-key. Produces a :class:`MachineDriftReport`
    with per-section + overall severity. Machine identity fields
    (``machine_id`` / ``machine_name``) are left ``None`` here; the caller
    fills them in (and the endpoint layer attaches them).

    ``temporal`` says the two envelopes are two captures of the SAME machine
    over time (the config-history diff), not two machines being compared for
    parity. That changes what ``in_sync`` MEANS — "nothing changed between these
    two captures", not "these two boxes agree" — and the installed-inventory
    rules are only valid for the second question:

    * "Silence is never success" is a claim about PARITY. Two captures of one
      box that are byte-identical genuinely are the honest answer to "did
      anything change?", even when neither measured anything — asserting
      otherwise badges every consecutive pair on a box with a broken Python as
      drifted, and would even do it for ``from_id == to_id``.
    * The comparability gate is likewise about two boxes. A box whose env kind
      or interpreter minor changed BETWEEN captures has genuinely changed, and
      that is exactly what the history view is asked to show.

    So under ``temporal`` the inventory rules are off and the ordinary
    difference arms answer. The default is the PARITY behaviour because the two
    failure modes are not symmetric: a parity caller that forgets the flag gets
    a false "in sync" on an unmeasured box (the failure this module exists to
    remove), while a history caller that forgets it gets a noisy row. Defaults
    should fail in the direction that stays visible.
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
        # Per-SECTION, not per-key: both of these are properties of the two
        # captures as a PAIR (do their comparability markers agree? do both
        # speak the inventory contract at all?), and the keys they govern carry
        # no trace of either. Computed once here rather than re-derived inside
        # the key loop. Under ``temporal`` they are inert — see
        # ``diff_envelopes`` for why the inventory rules do not apply to two
        # captures of one machine.
        incomparable_inventory = not temporal and _inventory_incomparable(
            section_name, canon_kv, actual_kv
        )
        canon_participates = _participates_in_inventory(canon_kv)
        actual_participates = _participates_in_inventory(actual_kv)
        # Each side's own verdict about whether it measured, which is what tells
        # "this box did not measure" apart from "this box's runner predates the
        # key" when a measurement key is missing.
        canon_probe = canon_kv.get(_INSTALLED_PROBE_KEY)
        actual_probe = actual_kv.get(_INSTALLED_PROBE_KEY)

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

            # How the installed-inventory family must be reported, if this
            # key belongs to it. ``None`` for every other key — and for every
            # key at all under ``temporal``.
            verdict = (
                None
                if temporal
                else _inventory_verdict(
                    section_name,
                    key,
                    expected,
                    actual_val,
                    canon_participates=canon_participates,
                    actual_participates=actual_participates,
                    canon_probe=canon_probe,
                    actual_probe=actual_probe,
                    incomparable=incomparable_inventory,
                )
            )

            # A comparability marker keeps its ordinary delta but never at
            # ``critical`` — see ``_INVENTORY_MARKER_SEVERITY``.
            marker_capped = verdict == _VERDICT_MARKER
            change_sev: SeverityT = (
                "info"
                if derived
                else (_INVENTORY_MARKER_SEVERITY if marker_capped else base_sev)
            )
            removed_sev: SeverityT = (
                "info"
                if derived
                else (
                    _INVENTORY_MARKER_SEVERITY
                    if marker_capped
                    else _removed_severity(section_name)
                )
            )

            if verdict == _VERDICT_UNVERIFIED:
                # Checked FIRST, ahead of every arm below, because all of them
                # key on a DIFFERENCE and none of these cases is one. The
                # unmeasured case is two sides that are EQUAL — same probe key,
                # same failure reason, no delta, a report that says "in sync"
                # about an environment neither box looked at. The incomparable
                # case is the mirror: two digests taken over different
                # environments, whose difference the ``changed`` arm would
                # publish as drift no apply can clear, and whose EQUALITY would
                # be no more meaningful. The one-sided case is the third: a
                # measurement absent because that box never measured, which the
                # ``removed`` arm would publish as "you are missing this" at
                # ``critical``. All three have to win over ``changed`` when the
                # sides disagree — the headline is not "these values differ", it
                # is "this pair cannot answer".
                deltas.append(
                    KeyDelta(
                        key=key,
                        status="unverified",
                        expected=expected,
                        actual=actual_val,
                        severity=_UNVERIFIED_INVENTORY_SEVERITY,
                        derived=derived,
                        observation_only=observation_only,
                    )
                )
                has_unverified_inventory = True
            elif verdict == _VERDICT_SKEW:
                # One capture predates the whole inventory family. Reported as
                # the information gap it is (``unknown`` at ``info``, excluded
                # from ``in_sync``) rather than as six ``removed`` findings
                # against a runner that was never asked the question. See
                # ``_participates_in_inventory`` for the rollout reasoning and
                # the residual it accepts.
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
                        severity=removed_sev,
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
                        severity=change_sev,
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
                        severity=change_sev,
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
