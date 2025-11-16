# State Discovery Service Architecture

## Overview

The state discovery system provides unified access to multiple algorithms for discovering UI states from automation sessions. The architecture uses a **Facade Pattern** to abstract different state discovery implementations while providing a consistent interface.

## Service Components

### 1. `state_discovery_facade.py` (Unified Interface)

**Purpose:** Provides a unified interface to all state discovery algorithms

**Key Classes:**
- `DiscoveryAlgorithm` - Enum defining available algorithms (SIMPLE, ADVANCED)
- `StateDiscoveryFacade` - Main facade class that routes to appropriate service

**Usage:**
```python
from app.services.state_discovery_facade import (
    StateDiscoveryFacade,
    DiscoveryAlgorithm
)

# Use simple algorithm
facade = StateDiscoveryFacade(DiscoveryAlgorithm.SIMPLE)
result = await facade.discover_from_automation_session(session_id, db, config)

# Use advanced algorithm
facade = StateDiscoveryFacade(DiscoveryAlgorithm.ADVANCED)
result = await facade.discover_from_automation_session(session_id, db, config)
```

### 2. `automated_state_discovery_service.py` (SIMPLE Algorithm)

**Purpose:** Fast, computer vision-based state discovery using perceptual hashing

**Algorithm:**
1. Generate perceptual hashes for all screenshots
2. Cluster screenshots by visual similarity using hierarchical clustering
3. Extract stable UI regions from each cluster using pixel variance
4. Build co-occurrence matrix to find StateImages that appear together
5. Assemble DiscoveredStates from co-occurring StateImages
6. Infer StateTransitions from input events

**Key Features:**
- Perceptual hashing for fast similarity comparison
- Stable region detection using pixel-wise variance
- Co-occurrence matrix for identifying state-defining elements
- Filters universal elements (headers, footers) that appear everywhere

**Dependencies:**
- `computer_vision_service.py` - For image processing operations
- `imagehash` - For perceptual hashing
- `opencv-python` - For region detection

**Configuration:**
```python
config = {
    'similarity_threshold': 0.90,      # Min similarity to group screenshots
    'min_stability': 0.95,              # Min stability score for regions
    'min_region_size': (20, 20),        # Min region dimensions
    'cooccurrence_threshold': 0.80      # Min co-occurrence to group regions
}
```

### 3. `computer_vision_service.py` (CV Utilities)

**Purpose:** Low-level computer vision operations for image analysis

**Key Functions:**
- `generate_perceptual_hash()` - Generate pHash for an image
- `calculate_similarity()` - Calculate similarity between two hashes
- `detect_state_change()` - Detect significant visual changes
- `find_stable_regions()` - Extract stable UI regions from screenshot batch
- `download_screenshot_from_s3()` - Download images from storage
- `extract_region_image()` - Crop specific region from image

**Technologies:**
- PIL/Pillow for image manipulation
- imagehash for perceptual hashing
- OpenCV for region detection
- NumPy for array operations

### 4. `state_discovery_service.py` (ADVANCED Algorithm - Under Development)

**Purpose:** Advanced state discovery with OCR and intelligent naming

**Planned Algorithm:**
1. Cluster frames using DBSCAN on visual features
2. Detect stable regions using SSIM (Structural Similarity Index)
3. Extract text elements using OCR (Tesseract)
4. Generate intelligent state names from extracted text
5. Calculate confidence scores (uniqueness, stability, distinctiveness)
6. Detect error states from text patterns and color schemes

**Key Features (Planned):**
- OCR-based state naming
- DBSCAN clustering for better noise handling
- SSIM for more accurate region stability
- Error state detection
- Transient state identification

**Dependencies:**
- `frame_analysis_service.py` - For frame-level analysis
- `pytesseract` - For OCR
- `scikit-learn` - For DBSCAN clustering
- `scipy` - For SSIM calculations

**Status:** Currently, this service exists with a simple timestamp clustering implementation (348 lines). The advanced OCR-based implementation is planned.

### 5. `frame_analysis_service.py` (Frame Processing Utilities)

**Purpose:** Frame-level analysis operations for advanced algorithm

**Key Functions:**
- `download_frame()` - Download frame from S3
- `compute_perceptual_hash()` - Generate pHash for frame
- `calculate_similarity()` - Calculate frame similarity
- `detect_stable_regions()` - Find stable vs volatile regions
- `cluster_by_similarity()` - DBSCAN clustering of frames

**Technologies:**
- PIL/Pillow for image loading
- imagehash for hashing
- scikit-learn for clustering
- NumPy for numerical operations

## Algorithm Comparison

| Feature | SIMPLE Algorithm | ADVANCED Algorithm (Planned) |
|---------|------------------|------------------------------|
| **Speed** | Fast (perceptual hashing) | Slower (OCR + DBSCAN) |
| **Accuracy** | Good for similar UIs | Excellent for complex UIs |
| **State Naming** | Generic (state_0, state_1) | Intelligent (from OCR text) |
| **Clustering** | Hierarchical (greedy) | DBSCAN (density-based) |
| **Region Detection** | Pixel variance | SSIM (structural) |
| **Error Detection** | No | Yes (text + color patterns) |
| **Best For** | Sessions with consistent UI | Recordings with diverse UI |

## Data Models

### DiscoveredState

```python
{
    'state_id': str,                    # Unique identifier
    'name': str | None,                 # Human-readable name
    'confidence': float,                # Overall confidence (0-1)
    'metadata': dict,                   # Algorithm-specific metadata
    'screenshot_ids': list[UUID],       # Screenshots in this state
    'state_images': list[StateImage],   # Visual elements defining state
    'representative_screenshot_id': UUID, # Representative screenshot
    'timestamp_first_seen': datetime,   # First occurrence
    'timestamp_last_seen': datetime     # Last occurrence
}
```

