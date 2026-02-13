"""
PDF report executive summary section.
"""

from typing import Any

from reportlab.graphics.charts.piecharts import Pie
from reportlab.graphics.shapes import Drawing
from reportlab.lib import colors
from reportlab.lib.styles import StyleSheet1
from reportlab.lib.units import inch
from reportlab.platypus import Paragraph, Spacer


def build_executive_summary(
    story: list[Any],
    result: dict[str, Any],
    styles: StyleSheet1,
) -> None:
    """Build executive summary section"""
    story.append(Paragraph("1. Executive Summary", styles["SectionHeading"]))
    story.append(Spacer(1, 0.2 * inch))

    # Overall result
    success = result.get("success", False)
    success_rate = result.get("success_rate", 0) * 100
    process_name = result.get("process_name", "Unknown")

    result_text = "PASSED" if success else "FAILED"
    result_color = "green" if success else "red"

    summary = f"""
    <para>
    The integration test for process <b>{process_name}</b> has <font color="{result_color}"><b>{result_text}</b></font>
    with a success rate of <b>{success_rate:.1f}%</b>.
    </para>
    """
    story.append(Paragraph(summary, styles["CustomBody"]))
    story.append(Spacer(1, 0.2 * inch))

    # Test execution details
    start_time = result.get("start_time", "N/A")
    end_time = result.get("end_time", "N/A")
    duration = result.get("total_duration_ms", 0)

    details = f"""
    <para>
    <b>Execution Period:</b> {start_time} to {end_time}<br/>
    <b>Total Duration:</b> {duration:.0f}ms ({duration / 1000:.2f} seconds)<br/>
    <b>Total Actions:</b> {result.get("total_actions", 0)}<br/>
    <b>Successful Actions:</b> {result.get("successful_actions", 0)}<br/>
    </para>
    """
    story.append(Paragraph(details, styles["CustomBody"]))
    story.append(Spacer(1, 0.2 * inch))

    # Success rate pie chart
    _add_success_rate_chart(story, result)


def _add_success_rate_chart(
    story: list[Any],
    result: dict[str, Any],
) -> None:
    """Add success rate pie chart"""
    successful = result.get("successful_actions", 0)
    failed = result.get("total_actions", 0) - successful

    if successful + failed == 0:
        return

    drawing = Drawing(400, 200)
    pie = Pie()
    pie.x = 150
    pie.y = 50
    pie.width = 100
    pie.height = 100
    pie.data = [successful, failed]
    pie.labels = ["Successful", "Failed"]
    pie.slices.strokeWidth = 0.5
    pie.slices[0].fillColor = colors.HexColor("#48bb78")
    pie.slices[1].fillColor = colors.HexColor("#f56565")

    drawing.add(pie)
    story.append(drawing)
    story.append(Spacer(1, 0.2 * inch))
