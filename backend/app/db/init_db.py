from sqlalchemy.orm import Session

from app.core.config import settings
from app.crud.user import create_user, get_user_by_email
from app.db.base import Base
from app.db.session import engine
from app.schemas.user import UserCreate
# Import models to register them with Base
from app.db.base_class import *  # noqa


def init_db(db: Session) -> None:
    # Create all tables
    Base.metadata.create_all(bind=engine)
    
    # Create first superuser if it doesn't exist
    if settings.FIRST_SUPERUSER_EMAIL:
        user = get_user_by_email(db, email=settings.FIRST_SUPERUSER_EMAIL)
        if not user:
            user_in = UserCreate(
                email=settings.FIRST_SUPERUSER_EMAIL,
                username=settings.FIRST_SUPERUSER_EMAIL.split("@")[0],
                password=settings.FIRST_SUPERUSER_PASSWORD,
                full_name="Admin User"
            )
            user = create_user(db, user_in)
            # Update user to be superuser
            user.is_superuser = True
            db.add(user)
            db.commit()
            print(f"Created first superuser: {settings.FIRST_SUPERUSER_EMAIL}")