### StateImage

```python
{
    'cluster_id': str,                  # Source cluster
    'x': int, 'y': int,                 # Position
    'width': int, 'height': int,        # Dimensions
    'pixel_hash': str,                  # Visual hash
    'stability_score': float,           # Stability across frames (0-1)
    'screenshot_ids': list[UUID]        # Screenshots containing this region
}
```

### StateTransition

```python
{
    'from_state_id': str,               # Source state
    'to_state_id': str,                 # Target state
    'trigger_event_id': UUID,           # Input event that triggered transition
    'event_type': str,                  # Type of event (click, keypress, etc.)
    'timestamp': datetime,              # When transition occurred
    'confidence': float,                # Transition confidence (0-1)
    'metadata': dict                    # Additional metadata
}
```

## API Integration

### Using the Facade in Endpoints

```python
from app.services.state_discovery_facade import (
    get_state_discovery_facade,
    DiscoveryAlgorithm
)

# In endpoint function
@router.post("/sessions/{session_id}/discover-states")
async def trigger_state_discovery(
    session_id: UUID,
    algorithm: str = "simple",  # or "advanced"
    config: dict = None,
    db: AsyncSession = Depends(get_async_db)
):
    # Map algorithm parameter to enum
    algo_enum = DiscoveryAlgorithm.SIMPLE if algorithm == "simple" else DiscoveryAlgorithm.ADVANCED

    # Get facade
    facade = get_state_discovery_facade(algo_enum)

    # Discover states
    result = await facade.discover_from_automation_session(session_id, db, config)

    return result
```

### Current Endpoint Status

**`/api/v1/state-discovery/`**
- Uses `state_discovery_service.discover_states_from_session()`
- Supports `algorithm` parameter ("timestamp_clustering", "computer_vision")
- Needs update to use facade pattern

**`/api/v1/recordings/{recording_id}/state-structure`**
- Retrieves discovered states from database
- Works with persisted DiscoveredState models
- No changes needed

## Migration Path

To fully implement the unified facade pattern:

1. **Update Endpoints** ✓ (Created facade)
   - Modify `state_discovery.py` to use `StateDiscoveryFacade`
   - Add algorithm parameter to API requests
   - Map old algorithm names to new enum values

2. **Complete Advanced Algorithm** (In Progress)
   - Implement OCR-based state naming in `state_discovery_service.py`
   - Add DBSCAN clustering
   - Add SSIM-based region detection
   - Integrate `frame_analysis_service.py`

3. **Testing** (Required)
   - Install missing dependencies: `pytesseract`, `scikit-learn`, `scipy`
   - Test both algorithms on sample sessions
   - Compare accuracy and performance
   - Validate API responses

4. **Documentation** (Needed)
   - API documentation for algorithm selection
   - Configuration parameter documentation
   - Performance benchmarks
   - Migration guide for existing code

## Dependencies Added

Updated `backend/requirements.txt`:
```
pytesseract==0.3.13      # OCR for advanced algorithm
scikit-learn==1.5.2      # DBSCAN clustering
scipy==1.15.0            # SSIM calculations
```

Existing dependencies:
```
imagehash==4.3.1         # Perceptual hashing
opencv-python==4.11.0.86 # Computer vision
pillow==11.3.0           # Image manipulation
numpy==2.3.4             # Numerical operations
```

## File Structure

```
backend/app/services/
├── state_discovery_facade.py          # ✓ Unified interface (NEW)
├── automated_state_discovery_service.py  # ✓ Simple algorithm
├── computer_vision_service.py          # ✓ CV utilities
├── state_discovery_service.py          # ⚠ Advanced algorithm (needs OCR impl)
├── frame_analysis_service.py           # ✓ Frame processing (fixed import)
└── object_storage.py                   # Storage utilities
```

## Known Issues and Fixes

### 1. Fixed: `frame_analysis_service.py` Import Error
**Issue:** `ImportError: cannot import name 'get_storage'`
**Fix:** Changed import from `get_storage()` to `object_storage` singleton

### 2. Missing: `automation_log` Model
**Issue:** `ModuleNotFoundError: No module named 'app.models.automation_log'`
**Status:** Separate issue, not part of state discovery merge

### 3. Missing Dependencies
**Issue:** `pytesseract`, `scikit-learn`, `scipy` not in requirements.txt
**Fix:** Added to requirements.txt

## Next Steps

1. Install new dependencies:
   ```bash
   cd backend
   pip install -r requirements.txt
   ```

2. Install Tesseract OCR (system dependency):
   ```bash
   # Ubuntu/Debian
   sudo apt-get install tesseract-ocr

   # macOS
   brew install tesseract

   # Windows
   # Download installer from: https://github.com/UB-Mannheim/tesseract/wiki
   ```

3. Test facade imports:
   ```bash
   cd backend
   python -c "from app.services.state_discovery_facade import StateDiscoveryFacade; print('OK')"
   ```

4. Update endpoints to use facade (if needed)

5. Implement advanced algorithm OCR features

6. Add comprehensive tests for both algorithms

## Summary

The unified state discovery architecture provides:
- ✓ Facade pattern for algorithm selection
- ✓ Simple algorithm (perceptual hashing + clustering)
- ✓ Computer vision utilities
- ✓ Frame analysis utilities
- ⚠ Advanced algorithm framework (OCR implementation pending)
- ✓ Consistent data models
- ✓ Extensible design for future algorithms

Both simple and advanced implementations coexist, allowing users to choose based on their accuracy vs. speed requirements.
