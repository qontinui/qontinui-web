"""Password hashing and validation service."""

import secrets
import string

from passlib.context import CryptContext


class PasswordService:
    """Password hashing and validation service."""

    def __init__(self):
        """Initialize the password service with bcrypt and argon2 support."""
        # Support both bcrypt (primary) and argon2id (for backward compatibility)
        # New passwords are always hashed with bcrypt, but we can verify argon2id
        self.pwd_context = CryptContext(
            schemes=["bcrypt", "argon2"],
            deprecated="auto",
            # Ensure new hashes always use bcrypt
            default="bcrypt",
        )
        self.min_password_length = 8

    def hash_password(self, password: str) -> str:
        """Hash a password using bcrypt."""
        return self.pwd_context.hash(password)

    def verify_password(self, plain_password: str, hashed_password: str) -> bool:
        """Verify a password against its hash."""
        return self.pwd_context.verify(plain_password, hashed_password)

    def generate_temporary_password(self, length: int = 12) -> str:
        """Generate a temporary password with special characters."""
        characters = string.ascii_letters + string.digits + string.punctuation
        return "".join(secrets.choice(characters) for _ in range(length))

    def generate_secure_password(self, length: int = 16) -> str:
        """Generate a secure alphanumeric password."""
        alphabet = string.ascii_letters + string.digits
        while True:
            password = "".join(secrets.choice(alphabet) for _ in range(length))
            if (
                any(c.islower() for c in password)
                and any(c.isupper() for c in password)
                and any(c.isdigit() for c in password)
            ):
                return password

    def validate_password_strength(self, password: str) -> tuple[bool, str]:
        """Validate password strength and return result with message."""
        if len(password) < self.min_password_length:
            return (
                False,
                f"Password must be at least {self.min_password_length} characters long",
            )

        if not any(c.islower() for c in password):
            return False, "Password must contain at least one lowercase letter"

        if not any(c.isupper() for c in password):
            return False, "Password must contain at least one uppercase letter"

        if not any(c.isdigit() for c in password):
            return False, "Password must contain at least one digit"

        return True, "Password is strong"


password_service = PasswordService()
