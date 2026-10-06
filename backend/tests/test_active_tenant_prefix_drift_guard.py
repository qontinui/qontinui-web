"""Drift guard: traced tenant-resolving routes are reachable by the Project selector.

Plan ``2026-09-17-regression-tests-target-the-selected-project``, Phase 3.

The sidebar's Project selector reaches the backend ONLY as the
``X-Qontinui-Active-Tenant`` header, and ``HttpClient`` attaches that header
ONLY to URLs matching ``ACTIVE_TENANT_URL_PREFIXES``
(``frontend/src/services/http-client.ts``, matched with ``url.includes``). A
backend route that resolves the caller's tenant while no prefix covers it
silently serves the operator's HOME project whatever the selector says — the
Regression Tests page did exactly that, and so did roughly eight other
families, with nothing anywhere failing.

This module guards that class for the routes its trace can follow. It walks
the LIVE route table (``app.routes``, so mount prefixes such as
``prompt_injections`` at ``/admin`` and the two ``/overview`` routers are
exact, and routers living outside ``endpoints/`` are seen) and marks a route
*tenant-resolving* when the trace from it reaches a known resolver
(:data:`_RESOLVERS`) or a read of the header by value (a string constant equal
to ``X-Qontinui-Active-Tenant``, any case, inline or through a module global of
any name — which is how ``devenv._ACTIVE_TENANT_HEADER`` and the read inside
``coord_device_resolve`` are seen). The trace follows, within ``app.*``:

* the route's dependency tree and endpoint body;
* module globals, attributes of referenced ``app.*`` modules, and
  function-local imports (read from bytecode);
* on a referenced class or module-level instance, the methods the referring
  function names, plus construction/call;
* on an INJECTED dependency parameter, the methods read off that parameter,
  resolved against the classes its provider constructs.

It does NOT follow a method called on an object whose class nothing on the
path names (a return value, an untyped local). That gap is bounded by
``test_module_source_cross_check``: any route whose endpoint module names a
resolver or the header but which the trace calls non-resolving must be listed
in :data:`_UNTRACED` by a person, with the reason. So a reach gap in those
modules fails; one in a module that names neither is not detected.

Each tenant-resolving HTTP route must be covered by a prefix or named in
:data:`_EXCLUSIONS` with a reason; each exclusion and each :data:`_UNTRACED`
path must still be live. On a covered route, EVERY raw header read must sit in
a module that forwards the header to coord (:data:`_FORWARDED_TO_COORD`) or
validates it against the caller's coord memberships
(:data:`_VALIDATED_LOCALLY`). WebSocket routes are not held to prefixes — a
browser ``WebSocket`` cannot send the header — and are checked instead for
reading the ``active_tenant`` query param. The prefix parse, the classifier's
reach, the cycle handling and each detector have a test that fails if that
piece stops measuring.

How to fix a failure of ``test_every_tenant_resolving_route_is_covered``:

* the route forwards the header to coord (class a) or scopes web-DB rows by the
  tenant ``get_tenant_id`` / ``get_coord_identity`` resolve (class b) → add
  the narrowest prefix that covers it to ``ACTIVE_TENANT_URL_PREFIXES``, with
  a comment, and a URL to ``SCOPED_URLS`` in ``http-client.test.ts``;
* the route reads the raw header WITHOUT coord's membership check (class c),
  or the selection must not change what it does → add it to
  :data:`_EXCLUSIONS` with the reason. Never add a class-(c) prefix: it turns
  an unvalidated client value into a trusted one.
"""

from __future__ import annotations

import dis
import importlib.util
import inspect
import re
import sys
import types
from collections.abc import Callable, Iterable
from pathlib import Path
from typing import Any
from uuid import UUID

import pytest
import yaml
from fastapi import APIRouter, Depends, FastAPI, Request, WebSocket
from fastapi.routing import APIRoute, APIWebSocketRoute

from app.api.v1.endpoints import operations, plan_library
from app.overview import permissions as overview_permissions
from app.services import coord_device_resolve, coord_identity

# backend/tests/x.py -> parents[2] == repo root.
_REPO_ROOT = Path(__file__).resolve().parents[2]
_HTTP_CLIENT = _REPO_ROOT / "frontend" / "src" / "services" / "http-client.ts"
_BACKEND_CI = _REPO_ROOT / ".github" / "workflows" / "backend-ci.yml"

_HEADER = "x-qontinui-active-tenant"

# The resolvers a route can reach the caller's tenant through. Imported, not
# named, so a rename or removal fails this module at import rather than
# quietly shrinking what the guard sees.
_RESOLVERS: dict[int, str] = {
    id(obj): name
    for obj, name in (
        (operations.get_tenant_id, "get_tenant_id"),
        (operations.require_coord_tenant_admin, "require_coord_tenant_admin"),
        (
            operations.require_coord_tenant_admin_target,
            "require_coord_tenant_admin_target",
        ),
        (operations.capture_caller_bearer, "capture_caller_bearer"),
        (coord_identity.get_coord_identity, "get_coord_identity"),
        (coord_device_resolve.CoordCaller, "CoordCaller"),
        (overview_permissions.get_overview_caller, "get_overview_caller"),
        (overview_permissions.get_overview_access, "get_overview_access"),
        (plan_library._soft_tenant_id, "_soft_tenant_id"),  # noqa: SLF001
        (operations._effective_tenant_id, "_effective_tenant_id"),  # noqa: SLF001
    )
}

# ``_Classifier._reach``'s "no ancestor was cut off" lowlink.
_NO_CUT = sys.maxsize

