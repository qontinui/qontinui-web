# Automated State Discovery - System Architecture

## Overview

This document provides architectural diagrams and visual representations of the automated state structure creation system.

---

## 1. High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        External Recording Tools                      │
│  - Screen capture software                                           │
│  - Browser extensions                                                │
│  - Platform-specific recorders                                       │
└─────────────────────────┬───────────────────────────────────────────┘
                          │ ZIP/JSON upload
                          ▼
┌─────────────────────────────────────────────────────────────────────┐
│                         qontinui-web Frontend                        │
│                                                                       │
│  ┌─────────────────┐  ┌──────────────────┐  ┌──────────────────┐  │
│  │ Upload UI       │  │ Processing       │  │ Review &         │  │
│  │ - File picker   │  │ Monitor          │  │ Edit Interface   │  │
│  │ - Validation    │  │ - Progress bar   │  │ - State graph    │  │
│  │ - Preview       │  │ - Real-time logs │  │ - Frame viewer   │  │
│  └────────┬────────┘  └────────┬─────────┘  └────────┬─────────┘  │
│           │                     │                      │             │
└───────────┼─────────────────────┼──────────────────────┼─────────────┘
            │                     │                      │
            │ HTTP POST           │ WebSocket/Poll       │ HTTP GET/POST
            ▼                     ▼                      ▼
┌─────────────────────────────────────────────────────────────────────┐
│                         qontinui-web Backend                         │
│                                                                       │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │                    Recording Upload API                       │  │
│  │  POST /api/recordings/upload                                  │  │
│  └─────────────────────────┬────────────────────────────────────┘  │
│                              │                                       │
│                              ▼                                       │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │                  Processing Engine (Celery)                   │  │
│  │                                                                │  │
│  │  ┌────────────────┐    ┌────────────────┐                    │  │
│  │  │ Frame Analysis │ -> │ State          │                    │  │
│  │  │ - Clustering   │    │ Identification │                    │  │
│  │  │ - Hashing      │    │ - Naming       │                    │  │
│  │  │ - OCR          │    │ - Properties   │                    │  │
│  │  └────────────────┘    └────────┬───────┘                    │  │
│  │                                  │                            │  │
│  │  ┌────────────────┐    ┌────────▼───────┐                    │  │
│  │  │ Interaction    │ -> │ Transition     │                    │  │
│  │  │ Processing     │    │ Discovery      │                    │  │
│  │  │ - Event parse  │    │ - Workflow gen │                    │  │
│  │  │ - Click detect │    │ - Timing calc  │                    │  │
│  │  └────────────────┘    └────────┬───────┘                    │  │
│  │                                  │                            │  │
│  │                         ┌────────▼───────┐                    │  │
│  │                         │ State Machine  │                    │  │
│  │                         │ Assembly       │                    │  │
│  │                         │ - Dedup        │                    │  │
│  │                         │ - Optimize     │                    │  │
│  │                         │ - Validate     │                    │  │
│  │                         └────────┬───────┘                    │  │
│  └──────────────────────────────────┼────────────────────────────┘  │
│                                      │                               │
│                                      ▼                               │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │                    PostgreSQL Database                        │  │
│  │  - States                                                     │  │
│  │  - Transitions                                                │  │
│  │  - Workflows                                                  │  │
│  │  - Images                                                     │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                       │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │                       S3 Storage                              │  │
│  │  - Frame images                                               │  │
│  │  - Extracted patterns                                         │  │
│  └──────────────────────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────────────────────┘
```

---

## 2. Data Flow Through Processing Pipeline

```
┌────────────────────┐
│  Recording Upload  │
│  (ZIP with frames  │
│   + interactions)  │
└─────────┬──────────┘
          │
          ▼
