#!/usr/bin/env python3
"""
Test Data Generator for Analysis Evaluation

Generates synthetic GUI screenshots with known elements for testing.
This allows for ground truth comparison and accuracy measurement.

Usage:
    poetry run python generate_test_data.py --count 5
"""

import sys
import io
import asyncio
from pathlib import Path
from typing import List, Dict, Tuple
from uuid import uuid4
from datetime import datetime
import random

# Add backend to path
backend_path = Path(__file__).parent
sys.path.insert(0, str(backend_path))

from PIL import Image, ImageDraw, ImageFont
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import AsyncSessionLocal
from app.models.annotation import AnnotationSet
from app.models.user import User
from app.services.object_storage import upload_file
from sqlalchemy import select


class GUIScreenshotGenerator:
    """Generate synthetic GUI screenshots with known elements"""

    def __init__(self, width: int = 800, height: int = 600):
        self.width = width
        self.height = height
        self.elements = []  # Ground truth elements

    def generate_button(
        self,
        draw: ImageDraw.Draw,
        x: int,
        y: int,
        width: int,
        height: int,
        text: str,
        color: str = "#4CAF50"
    ):
        """Generate a button"""
        # Button background
        draw.rectangle([x, y, x + width, y + height], fill=color, outline="#2E7D32", width=2)

        # Button text (simplified - no font rendering)
        text_x = x + width // 2
        text_y = y + height // 2
        draw.text((text_x, text_y), text, fill="white", anchor="mm")

        self.elements.append({
            "type": "button",
            "label": text,
            "bbox": {"x": x, "y": y, "width": width, "height": height}
        })

    def generate_text_input(
        self,
        draw: ImageDraw.Draw,
        x: int,
        y: int,
        width: int,
        height: int = 30
    ):
        """Generate a text input field"""
        # Input background
        draw.rectangle([x, y, x + width, y + height], fill="white", outline="#CCCCCC", width=2)

        self.elements.append({
            "type": "input",
            "label": "text_input",
            "bbox": {"x": x, "y": y, "width": width, "height": height}
        })

    def generate_menu_bar(
        self,
        draw: ImageDraw.Draw,
        items: List[str]
    ):
        """Generate a menu bar at the top"""
        bar_height = 40
        draw.rectangle([0, 0, self.width, bar_height], fill="#333333")

        item_width = 100
        for i, item in enumerate(items):
            x = 10 + i * item_width
            draw.text((x, bar_height // 2), item, fill="white", anchor="lm")

        self.elements.append({
            "type": "menu",
            "label": "menu_bar",
            "bbox": {"x": 0, "y": 0, "width": self.width, "height": bar_height}
        })

    def generate_dialog_box(
        self,
        draw: ImageDraw.Draw,
        x: int,
        y: int,
        width: int,
        height: int,
        title: str = "Dialog"
    ):
        """Generate a dialog box"""
        # Dialog background
        draw.rectangle([x, y, x + width, y + height], fill="#F5F5F5", outline="#999999", width=3)

        # Title bar
        title_height = 30
        draw.rectangle([x, y, x + width, y + title_height], fill="#2196F3", outline="#1976D2", width=2)
        draw.text((x + 10, y + title_height // 2), title, fill="white", anchor="lm")

        self.elements.append({
            "type": "dialog",
            "label": title,
            "bbox": {"x": x, "y": y, "width": width, "height": height}
        })

        # Add OK and Cancel buttons inside dialog
        button_y = y + height - 50
        self.generate_button(draw, x + width - 180, button_y, 80, 35, "OK", "#4CAF50")
        self.generate_button(draw, x + width - 90, button_y, 80, 35, "Cancel", "#F44336")

    def generate_sidebar(
        self,
        draw: ImageDraw.Draw,
        items: List[str]
    ):
        """Generate a sidebar navigation"""
        sidebar_width = 200
        draw.rectangle([0, 40, sidebar_width, self.height], fill="#424242")

        item_height = 50
        for i, item in enumerate(items):
            y = 50 + i * item_height
            draw.rectangle([5, y, sidebar_width - 5, y + item_height - 5], fill="#616161")
            draw.text((10, y + item_height // 2), item, fill="white", anchor="lm")

        self.elements.append({
            "type": "sidebar",
            "label": "navigation",
            "bbox": {"x": 0, "y": 40, "width": sidebar_width, "height": self.height - 40}
        })

    def generate_screenshot(self, variation: int = 0) -> Tuple[Image.Image, List[Dict]]:
        """Generate a complete GUI screenshot"""
        # Create image
        img = Image.new('RGB', (self.width, self.height), color='#EEEEEE')
        draw = ImageDraw.Draw(img)

        self.elements = []  # Reset elements

        # Generate stable elements (appear in all variations)
        self.generate_menu_bar(draw, ["File", "Edit", "View", "Help"])
        self.generate_sidebar(draw, ["Home", "Settings", "Profile", "About"])

        # Generate variable elements (change position/presence)
        if variation == 0:
            # Main content area buttons
            self.generate_button(draw, 250, 100, 120, 40, "Submit")
            self.generate_button(draw, 390, 100, 120, 40, "Reset")
            self.generate_text_input(draw, 250, 160, 260, 30)

        elif variation == 1:
            # Different layout
            self.generate_button(draw, 300, 150, 120, 40, "Submit")
            self.generate_button(draw, 440, 150, 120, 40, "Reset")
            self.generate_text_input(draw, 300, 210, 260, 30)
            self.generate_button(draw, 300, 260, 260, 40, "Advanced")

        elif variation == 2:
            # With dialog box
            self.generate_button(draw, 250, 100, 120, 40, "Submit")
            self.generate_text_input(draw, 250, 160, 260, 30)
            self.generate_dialog_box(draw, 300, 250, 400, 200, "Confirm Action")

        else:
            # Random variation
            base_x = 250 + random.randint(-50, 50)
            base_y = 100 + random.randint(-20, 20)
            self.generate_button(draw, base_x, base_y, 120, 40, "Submit")
            self.generate_button(draw, base_x + 140, base_y, 120, 40, "Reset")
            self.generate_text_input(draw, base_x, base_y + 60, 260, 30)

            if random.random() > 0.5:
                self.generate_dialog_box(
                    draw,
                    300 + random.randint(-30, 30),
                    250 + random.randint(-30, 30),
                    400,
                    200,
                    "Dialog"
                )

        return img, self.elements.copy()


async def generate_test_annotation_sets(
    db: AsyncSession,
    user: User,
    count: int = 3,
    screenshots_per_set: int = 3
) -> List[AnnotationSet]:
    """Generate test annotation sets with synthetic screenshots"""

    print(f"\n📸 Generating {count} test annotation sets...")

    generator = GUIScreenshotGenerator()
    created_sets = []

    for set_idx in range(count):
        print(f"\n  Creating set {set_idx + 1}/{count}...")

        screenshots = []
        all_elements = []

        for screenshot_idx in range(screenshots_per_set):
            # Generate screenshot with variation
            img, elements = generator.generate_screenshot(variation=screenshot_idx)

            # Convert to bytes
            img_bytes = io.BytesIO()
            img.save(img_bytes, format='PNG')
            img_bytes.seek(0)

            # Upload to storage
            filename = f"test_screenshot_set{set_idx}_img{screenshot_idx}_{uuid4()}.png"
            url = await upload_file(
                filename,
                img_bytes.getvalue(),
                content_type="image/png"
            )

            screenshots.append({
                "name": f"Screenshot {screenshot_idx + 1}",
                "url": url,
                "width": generator.width,
                "height": generator.height,
            })

            all_elements.extend(elements)

            print(f"    ✓ Screenshot {screenshot_idx + 1}: {len(elements)} elements")

        # Create annotation set
        annotation_set = AnnotationSet(
            id=str(uuid4()),
            name=f"Test Set {set_idx + 1} - Synthetic GUI",
            description=f"Auto-generated test data with {screenshots_per_set} screenshots and {len(all_elements)} known elements",
            screenshot_name=screenshots[0]["name"],
            screenshot_url=screenshots[0]["url"],
            image_width=generator.width,
            image_height=generator.height,
            screenshots=screenshots,
            created_by_id=user.id,
            created_at=datetime.utcnow()
        )

        db.add(annotation_set)
        created_sets.append(annotation_set)

        print(f"  ✓ Created annotation set: {annotation_set.id}")

    await db.commit()

    print(f"\n✅ Successfully generated {len(created_sets)} test annotation sets")

    return created_sets


async def main():
    """Main entry point"""
    import argparse

    parser = argparse.ArgumentParser(description="Generate Test Data for Analysis")
    parser.add_argument(
        "--count",
        type=int,
        default=3,
        help="Number of annotation sets to generate"
    )
    parser.add_argument(
        "--screenshots",
        type=int,
        default=3,
        help="Number of screenshots per annotation set"
    )

    args = parser.parse_args()

    print("="*80)
    print("TEST DATA GENERATOR")
    print("="*80)

    async with AsyncSessionLocal() as db:
        # Get or create test user
        result = await db.execute(
            select(User).where(User.email == "test@example.com")
        )
        user = result.scalar_one_or_none()

        if not user:
            print("\n❌ Test user not found. Please ensure test@example.com user exists.")
            print("   You can create it through the web UI or admin panel.")
            return

        print(f"\n✓ Using user: {user.email} (ID: {user.id})")

        # Generate test data
        annotation_sets = await generate_test_annotation_sets(
            db,
            user,
            count=args.count,
            screenshots_per_set=args.screenshots
        )

        print("\n" + "="*80)
        print("GENERATED ANNOTATION SET IDs:")
        print("="*80)
        for ann_set in annotation_sets:
            print(f"  {ann_set.id} - {ann_set.name}")

        print("\n💡 You can now run evaluation with these sets:")
        print(f"   poetry run python test_analysis.py")


if __name__ == "__main__":
    asyncio.run(main())
