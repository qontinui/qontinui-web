from app.db.base import Base  # noqa

# Import all models here for Alembic to detect them
from app.models.user import User  # noqa
from app.models.project import Project  # noqa