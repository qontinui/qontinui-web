"""Tests for the ``devenv`` Environments (digital-twin) feature.

Two layers:

* **Layer 1 — pure unit tests (no DB):**
  - :func:`app.services.devenv_drift.diff_envelopes` — the section/key/severity
    rubric (removed/changed/added, critical vs warning sections, schema-version
    override, in-sync identity).
  - :class:`app.schemas.devenv.ConfigEnvelope` — the secret backstop
    (env_contract values coerced to present/absent; nested non-string section
    values rejected) and the additive ``unknown_keys`` field (absent /
    explicit-``{}`` / populated all stay distinguishable through persist).
  - :mod:`app.crud.devenv_machine_crud` — machine-key generation (mk_ prefix,
    sha256 hash, non-secret prefix, uniqueness).

* **Layer 2 — full HTTP integration (real Postgres, auth overridden):**
  Drives the enroll → push-config → set-canonical → drift flow end-to-end
  against the test DB, plus the secret backstop and cross-owner isolation.

  Uses ``httpx.AsyncClient`` + ``ASGITransport`` (NOT ``TestClient``) so the
  request handler runs in the SAME asyncio loop as the shared async DB
  session — mirrors the proven pattern in ``test_pair_codes.py``. The
  function-scoped ``async_db_session`` is bound to a connection whose outer
  transaction is rolled back after each test, so endpoint ``db.commit()``
  calls are visible within the test but never persist.
"""

from __future__ import annotations

from datetime import UTC, datetime
from uuid import UUID, uuid4

import httpx
import pytest
import pytest_asyncio
from fastapi import FastAPI
from pydantic import ValidationError
from sqlalchemy.ext.asyncio import AsyncSession

from app.crud import devenv_machine_crud
from app.schemas.devenv import ConfigEnvelope
from app.services import devenv_drift

API_PREFIX = "/api/v1/devenv"


# ===========================================================================
# Layer 1 — pure unit tests (no DB)
# ===========================================================================


def _envelope(
    sections: dict,
    *,
    schema_version: int = 1,
    unknown_keys: dict | None = None,
) -> dict:
    """Build a persisted-shape envelope dict (what JSONB holds).

    ``unknown_keys`` is OMITTED entirely when ``None`` — that is the on-disk
    shape written by a runner predating the field, and several tests below turn
    on omitted-vs-``{}`` being different bytes.
    """
    envelope: dict = {
        "schema_version": schema_version,
        "captured_at": "2026-06-21T00:00:00Z",
        "sections": sections,
    }
    if unknown_keys is not None:
        envelope["unknown_keys"] = unknown_keys
    return envelope


class TestDiffEnvelopes:
    """:func:`diff_envelopes` — the drift rubric."""

    def test_removed_key_is_critical(self) -> None:
        """A canonical key missing on the target → removed / critical."""
        canonical = _envelope({"services": {"redis": "6379", "pg": "5432"}})
        actual = _envelope({"services": {"redis": "6379"}})
        report = devenv_drift.diff_envelopes(canonical, actual)

        assert report.in_sync is False
        section = _section(report, "services")
        delta = _delta(section, "pg")
        assert delta.status == "removed"
        assert delta.severity == "critical"
        assert delta.expected == "5432"
        assert delta.actual is None

    def test_versions_change_is_critical(self) -> None:
        """A changed value in the ``versions`` (critical) section → critical."""
        canonical = _envelope({"versions": {"python": "3.12"}})
        actual = _envelope({"versions": {"python": "3.11"}})
        report = devenv_drift.diff_envelopes(canonical, actual)

        delta = _delta(_section(report, "versions"), "python")
        assert delta.status == "changed"
        assert delta.severity == "critical"
        assert delta.expected == "3.12"
        assert delta.actual == "3.11"
        assert report.severity == "critical"

    def test_services_change_is_warning(self) -> None:
        """A changed value in the ``services`` section → warning."""
        canonical = _envelope({"services": {"redis": "6379"}})
        actual = _envelope({"services": {"redis": "6380"}})
        report = devenv_drift.diff_envelopes(canonical, actual)

        delta = _delta(_section(report, "services"), "redis")
        assert delta.status == "changed"
        assert delta.severity == "warning"
        assert report.severity == "warning"

    def test_missing_repo_is_warning_not_critical(self) -> None:
        """A repo canonical has and the box lacks → removed / **warning**.

        This is the motivating case of the repos plan, and it is a ``removed``
        delta — the one status that ignores the per-section base severity and
        hardcodes ``critical``. Setting ``_SECTION_BASE_SEVERITY["repos"]``
        alone therefore does NOT reach it; the per-section removed override is
        what does. A box missing ten of the org's repositories must not pin the
        environment rollup to ``critical`` forever, especially when some of
        those repos are private and the developer cannot clone them at all.
        """
        canonical = _envelope(
            {
                "repos": {
                    "repo_qontinui_qontinui-runner": "https://github.com/qontinui/qontinui-runner",
                    "repo_qontinui_qontinui-stack": "https://github.com/qontinui/qontinui-stack",
                }
            }
        )
        actual = _envelope(
            {
                "repos": {
                    "repo_qontinui_qontinui-runner": "https://github.com/qontinui/qontinui-runner"
                }
            }
        )
        report = devenv_drift.diff_envelopes(canonical, actual)

        delta = _delta(_section(report, "repos"), "repo_qontinui_qontinui-stack")
        assert delta.status == "removed"
        assert delta.severity == "warning"
        assert delta.expected == "https://github.com/qontinui/qontinui-stack"
        assert delta.derived is False
        # Still real drift — softening the severity must not hide it.
        assert report.in_sync is False
        assert report.severity == "warning"

    def test_removed_override_does_not_leak_to_other_sections(self) -> None:
        """Only ``repos`` opts out; every other section keeps ``critical``.

        The override table exists so one section can soften a rule that is right
        everywhere else. A regression that made it global would quietly downgrade
        a missing ``db_schema`` or ``services`` key — the most dangerous drift
        there is — to a warning.
        """
        for section_name in ("services", "versions", "db_schema", "env_contract"):
            canonical = _envelope({section_name: {"a": "1", "b": "2"}})
            actual = _envelope({section_name: {"a": "1"}})
            report = devenv_drift.diff_envelopes(canonical, actual)
            delta = _delta(_section(report, section_name), "b")
            assert delta.status == "removed"
            assert delta.severity == "critical", f"{section_name} must stay critical"

    def test_repos_scope_kind_difference_is_derived_and_info(self) -> None:
        """Capture provenance is reported, never actionable, never drift.

        Two boxes that resolved different KINDS of workspace root did not
        enumerate the same concept — that is worth SEEING, which is why the
        delta is reported at all. But no clone can install a scope, so it must
        not count as machine drift or push the rollup up.
        """
        canonical = _envelope({"repos": {"repos_scope_kind": "declared"}})
        actual = _envelope({"repos": {"repos_scope_kind": "home_default"}})
        report = devenv_drift.diff_envelopes(canonical, actual)

        delta = _delta(_section(report, "repos"), "repos_scope_kind")
        assert delta.status == "changed"
        assert delta.derived is True
        assert delta.severity == "info"
        assert report.in_sync is True, "a derived-only difference is not drift"

    def test_extra_repo_on_the_target_is_added_and_breaks_in_sync(self) -> None:
        """A repo the box has but canonical does not is `added` — real drift.

        Documented deliberately: it is why the collector filters by an owner
        allowlist. Without that filter a developer's personal checkouts land
        here, and each one breaks ``in_sync`` on a box that is otherwise
        perfectly aligned.
        """
        canonical = _envelope({"repos": {"repos_scope_kind": "declared"}})
        actual = _envelope(
            {
                "repos": {
                    "repos_scope_kind": "declared",
                    "repo_someone_personal-notes": "https://github.com/someone/personal-notes",
                }
            }
        )
        report = devenv_drift.diff_envelopes(canonical, actual)

        delta = _delta(_section(report, "repos"), "repo_someone_personal-notes")
        assert delta.status == "added"
        assert delta.derived is False
        assert delta.severity == "warning"
        assert report.in_sync is False

    def test_claude_accounts_change_is_warning(self) -> None:
        """A changed value in the ``claude_accounts`` section → warning (not info)."""
        canonical = _envelope({"claude_accounts": {"selection_mode": "all"}})
        actual = _envelope({"claude_accounts": {"selection_mode": "single"}})
        report = devenv_drift.diff_envelopes(canonical, actual)

        delta = _delta(_section(report, "claude_accounts"), "selection_mode")
        assert delta.status == "changed"
        assert delta.severity == "warning"
        assert report.severity == "warning"

    def test_added_key_status_added(self) -> None:
        """A key on the target but not canonical → added."""
        canonical = _envelope({"services": {"redis": "6379"}})
        actual = _envelope({"services": {"redis": "6379", "extra": "1"}})
        report = devenv_drift.diff_envelopes(canonical, actual)

        delta = _delta(_section(report, "services"), "extra")
        assert delta.status == "added"
        assert delta.expected is None
        assert delta.actual == "1"

    def test_schema_version_mismatch_forces_critical(self) -> None:
        """A schema_version mismatch forces overall critical + the flag."""
        canonical = _envelope({"services": {"redis": "6379"}}, schema_version=1)
        actual = _envelope({"services": {"redis": "6379"}}, schema_version=2)
        report = devenv_drift.diff_envelopes(canonical, actual)

        assert report.schema_version_mismatch is True
        assert report.expected_schema_version == 1
        assert report.actual_schema_version == 2
        assert report.severity == "critical"
        assert report.in_sync is False

    def test_repo_derived_key_change_is_info_and_flagged(self) -> None:
        """A repo-derived key in the CRITICAL ``versions`` section → info + derived.

        ``runner_crate_version`` is parsed from the ``Cargo.toml`` next to the
        capturing binary, so it reports which source tree captured the config,
        not what the box is. Two binaries on one machine legitimately disagree,
        so calling it critical drift asserts something false.
        """
        canonical = _envelope({"versions": {"runner_crate_version": "1.0.5"}})
        actual = _envelope({"versions": {"runner_crate_version": "1.0.3"}})
        report = devenv_drift.diff_envelopes(canonical, actual)

        delta = _delta(_section(report, "versions"), "runner_crate_version")
        assert delta.status == "changed"
        assert delta.derived is True
        assert delta.severity == "info"
        assert report.severity == "info"

    def test_derived_key_prefix_is_also_derived(self) -> None:
        """The ``node_dep_*`` prefix rule applies here too, not just on pull."""
        canonical = _envelope({"versions": {"node_dep_react": "19.0.0"}})
        actual = _envelope({"versions": {"node_dep_react": "18.2.0"}})
        report = devenv_drift.diff_envelopes(canonical, actual)

        assert _delta(_section(report, "versions"), "node_dep_react").derived is True

    def test_python_dep_prefix_is_also_derived(self) -> None:
        """The ``python_dep_*`` prefix rule applies on the drift path too.

        The ``in_sync`` assertion is the operationally load-bearing one: being
        derived is only meaningful because it drops the delta out of the
        ``in_sync`` oracle. The pre-existing derived-stays-in-sync test covers
        the EXPLICIT-key path only, so without this the prefix -> ``in_sync``
        link is unasserted for ``node_dep_`` and ``python_dep_`` alike.
        """
        canonical = _envelope({"versions": {"python_dep_requests": "2.32.3"}})
        actual = _envelope({"versions": {"python_dep_requests": "2.31.0"}})
        report = devenv_drift.diff_envelopes(canonical, actual)

        delta = _delta(_section(report, "versions"), "python_dep_requests")
        assert delta.derived is True
        assert delta.severity == "info"
        assert report.severity == "info"
        assert report.in_sync is True

    def test_removed_derived_key_is_not_critical(self) -> None:
        """``removed`` is normally always critical — derived keys are the exception."""
        canonical = _envelope({"versions": {"tauri": "2.0.0"}})
        actual = _envelope({"versions": {}})
        report = devenv_drift.diff_envelopes(canonical, actual)

        delta = _delta(_section(report, "versions"), "tauri")
        assert delta.status == "removed"
        assert delta.derived is True
        assert delta.severity == "info"

    def test_derived_only_difference_stays_in_sync(self) -> None:
        """A machine differing ONLY in derived keys is in sync.

        This is the canonical-box-diffs-dirty-against-itself case: the drift is
        visible but it is not machine drift, so it must not fail the oracle.
        """
        canonical = _envelope({"versions": {"node_package_version": "1.0.5"}})
        actual = _envelope({"versions": {"node_package_version": "1.0.3"}})
        report = devenv_drift.diff_envelopes(canonical, actual)

        assert report.in_sync is True
        # Still reported — visible, just not drift.
        assert _section(report, "versions") is not None

    def test_observed_toolchain_key_is_not_derived(self) -> None:
        """``python``/``node``/``rustc`` are shelled --version reads → real drift."""
        canonical = _envelope({"versions": {"python": "3.12"}})
        actual = _envelope({"versions": {"python": "3.11"}})
        report = devenv_drift.diff_envelopes(canonical, actual)

        delta = _delta(_section(report, "versions"), "python")
        assert delta.derived is False
        assert delta.severity == "critical"
        assert report.in_sync is False

    def test_mixed_section_keeps_real_drift(self) -> None:
        """A derived key must not mask a real one sharing its section."""
        canonical = _envelope(
            {"versions": {"python": "3.12", "runner_crate_version": "1.0.5"}}
        )
        actual = _envelope(
            {"versions": {"python": "3.11", "runner_crate_version": "1.0.3"}}
        )
        report = devenv_drift.diff_envelopes(canonical, actual)

        section = _section(report, "versions")
        assert _delta(section, "python").severity == "critical"
        assert _delta(section, "runner_crate_version").severity == "info"
        assert section.severity == "critical"
        assert report.in_sync is False

    def test_env_contract_is_flagged_process_scoped_not_suppressed(self) -> None:
        """``env_contract`` deltas are LABELLED, never downgraded or hidden.

        Server-side, a process-scope artifact and a genuinely missing value are
        indistinguishable — so suppressing would hide real missing config.
        """
        canonical = _envelope({"env_contract": {"QONTINUI_API_URL": "present"}})
        actual = _envelope({"env_contract": {}})
        report = devenv_drift.diff_envelopes(canonical, actual)

        section = _section(report, "env_contract")
        assert section.process_scoped is True
        assert _delta(section, "QONTINUI_API_URL").severity == "critical"
        assert report.in_sync is False

    def test_non_env_contract_sections_are_not_process_scoped(self) -> None:
        """The process-scope flag must not leak onto machine-scoped sections."""
        canonical = _envelope({"services": {"redis": "6379"}})
        actual = _envelope({"services": {"redis": "6380"}})
        report = devenv_drift.diff_envelopes(canonical, actual)

        assert _section(report, "services").process_scoped is False

    def test_identical_envelopes_in_sync(self) -> None:
        """Identical envelopes → in_sync, no section deltas."""
        env = _envelope(
            {
                "versions": {"python": "3.12"},
                "services": {"redis": "6379"},
            }
        )
        report = devenv_drift.diff_envelopes(env, dict(env))

        assert report.in_sync is True
        assert report.sections == []
        assert report.severity == "info"
        assert report.schema_version_mismatch is False


class TestUnmeasuredKeys:
    """``unknown_keys`` — an unmeasured key is ``unknown``, never ``removed``.

    A capture probe that exceeds the runner's budget makes the runner omit the
    key rather than guess a value, and it names the omission in the envelope's
    ``unknown_keys``. Diffing that as ``removed`` would assert the box lacks a
    toolchain nobody looked for — and ``removed`` is always critical, so a slow
    probe alone could drive an install of a version that is already correct.
    """

    def test_unmeasured_key_is_unknown_not_removed(self) -> None:
        """A key named in the target's ``unknown_keys`` → unknown / info."""
        canonical = _envelope({"versions": {"python": "3.12"}})
        actual = _envelope({"versions": {}}, unknown_keys={"versions": ["python"]})
        report = devenv_drift.diff_envelopes(canonical, actual)

        delta = _delta(_section(report, "versions"), "python")
        assert delta.status == "unknown"
        # NOT critical: an information gap, not confirmed drift.
        assert delta.severity == "info"
        assert delta.expected == "3.12"
        assert delta.actual is None
        assert report.severity == "info"

    def test_unmeasured_key_does_not_break_in_sync(self) -> None:
        """A probe timeout must not flip the oracle.

        ``in_sync`` is a claim about the BOX; a budget overrun is a fact about
        the measuring process. Letting it decide would make the verdict depend
        on how busy the machine was during capture — the nondeterminism this
        change exists to remove. The gap is still REPORTED.
        """
        canonical = _envelope({"versions": {"rustc": "1.83.0"}})
        actual = _envelope({"versions": {}}, unknown_keys={"versions": ["rustc"]})
        report = devenv_drift.diff_envelopes(canonical, actual)

        assert report.in_sync is True
        # Visible, not suppressed.
        assert _delta(_section(report, "versions"), "rustc").status == "unknown"

    def test_genuinely_removed_key_is_still_removed_and_critical(self) -> None:
        """Over-suppression guard: only the NAMED keys become unknown.

        The same envelope carries one unmeasured key and one genuinely absent
        one. Marking the whole capture "unknown" would suppress real drift.
        """
        canonical = _envelope({"versions": {"python": "3.12", "rustc": "1.83.0"}})
        actual = _envelope({"versions": {}}, unknown_keys={"versions": ["rustc"]})
        report = devenv_drift.diff_envelopes(canonical, actual)

        section = _section(report, "versions")
        assert _delta(section, "rustc").status == "unknown"
        python = _delta(section, "python")
        assert python.status == "removed"
        assert python.severity == "critical"
        assert report.severity == "critical"
        assert report.in_sync is False

    def test_envelope_without_unknown_keys_behaves_exactly_as_before(self) -> None:
        """An older runner's envelope (no ``unknown_keys``) → removed / critical."""
        canonical = _envelope({"versions": {"python": "3.12"}})
        actual = _envelope({"versions": {}})
        assert "unknown_keys" not in actual
        report = devenv_drift.diff_envelopes(canonical, actual)

        delta = _delta(_section(report, "versions"), "python")
        assert delta.status == "removed"
        assert delta.severity == "critical"
        assert report.in_sync is False

    def test_explicit_empty_unknown_keys_is_still_removed(self) -> None:
        """``{}`` is a positive claim that every probe completed → removed."""
        canonical = _envelope({"versions": {"python": "3.12"}})
        actual = _envelope({"versions": {}}, unknown_keys={})
        report = devenv_drift.diff_envelopes(canonical, actual)

        delta = _delta(_section(report, "versions"), "python")
        assert delta.status == "removed"
        assert delta.severity == "critical"

    def test_canonical_side_unmeasured_key_is_unknown_not_added(self) -> None:
        """Symmetric: a key CANONICAL could not measure is not "extra" on peers.

        Otherwise one slow probe on the canonical box marks the key ``added`` at
        the section's severity on every peer that DID measure it — the same
        false claim inverted.
        """
        canonical = _envelope({"versions": {}}, unknown_keys={"versions": ["node"]})
        actual = _envelope({"versions": {"node": "22.1.0"}})
        report = devenv_drift.diff_envelopes(canonical, actual)

        delta = _delta(_section(report, "versions"), "node")
        assert delta.status == "unknown"
        assert delta.severity == "info"
        assert delta.expected is None
        assert delta.actual == "22.1.0"
        assert report.in_sync is True

    def test_measured_value_wins_over_a_contradictory_unknown_claim(self) -> None:
        """A runner naming a key it also reported a value for contradicts itself.

        The measured value is the stronger evidence, so the delta stays a real
        ``changed`` — the unknown marker must not become a way to mute drift.
        """
        canonical = _envelope({"versions": {"python": "3.12"}})
        actual = _envelope(
            {"versions": {"python": "3.11"}}, unknown_keys={"versions": ["python"]}
        )
        report = devenv_drift.diff_envelopes(canonical, actual)

        delta = _delta(_section(report, "versions"), "python")
        assert delta.status == "changed"
        assert delta.severity == "critical"
        assert report.in_sync is False

    def test_unknown_keys_for_another_section_do_not_leak(self) -> None:
        """The marker is per-SECTION; a same-named key elsewhere is unaffected."""
        canonical = _envelope(
            {"versions": {"python": "3.12"}, "services": {"python": "8000"}}
        )
        actual = _envelope(
            {"versions": {}, "services": {}}, unknown_keys={"versions": ["python"]}
        )
        report = devenv_drift.diff_envelopes(canonical, actual)

        assert _delta(_section(report, "versions"), "python").status == "unknown"
        assert _delta(_section(report, "services"), "python").status == "removed"

    def test_malformed_unknown_keys_is_ignored_not_fatal(self) -> None:
        """A misshapen advisory field must not lose the real drift signal."""
        canonical = _envelope({"versions": {"python": "3.12"}})
        actual = _envelope({"versions": {}}, unknown_keys={"versions": "python"})
        report = devenv_drift.diff_envelopes(canonical, actual)

        assert _delta(_section(report, "versions"), "python").status == "removed"