┌─────────────────────────────────────────────────────────────────────┐
│ PHASE 1: Frame Analysis                                              │
│                                                                       │
│  Frame 0 ───┐                                                        │
│  Frame 1 ───┤                                                        │
│  Frame 2 ───┼─► Perceptual Hash ──► Similarity Matrix               │
│  Frame 3 ───┤                           │                            │
│  Frame ... ─┘                           ▼                            │
│                                   ┌──────────────┐                   │
│                                   │ Hierarchical │                   │
│                                   │  Clustering  │                   │
│                                   └──────┬───────┘                   │
│                                          │                            │
│                                          ▼                            │
│                          Cluster 1: Frames [0,1,5,8,12]              │
│                          Cluster 2: Frames [2,3,4]                   │
│                          Cluster 3: Frames [6,7,9,10,11]             │
│                                                                       │
└─────────────────────────────────┬─────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│ PHASE 2: Visual Element Extraction                                   │
│                                                                       │
│  For each cluster:                                                   │
│                                                                       │
│  ┌───────────────────────────────────────────────────┐              │
│  │ Cluster 1 Frames                                  │              │
│  │  ┌────────┬────────┬────────┐                    │              │
│  │  │Frame 0 │Frame 1 │Frame 5 │                    │              │
│  │  └────────┴────────┴────────┘                    │              │
│  │           │         │         │                   │              │
│  │           └────┬────┴─────────┘                   │              │
│  │                ▼                                   │              │
│  │    ┌──────────────────────┐                       │              │
│  │    │  Pixel Diff Analysis │                       │              │
│  │    └──────────┬───────────┘                       │              │
│  │               │                                    │              │
│  │      ┌────────┴────────┐                          │              │
│  │      ▼                 ▼                          │              │
│  │  Stable            Volatile                       │              │
│  │  Regions           Regions                        │              │
│  │  (StateImages)     (StateRegions)                 │              │
│  │                                                    │              │
│  │  [Logo]            [Content Area]                 │              │
│  │  [Header]          [Dynamic Text]                 │              │
│  │  [Button]          [Loading Spinner]              │              │
│  └───────────────────────────────────────────────────┘              │
│                                                                       │
└─────────────────────────────────┬─────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│ PHASE 3: State Identification                                        │
│                                                                       │
│  Cluster 1 ────► State A: "Login Page"                              │
│    - StateImage: Logo (x:100, y:50, w:200, h:80)                    │
│    - StateImage: "Sign In" button (x:500, y:400, w:120, h:40)       │
│    - StateString: "Welcome Back" (OCR)                               │
│    - StateRegion: Content area (x:300, y:200, w:800, h:400)         │
│                                                                       │
│  Cluster 2 ────► State B: "Loading"                                 │
│    - StateImage: Logo                                                │
│    - StateImage: Spinner (x:600, y:400, w:50, h:50)                 │
│                                                                       │
│  Cluster 3 ────► State C: "Dashboard"                               │
│    - StateImage: Logo                                                │
│    - StateImage: Dashboard icon (x:50, y:100, w:40, h:40)           │
│    - StateImage: User avatar (x:1800, y:20, w:60, h:60)             │
│    - StateString: "Dashboard" (OCR)                                  │
│                                                                       │
└─────────────────────────────────┬─────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│ PHASE 4: Interaction Correlation                                     │
│                                                                       │
│  Timeline:                                                           │
│                                                                       │
│  t=0s    ┌─────────┐                                                │
│  Frame 0 │State A  │ Login Page                                     │
│          └─────────┘                                                 │
│                                                                       │
│  t=5s    [CLICK] (x:650, y:420) "Sign In" button                    │
│                                                                       │
│  t=5.5s  ┌─────────┐                                                │
│  Frame 2 │State B  │ Loading                                        │
│          └─────────┘                                                 │
│                                                                       │
│  t=7s    ┌─────────┐                                                │
│  Frame 6 │State C  │ Dashboard                                      │
│          └─────────┘                                                 │
│                                                                       │
│  Detected Transition:                                                │
│    FROM: State A                                                     │
│    TO: State C (via intermediate State B)                           │
│    TRIGGER: Click on "Sign In" button                                │
│    DURATION: 2 seconds                                               │
│                                                                       │
└─────────────────────────────────┬─────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│ PHASE 5: Workflow Generation                                         │
│                                                                       │
│  Transition: Login_to_Dashboard                                      │
│                                                                       │
│  Workflow: "Execute Login"                                           │
│    Action 1: FILL_TEXT (username field) ──► "user@example.com"      │
│         │                                                             │
│         ▼                                                             │
│    Action 2: FILL_TEXT (password field) ──► "[MASKED]"              │
│         │                                                             │
│         ▼                                                             │
│    Action 3: CLICK (submit button) ──► (650, 420)                   │
│         │                                                             │
│         ▼                                                             │
│    Action 4: WAIT_FOR_STATE ──► "Dashboard" (timeout: 5s)           │
│                                                                       │
└─────────────────────────────────┬─────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│ PHASE 6: State Machine Assembly                                      │
│                                                                       │
│                  ┌─────────┐                                         │
│                  │ State A │                                         │
│                  │ Login   │                                         │
│                  └────┬────┘                                         │
│                       │                                               │
│                       │ Transition 1                                 │
│                       │ Workflow: "Execute Login"                    │
│                       │ Timeout: 5000ms                              │
│                       │                                               │
│                       ▼                                               │
│                  ┌─────────┐                                         │
│                  │ State C │                                         │
│                  │Dashboard│                                         │
│                  └─────────┘                                         │
│                                                                       │
│  Note: State B (Loading) skipped as transient intermediate state    │
│                                                                       │
└───────────────────────────────────────────────────────────────────────┘
```

---

## 3. State Identification Algorithm

```
Input: Array of frames, similarity threshold (default: 0.95)
Output: Array of states

