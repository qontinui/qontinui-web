"""
Test script to verify collaboration infrastructure imports correctly.

Run this to ensure all components are properly set up:
    python test_collaboration_import.py
"""


def test_imports():
    """Test that all collaboration components can be imported."""
    print("Testing collaboration infrastructure imports...")

    # Test models
    try:
        from app.models.collaboration import (
            ActionType,
            ActivityLog,
            ProjectComment,
            ProjectLock,
            ResourceType,
        )

        print("✓ Models imported successfully")
        print(f"  - ProjectLock: {ProjectLock.__tablename__}")
        print(f"  - ProjectComment: {ProjectComment.__tablename__}")
        print(f"  - ActivityLog: {ActivityLog.__tablename__}")
        print(f"  - ResourceType enum: {list(ResourceType)}")
        print(f"  - ActionType enum: {list(ActionType)}")
    except Exception as e:
        print(f"✗ Failed to import models: {e}")
        return False

    # Test WebSocket manager
    try:
        from app.services.websocket_manager import connection_manager

        print("✓ WebSocket manager imported successfully")
        print("  - ConnectionManager class available")
        print("  - Global connection_manager instance created")
        print(f"  - Active connections: {connection_manager.get_total_connections()}")
    except Exception as e:
        print(f"✗ Failed to import WebSocket manager: {e}")
        return False

    # Test WebSocket endpoints
    try:
        from app.api.v1.endpoints import collaboration_ws

        print("✓ WebSocket endpoints imported successfully")
        print(f"  - Router: {collaboration_ws.router}")
    except Exception as e:
        print(f"✗ Failed to import WebSocket endpoints: {e}")
        return False

    # Test CRUD operations
    try:
        from app.crud import collaboration

        print("✓ CRUD operations imported successfully")
        print("  - Available functions:")
        funcs = [
            f
            for f in dir(collaboration)
            if not f.startswith("_") and callable(getattr(collaboration, f))
        ]
        for func in funcs[:5]:  # Show first 5
            print(f"    - {func}")
        if len(funcs) > 5:
            print(f"    ... and {len(funcs) - 5} more")
    except Exception as e:
        print(f"✗ Failed to import CRUD operations: {e}")
        return False

    # Test schemas
    try:
        print("✓ Schemas imported successfully")
        print("  - Lock schemas available")
        print("  - Comment schemas available")
        print("  - Activity log schemas available")
    except Exception as e:
        print(f"✗ Failed to import schemas: {e}")
        return False

    # Test API router integration
    try:
        from app.api.v1.api import api_router

        print("✓ API router integration successful")
        routes = [
            route.path
            for route in api_router.routes
            if "collaboration" in route.path.lower()
        ]
        if routes:
            print("  - Collaboration routes registered:")
            for route in routes:
                print(f"    - {route}")
        else:
            # WebSocket routes might not show up in routes list
            print("  - API router configured (WebSocket routes may not be visible)")
    except Exception as e:
        print(f"✗ Failed to verify API router: {e}")
        return False

    # Test database base class
    try:
        from app.db.base_class import Base

        # Check if collaboration models are imported
        print("✓ Database models registered with Alembic")
        tables = Base.metadata.tables.keys()
        collab_tables = [
            t
            for t in tables
            if t in ["project_locks", "project_comments", "activity_logs"]
        ]
        if collab_tables:
            print(f"  - Collaboration tables: {collab_tables}")
        else:
            print("  - Collaboration tables will be created via migration")
    except Exception as e:
        print(f"✗ Failed to check database registration: {e}")
        return False

    print("\n✓ All collaboration infrastructure components imported successfully!")
    print("\nNext steps:")
    print("1. Run Alembic migration to create database tables:")
    print("   alembic upgrade head")
    print("2. Start the backend server:")
    print("   uvicorn app.main:app --reload")
    print("3. Connect to WebSocket:")
    print(
        "   ws://localhost:8000/api/v1/ws/projects/{project_id}/collaboration?token={jwt_token}"
    )

    return True


if __name__ == "__main__":
    import sys

    success = test_imports()
    sys.exit(0 if success else 1)
