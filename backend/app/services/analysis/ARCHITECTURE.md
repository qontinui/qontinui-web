# GUI Element Analysis Architecture

## Overview

This modular analysis system supports multiple methods for detecting GUI elements in screenshots. It's designed to be scalable, extensible, and composable - making it easy to add new analysis methods and combine results from different analyzers.

## Core Concepts

### 1. Analyzers
Individual analysis modules that detect GUI elements using specific techniques:
- **Stable Region Analyzer** (Type 1): Finds elements in fixed positions across multiple screenshots
- **Pattern Match Analyzer** (Type 2): Detects recurring visual patterns in different locations
- **Single Shot Analyzer** (Type 3): Uses ML/CV to analyze individual screenshots

### 2. Orchestrator
Manages the analysis pipeline:
- Coordinates multiple analyzers
- Runs analyzers in parallel or sequence
- Validates input data
- Handles errors gracefully

### 3. Decision Fusion System
Combines results from multiple analyzers:
- Uses weighted voting
- Resolves conflicts
- Boosts confidence for multi-analyzer agreement
- Filters results by confidence and vote thresholds

## Architecture Diagram

```
Input Screenshots
       │
       ▼
┌──────────────────┐
│  Orchestrator    │ ◄─── Analyzer Registry
└────────┬─────────┘
         │
         ├──────────┐──────────┐──────────┐
         ▼          ▼          ▼          ▼
    Analyzer 1  Analyzer 2  Analyzer 3  ... More
    (Stable)    (Pattern)   (SingleShot)    Analyzers
         │          │          │          │
         └──────────┴──────────┴──────────┘
                    │
                    ▼
         ┌──────────────────┐
         │  Decision Fusion │
         └────────┬──────────┘
                  │
                  ▼
         Fused Element Results
```

## Key Components

### BaseAnalyzer Interface

All analyzers implement this interface:

```python
class BaseAnalyzer(ABC):
    @property
    @abstractmethod
    def analysis_type(self) -> AnalysisType:
        """Type of analysis"""

    @property
    @abstractmethod
    def name(self) -> str:
        """Unique analyzer name"""

    @abstractmethod
    async def analyze(self, input_data: AnalysisInput) -> AnalysisResult:
        """Perform analysis"""

    def validate_input(self, input_data: AnalysisInput) -> bool:
        """Validate input data"""

    def get_default_parameters(self) -> Dict[str, Any]:
        """Get default parameters"""
```

### Data Models

#### DetectedElement
Represents a single detected GUI element:
- `bounding_box`: Position and size
- `confidence`: 0.0 to 1.0
- `label`: Human-readable label
- `element_type`: button, input, image, etc.
- `screenshot_index`: Which screenshot
- `metadata`: Additional information

#### AnalysisResult
Result from one analyzer:
- `analyzer_type`: Type of analysis
- `analyzer_name`: Analyzer identifier
- `elements`: List of detected elements
- `confidence`: Overall confidence
- `metadata`: Analysis parameters

#### FusedElement
Combined result from multiple analyzers:
- `bounding_box`: Averaged position
- `confidence`: Combined confidence
- `sources`: Which analyzers detected this
- `source_confidences`: Individual confidences
- `votes`: Number of agreeing analyzers

### Decision Fusion

The fusion system uses **Weighted Voting**:

1. **Group Overlapping Elements**: Elements with IoU >= threshold are grouped
2. **Average Bounding Boxes**: Weighted by confidence
3. **Combine Confidences**: Base confidence + vote boost
4. **Filter Results**: Apply minimum confidence and vote thresholds

Weights can be configured per analyzer type:
```python
fusion = DecisionFusion(
    strategy=WeightedVotingFusion(weights={
        AnalysisType.STABLE_REGION: 1.2,  # Trust stable regions more
        AnalysisType.PATTERN_MATCH: 1.0,
        AnalysisType.SINGLE_SHOT: 0.8,
    }),
    min_confidence=0.5,
    min_votes=2  # Require at least 2 analyzers
)
```

## Usage

### Running Analysis

```python
from app.services.analysis import AnalysisOrchestrator, AnalysisInput

orchestrator = AnalysisOrchestrator()

input_data = AnalysisInput(
    annotation_set_id=annotation_set_id,
    screenshots=screenshot_metadata,
    screenshot_data=image_bytes_list,
    parameters={
        "variance_threshold": 0.05,  # For stable region analyzer
    }
)

# Run all analyzers and fuse results
results = await orchestrator.analyze(
    input_data=input_data,
    parallel=True,  # Run analyzers in parallel
    fuse_results=True,  # Combine results
    overlap_threshold=0.5  # IoU threshold for fusion
)

# Access results
for element in results["fused_elements"]:
    print(f"Element at ({element['bounding_box']['x']}, "
          f"{element['bounding_box']['y']}) "
          f"confidence={element['confidence']:.2f} "
          f"votes={element['votes']}")
```

### Running Specific Analyzers

```python
# Run only certain analyzers
results = await orchestrator.analyze(
    input_data=input_data,
    analyzer_names=["stable_region", "pattern_match"],
    analyzer_configs={
        "stable_region": {"variance_threshold": 0.03},
        "pattern_match": {"min_occurrences": 3},
    }
)
```

