# State Discovery Implementation Plan for qontinui-web

**Date:** 2025-11-16
**Status:** 📋 Planning Document - DO NOT IMPLEMENT YET
**Context:** Automated state structure discovery from automation session data

---

## Executive Summary

This plan outlines how to implement **nuanced state discovery** in qontinui-web that analyzes automation sessions to automatically discover UI states and transitions.

**Critical Understanding:** States are **NOT** entire screenshots. States are **logical UI states** composed of multiple visual elements (StateImages) that appear together consistently. A single screenshot may contain multiple states, and states may persist across many screenshots.

---

## Background: Existing State Discovery System

### Current Implementation (Frontend Upload-Based)

qontinui-web already has a **manual State Discovery** system located in `frontend/src/components/state-discovery/`:

**How it currently works:**
1. User manually uploads multiple screenshots
2. Computer vision algorithm analyzes screenshots to find **stable regions**
3. Stable regions become **StateImages** (visual elements)
4. StateImages that co-occur consistently are grouped into **DiscoveredStates**
5. User reviews and exports discovered structure to workflow format

**Key Concept - StateImage:**
```typescript
interface StateImage {
  id: string;
  name: string;
  x: number; y: number;        // Position
  x2: number; y2: number;
  width: number; height: number;
  pixelHash: string;            // Visual signature
  stabilityScore: number;       // 1.0 = always present when expected
  screenshots: string[];        // Which screenshots contain this
  hasMask?: boolean;           // Custom shape mask
  maskDensity?: number;        // % of region that's meaningful
}
```

**Key Concept - DiscoveredState:**
```typescript
interface DiscoveredState {
  id: string;
  name: string;
  stateImageIds: string[];     // Collection of StateImages
  screenshotIds: string[];     // Screenshots showing this state
  confidence: number;          // How confident we are this is a real state
  metadata?: Record<string, any>;
}
```

**Example:**
```
Screenshot 1: [LoginForm, CompanyLogo, LoginButton]
Screenshot 2: [LoginForm, CompanyLogo, LoginButton]
Screenshot 3: [Dashboard, CompanyLogo, UserMenu, Notification(3)]
Screenshot 4: [Dashboard, CompanyLogo, UserMenu, Notification(5)]

StateImages Discovered:
- LoginForm (appears in screenshots 1-2)
- CompanyLogo (appears in ALL screenshots - header element)
- LoginButton (appears in screenshots 1-2)
- Dashboard (appears in screenshots 3-4)
- UserMenu (appears in screenshots 3-4)
- Notification (appears in screenshots 3-4, content varies)

DiscoveredStates:
- State "Login Page": [LoginForm, LoginButton] (+ CompanyLogo)
- State "Dashboard": [Dashboard, UserMenu] (+ CompanyLogo)

CompanyLogo appears in both states but isn't state-defining.
Notification count varies but StateImage is stable.
```

---

## Problem Statement

### What We Have Now
- ✅ Screenshot capture every 500ms during automation
- ✅ Input event logging (mouse clicks, drags, keyboard)
- ✅ Screenshot-input event associations (±2.5 second window)
- ✅ All data stored in PostgreSQL
- ✅ Manual State Discovery UI (upload-based)

### What We Need
- ❌ **Automated State Discovery** from live automation sessions
- ❌ Analysis algorithm that processes session data to discover states
- ❌ Integration between session data and State Discovery system
- ❌ State transition inference from input events
- ❌ Automated workflow structure generation

### The Challenge: Nuanced Analysis

**Why this is complex:**

1. **Temporal Clustering isn't enough**
   - Can't just group screenshots by time proximity
   - Same state may appear at t=0s and t=60s
   - Different states may occur only 1 second apart

2. **Visual Similarity is required**
   - Must use computer vision to identify stable UI regions
   - Need perceptual hashing or image differencing
   - Must handle dynamic content (counters, timestamps, data values)

3. **State boundaries are semantic**
   - "Login page" vs "Dashboard" are different states
   - But "Dashboard with 3 notifications" vs "Dashboard with 5 notifications" is the SAME state
   - Must distinguish state-defining elements from dynamic content

4. **Multi-screenshot states**
   - A state might be visible in 50 screenshots over 10 seconds
   - During scrolling, the "same" state has different pixel content
   - StateImages help solve this - look for co-occurring stable elements

