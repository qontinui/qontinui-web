from sqlalchemy.orm import Session

from app.models.user import User
from app.schemas.user import UserCreate, UserUpdate
from app.services.auth.password_service import password_service


class UserManagementService:
    def __init__(self):
        self.password_service = password_service

    def create_user(self, db: Session, user_data: UserCreate) -> User:
        hashed_password = self.password_service.hash_password(user_data.password)

        db_user = User(
            email=user_data.email,
            username=user_data.username,
            full_name=user_data.full_name,
            hashed_password=hashed_password,
        )
        db.add(db_user)
        db.commit()
        db.refresh(db_user)
        return db_user

    def create_beta_user(
        self, db: Session, email: str, username: str, temporary_password: str
    ) -> User:
        hashed_password = self.password_service.hash_password(temporary_password)

        db_user = User(
            email=email,
            username=username,
            full_name="",
            hashed_password=hashed_password,
            is_beta=True,
            is_active=True,
        )
        db.add(db_user)
        db.commit()
        db.refresh(db_user)
        return db_user

    def update_user_password(self, db: Session, user: User, new_password: str) -> User:
        user.hashed_password = self.password_service.hash_password(new_password)
        db.commit()
        db.refresh(user)
        return user

    def update_user_profile(
        self, db: Session, user: User, user_update: UserUpdate
    ) -> User:
        update_data = user_update.dict(exclude_unset=True)

        if "password" in update_data:
            hashed_password = self.password_service.hash_password(
                update_data["password"]
            )
            del update_data["password"]
            update_data["hashed_password"] = hashed_password

        for field, value in update_data.items():
            setattr(user, field, value)

        db.commit()
        db.refresh(user)
        return user

    def activate_user(self, db: Session, user: User) -> User:
        user.is_active = True
        db.commit()
        db.refresh(user)
        return user

    def deactivate_user(self, db: Session, user: User) -> User:
        user.is_active = False
        db.commit()
        db.refresh(user)
        return user

    def delete_user(self, db: Session, user: User) -> bool:
        db.delete(user)
        db.commit()
        return True

    def generate_unique_username(self, db: Session, base_username: str) -> str:
        from app.crud.user import get_user_by_username

        username = base_username
        counter = 1

        while get_user_by_username(db, username):
            username = f"{base_username}{counter}"
            counter += 1

        return username


user_management_service = UserManagementService()
