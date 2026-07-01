"""
Service for managing app deployment state (project.app_deploy_state).

Used by P3 auto-fresh engine to record build/restart results and by P4
dispatcher to query fresh hosts.
"""

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import and_, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.app_deploy_state import AppDeploymentFreshness, AppDeployState


class AppDeployStateService:
    """Service for app deployment state operations."""

    def __init__(self, session: AsyncSession):
        self.session = session

    async def upsert_deploy_state(
        self,
        device_id: UUID,
        app_id: str,
        deployed_sha: str | None,
        freshness: AppDeploymentFreshness,
        last_error: str | None = None,
    ) -> AppDeployState:
        """
        Upsert deployment state for (device_id, app_id).

        Used by P3 auto-fresh engine after pull+build+restart operations:
        - On success: freshness='fresh', deployed_sha=new_sha, last_error=None
        - On failure: freshness='failed', deployed_sha=None, last_error=error_msg

        Args:
            device_id: Runner device ID
            app_id: Application ID from project.apps
            deployed_sha: git commit SHA currently deployed (None on failure)
            freshness: State (fresh, building, failed, stale)
            last_error: Error message if freshness='failed'

        Returns:
            Updated AppDeployState row
        """
        now = datetime.now(UTC)

        # Use PostgreSQL INSERT ... ON CONFLICT for upsert
        stmt = (
            insert(AppDeployState)
            .values(
                device_id=device_id,
                app_id=app_id,
                deployed_sha=deployed_sha,
                freshness=freshness,
                deployed_at=now,
                last_error=last_error,
                updated_at=now,
            )
            .on_conflict_do_update(
                index_elements=[AppDeployState.device_id, AppDeployState.app_id],
                set_={
                    AppDeployState.deployed_sha: deployed_sha,
                    AppDeployState.freshness: freshness,
                    AppDeployState.deployed_at: now if deployed_sha else AppDeployState.deployed_at,
                    AppDeployState.last_error: last_error,
                    AppDeployState.updated_at: now,
                },
            )
            .returning(AppDeployState)
        )

        result = await self.session.execute(stmt)
        row = result.scalar_one()
        await self.session.flush()
        return row

    async def get_fresh_hosts_for_app(self, app_id: str, limit: int = 10) -> list[UUID]:
        """
        Get list of fresh device IDs for an app (dispatcher routing).

        Queries WHERE freshness='fresh' to find hosts ready for test execution.

        Args:
            app_id: Application ID
            limit: Max number of fresh hosts to return

        Returns:
            List of device IDs with fresh deployment of this app
        """
        stmt = (
            select(AppDeployState.device_id)
            .where(
                and_(
                    AppDeployState.app_id == app_id,
                    AppDeployState.freshness == AppDeploymentFreshness.FRESH,
                )
            )
            .limit(limit)
        )

        result = await self.session.execute(stmt)
        return result.scalars().all()

    async def get_deploy_state(
        self, device_id: UUID, app_id: str
    ) -> AppDeployState | None:
        """Get deployment state for a specific (device_id, app_id)."""
        stmt = select(AppDeployState).where(
            and_(
                AppDeployState.device_id == device_id,
                AppDeployState.app_id == app_id,
            )
        )
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none()

    async def set_building(self, device_id: UUID, app_id: str) -> AppDeployState:
        """Mark app as currently building (before pull+build+restart)."""
        return await self.upsert_deploy_state(
            device_id=device_id,
            app_id=app_id,
            deployed_sha=None,
            freshness=AppDeploymentFreshness.BUILDING,
            last_error=None,
        )

    async def set_fresh(
        self, device_id: UUID, app_id: str, deployed_sha: str
    ) -> AppDeployState:
        """Mark app as fresh after successful build+restart."""
        return await self.upsert_deploy_state(
            device_id=device_id,
            app_id=app_id,
            deployed_sha=deployed_sha,
            freshness=AppDeploymentFreshness.FRESH,
            last_error=None,
        )

    async def set_failed(
        self, device_id: UUID, app_id: str, error_message: str
    ) -> AppDeployState:
        """Mark app as failed after build/restart error."""
        return await self.upsert_deploy_state(
            device_id=device_id,
            app_id=app_id,
            deployed_sha=None,
            freshness=AppDeploymentFreshness.FAILED,
            last_error=error_message,
        )