---

## Proposed Architecture

### Phase 1: Data Pipeline Setup

**Goal:** Connect automation session data to State Discovery analysis

#### Database Schema Extensions

**Add to existing `automation_sessions` table:**
```sql
ALTER TABLE automation_sessions ADD COLUMN state_discovery_status VARCHAR(50);
-- Values: 'pending', 'processing', 'completed', 'failed'

ALTER TABLE automation_sessions ADD COLUMN state_discovery_started_at TIMESTAMP;
ALTER TABLE automation_sessions ADD COLUMN state_discovery_completed_at TIMESTAMP;
ALTER TABLE automation_sessions ADD COLUMN state_discovery_error TEXT;
```

**New table: `discovered_states` (persisted analysis results)**
```sql
CREATE TABLE discovered_states (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES automation_sessions(id) ON DELETE CASCADE,
    state_id VARCHAR(100) NOT NULL,  -- e.g., "state_0", "state_1"
    name VARCHAR(255),               -- User-editable or auto-generated
    confidence FLOAT NOT NULL,
    metadata JSONB,

    -- Screenshots that show this state
    screenshot_ids UUID[] NOT NULL,  -- Array of automation_screenshot IDs

    -- StateImages that define this state (stored as JSONB for flexibility)
    state_images JSONB NOT NULL,     -- Array of StateImage objects

    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),

    INDEX idx_discovered_states_session (session_id),
    UNIQUE (session_id, state_id)
);
```

**New table: `state_transitions` (inferred from input events)**
```sql
CREATE TABLE state_transitions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES automation_sessions(id) ON DELETE CASCADE,
    from_state_id UUID REFERENCES discovered_states(id) ON DELETE CASCADE,
    to_state_id UUID REFERENCES discovered_states(id) ON DELETE CASCADE,

    -- Input event that triggered this transition
    trigger_event_id BIGINT REFERENCES automation_input_events(id) ON DELETE SET NULL,
    event_type VARCHAR(50),          -- 'mouse.clicked', 'keyboard.text_typed', etc.
    confidence FLOAT NOT NULL,

    timestamp TIMESTAMP NOT NULL,
    metadata JSONB,

    created_at TIMESTAMP DEFAULT NOW(),

    INDEX idx_state_transitions_session (session_id),
    INDEX idx_state_transitions_from (from_state_id),
    INDEX idx_state_transitions_to (to_state_id),
    INDEX idx_state_transitions_trigger (trigger_event_id)
);
```

**Rationale:**
- Store discovered states in database (not just in-memory)
- Allow incremental updates as session progresses
- Enable caching and avoid re-analysis
- Support state evolution tracking

---

### Phase 2: Computer Vision Service

**Goal:** Detect visual changes and extract stable regions from screenshots

#### New Service: `app/services/computer_vision_service.py`

**Responsibilities:**
1. **Perceptual Hashing** - Generate visual fingerprints of screenshots
2. **Image Differencing** - Detect what changed between screenshots
3. **Stable Region Extraction** - Find UI elements that don't change
4. **Clustering** - Group visually similar screenshots
5. **StateImage Generation** - Extract bounded regions with pixel hashes

**Key Methods:**

```python
class ComputerVisionService:

    async def generate_perceptual_hash(self, screenshot: bytes) -> str:
        """
        Generate pHash for screenshot.

        Returns: 64-bit hash as hex string
        Uses: imagehash library (pHash algorithm)
        Purpose: Quick similarity comparison
        """

    async def calculate_screenshot_similarity(
        self,
        screenshot1_hash: str,
        screenshot2_hash: str
    ) -> float:
        """
        Calculate similarity between two screenshots.

        Returns: 0.0 (completely different) to 1.0 (identical)
        Uses: Hamming distance on pHashes
        """

    async def find_stable_regions(
        self,
        screenshot_batch: list[bytes],
        min_stability: float = 0.95
    ) -> list[StateImageCandidate]:
        """
        Find UI regions that appear consistently across screenshots.

        Process:
        1. Align screenshots (detect shifts/scrolling)
        2. For each pixel region, calculate variance across screenshots
        3. Low variance = stable region (UI element)
        4. High variance = dynamic content (data, animations)
        5. Extract bounding boxes around stable regions
        6. Generate pixel hash for each region

        Returns: List of candidate StateImages
        """

    async def extract_state_images_from_screenshots(
        self,
        screenshots: list[AutomationScreenshot],
        config: AnalysisConfig
    ) -> list[StateImage]:
        """
        Main analysis pipeline.

        Steps:
        1. Download screenshots from S3
        2. Group visually similar screenshots (clustering)
        3. For each cluster, find stable regions
        4. Generate StateImage objects with:
           - Bounding box (x, y, width, height)
           - Pixel hash
           - Stability score
           - Screenshot IDs where it appears
        5. Filter by min_region_size and stability_threshold

        Returns: List of StateImage objects
        """

    async def detect_state_change(
        self,
        screenshot_before: bytes,
        screenshot_after: bytes,
        threshold: float = 0.15
    ) -> bool:
        """
        Detect if a significant state change occurred.

        Returns: True if similarity < threshold (different states)
        Purpose: Identify state transition boundaries
        """
```

