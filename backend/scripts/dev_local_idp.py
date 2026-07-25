"""Standardized dev-local-auth IdP for the local web UI-Bridge verification on-ramp.

This is the DEV analogue of the Spec-CI local IdP. It is a thin wrapper around
``scripts/spec_ci_local_idp.mint_token`` (no crypto/claims logic is
reimplemented) that:

1. mints a dev id token + JWKS with FIXED dev parameters (issuer
   ``http://127.0.0.1:8770``, audience ``qontinui-web-local``, dev email
   ``dev-local@no-reply.qontinui.io``), writing the token to ``--token-out``
   (OUTSIDE the served directory — see the security note below),
2. serves ONLY ``/.well-known/jwks.json`` over HTTP bound to ``0.0.0.0`` so a
   container'd backend can reach it via ``host.docker.internal`` (Spec CI binds
   127.0.0.1; the dev flow must reach across the container boundary), and
3. stays alive (``serve_forever``) for the life of the dev session so the
   backend's Cognito verifier can fetch the JWKS whenever it validates the token.

**Security note.** The bind is ``0.0.0.0`` (LAN-reachable), so the server MUST
expose only the public JWKS — never the minted token. A ``SimpleHTTPRequestHandler``
serving the whole directory (with dir-listing) would leak the token to anyone on
the subnet. Hence the custom handler below serves the single JWKS path and 404s
everything else, and the token is written outside the served tree.

The backend accepts the resulting token through its REAL Cognito verifier
(``app/services/cognito_jwks.py``) with ZERO code change — it is issuer-driven —
provided it is booted with the env vars this script prints on startup AND the
``QONTINUI_DEV_LOCAL_AUTH=1`` master flag (which the prod guardrail in
``app/core/config.py`` forbids under a production posture).

Run:

    poetry run python scripts/dev_local_idp.py

Then boot the backend with (see the startup banner this script prints):

    QONTINUI_DEV_LOCAL_AUTH=1
    ENVIRONMENT=development
    COGNITO_ISSUER=http://127.0.0.1:8770      # or http://host.docker.internal:8770 from a container
    COGNITO_ALLOWED_AUDIENCES=qontinui-web-local
    DATABASE_URL=postgresql://<user>:<pass>@localhost:5433/qontinui_local_auth  # isolated DB (guardrail-enforced)
"""

from __future__ import annotations

import argparse
import sys
import tempfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

# Reuse the Spec-CI minting core — single source of truth for keypair/JWKS/claims.
from spec_ci_local_idp import mint_token

# ---- Fixed dev-local-auth parameters (referenced by docs + the dev-start phase) ----
DEV_ISSUER = "http://127.0.0.1:8770"
DEV_AUDIENCE = "qontinui-web-local"
DEV_EMAIL = "dev-local@no-reply.qontinui.io"
DEV_BIND_HOST = "0.0.0.0"  # noqa: S104 - intentional: container reaches host IdP
DEV_PORT = 8770

_JWKS_PATH = "/.well-known/jwks.json"


class _JwksOnlyHandler(BaseHTTPRequestHandler):
    """Serves ONLY the public JWKS. Everything else (esp. the token) is 404.

    Subclassed per-run with ``jwks_bytes`` bound so the bind-``0.0.0.0`` server
    can never leak the minted token to the LAN.
    """

    jwks_bytes: bytes = b""

    def do_GET(self) -> None:  # noqa: N802 - stdlib handler contract
        if self.path.split("?", 1)[0] == _JWKS_PATH:
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(self.jwks_bytes)))
            self.end_headers()
            self.wfile.write(self.jwks_bytes)
        else:
            self.send_error(404, "Not Found")

    def log_message(self, format: str, *args: Any) -> None:  # noqa: A002
        # Route the access log to stderr (stdout stays clean). The inner
        # ``format % args`` is the stdlib BaseHTTPRequestHandler contract.
        sys.stderr.write(f"[dev-local-idp] {self.address_string()} - {format % args}\n")


