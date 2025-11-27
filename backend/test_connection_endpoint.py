#!/usr/bin/env python3
"""Test the /me/connection-info endpoint"""

import json

# This test assumes you have a test user and can get a token
# You would need to login first to get a token

BASE_URL = "http://localhost:8000"


def test_connection_info():
    print("Testing /api/v1/users/me/connection-info endpoint...")
    print("\nNote: This test requires authentication.")
    print("Please login first to get a valid token.\n")

    # Example of how to use it (requires valid token)
    print("Example usage:")
    print("  1. Login to get a token")
    print("  2. curl -H 'Authorization: Bearer YOUR_TOKEN' \\")
    print(f"       {BASE_URL}/api/v1/users/me/connection-info")
    print("\nExpected response:")
    print(
        json.dumps(
            {
                "version": "1.0",
                "url": "ws://localhost:8001",
                "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
                "userId": "550e8400-e29b-41d4-a716-446655440000",
                "projectId": None,
                "createdAt": "2025-01-19T12:34:56.789Z",
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    test_connection_info()
