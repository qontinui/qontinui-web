"""
Pydantic schemas for code package management.

Provides request/response models for the community marketplace API.
"""

from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.schemas.base import IsoDatetime

# ===== Category Schemas =====


class CategoryBase(BaseModel):
    """Base category schema."""

    name: str = Field(..., min_length=1, max_length=100)
    description: str | None = None
    icon: str | None = None


class CategoryCreate(CategoryBase):
    """Schema for creating a category (admin only)."""

    pass


class CategoryRead(CategoryBase):
    """Schema for reading category data."""

    id: int
    slug: str
    created_at: IsoDatetime

    model_config = ConfigDict(from_attributes=True)


# ===== Package Schemas =====


class PackageBase(BaseModel):
    """Base package schema."""

    name: str = Field(
        ...,
        min_length=3,
        max_length=100,
        description="Package name (lowercase, hyphens allowed)",
    )
    description: str = Field(..., min_length=10, max_length=500)
    long_description: str | None = Field(None, max_length=5000)
    category_id: int | None = None
    license: str | None = Field(None, max_length=50)
    tags: list[str] = Field(default_factory=list, max_length=10)

    @field_validator("tags")
    @classmethod
    def validate_tags(cls, v: list[str]) -> list[str]:
        """Validate tags are lowercase and not empty."""
        if not v:
            return []
        return [tag.lower().strip() for tag in v if tag.strip()]

    @field_validator("name")
    @classmethod
    def validate_name(cls, v: str) -> str:
        """Validate package name format."""
        import re

        if not re.match(r"^[a-z0-9-]+$", v):
            raise ValueError(
                "Package name must be lowercase letters, numbers, and hyphens only"
            )
        return v


class PackageCreate(PackageBase):
    """Schema for creating a new package."""

    pass


class PackageUpdate(BaseModel):
    """Schema for updating package metadata."""

    description: str | None = Field(None, min_length=10, max_length=500)
    long_description: str | None = Field(None, max_length=5000)
    category_id: int | None = None
    license: str | None = Field(None, max_length=50)
    tags: list[str] | None = Field(None, max_length=10)

    @field_validator("tags")
    @classmethod
    def validate_tags(cls, v: list[str] | None) -> list[str] | None:
        """Validate tags are lowercase and not empty."""
        if v is None:
            return None
        return [tag.lower().strip() for tag in v if tag.strip()]


class PackageRead(PackageBase):
    """Schema for reading package data."""

    id: int
    slug: str
    author_id: UUID
    is_verified: bool
    total_downloads: int
    avg_rating: float | None
    created_at: IsoDatetime
    updated_at: IsoDatetime

    # Nested relationships (optional)
    category: CategoryRead | None = None

    model_config = ConfigDict(from_attributes=True)


class PackageDetailRead(PackageRead):
    """Extended package schema with version information."""

    latest_version: "VersionRead | None" = None
    total_versions: int = 0
    total_ratings: int = 0


# ===== Version Schemas =====


class VersionBase(BaseModel):
    """Base version schema."""

    version: str = Field(
        ..., pattern=r"^\d+\.\d+\.\d+$", description="Semantic version (e.g., 1.2.3)"
    )
    code_content: str = Field(..., min_length=10)
    function_name: str = Field(
        ..., min_length=1, max_length=100, description="Main function entry point"
    )
    changelog: str | None = Field(None, max_length=2000)
    dependencies: list[dict[str, str]] = Field(
        default_factory=list,
        description='List of dependencies: [{"name": "requests", "version": ">=2.25.0"}]',
    )
    min_python_version: str | None = Field(None, pattern=r"^\d+\.\d+$")

    @field_validator("version")
    @classmethod
    def validate_version(cls, v: str) -> str:
        """Validate semantic version format."""
        import re

        if not re.match(r"^\d+\.\d+\.\d+$", v):
            raise ValueError("Version must follow semantic versioning (e.g., 1.2.3)")
        return v


