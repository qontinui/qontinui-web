"""
Pydantic schemas for package installation service.
"""

from datetime import datetime
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, ConfigDict, Field

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
    changelog: Optional[str] = None
    dependencies: List[PackageDependency] = Field(default_factory=list)
    min_python_version: Optional[str] = None


class PackageVersionCreate(PackageVersionBase):
    """Schema for creating a new package version."""

    pass


class PackageVersionResponse(PackageVersionBase):
    """Schema for package version response."""

    id: int
    package_id: int
    security_scan_status: str
    security_scan_result: Optional[Dict[str, Any]] = None
    download_count: int
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class PackageBase(BaseModel):
    """Base schema for package."""

    name: str
    slug: str
    description: str
    long_description: Optional[str] = None
    license: Optional[str] = None
    tags: List[str] = Field(default_factory=list)


class PackageCreate(PackageBase):
    """Schema for creating a new package."""

    category_id: Optional[int] = None


class PackageResponse(PackageBase):
    """Schema for package response."""

    id: int
    author_id: str
    category_id: Optional[int] = None
    is_verified: bool
    total_downloads: int
    avg_rating: Optional[float] = None
    created_at: datetime
    updated_at: datetime

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
    error: Optional[str] = None


class UpdateInfo(BaseModel):
    """Information about available package update."""

    package_id: int
    package_name: str
    current_version: str
    latest_version: str
    changelog: Optional[str] = None


class UpdateResult(BaseModel):
    """Result of package update."""

    success: bool
    package_id: int
    old_version: str
    new_version: str
    message: str
    error: Optional[str] = None


class UninstallResult(BaseModel):
    """Result of package uninstallation."""

    success: bool
    package_id: int
    message: str
    removed_dependencies: List[str] = Field(default_factory=list)
    error: Optional[str] = None


class PackageInstallationResponse(BaseModel):
    """Schema for package installation response."""

    id: int
    package_id: int
    version_id: int
    project_id: int
    user_id: str
    status: str
    installed_at: datetime
    updated_at: datetime

    # Related data
    package: Optional[PackageResponse] = None
    version: Optional[PackageVersionResponse] = None

    model_config = ConfigDict(from_attributes=True)


# ============================================================================
# Dependency Management Schemas
# ============================================================================


class DependencyInfo(BaseModel):
    """Information about a dependency."""

    name: str
    version_spec: str  # e.g., ">=2.0.0"
    is_installed: bool
    installed_version: Optional[str] = None


class DependencyResolutionResult(BaseModel):
    """Result of dependency resolution."""

    required_dependencies: List[DependencyInfo]
    missing_dependencies: List[str]
    conflicts: List[str] = Field(default_factory=list)


# ============================================================================
# Security Schemas
# ============================================================================


class SecurityScanResult(BaseModel):
    """Result of security scan."""

    status: str  # "passed", "failed", "pending"
    vulnerabilities: List[Dict[str, Any]] = Field(default_factory=list)
    warnings: List[str] = Field(default_factory=list)
    scanned_at: Optional[datetime] = None


class SafetyCheckResult(BaseModel):
    """Result of pre-installation safety checks."""

    passed: bool
    checks: Dict[str, bool]
    errors: List[str] = Field(default_factory=list)
    warnings: List[str] = Field(default_factory=list)
