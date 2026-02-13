"""
PDF report cover page and table of contents.
"""

import logging
from datetime import datetime
from pathlib import Path
from typing import Any

from reportlab.lib import colors
from reportlab.lib.styles import StyleSheet1
from reportlab.lib.units import inch
from reportlab.platypus import Image, Paragraph, Spacer, Table, TableStyle

from app.services.reports.pdf_options import PDFReportOptions

logger = logging.getLogger(__name__)


def build_cover_page(
    story: list[Any],
    result: dict[str, Any],
    options: PDFReportOptions,
    styles: StyleSheet1,
) -> None:
    """Build cover page"""
    # Logo if provided
    if options.logo_path and Path(options.logo_path).exists():
        try:
            logo = Image(options.logo_path, width=2 * inch, height=1 * inch)
            story.append(logo)
            story.append(Spacer(1, 0.5 * inch))
        except Exception as e:
            logger.warning(f"Failed to load logo: {e}")

    # Title
    title = options.title or "Integration Test Report"
    story.append(Paragraph(title, styles["CustomTitle"]))
    story.append(Spacer(1, 0.5 * inch))

    # Process name
    process_name = result.get("process_name", "Unknown Process")
    story.append(
        Paragraph(
            f"<b>Process:</b> {process_name}",
            styles["CustomBody"],
        )
    )
    story.append(Spacer(1, 0.2 * inch))

    # Date
    date_str = datetime.now().strftime("%B %d, %Y %H:%M")
    story.append(Paragraph(f"<b>Generated:</b> {date_str}", styles["CustomBody"]))
    story.append(Spacer(1, 0.5 * inch))

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
    story.append(metrics_table)


def build_table_of_contents(
    story: list[Any],
    styles: StyleSheet1,
) -> None:
    """Build table of contents"""
    story.append(Paragraph("Table of Contents", styles["SectionHeading"]))
    story.append(Spacer(1, 0.2 * inch))

    toc_items = [
        "1. Executive Summary",
        "2. Coverage Analysis",
        "3. Action Timeline",
        "4. Detailed Results",
        "5. Recommendations",
        "6. Appendices",
    ]

    for item in toc_items:
        story.append(Paragraph(item, styles["CustomBody"]))
        story.append(Spacer(1, 0.1 * inch))
