"""
Pydantic schemas for package installation service.
"""

from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.base import IsoDatetime

# ============================================================================
# Package Schemas
# ============================================================================


class PackageDependency(BaseModel):
    """Dependency specification."""

    name: str
    version: str  # e.g., ">=2.0.0", "==1.5.3"


class PackageVersionBase(BaseModel):
    """Base schema for package version."""

    version: str
    code_content: str
    function_name: str
    changelog: str | None = None
    dependencies: list[PackageDependency] = Field(default_factory=list)
    min_python_version: str | None = None


class PackageVersionCreate(PackageVersionBase):
    """Schema for creating a new package version."""

    pass


class PackageVersionResponse(PackageVersionBase):
    """Schema for package version response."""

    id: int
    package_id: int
    security_scan_status: str
    security_scan_result: dict[str, Any] | None = None
    download_count: int
    created_at: IsoDatetime

    model_config = ConfigDict(from_attributes=True)


class PackageBase(BaseModel):
    """Base schema for package."""

    name: str
    slug: str
    description: str
    long_description: str | None = None
    license: str | None = None
    tags: list[str] = Field(default_factory=list)


class PackageCreate(PackageBase):
    """Schema for creating a new package."""

    category_id: int | None = None


class PackageResponse(PackageBase):
    """Schema for package response."""

    id: int
    author_id: str
    category_id: int | None = None
    is_verified: bool
    total_downloads: int
    avg_rating: float | None = None
    created_at: IsoDatetime
    updated_at: IsoDatetime

    model_config = ConfigDict(from_attributes=True)


# ============================================================================
# Installation Schemas
# ============================================================================


class InstallResult(BaseModel):
    """Result of package installation."""

    success: bool
    package_id: int
    version_id: int
    installed_path: str
    message: str
    error: str | None = None


class UpdateInfo(BaseModel):
    """Information about available package update."""

    package_id: int
    package_name: str
    current_version: str
    latest_version: str
    changelog: str | None = None


class UpdateResult(BaseModel):
    """Result of package update."""

    success: bool
    package_id: int
    old_version: str
    new_version: str
    message: str
    error: str | None = None


class UninstallResult(BaseModel):
    """Result of package uninstallation."""

    success: bool
    package_id: int
    message: str
    removed_dependencies: list[str] = Field(default_factory=list)
    error: str | None = None


class PackageInstallationResponse(BaseModel):
    """Schema for package installation response."""

    id: int
    package_id: int
    version_id: int
    project_id: int
    user_id: str
    status: str
    installed_at: IsoDatetime
    updated_at: IsoDatetime

    # Related data
    package: PackageResponse | None = None
    version: PackageVersionResponse | None = None

    model_config = ConfigDict(from_attributes=True)


# ============================================================================
# Dependency Management Schemas
# ============================================================================


class DependencyInfo(BaseModel):
    """Information about a dependency."""

    name: str
    version_spec: str  # e.g., ">=2.0.0"
    is_installed: bool
    installed_version: str | None = None


class DependencyResolutionResult(BaseModel):
    """Result of dependency resolution."""

    required_dependencies: list[DependencyInfo]
    missing_dependencies: list[str]
    conflicts: list[str] = Field(default_factory=list)


# ============================================================================
# Security Schemas
# ============================================================================


class SecurityScanResult(BaseModel):
    """Result of security scan."""

    status: str  # "passed", "failed", "pending"
    vulnerabilities: list[dict[str, Any]] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    scanned_at: IsoDatetime | None = None


class SafetyCheckResult(BaseModel):
    """Result of pre-installation safety checks."""

    passed: bool
    checks: dict[str, bool]
    errors: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