## Adding New Analyzers

### Step 1: Create Analyzer Class

```python
from app.services.analysis.base import BaseAnalyzer, AnalysisType

class MyCustomAnalyzer(BaseAnalyzer):
    @property
    def analysis_type(self) -> AnalysisType:
        return AnalysisType.CUSTOM

    @property
    def name(self) -> str:
        return "my_custom"

    async def analyze(self, input_data: AnalysisInput) -> AnalysisResult:
        # Your analysis logic here
        elements = []

        # ... detect elements ...

        return AnalysisResult(
            analyzer_type=self.analysis_type,
            analyzer_name=self.name,
            elements=elements,
            confidence=0.8
        )
```

### Step 2: Register Analyzer

```python
from app.services.analysis.orchestrator import analyzer_registry

analyzer_registry.register(MyCustomAnalyzer)
```

### Step 3: Use It

```python
results = await orchestrator.analyze(
    input_data=input_data,
    analyzer_names=["my_custom"]
)
```

## Extending the System

### Custom Fusion Strategies

Create a new fusion strategy:

```python
from app.services.analysis.fusion import FusionStrategy

class MyFusionStrategy(FusionStrategy):
    def fuse(self, results, overlap_threshold):
        # Your custom fusion logic
        return fused_elements

# Use it
orchestrator = AnalysisOrchestrator(
    fusion_system=DecisionFusion(strategy=MyFusionStrategy())
)
```

### Custom Analysis Types

Add new analysis types:

```python
class AnalysisType(str, Enum):
    STABLE_REGION = "stable_region"
    PATTERN_MATCH = "pattern_match"
    SINGLE_SHOT = "single_shot"
    TEMPORAL = "temporal"  # New: analyze changes over time
    SEMANTIC = "semantic"  # New: semantic understanding
    CUSTOM = "custom"
```

## Best Practices

### For Analyzer Developers

1. **Make analyzers stateless**: Each `analyze()` call should be independent
2. **Validate input**: Check that input meets requirements
3. **Handle errors gracefully**: Don't crash the entire pipeline
4. **Provide good metadata**: Include parameters and diagnostics
5. **Set appropriate confidence**: Be honest about uncertainty
6. **Document parameters**: Clear descriptions in `get_default_parameters()`

### For System Users

1. **Use appropriate analyzers**: Not all analyzers work for all scenarios
2. **Tune parameters**: Default parameters may not be optimal
3. **Experiment with fusion settings**: Adjust weights and thresholds
4. **Monitor performance**: Check analyzer statistics
5. **Validate results**: Fusion isn't perfect - verify important detections

## Performance Considerations

### Parallel Execution
- Analyzers run concurrently by default
- CPU-bound analyzers: Consider process pool
- ML models: May benefit from GPU batching

### Memory Management
- Large images consume memory
- Multiple analyzers multiply memory needs
- Consider processing screenshots in batches

### Caching
- Cache loaded models (ML analyzers)
- Cache preprocessed images if reused
- Store intermediate results for debugging

## Future Enhancements

### Planned Features
1. **Temporal Analysis**: Track element changes across time
2. **Hierarchical Analysis**: Detect containers and nested elements
3. **Semantic Understanding**: Use language models for context
4. **Active Learning**: Learn from user corrections
5. **Confidence Calibration**: Better confidence estimates
6. **Performance Optimization**: GPU acceleration, caching

### Integration Points
1. **Annotation Storage**: Save analysis results to database
2. **User Feedback**: Allow users to correct detections
3. **Model Training**: Use annotations to train better models
4. **Metrics & Monitoring**: Track analyzer accuracy over time
5. **API Endpoints**: Expose via REST API

## Testing

### Unit Tests
Test individual analyzers:
```python
async def test_stable_region_analyzer():
    analyzer = StableRegionAnalyzer()
    input_data = create_test_input()
    result = await analyzer.analyze(input_data)
    assert len(result.elements) > 0
```

### Integration Tests
Test full pipeline:
```python
async def test_analysis_pipeline():
    orchestrator = AnalysisOrchestrator()
    results = await orchestrator.analyze(input_data)
    assert "fused_elements" in results
    assert results["fusion_stats"]["total_elements"] > 0
```

### Accuracy Evaluation
Compare with ground truth:
```python
def evaluate_accuracy(predictions, ground_truth):
    # Calculate precision, recall, F1
    # Use IoU for bounding box matching
    return metrics
```

## Troubleshooting

### No elements detected
- Check input validation
- Verify image quality
- Adjust analyzer parameters
- Check analyzer logs

### Low confidence scores
- Elements may be ambiguous
- Try different analyzers
- Adjust fusion weights
- Collect more training data

### High memory usage
- Reduce image resolution
- Process fewer screenshots at once
- Disable unused analyzers
- Use lighter ML models

## Contributing

When adding new analyzers:
1. Follow the BaseAnalyzer interface
2. Add comprehensive docstrings
3. Include unit tests
4. Update this documentation
5. Provide example usage
