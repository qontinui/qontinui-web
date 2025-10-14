from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.security import get_password_hash
from app.db.base import Base

# Import models to register them with Base
from app.db.base_class import *  # noqa
from app.db.session import engine
from app.models.user import User


def init_db(db: Session) -> None:
    # Create all tables
    Base.metadata.create_all(bind=engine)

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
                email_verified=True,
                is_active=True,
            )
            db.add(user)
            db.commit()
            db.refresh(user)
            print(f"Created first superuser: {settings.FIRST_SUPERUSER_EMAIL}")
