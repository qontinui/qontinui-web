#!/usr/bin/env python3
"""Test script for export/import endpoints"""

import sys

import requests  # type: ignore[import-untyped]

BASE_URL = "http://localhost:8000/api/v1"


def get_token(email="test@example.com", password="testpassword"):
    """Get authentication token"""
    response = requests.post(
        f"{BASE_URL}/auth/login", data={"username": email, "password": password}
    )
    if response.status_code == 200:
        return response.json()["access_token"]
    else:
        print(f"Login failed: {response.status_code} - {response.text}")
        return None


def test_export(token, project_id=1):
    """Test export endpoint"""
    headers = {"Authorization": f"Bearer {token}"}
    response = requests.get(f"{BASE_URL}/projects/{project_id}/export", headers=headers)

    print(f"\n=== Export Test (Project {project_id}) ===")
    print(f"Status: {response.status_code}")

    if response.status_code == 200:
        config = response.json()
        print(f"Exported config version: {config.get('version')}")
        print(f"Metadata: {config.get('metadata', {}).get('name')}")
        print(f"Images: {len(config.get('images', []))}")
        print(f"Processes: {len(config.get('processes', []))}")
        print(f"States: {len(config.get('states', []))}")
        print(f"Transitions: {len(config.get('transitions', []))}")
        return config
    else:
        print(f"Export failed: {response.text}")
        return None


def test_validate(token, config):
    """Test validation endpoint"""
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    response = requests.post(
        f"{BASE_URL}/projects/1/validate", headers=headers, json=config
    )

    print("\n=== Validation Test ===")
    print(f"Status: {response.status_code}")

    if response.status_code == 200:
        result = response.json()
        print(f"Valid: {result.get('valid')}")
        if result.get("errors"):
            print(f"Errors: {result.get('errors')}")
        if result.get("warnings"):
            print(f"Warnings: {result.get('warnings')}")
        return result
    else:
        print(f"Validation request failed: {response.text}")
        return None


def test_import(token, project_id, config):
    """Test import endpoint"""
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}

    # Modify config slightly for testing
    if config:
        config["metadata"]["name"] = "Imported Configuration"
        config["metadata"]["description"] = "Test import"

    response = requests.post(
        f"{BASE_URL}/projects/{project_id}/import?merge=false",
        headers=headers,
        json=config,
    )

    print(f"\n=== Import Test (Project {project_id}) ===")
    print(f"Status: {response.status_code}")

    if response.status_code == 200:
        result = response.json()
        print(f"Success: {result.get('success')}")
        print(f"Message: {result.get('message')}")
        return result
    else:
        print(f"Import failed: {response.text}")
        return None


def test_get_configuration(token, project_id):
    """Test get configuration endpoint"""
    headers = {"Authorization": f"Bearer {token}"}
    response = requests.get(
        f"{BASE_URL}/projects/{project_id}/configuration", headers=headers
    )

    print(f"\n=== Get Configuration Test (Project {project_id}) ===")
    print(f"Status: {response.status_code}")

    if response.status_code == 200:
        config = response.json()
        print(f"Config version: {config.get('version')}")
        print(f"Metadata name: {config.get('metadata', {}).get('name')}")
        return config
    else:
        print(f"Get configuration failed: {response.text}")
        return None


def main():
    print("Testing Qontinui Export/Import API Endpoints")
    print("=" * 50)

    # Get authentication token
    token = get_token()
    if not token:
        print("Failed to authenticate. Make sure test user exists.")
        sys.exit(1)

    print("Successfully authenticated!")

    # Test export
    config = test_export(token, project_id=1)

    if config:
        # Test validation
        test_validate(token, config)

        # Test import
        test_import(token, 1, config)

        # Test get configuration
        test_get_configuration(token, project_id=1)

    print("\n" + "=" * 50)
    print("Tests completed!")


if __name__ == "__main__":
    main()
