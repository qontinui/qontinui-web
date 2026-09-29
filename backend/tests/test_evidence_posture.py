"""Every device-JWT-admitted write route carries exactly one evidence posture.

Phase 3 of plan
``2026-09-20-nothing-checks-that-an-agent-writable-evidence-store-ships-its-vocabulary-and-a-correction-verb``.
The table is ``app.core.evidence_posture.ROUTE_POSTURE``; its module docstring
says what each posture means. These tests are DB-free and walk the LIVE
``app.routes`` — never a grep, never a hand list of paths.

Proved by mutation when this landed (recorded in the PR):

* M6 — a write route under ``get_audit_actor_user`` with no row →
  ``test_every_device_writable_route_has_a_posture_row`` red.
* M6b — the same route behind a wrapper dependency that itself depends on
  ``get_audit_actor_user`` → the same test red, which proves the walk
  recurses (a one-level walk sees only the wrapper).
* M6c — a wrapper that calls ``get_authenticated_device_user`` BY HAND in its
  body (the ``get_runner_user`` shape, invisible to the dependency walk) →
  ``test_every_device_jwt_verifier_is_an_admitting_dependency`` red.
* M6d — the same with an attribute-form call (``deps._verify_device_jwt(...)``)
  → the same test red.
* M6e — an ALIASED hand-delegating call (``from app.api.deps import
  get_authenticated_device_user as gadu`` then ``gadu(...)``) → the same test
  red.
* M6f — two classes in ONE module each defining ``__call__``: the first
  calls ``deps._verify_device_jwt``, the second returns 1. Keyed by bare
  name the second shadowed the first and the test stayed green; keyed by
  qualname → the same test red.
* M8 — the memory-records ``Verb`` narrowed to ``admits=("live",)``, a
  non-terminal state → ``test_every_correction_verb_admits_a_terminal_state``
  red.
"""

from __future__ import annotations

import ast
import importlib
import re
from pathlib import Path
from typing import Any

import pytest
from fastapi import Depends, FastAPI
from fastapi.routing import APIRoute
from pydantic import BaseModel

from app.core.evidence_posture import (
    ROUTE_POSTURE,
    STORES,
    WRITE_METHODS,
    AppendOnlyByDesign,
    Ephemeral,
    Evidence,
    Gap,
    Read,
    SupersedeArg,
    Verb,
    correction_sentences,
    device_jwt_admitting_dependencies,
    device_writable_routes,
    gaps,
    unserved_closed_fields,
)

#: THE RATCHET. The number of ``Gap`` corrections in ``ROUTE_POSTURE`` (row
#: corrections and aspect corrections alike). Raise it only by adding a gap
#: that is really there; LOWER it in the PR that lands the verb and swaps the
#: row. The seven at landing (2026-09-30):
#:
#: * ``POST /plan-library`` [kind] — the junk-row plan's soft-delete (#1545);
#: * ``POST /plan-library/{artifact_id}/edges`` — the edge verbs (#1459);
#: * ``PATCH /plan-library/edges/{edge_id}`` — the edge verbs (#1459);
#: * ``POST /session-repository`` [identity] — this plan;
#: * ``POST /testing/runs``, ``…/deficiencies``, ``…/screenshots`` — this plan.
GAP_COUNT_PIN = 7

#: The number of declared closed fields whose schema serves no ``enum``.
#: Same ratchet rules. At landing: ``POST /events/workflow`` ``event_type``;
#: the testing reports' ``transitions[].status``, ``transitions[].error_type``,
#: ``deficiencies[].severity``, ``deficiencies[].deficiency_type``, the
#: completion ``status`` and the screenshot ``screenshot_type``.
UNSERVED_CLOSED_FIELD_PIN = 7

#: A plan stem as the corpus spells one: ``YYYY-MM-DD-kebab-case``.
_PLAN_STEM = re.compile(r"^\d{4}-\d{2}-\d{2}-[a-z0-9]+(?:-[a-z0-9]+)*$")

#: A reason a reviewer can act on, not a placeholder.
_MIN_REASON = 40

_APP_DIR = Path(__file__).resolve().parents[1] / "app"


@pytest.fixture(scope="module")
def live_routes() -> list[Any]:
    from app.main import app

    return list(app.routes)


@pytest.fixture(scope="module")
def population(live_routes: list[Any]) -> dict[tuple[str, str], frozenset[str]]:
    return device_writable_routes(live_routes)


# ───────────────────────────── exhaustiveness ─────────────────────────────