**Dependencies:**
- `Pillow` - Image processing (already in project)
- `imagehash` - Perceptual hashing (NEW - needs pip install)
- `numpy` - Numerical operations (already in project)
- `opencv-python` - Advanced CV operations (OPTIONAL - for future enhancements)

**Storage:**
- Screenshots already in S3 (`automation_screenshots.s3_key`)
- Generate pHash when screenshot is uploaded, store in `screenshot_metadata` JSONB
- Cache analysis results in `discovered_states.state_images` JSONB

---

### Phase 3: State Discovery Algorithm

**Goal:** Convert session data into DiscoveredStates and StateTransitions

#### New Service: `app/services/automated_state_discovery_service.py`

**Algorithm Overview:**

```python
class AutomatedStateDiscoveryService:

    async def discover_states_from_session(
        self,
        session_id: UUID,
        config: Optional[AnalysisConfig] = None
    ) -> AnalysisResult:
        """
        Main state discovery pipeline.

        Steps:
        1. Load all screenshots for session (ordered by timestamp)
        2. Generate perceptual hashes if not already done
        3. Cluster screenshots by visual similarity
        4. Extract StateImages from each cluster
        5. Build co-occurrence matrix (which StateImages appear together)
        6. Identify DiscoveredStates (sets of StateImages with high co-occurrence)
        7. Infer StateTransitions from input events + state changes
        8. Persist results to database
        9. Return AnalysisResult
        """
```

**Detailed Algorithm:**

#### Step 1: Screenshot Clustering
```python
async def cluster_screenshots_by_similarity(
    self,
    screenshots: list[AutomationScreenshot],
    similarity_threshold: float = 0.90
) -> dict[str, list[AutomationScreenshot]]:
    """
    Group visually similar screenshots into clusters.

    Process:
    1. For each screenshot, get pHash
    2. Build similarity matrix (NxN)
    3. Use hierarchical clustering (or DBSCAN)
    4. Threshold at similarity_threshold
    5. Each cluster = candidate state

    Returns:
        {
            "cluster_0": [screenshot1, screenshot2, ...],
            "cluster_1": [screenshot5, screenshot6, ...],
            ...
        }

    Example:
        Screenshots 1-10: Login screen (cluster_0)
        Screenshots 11-50: Dashboard (cluster_1)
        Screenshots 51-60: Login screen again (cluster_0)
    """
```

#### Step 2: StateImage Extraction
```python
async def extract_state_images_from_cluster(
    self,
    cluster: list[AutomationScreenshot],
    cluster_id: str,
    config: AnalysisConfig
) -> list[StateImage]:
    """
    Find stable UI regions within a cluster of similar screenshots.

    Process:
    1. Download all screenshots in cluster from S3
    2. Align images (handle scroll/shift)
    3. Calculate pixel variance across all screenshots
    4. Regions with variance < threshold are "stable"
    5. Extract bounding boxes around stable regions
    6. Filter by min_region_size
    7. Generate pixel hash for each region
    8. Create StateImage object

    Returns: List of StateImages found in this cluster

    Example for "Dashboard" cluster:
        StateImage 1: Top navbar (x:0, y:0, w:1920, h:60)
        StateImage 2: Sidebar (x:0, y:60, w:250, h:1020)
        StateImage 3: Main content header (x:250, y:60, w:1670, h:100)
        StateImage 4: Notification badge (x:1800, y:10, w:40, h:40)
    """
```

