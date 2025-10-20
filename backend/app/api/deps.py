"""
FastAPI dependencies for authentication and database access.

Now using fastapi-users for authentication.
"""

# Export fastapi-users dependencies
from app.auth.config import (
    current_active_user,
    current_superuser,
    current_verified_user,
)

# Backward compatibility aliases
get_current_user_async = current_active_user
get_current_active_user_async = current_active_user
get_current_superuser_async = current_superuser
get_verified_user_async = current_verified_user