def test_every_device_writable_route_has_a_posture_row(
    population: dict[tuple[str, str], frozenset[str]],
) -> None:
    missing = sorted(set(population) - set(ROUTE_POSTURE))
    stale = sorted(set(ROUTE_POSTURE) - set(population))
    assert not missing, (
        "device-JWT-admitted write route(s) with NO evidence-posture row — "
        "classify each in app/core/evidence_posture.py ROUTE_POSTURE by "
        f"reading its handler: {missing}"
    )
    assert not stale, (
        "ROUTE_POSTURE row(s) naming no device-JWT-admitted write route — the "
        f"route moved, lost its device admission, or was deleted: {stale}"
    )


def test_the_population_is_not_vacuous(
    population: dict[tuple[str, str], frozenset[str]],
) -> None:
    """A walk that found nothing would pass the exhaustiveness test vacuously.

    The two anchors are the plan library's upsert and the memory write — the
    stores this plan exists for — and the floor is the population measured at
    landing, so a walk that silently stops seeing routes goes red here.
    """
    assert ("POST", "/api/v1/plan-library") in population
    assert ("POST", "/api/v1/memory/records") in population
    assert ("POST", "/api/v1/testing/runs") in population  # hand-delegating wrapper
    assert len(population) >= 24, sorted(population)


def test_the_walk_recurses_through_a_wrapper_dependency() -> None:
    """``route.dependant.dependencies`` is DIRECT only; the walk must not be."""
    from app.api.deps import get_audit_actor_user

    async def wrapper(user: Any = Depends(get_audit_actor_user)) -> Any:
        return user

    async def deeper(inner: Any = Depends(wrapper)) -> Any:
        return inner

    probe = FastAPI()

    @probe.post("/direct")
    async def direct(user: Any = Depends(get_audit_actor_user)) -> None: ...

    @probe.put("/wrapped")
    async def wrapped(inner: Any = Depends(deeper)) -> None: ...

    @probe.get("/read-only")
    async def read_only(user: Any = Depends(get_audit_actor_user)) -> None: ...

    found = device_writable_routes(list(probe.routes))
    assert set(found) == {("POST", "/direct"), ("PUT", "/wrapped")}
    assert found[("PUT", "/wrapped")] == frozenset({"get_audit_actor_user"})


def test_a_handler_that_verifies_a_device_jwt_itself_is_in_the_population() -> None:
    """The walk covers the route's own endpoint, not only its dependencies:
    a handler that verifies the bearer in its OWN body (and is therefore in
    the admitting set — the verifier scan below demands it) must enter the
    population."""
    from fastapi import Request

    async def self_verifying(request: Request) -> None:
        from app.api import deps

        await deps._verify_device_jwt(request.headers.get("authorization", ""))

    probe = FastAPI()
    probe.post("/self-verifying")(self_verifying)
    admitting = device_jwt_admitting_dependencies() | {self_verifying}
    found = device_writable_routes(list(probe.routes), admitting)
    assert found == {("POST", "/self-verifying"): frozenset({"self_verifying"})}
    # …and without it in the set, nothing: the scan, not the walk, is what
    # puts a self-verifying handler there.
    assert device_writable_routes(list(probe.routes)) == {}


#: Calls that verify a coord device JWT at the root of the transitive scan.
_VERIFIER_ROOTS = frozenset({"_verify_device_jwt", "_resolve_actor_principal"})


def _import_aliases(tree: ast.Module) -> dict[str, str]:
    """``local name → real name`` for every aliased ``from … import x as y``
    anywhere in the module (function-local imports included), so
    ``from app.api.deps import get_authenticated_device_user as gadu`` makes
    ``gadu(...)`` read as the call it is."""
    aliases: dict[str, str] = {}
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom):
            for alias in node.names:
                if alias.asname:
                    aliases[alias.asname] = alias.name
    return aliases


def _called_name(call: ast.Call, aliases: dict[str, str]) -> str | None:
    """The real simple name a call targets — ``f(...)``, ``a.b.f(...)`` and
    an aliased ``g(...)`` (``from m import f as g``) all give ``f``.
    Attribute form matters: ``deps._verify_device_jwt(...)`` is as much a
    verification as the bare-name spelling."""
    func = call.func
    if isinstance(func, ast.Name):
        return aliases.get(func.id, func.id)
    if isinstance(func, ast.Attribute):
        return func.attr
    return None


def _is_coord_verify_token(call: ast.Call, aliases: dict[str, str]) -> bool:
    """``coord_jwks_client.verify_token(...)`` under any receiver path
    (``coord_jwks.coord_jwks_client.verify_token(...)`` included) and under
    an import alias — and NOT ``cognito_jwks_client.verify_token``, which
    verifies a different token."""
    func = call.func
    if not (isinstance(func, ast.Attribute) and func.attr == "verify_token"):
        return False
    receiver = func.value
    if isinstance(receiver, ast.Name):
        name = aliases.get(receiver.id, receiver.id)
    else:
        name = getattr(receiver, "attr", "")
    return name == "coord_jwks_client"