#### Step 3: Co-occurrence Analysis
```python
async def build_cooccurrence_matrix(
    self,
    state_images: list[StateImage],
    screenshots: list[AutomationScreenshot]
) -> np.ndarray:
    """
    Build matrix showing which StateImages appear together.

    Process:
    1. For each screenshot:
       - Determine which StateImages are present
       - Increment co-occurrence counts
    2. Normalize by screenshot count

    Returns: NxN matrix where:
        matrix[i][j] = % of time StateImage i and j appear together

    Example:
        LoginForm + LoginButton: 100% (always together)
        Dashboard + UserMenu: 95% (usually together)
        LoginForm + UserMenu: 0% (never together - different states)
    """
```

#### Step 4: State Assembly
```python
async def assemble_discovered_states(
    self,
    state_images: list[StateImage],
    cooccurrence_matrix: np.ndarray,
    cooccurrence_threshold: float = 0.80
) -> list[DiscoveredState]:
    """
    Group StateImages into DiscoveredStates based on co-occurrence.

    Process:
    1. Find StateImage groups with high co-occurrence (>threshold)
    2. Use graph clustering (connected components):
       - Nodes = StateImages
       - Edges = co-occurrence > threshold
       - Connected components = DiscoveredStates
    3. Exclude "universal" StateImages (appear in >80% of screenshots)
       - Example: CompanyLogo, TopNav that's always present
       - These are "decorations" not state-defining
    4. Calculate state confidence based on:
       - Co-occurrence strength
       - StateImage stability scores
       - Number of screenshots

    Returns: List of DiscoveredStates

    Example:
        State "Login": [LoginForm, LoginButton, ForgotPasswordLink]
        State "Dashboard": [Dashboard, Sidebar, UserMenu, NotificationBell]
        State "Settings": [SettingsPanel, SaveButton, CancelButton]
    """
```

#### Step 5: Transition Inference
```python
async def infer_state_transitions(
    self,
    states: list[DiscoveredState],
    input_events: list[AutomationInputEvent],
    screenshots: list[AutomationScreenshot]
) -> list[StateTransition]:
    """
    Infer state transitions from input events and state changes.

    Process:
    1. Build timeline: [(timestamp, state_id, screenshot_id), ...]
    2. For each input event:
       - Find state before input (nearest screenshot before)
       - Find state after input (nearest screenshot after, >100ms later)
       - If states differ, record transition
       - Link to input event as trigger
    3. Calculate transition confidence:
       - High: Same transition seen multiple times
       - Medium: Transition seen once, states are distinct
       - Low: States are similar, might be same state

    Returns: List of StateTransition objects

    Example:
        t=0.5s: State "Login" (screenshot 1)
        t=1.0s: [INPUT] mouse.clicked at LoginButton
        t=1.2s: State "Dashboard" (screenshot 3)

        Transition: Login -> Dashboard (trigger: mouse.clicked@LoginButton)
    """
```

#### Step 6: Persistence
```python
async def save_analysis_results(
    self,
    session_id: UUID,
    states: list[DiscoveredState],
    state_images: list[StateImage],
    transitions: list[StateTransition],
    db: AsyncSession
) -> None:
    """
    Persist analysis results to database.

    Process:
    1. Insert DiscoveredState records
       - Store state_images as JSONB array
       - Store screenshot_ids as UUID array
    2. Insert StateTransition records
       - Link to from_state and to_state
       - Link to trigger input event
    3. Update automation_session.state_discovery_status = 'completed'

    Benefits:
    - Cached results (no re-analysis)
    - Can query states and transitions via SQL
    - Can update/edit states in UI
    """
```

---

### Phase 4: API Endpoints

