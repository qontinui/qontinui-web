"""Scheduled job cores.

Pure async cores invoked by the in-process asyncio scheduler
(:mod:`app.core.scheduler`). Each core opens its own DB session (or accepts
one for direct testing) and manages its own commit discipline. No Celery, no
event-loop bootstrapping — the scheduler already runs these on the app loop.
"""
