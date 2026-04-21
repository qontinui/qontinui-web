"""
Tests for Package Installer Service.

Tests cover:
- Installation workflow
- Dependency resolution
- Update detection
- Uninstallation cleanup
- Safety checks
"""

from pathlib import Path
from uuid import uuid4

import pytest
import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.code_package import (
    CodePackage,
    InstallationStatus,
    PackageCategory,
    PackageInstallation,
    PackageVersion,
    SecurityScanStatus,
)
from app.models.project import Project
from app.models.user import User
from app.services.package_installer import PackageInstaller
from app.services.project_directory import ProjectDirectoryManager

# ============================================================================
# Fixtures
# ============================================================================


@pytest_asyncio.fixture
async def test_user(async_db_session: AsyncSession) -> User:
    """Create a test user."""
    user = User(
        email=f"testuser_{uuid4()}@example.com",
        username=f"testuser_{uuid4().hex[:8]}",
        full_name="Test User",
        hashed_password="hashed_password",
        is_active=True,
        is_verified=True,
    )
    async_db_session.add(user)
    await async_db_session.commit()
    await async_db_session.refresh(user)
    return user


@pytest_asyncio.fixture
async def test_project(async_db_session: AsyncSession, test_user: User) -> Project:
    """Create a test project."""
    project = Project(
        name="Test Project",
        description="Test project for package installation",
        owner_id=test_user.id,
        configuration={},
    )
    async_db_session.add(project)
    await async_db_session.commit()
    await async_db_session.refresh(project)
    return project


@pytest_asyncio.fixture
async def test_category(async_db_session: AsyncSession) -> PackageCategory:
    """Create a test package category."""
    category = PackageCategory(
        name="Data Processing",
        slug="data-processing",
        description="Data extraction and transformation packages",
    )
    async_db_session.add(category)
    await async_db_session.commit()
    await async_db_session.refresh(category)
    return category


@pytest_asyncio.fixture
async def test_package(
    async_db_session: AsyncSession, test_user: User, test_category: PackageCategory
) -> CodePackage:
    """Create a test package."""
    package = CodePackage(
        name="Email Parser",
        slug="email-parser",
        description="Extract email addresses from text",
        long_description="A comprehensive email parser for automation workflows",
        author_id=test_user.id,
        category_id=test_category.id,
        license="MIT",
        tags=["email", "parsing", "text"],
        is_verified=True,
        total_downloads=0,
    )
    async_db_session.add(package)
    await async_db_session.commit()
    await async_db_session.refresh(package)
    return package


@pytest_asyncio.fixture
async def test_package_version(
    async_db_session: AsyncSession, test_package: CodePackage
) -> PackageVersion:
    """Create a test package version."""
    code_content = '''"""
Email parser package.

Extracts email addresses from text using regex.
"""

import re


def extract_emails(text: str) -> list:
    """
    Extract email addresses from text.

    Args:
        text: Input text to parse

    Returns:
        List of email addresses found
    """
    email_pattern = r'[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}'
    return re.findall(email_pattern, text)
'''

    version = PackageVersion(
        package_id=test_package.id,
        version="1.0.0",
        code_content=code_content,
        function_name="extract_emails",
        changelog="Initial release",
        dependencies=[{"name": "re", "version": ""}],  # Built-in module
        min_python_version="3.8",
        security_scan_status=SecurityScanStatus.PASSED.value,
        download_count=0,
    )
    async_db_session.add(version)
    await async_db_session.commit()
    await async_db_session.refresh(version)
    return version


@pytest_asyncio.fixture
async def package_installer(
    async_db_session: AsyncSession, temp_dir: str
) -> PackageInstaller:
    """Create package installer with temp directory.

    The ``download_service`` in ``PackageInstaller`` has its own internal
    ``ProjectDirectoryManager`` which is where files actually land. We must
    point both at the same temp directory for the tests to see the files.
    """
    from app.services.package_download_service import PackageDownloadService

    project_dir_manager = ProjectDirectoryManager(base_dir=Path(temp_dir))
    download_service = PackageDownloadService(project_dir_manager=project_dir_manager)
    return PackageInstaller(
        db_session=async_db_session,
        project_dir_manager=project_dir_manager,
        download_service=download_service,
    )


# ============================================================================
# Installation Tests
# ============================================================================


