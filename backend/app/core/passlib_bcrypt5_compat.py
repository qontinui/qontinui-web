"""Monkey-patch passlib to work with bcrypt >= 5.0.0.

bcrypt 5 removed the ``__about__`` module and changed ``hashpw``/``checkpw``
to reject passwords longer than 72 bytes instead of silently truncating.
passlib 1.7.4 (unmaintained) is not aware of these changes, so we patch
the relevant internals at import time.

Import this module **before** any passlib usage to ensure compatibility.
"""

import bcrypt as _bcrypt

# 1. Restore the ``__about__`` shim so passlib can read the version string.
if not hasattr(_bcrypt, "__about__"):

    class _About:
        __version__: str = getattr(_bcrypt, "__version__", "0.0.0")

    _bcrypt.__about__ = _About  # type: ignore[attr-defined]

# 2. Wrap ``hashpw`` and ``checkpw`` to auto-truncate passwords to 72 bytes
#    (matching bcrypt 4.x behaviour that passlib relied on).
_orig_hashpw = _bcrypt.hashpw
_orig_checkpw = _bcrypt.checkpw


def _patched_hashpw(password: bytes, salt: bytes, **kwargs: object) -> bytes:
    result: bytes = _orig_hashpw(password[:72], salt, **kwargs)
    return result


def _patched_checkpw(password: bytes, hashed_password: bytes) -> bool:
    result: bool = _orig_checkpw(password[:72], hashed_password)
    return result


_bcrypt.hashpw = _patched_hashpw  # type: ignore[assignment]
_bcrypt.checkpw = _patched_checkpw  # type: ignore[assignment]