# Tenant-resolving routes that deliberately get NO prefix. Keyed by the exact
# route path (``route.path``); each entry must still classify as
# tenant-resolving, or ``test_every_exclusion_is_still_live`` fails.
_EXCLUSIONS: dict[str, str] = {
    # Class (c). ``devenv._best_effort_tenant_id`` parses the raw header onto
    # the canonical audit row with NO coord membership check. Sending it would
    # let the client write any tenant id it likes into the audit trail.
    "/api/v1/devenv/environments/{environment_id}/canonical": (
        "class (c): raw header, no membership check (devenv._best_effort_tenant_id)"
    ),
    # The caller's own profile. Its ``tenant_id`` / ``tenant_slug`` render as
    # the ACCOUNT's tenant on /settings/account; scoping them to the selection
    # would relabel the account rather than scope any data.
    "/api/v1/auth/users/me": (
        "profile read: reports the account's home tenant, not scoped data"
    ),
    # ``get_coord_identity`` here is only a linked-operator gate; coord takes
    # the tenant from the pair-start flow it stored, so the value is unused.
    "/api/v1/devices/pair-confirm": (
        "identity is a gate only; coord resolves the tenant from the pair flow"
    ),
    # The helper-role grant POST does not forward the header, so it lands in
    # the caller's home tenant; the ``already_granted`` check must read that
    # same tenant. Sending the header would make the check and the write
    # disagree (coord_helper_provisioning).
    "/api/v1/organizations/invitations/accept": (
        "helper-role grant is home-tenant; check and write must agree"
    ),
    # Superuser user admin. No dashboard caller today, and the only prefix
    # that would cover it (``/api/v1/users/``) also covers the header-free
    # ``/users/me/*`` family. An API caller sends the header itself.
    "/api/v1/users/{user_id}": (
        "no dashboard caller; a covering prefix would leak onto /users/me/*"
    ),
    # The same deactivation writer through fastapi-users' users router
    # (``UserManager.update`` -> ``apply_activation_transition``). Same
    # reasons: no dashboard caller, and ``/api/v1/auth/users/`` would cover the
    # profile read excluded above.
    "/api/v1/auth/users/{id}": (
        "no dashboard caller; a covering prefix would leak onto /auth/users/me"
    ),
    # Resolves a device AS the caller (CoordCaller). No dashboard caller today
    # (the UI dispatches via /devices/{id}/dispatch), and an ``includes``
    # prefix cannot name a segment after ``{workflow_id}`` without covering
    # the header-free workflow CRUD that http-client.test.ts pins.
    "/api/v1/workflows/{workflow_id}/dispatch": (
        "no dashboard caller; includes() cannot target it without workflow CRUD"
    ),
    # The trace reaches coord_device_resolve through fire_scheduled_run, but
    # that dispatch runs as ``NO_CALLER`` (a scheduled run has no request
    # behind it), so the header is never read; the row is scoped by user_id.
    "/api/v1/scheduled-runs/{run_id}/run-now": (
        "dispatches as NO_CALLER: the scheduler path never reads the header"
    ),
    # The designation PUT stamps AND overwrites ``coord.test_targets.tenant_id``
    # from ``get_tenant_id`` checking only device ownership and app existence,
    # while coord's own writer requires a ``coord.tenant_devices`` binding and
    # the runner poll returns only rows whose tenant is one of the device's
    # bindings. With the header, an operator switched to a project the device
    # is not bound to would re-stamp the row there and the designation would
    # silently vanish from the device's runner. Follow-up: route the PUT
    # through coord's binding-checked test-targets upsert, then add the prefix.
    # Do NOT drop this entry without that backend fix: it is the only thing
    # that fails if the prefix is re-added (the raw-read rule cannot see it).
    "/api/v1/fleet/test-targets/{device_id}/{app_id}": (
        "PUT re-stamps tenant_id with no coord.tenant_devices binding check; "
        "follow-up: route it through coord's binding-checked upsert, then add "
        "the prefix"
    ),
}

# Modules whose raw header read is legitimate on a COVERED route: each
# captures the header and forwards it verbatim to coord, whose
# ``auth::apply_active_tenant_override`` membership-checks it (a non-member
# selection keeps the home tenant). A raw read in any module outside this list
# and _VALIDATED_LOCALLY fails ``test_covered_raw_header_reads_are_validated``.
_FORWARDED_TO_COORD: dict[str, str] = {
    "app.api.v1.endpoints.operations": "_tenant_headers forwards it to coord",
    "app.api.v1.endpoints.agent_registry": (
        "captured into operations' ContextVar; _tenant_headers forwards it"
    ),
    "app.api.v1.endpoints.agent_sessions": "_coord_headers forwards it to coord",
    "app.api.v1.endpoints.repo_followup_dials": (
        "reads it only for can_edit's _effective_tenant_roles (membership-"
        "matched); operations' _tenant_headers forwards it to coord"
    ),
    "app.api.v1.endpoints.prompt_injections": "_coord_headers forwards it to coord",
    "app.services.coord_device_resolve": (
        "CoordCaller carries it to coord's /coord/devices/resolve, which "
        "scopes candidates to the membership-checked active tenant"
    ),
}

# Modules that read the raw header and validate it WEB-SIDE against the
# caller's coord memberships (the same rule as coord's override: a non-member
# selection degrades to home) before using it for anything local, such as a
# cache key. They also forward it to coord.
_VALIDATED_LOCALLY: dict[str, str] = {
    "app.api.v1.endpoints.admin_dev": (
        "_capture_bearer_best_effort matches the selection against identity.tenants"
    ),
    "app.api.v1.endpoints.digital_twin": (
        "subspaces keys its cache on _effective_tenant_id(identity, header)"
    ),
}

