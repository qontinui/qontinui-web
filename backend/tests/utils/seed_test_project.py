"""
Seed the E2E test project for Playwright specs.

Three specs hardcode the same project UUID and use it as a path/query
arg against `/automation-builder/extraction`:

- `frontend/tests/e2e/annotation-editor.spec.ts:17`
- `frontend/tests/e2e/web-extraction.spec.ts:10`
- `frontend/tests/e2e/web-extraction-debug.spec.ts:10`

On a fresh CI database the row doesn't exist, so every navigation that
threads the UUID through the API 404s. This seeder creates the project
row idempotently, owned by the dev test user. `organization_id` is
nullable on `project.projects`, and `seed_test_user.create_test_user`
bypasses the `on_after_register` hook that would otherwise auto-create
a personal organization, so the project is left org-less.
"""

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.project import Project
from app.models.user import User

# Hardcoded in the three Playwright specs above. Keep in sync if any
# spec rotates the UUID.
TEST_PROJECT_ID = UUID("fb93478d-98bd-4e40-99f4-0f2c08c1fd5a")
TEST_PROJECT_NAME = "E2E Test Project"


async def create_test_project(db: AsyncSession, owner: User) -> Project:
    """Create or return the E2E test project owned by `owner`."""
    result = await db.execute(select(Project).filter(Project.id == TEST_PROJECT_ID))
    existing = result.scalar_one_or_none()
    if existing is not None:
        return existing

    project = Project(
        id=TEST_PROJECT_ID,
        name=TEST_PROJECT_NAME,
        description="Seeded project for Playwright E2E specs that hardcode this UUID.",
        configuration={},
        owner_id=owner.id,
    )
    db.add(project)
    await db.commit()
    await db.refresh(project)
    return project
