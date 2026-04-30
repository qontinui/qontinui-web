"""Cloud-control extension registry.

OSS exports no-op default hooks. The qontinui-cloud-control package
side-effect-registers real implementations at install time by importing
this module and calling the ``add_*`` / ``register_*`` helpers.

Public surface (consumed by OSS code):

* ``register_cloud_extensions(api_router)`` — called once from
  ``app/api/v1/api.py`` after OSS routers are mounted. No-op when no
  cloud-control package has registered any route extensions.
* ``register_cloud_models()`` — called once from ``app/models/__init__.py``
  after OSS model imports. No-op when no cloud-control package has
  registered model imports.
* ``check_org_permission(user, org_id, action)`` — called from OSS code
  that wants to gate a cross-org operation. Returns ``True`` (single-tenant
  default = always allowed) when no cloud-control implementation is
  registered.
* ``get_service(name)`` — returns the cloud-control-registered service
  instance for the given slot name, or ``None``.

Public surface (consumed by cloud-control):

* ``add_route_registrar(fn)`` — cloud-control registers a function that
  will be called with ``api_router`` and is expected to mount additional
  routers. Additive; multiple registrars all fire.
* ``add_model_registrar(fn)`` — cloud-control registers a function that
  imports its model modules (side-effect: SQLAlchemy ``Base.metadata``
  picks them up).
* ``register_org_permission_check(fn)`` — installs the cross-org
  permission-check function. Last-write-wins (production: do not call
  multiple times; hot-reload: explicitly supported).
* ``register_service(name, instance)`` — installs a named service slot
  (e.g. ``"auth_analytics_aggregator"``). Last-write-wins, same caveat as
  ``register_org_permission_check``.

See ``tmp_cloud_control_carve_out.md`` §3 for the full design rationale.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from fastapi import APIRouter

# --- Route registration ---------------------------------------------------

_route_registrars: list[Callable[[APIRouter], None]] = []


def add_route_registrar(fn: Callable[[APIRouter], None]) -> None:
    """Cloud-control registers a function that mounts its routers onto
    ``api_router``.

    Called from cloud-control's package ``__init__``. Must be import-safe;
    additive (same fn registered twice fires twice — FastAPI's
    ``include_router`` tolerates duplicate paths gracefully).
    """
    _route_registrars.append(fn)


def register_cloud_extensions(api_router: APIRouter) -> None:
    """OSS calls this once from ``app/api/v1/api.py`` after OSS routers are
    mounted.

    No-op when no cloud-control package is installed (the registrar list
    is empty).
    """
    for fn in _route_registrars:
        fn(api_router)


# --- Model registration ---------------------------------------------------

_model_registrars: list[Callable[[], None]] = []


def add_model_registrar(fn: Callable[[], None]) -> None:
    """Cloud-control registers a function that imports its model modules.

    Importing a SQLAlchemy model module registers it on ``Base.metadata``,
    which is what alembic / model-discovery rely on. Additive.
    """
    _model_registrars.append(fn)


def register_cloud_models() -> None:
    """OSS calls this once from ``app/models/__init__.py`` after OSS model
    imports.
    """
    for fn in _model_registrars:
        fn()


# --- Permission hook ------------------------------------------------------

_org_permission_check: Callable[..., bool] | None = None


def register_org_permission_check(fn: Callable[..., bool]) -> None:
    """Cloud-control installs the cross-org permission-check function.

    Last-write-wins. Production: register once at startup. Hot-reload:
    explicitly supported (the second import wins, replacing the prior
    function reference cleanly).

    Signature: ``fn(user, org_id, action) -> bool``.
    """
    global _org_permission_check
    _org_permission_check = fn


def check_org_permission(user: Any, org_id: Any, action: str) -> bool:
    """OSS callers ask this; returns ``True`` when no cross-org check is
    installed (single-tenant default = always allowed within own user's
    data).
    """
    if _org_permission_check is None:
        return True
    return _org_permission_check(user, org_id, action)


# --- Service factory hook (named slots; analogous to org permission) ------

_service_overrides: dict[str, Any] = {}


def register_service(name: str, instance: Any) -> None:
    """Cloud-control installs an override for a named service slot.

    OSS code requests the service via ``get_service(name)``; when no
    override is registered, ``get_service`` returns ``None`` and OSS code
    is expected to handle the ``None`` case (e.g. "billing UI hidden").

    Last-write-wins per slot; same caveat as
    ``register_org_permission_check``.
    """
    _service_overrides[name] = instance


def get_service(name: str) -> Any | None:
    """Return the registered service instance for ``name``, or ``None``."""
    return _service_overrides.get(name)