┌──────────────────────────────────────────────────────────────┐
│ Step 1: Generate perceptual hashes                            │
│                                                               │
│  for each frame in frames:                                   │
│    phash[frame] = generate_perceptual_hash(frame)            │
│    features[frame] = extract_features(frame)                 │
│      - color_histogram                                       │
│      - edge_density                                          │
│      - text_regions (OCR)                                    │
│      - ui_elements (object detection)                        │
└─────────────────────────┬─────────────────────────────────────┘
                          │
                          ▼
┌──────────────────────────────────────────────────────────────┐
│ Step 2: Compute similarity matrix                            │
│                                                               │
│  similarity[i][j] = compare_frames(frames[i], frames[j])     │
│                                                               │
│  Similarity Metrics:                                         │
│    - Hamming distance of perceptual hashes                   │
│    - Structural Similarity Index (SSIM)                      │
│    - Feature vector cosine similarity                        │
│                                                               │
│  Combined Score = weighted_average(metrics)                  │
└─────────────────────────┬─────────────────────────────────────┘
                          │
                          ▼
┌──────────────────────────────────────────────────────────────┐
│ Step 3: Hierarchical clustering                              │
│                                                               │
│  clusters = hierarchical_cluster(                            │
│    similarity_matrix,                                        │
│    threshold=0.95,                                           │
│    linkage='average'                                         │
│  )                                                           │
│                                                               │
│  Result: Groups of similar frames                            │
│    Cluster 1: [0, 1, 5, 8, 12]                              │
│    Cluster 2: [2, 3, 4]                                      │
│    Cluster 3: [6, 7, 9, 10, 11]                             │
└─────────────────────────┬─────────────────────────────────────┘
                          │
                          ▼
┌──────────────────────────────────────────────────────────────┐
│ Step 4: Identify stable regions (per cluster)                │
│                                                               │
│  for each cluster in clusters:                               │
│    aligned_frames = align_frames(cluster.frames)             │
│                                                               │
│    for each pixel_region in frame:                           │
│      variance = calculate_variance_across_frames(region)     │
│                                                               │
│      if variance < THRESHOLD:                                │
│        stable_regions.add(region)                            │
│        # This region is consistent -> StateImage candidate   │
│      else:                                                   │
│        volatile_regions.add(region)                          │
│        # This region changes -> StateRegion for context      │
└─────────────────────────┬─────────────────────────────────────┘
                          │
                          ▼
┌──────────────────────────────────────────────────────────────┐
│ Step 5: Extract StateImages from stable regions              │
│                                                               │
│  for each stable_region in stable_regions:                   │
│    # Get bounding box                                        │
│    bbox = find_minimal_bounding_box(stable_region)           │
│                                                               │
│    # Extract image                                           │
│    image = crop_image(representative_frame, bbox)            │
│                                                               │
│    # Calculate properties                                    │
│    state_image = StateImage(                                 │
│      id=generate_uuid(),                                     │
│      name=f"element_{counter}",                              │
│      patterns=[Pattern(                                      │
│        imageId=upload_to_image_library(image),               │
│        searchRegions=[SearchRegion(bbox)],                   │
│        fixed=(position_variance < FIXED_THRESHOLD),          │
│        similarity=0.85                                       │
│      )],                                                     │
│      stabilityScore=calculate_stability(region),             │
│      shared=appears_in_other_clusters(region)                │
│    )                                                         │
└─────────────────────────┬─────────────────────────────────────┘
                          │
                          ▼
