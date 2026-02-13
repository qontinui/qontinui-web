"""
PDF report custom styles.

Defines paragraph styles used across all PDF report sections.
"""

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet


def setup_custom_styles():
    """Setup and return custom paragraph styles for the PDF report."""
    styles = getSampleStyleSheet()

    # Title style
    styles.add(
        ParagraphStyle(
            name="CustomTitle",
            parent=styles["Heading1"],
            fontSize=24,
            textColor=colors.HexColor("#1a202c"),
            spaceAfter=30,
            alignment=TA_CENTER,
            fontName="Helvetica-Bold",
        )
    )

    # Section heading
    styles.add(
        ParagraphStyle(
            name="SectionHeading",
            parent=styles["Heading2"],
            fontSize=16,
            textColor=colors.HexColor("#2d3748"),
            spaceAfter=12,
            spaceBefore=20,
            fontName="Helvetica-Bold",
        )
    )

    # Subsection heading
    styles.add(
        ParagraphStyle(
            name="SubsectionHeading",
            parent=styles["Heading3"],
            fontSize=12,
            textColor=colors.HexColor("#4a5568"),
            spaceAfter=8,
            spaceBefore=12,
            fontName="Helvetica-Bold",
        )
    )

    # Body text
    styles.add(
        ParagraphStyle(
            name="CustomBody",
            parent=styles["BodyText"],
            fontSize=10,
            textColor=colors.HexColor("#2d3748"),
            spaceAfter=6,
        )
    )

    return styles
