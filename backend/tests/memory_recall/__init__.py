"""Offline retrieval-efficacy harness for the tenant agentic-memory store.

Phase 1 of ``2026-07-29-memory-recall-efficacy-benchmark``. Everything in
this package is TEST tooling — it is imported by
``tests/test_memory_recall_scorer.py`` (pure logic, runs everywhere) and
``tests/test_memory_recall_eval_db.py`` (seeded Postgres, skips without
pgvector). No application code imports it.

The split is deliberate: :mod:`scorer` is arithmetic over id lists with no
I/O at all, so its correctness is asserted against hand-computed values
rather than against the retrieval system it is meant to judge. A harness
whose scorer is only validated by the thing it scores can report anything.
"""
