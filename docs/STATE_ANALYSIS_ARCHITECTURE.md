# State Analysis Architecture - Local Processing Model

## Executive Summary

This document defines the architectural decisions for state discovery and image analysis in the Qontinui ecosystem. The key principle is: **Heavy computational analysis (Computer Vision, Machine Learning) happens LOCALLY using the qontinui library, NOT in AWS cloud infrastructure.**

### Core Principles

1. **Local Processing First**: All CV/ML analysis is performed locally by the qontinui library
2. **Cost-Driven Design**: AWS services are expensive; maximize local computation
3. **Web Services as Data Layer**: qontinui-web and qontinui-train handle storage/retrieval, not analysis
4. **Runner as Data Capture**: qontinui-runner captures GUI interactions and screenshots
5. **Correct State Model**: Screenshots contain multiple STATES (cohesive UI regions), not 1:1 mapping

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          USER'S LOCAL MACHINE                           │
│                                                                          │
│  ┌────────────────────────────────────────────────────────────────┐   │
│  │                    qontinui-runner (Tauri + React)              │   │
│  │                                                                  │   │
│  │  • Captures screenshots during GUI manipulation                 │   │
│  │  • Records user input events (clicks, keys, etc.)               │   │
│  │  • Saves raw data locally (frames + interaction log)            │   │
│  │  • Can run manual exploration OR automated workflows            │   │
│  │                                                                  │   │
│  │  Output: Raw recording session (images + event log)             │   │
│  └──────────────────────────┬───────────────────────────────────────┘   │
│                             │                                            │
│                             ▼                                            │
│  ┌────────────────────────────────────────────────────────────────┐   │
│  │                   qontinui Library (Python)                     │   │
│  │               CORE INTELLIGENCE AND ANALYSIS                    │   │
│  │                                                                  │   │
│  │  ┌──────────────────────────────────────────────────────────┐  │   │
│  │  │        discovery/ - Computer Vision & ML Analysis        │  │   │
│  │  │                                                            │  │   │
│  │  │  state_detection/                                         │  │   │
│  │  │    • DifferentialConsistencyDetector                      │  │   │
│  │  │    • Signature matching for known states                  │  │   │
│  │  │    • Transition pattern analysis                          │  │   │
│  │  │                                                            │  │   │
│  │  │  state_construction/                                      │  │   │
│  │  │    • StateBuilder - constructs State objects              │  │   │
│  │  │    • OCRNameGenerator - semantic naming                   │  │   │
│  │  │    • ElementIdentifier - region classification           │  │   │
│  │  │                                                            │  │   │
│  │  │  element_detection/ (18+ detectors)                       │  │   │
│  │  │    • Typography, buttons, windows, modals                 │  │   │
│  │  │    • Template matching & feature extraction               │  │   │
│  │  │                                                            │  │   │
│  │  │  region_analysis/ (20+ analyzers)                         │  │   │
│  │  │    • Grid detection, texture analysis                     │  │   │
│  │  │    • Spatial relationships, layout detection              │  │   │
│  │  │                                                            │  │   │
│  │  │  pixel_analysis/                                          │  │   │
│  │  │    • Pixel stability matrices                             │  │   │
│  │  │    • Multi-screenshot comparison                          │  │   │
│  │  │    • Consistency scoring                                  │  │   │
│  │  │                                                            │  │   │
│  │  │  experimental/                                            │  │   │
│  │  │    • SAM (Segment Anything Model)                         │  │   │
│  │  │    • YOLO object detection                                │  │   │
│  │  │    • Vision transformers                                  │  │   │
│  │  └──────────────────────────────────────────────────────────┘  │   │
│  │                                                                  │   │
│  │  Output: Analyzed data (StateImages, States, Transitions)       │   │
│  └──────────────────────────┬───────────────────────────────────────┘   │
│                             │                                            │
└─────────────────────────────┼────────────────────────────────────────────┘
                              │
                              │ Upload analyzed results
                              │ (NOT raw screenshots!)
                              ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                            AWS CLOUD SERVICES                           │