┌──────────────────────────────────────────────────────────────┐
│ Step 6: Create State objects                                 │
│                                                               │
│  for each cluster in clusters:                               │
│    # Generate intelligent name                               │
│    name = generate_state_name(cluster)                       │
│      1. Extract text via OCR                                 │
│      2. Analyze window title                                 │
│      3. Detect common patterns (login, dashboard, etc.)      │
│      4. Fallback to "State_001"                              │
│                                                               │
│    # Create state                                            │
│    state = State(                                            │
│      id=generate_uuid(),                                     │
│      name=name,                                              │
│      description=f"Auto-discovered from {len(cluster)} frames",│
│      stateImages=get_unique_state_images(cluster),           │
│      regions=get_volatile_regions(cluster),                  │
│      locations=[], # Populated later from interactions       │
│      strings=extract_text_elements(cluster),                 │
│      position=calculate_canvas_position(cluster_index),      │
│      initial=(cluster_index == 0)                            │
│    )                                                         │
│                                                               │
│    states.append(state)                                      │
│                                                               │
│  return states                                               │
└──────────────────────────────────────────────────────────────┘
```

---

## 4. Transition Discovery Algorithm

```
Input: States, Interactions, Frames
Output: Transitions with Workflows

┌──────────────────────────────────────────────────────────────┐
│ Step 1: Build state timeline                                  │
│                                                               │
│  state_timeline = []                                         │
│  for each frame in frames:                                   │
│    matched_state = match_frame_to_state(frame, states)       │
│    state_timeline.append({                                   │
│      frame_number: frame.number,                             │
│      timestamp: frame.timestamp,                             │
│      state: matched_state                                    │
│    })                                                        │
│                                                               │
│  Result:                                                     │
│    Frame 0-4:   State A                                      │
│    Frame 5-7:   State B                                      │
│    Frame 8-15:  State C                                      │
│    Frame 16-20: State A                                      │
└─────────────────────────┬─────────────────────────────────────┘
                          │
                          ▼
┌──────────────────────────────────────────────────────────────┐
│ Step 2: Detect state changes                                  │
│                                                               │
│  state_changes = []                                          │
│  for i in range(len(state_timeline) - 1):                    │
│    current = state_timeline[i]                               │
│    next = state_timeline[i + 1]                              │
│                                                               │
│    if current.state != next.state:                           │
│      state_changes.append({                                  │
│        from_state: current.state,                            │
│        to_state: next.state,                                 │
│        change_frame: next.frame_number,                      │
│        change_time: next.timestamp                           │
│      })                                                      │
│                                                               │
│  Result:                                                     │
│    Change 1: A -> B at frame 5 (t=2.5s)                     │
│    Change 2: B -> C at frame 8 (t=4.0s)                     │
│    Change 3: C -> A at frame 16 (t=8.0s)                    │
└─────────────────────────┬─────────────────────────────────────┘
                          │
                          ▼
┌──────────────────────────────────────────────────────────────┐
│ Step 3: Find trigger interactions                            │
│                                                               │
│  for each change in state_changes:                           │
│    # Find interactions before state change                   │
│    trigger_window = get_interactions_before(                 │
│      change.change_time,                                     │
│      lookback_seconds=2.0                                    │
│    )                                                         │
│                                                               │
│    # Identify most likely trigger                            │
│    trigger = find_trigger_interaction(trigger_window)       │
│      Priority:                                               │
│        1. Click events (highest priority)                    │
│        2. Key events (Enter, shortcuts)                      │
│        3. Form submission                                    │
│        4. Navigation events                                  │
│                                                               │
│    change.trigger = trigger                                  │
│    change.latency = change.change_time - trigger.timestamp   │
│                                                               │
│  Result:                                                     │
│    Change 1: Triggered by CLICK at (650, 420) "Submit btn"  │
│             Latency: 0.3s                                    │
│    Change 2: Auto-transition (no trigger)                    │
│             Latency: 1.5s                                    │
│    Change 3: Triggered by KEY "Escape"                       │
│             Latency: 0.1s                                    │
└─────────────────────────┬─────────────────────────────────────┘
                          │
                          ▼