class TestUnmeasuredInstalledInventory:
    """``python_installed_probe`` — silence is never success.

    The runner's installed-inventory capture reports ``measured`` when it
    genuinely read the environment and otherwise names the REASON it could not
    (``scope_unusable``, ``python_absent``, ``probe_failed``, ``probe_timeout``,
    ``unparseable_output``), omitting the count/digest/interpreter rather than
    reporting zero packages. The runner's contract is explicit that a consumer
    should match on ``measured`` and treat EVERY other value — including one
    added later — as not-clean, which is the polarity these tests pin. Every other rule in the oracle keys on a DIFFERENCE, so two
    boxes that both failed to measure for the same reason are byte-identical and
    would be reported in sync — parity asserted from two identical notes saying
    nobody looked. These tests pin the rule that closes that hole: a probe value
    other than ``measured``, on either side, breaks ``in_sync`` and says why.
    """

    def test_both_sides_unmeasured_for_the_same_reason_is_not_in_sync(self) -> None:
        """The motivating case: EQUAL captures, and equality proves nothing.

        Nothing differs between these two envelopes — the ordinary delta arms
        produce no finding at all — yet neither box has an installed inventory.
        ``in_sync`` here would be the "reports clean while measuring nothing"
        failure the whole capture exists to remove.
        """
        sections = {
            "versions": {
                "python": "3.13",
                "python_installed_probe": "python_absent",
                "python_installed_scope_kind": "default",
                "python_installed_env_kind": "venv",
            }
        }
        canonical = _envelope(sections)
        actual = _envelope({"versions": dict(sections["versions"])})
        report = devenv_drift.diff_envelopes(canonical, actual)

        assert report.in_sync is False, "an unmeasured environment is not 'in sync'"
        delta = _delta(_section(report, "versions"), "python_installed_probe")
        # The report NAMES the reason on both sides rather than asserting a
        # difference that does not exist.
        assert delta.status == "unverified"
        assert delta.expected == "python_absent"
        assert delta.actual == "python_absent"
        # Not confirmed drift (critical), but not something a rollup may render
        # green either.
        assert delta.severity == "warning"
        assert delta.derived is False
        assert _section(report, "versions").severity == "warning"
        assert report.severity == "warning"

    def test_measured_match_is_in_sync(self) -> None:
        """A GENUINELY measured match still reports clean — for the right reason.

        The guard against the rule over-firing: two boxes that were both read
        with ``measured`` and produced the same digest are in sync, which is the
        whole point of measuring.
        """
        sections = {
            "versions": {
                "python": "3.13",
                "python_installed_probe": "measured",
                "python_installed_scope_kind": "default",
                "python_installed_env_kind": "venv",
                "python_installed_interpreter": "3.13",
                "python_installed_count": "214",
                "python_installed_digest": "sha256:abc123",
            }
        }
        canonical = _envelope(sections)
        actual = _envelope({"versions": dict(sections["versions"])})
        report = devenv_drift.diff_envelopes(canonical, actual)

        assert report.in_sync is True
        assert report.sections == []
        assert report.severity == "info"

    def test_measured_but_differing_digests_is_ordinary_drift(self) -> None:
        """Real inventory drift is still real drift — the rule swallows nothing.

        Both sides measured, so the attestation arm stays silent and the digest
        difference lands as an ordinary ``changed`` delta at the ``versions``
        section's own severity.
        """
        canonical = _envelope(
            {
                "versions": {
                    "python_installed_probe": "measured",
                    "python_installed_count": "214",
                    "python_installed_digest": "sha256:abc123",
                }
            }
        )
        actual = _envelope(
            {
                "versions": {
                    "python_installed_probe": "measured",
                    "python_installed_count": "197",
                    "python_installed_digest": "sha256:def456",
                }
            }
        )
        report = devenv_drift.diff_envelopes(canonical, actual)

        assert report.in_sync is False
        section = _section(report, "versions")
        digest = _delta(section, "python_installed_digest")
        assert digest.status == "changed"
        assert digest.derived is False
        assert digest.severity == "critical"
        assert report.severity == "critical"
        # The probe agreed and was the measured marker, so it is NOT reported —
        # the attestation arm did not fire on a measured pair.
        assert [
            d.key for d in section.deltas if d.key == "python_installed_probe"
        ] == []

    def test_absent_key_on_both_sides_is_inert(self) -> None:
        """Every runner in the field today: no probe key at all → unchanged.

        Absence is NOT the unmeasured case — it means the capturing runner
        predates the inventory probe. Treating it as unmeasured would mark every
        existing box drifted the moment this rule landed, which is why the rule
        consults values that are present and never an absent key.
        """
        sections = {"versions": {"python": "3.13"}, "services": {"redis": "6379"}}
        canonical = _envelope(sections)
        actual = _envelope(
            {"versions": {"python": "3.13"}, "services": {"redis": "6379"}}
        )
        report = devenv_drift.diff_envelopes(canonical, actual)

        assert report.in_sync is True
        assert report.sections == []
        assert report.severity == "info"

    def test_one_side_unmeasured_beats_the_changed_arm(self) -> None:
        """``measured`` vs a failure reason: the headline is the failure.

        Symmetric on purpose — an unmeasured CANONICAL makes the comparison just
        as unusable as an unmeasured target, so the same delta is produced
        whichever side declined to measure.
        """
        canonical = _envelope(
            {
                "versions": {
                    "python_installed_probe": "measured",
                    "python_installed_digest": "sha256:abc123",
                }
            }
        )
        actual = _envelope({"versions": {"python_installed_probe": "probe_timeout"}})
        report = devenv_drift.diff_envelopes(canonical, actual)

        assert report.in_sync is False
        delta = _delta(_section(report, "versions"), "python_installed_probe")
        assert delta.status == "unverified"
        assert delta.expected == "measured"
        assert delta.actual == "probe_timeout"
        assert delta.severity == "warning"

        # ... and inverted: canonical is the side that could not measure.
        inverted = devenv_drift.diff_envelopes(actual, canonical)
        assert inverted.in_sync is False
        inverted_delta = _delta(
            _section(inverted, "versions"), "python_installed_probe"
        )
        assert inverted_delta.status == "unverified"
        assert inverted_delta.expected == "probe_timeout"
        assert inverted_delta.actual == "measured"

    @pytest.mark.parametrize(
        "reason",
        [
            # The runner's own PythonInventoryProbe::wire variants, read off
            # env_agent/collectors.rs rather than off a plan summary.
            "scope_unusable",
            "python_absent",
            "probe_failed",
            "probe_timeout",
            "unparseable_output",
            # A reason no runner emits yet. The rule is polarised on the ONE
            # measured marker rather than on a list of known failures, so a
            # reason a later runner invents blocks in_sync the day it ships
            # instead of silently reading as clean.
            "some_future_reason_nobody_has_written_yet",
        ],
    )
    def test_every_non_measured_probe_value_blocks_in_sync(self, reason: str) -> None:
        """Anything that is not ``measured`` means the environment was not read."""
        canonical = _envelope({"versions": {"python_installed_probe": reason}})
        actual = _envelope({"versions": {"python_installed_probe": reason}})
        report = devenv_drift.diff_envelopes(canonical, actual)

        assert report.in_sync is False
        assert _delta(
            _section(report, "versions"), "python_installed_probe"
        ).actual == (reason)

    def test_rule_is_scoped_to_the_versions_section(self) -> None:
        """A same-named key in another section is not this probe.

        Same conservatism as ``_DERIVED_KEYS`` being section-keyed: the oracle
        must not read a value's MEANING out of a section that never agreed to
        the convention.
        """
        canonical = _envelope({"services": {"python_installed_probe": "python_absent"}})
        actual = _envelope({"services": {"python_installed_probe": "python_absent"}})
        report = devenv_drift.diff_envelopes(canonical, actual)

        assert report.in_sync is True
        assert report.sections == []

    def test_incomparable_env_kinds_are_not_reported_as_drift(self) -> None:
        """The mirror failure: a digest difference nobody can act on.

        The inventory digest is a function of WHICH environment was read — the
        interpreter comes off the inherited PATH, so the same box captured from
        an activated venv and from a plain shell yields two different digests
        with nothing wrong on either side. Comparing them manufactures a
        permanent out-of-sync with no apply path, which is the exact inverse of
        reporting an unmeasured box as clean.
        """
        canonical = _envelope(
            {
                "versions": {
                    "python_installed_probe": "measured",
                    "python_installed_env_kind": "venv",
                    "python_installed_count": "214",
                    "python_installed_digest": "sha256:abc123",
                }
            }
        )
        actual = _envelope(
            {
                "versions": {
                    "python_installed_probe": "measured",
                    "python_installed_env_kind": "not_venv",
                    "python_installed_count": "97",
                    "python_installed_digest": "sha256:def456",
                }
            }
        )
        report = devenv_drift.diff_envelopes(canonical, actual)
        section = _section(report, "versions")

        for key in ("python_installed_count", "python_installed_digest"):
            delta = _delta(section, key)
            # NOT ``changed``: the two numbers were taken over different
            # environments, so their difference is not evidence of drift.
            assert delta.status == "unverified", key
            assert delta.severity == "warning", key
            assert delta.expected is not None and delta.actual is not None, key
        # The MARKER itself stays an ordinary, actionable difference — the
        # runner emits it un-derived precisely so it cannot be swallowed.
        marker = _delta(section, "python_installed_env_kind")
        assert marker.status == "changed"
        assert marker.derived is False
        # ... and it is still not something an apply can set.
        assert marker.observation_only is True
        # Capped BELOW the versions table's `critical`: at critical the rollup
        # badge for "not comparable" is indistinguishable from real package
        # drift, and there is no remediation line that could ever clear it.
        assert marker.severity == "warning"
        assert _section(report, "versions").severity == "warning"
        assert report.severity == "warning"
        # Neither clean nor silently drifted.
        assert report.in_sync is False

    def test_incomparable_inventories_are_not_reported_as_clean(self) -> None:
        """Equal digests across differing markers are still not evidence.

        Two numbers taken over different environments do not become comparable
        by coming out equal, so the gate fires on the EQUAL case too — the same
        property that makes the unmeasured rule work.
        """
        base = {
            "python_installed_probe": "measured",
            "python_installed_count": "214",
            "python_installed_digest": "sha256:abc123",
        }
        canonical = _envelope(
            {"versions": {**base, "python_installed_scope_kind": "declared"}}
        )
        actual = _envelope(
            {"versions": {**base, "python_installed_scope_kind": "default"}}
        )
        report = devenv_drift.diff_envelopes(canonical, actual)

        assert report.in_sync is False
        digest = _delta(_section(report, "versions"), "python_installed_digest")
        assert digest.status == "unverified"
        assert digest.expected == digest.actual == "sha256:abc123"

    def test_agreeing_markers_leave_digest_drift_alone(self) -> None:
        """Over-suppression guard: the gate only fires on DISAGREEING markers.

        Both boxes measured venvs, in the same scope kind, on the same
        interpreter minor — every marker agrees — so their digests are
        comparable and a difference between them is ordinary, actionable drift.
        A gate that fired here would mute the very signal the installed
        inventory exists to produce.
        """
        canonical = _envelope(
            {
                "versions": {
                    "python_installed_probe": "measured",
                    "python_installed_env_kind": "venv",
                    "python_installed_scope_kind": "default",
                    "python_installed_interpreter": "3.13",
                    "python_installed_digest": "sha256:abc123",
                }
            }
        )
        actual = _envelope(
            {
                "versions": {
                    "python_installed_probe": "measured",
                    "python_installed_env_kind": "venv",
                    "python_installed_scope_kind": "default",
                    "python_installed_interpreter": "3.13",
                    "python_installed_digest": "sha256:def456",
                }
            }
        )
        report = devenv_drift.diff_envelopes(canonical, actual)

        digest = _delta(_section(report, "versions"), "python_installed_digest")
        assert digest.status == "changed"
        assert digest.severity == "critical"
        assert report.in_sync is False

    @pytest.mark.parametrize(
        ("marker", "value", "expected_status"),
        [
            ("python_installed_env_kind", "venv", "added"),
            ("python_installed_scope_kind", "default", "added"),
            # The sixth key is a marker AND a measurement, so its own status
            # differs: canonical says ``measured`` yet carries no interpreter,
            # which by the runner's invariant can only mean that capture's
            # runner predates the key. That is contract skew (``unknown``,
            # blocking nothing), not "the target has an extra key".
            ("python_installed_interpreter", "3.13", "unknown"),
        ],
    )
    def test_a_marker_on_one_side_only_does_not_gate(
        self, marker: str, value: str, expected_status: str
    ) -> None:
        """A marker only one capture reports is runner skew, not incomparability.

        Refusing to compare on a one-sided marker would let an OLD runner —
        which emits no marker at all — mute a real digest difference on every
        peer that does emit one. Both-sides-present is required, so the marker
        is reported as the ordinary difference (or the skew) it is and the
        DIGEST DRIFT SURVIVES — that last assertion is the point of the test,
        and it holds for all three markers.
        """
        canonical = _envelope(
            {
                "versions": {
                    "python_installed_probe": "measured",
                    "python_installed_digest": "sha256:abc123",
                }
            }
        )
        actual = _envelope(
            {
                "versions": {
                    "python_installed_probe": "measured",
                    marker: value,
                    "python_installed_digest": "sha256:def456",
                }
            }
        )
        report = devenv_drift.diff_envelopes(canonical, actual)

        section = _section(report, "versions")
        assert _delta(section, "python_installed_digest").status == "changed"
        assert _delta(section, marker).status == expected_status
        assert report.in_sync is False

    def test_differing_interpreter_minor_gates_the_digest(self) -> None:
        """The blind spot the sixth key was added to close.

        ``env_kind`` alone only separates venv from not-venv, so two boxes on
        3.12 and 3.13 — different interpreters, wholly different site-packages —
        both report ``not_venv``, pass a two-marker gate, and have their digests
        compared as if they measured the same thing. That is precisely the class
        this rule exists to catch, so the interpreter gates too.

        MAJOR.MINOR is what the runner publishes, on purpose: a patch bump does
        not change which packages are installed, so gating on the patch would
        manufacture incomparability where none exists. Nothing here needs to
        know that — the rule compares values — but a fixture carrying a patch
        version would be testing a contract the runner does not offer.
        """
        canonical = _envelope(
            {
                "versions": {
                    "python_installed_probe": "measured",
                    "python_installed_env_kind": "not_venv",
                    "python_installed_scope_kind": "default",
                    "python_installed_interpreter": "3.12",
                    "python_installed_count": "214",
                    "python_installed_digest": "sha256:abc123",
                }
            }
        )
        actual = _envelope(
            {
                "versions": {
                    "python_installed_probe": "measured",
                    "python_installed_env_kind": "not_venv",
                    "python_installed_scope_kind": "default",
                    "python_installed_interpreter": "3.13",
                    "python_installed_count": "197",
                    "python_installed_digest": "sha256:def456",
                }
            }
        )
        report = devenv_drift.diff_envelopes(canonical, actual)
        section = _section(report, "versions")

        # The two markers that USED to be the whole gate agree here — without
        # the interpreter this pair would have compared clean-or-drifted.
        assert "python_installed_env_kind" not in [d.key for d in section.deltas]
        for key in ("python_installed_count", "python_installed_digest"):
            assert _delta(section, key).status == "unverified", key
            assert _delta(section, key).severity == "warning", key
        interpreter = _delta(section, "python_installed_interpreter")
        assert interpreter.status == "changed"
        assert interpreter.derived is False
        assert interpreter.observation_only is True
        assert report.in_sync is False

    def test_unmeasured_side_reports_the_reason_and_gates_the_numbers(self) -> None:
        """Both rules at once, on the shape a real failure actually produces.

        The runner sets ``python_installed_env_kind = "unknown"`` whenever it
        measured nothing — never ``not_venv`` — so an unmeasurable box trips the
        probe rule AND disagrees on the marker. The report must name the reason
        (that is what the operator acts on) and must not turn canonical's
        numbers into ``removed`` drift on a box that never looked.
        """
        canonical = _envelope(
            {
                "versions": {
                    "python_installed_probe": "measured",
                    "python_installed_env_kind": "venv",
                    "python_installed_count": "214",
                    "python_installed_digest": "sha256:abc123",
                }
            }
        )
        actual = _envelope(
            {
                "versions": {
                    "python_installed_probe": "python_absent",
                    "python_installed_env_kind": "unknown",
                }
            }
        )
        report = devenv_drift.diff_envelopes(canonical, actual)

        section = _section(report, "versions")
        probe = _delta(section, "python_installed_probe")
        assert probe.status == "unverified"
        assert probe.actual == "python_absent"
        for key in ("python_installed_count", "python_installed_digest"):
            assert _delta(section, key).status == "unverified", key
        assert report.in_sync is False

    def test_one_sided_probe_failure_is_never_confirmed_drift(self) -> None:
        """The realistic field case: canonical measured, the peer's probe failed.

        This is what actually happens — one box has a broken or absent Python —
        and it used to come out ``critical`` with ``has_real_drift`` set: the
        interpreter read ``removed`` ("canonical has one, this box does not")
        and ``env_kind`` read ``changed`` (``venv`` -> ``unknown``), both at the
        ``versions`` table's ``critical``, both about a box that never looked,
        and neither clearable because these keys get no remediation line. An
        environment rollup pinned at ``critical`` with no apply path is the
        "drift signal rots" failure this module names as its own risk.

        Every inventory key must therefore land on the evidence-gap side, and
        the report's severity must stay ``warning``.
        """
        canonical = _envelope(
            {
                "versions": {
                    "python": "3.13",
                    "python_installed_probe": "measured",
                    "python_installed_scope_kind": "default",
                    "python_installed_env_kind": "venv",
                    "python_installed_interpreter": "3.13",
                    "python_installed_count": "214",
                    "python_installed_digest": "sha256:abc123",
                }
            }
        )
        actual = _envelope(
            {
                "versions": {
                    "python": "3.13",
                    "python_installed_probe": "probe_failed",
                    "python_installed_scope_kind": "default",
                    "python_installed_env_kind": "unknown",
                }
            }
        )
        report = devenv_drift.diff_envelopes(canonical, actual)
        section = _section(report, "versions")

        for key in (
            "python_installed_probe",
            "python_installed_env_kind",
            "python_installed_interpreter",
            "python_installed_count",
            "python_installed_digest",
        ):
            delta = _delta(section, key)
            assert delta.status == "unverified", key
            assert delta.severity == "warning", key
        # Not in sync — nobody can say these two agree — but NOT critical, and
        # nothing claims the box is missing something it never looked for.
        assert report.in_sync is False
        assert report.severity == "warning"
        assert section.severity == "warning"
        assert [d.status for d in section.deltas if d.status == "removed"] == []

    def test_env_kind_unknown_is_a_sentinel_not_a_third_environment(self) -> None:
        """``unknown`` means "I did not measure", so it is never a ``changed``.

        The runner writes ``env_kind = "unknown"`` on every failure path and
        asserts the biconditional (``env_kind != "unknown"`` iff measured) in
        its own capture test. Reporting ``venv`` -> ``unknown`` as a difference
        would claim the box's environment changed when what changed is whether
        anyone looked — and would do it at ``critical`` on a key no apply can
        set.

        The polarity is deliberately narrow, unlike the probe's: ``venv`` and
        ``not_venv`` are both real observations, so only the one sentinel value
        counts.
        """
        canonical = _envelope(
            {
                "versions": {
                    "python_installed_probe": "measured",
                    "python_installed_env_kind": "venv",
                    "python_installed_interpreter": "3.13",
                    "python_installed_count": "214",
                    "python_installed_digest": "sha256:abc123",
                }
            }
        )
        actual = _envelope(
            {
                "versions": {
                    "python_installed_probe": "python_absent",
                    "python_installed_env_kind": "unknown",
                }
            }
        )
        report = devenv_drift.diff_envelopes(canonical, actual)

        env_kind = _delta(_section(report, "versions"), "python_installed_env_kind")
        assert env_kind.status == "unverified"
        assert env_kind.severity == "warning"

        # ... while a genuine venv/not_venv difference IS a real difference.
        both_measured = devenv_drift.diff_envelopes(
            _envelope(
                {
                    "versions": {
                        "python_installed_probe": "measured",
                        "python_installed_env_kind": "venv",
                    }
                }
            ),
            _envelope(
                {
                    "versions": {
                        "python_installed_probe": "measured",
                        "python_installed_env_kind": "not_venv",
                    }
                }
            ),
        )
        real = _delta(_section(both_measured, "versions"), "python_installed_env_kind")
        assert real.status == "changed"

    def test_mixed_fleet_rollout_does_not_manufacture_drift(self) -> None:
        """A peer whose runner predates the family is UNKNOWN, not missing six keys.

        The rollout window this change exists to serve: canonical captured by
        the new runner, a peer still on the old one. Without a participation
        check all six keys read ``removed`` at ``critical`` on that peer — a
        false claim (it never looked), unclearable (``observation_only``, so no
        remediation line), and pinned to the environment rollup for as long as
        the rollout takes. The sibling ``python_dep_*`` change was harmless on
        arrival because ``derived`` keys drop out of ``in_sync``;
        ``observation_only`` deliberately gives no such protection, so the skew
        is handled here.

        The accepted residual is asserted too: that peer's inventory is UNKNOWN
        rather than drifted, so it blocks nothing until it upgrades.
        """
        canonical = _envelope(
            {
                "versions": {
                    "python": "3.13",
                    "python_installed_probe": "measured",
                    "python_installed_scope_kind": "default",
                    "python_installed_env_kind": "venv",
                    "python_installed_interpreter": "3.13",
                    "python_installed_count": "214",
                    "python_installed_digest": "sha256:abc123",
                }
            }
        )
        actual = _envelope({"versions": {"python": "3.13"}})
        report = devenv_drift.diff_envelopes(canonical, actual)
        section = _section(report, "versions")

        for delta in section.deltas:
            assert delta.key.startswith("python_installed_"), delta.key
            assert delta.status == "unknown", delta.key
            assert delta.severity == "info", delta.key
        # Visible, but not a verdict: an old capture carries no inventory
        # evidence in either direction.
        assert report.in_sync is True
        assert report.severity == "info"

    def test_temporal_diff_keeps_identical_captures_in_sync(self) -> None:
        """Blocking case: the same oracle also answers "did anything change?".

        ``diff_envelopes`` serves the config-history endpoint, where both
        envelopes are captures of ONE machine and ``in_sync`` means "nothing
        changed between them". "Silence is never success" is a claim about
        PARITY: two captures of one box that are byte-identical genuinely are
        unchanged, even when neither measured anything. Applying the parity rule
        there badges every consecutive pair on a box with a broken Python — and
        would do it for ``from_id == to_id``.
        """
        capture = _envelope(
            {
                "versions": {
                    "python_installed_probe": "python_absent",
                    "python_installed_scope_kind": "default",
                    "python_installed_env_kind": "unknown",
                }
            }
        )

        temporal = devenv_drift.diff_envelopes(capture, dict(capture), temporal=True)
        assert temporal.in_sync is True
        assert temporal.sections == []
        assert temporal.severity == "info"

        # The contrast is the point: the SAME pair compared for parity is not
        # in sync, because there two boxes are being called equal on the
        # strength of two identical notes saying nobody looked.
        parity = devenv_drift.diff_envelopes(capture, dict(capture))
        assert parity.in_sync is False

    def test_temporal_diff_still_reports_what_changed(self) -> None:
        """Switching the rules off must not switch the diff off.

        A box whose inventory actually moved between two captures is exactly
        what the history view exists to show, so the ordinary arms still answer
        — including when the box stopped measuring between them.
        """
        before = _envelope(
            {
                "versions": {
                    "python_installed_probe": "measured",
                    "python_installed_env_kind": "venv",
                    "python_installed_interpreter": "3.13",
                    "python_installed_digest": "sha256:abc123",
                }
            }
        )
        after = _envelope(
            {
                "versions": {
                    "python_installed_probe": "measured",
                    "python_installed_env_kind": "venv",
                    "python_installed_interpreter": "3.13",
                    "python_installed_digest": "sha256:def456",
                }
            }
        )
        report = devenv_drift.diff_envelopes(before, after, temporal=True)

        digest = _delta(_section(report, "versions"), "python_installed_digest")
        assert digest.status == "changed"
        assert report.in_sync is False

    def test_history_endpoint_asks_for_the_temporal_reading(self) -> None:
        """The wiring, not just the capability.

        The parity default is the safe one (a caller that forgets the flag gets
        a noisy row, not a false "in sync"), which is exactly why the ONE caller
        that needs the other reading has to be pinned. The endpoint that uses it
        is DB-backed and cannot run in this layer, so the call site is asserted
        directly — a cheap guard on a line whose only other cover is an
        integration test.
        """
        import inspect

        from app.api.v1.endpoints import devenv as devenv_endpoints

        source = inspect.getsource(devenv_endpoints.get_config_history_diff)
        assert "temporal=True" in source

    def test_inventory_key_table_matches_the_policy_prefix(self) -> None:
        """The two modules must agree about what the family contains.

        This is the guard for how the interpreter defect happened: the policy
        module classifies the family by PREFIX (so it absorbed the runner's
        sixth key silently and correctly) while the oracle declares it KEY BY
        KEY (so it absorbed nothing, and the new key fell through to the
        ``removed`` arm at ``critical``). The oracle needs per-key roles and
        cannot use a prefix, so the two representations stay — but they may
        never disagree about membership.
        """
        from app.services import devenv_section_policy as sp

        for key in devenv_drift._INVENTORY_KEY_ROLES:
            assert sp.is_observation_only_key("versions", key) is True, key
        # Every declared key holds at least one known role, so a typo in the
        # table cannot silently produce a key the verdict function ignores.
        known = {
            devenv_drift._ROLE_ATTESTATION,
            devenv_drift._ROLE_MARKER,
            devenv_drift._ROLE_MEASUREMENT,
        }
        for key, roles in devenv_drift._INVENTORY_KEY_ROLES.items():
            assert roles, key
            assert roles <= known, key

    def test_installed_keys_are_never_classified_derived(self) -> None:
        """The load-bearing negative: derived would INVERT this rule.

        A derived key is reported at ``info`` and dropped from ``in_sync``. So
        registering any ``python_installed_*`` key as derived would not merely
        soften this rule, it would restore exactly the failure it exists to
        prevent — an unmeasured box reporting clean. ``_DERIVED_KEY_PREFIXES``
        must keep only ``node_dep_`` and ``python_dep_``.
        """
        from app.services import devenv_section_policy as sp

        installed = {
            "python_installed_probe": "python_absent",
            "python_installed_scope_kind": "default",
            "python_installed_env_kind": "venv",
            "python_installed_interpreter": "3.13",
            "python_installed_count": "214",
            "python_installed_digest": "sha256:abc123",
        }
        for key in installed:
            assert sp.is_derived_key("versions", key) is False, key
        assert sp.derived_keys_map({"versions": installed}) == {"versions": []}
        assert sp._DERIVED_KEY_PREFIXES == {"versions": ("node_dep_", "python_dep_")}

        # And on the drift path, which is where the classification is spent.
        report = devenv_drift.diff_envelopes(
            _envelope({"versions": dict(installed)}),
            _envelope({"versions": dict(installed)}),
        )
        assert (
            _delta(_section(report, "versions"), "python_installed_probe").derived
            is False
        )

    def test_installed_keys_are_observation_only_not_apply_actions(self) -> None:
        """Measured box state, but nothing an apply can SET.

        The mirror image of the rule above, and the reason it needs a second
        flag rather than ``derived``. ``versions`` is an ``applyable`` section
        and web's remediation builder allow-lists ``changed``/``removed``
        deltas, skipping only ``derived`` ones — so an unflagged
        ``python_installed_digest`` difference becomes the instruction "set
        python_installed_digest to sha256:abc123", which nobody can carry out.
        The box converges by installing packages; the digest follows.

        ``derived=False`` is asserted alongside because the two flags must not
        collapse: derived would ALSO drop these keys out of ``in_sync``, which
        is the failure the whole inventory capture exists to remove.
        """
        canonical = _envelope(
            {
                "versions": {
                    "python": "3.13",
                    "python_installed_probe": "measured",
                    "python_installed_count": "214",
                    "python_installed_digest": "sha256:abc123",
                }
            }
        )
        actual = _envelope(
            {
                "versions": {
                    "python": "3.13",
                    "python_installed_probe": "measured",
                    "python_installed_count": "197",
                    "python_installed_digest": "sha256:def456",
                }
            }
        )
        report = devenv_drift.diff_envelopes(canonical, actual)
        section = _section(report, "versions")

        for key in ("python_installed_count", "python_installed_digest"):
            delta = _delta(section, key)
            assert delta.observation_only is True, key
            # Still full drift: visible, counted, at the section's severity.
            assert delta.derived is False, key
            assert delta.status == "changed", key
            assert delta.severity == "critical", key
        assert report.in_sync is False

    def test_ordinary_keys_are_not_observation_only(self) -> None:
        """The flag is scoped, so it cannot quietly empty a remediation plan.

        An observation-only key is REMOVED from the apply plan, so an
        over-broad rule here does not fail loudly — it silently stops offering
        remediations that were correct. Hence the negative cases and the
        section scoping, exactly as for the derived-key prefixes.
        """
        from app.services import devenv_section_policy as sp

        # Every key the capture emits, verified rather than assumed — the
        # prefix rule is supposed to cover a key added by a later runner round
        # with no server change, and ``python_installed_interpreter`` is the
        # first key to actually test that claim.
        for key in (
            "python_installed_probe",
            "python_installed_scope_kind",
            "python_installed_env_kind",
            "python_installed_interpreter",
            "python_installed_count",
            "python_installed_digest",
        ):
            assert sp.is_observation_only_key("versions", key) is True, key
        assert sp.is_observation_only_key("versions", "python") is False
        assert sp.is_observation_only_key("versions", "python_dep_requests") is False
        assert sp.is_observation_only_key("versions", "node") is False
        # Section-scoped: registered under ``versions`` only.
        assert (
            sp.is_observation_only_key("services", "python_installed_digest") is False
        )

        canonical = _envelope({"versions": {"python": "3.13"}})
        actual = _envelope({"versions": {"python": "3.12"}})
        report = devenv_drift.diff_envelopes(canonical, actual)
        assert _delta(_section(report, "versions"), "python").observation_only is False


