"""Email template service - handles template rendering."""

from pathlib import Path

import structlog
from jinja2 import Environment, FileSystemLoader, TemplateNotFound

logger = structlog.get_logger(__name__)


class EmailTemplateService:
    """Handles email template loading and rendering."""

    def __init__(self, template_dir: str | Path = None):
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
        logger.info("template_dir_initialized", template_dir=str(self.template_dir), exists=self.template_dir.exists())
        self.env = Environment(
            loader=FileSystemLoader(str(self.template_dir)),
            autoescape=True,  # Enable autoescaping for security
        )

    def render_template(self, template_name: str, context: dict) -> tuple[str, str]:
        """
        Render both HTML and text versions of an email template.

        Args:
            template_name: Base name of template (e.g., "beta_welcome")
            context: Dictionary of variables to pass to template

        Returns:
            Tuple of (html_content, text_content)

        Raises:
            TemplateNotFound: If template files don't exist
        """
        try:
            # Render HTML template
            html_template = self.env.get_template(f"{template_name}.html")
            html_content = html_template.render(**context)

            # Render text template
            text_template = self.env.get_template(f"{template_name}.txt")
            text_content = text_template.render(**context)

            return (html_content, text_content)

        except TemplateNotFound as e:
            logger.error(f"Template not found: {e}")
            raise

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