│                                                                          │
│  ┌────────────────────────────────────────────────────────────────┐   │
│  │                  qontinui-web Backend (FastAPI)                 │   │
│  │                   DATA STORAGE & RETRIEVAL                      │   │
│  │                                                                  │   │
│  │  • Store analyzed StateImages (metadata + small images)         │   │
│  │  • Store DiscoveredStates (IDs + relationships)                 │   │
│  │  • Store StateTransitions (state graph)                         │   │
│  │  • Serve data to frontend for visualization                     │   │
│  │  • NO heavy CV/ML processing here                               │   │
│  │                                                                  │   │
│  │  PostgreSQL: State metadata, transitions, user projects         │   │
│  │  S3: StateImage thumbnails, representative screenshots          │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                                          │
│  ┌────────────────────────────────────────────────────────────────┐   │
│  │              qontinui-train Backend (Future)                    │   │
│  │                TRAINING DATA MANAGEMENT                         │   │
│  │                                                                  │   │
│  │  • Store verified state labels for ML training                  │   │
│  │  • Collect detection performance metrics                        │   │
│  │  • Export training datasets                                     │   │
│  │  • NO model training here (happens locally)                     │   │
│  └──────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Data Flow: Runner → Library → Web/Train

### Phase 1: Data Capture (qontinui-runner)

**Location**: User's local machine
**Technology**: Tauri (Rust) + React (TypeScript)

```python
# What qontinui-runner captures:
Recording Session:
  - screenshots/
      frame_000.png (1920x1080 @ 12:34:56.123)
      frame_001.png (1920x1080 @ 12:34:57.456)
      frame_002.png (1920x1080 @ 12:34:58.789)
      ...
  - interactions.json
      {
        "events": [
          {
            "timestamp": "2024-11-25T12:34:56.500Z",
            "type": "click",
            "x": 450,
            "y": 320,
            "button": "left"
          },
          {
            "timestamp": "2024-11-25T12:34:57.200Z",
            "type": "keypress",
            "key": "Enter"
          }
        ]
      }
```

**Key Points**:
- Runner does NOT analyze images
- Runner does NOT identify states
- Runner simply captures raw data
- Can capture manual exploration or automated runs
- Bridge script connects to qontinui library: `python-bridge/qontinui_bridge.py`

### Phase 2: Local Analysis (qontinui Library)

**Location**: User's local machine
**Technology**: Python + OpenCV + NumPy + (optional) ML models

```python
# Example: Local state analysis workflow
from qontinui.discovery import MultiScreenshotDetector
from qontinui.discovery.state_construction import StateBuilder
from qontinui.discovery.models import AnalysisConfig

# Load recording session
screenshots = load_screenshots("recording_session/screenshots/")
interactions = load_interactions("recording_session/interactions.json")

# Configure analysis
config = AnalysisConfig(
    min_region_size=(20, 20),
    max_region_size=(500, 500),
    stability_threshold=0.98,
    enable_rectangle_decomposition=True,
    similarity_threshold=0.95
)

# STEP 1: Detect persistent UI elements (StateImages)
detector = MultiScreenshotDetector()
state_images = detector.detect_multi(screenshots, **config.to_dict())

# STEP 2: Build complete States from StateImages
builder = StateBuilder()
states = []
for state_images_group in group_by_cooccurrence(state_images):
    state = builder.build_state_from_screenshots(
        screenshot_sequence=get_screenshots_for_group(state_images_group),
        transitions_to_state=find_transitions_to(state_images_group),
        transitions_from_state=find_transitions_from(state_images_group)
    )
    states.append(state)

# STEP 3: Identify transitions
transitions = analyze_transitions(states, interactions)

# Result: Analyzed data ready for upload
analysis_result = {
    "state_images": [si.to_dict() for si in state_images],
    "states": [s.to_dict() for s in states],
    "transitions": [t.to_dict() for t in transitions],
    "statistics": compute_statistics(state_images, states)
}
```

**What Happens Locally**:
1. **Pixel Analysis**: Compute stability matrices, consistency maps
2. **Element Detection**: Find buttons, windows, text regions using CV algorithms
3. **Region Analysis**: Identify grids, panels, functional areas
4. **State Construction**: Build State objects with StateImages, StateRegions, StateLocations
5. **Transition Detection**: Analyze interaction patterns between states
6. **OCR & Naming**: Generate semantic names using text extraction
7. **ML Inference** (optional): SAM segmentation, YOLO detection

**Cost Savings**: All heavy computation happens on user's hardware, not AWS

### Phase 3: Upload Results (qontinui-web)

**Location**: AWS Cloud
**Technology**: FastAPI + PostgreSQL + S3