class TestConfigEnvelopeUnknownKeys:
    """:class:`ConfigEnvelope` — the ``unknown_keys`` wire field + persistence."""

    def test_absent_stays_none_and_is_omitted_from_stored_config(self) -> None:
        """An older runner's push leaves the persisted bytes exactly as before."""
        env = ConfigEnvelope(
            captured_at=datetime.now(UTC),
            sections={"versions": {"python": "3.12"}},
        )
        assert env.unknown_keys is None
        assert "unknown_keys" not in env.to_stored_config()

    def test_explicit_empty_is_preserved_and_persisted(self) -> None:
        """``{}`` ("everything was measured") must survive as distinct from absent."""
        env = ConfigEnvelope(
            captured_at=datetime.now(UTC),
            sections={"versions": {"python": "3.12"}},
            unknown_keys={},
        )
        assert env.unknown_keys == {}
        assert env.to_stored_config()["unknown_keys"] == {}

    def test_populated_round_trips_as_a_sibling_of_sections(self) -> None:
        """The stored shape mirrors the runner's wire shape."""
        env = ConfigEnvelope(
            captured_at=datetime.now(UTC),
            sections={"versions": {}},
            unknown_keys={"versions": ["rustc", "python"]},
        )
        stored = env.to_stored_config()
        assert set(stored) == {
            "schema_version",
            "captured_at",
            "sections",
            "unknown_keys",
        }
        # Deduped + sorted so list ORDER alone cannot append a history row.
        assert stored["unknown_keys"] == {"versions": ["python", "rustc"]}

    def test_duplicates_are_deduped_and_sorted(self) -> None:
        """Two captures naming the same keys in any order normalize identically."""
        a = ConfigEnvelope(
            captured_at=datetime.now(UTC),
            sections={},
            unknown_keys={"versions": ["rustc", "python", "rustc"]},
        )
        b = ConfigEnvelope(
            captured_at=datetime.now(UTC),
            sections={},
            unknown_keys={"versions": ["python", "rustc"]},
        )
        assert a.unknown_keys == b.unknown_keys == {"versions": ["python", "rustc"]}

    def test_non_list_value_rejected(self) -> None:
        """A bare string is not a key LIST — reject rather than iterate its chars."""
        with pytest.raises(ValidationError):
            ConfigEnvelope(
                captured_at=datetime.now(UTC),
                sections={},
                unknown_keys={"versions": "python"},
            )

    def test_non_string_key_entry_rejected(self) -> None:
        """Entries must be key NAMES."""
        with pytest.raises(ValidationError):
            ConfigEnvelope(
                captured_at=datetime.now(UTC),
                sections={},
                unknown_keys={"versions": [1, 2]},
            )

    def test_non_mapping_rejected(self) -> None:
        """The field is ``section -> [key, ...]``, not a bare list."""
        with pytest.raises(ValidationError):
            ConfigEnvelope(
                captured_at=datetime.now(UTC),
                sections={},
                unknown_keys=["python"],
            )


class TestConfigEnvelopeBackstop:
    """:class:`ConfigEnvelope` — secret backstop + nesting rejection."""

    def test_env_contract_secret_value_coerced_to_present(self) -> None:
        """A secret env_contract value is stored as "present", not the raw."""
        secret = "postgres://u:secretpw@h/db"
        env = ConfigEnvelope(
            captured_at=datetime.now(UTC),
            sections={"env_contract": {"DATABASE_URL": secret}},
        )
        stored = env.sections["env_contract"]["DATABASE_URL"]
        assert stored == "present"
        assert "secretpw" not in stored
        assert secret not in str(env.sections)

    def test_env_contract_empty_value_is_absent(self) -> None:
        """An empty env_contract value is stored as "absent"."""
        env = ConfigEnvelope(
            captured_at=datetime.now(UTC),
            sections={"env_contract": {"MISSING": ""}},
        )
        assert env.sections["env_contract"]["MISSING"] == "absent"

    def test_nested_section_value_rejected(self) -> None:
        """A nested (non-string) section value raises ValidationError."""
        with pytest.raises(ValidationError):
            ConfigEnvelope(
                captured_at=datetime.now(UTC),
                sections={"services": {"x": {"nested": 1}}},
            )

    def test_list_section_value_rejected(self) -> None:
        """A list section value raises ValidationError."""
        with pytest.raises(ValidationError):
            ConfigEnvelope(
                captured_at=datetime.now(UTC),
                sections={"services": {"x": [1, 2, 3]}},
            )


class TestMachineKeyCrud:
    """:mod:`devenv_machine_crud` — machine-key generation."""

    def test_key_prefix_hash_shape(self) -> None:
        """Generated key: mk_ prefix, sha256 hex hash, non-secret prefix."""
        plaintext, key_hash, key_prefix = devenv_machine_crud.generate_machine_key()

        assert plaintext.startswith("mk_")
        # Hash is the sha256 hex of the FULL plaintext key.
        assert key_hash == devenv_machine_crud.hash_machine_key(plaintext)
        assert len(key_hash) == 64
        assert all(c in "0123456789abcdef" for c in key_hash)
        # Prefix is a non-secret display prefix — a leading slice of the key,
        # never the hash, and short enough that it can't reveal the secret.
        assert plaintext.startswith(key_prefix)
        assert key_prefix.startswith("mk_")
        assert key_prefix != plaintext
        assert key_prefix != key_hash
        assert len(key_prefix) == devenv_machine_crud.MACHINE_KEY_PREFIX_LEN

    def test_two_generations_differ(self) -> None:
        """Two generations yield distinct keys + hashes."""
        a_plain, a_hash, _ = devenv_machine_crud.generate_machine_key()
        b_plain, b_hash, _ = devenv_machine_crud.generate_machine_key()
        assert a_plain != b_plain
        assert a_hash != b_hash

    def test_enrollment_code_alphabet(self) -> None:
        """Enrollment codes are drawn from the unambiguous alphabet."""
        for _ in range(50):
            code = devenv_machine_crud.generate_enrollment_code()
            assert len(code) == devenv_machine_crud.ENROLLMENT_CODE_LENGTH
            for ch in code:
                assert ch in devenv_machine_crud.ENROLLMENT_CODE_ALPHABET
            assert "0" not in code and "O" not in code
            assert "1" not in code and "I" not in code


class TestContentHash:
    """:func:`app.repositories.devenv.compute_content_hash` — canonical JSON."""

    def test_key_order_does_not_change_hash(self) -> None:
        """The same envelope with different dict key order hashes identically."""
        from app.repositories.devenv import compute_content_hash

        a = {
            "schema_version": 1,
            "sections": {
                "services": {"redis": "6379", "pg": "5432"},
                "versions": {"python": "3.12"},
            },
        }
        b = {
            "sections": {
                "versions": {"python": "3.12"},
                "services": {"pg": "5432", "redis": "6379"},
            },
            "schema_version": 1,
        }
        assert compute_content_hash(a) == compute_content_hash(b)
        # Shape sanity: sha256 hex.
        digest = compute_content_hash(a)
        assert len(digest) == 64
        assert all(c in "0123456789abcdef" for c in digest)

    def test_captured_at_excluded_from_hash(self) -> None:
        """A re-capture of identical content dedups despite a moved timestamp."""
        from app.repositories.devenv import compute_content_hash

        sections = {"services": {"redis": "6379"}}
        early = {
            "schema_version": 1,
            "captured_at": "2026-06-21T00:00:00Z",
            "sections": sections,
        }
        late = {
            "schema_version": 1,
            "captured_at": "2026-06-21T00:15:00Z",
            "sections": sections,
        }
        assert compute_content_hash(early) == compute_content_hash(late)

    def test_content_change_changes_hash(self) -> None:
        """A changed section value produces a different hash."""
        from app.repositories.devenv import compute_content_hash

        a = {"schema_version": 1, "sections": {"services": {"redis": "6379"}}}
        b = {"schema_version": 1, "sections": {"services": {"redis": "6380"}}}
        assert compute_content_hash(a) != compute_content_hash(b)


class TestSectionPolicy:
    """:mod:`app.services.devenv_section_policy` — per-section apply policy."""

    def test_known_sections(self) -> None:
        """versions/services apply; env_contract secret; db_schema destructive."""
        from app.services import devenv_section_policy as sp

        assert sp.policy_for("versions") == "applyable"
        assert sp.policy_for("services") == "applyable"
        assert sp.policy_for("env_contract") == "secret_report_only"
        assert sp.policy_for("db_schema") == "destructive_confirm"
        assert sp.policy_for("claude_accounts") == "report_only"

    def test_unknown_section_defaults_report_only(self) -> None:
        """An unrecognized section is conservatively report_only."""
        from app.services import devenv_section_policy as sp

        assert sp.policy_for("something_new") == "report_only"

    def test_repos_is_report_only_until_the_apply_module_exists(self) -> None:
        """``repos`` must not be applyable before the runner can apply it.

        The runner's apply driver returns ``Unsupported`` for an applyable
        section with no module, while its plan renderer simultaneously reports
        "N change(s) are in applyable sections - re-run with --confirm". Marking
        ``repos`` applyable before ``env_agent/apply_repos.rs`` ships therefore
        makes the box advertise an apply it cannot perform. Flip this — and this
        test — in the same change that adds the module.
        """
        from app.services import devenv_section_policy as sp

        assert sp.policy_for("repos") == "report_only"

    def test_policy_map(self) -> None:
        """policy_map returns section -> policy for the given names."""
        from app.services import devenv_section_policy as sp

        m = sp.policy_map(["versions", "db_schema", "zzz"])
        assert m == {
            "versions": "applyable",
            "db_schema": "destructive_confirm",
            "zzz": "report_only",
        }


class TestDerivedKeys:
    """:mod:`app.services.devenv_section_policy` — per-KEY derived refinement."""

    def test_versions_repo_derived_keys(self) -> None:
        """Every repo-derived versions key is classified derived, incl. node_dep_*."""
        from app.services import devenv_section_policy as sp

        derived = sp.derived_keys_map(
            {
                "versions": {
                    "runner_crate_version": "0.1.0",
                    "node_package_version": "1.2.3",
                    "node_package_name": "qontinui-runner",
                    "python_constraint": ">=3.12",
                    "tauri": "2.0.0",
                    "node_dep_react": "19.0.0",
                }
            }
        )
        assert sorted(derived["versions"]) == [
            "node_dep_react",
            "node_package_name",
            "node_package_version",
            "python_constraint",
            "runner_crate_version",
            "tauri",
        ]

    def test_python_dep_prefix_is_derived(self) -> None:
        """``python_dep_*`` is repo-derived, and ONLY that exact prefix is.

        The stored value is the DECLARED CONSTRAINT out of a committed
        manifest, not an installed version, so — like ``node_dep_*`` — it
        converges by pulling the repo and can never be an apply action.
        Registering the
        prefix here is a PREREQUISITE for the runner emitting the keys:
        ``is_derived_key`` answers False for an unrecognized prefix, so an
        unregistered ``python_dep_*`` would silently become actionable drift in
        the ``applyable`` ``versions`` section on every box.

        The negative cases are what prove the classification is keyed on the
        prefix rather than being vacuously true for anything Python-ish.
        """
        from app.services import devenv_section_policy as sp

        assert sp.is_derived_key("versions", "python_dep_requests") is True
        assert sp.is_derived_key("versions", "python_dep_pydantic") is True
        # A near-miss key that was never registered stays NOT derived.
        assert sp.is_derived_key("versions", "python_pkg_requests") is False
        assert sp.is_derived_key("versions", "pythondep_requests") is False
        # Machine facts in the same section are untouched by the prefix rule.
        assert sp.is_derived_key("versions", "python") is False
        # Section-scoped: the prefix is registered under ``versions`` only.
        assert sp.is_derived_key("services", "python_dep_requests") is False
        derived = sp.derived_keys_map(
            {
                "versions": {
                    "python": "3.13",
                    "python_dep_requests": "2.32.3",
                    "python_pkg_requests": "2.32.3",
                }
            }
        )
        assert derived == {"versions": ["python_dep_requests"]}

    def test_probe_scope_kind_is_derived(self) -> None:
        """Capture provenance is reported but is never an apply action.

        ``probe_scope_kind`` records WHICH scope the node/python/rustc probes
        ran in. No version manager can install a scope, so it must never be
        counted as actionable drift — but it must still be REPORTED, because a
        runner uses it to decide whether canonical's toolchain numbers are
        comparable with its own at all.
        """
        from app.services import devenv_section_policy as sp

        assert sp.is_derived_key("versions", "probe_scope_kind") is True
        derived = sp.derived_keys_map(
            {"versions": {"node": "22.1.0", "probe_scope_kind": "default"}}
        )
        assert derived == {"versions": ["probe_scope_kind"]}
        # Scoped to `versions` — it is not a blanket key name.
        assert sp.is_derived_key("services", "probe_scope_kind") is False

    def test_repos_scope_kind_is_derived(self) -> None:
        """The repos section's provenance key is reported, never applied.

        ``repos_scope_kind`` names WHICH KIND of workspace-root resolution the
        repo observations were taken under. No clone can install a scope, so it
        must never be counted as actionable drift — but it must still be
        REPORTED, because two boxes that resolved different kinds did not
        enumerate the same concept and their repo lists are not comparable.
        """
        from app.services import devenv_section_policy as sp

        assert sp.is_derived_key("repos", "repos_scope_kind") is True
        derived = sp.derived_keys_map(
            {
                "repos": {
                    "repo_qontinui_qontinui-runner": "https://github.com/qontinui/qontinui-runner",
                    "repos_scope_kind": "discovered",
                }
            }
        )
        assert derived == {"repos": ["repos_scope_kind"]}

    def test_derived_keys_do_not_leak_across_sections(self) -> None:
        """``_DERIVED_KEYS`` is section-keyed and must stay that way.

        ``is_derived_key`` answers False for an unrecognized key (its
        conservative default), so registering a provenance key under one section
        does NOT cover a same-named key in another. Getting this wrong is silent:
        an unregistered provenance key simply keeps its section policy and gets
        counted as an actionable apply action.
        """
        from app.services import devenv_section_policy as sp

        # Each provenance key is derived in its OWN section only.
        assert sp.is_derived_key("versions", "probe_scope_kind") is True
        assert sp.is_derived_key("repos", "probe_scope_kind") is False
        assert sp.is_derived_key("repos", "repos_scope_kind") is True
        assert sp.is_derived_key("versions", "repos_scope_kind") is False
        # A real repo key is never derived — cloning IS the apply action.
        assert sp.is_derived_key("repos", "repo_qontinui_qontinui-stack") is False

    def test_machine_facts_are_not_derived(self) -> None:
        """node/python/rustc are shelled machine facts — they stay applyable."""
        from app.services import devenv_section_policy as sp

        derived = sp.derived_keys_map(
            {"versions": {"node": "22.1.0", "python": "3.13", "rustc": "1.84.0"}}
        )
        assert derived == {"versions": []}

    def test_other_sections_have_no_derived_keys(self) -> None:
        """services/env_contract/db_schema classify to empty lists."""
        from app.services import devenv_section_policy as sp

        derived = sp.derived_keys_map(
            {
                "services": {"redis": "6379"},
                "env_contract": {"DATABASE_URL": "present"},
                "db_schema": {"alembic_head": "abc123"},
            }
        )
        assert derived == {"services": [], "env_contract": [], "db_schema": []}

    def test_unknown_key_is_not_derived(self) -> None:
        """Conservative default: an unrecognized key keeps its section policy."""
        from app.services import devenv_section_policy as sp

        assert sp.is_derived_key("versions", "something_new") is False
        assert sp.is_derived_key("services", "runner_crate_version") is False
        assert sp.derived_keys_map({"versions": {"something_new": "x"}}) == {
            "versions": []
        }

    def test_response_is_valid_without_derived_keys(self) -> None:
        """Additive: a response built without the field still validates (empty)."""
        from uuid import uuid4

        from app.schemas.devenv import CanonicalConfigResponse

        r = CanonicalConfigResponse(
            environment_id=uuid4(),
            sections={"versions": {"python": "3.13"}},
            section_policy={"versions": "applyable"},
        )
        assert r.derived_keys == {}


