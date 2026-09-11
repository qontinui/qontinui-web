#!/usr/bin/env python3
"""One-off seed for ``auth.claude_account_profiles``.

Populates the server-side Claude account roster (see
``app/models/claude_account.py``) for one user, from the same account list
``qontinui-claude-config/accounts.json`` already declares, restricted by
default to the accounts confirmed to have valid local credentials on the
test machine (nomad): gmail, hotmail, paktis, qontinui, tiohorst.

Idempotent — upserts by ``(user_id, account_key)``, so re-running just
updates ``shortcut``/``email``/``dir_name`` rather than duplicating rows.

Run it::

    python -m scripts.seed_claude_accounts --email jspinak@gmail.com
    python -m scripts.seed_claude_accounts --email jspinak@gmail.com --dry-run
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

import structlog  # noqa: E402
from sqlalchemy import select  # noqa: E402

from app.db.session import AsyncSessionLocal  # noqa: E402
from app.models.claude_account import ClaudeAccountProfile  # noqa: E402
from app.models.user import User  # noqa: E402

logger = structlog.get_logger(__name__)

# Mirrors qontinui-claude-config/accounts.json's `accounts` list, restricted
# to the entries with a confirmed valid `.credentials.json` on nomad.
DEFAULT_ROSTER: list[dict[str, str | None]] = [
    {"account_key": "gmail", "shortcut": "clg", "email": None, "dir_name": None},
    {"account_key": "hotmail", "shortcut": "clh", "email": None, "dir_name": None},
    {"account_key": "paktis", "shortcut": "clp", "email": None, "dir_name": None},
    {"account_key": "qontinui", "shortcut": "clq", "email": None, "dir_name": None},
    {"account_key": "tiohorst", "shortcut": "clt", "email": None, "dir_name": None},
]


async def seed(*, email: str, dry_run: bool = False) -> int:
    """Upsert ``DEFAULT_ROSTER`` for the user with the given login email.

    Returns the number of rows written (0 on dry-run or if the user is
    missing).
    """
    async with AsyncSessionLocal() as session:
        result = await session.execute(select(User).where(User.email == email))
        user = result.scalar_one_or_none()
        if user is None:
            logger.error("seed_claude_accounts_user_not_found", email=email)
            return 0

        existing = (
            (
                await session.execute(
                    select(ClaudeAccountProfile).where(
                        ClaudeAccountProfile.user_id == user.id
                    )
                )
            )
            .scalars()
            .all()
        )
        by_key = {p.account_key: p for p in existing}

        written = 0
        for entry in DEFAULT_ROSTER:
            key = entry["account_key"]
            assert key is not None
            row = by_key.get(key)
            if row is None:
                logger.info(
                    "seed_claude_accounts_create", user_id=user.id, account_key=key
                )
                if not dry_run:
                    session.add(
                        ClaudeAccountProfile(
                            user_id=user.id,
                            account_key=key,
                            shortcut=entry["shortcut"],
                            email=entry["email"],
                            dir_name=entry["dir_name"],
                        )
                    )
                written += 1
            else:
                logger.info(
                    "seed_claude_accounts_update", user_id=user.id, account_key=key
                )
                if not dry_run:
                    row.shortcut = entry["shortcut"]
                    row.email = entry["email"]
                    row.dir_name = entry["dir_name"]
                written += 1

        if not dry_run:
            await session.commit()
        return written


def main() -> None:
    """CLI entrypoint."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--email", required=True, help="Login email of the user to seed"
    )
    parser.add_argument(
        "--dry-run", action="store_true", help="Log what would change, write nothing"
    )
    args = parser.parse_args()

    written = asyncio.run(seed(email=args.email, dry_run=args.dry_run))
    logger.info("seed_claude_accounts_done", written=written, dry_run=args.dry_run)


if __name__ == "__main__":
    main()
