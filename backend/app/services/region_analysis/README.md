# Region Analysis Framework

A modular system for detecting important regions in screenshots (e.g., inventory grids, minimaps, toolbars, status bars). This framework runs parallel to the element detection system but focuses on larger functional areas rather than individual UI components.

## Architecture Overview

### Core Components

1. **base.py** - Base classes and data structures
   - `RegionType`: Enum defining types of regions (inventory_grid, minimap, status_bar, etc.)
   - `RegionAnalysisType`: Enum defining analysis methods (template_match, edge_detection, etc.)
   - `BoundingBox`: Represents a region's location and size
   - `DetectedRegion`: Represents a detected region with confidence and metadata
   - `RegionAnalysisResult`: Result from a region analyzer
   - `RegionAnalysisInput`: Input data for analysis
   - `BaseRegionAnalyzer`: Abstract base class for all region analyzers

2. **orchestrator.py** - Pipeline management
   - `RegionAnalyzerRegistry`: Registry for managing available analyzers
   - `RegionOrchestrator`: Coordinates execution of multiple analyzers
   - Supports parallel and sequential execution
   - Integrates with fusion system

3. **fusion.py** - Region fusion system
   - `FusedRegion`: Combined result from multiple analyzers
   - `WeightedVotingRegionFusion`: Fusion strategy using weighted voting
   - `RegionFusion`: Main fusion system
   - Handles overlapping regions
   - Identifies nested regions (e.g., minimap within a larger panel)

4. **register.py** - Auto-registration
   - Automatically registers analyzers on import
   - Easy to add new analyzers to the system

