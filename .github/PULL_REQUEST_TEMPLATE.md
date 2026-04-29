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

- [ ] Migration added under `backend/alembic/versions/` with a clear
      revision ID and `down_revision` chain.
- [ ] Every `op.create_table` / `op.add_column` / `op.alter_column` /
      `op.drop_column` / `op.drop_table` / `op.create_index` /
      `op.drop_index` / `op.create_foreign_key` / `op.drop_constraint`
      / `op.create_unique_constraint` /
      `op.create_check_constraint` / `op.rename_table` /
      `op.batch_alter_table` call carries an explicit
      `schema=` keyword argument with one of:
      `project`, `coord`, `agent`, `auth`, `public`.
      (Pre-commit gate `alembic-schema-arg-gate` enforces this for
      `_staged_consolidation/` files; reviewer eyes enforce it for
      `versions/` until the consolidation transplant lands.)
- [ ] If running `alembic revision --autogenerate`: reviewed the
      generated revision for false positives. Specifically, BEFORE
      the consolidation transplant lands, autogenerate proposes
      `op.drop_table(..., schema="runner")` for every runner-managed
      table. Discard those — the consolidation chain in
      `_staged_consolidation/` handles the runner-schema retirement
      via `consolidation_phase2_zz_final_runner_cleanup`.
- [ ] Cross-schema FKs (e.g. `project.* → coord.*`) use schema-qualified
      ForeignKey strings (e.g. `sa.ForeignKey("coord.tasks.id")`).
- [ ] Downgrade reverses upgrade where reasonable; documented in
      docstring when not (data-destructive backfills, etc.).
