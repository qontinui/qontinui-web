# GUI Element Analysis System - Setup & Usage

## Quick Start

### 1. Setup Database Tables

```bash
cd backend
python setup_analysis.py
```

This creates four tables:
- `analysis_jobs` - Analysis run metadata and configuration
- `analyzer_results` - Individual analyzer outputs
- `detected_elements` - Elements detected by each analyzer
- `fused_elements` - Combined results from multiple analyzers

### 2. Start the Backend

```bash
poetry run python run.py
```

Backend will be available at `http://localhost:8000`

### 3. Access the Web UI

Navigate to: `http://localhost:3000/admin/analysis`

(Requires admin login with `jspinak@hotmail.com`)

---

## Unified Result Format

All analysis results are presented in a **consistent, modular format** regardless of which analyzer methods are used.

### Core Data Structure

Every detected element follows this unified schema:

```python
DetectedElement:
  - bounding_box: BoundingBox (x, y, width, height)
  - confidence: float (0.0 to 1.0)
  - label: str (optional)
  - element_type: str (optional, e.g., "button", "input", "image")
  - screenshot_index: int
  - metadata: dict (analyzer-specific data)
```

### How It Works

1. **Input**: Any combination of analyzers (Stable Region, Pattern Match, Single Shot)
2. **Individual Results**: Each analyzer outputs `DetectedElement[]` in the unified format
3. **Fusion**: Decision system combines overlapping elements into `FusedElement[]`
4. **Output**: Single, consistent result format

```
┌─────────────────────────────────────────────────────────┐
│ Any Analyzer                                            │
│ - StableRegionVarianceAnalyzer                          │
│ - StableRegionDifferenceAnalyzer                        │
│ - PatternTemplateMatchAnalyzer                          │
│ - PatternFeatureMatchAnalyzer                           │
│ - SingleShotEdgeAnalyzer                                │
│ - SingleShotColorAnalyzer                               │
│ - YourCustomAnalyzer (easy to add!)                     │
└─────────────────┬───────────────────────────────────────┘
                  │
                  ▼
         Unified DetectedElement Format
                  │
                  ▼
         ┌────────────────────┐
         │ Decision Fusion    │
         │ (Optional)         │
         └────────┬───────────┘
                  │
                  ▼
         Unified FusedElement Format
                  │
                  ▼
         ┌────────────────────┐
         │ Single Result View │
         │ - Visual overlay   │
         │ - Element list     │
         │ - Statistics       │
         └────────────────────┘
```

### Frontend Display

The **same `AnalysisResults` component** displays results from:
- ✅ Single analyzer
- ✅ Multiple analyzers (individual view)
- ✅ Fused results (combined view)
- ✅ Any combination of the 6 built-in analyzers
- ✅ Custom analyzers you add

**No frontend changes needed** when adding new analyzers!

---

## Using the System

### Running Analysis

1. **Select Annotation Set**: Choose a screenshot with annotations
2. **Configure Analyzers**:
   - Select which analyzers to run (or keep all)
   - Adjust parameters per analyzer
   - Configure fusion settings
3. **Execute**: Click "Run Full Analysis" or "Quick Test"
4. **View Results**: Switch to "Results" tab to see detected elements

### Viewing Results

The results display shows:

- **Visual Overlay**: Bounding boxes on the screenshot
  - Color-coded by analyzer source
  - Labeled with confidence scores
  - Vote counts for fused results

- **Element List**: All detected elements
  - Click to view detailed information
  - Filter by analyzer source
  - Sort by confidence

- **Statistics**:
  - Total elements found
  - Average confidence
  - Per-analyzer breakdown
  - Confidence distribution

### Result Format Examples

**Individual Analyzer Result:**
```json
{
  "analyzer_name": "stable_region_variance",
  "analyzer_type": "stable_region",
  "elements": [
    {
      "bounding_box": {"x": 50, "y": 100, "width": 150, "height": 40},
      "confidence": 0.85,
      "label": "Stable Region",
      "element_type": "stable",
      "screenshot_index": 0,
      "metadata": {
        "method": "variance",
        "stability": 0.95
      }
    }
  ],
  "confidence": 0.85
}
```

**Fused Result (Multiple Analyzers):**
```json
{
  "bounding_box": {"x": 52, "y": 102, "width": 148, "height": 38},
  "confidence": 0.88,
  "votes": 3,
  "sources": ["stable_region_variance", "pattern_template_match", "single_shot_edge"],
  "source_confidences": {
    "stable_region_variance": 0.85,
    "pattern_template_match": 0.82,
    "single_shot_edge": 0.95
  },
  "label": "Button",
  "element_type": "button",
  "screenshot_index": 0
}
```

---

## Analysis History

All analysis runs are saved to the database (if enabled).

**View History:**
1. Go to "History" tab
2. Filter by status (completed/running/failed)
3. Click eye icon to view results
4. Click trash icon to delete