5. **analyzers/** - Region detection strategies
   - Directory containing all region analyzer implementations
   - Each analyzer detects specific region types using different techniques

## Key Design Principles

### Regions vs. Elements

- **Regions**: Larger functional areas (inventory panels, minimaps, toolbars)
  - Focus on grouping and structure
  - Often contain multiple elements
  - Detected using clustering, segmentation, pattern analysis

- **Elements**: Individual UI components (buttons, inputs, images)
  - Focus on specific interactive components
  - Usually contained within regions
  - Detected using edge detection, template matching, ML

### Modular Architecture

- **Unified Output**: All analyzers return `DetectedRegion` objects
- **Pluggable**: Easy to add new detection strategies
- **Compatible**: Works with existing annotation system (same screenshot input)
- **Extensible**: Support for custom region types

## Usage

### Basic Usage

```python
from app.services.region_analysis import (
    RegionOrchestrator,
    RegionAnalysisInput,
    RegionType,
)
from uuid import uuid4

# Create orchestrator
orchestrator = RegionOrchestrator()

# Prepare input
input_data = RegionAnalysisInput(
    annotation_set_id=uuid4(),
    screenshots=[{"id": "screenshot_1"}],
    screenshot_data=[screenshot_bytes],
    parameters={}
)

# Run analysis (async)
results = await orchestrator.analyze(
    input_data=input_data,
    parallel=True,           # Run analyzers in parallel
    fuse_results=True,       # Combine overlapping detections
    overlap_threshold=0.5    # IoU threshold for fusion
)

# Access results
fused_regions = results["fused_regions"]
for region in fused_regions:
    print(f"Region: {region['region_type']}")
    print(f"Confidence: {region['confidence']}")
    print(f"Bounding box: {region['bounding_box']}")
    print(f"Detected by: {region['sources']}")
```

### Using Specific Analyzers

```python
# Run only specific analyzers
results = await orchestrator.analyze(
    input_data=input_data,
    analyzer_names=["grid_pattern_detector"],
    fuse_results=False
)
```

### Custom Configuration

```python
# Configure individual analyzers
results = await orchestrator.analyze(
    input_data=input_data,
    analyzer_configs={
        "grid_pattern_detector": {
            "min_cell_size": 40,
            "min_grid_rows": 3,
            "min_grid_cols": 3,
        }
    }
)
```

## Creating a New Region Analyzer

### Step 1: Create Analyzer File

Create a new file in `analyzers/` directory (e.g., `minimap_detector.py`):

```python
from typing import List, Dict, Any
import numpy as np
from io import BytesIO
from PIL import Image

from ..base import (
    BaseRegionAnalyzer,
    RegionAnalysisType,
    RegionType,
    RegionAnalysisInput,
    RegionAnalysisResult,
    DetectedRegion,
    BoundingBox,
)

class MinimapDetector(BaseRegionAnalyzer):
    """Detects minimap regions in game screenshots"""

    @property
    def analysis_type(self) -> RegionAnalysisType:
        """Return the analysis method type"""
        return RegionAnalysisType.TEMPLATE_MATCH

    @property
    def name(self) -> str:
        """Return unique analyzer name"""
        return "minimap_detector"

    @property
    def supported_region_types(self) -> List[RegionType]:
        """Return list of region types this analyzer detects"""
        return [RegionType.MINIMAP]

    def get_default_parameters(self) -> Dict[str, Any]:
        """Return default configuration parameters"""
        return {
            "min_size": 100,
            "max_size": 300,
            "corner_preference": "top_right",
        }

    async def analyze(self, input_data: RegionAnalysisInput) -> RegionAnalysisResult:
        """Main analysis method"""
        all_regions = []

        # Process each screenshot
        for idx, screenshot_bytes in enumerate(input_data.screenshot_data):
            # Convert bytes to numpy array
            image = Image.open(BytesIO(screenshot_bytes))
            image_np = np.array(image)

            # Your detection logic here
            regions = self._detect_minimap(image_np, idx, input_data.parameters)
            all_regions.extend(regions)

        # Calculate overall confidence
        overall_confidence = (
            sum(r.confidence for r in all_regions) / len(all_regions)
            if all_regions else 0.0
        )

        return RegionAnalysisResult(
            analyzer_type=self.analysis_type,
            analyzer_name=self.name,
            regions=all_regions,
            confidence=overall_confidence,
            metadata={"total_minimaps_detected": len(all_regions)},
        )

    def _detect_minimap(
        self, image: np.ndarray, screenshot_index: int, params: Dict[str, Any]
    ) -> List[DetectedRegion]:
        """Implement your detection logic"""
        params = {**self.get_default_parameters(), **params}
        regions = []

        # Your detection algorithm here
        # Example: detect based on corner position and size
        # ...

        # Create DetectedRegion for each found region
        # regions.append(DetectedRegion(
        #     bounding_box=BoundingBox(x, y, width, height),
        #     confidence=0.9,
        #     region_type=RegionType.MINIMAP,
        #     label="Minimap",
        #     screenshot_index=screenshot_index,
        #     metadata={"corner": "top_right"}
        # ))

        return regions
```

### Step 2: Register the Analyzer

Edit `register.py` to import and register your new analyzer:

```python
def register_default_region_analyzers():
    logger.info("Registering default region analyzers...")

    # Import and register your analyzer
    try:
        from .analyzers.minimap_detector import MinimapDetector
        region_analyzer_registry.register(MinimapDetector)
    except Exception as e:
        logger.warning(f"Failed to register MinimapDetector: {e}")

    # ... other analyzers ...
```

### Step 3: Test Your Analyzer

```python
# List available analyzers
orchestrator = RegionOrchestrator()
analyzers = orchestrator.get_available_analyzers()
print(analyzers)

# Test your specific analyzer
results = await orchestrator.analyze(
    input_data=input_data,
    analyzer_names=["minimap_detector"],
)
```

## Region Types

The framework supports these pre-defined region types:

- `INVENTORY_GRID`: Grid-based inventory systems
- `MINIMAP`: Mini-maps in games
- `STATUS_BAR`: Status/health bars
- `TOOLBAR`: Tool/action bars
- `DIALOG`: Dialog boxes/windows
- `MENU`: Menu areas
- `CHAT_PANEL`: Chat/message panels
- `SKILL_TREE`: Skill/ability trees
- `QUEST_LOG`: Quest/mission panels
- `EQUIPMENT_PANEL`: Character equipment
- `CUSTOM`: For game-specific regions

To add new region types, edit `base.py`:

```python
class RegionType(str, Enum):
    # ... existing types ...
    MY_CUSTOM_REGION = "my_custom_region"
```

## Analysis Types

Different detection strategies:

- `TEMPLATE_MATCH`: Template matching for known regions
- `EDGE_DETECTION`: Edge-based region detection
- `COLOR_CLUSTERING`: Color-based region segmentation
- `PATTERN_ANALYSIS`: Pattern-based detection (grids, repetition)
- `ML_CLASSIFICATION`: ML-based region classification
- `CUSTOM`: For custom methods

## Fusion System

The fusion system combines results from multiple analyzers:

### Overlapping Regions

Regions with high IoU (Intersection over Union) are merged:
- Weighted average of bounding boxes
- Combined confidence with vote boost
- Tracks which analyzers detected the region

### Nested Regions

The system automatically identifies nested regions:
- A region completely contained within another is marked as nested
- Example: Minimap (small) within a larger UI panel (big)
- Parent-child relationships are preserved in metadata

### Confidence Calculation

```
combined_confidence = base_confidence + vote_boost
where:
  base_confidence = weighted_avg(analyzer_confidences)
  vote_boost = min(num_votes * 0.1, 0.3)
```

## Integration Points

### With Element Detection System

Region analysis complements element detection:

1. **Sequential**: Run region analysis first, then element detection within regions
2. **Parallel**: Run both systems independently and combine results
3. **Hierarchical**: Use regions to scope element detection

### With Annotation System

Uses the same input format as element detection:
- Same screenshot data (bytes)
- Same annotation_set_id
- Compatible with existing pipeline

### Example Integration

```python
# Run both region and element analysis
region_results = await region_orchestrator.analyze(input_data)
element_results = await element_orchestrator.analyze(input_data)

# Combine results
combined = {
    "regions": region_results["fused_regions"],
    "elements": element_results["fused_elements"],
    "hierarchy": match_elements_to_regions(
        region_results["fused_regions"],
        element_results["fused_elements"]
    )
}
```

## Advanced Features

### Custom Fusion Strategies

Implement custom fusion logic:

```python
from app.services.region_analysis.fusion import RegionFusionStrategy

class MyCustomFusion(RegionFusionStrategy):
    def fuse(self, results, overlap_threshold=0.5):
        # Your custom fusion logic
        pass

# Use custom strategy
orchestrator = RegionOrchestrator(
    fusion_system=RegionFusion(strategy=MyCustomFusion())
)
```

### Filtering Nested Regions

```python
# Exclude nested regions from results
orchestrator = RegionOrchestrator(
    fusion_system=RegionFusion(include_nested=False)
)
```

### Custom Confidence Thresholds

```python
# Only include high-confidence regions
orchestrator = RegionOrchestrator(
    fusion_system=RegionFusion(
        min_confidence=0.7,
        min_votes=2
    )
)
```

## File Structure

```
app/services/region_analysis/
├── __init__.py              # Package exports
├── base.py                  # Base classes and data structures
├── orchestrator.py          # RegionOrchestrator and registry
├── fusion.py               # Region fusion system
├── register.py             # Auto-registration
├── README.md               # This file
└── analyzers/
    ├── __init__.py
    ├── grid_pattern_detector.py
    └── ... (add more analyzers here)
```

## Best Practices

1. **Analyzer Design**
   - Keep analyzers stateless and thread-safe
   - Use descriptive names for analyzers and region types
   - Include comprehensive metadata in DetectedRegion
   - Provide reasonable default parameters

2. **Performance**
   - Use parallel execution for independent analyzers
   - Optimize detection algorithms for speed
   - Consider image resolution when setting parameters

3. **Accuracy**
   - Combine multiple detection strategies for robustness
   - Use fusion to improve confidence
   - Validate detections before returning results

4. **Testing**
   - Test analyzers with various screenshot types
   - Verify fusion produces correct results
   - Check performance with multiple screenshots

## Troubleshooting

### Analyzer Not Detected

Check that:
1. Analyzer is imported in `register.py`
2. Analyzer class inherits from `BaseRegionAnalyzer`
3. Required abstract methods are implemented
4. No import errors when loading the analyzer

### Low Detection Accuracy

Try:
1. Adjusting analyzer parameters
2. Using multiple analyzers with fusion
3. Improving preprocessing (e.g., edge detection, color normalization)
4. Adding more training data for ML-based analyzers

### Performance Issues

Consider:
1. Using parallel execution
2. Optimizing image processing
3. Reducing number of analyzers
4. Implementing caching for repeated screenshots

## Future Enhancements

Potential areas for expansion:

1. **ML-Based Detection**: Deep learning models for region classification
2. **Temporal Analysis**: Track region changes across multiple screenshots
3. **Game-Specific Analyzers**: Specialized detectors for popular games
4. **Adaptive Fusion**: Dynamic weight adjustment based on performance
5. **Region Relationships**: Detect and model relationships between regions
