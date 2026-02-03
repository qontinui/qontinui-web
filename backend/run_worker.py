#!/usr/bin/env python
"""Run the ARQ worker."""

import logging

from arq import run_worker

from app.worker.settings import WorkerSettings

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def main():
    """Run the ARQ worker."""
    logger.info("Starting ARQ worker...")
    run_worker(WorkerSettings)  # type: ignore[arg-type]


if __name__ == "__main__":
    main()
