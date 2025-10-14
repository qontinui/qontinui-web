"""Email services - refactored architecture."""

from app.services.email.email_composers import (
    BetaWelcomeEmailComposer,
    EmailVerificationComposer,
    PasswordResetEmailComposer,
    ResendVerificationEmailComposer,
)
from app.services.email.email_template_service import EmailTemplateService
from app.services.email.email_transport_service import EmailTransportService

__all__ = [
    "EmailTransportService",
    "EmailTemplateService",
    "BetaWelcomeEmailComposer",
    "PasswordResetEmailComposer",
    "EmailVerificationComposer",
    "ResendVerificationEmailComposer",
]
