# Getting Started - 5 Minute Guide

## What This Does

This is an autonomous research environment that learns to detect GUI elements in your screenshots. You annotate one screenshot, and the system automatically tests dozens of detection strategies to find the perfect approach.

## Quick Start (3 Steps)

### Step 1: Install (1 minute)

```bash
cd research_env
pip install -r requirements.txt
```

### Step 2: Annotate (2-3 minutes)

```bash
# 1. Copy your screenshots to the screenshots/ folder
cp /path/to/your/screenshots/*.png screenshots/

# 2. Run the annotation tool
python annotation_tool.py
```

**In the annotation tool:**
- Click "Load Screenshots"
- Select the screenshot to annotate
- Draw boxes around GUI elements (click and drag)
- Adjust boxes by dragging edges (zoom in with mouse wheel for precision)
- For each box:
  - Add a label (e.g., "Login Button")
  - Add description (e.g., "Primary action button")
  - Add reason (e.g., "Main user interaction point")
- Click "Save Annotations"

**Pro tip:** Only annotate ONE screenshot. Load 2-4 others for context.

### Step 3: Run Research (Automatic)

```bash
python research_env.py
```

The system will now:
- ✅ Load your annotations
- ✅ Test 50+ different detection configurations
- ✅ Report results in real-time
- ✅ Keep detailed notes in `results/research_notes.md`
- ✅ Continue until 100% accuracy achieved

Just sit back and watch! Type `continue` if prompted.

## What to Expect

### Console Output
```
================================================================================
ITERATION 1
================================================================================

🔬 Testing Edge-Based Detector (9 configurations)...
   ✗ Config 1: P=85.71% R=100.00% F1=92.31% (0.023s)
   ✗ Config 2: P=92.31% R=100.00% F1=96.00% (0.025s)
   ✓ Config 3: P=100.00% R=100.00% F1=100.00% (0.024s)

   🎉 PERFECT DETECTION ACHIEVED!
```

### Results File
Check `results/research_notes.md` for:
- Detailed iteration results
- Performance comparisons
- Insights and findings
- Final winning method

## Verify Your Setup

```bash
python verify_setup.py
```

This checks:
- ✓ Python version
- ✓ Dependencies installed
- ✓ Screenshots present
- ✓ Annotations ready

## Example Annotation Format

Your annotation will be saved as `annotations/screenshot_name_annotations.json`:

```json
{
  "screenshot": "app.png",
  "image_size": [1920, 1080],
  "num_elements": 5,
  "annotations": [
    {
      "bbox": [100, 200, 300, 250],
      "label": "Login Button",
      "description": "Blue primary button",
      "reason": "Main call-to-action",
      "width": 200,
      "height": 50,
      "area": 10000
    }
  ]
}
```

## Tips for Best Results

### Annotation Tips
- ✓ Be precise - zoom in and adjust box edges carefully
- ✓ Include ALL useful elements (buttons, fields, icons, etc.)
- ✓ Add clear labels and descriptions
- ✓ Annotate a representative screenshot

### Screenshot Tips
- ✓ Provide 2-5 screenshots total
- ✓ Show different UI states (different content, layouts)
- ✓ Higher resolution is better
- ✓ PNG format preferred

## Troubleshooting

### "No annotation files found"
→ Run `python annotation_tool.py` and click "Save Annotations"

### "SAM2 not available"
→ SAM2 is optional. Other detectors will work fine.
→ To install: `pip install torch torchvision`

### Can't see boxes clearly
→ Use mouse wheel to zoom in
→ Use middle mouse button to pan

### System not finding all elements
→ Let it run more iterations
→ Try annotating a different screenshot (clearer UI)
→ Check that your bounding boxes are accurate

## Next Steps After Research

Once you have perfect detection:

1. Check `results/research_notes.md` for the winning method
2. The winning configuration is saved in `results/`
3. Implement that method in your application
4. The research environment can be used to test on new UIs

## Advanced: Add Custom Detectors

Want to test your own detection algorithm?

1. Create `detectors/my_detector.py`:

```python
from .base_detector import BaseDetector
from evaluator import BBox

class MyDetector(BaseDetector):
    def __init__(self):
        super().__init__("My Detector")

    def detect(self, image_path: str, **params) -> List[BBox]:
        # Your detection logic
        return boxes
```

2. Add to `detectors/__init__.py`
3. Add to `research_env.py` detector list
4. Run research again!

## FAQ

**Q: How long does research take?**
A: Usually 5-30 minutes depending on number of methods and screenshot size.

**Q: What if perfect detection isn't achieved?**
A: The system will report the best method found. You can:
- Run more iterations
- Annotate a clearer screenshot
- Add custom detection strategies

**Q: Can I stop and resume?**
A: Yes! Press Ctrl+C to stop. Results are saved after each iteration.

**Q: What methods are tested?**
A: Edge detection, contour detection, color clustering, MSER, selective search, template matching, SAM2, and hybrid approaches - with multiple parameter configurations each.

**Q: Do I need a GPU?**
A: No! All traditional CV methods work on CPU. SAM2 benefits from GPU but is optional.

**Q: Can I use this for my own project?**
A: Yes! MIT licensed. Use freely for research or production.

## Support

- 📖 See [README.md](README.md) for detailed documentation
- 🔍 Check code comments for implementation details
- 🐛 Issues? Check that dependencies are installed correctly

---

**You're ready to go! Start with Step 1 above.**