#### Endpoint 1: Trigger State Discovery
```python
@router.post("/sessions/{session_id}/discover-states")
async def trigger_state_discovery(
    session_id: UUID,
    config: Optional[AnalysisConfig] = None,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_user)
):
    """
    Trigger automated state discovery for a session.

    Request Body:
    {
        "config": {
            "similarity_threshold": 0.90,
            "min_region_size": [20, 20],
            "stability_threshold": 0.95,
            "cooccurrence_threshold": 0.80
        }
    }

    Process:
    1. Verify session belongs to user
    2. Check if already processed (return cached if yes)
    3. Mark session as 'processing'
    4. Call automated_state_discovery_service.discover_states_from_session()
    5. Save results to database
    6. Return AnalysisResult

    Response:
    {
        "session_id": "uuid",
        "states": [...],
        "state_images": [...],
        "transitions": [...],
        "statistics": {
            "totalScreenshots": 120,
            "statesFound": 5,
            "stateImagesFound": 23,
            "processingTime": "2.4s"
        }
    }
    """
```

#### Endpoint 2: Get Discovered States
```python
@router.get("/sessions/{session_id}/discovered-states")
async def get_discovered_states(
    session_id: UUID,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_user)
):
    """
    Get previously discovered states (from database).

    Response:
    {
        "session_id": "uuid",
        "status": "completed",
        "discovered_at": "2025-11-16T12:00:00Z",
        "states": [...],
        "transitions": [...]
    }
    """
```

#### Endpoint 3: Update State Name
```python
@router.patch("/discovered-states/{state_id}")
async def update_discovered_state(
    state_id: UUID,
    update: StateUpdateRequest,  # { name: "Login Page" }
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_user)
):
    """
    Allow user to rename/edit discovered states.
    """
```

#### Endpoint 4: Export to Workflow
```python
@router.post("/sessions/{session_id}/export-workflow")
async def export_discovered_states_to_workflow(
    session_id: UUID,
    project_id: UUID,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_user)
):
    """
    Convert discovered states + transitions into qontinui workflow.

    Process:
    1. Load discovered states and transitions
    2. Generate workflow structure:
       - Each DiscoveredState becomes a workflow state
       - Each StateImage becomes a pattern/image to find
       - Each StateTransition becomes a workflow transition
       - Input events become actions
    3. Create Project workflow in database
    4. Return workflow_id

    Generated Workflow Example:
    {
        "states": [
            {
                "id": "login",
                "name": "Login Page",
                "patterns": [
                    { "image": "LoginForm.png", "x": 100, "y": 200 },
                    { "image": "LoginButton.png", "x": 150, "y": 400 }
                ]
            },
            {
                "id": "dashboard",
                "name": "Dashboard",
                "patterns": [...]
            }
        ],
        "transitions": [
            {
                "from": "login",
                "to": "dashboard",
                "actions": [
                    { "type": "CLICK", "target": "LoginButton" }
                ]
            }
        ]
    }
    """
```

---

### Phase 5: Background Processing (Optional Enhancement)

For large sessions (>500 screenshots), processing may take >30 seconds. Consider background processing:

```python
# Use existing Celery/background worker infrastructure

@celery_app.task
def discover_states_task(session_id: str, config: dict):
    """Background task for state discovery."""
    # Run analysis
    # Update database with results
    # Emit WebSocket notification when complete

# In endpoint:
@router.post("/sessions/{session_id}/discover-states")
async def trigger_state_discovery(...):
    task = discover_states_task.delay(str(session_id), config.dict())
    return {"job_id": task.id, "status": "processing"}
```

---

## Implementation Phases Summary

### Phase 1: Data Pipeline (2 hours)
- Database schema updates (migrations)
- Test with sample data

### Phase 2: Computer Vision Service (8 hours)
- Install `imagehash` library
- Implement perceptual hashing
- Implement stable region extraction
- Test with sample screenshots

### Phase 3: State Discovery Algorithm (12 hours)
- Screenshot clustering
- StateImage extraction
- Co-occurrence analysis
- State assembly
- Transition inference
- Comprehensive testing

### Phase 4: API Endpoints (6 hours)
- Create endpoints
- Request/response schemas
- Authentication/authorization
- Error handling

### Phase 5: Frontend Integration (8 hours)
- Update State Discovery UI to work with session data
- Add "Discover from Session" button
- Display results
- Export to workflow

**Total Estimated Time: 36 hours**

---

## Testing Strategy

### Unit Tests
```python
# test_computer_vision_service.py
def test_perceptual_hash_generation()
def test_screenshot_similarity_calculation()
def test_stable_region_extraction()

# test_automated_state_discovery_service.py
def test_screenshot_clustering()
def test_state_image_extraction()
def test_cooccurrence_matrix()
def test_state_assembly()
def test_transition_inference()
```