# ---------------------------------------------------------------------------
# Layer 1 helpers
# ---------------------------------------------------------------------------


def _section(report, name):
    """Return the SectionDrift for ``name`` (asserts it exists)."""
    for sec in report.sections:
        if sec.section == name:
            return sec
    raise AssertionError(f"section {name!r} not in report: {report.sections}")


def _delta(section, key):
    """Return the KeyDelta for ``key`` within a section (asserts it exists)."""
    for delta in section.deltas:
        if delta.key == key:
            return delta
    raise AssertionError(f"key {key!r} not in section {section.section!r}")


# ===========================================================================
# Layer 2 — full HTTP integration (real DB, auth overridden)
# ===========================================================================


def _build_app(*, db_session: AsyncSession, user) -> FastAPI:
    """Build a FastAPI app mounting the devenv routers with overridden deps.

    Overrides ``get_async_db`` → the shared test session and
    ``get_current_active_user_async`` → the real ``test_user`` row (needed
    because ``devenv.*.owner_user_id`` FKs ``auth.users.id``).
    """
    from app.api.deps import get_async_db, get_current_active_user_async
    from app.api.v1.endpoints.devenv import router as devenv_router
    from app.api.v1.endpoints.devenv_agent import router as agent_router

    app = FastAPI()

    if user is not None:
        app.dependency_overrides[get_current_active_user_async] = lambda: user

    async def _db_override():
        yield db_session

    app.dependency_overrides[get_async_db] = _db_override
    app.include_router(devenv_router, prefix=API_PREFIX)
    app.include_router(agent_router, prefix=API_PREFIX)
    return app


def _client(app: FastAPI) -> httpx.AsyncClient:
    """An in-process ``httpx.AsyncClient`` against ``app``."""
    transport = httpx.ASGITransport(app=app)
    return httpx.AsyncClient(transport=transport, base_url="http://test")


async def _mk_coord_device(db: AsyncSession, *, user_id, hostname: str = "box") -> str:
    """A ``coord.devices`` row PAIRED TO ``user_id``; returns its id as a str.

    ``POST /machines/dispatch-enroll`` authorizes on exactly this row, so every
    dispatch test has to own its target. A test that skipped this and passed a
    bare ``uuid4()`` would now assert a 404 while believing it asserted a
    dispatch.
    """
    from app.models.device import Device

    device = Device(
        device_id=uuid4(),
        user_id=user_id,
        name=hostname,
        hostname=hostname,
        state="healthy",
        capability_user_paired=True,
        paired_at=datetime.now(UTC),
    )
    db.add(device)
    await db.flush()
    return str(device.device_id)


def _config_body(sections: dict, *, unknown_keys: dict | None = None) -> dict:
    """A ConfigEnvelope request body (agent push).

    ``unknown_keys`` is omitted when ``None`` — the body an agent predating the
    field sends.
    """
    body: dict = {
        "schema_version": 1,
        "captured_at": "2026-06-21T12:00:00Z",
        "sections": sections,
    }
    if unknown_keys is not None:
        body["unknown_keys"] = unknown_keys
    return body


@pytest_asyncio.fixture()
async def second_user(async_db_session: AsyncSession):
    """A second real user row, for cross-owner isolation tests."""
    from app.models.user import User

    user = User(
        email=f"other_{uuid4()}@example.com",
        username=f"other_{uuid4().hex[:8]}",
        full_name="Other User",
        is_active=True,
        is_verified=True,
    )
    async_db_session.add(user)
    await async_db_session.commit()
    await async_db_session.refresh(user)
    return user


@pytest_asyncio.fixture()
async def third_user(async_db_session: AsyncSession):
    """A third real user row — the org NON-member in sharing tests."""
    from app.models.user import User

    user = User(
        email=f"third_{uuid4()}@example.com",
        username=f"third_{uuid4().hex[:8]}",
        full_name="Third User",
        is_active=True,
        is_verified=True,
    )
    async_db_session.add(user)
    await async_db_session.commit()
    await async_db_session.refresh(user)
    return user


class TestDevenvEndToEnd:
    """The enroll → push → canonical → drift flow against real Postgres."""

    @pytest.mark.asyncio
    async def test_full_flow(self, async_db_session: AsyncSession, test_user) -> None:
        app = _build_app(db_session=async_db_session, user=test_user)

        async with _client(app) as client:
            # 1. Create application + environment + two machines.
            r = await client.post(
                f"{API_PREFIX}/applications",
                json={"name": "App", "slug": "app", "description": None},
            )
            assert r.status_code == 201, r.text

            r = await client.post(
                f"{API_PREFIX}/environments",
                json={"name": "Prod", "description": None},
            )
            assert r.status_code == 201, r.text
            env_id = r.json()["id"]

            r = await client.post(f"{API_PREFIX}/machines", json={"name": "machine-a"})
            assert r.status_code == 201, r.text
            body_a = r.json()
            machine_a_id = body_a["id"]
            code_a = body_a["enrollment_code"]
            # The one-time code must be present + key material never exposed.
            assert code_a and "machine_key" not in body_a
            assert "key_hash" not in body_a

            r = await client.post(f"{API_PREFIX}/machines", json={"name": "machine-b"})
            assert r.status_code == 201, r.text
            body_b = r.json()
            machine_b_id = body_b["id"]
            code_b = body_b["enrollment_code"]

            assert code_a != code_b

            # 2. Enroll both machines (no user auth needed for enroll).
            r = await client.post(
                f"{API_PREFIX}/agent/enroll",
                json={"enrollment_code": code_a, "machine_id": machine_a_id},
            )
            assert r.status_code == 200, r.text
            enroll_a = r.json()
            key_a = enroll_a["machine_key"]
            assert key_a.startswith("mk_")
            assert enroll_a["machine_id"] == machine_a_id
            # Exactly one environment exists → agent gets it bound.
            assert enroll_a["environment_id"] == env_id

            r = await client.post(
                f"{API_PREFIX}/agent/enroll",
                json={"enrollment_code": code_b, "machine_id": machine_b_id},
            )
            assert r.status_code == 200, r.text
            key_b = r.json()["machine_key"]
            assert key_b != key_a

            # 3. Push DIFFERENT config for A and B via X-Machine-Key.
            #    A is the intended canonical; B drifts on db_schema + is
            #    missing a key A has; both include a secret env_contract.
            secret = "postgres://user:topsecret@db/app"
            config_a = _config_body(
                {
                    "db_schema": {"alembic_head": "rev_new"},
                    "services": {"redis": "6379"},
                    "env_contract": {"DATABASE_URL": secret, "API_KEY": "abc123"},
                }
            )
            config_b = _config_body(
                {
                    "db_schema": {"alembic_head": "rev_old"},
                    # NOTE: no "services" section → A's services.redis is removed.
                    "env_contract": {"DATABASE_URL": secret},
                }
            )

            r = await client.put(
                f"{API_PREFIX}/agent/environments/{env_id}/config",
                json=config_a,
                headers={"X-Machine-Key": key_a},
            )
            assert r.status_code == 200, r.text
            assert r.json()["ok"] is True

            r = await client.put(
                f"{API_PREFIX}/agent/environments/{env_id}/config",
                json=config_b,
                headers={"X-Machine-Key": key_b},
            )
            assert r.status_code == 200, r.text

            # 3b. Secret backstop: drift BEFORE canonical is undefined (422),
            #     so verify the persisted value directly is "present".
            from app.repositories.devenv import config_repo

            row_a = await config_repo.get(
                async_db_session,
                environment_id=UUID(env_id),
                machine_id=UUID(machine_a_id),
            )
            assert row_a is not None
            assert row_a.config["sections"]["env_contract"]["DATABASE_URL"] == "present"
            assert "topsecret" not in str(row_a.config)

            # 4. Set canonical to A.
            r = await client.put(
                f"{API_PREFIX}/environments/{env_id}/canonical",
                json={"machine_id": machine_a_id},
            )
            assert r.status_code == 200, r.text
            assert r.json()["canonical_machine_id"] == machine_a_id

            # 5. Environment drift — B should appear with non-empty deltas,
            #    the db_schema change flagged critical, overall critical, and
            #    the secret never leaked.
            r = await client.get(f"{API_PREFIX}/environments/{env_id}/drift")
            assert r.status_code == 200, r.text
            drift = r.json()
            assert drift["severity"] == "critical"
            assert drift["in_sync"] is False
            assert drift["canonical_machine_id"] == machine_a_id

            # Only the non-canonical machine (B) is reported.
            reports = drift["reports"]
            assert len(reports) == 1
            report_b = reports[0]
            assert report_b["machine_id"] == machine_b_id
            assert report_b["sections"]  # non-empty deltas

            db_schema = _find_section(report_b, "db_schema")
            head_delta = _find_delta(db_schema, "alembic_head")
            assert head_delta["status"] == "changed"
            assert head_delta["severity"] == "critical"
            assert head_delta["expected"] == "rev_new"
            assert head_delta["actual"] == "rev_old"

            # A's services.redis is removed on B → critical.
            services = _find_section(report_b, "services")
            redis_delta = _find_delta(services, "redis")
            assert redis_delta["status"] == "removed"
            assert redis_delta["severity"] == "critical"

            # Secret backstop holds across the wire: env_contract shows the
            # API_KEY that A has but B lacks as a removed "present" value —
            # never the raw secret.
            env_contract = _find_section(report_b, "env_contract")
            api_key_delta = _find_delta(env_contract, "API_KEY")
            assert api_key_delta["status"] == "removed"
            assert api_key_delta["expected"] == "present"
            assert "abc123" not in r.text
            assert "topsecret" not in r.text

            # 5b. Single-machine drift for B returns B's full report.
            r = await client.get(
                f"{API_PREFIX}/environments/{env_id}/drift/{machine_b_id}"
            )
            assert r.status_code == 200, r.text
            single = r.json()
            assert single["machine_id"] == machine_b_id
            assert single["severity"] == "critical"
            assert single["in_sync"] is False
            assert single["has_config"] is True

            # 5c. Single-machine drift for A vs itself (canonical) → in sync.
            r = await client.get(
                f"{API_PREFIX}/environments/{env_id}/drift/{machine_a_id}"
            )
            assert r.status_code == 200, r.text
            assert r.json()["in_sync"] is True

    @pytest.mark.asyncio
    async def test_drift_requires_canonical(
        self, async_db_session: AsyncSession, test_user
    ) -> None:
        """Drift with no canonical machine set → 422."""
        app = _build_app(db_session=async_db_session, user=test_user)
        async with _client(app) as client:
            r = await client.post(
                f"{API_PREFIX}/environments",
                json={"name": "NoCanon", "description": None},
            )
            assert r.status_code == 201, r.text
            env_id = r.json()["id"]

            r = await client.get(f"{API_PREFIX}/environments/{env_id}/drift")
            assert r.status_code == 422, r.text
            assert r.json()["detail"]["code"] == "no_canonical_machine"

    @pytest.mark.asyncio
    async def test_set_canonical_requires_config(
        self, async_db_session: AsyncSession, test_user
    ) -> None:
        """Setting canonical to a machine with no config → 409."""
        app = _build_app(db_session=async_db_session, user=test_user)
        async with _client(app) as client:
            r = await client.post(
                f"{API_PREFIX}/environments",
                json={"name": "EnvX", "description": None},
            )
            env_id = r.json()["id"]
            r = await client.post(
                f"{API_PREFIX}/machines", json={"name": "no-config-machine"}
            )
            machine_id = r.json()["id"]

            r = await client.put(
                f"{API_PREFIX}/environments/{env_id}/canonical",
                json={"machine_id": machine_id},
            )
            assert r.status_code == 409, r.text
            assert r.json()["detail"]["code"] == "machine_has_no_config"

    @pytest.mark.asyncio
    async def test_invalid_machine_key_rejected(
        self, async_db_session: AsyncSession, test_user
    ) -> None:
        """Agent config push with a bad/missing key → 401."""
        app = _build_app(db_session=async_db_session, user=test_user)
        async with _client(app) as client:
            r = await client.post(
                f"{API_PREFIX}/environments",
                json={"name": "EnvAuth", "description": None},
            )
            env_id = r.json()["id"]

            # Malformed (no mk_ prefix).
            r = await client.put(
                f"{API_PREFIX}/agent/environments/{env_id}/config",
                json=_config_body({"services": {"a": "1"}}),
                headers={"X-Machine-Key": "not-a-real-key"},
            )
            assert r.status_code == 401, r.text

            # Well-formed prefix but unknown key.
            r = await client.put(
                f"{API_PREFIX}/agent/environments/{env_id}/config",
                json=_config_body({"services": {"a": "1"}}),
                headers={"X-Machine-Key": "mk_" + "x" * 40},
            )
            assert r.status_code == 401, r.text

    @pytest.mark.asyncio
    async def test_revoked_machine_rejected(
        self, async_db_session: AsyncSession, test_user
    ) -> None:
        """A revoked machine's key is rejected on agent calls → 403/401."""
        app = _build_app(db_session=async_db_session, user=test_user)
        async with _client(app) as client:
            r = await client.post(
                f"{API_PREFIX}/environments",
                json={"name": "EnvRevoke", "description": None},
            )
            env_id = r.json()["id"]
            r = await client.post(f"{API_PREFIX}/machines", json={"name": "revoke-me"})
            body = r.json()
            machine_id = body["id"]
            code = body["enrollment_code"]

            r = await client.post(
                f"{API_PREFIX}/agent/enroll",
                json={"enrollment_code": code, "machine_id": machine_id},
            )
            key = r.json()["machine_key"]

            # Revoke it.
            r = await client.post(f"{API_PREFIX}/machines/{machine_id}/revoke")
            assert r.status_code == 200, r.text
            assert r.json()["revoked"] is True

            # The key no longer authenticates. revoke_machine() clears the
            # key_hash, so the lookup misses entirely → 401 (revoked machines
            # whose hash survived would be 403; either way: not authorized).
            r = await client.put(
                f"{API_PREFIX}/agent/environments/{env_id}/config",
                json=_config_body({"services": {"a": "1"}}),
                headers={"X-Machine-Key": key},
            )
            assert r.status_code in (401, 403), r.text

    @pytest.mark.asyncio
    async def test_enroll_machine_id_mismatch(
        self, async_db_session: AsyncSession, test_user
    ) -> None:
        """Enrolling with a mismatched machine_id → 409."""
        app = _build_app(db_session=async_db_session, user=test_user)
        async with _client(app) as client:
            r = await client.post(f"{API_PREFIX}/machines", json={"name": "bind-check"})
            code = r.json()["enrollment_code"]

            r = await client.post(
                f"{API_PREFIX}/agent/enroll",
                json={
                    "enrollment_code": code,
                    "machine_id": str(uuid4()),  # wrong machine
                },
            )
            assert r.status_code == 409, r.text
            assert r.json()["detail"]["code"] == "machine_id_mismatch"

    @pytest.mark.asyncio
    async def test_enroll_persists_coord_device_id(
        self, async_db_session: AsyncSession, test_user
    ) -> None:
        """Enrolling with a coord_device_id persists the P3 coord bridge."""
        app = _build_app(db_session=async_db_session, user=test_user)
        coord_device_id = str(uuid4())
        async with _client(app) as client:
            r = await client.post(
                f"{API_PREFIX}/machines", json={"name": "coord-bridged"}
            )
            assert r.status_code == 201, r.text
            body = r.json()
            machine_id = body["id"]
            # Unbridged at create.
            assert body["coord_device_id"] is None

            r = await client.post(
                f"{API_PREFIX}/agent/enroll",
                json={
                    "enrollment_code": body["enrollment_code"],
                    "machine_id": machine_id,
                    "coord_device_id": coord_device_id,
                },
            )
            assert r.status_code == 200, r.text

            # The owner read surface exposes the persisted bridge.
            r = await client.get(f"{API_PREFIX}/machines/{machine_id}")
            assert r.status_code == 200, r.text
            assert r.json()["coord_device_id"] == coord_device_id

    @pytest.mark.asyncio
    async def test_cross_owner_isolation(
        self, async_db_session: AsyncSession, test_user, second_user
    ) -> None:
        """A second user cannot see the first user's environment → 404."""
        # User 1 creates an environment.
        app1 = _build_app(db_session=async_db_session, user=test_user)
        async with _client(app1) as client:
            r = await client.post(
                f"{API_PREFIX}/environments",
                json={"name": "PrivateEnv", "description": None},
            )
            assert r.status_code == 201, r.text
            env_id = r.json()["id"]

        # User 2 (same DB session, different identity) cannot read it.
        app2 = _build_app(db_session=async_db_session, user=second_user)
        async with _client(app2) as client:
            r = await client.get(f"{API_PREFIX}/environments/{env_id}")
            assert r.status_code == 404, r.text
            assert r.json()["detail"]["code"] == "environment_not_found"


# ---------------------------------------------------------------------------
# Layer 2 helpers (operate on JSON dicts, not pydantic models)
# ---------------------------------------------------------------------------


def _find_section(report: dict, name: str) -> dict:
    """Return the section dict named ``name`` from a JSON drift report."""
    for sec in report["sections"]:
        if sec["section"] == name:
            return sec
    raise AssertionError(f"section {name!r} not in report sections")


def _find_delta(section: dict, key: str) -> dict:
    """Return the delta dict for ``key`` within a JSON section."""
    for delta in section["deltas"]:
        if delta["key"] == key:
            return delta
    raise AssertionError(f"key {key!r} not in section {section['section']!r}")


class TestDevenvMachineEnvBinding:
    """Phase 2 P1 — explicit machine→environment binding."""

    @pytest.mark.asyncio
    async def test_create_machine_with_environment_binds(
        self, async_db_session: AsyncSession, test_user
    ) -> None:
        app = _build_app(db_session=async_db_session, user=test_user)
        async with _client(app) as client:
            r = await client.post(
                f"{API_PREFIX}/environments",
                json={"name": "env-1", "description": None},
            )
            env_id = r.json()["id"]

            r = await client.post(
                f"{API_PREFIX}/machines",
                json={"name": "bound-machine", "environment_id": env_id},
            )
            assert r.status_code == 201, r.text
            assert r.json()["environment_id"] == env_id

    @pytest.mark.asyncio
    async def test_create_machine_with_foreign_environment_404(
        self, async_db_session: AsyncSession, test_user
    ) -> None:
        app = _build_app(db_session=async_db_session, user=test_user)
        async with _client(app) as client:
            r = await client.post(
                f"{API_PREFIX}/machines",
                json={"name": "m", "environment_id": str(uuid4())},
            )
            assert r.status_code == 404, r.text
            assert r.json()["detail"]["code"] == "environment_not_found"

    @pytest.mark.asyncio
    async def test_set_machine_environment_rebind_and_unbind(
        self, async_db_session: AsyncSession, test_user
    ) -> None:
        app = _build_app(db_session=async_db_session, user=test_user)
        async with _client(app) as client:
            r = await client.post(
                f"{API_PREFIX}/environments",
                json={"name": "env-a", "description": None},
            )
            env_id = r.json()["id"]
            r = await client.post(f"{API_PREFIX}/machines", json={"name": "rebind-me"})
            machine_id = r.json()["id"]
            assert r.json()["environment_id"] is None

            # Bind.
            r = await client.put(
                f"{API_PREFIX}/machines/{machine_id}/environment",
                json={"environment_id": env_id},
            )
            assert r.status_code == 200, r.text
            assert r.json()["environment_id"] == env_id

            # Unbind (null).
            r = await client.put(
                f"{API_PREFIX}/machines/{machine_id}/environment",
                json={"environment_id": None},
            )
            assert r.status_code == 200, r.text
            assert r.json()["environment_id"] is None

    @pytest.mark.asyncio
    async def test_enroll_honors_explicit_binding_over_multi_env(
        self, async_db_session: AsyncSession, test_user
    ) -> None:
        """With MULTIPLE environments the v1 auto-bind returns None; an
        explicit binding must still resolve deterministically at enroll."""
        app = _build_app(db_session=async_db_session, user=test_user)
        async with _client(app) as client:
            r = await client.post(
                f"{API_PREFIX}/environments",
                json={"name": "env-1", "description": None},
            )
            assert r.status_code == 201, r.text
            r = await client.post(
                f"{API_PREFIX}/environments",
                json={"name": "env-2", "description": None},
            )
            env2_id = r.json()["id"]

            r = await client.post(
                f"{API_PREFIX}/machines",
                json={"name": "explicit", "environment_id": env2_id},
            )
            machine_id = r.json()["id"]
            code = r.json()["enrollment_code"]

            r = await client.post(
                f"{API_PREFIX}/agent/enroll",
                json={"enrollment_code": code, "machine_id": machine_id},
            )
            assert r.status_code == 200, r.text
            # Two envs exist, so the v1 heuristic would bind None — the explicit
            # binding wins.
            assert r.json()["environment_id"] == env2_id


