#!/usr/bin/env python3
"""
Verify that the research environment is set up correctly
"""

import sys
import os
from pathlib import Path


def check_python_version():
    """Check Python version"""
    version = sys.version_info
    if version.major >= 3 and version.minor >= 7:
        print(f"✓ Python {version.major}.{version.minor}.{version.micro}")
        return True
    else:
        print(f"✗ Python {version.major}.{version.minor}.{version.micro} - Need 3.7+")
        return False


def check_dependencies():
    """Check required dependencies"""
    deps = {
        'cv2': 'opencv-python',
        'numpy': 'numpy',
        'PIL': 'pillow',
    }

    all_ok = True
    for module, package in deps.items():
        try:
            __import__(module)
            print(f"✓ {package}")
        except ImportError:
            print(f"✗ {package} - Run: pip install {package}")
            all_ok = False

    # Check for contrib
    try:
        import cv2.ximgproc
        print("✓ opencv-contrib-python (selective search)")
    except AttributeError:
        print("⚠ opencv-contrib-python not found - Selective search will not work")
        print("  Install with: pip install opencv-contrib-python")

    # Check for SAM2 (optional)
    try:
        import torch
        print("✓ torch (SAM2 support)")
        try:
            from sam2.build_sam import build_sam2
            print("✓ SAM2 installed")
        except ImportError:
            print("⚠ SAM2 not installed (optional)")
            print("  Install with: pip install git+https://github.com/facebookresearch/segment-anything-2.git")
    except ImportError:
        print("⚠ torch not installed - SAM2 will not be available")

    return all_ok


def check_directories():
    """Check directory structure"""
    dirs = ['screenshots', 'annotations', 'results', 'detectors']
    all_ok = True

    for dir_name in dirs:
        path = Path(dir_name)
        if path.exists():
            print(f"✓ {dir_name}/ exists")
        else:
            if dir_name == 'results':
                path.mkdir(exist_ok=True)
                print(f"✓ {dir_name}/ created")
            else:
                print(f"✗ {dir_name}/ not found")
                all_ok = False

    return all_ok


def check_screenshots():
    """Check for screenshots"""
    screenshot_dir = Path('screenshots')
    if not screenshot_dir.exists():
        print("✗ No screenshots directory")
        return False

    screenshots = list(screenshot_dir.glob('*.png')) + list(screenshot_dir.glob('*.jpg'))
    if screenshots:
        print(f"✓ Found {len(screenshots)} screenshot(s)")
        for s in screenshots:
            print(f"  - {s.name}")
        return True
    else:
        print("⚠ No screenshots found in screenshots/")
        print("  Add .png or .jpg files to screenshots/ directory")
        return False


def check_annotations():
    """Check for annotations"""
    annotation_dir = Path('annotations')
    if not annotation_dir.exists():
        print("✗ No annotations directory")
        return False

    annotations = list(annotation_dir.glob('*_annotations.json'))
    if annotations:
        print(f"✓ Found {len(annotations)} annotation(s)")
        for a in annotations:
            print(f"  - {a.name}")
        return True
    else:
        print("⚠ No annotations found")
        print("  Use the web-based annotation tool at /admin/annotations")
        return False


def main():
    print("="*60)
    print("GUI Element Detection - Setup Verification")
    print("="*60)
    print()

    print("Checking Python...")
    python_ok = check_python_version()
    print()

    print("Checking dependencies...")
    deps_ok = check_dependencies()
    print()

    print("Checking directories...")
    dirs_ok = check_directories()
    print()

    print("Checking screenshots...")
    screenshots_ok = check_screenshots()
    print()

    print("Checking annotations...")
    annotations_ok = check_annotations()
    print()

    print("="*60)
    if python_ok and deps_ok and dirs_ok:
        print("✓ Core setup complete")
        print()

        if screenshots_ok and annotations_ok:
            print("✓ Ready to run research environment!")
            print()
            print("Next step: python research_env.py")
        elif screenshots_ok and not annotations_ok:
            print("⚠ Need annotations")
            print()
            print("Next step: Create annotations at /admin/annotations (web app)")
        else:
            print("⚠ Need screenshots")
            print()
            print("Next steps:")
            print("  1. Add screenshots to screenshots/ directory")
            print("  2. Create annotations at /admin/annotations (web app)")
            print("  3. Run: python research_env.py")
    else:
        print("✗ Setup incomplete")
        print()
        print("Please fix the issues above and run this script again.")

    print("="*60)


if __name__ == "__main__":
    main()