**Stored Information:**
- Which analyzers were used
- Configuration parameters
- Number of elements found
- Execution time
- Full results with bounding boxes

---

## Database Management

### Create Tables
```bash
python setup_analysis.py
```

### Reset Tables (Destroys Data!)
```bash
python setup_analysis.py --reset
```

### Drop Tables Only
```bash
python setup_analysis.py --drop
```

### Check Table Status
```bash
python -c "from setup_analysis import table_exists; print('Tables exist:', [t for t in ['analysis_jobs', 'analyzer_results', 'detected_elements', 'fused_elements'] if table_exists(t)])"
```

---

## Adding Custom Analyzers

The unified format makes it easy to add new analyzers:

```python
from app.services.analysis.base import BaseAnalyzer, AnalysisType, DetectedElement, BoundingBox

class MyCustomAnalyzer(BaseAnalyzer):
    @property
    def analysis_type(self) -> AnalysisType:
        return AnalysisType.CUSTOM

    @property
    def name(self) -> str:
        return "my_custom_analyzer"

    async def analyze(self, input_data: AnalysisInput) -> AnalysisResult:
        elements = []

        # Your detection logic here
        # ...

        # Return results in unified format
        elements.append(DetectedElement(
            bounding_box=BoundingBox(x=10, y=20, width=100, height=50),
            confidence=0.9,
            label="My Detection",
            element_type="custom",
            screenshot_index=0,
            metadata={"custom_info": "value"}
        ))

        return AnalysisResult(
            analyzer_type=self.analysis_type,
            analyzer_name=self.name,
            elements=elements,
            confidence=0.9
        )
```

Register it:
```python
from app.services.analysis.orchestrator import analyzer_registry
analyzer_registry.register(MyCustomAnalyzer)
```

**That's it!** Your analyzer will:
- ✅ Appear in the UI automatically
- ✅ Be configurable with parameters
- ✅ Work with the fusion system
- ✅ Display results in the same format

---

## API Endpoints

### List Available Analyzers
```bash
GET /api/v1/analysis/analyzers
```

Returns all registered analyzers with their capabilities.

### Run Analysis
```bash
POST /api/v1/analysis/analyze
{
  "annotation_set_id": "uuid",
  "analyzer_names": ["stable_region_variance", "single_shot_edge"],
  "fuse_results": true,
  "save_to_database": true
}
```

### Quick Test (No DB Storage)
```bash
POST /api/v1/analysis/analyze/quick
{
  "annotation_set_id": "uuid",
  "analyzers": ["stable_region_variance"],
  "fuse_results": true
}
```

### List Analysis Jobs
```bash
GET /api/v1/analysis/jobs?annotation_set_id=uuid&status=completed
```

### Get Job Details
```bash
GET /api/v1/analysis/jobs/{job_id}
```

### Delete Job
```bash
DELETE /api/v1/analysis/jobs/{job_id}
```

---

## Troubleshooting

### Tables Don't Exist
```bash
python setup_analysis.py
```

### Analysis Fails
- Check that annotation set exists
- Verify screenshots are accessible
- Check analyzer parameters are valid
- View error message in job history

### No Results Shown
- Ensure analysis completed (check status)
- Try lowering confidence thresholds
- Check that screenshots have detectable elements
- Try different analyzer combinations

### Fusion Not Working
- Ensure "Fuse Results" is enabled
- Adjust overlap threshold (default 0.5)
- Verify multiple analyzers detected overlapping elements
- Check that elements have sufficient confidence

---

## Performance Tips

1. **Parallel Execution**: Keep enabled for faster analysis (default)
2. **Quick Test**: Use for experimenting with parameters
3. **Selective Analyzers**: Don't run all 6 if you don't need them
4. **Database Storage**: Disable for temporary tests
5. **Image Size**: Smaller images analyze faster

---

## Architecture Benefits

### 1. Modularity
- Add analyzers without touching frontend
- Mix and match detection methods
- Configure each analyzer independently

### 2. Consistency
- Same result format for all analyzers
- Single visualization component
- Unified API responses

### 3. Composability
- Combine multiple analyzers
- Weight different methods differently
- Leverage strengths of each approach

### 4. Extensibility
- Easy to add new analyzers
- Support for custom analysis types
- Plugin-like architecture

---

## Next Steps

1. ✅ **Setup Database**: Run `python setup_analysis.py`
2. ✅ **Create Annotations**: Use `/admin/annotations` page
3. ✅ **Run Analysis**: Use `/admin/analysis` page
4. ✅ **View Results**: Explore detected elements
5. ✅ **Iterate**: Adjust parameters and re-run
6. ✅ **Add Custom Analyzers**: Extend with your own methods

---

## Support

For questions or issues:
- Check analyzer logs for errors
- Review `backend/app/services/analysis/ARCHITECTURE.md` for details
- Inspect database tables for stored results
- Use "Quick Test" mode for debugging
