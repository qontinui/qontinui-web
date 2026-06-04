#!/usr/bin/env python3
"""Export the web backend's OpenAPI schema to the committed snapshot.

Writes ``frontend/src/lib/api-client/openapi-schema.json`` from the live
FastAPI app (``app.main:app``). This file is the **authoritative declared
external surface** of the web backend: the frontend's
``generate-api-types.ts`` consumes it to regenerate ``generated-types.ts``,
and coord's external-surface (route-serving) observer reads it as the
declared-route source of truth. Keeping it in lockstep with the actual route
table is the whole point — a stale snapshot silently mis-declares the surface.

Why this works with no running server and ``openapi_url=None`` in prod:
``app.openapi()`` is the FastAPI *method* that computes the schema from the
registered routes. ``openapi_url`` only governs whether an HTTP route *serves*
that schema; it has no bearing on the method. Importing ``app.main`` builds the
``FastAPI`` instance and registers all routers at import time, and does NOT open
a DB/Redis connection (those are deferred to the lifespan/startup handlers), so
this runs fully offline.

Determinism: the schema is dumped with ``sort_keys=True`` and ``indent=2`` plus
a trailing newline, so re-running on an unchanged app is a no-op and the CI
drift check (`git diff --exit-code`) is stable.

Two snapshots, one exporter:

* default — ``openapi-schema.json``: the app as built in THIS environment.
  CI installs the qontinui-cloud-control sibling, so CI's run includes the
  extension routes (admin/billing); this is the spec the frontend api-client
  generates types from.
* ``--base`` — ``openapi-schema.base.json``: the app with the cloud-control
  side-effect import suppressed (``QONTINUI_DISABLE_CLOUD_EXTENSIONS=1``,
  honored in ``app/main.py``) even where the package is installed. This is the
  surface **prod api.qontinui.io actually serves** (the prod image does not
  install cloud-control), so it is the declared-route source coord's
  Ξ_RouteServing observer reads for that host — using the extended spec there
  false-positives ``route_missing`` on every extension route.

The two variants need separate *processes* (the app is built at import time;
one process cannot re-import it with different env), so CI runs the script
twice.

Usage::

    python backend/scripts/export_openapi.py          # extended (env-dependent)
    python backend/scripts/export_openapi.py --base   # base (OSS-only, anywhere)

The script self-configures the minimal env it needs (a dummy PostgreSQL
``DATABASE_URL``, ``ENVIRONMENT=development``, a >=32-char ``SECRET_KEY``,
``TESTING=1``) when those are not already provided, matching the env the
backend-ci test job sets, so it imports cleanly in any environment.
"""

from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path

# Repo layout: this file is <repo>/backend/scripts/export_openapi.py
SCRIPT_DIR = Path(__file__).resolve().parent
BACKEND_DIR = SCRIPT_DIR.parent
REPO_ROOT = BACKEND_DIR.parent
OUTPUT_PATH = REPO_ROOT / "frontend" / "src" / "lib" / "api-client" / "openapi-schema.json"
# The BASE (OSS-only) variant — what prod api.qontinui.io serves (no
# cloud-control). Declared-route source for coord's Ξ_RouteServing observer.
BASE_OUTPUT_PATH = (
    REPO_ROOT / "frontend" / "src" / "lib" / "api-client" / "openapi-schema.base.json"
)


def _ensure_offline_env() -> None:
    """Provide the minimal settings the app import requires, if unset.

    These mirror the env the ``backend-ci.yml`` test job exports. They are
    only *defaults* — any value already present in the environment wins, so a
    real DATABASE_URL/SECRET_KEY passed by CI is respected. None of these cause
    a network/DB connection at import time; computing the schema never queries.
    """
    defaults = {
        # Must be a postgresql DSN to satisfy Settings.validate_database_url;
        # never actually connected to (schema computation doesn't query).
        "DATABASE_URL": "postgresql://user:pass@localhost:5432/db",
        "ENVIRONMENT": "development",
        # Settings.SECRET_KEY requires >= 32 chars.
        "SECRET_KEY": "openapi-export-dummy-secret-key-minimum-32-characters-long",
        "TESTING": "1",
        # Keep Redis fully off so nothing tries to dial it.
        "REDIS_ENABLED": "false",
    }
    for key, value in defaults.items():
        os.environ.setdefault(key, value)


_HTTP_METHODS = frozenset(
    {"get", "put", "post", "delete", "options", "head", "patch", "trace"}
)


def _canonicalize_operation_ids(schema: dict) -> None:
    """Rewrite every ``operationId`` deterministically as ``<path>_<method>``.

    FastAPI derives ``operationId`` from the endpoint *function* name, which
    COLLIDES when one function backs several routes (e.g. the ``runner_proxy``
    catch-all, or routers re-included by slowapi/cloud-control). The
    collision-resolution order is **not stable across runs** — hence the
    ``Duplicate Operation ID`` warnings and an ``app.openapi()`` whose
    operationId values jitter run-to-run, which makes the raw schema NOT
    byte-reproducible (the CI drift check would flap forever).

    Deriving the id purely from ``(path, method)`` is unique by construction
    and stable, so the committed snapshot is reproducible AND the
    duplicate-operation-id ambiguity is removed for downstream codegen. This is
    a pure function of the path+method already present in the document, so it
    can be applied identically to a freshly generated schema or to the
    committed file.
    """
    for path, item in schema.get("paths", {}).items():
        if not isinstance(item, dict):
            continue
        for method, operation in item.items():
            if method.lower() in _HTTP_METHODS and isinstance(operation, dict):
                slug = re.sub(
                    r"[^a-z0-9]+", "_", f"{path}_{method}".lower()
                ).strip("_")
                operation["operationId"] = slug


def main() -> int:
    base = "--base" in sys.argv[1:]
    unknown = [a for a in sys.argv[1:] if a != "--base"]
    if unknown:
        print(f"unknown argument(s): {unknown} (only --base is supported)", file=sys.stderr)
        return 2

    if base:
        # MUST be set before ``app.main`` is imported — the suppression is
        # consulted at the cloud-control side-effect import site. Hard-set
        # (not setdefault): the whole point is overriding an environment
        # where the package is installed (CI).
        os.environ["QONTINUI_DISABLE_CLOUD_EXTENSIONS"] = "1"

    _ensure_offline_env()

    # Import only after env is in place so module-level Settings() succeeds.
    # backend/ must be importable as the package root for ``app.*``.
    sys.path.insert(0, str(BACKEND_DIR))

    from app.main import app  # noqa: E402 -- deferred until env is configured

    schema = app.openapi()
    _canonicalize_operation_ids(schema)

    output_path = BASE_OUTPUT_PATH if base else OUTPUT_PATH
    output_path.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(schema, indent=2, sort_keys=True) + "\n"
    # Always emit LF (never platform CRLF): the committed snapshot is
    # ``*.json text eol=lf`` (.gitattributes) and the CI drift check
    # (``git diff --exit-code``) must be byte-stable across OSes. ``newline=""``
    # disables newline translation so the literal ``\n`` in ``payload`` is
    # written verbatim, matching what Linux CI and the git blob expect.
    with open(output_path, "w", encoding="utf-8", newline="") as fh:
        fh.write(payload)

    variant = "BASE (OSS-only)" if base else "extended"
    path_count = len(schema.get("paths", {}))
    print(f"Wrote {variant} OpenAPI schema ({path_count} paths) to {output_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
