"""
Tests for organization service, specifically personal organization creation.
"""

import pytest
from sqlalchemy import select

from app.models.organization import Organization, TeamMember, TeamRole
from app.models.user import User
from app.services.organization_service import organization_service


@pytest.mark.asyncio
async def test_create_personal_organization(async_db_session):
    """Test creating a personal organization for a new user."""
    # Create a test user
    user = User(
        email="test@example.com",
        username="testuser",
        full_name="Test User",
        hashed_password="hashed_password",
    )
    async_db_session.add(user)
    await async_db_session.commit()
    await async_db_session.refresh(user)

    # Create personal organization
    org = await organization_service.create_personal_organization(
        db=async_db_session,
        user=user,
    )

    # Verify organization was created
    assert org is not None
    assert org.name == "Test User's Projects"
    assert org.slug.startswith("user-")
    assert org.owner_id == user.id
    assert org.settings.get("is_personal") is True
    assert org.settings.get("default_org") is True

    # Verify team member was created
    result = await async_db_session.execute(
        select(TeamMember).filter(
            TeamMember.organization_id == org.id,
            TeamMember.user_id == user.id,
        )
    )
    member = result.scalar_one_or_none()

    assert member is not None
    assert member.role == TeamRole.OWNER.value


@pytest.mark.asyncio
async def test_create_personal_organization_idempotency(async_db_session):
    """Test that creating a personal organization twice returns the same org."""
    # Create a test user
    user = User(
        email="test2@example.com",
        username="testuser2",
        full_name="Test User 2",
        hashed_password="hashed_password",
    )
    async_db_session.add(user)
    await async_db_session.commit()
    await async_db_session.refresh(user)

    # Create personal organization first time
    org1 = await organization_service.create_personal_organization(
        db=async_db_session,
        user=user,
    )

    # Create personal organization second time (should return existing)
    org2 = await organization_service.create_personal_organization(
        db=async_db_session,
        user=user,
    )

    # Verify they are the same organization
    assert org1.id == org2.id
    assert org1.name == org2.name
    assert org1.slug == org2.slug

    # Verify only one organization exists for this user
    result = await async_db_session.execute(
        select(Organization)
        .join(TeamMember)
        .filter(TeamMember.user_id == user.id)
    )
    orgs = result.scalars().all()

    # Should only have one personal org (idempotency check)
    personal_orgs = [
        org for org in orgs
        if org.settings.get("is_personal") is True
    ]
    assert len(personal_orgs) == 1


@pytest.mark.asyncio
async def test_create_personal_organization_username_only(async_db_session):
    """Test creating a personal org for user without full name."""
    # Create a test user without full name
    user = User(
        email="test3@example.com",
        username="johndoe",
        full_name="",
        hashed_password="hashed_password",
    )
    async_db_session.add(user)
    await async_db_session.commit()
    await async_db_session.refresh(user)

    # Create personal organization
    org = await organization_service.create_personal_organization(
        db=async_db_session,
        user=user,
    )

    # Verify organization name uses username
    assert org is not None
    assert org.name == "johndoe's Projects"


@pytest.mark.asyncio
async def test_create_personal_organization_email_only(async_db_session):
    """Test creating a personal org for user with only email."""
    # Create a test user with only email (no username or full name)
    user = User(
        email="jane.smith@example.com",
        username="janesmith",  # Username is required, so we use email prefix
        full_name=None,
        hashed_password="hashed_password",
    )
    async_db_session.add(user)
    await async_db_session.commit()
    await async_db_session.refresh(user)

    # Create personal organization
    org = await organization_service.create_personal_organization(
        db=async_db_session,
        user=user,
    )

    # Verify organization was created
    assert org is not None
    assert org.name == "janesmith's Projects"


@pytest.mark.asyncio
async def test_personal_organization_slug_uniqueness(async_db_session):
    """Test that slugs are unique even for users with similar IDs."""
    # Create first user
    user1 = User(
        email="user1@example.com",
        username="user1",
        full_name="User One",
        hashed_password="hashed_password",
    )
    async_db_session.add(user1)
    await async_db_session.commit()
    await async_db_session.refresh(user1)

    # Create second user
    user2 = User(
        email="user2@example.com",
        username="user2",
        full_name="User Two",
        hashed_password="hashed_password",
    )
    async_db_session.add(user2)
    await async_db_session.commit()
    await async_db_session.refresh(user2)

    # Create personal organizations for both
    org1 = await organization_service.create_personal_organization(
        db=async_db_session,
        user=user1,
    )
    org2 = await organization_service.create_personal_organization(
        db=async_db_session,
        user=user2,
    )

    # Verify slugs are different
    assert org1.slug != org2.slug

    # Verify both organizations exist
    result = await async_db_session.execute(
        select(Organization).filter(
            Organization.id.in_([org1.id, org2.id])
        )
    )
    orgs = result.scalars().all()
    assert len(orgs) == 2
