#!/usr/bin/env python3
"""
Migration script to move files from local filesystem to object storage (S3/MinIO)

This script:
1. Scans the uploads directory for existing files
2. Uploads each file to object storage
3. Updates database records with new URLs
4. Creates a backup report

Usage:
    python scripts/migrate_files_to_object_storage.py [--dry-run] [--backup]
"""

import argparse
import asyncio
import json
import sys
from datetime import datetime
from pathlib import Path

import structlog

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.db.session import AsyncSessionLocal
from app.models.project_assets import ProjectScreenshot
from app.models.user import User
from app.services.object_storage import object_storage

logger = structlog.get_logger(__name__)


class FileMigrator:
    """Handles migration of files from local filesystem to object storage"""

    def __init__(self, dry_run: bool = False):
        self.dry_run = dry_run
        self.uploaded = []
        self.failed = []
        self.skipped = []

    async def migrate_avatars(self, db: AsyncSession):
        """Migrate avatar files"""
        uploads_dir = Path("uploads/avatars")

        if not uploads_dir.exists():
            logger.warning("avatars_directory_not_found", path=str(uploads_dir))
            return

        logger.info("scanning_avatars", path=str(uploads_dir))

        # Get all avatar files
        avatar_files = list(uploads_dir.glob("*"))
        logger.info("found_avatar_files", count=len(avatar_files))

        for file_path in avatar_files:
            if not file_path.is_file():
                continue

            try:
                # Find user with this avatar
                old_url = f"/uploads/avatars/{file_path.name}"
                result = await db.execute(
                    select(User).filter(User.avatar_url == old_url)
                )
                user = result.scalar_one_or_none()

                if not user:
                    logger.warning(
                        "avatar_no_user_found",
                        filename=file_path.name,
                        url=old_url,
                    )
                    self.skipped.append(
                        {
                            "file": str(file_path),
                            "reason": "No user found",
                        }
                    )
                    continue

                # Upload to object storage
                if not self.dry_run:
                    logger.info(
                        "uploading_avatar",
                        filename=file_path.name,
                        user_id=str(user.id),
                    )

                    storage_key, new_url = object_storage.upload_from_path(
                        file_path=file_path,
                        prefix="avatars",
                        content_type="image/jpeg",
                        metadata={
                            "user_id": str(user.id),
                            "migrated_at": datetime.utcnow().isoformat(),
                            "original_path": str(file_path),
                        },
                        generate_unique_name=False,
                    )

                    # Update user record
                    await db.execute(
                        update(User)
                        .where(User.id == user.id)
                        .values(avatar_url=new_url)
                    )
                    await db.commit()

                    logger.info(
                        "avatar_migrated",
                        filename=file_path.name,
                        old_url=old_url,
                        new_url=new_url,
                        user_id=str(user.id),
                    )

                    self.uploaded.append(
                        {
                            "file": str(file_path),
                            "user_id": str(user.id),
                            "old_url": old_url,
                            "new_url": new_url,
                            "storage_key": storage_key,
                        }
                    )
                else:
                    logger.info(
                        "avatar_would_migrate",
                        filename=file_path.name,
                        user_id=str(user.id),
                    )
                    self.uploaded.append(
                        {
                            "file": str(file_path),
                            "user_id": str(user.id),
                            "old_url": old_url,
                        }
                    )

            except Exception as e:
                logger.error(
                    "avatar_migration_failed",
                    filename=file_path.name,
                    error=str(e),
                    error_type=type(e).__name__,
                )
                self.failed.append(
                    {
                        "file": str(file_path),
                        "error": str(e),
                    }
                )

    async def migrate_screenshots(self, db: AsyncSession):
        """Migrate screenshot files"""
        uploads_dir = Path("uploads/screenshots")

        if not uploads_dir.exists():
            logger.warning("screenshots_directory_not_found", path=str(uploads_dir))
            return

        logger.info("scanning_screenshots", path=str(uploads_dir))

        # Get all screenshot files (recursively to handle nested structures)
        screenshot_files = list(uploads_dir.rglob("*"))
        file_count = len([f for f in screenshot_files if f.is_file()])
        logger.info("found_screenshot_files", count=file_count)

        for file_path in screenshot_files:
            if not file_path.is_file():
                continue

            try:
                # Extract filename from path
                filename = file_path.name

                # Try to find screenshot in database by matching the s3_key pattern
                # Screenshots are stored as: screenshots/{user_id}/{project_id}/{uuid}.{ext}
                # Or they might be stored as: uploads/screenshots/{filename}

                # First, try to find by checking if the current s3_key contains the filename
                result = await db.execute(
                    select(ProjectScreenshot).filter(
                        ProjectScreenshot.s3_key.contains(filename)
                    )
                )
                screenshot = result.scalar_one_or_none()

                # If not found, try to match by extra_metadata.uploaded_filename
                if not screenshot:
                    result = await db.execute(
                        select(ProjectScreenshot).filter(
                            ProjectScreenshot.extra_metadata["uploaded_filename"].astext
                            == filename
                        )
                    )
                    screenshot = result.scalar_one_or_none()

                # If still not found, try to match by the file stem (UUID) in the s3_key
                if not screenshot:
                    file_stem = file_path.stem  # UUID part without extension
                    result = await db.execute(
                        select(ProjectScreenshot).filter(
                            ProjectScreenshot.s3_key.contains(file_stem)
                        )
                    )
                    screenshot = result.scalar_one_or_none()

                if not screenshot:
                    logger.warning(
                        "screenshot_no_record_found",
                        filename=filename,
                        path=str(file_path),
                    )
                    self.skipped.append(
                        {
                            "file": str(file_path),
                            "reason": "No database record found",
                        }
                    )
                    continue

                # Check if already migrated (s3_key doesn't start with "uploads/")
                if not screenshot.s3_key.startswith("uploads/"):
                    logger.info(
                        "screenshot_already_migrated",
                        filename=filename,
                        screenshot_id=str(screenshot.id),
                        s3_key=screenshot.s3_key,
                    )
                    self.skipped.append(
                        {
                            "file": str(file_path),
                            "reason": "Already migrated",
                            "screenshot_id": str(screenshot.id),
                            "s3_key": screenshot.s3_key,
                        }
                    )
                    continue

                # Determine content type from file extension
                ext = file_path.suffix.lower()
                content_type_map = {
                    ".png": "image/png",
                    ".jpg": "image/jpeg",
                    ".jpeg": "image/jpeg",
                    ".gif": "image/gif",
                    ".webp": "image/webp",
                }
                content_type = content_type_map.get(ext, "image/png")

                # Upload to object storage
                if not self.dry_run:
                    logger.info(
                        "uploading_screenshot",
                        filename=filename,
                        screenshot_id=str(screenshot.id),
                        user_id=str(screenshot.user_id),
                        project_id=str(screenshot.project_id),
                    )

                    # Build the new S3 key following the pattern: screenshots/{user_id}/{project_id}/{uuid}.{ext}
                    new_s3_key = f"screenshots/{screenshot.user_id}/{screenshot.project_id}/{screenshot.id}{ext}"

                    storage_key, new_url = object_storage.upload_from_path(
                        file_path=file_path,
                        prefix=f"screenshots/{screenshot.user_id}/{screenshot.project_id}",
                        content_type=content_type,
                        metadata={
                            "screenshot_id": str(screenshot.id),
                            "user_id": str(screenshot.user_id),
                            "project_id": str(screenshot.project_id),
                            "migrated_at": datetime.utcnow().isoformat(),
                            "original_path": str(file_path),
                            "source": screenshot.source,
                        },
                        generate_unique_name=False,
                    )

                    # Update screenshot record with new s3_key
                    old_s3_key = screenshot.s3_key
                    await db.execute(
                        update(ProjectScreenshot)
                        .where(ProjectScreenshot.id == screenshot.id)
                        .values(s3_key=storage_key)
                    )
                    await db.commit()

                    logger.info(
                        "screenshot_migrated",
                        filename=filename,
                        screenshot_id=str(screenshot.id),
                        old_s3_key=old_s3_key,
                        new_s3_key=storage_key,
                        user_id=str(screenshot.user_id),
                        project_id=str(screenshot.project_id),
                    )

                    self.uploaded.append(
                        {
                            "file": str(file_path),
                            "screenshot_id": str(screenshot.id),
                            "user_id": str(screenshot.user_id),
                            "project_id": str(screenshot.project_id),
                            "old_s3_key": old_s3_key,
                            "new_s3_key": storage_key,
                            "storage_key": storage_key,
                        }
                    )
                else:
                    logger.info(
                        "screenshot_would_migrate",
                        filename=filename,
                        screenshot_id=str(screenshot.id),
                        user_id=str(screenshot.user_id),
                        project_id=str(screenshot.project_id),
                    )
                    self.uploaded.append(
                        {
                            "file": str(file_path),
                            "screenshot_id": str(screenshot.id),
                            "user_id": str(screenshot.user_id),
                            "project_id": str(screenshot.project_id),
                            "old_s3_key": screenshot.s3_key,
                        }
                    )

            except Exception as e:
                logger.error(
                    "screenshot_migration_failed",
                    filename=file_path.name,
                    path=str(file_path),
                    error=str(e),
                    error_type=type(e).__name__,
                )
                self.failed.append(
                    {
                        "file": str(file_path),
                        "error": str(e),
                    }
                )

    def generate_report(self) -> dict:
        """Generate migration report"""
        return {
            "migration_date": datetime.utcnow().isoformat(),
            "dry_run": self.dry_run,
            "storage_backend": settings.STORAGE_BACKEND,
            "storage_bucket": settings.STORAGE_BUCKET_NAME,
            "summary": {
                "uploaded": len(self.uploaded),
                "failed": len(self.failed),
                "skipped": len(self.skipped),
                "total": len(self.uploaded) + len(self.failed) + len(self.skipped),
            },
            "uploaded_files": self.uploaded,
            "failed_files": self.failed,
            "skipped_files": self.skipped,
        }

    def save_report(self, report_path: Path):
        """Save migration report to file"""
        report = self.generate_report()
        report_path.parent.mkdir(parents=True, exist_ok=True)

        with open(report_path, "w") as f:
            json.dump(report, f, indent=2)

        logger.info("report_saved", path=str(report_path))