# Routes in modules that name a resolver or the header but which, read by a
# person, resolve no tenant. ``test_module_source_cross_check`` requires every
# such route to be listed here — so a route the TRACE cannot follow (a reach
# gap) fails instead of silently reading as "not tenant-resolving".
#
# Each entry is ``module -> (reason, paths)``. The reason says why the module
# names a resolver at all and what these routes are scoped by instead.
_UNTRACED: dict[str, tuple[str, frozenset[str]]] = {
    "app.api.v1.endpoints.users": (
        "names get_tenant_id only in a comment; /users/me* is the caller's own "
        "web-DB profile, /users is a superuser web-DB listing",
        frozenset(
            {
                "/api/v1/users",
                "/api/v1/users/me",
                "/api/v1/users/me/activity",
                "/api/v1/users/me/automation-streaming",
                "/api/v1/users/me/automation-streaming/reset-limit",
                "/api/v1/users/me/automation-streaming/toggle",
                "/api/v1/users/me/avatar",
                "/api/v1/users/me/connection-info",
                "/api/v1/users/me/preferences",
                "/api/v1/users/me/profile",
                "/api/v1/users/me/storage",
            }
        ),
    ),
    "app.api.v1.endpoints.devices": (
        "only pair-confirm resolves identity; the rest are device-owner scoped "
        "(Device.user_id / coord /devices/:id/owned) or device-JWT/CLI "
        "credential flows that carry their own tenant",
        frozenset(
            {
                "/api/v1/devices",
                "/api/v1/devices/connections",
                "/api/v1/devices/me",
                "/api/v1/devices/pair-cli",
                "/api/v1/devices/{device_id}",
                "/api/v1/devices/{device_id}/dispatch",
                "/api/v1/devices/{device_id}/machine-credential/exchange",
                "/api/v1/devices/{device_id}/machine-credential/mint",
                "/api/v1/devices/{device_id}/machine-credential/self-mint",
            }
        ),
    ),
    "app.api.v1.endpoints.pair_codes": (
        "redeem is called by the pairing runner with the code; the code's "
        "tenant was burned at mint time",
        frozenset({"/api/v1/devices/pair-codes/{code}/redeem"}),
    ),
    "app.api.v1.endpoints.operations": (
        "the in-process fleet beacon (device-owner scoped), local runner "
        "control, and superuser Cognito pool admin — none reaches coord",
        frozenset(
            {
                "/api/v1/operations/claude-sessions",
                "/api/v1/operations/coord/cognito/groups",
                "/api/v1/operations/coord/cognito/groups/{group_name}/users",
                "/api/v1/operations/fleet",
                "/api/v1/operations/fleet/machines/{hostname}",
                "/api/v1/operations/fleet/runners/{runner_id}",
                "/api/v1/operations/fleet/runners/{runner_id}/output",
                "/api/v1/operations/fleet/runners/{runner_id}/workflow-state",
                "/api/v1/operations/fleet/tasks",
                "/api/v1/operations/heartbeat",
            }
        ),
    ),
    "app.api.v1.endpoints.plan_library": (
        "organization-scoped web-DB plan bodies; only candidates, "
        "reconciliation and by-id add the coord overlay; /vocabulary is a "
        "static description of the write doors' closed fields (auth only)",
        frozenset(
            {
                "/api/v1/plan-library",
                "/api/v1/plan-library/capture-health",
                "/api/v1/plan-library/difficulty",
                "/api/v1/plan-library/divergent",
                "/api/v1/plan-library/edges/{edge_id}",
                "/api/v1/plan-library/export",
                "/api/v1/plan-library/followups",
                "/api/v1/plan-library/vocabulary",
                "/api/v1/plan-library/{artifact_id}/edges",
                "/api/v1/plan-library/{artifact_id}/export",
                "/api/v1/plan-library/{artifact_id}/kind",
            }
        ),
    ),
    "app.api.v1.endpoints.session_repository": (
        "organization-scoped web-DB session artifacts; only unfinished and "
        "relaunch proxy to coord",
        frozenset(
            {
                "/api/v1/session-repository",
                "/api/v1/session-repository/{artifact_id}",
                "/api/v1/session-repository/{artifact_id}/export",
                "/api/v1/session-repository/{artifact_id}/turns",
            }
        ),
    ),
    "app.api.v1.endpoints.helper_tasks": (
        "status reads the caller's web organization membership, not coord",
        frozenset({"/api/v1/helper-tasks/status"}),
    ),
    "app.api.v1.endpoints.devenv": (
        "names the header only for the canonical-set audit row (excluded, "
        "class c); the rest are owner-scoped web-DB rows and service-token "
        "coord calls that do not forward it",
        frozenset(
            {
                "/api/v1/devenv/applications",
                "/api/v1/devenv/applications/{application_id}",
                "/api/v1/devenv/auto-enroll-policy",
                "/api/v1/devenv/environments",
                "/api/v1/devenv/environments/{environment_id}",
                "/api/v1/devenv/environments/{environment_id}/canonical-history",
                "/api/v1/devenv/environments/{environment_id}/drift",
                "/api/v1/devenv/environments/{environment_id}/drift/{machine_id}",
                "/api/v1/devenv/environments/{environment_id}/machines/"
                "{machine_id}/config-history",
                "/api/v1/devenv/environments/{environment_id}/machines/"
                "{machine_id}/config-history/diff",
                "/api/v1/devenv/machines",
                "/api/v1/devenv/machines/dispatch-enroll",
                "/api/v1/devenv/machines/{machine_id}",
                "/api/v1/devenv/machines/{machine_id}/ci-node",
                "/api/v1/devenv/machines/{machine_id}/environment",
                "/api/v1/devenv/machines/{machine_id}/regenerate-enrollment",
                "/api/v1/devenv/machines/{machine_id}/repos-apply-dispatch",
                "/api/v1/devenv/machines/{machine_id}/revoke",
            }
        ),
    ),
    "app.api.v1.endpoints.fleet_dispatch": (
        "status reads the caller's own devices' deploy state; only "
        "fresh-host resolves a device through coord",
        frozenset({"/api/v1/dispatch/status/{app_id}"}),
    ),
    "app.api.v1.endpoints.fleet_targets": (
        "device-owner scoped reads/writes; only the designation PUT stamps a tenant",
        frozenset(
            {
                "/api/v1/fleet/apps",
                "/api/v1/fleet/apps/{app_id}",
                "/api/v1/fleet/freshness",
                "/api/v1/fleet/test-targets",
            }
        ),
    ),
}

# The prefix array has held at least this many entries since Phase 1; fewer
# means the parse lost entries, not that the list shrank on purpose.
_MIN_PREFIXES = 10


# --------------------------------------------------------------------------
# Frontend prefix parse
# --------------------------------------------------------------------------


