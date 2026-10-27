"""Admin endpoint dependencies."""

from fastapi import Depends, HTTPException, status

from app.api.deps import get_current_active_user_async
from app.models.user import User

#: The sentence an authenticated, active user who is not a platform admin is
#: refused with (403). A client that must tell THIS refusal apart from any
#: other 403 — a proxy's, a WAF's — keys on it: the fleet app-config UI does
#: (``frontend/src/lib/api/fleet.ts`` ``PLATFORM_ADMIN_REFUSAL``, by strict
#: equality), so rewording it is a wire change for both sides. Each side's
#: tests check the other's copy: ``tests/test_fleet_apps_platform_admin_gate.py``
#: compares the 403 body with the literal sentence and reads ``fleet.ts``, and
#: ``frontend/src/lib/api/fleet.test.ts`` reads this assignment, which it
#: expects on one line in exactly this form.
ADMIN_REQUIRED_DETAIL = "Not authorized. Admin access required."


async def require_admin(
    current_user: User = Depends(get_current_active_user_async),
) -> User:
    """Require an ACTIVE platform admin (``User.is_superuser``).

    The user comes from fastapi-users' ``current_user(active=True)``, which
    answers 401 for a missing or invalid bearer AND for an inactive user before
    this body runs, so a deactivated superuser never reaches the
    ``is_superuser`` check. An active user who is not a superuser is refused
    403 here, with :data:`ADMIN_REQUIRED_DETAIL`.
    """
    if not current_user.is_superuser:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=ADMIN_REQUIRED_DETAIL,
        )
    return current_user
