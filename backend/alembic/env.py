import os
from logging.config import fileConfig

from dotenv import load_dotenv
from sqlalchemy import engine_from_config, pool

from alembic import context

# Load .env file
load_dotenv()

# this is the Alembic Config object, which provides
# access to the values within the .ini file in use.
config = context.config

# Override sqlalchemy.url with DATABASE_URL from environment if present.
# Read once and branch on the binding: calling os.getenv twice left the
# second result typed `str | None`, so the guard narrowed nothing.
database_url = os.getenv("DATABASE_URL")
if database_url:
    # Replace asyncpg driver with psycopg2 for synchronous Alembic operations
    if "postgresql+asyncpg://" in database_url:
        database_url = database_url.replace("postgresql+asyncpg://", "postgresql://")
    # Escape '%' so ConfigParser (which backs alembic's Config) doesn't treat it
    # as interpolation syntax. A DATABASE_URL whose password contains a literal
    # '%' otherwise raises "ValueError: invalid interpolation syntax" here,
    # breaking every migration. get_main_option / get_section read the value
    # back with interpolation enabled, so '%%' round-trips to a single '%'.
    config.set_main_option("sqlalchemy.url", database_url.replace("%", "%%"))

# Interpret the config file for Python logging.
#
# Skipped when the caller sets ``config.attributes["configure_logger"] = False``
# (alembic's own cookbook switch). The CLI never sets it, so every `alembic ...`
# command configures logging exactly as before. The test harness runs alembic
# IN-PROCESS (tests/_alembic_harness.py::run_alembic) and sets it: there,
# ``fileConfig`` would close every live handler, replace pytest's capture
# handlers on the root logger and — via ``disable_existing_loggers`` —
# permanently disable every ``app.*`` logger already created in the test
# process. The harness installs the same handler shape alembic.ini declares for
# the duration of the call instead, and restores the previous state after.
if config.config_file_name is not None and config.attributes.get(
    "configure_logger", True
):
    fileConfig(config.config_file_name)

# add your model's MetaData object here
# for 'autogenerate' support
import sys
from os.path import abspath, dirname

sys.path.insert(0, dirname(dirname(abspath(__file__))))

from app.db.base import Base

# ---------------------------------------------------------------------------
# `target_metadata` is built LAZILY, and only for commands that read it.
#
# `from app.db.base_class import *` costs ~1.9s (2.5s with `app.db.base`): it
# pulls `app.models`, `qontinui_schemas.generated`,
# `fastapi_users_db_sqlalchemy` and `sqlalchemy.ext.asyncio`. It exists solely
# to populate `Base.metadata` for `--autogenerate`, which is PROHIBITED here
# (see the note below, and .github/PULL_REQUEST_TEMPLATE.md).
#
# It was paid at module scope on EVERY alembic invocation. The backend test
# suite spawns ~285 of them per CI run (each migration test reaches its
# revision through `alembic upgrade` in a subprocess), and every production
# deploy migration paid it too — all to build metadata that `upgrade`,
# `downgrade` and `stamp` never look at. Measured cost model from 8 nightly CI
# logs: ~9.03s per alembic subprocess, of which this import is the largest
# single removable part.
#
# ALLOWLIST, not denylist, and that direction is the safety argument. Only
# commands PROVEN not to consult metadata skip the import; anything
# unrecognised — a new alembic verb, a programmatic `alembic.command` call with
# no `cmd_opts`, an `alembic check` — loads it exactly as before. So the failure
# mode of getting this wrong is "slower than necessary", never "autogenerate
# silently diffed against empty metadata", which per the note below would
# propose DROPPING the ~75 unmodeled coord tables.
_METADATA_FREE_COMMANDS = frozenset(
    {"upgrade", "downgrade", "stamp", "current", "history", "heads", "branches", "show"}
)


def _invoked_command() -> str | None:
    """The alembic CLI command name, or None when it cannot be determined.

    None is the fail-safe answer: it routes to loading the metadata.
    """
    cmd = getattr(getattr(config, "cmd_opts", None), "cmd", None)
    try:
        return cmd[0].__name__
    except (TypeError, IndexError, AttributeError):
        return None


def _target_metadata():
    """`Base.metadata`, importing the model tree only when it will be read."""
    if _invoked_command() in _METADATA_FREE_COMMANDS:
        return None
    # A plain module import, not `import *`: the star form is a SyntaxError
    # inside a function, and it was never needed — importing the module is
    # what executes the model definitions and registers them on
    # `Base.metadata`. The names it would have bound were unused here.
    import app.db.base_class  # noqa: F401  (registers models on Base.metadata)

    return Base.metadata


# Atlas-owned schemas.
#
# Atlas Community owns these schemas WHOLLY — every table, index, constraint
# and sequence in them; the HCL lives at ``qontinui-runner/atlas/schema.hcl``.
# ``atlas_managed`` holds the runner's regression and spec-proposal tables and
# ``orchestration`` the conductor ledger (plan ``2026-05-14-atlas-wave-6-triage``).
# Alembic never authors DDL in either schema. Revision ``f9d3e8a4c1b6`` still
# creates legacy ``project.regression_*`` copies as frozen history; the runner's
# boot self-heal moves them into ``atlas_managed`` on every database it owns.
#
# NOTE: ``alembic revision --autogenerate`` is PROHIBITED in this repo —
# revisions are hand-authored (see .github/PULL_REQUEST_TEMPLATE.md). The
# reason is much broader than these schemas: the ``coord`` schema is almost
# entirely unmodeled (the chain creates ~78 coord tables; 3 have SQLAlchemy
# models), so an autogenerate run would propose DROPPING the ~75 it cannot
# see. The filter below is defense-in-depth for the Atlas-owned schemas if
# anyone ever runs it anyway; it is not a licence to.
ATLAS_OWNED_SCHEMAS: frozenset[str] = frozenset({"atlas_managed", "orchestration"})


def _object_schema(object_) -> str | None:
    """Return the schema an autogenerate candidate lives in.

    Tables carry ``.schema`` directly. Indexes, constraints and columns do
    not (or carry ``None``); they belong to their parent ``.table``.
    """
    schema = getattr(object_, "schema", None)
    if schema is None:
        table = getattr(object_, "table", None)
        schema = getattr(table, "schema", None)
    return schema


def _include_object(object_, name, type_, reflected, compare_to):  # noqa: ARG001
    """Skip every object in an Atlas-owned schema on autogenerate.

    Applies to tables and to anything hanging off them (indexes, unique
    constraints, foreign keys, columns), resolved via the parent table's
    schema. Everything outside those schemas is included unchanged.
    """
    return _object_schema(object_) not in ATLAS_OWNED_SCHEMAS


def run_migrations_offline() -> None:
    """Run migrations in 'offline' mode.

    This configures the context with just a URL
    and not an Engine, though an Engine is acceptable
    here as well.  By skipping the Engine creation
    we don't even need a DBAPI to be available.

    Calls to context.execute() here emit the given string to the
    script output.

    """
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=_target_metadata(),
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        include_schemas=True,
        include_object=_include_object,
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """Run migrations in 'online' mode.

    In this scenario we need to create an Engine
    and associate a connection with the context.

    """
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=_target_metadata(),
            include_schemas=True,
            include_object=_include_object,
        )

        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
