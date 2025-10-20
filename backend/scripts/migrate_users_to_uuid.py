#!/usr/bin/env python3
"""
Migration script to convert user IDs from Integer to UUID.

This script:
1. Exports all existing users from the database
2. Drops all tables (including alembic_version)
3. Runs alembic migrations to create new UUID schema
4. Re-imports users with new UUID IDs

IMPORTANT: This will DELETE all data except users. Projects, subscriptions, etc. will be lost.
If you have important data beyond user accounts, you'll need a more sophisticated migration.
"""

import asyncio
import json
import sys
import uuid
from datetime import datetime
from pathlib import Path

# Add parent directory to path so we can import from app
sys.path.insert(0, str(Path(__file__).parent.parent))

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.orm import sessionmaker

from app.core.config import settings


async def export_users(engine):
    """Export all users from the database."""
    print("📤 Exporting existing users...")

    async_session = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    async with async_session() as session:
        try:
            result = await session.execute(
                text("""
                    SELECT
                        id, email, username, full_name, hashed_password,
                        is_active, is_superuser, is_verified, is_beta,
                        company, phone, avatar_url, subscription_tier,
                        created_at, updated_at, email_verification_token
                    FROM users
                    ORDER BY created_at
                """)
            )
            users = result.fetchall()

            # Convert to list of dicts
            user_list = []
            for user in users:
                user_dict = {
                    "old_id": user[0],
                    "email": user[1],
                    "username": user[2],
                    "full_name": user[3],
                    "hashed_password": user[4],
                    "is_active": user[5],
                    "is_superuser": user[6],
                    "is_verified": user[7],
                    "is_beta": user[8],
                    "company": user[9],
                    "phone": user[10],
                    "avatar_url": user[11],
                    "subscription_tier": user[12],
                    "created_at": user[13].isoformat() if user[13] else None,
                    "updated_at": user[14].isoformat() if user[14] else None,
                    "email_verification_token": user[15],
                    "new_uuid": str(uuid.uuid4()),  # Generate new UUID
                }
                user_list.append(user_dict)

            print(f"✅ Exported {len(user_list)} users")
            return user_list

        except Exception as e:
            print(f"❌ Error exporting users: {e}")
            print(
                "ℹ️  This might be normal if the database is already empty or using UUID"
            )
            return []


async def drop_all_tables(engine):
    """Drop all tables including alembic_version."""
    print("\n🗑️  Dropping all tables...")

    async_session = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    async with async_session() as session:
        try:
            # Get all table names
            result = await session.execute(
                text("""
                    SELECT tablename
                    FROM pg_tables
                    WHERE schemaname = 'public'
                """)
            )
            tables = [row[0] for row in result.fetchall()]

            if not tables:
                print("ℹ️  No tables found to drop")
                return

            print(f"   Found {len(tables)} tables: {', '.join(tables)}")

            # Drop all tables with CASCADE to handle foreign keys
            for table in tables:
                await session.execute(text(f'DROP TABLE IF EXISTS "{table}" CASCADE'))

            await session.commit()
            print("✅ All tables dropped")

        except Exception as e:
            print(f"❌ Error dropping tables: {e}")
            raise


async def import_users(engine, users):
    """Import users with new UUID IDs."""
    if not users:
        print("\nℹ️  No users to import")
        return

    print(f"\n📥 Importing {len(users)} users with new UUIDs...")

    async_session = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    async with async_session() as session:
        try:
            for i, user in enumerate(users, 1):
                await session.execute(
                    text("""
                        INSERT INTO users (
                            id, email, username, full_name, hashed_password,
                            is_active, is_superuser, is_verified, is_beta,
                            company, phone, avatar_url, subscription_tier,
                            created_at, updated_at, email_verification_token
                        ) VALUES (
                            :id, :email, :username, :full_name, :hashed_password,
                            :is_active, :is_superuser, :is_verified, :is_beta,
                            :company, :phone, :avatar_url, :subscription_tier,
                            :created_at, :updated_at, :email_verification_token
                        )
                    """),
                    {
                        "id": user["new_uuid"],
                        "email": user["email"],
                        "username": user["username"],
                        "full_name": user["full_name"],
                        "hashed_password": user["hashed_password"],
                        "is_active": user["is_active"],
                        "is_superuser": user["is_superuser"],
                        "is_verified": user["is_verified"],
                        "is_beta": user["is_beta"],
                        "company": user["company"],
                        "phone": user["phone"],
                        "avatar_url": user["avatar_url"],
                        "subscription_tier": user["subscription_tier"],
                        "created_at": user["created_at"],
                        "updated_at": user["updated_at"],
                        "email_verification_token": user["email_verification_token"],
                    },
                )
                print(
                    f"   {i}/{len(users)}: {user['email']} (old ID: {user['old_id']} → new UUID: {user['new_uuid']})"
                )

            await session.commit()
            print("✅ All users imported")

        except Exception as e:
            print(f"❌ Error importing users: {e}")
            await session.rollback()
            raise


