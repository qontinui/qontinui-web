"""
Code Package models for Community Code Library feature.

This module defines models for the marketplace where users can publish,
discover, and install reusable Python code packages for automation workflows.
"""

from datetime import datetime
from enum import Enum

from app.db.base import Base
from sqlalchemy import (
    JSON,
    Boolean,
    CheckConstraint,
    Column,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship


class SecurityScanStatus(str, Enum):
    """Security scan status for package versions"""

    PENDING = "pending"
    SCANNING = "scanning"
    PASSED = "passed"
    FAILED = "failed"
    SKIPPED = "skipped"


class InstallationStatus(str, Enum):
    """Installation status for packages"""

    ACTIVE = "active"
    DISABLED = "disabled"


class PackageCategory(Base):
    """
    Package category model for organizing code packages.

    Categories help users discover packages by grouping them into
    logical areas like "Data Extraction", "Image Processing", etc.
    """

    __tablename__ = "package_categories"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False, unique=True)
    slug = Column(String, nullable=False, unique=True, index=True)
    description = Column(Text, nullable=True)
    icon = Column(String, nullable=True)  # Icon name or emoji
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False
    )

    # Relationships
    packages = relationship(
        "CodePackage", back_populates="category", cascade="all, delete-orphan"
    )

    # Indexes
    __table_args__ = (Index("idx_category_slug", "slug"),)

    def __repr__(self):
        return f"<PackageCategory(id={self.id}, name={self.name}, slug={self.slug})>"