```python
# What gets uploaded to qontinui-web:
POST /api/v1/state-discovery/sessions/{session_id}/results

{
  "state_images": [
    {
      "id": "si_abc123",
      "name": "main_menu_button",
      "x": 100, "y": 200, "x2": 200, "y2": 250,
      "pixel_hash": "def456...",
      "frequency": 0.95,
      "screenshot_ids": ["sc_001", "sc_002", "sc_005"],
      "tags": ["button", "navigation"],
      "dark_pixel_percentage": 0.3,
      "light_pixel_percentage": 0.7,
      "mask_density": 1.0
    }
  ],
  "states": [
    {
      "id": "st_xyz789",
      "name": "Main Menu",
      "state_image_ids": ["si_abc123", "si_def456"],
      "screenshot_ids": ["sc_001", "sc_002", "sc_005"],
      "confidence": 0.92,
      "metadata": {
        "element_count": 2,
        "transition_count": 3
      }
    }
  ],
  "transitions": [
    {
      "from_state": "st_xyz789",
      "to_state": "st_uvw012",
      "trigger_image": "si_abc123",
      "confidence": 0.87
    }
  ],
  "statistics": {
    "total_screenshots": 150,
    "unique_states": 12,
    "average_state_images_per_state": 3.5
  }
}
```

**What qontinui-web Does**:
- Store StateImage metadata in PostgreSQL
- Store small thumbnail images in S3 (NOT full screenshots)
- Store State and Transition relationships
- Serve data to frontend for visualization
- Provide APIs for querying state graphs
- **Does NOT**: Run CV algorithms, train ML models, perform image analysis

**What qontinui-web Does NOT Do**:
- Image analysis or computer vision
- Machine learning inference
- Pixel-level processing
- State detection algorithms
- Heavy computation of any kind

---

## The Correct State Model

### Key Concept: Screenshot ≠ State

A fundamental misunderstanding is thinking that one screenshot equals one state. This is WRONG.

**Correct Model**: A single screenshot contains MULTIPLE STATES (cohesive UI regions)

```
┌────────────────────────────────────────────────────────────────┐
│                    Single Screenshot                           │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │                                                            │ │
│  │  ┌─────────────────────────────────────┐  STATE 1        │ │
│  │  │  Title Bar: "MyApp v1.0"            │  (Title Bar)    │ │
│  │  └─────────────────────────────────────┘                 │ │
│  │                                                            │ │
│  │  ┌──────────────────────┐  STATE 2                       │ │
│  │  │  Navigation Menu     │  (Menu Panel)                  │ │
│  │  │  - Home              │                                 │ │
│  │  │  - Settings          │                                 │ │
│  │  │  - About             │                                 │ │
│  │  └──────────────────────┘                                │ │
│  │                                                            │ │
│  │  ┌────────────────────────────────────────┐  STATE 3     │ │
│  │  │  Content Area                          │  (Main View) │ │
│  │  │                                        │               │ │
│  │  │  [Dynamic content changes here]        │               │ │
│  │  │                                        │               │ │
│  │  └────────────────────────────────────────┘              │ │
│  │                                                            │ │
│  │  ┌──────────────────────────────────┐  STATE 4           │ │
│  │  │  Status Bar: "Connected"         │  (Status Bar)      │ │
│  │  └──────────────────────────────────┘                    │ │
│  └──────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────┘
```

### Data Model Hierarchy

