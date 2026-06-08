"""
Notification builders for test-related notifications.

Provides utilities for building notification data objects.
"""

from dataclasses import dataclass
from decimal import Decimal
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.software_test_run import SoftwareTestRun
from app.models.test_deficiency import DeficiencySeverity, TestDeficiency
from app.schemas.test_notifications import (
    CoverageAlertNotification,
    DeficiencyNotification,
    TestRunNotification,
)

# Human-readable labels for coord's ``block_reason_code`` enum. Unknown
# codes fall back to a humanised form of the raw code so a new coord reason
# never produces an empty/ugly title.
_GATE_REASON_LABELS: dict[str, str] = {
    "blast_radius": "large blast radius",
    "removes_referenced_export": "removes a referenced export",
    "coverage_drop": "a coverage drop",
    "breaking_change": "a potential breaking change",
    "cross_repo_impact": "cross-repo impact",
}


def _gate_reason_label(block_reason_code: str | None) -> str:
    if not block_reason_code:
        return "review required"
    return _GATE_REASON_LABELS.get(
        block_reason_code, block_reason_code.replace("_", " ")
    )


@dataclass(frozen=True)
class GateActionNotification:
    """Built title + message + deep-link metadata for a GATE_ACTION.

    ``metadata`` is the dedupe key carrier (repo / pr_number / head_sha /
    block_reason_code) plus deep-link info; the message is honesty-scoped
    (graph availability + partial coverage) — see
    :func:`build_gate_action_notification`.
    """

    title: str
    message: str
    metadata: dict[str, Any]


def build_gate_action_notification(
    *,
    repo: str,
    pr_number: int,
    block_reason_code: str | None,
    head_sha: str | None,
    coverage: float | None,
    graph_available: bool,
    evidence: Any | None = None,
) -> GateActionNotification:
    """Build a merge-gate-escalation (GATE_ACTION) notification.

    Honesty rules (T3 N3):

    * When ``graph_available`` is false, the message states the decision
      was made *without a code graph* and is therefore non-authoritative.
    * When ``coverage`` is present and < 1.0, the message states the
      analysis ran under *partial coverage (NN%)*.
    * Never implies authoritative certainty the gate does not have.

    Metadata carries the dedupe key (``repo``/``pr_number``/``head_sha``/
    ``block_reason_code``) and deep-link info (PR URL + the ``/operations``
    panel pointer) for the in-app + email surfaces.
    """
    reason_label = _gate_reason_label(block_reason_code)
    pr_url = f"https://github.com/{repo}/pull/{pr_number}"

    title = f"Review required: {repo}#{pr_number} ({reason_label})"

    parts: list[str] = [
        f"The merge gate escalated pull request {repo}#{pr_number} to "
        f"specialist review because of {reason_label}.",
    ]

    # Honesty: confidence qualifiers. Order matters — graph availability is
    # the strongest caveat, coverage refines it.
    if not graph_available:
        parts.append(
            "This decision was made without a code graph, so it is "
            "non-authoritative and may be over- or under-inclusive."
        )
    if coverage is not None and coverage < 1.0:
        pct = round(coverage * 100)
        parts.append(f"Analysis ran under partial coverage ({pct}%).")

    parts.append(f"Review the pull request: {pr_url}")

    message = " ".join(parts)

    metadata: dict[str, Any] = {
        "repo": repo,
        "pr_number": pr_number,
        "head_sha": head_sha,
        "block_reason_code": block_reason_code,
        "pr_url": pr_url,
        # Deep-link pointer to the operations console where gate activity
        # is surfaced (the frontend resolves the panel from this hint).
        "operations_panel": "/operations",
        "graph_available": graph_available,
        "coverage": coverage,
    }
    if evidence is not None:
        metadata["evidence"] = evidence

    return GateActionNotification(title=title, message=message, metadata=metadata)


