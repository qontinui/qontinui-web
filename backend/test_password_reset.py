#!/usr/bin/env python3
"""
Test script for password reset functionality
Run this to test the password reset flow without email
"""

import requests  # type: ignore[import-untyped]

API_URL = "http://localhost:8000/api/v1/auth"


def test_password_reset():
    # Test email (use the one you signed up with)
    test_email = "jspinak@hotmail.com"

    print(f"Testing password reset for: {test_email}")
    print("-" * 50)

    # Step 1: Request password reset
    print("\n1. Requesting password reset...")
    response = requests.post(f"{API_URL}/password-reset", json={"email": test_email})

    if response.status_code == 200:
        print("✅ Password reset requested successfully")
        print(f"Response: {response.json()}")
    else:
        print(f"❌ Failed: {response.status_code} - {response.text}")
        return

    # Since email is disabled, we need to get the token from logs
    print("\n⚠️  Email sending is disabled.")
    print("Check the backend logs for the reset token.")
    print("Look for a line like: 'Password reset token generated for ...: <TOKEN>'")
    print("\nThen you can test the reset by:")
    print("1. Going to: http://localhost:3000/reset-password?token=<TOKEN>")
    print("2. Or running this script with the token:")
    print("   python test_password_reset.py <TOKEN>")


if __name__ == "__main__":
    import sys

    if len(sys.argv) > 1:
        # Test reset with provided token
        token = sys.argv[1]
        new_password = "NewTestPassword123!"

        print("\nTesting password reset confirmation with token...")
        response = requests.post(
            f"{API_URL}/password-reset-confirm",
            json={"token": token, "new_password": new_password},
        )

        if response.status_code == 200:
            print("✅ Password reset successfully!")
            print(f"Response: {response.json()}")
            print("\nYou can now login with:")
            print("  Username: jspinak")
            print(f"  Password: {new_password}")
        else:
            print(f"❌ Failed: {response.status_code} - {response.text}")
    else:
        test_password_reset()