async def run_alembic_upgrade():
    """Run alembic upgrade head using subprocess."""
    print("\n🔄 Running alembic migrations...")
    import subprocess

    # Change to backend directory
    backend_dir = Path(__file__).parent.parent

    try:
        result = subprocess.run(
            ["alembic", "upgrade", "head"],
            cwd=backend_dir,
            capture_output=True,
            text=True,
            check=True,
        )
        print(result.stdout)
        print("✅ Migrations applied successfully")

    except subprocess.CalledProcessError as e:
        print(f"❌ Error running migrations: {e}")
        print(f"STDOUT: {e.stdout}")
        print(f"STDERR: {e.stderr}")
        raise


async def main():
    """Main migration function."""
    print("=" * 60)
    print("USER UUID MIGRATION SCRIPT")
    print("=" * 60)
    print()
    print("⚠️  WARNING: This will:")
    print("   - Export all existing users")
    print("   - DROP ALL TABLES in the database")
    print("   - Recreate tables with UUID schema")
    print("   - Re-import users with new UUID IDs")
    print()
    print("⚠️  ALL DATA EXCEPT USERS WILL BE LOST:")
    print("   - Projects")
    print("   - Subscriptions")
    print("   - Audit logs")
    print("   - Usage metrics")
    print("   - Storage usage records")
    print()

    # Get database URL from settings
    db_url = str(settings.DATABASE_URL)

    # Convert to async if needed
    if db_url.startswith("postgresql://"):
        db_url = db_url.replace("postgresql://", "postgresql+asyncpg://")
    elif not db_url.startswith("postgresql+asyncpg://"):
        print(f"❌ Unsupported database URL: {db_url}")
        return

    print(f"Database: {db_url.split('@')[1] if '@' in db_url else 'unknown'}")
    print()

    response = input("Are you sure you want to continue? Type 'yes' to proceed: ")
    if response.lower() != "yes":
        print("❌ Migration cancelled")
        return

    print()
    print("Starting migration...")
    print()

    # Create engine
    engine = create_async_engine(db_url, echo=False)

    try:
        # Step 1: Export users
        users = await export_users(engine)

        # Save backup to file
        backup_file = (
            Path(__file__).parent
            / f"user_backup_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
        )
        with open(backup_file, "w") as f:
            json.dump(users, f, indent=2)
        print(f"📝 Backup saved to: {backup_file}")

        # Step 2: Drop all tables
        await drop_all_tables(engine)

        # Close engine before running alembic
        await engine.dispose()

        # Step 3: Run migrations
        await run_alembic_upgrade()

        # Create new engine after migrations
        engine = create_async_engine(db_url, echo=False)

        # Step 4: Import users
        await import_users(engine, users)

        print()
        print("=" * 60)
        print("✅ MIGRATION COMPLETE!")
        print("=" * 60)
        print()
        print(f"✅ {len(users)} users migrated successfully")
        print(f"📝 Backup saved to: {backup_file}")
        print()
        print("Next steps:")
        print("1. Test user login with existing credentials")
        print("2. Verify admin access works")
        print("3. Update frontend to handle UUID user IDs")
        print()

    except Exception as e:
        print()
        print("=" * 60)
        print("❌ MIGRATION FAILED!")
        print("=" * 60)
        print(f"Error: {e}")
        print()
        print("Your database may be in an inconsistent state.")
        print(
            f"User backup is available at: {backup_file if 'backup_file' in locals() else 'not created'}"
        )
        print()
        raise

    finally:
        await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
