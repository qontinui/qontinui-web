import hashlib
import secrets

from fastapi import HTTPException, Request, status
from fastapi.responses import Response

# CSRF token storage (use Redis in production)
csrf_tokens = {}


def generate_csrf_token(session_id: str) -> str:
    """Generate a new CSRF token for a session"""
    token = secrets.token_urlsafe(32)
    csrf_tokens[session_id] = hashlib.sha256(token.encode()).hexdigest()
    return token


def verify_csrf_token(session_id: str, token: str) -> bool:
    """Verify a CSRF token against the stored hash"""
    if session_id not in csrf_tokens:
        return False

    token_hash = hashlib.sha256(token.encode()).hexdigest()
    return secrets.compare_digest(csrf_tokens[session_id], token_hash)


async def csrf_middleware(request: Request, call_next):
    """CSRF protection middleware"""
    # Skip CSRF for safe methods
    if request.method in ["GET", "HEAD", "OPTIONS"]:
        response = await call_next(request)
        return response

    # Skip CSRF for API endpoints (they use JWT)
    if request.url.path.startswith("/api/"):
        response = await call_next(request)
        return response

    # For other POST/PUT/DELETE requests, verify CSRF token
    csrf_token = request.headers.get("X-CSRF-Token")
    if not csrf_token:
        # Try to get from form data
        if request.headers.get("content-type", "").startswith(
            "application/x-www-form-urlencoded"
        ):
            form = await request.form()
            csrf_token = form.get("csrf_token")

    if not csrf_token:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="CSRF token missing"
        )

    # Get session ID from cookie or header
    session_id = request.cookies.get("session_id") or request.headers.get(
        "X-Session-ID"
    )
    if not session_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Session ID missing"
        )

    if not verify_csrf_token(session_id, csrf_token):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Invalid CSRF token"
        )

    response = await call_next(request)
    return response


def set_csrf_cookie(response: Response, session_id: str, token: str):
    """Set CSRF token as an HTTP-only cookie"""
    response.set_cookie(
        key="csrf_token",
        value=token,
        httponly=True,
        secure=True,  # Only over HTTPS in production
        samesite="strict",
        max_age=3600,  # 1 hour
    )
