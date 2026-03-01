import {
  Code2,
  Eye,
  GitBranch,
  Terminal,
  ScanSearch,
  Link2,
  ListChecks,
} from "lucide-react";
import type { TestTypeConfig, AiTemplate, EditorTabConfig } from "./test-types";

// =============================================================================
// Test Type Configuration
// =============================================================================

export const TEST_TYPES: readonly TestTypeConfig[] = [
  {
    id: "python_script",
    label: "Python Script",
    color: "amber",
    language: "python",
    description: "Custom Python test script",
    icon: Terminal,
    badgeClasses: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
    dotClass: "bg-emerald-400",
  },
  {
    id: "qontinui_vision",
    label: "Qontinui Vision",
    color: "cyan",
    language: "python",
    description: "Visual automation test with Qontinui",
    icon: Eye,
    badgeClasses: "bg-purple-500/10 text-purple-400 border-purple-500/30",
    dotClass: "bg-purple-400",
    devOnly: true,
  },
  {
    id: "repository_test",
    label: "Repository Test",
    color: "gray",
    language: "shell",
    description: "Shell script for repository testing",
    icon: GitBranch,
    badgeClasses: "bg-orange-500/10 text-orange-400 border-orange-500/30",
    dotClass: "bg-orange-400",
  },
];

export const TEST_TYPE_MAP: Record<string, TestTypeConfig> = Object.fromEntries(
  TEST_TYPES.map((t) => [t.id, t])
);

// =============================================================================
// Default Code Templates
// =============================================================================

export const TEST_TEMPLATES: Record<string, string> = {
  python_script: `import pytest

def test_example():
    """Test description here"""
    # Arrange
    expected = True

    # Act
    result = True

    # Assert
    assert result == expected
`,
  qontinui_vision: `# Qontinui Vision Test
# This test uses visual AI to verify UI elements

from qontinui import vision

def test_visual_check():
    """Visual verification test"""
    # Capture the current screen state
    screenshot = vision.capture()

    # Verify expected elements are visible
    assert vision.find_element(screenshot, "target_element")
`,
  repository_test: `#!/bin/bash
# Repository Test
# Validates repository structure and configuration

set -e

echo "Running repository checks..."

# Check required files exist
test -f README.md && echo "OK README.md exists" || echo "FAIL README.md missing"
test -f package.json && echo "OK package.json exists" || echo "FAIL package.json missing"

echo "Repository check complete"
`,
};

// =============================================================================
// AI Templates per Test Type
// =============================================================================

export const AI_TEMPLATES_BY_TYPE: Record<string, AiTemplate[]> = {
  python_script: [
    { label: "Unit test for a function", prompt: "Create a unit test for a Python function that validates inputs and returns expected outputs" },
    { label: "Integration test", prompt: "Create an integration test that verifies multiple components work together correctly" },
    { label: "API test", prompt: "Create a test that makes HTTP requests to API endpoints and verifies response status codes and data" },
  ],
  qontinui_vision: [
    { label: "Visual element verification", prompt: "Create a vision test that verifies specific UI elements are visible and correctly positioned on screen" },
    { label: "Screen state validation", prompt: "Create a vision test that captures the screen state and validates it matches the expected layout" },
  ],
  repository_test: [
    { label: "CI/CD check", prompt: "Create a repository test that validates CI/CD configuration files are present and correctly formatted" },
    { label: "Config validation", prompt: "Create a repository test that checks all configuration files are valid and contain required fields" },
  ],
};

export const AI_TEMPLATES_GENERIC: AiTemplate[] = [
  { label: "Login flow test", prompt: "Create a test that logs into a web application with username and password" },
  { label: "API integration test", prompt: "Create a test that verifies API endpoints are responding correctly" },
  { label: "Form validation", prompt: "Create a test that validates form input fields and error messages" },
  { label: "Page navigation", prompt: "Create a test that navigates through multiple pages and verifies content" },
];

// =============================================================================
// Editor Tabs
// =============================================================================

export const EDITOR_TABS: EditorTabConfig[] = [
  { id: "editor", label: "Editor", icon: Code2 },
  { id: "analyzer", label: "Page Analyzer", icon: ScanSearch },
  { id: "orchestrator", label: "Orchestrator", icon: Link2 },
  { id: "spec", label: "Spec Workflow", icon: ListChecks },
];
