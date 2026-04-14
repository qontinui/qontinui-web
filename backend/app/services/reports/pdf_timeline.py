"""
PDF report action timeline section.
"""

import logging
from pathlib import Path
from typing import Any

from app.services.reports.pdf_options import PDFReportOptions
from reportlab.lib.styles import StyleSheet1
from reportlab.lib.units import inch
from reportlab.platypus import Image, PageBreak, Paragraph, Spacer

logger = logging.getLogger(__name__)


def build_action_timeline(
    story: list[Any],
    result: dict[str, Any],
    screenshots_dir: Path,
    options: PDFReportOptions,
    styles: StyleSheet1,
) -> None:
    """Build action timeline with screenshot thumbnails"""
    story.append(Paragraph("3. Action Timeline", styles["SectionHeading"]))
    story.append(Spacer(1, 0.2 * inch))

    actions = result.get("actions", [])

    # Add timeline with thumbnails
    for i, action in enumerate(actions):
        _add_action_timeline_entry(story, i, action, screenshots_dir, options, styles)

        # Add page break every 3 actions to prevent overflow
        if (i + 1) % 3 == 0 and i < len(actions) - 1:
            story.append(PageBreak())


def _add_action_timeline_entry(
    story: list[Any],
    index: int,
    action: dict[str, Any],
    screenshots_dir: Path,
    options: PDFReportOptions,
    styles: StyleSheet1,
) -> None:
    """Add single action timeline entry"""
    action_type = action.get("action_type", "UNKNOWN")
    success = action.get("success", False)
    duration = action.get("duration_ms", 0)
    states = action.get("active_states", [])

    # Header
    status_color = "green" if success else "red"
    status_text = "\u2713" if success else "\u2717"

    header = f"""
    <para>
    <b>Action {index + 1}: {action_type}</b>
    <font color="{status_color}"><b>{status_text}</b></font>
    ({duration:.0f}ms)
    </para>
    """
    story.append(Paragraph(header, styles["SubsectionHeading"]))

    # States
    if states:
        states_text = f"<para><b>Active States:</b> {', '.join(states)}</para>"
        story.append(Paragraph(states_text, styles["CustomBody"]))

    # Screenshot thumbnail
    if options.include_screenshots:
        screenshot_path = action.get("screenshot_path")
        if screenshot_path:
            full_path = screenshots_dir / screenshot_path
            if full_path.exists():
                try:
                    # Thumbnail size based on quality
                    if options.screenshot_quality == "high":
                        width, height = 5 * inch, 3 * inch
                    elif options.screenshot_quality == "low":
                        width, height = 3 * inch, 2 * inch
                    else:  # medium
                        width, height = 4 * inch, 2.5 * inch

                    img = Image(str(full_path), width=width, height=height)
                    story.append(img)
                except Exception as e:
                    logger.warning(f"Failed to load screenshot {screenshot_path}: {e}")

    story.append(Spacer(1, 0.2 * inch))
