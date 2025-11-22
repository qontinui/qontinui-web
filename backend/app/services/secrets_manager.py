"""
AWS Secrets Manager Service

Provides secure secret retrieval from AWS Secrets Manager with caching.
Falls back to environment variables for local development.

Usage:
    from app.services.secrets_manager import get_secret

    # Get entire secret as dict
    db_secret = get_secret("qontinui/prod/database")

    # Get specific field
    db_password = get_secret("qontinui/prod/database", key="password")
"""

import json
import os
from functools import lru_cache
from typing import Any

import structlog

logger = structlog.get_logger(__name__)


class SecretsManager:
    """Manages secret retrieval from AWS Secrets Manager or environment variables"""

    def __init__(self):
        self.use_secrets_manager = (
            os.getenv("USE_AWS_SECRETS_MANAGER", "false").lower() == "true"
        )
        self.aws_region = os.getenv("AWS_REGION", "eu-central-1")
        self._client = None

    @property
    def client(self):
        """Lazy-load boto3 client"""
        if self._client is None and self.use_secrets_manager:
            try:
                import boto3

                self._client = boto3.client(
                    "secretsmanager", region_name=self.aws_region
                )
                logger.info("secrets_manager_initialized", region=self.aws_region)
            except ImportError:
                logger.warning(
                    "boto3_not_installed", message="Install with: pip install boto3"
                )
                self.use_secrets_manager = False
            except Exception as e:
                logger.error("secrets_manager_init_failed", error=str(e))
                self.use_secrets_manager = False
        return self._client

    @lru_cache(maxsize=50)
    def get_secret(self, secret_name: str, key: str | None = None) -> Any:
        """
        Retrieve secret from AWS Secrets Manager or environment variables

        Args:
            secret_name: Name or ARN of the secret
            key: Optional key to extract from JSON secret

        Returns:
            Secret value (dict if JSON, str otherwise)

        Raises:
            ValueError: If secret not found
        """
        if self.use_secrets_manager:
            return self._get_from_aws(secret_name, key)
        else:
            return self._get_from_env(secret_name, key)

    def _get_from_aws(self, secret_name: str, key: str | None = None) -> Any:
        """Retrieve secret from AWS Secrets Manager"""
        try:
            response = self.client.get_secret_value(SecretId=secret_name)

            # Parse secret string
            if "SecretString" in response:
                secret_value = response["SecretString"]
                try:
                    secret_dict = json.loads(secret_value)
                    if key:
                        if key not in secret_dict:
                            raise ValueError(
                                f"Key '{key}' not found in secret '{secret_name}'"
                            )
                        return secret_dict[key]
                    return secret_dict
                except json.JSONDecodeError:
                    # Not JSON, return as string
                    if key:
                        raise ValueError(
                            f"Secret '{secret_name}' is not JSON, cannot extract key '{key}'"
                        )
                    return secret_value
            else:
                # Binary secret
                return response["SecretBinary"]

        except self.client.exceptions.ResourceNotFoundException:
            raise ValueError(f"Secret '{secret_name}' not found in AWS Secrets Manager")
        except Exception as e:
            logger.error(
                "aws_secret_retrieval_failed", secret_name=secret_name, error=str(e)
            )
            raise ValueError(f"Failed to retrieve secret '{secret_name}': {str(e)}")

    def _get_from_env(self, secret_name: str, key: str | None = None) -> Any:
        """
        Retrieve secret from environment variables (fallback for local development)

        Converts secret_name to env var format:
        'qontinui/prod/database' -> 'QONTINUI_PROD_DATABASE'
        """
        # Convert secret name to env var format
        env_var_name = secret_name.replace("/", "_").replace("-", "_").upper()

        if key:
            # Try specific key first: QONTINUI_PROD_DATABASE_PASSWORD
            specific_env = f"{env_var_name}_{key.upper()}"
            value = os.getenv(specific_env)
            if value:
                return value

        # Try full secret as JSON
        full_secret = os.getenv(env_var_name)
        if full_secret:
            try:
                secret_dict = json.loads(full_secret)
                if key:
                    if key not in secret_dict:
                        raise ValueError(
                            f"Key '{key}' not found in env var '{env_var_name}'"
                        )
                    return secret_dict[key]
                return secret_dict
            except json.JSONDecodeError:
                # Not JSON
                if key:
                    raise ValueError(
                        f"Env var '{env_var_name}' is not JSON, cannot extract key '{key}'"
                    )
                return full_secret

        raise ValueError(
            f"Secret '{secret_name}' not found in environment. "
            f"Set env var: {env_var_name}" + (f"_{key.upper()}" if key else "")
        )

    def clear_cache(self):
        """Clear the secret cache (useful for testing or secret rotation)"""
        self.get_secret.cache_clear()
        logger.info("secrets_cache_cleared")


# Global instance
_secrets_manager = SecretsManager()


def get_secret(secret_name: str, key: str | None = None, default: Any = None) -> Any:
    """
    Convenience function to get a secret

    Args:
        secret_name: Name or ARN of the secret
        key: Optional key to extract from JSON secret
        default: Default value if secret not found (if provided, won't raise exception)

    Returns:
        Secret value or default
    """
    try:
        return _secrets_manager.get_secret(secret_name, key)
    except ValueError:
        if default is not None:
            return default
        raise


def clear_secrets_cache():
    """Clear the secret cache"""
    _secrets_manager.clear_cache()