# One TS token at a time: a string literal, a comment, the array's closing
# bracket, or any other single character. Scanning tokens (not lines) is what
# keeps a quoted path inside a ``/* ... */`` or trailing ``//`` comment, and a
# ``]`` inside a comment or string, from being read as array structure.
_TS_TOKEN = re.compile(
    r"""(?P<str>"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*')"""
    r"|(?P<comment>//[^\n]*|/\*.*?\*/)"
    r"|(?P<close>\])"
    r"|(?P<other>.)",
    re.DOTALL,
)


def _parse_prefixes(source: str) -> list[str]:
    """String literals of ``const ACTIVE_TENANT_URL_PREFIXES = [ ... ];``.

    Line, trailing and block comments are skipped, so a quoted path inside a
    comment is never mistaken for an entry. Fails loudly when the array (or
    its closing bracket) is absent.
    """
    start = re.search(r"const\s+ACTIVE_TENANT_URL_PREFIXES\s*=\s*\[", source)
    if start is None:
        pytest.fail(
            f"`const ACTIVE_TENANT_URL_PREFIXES = [...]` not found in "
            f"{_HTTP_CLIENT}. It was renamed, moved or reformatted; retarget "
            "this parse — the guard fails rather than passing with no prefixes."
        )
    entries: list[str] = []
    for token in _TS_TOKEN.finditer(source, start.end()):
        if token.group("close"):
            return entries
        literal = token.group("str")
        if literal:
            entries.append(literal[1:-1])
    pytest.fail(f"ACTIVE_TENANT_URL_PREFIXES in {_HTTP_CLIENT} has no closing `]`.")


def _frontend_prefixes() -> list[str]:
    if not _HTTP_CLIENT.is_file():
        pytest.fail(
            f"{_HTTP_CLIENT} not found. This guard reads the frontend's prefix "
            "allowlist; a missing file fails rather than passes."
        )
    return _parse_prefixes(_HTTP_CLIENT.read_text(encoding="utf-8"))


# --------------------------------------------------------------------------
# Classifier
# --------------------------------------------------------------------------


def _code_objects(code: types.CodeType) -> Iterable[types.CodeType]:
    yield code
    for const in code.co_consts:
        if isinstance(const, types.CodeType):
            yield from _code_objects(const)


def _is_header(value: Any) -> bool:
    return isinstance(value, str) and value.casefold() == _HEADER


def _local_imports(code: types.CodeType, package: str) -> Iterable[Any]:
    """Objects a function-local ``import`` / ``from ... import`` binds.

    Read from the bytecode (``IMPORT_NAME`` then ``IMPORT_FROM``), because a
    deferred import never reaches ``__globals__`` — ``UserManager.update``'s
    import of ``apply_activation_transition`` is the measured case.

    An in-scope (``app.*``) module that is not loaded yet IS imported here.
    Consulting only ``sys.modules`` made the verdict depend on which other
    test files in the same shard had imported that module first:
    ``/scheduled-runs/{run_id}/run-now``'s deferred import of
    ``app.jobs.scheduled_dispatch`` was traced in one CI shard and invisible
    in another. Out-of-scope modules are still never imported.
    """
    consts: list[Any] = []
    current: Any = None
    for ins in dis.get_instructions(code):
        if ins.opname == "IMPORT_NAME":
            level = consts[-2] if len(consts) >= 2 else 0
            name = str(ins.argval)
            if isinstance(level, int) and level:
                name = importlib.util.resolve_name("." * level + name, package)
            current = sys.modules.get(name)
            if current is None and name.startswith("app."):
                try:
                    current = importlib.import_module(name)
                except ModuleNotFoundError as err:
                    # A deferred import of a module that does not exist
                    # (``app.services.admin_notification_service``) can
                    # never run, so it reaches nothing. Any OTHER import
                    # failure inside an existing module is real breakage
                    # and must not silently empty the trace.
                    if err.name != name:
                        raise
                    current = None
            if current is not None:
                yield current
        elif ins.opname == "IMPORT_FROM" and current is not None:
            imported = getattr(current, str(ins.argval), None)
            if imported is not None:
                yield imported
        if ins.opname == "LOAD_CONST":
            consts.append(ins.argval)
        elif ins.opname not in ("IMPORT_NAME", "IMPORT_FROM"):
            consts.clear()


def _attrs_loaded_from_local(code: types.CodeType, local: str) -> set[str]:
    """Attribute names read directly off local ``local`` (``local.attr``)."""
    attrs: set[str] = set()
    for co in _code_objects(code):
        previous: dis.Instruction | None = None
        for ins in dis.get_instructions(co):
            if (
                ins.opname in ("LOAD_ATTR", "LOAD_METHOD")
                and previous is not None
                and previous.opname.startswith("LOAD_FAST")
                # 3.13 fuses two loads (``LOAD_FAST_LOAD_FAST``) into a tuple
                # argval; the attribute is read off the last one.
                and (
                    previous.argval[-1]
                    if isinstance(previous.argval, tuple)
                    else previous.argval
                )
                == local
            ):
                attrs.add(str(ins.argval))
            previous = ins
    return attrs


# Names a construction or a call of a class/instance runs without naming them.
_IMPLICIT_METHODS = frozenset({"__init__", "__new__", "__post_init__", "__call__"})


