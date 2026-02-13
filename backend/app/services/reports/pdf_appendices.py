"""
PDF report appendices section (full screenshots).
"""

import logging
from pathlib import Path
from typing import Any

from reportlab.lib.styles import StyleSheet1
from reportlab.lib.units import inch
from reportlab.platypus import Image, PageBreak, Paragraph, Spacer

logger = logging.getLogger(__name__)


def build_appendices(
    story: list[Any],
    result: dict[str, Any],
    screenshots_dir: Path,
    styles: StyleSheet1,
) -> None:
    """Build appendices with full screenshots"""
    story.append(Paragraph("6. Appendices", styles["SectionHeading"]))
    story.append(Spacer(1, 0.2 * inch))

    story.append(Paragraph("A. Full Screenshots", styles["SubsectionHeading"]))
    story.append(Spacer(1, 0.2 * inch))

    actions = result.get("actions", [])

    for i, action in enumerate(actions):
        screenshot_path = action.get("screenshot_path")
        if screenshot_path:
            full_path = screenshots_dir / screenshot_path
            if full_path.exists():
                try:
                    # Add caption
                    caption = f"<para><b>Screenshot {i + 1}:</b> {action.get('action_type', 'UNKNOWN')}</para>"
                    story.append(Paragraph(caption, styles["CustomBody"]))

                    # Full size screenshot (fit to page)
                    img = Image(str(full_path), width=6 * inch, height=4 * inch)
                    story.append(img)
                    story.append(Spacer(1, 0.2 * inch))

                    # Page break every 2 screenshots
                    if (i + 1) % 2 == 0 and i < len(actions) - 1:
                        story.append(PageBreak())
                except Exception as e:
                    logger.warning(f"Failed to load screenshot {screenshot_path}: {e}")