```python
# Core Models from qontinui/discovery/models.py

class StateImage:
    """
    A VISUAL ELEMENT that appears consistently across screenshots.
    This is a REGION within a screenshot, not the whole screenshot.

    Represents a cohesive UI region like:
    - A button
    - A menu panel
    - A title bar
    - An icon
    - A persistent UI chrome element
    """
    id: str                        # Unique identifier
    name: str                      # "main_menu_button", "title_bar"
    x, y, x2, y2: int             # Bounding box coordinates
    pixel_hash: str                # Hash for quick comparison
    frequency: float               # % of screenshots containing this
    screenshot_ids: list[str]      # Which screenshots contain this
    pixel_data: np.ndarray         # The actual image data
    mask: np.ndarray               # Alpha mask (for irregular shapes)
    tags: list[str]                # ["button", "navigation"]

    # This is ONE REGION in a screenshot, not a whole screenshot!


class DiscoveredState:
    """
    A STATE composed of multiple StateImages.
    A State is identified by the COMBINATION of StateImages present.

    Example: "Main Menu State" = Title Bar + Menu Panel + Status Bar
    """
    id: str                        # Unique identifier
    name: str                      # "Main Menu", "Settings Screen"
    state_image_ids: list[str]     # IDs of StateImages that define this state
    screenshot_ids: list[str]      # Screenshots where this state was observed
    confidence: float              # Detection confidence
    metadata: dict                 # Additional properties


class StateTransition:
    """
    Transition from one State to another.
    Triggered by user actions (clicks, keys).
    """
    from_state: str                # Source state ID
    to_state: str                  # Destination state ID
    trigger_image: str | None      # StateImage that was clicked (if applicable)
    confidence: float              # Transition reliability


class AnalysisResult:
    """
    Complete analysis output from qontinui library.
    This is what gets uploaded to qontinui-web.
    """
    states: list[DiscoveredState]
    state_images: list[StateImage]
    transitions: list[StateTransition]
    stability_map: np.ndarray | None
    statistics: dict
```

### Example: Real-World Scenario

```python
# Scenario: User navigates through a game menu system
# Recording: 100 screenshots captured

# After local analysis with qontinui library:

state_images = [
    StateImage(id="si_001", name="game_logo", x=10, y=10, x2=200, y2=100,
               frequency=1.0, screenshot_ids=["sc_001"..."sc_100"]),
    StateImage(id="si_002", name="main_menu_panel", x=300, y=200, x2=700, y2=600,
               frequency=0.6, screenshot_ids=["sc_001"..."sc_060"]),
    StateImage(id="si_003", name="settings_panel", x=300, y=200, x2=700, y2=600,
               frequency=0.3, screenshot_ids=["sc_061"..."sc_090"]),
    StateImage(id="si_004", name="play_button", x=450, y=500, x2=550, y2=550,
               frequency=0.6, screenshot_ids=["sc_001"..."sc_060"]),
]

states = [
    DiscoveredState(
        id="st_001",
        name="Main Menu",
        state_image_ids=["si_001", "si_002", "si_004"],  # Logo + Menu + Play Button
        screenshot_ids=["sc_001"..."sc_060"],
        confidence=0.95
    ),
    DiscoveredState(
        id="st_002",
        name="Settings Screen",
        state_image_ids=["si_001", "si_003"],  # Logo + Settings Panel
        screenshot_ids=["sc_061"..."sc_090"],
        confidence=0.92
    ),
]

transitions = [
    StateTransition(
        from_state="st_001",
        to_state="st_002",
        trigger_image="si_005",  # Settings button (not shown above)
        confidence=0.89
    ),
]
```

---

## Detection Algorithms Available

The qontinui library provides multiple detection strategies:

### 1. Pixel Stability Analysis

**Location**: `qontinui/discovery/pixel_analysis/`

```python
from qontinui.discovery import PixelStabilityMatrixAnalyzer

analyzer = PixelStabilityMatrixAnalyzer()
stability_map = analyzer.analyze(screenshots)

# Identifies regions that don't change across screenshots
# High stability = persistent UI element (good StateImage candidate)
```

**Use Case**: Find persistent UI chrome (title bars, navigation, logos)

### 2. Differential Consistency Detection

**Location**: `qontinui/discovery/state_detection/differential_consistency_detector.py`

```python
from qontinui.discovery.state_detection import DifferentialConsistencyDetector

detector = DifferentialConsistencyDetector()

# Provide 100-1000 transition pairs (before/after screenshots)
transition_pairs = [
    (before_img1, after_img1),
    (before_img2, after_img2),
    # ... more pairs
]

regions = detector.detect_state_regions(
    transition_pairs,
    consistency_threshold=0.7,
    min_region_area=500
)

# Identifies regions that change CONSISTENTLY during transitions
# Breakthrough algorithm for animated backgrounds (games, multimedia)
```

**Use Case**: Detect state boundaries in dynamic environments with animated backgrounds

### 3. Multi-Screenshot Element Detection

**Location**: `qontinui/discovery/element_detection/`

18+ specialized detectors:
- Typography detectors (OCR, MSER, Stroke Width)
- Structural detectors (windows, borders, title bars)
- Interactive element detectors (buttons, menus, modals)
- Layout detectors (grids, containers, slots)