@pytest.mark.asyncio
async def test_install_package_success(
    package_installer: PackageInstaller,
    test_project: Project,
    test_package: CodePackage,
    test_package_version: PackageVersion,
    test_user: User,
    async_db_session: AsyncSession,
):
    """Test successful package installation."""
    # Install package
    result = await package_installer.install_package(
        project_id=test_project.id,
        package_id=test_package.id,
        version_id=test_package_version.id,
        user_id=str(test_user.id),
    )

    # Check result
    assert result.success is True
    assert result.package_id == test_package.id
    assert result.version_id == test_package_version.id
    assert result.installed_path == f"packages/{test_package.slug}"
    assert "Successfully installed" in result.message

    # Verify installation record in database
    query = select(PackageInstallation).where(
        PackageInstallation.project_id == test_project.id,
        PackageInstallation.package_id == test_package.id,
    )
    db_result = await async_db_session.execute(query)
    installation = db_result.scalar_one_or_none()

    assert installation is not None
    assert installation.version_id == test_package_version.id
    assert installation.status == InstallationStatus.ACTIVE.value

    # Verify files were created
    project_root = package_installer.project_dir_manager.get_project_root(
        test_project.id
    )
    package_dir = project_root / "packages" / test_package.slug

    assert package_dir.exists()
    assert (package_dir / "__init__.py").exists()
    assert (package_dir / "extract_emails.py").exists()
    assert (package_dir / "README.md").exists()

    # Verify __init__.py exports function
    init_content = (package_dir / "__init__.py").read_text()
    assert "extract_emails" in init_content
    assert test_package_version.version in init_content


@pytest.mark.asyncio
async def test_install_package_already_installed(
    package_installer: PackageInstaller,
    test_project: Project,
    test_package: CodePackage,
    test_package_version: PackageVersion,
    test_user: User,
):
    """Test installing a package that's already installed."""
    # Install package first time
    await package_installer.install_package(
        project_id=test_project.id,
        package_id=test_package.id,
        version_id=test_package_version.id,
        user_id=str(test_user.id),
    )

    # Try to install again
    result = await package_installer.install_package(
        project_id=test_project.id,
        package_id=test_package.id,
        version_id=test_package_version.id,
        user_id=str(test_user.id),
    )

    assert result.success is False
    assert result.error == "ALREADY_INSTALLED"
    assert "already installed" in result.message.lower()


@pytest.mark.asyncio
async def test_install_package_security_scan_failed(
    package_installer: PackageInstaller,
    test_project: Project,
    test_package: CodePackage,
    test_user: User,
    async_db_session: AsyncSession,
):
    """Test installing a package that failed security scan."""
    # Create version with failed security scan
    version = PackageVersion(
        package_id=test_package.id,
        version="2.0.0",
        code_content="def test(): pass",
        function_name="test",
        security_scan_status=SecurityScanStatus.FAILED.value,
    )
    async_db_session.add(version)
    await async_db_session.commit()
    await async_db_session.refresh(version)

    # Try to install
    result = await package_installer.install_package(
        project_id=test_project.id,
        package_id=test_package.id,
        version_id=version.id,
        user_id=str(test_user.id),
    )

    assert result.success is False
    assert result.error == "SAFETY_CHECK_FAILED"
    assert "security scan" in result.message.lower()


@pytest.mark.asyncio
async def test_install_package_not_found(
    package_installer: PackageInstaller,
    test_project: Project,
    test_user: User,
):
    """Test installing a non-existent package."""
    result = await package_installer.install_package(
        project_id=test_project.id,
        package_id=99999,  # Non-existent
        version_id=99999,
        user_id=str(test_user.id),
    )

    assert result.success is False
    assert result.error == "PACKAGE_NOT_FOUND"


# ============================================================================
# Dependency Resolution Tests
# ============================================================================


@pytest.mark.asyncio
async def test_resolve_dependencies_all_installed(
    package_installer: PackageInstaller,
):
    """Test dependency resolution when all dependencies are installed."""
    dependencies = [
        {"name": "json", "version": ""},  # Built-in
        {"name": "re", "version": ""},  # Built-in
    ]

    result = await package_installer.resolve_dependencies(dependencies)

    assert len(result.required_dependencies) == 2
    assert len(result.missing_dependencies) == 0