class _QualifiedFunctions(ast.NodeVisitor):
    """Every function in a module, keyed by its ``__qualname__`` spelling
    (``Class.method``, ``outer.<locals>.inner``) — NOT by its bare name,
    because same-named functions in one module (a dozen ``__call__`` /
    ``__init__`` methods) would otherwise overwrite each other and let a
    verifying one be shadowed by an innocent twin."""

    def __init__(self) -> None:
        self.stack: list[str] = []
        self.found: list[tuple[str, ast.FunctionDef | ast.AsyncFunctionDef]] = []

    def visit_ClassDef(self, node: ast.ClassDef) -> None:
        self.stack.append(node.name)
        self.generic_visit(node)
        self.stack.pop()

    def _function(self, node: ast.FunctionDef | ast.AsyncFunctionDef) -> None:
        self.found.append((".".join([*self.stack, node.name]), node))
        self.stack += [node.name, "<locals>"]
        self.generic_visit(node)
        del self.stack[-2:]

    visit_FunctionDef = _function
    visit_AsyncFunctionDef = _function


def _functions_verifying_a_device_jwt(admitting_names: frozenset[str]) -> set[str]:
    """``module.qualname`` of every function under ``app/`` that verifies a
    coord device JWT, TRANSITIVELY.

    A function is in the set when its body calls ``coord_jwks_client.
    verify_token``, a root verifier, an admitting dependency BY HAND (a
    ``Depends()`` default is not a call and does not count), or any function
    already in the set — iterated to a fixpoint, so a wrapper that delegates
    by hand (``get_runner_user`` calling ``get_authenticated_device_user``
    in its body, invisible to the dependency walk) is found however deep.
    """
    functions: dict[str, tuple[str, set[str], bool]] = {}
    for path in sorted(_APP_DIR.rglob("*.py")):
        module = ".".join(path.relative_to(_APP_DIR.parent).with_suffix("").parts)
        tree = ast.parse(path.read_text(encoding="utf-8"))
        aliases = _import_aliases(tree)
        visitor = _QualifiedFunctions()
        visitor.visit(tree)
        for qualname, node in visitor.found:
            calls = [c for c in ast.walk(node) if isinstance(c, ast.Call)]
            names = {n for c in calls if (n := _called_name(c, aliases)) is not None}
            coord_verify = any(_is_coord_verify_token(c, aliases) for c in calls)
            key = f"{module}.{qualname}"
            assert key not in functions, f"two functions share a qualname: {key}"
            functions[key] = (node.name, names, coord_verify)

    verifying: set[str] = set()
    targets = set(_VERIFIER_ROOTS) | set(admitting_names)
    while True:
        grown = {
            key
            for key, (_name, names, coord_verify) in functions.items()
            if key not in verifying and (coord_verify or names & targets)
        }
        if not grown:
            return verifying
        verifying |= grown
        targets |= {functions[key][0] for key in grown}


#: Functions that verify a coord device JWT but are NOT route dependencies,
#: each with why the population walk does not need them.
_NOT_A_ROUTE_DEPENDENCY: dict[str, str] = {
    "app.api.deps._verify_device_jwt": (
        "the verifier itself; reached only through the dependencies in the set"
    ),
    "app.api.deps._resolve_actor_principal": (
        "a plain coroutine the dual-auth dependencies call by hand; never a Depends()"
    ),
    "app.api.v1.endpoints.devices_ws.websocket_device_unified_endpoint": (
        "a WebSocket endpoint — no write METHOD, so never in the population"
    ),
    "app.api.v1.endpoints.devices_ws._route_device_message": (
        "dispatches frames inside the device WebSocket session, not an HTTP route"
    ),
    "app.services.runner.remote_terminal_relay.RemoteTerminalRelay._verify_grant": (
        "verifies a relay capability grant inside a WebSocket session, not an HTTP route"
    ),
    "app.services.runner.remote_terminal_relay.RemoteTerminalRelay._handle_attach": (
        "relay frame handler reached from the device WebSocket, not an HTTP route"
    ),
    "app.services.runner.remote_terminal_relay.RemoteTerminalRelay._handle_create": (
        "relay frame handler reached from the device WebSocket, not an HTTP route"
    ),
    "app.services.runner.remote_terminal_relay.handle_source_frame": (
        "relay frame entry point reached from the device WebSocket, not an HTTP route"
    ),
    "app.services.runner.remote_terminal_relay.RemoteTerminalRelay.handle_source_frame": (
        "relay frame entry point reached from the device WebSocket, not an HTTP route"
    ),
}


