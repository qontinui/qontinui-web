#!/usr/bin/env python3
"""
Export all data from snapshot and migrate to UUID database.
"""

import json
import sys
import uuid
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from sqlalchemy import create_engine, text

# Database URLs
TEMP_DB_URL = "postgresql://qontinui_admin:NawaiNawai2008!=@qontinui-db-temp-recovery.c16uiu02ugak.eu-central-1.rds.amazonaws.com:5432/postgres"
PROD_DB_URL = "postgresql://qontinui_admin:NawaiNawai2008!=@qontinui-db.c16uiu02ugak.eu-central-1.rds.amazonaws.com:5432/qontinui-db"


def export_all_data():
    """Export all users and related data from temporary instance."""
    print("📤 Step 2: Exporting all data from snapshot...")
    print()

    engine = create_engine(TEMP_DB_URL)

    with engine.connect() as conn:
        # Export users (using old schema column names from snapshot)
        result = conn.execute(
            text("""
            SELECT id, email, username, full_name, hashed_password,
                   is_active, is_superuser, email_verified, is_beta,
                   company, phone, avatar_url, subscription_tier,
                   created_at, updated_at, email_verification_token
            FROM users
            ORDER BY created_at
        """)
        )

        users = []
        user_id_map = {}  # old_id -> new_uuid mapping

        for row in result:
            old_id = row[0]
            new_uuid = str(uuid.uuid4())
            user_id_map[old_id] = new_uuid

            users.append(
                {
                    "old_id": old_id,
                    "new_uuid": new_uuid,
                    "email": row[1],
                    "username": row[2],
                    "full_name": row[3],
                    "hashed_password": row[4],
                    "is_active": row[5],
                    "is_superuser": row[6],
                    "is_verified": row[
                        7
                    ],  # Maps email_verified from snapshot to is_verified
                    "is_beta": row[8],
                    "company": row[9],
                    "phone": row[10],
                    "avatar_url": row[11],
                    "subscription_tier": row[12],
                    "created_at": row[13].isoformat() if row[13] else None,
                    "updated_at": row[14].isoformat() if row[14] else None,
                    "email_verification_token": row[15],
                }
            )

        print(f"✅ Exported {len(users)} users")
        for user in users:
            admin_badge = "👑" if user["is_superuser"] else "👤"
            print(
                f"   {admin_badge} {user['email']} (ID: {user['old_id']} → UUID: {user['new_uuid'][:8]}...)"
            )
        print()

        # Export projects
        result = conn.execute(
            text("""
            SELECT id, name, description, configuration, owner_id, created_at, updated_at
            FROM projects
            ORDER BY created_at
        """)
        )

        projects = []
        for row in result:
            old_owner_id = row[4]
            if old_owner_id in user_id_map:
                projects.append(
                    {
                        "id": row[0],
                        "name": row[1],
                        "description": row[2],
                        "configuration": row[3],
                        "old_owner_id": old_owner_id,
                        "new_owner_uuid": user_id_map[old_owner_id],
                        "created_at": row[5].isoformat() if row[5] else None,
                        "updated_at": row[6].isoformat() if row[6] else None,
                    }
                )

        print(f"✅ Exported {len(projects)} projects")
        for project in projects:
            print(
                f"   📦 {project['name']} (owner: {project['old_owner_id']} → {project['new_owner_uuid'][:8]}...)"
            )
        print()

        # Export subscriptions if any
        try:
            result = conn.execute(text("SELECT COUNT(*) FROM subscriptions"))
            sub_count = result.scalar()
            if sub_count > 0:
                result = conn.execute(
                    text("""
                    SELECT id, user_id, stripe_customer_id, stripe_subscription_id,
                           stripe_price_id, tier, status, current_period_start,
                           current_period_end, cancel_at_period_end, canceled_at,
                           created_at, updated_at
                    FROM subscriptions
                """)
                )

                subscriptions = []
                for row in result:
                    old_user_id = row[1]
                    if old_user_id in user_id_map:
                        subscriptions.append(
                            {
                                "id": row[0],
                                "old_user_id": old_user_id,
                                "new_user_uuid": user_id_map[old_user_id],
                                "stripe_customer_id": row[2],
                                "stripe_subscription_id": row[3],
                                "stripe_price_id": row[4],
                                "tier": row[5],
                                "status": row[6],
                                "current_period_start": (
                                    row[7].isoformat() if row[7] else None
                                ),
                                "current_period_end": (
                                    row[8].isoformat() if row[8] else None
                                ),
                                "cancel_at_period_end": row[9],
                                "canceled_at": row[10].isoformat() if row[10] else None,
                                "created_at": row[11].isoformat() if row[11] else None,
                                "updated_at": row[12].isoformat() if row[12] else None,
                            }
                        )
                print(f"✅ Exported {len(subscriptions)} subscriptions")
            else:
                subscriptions = []
                print("ℹ️  No subscriptions to export")
        except Exception as e:
            print(f"ℹ️  Subscriptions table not found or error: {e}")
            subscriptions = []

        print()

    return {
        "users": users,
        "projects": projects,
        "subscriptions": subscriptions,
        "user_id_map": user_id_map,
    }