@pytest.mark.asyncio
async def test_resolve_dependencies_some_missing(
    package_installer: PackageInstaller,
):
    """Test dependency resolution with missing dependencies."""
    dependencies = [
        {"name": "json", "version": ""},  # Built-in
        {"name": "nonexistent_package_xyz", "version": ">=1.0.0"},  # Not installed
    ]

    result = await package_installer.resolve_dependencies(dependencies)

    assert len(result.required_dependencies) == 2
    assert len(result.missing_dependencies) == 1
    assert "nonexistent_package_xyz" in result.missing_dependencies[0]


# ============================================================================
# Update Tests
# ============================================================================


@pytest.mark.asyncio
async def test_check_updates_available(
    package_installer: PackageInstaller,
    test_project: Project,
    test_package: CodePackage,
    test_package_version: PackageVersion,
    test_user: User,
    async_db_session: AsyncSession,
):
    """Test checking for available updates."""
    # Install version 1.0.0
    await package_installer.install_package(
        project_id=test_project.id,
        package_id=test_package.id,
        version_id=test_package_version.id,
        user_id=str(test_user.id),
    )

    # Create newer version 2.0.0
    newer_version = PackageVersion(
        package_id=test_package.id,
        version="2.0.0",
        code_content="def new_feature(): pass",
        function_name="new_feature",
        changelog="Added new features",
        security_scan_status=SecurityScanStatus.PASSED.value,
    )
    async_db_session.add(newer_version)
    await async_db_session.commit()

    # Check for updates
    updates = await package_installer.check_updates(test_project.id)

    assert len(updates) == 1
    assert updates[0].package_id == test_package.id
    assert updates[0].current_version == "1.0.0"
    assert updates[0].latest_version == "2.0.0"
    assert updates[0].package_name == test_package.name


@pytest.mark.asyncio
async def test_check_updates_none_available(
    package_installer: PackageInstaller,
    test_project: Project,
    test_package: CodePackage,
    test_package_version: PackageVersion,
    test_user: User,
):
    """Test checking for updates when already on latest version."""
    # Install latest version
    await package_installer.install_package(
        project_id=test_project.id,
        package_id=test_package.id,
        version_id=test_package_version.id,
        user_id=str(test_user.id),
    )

    # Check for updates
    updates = await package_installer.check_updates(test_project.id)

    assert len(updates) == 0


@pytest.mark.asyncio
async def test_update_package_success(
    package_installer: PackageInstaller,
    test_project: Project,
    test_package: CodePackage,
    test_package_version: PackageVersion,
    test_user: User,
    async_db_session: AsyncSession,
):
    """Test successful package update."""
    # Install version 1.0.0
    await package_installer.install_package(
        project_id=test_project.id,
        package_id=test_package.id,
        version_id=test_package_version.id,
        user_id=str(test_user.id),
    )

    # Create newer version 2.0.0
    newer_version = PackageVersion(
        package_id=test_package.id,
        version="2.0.0",
        code_content="def updated_function(): pass",
        function_name="updated_function",
        changelog="Updated implementation",
        security_scan_status=SecurityScanStatus.PASSED.value,
    )
    async_db_session.add(newer_version)
    await async_db_session.commit()
    await async_db_session.refresh(newer_version)

    # Update package
    result = await package_installer.update_package(
        project_id=test_project.id,
        package_id=test_package.id,
        user_id=str(test_user.id),
    )

    assert result.success is True
    assert result.old_version == "1.0.0"
    assert result.new_version == "2.0.0"
    assert "Updated from" in result.message


@pytest.mark.asyncio
async def test_update_package_not_installed(
    package_installer: PackageInstaller,
    test_project: Project,
    test_package: CodePackage,
    test_user: User,
):
    """Test updating a package that's not installed."""
    result = await package_installer.update_package(
        project_id=test_project.id,
        package_id=test_package.id,
        user_id=str(test_user.id),
    )

    assert result.success is False
    assert result.error == "NOT_INSTALLED"


# ============================================================================
# Uninstallation Tests
# ============================================================================