┌──────────────────────────────────────────────────────────────┐
│ Step 4: Generate workflows for transitions                    │
│                                                               │
│  for each change in state_changes:                           │
│    # Find all interactions between previous state and trigger│
│    interaction_sequence = get_interactions_between(          │
│      start=previous_state_start_time,                        │
│      end=change.trigger.timestamp                            │
│    )                                                         │
│                                                               │
│    # Convert interactions to actions                         │
│    actions = []                                              │
│    for interaction in interaction_sequence:                  │
│      action = convert_to_action(interaction)                 │
│      # Examples:                                             │
│      #   CLICK -> CLICK action                               │
│      #   KEY type -> FILL_TEXT action                        │
│      #   KEY Enter -> SUBMIT action                          │
│      actions.append(action)                                  │
│                                                               │
│    # Add wait action for target state                        │
│    actions.append(Action(                                    │
│      type='WAIT_FOR_STATE',                                  │
│      targetState=change.to_state,                            │
│      timeout=change.latency * 1.5 + 1000                     │
│    ))                                                        │
│                                                               │
│    # Create workflow                                         │
│    workflow = Workflow(                                      │
│      id=generate_uuid(),                                     │
│      name=f"{change.from_state}_to_{change.to_state}",      │
│      actions=actions,                                        │
│      connections=generate_sequential_connections(actions)    │
│    )                                                         │
│                                                               │
│    change.workflow = workflow                                │
└─────────────────────────┬─────────────────────────────────────┘
                          │
                          ▼
┌──────────────────────────────────────────────────────────────┐
│ Step 5: Create transition objects                            │
│                                                               │
│  transitions = []                                            │
│  for each change in state_changes:                           │
│    # Determine if multi-state activation                     │
│    multi_state = detect_multi_state_scenario(                │
│      change.from_state,                                      │
│      change.to_state                                         │
│    )                                                         │
│                                                               │
│    if multi_state:                                           │
│      # Overlay/modal scenario                                │
│      transition = OutgoingTransition(                        │
│        id=generate_uuid(),                                   │
│        fromState=change.from_state.id,                       │
│        activateStates=[change.to_state.id],                  │
│        staysVisible=True,                                    │
│        workflows=[change.workflow.id],                       │
│        timeout=calculate_timeout(change.latency),            │
│        retryCount=3                                          │
│      )                                                       │
│    else:                                                     │
│      # Normal state transition                               │
│      transition = OutgoingTransition(                        │
│        id=generate_uuid(),                                   │
│        fromState=change.from_state.id,                       │
│        toState=change.to_state.id,                           │
│        staysVisible=False,                                   │
│        workflows=[change.workflow.id],                       │
│        timeout=calculate_timeout(change.latency),            │
│        retryCount=3                                          │
│      )                                                       │
│                                                               │
│    transitions.append(transition)                            │
│                                                               │
│  return transitions                                          │
└──────────────────────────────────────────────────────────────┘
```

---

## 5. Multi-State Detection Logic

```
Decision Tree for State Relationship:

Input: State A (before), State B (after)

                    ┌────────────────────┐
                    │ Compare StateImages │
                    │   A.images vs B.images│
                    └──────────┬───────────┘
                               │
        ┌──────────────────────┼──────────────────────┐
        │                      │                      │
        ▼                      ▼                      ▼
┌───────────────┐    ┌─────────────────┐    ┌───────────────┐
│ B contains    │    │ B shares some   │    │ B completely  │
│ all A images  │    │ A images        │    │ different     │
│ + new images  │    │ (partial overlap)│    │ from A        │
└───────┬───────┘    └────────┬────────┘    └───────┬───────┘
        │                     │                      │
        │                     │                      │
        ▼                     ▼                      ▼
┌───────────────────┐ ┌──────────────────┐ ┌────────────────┐
│ OVERLAY/MODAL     │ │ PARTIAL CHANGE   │ │ FULL CHANGE    │
│                   │ │                  │ │                │
│ A stays active    │ │ Some elements    │ │ Complete       │
│ B activates       │ │ hidden/shown     │ │ replacement    │
│                   │ │                  │ │                │
│ Transition:       │ │ Transition:      │ │ Transition:    │
│  fromState: A     │ │  fromState: A    │ │  fromState: A  │
│  activateStates:  │ │  toState: B      │ │  toState: B    │
│    [B]            │ │  deactivateStates:│ │  staysVisible: │
│  staysVisible:    │ │    [removed]     │ │    false       │
│    true           │ │                  │ │                │
└───────────────────┘ └──────────────────┘ └────────────────┘

