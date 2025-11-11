# GUI Element Detection Research Environment

An autonomous research environment for detecting GUI elements in screenshots using computer vision and machine learning techniques.

## Overview

This system consists of two main components:

1. **Annotation Tool** - A GUI tool for creating ground truth annotations
2. **Research Environment** - An autonomous system that tests and refines detection strategies

## Quick Start

### 1. Install Dependencies

```bash
pip install -r requirements.txt
```

For SAM2 support (optional but recommended):
```bash
pip install torch torchvision
pip install git+https://github.com/facebookresearch/segment-anything-2.git
```

### 2. Annotate Screenshots

Place your screenshots in the `screenshots/` directory, then run:

```bash
python annotation_tool.py
```

**Annotation Tool Features:**
- Load multiple screenshots
- Draw bounding boxes around GUI elements
- Zoom and pan for precise annotation (mouse wheel to zoom, middle button to pan)
- Resize boxes by dragging edges
- Add labels, descriptions, and reasons for each element
- Save annotations to JSON

**Important:** You only need to annotate ONE screenshot. The other screenshots provide context for the detection algorithms.

### 3. Run Research Environment

Once you have at least one annotated screenshot:

```bash
python research_env.py
```

The system will:
- Load your ground truth annotations
- Test multiple detection strategies with various parameters
- Evaluate each approach with strict metrics (100% precision and recall required)
- Keep detailed notes in `results/research_notes.md`
- Iterate until perfect detection is achieved

### 4. Monitor Progress

Check `results/research_notes.md` to see:
- What methods are being tested
- Performance of each approach
- Insights and findings
- Best methods so far

The system runs autonomously - just type "continue" when prompted or let it run to completion.

## Directory Structure

```
research_env/
├── annotation_tool.py          # GUI annotation tool
├── research_env.py             # Main research environment
├── evaluator.py                # Evaluation metrics and visualization
├── detectors/                  # Detection strategies
│   ├── base_detector.py        # Base detector class
│   ├── edge_detector.py        # Edge-based detection
│   ├── contour_detector.py     # Contour-based detection
│   ├── color_detector.py       # Color clustering
│   ├── mser_detector.py        # MSER detector
│   ├── selective_search.py     # Selective search
│   ├── template_detector.py    # Corner/template detection
│   ├── hybrid_detector.py      # Combines multiple methods
│   └── sam2_detector.py        # SAM2-based detection (ML)
├── screenshots/                # Place screenshots here
├── annotations/                # Annotations saved here
└── results/                    # Research results and notes
    ├── research_notes.md       # Detailed research notes
    └── *.json                  # Individual result files
```

## Detection Strategies

The system tests multiple approaches:

### Traditional Computer Vision
- **Edge Detection**: Uses Canny edge detection + contours
- **Adaptive Thresholding**: Binary thresholding with contours
- **Color Clustering**: K-means color segmentation
- **MSER**: Maximally Stable Extremal Regions
- **Corner Detection**: Identifies corners and rectangular patterns
- **Selective Search**: Region proposal algorithm

### Machine Learning
- **SAM2**: Segment Anything Model 2 (state-of-the-art segmentation)

### Hybrid
- **Ensemble Methods**: Combines multiple detectors with voting

Each method is tested with multiple parameter configurations.

## Evaluation Metrics

The system uses strict evaluation:

- **Precision** = TP / (TP + FP) - Must be 100%
- **Recall** = TP / (TP + FN) - Must be 100%
- **IoU Threshold** = 0.5 (boxes must overlap ≥50% to match)

Success is only declared when ALL elements are detected with NO false positives.

## Advanced Usage

### Custom Parameters

Edit `research_env.py` to customize:

```bash
python research_env.py --screenshots ./my_screenshots \
                       --annotations ./my_annotations \
                       --results ./my_results \
                       --max-iterations 100
```

### Adding New Detection Strategies

1. Create a new detector in `detectors/`
2. Inherit from `BaseDetector`
3. Implement `detect()` method
4. Optionally implement `get_param_grid()` for hyperparameter search
5. Add to `detectors/__init__.py`
6. Add to `research_env.py` detector list