class TestDispatchEnroll:
    """Phase 3 — POST /machines/dispatch-enroll creates a machine, binds it to
    the chosen coord device, and dispatches an enroll directive via coord."""

    @pytest.mark.asyncio
    async def test_dispatch_success(
        self, async_db_session: AsyncSession, test_user, monkeypatch
    ) -> None:
        app = _build_app(db_session=async_db_session, user=test_user)
        captured: dict = {}

        async def _fake_post(path, *, headers, json_body, log_event, **kw):
            captured["path"] = path
            captured["body"] = json_body
            return httpx.Response(200, json={"dispatched": True})

        monkeypatch.setattr("app.api.v1.endpoints.devenv.post_to_coord", _fake_post)
        device_id = await _mk_coord_device(async_db_session, user_id=test_user.id)
        async with _client(app) as client:
            r = await client.post(
                f"{API_PREFIX}/machines/dispatch-enroll",
                json={"name": "dispatch-me", "target_device_id": device_id},
            )
        assert r.status_code == 201, r.text
        body = r.json()
        assert body["dispatched"] is True
        machine = body["machine"]
        # Machine created with a one-time code, bound to the chosen device.
        assert machine["enrollment_code"]
        assert machine["coord_device_id"] == device_id
        assert "machine_key" not in machine and "key_hash" not in machine
        # Coord received the correct directive.
        assert captured["path"] == "/devenv/enroll-dispatch"
        assert captured["body"]["target_device_id"] == device_id
        assert captured["body"]["enrollment_code"] == machine["enrollment_code"]
        assert captured["body"]["machine_id"] == machine["id"]
        assert machine["enrollment_origin"] == "dispatched"

    @pytest.mark.asyncio
    async def test_dashboard_created_machine_is_stamped_manual(
        self, async_db_session: AsyncSession, test_user
    ) -> None:
        """The other existing writer stamps its own origin.

        Both writers stamp at creation so every row created from devenv_09
        onward has honest provenance; only rows that PREDATE the column carry
        NULL, which must read as "unknown" rather than being backfilled with a
        guess.
        """
        app = _build_app(db_session=async_db_session, user=test_user)
        async with _client(app) as client:
            r = await client.post(
                f"{API_PREFIX}/machines", json={"name": "manual-origin-box"}
            )
        assert r.status_code == 201, r.text
        assert r.json()["enrollment_origin"] == "manual"

    @pytest.mark.asyncio
    async def test_dispatch_rejection_still_creates_machine(
        self, async_db_session: AsyncSession, test_user, monkeypatch
    ) -> None:
        app = _build_app(db_session=async_db_session, user=test_user)

        async def _fake_post(path, *, headers, json_body, log_event, **kw):
            return httpx.Response(400, json={"error": "unknown device"})

        monkeypatch.setattr("app.api.v1.endpoints.devenv.post_to_coord", _fake_post)
        device_id = await _mk_coord_device(async_db_session, user_id=test_user.id)
        async with _client(app) as client:
            r = await client.post(
                f"{API_PREFIX}/machines/dispatch-enroll",
                json={"name": "offline-box", "target_device_id": device_id},
            )
        # The machine + code are still created (copy-paste fallback), dispatch soft-fails.
        assert r.status_code == 201, r.text
        body = r.json()
        assert body["dispatched"] is False
        assert body["detail"]
        assert body["machine"]["enrollment_code"]

    # -- socket-first transport (plan 2026-08-05, decision 1B) ---------------
    #
    # When the device is connected, the directive goes down the device socket
    # web already holds instead of the coord hop. ``dispatched`` must keep the
    # same meaning on both paths so the dashboard needs no change.

    @staticmethod
    def _patch_socket(monkeypatch, *, connected: bool, sent: bool, captured: dict):
        """Point devenv's socket path at a stub manager."""

        class _Manager:
            async def is_connected_redis(self, device_id):
                captured["checked"] = str(device_id)
                return connected

            async def send_devenv_enroll(
                self, device_id, payload, *, require_local_connection=True
            ):
                captured["sent_to"] = str(device_id)
                captured["payload"] = payload
                captured["require_local_connection"] = require_local_connection
                return sent

        async def _fake_redis():
            return object()

        async def _fake_manager(_redis):
            return _Manager()

        monkeypatch.setattr("app.api.v1.endpoints.devenv.get_redis", _fake_redis)
        monkeypatch.setattr(
            "app.api.v1.endpoints.devenv.get_runner_websocket_manager", _fake_manager
        )

    @pytest.mark.asyncio
    async def test_dispatch_prefers_socket_when_device_connected(
        self, async_db_session: AsyncSession, test_user, monkeypatch
    ) -> None:
        """A connected device gets the directive on its own socket, not via coord."""
        app = _build_app(db_session=async_db_session, user=test_user)
        captured: dict = {}
        coord_calls: list = []

        async def _fake_post(path, *, headers, json_body, log_event, **kw):
            coord_calls.append(path)
            return httpx.Response(200, json={"dispatched": True})

        monkeypatch.setattr("app.api.v1.endpoints.devenv.post_to_coord", _fake_post)
        self._patch_socket(monkeypatch, connected=True, sent=True, captured=captured)

        device_id = await _mk_coord_device(async_db_session, user_id=test_user.id)
        async with _client(app) as client:
            r = await client.post(
                f"{API_PREFIX}/machines/dispatch-enroll",
                json={"name": "socket-box", "target_device_id": device_id},
            )

        assert r.status_code == 201, r.text
        body = r.json()
        # Identical `dispatched` semantics — the dashboard cannot tell which
        # transport carried it, which is the point.
        assert body["dispatched"] is True
        machine = body["machine"]
        # Provenance describes WHO asked, not which wire carried it: an
        # operator-pushed machine is `dispatched` on both transports.
        assert machine["enrollment_origin"] == "dispatched"
        # The coord hop was NOT used.
        assert coord_calls == []
        # The socket carried the same directive fields coord's body carries.
        assert captured["sent_to"] == device_id
        assert captured["payload"]["machine_id"] == machine["id"]
        assert captured["payload"]["enrollment_code"] == machine["enrollment_code"]
        # Connectivity was confirmed cross-process, so the send must publish via
        # Redis rather than requiring the socket on THIS replica.
        assert captured["require_local_connection"] is False

    @pytest.mark.asyncio
    async def test_dispatch_falls_back_to_coord_when_not_connected(
        self, async_db_session: AsyncSession, test_user, monkeypatch
    ) -> None:
        """An offline device takes the shipped coord path, unchanged."""
        app = _build_app(db_session=async_db_session, user=test_user)
        captured: dict = {}
        coord_body: dict = {}

        async def _fake_post(path, *, headers, json_body, log_event, **kw):
            coord_body.update(json_body)
            return httpx.Response(200, json={"dispatched": True})

        monkeypatch.setattr("app.api.v1.endpoints.devenv.post_to_coord", _fake_post)
        self._patch_socket(monkeypatch, connected=False, sent=True, captured=captured)

        device_id = await _mk_coord_device(async_db_session, user_id=test_user.id)
        async with _client(app) as client:
            r = await client.post(
                f"{API_PREFIX}/machines/dispatch-enroll",
                json={"name": "offline-socket-box", "target_device_id": device_id},
            )

        assert r.status_code == 201, r.text
        assert r.json()["dispatched"] is True
        # No socket send was attempted; coord got the directive as before.
        assert "sent_to" not in captured
        assert coord_body["target_device_id"] == device_id

    @pytest.mark.asyncio
    async def test_dispatch_falls_back_when_socket_send_does_not_land(
        self, async_db_session: AsyncSession, test_user, monkeypatch
    ) -> None:
        """A connected-but-unreachable device must not silently lose the directive."""
        app = _build_app(db_session=async_db_session, user=test_user)
        captured: dict = {}
        coord_body: dict = {}

        async def _fake_post(path, *, headers, json_body, log_event, **kw):
            coord_body.update(json_body)
            return httpx.Response(200, json={"dispatched": True})

        monkeypatch.setattr("app.api.v1.endpoints.devenv.post_to_coord", _fake_post)
        self._patch_socket(monkeypatch, connected=True, sent=False, captured=captured)

        device_id = await _mk_coord_device(async_db_session, user_id=test_user.id)
        async with _client(app) as client:
            r = await client.post(
                f"{API_PREFIX}/machines/dispatch-enroll",
                json={"name": "half-open-box", "target_device_id": device_id},
            )

        assert r.status_code == 201, r.text
        assert r.json()["dispatched"] is True
        # The socket was tried, then coord picked it up.
        assert captured["sent_to"]
        assert coord_body["machine_id"]

    @pytest.mark.asyncio
    async def test_dispatch_falls_back_when_redis_unavailable(
        self, async_db_session: AsyncSession, test_user, monkeypatch
    ) -> None:
        """Redis being down is not a reason to fail an operator's dispatch."""
        app = _build_app(db_session=async_db_session, user=test_user)
        coord_body: dict = {}

        async def _fake_post(path, *, headers, json_body, log_event, **kw):
            coord_body.update(json_body)
            return httpx.Response(200, json={"dispatched": True})

        async def _boom():
            raise RuntimeError("redis unavailable")

        monkeypatch.setattr("app.api.v1.endpoints.devenv.post_to_coord", _fake_post)
        monkeypatch.setattr("app.api.v1.endpoints.devenv.get_redis", _boom)

        device_id = await _mk_coord_device(async_db_session, user_id=test_user.id)
        async with _client(app) as client:
            r = await client.post(
                f"{API_PREFIX}/machines/dispatch-enroll",
                json={"name": "no-redis-box", "target_device_id": device_id},
            )

        assert r.status_code == 201, r.text
        assert r.json()["dispatched"] is True
        assert coord_body["machine_id"]


class TestDispatchEnrollAuthorization:
    """``target_device_id`` must be a device the CALLER owns — on both transports.

    This route used to be authorized only by the transport it happened to take.
    coord's ``POST /devenv/enroll-dispatch`` sits behind ``require_role(admin)``,
    so while the coord hop was the only path, a non-admin could not reach anyone
    else's device through it. The socket transport has no such gate — web holds
    the device's socket itself — so trying the socket FIRST removed the only
    authorization there was: any signed-in user could name any CONNECTED device,
    get a machine row of their own bound to it, and receive that box's
    environment captures from then on.

    So the tests come in pairs: a non-owner must be refused BEFORE anything
    exists, on the socket path and on the coord path alike, and the owner must
    still succeed on both.
    """

    @pytest.mark.asyncio
    async def test_non_owner_cannot_dispatch_to_a_connected_device(
        self, async_db_session: AsyncSession, test_user, second_user, monkeypatch
    ) -> None:
        """The escalation itself: a connected device belonging to someone else."""
        app = _build_app(db_session=async_db_session, user=test_user)
        captured: dict = {}
        coord_calls: list = []

        async def _fake_post(path, *, headers, json_body, log_event, **kw):
            coord_calls.append(path)
            return httpx.Response(200, json={"dispatched": True})

        monkeypatch.setattr("app.api.v1.endpoints.devenv.post_to_coord", _fake_post)
        TestDispatchEnroll._patch_socket(
            monkeypatch, connected=True, sent=True, captured=captured
        )

        # The device is CONNECTED (so the socket path would have taken it) and
        # belongs to `second_user`, not the caller.
        victim_device = await _mk_coord_device(
            async_db_session, user_id=second_user.id, hostname="victim-box"
        )

        async with _client(app) as client:
            r = await client.post(
                f"{API_PREFIX}/machines/dispatch-enroll",
                json={"name": "steal-me", "target_device_id": victim_device},
            )

        # 404, not 403 — cross-owner ids never leak existence in this module.
        assert r.status_code == 404, r.text
        assert r.json()["detail"]["code"] == "device_not_found"
        # Nothing was dispatched on EITHER transport...
        assert captured == {}
        assert coord_calls == []
        # ...and no machine row was created for the caller.
        from sqlalchemy import select as _select

        from app.models.devenv import Machine as _Machine

        rows = (
            (
                await async_db_session.execute(
                    _select(_Machine.id).where(
                        _Machine.owner_user_id == test_user.id,
                        _Machine.coord_device_id == UUID(victim_device),
                    )
                )
            )
            .scalars()
            .all()
        )
        assert list(rows) == []

    @pytest.mark.asyncio
    async def test_non_owner_is_refused_on_the_coord_path_too(
        self, async_db_session: AsyncSession, test_user, second_user, monkeypatch
    ) -> None:
        """The gate is before the transport choice, not inside one branch.

        With the device OFFLINE the socket arm is skipped entirely, so this is
        the arm that used to be protected by coord's admin role. It must now be
        refused by web itself, without ever asking coord.
        """
        app = _build_app(db_session=async_db_session, user=test_user)
        captured: dict = {}
        coord_calls: list = []

        async def _fake_post(path, *, headers, json_body, log_event, **kw):
            coord_calls.append(path)
            return httpx.Response(200, json={"dispatched": True})

        monkeypatch.setattr("app.api.v1.endpoints.devenv.post_to_coord", _fake_post)
        TestDispatchEnroll._patch_socket(
            monkeypatch, connected=False, sent=True, captured=captured
        )

        victim_device = await _mk_coord_device(
            async_db_session, user_id=second_user.id, hostname="offline-victim"
        )
        async with _client(app) as client:
            r = await client.post(
                f"{API_PREFIX}/machines/dispatch-enroll",
                json={"name": "steal-me-too", "target_device_id": victim_device},
            )

        assert r.status_code == 404, r.text
        assert coord_calls == []
        assert captured == {}

    @pytest.mark.asyncio
    async def test_unknown_device_is_also_a_404(
        self, async_db_session: AsyncSession, test_user, monkeypatch
    ) -> None:
        """A device id with no row reads identically to someone else's."""
        app = _build_app(db_session=async_db_session, user=test_user)

        async def _fake_post(path, *, headers, json_body, log_event, **kw):
            raise AssertionError("coord must not be reached")

        monkeypatch.setattr("app.api.v1.endpoints.devenv.post_to_coord", _fake_post)
        async with _client(app) as client:
            r = await client.post(
                f"{API_PREFIX}/machines/dispatch-enroll",
                json={"name": "ghost-box", "target_device_id": str(uuid4())},
            )
        assert r.status_code == 404, r.text
        assert r.json()["detail"]["code"] == "device_not_found"

    @pytest.mark.asyncio
    async def test_owner_still_succeeds_on_the_socket_transport(
        self, async_db_session: AsyncSession, test_user, monkeypatch
    ) -> None:
        """Control: the gate admits the owner, so the refusals mean something."""
        app = _build_app(db_session=async_db_session, user=test_user)
        captured: dict = {}

        async def _fake_post(path, *, headers, json_body, log_event, **kw):
            raise AssertionError("the socket path should have returned first")

        monkeypatch.setattr("app.api.v1.endpoints.devenv.post_to_coord", _fake_post)
        TestDispatchEnroll._patch_socket(
            monkeypatch, connected=True, sent=True, captured=captured
        )

        device_id = await _mk_coord_device(
            async_db_session, user_id=test_user.id, hostname="my-connected-box"
        )
        async with _client(app) as client:
            r = await client.post(
                f"{API_PREFIX}/machines/dispatch-enroll",
                json={"name": "my-socket-box", "target_device_id": device_id},
            )

        assert r.status_code == 201, r.text
        assert r.json()["dispatched"] is True
        assert captured["sent_to"] == device_id

    @pytest.mark.asyncio
    async def test_owner_still_succeeds_on_the_coord_transport(
        self, async_db_session: AsyncSession, test_user, monkeypatch
    ) -> None:
        """Control for the offline arm."""
        app = _build_app(db_session=async_db_session, user=test_user)
        coord_body: dict = {}

        async def _fake_post(path, *, headers, json_body, log_event, **kw):
            coord_body.update(json_body)
            return httpx.Response(200, json={"dispatched": True})

        monkeypatch.setattr("app.api.v1.endpoints.devenv.post_to_coord", _fake_post)
        TestDispatchEnroll._patch_socket(
            monkeypatch, connected=False, sent=True, captured={}
        )

        device_id = await _mk_coord_device(
            async_db_session, user_id=test_user.id, hostname="my-offline-box"
        )
        async with _client(app) as client:
            r = await client.post(
                f"{API_PREFIX}/machines/dispatch-enroll",
                json={"name": "my-coord-box", "target_device_id": device_id},
            )

        assert r.status_code == 201, r.text
        assert r.json()["dispatched"] is True
        assert coord_body["target_device_id"] == device_id


class TestOneLiveMachinePerDeviceIsA409:
    """``devenv_10``'s unique index must never surface as an untyped 500.

    Three shipped writers can breach ``uq_devenv_machine_active_coord_device``,
    and none of them handled ``IntegrityError``: the violation was an untyped
    500 on a poisoned transaction. Each is asserted here to answer **409 with
    the typed ``device_already_has_machine`` code** instead, because a caller
    can act on that and cannot act on a 500.
    """

    @pytest.mark.asyncio
    async def test_agent_enroll_when_the_box_beat_the_human(
        self, async_db_session: AsyncSession, test_user
    ) -> None:
        """The likely one, and with auto-enroll on it is the NORMAL ordering.

        The owner creates a machine by hand (no ``coord_device_id``); before
        they paste the one-liner, the box connects and the engine creates its
        own row bound to that device. Consuming the hand-made code then tries to
        bind a SECOND live row to the same device.
        """
        from app.models.devenv import Machine

        app = _build_app(db_session=async_db_session, user=test_user)
        device_id = await _mk_coord_device(
            async_db_session, user_id=test_user.id, hostname="raced-box"
        )

        async with _client(app) as client:
            r = await client.post(
                f"{API_PREFIX}/machines", json={"name": "manual-first"}
            )
            assert r.status_code == 201, r.text
            code = r.json()["enrollment_code"]

            # The engine gets there first.
            auto = Machine(
                owner_user_id=test_user.id,
                name="auto-created",
                hostname="raced-box",
                coord_device_id=UUID(device_id),
                enrollment_origin="auto",
            )
            async_db_session.add(auto)
            await async_db_session.flush()

            r = await client.post(
                f"{API_PREFIX}/agent/enroll",
                json={"enrollment_code": code, "coord_device_id": device_id},
            )

        assert r.status_code == 409, r.text
        assert r.json()["detail"]["code"] == "device_already_has_machine"

    @pytest.mark.asyncio
    async def test_agent_reenroll_of_the_same_device_is_not_a_conflict(
        self, async_db_session: AsyncSession, test_user
    ) -> None:
        """Control: rotating a machine's OWN binding stays a 200.

        Without this, the pre-check could be "any live row for this device
        conflicts", which would break the ordinary re-enroll of the very
        machine that owns the device.
        """
        app = _build_app(db_session=async_db_session, user=test_user)
        device_id = await _mk_coord_device(
            async_db_session, user_id=test_user.id, hostname="rotating-box"
        )

        async with _client(app) as client:
            r = await client.post(f"{API_PREFIX}/machines", json={"name": "rotate-me"})
            assert r.status_code == 201, r.text
            machine_id = r.json()["id"]
            code = r.json()["enrollment_code"]
            r = await client.post(
                f"{API_PREFIX}/agent/enroll",
                json={"enrollment_code": code, "coord_device_id": device_id},
            )
            assert r.status_code == 200, r.text

            # Re-mint and enroll again, same device.
            r = await client.post(
                f"{API_PREFIX}/machines/{machine_id}/regenerate-enrollment"
            )
            assert r.status_code == 200, r.text
            r = await client.post(
                f"{API_PREFIX}/agent/enroll",
                json={
                    "enrollment_code": r.json()["enrollment_code"],
                    "coord_device_id": device_id,
                },
            )
        assert r.status_code == 200, r.text

    @pytest.mark.asyncio
    async def test_dispatch_to_a_device_that_already_has_a_machine(
        self, async_db_session: AsyncSession, test_user, monkeypatch
    ) -> None:
        """The operator dispatch path — a 409, not a 500 mid-contract.

        The route's documented contract is "the machine + code are ALWAYS
        created and returned"; it cannot honor that for a device that already
        has a live row, so it must say so in the answer rather than blow up
        after the bind.
        """
        from app.models.devenv import Machine

        app = _build_app(db_session=async_db_session, user=test_user)

        async def _fake_post(path, *, headers, json_body, log_event, **kw):
            raise AssertionError("must be refused before any dispatch")

        monkeypatch.setattr("app.api.v1.endpoints.devenv.post_to_coord", _fake_post)
        device_id = await _mk_coord_device(
            async_db_session, user_id=test_user.id, hostname="taken-box"
        )
        async_db_session.add(
            Machine(
                owner_user_id=test_user.id,
                name="already-here",
                hostname="taken-box",
                coord_device_id=UUID(device_id),
                enrollment_origin="auto",
            )
        )
        await async_db_session.flush()

        async with _client(app) as client:
            r = await client.post(
                f"{API_PREFIX}/machines/dispatch-enroll",
                json={"name": "second-row", "target_device_id": device_id},
            )

        assert r.status_code == 409, r.text
        assert r.json()["detail"]["code"] == "device_already_has_machine"

    @pytest.mark.asyncio
    async def test_regenerate_cannot_unrevoke_over_a_live_successor(
        self, async_db_session: AsyncSession, test_user
    ) -> None:
        """The sharpest one: revoke + regenerate IS the reversibility story.

        ``regenerate_enrollment`` clears ``revoked_at`` unconditionally. The
        partial index deliberately lets a revoked row sit out of the way, so the
        device can (and with auto-enroll on, does) acquire a NEW live row —
        un-revoking the old one then makes two live rows for one device.
        """
        from app.models.devenv import Machine

        app = _build_app(db_session=async_db_session, user=test_user)
        device_id = await _mk_coord_device(
            async_db_session, user_id=test_user.id, hostname="reversible-box"
        )

        async with _client(app) as client:
            r = await client.post(
                f"{API_PREFIX}/machines", json={"name": "the-old-one"}
            )
            assert r.status_code == 201, r.text
            old_id = r.json()["id"]
            code = r.json()["enrollment_code"]
            r = await client.post(
                f"{API_PREFIX}/agent/enroll",
                json={"enrollment_code": code, "coord_device_id": device_id},
            )
            assert r.status_code == 200, r.text

            # The owner revokes it — the documented one-click undo.
            r = await client.post(f"{API_PREFIX}/machines/{old_id}/revoke")
            assert r.status_code == 200, r.text

            # The box reconnects and the engine gives it a fresh row.
            async_db_session.add(
                Machine(
                    owner_user_id=test_user.id,
                    name="the-new-one",
                    hostname="reversible-box",
                    coord_device_id=UUID(device_id),
                    enrollment_origin="auto",
                )
            )
            await async_db_session.flush()

            r = await client.post(
                f"{API_PREFIX}/machines/{old_id}/regenerate-enrollment"
            )

        assert r.status_code == 409, r.text
        assert r.json()["detail"]["code"] == "device_already_has_machine"

    @pytest.mark.asyncio
    async def test_regenerate_on_an_unrevoked_machine_is_unaffected(
        self, async_db_session: AsyncSession, test_user
    ) -> None:
        """Control: the ordinary rotate path keeps working."""
        app = _build_app(db_session=async_db_session, user=test_user)
        device_id = await _mk_coord_device(
            async_db_session, user_id=test_user.id, hostname="plain-rotate-box"
        )
        async with _client(app) as client:
            r = await client.post(f"{API_PREFIX}/machines", json={"name": "plain-box"})
            machine_id = r.json()["id"]
            code = r.json()["enrollment_code"]
            r = await client.post(
                f"{API_PREFIX}/agent/enroll",
                json={"enrollment_code": code, "coord_device_id": device_id},
            )
            assert r.status_code == 200, r.text
            r = await client.post(
                f"{API_PREFIX}/machines/{machine_id}/regenerate-enrollment"
            )
        assert r.status_code == 200, r.text
        assert r.json()["enrollment_code"]