Examples:

1. LOGIN PAGE → LOGIN MODAL ERROR
   Login page (A) shows error modal (B) on top
   Result: OVERLAY
   - All login elements still visible
   - Error modal appears
   - Close modal returns to login

2. DASHBOARD → DASHBOARD (scrolled)
   Same state, different scroll position
   Result: NO TRANSITION (same state)
   - Content area is StateRegion (not identifier)
   - Fixed elements (header) unchanged

3. LOGIN → DASHBOARD
   Completely different screens
   Result: FULL CHANGE
   - No shared identifying elements
   - Clear state transition

4. SETTINGS TAB 1 → SETTINGS TAB 2
   Settings page with different tab selected
   Result: PARTIAL CHANGE
   - Shared: Settings header, sidebar
   - Different: Tab content area
   - May be modeled as sub-states or same state with parameter
```

---

## 6. State Machine Optimization

```
┌─────────────────────────────────────────────────────────────┐
│ Input: Raw discovered states & transitions                   │
└───────────────────────┬─────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────┐
│ Optimization 1: Remove transient states                      │
│                                                               │
│  Before:                                                     │
│    Login ──► Loading ──► Dashboard                          │
│                                                               │
│  After:                                                      │
│    Login ──────────────► Dashboard                          │
│         (with wait action for loading)                       │
│                                                               │
│  Criteria for removal:                                       │
│    - State appears for < 1 second                            │
│    - State only appears in transition (not end state)        │
│    - No user interaction occurs in state                     │
└───────────────────────┬─────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────┐
│ Optimization 2: Merge duplicate states                       │
│                                                               │
│  Before:                                                     │
│    Dashboard_1 (discovered at t=10s)                         │
│    Dashboard_2 (discovered at t=120s)                        │
│      -> 95% same StateImages                                 │
│                                                               │
│  After:                                                      │
│    Dashboard (merged)                                        │
│      -> All transitions updated to point to merged state     │
│                                                               │
│  Similarity threshold: > 90%                                 │
└───────────────────────┬─────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────┐
│ Optimization 3: Deduplicate transitions                      │
│                                                               │
│  Before:                                                     │
│    Login ──► Dashboard (discovered at t=10s)                │
│    Login ──► Dashboard (discovered at t=120s)               │
│      -> Same trigger, same workflow                          │
│                                                               │
│  After:                                                      │
│    Login ──► Dashboard (merged transition)                  │
│      -> Timeout = average of both                            │
│      -> Confidence increased (seen multiple times)           │
└───────────────────────┬─────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────┐
│ Optimization 4: Calculate canvas layout                      │
│                                                               │
│  Algorithm: Force-directed graph layout                      │
│                                                               │
│  1. Place initial state at (0, 0)                            │
│  2. Apply forces:                                            │
│     - Repulsion: States push each other apart                │
│     - Attraction: Connected states pull together             │
│     - Gravity: Keep graph centered                           │
│  3. Group related states:                                    │
│     - Same context (window, URL)                             │
│     - High interconnection                                   │
│  4. Minimize edge crossings                                  │
│  5. Adjust for readability                                   │
│                                                               │
│  Result: Visually organized state machine                    │
└───────────────────────┬─────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────┐
│ Output: Optimized state structure ready for review           │
└─────────────────────────────────────────────────────────────┘
```

---

## 7. Frontend Review Interface Flow

```
┌────────────────────────────────────────────────────────────────┐
│                    Review Interface Layout                      │
├────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────────────────────┬───────────────────────────────┐ │
│  │   State Machine Canvas   │    Frame Viewer & Details     │ │
│  │         (Left Panel)     │       (Right Panel)           │ │
│  │                          │                                │ │
│  │  ┌────────┐              │  ┌──────────────────────────┐ │ │
│  │  │State A │              │  │  Frame 0 (Login Page)    │ │ │
│  │  │ Login  │              │  │                          │ │ │
│  │  └───┬────┘              │  │  [Screenshot Preview]    │ │ │
│  │      │                   │  │                          │ │ │
│  │      │ Transition 1      │  │  StateImages:            │ │ │
│  │      │ [View Details]    │  │    ✓ Logo (x:100,y:50)   │ │ │
│  │      ▼                   │  │    ✓ "Sign In" button    │ │ │
│  │  ┌────────┐              │  │    ✓ Input fields        │ │ │
│  │  │State B │              │  │                          │ │ │
│  │  │Dashboard│             │  │  Confidence: 92%         │ │ │
│  │  └────────┘              │  │                          │ │ │
│  │                          │  │  [Edit] [Merge] [Delete] │ │ │
│  │                          │  └──────────────────────────┘ │ │
│  │                          │                                │ │
│  │  Canvas Controls:        │  Frame Timeline:              │ │
│  │  [Zoom In] [Zoom Out]    │  ├─┬─┬─┬─┬─┬─┬─┬─┬─┬─┬─┬─►  │ │
│  │  [Fit to Screen]         │  0 1 2 3 4 5 6 7 8 9 ...      │ │
│  │  [Auto Layout]           │  └─A─┴─A─┴B┴C┴C┴C┴C┴A─┘      │ │
│  │                          │                                │ │
│  └──────────────────────────┴───────────────────────────────┘ │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │                    Action Toolbar                         │ │
│  ├──────────────────────────────────────────────────────────┤ │
│  │  [Accept All] [Accept Selected] [Discard] [Export JSON]  │ │
│  │                                                            │ │
│  │  Stats: 5 states, 7 transitions, 12 StateImages          │ │
│  │  Confidence: High (3), Medium (2), Low (0)                │ │
│  └──────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────┘