```python
from qontinui.discovery.element_detection import ButtonDetector

detector = ButtonDetector()
buttons = detector.detect(screenshot)

# Each detector inherits from BaseDetector
# Can be combined for comprehensive analysis
```

**Use Case**: Identify specific UI element types

### 4. State Builder Pipeline

**Location**: `qontinui/discovery/state_construction/state_builder.py`

```python
from qontinui.discovery.state_construction import StateBuilder, TransitionInfo

builder = StateBuilder()

# Simple: just screenshots
state = builder.build_state_from_screenshots(screenshots)

# Advanced: with transition data
transitions = [
    TransitionInfo(before, after, click_point=(450, 320))
    for before, after in transition_pairs
]

state = builder.build_state_from_screenshots(
    screenshot_sequence=screenshots,
    transitions_to_state=transitions_to,
    transitions_from_state=transitions_from
)

# Produces complete State object with:
# - StateImages (persistent visual elements)
# - StateRegions (functional areas)
# - StateLocations (click points)
# - Semantic name (from OCR)
```

**Use Case**: End-to-end state construction from raw screenshots

---

## What Needs to Change in qontinui-web

### Current State Discovery Service

**File**: `/mnt/c/qontinui/qontinui-web/backend/app/services/state_discovery_service.py`

**Current Approach** (WRONG):
```python
class StateDiscoveryService:
    async def discover_states_from_session(
        session_id: UUID,
        db: AsyncSession,
        algorithm: str = "timestamp_clustering"
    ):
        # Currently does simple timestamp clustering
        # Groups screenshots by time gaps
        # This is NOT real state detection!
```

**Problems**:
1. Uses timestamp clustering, not visual analysis
2. Assumes 1 screenshot = 1 state (WRONG MODEL)
3. Tries to do analysis in web service (should be local)
4. No integration with qontinui library's detection algorithms

### Required Changes

#### 1. Change Service Responsibility

**Old Role**: Perform state detection analysis
**New Role**: Store and retrieve analysis results

```python
# NEW: state_discovery_service.py (simplified)
class StateDiscoveryService:
    """Store and retrieve state discovery results from qontinui library."""

    @staticmethod
    async def store_analysis_results(
        session_id: UUID,
        analysis_result: AnalysisResultCreate,
        db: AsyncSession
    ) -> AnalysisResult:
        """
        Store pre-computed analysis results from qontinui library.

        Args:
            session_id: Session identifier
            analysis_result: Results from local qontinui analysis
            db: Database session

        Returns:
            Stored analysis result
        """
        # Store StateImages
        for si_data in analysis_result.state_images:
            state_image = StateImage(
                session_id=session_id,
                name=si_data.name,
                x=si_data.x, y=si_data.y,
                x2=si_data.x2, y2=si_data.y2,
                pixel_hash=si_data.pixel_hash,
                frequency=si_data.frequency,
                screenshot_ids=si_data.screenshot_ids,
                tags=si_data.tags,
                # Store thumbnail in S3, not full image
                thumbnail_url=await upload_thumbnail(si_data.pixel_data)
            )
            db.add(state_image)

        # Store States
        for state_data in analysis_result.states:
            state = DiscoveredState(
                session_id=session_id,
                name=state_data.name,
                state_image_ids=state_data.state_image_ids,
                screenshot_ids=state_data.screenshot_ids,
                confidence=state_data.confidence,
                metadata=state_data.metadata
            )
            db.add(state)

        # Store Transitions
        for trans_data in analysis_result.transitions:
            transition = StateTransition(
                session_id=session_id,
                from_state=trans_data.from_state,
                to_state=trans_data.to_state,
                trigger_image=trans_data.trigger_image,
                confidence=trans_data.confidence
            )
            db.add(transition)

        await db.commit()
        return analysis_result

    @staticmethod
    async def get_analysis_results(
        session_id: UUID,
        db: AsyncSession
    ) -> AnalysisResult:
        """Retrieve stored analysis results."""
        # Query and return stored data
        pass

    @staticmethod
    async def get_state_graph(
        session_id: UUID,
        db: AsyncSession
    ) -> StateGraph:
        """Build state graph for visualization."""
        # Construct graph from stored states and transitions
        pass
```

#### 2. Update API Endpoints