Example:

```python
from .base_detector import BaseDetector
from evaluator import BBox

class MyDetector(BaseDetector):
    def __init__(self):
        super().__init__("My Custom Detector")

    def detect(self, image_path: str, **params) -> List[BBox]:
        # Your detection logic here
        boxes = []
        # ...
        return boxes

    def get_param_grid(self) -> List[Dict[str, Any]]:
        return [
            {'param1': value1},
            {'param1': value2},
        ]
```

## Tips for Best Results

### Annotation Quality
- Be precise with bounding boxes - zoom in and adjust edges carefully
- Include all useful GUI elements: buttons, text fields, icons, menus, etc.
- Add descriptive labels and reasons - this helps understand what makes elements "useful"
- Annotate one representative screenshot thoroughly

### Screenshot Selection
- Provide 3-5 screenshots showing different states of the UI
- Include variations: different content, hover states, different data
- Similar layouts help the algorithm learn patterns
- Higher resolution is better (but not required)

### Interpreting Results

The research notes will show:
- Which methods perform best
- Common failure modes (missing small elements? too many false positives?)
- Processing time for each method
- Trends across iterations

Use these insights to:
- Understand which approach works for your UI
- Identify if you need custom parameter tuning
- Decide which method to implement in production

## Troubleshooting

### "No annotation files found"
- Run `annotation_tool.py` first
- Make sure you saved annotations (click "Save Annotations")
- Check that files are in `annotations/` directory

### "SAM2 not available"
- SAM2 is optional
- Install with: `pip install torch torchvision && pip install git+https://github.com/facebookresearch/segment-anything-2.git`
- Download checkpoint from https://github.com/facebookresearch/segment-anything-2
- Other detectors will still work

### Poor Detection Results
- Try annotating a different screenshot (clearer, less complex)
- Ensure bounding boxes are accurate
- Add more screenshots for context
- Let the system run more iterations
- Consider that some UIs are inherently difficult

### High Memory Usage
- Reduce number of screenshots
- Use smaller images (resize before annotating)
- Disable SAM2 if not needed (requires GPU/lots of RAM)

## Research Workflow

```
┌─────────────────────┐
│ Collect Screenshots │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ Annotate One Image  │◄─── Use annotation_tool.py
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ Run Research Env    │◄─── Use research_env.py
└──────────┬──────────┘
           │
           ▼
     ┌─────────┐
     │Perfect? │
     └────┬────┘
      Yes │ No
          │  │
          │  └──► Add more screenshots
          │       Refine annotations
          │       Let system iterate
          │
          ▼
┌─────────────────────┐
│ Review Notes        │
│ Use Best Method     │
└─────────────────────┘
```

## Output Files

### Annotations
`annotations/<screenshot_name>_annotations.json`:
```json
{
  "screenshot": "app_screenshot.png",
  "image_size": [1920, 1080],
  "num_elements": 15,
  "annotations": [
    {
      "bbox": [100, 200, 300, 250],
      "label": "Login Button",
      "description": "Primary action button",
      "reason": "Main call-to-action for user authentication",
      "width": 200,
      "height": 50,
      "area": 10000
    }
  ]
}
```

### Research Notes
`results/research_notes.md` - Comprehensive markdown notes with:
- Iteration results
- Method comparisons
- Insights and findings
- Success criteria

### Result Files
`results/result_*.json` - Individual result files for each successful configuration

## Performance

Typical performance on a modern CPU:
- **Edge Detection**: 0.01-0.1s per image
- **MSER**: 0.05-0.2s per image
- **Selective Search**: 0.5-2s per image
- **SAM2** (GPU): 1-3s per image
- **SAM2** (CPU): 10-30s per image

## License

MIT License - Use freely for research and production

## Contributing

To add new detection methods:
1. Follow the `BaseDetector` interface
2. Test on various UI types
3. Document parameter meanings
4. Include parameter grid for hyperparameter search

## Questions?

Check the code comments for detailed explanations of each component.