class _Classifier:
    """Transitive "does this reach the caller's tenant?" over in-scope code.

    Nodes are functions defined in ``scope`` modules (``app.*`` by default).
    A function's edges are what its bytecode names: module globals,
    attributes of referenced in-scope modules, and function-local imports.
    A referenced in-scope CLASS, or module-level INSTANCE of one, contributes
    the methods the same function names (``Cls.method`` / ``obj.method`` put
    ``method`` in ``co_names``) plus the implicit construction/call methods —
    never every method, which would make every route reach everything.
    A method called on an object whose class nothing on the path names (a
    parameter, a return value) is not followed here; injected dependencies
    are handled per route (:func:`_injected_methods`), and the module-source
    cross-check catches what remains.

    Cycles: a result computed while an ancestor was still on the stack is
    incomplete, so it is memoized only once its whole strongly-connected
    component has finished (Tarjan's lowlink), and verdicts do not depend on
    classification order.
    """

    def __init__(self, scope: tuple[str, ...] = ("app.",)) -> None:
        self._scope = scope
        self._memo: dict[int, frozenset[str]] = {}
        self._on_stack: dict[int, int] = {}
        # Keeps every visited function alive so an ``id()`` is never reused.
        self._pinned: list[Any] = []

    def in_scope(self, obj: Any) -> bool:
        module = str(getattr(obj, "__module__", "") or "")
        return module.startswith(self._scope)

    def evidence(self, obj: Any) -> frozenset[str]:
        """Evidence for a dependency / endpoint callable (any module)."""
        found: set[str] = set()
        for target in self._expand(obj, frozenset(), found):
            found |= self._reach(target)[0]
        return frozenset(found)

    def methods(self, cls: type, names: Iterable[str]) -> list[Any]:
        """``cls``'s in-scope functions named ``names`` (plus implicit ones)."""
        found: set[str] = set()
        return list(self._members(cls, frozenset(names), found))

    def _members(
        self, cls: type, names: frozenset[str], found: set[str]
    ) -> Iterable[Any]:
        wanted = names | _IMPLICIT_METHODS
        for klass in cls.__mro__:
            if not self.in_scope(klass):
                continue
            for name, value in vars(klass).items():
                if name not in wanted:
                    continue
                if _is_header(value):
                    found.add(f"header@{klass.__module__}")
                elif isinstance(value, property):
                    yield from (f for f in (value.fget, value.fset, value.fdel) if f)
                elif isinstance(value, staticmethod | classmethod):
                    yield value.__func__
                elif inspect.isfunction(value):
                    yield value

    def _expand(
        self, value: Any, names: frozenset[str], found: set[str]
    ) -> Iterable[Any]:
        """The functions ``value`` stands for, given the names its referrer
        uses; header constants go straight into ``found``."""
        if id(value) in _RESOLVERS:
            found.add(_RESOLVERS[id(value)])
            return
        if _is_header(value):
            return
        if isinstance(value, staticmethod | classmethod):
            value = value.__func__
        if inspect.ismethod(value):
            value = value.__func__
        if inspect.isfunction(value):
            try:
                value = inspect.unwrap(value)
            except ValueError:  # a __wrapped__ cycle
                return
            if id(value) in _RESOLVERS:
                found.add(_RESOLVERS[id(value)])
            else:
                yield value
            return
        if isinstance(value, types.ModuleType):
            # ``module.attr`` puts both names in co_names; resolve them
            # against every referenced in-scope module.
            if not value.__name__.startswith(self._scope):
                return
            for n in names:
                attr = getattr(value, n, None)
                if _is_header(attr):
                    found.add(f"header@{value.__name__}")
                elif attr is not None and not isinstance(attr, types.ModuleType):
                    yield from self._expand(attr, names, found)
            return
        cls = value if inspect.isclass(value) else type(value)
        if self.in_scope(cls):
            yield from self._members(cls, names, found)

    def _reach(self, func: Any) -> tuple[frozenset[str], int]:
        key = id(func)
        if key in self._memo:
            return self._memo[key], _NO_CUT
        if key in self._on_stack:
            return frozenset(), self._on_stack[key]

        depth = len(self._on_stack)
        self._on_stack[key] = depth
        self._pinned.append(func)
        found: set[str] = set()
        low = _NO_CUT
        for target in self._edges(func, found):
            if not self.in_scope(target):
                continue
            sub, sub_low = self._reach(target)
            found |= sub
            low = min(low, sub_low)
        del self._on_stack[key]

        result = frozenset(found)
        if low >= depth:
            # Every cut pointed at this node or deeper: its component is done.
            self._memo[key] = result
            low = _NO_CUT
        return result, low

    def _edges(self, func: Any, found: set[str]) -> Iterable[Any]:
        code = getattr(func, "__code__", None)
        if code is None:
            return
        names: set[str] = set()
        values: list[Any] = []
        package = str(func.__module__ or "").rpartition(".")[0]
        for co in _code_objects(code):
            names.update(co.co_names)
            for const in co.co_consts:
                if _is_header(const):
                    found.add(f"header@{func.__module__}")
            values.extend(_local_imports(co, package))
        namespace = func.__globals__
        values.extend(namespace[n] for n in names if n in namespace)
        frozen = frozenset(names)
        for value in values:
            if _is_header(value):
                found.add(f"header@{func.__module__}")
                continue
            yield from self._expand(value, frozen, found)


def _dependency_calls(dependant: Any) -> Iterable[Callable[..., Any]]:
    if dependant.call is not None:
        yield dependant.call
    for sub in dependant.dependencies:
        yield from _dependency_calls(sub)


def _provided_classes(provider: Any, classifier: _Classifier) -> list[type]:
    """In-scope classes a dependency provider names directly — the likely
    type of what it injects (``get_user_manager`` yields ``UserManager(...)``)."""
    if inspect.isclass(provider):
        return [provider] if classifier.in_scope(provider) else []
    func = getattr(provider, "__func__", provider)
    code = getattr(func, "__code__", None)
    if code is None:
        return []
    package = str(func.__module__ or "").rpartition(".")[0]
    values: list[Any] = []
    for co in _code_objects(code):
        values.extend(func.__globals__.get(n) for n in co.co_names)
        values.extend(_local_imports(co, package))
    return [v for v in values if inspect.isclass(v) and classifier.in_scope(v)]


def _injected_methods(dependant: Any, classifier: _Classifier) -> Iterable[Any]:
    """Methods a dependant calls on an injected parameter.

    ``async def update_user(user_manager = Depends(get_user_manager))`` then
    ``user_manager.update(...)``: the parameter's type is not in any namespace,
    so the name-based walk cannot follow ``update``. Pair each sub-dependency's
    parameter name with the attributes read off that local, and resolve them
    against the classes its provider constructs.
    """
    code = getattr(
        getattr(dependant.call, "__func__", dependant.call), "__code__", None
    )
    for sub in dependant.dependencies:
        if code is not None and sub.name and sub.call is not None:
            attrs = _attrs_loaded_from_local(code, sub.name)
            if attrs:
                for cls in _provided_classes(sub.call, classifier):
                    yield from classifier.methods(cls, attrs)
        yield from _injected_methods(sub, classifier)


