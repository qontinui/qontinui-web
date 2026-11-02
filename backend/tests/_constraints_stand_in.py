"""A stand-in for the co-located runner's constraints API.

The constraints proxy (``app/api/v1/endpoints/constraints.py``) forwards to the
runner on its own host. Its tests point the module's ``RUNNER_HOST`` /
``RUNNER_PORT`` at this: a real HTTP server on loopback that RECORDS every
request it receives (method, request target, JSON body, headers) and answers
each constraints route the way qontinui-runner's
``src-tauri/src/mcp/constraints_api.rs`` does, in its ``ApiResponse`` envelope,
unless a test scripts another answer. What it received is the evidence the
tests assert on: nothing at all for a refused caller.
"""

from __future__ import annotations

import json
import threading
import time
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

import pytest

from app.api.v1.endpoints import constraints


@dataclass(frozen=True)
class Received:
    """One request the stand-in runner received."""

    method: str
    #: The request target as sent: path plus any query string.
    target: str
    #: The JSON body, or ``None`` when the request carried none.
    body: Any
    #: Header names, lower-cased, mapped to their values.
    headers: dict[str, str]


@dataclass(frozen=True)
class Scripted:
    """An answer a test scripts for one route, in place of the default."""

    status: int
    body: str
    content_type: str = "application/json"
    #: Seconds to wait before answering.
    delay: float = 0.0


def envelope(data: Any) -> dict[str, Any]:
    """The runner's ``ApiResponse::success`` envelope."""
    return {"success": True, "data": data}


#: What the runner answers each route with by default, keyed by method and
#: path (no query string). ``/constraints/results/<id>`` is matched by prefix.
ACTIVE = [
    {
        "id": "builtin:no-secrets",
        "name": "No secrets",
        "description": "Refuses committed credentials.",
        "severity": "block",
        "enabled": True,
        "check": {"type": "grep_forbidden", "pattern": "AKIA"},
    }
]
CONFIG = {
    "toml": "[resources]\nmax_wall_time_secs = 600\n",
    "path": "/srv/acme/.qontinui/constraints.toml",
}
WRITTEN = {"valid": True, "errors": [], "path": "/srv/acme/.qontinui/constraints.toml"}
VALIDATED = {"valid": True, "errors": [], "constraints": []}
RESULTS: list[Any] = []

DEFAULTS: dict[tuple[str, str], Any] = {
    ("GET", "/constraints/active"): envelope(ACTIVE),
    ("GET", "/constraints/config"): envelope(CONFIG),
    ("POST", "/constraints/config"): envelope(WRITTEN),
    ("POST", "/constraints/validate"): envelope(VALIDATED),
}
RESULTS_PREFIX = "/constraints/results/"


class StandInRunner:
    """A loopback HTTP server that records every request it receives."""

    def __init__(self) -> None:
        self.received: list[Received] = []
        self.scripted: dict[tuple[str, str], Scripted] = {}
        outer = self

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self) -> None:  # noqa: N802 - the stdlib's name
                self._serve("GET")

            def do_POST(self) -> None:  # noqa: N802 - the stdlib's name
                self._serve("POST")

            def _serve(self, method: str) -> None:
                length = int(self.headers.get("Content-Length") or 0)
                raw = self.rfile.read(length) if length else b""
                outer.received.append(
                    Received(
                        method=method,
                        target=self.path,
                        body=json.loads(raw) if raw else None,
                        headers={k.lower(): v for k, v in self.headers.items()},
                    )
                )
                route = self.path.split("?", 1)[0]
                scripted = outer.scripted.get((method, route))
                if scripted is not None:
                    time.sleep(scripted.delay)
                    self._answer(
                        scripted.status, scripted.body.encode(), scripted.content_type
                    )
                elif (method, route) in DEFAULTS:
                    self._json(200, DEFAULTS[(method, route)])
                elif method == "GET" and route.startswith(RESULTS_PREFIX):
                    self._json(200, envelope(RESULTS))
                else:
                    self._json(404, {"error": "not found"})

            def _json(self, status: int, body: Any) -> None:
                self._answer(status, json.dumps(body).encode(), "application/json")

            def _answer(self, status: int, raw: bytes, content_type: str) -> None:
                self.send_response(status)
                self.send_header("Content-Type", content_type)
                self.send_header("Content-Length", str(len(raw)))
                self.end_headers()
                self.wfile.write(raw)

            def log_message(self, *args: object) -> None:
                pass

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.port = self.server.server_address[1]
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def script(self, method: str, route: str, answer: Scripted) -> None:
        """Answer ``method`` ``route`` with ``answer`` from now on."""
        self.scripted[(method, route)] = answer

    def close(self) -> None:
        self.server.shutdown()
        self.server.server_close()


@contextmanager
def serving_stand_in(monkeypatch: pytest.MonkeyPatch) -> Iterator[StandInRunner]:
    """A :class:`StandInRunner`, with the constraints proxy pointed at it."""
    runner = StandInRunner()
    monkeypatch.setattr(constraints, "RUNNER_HOST", "127.0.0.1")
    monkeypatch.setattr(constraints, "RUNNER_PORT", runner.port)
    try:
        yield runner
    finally:
        runner.close()
