"""
PDF Report Generation Service for Integration Testing Results

Generates comprehensive PDF reports with:
- Executive summary
- Coverage analysis
- Action timeline with screenshots
- Detailed action tables
- State transition diagrams
- Recommendations
"""

import io
import logging
from collections import defaultdict
from datetime import datetime
from pathlib import Path
from typing import Any

from reportlab.graphics.charts.piecharts import Pie
from reportlab.graphics.shapes import Drawing
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import A4, letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import (
    Image,
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

logger = logging.getLogger(__name__)


class PDFReportOptions:
    """Configuration options for PDF report generation"""

    def __init__(
        self,
        include_screenshots: bool = True,
        include_coverage: bool = True,
        include_timeline: bool = True,
        include_recommendations: bool = True,
        include_appendices: bool = True,
        screenshot_quality: str = "medium",  # low, medium, high
        logo_path: str | None = None,
        page_size: str = "letter",  # letter or a4
        title: str | None = None,
    ):
        self.include_screenshots = include_screenshots
        self.include_coverage = include_coverage
        self.include_timeline = include_timeline
        self.include_recommendations = include_recommendations
        self.include_appendices = include_appendices
        self.screenshot_quality = screenshot_quality
        self.logo_path = logo_path
        self.page_size = A4 if page_size == "a4" else letter
        self.title = title


class IntegrationTestPDFReport:
    """Generate PDF reports for integration test execution results"""

    def __init__(self, options: PDFReportOptions = None):
        self.options = options or PDFReportOptions()
        self.styles = getSampleStyleSheet()
        self._setup_custom_styles()
        self.story = []

    def _setup_custom_styles(self):
        """Setup custom paragraph styles"""
        # Title style
        self.styles.add(
            ParagraphStyle(
                name="CustomTitle",
                parent=self.styles["Heading1"],
                fontSize=24,
                textColor=colors.HexColor("#1a202c"),
                spaceAfter=30,
                alignment=TA_CENTER,
                fontName="Helvetica-Bold",
            )
        )

        # Section heading
        self.styles.add(
            ParagraphStyle(
                name="SectionHeading",
                parent=self.styles["Heading2"],
                fontSize=16,
                textColor=colors.HexColor("#2d3748"),
                spaceAfter=12,
                spaceBefore=20,
                fontName="Helvetica-Bold",
            )
        )

        # Subsection heading
        self.styles.add(
            ParagraphStyle(
                name="SubsectionHeading",
                parent=self.styles["Heading3"],
                fontSize=12,
                textColor=colors.HexColor("#4a5568"),
                spaceAfter=8,
                spaceBefore=12,
                fontName="Helvetica-Bold",
            )
        )

        # Body text
        self.styles.add(
            ParagraphStyle(
                name="CustomBody",
                parent=self.styles["BodyText"],
                fontSize=10,
                textColor=colors.HexColor("#2d3748"),
                spaceAfter=6,
            )
        )

    def generate(
        self, execution_result: dict[str, Any], screenshots_dir: Path
    ) -> bytes:
        """
        Generate PDF report from execution result

        Args:
            execution_result: Integration test execution result dictionary
            screenshots_dir: Directory containing screenshot images

        Returns:
            PDF bytes
        """
        buffer = io.BytesIO()

        # Create document
        doc = SimpleDocTemplate(
            buffer,
            pagesize=self.options.page_size,
            rightMargin=72,
            leftMargin=72,
            topMargin=72,
            bottomMargin=72,
        )

        # Build content
        self._build_cover_page(execution_result)
        self.story.append(PageBreak())

        self._build_table_of_contents()
        self.story.append(PageBreak())

        self._build_executive_summary(execution_result)
        self.story.append(Spacer(1, 0.3 * inch))

        if self.options.include_coverage:
            self._build_coverage_analysis(execution_result)
            self.story.append(Spacer(1, 0.3 * inch))

        if self.options.include_timeline:
            self._build_action_timeline(execution_result, screenshots_dir)
            self.story.append(Spacer(1, 0.3 * inch))

        self._build_detailed_results(execution_result)
        self.story.append(Spacer(1, 0.3 * inch))

        if self.options.include_recommendations:
            self._build_recommendations(execution_result)
            self.story.append(Spacer(1, 0.3 * inch))

        if self.options.include_appendices:
            self.story.append(PageBreak())
            self._build_appendices(execution_result, screenshots_dir)

        # Build PDF
        doc.build(
            self.story,
            onFirstPage=self._add_page_number,
            onLaterPages=self._add_page_number,
        )

        pdf_bytes = buffer.getvalue()
        buffer.close()
        return pdf_bytes

    def _add_page_number(self, canvas_obj, doc):
        """Add page numbers to footer"""
        page_num = canvas_obj.getPageNumber()
        text = f"Page {page_num}"
        canvas_obj.saveState()
        canvas_obj.setFont("Helvetica", 9)
        canvas_obj.setFillColor(colors.grey)
        canvas_obj.drawRightString(doc.pagesize[0] - 72, 30, text)
        canvas_obj.restoreState()

    def _build_cover_page(self, result: dict[str, Any]):
        """Build cover page"""
        # Logo if provided
        if self.options.logo_path and Path(self.options.logo_path).exists():
            try:
                logo = Image(self.options.logo_path, width=2 * inch, height=1 * inch)
                self.story.append(logo)
                self.story.append(Spacer(1, 0.5 * inch))
            except Exception as e:
                logger.warning(f"Failed to load logo: {e}")

        # Title
        title = self.options.title or "Integration Test Report"
        self.story.append(Paragraph(title, self.styles["CustomTitle"]))
        self.story.append(Spacer(1, 0.5 * inch))

        # Process name
        process_name = result.get("process_name", "Unknown Process")
        self.story.append(
            Paragraph(
                f"<b>Process:</b> {process_name}",
                self.styles["CustomBody"],
            )
        )
        self.story.append(Spacer(1, 0.2 * inch))

        # Date
        date_str = datetime.now().strftime("%B %d, %Y %H:%M")
        self.story.append(
            Paragraph(f"<b>Generated:</b> {date_str}", self.styles["CustomBody"])
        )
        self.story.append(Spacer(1, 0.5 * inch))

        # Key metrics box
        success_rate = result.get("success_rate", 0) * 100
        total_actions = result.get("total_actions", 0)
        successful_actions = result.get("successful_actions", 0)
        duration = result.get("total_duration_ms", 0)

        metrics_data = [
            ["Metric", "Value"],
            ["Success Rate", f"{success_rate:.1f}%"],
            ["Total Actions", str(total_actions)],
            ["Successful Actions", str(successful_actions)],
            ["Total Duration", f"{duration:.0f}ms"],
        ]

        metrics_table = Table(metrics_data, colWidths=[3 * inch, 2 * inch])
        metrics_table.setStyle(
            TableStyle(
                [
                    ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#3182ce")),
                    ("TEXTCOLOR", (0, 0), (-1, 0), colors.whitesmoke),
                    ("ALIGN", (0, 0), (-1, -1), "CENTER"),
                    ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                    ("FONTSIZE", (0, 0), (-1, 0), 12),
                    ("BOTTOMPADDING", (0, 0), (-1, 0), 12),
                    ("BACKGROUND", (0, 1), (-1, -1), colors.beige),
                    ("GRID", (0, 0), (-1, -1), 1, colors.black),
                    ("FONTNAME", (0, 1), (-1, -1), "Helvetica"),
                    ("FONTSIZE", (0, 1), (-1, -1), 10),
                    ("TOPPADDING", (0, 1), (-1, -1), 8),
                    ("BOTTOMPADDING", (0, 1), (-1, -1), 8),
                ]
            )
        )
        self.story.append(metrics_table)

    def _build_table_of_contents(self):
        """Build table of contents"""
        self.story.append(Paragraph("Table of Contents", self.styles["SectionHeading"]))
        self.story.append(Spacer(1, 0.2 * inch))

        toc_items = [
            "1. Executive Summary",
            "2. Coverage Analysis",
            "3. Action Timeline",
            "4. Detailed Results",
            "5. Recommendations",
            "6. Appendices",
        ]

        for item in toc_items:
            self.story.append(Paragraph(item, self.styles["CustomBody"]))
            self.story.append(Spacer(1, 0.1 * inch))

    def _build_executive_summary(self, result: dict[str, Any]):
        """Build executive summary section"""
        self.story.append(
            Paragraph("1. Executive Summary", self.styles["SectionHeading"])
        )
        self.story.append(Spacer(1, 0.2 * inch))

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
        self.story.append(Paragraph(summary, self.styles["CustomBody"]))
        self.story.append(Spacer(1, 0.2 * inch))

        # Test execution details
        start_time = result.get("start_time", "N/A")
        end_time = result.get("end_time", "N/A")
        duration = result.get("total_duration_ms", 0)

        details = f"""
        <para>
        <b>Execution Period:</b> {start_time} to {end_time}<br/>
        <b>Total Duration:</b> {duration:.0f}ms ({duration/1000:.2f} seconds)<br/>
        <b>Total Actions:</b> {result.get('total_actions', 0)}<br/>
        <b>Successful Actions:</b> {result.get('successful_actions', 0)}<br/>
        </para>
        """
        self.story.append(Paragraph(details, self.styles["CustomBody"]))
        self.story.append(Spacer(1, 0.2 * inch))

        # Success rate pie chart
        self._add_success_rate_chart(result)

    def _add_success_rate_chart(self, result: dict[str, Any]):
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
        self.story.append(drawing)
        self.story.append(Spacer(1, 0.2 * inch))

    def _build_coverage_analysis(self, result: dict[str, Any]):
        """Build coverage analysis section"""
        self.story.append(
            Paragraph("2. Coverage Analysis", self.styles["SectionHeading"])
        )
        self.story.append(Spacer(1, 0.2 * inch))

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
        self.story.append(Paragraph(states_text, self.styles["CustomBody"]))
        self.story.append(Spacer(1, 0.2 * inch))

        # Action type distribution
        action_types = defaultdict(int)
        for action in actions:
            action_types[action.get("action_type", "UNKNOWN")] += 1

        self.story.append(
            Paragraph("Action Type Distribution:", self.styles["SubsectionHeading"])
        )
        self.story.append(Spacer(1, 0.1 * inch))

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
        self.story.append(action_table)

        # Transition analysis
        self.story.append(Spacer(1, 0.2 * inch))
        self._build_transition_analysis(actions)

    def _build_transition_analysis(self, actions: list[dict[str, Any]]):
        """Build state transition analysis"""
        self.story.append(
            Paragraph("State Transitions:", self.styles["SubsectionHeading"])
        )
        self.story.append(Spacer(1, 0.1 * inch))

        transitions = []
        for i in range(len(actions) - 1):
            current_states = set(actions[i].get("active_states", []))
            next_states = set(actions[i + 1].get("active_states", []))

            added = next_states - current_states
            removed = current_states - next_states

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
        self.story.append(Paragraph(transition_text, self.styles["CustomBody"]))

        if transitions[:5]:  # Show first 5 transitions
            trans_data = [["Action #", "Action Type", "States Added", "States Removed"]]
            for trans in transitions[:5]:
                trans_data.append(
                    [
                        str(trans["index"]),
                        trans["action"],
                        ", ".join(trans["added"]) if trans["added"] else "-",
                        ", ".join(trans["removed"]) if trans["removed"] else "-",
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
            self.story.append(trans_table)

    def _build_action_timeline(self, result: dict[str, Any], screenshots_dir: Path):
        """Build action timeline with screenshot thumbnails"""
        self.story.append(
            Paragraph("3. Action Timeline", self.styles["SectionHeading"])
        )
        self.story.append(Spacer(1, 0.2 * inch))

        actions = result.get("actions", [])

        # Add timeline with thumbnails
        for i, action in enumerate(actions):
            self._add_action_timeline_entry(i, action, screenshots_dir)

            # Add page break every 3 actions to prevent overflow
            if (i + 1) % 3 == 0 and i < len(actions) - 1:
                self.story.append(PageBreak())

    def _add_action_timeline_entry(
        self, index: int, action: dict[str, Any], screenshots_dir: Path
    ):
        """Add single action timeline entry"""
        action_type = action.get("action_type", "UNKNOWN")
        success = action.get("success", False)
        duration = action.get("duration_ms", 0)
        states = action.get("active_states", [])

        # Header
        status_color = "green" if success else "red"
        status_text = "✓" if success else "✗"

        header = f"""
        <para>
        <b>Action {index + 1}: {action_type}</b>
        <font color="{status_color}"><b>{status_text}</b></font>
        ({duration:.0f}ms)
        </para>
        """
        self.story.append(Paragraph(header, self.styles["SubsectionHeading"]))

        # States
        if states:
            states_text = f"<para><b>Active States:</b> {', '.join(states)}</para>"
            self.story.append(Paragraph(states_text, self.styles["CustomBody"]))

        # Screenshot thumbnail
        if self.options.include_screenshots:
            screenshot_path = action.get("screenshot_path")
            if screenshot_path:
                full_path = screenshots_dir / screenshot_path
                if full_path.exists():
                    try:
                        # Thumbnail size based on quality
                        if self.options.screenshot_quality == "high":
                            width, height = 5 * inch, 3 * inch
                        elif self.options.screenshot_quality == "low":
                            width, height = 3 * inch, 2 * inch
                        else:  # medium
                            width, height = 4 * inch, 2.5 * inch

                        img = Image(str(full_path), width=width, height=height)
                        self.story.append(img)
                    except Exception as e:
                        logger.warning(
                            f"Failed to load screenshot {screenshot_path}: {e}"
                        )

        self.story.append(Spacer(1, 0.2 * inch))

    def _build_detailed_results(self, result: dict[str, Any]):
        """Build detailed results table"""
        self.story.append(
            Paragraph("4. Detailed Results", self.styles["SectionHeading"])
        )
        self.story.append(Spacer(1, 0.2 * inch))

        actions = result.get("actions", [])

        # Build table
        table_data = [["#", "Type", "Success", "Duration (ms)", "Active States"]]

        for i, action in enumerate(actions):
            table_data.append(
                [
                    str(i + 1),
                    action.get("action_type", "UNKNOWN"),
                    "✓" if action.get("success") else "✗",
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
        self.story.append(results_table)

    def _build_recommendations(self, result: dict[str, Any]):
        """Build recommendations section"""
        self.story.append(
            Paragraph("5. Recommendations", self.styles["SectionHeading"])
        )
        self.story.append(Spacer(1, 0.2 * inch))

        recommendations = self._generate_recommendations(result)

        for i, rec in enumerate(recommendations):
            rec_text = f"<para>{i + 1}. {rec}</para>"
            self.story.append(Paragraph(rec_text, self.styles["CustomBody"]))
            self.story.append(Spacer(1, 0.1 * inch))

    def _generate_recommendations(self, result: dict[str, Any]) -> list[str]:
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
            failed_types = defaultdict(int)
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

    def _build_appendices(self, result: dict[str, Any], screenshots_dir: Path):
        """Build appendices with full screenshots"""
        self.story.append(Paragraph("6. Appendices", self.styles["SectionHeading"]))
        self.story.append(Spacer(1, 0.2 * inch))

        self.story.append(
            Paragraph("A. Full Screenshots", self.styles["SubsectionHeading"])
        )
        self.story.append(Spacer(1, 0.2 * inch))

        actions = result.get("actions", [])

        for i, action in enumerate(actions):
            screenshot_path = action.get("screenshot_path")
            if screenshot_path:
                full_path = screenshots_dir / screenshot_path
                if full_path.exists():
                    try:
                        # Add caption
                        caption = f"<para><b>Screenshot {i + 1}:</b> {action.get('action_type', 'UNKNOWN')}</para>"
                        self.story.append(Paragraph(caption, self.styles["CustomBody"]))

                        # Full size screenshot (fit to page)
                        img = Image(str(full_path), width=6 * inch, height=4 * inch)
                        self.story.append(img)
                        self.story.append(Spacer(1, 0.2 * inch))

                        # Page break every 2 screenshots
                        if (i + 1) % 2 == 0 and i < len(actions) - 1:
                            self.story.append(PageBreak())
                    except Exception as e:
                        logger.warning(
                            f"Failed to load screenshot {screenshot_path}: {e}"
                        )


def generate_pdf_report(
    execution_result: dict[str, Any],
    screenshots_dir: Path,
    options: PDFReportOptions = None,
) -> bytes:
    """
    Generate PDF report for integration test execution

    Args:
        execution_result: Integration test execution result dictionary
        screenshots_dir: Directory containing screenshot images
        options: Report generation options

    Returns:
        PDF bytes ready for download
    """
    report = IntegrationTestPDFReport(options)
    return report.generate(execution_result, screenshots_dir)
