"""
PDF report coverage and transition analysis sections.
"""

from collections import defaultdict
from typing import Any, cast

from reportlab.lib import colors
from reportlab.lib.styles import StyleSheet1
from reportlab.lib.units import inch
from reportlab.platypus import Paragraph, Spacer, Table, TableStyle


def build_coverage_analysis(
    story: list[Any],
    result: dict[str, Any],
    styles: StyleSheet1,
) -> None:
    """Build coverage analysis section"""
    story.append(Paragraph("2. Coverage Analysis", styles["SectionHeading"]))
    story.append(Spacer(1, 0.2 * inch))

    actions = result.get("actions", [])

    # State coverage
    initial_states = set(result.get("initial_states", []))
    final_states = set(result.get("final_states", []))
    all_states = set()

    for action in actions:
        all_states.update(action.get("active_states", []))

    states_text = f"""
    <para>
    <b>State Coverage:</b><br/>
    - Initial States: {len(initial_states)}<br/>
    - Final States: {len(final_states)}<br/>
    - Total Unique States: {len(all_states)}<br/>
    - New States Discovered: {len(final_states - initial_states)}
    </para>
    """
    story.append(Paragraph(states_text, styles["CustomBody"]))
    story.append(Spacer(1, 0.2 * inch))

    # Action type distribution
    action_types: defaultdict[str, int] = defaultdict(int)
    for action in actions:
        action_types[action.get("action_type", "UNKNOWN")] += 1

    story.append(Paragraph("Action Type Distribution:", styles["SubsectionHeading"]))
    story.append(Spacer(1, 0.1 * inch))

    action_data = [["Action Type", "Count"]]
    for action_type, count in sorted(action_types.items()):
        action_data.append([action_type, str(count)])

    action_table = Table(action_data, colWidths=[2 * inch, 1 * inch])
    action_table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), colors.grey),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.whitesmoke),
                ("ALIGN", (0, 0), (-1, -1), "LEFT"),
                ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                ("FONTSIZE", (0, 0), (-1, 0), 10),
                ("BOTTOMPADDING", (0, 0), (-1, 0), 8),
                ("BACKGROUND", (0, 1), (-1, -1), colors.white),
                ("GRID", (0, 0), (-1, -1), 1, colors.black),
            ]
        )
    )
    story.append(action_table)

    # Transition analysis
    story.append(Spacer(1, 0.2 * inch))
    build_transition_analysis(story, actions, styles)


def build_transition_analysis(
    story: list[Any],
    actions: list[dict[str, Any]],
    styles: StyleSheet1,
) -> None:
    """Build state transition analysis"""
    story.append(Paragraph("State Transitions:", styles["SubsectionHeading"]))
    story.append(Spacer(1, 0.1 * inch))

    transitions: list[dict[str, Any]] = []
    for i in range(len(actions) - 1):
        current_states = set(actions[i].get("active_states", []))
        next_states = set(actions[i + 1].get("active_states", []))

        added: set[str] = next_states - current_states
        removed: set[str] = current_states - next_states

        if added or removed:
            transitions.append(
                {
                    "index": i + 1,
                    "action": actions[i].get("action_type"),
                    "added": added,
                    "removed": removed,
                }
            )

    transition_text = f"""
    <para>
    <b>Total State Transitions:</b> {len(transitions)}<br/>
    </para>
    """
    story.append(Paragraph(transition_text, styles["CustomBody"]))

    if transitions[:5]:  # Show first 5 transitions
        trans_data = [["Action #", "Action Type", "States Added", "States Removed"]]
        for trans in transitions[:5]:
            added_states = cast(set[str], trans["added"])
            removed_states = cast(set[str], trans["removed"])
            trans_data.append(
                [
                    str(trans["index"]),
                    (
                        str(trans["action"])
                        if trans["action"] is not None
                        else "UNKNOWN"
                    ),
                    ", ".join(sorted(added_states)) if added_states else "-",
                    ", ".join(sorted(removed_states)) if removed_states else "-",
                ]
            )

        trans_table = Table(
            trans_data, colWidths=[0.8 * inch, 1.2 * inch, 2 * inch, 2 * inch]
        )
        trans_table.setStyle(
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
                ]
            )
        )
        story.append(trans_table)
