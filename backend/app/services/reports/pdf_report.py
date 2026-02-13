"""
PDF Report orchestrator for Integration Testing Results.

Generates comprehensive PDF reports by delegating to section builders.
"""

import io
from pathlib import Path
from typing import Any

from reportlab.lib import colors
from reportlab.lib.units import inch
from reportlab.platypus import PageBreak, SimpleDocTemplate, Spacer

from app.services.reports.pdf_analysis import build_coverage_analysis
from app.services.reports.pdf_appendices import build_appendices
from app.services.reports.pdf_cover import build_cover_page, build_table_of_contents
from app.services.reports.pdf_details import (
    build_detailed_results,
    build_recommendations,
)
from app.services.reports.pdf_options import PDFReportOptions
from app.services.reports.pdf_styles import setup_custom_styles
from app.services.reports.pdf_summary import build_executive_summary
from app.services.reports.pdf_timeline import build_action_timeline


class IntegrationTestPDFReport:
    """Generate PDF reports for integration test execution results"""

    def __init__(self, options: PDFReportOptions | None = None):
        self.options = options or PDFReportOptions()
        self.styles = setup_custom_styles()
        self.story: list[Any] = []

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
        build_cover_page(self.story, execution_result, self.options, self.styles)
        self.story.append(PageBreak())

        build_table_of_contents(self.story, self.styles)
        self.story.append(PageBreak())

        build_executive_summary(self.story, execution_result, self.styles)
        self.story.append(Spacer(1, 0.3 * inch))

        if self.options.include_coverage:
            build_coverage_analysis(self.story, execution_result, self.styles)
            self.story.append(Spacer(1, 0.3 * inch))

        if self.options.include_timeline:
            build_action_timeline(
                self.story, execution_result, screenshots_dir, self.options, self.styles
            )
            self.story.append(Spacer(1, 0.3 * inch))

        build_detailed_results(self.story, execution_result, self.styles)
        self.story.append(Spacer(1, 0.3 * inch))

        if self.options.include_recommendations:
            build_recommendations(self.story, execution_result, self.styles)
            self.story.append(Spacer(1, 0.3 * inch))

        if self.options.include_appendices:
            self.story.append(PageBreak())
            build_appendices(self.story, execution_result, screenshots_dir, self.styles)

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


def generate_pdf_report(
    execution_result: dict[str, Any],
    screenshots_dir: Path,
    options: PDFReportOptions | None = None,
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