### Integration Tests
```python
# test_state_discovery_api.py
async def test_discover_states_from_session()
async def test_get_discovered_states()
async def test_export_to_workflow()
```

### End-to-End Test
```python
async def test_complete_state_discovery_workflow():
    """
    1. Create automation session with sample data
    2. Upload screenshots
    3. Create input events
    4. Trigger state discovery
    5. Verify states discovered correctly
    6. Export to workflow
    7. Verify workflow structure
    """
```

---

## Key Success Criteria

1. **Accuracy:** Discovered states match human intuition
   - "Login" and "Dashboard" are separate states
   - Dynamic content doesn't create false states
   - State boundaries are semantically correct

2. **Performance:** Process 100 screenshots in <10 seconds
   - Perceptual hashing is fast
   - Clustering is efficient
   - Parallel processing where possible

3. **Robustness:** Handle edge cases
   - Sessions with very few screenshots
   - Sessions with many similar states
   - Sessions with scrolling/animations
   - Sessions with dynamic content

4. **Usability:** Results are actionable
   - States have meaningful names (auto-generated or user-editable)
   - Transitions are clear
   - Export to workflow works seamlessly

---

## Future Enhancements

### 1. Machine Learning
- Train CNN to identify state-defining vs decorative elements
- Semantic labeling (detect "login form", "button", "menu")
- Anomaly detection (unusual states)

### 2. Intelligent Naming
- OCR to extract text from StateImages
- Auto-name states based on content ("Login Page", "User Settings")
- Context-aware naming

### 3. State Evolution Tracking
- Detect when UI changes between sessions
- Compare state structures across versions
- Regression detection

### 4. Smart Clustering
- Use deep learning embeddings instead of pHash
- Better handling of scrolled content
- Semantic similarity (not just visual)

### 5. Interactive Refinement
- Allow user to merge/split states
- Adjust confidence thresholds
- Manual StateImage annotation

---

## Risks and Mitigations

### Risk 1: Computer Vision Accuracy
**Risk:** Algorithm doesn't correctly identify states
**Mitigation:**
- Start with conservative thresholds
- Allow manual review and adjustment
- Provide confidence scores
- Support iterative refinement

### Risk 2: Performance on Large Sessions
**Risk:** Analysis takes too long (>1 minute)
**Mitigation:**
- Background processing with progress updates
- Incremental analysis (process new screenshots only)
- Caching and memoization
- Optimize critical algorithms

### Risk 3: Storage for StateImages
**Risk:** Storing StateImage pixel data uses too much space
**Mitigation:**
- Store only pHash (8 bytes) not full pixels
- Store bounding boxes and screenshot references
- Compress StateImage thumbnails
- Clean up old analysis results

### Risk 4: Complex UI Handling
**Risk:** Dynamic UIs (SPAs, animations) confuse algorithm
**Mitigation:**
- Increase stability threshold
- Longer settle time before screenshots
- Manual override options
- Future: Deep learning models

---

## Dependencies

### Python Packages (NEW)
```bash
pip install imagehash==4.3.1
```

### Python Packages (EXISTING)
- Pillow (image processing)
- numpy (numerical operations)
- SQLAlchemy (database)
- FastAPI (endpoints)

### Optional (FUTURE)
```bash
pip install opencv-python  # Advanced CV
pip install scikit-learn   # Clustering algorithms
```

---

## Conclusion

This plan provides a comprehensive approach to automated state discovery that:

1. ✅ **Respects the nuanced nature of states** - Uses computer vision, not just timestamps
2. ✅ **Leverages existing infrastructure** - Builds on current State Discovery UI
3. ✅ **Is implementable in phases** - Can deliver incrementally
4. ✅ **Has clear success criteria** - Testable and measurable
5. ✅ **Allows for future enhancement** - ML/AI integration path is clear

The key insight is that **automated state discovery from sessions requires the same computer vision analysis** as manual State Discovery, just with automation session data as input instead of manual uploads.

**Next Steps:**
1. Review this plan with stakeholders
2. Validate technical approach
3. Prioritize phases
4. Begin Phase 1 implementation

---

**DO NOT IMPLEMENT THIS YET - PLANNING DOCUMENT ONLY**