User Interaction Flows:

1. Click on State Node:
   ┌──────┐
   │Click │ State A
   └──┬───┘
      │
      ▼
   Right panel shows:
   - All frames belonging to State A
   - StateImages with bounding boxes
   - Confidence score
   - Edit options

2. Click on Transition:
   ┌──────┐
   │Click │ Transition arrow
   └──┬───┘
      │
      ▼
   Right panel shows:
   - Interaction that triggered transition
   - Source frame (before)
   - Target frame (after)
   - Generated workflow actions
   - Timing information
   - Edit transition properties

3. Merge States:
   ┌──────┐
   │Drag  │ State B onto State A
   └──┬───┘
      │
      ▼
   Modal appears:
   "Merge State B into State A?"
   - Shows combined StateImages
   - Lists affected transitions
   - [Confirm] [Cancel]

4. Edit State:
   ┌──────┐
   │Click │ [Edit] button
   └──┬───┘
      │
      ▼
   Edit panel:
   - Rename state
   - Add/remove StateImages
   - Adjust StateRegions
   - Add StateStrings
   - Mark as initial/final
   - [Save] [Cancel]

5. Review Workflow:
   ┌──────┐
   │Click │ Transition details
   └──┬───┘
      │
      ▼
   Workflow viewer:
   Action 1: FILL_TEXT
     Target: username field
     Value: "user@example.com"
   ↓
   Action 2: FILL_TEXT
     Target: password field
     Value: "[MASKED]"
   ↓
   Action 3: CLICK
     Target: submit button
     Coords: (650, 420)
   ↓
   Action 4: WAIT_FOR_STATE
     State: Dashboard
     Timeout: 5000ms

   [Edit Actions] [Test Workflow]
