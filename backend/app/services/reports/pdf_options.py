"""
PDF report configuration options.
"""

from reportlab.lib.pagesizes import A4, letter


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
