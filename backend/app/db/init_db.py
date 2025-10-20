from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.security import get_password_hash

# Import models to register them with Base
from app.db.base_class import *  # noqa
from app.models.user import User


def init_db(db: Session) -> None:
    # Tables are created via Alembic migrations, not here
    # Base.metadata.create_all(bind=engine) is incompatible with async engines
    pass

    # Create first superuser if it doesn't exist
    if settings.FIRST_SUPERUSER_EMAIL:
        # Use direct query to avoid circular import issues
        user = (
            db.query(User).filter(User.email == settings.FIRST_SUPERUSER_EMAIL).first()
        )
        if not user:
            # Create user directly
            hashed_password = get_password_hash(settings.FIRST_SUPERUSER_PASSWORD)
            user = User(
                email=settings.FIRST_SUPERUSER_EMAIL,
                username=settings.FIRST_SUPERUSER_EMAIL.split("@")[0],
                hashed_password=hashed_password,
                full_name="Admin User",
                is_superuser=True,
                is_verified=True,  # Changed from email_verified
                is_active=True,
            )
            db.add(user)
            db.commit()
            db.refresh(user)
            print(f"Created first superuser: {settings.FIRST_SUPERUSER_EMAIL}")
