#!/usr/bin/env python
"""
Test script to verify new GUI element detector implementations
"""

import sys
import ast
from pathlib import Path

# Add backend to path
backend_path = Path(__file__).parent
sys.path.insert(0, str(backend_path))


def check_analyzer_structure(filepath: str, expected_name: str, expected_element_type: str):
    """Check if an analyzer file has the correct structure"""
    print(f"\nChecking {filepath}...")

    with open(filepath, 'r') as f:
        content = f.read()

    # Parse the file
    try:
        tree = ast.parse(content)
    except SyntaxError as e:
        print(f"  ❌ Syntax error: {e}")
        return False

    # Find the class definition
    class_found = False
    has_analyze = False
    has_analysis_type = False
    has_name = False

    for node in ast.walk(tree):
        if isinstance(node, ast.ClassDef):
            class_found = True
            # Check for required methods
            for item in node.body:
                if isinstance(item, ast.AsyncFunctionDef) and item.name == 'analyze':
                    has_analyze = True
                elif isinstance(item, ast.FunctionDef):
                    if item.name == 'analysis_type':
                        has_analysis_type = True
                    elif item.name == 'name':
                        has_name = True

    # Check for required imports
    has_base_imports = 'from ..base import' in content
    has_element_type = f'element_type="{expected_element_type}"' in content

    results = {
        "Class found": class_found,
        "Has analyze() method": has_analyze,
        "Has analysis_type property": has_analysis_type,
        "Has name property": has_name,
        "Has base imports": has_base_imports,
        f"Sets element_type='{expected_element_type}'": has_element_type,
    }

    all_passed = all(results.values())

    for check, passed in results.items():
        status = "✓" if passed else "❌"
        print(f"  {status} {check}")

    return all_passed


def main():
    """Main test function"""
    print("=" * 60)
    print("Testing New GUI Element Detector Implementations")
    print("=" * 60)

    analyzers = [
        ("app/services/analysis/analyzers/input_field_detector.py", "input_field_detector", "input"),
        ("app/services/analysis/analyzers/dropdown_detector.py", "dropdown_detector", "dropdown"),
        ("app/services/analysis/analyzers/menu_bar_detector.py", "menu_bar_detector", "menu"),
        ("app/services/analysis/analyzers/sidebar_detector.py", "sidebar_detector", "sidebar"),
        ("app/services/analysis/analyzers/icon_button_detector.py", "icon_button_detector", "icon_button"),
        ("app/services/analysis/analyzers/modal_dialog_detector.py", "modal_dialog_detector", "dialog"),
    ]

    results = []
    for filepath, name, element_type in analyzers:
        passed = check_analyzer_structure(filepath, name, element_type)
        results.append((name, passed))

    print("\n" + "=" * 60)
    print("Summary")
    print("=" * 60)

    passed_count = sum(1 for _, passed in results if passed)
    total_count = len(results)

    for name, passed in results:
        status = "✓ PASS" if passed else "❌ FAIL"
        print(f"{status}: {name}")

    print(f"\nTotal: {passed_count}/{total_count} analyzers passed")

    # Check registration
    print("\n" + "=" * 60)
    print("Checking Registration")
    print("=" * 60)

    with open("app/services/analysis/analyzers/__init__.py", 'r') as f:
        init_content = f.read()

    with open("app/services/analysis/register.py", 'r') as f:
        register_content = f.read()

    registration_checks = {
        "InputFieldDetector in __init__.py": "InputFieldDetector" in init_content,
        "DropdownDetector in __init__.py": "DropdownDetector" in init_content,
        "MenuBarDetector in __init__.py": "MenuBarDetector" in init_content,
        "SidebarDetector in __init__.py": "SidebarDetector" in init_content,
        "IconButtonDetector in __init__.py": "IconButtonDetector" in init_content,
        "ModalDialogDetector in __init__.py": "ModalDialogDetector" in init_content,
        "InputFieldDetector registered": "analyzer_registry.register(InputFieldDetector)" in register_content,
        "DropdownDetector registered": "analyzer_registry.register(DropdownDetector)" in register_content,
        "MenuBarDetector registered": "analyzer_registry.register(MenuBarDetector)" in register_content,
        "SidebarDetector registered": "analyzer_registry.register(SidebarDetector)" in register_content,
        "IconButtonDetector registered": "analyzer_registry.register(IconButtonDetector)" in register_content,
        "ModalDialogDetector registered": "analyzer_registry.register(ModalDialogDetector)" in register_content,
    }

    for check, passed in registration_checks.items():
        status = "✓" if passed else "❌"
        print(f"{status} {check}")

    all_registered = all(registration_checks.values())

    if all_registered:
        print("\n✓ All analyzers properly registered!")
    else:
        print("\n❌ Some analyzers not properly registered")

    # Final result
    print("\n" + "=" * 60)
    if passed_count == total_count and all_registered:
        print("✓ ALL CHECKS PASSED!")
        return 0
    else:
        print("❌ SOME CHECKS FAILED")
        return 1


if __name__ == "__main__":
    sys.exit(main())