```

---

## 8. Technology Stack

```
┌─────────────────────────────────────────────────────────────┐
│                        Frontend                              │
├─────────────────────────────────────────────────────────────┤
│  - React + TypeScript                                        │
│  - React Flow (state machine canvas)                         │
│  - Tailwind CSS (styling)                                    │
│  - Zustand (state management)                                │
│  - React Query (API calls)                                   │
│  - WebSocket (real-time progress updates)                    │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                        Backend                               │
├─────────────────────────────────────────────────────────────┤
│  - FastAPI (Python)                                          │
│  - Celery (async task processing)                            │
│  - Redis (Celery broker, caching)                            │
│  - PostgreSQL (data storage)                                 │
│  - SQLAlchemy (ORM)                                          │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                   Image Processing                           │
├─────────────────────────────────────────────────────────────┤
│  - OpenCV (computer vision)                                  │
│  - Pillow (image manipulation)                               │
│  - imagehash (perceptual hashing)                            │
│  - scikit-image (SSIM, feature extraction)                   │
│  - Tesseract OCR (text extraction)                           │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                  Machine Learning                            │
├─────────────────────────────────────────────────────────────┤
│  - scikit-learn (clustering)                                 │
│  - NumPy (numerical operations)                              │
│  - SciPy (hierarchical clustering)                           │
│  - (Optional) PyTorch/YOLO (UI element detection)            │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                   Storage & Infra                            │
├─────────────────────────────────────────────────────────────┤
│  - AWS S3 (image storage)                                    │
│  - CloudFront (CDN for images)                               │
│  - Docker (containerization)                                 │
│  - Nginx (reverse proxy)                                     │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                    Graph Processing                          │
├─────────────────────────────────────────────────────────────┤
│  - NetworkX (graph algorithms, layout)                       │
│  - graph-tool (if performance critical)                      │
└─────────────────────────────────────────────────────────────┘
```

---

## 9. Performance Considerations

### Processing Time Estimates (10-minute recording @ 2 fps = 1200 frames)

```
┌──────────────────────────────────────────────────────────────┐
│ Processing Phase          │ Time Estimate │ Bottleneck       │
├───────────────────────────┼───────────────┼──────────────────┤
│ Frame upload              │ 30-60s        │ Network speed    │
│ Perceptual hashing        │ 10-20s        │ CPU (parallel)   │
│ Similarity calculation    │ 30-60s        │ CPU (O(n²))      │
│ Clustering                │ 5-10s         │ CPU              │
│ Stable region detection   │ 20-40s        │ CPU (per cluster)│
│ OCR extraction            │ 60-120s       │ GPU/CPU          │
│ State identification      │ 5-10s         │ CPU              │
│ Interaction processing    │ 5-10s         │ CPU              │
│ Transition discovery      │ 10-20s        │ CPU              │
│ Workflow generation       │ 5-10s         │ CPU              │
│ Graph optimization        │ 2-5s          │ CPU              │
├───────────────────────────┼───────────────┼──────────────────┤
│ TOTAL                     │ 3-6 minutes   │                  │
└──────────────────────────────────────────────────────────────┘

Optimization Strategies:

1. Parallel Processing:
   - Process frame batches in parallel
   - Use multiprocessing for CPU-bound tasks
   - GPU acceleration for image processing

2. Smart Sampling:
   - Reduce frame rate during idle periods
   - Focus processing on interaction-adjacent frames
   - Skip duplicate frames (detected via hashing)

3. Incremental Processing:
   - Stream results as they're ready
   - Show preview states before full completion
   - Allow user to start reviewing early states

4. Caching:
   - Cache perceptual hashes
   - Reuse OCR results for similar regions
   - Store similarity calculations
```

---

## 10. Error Handling & Recovery

```
┌────────────────────────────────────────────────────────────┐
│                    Error Scenarios                          │
└────────────────────────────────────────────────────────────┘

1. Invalid Upload:
   User uploads corrupted file
   → Validation fails
   → Show error: "Invalid file format"
   → Request re-upload

2. Missing Frames:
   Frames 0-10, then jump to frame 20
   → Detect gap in sequence
   → Log warning
   → Continue processing (may miss transition)

3. No Clear States:
   All frames too similar or too different
   → Clustering produces 1 or 100+ clusters
   → Show warning: "Unable to identify distinct states"
   → Offer manual annotation option

4. OCR Failure:
   Text extraction fails for all frames
   → Fall back to image-only identification
   → Log warning
   → Proceed without text-based features

5. Processing Timeout:
   Job runs > 15 minutes
   → Cancel processing
   → Save partial results
   → Offer to resume or retry with reduced frames

6. Out of Memory:
   Too many high-resolution frames
   → Downsample images
   → Process in smaller batches
   → Resume from checkpoint

Recovery Strategy:
- Checkpoint progress every phase
- Allow resume from last checkpoint
- Provide partial results if full processing fails
```

---

## Summary

This architecture provides a robust, scalable system for automated state structure creation from recorded GUI interactions. Key strengths:

- **Modular pipeline**: Each phase independent and testable
- **Intelligent algorithms**: Leverages computer vision and ML for accuracy
- **User-centric design**: Review interface allows human refinement
- **Performance optimized**: Parallel processing, smart sampling
- **Error resilient**: Comprehensive error handling and recovery

Next steps: Begin implementation with Phase 1 (foundation) components.