@pytest.mark.asyncio
async def test_uninstall_package_success(
    package_installer: PackageInstaller,
    test_project: Project,
    test_package: CodePackage,
    test_package_version: PackageVersion,
    test_user: User,
    async_db_session: AsyncSession,
):
    """Test successful package uninstallation."""
    # Install package
    await package_installer.install_package(
        project_id=test_project.id,
        package_id=test_package.id,
        version_id=test_package_version.id,
        user_id=str(test_user.id),
    )

    # Verify it's installed
    project_root = package_installer.project_dir_manager.get_project_root(
        test_project.id
    )
    package_dir = project_root / "packages" / test_package.slug
    assert package_dir.exists()

    # Uninstall
    result = await package_installer.uninstall_package(
        project_id=test_project.id, package_id=test_package.id
    )

    assert result.success is True
    assert "Successfully uninstalled" in result.message

    # Verify directory removed
    assert not package_dir.exists()

    # Verify installation status updated
    query = select(PackageInstallation).where(
        PackageInstallation.project_id == test_project.id,
        PackageInstallation.package_id == test_package.id,
    )
    db_result = await async_db_session.execute(query)
    installation = db_result.scalar_one_or_none()

    assert installation is not None
    assert installation.status == InstallationStatus.DISABLED.value


@pytest.mark.asyncio
async def test_uninstall_package_not_installed(
    package_installer: PackageInstaller,
    test_project: Project,
    test_package: CodePackage,
):
    """Test uninstalling a package that's not installed."""
    result = await package_installer.uninstall_package(
        project_id=test_project.id, package_id=test_package.id
    )

    assert result.success is False
    assert result.error == "NOT_INSTALLED"


# ============================================================================
# Version Comparison Tests
# ============================================================================


def test_version_comparison():
    """Test version comparison logic (delegated to dependency resolver)."""
    from app.services.package_dependency_resolver import (
        package_dependency_resolver as resolver,
    )

    # Test newer versions
    assert resolver.is_newer_version("2.0.0", "1.0.0") is True
    assert resolver.is_newer_version("1.1.0", "1.0.0") is True
    assert resolver.is_newer_version("1.0.1", "1.0.0") is True

    # Test same versions
    assert resolver.is_newer_version("1.0.0", "1.0.0") is False

    # Test older versions
    assert resolver.is_newer_version("1.0.0", "2.0.0") is False


def test_version_satisfies():
    """Test version satisfaction logic (delegated to dependency resolver)."""
    from app.services.package_dependency_resolver import (
        package_dependency_resolver as resolver,
    )

    # Test >= operator
    assert resolver.version_satisfies("2.1.0", ">=2.0.0") is True
    assert resolver.version_satisfies("2.0.0", ">=2.0.0") is True
    assert resolver.version_satisfies("1.9.0", ">=2.0.0") is False

    # Test == operator
    assert resolver.version_satisfies("2.0.0", "==2.0.0") is True
    assert resolver.version_satisfies("2.0.1", "==2.0.0") is False

    # Test > operator
    assert resolver.version_satisfies("2.1.0", ">2.0.0") is True
    assert resolver.version_satisfies("2.0.0", ">2.0.0") is False


# ============================================================================
# Integration Tests
# ============================================================================


@pytest.mark.asyncio
async def test_complete_package_lifecycle(
    package_installer: PackageInstaller,
    test_project: Project,
    test_package: CodePackage,
    test_package_version: PackageVersion,
    test_user: User,
    async_db_session: AsyncSession,
):
    """Test complete package lifecycle: install -> update -> uninstall."""
    # 1. Install package
    install_result = await package_installer.install_package(
        project_id=test_project.id,
        package_id=test_package.id,
        version_id=test_package_version.id,
        user_id=str(test_user.id),
    )
    assert install_result.success is True

    # 2. Create and install update
    newer_version = PackageVersion(
        package_id=test_package.id,
        version="2.0.0",
        code_content="def v2_function(): pass",
        function_name="v2_function",
        security_scan_status=SecurityScanStatus.PASSED.value,
    )
    async_db_session.add(newer_version)
    await async_db_session.commit()

    update_result = await package_installer.update_package(
        project_id=test_project.id,
        package_id=test_package.id,
        user_id=str(test_user.id),
    )
    assert update_result.success is True
    assert update_result.new_version == "2.0.0"

    # 3. Uninstall package
    uninstall_result = await package_installer.uninstall_package(
        project_id=test_project.id, package_id=test_package.id
    )
    assert uninstall_result.success is True

    # Verify clean state
    project_root = package_installer.project_dir_manager.get_project_root(
        test_project.id
    )
    package_dir = project_root / "packages" / test_package.slug
    assert not package_dir.exists()
