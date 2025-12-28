"""
Centralized test credentials configuration.

This file is the SINGLE SOURCE OF TRUTH for local development credentials.
All test files, seed scripts, and development tools should import from here.

IMPORTANT: These credentials are ONLY for local development and testing.
They must NEVER be used in production environments.

When modifying credentials here, you MUST also update:
1. qontinui-web/frontend/.env.local (NEXT_PUBLIC_DEV_EMAIL, NEXT_PUBLIC_DEV_PASSWORD)
2. qontinui-runner/.env (VITE_DEV_EMAIL, VITE_DEV_PASSWORD)
3. qontinui-web/frontend/tests/e2e/test-credentials.ts
4. Run reset_local_password.py to update database passwords
"""

# Standard development password - use this for ALL dev users
# This makes it easy to switch between accounts during development
STANDARD_DEV_PASSWORD = "Qontinui123!"

# Primary development user - used for BOTH runner AND web during development
# This is the single default user for all local development
DEV_USER_EMAIL = "josh@qontinui.io"
DEV_USER_USERNAME = "josh"
DEV_USER_PASSWORD = STANDARD_DEV_PASSWORD
DEV_USER_IS_SUPERUSER = True
DEV_USER_IS_VERIFIED = True


def get_dev_credentials() -> dict:
    """Get the standard development user credentials.

    This is the SINGLE user used for:
    - qontinui-runner auto-login
    - qontinui-web E2E tests
    - Manual development testing
    """
    return {
        "email": DEV_USER_EMAIL,
        "username": DEV_USER_USERNAME,
        "password": DEV_USER_PASSWORD,
        "is_superuser": DEV_USER_IS_SUPERUSER,
        "is_verified": DEV_USER_IS_VERIFIED,
    }


# Aliases for backward compatibility
def get_runner_dev_credentials() -> dict:
    """Alias for get_dev_credentials() - runner uses the same dev user."""
    return get_dev_credentials()


def get_web_test_credentials() -> dict:
    """Alias for get_dev_credentials() - web tests use the same dev user."""
    return get_dev_credentials()


def get_admin_credentials() -> dict:
    """Alias for get_dev_credentials() - admin is the same as dev user."""
    return get_dev_credentials()
