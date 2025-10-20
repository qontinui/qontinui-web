#!/usr/bin/env python3
"""Script to migrate remaining files from standard logging to structlog."""

import re
from pathlib import Path

# List of files that still need migration
FILES_TO_MIGRATE = [
    "app/worker/arq_pool.py",
    "app/auth/config.py",
    "app/config/redis_config.py",
    "app/services/pattern_optimization_service.py",
    "app/services/background_removal_service.py",
    "app/services/email.py",
    "app/services/email/email_composers.py",
    "app/services/email/email_transport_service.py",
    "app/services/email/email_template_service.py",
    "app/services/metrics_service.py",
    "app/api/v1/endpoints/auth.py",
    "app/api/v1/endpoints/pattern_optimization.py",
    "app/api/v1/endpoints/background_removal.py",
    "app/api/v1/endpoints/admin.py",
]


def migrate_file(file_path: Path) -> bool:
    """Migrate a single file from logging to structlog."""
    if not file_path.exists():
        print(f"  File not found: {file_path}")
        return False

    content = file_path.read_text()

    # Check if file uses standard logging
    if "import logging" not in content and "logging.getLogger" not in content:
        print(f"  No logging found in {file_path}")
        return False

    # Replace logging import with structlog
    content = re.sub(
        r"^import logging\n",
        "import structlog\n",
        content,
        flags=re.MULTILINE,
    )

    # Replace logging.getLogger with structlog.get_logger
    content = re.sub(
        r"logger = logging\.getLogger\(__name__\)",
        "logger = structlog.get_logger(__name__)",
        content,
    )

    # Replace common f-string logging patterns with structured logging
    # Pattern: logger.info(f"text {var}")
    # Replace with: logger.info("text", var=var)

    # Pattern 1: Simple f-strings with one variable
    content = re.sub(
        r'logger\.(info|error|warning|debug)\(f"([^"]*)\{([^}]+)\}([^"]*)"\)',
        lambda m: f'logger.{m.group(1)}("{m.group(2).strip()}_{m.group(4).strip()}".strip("_").replace(" ", "_").lower(), value={m.group(3)})',
        content,
    )

    # Save the migrated file
    file_path.write_text(content)
    print(f"  Migrated: {file_path}")
    return True


def main():
    """Main migration function."""
    backend_dir = Path(__file__).parent.parent
    print(f"Backend directory: {backend_dir}")
    print(f"\nMigrating {len(FILES_TO_MIGRATE)} files...\n")

    migrated = 0
    for file_rel_path in FILES_TO_MIGRATE:
        file_path = backend_dir / file_rel_path
        print(f"Processing: {file_rel_path}")
        if migrate_file(file_path):
            migrated += 1

    print("\nMigration complete!")
    print(f"  Migrated: {migrated} files")
    print(f"  Total: {len(FILES_TO_MIGRATE)} files")


if __name__ == "__main__":
    main()