def _print_banner(*, issuer: str, audience: str, token_path: Path, bind_port: int) -> None:
    issuer_port = urlparse(issuer).port or bind_port
    lines = [
        "[dev-local-idp] hermetic dev IdP is up.",
        f"[dev-local-idp]   JWKS   : {issuer}{_JWKS_PATH} "
        f"(bound {DEV_BIND_HOST}:{bind_port})",
        f"[dev-local-idp]   token  : {token_path}  (NOT served over HTTP)",
        "[dev-local-idp] Boot the web backend with:",
        "[dev-local-idp]   QONTINUI_DEV_LOCAL_AUTH=1",
        "[dev-local-idp]   ENVIRONMENT=development",
        f"[dev-local-idp]   COGNITO_ISSUER={issuer}",
        "[dev-local-idp]   #   (container: COGNITO_ISSUER="
        f"http://host.docker.internal:{issuer_port})",
        f"[dev-local-idp]   COGNITO_ALLOWED_AUDIENCES={audience}",
        "[dev-local-idp]   DATABASE_URL=...@localhost:5433/qontinui_local_auth",
        "[dev-local-idp] Ctrl-C to stop.",
    ]
    if issuer_port != bind_port:
        lines.insert(
            1,
            f"[dev-local-idp]   WARNING: issuer port {issuer_port} != bind port "
            f"{bind_port} — the backend's JWKS fetch will target {issuer_port}.",
        )
    print("\n".join(lines), file=sys.stderr, flush=True)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--issuer", default=DEV_ISSUER)
    parser.add_argument("--audience", default=DEV_AUDIENCE)
    parser.add_argument("--email", default=DEV_EMAIL)
    parser.add_argument(
        "--name",
        default="",
        help="Display-name claim; empty (default) omits it (no full_name).",
    )
    parser.add_argument(
        "--out-dir",
        default=None,
        help="Directory to write .well-known/jwks.json under. "
        "Defaults to a fresh temp dir. Not exposed over HTTP (only the "
        "JWKS content is served).",
    )
    parser.add_argument(
        "--token-out",
        default=None,
        help="File to write the minted token to (OUTSIDE the served dir). "
        "Defaults to a sibling of --out-dir.",
    )
    parser.add_argument(
        "--port",
        type=int,
        default=None,
        help="Bind port for the JWKS server. Defaults to the issuer URL's "
        "port (or 8770) so the served port and the token's issuer agree.",
    )
    parser.add_argument(
        "--bind",
        default=DEV_BIND_HOST,
        help="Bind host for the JWKS HTTP server. Default 0.0.0.0 so "
        "containers can reach it via host.docker.internal.",
    )
    parser.add_argument("--ttl-seconds", type=int, default=7200)
    args = parser.parse_args()

    bind_port = args.port if args.port is not None else (urlparse(args.issuer).port or DEV_PORT)

    out_dir = (
        Path(args.out_dir)
        if args.out_dir
        else Path(tempfile.mkdtemp(prefix="dev-local-idp-"))
    )
    out_dir.mkdir(parents=True, exist_ok=True)

    token = mint_token(
        issuer=args.issuer,
        audience=args.audience,
        out_dir=str(out_dir),
        email=args.email,
        name=args.name,
        ttl_seconds=args.ttl_seconds,
    )

    # Token lives OUTSIDE the served directory — the bind is 0.0.0.0.
    token_path = (
        Path(args.token_out)
        if args.token_out
        else out_dir.parent / f"{out_dir.name}-token.txt"
    )
    token_path.write_text(token, encoding="utf-8")

    jwks_bytes = (out_dir / ".well-known" / "jwks.json").read_bytes()
    handler_cls = type(
        "_BoundJwksHandler", (_JwksOnlyHandler,), {"jwks_bytes": jwks_bytes}
    )

    _print_banner(
        issuer=args.issuer,
        audience=args.audience,
        token_path=token_path,
        bind_port=bind_port,
    )

    with ThreadingHTTPServer((args.bind, bind_port), handler_cls) as httpd:
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("[dev-local-idp] shutting down", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