class VersionCreate(VersionBase):
    """Schema for publishing a new package version."""

    pass


class VersionRead(VersionBase):
    """Schema for reading version data."""

    id: int
    package_id: int
    security_scan_status: str
    security_scan_result: dict[str, Any] | None = None
    download_count: int
    created_at: IsoDatetime

    model_config = ConfigDict(from_attributes=True)


# ===== Installation Schemas =====


class InstallRequest(BaseModel):
    """Schema for installing a package to a project."""

    package_id: int = Field(..., description="Package ID to install")
    version_id: int | None = Field(
        None, description="Specific version ID (optional, defaults to latest)"
    )


class InstallResponse(BaseModel):
    """Schema for installation response."""

    id: int
    package_id: int
    version_id: int
    project_id: int
    status: str
    installed_at: IsoDatetime
    package_name: str
    package_version: str

    model_config = ConfigDict(from_attributes=True)


class UninstallRequest(BaseModel):
    """Schema for uninstalling a package."""

    package_id: int = Field(..., description="Package ID to uninstall")


# ===== Rating Schemas =====


class RatingBase(BaseModel):
    """Base rating schema."""

    rating: int = Field(..., ge=1, le=5, description="Rating from 1 to 5 stars")
    review_text: str | None = Field(None, max_length=2000)


class RatingCreate(RatingBase):
    """Schema for creating/updating a rating."""

    pass


class RatingRead(RatingBase):
    """Schema for reading rating data."""

    id: int
    package_id: int
    user_id: UUID
    created_at: IsoDatetime
    updated_at: IsoDatetime

    model_config = ConfigDict(from_attributes=True)


class RatingWithUser(RatingRead):
    """Rating with user information."""

    user_email: str
    user_username: str


# ===== Search & List Schemas =====


class PackageSearchFilters(BaseModel):
    """Filters for searching packages."""

    query: str | None = Field(None, min_length=1, max_length=100)
    category: int | None = None
    tags: list[str] | None = None
    verified_only: bool = False
    min_rating: float | None = Field(None, ge=0, le=5)


class PackageSearchResult(BaseModel):
    """Individual search result."""

    id: int
    name: str
    slug: str
    description: str
    author_id: UUID
    category_id: int | None
    category_name: str | None = None
    license: str | None
    tags: list[str]
    is_verified: bool
    total_downloads: int
    avg_rating: float | None
    latest_version: str | None
    created_at: IsoDatetime

    model_config = ConfigDict(from_attributes=True)


class PackageListResponse(BaseModel):
    """Paginated list of packages."""

    packages: list[PackageSearchResult]
    total: int
    limit: int
    offset: int
    has_more: bool


class PopularPackageResponse(BaseModel):
    """Response for popular packages."""

    packages: list[PackageSearchResult]
    period: str  # "day", "week", "month", "all"


class TrendingPackageResponse(BaseModel):
    """Response for trending packages."""

    packages: list[PackageSearchResult]
    period: str  # "day", "week", "month"


# ===== Installation List Schemas =====


class InstalledPackageRead(BaseModel):
    """Schema for reading installed packages in a project."""

    id: int
    package_id: int
    version_id: int
    package_name: str
    package_slug: str
    package_description: str
    version: str
    status: str
    installed_at: IsoDatetime
    updated_at: IsoDatetime

    model_config = ConfigDict(from_attributes=True)


class ProjectPackagesResponse(BaseModel):
    """Response for listing installed packages in a project."""

    packages: list[InstalledPackageRead]
    total: int


# ===== Statistics Schemas =====


class PackageStats(BaseModel):
    """Package statistics."""

    total_packages: int
    total_downloads: int
    total_installations: int
    verified_packages: int
    categories_count: int


class UserPackageStats(BaseModel):
    """User's package statistics."""

    published_packages: int
    total_downloads: int
    total_ratings: int
    average_rating: float | None


# Update forward references
PackageDetailRead.model_rebuild()
