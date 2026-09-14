#!/usr/bin/env python3
"""One-off seed for ``auth.claude_account_profiles``.

Populates the server-side Claude account roster (see
``app/models/claude_account.py``) for one user, from the same account list
``qontinui-claude-config/accounts.json`` already declares, restricted by
default to the accounts confirmed to have valid local credentials on the
test machine (nomad): gmail, hotmail, paktis, qontinui, tiohorst.

Idempotent — upserts by ``(user_id, account_key)``, so re-running just
updates ``shortcut``/``email``/``dir_name`` rather than duplicating rows.

Run it, identifying the user either by login email or by the device_id of
one of their already-paired runners (coord.devices.device_id -> user_id) —
useful when the operator isn't sure which email a given runner is paired
under::

    python -m scripts.seed_claude_accounts --email jspinak@gmail.com
    python -m scripts.seed_claude_accounts --device-id 95a536af-6fa3-496b-97c7-1bce45b3217a
    python -m scripts.seed_claude_accounts --email jspinak@gmail.com --dry-run
"""

from __future__ import annotations

import argparse
import asyncio
import sys
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

import structlog  # noqa: E402
from sqlalchemy import select  # noqa: E402

from app.db.session import AsyncSessionLocal  # noqa: E402
from app.models.claude_account import ClaudeAccountProfile  # noqa: E402
from app.models.device import Device  # noqa: E402
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


async def _resolve_user(
    session, *, email: str | None, device_id: str | None
) -> User | None:
    """Resolve the target user by login email or by a paired device's id.

    Exactly one of ``email``/``device_id`` is expected (enforced by the CLI's
    mutually-exclusive group). A device lookup goes through
    ``coord.devices.user_id`` — the same FK the device-JWT auth path
    (``get_authenticated_device``) resolves at request time.
    """
    if device_id is not None:
        result = await session.execute(
            select(Device).where(Device.device_id == uuid.UUID(device_id))
        )
        device = result.scalar_one_or_none()
        if device is None:
            logger.error("seed_claude_accounts_device_not_found", device_id=device_id)
            return None
        if device.user_id is None:
            logger.error(
                "seed_claude_accounts_device_unpaired",
                device_id=device_id,
                hostname=device.hostname,
            )
            return None
        result = await session.execute(select(User).where(User.id == device.user_id))
        user = result.scalar_one_or_none()
        if user is None:
            logger.error(
                "seed_claude_accounts_device_user_missing",
                device_id=device_id,
                user_id=str(device.user_id),
            )
        return user

    assert email is not None
    result = await session.execute(select(User).where(User.email == email))
    user = result.scalar_one_or_none()
    if user is None:
        logger.error("seed_claude_accounts_user_not_found", email=email)
    return user


async def seed(
    *, email: str | None = None, device_id: str | None = None, dry_run: bool = False
) -> int:
    """Upsert ``DEFAULT_ROSTER`` for the user resolved by ``email`` or
    ``device_id``.

    Returns the number of rows written (0 on dry-run or if the user is
    missing).
    """
    async with AsyncSessionLocal() as session:
        user = await _resolve_user(session, email=email, device_id=device_id)
        if user is None:
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
    target = parser.add_mutually_exclusive_group(required=True)
    target.add_argument("--email", help="Login email of the user to seed")
    target.add_argument(
        "--device-id",
        help="device_id of one of the user's already-paired runners "
        "(coord.devices.device_id) -- resolves the owning user via that pairing",
    )
    parser.add_argument(
        "--dry-run", action="store_true", help="Log what would change, write nothing"
    )
    args = parser.parse_args()

    written = asyncio.run(
        seed(email=args.email, device_id=args.device_id, dry_run=args.dry_run)
    )
    logger.info("seed_claude_accounts_done", written=written, dry_run=args.dry_run)


if __name__ == "__main__":
    main()
