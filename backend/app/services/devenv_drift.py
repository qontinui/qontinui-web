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

The overall report severity is the max severity across all deltas (and the
schema-version override). :func:`rollup_environment` aggregates multiple
machine reports into an environment-level rollup.
"""

from __future__ import annotations

from typing import Any

from app.schemas.devenv import (
    EnvironmentDriftResponse,
    KeyDelta,
    MachineDriftReport,
    SectionDrift,
    SeverityT,
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


def diff_envelopes(canonical: dict[str, Any], actual: dict[str, Any]) -> MachineDriftReport:
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

            if in_canon and not in_actual:
                # Canonical key missing on target — always critical.
                deltas.append(
                    KeyDelta(
                        key=key,
                        status="removed",
                        expected=expected,
                        actual=None,
                        severity="critical",
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
                        severity=base_sev,
                    )
                )
            elif expected != actual_val:
                deltas.append(
                    KeyDelta(
                        key=key,
                        status="changed",
                        expected=expected,
                        actual=actual_val,
                        severity=base_sev,
                    )
                )

        if deltas:
            section_severity = _max_severity([d.severity for d in deltas])
            section_drifts.append(
                SectionDrift(
                    section=section_name,
                    deltas=deltas,
                    severity=section_severity,
                )
            )
            all_delta_severities.extend(d.severity for d in deltas)

    overall = _max_severity(all_delta_severities)
    if schema_version_mismatch:
        overall = "critical"

    in_sync = not section_drifts and not schema_version_mismatch

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
