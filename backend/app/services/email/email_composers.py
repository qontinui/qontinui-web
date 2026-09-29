"""Email composer classes - handle specific email types."""

import re

import structlog

from app.core.config import settings
from app.models.user import User
from app.services.email.email_template_service import EmailTemplateService
from app.services.email.email_transport_service import EmailTransportService

logger = structlog.get_logger(__name__)


class BaseEmailComposer:
    """Base class for email composers."""

    def __init__(
        self,
        template_service: EmailTemplateService,
        transport_service: EmailTransportService,
    ):
        """
        Initialize the composer.

        Args:
            template_service: Service for rendering templates
            transport_service: Service for sending emails
        """
        self.template_service = template_service
        self.transport_service = transport_service


class BetaWelcomeEmailComposer(BaseEmailComposer):
    """Composes and sends beta welcome emails."""

    async def send(self, user: User, temp_password: str) -> bool:
        """
        Send beta welcome email to a new user.

        Args:
            user: User model instance
            temp_password: Temporary password generated for the user

        Returns:
            True if email sent successfully
        """
        context = {
            "username": user.username,
            "temp_password": temp_password,
            "login_url": f"{settings.FRONTEND_URL}/login",
        }

        html_body = self.template_service.render_template("beta_welcome", context)

        return await self.transport_service.send_email(
            to_email=user.email,
            subject="🎉 Welcome to Qontinui Beta!",
            text_body="",
            html_body=html_body,
        )


#: coord role → the product tier label a person recognises. The dashboard's
#: `TIER_OPTIONS` (`frontend/src/app/(app)/admin/coord/members/page.tsx`) is
#: the same table: an administrator who granted "Developer" should not read
#: the word "operator" in the email their colleague received.
_MEMBER_ROLE_LABELS = {
    "admin": "Administrator",
    "operator": "Developer",
}

#: What the email calls a tenant whose human-readable name could not be
#: resolved. A raw UUID in front of a person is not a name — it is an internal
#: identifier that makes a legitimate email read like a phishing attempt.
_UNNAMED_TENANT = "a team"

#: How much of a tenant name may reach the recipient.
#:
#: A tenant's ``display_name`` is chosen by whoever created the tenant, which
#: is any authenticated user — tenant creation is self-service — and coord
#: validates only that it slugifies, up to
#: ``tenant_self_service::MAX_DISPLAY_NAME_CHARS``, which is **200**. So this
#: string is ATTACKER-CONTROLLED text inside a genuine, DKIM-signed email from
#: the product's own sender.
#:
#: 200 is the number to design against, not the 120 in this repo's own
#: ``_TenantCreateBody``: that caps ONE client path (qontinui-web's create
#: proxy). Coord owns the column, accepts 200 on its own route, and also
#: writes display names from the SSO auto-provision and group auto-create
#: paths — so 120 bounds what this UI sends, never what a name read back
#: from ``coord.tenants`` can be.
#:
#: This is not an escaping problem: the HTML template autoescapes, and the
#: transport builds the subject as a structured SES parameter rather than a
#: raw header, so neither HTML nor header injection is reachable. It is a
#: CONTENT-SPOOFING problem — 200 characters is ample room for a convincing
#: second sentence ("… — your password has expired, click here"). Forty is
#: enough to recognise a team you belong to and too little to write a
#: plausible instruction.
_MEMBER_TENANT_NAME_MAX = 40

#: Characters that must never survive into a rendered name.
#:
#: Three groups, and the LAST two are the ones that matter for spoofing:
#:
#: * C0/C1 controls (includes CR and LF) and the Unicode line/paragraph
#:   separators. Stripped for tidiness rather than for safety — neither HTML
#:   nor header injection is reachable here.
#: * **Bidirectional formatting**: U+061C, the embeddings/overrides
#:   U+202A–U+202E, and the isolates U+2066–U+2069. A bare RIGHT-TO-LEFT
#:   OVERRIDE reverses the rendering of everything after it, so forty
#:   characters is more than enough to make the rest of a line read as
#:   something else entirely — and in the plain-text part there is no markup
#:   boundary to stop it leaking into the sentences that follow.
#: * **Zero-width and invisible**: U+200B–U+200F (ZWSP/ZWNJ/ZWJ/LRM/RLM),
#:   U+2060–U+2064, U+FEFF (ZWNBSP) and U+180E. These are invisible, so they
#:   let a name pass a human review while carrying content a filter or a
#:   reader would otherwise catch, and they defeat length intuition because
#:   they cost characters while rendering as nothing.
#:
#: Every code point below is written as a BACKSLASH ESCAPE inside a raw
#: string, never as the literal character. A module whose job is to stop
#: bidirectional overrides reaching a reader must not ship them to its own
#: reviewers: a literal U+202E reverses the rendering of the source line it
#: sits on, and a literal U+2028 makes `str.splitlines` disagree with the
#: file's real line numbering below it — Trojan Source, in the one file least
#: able to afford it. Ruff's enabled rule set does not flag either. `re`
#: interprets these escapes itself, so the compiled class is identical.
_CONTROL_CHARS = re.compile(
    "["
    r"\x00-\x1f\x7f-\x9f"  # C0 / C1 controls, incl. CR and LF
    r"\u061c"  # ARABIC LETTER MARK
    r"\u180e"  # MONGOLIAN VOWEL SEPARATOR
    r"\u200b-\u200f"  # ZWSP, ZWNJ, ZWJ, LRM, RLM
    r"\u2028\u2029"  # LINE / PARAGRAPH SEPARATOR
    r"\u202a-\u202e"  # LRE, RLE, PDF, LRO, RLO
    r"\u2060-\u2064"  # WJ, invisible operators
    r"\u2066-\u2069"  # LRI, RLI, FSI, PDI
    r"\ufeff"  # ZWNBSP / BOM
    "]"
)


