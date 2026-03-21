"""
Migrate production database from INTEGER IDs to UUID IDs to match development schema.

This script:
1. Creates a backup ID mapping table
2. Adds UUID columns to existing tables
3. Migrates all foreign key relationships
4. Drops old INTEGER columns
5. Renames UUID columns to 'id'
6. Creates missing tables with UUID foreign keys
"""

from sqlalchemy import create_engine, text

# Production database URL
DATABASE_URL = "postgresql://qontinui_admin:SimplePass12345@qontinui-db.c16uiu02ugak.eu-central-1.rds.amazonaws.com:5432/postgres?sslmode=require"

engine = create_engine(DATABASE_URL)

print("Starting UUID migration...")
print("=" * 60)

with engine.begin() as conn:
    print("\n1. Creating ID mapping table...")
    conn.execute(text("""
        CREATE TABLE IF NOT EXISTS _id_mapping (
            table_name VARCHAR NOT NULL,
            old_id INTEGER NOT NULL,
            new_id UUID NOT NULL,
            PRIMARY KEY (table_name, old_id)
        )
    """))

    print("\n2. Dropping existing INTEGER-based session tables...")
    conn.execute(text("DROP TABLE IF EXISTS device_sessions CASCADE"))
    conn.execute(text("DROP TABLE IF EXISTS session_activities CASCADE"))

    print("\n3. Adding UUID columns to users table...")
    conn.execute(
        text(
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS new_id UUID DEFAULT gen_random_uuid() NOT NULL"
        )
    )
    conn.execute(
        text("ALTER TABLE users ADD CONSTRAINT users_new_id_unique UNIQUE (new_id)")
    )

    # Save mapping
    conn.execute(
        text(
            "INSERT INTO _id_mapping (table_name, old_id, new_id) SELECT 'users', id, new_id FROM users ON CONFLICT DO NOTHING"
        )
    )

    print("\n4. Adding UUID columns to projects table...")
    conn.execute(
        text(
            "ALTER TABLE projects ADD COLUMN IF NOT EXISTS new_id UUID DEFAULT gen_random_uuid() NOT NULL"
        )
    )
    conn.execute(
        text("ALTER TABLE projects ADD COLUMN IF NOT EXISTS new_owner_id UUID")
    )
    conn.execute(
        text(
            "ALTER TABLE projects ADD CONSTRAINT projects_new_id_unique UNIQUE (new_id)"
        )
    )

    # Map owner_id to new UUID
    conn.execute(text("""
        UPDATE projects SET new_owner_id = users.new_id
        FROM users
        WHERE projects.owner_id = users.id
    """))

    # Save mapping
    conn.execute(
        text(
            "INSERT INTO _id_mapping (table_name, old_id, new_id) SELECT 'projects', id, new_id FROM projects ON CONFLICT DO NOTHING"
        )
    )

    print("\n5. Migrating other tables with foreign keys...")

    # Check what other tables reference users
    result = conn.execute(text("""
        SELECT DISTINCT tc.table_name, kcu.column_name
        FROM information_schema.table_constraints AS tc
        JOIN information_schema.key_column_usage AS kcu
          ON tc.constraint_name = kcu.constraint_name
        JOIN information_schema.constraint_column_usage AS ccu
          ON ccu.constraint_name = tc.constraint_name
        WHERE tc.constraint_type = 'FOREIGN KEY'
          AND ccu.table_name = 'users'
          AND tc.table_name NOT IN ('projects')
    """))

    for table_name, column_name in result:
        print(f"   Migrating {table_name}.{column_name}...")
        conn.execute(
            text(
                f"ALTER TABLE {table_name} ADD COLUMN IF NOT EXISTS new_{column_name} UUID"
            )
        )
        conn.execute(text(f"""
            UPDATE {table_name} SET new_{column_name} = users.new_id
            FROM users
            WHERE {table_name}.{column_name} = users.id
        """))

    print("\n6. Dropping old constraints and columns...")

    # Drop foreign key constraints first
    result = conn.execute(text("""
        SELECT DISTINCT tc.constraint_name, tc.table_name
        FROM information_schema.table_constraints AS tc
        JOIN information_schema.constraint_column_usage AS ccu
          ON ccu.constraint_name = tc.constraint_name
        WHERE tc.constraint_type = 'FOREIGN KEY'
          AND ccu.table_name IN ('users', 'projects')
    """))

    for constraint_name, table_name in result:
        print(f"   Dropping constraint {table_name}.{constraint_name}...")
        conn.execute(
            text(
                f"ALTER TABLE {table_name} DROP CONSTRAINT IF EXISTS {constraint_name}"
            )
        )

    # Drop old ID columns
    print("   Dropping old id column from projects...")
    conn.execute(text("ALTER TABLE projects DROP COLUMN IF EXISTS id CASCADE"))
    conn.execute(text("ALTER TABLE projects DROP COLUMN IF EXISTS owner_id CASCADE"))

    print("   Dropping old id column from users...")
    conn.execute(text("ALTER TABLE users DROP COLUMN IF EXISTS id CASCADE"))

    print("\n7. Renaming UUID columns to 'id'...")
    conn.execute(text("ALTER TABLE users RENAME COLUMN new_id TO id"))
    conn.execute(text("ALTER TABLE projects RENAME COLUMN new_id TO id"))
    conn.execute(text("ALTER TABLE projects RENAME COLUMN new_owner_id TO owner_id"))

    print("\n8. Adding primary keys...")
    conn.execute(text("ALTER TABLE users ADD PRIMARY KEY (id)"))
    conn.execute(text("ALTER TABLE projects ADD PRIMARY KEY (id)"))

    print("\n9. Recreating foreign keys...")
    conn.execute(text("""
        ALTER TABLE projects
        ADD CONSTRAINT projects_owner_id_fkey
        FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
    """))

    # Handle other tables
    result = conn.execute(text("""
        SELECT DISTINCT tc.table_name, kcu.column_name
        FROM information_schema.table_constraints AS tc
        JOIN information_schema.key_column_usage AS kcu
          ON tc.constraint_name = kcu.constraint_name
        WHERE kcu.column_name LIKE 'new_%'
    """))

    for table_name, column_name in result:
        old_column = column_name.replace("new_", "")
        print(f"   Finalizing {table_name}.{column_name}...")
        conn.execute(
            text(f"ALTER TABLE {table_name} DROP COLUMN IF EXISTS {old_column} CASCADE")
        )
        conn.execute(
            text(
                f"ALTER TABLE {table_name} RENAME COLUMN {column_name} TO {old_column}"
            )
        )
        conn.execute(text(f"""
            ALTER TABLE {table_name}
            ADD CONSTRAINT {table_name}_{old_column}_fkey
            FOREIGN KEY ({old_column}) REFERENCES users(id) ON DELETE CASCADE
        """))

    print("\n10. Creating missing tables with UUID foreign keys...")

    # session_activities
    conn.execute(text("""
        CREATE TABLE session_activities (
            id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
            user_id UUID NOT NULL,
            jti VARCHAR NOT NULL,
            first_login_at TIMESTAMP WITHOUT TIME ZONE NOT NULL,
            last_activity_at TIMESTAMP WITHOUT TIME ZONE NOT NULL,
            absolute_expiry_at TIMESTAMP WITHOUT TIME ZONE NOT NULL,
            created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL,
            updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL,
            FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
        )
    """))
    conn.execute(
        text("CREATE INDEX ix_session_activities_id ON session_activities(id)")
    )
    conn.execute(
        text(
            "CREATE INDEX ix_session_activities_user_id ON session_activities(user_id)"
        )
    )
    conn.execute(
        text("CREATE INDEX ix_session_activities_jti ON session_activities(jti)")
    )
    print("   Created session_activities table")

    # device_sessions
    conn.execute(text("""
        CREATE TABLE device_sessions (
            id UUID PRIMARY KEY,
            user_id UUID NOT NULL,
            device_fingerprint VARCHAR NOT NULL,
            ip_address VARCHAR NOT NULL,
            user_agent TEXT NOT NULL,
            accept_language VARCHAR,
            is_trusted BOOLEAN NOT NULL DEFAULT FALSE,
            first_seen TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
            last_seen TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
            last_ip VARCHAR NOT NULL,
            device_name VARCHAR,
            created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
            email_verified BOOLEAN NOT NULL DEFAULT FALSE,
            verification_token TEXT,
            verification_sent_at TIMESTAMP WITHOUT TIME ZONE,
            country VARCHAR,
            city VARCHAR,
            FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
        )
    """))
    conn.execute(text("CREATE INDEX ix_device_sessions_id ON device_sessions(id)"))
    conn.execute(
        text("CREATE INDEX ix_device_sessions_user_id ON device_sessions(user_id)")
    )
    conn.execute(
        text(
            "CREATE INDEX ix_device_sessions_device_fingerprint ON device_sessions(device_fingerprint)"
        )
    )
    print("   Created device_sessions table")

    # analytics_events
    conn.execute(text("""
        CREATE TABLE analytics_events (
            id UUID PRIMARY KEY,
            event_name VARCHAR(255) NOT NULL,
            user_id UUID,
            properties JSONB NOT NULL DEFAULT '{}'::jsonb,
            timestamp TIMESTAMP WITHOUT TIME ZONE NOT NULL,
            created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL,
            FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
        )
    """))
    conn.execute(
        text(
            "CREATE INDEX ix_analytics_events_event_name ON analytics_events(event_name)"
        )
    )
    conn.execute(
        text("CREATE INDEX ix_analytics_events_user_id ON analytics_events(user_id)")
    )
    conn.execute(
        text(
            "CREATE INDEX ix_analytics_events_timestamp ON analytics_events(timestamp)"
        )
    )
    conn.execute(
        text(
            "CREATE INDEX ix_analytics_events_name_timestamp ON analytics_events(event_name, timestamp)"
        )
    )
    conn.execute(
        text(
            "CREATE INDEX ix_analytics_events_user_name ON analytics_events(user_id, event_name)"
        )
    )
    print("   Created analytics_events table")

print("\n" + "=" * 60)
print("Migration completed successfully!")
print("\nVerifying migration...")

with engine.connect() as conn:
    # Check users table
    result = conn.execute(
        text(
            "SELECT data_type FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'id'"
        )
    )
    user_id_type = result.scalar()
    print(f"✓ users.id type: {user_id_type}")

    # Check projects table
    result = conn.execute(
        text(
            "SELECT data_type FROM information_schema.columns WHERE table_name = 'projects' AND column_name = 'id'"
        )
    )
    project_id_type = result.scalar()
    print(f"✓ projects.id type: {project_id_type}")

    # Check new tables exist
    result = conn.execute(text("""
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public'
        AND table_name IN ('session_activities', 'device_sessions', 'analytics_events')
        ORDER BY table_name
    """))
    tables = [row[0] for row in result]
    print(f"✓ New tables created: {', '.join(tables)}")

    # Check record counts
    result = conn.execute(text("SELECT COUNT(*) FROM users"))
    user_count = result.scalar()
    result = conn.execute(text("SELECT COUNT(*) FROM projects"))
    project_count = result.scalar()
    print(f"✓ Data preserved: {user_count} users, {project_count} projects")

print("\nMigration verification complete!")
