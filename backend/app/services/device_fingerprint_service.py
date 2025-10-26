"""
Device fingerprinting service for advanced security.

Generates device fingerprints from request headers to detect suspicious login attempts
and help prevent token theft.
"""

import hashlib

from fastapi import Request


class DeviceFingerprintService:
    """
    Service for generating and managing device fingerprints.

    A device fingerprint is a hash of various device characteristics that helps
    identify unique devices without storing sensitive data.
    """

    @staticmethod
    def extract_device_info(request: Request) -> dict[str, str]:
        """
        Extract device information from request headers.

        Args:
            request: FastAPI request object

        Returns:
            Dictionary containing device information
        """
        # Get IP address (handle proxy headers)
        ip_address = (
            request.headers.get("X-Forwarded-For", "").split(",")[0].strip()
            or request.headers.get("X-Real-IP", "")
            or request.client.host
            if request.client
            else "unknown"
        )

        # Get User-Agent
        user_agent = request.headers.get("User-Agent", "unknown")

        # Get Accept-Language
        accept_language = request.headers.get("Accept-Language", "")

        return {
            "ip_address": ip_address,
            "user_agent": user_agent,
            "accept_language": accept_language,
        }

    @staticmethod
    def generate_fingerprint(
        user_agent: str,
        accept_language: str,
        ip_address: str | None = None,
    ) -> str:
        """
        Generate a device fingerprint hash.

        Note: IP address is optional in fingerprint generation because it can change
        (e.g., mobile devices switching networks). We store it separately for
        additional verification but don't include it in the core fingerprint.

        Args:
            user_agent: User-Agent header
            accept_language: Accept-Language header
            ip_address: IP address (optional, not included in hash)

        Returns:
            Hex string representing the device fingerprint
        """
        # Normalize inputs
        user_agent = user_agent.strip().lower()
        accept_language = accept_language.strip().lower()

        # Create fingerprint from stable device characteristics
        # Note: We exclude IP because it can change legitimately
        fingerprint_data = f"{user_agent}|{accept_language}"

        # Generate SHA-256 hash
        fingerprint_hash = hashlib.sha256(fingerprint_data.encode()).hexdigest()

        return fingerprint_hash

    @staticmethod
    def generate_fingerprint_from_request(
        request: Request,
    ) -> tuple[str, dict[str, str]]:
        """
        Generate device fingerprint from FastAPI request.

        Args:
            request: FastAPI request object

        Returns:
            Tuple of (fingerprint_hash, device_info_dict)
        """
        device_info = DeviceFingerprintService.extract_device_info(request)

        fingerprint = DeviceFingerprintService.generate_fingerprint(
            user_agent=device_info["user_agent"],
            accept_language=device_info["accept_language"],
            ip_address=device_info["ip_address"],
        )

        return fingerprint, device_info

    @staticmethod
    def compare_fingerprints(fingerprint1: str, fingerprint2: str) -> bool:
        """
        Compare two device fingerprints for equality.

        Args:
            fingerprint1: First fingerprint hash
            fingerprint2: Second fingerprint hash

        Returns:
            True if fingerprints match, False otherwise
        """
        return fingerprint1 == fingerprint2

    @staticmethod
    def is_ip_changed(old_ip: str, new_ip: str) -> bool:
        """
        Check if IP address has changed significantly.

        Args:
            old_ip: Previous IP address
            new_ip: Current IP address

        Returns:
            True if IP has changed, False otherwise
        """
        return old_ip != new_ip

    @staticmethod
    def is_suspicious_change(
        old_ip: str,
        new_ip: str,
        old_fingerprint: str,
        new_fingerprint: str,
    ) -> tuple[bool, str]:
        """
        Detect suspicious changes in device characteristics.

        Args:
            old_ip: Previous IP address
            new_ip: Current IP address
            old_fingerprint: Previous device fingerprint
            new_fingerprint: Current device fingerprint

        Returns:
            Tuple of (is_suspicious, reason)
        """
        # Different fingerprint = different device
        if not DeviceFingerprintService.compare_fingerprints(
            old_fingerprint, new_fingerprint
        ):
            return True, "Device fingerprint mismatch - possible token theft"

        # Same fingerprint but different IP = likely legitimate (user moved networks)
        if DeviceFingerprintService.is_ip_changed(old_ip, new_ip):
            return False, "IP address changed but device fingerprint matches"

        # Same fingerprint and IP = normal activity
        return False, "No suspicious activity detected"


# Global instance
device_fingerprint_service = DeviceFingerprintService()