def test_every_device_jwt_verifier_is_an_admitting_dependency() -> None:
    """The admitting set is a hand list; this keeps it exhaustive.

    A new dependency that verifies a device JWT and is left out of
    ``device_jwt_admitting_dependencies()`` would drop every route using it
    out of the population — read as "not agent-writable" — so it fails here.
    """
    dependencies = device_jwt_admitting_dependencies()
    admitting = {f"{fn.__module__}.{fn.__qualname__}" for fn in dependencies}
    verifiers = _functions_verifying_a_device_jwt(
        frozenset(fn.__name__ for fn in dependencies)
    )
    unaccounted = sorted(verifiers - admitting - set(_NOT_A_ROUTE_DEPENDENCY))
    assert not unaccounted, (
        "function(s) that verify a coord device JWT but are neither in "
        "device_jwt_admitting_dependencies() nor declared not to be a route "
        f"dependency: {unaccounted}"
    )
    stale = sorted(set(_NOT_A_ROUTE_DEPENDENCY) - verifiers)
    assert not stale, f"_NOT_A_ROUTE_DEPENDENCY names no verifier any more: {stale}"


# ───────────────────────────── the rows themselves ─────────────────────────────


def _reasons(posture: Any) -> list[str]:
    if isinstance(posture, (Read, Ephemeral)):
        return [posture.reason]
    texts: list[str] = []
    for _aspect, correction in posture.corrections():
        if isinstance(correction, AppendOnlyByDesign):
            texts.append(correction.reason)
        elif isinstance(correction, SupersedeArg):
            assert correction.property.strip(), posture
            texts.append(correction.how)
        elif isinstance(correction, Gap):
            texts.append(correction.what)
    return texts


@pytest.mark.parametrize("key", sorted(ROUTE_POSTURE), ids=" ".join)
def test_every_reason_is_specific(key: tuple[str, str]) -> None:
    """``Ephemeral`` / ``AppendOnlyByDesign`` / ``Gap`` must say WHY — a
    blank or token reason is the rubber stamp the table exists to refuse."""
    posture = ROUTE_POSTURE[key]
    for text in _reasons(posture):
        assert len(text.strip()) >= _MIN_REASON, (key, text)
    assert correction_sentences(posture), key


def test_every_gap_is_owned_and_the_count_is_pinned() -> None:
    found = gaps()
    for key, aspect, gap in found:
        assert gap.tracked_by.strip(), (key, aspect)
        assert _PLAN_STEM.match(gap.tracked_by), (key, aspect, gap.tracked_by)
    listing = [f"{m} {p} [{a or 'row'}] -> {g.tracked_by}" for (m, p), a, g in found]
    assert len(found) <= GAP_COUNT_PIN, (
        f"a NEW correction gap landed ({len(found)} > pin {GAP_COUNT_PIN}). If "
        "it is real, raise GAP_COUNT_PIN in the same PR and name its owning "
        f"plan; otherwise give the door a correction verb: {listing}"
    )
    assert len(found) >= GAP_COUNT_PIN, (
        f"a gap was CLOSED ({len(found)} < pin {GAP_COUNT_PIN}) — claim it by "
        f"lowering GAP_COUNT_PIN to {len(found)}: {listing}"
    )


def test_unserved_closed_field_count_is_pinned() -> None:
    found = unserved_closed_fields()
    for key, name, tracked_by in found:
        assert _PLAN_STEM.match(tracked_by), (key, name, tracked_by)
    assert len(found) == UNSERVED_CLOSED_FIELD_PIN, (
        "the number of closed fields whose schema serves no enum moved "
        f"({len(found)} vs pin {UNSERVED_CLOSED_FIELD_PIN}); raise the pin only "
        f"for a real new one, lower it when one is served: {found}"
    )


def test_every_correction_verb_resolves_to_a_live_route(live_routes: list[Any]) -> None:
    """A ``Verb`` (and its ``first`` step) must name a mounted route."""
    mounted = {
        (method, route.path)
        for route in live_routes
        if isinstance(route, APIRoute)
        for method in route.methods or set()
    }
    for key, posture in ROUTE_POSTURE.items():
        if not isinstance(posture, Evidence):
            continue
        for aspect, correction in posture.corrections():
            if not isinstance(correction, Verb):
                continue
            for verb in filter(None, (correction.first, correction.verb)):
                method, _, path = verb.partition(" ")
                assert method in WRITE_METHODS, (key, aspect, verb)
                assert (method, path) in mounted, (
                    f"{key} [{aspect or 'row'}] names correction verb "
                    f"{verb!r}, which is not a mounted route"
                )


