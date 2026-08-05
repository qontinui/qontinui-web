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
      `project`, `coord`, `agent`, `auth`, `public`.
      (Pre-commit gate `alembic-schema-arg-gate` enforces this for
      **both** `versions/` and `_staged_consolidation/` — its `files:`
      pattern is `^backend/alembic/(_staged_consolidation|versions)/.*\.py$`.
      The required `forbid-public-schema` check is the server-side half.)
- [ ] **Did NOT run `alembic revision --autogenerate`.** Raw autogenerate is
      prohibited: no SQLAlchemy models back the `coord` schema, so it has
      nothing to compare against there and emits spurious drops — most
      visibly `op.drop_table(..., schema="runner")` for every runner-managed
      table, which is Atlas-managed and must not be touched by alembic.
      Hand-author the `upgrade()` / `downgrade()` bodies instead.
- [ ] Cross-schema FKs (e.g. `project.* → coord.*`) use schema-qualified
      ForeignKey strings (e.g. `sa.ForeignKey("coord.tasks.id")`).
- [ ] Downgrade reverses upgrade where reasonable; documented in
      docstring when not (data-destructive backfills, etc.).
