"""Legacy compat alias — re-exports :class:`Device` as ``Runner``.

Phase 5 of the Unified Devices Registry plan
(``D:/qontinui-root/plans/2026-05-18-unified-devices-registry.md``)
retired the ``Runner`` SQLAlchemy model in favour of the unified
:class:`~app.models.device.Device` on ``coord.devices``. The unified
table absorbs every column the legacy ``Runner`` carried (plus the
liveness/capacity columns previously on ``coord.machines``).

Importing ``Runner`` from this module is preserved for in-process
backwards compatibility while the rename propagates through the
broader fleet of WS-bridge HTTP handlers — every consumer that
previously read ``Runner.id`` should migrate to ``Device.device_id``
in a follow-up cleanup pass.
"""

from app.models.device import Device as Runner

__all__ = ["Runner"]