def _safe_tenant_name(tenant_name: str | None) -> str:
    """Render an operator-supplied tenant name safe to show a recipient.

    Strips control characters, collapses internal whitespace to single
    spaces, and truncates to :data:`_MEMBER_TENANT_NAME_MAX` characters with
    an ellipsis. Anything left empty falls back to :data:`_UNNAMED_TENANT`.
    """
    if not tenant_name:
        return _UNNAMED_TENANT
    cleaned = _CONTROL_CHARS.sub(" ", tenant_name)
    cleaned = " ".join(cleaned.split())
    if not cleaned:
        return _UNNAMED_TENANT
    if len(cleaned) > _MEMBER_TENANT_NAME_MAX:
        cleaned = cleaned[: _MEMBER_TENANT_NAME_MAX - 1].rstrip() + "…"
    return cleaned


#: The subject line, fixed. The tenant name is deliberately NOT in it.
#:
#: The subject is what a recipient sees in a list of messages, before any
#: context, and it is the line most often screenshotted or quoted — so it is
#: the highest-value place to plant spoofed text and the lowest-value place
#: to spend a name the body repeats twice anyway. Keeping it constant means
#: no attacker-chosen character reaches it at all.
_MEMBER_ADDED_SUBJECT = "You have been given access to a team on Qontinui"


class MemberAddedNoticeComposer(BaseEmailComposer):
    """Tells somebody who ALREADY has an account that they were given access.

    The gap this closes: ``POST /coord/tenant-members`` has three grant arms,
    and only the CONFIRMED-account one (``added``) sent nothing at all. A
    person granted access that way found out by being told out of band, or
    not at all.

    Two things make this deliberately unlike every other composer here:

    * **It takes an email address, not a :class:`~app.models.user.User`.** The
      caller resolved a Cognito identity and a coord operator; there may be no
      ``users`` row for them in THIS backend's database at all, and requiring
      one would make the notice unsendable in exactly the case it exists for.
    * **It carries no credential of any kind** — no temporary password, no
      reset link, no token. The recipient already has an account and already
      knows how to sign in. An email that offers them a credential they did
      not ask for is indistinguishable from a phishing attempt, and training
      people to click those is a security defect, not a nicety.
    """

    async def send(
        self,
        *,
        email: str,
        role: str,
        tenant_name: str | None = None,
    ) -> bool:
        """
        Send the "you have been given access" notice.

        Args:
            email: Recipient's email address — the address the administrator
                typed, which is the one the grant was made against.
            role: The coord role granted (``admin`` / ``operator``). An
                unknown role is rendered verbatim rather than dropped: saying
                the wrong thing about what they can do would be worse than
                showing them coord's own word for it.
            tenant_name: The tenant's human-readable name (display name, else
                slug). ``None`` — unresolvable, or a bare identifier — renders
                as "a team". Operator-supplied, so it is sanitised and
                truncated by :func:`_safe_tenant_name` before it is rendered,
                and it never reaches the subject line.

        Returns:
            True if the email was handed to a transport successfully. False
            is a REAL outcome here, not an exception: ``send_email`` reports
            every transport failure by returning ``False`` rather than
            raising, so the caller must be able to report "not sent" instead
            of treating the send as having happened.

        The shared ``EmailTransportService`` is the only path used, and not
        merely for tidiness: the web task role is granted ``ses:SendEmail``
        (what ``_send_via_ses_api`` calls) and not ``ses:SendRawEmail``, so a
        second, hand-rolled raw-MIME sender would be refused at IAM.
        """
        tenant_label = _safe_tenant_name(tenant_name)
        role_label = _MEMBER_ROLE_LABELS.get(role, role)

        # An ABSENT template must not become a delivered blank email.
        # `render_template` swallows `TemplateNotFound` and falls back to a
        # body built from `title` / `message` context keys, which this
        # composer does not set — so a template missing from the image would
        # render `<html><body><h2>Notification</h2><p></p></body></html>`,
        # the transport would return True, and the operator would be told the
        # mail went out. Refusing here turns that into the `not_sent` the
        # caller already knows how to report.
        if not self.template_service.template_exists("member_added"):
            logger.error(
                "member_added_notice_template_missing",
                template="member_added",
                template_dir=str(self.template_service.template_dir),
            )
            return False

        context = {
            "tenant_name": tenant_label,
            "role_label": role_label,
            "login_url": f"{settings.FRONTEND_URL}/login",
        }

        html_body = self.template_service.render_template("member_added", context)
        text_body = self.template_service.render_text_template("member_added", context)

        # Belt and braces for the same failure in a shape `template_exists`
        # cannot see — a present but empty file, or a render that produced
        # nothing. An empty email is never a successful send.
        if not html_body.strip() or not text_body.strip():
            logger.error(
                "member_added_notice_render_empty",
                html_chars=len(html_body.strip()),
                text_chars=len(text_body.strip()),
            )
            return False

        return await self.transport_service.send_email(
            to_email=email,
            subject=_MEMBER_ADDED_SUBJECT,
            text_body=text_body,
            html_body=html_body,
        )