class TestNotificationBuilder:
    """Builder for test-related notification data."""

    async def build_test_run_notification(
        self, db: AsyncSession, test_run: SoftwareTestRun, frontend_url: str
    ) -> TestRunNotification:
        """Build test run notification data."""
        # Count deficiencies by severity
        result = await db.execute(
            select(TestDeficiency).filter(TestDeficiency.test_run_id == test_run.id)
        )
        deficiencies = result.scalars().all()

        critical_count = sum(
            1 for d in deficiencies if d.severity == DeficiencySeverity.CRITICAL
        )
        high_count = sum(
            1 for d in deficiencies if d.severity == DeficiencySeverity.HIGH
        )

        # Calculate duration
        duration = None
        if test_run.completed_at and test_run.started_at:
            duration = int(
                (test_run.completed_at - test_run.started_at).total_seconds()
            )

        # Build URLs
        dashboard_url = (
            f"{frontend_url}/projects/{test_run.project_id}/testing/runs/{test_run.id}"
        )
        report_url = f"{dashboard_url}/report"

        return TestRunNotification(
            test_run_id=test_run.id,
            project_id=test_run.project_id,
            workflow_id=test_run.workflow_id,
            status=test_run.status,
            started_at=test_run.started_at,
            completed_at=test_run.completed_at,
            total_transitions=test_run.total_transitions,
            successful_transitions=test_run.successful_transitions,
            failed_transitions=test_run.failed_transitions,
            skipped_transitions=test_run.skipped_transitions,
            coverage_percentage=test_run.coverage_percentage,
            unique_states_visited=test_run.unique_states_visited,
            unique_paths_found=test_run.unique_paths_found,
            deficiencies_found=test_run.deficiencies_found,
            critical_deficiencies=critical_count,
            high_deficiencies=high_count,
            dashboard_url=dashboard_url,
            report_url=report_url,
            duration_seconds=duration,
            error_summary=test_run.error_summary,
        )

    async def build_deficiency_notification(
        self, db: AsyncSession, deficiency: TestDeficiency, frontend_url: str
    ) -> DeficiencyNotification:
        """Build deficiency notification data."""
        # Get test run for project context
        result = await db.execute(
            select(SoftwareTestRun).filter(SoftwareTestRun.id == deficiency.test_run_id)
        )
        test_run = result.scalar_one_or_none()

        # Build URLs
        deficiency_url = (
            f"{frontend_url}/projects/{test_run.project_id}/testing/deficiencies/{deficiency.id}"
            if test_run
            else None
        )
        test_run_url = (
            f"{frontend_url}/projects/{test_run.project_id}/testing/runs/{test_run.id}"
            if test_run
            else None
        )

        return DeficiencyNotification(
            deficiency_id=deficiency.id,
            test_run_id=deficiency.test_run_id,
            project_id=test_run.project_id if test_run else UUID(int=0),
            severity=deficiency.severity,
            deficiency_type=deficiency.deficiency_type,
            title=deficiency.title,
            description=deficiency.description,
            screenshot_urls=deficiency.screenshot_urls,
            video_url=deficiency.video_url,
            reproducible=deficiency.reproducible,
            reproduction_rate=deficiency.reproduction_rate,
            environment_info=deficiency.environment_info,
            workflow_id=test_run.workflow_id if test_run else None,
            deficiency_url=deficiency_url,
            test_run_url=test_run_url,
            first_seen_at=deficiency.first_seen_at,
            occurrence_count=deficiency.occurrence_count,
        )

    async def build_coverage_alert_notification(
        self,
        test_run: SoftwareTestRun | None,
        project_id: UUID,
        current_coverage: Decimal,
        previous_coverage: Decimal | None,
        threshold: Decimal,
        frontend_url: str,
    ) -> CoverageAlertNotification:
        """Build coverage alert notification data."""
        coverage_drop = None
        if previous_coverage is not None:
            coverage_drop = previous_coverage - current_coverage

        # Build URLs
        dashboard_url = (
            f"{frontend_url}/projects/{project_id}/testing/coverage"
            if test_run
            else None
        )
        report_url = (
            f"{frontend_url}/projects/{project_id}/testing/runs/{test_run.id}/coverage"
            if test_run
            else None
        )

        return CoverageAlertNotification(
            test_run_id=test_run.id if test_run else UUID(int=0),
            project_id=project_id,
            current_coverage=current_coverage,
            previous_coverage=previous_coverage,
            threshold=threshold,
            coverage_drop=coverage_drop,
            workflow_id=test_run.workflow_id if test_run else None,
            states_covered=test_run.unique_states_visited if test_run else 0,
            states_total=0,  # Would need separate query
            transitions_covered=test_run.successful_transitions if test_run else 0,
            transitions_total=test_run.total_transitions if test_run else 0,
            dashboard_url=dashboard_url,
            report_url=report_url,
        )


# Global instance
test_notification_builder = TestNotificationBuilder()
