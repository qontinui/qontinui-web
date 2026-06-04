"""Mint a local RS256 id token + JWKS for hermetic Spec CI auth.

Spec CI (.github/workflows/spec-ci.yml) runs against a backend booted
inside the CI job — no prod API, no real Cognito. The backend's Cognito
verifier (app/services/cognito_jwks.py) is configuration-driven: it
trusts whatever ``COGNITO_ISSUER`` is set to and fetches that issuer's
JWKS from ``<issuer>/.well-known/jwks.json``. This script is the local
"issuer": it

1. generates an ephemeral RSA-2048 keypair (lives only for this run),
2. writes ``<out-dir>/.well-known/jwks.json`` with the public JWK
   (served by a throwaway ``python -m http.server`` in the workflow),
3. mints a ci-bot **id token** signed with the private key, carrying the
   claims the backend's provision-on-first-login path requires
   (``sub``, ``email``, ``email_verified``, ``name`` — see
   app/services/cognito_provision.py), and prints it to **stdout**
   (stdout carries ONLY the token so ``$( ... )`` capture is clean).

The backend then verifies the token exactly as it would a real Cognito
token — RS256 signature via JWKS, ``iss``, ``aud``, ``exp`` — and
JIT-provisions the ci-bot ``auth.users`` row. No backend code path is
stubbed; only the issuer is local. Real-Cognito integration remains
covered post-deploy by verify-frontend-deploy.yml's authed smoke.

The key is NOT a secret worth protecting: it is generated per-run,
trusted only by the run-local backend, and dies with the runner VM.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
import uuid
from pathlib import Path

import jwt as pyjwt
from cryptography.hazmat.primitives.asymmetric import rsa
from jwt.algorithms import RSAAlgorithm

KID = "spec-ci-local"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--issuer",
        required=True,
        help="Issuer URL the backend is configured with (COGNITO_ISSUER), "
        "e.g. http://127.0.0.1:8770",
    )
    parser.add_argument(
        "--audience",
        required=True,
        help="App-client id the backend trusts (COGNITO_ALLOWED_AUDIENCES)",
    )
    parser.add_argument(
        "--email",
        # MX-less controlled domain, NOT the special-use `.local` TLD —
        # pydantic's EmailStr rejects `.local`, which 500s every /users/me
        # read of the provisioned row (see cognito_provision.py's identical
        # choice for synthesized addresses).
        default="spec-ci-bot@no-reply.qontinui.io",
        help="ci-bot email; the backend JIT-provisions auth.users from it",
    )
    parser.add_argument(
        "--name",
        # Default EMPTY (claim omitted) — prod ci-bot has no name, and the
        # settings spec's positional element ids (content-label-tenant-
        # label-4/-6) were authored against the page WITHOUT the conditional
        # Name row (settings/account/page.tsx renders it only when full_name
        # is set; a name shifts every later content index by 2).
        default="",
        help="Display name claim; empty (default) omits the claim so the "
        "provisioned user has no full_name — prod ci-bot parity",
    )
    parser.add_argument(
        "--out-dir",
        required=True,
        help="Directory to write .well-known/jwks.json under (the dir "
        "python -m http.server serves as the issuer)",
    )
    parser.add_argument(
        "--ttl-seconds",
        type=int,
        default=7200,
        help="Token lifetime; default 2h comfortably outlives the job's "
        "25-minute timeout",
    )
    args = parser.parse_args()

    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)

    # Public JWK (kty/n/e from PyJWT's serializer) + the lookup/metadata
    # fields the backend's verifier selects on (kid) and pins (alg).
    jwk = json.loads(RSAAlgorithm.to_jwk(private_key.public_key()))
    jwk.update({"kid": KID, "alg": "RS256", "use": "sig"})

    well_known = Path(args.out_dir) / ".well-known"
    well_known.mkdir(parents=True, exist_ok=True)
    jwks_path = well_known / "jwks.json"
    jwks_path.write_text(json.dumps({"keys": [jwk]}), encoding="utf-8")
    print(f"[spec-ci-local-idp] wrote {jwks_path}", file=sys.stderr)

    now = int(time.time())
    claims = {
        # Stable sub for a given email so re-runs resolve to the same
        # provisioned user (uuid5 = deterministic).
        "sub": str(uuid.uuid5(uuid.NAMESPACE_URL, f"spec-ci:{args.email}")),
        "email": args.email,
        # email_verified=True is required for the provision path's
        # link-by-email arm to be willing to match an existing row.
        "email_verified": True,
        "token_use": "id",
        "iss": args.issuer.rstrip("/"),
        "aud": args.audience,
        "iat": now,
        "exp": now + args.ttl_seconds,
    }
    if args.name:
        claims["name"] = args.name
    token = pyjwt.encode(claims, private_key, algorithm="RS256", headers={"kid": KID})
    print(
        f"[spec-ci-local-idp] minted id token for {args.email} "
        f"(exp +{args.ttl_seconds}s)",
        file=sys.stderr,
    )
    print(token)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