class PasswordResetEmailComposer(BaseEmailComposer):
    """Composes and sends password reset emails."""

    async def send(self, user: User, reset_token: str) -> bool:
        """
        Send password reset email.

        Args:
            user: User model instance
            reset_token: Password reset token

        Returns:
            True if email sent successfully
        """
        reset_url = f"{settings.FRONTEND_URL}/reset-password?token={reset_token}"

        context = {
            "username": user.username,
            "reset_url": reset_url,
        }

        html_body = self.template_service.render_template("password_reset", context)

        return await self.transport_service.send_email(
            to_email=user.email,
            subject="Qontinui - Password Reset Request",
            text_body="",
            html_body=html_body,
        )


class EmailVerificationComposer(BaseEmailComposer):
    """Composes and sends email verification emails."""

    async def send(self, user: User, verification_token: str) -> bool:
        """
        Send email verification email.

        Args:
            user: User model instance
            verification_token: Email verification token

        Returns:
            True if email sent successfully
        """
        verify_url = f"{settings.FRONTEND_URL}/verify-email?token={verification_token}"

        context = {
            "username": user.username,
            "verify_url": verify_url,
        }

        html_body = self.template_service.render_template("email_verification", context)

        return await self.transport_service.send_email(
            to_email=user.email,
            subject="Qontinui - Verify Your Email Address",
            text_body="",
            html_body=html_body,
        )


class ResendVerificationEmailComposer(BaseEmailComposer):
    """Composes and sends resend verification emails."""

    async def send(self, user: User, verification_token: str) -> bool:
        """
        Send resend verification email.

        Args:
            user: User model instance
            verification_token: Email verification token

        Returns:
            True if email sent successfully
        """
        verify_url = f"{settings.FRONTEND_URL}/verify-email?token={verification_token}"

        context = {
            "username": user.username,
            "verify_url": verify_url,
        }

        html_body = self.template_service.render_template(
            "resend_verification", context
        )

        return await self.transport_service.send_email(
            to_email=user.email,
            subject="Qontinui - Verify Your Email Address",
            text_body="",
            html_body=html_body,
        )


class FeedbackEmailComposer(BaseEmailComposer):
    """Composes and sends feedback emails."""

    async def send(
        self,
        name: str,
        email: str,
        message: str,
        page_url: str | None = None,
    ) -> bool:
        """
        Send feedback email to admin.

        Args:
            name: User's name
            email: User's email address
            message: Feedback message
            page_url: URL where feedback was submitted (optional)

        Returns:
            True if email sent successfully
        """
        # Create email body without template
        text_body = f"""
New Feedback Received from Qontinui Beta

Name: {name}
Email: {email}
Page: {page_url or "Not provided"}

Message:
{message}

---
This feedback was submitted through the Qontinui Beta feedback form.
"""

        html_body = f"""
<html>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
    <h2 style="color: #6366f1;">New Feedback Received from Qontinui Beta</h2>

    <div style="background-color: #f3f4f6; padding: 15px; border-radius: 5px; margin: 20px 0;">
        <p><strong>Name:</strong> {name}</p>
        <p><strong>Email:</strong> <a href="mailto:{email}">{email}</a></p>
        <p><strong>Page:</strong> {page_url or "Not provided"}</p>
    </div>

    <div style="margin: 20px 0;">
        <p><strong>Message:</strong></p>
        <div style="background-color: #fff; border-left: 4px solid #6366f1; padding: 15px; margin: 10px 0;">
            {message.replace("\n", "<br>")}
        </div>
    </div>

    <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 30px 0;">
    <p style="color: #6b7280; font-size: 14px;">
        This feedback was submitted through the Qontinui Beta feedback form.
    </p>
</body>
</html>
"""

        return await self.transport_service.send_email(
            to_email=settings.SUPPORT_EMAIL,
            subject=f"Qontinui Beta Feedback from {name}",
            text_body=text_body,
            html_body=html_body,
        )
