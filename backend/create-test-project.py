#!/usr/bin/env python3
"""Create a test project with sample configuration"""

import requests  # type: ignore[import-untyped]

BASE_URL = "http://localhost:8000/api/v1"

# Login
response = requests.post(
    f"{BASE_URL}/auth/login",
    data={"username": "test@example.com", "password": "testpassword"},
)

if response.status_code != 200:
    print(f"Login failed: {response.text}")
    exit(1)

token = response.json()["access_token"]
headers = {"Authorization": f"Bearer {token}"}

# Create a project with sample configuration
sample_config = {
    "version": "1.0.0",
    "metadata": {
        "name": "Sample Automation",
        "description": "Test configuration for export/import",
        "created": "2024-01-01T00:00:00Z",
        "modified": "2024-01-01T00:00:00Z",
        "tags": ["test", "sample"],
        "targetApplication": "Test App",
    },
    "images": [
        {
            "id": "img-1",
            "name": "button.png",
            "data": "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
            "format": "png",
            "width": 100,
            "height": 50,
        }
    ],
    "processes": [
        {
            "id": "proc-1",
            "name": "Click Button",
            "description": "Clicks the main button",
            "type": "sequence",
            "actions": [
                {
                    "id": "action-1",
                    "type": "CLICK",
                    "config": {
                        "target": {
                            "type": "image",
                            "imageId": "img-1",
                            "threshold": 0.9,
                        }
                    },
                    "timeout": 5000,
                    "retryCount": 3,
                }
            ],
        }
    ],
    "states": [
        {
            "id": "state-1",
            "name": "Main Menu",
            "description": "The main menu state",
            "identifyingImages": [
                {"imageId": "img-1", "threshold": 0.9, "required": True}
            ],
            "position": {"x": 100, "y": 100},
            "isInitial": True,
            "isFinal": False,
        },
        {
            "id": "state-2",
            "name": "Settings",
            "description": "Settings screen",
            "identifyingImages": [],
            "position": {"x": 300, "y": 100},
            "isInitial": False,
            "isFinal": False,
        },
    ],
    "transitions": [
        {
            "id": "trans-1",
            "type": "OutgoingTransition",
            "name": "Open Settings",
            "processes": ["proc-1"],
            "fromState": "state-1",
            "toState": "state-2",
            "staysVisible": False,
            "activateStates": [],
            "deactivateStates": [],
            "timeout": 10000,
            "retryCount": 3,
        }
    ],
    "settings": {
        "execution": {
            "defaultTimeout": 10000,
            "defaultRetryCount": 3,
            "actionDelay": 100,
            "failureStrategy": "stop",
        },
        "recognition": {
            "defaultThreshold": 0.9,
            "searchAlgorithm": "template_matching",
            "multiScaleSearch": True,
            "colorSpace": "rgb",
        },
        "logging": {"level": "info", "screenshotOnError": True, "consoleOutput": True},
        "performance": {
            "maxParallelActions": 1,
            "cacheImages": True,
            "optimizeSearch": True,
        },
    },
}

# Create project
project_data = {
    "name": "Test Project",
    "description": "A test project for export/import",
    "configuration": sample_config,
}

response = requests.post(
    f"{BASE_URL}/projects/",
    headers={**headers, "Content-Type": "application/json"},
    json=project_data,
)

if response.status_code == 200:
    project = response.json()
    print("Project created successfully!")
    print(f"Project ID: {project['id']}")
    print(f"Project Name: {project['name']}")
else:
    print(f"Failed to create project: {response.text}")
