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

# Override sqlalchemy.url with DATABASE_URL from environment if present
if os.getenv("DATABASE_URL"):
    database_url = os.getenv("DATABASE_URL")
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
# This line sets up loggers basically.
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# add your model's MetaData object here
# for 'autogenerate' support
import sys
from os.path import abspath, dirname

sys.path.insert(0, dirname(dirname(abspath(__file__))))

from app.db.base import Base
from app.db.base_class import *  # Import all models

target_metadata = Base.metadata


# Atlas-owned tables (Row 3 schema-half pilot, Wave 1.4).
#
# Atlas Community is the source of truth for this set; the HCL lives at
# ``qontinui-runner/atlas/schema.hcl``. Historical alembic migrations for
# these tables remain in ``versions/`` as frozen history, but new
# ``alembic revision --autogenerate`` runs MUST skip them — otherwise
# autogenerate would propose drop/recreate ops every time, since the
# tables aren't declared as SQLAlchemy models on the alembic side.
#
# When Atlas takes over additional tables, add them here too.
ATLAS_OWNED_TABLES: set[tuple[str, str]] = {
    ("project", "regression_suites"),
    ("project", "regression_runs"),
    ("project", "regression_diagnoses"),
    ("project", "regression_assertion_executions"),
    ("coord", "coordinator_shadow_decisions"),
}


def _include_object(object_, name, type_, reflected, compare_to):  # noqa: ARG001
    """Skip Atlas-owned tables on autogenerate.

    Indexes and FKs hanging off skipped tables come along for the ride —
    alembic doesn't surface them as standalone autogenerate candidates
    when their parent table is filtered out.
    """
    if type_ == "table":
        schema = getattr(object_, "schema", None)
        return (schema, name) not in ATLAS_OWNED_TABLES
    return True


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
        target_metadata=target_metadata,
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
            target_metadata=target_metadata,
            include_schemas=True,
            include_object=_include_object,
        )

        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