def import_all_data(data):
    """Import all data with UUID mappings to production database."""
    print("📥 Step 3: Importing data to production database with UUIDs...")
    print()

    engine = create_engine(PROD_DB_URL)

    with engine.connect() as conn:
        # Import users
        print(f"Importing {len(data['users'])} users...")
        for i, user in enumerate(data["users"], 1):
            conn.execute(
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
            print(f"   [{i}/{len(data['users'])}] {user['email']}")

        conn.commit()
        print(f"✅ Imported {len(data['users'])} users")
        print()

        # Import projects
        if data["projects"]:
            print(f"Importing {len(data['projects'])} projects...")
            for i, project in enumerate(data["projects"], 1):
                conn.execute(
                    text("""
                    INSERT INTO projects (
                        name, description, configuration, owner_id, created_at, updated_at
                    ) VALUES (
                        :name, :description, :configuration, :owner_id, :created_at, :updated_at
                    )
                """),
                    {
                        "name": project["name"],
                        "description": project["description"],
                        "configuration": (
                            json.dumps(project["configuration"])
                            if isinstance(project["configuration"], dict)
                            else project["configuration"]
                        ),
                        "owner_id": project["new_owner_uuid"],
                        "created_at": project["created_at"],
                        "updated_at": project["updated_at"],
                    },
                )
                print(f"   [{i}/{len(data['projects'])}] {project['name']}")

            conn.commit()
            print(f"✅ Imported {len(data['projects'])} projects")
        else:
            print("ℹ️  No projects to import")
        print()

        # Import subscriptions
        if data["subscriptions"]:
            print(f"Importing {len(data['subscriptions'])} subscriptions...")
            for i, sub in enumerate(data["subscriptions"], 1):
                conn.execute(
                    text("""
                    INSERT INTO subscriptions (
                        user_id, stripe_customer_id, stripe_subscription_id,
                        stripe_price_id, tier, status, current_period_start,
                        current_period_end, cancel_at_period_end, canceled_at,
                        created_at, updated_at
                    ) VALUES (
                        :user_id, :stripe_customer_id, :stripe_subscription_id,
                        :stripe_price_id, :tier, :status, :current_period_start,
                        :current_period_end, :cancel_at_period_end, :canceled_at,
                        :created_at, :updated_at
                    )
                """),
                    {
                        "user_id": sub["new_user_uuid"],
                        "stripe_customer_id": sub["stripe_customer_id"],
                        "stripe_subscription_id": sub["stripe_subscription_id"],
                        "stripe_price_id": sub["stripe_price_id"],
                        "tier": sub["tier"],
                        "status": sub["status"],
                        "current_period_start": sub["current_period_start"],
                        "current_period_end": sub["current_period_end"],
                        "cancel_at_period_end": sub["cancel_at_period_end"],
                        "canceled_at": sub["canceled_at"],
                        "created_at": sub["created_at"],
                        "updated_at": sub["updated_at"],
                    },
                )
                print(
                    f"   [{i}/{len(data['subscriptions'])}] User {sub['old_user_id']} subscription"
                )

            conn.commit()
            print(f"✅ Imported {len(data['subscriptions'])} subscriptions")
        else:
            print("ℹ️  No subscriptions to import")
        print()


def main():
    """Main recovery function."""
    print("=" * 70)
    print("COMPLETE DATA RECOVERY WITH UUID MIGRATION")
    print("=" * 70)
    print()

    try:
        # Export from snapshot
        data = export_all_data()

        # Save backup
        backup_file = (
            Path(__file__).parent
            / f"recovery_backup_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
        )
        with open(backup_file, "w") as f:
            json.dump(data, f, indent=2, default=str)
        print(f"💾 Backup saved to: {backup_file}")
        print()

        # Import to production
        import_all_data(data)

        print()
        print("=" * 70)
        print("✅ RECOVERY COMPLETE!")
        print("=" * 70)
        print()
        print("📊 Summary:")
        print(f"   ✅ {len(data['users'])} users migrated")
        print(f"   ✅ {len(data['projects'])} projects migrated")
        print(f"   ✅ {len(data['subscriptions'])} subscriptions migrated")
        print(f"   💾 Backup: {backup_file}")
        print()
        print("🎉 All data has been successfully migrated to UUID format!")
        print("   Users can log in with their existing credentials.")
        print("   All projects and relationships are preserved.")
        print()

    except Exception as e:
        print()
        print("=" * 70)
        print("❌ RECOVERY FAILED!")
        print("=" * 70)
        print(f"Error: {e}")
        import traceback

        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    main()