def _tenant_resolving_routes(
    routes: Iterable[Any], kind: type = APIRoute
) -> dict[str, frozenset[str]]:
    """``{route.path: evidence}`` for every ``kind`` route (HTTP by default,
    ``APIWebSocketRoute`` for the socket check) whose trace reaches the tenant."""
    classifier = _Classifier()
    found: dict[str, frozenset[str]] = {}
    for route in routes:
        if not isinstance(route, kind):
            continue
        evidence: set[str] = set()
        for call in _dependency_calls(route.dependant):
            evidence |= classifier.evidence(call)
        for method in _injected_methods(route.dependant, classifier):
            evidence |= classifier.evidence(method)
        if evidence:
            found[route.path] = found.get(route.path, frozenset()) | evidence
    return found


def _uncovered(
    resolving: dict[str, frozenset[str]],
    prefixes: list[str],
    exclusions: dict[str, str],
) -> dict[str, frozenset[str]]:
    """Tenant-resolving routes no prefix (``includes`` rule) and no exclusion
    covers — the same rule ``http-client.ts`` ``isActiveTenantScopedUrl``
    applies to a request URL."""
    return {
        path: evidence
        for path, evidence in resolving.items()
        if path not in exclusions and not any(p in path for p in prefixes)
    }


def _live_routes() -> list[Any]:
    from app.main import app

    return list(app.routes)


# --------------------------------------------------------------------------
# Tests
# --------------------------------------------------------------------------


def test_prefix_parse_reads_the_whole_array():
    prefixes = _frontend_prefixes()
    assert len(prefixes) >= _MIN_PREFIXES, (
        f"Parsed only {len(prefixes)} entries from ACTIVE_TENANT_URL_PREFIXES "
        f"({prefixes}); expected at least {_MIN_PREFIXES}. The parse is losing "
        "entries — fix the parse rather than lowering the floor."
    )
    bad = [p for p in prefixes if not p.startswith("/api/v1/")]
    assert not bad, f"Prefixes outside /api/v1/ (parse error?): {bad}"
    assert "/api/v1/conditions/" in prefixes


def test_classifier_sees_every_known_resolution_shape():
    """Non-vacuity: one route per way a family reaches the tenant."""
    resolving = _tenant_resolving_routes(_live_routes())
    expected = {
        # Depends(get_tenant_id) → coord proxy.
        "/api/v1/conditions/groups": "get_tenant_id",
        # Header read inside a service module, never named in the endpoint.
        "/api/v1/devices/resolve": "CoordCaller",
        # Router outside endpoints/, mounted under /overview.
        "/api/v1/overview/pages": "get_overview_access",
        # Called in the body, not a dependency.
        "/api/v1/plan-library/candidates": "_soft_tenant_id",
        # Header constant under a private name (class c).
        "/api/v1/devenv/environments/{environment_id}/canonical": (
            "header@app.api.v1.endpoints.devenv"
        ),
        # fastapi-users' PATCH calls ``user_manager.update`` on an INJECTED
        # UserManager, whose ``update`` reaches the header through a
        # function-local import (coord_operator_activation).
        "/api/v1/auth/users/{id}": "header@app.services.coord_operator_activation",
    }
    missing = {
        path: token
        for path, token in expected.items()
        if token not in resolving.get(path, frozenset())
    }
    assert not missing, (
        "The classifier no longer sees these known tenant-resolving routes "
        f"(path -> expected evidence): {missing}. It has gone blind to a "
        "resolution shape; every coverage verdict below is untrustworthy."
    )


def test_every_tenant_resolving_route_is_covered():
    prefixes = _frontend_prefixes()
    resolving = _tenant_resolving_routes(_live_routes())
    uncovered = _uncovered(resolving, prefixes, _EXCLUSIONS)
    if uncovered:
        lines = "\n".join(
            f"  {path}   (reaches: {', '.join(sorted(ev))})"
            for path, ev in sorted(uncovered.items())
        )
        pytest.fail(
            "These routes resolve the caller's tenant, but no entry in "
            "ACTIVE_TENANT_URL_PREFIXES (frontend/src/services/http-client.ts) "
            "covers them, so the Project selector is silently ignored there:\n"
            f"{lines}\n"
            "Fix: if the route forwards the header to coord or scopes rows by "
            "the resolved tenant, add the narrowest covering prefix (with a "
            "comment) and a SCOPED_URLS entry in http-client.test.ts. If it "
            "reads the raw header without coord's membership check, or the "
            "selection must not change it, add it to _EXCLUSIONS in this file "
            "with the reason."
        )


def test_every_exclusion_is_still_live():
    resolving = _tenant_resolving_routes(_live_routes())
    stale = sorted(set(_EXCLUSIONS) - set(resolving))
    assert not stale, (
        f"_EXCLUSIONS names routes that no longer exist or no longer resolve a "
        f"tenant: {stale}. Delete them — a stale exclusion would silently "
        "excuse a future route at the same path."
    )
    prefixes = _frontend_prefixes()
    shadowed = sorted(p for p in _EXCLUSIONS if any(x in p for x in prefixes))
    assert not shadowed, (
        f"_EXCLUSIONS entries that a prefix now covers anyway: {shadowed}. "
        "Either the exclusion is wrong or the prefix is too broad."
    )