def test_every_correction_verb_admits_a_terminal_state() -> None:
    """Plan D2 test (iii): mounting is not correction.

    A row carrying a ``Verb`` names its store; the verb's ``admits`` must be
    states that store has, and must MEET the store's terminal states — the
    states a wrong record rests in with nothing automatic left to move it. A
    verb admitting only non-terminal states (coord's three open-gate-only gate
    verbs are the measured instance of the shape) corrects nothing.
    """
    for key, posture in ROUTE_POSTURE.items():
        if not isinstance(posture, Evidence):
            continue
        verbs = [(a, c) for a, c in posture.corrections() if isinstance(c, Verb)]
        if not verbs:
            continue
        assert posture.store in STORES, (
            f"{key}: a row with a Verb correction must name its store "
            f"(one of {sorted(STORES)}), got {posture.store!r}"
        )
        store = STORES[posture.store]
        assert set(store.terminal) <= set(store.states), posture.store
        for aspect, verb in verbs:
            assert verb.admits, (key, aspect)
            assert set(verb.admits) <= set(store.states), (
                key,
                aspect,
                sorted(set(verb.admits) - set(store.states)),
            )
            assert set(verb.admits) & set(store.terminal), (
                f"{key} [{aspect or 'row'}]: {verb.verb} admits only "
                f"{sorted(verb.admits)}, none of {posture.store}'s terminal "
                f"states {sorted(store.terminal)} — it is not a correction "
                "verb; the row is a Gap"
            )


# ───────────────────────────── closed fields (plan D3) ─────────────────────────────


def _walk_schema(
    schema: dict[str, Any],
    defs: dict[str, Any],
    prefix: str,
    paths: set[str],
    enum_paths: set[str],
) -> None:
    """Collect the dotted path of every property (``records[].kind``), and
    separately of every property that carries an ``enum`` / ``const``."""
    if "$ref" in schema:
        target = defs[schema["$ref"].rsplit("/", 1)[-1]]
        _walk_schema(target, defs, prefix, paths, enum_paths)
        return
    if prefix:
        paths.add(prefix)
        if "enum" in schema or "const" in schema:
            enum_paths.add(prefix)
    for key in ("anyOf", "oneOf", "allOf"):
        for sub in schema.get(key, []):
            _walk_schema(sub, defs, prefix, paths, enum_paths)
    if schema.get("type") == "array" and isinstance(schema.get("items"), dict):
        _walk_schema(schema["items"], defs, f"{prefix}[]", paths, enum_paths)
    for name, sub in schema.get("properties", {}).items():
        child = f"{prefix}.{name}" if prefix else name
        _walk_schema(sub, defs, child, paths, enum_paths)


def _body_models(route: APIRoute, posture: Evidence) -> list[type[BaseModel]]:
    if posture.body_model is not None:
        module, _, name = posture.body_model.partition(":")
        return [getattr(importlib.import_module(module), name)]
    models = []
    for param in route.dependant.body_params:
        annotation = param.field_info.annotation
        if isinstance(annotation, type) and issubclass(annotation, BaseModel):
            models.append(annotation)
    return models


def test_declared_closed_fields_equal_the_body_schema_enums(
    live_routes: list[Any],
) -> None:
    """Both directions: a closed field the body schema serves as an ``enum``
    must be declared on the row, and a declared one must really be served.
    An ``unserved_closed_fields`` entry must name a real property that serves
    NO enum — the row admits the gap rather than hiding it."""
    by_key = {
        (method, route.path): route
        for route in live_routes
        if isinstance(route, APIRoute)
        for method in route.methods or set()
    }
    for key, posture in ROUTE_POSTURE.items():
        if not isinstance(posture, Evidence):
            continue
        served: set[str] = set()
        properties: set[str] = set()
        for model in _body_models(by_key[key], posture):
            schema = model.model_json_schema()
            _walk_schema(schema, schema.get("$defs", {}), "", properties, served)
        assert set(posture.closed_fields) == served, (
            f"{key}: declared closed_fields {sorted(posture.closed_fields)} != "
            f"enum-bearing body properties {sorted(served)}"
        )
        for name, _tracked_by in posture.unserved_closed_fields:
            assert name in properties, (key, name)
            assert name not in served, (
                f"{key}: {name} now serves an enum — move it to closed_fields "
                "and lower UNSERVED_CLOSED_FIELD_PIN"
            )
