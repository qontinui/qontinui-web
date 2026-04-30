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
    config.set_main_option("sqlalchemy.url", database_url)

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


# NOTE on cross-schema autogenerate (post-consolidation):
#
# Earlier this file carried an ``include_object`` filter that
# block-listed ``runner.*`` tables not declared as SQLAlchemy models.
# Its purpose was to prevent autogenerate from proposing
# ``op.drop_table`` on tables the runner-native migration system owned
# (qontinui-runner managed its own ``runner`` schema independently of
# alembic).
#
# That filter is deleted here as part of the migration consolidation
# (see ``D:/qontinui-root/tmp_migration_consolidation_plan.md``).
# Post-consolidation, alembic owns every table across all four canonical
# schemas (``project``, ``coord``, ``agent``, ``auth``), so autogenerate
# should see all of them — which is what removing the filter
# accomplishes (``include_schemas=True`` below makes alembic reflect
# all non-system schemas; with no filter, every table is a candidate).
#
# Transitional hazard: if someone runs ``alembic revision
# --autogenerate`` on a DB that still has the old runner-native
# ``runner.*`` tables (i.e., before the consolidation chain in
# ``backend/alembic/_staged_consolidation/`` is transplanted into
# ``versions/`` and applied), autogenerate will propose
# ``op.drop_table(..., schema="runner")`` for every runner-managed
# table — destructive if accepted. Until the consolidation lands,
# review autogenerate output carefully and discard any drop_table
# proposals targeting the ``runner`` schema.


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
        )

        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
