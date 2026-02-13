"""
PDF report detailed results and recommendations sections.
"""

from collections import defaultdict
from typing import Any

from reportlab.lib import colors
from reportlab.lib.styles import StyleSheet1
from reportlab.lib.units import inch
from reportlab.platypus import Paragraph, Spacer, Table, TableStyle


def build_detailed_results(
    story: list[Any],
    result: dict[str, Any],
    styles: StyleSheet1,
) -> None:
    """Build detailed results table"""
    story.append(Paragraph("4. Detailed Results", styles["SectionHeading"]))
    story.append(Spacer(1, 0.2 * inch))

    actions = result.get("actions", [])

    # Build table
    table_data = [["#", "Type", "Success", "Duration (ms)", "Active States"]]

    for i, action in enumerate(actions):
        table_data.append(
            [
                str(i + 1),
                action.get("action_type", "UNKNOWN"),
                "\u2713" if action.get("success") else "\u2717",
                f"{action.get('duration_ms', 0):.0f}",
                ", ".join(action.get("active_states", [])[:3])
                + ("..." if len(action.get("active_states", [])) > 3 else ""),
            ]
        )

    results_table = Table(
        table_data,
        colWidths=[0.5 * inch, 1.2 * inch, 0.8 * inch, 1 * inch, 2.5 * inch],
    )
    results_table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), colors.grey),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.whitesmoke),
                ("ALIGN", (0, 0), (-1, -1), "LEFT"),
                ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                ("FONTSIZE", (0, 0), (-1, -1), 8),
                ("BOTTOMPADDING", (0, 0), (-1, 0), 8),
                ("BACKGROUND", (0, 1), (-1, -1), colors.white),
                ("GRID", (0, 0), (-1, -1), 1, colors.black),
                (
                    "ROWBACKGROUNDS",
                    (0, 1),
                    (-1, -1),
                    [colors.white, colors.lightgrey],
                ),
            ]
        )
    )
    story.append(results_table)


def build_recommendations(
    story: list[Any],
    result: dict[str, Any],
    styles: StyleSheet1,
) -> None:
    """Build recommendations section"""
    story.append(Paragraph("5. Recommendations", styles["SectionHeading"]))
    story.append(Spacer(1, 0.2 * inch))

    recommendations = generate_recommendations(result)

    for i, rec in enumerate(recommendations):
        rec_text = f"<para>{i + 1}. {rec}</para>"
        story.append(Paragraph(rec_text, styles["CustomBody"]))
        story.append(Spacer(1, 0.1 * inch))


def generate_recommendations(result: dict[str, Any]) -> list[str]:
    """Generate intelligent recommendations based on results"""
    recommendations = []
    actions = result.get("actions", [])
    success_rate = result.get("success_rate", 0)

    # Success rate based recommendations
    if success_rate < 0.8:
        recommendations.append(
            "Review failed actions and improve pattern recognition accuracy. "
            "Consider updating pattern images or adjusting similarity thresholds."
        )

    # Performance recommendations
    slow_actions = [a for a in actions if a.get("duration_ms", 0) > 5000]
    if slow_actions:
        recommendations.append(
            f"Optimize {len(slow_actions)} slow actions (>5s). "
            "Consider reducing wait times or improving search regions."
        )

    # State coverage
    initial_states = set(result.get("initial_states", []))
    final_states = set(result.get("final_states", []))
    if len(final_states - initial_states) == 0:
        recommendations.append(
            "No new states discovered during execution. "
            "Verify that state definitions are working correctly."
        )

    # Failed actions analysis
    failed_actions = [a for a in actions if not a.get("success")]
    if failed_actions:
        failed_types: defaultdict[str, int] = defaultdict(int)
        for action in failed_actions:
            failed_types[action.get("action_type")] += 1

        most_failed = max(failed_types.items(), key=lambda x: x[1])
        recommendations.append(
            f"Action type '{most_failed[0]}' failed {most_failed[1]} times. "
            "Review these actions for potential issues with timing or pattern quality."
        )

    if not recommendations:
        recommendations.append(
            "Test execution was successful. Continue monitoring for consistency."
        )

    return recommendations
