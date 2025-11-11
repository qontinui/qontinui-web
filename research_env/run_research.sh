#!/bin/bash

# GUI Element Detection Research - Quick Start Script

echo "=================================================="
echo "GUI Element Detection Research Environment"
echo "=================================================="
echo ""

# Check for Python
if ! command -v python3 &> /dev/null; then
    echo "❌ Python 3 not found. Please install Python 3.7 or higher."
    exit 1
fi

echo "✓ Python 3 found"

# Check for dependencies
echo ""
echo "Checking dependencies..."

if ! python3 -c "import cv2" 2>/dev/null; then
    echo "⚠ OpenCV not found. Installing dependencies..."
    pip install -r requirements.txt
    echo "✓ Dependencies installed"
else
    echo "✓ Dependencies OK"
fi

# Check for screenshots
echo ""
if [ ! -d "screenshots" ] || [ -z "$(ls -A screenshots 2>/dev/null)" ]; then
    echo "⚠ No screenshots found in screenshots/ directory"
    echo ""
    echo "Please add your screenshots to the 'screenshots' directory first."
    echo "Supported formats: .png, .jpg, .jpeg"
    exit 1
fi

SCREENSHOT_COUNT=$(ls screenshots/*.{png,jpg,jpeg} 2>/dev/null | wc -l)
echo "✓ Found $SCREENSHOT_COUNT screenshot(s)"

# Check for annotations
echo ""
if [ ! -d "annotations" ] || [ -z "$(ls -A annotations/*.json 2>/dev/null)" ]; then
    echo "⚠ No annotations found"
    echo ""
    echo "Opening annotation tool..."
    echo "Please annotate at least ONE screenshot, then run this script again."
    echo ""
    python3 annotation_tool.py
    exit 0
fi

ANNOTATION_COUNT=$(ls annotations/*.json 2>/dev/null | wc -l)
echo "✓ Found $ANNOTATION_COUNT annotation(s)"

# Run research environment
echo ""
echo "=================================================="
echo "Starting Research Environment"
echo "=================================================="
echo ""
echo "The system will now:"
echo "  1. Load your annotations"
echo "  2. Test multiple detection strategies"
echo "  3. Iterate until 100% precision and recall achieved"
echo "  4. Save notes to results/research_notes.md"
echo ""
echo "You can monitor progress in real-time."
echo "Press Ctrl+C to stop at any time."
echo ""

read -p "Press Enter to start research..."

python3 research_env.py "$@"

echo ""
echo "=================================================="
echo "Research Complete"
echo "=================================================="
echo ""
echo "Check results/research_notes.md for detailed findings."
echo ""
