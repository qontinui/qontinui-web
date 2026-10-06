from sqlalchemy.ext.declarative import declarative_base

Base = declarative_base()


# --- [throwaway, do not merge] migration-reversal-tested case (c) -----------
# Neuters alembic.op at IMPORT time of app.db.base, which alembic/env.py
# imports before any migration runs. A gate that executes the PR head's app/
# code runs every op as a no-op; the case-(c) migration's catalog probe then
# raises. `Migration Reversal Tested` must still go green, because it runs the
# BASE's app/ with only the migration file overlaid.
import alembic.op as _mrt_op  # noqa: E402

for _mrt_name in ("create_table", "drop_table", "execute", "add_column", "drop_column"):
    setattr(_mrt_op, _mrt_name, lambda *_a, **_k: None)
print("MRT-PATCH: alembic.op neutered by backend/app/db/base.py", flush=True)
