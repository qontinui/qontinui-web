"""Email template service - handles template rendering."""

from pathlib import Path

import structlog
from jinja2 import Environment, FileSystemLoader, TemplateNotFound

logger = structlog.get_logger(__name__)


class EmailTemplateService:
    """Handles email template loading and rendering."""

    def __init__(self, template_dir: str | Path | None = None):
        """
        Initialize the template service.

        Args:
            template_dir: Directory containing email templates.
                         Defaults to backend/templates/emails
        """
        if template_dir is None:
            # Default to backend/templates/emails
            # __file__ is app/services/email/email_template_service.py
            # Go up to backend/ directory, then add templates/emails
            backend_dir = Path(__file__).parent.parent.parent.parent
            template_dir = backend_dir / "templates" / "emails"

        self.template_dir = Path(template_dir)
        logger.info(
            "template_dir_initialized",
            template_dir=str(self.template_dir),
            exists=self.template_dir.exists(),
        )
        self.env = Environment(
            loader=FileSystemLoader(str(self.template_dir)),
            autoescape=True,  # Enable autoescaping for security
        )
        # A `.txt` template is NOT HTML, so HTML-escaping it is a bug rather
        # than a safety measure: it renders an apostrophe in a tenant name as
        # `&#39;` in the plain-text part a mail client shows when it will not
        # render HTML. An overlay shares this environment's LOADER while
        # turning autoescape off for that one render path.
        #
        # It does NOT share the template cache: `Environment.overlay` ends in
        # `rv.cache = copy_cache(self.cache)`, and `copy_cache` returns an
        # EMPTY cache of the same kind rather than the same object (verified
        # against jinja2 3.1.6). So the two environments compile and cache
        # independently — which is what we want, since a template compiled
        # under one autoescape setting must never be served to the other.
        self.text_env = self.env.overlay(autoescape=False)

    def render_template(self, template_name: str, context: dict) -> str:
        """
        Render HTML version of an email template.

        Args:
            template_name: Base name of template (e.g., "beta_welcome")
            context: Dictionary of variables to pass to template

        Returns:
            HTML content string

        Raises:
            TemplateNotFound: If template files don't exist
        """
        try:
            # Render HTML template
            html_template = self.env.get_template(f"{template_name}.html")
            html_content = html_template.render(**context)

            return html_content

        except TemplateNotFound as e:
            logger.error(f"Template not found: {e}")
            # Return a simple fallback if template not found
            return f"<html><body><h2>{context.get('title', 'Notification')}</h2><p>{context.get('message', '')}</p></body></html>"

    def render_text_template(self, template_name: str, context: dict) -> str:
        """
        Render the PLAIN-TEXT version of an email template.

        The counterpart to :meth:`render_template`. MOST templates here ship
        an HTML and a ``.txt`` half — not all of them; ``admin_notification``
        is HTML-only, which is why ``template_exists`` and ``list_templates``
        test for the pair rather than assuming it. Until now only the HTML
        half was ever rendered, so the text part of a multipart message was
        whatever the composer passed as ``text_body``, which for most of them
        is the empty string.

        Args:
            template_name: Base name of template (e.g., "member_added")
            context: Dictionary of variables to pass to template

        Returns:
            Plain-text content string, or ``""`` when no ``.txt`` template
            exists — an absent text part is what every composer already sends,
            so it degrades to the status quo rather than to an exception.
        """
        try:
            text_template = self.text_env.get_template(f"{template_name}.txt")
            return text_template.render(**context)
        except TemplateNotFound as e:
            logger.error(f"Text template not found: {e}")
            return ""

    def template_exists(self, template_name: str) -> bool:
        """
        Check if both HTML and text templates exist for a given name.

        Args:
            template_name: Base name of template

        Returns:
            True if both templates exist
        """
        html_path = self.template_dir / f"{template_name}.html"
        text_path = self.template_dir / f"{template_name}.txt"

        return html_path.exists() and text_path.exists()

    def list_templates(self) -> list[str]:
        """
        List all available email templates (base names).

        Returns:
            List of template names (without .html or .txt extensions)
        """
        html_files = self.template_dir.glob("*.html")
        template_names = set()

        for html_file in html_files:
            base_name = html_file.stem
            # Only include if matching .txt file exists
            if (self.template_dir / f"{base_name}.txt").exists():
                template_names.add(base_name)

        return sorted(template_names)