**File**: `/mnt/c/qontinui/qontinui-web/backend/app/api/v1/endpoints/state_discovery.py`

```python
# NEW endpoints

@router.post("/sessions/{session_id}/analysis-results")
async def upload_analysis_results(
    session_id: UUID,
    analysis_result: AnalysisResultCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Upload pre-computed analysis results from qontinui library.

    This endpoint receives results that were already computed locally,
    not raw screenshots to analyze.
    """
    result = await StateDiscoveryService.store_analysis_results(
        session_id, analysis_result, db
    )
    return result


@router.get("/sessions/{session_id}/analysis-results")
async def get_analysis_results(
    session_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Retrieve stored analysis results."""
    return await StateDiscoveryService.get_analysis_results(session_id, db)


@router.get("/sessions/{session_id}/state-graph")
async def get_state_graph(
    session_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get state transition graph for visualization."""
    return await StateDiscoveryService.get_state_graph(session_id, db)


@router.delete("/sessions/{session_id}/analysis-results")
async def delete_analysis_results(
    session_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Delete analysis results (e.g., to re-run analysis)."""
    await StateDiscoveryService.delete_analysis_results(session_id, db)
    return {"message": "Analysis results deleted"}
```

#### 3. Update Schemas

**File**: `/mnt/c/qontinui/qontinui-web/backend/app/schemas/state_discovery.py`

```python
# Match qontinui library models

class StateImageCreate(BaseModel):
    """Schema for creating StateImage (matches qontinui.discovery.models.StateImage)"""
    name: str
    x: int
    y: int
    x2: int
    y2: int
    pixel_hash: str
    frequency: float
    screenshot_ids: list[str]
    tags: list[str] = []
    dark_pixel_percentage: float | None = None
    light_pixel_percentage: float | None = None
    mask_density: float = 1.0


class DiscoveredStateCreate(BaseModel):
    """Schema for creating DiscoveredState (matches qontinui.discovery.models.DiscoveredState)"""
    name: str
    state_image_ids: list[str]
    screenshot_ids: list[str]
    confidence: float
    metadata: dict[str, Any] = {}


class StateTransitionCreate(BaseModel):
    """Schema for creating StateTransition (matches qontinui.discovery.models.StateTransition)"""
    from_state: str
    to_state: str
    trigger_image: str | None = None
    confidence: float


class AnalysisResultCreate(BaseModel):
    """Complete analysis result from qontinui library"""
    state_images: list[StateImageCreate]
    states: list[DiscoveredStateCreate]
    transitions: list[StateTransitionCreate]
    statistics: dict[str, Any] = {}


class StateGraph(BaseModel):
    """State transition graph for visualization"""
    nodes: list[StateNode]  # States as nodes
    edges: list[StateEdge]  # Transitions as edges

class StateNode(BaseModel):
    id: str
    name: str
    state_image_count: int
    screenshot_count: int

class StateEdge(BaseModel):
    from_state: str
    to_state: str
    trigger_image: str | None
    confidence: float
```

#### 4. Database Schema Updates

**Add/Update Models**:

```python
# models/state_image.py
class StateImage(Base):
    __tablename__ = "state_images"

    id = Column(UUID, primary_key=True)
    session_id = Column(UUID, ForeignKey("automation_sessions.id"))
    name = Column(String)
    x = Column(Integer)
    y = Column(Integer)
    x2 = Column(Integer)
    y2 = Column(Integer)
    pixel_hash = Column(String)
    frequency = Column(Float)
    screenshot_ids = Column(ARRAY(String))  # PostgreSQL array
    tags = Column(ARRAY(String))
    thumbnail_url = Column(String)  # S3 URL for small thumbnail
    created_at = Column(DateTime)


# models/discovered_state.py
class DiscoveredState(Base):
    __tablename__ = "discovered_states"

    id = Column(UUID, primary_key=True)
    session_id = Column(UUID, ForeignKey("automation_sessions.id"))
    name = Column(String)
    state_image_ids = Column(ARRAY(String))
    screenshot_ids = Column(ARRAY(String))
    confidence = Column(Float)
    metadata = Column(JSONB)
    created_at = Column(DateTime)


# models/state_transition.py
class StateTransition(Base):
    __tablename__ = "state_transitions"

    id = Column(UUID, primary_key=True)
    session_id = Column(UUID, ForeignKey("automation_sessions.id"))
    from_state_id = Column(UUID, ForeignKey("discovered_states.id"))
    to_state_id = Column(UUID, ForeignKey("discovered_states.id"))
    trigger_image_id = Column(UUID, ForeignKey("state_images.id"), nullable=True)
    confidence = Column(Float)
    created_at = Column(DateTime)
```

