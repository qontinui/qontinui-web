"""Legacy compat shim — re-exports from :mod:`app.crud.device_crud`.

Phase 5 of the Unified Devices Registry plan
(``D:/qontinui-root/plans/2026-05-18-unified-devices-registry.md``)
retired the ``Runner`` SQLAlchemy model + companion ``runner_crud``
module. The replacement is :mod:`app.crud.device_crud` (operating on
``coord.devices``). This shim re-exports the equivalent helpers under
their legacy names so the broader fleet of WS-bridge HTTP handlers
(``runner_chat.py``, ``runner_command_ws.py``, etc.) continues to
compile while the rename is propagated through the codebase.

The legacy token-mint helpers (``create_runner_token`` /
``validate_runner_token`` / ``revoke_runner_token`` /
``list_runner_tokens`` / ``get_runner_token``) are NOT re-exported —
token issuance is now coord's responsibility via the OAuth-loopback
pairing flow (see ``backend/app/api/v1/endpoints/devices.py`` and
``backend/app/services/coord_jwks.py``).
"""

from app.crud.device_crud import (
    delete_device as delete_runner,
)
from app.crud.device_crud import (
    get_device as get_runner,
)
from app.crud.device_crud import (
    heartbeat_device as heartbeat_runner,
)
from app.crud.device_crud import (
    list_devices as list_runners,
)
from app.crud.device_crud import (
    register_device as register_runner,
)

__all__ = [
    "register_runner",
    "heartbeat_runner",
    "list_runners",
    "get_runner",
    "delete_runner",
]
