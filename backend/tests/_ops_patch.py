"""Patch a name wherever the ``/operations`` code looks it up.

Plan ``2026-10-04-web-operations-py-is-one-router-for-every-coord-domain``
(D6) splits ``app/api/v1/endpoints/operations.py`` into a package of
per-domain modules. A test that patches an imported name by string
(``patch("app.api.v1.endpoints.operations.get_coord_identity")``) patches the
binding in ONE module; once the route that looks the name up lives in
``operations.<domain>``, that patch stops reaching it and the test passes
vacuously or fails for an unrelated reason.

:func:`patch_ops` patches ``name`` in **every** already-loaded module under
the ``app.api.v1.endpoints.operations`` package, plus ``app.api.coord_proxy``,
that binds it. Before the split that is one module; after it, several. It
raises :class:`LookupError` when no module binds the name, so a typo or a
stale target is loud, never vacuous.

Dotted names (``"runner_crud.list_runners"``, ``"settings.USE_SES_API"``)
patch the final attribute on the object the head name is bound to. When
several modules bind the same object (the ``runner_crud`` module, the global
``settings``), the owner is patched once — owners are de-duplicated by
identity.

The call shape mirrors :func:`unittest.mock.patch`: ``new`` defaults to a
``MagicMock`` (an ``AsyncMock`` for an async target), keyword arguments
(``new_callable``, ``return_value``, ``side_effect`` …) are forwarded, and
entering the context yields the replacement. The one replacement object is
bound into every target, so assertions on it see every call.

:func:`setattr_ops` is the ``monkeypatch`` form: the same resolution, undone
by pytest at teardown.

``patch("app.api.v1.endpoints.operations.httpx.AsyncClient")`` is the one
string target that does NOT need this helper: ``operations.httpx`` is the
global ``httpx`` module, so that patch reaches every caller wherever its body
lives. ``test_operations_patch_targets_go_through_patch_ops`` enforces the
rest.
"""

from __future__ import annotations

import importlib
import sys
from types import ModuleType, TracebackType
from typing import Any
from unittest import mock

import pytest

OPS_PACKAGE = "app.api.v1.endpoints.operations"
COORD_PROXY = "app.api.coord_proxy"


def is_ops_module(module_name: str) -> bool:
    """True for the operations module/package and anything under it."""
    return module_name == OPS_PACKAGE or module_name.startswith(OPS_PACKAGE + ".")


def ops_modules() -> list[ModuleType]:
    """Every loaded module under the operations package, then ``coord_proxy``.

    Both are imported first, so a test that patches before anything imported
    the app still finds the bindings rather than reporting none.
    """
    importlib.import_module(OPS_PACKAGE)
    importlib.import_module(COORD_PROXY)
    modules = [
        module
        for module_name, module in sorted(sys.modules.items())
        if module is not None and is_ops_module(module_name)
    ]
    modules.append(sys.modules[COORD_PROXY])
    return modules


def resolve_ops_targets(name: str) -> list[tuple[Any, str]]:
    """``[(owner, attribute)]`` for every distinct binding of ``name``.

    Raises :class:`LookupError` when no module binds the head of ``name``, or
    when a module binds the head but the dotted path does not resolve on it.
    """
    parts = name.split(".")
    if not all(parts):
        raise ValueError(f"patch_ops: malformed name {name!r}")
    head, path, attribute = parts[0], parts[:-1], parts[-1]
    targets: list[tuple[Any, str]] = []
    seen: set[int] = set()
    for module in ops_modules():
        if head not in vars(module):
            continue
        owner: Any = module
        for part in path:
            try:
                owner = getattr(owner, part)
            except AttributeError as exc:
                raise LookupError(
                    f"patch_ops: {module.__name__} binds {head!r} but "
                    f"{name!r} does not resolve on it ({exc})"
                ) from exc
        if not hasattr(owner, attribute):
            raise LookupError(
                f"patch_ops: {module.__name__} binds {head!r} but "
                f"{'.'.join(path) or module.__name__} has no {attribute!r}"
            )
        if id(owner) in seen:
            continue
        seen.add(id(owner))
        targets.append((owner, attribute))
    if not targets:
        raise LookupError(
            f"patch_ops: no module under {OPS_PACKAGE} (nor {COORD_PROXY}) "
            f"binds {head!r} — a typo, or a name that moved"
        )
    return targets


class _OpsPatcher:
    """One logical patch applied to every binding :func:`resolve_ops_targets`
    finds. Usable as a context manager or via ``start()`` / ``stop()``."""

    def __init__(self, name: str, new: Any, kwargs: dict[str, Any]) -> None:
        self.name = name
        self.new = new
        self.kwargs = kwargs
        self._patchers: list[Any] = []

    def start(self) -> Any:
        targets = resolve_ops_targets(self.name)
        (first_owner, attribute), rest = targets[0], targets[1:]
        first = mock.patch.object(first_owner, attribute, self.new, **self.kwargs)
        replacement = first.start()
        self._patchers.append(first)
        try:
            for owner, attr in rest:
                patcher = mock.patch.object(owner, attr, replacement)
                patcher.start()
                self._patchers.append(patcher)
        except BaseException:
            self.stop()
            raise
        return replacement

    def stop(self) -> None:
        """Stop every patcher, newest first, even when one of them raises —
        a failure must not leave the remaining bindings patched. The first
        error is re-raised once all have been stopped."""
        first_error: BaseException | None = None
        while self._patchers:
            patcher = self._patchers.pop()
            try:
                patcher.stop()
            except BaseException as exc:  # re-raised once all are stopped
                if first_error is None:
                    first_error = exc
        if first_error is not None:
            raise first_error

    def __enter__(self) -> Any:
        return self.start()

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        tb: TracebackType | None,
    ) -> None:
        self.stop()


def patch_ops(name: str, new: Any = mock.DEFAULT, **kwargs: Any) -> _OpsPatcher:
    """Patch ``name`` in every operations module (and ``coord_proxy``) that
    binds it. See the module docstring."""
    return _OpsPatcher(name, new, kwargs)


def setattr_ops(monkeypatch: pytest.MonkeyPatch, name: str, value: Any) -> None:
    """``monkeypatch.setattr`` on every binding of ``name``; pytest undoes it."""
    for owner, attribute in resolve_ops_targets(name):
        monkeypatch.setattr(owner, attribute, value, raising=True)