def test_guard_flags_an_uncovered_resolving_route():
    """Non-vacuity of the detector: a new family with Depends(get_tenant_id),
    and one reading the header by value, are both reported by path."""
    router = APIRouter()

    @router.get("/widgets")
    async def list_widgets(
        tenant_id: UUID = Depends(operations.get_tenant_id),
    ) -> str:
        return str(tenant_id)

    @router.get("/gadgets")
    async def list_gadgets(request: Request) -> str | None:
        return request.headers.get("X-Qontinui-Active-Tenant")

    @router.get("/plain")
    async def plain() -> str:
        return "ok"

    fixture = FastAPI()
    fixture.include_router(router, prefix="/api/v1/drift-fixture")

    resolving = _tenant_resolving_routes(fixture.routes)
    assert set(resolving) == {
        "/api/v1/drift-fixture/widgets",
        "/api/v1/drift-fixture/gadgets",
    }
    assert "get_tenant_id" in resolving["/api/v1/drift-fixture/widgets"]

    uncovered = _uncovered(resolving, _frontend_prefixes(), _EXCLUSIONS)
    assert set(uncovered) == set(resolving)
    assert not _uncovered(resolving, ["/api/v1/drift-fixture/"], {})


def test_prefix_parse_ignores_commented_entries():
    parsed = _parse_prefixes(
        """
        const ACTIVE_TENANT_URL_PREFIXES = [
          "/api/v1/a/",
          // "/api/v1/commented-out", and a ] that is not the end
          '/api/v1/b', // "/api/v1/trailing-comment"
          /* "/api/v1/block-comment",
             "/api/v1/block-comment-2" ] */
          "/api/v1/c", /* "/api/v1/inline-block" */ "/api/v1/d",
        ];
        const OTHER = ["/api/v1/not-this-array"];
        """
    )
    assert parsed == ["/api/v1/a/", "/api/v1/b", "/api/v1/c", "/api/v1/d"]


# --------------------------------------------------------------------------
# Classifier reach (synthetic, scoped to this module)
# --------------------------------------------------------------------------


def _cycle_a(depth: int) -> Any:
    if depth:
        return _cycle_b(depth - 1)
    return operations.get_tenant_id


def _cycle_b(depth: int) -> Any:
    return _cycle_a(depth)


class _Holder:
    @staticmethod
    def resolve() -> Any:
        return operations.get_tenant_id

    def unrelated(self) -> None:
        return None


def _calls_a_class_method() -> Any:
    return _Holder.resolve()


def _calls_an_unrelated_method() -> Any:
    return _Holder().unrelated()


def _imports_locally() -> Any:
    from app.api.v1.endpoints.operations import get_tenant_id

    return get_tenant_id


def _this_module_classifier() -> _Classifier:
    return _Classifier(scope=("app.", __name__))


def test_cycle_verdicts_do_not_depend_on_order():
    """a <-> b, only a names get_tenant_id: b resolves whichever is asked first."""
    a_first = _this_module_classifier()
    assert "get_tenant_id" in a_first.evidence(_cycle_a)
    assert "get_tenant_id" in a_first.evidence(_cycle_b)

    b_first = _this_module_classifier()
    assert "get_tenant_id" in b_first.evidence(_cycle_b)
    assert "get_tenant_id" in b_first.evidence(_cycle_a)


def test_classifier_follows_class_methods_and_local_imports():
    classifier = _this_module_classifier()
    assert "get_tenant_id" in classifier.evidence(_calls_a_class_method)
    assert "get_tenant_id" in classifier.evidence(_imports_locally)
    # Only the methods a function names are followed, not the whole class.
    assert not classifier.evidence(_calls_an_unrelated_method)


def _unvalidated_header_reads(
    covered: dict[str, frozenset[str]],
) -> dict[str, list[str]]:
    """Per covered route, the raw-read modules in neither trusted list."""
    trusted = set(_FORWARDED_TO_COORD) | set(_VALIDATED_LOCALLY)
    found: dict[str, list[str]] = {}
    for path, ev in covered.items():
        bad = sorted(
            e.removeprefix("header@")
            for e in ev
            if e.startswith("header@") and e.removeprefix("header@") not in trusted
        )
        if bad:
            found[path] = bad
    return found


def test_covered_raw_header_reads_are_validated():
    """A prefix must not carry the header onto a raw, unvalidated read.

    On a covered route, EVERY raw header read (``header@<module>`` evidence)
    must be in a module listed in :data:`_FORWARDED_TO_COORD` or
    :data:`_VALIDATED_LOCALLY` — a validating resolver elsewhere on the same
    path does not excuse a raw read that uses the value unchecked.
    """
    prefixes = _frontend_prefixes()
    resolving = _tenant_resolving_routes(_live_routes())
    covered = {
        path: ev for path, ev in resolving.items() if any(p in path for p in prefixes)
    }
    unvalidated = _unvalidated_header_reads(covered)
    assert not unvalidated, (
        "These COVERED routes read X-Qontinui-Active-Tenant in modules that "
        f"neither forward it to coord nor validate it: {unvalidated}. The "
        "prefix turns an unvalidated client value into a trusted one (class "
        "c): narrow the prefix and add the route to _EXCLUSIONS, or — if the "
        "module forwards the header to coord / checks it against the caller's "
        "coord memberships — add it to _FORWARDED_TO_COORD / "
        "_VALIDATED_LOCALLY with why."
    )
    used = {
        e.removeprefix("header@")
        for ev in covered.values()
        for e in ev
        if e.startswith("header@")
    }
    stale = sorted((set(_FORWARDED_TO_COORD) | set(_VALIDATED_LOCALLY)) - used)
    assert not stale, f"Trusted header-read modules no covered route uses: {stale}"


def test_raw_read_on_a_covered_route_is_caught():
    """Non-vacuity of the over-coverage rule, on a synthetic route — including
    one where a validating resolver sits on the same path."""
    router = APIRouter()

    @router.get("/raw")
    async def raw(request: Request) -> str | None:
        return request.headers.get("X-Qontinui-Active-Tenant")

    @router.get("/raw-beside-a-resolver")
    async def raw_beside(
        request: Request,
        tenant_id: UUID = Depends(operations.get_tenant_id),
    ) -> str | None:
        return request.headers.get("X-Qontinui-Active-Tenant")

    fixture = FastAPI()
    fixture.include_router(router, prefix="/api/v1/operations")
    resolving = _tenant_resolving_routes(fixture.routes)
    assert __name__ not in _FORWARDED_TO_COORD
    assert __name__ not in _VALIDATED_LOCALLY
    assert _unvalidated_header_reads(resolving) == {
        "/api/v1/operations/raw": [__name__],
        "/api/v1/operations/raw-beside-a-resolver": [__name__],
    }


