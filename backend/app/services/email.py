import logging
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

import aiosmtplib

from app.core.config import settings

logger = logging.getLogger(__name__)


class EmailService:
    @staticmethod
    async def send_email(
        to_email: str, subject: str, body: str, html_body: str | None = None
    ) -> bool:
        """Send an email using SMTP"""

        # Check if email is configured
        if not settings.SMTP_HOST:
            logger.warning("SMTP not configured, skipping email send")
            logger.info(f"Would send email to {to_email}: {subject}")
            return False

        try:
            message = MIMEMultipart("alternative")
            message["Subject"] = subject
            message["From"] = settings.SMTP_FROM_EMAIL
            message["To"] = to_email

            # Add plain text part
            text_part = MIMEText(body, "plain")
            message.attach(text_part)

            # Add HTML part if provided
            if html_body:
                html_part = MIMEText(html_body, "html")
                message.attach(html_part)

            # Send email
            await aiosmtplib.send(
                message,
                hostname=settings.SMTP_HOST,
                port=settings.SMTP_PORT,
                start_tls=settings.SMTP_TLS,
                username=settings.SMTP_USER if settings.SMTP_USER else None,
                password=settings.SMTP_PASSWORD if settings.SMTP_PASSWORD else None,
            )

            logger.info(f"Email sent successfully to {to_email}")
            return True

        except Exception as e:
            logger.error(f"Failed to send email to {to_email}: {str(e)}")
            return False

    @staticmethod
    async def send_beta_welcome_email(
        to_email: str, username: str, temp_password: str
    ) -> bool:
        """Send welcome email to beta users"""

        subject = "🎉 Welcome to Qontinui Beta!"

        body = f"""Welcome to Qontinui Beta!

Thank you for joining our beta program. Your account has been created with the following credentials:

Username: {username}
Temporary Password: {temp_password}

Please log in at: {settings.FRONTEND_URL}/login

For security reasons, we recommend changing your password after your first login.

If you have any questions or feedback, please don't hesitate to reach out.

Best regards,
The Qontinui Team
"""

        html_body = f"""
<!DOCTYPE html>
<html>
<head>
    <style>
        body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; }}
        .container {{ max-width: 600px; margin: 0 auto; padding: 20px; }}
        .header {{ background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; border-radius: 10px 10px 0 0; }}
        .content {{ background: #f7f7f7; padding: 30px; border-radius: 0 0 10px 10px; }}
        .credentials {{ background: white; padding: 20px; border-radius: 8px; margin: 20px 0; }}
        .button {{ display: inline-block; padding: 12px 30px; background: #667eea; color: white; text-decoration: none; border-radius: 5px; margin-top: 20px; }}
        code {{ background: #f0f0f0; padding: 2px 6px; border-radius: 3px; font-family: monospace; }}
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🎉 Welcome to Qontinui Beta!</h1>
        </div>
        <div class="content">
            <p>Thank you for joining our beta program! We're excited to have you on board.</p>

            <div class="credentials">
                <h3>Your Login Credentials</h3>
                <p><strong>Username:</strong> <code>{username}</code></p>
                <p><strong>Temporary Password:</strong> <code>{temp_password}</code></p>
            </div>

            <p>For security reasons, we recommend changing your password after your first login.</p>

            <a href="{settings.FRONTEND_URL}/login" class="button">Login to Qontinui</a>

            <p style="margin-top: 30px; color: #666;">
                If you have any questions or feedback, please don't hesitate to reach out.<br><br>
                Best regards,<br>
                The Qontinui Team
            </p>
        </div>
    </div>
</body>
</html>
"""

        return await EmailService.send_email(to_email, subject, body, html_body)

    @staticmethod
    async def send_password_reset_email(
        to_email: str, username: str, reset_token: str
    ) -> bool:
        """Send password reset email"""

        reset_url = f"{settings.FRONTEND_URL}/reset-password?token={reset_token}"
        subject = "Qontinui - Password Reset Request"

        body = f"""Password Reset Request

Hi {username},

We received a request to reset your password. Click the link below to reset it:

{reset_url}

This link will expire in 1 hour.

If you didn't request this, please ignore this email.

Best regards,
The Qontinui Team
"""

        html_body = f"""
<!DOCTYPE html>
<html>
<head>
    <style>
        body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; }}
        .container {{ max-width: 600px; margin: 0 auto; padding: 20px; }}
        .header {{ background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; border-radius: 10px 10px 0 0; }}
        .content {{ background: #f7f7f7; padding: 30px; border-radius: 0 0 10px 10px; }}
        .button {{ display: inline-block; padding: 12px 30px; background: #667eea; color: white; text-decoration: none; border-radius: 5px; margin-top: 20px; }}
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>Password Reset Request</h1>
        </div>
        <div class="content">
            <p>Hi {username},</p>
            <p>We received a request to reset your password. Click the button below to reset it:</p>

            <a href="{reset_url}" class="button">Reset Password</a>

            <p style="margin-top: 30px; color: #666;">
                This link will expire in 1 hour.<br><br>
                If you didn't request this, please ignore this email.<br><br>
                Best regards,<br>
                The Qontinui Team
            </p>
        </div>
    </div>
</body>
</html>
"""

        return await EmailService.send_email(to_email, subject, body, html_body)


email_service = EmailService()