class TestDispatchReposApply:
    """P4 — POST /machines/{id}/repos-apply-dispatch asks a machine's runner to
    reconcile its cloned repositories. The server REQUESTS; the box DECIDES."""

    @pytest.mark.asyncio
    async def test_dispatch_forwards_the_device_and_confirm_flag(
        self, async_db_session: AsyncSession, test_user, monkeypatch
    ) -> None:
        app = _build_app(db_session=async_db_session, user=test_user)
        captured: dict = {}

        async def _fake_post(path, *, headers, json_body, log_event, **kw):
            captured["path"] = path
            captured["body"] = json_body
            return httpx.Response(200, json={"dispatched": True})

        monkeypatch.setattr("app.api.v1.endpoints.devenv.post_to_coord", _fake_post)
        device_id = await _mk_coord_device(async_db_session, user_id=test_user.id)
        async with _client(app) as client:
            r = await client.post(
                f"{API_PREFIX}/machines/dispatch-enroll",
                json={"name": "repos-box", "target_device_id": device_id},
            )
            machine_id = r.json()["machine"]["id"]

            r = await client.post(
                f"{API_PREFIX}/machines/{machine_id}/repos-apply-dispatch",
                json={"confirm": True},
            )

        assert r.status_code == 200, r.text
        assert r.json() == {"dispatched": True, "confirm": True, "detail": None}
        assert captured["path"] == "/devenv/repos-apply-dispatch"
        assert captured["body"] == {
            "target_device_id": device_id,
            "confirm": True,
        }

    @pytest.mark.asyncio
    async def test_an_omitted_confirm_dispatches_a_dry_run(
        self, async_db_session: AsyncSession, test_user, monkeypatch
    ) -> None:
        """An omitted ``confirm`` must reach coord as ``false``.

        Defence in depth with the runner's own default: a request that forgets
        the field asks for a plan, never for mutation of someone's disk.
        """
        app = _build_app(db_session=async_db_session, user=test_user)
        captured: dict = {}

        async def _fake_post(path, *, headers, json_body, log_event, **kw):
            captured["body"] = json_body
            return httpx.Response(200, json={"dispatched": True})

        monkeypatch.setattr("app.api.v1.endpoints.devenv.post_to_coord", _fake_post)
        device_id = await _mk_coord_device(async_db_session, user_id=test_user.id)
        async with _client(app) as client:
            r = await client.post(
                f"{API_PREFIX}/machines/dispatch-enroll",
                json={"name": "dryrun-box", "target_device_id": device_id},
            )
            machine_id = r.json()["machine"]["id"]
            r = await client.post(
                f"{API_PREFIX}/machines/{machine_id}/repos-apply-dispatch", json={}
            )

        assert r.status_code == 200, r.text
        assert captured["body"]["confirm"] is False
        assert r.json()["confirm"] is False

    @pytest.mark.asyncio
    async def test_an_unpaired_machine_is_a_conflict_not_a_soft_failure(
        self, async_db_session: AsyncSession, test_user, monkeypatch
    ) -> None:
        """No bound coord device means there is no runner to ask.

        A retry cannot fix that, so it must not return ``dispatched: false``
        (which invites one) — it is a precondition failure.
        """
        app = _build_app(db_session=async_db_session, user=test_user)

        async def _unreachable(*a, **kw):  # pragma: no cover - must not be called
            raise AssertionError("coord must not be called for an unpaired machine")

        monkeypatch.setattr("app.api.v1.endpoints.devenv.post_to_coord", _unreachable)
        async with _client(app) as client:
            r = await client.post(f"{API_PREFIX}/machines", json={"name": "unpaired"})
            machine_id = r.json()["id"]
            r = await client.post(
                f"{API_PREFIX}/machines/{machine_id}/repos-apply-dispatch", json={}
            )

        assert r.status_code == 409, r.text
        assert r.json()["detail"]["code"] == "machine_not_paired"

    @pytest.mark.asyncio
    async def test_coord_rejection_is_a_soft_failure(
        self, async_db_session: AsyncSession, test_user, monkeypatch
    ) -> None:
        app = _build_app(db_session=async_db_session, user=test_user)
        calls: list[str] = []

        async def _fake_post(path, *, headers, json_body, log_event, **kw):
            calls.append(path)
            # First call is the enroll dispatch; the second is ours.
            if path == "/devenv/repos-apply-dispatch":
                return httpx.Response(400, json={"error": "unknown device"})
            return httpx.Response(200, json={"dispatched": True})

        monkeypatch.setattr("app.api.v1.endpoints.devenv.post_to_coord", _fake_post)
        device_id = await _mk_coord_device(async_db_session, user_id=test_user.id)
        async with _client(app) as client:
            r = await client.post(
                f"{API_PREFIX}/machines/dispatch-enroll",
                json={"name": "rejecting-box", "target_device_id": device_id},
            )
            machine_id = r.json()["machine"]["id"]
            r = await client.post(
                f"{API_PREFIX}/machines/{machine_id}/repos-apply-dispatch", json={}
            )

        assert r.status_code == 200, r.text
        assert r.json()["dispatched"] is False
        assert r.json()["detail"]

    @pytest.mark.asyncio
    async def test_another_owners_machine_is_404(
        self, async_db_session: AsyncSession, test_user, monkeypatch
    ) -> None:
        app = _build_app(db_session=async_db_session, user=test_user)

        async def _unreachable(*a, **kw):  # pragma: no cover - must not be called
            raise AssertionError("coord must not be called for a foreign machine")

        monkeypatch.setattr("app.api.v1.endpoints.devenv.post_to_coord", _unreachable)
        async with _client(app) as client:
            r = await client.post(
                f"{API_PREFIX}/machines/{uuid4()}/repos-apply-dispatch", json={}
            )
        assert r.status_code == 404, r.text
        assert r.json()["detail"]["code"] == "machine_not_found"


