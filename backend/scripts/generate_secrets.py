#!/usr/bin/env python3
"""
Generate secure secrets for production deployment
"""

import secrets
import string
import sys
from pathlib import Path


def generate_secret_key(length=64):
    """Generate a cryptographically secure secret key"""
    alphabet = string.ascii_letters + string.digits + string.punctuation
    return "".join(secrets.choice(alphabet) for _ in range(length))


def generate_env_file():
    """Generate a production-ready .env file"""

    env_template = """# Qontinui Backend Configuration
# Generated for production deployment

# Environment
ENVIRONMENT=production

# Security
SECRET_KEY={secret_key}
ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=15
REFRESH_TOKEN_EXPIRE_DAYS=7

# Database (Update with your actual database URL)
DATABASE_URL=postgresql://user:password@localhost/qontinui_db

# CORS Origins (Update with your domain)
BACKEND_CORS_ORIGINS=["https://qontinui.com","https://qontinui.io"]

# Rate Limiting
RATE_LIMIT_ENABLED=true
RATE_LIMIT_PER_MINUTE=60
RATE_LIMIT_PER_HOUR=600

# Server
HOST=0.0.0.0
PORT=8000
RELOAD=false
DEBUG=false

# Frontend URL
FRONTEND_URL=https://qontinui.io

# Admin User (Optional - remove after first setup)
# FIRST_SUPERUSER_EMAIL=admin@qontinui.com
# FIRST_SUPERUSER_PASSWORD={admin_password}
"""

    secret_key = generate_secret_key()
    admin_password = generate_secret_key(32)

    env_content = env_template.format(
        secret_key=secret_key, admin_password=admin_password
    )

    # Check if .env.production exists
    env_file = Path(".env.production")
    if env_file.exists():
        response = input(".env.production already exists. Overwrite? (y/n): ")
        if response.lower() != "y":
            print("Aborted.")
            sys.exit(0)

    # Write the file
    env_file.write_text(env_content)
    print("✅ Generated .env.production")
    print(f"📝 Secret Key: {secret_key[:20]}...")
    print(f"📝 Admin Password: {admin_password}")
    print("\n⚠️  IMPORTANT:")
    print("1. Update DATABASE_URL with your actual database connection string")
    print("2. Update BACKEND_CORS_ORIGINS with your domain")
    print("3. Store the admin password securely")
    print("4. Never commit .env.production to git")

    # Create .env.example if it doesn't exist
    example_file = Path(".env.example")
    if not example_file.exists():
        example_content = env_template.format(
            secret_key="change-me-" + "x" * 32, admin_password="change-me"
        )
        example_file.write_text(example_content)
        print("\n✅ Generated .env.example for reference")


if __name__ == "__main__":
    generate_env_file()