async def main():
    parser = argparse.ArgumentParser(
        description="Migrate files from local storage to object storage"
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Preview migration without making changes",
    )
    parser.add_argument(
        "--backup",
        action="store_true",
        help="Create backup of uploads directory before migration",
    )
    parser.add_argument(
        "--report",
        type=str,
        default=f"migration_report_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json",
        help="Path to save migration report",
    )

    args = parser.parse_args()

    # Check storage backend
    if settings.STORAGE_BACKEND not in ["s3", "minio"]:
        logger.error(
            "invalid_storage_backend",
            backend=settings.STORAGE_BACKEND,
            message="STORAGE_BACKEND must be 's3' or 'minio' for migration",
        )
        sys.exit(1)

    logger.info(
        "migration_starting",
        dry_run=args.dry_run,
        backend=settings.STORAGE_BACKEND,
        bucket=settings.STORAGE_BUCKET_NAME,
    )

    # Create backup if requested
    if args.backup and not args.dry_run:
        import tarfile

        backup_name = (
            f"uploads_backup_{datetime.now().strftime('%Y%m%d_%H%M%S')}.tar.gz"
        )
        logger.info("creating_backup", filename=backup_name)

        with tarfile.open(backup_name, "w:gz") as tar:
            tar.add("uploads", arcname="uploads")

        logger.info("backup_created", filename=backup_name)

    # Run migration
    migrator = FileMigrator(dry_run=args.dry_run)

    async with AsyncSessionLocal() as db:
        try:
            # Migrate avatars
            await migrator.migrate_avatars(db)

            # Migrate screenshots
            await migrator.migrate_screenshots(db)

        except Exception as e:
            logger.error("migration_failed", error=str(e), error_type=type(e).__name__)
            raise

    # Generate and save report
    report_path = Path(args.report)
    migrator.save_report(report_path)

    # Print summary
    report = migrator.generate_report()
    print("\n" + "=" * 60)
    print("MIGRATION SUMMARY")
    print("=" * 60)
    print(f"Mode: {'DRY RUN' if args.dry_run else 'LIVE'}")
    print(f"Backend: {settings.STORAGE_BACKEND}")
    print(f"Bucket: {settings.STORAGE_BUCKET_NAME}")
    print("\nResults:")
    print(f"  Uploaded: {report['summary']['uploaded']}")
    print(f"  Failed:   {report['summary']['failed']}")
    print(f"  Skipped:  {report['summary']['skipped']}")
    print(f"  Total:    {report['summary']['total']}")
    print(f"\nReport saved to: {report_path}")
    print("=" * 60)

    if report["summary"]["failed"] > 0:
        print("\nWARNING: Some files failed to migrate. Check the report for details.")
        sys.exit(1)

    if args.dry_run:
        print("\nThis was a dry run. No changes were made.")
        print("Run without --dry-run to perform the actual migration.")


if __name__ == "__main__":
    asyncio.run(main())
