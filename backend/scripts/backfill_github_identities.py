#!/usr/bin/env python3
"""Backfill ``auth.users.github_user_id`` / ``github_login`` from Cognito.

Identity-contract I1, **permanent** post-deploy backfill job.

Why this exists
===============
The ``github_id_01`` migration ships an inline data backfill, but that
backfill is *fail-open in the migrator container* — which ships only
alembic + sqlalchemy, NOT the app (no ``app.services``, no Cognito-admin
task role). So the migrator path imports ``app.services.cognito_admin``,
fails the import, and returns early. And the "it runs when the full app
applies migrations" assumption is FALSE: the app never re-runs an
already-applied migration. Net effect observed on prod 2026-06-10:
``github_user_id`` stayed NULL for every user for two days despite live
Cognito GitHub links, and the identity resolver had zero data.

This script is the durable fix. It runs from the **web image** (which has
``app.services.cognito_admin`` + the Cognito-admin task role the migrator
lacks) as a one-off Fargate task after each deploy (see
``.github/workflows/deploy-web.yml`` → "Backfill GitHub identities").

What it does
============
For every ``auth.users`` row with ``cognito_sub IS NOT NULL`` and
``github_user_id IS NULL``:

1. ``cognito_admin.resolve_username_for_sub(cognito_sub)`` → pool Username.
2. ``cognito_admin.list_user_identities(username)`` → find the linked
   ``GitHub`` federated identity → its ``user_id`` (the GitHub OIDC ``sub``
   = GitHub's numeric user id; the canonical key the resolver joins on).
3. Best-effort ``github_login`` display alias via the public GitHub API
   (``GET https://api.github.com/user/{id}``; unauthenticated, fail-open —
   the login is never a join key).
4. ``UPDATE auth.users SET github_user_id=..., github_login=...`` guarded
   by ``github_user_id IS NULL`` so the write is idempotent.

Safety posture
==============
* **Idempotent** — only NULL ``github_user_id`` rows are candidates, and
  the UPDATE re-checks NULL. Running it twice is a no-op the second time.
* **Fail-open per row** — one bad Cognito lookup (or a missing GitHub
  link) skips that user and continues. Mirrors the migration's posture so
  a single user can never wedge the job.
* **Fail-open overall (default)** — a total Cognito outage logs loudly and
  exits 0 so a transient blip never reds a deploy. Pass ``--strict`` to
  exit non-zero when there were unresolved candidates (e.g. for a manual
  remediation run where you WANT a red signal).

Run it::

    python -m scripts.backfill_github_identities            # fail-open
    python -m scripts.backfill_github_identities --strict    # red on misses
    python -m scripts.backfill_github_identities --dry-run    # no writes
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path

# Allow ``python scripts/backfill_github_identities.py`` (not just ``-m``).
sys.path.insert(0, str(Path(__file__).parent.parent))

import httpx  # noqa: E402
import structlog  # noqa: E402
from sqlalchemy import text  # noqa: E402

from app.db.session import AsyncSessionLocal  # noqa: E402
from app.services import cognito_admin  # noqa: E402

logger = structlog.get_logger(__name__)

# The GitHub federated provider name as it appears in Cognito's identities
# claim. Matches the link-hook guard in ``identities.py`` and the migration.
_GITHUB_PROVIDER = "GitHub"


def _github_login_via_api(github_user_id: str) -> str | None:
    """Best-effort GitHub login from the public API, by numeric id.

    Unauthenticated ``GET https://api.github.com/user/{id}`` (low anonymous
    rate limit). Fully fail-open: any error returns ``None`` — the login is
    a mutable display alias, never a join key, so a miss is harmless. Mirrors
    ``identities.py::_github_login_via_api``.
    """
    try:
        resp = httpx.get(
            f"https://api.github.com/user/{github_user_id}",
            timeout=httpx.Timeout(5.0),
            headers={"Accept": "application/vnd.github+json"},
        )
        if resp.status_code != 200:
            return None
        login = resp.json().get("login")
        return login if isinstance(login, str) and login.strip() else None
    except Exception as exc:  # noqa: BLE001 - best-effort, never block
        logger.warning(
            "github_backfill_login_api_failed",
            github_user_id=github_user_id,
            error=str(exc),
        )
        return None


def _github_id_from_identities(identities: list[dict]) -> str | None:
    """Pluck the GitHub federated ``user_id`` from a list_user_identities result."""
    return next(
        (
            i.get("user_id")
            for i in identities
            if isinstance(i, dict)
            and (i.get("provider") or "").lower() == _GITHUB_PROVIDER.lower()
            and i.get("user_id")
        ),
        None,
    )


async def backfill(*, dry_run: bool = False) -> tuple[int, int, int]:
    """Backfill all eligible rows. Returns ``(updated, skipped, candidates)``.

    ``skipped`` counts candidates that could not be resolved (no pool user,
    no linked GitHub identity, or a per-row Cognito error).
    """
    async with AsyncSessionLocal() as session:
        rows = (
            await session.execute(
                text(
                    "SELECT id, cognito_sub FROM auth.users "
                    "WHERE cognito_sub IS NOT NULL AND github_user_id IS NULL"
                )
            )
        ).fetchall()

        candidates = len(rows)
        if candidates == 0:
            logger.info("github_backfill_noop", candidates=0)
            return (0, 0, 0)

        updated = 0
        skipped = 0
        for user_id, cognito_sub in rows:
            try:
                username = cognito_admin.resolve_username_for_sub(cognito_sub)
                if not username:
                    skipped += 1
                    continue
                identities = cognito_admin.list_user_identities(username)
            except Exception as exc:  # noqa: BLE001 - fail-open per row
                logger.warning(
                    "github_backfill_lookup_failed",
                    user_id=str(user_id),
                    error=str(exc),
                )
                skipped += 1
                continue

            github_id = _github_id_from_identities(identities)
            if not github_id:
                # User simply has no linked GitHub identity — not an error.
                skipped += 1
                continue

            github_login = await asyncio.to_thread(
                _github_login_via_api, str(github_id)
            )

            if dry_run:
                logger.info(
                    "github_backfill_would_update",
                    user_id=str(user_id),
                    github_user_id=str(github_id),
                    github_login=github_login,
                )
                updated += 1
                continue

            await session.execute(
                text(
                    "UPDATE auth.users "
                    "SET github_user_id = :gid, github_login = :login "
                    "WHERE id = :uid AND github_user_id IS NULL"
                ),
                {"gid": str(github_id), "login": github_login, "uid": str(user_id)},
            )
            updated += 1

        if not dry_run:
            await session.commit()

        logger.info(
            "github_backfill_done",
            updated=updated,
            skipped=skipped,
            candidates=candidates,
            dry_run=dry_run,
        )
        return (updated, skipped, candidates)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Resolve + log intended updates but write nothing.",
    )
    parser.add_argument(
        "--strict",
        action="store_true",
        help="Exit non-zero if any candidate could not be resolved.",
    )
    args = parser.parse_args()

    updated, skipped, candidates = asyncio.run(backfill(dry_run=args.dry_run))

    # A human-greppable one-line summary for CloudWatch / workflow logs.
    print(
        f"github-backfill: candidates={candidates} updated={updated} "
        f"skipped={skipped} dry_run={args.dry_run} strict={args.strict}"
    )

    if args.strict and skipped > 0:
        print(
            f"github-backfill: STRICT failure — {skipped} candidate(s) unresolved",
            file=sys.stderr,
        )
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
