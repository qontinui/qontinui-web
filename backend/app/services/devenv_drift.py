"""Drift computation for the ``devenv`` digital-twin feature.

Given the **canonical** machine's config envelope and a **target**
machine's envelope, :func:`diff_envelopes` produces a
:class:`MachineDriftReport` describing — section by section, key by key —
how the target differs from canonical.

Severity heuristic
------------------

* A ``removed`` delta (a key present on canonical but absent on the
  target) is always ``"critical"`` — a missing piece of required topology
  is the most dangerous drift.
* Otherwise the base severity is derived from the section name:

  ===================  ==========
  section              base sev
  ===================  ==========
  ``db_schema``        critical
  ``versions``         critical
  ``services``         warning
  ``env_contract``     warning
  (unknown)            info
  ===================  ==========

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
from app.services.devenv_section_policy import is_derived_key

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
}


def _max_severity(severities: list[SeverityT]) -> SeverityT:
    """Return the highest-ranked severity, defaulting to ``"info"``."""
    if not severities:
        return "info"
    return _RANK_TO_SEVERITY[max(_SEVERITY_RANK[s] for s in severities)]


def _section_base_severity(section: str) -> SeverityT:
    """Base severity for a section name (``"info"`` for unknown sections)."""
    return _SECTION_BASE_SEVERITY.get(section, "info")


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

    all_section_names = sorted(set(canon_sections) | set(actual_sections))
    for section_name in all_section_names:
        canon_kv = canon_sections.get(section_name, {})
        actual_kv = actual_sections.get(section_name, {})
        base_sev = _section_base_severity(section_name)

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

            if in_canon and not in_actual:
                # Canonical key missing on target — critical, unless derived.
                deltas.append(
                    KeyDelta(
                        key=key,
                        status="removed",
                        expected=expected,
                        actual=None,
                        severity="info" if derived else "critical",
                        derived=derived,
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
            if any(not d.derived for d in deltas):
                has_real_drift = True

    overall = _max_severity(all_delta_severities)
    if schema_version_mismatch:
        overall = "critical"

    in_sync = not has_real_drift and not schema_version_mismatch

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
