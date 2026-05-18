"""Legacy compat shim — re-exports from :mod:`app.crud.device_connection`.

Phase 5 of the Unified Devices Registry plan
(``D:/qontinui-root/plans/2026-05-18-unified-devices-registry.md``)
renamed ``RunnerSession`` → ``DeviceConnection`` and moved the table
to ``coord.device_connections``. This shim re-exports the equivalent
helpers under their legacy names so the broader fleet of consumers
compiles while the rename propagates.
"""

from app.crud.device_connection import (
    close_connection_record as close_session_record,
)
from app.crud.device_connection import (
    close_orphaned_connections as close_orphaned_sessions,
)
from app.crud.device_connection import (
    create_connection_record as create_session_record,
)
from app.crud.device_connection import (
    get_active_connection_for_project as get_active_session_for_project,
)
from app.crud.device_connection import (
    get_active_connections as get_active_sessions,
)
from app.crud.device_connection import (
    get_connection_by_session_id as get_session_by_session_id,
)
from app.crud.device_connection import (
    get_connection_history as get_session_history,
)

# Legacy fleet CRUD helpers (Runner token + Runner registration) are
# re-exported from the runner_crud shim.
from app.crud.runner_crud import (
    delete_runner,
    get_runner,
    heartbeat_runner,
    list_runners,
    register_runner,
)

__all__ = [
    # Re-exported from device_crud
    "register_runner",
    "heartbeat_runner",
    "list_runners",
    "get_runner",
    "delete_runner",
    # Session history CRUD (re-exported with legacy names)
    "create_session_record",
    "close_session_record",
    "get_session_history",
    "get_active_sessions",
    "get_active_session_for_project",
    "close_orphaned_sessions",
    "get_session_by_session_id",
]
