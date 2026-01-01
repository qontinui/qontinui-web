"""
Package Validation Service.

Handles security and compatibility validation for package installations.

Features:
- Security scan status validation
- Disk space checks
- Python version compatibility
- Package size validation
- Package name validation
"""

import re
import shutil
import sys

import structlog

from app.models.code_package import CodePackage, PackageVersion, SecurityScanStatus
from app.schemas.package import SafetyCheckResult
from app.services.project_directory import ProjectDirectoryManager

logger = structlog.get_logger(__name__)


# ============================================================================
# Configuration
# ============================================================================

# Maximum package size (10MB per package)
MAX_PACKAGE_SIZE_BYTES = 10 * 1024 * 1024

# Minimum free disk space required (100MB)
MIN_FREE_DISK_SPACE_BYTES = 100 * 1024 * 1024


# ============================================================================
# Helper Functions
# ============================================================================


def validate_package_name(package: str) -> bool:
    """Validate package name follows PyPI conventions (prevents command injection)."""
    # PEP 508 compatible pattern: package-name[extras]>=version,<other-version
    pattern = r"^[a-zA-Z0-9]([a-zA-Z0-9._-]*[a-zA-Z0-9])?(\[([a-zA-Z0-9._-]+,?)+\])?([<>=!~]+[0-9a-zA-Z.*,<>=!~]+)?$"
    return bool(re.match(pattern, package))


# ============================================================================
# Package Validator Service
# ============================================================================


class PackageValidator:
    """
    Service for validating packages before installation.

    Responsibilities:
    - Validate package names (security)
    - Check security scan status
    - Verify disk space availability
    - Check Python version compatibility
    - Validate package size limits
    """

    def __init__(
        self,
        project_dir_manager: ProjectDirectoryManager | None = None,
        max_package_size: int = MAX_PACKAGE_SIZE_BYTES,
        min_disk_space: int = MIN_FREE_DISK_SPACE_BYTES,
    ):
        """Initialize package validator with configurable limits."""
        self.project_dir_manager = project_dir_manager or ProjectDirectoryManager()
        self.max_package_size = max_package_size
        self.min_disk_space = min_disk_space

    async def run_safety_checks(
        self, project_id: int, package: CodePackage, version: PackageVersion
    ) -> SafetyCheckResult:
        """Run security, disk space, Python version, and package size checks."""
        checks: dict[str, bool] = {}
        errors: list[str] = []
        warnings: list[str] = []

        # Check security scan status
        security_passed = self._check_security_scan(version)
        checks["security_scan"] = security_passed
        if not security_passed:
            scan_status: str = version.security_scan_status  # type: ignore[assignment]
            errors.append(
                f"Package has not passed security scan (status: {scan_status})"
            )

        # Check disk space
        disk_ok, disk_error = self._check_disk_space(project_id)
        checks["disk_space"] = disk_ok
        if not disk_ok and disk_error:
            errors.append(disk_error)

        # Check Python version compatibility
        python_ok, python_error = self._check_python_version(version)
        checks["python_version"] = python_ok
        if not python_ok and python_error:
            errors.append(python_error)

        # Check package size
        size_ok, size_error = self._check_package_size(version)
        checks["package_size"] = size_ok
        if not size_ok and size_error:
            errors.append(size_error)

        passed = all(checks.values())

        return SafetyCheckResult(
            passed=passed, checks=checks, errors=errors, warnings=warnings
        )

    def _check_security_scan(self, version: PackageVersion) -> bool:
        """Check if package version passed security scan."""
        scan_status: str = version.security_scan_status  # type: ignore[assignment]
        return scan_status == SecurityScanStatus.PASSED.value

    def _check_disk_space(self, project_id: int) -> tuple[bool, str | None]:
        """Check if sufficient disk space is available."""
        project_root = self.project_dir_manager.get_project_root(project_id)

        if project_root.exists():
            stat = shutil.disk_usage(project_root)
            has_space = stat.free >= self.min_disk_space

            if not has_space:
                free_mb = stat.free / 1024 / 1024
                required_mb = self.min_disk_space / 1024 / 1024
                return (
                    False,
                    f"Insufficient disk space (free: {free_mb:.1f}MB, required: {required_mb:.1f}MB)",
                )

            return True, None

        # If directory doesn't exist, assume we have space
        return True, None

    def _check_python_version(self, version: PackageVersion) -> tuple[bool, str | None]:
        """Check if current Python version meets minimum requirement."""
        if not version.min_python_version:
            return True, None

        current_python = f"{sys.version_info.major}.{sys.version_info.minor}"
        python_compatible = self._version_satisfies(
            current_python, f">={version.min_python_version}"
        )

        if not python_compatible:
            return (
                False,
                f"Python version incompatible (current: {current_python}, required: >={version.min_python_version})",
            )

        return True, None

    def _check_package_size(self, version: PackageVersion) -> tuple[bool, str | None]:
        """Check if package size is within configured limits."""
        code_content: str = version.code_content  # type: ignore[assignment]
        code_size = len(code_content.encode("utf-8"))
        size_ok = code_size <= self.max_package_size

        if not size_ok:
            size_mb = code_size / 1024 / 1024
            max_mb = self.max_package_size / 1024 / 1024
            return (
                False,
                f"Package too large (size: {size_mb:.1f}MB, max: {max_mb:.1f}MB)",
            )

        return True, None

    def _version_satisfies(self, installed: str, spec: str) -> bool:
        """Check if installed version satisfies version spec (e.g., >=3.10)."""
        if not spec:
            return True

        # Extract operator and version
        match = re.match(r"([><=!]+)(.+)", spec)
        if not match:
            return True

        operator, required = match.groups()
        required = required.strip()

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
            return True

    def validate_package_name(self, package: str) -> bool:
        """Validate package name follows PyPI conventions."""
        return validate_package_name(package)


# Singleton instance for dependency injection
package_validator = PackageValidator()
