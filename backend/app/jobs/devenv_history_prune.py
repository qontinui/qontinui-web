"""Scheduled job — retention-prune the devenv config-history timeline.

Runs on the scheduler's ``devenv_config_history_prune`` cadence (daily) to
cap ``devenv.machine_environment_config_history`` at the newest
``KEEP_PER_PAIR`` rows per (environment, machine) pair. The agent write path
already dedups consecutive identical captures, so 500 retained rows are 500
actual change points — months of real drift for a typical machine.

Logging is one structured line PER pruned pair plus a total — a capped
timeline is never silent.
"""

import structlog

from app.db.session import AsyncSessionLocal
from app.repositories.devenv import config_history_repo

logger = structlog.get_logger(__name__)

# Newest rows retained per (environment, machine) pair.
KEEP_PER_PAIR = 500


async def prune_config_history() -> dict[str, int]:
    """
    Delete config-history rows beyond the newest ``KEEP_PER_PAIR`` per pair.

    Returns:
        Dictionary with prune statistics:
        - pairs: Number of (environment, machine) pairs pruned
        - deleted: Total rows removed
    """
    stats = {"pairs": 0, "deleted": 0}

    try:
        async with AsyncSessionLocal() as db:
            pruned = await config_history_repo.prune(db, keep_per_pair=KEEP_PER_PAIR)
            await db.commit()

            for environment_id, machine_id, deleted in pruned:
                logger.info(
                    "devenv_config_history_pruned_pair",
                    environment_id=str(environment_id),
                    machine_id=str(machine_id),
                    deleted=deleted,
                    keep_per_pair=KEEP_PER_PAIR,
                )
            stats["pairs"] = len(pruned)
            stats["deleted"] = sum(deleted for _, _, deleted in pruned)

            if stats["deleted"] > 0:
                logger.info(
                    "devenv_config_history_prune_completed",
                    pairs=stats["pairs"],
                    deleted=stats["deleted"],
                )
            else:
                logger.debug("devenv_config_history_prune_nothing_to_do")

    except Exception as e:
        logger.error(
            "devenv_config_history_prune_error",
            error=str(e),
            error_type=type(e).__name__,
            exc_info=True,
        )
        # Re-raise: the scheduler records `last_status="failed"` on /health —
        # swallowing would make every failed run report "ok" (the silent-no-op
        # blindness the scheduler exists to end).
        raise

    return stats
