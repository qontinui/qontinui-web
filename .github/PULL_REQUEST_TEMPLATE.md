<!--
Thanks for the PR. Fill in the sections that apply; remove the rest.
-->

## Summary

<!-- 1-3 bullets on what this PR does and why. -->

## Test plan

<!-- Bulleted checklist of what was tested manually + what tests cover. -->

---

## Schema-change checklist

Skip this section if the PR doesn't touch the database schema.

- [ ] Migration **hand-authored** under `backend/alembic/versions/` with a
      clear revision ID and `down_revision` chain, and `alembic heads`
      prints exactly one head (the required `alembic-heads-pr` check will
      red this PR on a forked chain).
- [ ] Every `op.create_table` / `op.add_column` / `op.alter_column` /
      `op.drop_column` / `op.drop_table` / `op.create_index` /
      `op.drop_index` / `op.create_foreign_key` / `op.drop_constraint`
      / `op.create_unique_constraint` /
      `op.create_check_constraint` / `op.rename_table` /
      `op.batch_alter_table` call carries an explicit
      `schema=` keyword argument with one of:
      `project`, `coord`, `agent`, `auth`, `cloud`, `strategy`, `web`.
      **`public` is not accepted on an `op.*` call** — Phase 7 drained it to
      `alembic_version` alone. It stays legal only inside raw
      `op.execute("…")` SQL, which the gate checks against a separate set.
      (Pre-commit gate `alembic-schema-arg-gate` enforces this for
      `backend/alembic/versions/` — the only directory its `SCOPED_DIRS`
      covers. There is **no server-side mirror**: `forbid-public-schema`
      excludes `backend/alembic/versions/*`, so it guards the rest of the
      tree, not your migration. Committing with `--no-verify` skips this
      check entirely and nothing downstream re-runs it.)
- [ ] **Did NOT run `alembic revision --autogenerate`.** Raw autogenerate is
      prohibited because the `coord` schema is almost entirely unmodeled:
      the chain creates ~78 `coord` tables and only 3 of them have a
      SQLAlchemy model. Autogenerate diffs `Base.metadata` against the live
      database, cannot see the other ~75, and proposes **dropping** them.
      Scaffold with bare `alembic revision -m "…"` (no model diff is loaded)
      and hand-author the `upgrade()` / `downgrade()` bodies instead.
- [ ] Cross-schema FKs (e.g. `project.* → coord.*`) use schema-qualified
      ForeignKey strings (e.g. `sa.ForeignKey("coord.tasks.id")`).
- [ ] Downgrade reverses upgrade where reasonable; documented in
      docstring when not (data-destructive backfills, etc.).
