"""
Report generation services.

Re-exports IntegrationTestPDFReport, PDFReportOptions, and generate_pdf_report
for backward compatibility with the old app.services.pdf_report import path.
"""

from app.services.reports.pdf_options import PDFReportOptions
from app.services.reports.pdf_report import (
    IntegrationTestPDFReport,
    generate_pdf_report,
)

__all__ = [
    "IntegrationTestPDFReport",
    "PDFReportOptions",
    "generate_pdf_report",
]