async def _new_user(db: AsyncSession, label: str):
    """Create + persist a real ``auth.users`` row (devenv FKs require one)."""
    from app.models.user import User

    user = User(
        email=f"{label}_{uuid4()}@example.com",
        username=f"{label}_{uuid4().hex[:8]}",
        full_name=f"{label} user",
        is_active=True,
        is_verified=True,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


async def _new_org(db: AsyncSession, owner):
    """Create an ``auth.organizations`` row owned by ``owner``."""
    from app.models.organization import Organization

    org = Organization(
        name=f"Org {uuid4().hex[:8]}",
        slug=f"org-{uuid4().hex[:12]}",
        owner_id=owner.id,
        settings={},
        is_active=True,
    )
    db.add(org)
    await db.commit()
    await db.refresh(org)
    return org


async def _add_member(db: AsyncSession, org, user, role: str) -> None:
    """Add a ``auth.team_members`` row (org, user, role)."""
    from app.models.organization import TeamMember

    db.add(
        TeamMember(
            organization_id=org.id,
            user_id=user.id,
            role=role,
            permissions={},
        )
    )
    await db.commit()


class TestOrgSharing:
    """P4 — org/team sharing of environments via ``organization_id``.

    Org + membership rows are created directly through the models (no need
    to drive the org endpoints). The devenv access model under test:
    owner/admin/member → edit, viewer → view-only (403 ``read_only_access``
    on edit routes), helper → no devenv access (404), non-member → 404.
    Sharing/unsharing itself is owner-only.
    """

    async def _seed_shared_env(
        self, db: AsyncSession, owner, *, role_members: dict | None = None
    ) -> tuple[object, str]:
        """Create an org (owner enrolled with role ``owner``) + a shared env.

        ``role_members`` maps user -> role for extra memberships. Returns
        ``(org, env_id)``.
        """
        org = await _new_org(db, owner)
        await _add_member(db, org, owner, "owner")
        for user, role in (role_members or {}).items():
            await _add_member(db, org, user, role)

        app = _build_app(db_session=db, user=owner)
        async with _client(app) as client:
            r = await client.post(
                f"{API_PREFIX}/environments",
                json={"name": f"Shared-{uuid4().hex[:8]}", "description": None},
            )
            assert r.status_code == 201, r.text
            env_id = r.json()["id"]
            r = await client.patch(
                f"{API_PREFIX}/environments/{env_id}",
                json={"organization_id": str(org.id)},
            )
            assert r.status_code == 200, r.text
            assert r.json()["organization_id"] == str(org.id)
        return org, env_id

    @pytest.mark.asyncio
    async def test_shared_env_visible_to_member(
        self, async_db_session: AsyncSession, test_user, second_user
    ) -> None:
        """An org-shared env is readable + listed for a ``member``."""
        _org, env_id = await self._seed_shared_env(
            async_db_session, test_user, role_members={second_user: "member"}
        )
        app2 = _build_app(db_session=async_db_session, user=second_user)
        async with _client(app2) as client:
            r = await client.get(f"{API_PREFIX}/environments/{env_id}")
            assert r.status_code == 200, r.text
            body = r.json()
            assert body["owner_user_id"] == str(test_user.id)
            r = await client.get(f"{API_PREFIX}/environments")
            assert env_id in {e["id"] for e in r.json()}

    @pytest.mark.asyncio
    async def test_not_visible_to_non_member(
        self, async_db_session: AsyncSession, test_user, second_user
    ) -> None:
        """A user outside the org gets the never-leak 404."""
        _org, env_id = await self._seed_shared_env(async_db_session, test_user)
        app2 = _build_app(db_session=async_db_session, user=second_user)
        async with _client(app2) as client:
            r = await client.get(f"{API_PREFIX}/environments/{env_id}")
            assert r.status_code == 404, r.text
            assert r.json()["detail"]["code"] == "environment_not_found"

    @pytest.mark.asyncio
    async def test_helper_gets_nothing(
        self, async_db_session: AsyncSession, test_user, second_user
    ) -> None:
        """``helper`` has no devenv access at all — same 404 as a non-member."""
        _org, env_id = await self._seed_shared_env(
            async_db_session, test_user, role_members={second_user: "helper"}
        )
        app2 = _build_app(db_session=async_db_session, user=second_user)
        async with _client(app2) as client:
            r = await client.get(f"{API_PREFIX}/environments/{env_id}")
            assert r.status_code == 404, r.text
            r = await client.get(f"{API_PREFIX}/environments")
            assert env_id not in {e["id"] for e in r.json()}

    @pytest.mark.asyncio
    async def test_viewer_can_get_but_not_edit(
        self, async_db_session: AsyncSession, test_user, second_user
    ) -> None:
        """``viewer`` reads the shared env but edit routes 403 read_only_access."""
        _org, env_id = await self._seed_shared_env(
            async_db_session, test_user, role_members={second_user: "viewer"}
        )
        app2 = _build_app(db_session=async_db_session, user=second_user)
        async with _client(app2) as client:
            r = await client.get(f"{API_PREFIX}/environments/{env_id}")
            assert r.status_code == 200, r.text

            r = await client.patch(
                f"{API_PREFIX}/environments/{env_id}",
                json={"description": "viewer edit attempt"},
            )
            assert r.status_code == 403, r.text
            assert r.json()["detail"]["code"] == "read_only_access"

            r = await client.put(
                f"{API_PREFIX}/environments/{env_id}/canonical",
                json={"machine_id": str(uuid4())},
            )
            assert r.status_code == 403, r.text
            assert r.json()["detail"]["code"] == "read_only_access"

    @pytest.mark.asyncio
    async def test_member_can_set_canonical_and_is_audited(
        self, async_db_session: AsyncSession, test_user, second_user
    ) -> None:
        """A ``member`` sets canonical on a shared env (owner's machine) and
        the canonical change log attributes the change to the member."""
        _org, env_id = await self._seed_shared_env(
            async_db_session, test_user, role_members={second_user: "member"}
        )
        # Owner enrolls a machine + pushes a config for the shared env.
        app1 = _build_app(db_session=async_db_session, user=test_user)
        async with _client(app1) as client:
            r = await client.post(
                f"{API_PREFIX}/machines",
                json={"name": f"owner-box-{uuid4().hex[:6]}"},
            )
            body = r.json()
            machine_id = body["id"]
            r = await client.post(
                f"{API_PREFIX}/agent/enroll",
                json={"enrollment_code": body["enrollment_code"]},
            )
            key = r.json()["machine_key"]
            r = await client.put(
                f"{API_PREFIX}/agent/environments/{env_id}/config",
                json=_config_body({"versions": {"python": "3.13"}}),
                headers={"X-Machine-Key": key},
            )
            assert r.status_code == 200, r.text

        # The member designates that (foreign-owned) machine as canonical.
        app2 = _build_app(db_session=async_db_session, user=second_user)
        async with _client(app2) as client:
            r = await client.put(
                f"{API_PREFIX}/environments/{env_id}/canonical",
                json={"machine_id": machine_id},
            )
            assert r.status_code == 200, r.text
            assert r.json()["canonical_machine_id"] == machine_id

            hist = (
                await client.get(
                    f"{API_PREFIX}/environments/{env_id}/canonical-history"
                )
            ).json()
            assert len(hist) == 1
            assert hist[0]["to_machine_id"] == machine_id
            assert hist[0]["changed_by_user_id"] == str(second_user.id)

    @pytest.mark.asyncio
    async def test_owner_can_share_and_unshare(
        self, async_db_session: AsyncSession, test_user, second_user
    ) -> None:
        """Owner shares (set) then unshares (explicit null); member loses access."""
        _org, env_id = await self._seed_shared_env(
            async_db_session, test_user, role_members={second_user: "member"}
        )
        app1 = _build_app(db_session=async_db_session, user=test_user)
        async with _client(app1) as client:
            # Unshare via explicit null (exclude_unset distinguishes it from
            # field-absent).
            r = await client.patch(
                f"{API_PREFIX}/environments/{env_id}",
                json={"organization_id": None},
            )
            assert r.status_code == 200, r.text
            assert r.json()["organization_id"] is None
        # The former member can no longer see it.
        app2 = _build_app(db_session=async_db_session, user=second_user)
        async with _client(app2) as client:
            r = await client.get(f"{API_PREFIX}/environments/{env_id}")
            assert r.status_code == 404, r.text

    @pytest.mark.asyncio
    async def test_member_cannot_change_sharing(
        self, async_db_session: AsyncSession, test_user, second_user
    ) -> None:
        """Sharing is the OWNER's call — an edit-capable member gets 403."""
        _org, env_id = await self._seed_shared_env(
            async_db_session, test_user, role_members={second_user: "member"}
        )
        app2 = _build_app(db_session=async_db_session, user=second_user)
        async with _client(app2) as client:
            r = await client.patch(
                f"{API_PREFIX}/environments/{env_id}",
                json={"organization_id": None},
            )
            assert r.status_code == 403, r.text
            assert r.json()["detail"]["code"] == "owner_only_operation"

    @pytest.mark.asyncio
    async def test_share_into_foreign_org_rejected(
        self, async_db_session: AsyncSession, test_user, second_user
    ) -> None:
        """Sharing into an org the owner has no edit membership in → 403,
        on both the update route and create-with-org."""
        foreign_org = await _new_org(async_db_session, second_user)
        await _add_member(async_db_session, foreign_org, second_user, "owner")

        app1 = _build_app(db_session=async_db_session, user=test_user)
        async with _client(app1) as client:
            r = await client.post(
                f"{API_PREFIX}/environments",
                json={"name": f"Mine-{uuid4().hex[:8]}", "description": None},
            )
            env_id = r.json()["id"]
            r = await client.patch(
                f"{API_PREFIX}/environments/{env_id}",
                json={"organization_id": str(foreign_org.id)},
            )
            assert r.status_code == 403, r.text
            assert r.json()["detail"]["code"] == "organization_access_denied"

            r = await client.post(
                f"{API_PREFIX}/environments",
                json={
                    "name": f"Born-shared-{uuid4().hex[:8]}",
                    "organization_id": str(foreign_org.id),
                },
            )
            assert r.status_code == 403, r.text
            assert r.json()["detail"]["code"] == "organization_access_denied"

    @pytest.mark.asyncio
    async def test_drift_on_shared_env_visible_to_member(
        self, async_db_session: AsyncSession, test_user, second_user
    ) -> None:
        """Drift on a shared env shows the owner's machines to a member."""
        _org, env_id = await self._seed_shared_env(
            async_db_session, test_user, role_members={second_user: "member"}
        )
        # Owner: two machines with configs, canonical = A.
        app1 = _build_app(db_session=async_db_session, user=test_user)
        async with _client(app1) as client:
            machines = {}
            for name, py in (("drift-a", "3.13"), ("drift-b", "3.11")):
                r = await client.post(
                    f"{API_PREFIX}/machines",
                    json={"name": f"{name}-{uuid4().hex[:6]}"},
                )
                body = r.json()
                r = await client.post(
                    f"{API_PREFIX}/agent/enroll",
                    json={"enrollment_code": body["enrollment_code"]},
                )
                key = r.json()["machine_key"]
                r = await client.put(
                    f"{API_PREFIX}/agent/environments/{env_id}/config",
                    json=_config_body({"versions": {"python": py}}),
                    headers={"X-Machine-Key": key},
                )
                assert r.status_code == 200, r.text
                machines[name] = body["id"]
            r = await client.put(
                f"{API_PREFIX}/environments/{env_id}/canonical",
                json={"machine_id": machines["drift-a"]},
            )
            assert r.status_code == 200, r.text

        # Member: reads env drift + single-machine drift for the owner's box.
        app2 = _build_app(db_session=async_db_session, user=second_user)
        async with _client(app2) as client:
            r = await client.get(f"{API_PREFIX}/environments/{env_id}/drift")
            assert r.status_code == 200, r.text
            drift = r.json()
            assert drift["canonical_machine_id"] == machines["drift-a"]
            assert len(drift["reports"]) == 1
            assert drift["reports"][0]["machine_id"] == machines["drift-b"]
            assert drift["reports"][0]["in_sync"] is False

            r = await client.get(
                f"{API_PREFIX}/environments/{env_id}/drift/{machines['drift-b']}"
            )
            assert r.status_code == 200, r.text
            assert r.json()["machine_id"] == machines["drift-b"]

    @pytest.mark.asyncio
    async def test_config_history_on_shared_env_visible_to_member(
        self, async_db_session: AsyncSession, test_user, second_user, third_user
    ) -> None:
        """Config-history is authorized through the ENVIRONMENT, like drift.

        The config-history routes predate org sharing and were owner-scoped.
        They resolve through ``_resolve_env_machine_or_404``, which now goes
        through ``get_viewable`` — so a member reads the owner's machine
        timeline on a shared env, while a non-member still 404s on the env.
        """
        _org, env_id = await self._seed_shared_env(
            async_db_session, test_user, role_members={second_user: "member"}
        )
        # Owner: one machine that reports two DISTINCT configs (two captures).
        app1 = _build_app(db_session=async_db_session, user=test_user)
        async with _client(app1) as client:
            r = await client.post(
                f"{API_PREFIX}/machines", json={"name": f"hist-{uuid4().hex[:6]}"}
            )
            machine_id = r.json()["id"]
            r = await client.post(
                f"{API_PREFIX}/agent/enroll",
                json={"enrollment_code": r.json()["enrollment_code"]},
            )
            key = r.json()["machine_key"]
            for py in ("3.13", "3.11"):
                r = await client.put(
                    f"{API_PREFIX}/agent/environments/{env_id}/config",
                    json=_config_body({"versions": {"python": py}}),
                    headers={"X-Machine-Key": key},
                )
                assert r.status_code == 200, r.text

        history_url = (
            f"{API_PREFIX}/environments/{env_id}/machines/{machine_id}/config-history"
        )

        # Member: sees the owner's machine timeline through the shared env.
        app2 = _build_app(db_session=async_db_session, user=second_user)
        async with _client(app2) as client:
            r = await client.get(history_url)
            assert r.status_code == 200, r.text
            assert len(r.json()) == 2

        # Non-member: the env is not viewable, so it does not exist to them.
        app3 = _build_app(db_session=async_db_session, user=third_user)
        async with _client(app3) as client:
            r = await client.get(history_url)
            assert r.status_code == 404, r.text
            assert r.json()["detail"]["code"] == "environment_not_found"

    @pytest.mark.asyncio
    async def test_member_machine_agent_report_and_pull_on_shared_env(
        self, async_db_session: AsyncSession, test_user, second_user
    ) -> None:
        """A member's machine (bound to the owner's shared env) can report
        config and pull the canonical config through the agent surface; a
        demotion to viewer kills report (404, never-leak), removal kills the
        pull too."""
        from sqlalchemy import select as sa_select

        from app.models.organization import TeamMember

        org, env_id = await self._seed_shared_env(
            async_db_session, test_user, role_members={second_user: "member"}
        )

        # Owner: a machine with config, designated canonical (the pull target).
        app1 = _build_app(db_session=async_db_session, user=test_user)
        async with _client(app1) as client:
            r = await client.post(
                f"{API_PREFIX}/machines",
                json={"name": f"own-canon-{uuid4().hex[:6]}"},
            )
            owner_machine = r.json()
            r = await client.post(
                f"{API_PREFIX}/agent/enroll",
                json={"enrollment_code": owner_machine["enrollment_code"]},
            )
            owner_key = r.json()["machine_key"]
            r = await client.put(
                f"{API_PREFIX}/agent/environments/{env_id}/config",
                json=_config_body({"versions": {"python": "3.13"}}),
                headers={"X-Machine-Key": owner_key},
            )
            assert r.status_code == 200, r.text
            r = await client.put(
                f"{API_PREFIX}/environments/{env_id}/canonical",
                json={"machine_id": owner_machine["id"]},
            )
            assert r.status_code == 200, r.text

        # Member: their own machine, explicitly bound to the SHARED env.
        app2 = _build_app(db_session=async_db_session, user=second_user)
        async with _client(app2) as client:
            r = await client.post(
                f"{API_PREFIX}/machines",
                json={
                    "name": f"member-box-{uuid4().hex[:6]}",
                    "environment_id": env_id,
                },
            )
            assert r.status_code == 201, r.text
            member_machine = r.json()
            r = await client.post(
                f"{API_PREFIX}/agent/enroll",
                json={"enrollment_code": member_machine["enrollment_code"]},
            )
            assert r.status_code == 200, r.text
            # Explicit binding resolves the FOREIGN (shared) env at enroll.
            assert r.json()["environment_id"] == env_id
            member_key = r.json()["machine_key"]

            # Report config into the shared env (owner has edit via `member`).
            r = await client.put(
                f"{API_PREFIX}/agent/environments/{env_id}/config",
                json=_config_body({"versions": {"python": "3.12"}}),
                headers={"X-Machine-Key": member_key},
            )
            assert r.status_code == 200, r.text

            # Pull the canonical config — canonical machine belongs to the
            # env owner, and its name still resolves.
            r = await client.get(
                f"{API_PREFIX}/agent/environments/{env_id}/canonical-config",
                headers={"X-Machine-Key": member_key},
            )
            assert r.status_code == 200, r.text
            body = r.json()
            assert body["canonical_machine_id"] == owner_machine["id"]
            assert body["canonical_machine_name"] == owner_machine["name"]
            assert body["sections"]["versions"]["python"] == "3.13"

            # Demote the member to viewer: report loses edit -> 404
            # (never-leak on the agent surface), but the pull (view) stays.
            membership = (
                await async_db_session.execute(
                    sa_select(TeamMember).where(
                        TeamMember.organization_id == org.id,
                        TeamMember.user_id == second_user.id,
                    )
                )
            ).scalar_one()
            membership.role = "viewer"
            await async_db_session.commit()

            r = await client.put(
                f"{API_PREFIX}/agent/environments/{env_id}/config",
                json=_config_body({"versions": {"python": "3.12"}}),
                headers={"X-Machine-Key": member_key},
            )
            assert r.status_code == 404, r.text
            assert r.json()["detail"]["code"] == "environment_not_found"

            r = await client.get(
                f"{API_PREFIX}/agent/environments/{env_id}/canonical-config",
                headers={"X-Machine-Key": member_key},
            )
            assert r.status_code == 200, r.text

            # Remove the membership entirely: the pull 404s too.
            await async_db_session.delete(membership)
            await async_db_session.commit()
            r = await client.get(
                f"{API_PREFIX}/agent/environments/{env_id}/canonical-config",
                headers={"X-Machine-Key": member_key},
            )
            assert r.status_code == 404, r.text
            assert r.json()["detail"]["code"] == "environment_not_found"

    @pytest.mark.asyncio
    async def test_member_cannot_bind_shared_env_to_private_app(
        self, async_db_session: AsyncSession, test_user, second_user
    ) -> None:
        """PATCHing a shared env's application_id to an app the ENV OWNER
        cannot view (the member's private app) → 404 application_not_found."""
        _org, env_id = await self._seed_shared_env(
            async_db_session, test_user, role_members={second_user: "member"}
        )
        app2 = _build_app(db_session=async_db_session, user=second_user)
        async with _client(app2) as client:
            r = await client.post(
                f"{API_PREFIX}/applications",
                json={
                    "name": "Member Private",
                    "slug": f"member-private-{uuid4().hex[:8]}",
                    "description": None,
                },
            )
            assert r.status_code == 201, r.text
            private_app_id = r.json()["id"]

            r = await client.patch(
                f"{API_PREFIX}/environments/{env_id}",
                json={"application_id": private_app_id},
            )
            assert r.status_code == 404, r.text
            assert r.json()["detail"]["code"] == "application_not_found"

    @pytest.mark.asyncio
    async def test_admin_role_user_can_edit(
        self, async_db_session: AsyncSession, test_user
    ) -> None:
        """An ``admin`` member may update shared-env content (not sharing)."""
        admin_user = await _new_user(async_db_session, "admin")
        _org, env_id = await self._seed_shared_env(
            async_db_session, test_user, role_members={admin_user: "admin"}
        )
        app2 = _build_app(db_session=async_db_session, user=admin_user)
        async with _client(app2) as client:
            r = await client.patch(
                f"{API_PREFIX}/environments/{env_id}",
                json={"description": "edited by admin"},
            )
            assert r.status_code == 200, r.text
            assert r.json()["description"] == "edited by admin"


class TestUnknownKeysWire:
    """The unmeasured-key marker survives the agent PUT → JSONB → drift GET.

    The layer-1 tests above cover the classification; this covers the WIRE —
    the field used to be dropped on the floor by ``ConfigEnvelope`` (extra
    fields ignored) and by ``to_stored_config`` (three keys copied), so the
    marker never reached the diff no matter how correct the diff was.
    """

    async def _seed(self, client: httpx.AsyncClient) -> tuple[str, str, str, str]:
        """env + two enrolled machines. Returns (env_id, a_id, key_a, key_b)."""
        r = await client.post(
            f"{API_PREFIX}/environments", json={"name": "Unknowns", "description": None}
        )
        env_id = r.json()["id"]
        r = await client.post(f"{API_PREFIX}/machines", json={"name": "canon"})
        a = r.json()
        r = await client.post(f"{API_PREFIX}/machines", json={"name": "slow-box"})
        b = r.json()
        r = await client.post(
            f"{API_PREFIX}/agent/enroll",
            json={"enrollment_code": a["enrollment_code"], "machine_id": a["id"]},
        )
        key_a = r.json()["machine_key"]
        r = await client.post(
            f"{API_PREFIX}/agent/enroll",
            json={"enrollment_code": b["enrollment_code"], "machine_id": b["id"]},
        )
        key_b = r.json()["machine_key"]
        return env_id, a["id"], key_a, key_b

    @pytest.mark.asyncio
    async def test_unknown_keys_persist_and_reach_the_drift_report(
        self, async_db_session: AsyncSession, test_user
    ) -> None:
        """A pushed ``unknown_keys`` is stored and turns removed → unknown."""
        app = _build_app(db_session=async_db_session, user=test_user)
        async with _client(app) as client:
            env_id, a_id, key_a, key_b = await self._seed(client)

            await client.put(
                f"{API_PREFIX}/agent/environments/{env_id}/config",
                json=_config_body({"versions": {"python": "3.12", "node": "22"}}),
                headers={"X-Machine-Key": key_a},
            )
            # B measured `node` and matched; its `python` probe timed out. The
            # older behavior called that a critical `removed`.
            r = await client.put(
                f"{API_PREFIX}/agent/environments/{env_id}/config",
                json=_config_body(
                    {"versions": {"node": "22"}},
                    unknown_keys={"versions": ["python"]},
                ),
                headers={"X-Machine-Key": key_b},
            )
            assert r.status_code == 200, r.text

            # Persisted as a sibling of `sections`, not dropped.
            from app.repositories.devenv import config_repo

            row = await config_repo.get(
                async_db_session,
                environment_id=UUID(env_id),
                machine_id=UUID(r.json()["machine_id"]),
            )
            assert row is not None
            assert row.config["unknown_keys"] == {"versions": ["python"]}

            await client.put(
                f"{API_PREFIX}/environments/{env_id}/canonical",
                json={"machine_id": a_id},
            )
            r = await client.get(f"{API_PREFIX}/environments/{env_id}/drift")
            assert r.status_code == 200, r.text
            drift = r.json()

            report = drift["reports"][0]
            section = next(s for s in report["sections"] if s["section"] == "versions")
            delta = next(d for d in section["deltas"] if d["key"] == "python")
            assert delta["status"] == "unknown"
            assert delta["severity"] == "info"
            # A probe timeout must not report the fleet as critically drifted.
            assert drift["severity"] == "info"
            assert drift["in_sync"] is True

    @pytest.mark.asyncio
    async def test_agent_omitting_the_field_is_unchanged_end_to_end(
        self, async_db_session: AsyncSession, test_user
    ) -> None:
        """An older agent's push stores no ``unknown_keys`` and still drifts."""
        app = _build_app(db_session=async_db_session, user=test_user)
        async with _client(app) as client:
            env_id, a_id, key_a, key_b = await self._seed(client)

            await client.put(
                f"{API_PREFIX}/agent/environments/{env_id}/config",
                json=_config_body({"versions": {"python": "3.12"}}),
                headers={"X-Machine-Key": key_a},
            )
            r = await client.put(
                f"{API_PREFIX}/agent/environments/{env_id}/config",
                json=_config_body({"versions": {}}),
                headers={"X-Machine-Key": key_b},
            )
            assert r.status_code == 200, r.text

            from app.repositories.devenv import config_repo

            row = await config_repo.get(
                async_db_session,
                environment_id=UUID(env_id),
                machine_id=UUID(r.json()["machine_id"]),
            )
            assert row is not None
            # Absent, not an empty dict — the stored shape is byte-identical to
            # what a pre-field runner always wrote.
            assert "unknown_keys" not in row.config

            await client.put(
                f"{API_PREFIX}/environments/{env_id}/canonical",
                json={"machine_id": a_id},
            )
            r = await client.get(f"{API_PREFIX}/environments/{env_id}/drift")
            drift = r.json()
            section = next(
                s for s in drift["reports"][0]["sections"] if s["section"] == "versions"
            )
            delta = next(d for d in section["deltas"] if d["key"] == "python")
            assert delta["status"] == "removed"
            assert delta["severity"] == "critical"
            assert drift["in_sync"] is False


class TestCanonicalAuditAndPull:
    """P1 (pull model) — canonical audit trail + the machine pull surface."""

    async def _seed_env_two_enrolled_machines(
        self, client: httpx.AsyncClient
    ) -> tuple[str, str, str, str, str]:
        """Create env + machines A,B, enroll both, push A's + B's config.

        Returns (env_id, machine_a_id, machine_b_id, key_a, key_b).
        A carries a secret env_contract so pull secret-safety is testable.
        """
        r = await client.post(
            f"{API_PREFIX}/environments", json={"name": "Sync", "description": None}
        )
        env_id = r.json()["id"]

        r = await client.post(f"{API_PREFIX}/machines", json={"name": "machine-a"})
        body_a = r.json()
        machine_a_id, code_a = body_a["id"], body_a["enrollment_code"]
        r = await client.post(f"{API_PREFIX}/machines", json={"name": "machine-b"})
        body_b = r.json()
        machine_b_id, code_b = body_b["id"], body_b["enrollment_code"]

        r = await client.post(
            f"{API_PREFIX}/agent/enroll",
            json={"enrollment_code": code_a, "machine_id": machine_a_id},
        )
        key_a = r.json()["machine_key"]
        r = await client.post(
            f"{API_PREFIX}/agent/enroll",
            json={"enrollment_code": code_b, "machine_id": machine_b_id},
        )
        key_b = r.json()["machine_key"]

        await client.put(
            f"{API_PREFIX}/agent/environments/{env_id}/config",
            json=_config_body(
                {
                    "versions": {"python": "3.13"},
                    "services": {"redis": "6379"},
                    "env_contract": {"DATABASE_URL": "postgres://u:topsecret@h/d"},
                }
            ),
            headers={"X-Machine-Key": key_a},
        )
        await client.put(
            f"{API_PREFIX}/agent/environments/{env_id}/config",
            json=_config_body({"versions": {"python": "3.11"}}),
            headers={"X-Machine-Key": key_b},
        )
        return env_id, machine_a_id, machine_b_id, key_a, key_b

    @pytest.mark.asyncio
    async def test_canonical_changes_are_audited(
        self, async_db_session: AsyncSession, test_user
    ) -> None:
        """Every canonical (re)designation is recorded who/when/from->to;
        a no-op re-designation is not."""
        app = _build_app(db_session=async_db_session, user=test_user)
        async with _client(app) as client:
            env_id, a_id, b_id, _, _ = await self._seed_env_two_enrolled_machines(
                client
            )

            # No changes yet.
            r = await client.get(
                f"{API_PREFIX}/environments/{env_id}/canonical-history"
            )
            assert r.status_code == 200, r.text
            assert r.json() == []

            # First designation A: from None -> A, attributed to the user.
            r = await client.put(
                f"{API_PREFIX}/environments/{env_id}/canonical",
                json={"machine_id": a_id},
            )
            assert r.status_code == 200, r.text
            hist = (
                await client.get(
                    f"{API_PREFIX}/environments/{env_id}/canonical-history"
                )
            ).json()
            assert len(hist) == 1
            assert hist[0]["from_machine_id"] is None
            assert hist[0]["to_machine_id"] == a_id
            assert hist[0]["changed_by_user_id"] == str(test_user.id)
            assert hist[0]["changed_at"].endswith("Z")

            # Re-point to B → a second record with the A -> B transition.
            # NOTE: assert on the SET of transitions, not positional order:
            # this test harness wraps every request in ONE transaction, so
            # Postgres now() (transaction-start time) is identical for both
            # rows and ORDER BY changed_at DESC is a tie. In production each
            # change is its own transaction with a distinct timestamp.
            r = await client.put(
                f"{API_PREFIX}/environments/{env_id}/canonical",
                json={"machine_id": b_id},
            )
            assert r.status_code == 200, r.text
            hist = (
                await client.get(
                    f"{API_PREFIX}/environments/{env_id}/canonical-history"
                )
            ).json()
            assert len(hist) == 2
            transitions = {(h["from_machine_id"], h["to_machine_id"]) for h in hist}
            assert transitions == {(None, a_id), (a_id, b_id)}

            # No-op re-designation of B (already canonical) is NOT recorded.
            await client.put(
                f"{API_PREFIX}/environments/{env_id}/canonical",
                json={"machine_id": b_id},
            )
            hist = (
                await client.get(
                    f"{API_PREFIX}/environments/{env_id}/canonical-history"
                )
            ).json()
            assert len(hist) == 2

    @pytest.mark.asyncio
    async def test_canonical_note_round_trips(
        self, async_db_session: AsyncSession, test_user
    ) -> None:
        """The optional "why" travels from the request into the audit row.

        The column, the response field and the UI row all existed; nothing
        could WRITE one until ``SetCanonicalRequest.note`` did.
        """
        app = _build_app(db_session=async_db_session, user=test_user)
        async with _client(app) as client:
            env_id, a_id, b_id, _, _ = await self._seed_env_two_enrolled_machines(
                client
            )
            r = await client.put(
                f"{API_PREFIX}/environments/{env_id}/canonical",
                json={"machine_id": a_id, "note": "  a-box rebuilt on 3.12  "},
            )
            assert r.status_code == 200, r.text

            # A note-less designation stays null (the field is optional).
            r = await client.put(
                f"{API_PREFIX}/environments/{env_id}/canonical",
                json={"machine_id": b_id},
            )
            assert r.status_code == 200, r.text

            hist = (
                await client.get(
                    f"{API_PREFIX}/environments/{env_id}/canonical-history"
                )
            ).json()
            # Same-transaction rows tie on changed_at — key by transition.
            notes = {h["to_machine_id"]: h["note"] for h in hist}
            assert notes[a_id] == "a-box rebuilt on 3.12"  # trimmed
            assert notes[b_id] is None

    @pytest.mark.asyncio
    async def test_blank_canonical_note_is_stored_as_null(
        self, async_db_session: AsyncSession, test_user
    ) -> None:
        """A whitespace-only note is no note — never an empty string.

        Readers test the note for truthiness (the UI renders the line only
        when it is non-null); `""` would be a third state meaning nothing.
        """
        app = _build_app(db_session=async_db_session, user=test_user)
        async with _client(app) as client:
            env_id, a_id, _, _, _ = await self._seed_env_two_enrolled_machines(client)
            r = await client.put(
                f"{API_PREFIX}/environments/{env_id}/canonical",
                json={"machine_id": a_id, "note": "   "},
            )
            assert r.status_code == 200, r.text
            hist = (
                await client.get(
                    f"{API_PREFIX}/environments/{env_id}/canonical-history"
                )
            ).json()
            assert len(hist) == 1
            assert hist[0]["note"] is None

    @pytest.mark.asyncio
    async def test_overlong_canonical_note_is_rejected(
        self, async_db_session: AsyncSession, test_user
    ) -> None:
        """The note is bounded — the audit trail is not a free-text dumping
        ground, and the UI renders it inline."""
        app = _build_app(db_session=async_db_session, user=test_user)
        async with _client(app) as client:
            env_id, a_id, _, _, _ = await self._seed_env_two_enrolled_machines(client)
            r = await client.put(
                f"{API_PREFIX}/environments/{env_id}/canonical",
                json={"machine_id": a_id, "note": "x" * 501},
            )
            assert r.status_code == 422, r.text

    @pytest.mark.asyncio
    async def test_history_pages_without_gaps_or_repeats(
        self, async_db_session: AsyncSession, test_user
    ) -> None:
        """limit/offset page the audit trail deterministically.

        The load-bearing part is the ``id`` tiebreaker in the repository sort:
        ``changed_at`` defaults to Postgres ``now()`` (transaction time), so
        these three rows share a timestamp exactly. Ordering on the timestamp
        alone would let the two pages skip or repeat a row.
        """
        app = _build_app(db_session=async_db_session, user=test_user)
        async with _client(app) as client:
            env_id, a_id, b_id, _, _ = await self._seed_env_two_enrolled_machines(
                client
            )
            for machine_id in (a_id, b_id, a_id):
                r = await client.put(
                    f"{API_PREFIX}/environments/{env_id}/canonical",
                    json={"machine_id": machine_id},
                )
                assert r.status_code == 200, r.text

            async def page(limit: int, offset: int) -> list[str]:
                r = await client.get(
                    f"{API_PREFIX}/environments/{env_id}/canonical-history"
                    f"?limit={limit}&offset={offset}"
                )
                assert r.status_code == 200, r.text
                return [h["id"] for h in r.json()]

            first, second = await page(2, 0), await page(2, 2)
            assert len(first) == 2
            assert len(second) == 1
            # Disjoint, and together the whole history.
            assert set(first).isdisjoint(second)
            assert set(first) | set(second) == set(await page(50, 0))

    @pytest.mark.asyncio
    async def test_history_resolves_display_names(
        self, async_db_session: AsyncSession, test_user
    ) -> None:
        """History rows carry the actor email + from/to machine names.

        Resolved server-side by LEFT JOIN so the UI never renders a raw UUID
        and never issues a per-row lookup.
        """
        app = _build_app(db_session=async_db_session, user=test_user)
        async with _client(app) as client:
            env_id, a_id, b_id, _, _ = await self._seed_env_two_enrolled_machines(
                client
            )
            await client.put(
                f"{API_PREFIX}/environments/{env_id}/canonical",
                json={"machine_id": a_id},
            )
            await client.put(
                f"{API_PREFIX}/environments/{env_id}/canonical",
                json={"machine_id": b_id},
            )
            hist = (
                await client.get(
                    f"{API_PREFIX}/environments/{env_id}/canonical-history"
                )
            ).json()
            assert len(hist) == 2
            # Same-transaction rows share now(), so ORDER BY changed_at DESC
            # is a tie here — assert on the SET of transitions, not position.
            named = {(h["from_machine_name"], h["to_machine_name"]) for h in hist}
            assert named == {(None, "machine-a"), ("machine-a", "machine-b")}
            assert {h["changed_by_email"] for h in hist} == {test_user.email}

    @pytest.mark.asyncio
    async def test_history_survives_machine_deletion_with_null_name(
        self, async_db_session: AsyncSession, test_user
    ) -> None:
        """The load-bearing case: deleting a machine must NOT drop its audit
        rows — the ids are soft refs, so the row stays and the name is None."""
        app = _build_app(db_session=async_db_session, user=test_user)
        async with _client(app) as client:
            env_id, a_id, b_id, _, _ = await self._seed_env_two_enrolled_machines(
                client
            )
            await client.put(
                f"{API_PREFIX}/environments/{env_id}/canonical",
                json={"machine_id": a_id},
            )
            await client.put(
                f"{API_PREFIX}/environments/{env_id}/canonical",
                json={"machine_id": b_id},
            )

            r = await client.delete(f"{API_PREFIX}/machines/{a_id}")
            assert r.status_code == 204, r.text

            hist = (
                await client.get(
                    f"{API_PREFIX}/environments/{env_id}/canonical-history"
                )
            ).json()
            # Both audit rows survive the deletion.
            assert len(hist) == 2
            # The soft-ref ids are untouched — only the resolved name is gone.
            assert {h["to_machine_id"] for h in hist} == {a_id, b_id}
            named = {(h["from_machine_name"], h["to_machine_name"]) for h in hist}
            assert named == {(None, None), (None, "machine-b")}

    @pytest.mark.asyncio
    async def test_history_null_actor_yields_null_email(
        self, async_db_session: AsyncSession, test_user
    ) -> None:
        """``changed_by_user_id`` is FK SET NULL — a null actor resolves to a
        null email rather than erroring or dropping the row."""
        from app.repositories.devenv import canonical_log_repo

        app = _build_app(db_session=async_db_session, user=test_user)
        async with _client(app) as client:
            env_id, a_id, _, _, _ = await self._seed_env_two_enrolled_machines(client)
            await canonical_log_repo.record(
                async_db_session,
                environment_id=UUID(env_id),
                from_machine_id=None,
                to_machine_id=UUID(a_id),
                changed_by_user_id=None,
            )
            await async_db_session.commit()

            hist = (
                await client.get(
                    f"{API_PREFIX}/environments/{env_id}/canonical-history"
                )
            ).json()
            assert len(hist) == 1
            assert hist[0]["changed_by_user_id"] is None
            assert hist[0]["changed_by_email"] is None
            assert hist[0]["to_machine_name"] == "machine-a"

    @pytest.mark.asyncio
    async def test_audit_records_active_tenant_best_effort(
        self, async_db_session: AsyncSession, test_user
    ) -> None:
        """The active-tenant header is captured onto the audit row when sent."""
        app = _build_app(db_session=async_db_session, user=test_user)
        tenant_id = str(uuid4())
        async with _client(app) as client:
            env_id, a_id, _, _, _ = await self._seed_env_two_enrolled_machines(client)
            r = await client.put(
                f"{API_PREFIX}/environments/{env_id}/canonical",
                json={"machine_id": a_id},
                headers={"X-Qontinui-Active-Tenant": tenant_id},
            )
            assert r.status_code == 200, r.text
            hist = (
                await client.get(
                    f"{API_PREFIX}/environments/{env_id}/canonical-history"
                )
            ).json()
            assert hist[0]["tenant_id"] == tenant_id

    @pytest.mark.asyncio
    async def test_pull_canonical_config(
        self, async_db_session: AsyncSession, test_user
    ) -> None:
        """A machine pulls the canonical config + per-section policy, secret-free."""
        app = _build_app(db_session=async_db_session, user=test_user)
        async with _client(app) as client:
            env_id, a_id, _, _, key_b = await self._seed_env_two_enrolled_machines(
                client
            )
            await client.put(
                f"{API_PREFIX}/environments/{env_id}/canonical",
                json={"machine_id": a_id},
            )

            # Machine B pulls what to reconcile toward (canonical = A).
            r = await client.get(
                f"{API_PREFIX}/agent/environments/{env_id}/canonical-config",
                headers={"X-Machine-Key": key_b},
            )
            assert r.status_code == 200, r.text
            body = r.json()
            assert body["canonical_machine_id"] == a_id
            assert body["canonical_machine_name"] == "machine-a"
            assert body["sections"]["versions"]["python"] == "3.13"
            # Policy delivered alongside so the runner knows what it may apply.
            assert body["section_policy"]["versions"] == "applyable"
            assert body["section_policy"]["env_contract"] == "secret_report_only"
            # Per-key refinement rides along: python is a machine fact, so the
            # applyable versions section reports no derived keys here.
            assert body["derived_keys"]["versions"] == []
            assert body["derived_keys"]["env_contract"] == []
            # Secret-free: env_contract is present/absent, never the raw value.
            assert body["sections"]["env_contract"]["DATABASE_URL"] == "present"
            assert "topsecret" not in r.text

    @pytest.mark.asyncio
    async def test_pull_requires_canonical(
        self, async_db_session: AsyncSession, test_user
    ) -> None:
        """Pulling with no canonical set → 422 no_canonical_machine."""
        app = _build_app(db_session=async_db_session, user=test_user)
        async with _client(app) as client:
            _env, _a, _b, _ka, key_b = await self._seed_env_two_enrolled_machines(
                client
            )
            r = await client.get(
                f"{API_PREFIX}/agent/environments/{_env}/canonical-config",
                headers={"X-Machine-Key": key_b},
            )
            assert r.status_code == 422, r.text
            assert r.json()["detail"]["code"] == "no_canonical_machine"

    @pytest.mark.asyncio
    async def test_pull_cross_owner_404(
        self, async_db_session: AsyncSession, test_user, second_user
    ) -> None:
        """A machine can only pull its own owner's environment (else 404)."""
        # Owner 1: env + canonical A.
        app1 = _build_app(db_session=async_db_session, user=test_user)
        async with _client(app1) as client:
            env_id, a_id, _b, _ka, _kb = await self._seed_env_two_enrolled_machines(
                client
            )
            await client.put(
                f"{API_PREFIX}/environments/{env_id}/canonical",
                json={"machine_id": a_id},
            )

        # Owner 2: a machine of their own, whose key must NOT reach env_id.
        app2 = _build_app(db_session=async_db_session, user=second_user)
        async with _client(app2) as client:
            r = await client.post(f"{API_PREFIX}/machines", json={"name": "intruder"})
            body = r.json()
            r = await client.post(
                f"{API_PREFIX}/agent/enroll",
                json={
                    "enrollment_code": body["enrollment_code"],
                    "machine_id": body["id"],
                },
            )
            key_intruder = r.json()["machine_key"]
            r = await client.get(
                f"{API_PREFIX}/agent/environments/{env_id}/canonical-config",
                headers={"X-Machine-Key": key_intruder},
            )
            assert r.status_code == 404, r.text
            assert r.json()["detail"]["code"] == "environment_not_found"


class TestConfigHistory:
    """P2 — append-only config-history timeline + point-to-point diff."""

    async def _seed_enrolled_machine(
        self, client: httpx.AsyncClient
    ) -> tuple[str, str, str]:
        """Create env + one enrolled machine. Returns (env_id, machine_id, key)."""
        r = await client.post(
            f"{API_PREFIX}/environments", json={"name": "Hist", "description": None}
        )
        env_id = r.json()["id"]
        r = await client.post(f"{API_PREFIX}/machines", json={"name": "hist-machine"})
        body = r.json()
        machine_id, code = body["id"], body["enrollment_code"]
        r = await client.post(
            f"{API_PREFIX}/agent/enroll",
            json={"enrollment_code": code, "machine_id": machine_id},
        )
        key = r.json()["machine_key"]
        return env_id, machine_id, key

    @staticmethod
    def _body(sections: dict, captured_at: str) -> dict:
        return {"schema_version": 1, "captured_at": captured_at, "sections": sections}

    @pytest.mark.asyncio
    async def test_history_dedup_diff_and_prune(
        self, async_db_session: AsyncSession, test_user
    ) -> None:
        """Identical re-push adds no row; a change appends; diff shows it;
        prune caps the timeline and reports counts."""
        app = _build_app(db_session=async_db_session, user=test_user)
        async with _client(app) as client:
            env_id, machine_id, key = await self._seed_enrolled_machine(client)
            history_url = (
                f"{API_PREFIX}/environments/{env_id}"
                f"/machines/{machine_id}/config-history"
            )

            # 1. Push a config, then re-push the IDENTICAL envelope → 1 row.
            sections_v1 = {"services": {"redis": "6379"}}
            r = await client.put(
                f"{API_PREFIX}/agent/environments/{env_id}/config",
                json=self._body(sections_v1, "2026-07-01T10:00:00Z"),
                headers={"X-Machine-Key": key},
            )
            assert r.status_code == 200, r.text
            r = await client.put(
                f"{API_PREFIX}/agent/environments/{env_id}/config",
                json=self._body(sections_v1, "2026-07-01T10:15:00Z"),
                headers={"X-Machine-Key": key},
            )
            assert r.status_code == 200, r.text

            r = await client.get(history_url)
            assert r.status_code == 200, r.text
            hist = r.json()
            assert len(hist) == 1
            # Metadata only — NEVER a config body in the list payload.
            assert "config" not in hist[0]
            assert hist[0]["source"] == "agent"
            assert hist[0]["schema_version"] == 1
            assert len(hist[0]["content_hash"]) == 64

            # 2. Push a CHANGED envelope → a second row, newest first.
            sections_v2 = {"services": {"redis": "6380"}}
            r = await client.put(
                f"{API_PREFIX}/agent/environments/{env_id}/config",
                json=self._body(sections_v2, "2026-07-02T10:00:00Z"),
                headers={"X-Machine-Key": key},
            )
            assert r.status_code == 200, r.text

            hist = (await client.get(history_url)).json()
            assert len(hist) == 2
            assert hist[0]["captured_at"] == "2026-07-02T10:00:00Z"
            assert hist[1]["captured_at"] == "2026-07-01T10:00:00Z"
            assert hist[0]["content_hash"] != hist[1]["content_hash"]
            newer_id, older_id = hist[0]["id"], hist[1]["id"]

            # 3. Diff older -> newer surfaces the changed key.
            r = await client.get(
                f"{history_url}/diff",
                params={"from_id": older_id, "to_id": newer_id},
            )
            assert r.status_code == 200, r.text
            diff = r.json()
            assert diff["machine_id"] == machine_id
            assert diff["from_id"] == older_id
            assert diff["to_id"] == newer_id
            assert diff["in_sync"] is False
            delta = _find_delta(_find_section(diff, "services"), "redis")
            assert delta["status"] == "changed"
            assert delta["expected"] == "6379"
            assert delta["actual"] == "6380"

            # 3b. A diff id from nowhere → 404 (missing or foreign pair).
            r = await client.get(
                f"{history_url}/diff",
                params={"from_id": str(uuid4()), "to_id": newer_id},
            )
            assert r.status_code == 404, r.text
            assert r.json()["detail"]["code"] == "config_history_entry_not_found"

            # 4. Prune with keep_per_pair=1 deletes the older row + reports it.
            from app.repositories.devenv import config_history_repo

            pruned = await config_history_repo.prune(async_db_session, keep_per_pair=1)
            assert pruned == [(UUID(env_id), UUID(machine_id), 1)]

            hist = (await client.get(history_url)).json()
            assert len(hist) == 1
            assert hist[0]["id"] == newer_id

    @pytest.mark.asyncio
    async def test_history_cross_owner_404(
        self, async_db_session: AsyncSession, test_user, second_user
    ) -> None:
        """Another owner cannot read a machine's history (404, not 403)."""
        app1 = _build_app(db_session=async_db_session, user=test_user)
        async with _client(app1) as client:
            env_id, machine_id, key = await self._seed_enrolled_machine(client)
            r = await client.put(
                f"{API_PREFIX}/agent/environments/{env_id}/config",
                json=self._body(
                    {"services": {"redis": "6379"}}, "2026-07-01T10:00:00Z"
                ),
                headers={"X-Machine-Key": key},
            )
            assert r.status_code == 200, r.text

        app2 = _build_app(db_session=async_db_session, user=second_user)
        async with _client(app2) as client:
            r = await client.get(
                f"{API_PREFIX}/environments/{env_id}"
                f"/machines/{machine_id}/config-history"
            )
            assert r.status_code == 404, r.text
            assert r.json()["detail"]["code"] == "environment_not_found"


class TestAutoEnrollPolicyApi:
    """``GET``/``PUT /devenv/auto-enroll-policy`` (plan 2026-08-05, Phase 5).

    The surface that makes the connect-time engine visible and reversible. The
    thing worth testing hardest is what it says when the engine would do
    NOTHING: several environments and no target is a permanent silent no-op,
    and the response has to name it rather than reporting a healthy "enabled".
    """

    @pytest.mark.asyncio
    async def test_response_carries_the_deployment_flag_beside_the_owners(
        self, async_db_session: AsyncSession, test_user, monkeypatch
    ) -> None:
        """Both halves, because either alone is a half-truth.

        ``DEVENV_AUTO_ENROLL_ENABLED`` ships FALSE and the owner's ``enabled``
        defaults TRUE, so for the whole rollout window a response carrying only
        the owner's half describes an engine that returns ``disabled_globally``
        before reading a row as if it were healthy. The panel keys its dominant
        status off this field, so its absence is what the green-on bug was made
        of.
        """
        from app.core.config import settings

        app = _build_app(db_session=async_db_session, user=test_user)

        monkeypatch.setattr(settings, "DEVENV_AUTO_ENROLL_ENABLED", False)
        async with _client(app) as client:
            r = await client.get(f"{API_PREFIX}/auto-enroll-policy")
            assert r.status_code == 200, r.text
            body = r.json()
            # The rollout default: the owner wants it on, the engine is off.
            assert body["enabled"] is True
            assert body["globally_enabled"] is False

        monkeypatch.setattr(settings, "DEVENV_AUTO_ENROLL_ENABLED", True)
        async with _client(app) as client:
            r = await client.get(f"{API_PREFIX}/auto-enroll-policy")
            assert r.json()["globally_enabled"] is True

        # The PUT reports it too — a save must not answer with a shape the GET
        # would contradict.
        async with _client(app) as client:
            r = await client.put(
                f"{API_PREFIX}/auto-enroll-policy",
                json={"enabled": True, "target_environment_id": None},
            )
            assert r.status_code == 200, r.text
            assert r.json()["globally_enabled"] is True

    @pytest.mark.asyncio
    async def test_absent_row_reads_as_enabled_and_unconfigured(
        self, async_db_session: AsyncSession, test_user
    ) -> None:
        """No row = enabled (decision 3), and the GET must not create one."""
        from sqlalchemy import select

        from app.models.devenv import AutoEnrollPolicy

        app = _build_app(db_session=async_db_session, user=test_user)
        async with _client(app) as client:
            r = await client.get(f"{API_PREFIX}/auto-enroll-policy")
            assert r.status_code == 200, r.text
            body = r.json()
            assert body["enabled"] is True
            assert body["configured"] is False
            assert body["target_environment_id"] is None
            assert body["updated_at"] is None

        # Reading must not materialise state: the default has to keep working
        # for the owners who never open this surface.
        row = await async_db_session.scalar(
            select(AutoEnrollPolicy).where(
                AutoEnrollPolicy.owner_user_id == test_user.id
            )
        )
        assert row is None

    @pytest.mark.asyncio
    async def test_single_environment_is_the_effective_target(
        self, async_db_session: AsyncSession, test_user
    ) -> None:
        """One environment resolves without a stated target (the shipped rule)."""
        app = _build_app(db_session=async_db_session, user=test_user)
        async with _client(app) as client:
            r = await client.post(
                f"{API_PREFIX}/environments", json={"name": "Only", "description": None}
            )
            assert r.status_code == 201, r.text
            env_id = r.json()["id"]

            r = await client.get(f"{API_PREFIX}/auto-enroll-policy")
            assert r.status_code == 200, r.text
            body = r.json()
            assert body["environment_count"] == 1
            assert body["effective_environment_id"] == env_id

    @pytest.mark.asyncio
    async def test_two_environments_no_target_is_reported_as_unresolved(
        self, async_db_session: AsyncSession, test_user
    ) -> None:
        """The ambiguous state: enabled, but nothing would actually happen.

        This is the case Phase 5 exists for. ``enabled`` alone would read as
        healthy; ``effective_environment_id: null`` with ``environment_count``
        above one is what tells the UI that every new box is being skipped.
        """
        app = _build_app(db_session=async_db_session, user=test_user)
        async with _client(app) as client:
            for name in ("Alpha", "Beta"):
                r = await client.post(
                    f"{API_PREFIX}/environments",
                    json={"name": name, "description": None},
                )
                assert r.status_code == 201, r.text

            r = await client.get(f"{API_PREFIX}/auto-enroll-policy")
            assert r.status_code == 200, r.text
            body = r.json()
            assert body["enabled"] is True
            assert body["environment_count"] == 2
            assert body["effective_environment_id"] is None

    @pytest.mark.asyncio
    async def test_put_sets_target_and_resolves_it(
        self, async_db_session: AsyncSession, test_user
    ) -> None:
        """Naming a target disambiguates, and the row round-trips."""
        app = _build_app(db_session=async_db_session, user=test_user)
        async with _client(app) as client:
            ids = []
            for name in ("Alpha", "Beta"):
                r = await client.post(
                    f"{API_PREFIX}/environments",
                    json={"name": name, "description": None},
                )
                assert r.status_code == 201, r.text
                ids.append(r.json()["id"])

            r = await client.put(
                f"{API_PREFIX}/auto-enroll-policy",
                json={"enabled": True, "target_environment_id": ids[1]},
            )
            assert r.status_code == 200, r.text
            body = r.json()
            assert body["configured"] is True
            assert body["target_environment_id"] == ids[1]
            assert body["effective_environment_id"] == ids[1]
            assert body["updated_at"] is not None

            r = await client.get(f"{API_PREFIX}/auto-enroll-policy")
            assert r.json()["target_environment_id"] == ids[1]

    @pytest.mark.asyncio
    async def test_put_disable_round_trips(
        self, async_db_session: AsyncSession, test_user
    ) -> None:
        """Opting out is one write, and it is what the GET reports back."""
        app = _build_app(db_session=async_db_session, user=test_user)
        async with _client(app) as client:
            r = await client.put(
                f"{API_PREFIX}/auto-enroll-policy",
                json={"enabled": False, "target_environment_id": None},
            )
            assert r.status_code == 200, r.text
            assert r.json()["enabled"] is False

            r = await client.get(f"{API_PREFIX}/auto-enroll-policy")
            assert r.status_code == 200, r.text
            body = r.json()
            assert body["enabled"] is False
            assert body["configured"] is True

    @pytest.mark.asyncio
    async def test_put_rejects_unknown_environment(
        self, async_db_session: AsyncSession, test_user
    ) -> None:
        """A dangling target is refused rather than stored as a silent no-op."""
        app = _build_app(db_session=async_db_session, user=test_user)
        async with _client(app) as client:
            r = await client.put(
                f"{API_PREFIX}/auto-enroll-policy",
                json={"enabled": True, "target_environment_id": str(uuid4())},
            )
            assert r.status_code == 404, r.text
            assert r.json()["detail"]["code"] == "environment_not_found"

    @pytest.mark.asyncio
    async def test_put_rejects_another_owners_environment(
        self, async_db_session: AsyncSession, test_user, second_user
    ) -> None:
        """A foreign environment is a 404 — never stored, and never confirmed."""
        app_other = _build_app(db_session=async_db_session, user=second_user)
        async with _client(app_other) as client:
            r = await client.post(
                f"{API_PREFIX}/environments",
                json={"name": "Theirs", "description": None},
            )
            assert r.status_code == 201, r.text
            foreign_env_id = r.json()["id"]

        app = _build_app(db_session=async_db_session, user=test_user)
        async with _client(app) as client:
            r = await client.put(
                f"{API_PREFIX}/auto-enroll-policy",
                json={"enabled": True, "target_environment_id": foreign_env_id},
            )
            assert r.status_code == 404, r.text
            assert r.json()["detail"]["code"] == "environment_not_found"

    @pytest.mark.asyncio
    async def test_policy_is_owner_scoped(
        self, async_db_session: AsyncSession, test_user, second_user
    ) -> None:
        """One owner's opt-out never leaks into another owner's policy."""
        app = _build_app(db_session=async_db_session, user=test_user)
        async with _client(app) as client:
            r = await client.put(
                f"{API_PREFIX}/auto-enroll-policy",
                json={"enabled": False, "target_environment_id": None},
            )
            assert r.status_code == 200, r.text

        app_other = _build_app(db_session=async_db_session, user=second_user)
        async with _client(app_other) as client:
            r = await client.get(f"{API_PREFIX}/auto-enroll-policy")
            assert r.status_code == 200, r.text
            assert r.json()["enabled"] is True
            assert r.json()["configured"] is False
