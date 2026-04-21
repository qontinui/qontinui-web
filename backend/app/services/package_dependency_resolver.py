"""
Package Dependency Resolution Service.

Handles dependency resolution and version compatibility checking for package installations.

Features:
- Resolve package dependencies
- Check version compatibility
- Compare semantic versions
- Check if dependencies are installed
"""

import importlib.metadata
import re
from dataclasses import dataclass

import structlog

from app.schemas.package import DependencyInfo, DependencyResolutionResult

logger = structlog.get_logger(__name__)


# ============================================================================
# Data Classes
# ============================================================================


@dataclass
class VersionComparisonResult:
    """Result of comparing two versions."""

    is_newer: bool
    v1_parts: list[int]
    v2_parts: list[int]


# ============================================================================
# Package Dependency Resolver
# ============================================================================


class PackageDependencyResolver:
    """
    Service for resolving package dependencies and checking version compatibility.

    Responsibilities:
    - Parse and validate version specifications
    - Compare semantic versions
    - Check if dependencies are satisfied
    - Resolve dependency trees
    """

    def resolve_dependencies(
        self, dependencies: list[dict[str, str]]
    ) -> DependencyResolutionResult:
        """
        Resolve package dependencies.

        Parses dependencies list (e.g., [{"name": "requests", "version": ">=2.0"}])
        Checks which are already installed
        Returns missing dependencies

        Args:
            dependencies: List of dependency specifications

        Returns:
            DependencyResolutionResult with required and missing dependencies
        """
        required_deps: list[DependencyInfo] = []
        missing_deps: list[str] = []

        for dep in dependencies:
            name = dep.get("name", "")
            version_spec = dep.get("version", "")

            # Check if dependency is installed
            is_installed, installed_version = self.check_dependency_installed(
                name, version_spec
            )

            dep_info = DependencyInfo(
                name=name,
                version_spec=version_spec,
                is_installed=is_installed,
                installed_version=installed_version,
            )
            required_deps.append(dep_info)

            if not is_installed:
                missing_deps.append(f"{name}{version_spec}")

        return DependencyResolutionResult(
            required_dependencies=required_deps,
            missing_dependencies=missing_deps,
        )

    def check_dependency_installed(
        self, name: str, version_spec: str
    ) -> tuple[bool, str | None]:
        """
        Check if a Python dependency is installed.

        Args:
            name: Package name
            version_spec: Version specification (e.g., ">=2.0.0")

        Returns:
            (is_installed, installed_version)
        """
        # Standard-library modules have no distribution metadata, but they
        # are always available. Treat them as installed (no version).
        import sys

        stdlib_modules: frozenset[str] | set[str] = getattr(
            sys, "stdlib_module_names", frozenset()
        )
        if name in stdlib_modules:
            return True, None

        try:
            installed_version = importlib.metadata.version(name)

            # Simple version check (could be improved with packaging library)
            if self.version_satisfies(installed_version, version_spec):
                return True, installed_version
            else:
                return False, installed_version

        except importlib.metadata.PackageNotFoundError:
            return False, None

    def version_satisfies(self, installed: str, spec: str) -> bool:
        """
        Check if installed version satisfies spec.

        Simple implementation - could use packaging.specifiers for production.

        Args:
            installed: Installed version (e.g., "2.1.0")
            spec: Version spec (e.g., ">=2.0.0")

        Returns:
            True if satisfied
        """
        if not spec:
            return True

        # Extract operator and version
        match = re.match(r"([><=!]+)(.+)", spec)
        if not match:
            return True  # No constraint

        operator, required = match.groups()
        required = required.strip()

        # Simple version comparison (split by dots)
        try:
            installed_parts = [int(x) for x in installed.split(".")]
            required_parts = [int(x) for x in required.split(".")]

            # Pad to same length
            max_len = max(len(installed_parts), len(required_parts))
            installed_parts += [0] * (max_len - len(installed_parts))
            required_parts += [0] * (max_len - len(required_parts))

            if operator == ">=":
                return installed_parts >= required_parts
            elif operator == ">":
                return installed_parts > required_parts
            elif operator == "==":
                return installed_parts == required_parts
            elif operator == "<=":
                return installed_parts <= required_parts
            elif operator == "<":
                return installed_parts < required_parts
            else:
                return True

        except ValueError:
            # If version parsing fails, assume satisfied
            return True

    def is_newer_version(self, v1: str, v2: str) -> bool:
        """
        Check if v1 is newer than v2.

        Args:
            v1: Version 1 (e.g., "2.0.0")
            v2: Version 2 (e.g., "1.5.0")

        Returns:
            True if v1 > v2
        """
        try:
            v1_parts = [int(x) for x in v1.split(".")]
            v2_parts = [int(x) for x in v2.split(".")]

            # Pad to same length
            max_len = max(len(v1_parts), len(v2_parts))
            v1_parts += [0] * (max_len - len(v1_parts))
            v2_parts += [0] * (max_len - len(v2_parts))

            return v1_parts > v2_parts

        except ValueError:
            return False

    def parse_version(self, version_string: str) -> list[int]:
        """
        Parse a version string into integer components.

        Args:
            version_string: Version string (e.g., "2.1.0")

        Returns:
            List of integer version components

        Raises:
            ValueError: If version string is invalid
        """
        return [int(x) for x in version_string.split(".")]

    def compare_versions(self, v1: str, v2: str) -> int:
        """
        Compare two version strings.

        Args:
            v1: First version string
            v2: Second version string

        Returns:
            -1 if v1 < v2, 0 if v1 == v2, 1 if v1 > v2
        """
        try:
            v1_parts = self.parse_version(v1)
            v2_parts = self.parse_version(v2)

            # Pad to same length
            max_len = max(len(v1_parts), len(v2_parts))
            v1_parts += [0] * (max_len - len(v1_parts))
            v2_parts += [0] * (max_len - len(v2_parts))

            if v1_parts < v2_parts:
                return -1
            elif v1_parts > v2_parts:
                return 1
            else:
                return 0

        except ValueError:
            # If parsing fails, treat as equal
            return 0


# Singleton instance for dependency injection
package_dependency_resolver = PackageDependencyResolver()