class CodePackage(Base):
    """
    Code package model for published packages in the marketplace.

    Represents a reusable code package that users can install into their
    automation workflows. Tracks metadata, ratings, downloads, and verification status.
    """

    __tablename__ = "code_packages"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False, unique=True, index=True)
    slug = Column(String, nullable=False, unique=True, index=True)
    description = Column(Text, nullable=False)
    long_description = Column(Text, nullable=True)
    author_id = Column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    category_id = Column(
        Integer,
        ForeignKey("package_categories.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    license = Column(String, nullable=True)  # e.g., "MIT", "Apache 2.0", "Proprietary"
    tags = Column(JSON, default=[], nullable=False)  # Array of tag strings
    is_verified = Column(
        Boolean, default=False, nullable=False, index=True
    )  # Official verification badge
    total_downloads = Column(Integer, default=0, nullable=False)
    avg_rating = Column(
        Numeric(3, 2), nullable=True
    )  # Average rating (e.g., 4.53 out of 5)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)
    updated_at = Column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False
    )

    # Relationships
    author = relationship("User", foreign_keys=[author_id], back_populates="packages")
    category = relationship("PackageCategory", back_populates="packages")
    versions = relationship(
        "PackageVersion", back_populates="package", cascade="all, delete-orphan"
    )
    installations = relationship(
        "PackageInstallation", back_populates="package", cascade="all, delete-orphan"
    )
    ratings = relationship(
        "PackageRating", back_populates="package", cascade="all, delete-orphan"
    )

    # Indexes
    __table_args__ = (
        Index("idx_package_name", "name"),
        Index("idx_package_slug", "slug"),
        Index("idx_package_author", "author_id"),
        Index("idx_package_category", "category_id"),
        Index("idx_package_verified", "is_verified"),
        Index("idx_package_created", "created_at"),
    )

    def __repr__(self):
        return (
            f"<CodePackage(id={self.id}, name={self.name}, author_id={self.author_id})>"
        )


class PackageVersion(Base):
    """
    Package version model for tracking version history of packages.

    Each package can have multiple versions with different code content,
    dependencies, and security scan results. Tracks download counts per version.
    """

    __tablename__ = "package_versions"

    id = Column(Integer, primary_key=True, index=True)
    package_id = Column(
        Integer,
        ForeignKey("code_packages.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    version = Column(String, nullable=False)  # e.g., "1.0.0", "2.1.3"
    code_content = Column(Text, nullable=False)  # The actual Python code
    function_name = Column(
        String, nullable=False
    )  # Main entry point function name (e.g., "extract_data")
    changelog = Column(Text, nullable=True)  # What's new in this version
    dependencies = Column(
        JSON, default=[], nullable=False
    )  # Array of dependency objects: [{"name": "requests", "version": ">=2.25.0"}]
    min_python_version = Column(
        String, nullable=True
    )  # e.g., "3.8" - minimum Python version required
    security_scan_status = Column(
        String, default=SecurityScanStatus.PENDING.value, nullable=False, index=True
    )
    security_scan_result = Column(
        JSON, nullable=True
    )  # Detailed scan results (vulnerabilities, warnings)
    download_count = Column(Integer, default=0, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)

    # Relationships
    package = relationship("CodePackage", back_populates="versions")
    installations = relationship(
        "PackageInstallation", back_populates="version", cascade="all, delete-orphan"
    )

    # Constraints and Indexes
    __table_args__ = (
        UniqueConstraint("package_id", "version", name="uq_package_version"),
        Index("idx_version_package", "package_id"),
        Index("idx_version_created", "created_at"),
        Index("idx_version_security", "security_scan_status"),
        CheckConstraint(
            "security_scan_status IN ('pending', 'scanning', 'passed', 'failed', 'skipped')",
            name="chk_security_scan_status",
        ),
    )

    def __repr__(self):
        return f"<PackageVersion(id={self.id}, package_id={self.package_id}, version={self.version})>"


class PackageInstallation(Base):
    """
    Package installation model tracking which packages are installed in projects.

    Records when users install packages into their projects, which version
    they're using, and whether the installation is active or disabled.
    """

    __tablename__ = "package_installations"

    id = Column(Integer, primary_key=True, index=True)
    package_id = Column(
        Integer,
        ForeignKey("code_packages.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    version_id = Column(
        Integer,
        ForeignKey("package_versions.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    project_id = Column(
        UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False
    )
    user_id = Column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    status = Column(
        String, default=InstallationStatus.ACTIVE.value, nullable=False, index=True
    )
    installed_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False
    )

    # Relationships
    package = relationship("CodePackage", back_populates="installations")
    version = relationship("PackageVersion", back_populates="installations")
    project = relationship("Project")
    user = relationship("User")

    # Constraints and Indexes
    __table_args__ = (
        UniqueConstraint("project_id", "package_id", name="uq_project_package"),
        Index("idx_installation_project", "project_id"),
        Index("idx_installation_package", "package_id"),
        Index("idx_installation_version", "version_id"),
        Index("idx_installation_user", "user_id"),
        Index("idx_installation_status", "status"),
        CheckConstraint(
            "status IN ('active', 'disabled')", name="chk_installation_status"
        ),
    )

    def __repr__(self):
        return f"<PackageInstallation(id={self.id}, project_id={self.project_id}, package_id={self.package_id})>"


class PackageRating(Base):
    """
    Package rating model for user reviews and ratings.

    Users can rate packages from 1-5 stars and optionally leave a text review.
    Each user can only rate a package once.
    """

    __tablename__ = "package_ratings"

    id = Column(Integer, primary_key=True, index=True)
    package_id = Column(
        Integer,
        ForeignKey("code_packages.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    user_id = Column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    rating = Column(
        Integer, nullable=False
    )  # Rating from 1-5 stars (enforced by constraint)
    review_text = Column(Text, nullable=True)  # Optional written review
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)
    updated_at = Column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False
    )

    # Relationships
    package = relationship("CodePackage", back_populates="ratings")
    user = relationship("User")

    # Constraints and Indexes
    __table_args__ = (
        UniqueConstraint("package_id", "user_id", name="uq_package_user_rating"),
        Index("idx_rating_package", "package_id"),
        Index("idx_rating_user", "user_id"),
        Index("idx_rating_created", "created_at"),
        CheckConstraint("rating >= 1 AND rating <= 5", name="chk_rating_range"),
    )

    def __repr__(self):
        return f"<PackageRating(id={self.id}, package_id={self.package_id}, user_id={self.user_id}, rating={self.rating})>"
