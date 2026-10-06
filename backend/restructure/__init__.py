"""Deterministic, replayable source transforms (``Coord-Restructure:`` executables).

Each module here is a stdlib-only program that only moves or reshapes code and
never changes behaviour. It is idempotent: re-running it on a tree it already
transformed is a no-op. See plan
``2026-10-01-coord-hub-files-serialize-the-merge-train`` (D6, Phase 3) for the
replay contract.
"""
