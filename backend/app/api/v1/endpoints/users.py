from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_active_user, get_current_superuser, get_db
from app.crud.user import delete_user, get_user, get_users, update_user
from app.models.user import User as UserModel
from app.schemas.user import User, UserUpdate

router = APIRouter()


@router.get("/me", response_model=User)
def read_user_me(current_user: UserModel = Depends(get_current_active_user)) -> Any:
    return current_user


@router.put("/me", response_model=User)
def update_user_me(
    *,
    db: Session = Depends(get_db),
    user_update: UserUpdate,
    current_user: UserModel = Depends(get_current_active_user),
) -> Any:
    user = update_user(db, current_user, user_update)
    return user


@router.get("/", response_model=list[User])
def read_users(
    db: Session = Depends(get_db),
    skip: int = 0,
    limit: int = 100,
    current_user: UserModel = Depends(get_current_superuser),
) -> Any:
    users = get_users(db, skip=skip, limit=limit)
    return users


@router.get("/{user_id}", response_model=User)
def read_user(
    user_id: int,
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(get_current_superuser),
) -> Any:
    user = get_user(db, user_id=user_id)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="User not found"
        )
    return user


@router.put("/{user_id}", response_model=User)
def update_user_by_id(
    *,
    db: Session = Depends(get_db),
    user_id: int,
    user_update: UserUpdate,
    current_user: UserModel = Depends(get_current_superuser),
) -> Any:
    user = get_user(db, user_id=user_id)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="User not found"
        )
    user = update_user(db, user, user_update)
    return user


@router.delete("/{user_id}")
def delete_user_by_id(
    *,
    db: Session = Depends(get_db),
    user_id: int,
    current_user: UserModel = Depends(get_current_superuser),
) -> Any:
    success = delete_user(db, user_id=user_id)
    if not success:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="User not found"
        )
    return {"message": "User deleted successfully"}
