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


def include_object(object, name, type_, reflected, compare_to):
    """Filter what alembic compares during autogenerate.

    The DB is shared with qontinui-runner, which manages its own tables
    in the ``runner`` schema via native (non-alembic) migrations. With
    ``include_schemas=True`` set below, alembic would otherwise see
    those runner-managed tables and propose dropping them. This filter
    limits cross-schema reflection to runner.* tables that web alembic
    actually owns (i.e., tables a SQLAlchemy model declares with
    ``__table_args__ = {"schema": "runner"}``). Currently that's just
    ``runner.users`` (see ``app/models/user.py``).
    """
    if type_ == "table" and reflected and getattr(object, "schema", None) == "runner":
        return f"runner.{name}" in target_metadata.tables
    return True


# other values from the config, defined by the needs of env.py,
# can be acquired:
# my_important_option = config.get_main_option("my_important_option")
# ... etc.


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
        include_object=include_object,
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
            include_object=include_object,
        )

        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