def _reads_query_selection(route: APIWebSocketRoute) -> bool:
    """The endpoint's code names the ``active_tenant`` query param."""
    code = getattr(inspect.unwrap(route.endpoint), "__code__", None)
    return code is not None and any(
        "active_tenant" in co.co_consts for co in _code_objects(code)
    )


def _ws_without_query_selection(routes: Iterable[Any]) -> list[str]:
    resolving = _tenant_resolving_routes(routes, kind=APIWebSocketRoute)
    return sorted(
        route.path
        for route in routes
        if isinstance(route, APIWebSocketRoute)
        and route.path in resolving
        and not _reads_query_selection(route)
    )


def test_tenant_resolving_websockets_read_the_query_selection():
    """A WebSocket cannot carry the header, so no prefix can scope one: the
    selection must ride the ``active_tenant`` query param instead (the
    operations bridges, validated by ``_effective_tenant_id``)."""
    routes = _live_routes()
    resolving = _tenant_resolving_routes(routes, kind=APIWebSocketRoute)
    assert resolving, (
        "No tenant-resolving WebSocket route found; the operations bridges "
        "used to classify. The WS check has gone vacuous."
    )
    missing = _ws_without_query_selection(routes)
    assert not missing, (
        f"These WebSocket routes resolve the caller's tenant but never read the "
        f"`active_tenant` query param: {missing}. A browser WebSocket cannot "
        "send X-Qontinui-Active-Tenant, so a prefix will NOT help. Read "
        "websocket.query_params.get('active_tenant') and validate it with "
        "_effective_tenant_id, as operations.websocket_device_status does."
    )


def test_ws_check_flags_a_socket_ignoring_the_selection():
    router = APIRouter()

    @router.websocket("/ws-ignores")
    async def ignores(
        websocket: WebSocket,
        tenant_id: UUID = Depends(operations.get_tenant_id),
    ) -> None:
        await websocket.close()

    @router.websocket("/ws-reads")
    async def reads(
        websocket: WebSocket,
        tenant_id: UUID = Depends(operations.get_tenant_id),
    ) -> None:
        websocket.query_params.get("active_tenant")
        await websocket.close()

    fixture = FastAPI()
    fixture.include_router(router, prefix="/api/v1/operations")
    assert _ws_without_query_selection(fixture.routes) == [
        "/api/v1/operations/ws-ignores"
    ]


_RESOLVER_TOKENS = tuple(sorted(set(_RESOLVERS.values())))


def _names_a_resolver(module_name: str, cache: dict[str, bool]) -> bool:
    if module_name not in cache:
        module = sys.modules.get(module_name)
        try:
            source = inspect.getsource(module) if module is not None else ""
        except (OSError, TypeError):
            source = ""
        cache[module_name] = _HEADER in source.casefold() or any(
            token in source for token in _RESOLVER_TOKENS
        )
    return cache[module_name]


def test_module_source_cross_check():
    """Catch a reach gap: a route whose endpoint MODULE names a resolver or
    the header, yet the trace classifies it as not resolving, must be listed
    in :data:`_UNTRACED` with why it truly does not resolve a tenant."""
    resolving = {
        **_tenant_resolving_routes(_live_routes()),
        **_tenant_resolving_routes(_live_routes(), kind=APIWebSocketRoute),
    }
    cache: dict[str, bool] = {}
    unexplained: dict[str, set[str]] = {}
    seen: dict[str, set[str]] = {}
    for route in _live_routes():
        if not isinstance(route, APIRoute | APIWebSocketRoute):
            continue
        module = route.endpoint.__module__
        if route.path in resolving or not _names_a_resolver(module, cache):
            continue
        seen.setdefault(module, set()).add(route.path)
        listed = _UNTRACED.get(module)
        if listed is None or route.path not in listed[1]:
            unexplained.setdefault(module, set()).add(route.path)
    assert not unexplained, (
        "Routes whose module names a tenant resolver or the active-tenant "
        "header, but which the trace does NOT classify as resolving: "
        f"{ {m: sorted(p) for m, p in unexplained.items()} }. Either the classifier cannot reach the resolver (a "
        "reach gap — extend _Classifier or _injected_methods), or the route "
        "really resolves no tenant: then add its path to that module's entry "
        "in _UNTRACED."
    )
    stale = {
        module: sorted(paths - seen.get(module, set()))
        for module, (_, paths) in _UNTRACED.items()
        if paths - seen.get(module, set())
    }
    assert not stale, (
        f"_UNTRACED lists paths that are gone or now classify as resolving: "
        f"{stale}. Delete them."
    )


def _ci_paths(workflow: dict[Any, Any], trigger: str) -> list[str]:
    triggers = workflow.get("on", workflow.get(True))
    assert isinstance(triggers, dict), f"No `on:` mapping in {_BACKEND_CI}."
    block = triggers.get(trigger)
    assert isinstance(block, dict), f"No `on.{trigger}` mapping in {_BACKEND_CI}."
    paths = block.get("paths")
    assert isinstance(paths, list) and paths, (
        f"`on.{trigger}.paths` missing or empty in {_BACKEND_CI}."
    )
    return [str(p) for p in paths]


def test_backend_ci_triggers_on_the_prefix_file():
    """A frontend-only PR that drops a prefix must run this guard."""
    workflow = yaml.safe_load(_BACKEND_CI.read_text(encoding="utf-8"))
    relative = _HTTP_CLIENT.relative_to(_REPO_ROOT).as_posix()
    for trigger in ("pull_request", "push"):
        assert relative in _ci_paths(workflow, trigger), (
            f"{relative} is not in backend-ci.yml `on.{trigger}.paths`, so a "
            "frontend-only change to the prefix list never runs this guard."
        )