---

## Integration Workflow

### Complete End-to-End Flow

```
1. USER CAPTURES DATA (qontinui-runner)
   ├─ Launch qontinui-runner application
   ├─ Start recording session
   ├─ Perform GUI interactions (manual or automated)
   ├─ Runner captures screenshots + input events
   └─ Save recording session locally

2. USER ANALYZES LOCALLY (qontinui library)
   ├─ Load recording session
   ├─ Run state detection algorithms
   │   ├─ Pixel stability analysis
   │   ├─ Element detection
   │   ├─ Region analysis
   │   └─ State construction
   ├─ Generate analysis results
   │   ├─ StateImages
   │   ├─ States
   │   └─ Transitions
   └─ Export results as JSON

3. USER UPLOADS RESULTS (qontinui-web)
   ├─ POST /api/v1/state-discovery/sessions/{id}/analysis-results
   ├─ Web backend stores results in PostgreSQL
   ├─ Small thumbnails stored in S3
   └─ No heavy processing in web service

4. USER VISUALIZES (qontinui-web frontend)
   ├─ GET /api/v1/state-discovery/sessions/{id}/state-graph
   ├─ Display state transition graph
   ├─ Show StateImages and their relationships
   └─ Allow editing/refinement of results

5. USER EXPORTS (optional, qontinui-train)
   ├─ Export verified state labels
   ├─ Create training datasets
   └─ Improve detection models (locally)
```

---

## Cost Analysis

### Current (Wrong) Approach
```
Recording session: 150 screenshots @ 1920x1080 = ~450MB raw data
Upload to AWS: 450MB transfer
Store in S3: 450MB * $0.023/GB/month = $10.35/month
Process in Lambda/EC2:
  - CPU time: 15 minutes @ $0.0001/second = $9/run
  - Memory: 8GB * 15 min = expensive
Total per session: ~$12-15
```

### New (Correct) Approach
```
Recording session: 150 screenshots @ 1920x1080 = 450MB (stays local)
Local analysis: FREE (user's hardware)
Upload results:
  - StateImages metadata: ~50KB JSON
  - Thumbnails (50 images @ 10KB): 500KB
  - Total: ~550KB
Upload to AWS: 550KB transfer = negligible
Store in S3: 550KB * $0.023/GB/month = $0.01/month
Process in web: NONE (just store/retrieve)
Total per session: ~$0.01

SAVINGS: 99% cost reduction!
```

---

## Future Enhancements

### Phase 1: Current Implementation
- [x] qontinui library has detection algorithms
- [x] qontinui-runner captures data
- [ ] qontinui-web stores results (NOT analysis)
- [ ] Integration between runner and web

### Phase 2: Advanced Features
- [ ] Real-time analysis during recording (qontinui-runner)
- [ ] Progressive upload of results (streaming)
- [ ] Collaborative state refinement (web UI)
- [ ] State library sharing across projects

### Phase 3: ML Integration
- [ ] Local ML model training (qontinui library)
- [ ] Model performance tracking (qontinui-train)
- [ ] Transfer learning for similar applications
- [ ] Active learning feedback loops

---

## Key Takeaways

1. **Heavy analysis happens LOCALLY** - qontinui library does CV/ML work
2. **Runner captures, doesn't analyze** - qontinui-runner is data collector
3. **Web services store, don't compute** - qontinui-web/train are data layers
4. **Screenshots contain multiple states** - StateImage model is correct
5. **Cost-driven architecture** - 99% cost savings vs cloud processing
6. **User's hardware does the work** - Free computation

## References

- qontinui Library: `/mnt/c/qontinui/qontinui/src/qontinui/discovery/`
- qontinui-runner: `/mnt/c/qontinui/qontinui-runner/`
- qontinui-web Backend: `/mnt/c/qontinui/qontinui-web/backend/app/services/`
- Models Documentation: `/mnt/c/qontinui/qontinui/src/qontinui/discovery/models.py`
- Detection README: `/mnt/c/qontinui/qontinui/src/qontinui/discovery/README.md`
