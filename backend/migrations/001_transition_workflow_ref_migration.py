"""
Migration: Convert transition workflows from string[] to WorkflowReference[]

This script migrates the transition.workflows field from an array of workflow ID strings
to an array of WorkflowReference objects: { type: 'reference', workflowId: string }

Usage:
    python migrations/001_transition_workflow_ref_migration.py

Requirements:
    - Set DATABASE_URL environment variable
    - Run from backend directory
"""

import os
import sys
from typing import Any

# Add parent directory to path to import app modules
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Import all models to ensure relationships are properly configured
from app.models.project import Project
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker


def migrate_workflows_in_transition(transition: dict[str, Any]) -> bool:
    """
    Migrate a single transition's workflows field.

    Args:
        transition: Transition dictionary from configuration

    Returns:
        True if migration was needed and performed, False if already migrated
    """
    workflows = transition.get("workflows", [])

    if not workflows:
        return False

    # Check if already migrated (first item is an object, not a string)
    if isinstance(workflows[0], dict) and "type" in workflows[0]:
        return False  # Already migrated

    # Convert string array to WorkflowReference array
    migrated_workflows = [
        {"type": "reference", "workflowId": workflow_id}
        for workflow_id in workflows
        if isinstance(workflow_id, str)  # Only convert strings, skip malformed data
    ]

    transition["workflows"] = migrated_workflows
    return True


def migrate_project_configuration(config: dict[str, Any]) -> int:
    """
    Migrate all transitions in a project configuration.

    Args:
        config: Project configuration dictionary

    Returns:
        Number of transitions migrated
    """
    transitions = config.get("transitions", [])
    migrated_count = 0

    for transition in transitions:
        if migrate_workflows_in_transition(transition):
            migrated_count += 1

    return migrated_count


def main():
    """Main migration function."""
    # Get database URL from environment
    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        print("ERROR: DATABASE_URL environment variable not set")
        print(
            "Export it with: export DATABASE_URL='postgresql://user:password@localhost/dbname'"
        )
        sys.exit(1)

    # Create database engine
    engine = create_engine(database_url)
    Session = sessionmaker(bind=engine)  # noqa: N806
    session = Session()

    try:
        # Query all projects
        projects = session.query(Project).all()
        print(f"Found {len(projects)} projects in database")

        total_projects_migrated = 0
        total_transitions_migrated = 0

        # Migrate each project
        for project in projects:
            config = project.configuration

            if not config or not isinstance(config, dict):
                print(
                    f"⚠️  Project {project.id} ({project.name}): Invalid configuration, skipping"
                )
                continue

            # Perform migration
            transitions_migrated = migrate_project_configuration(config)

            if transitions_migrated > 0:
                # Update project in database
                project.configuration = config
                session.add(project)
                total_projects_migrated += 1
                total_transitions_migrated += transitions_migrated
                print(
                    f"✅ Project {project.id} ({project.name}): Migrated {transitions_migrated} transition(s)"
                )
            else:
                print(f"⏭️  Project {project.id} ({project.name}): No migration needed")

        # Commit all changes
        if total_projects_migrated > 0:
            session.commit()
            print(f"\n{'='*60}")
            print("✅ Migration complete!")
            print(f"   Projects migrated: {total_projects_migrated}/{len(projects)}")
            print(f"   Transitions migrated: {total_transitions_migrated}")
            print(f"{'='*60}")
        else:
            print("\n✅ No migrations needed - all projects already up to date")

    except Exception as e:
        session.rollback()
        print(f"\n❌ Migration failed: {e}")
        import traceback

        traceback.print_exc()
        sys.exit(1)
    finally:
        session.close()


if __name__ == "__main__":
    main()
