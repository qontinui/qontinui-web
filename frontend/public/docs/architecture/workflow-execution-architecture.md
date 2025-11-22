# Workflow Execution Pipeline Architecture

**Version:** 2.0.0
**Last Updated:** 2025-11-18
**Status:** Active

## Overview

This document describes the complete architecture of the Qontinui Workflow Execution Pipeline, from workflow design and configuration export through graph-based execution and state machine navigation. The system supports both mock execution (for testing) and real execution via the qontinui-runner.

## Key Components

- **export-schema.ts**: Defines the JSON configuration structure for workflows, actions, states, and transitions
- **Workflow Builder**: React Flow-based visual editor for creating and editing workflows
- **Graph Algorithms**: Dependency analysis, cycle detection, and topological sorting
- **Dagre**: Hierarchical graph layout algorithm for auto-arranging workflow nodes
- **@xyflow/react**: Interactive node-based workflow visualization
- **Mock Execution Engine**: Browser-based testing using captured screenshots and state transitions
- **qontinui-runner**: Desktop application that executes workflows using the qontinui Python library
- **State Machine**: Model-based navigation between application states using transitions

## Architecture Diagram

```mermaid
graph TB
    subgraph "1. WORKFLOW BUILDING"
        A1[User Creates Workflow]
        A2[WorkflowCanvas Component]
        A3["@xyflow/react ReactFlow"]
        A4[Node Palette]
        A5[Node Types Registry]

        A1 --> A2
        A2 --> A3
        A2 --> A4
        A4 --> A5

        style A1 fill:#e3f2fd
        style A2 fill:#bbdefb
        style A3 fill:#90caf9
        style A4 fill:#bbdefb
        style A5 fill:#90caf9
    end

    subgraph "2. GRAPH VALIDATION & ANALYSIS"
        B1[Dependency Analyzer]
        B2[Cycle Detection]
        B3[Topological Sort]
        B4[Validation Rules]
        B5[Error Detection]

        B1 --> B2
        B2 --> B3
        B1 --> B4
        B4 --> B5

        style B1 fill:#fff3e0
        style B2 fill:#ffe0b2
        style B3 fill:#ffcc80
        style B4 fill:#ffe0b2
        style B5 fill:#ffcc80
    end

    subgraph "3. LAYOUT & VISUALIZATION"
        C1[Dagre Layout Engine]
        C2[Auto-Layout Algorithm]
        C3[Position Calculation]
        C4[React Flow Rendering]

        C1 --> C2
        C2 --> C3
        C3 --> C4

        style C1 fill:#f3e5f5
        style C2 fill:#e1bee7
        style C3 fill:#ce93d8
        style C4 fill:#ba68c8
    end

    subgraph "4. CONFIG EXPORT"
        D1[export-schema.ts]
        D2[QontinuiConfig Interface]
        D3[Workflow Structure]
        D4[Action Definitions]
        D5[Connection Graph]
        D6[State & Transition Data]
        D7[Image Assets Base64]
        D8[JSON Validation]

        D1 --> D2
        D2 --> D3
        D3 --> D4
        D4 --> D5
        D2 --> D6
        D2 --> D7
        D2 --> D8

        style D1 fill:#e8f5e9
        style D2 fill:#c8e6c9
        style D3 fill:#a5d6a7
        style D4 fill:#a5d6a7
        style D5 fill:#a5d6a7
        style D6 fill:#a5d6a7
        style D7 fill:#a5d6a7
        style D8 fill:#81c784
    end

    subgraph "5A. MOCK EXECUTION PATH"
        E1[useMockExecution Hook]
        E2[Integration Testing Service]
        E3[Mock Executor Python]
        E4[Captured Screenshots]
        E5[State Pattern Matching]
        E6[Action Simulation]
        E7[State Transitions]
        E8[Execution Visualization]

        E1 --> E2
        E2 --> E3
        E3 --> E4
        E4 --> E5
        E5 --> E6
        E6 --> E7
        E7 --> E8

        style E1 fill:#fce4ec
        style E2 fill:#f8bbd0
        style E3 fill:#f48fb1
        style E4 fill:#f06292
        style E5 fill:#f06292
        style E6 fill:#f06292
        style E7 fill:#f06292
        style E8 fill:#ec407a
    end

    subgraph "5B. QONTINUI-RUNNER EXECUTION PATH"
        F1[qontinui-runner Desktop App]
        F2[Tauri Rust Backend]
        F3[Python Bridge]
        F4[qontinui_executor.py]
        F5[ConfigParser]
        F6[GraphExecutor]
        F7[GraphTraverser]
        F8[Action Executor]
        F9[HAL Hardware Control]
        F10[Computer Vision]
        F11[State Discovery]
        F12[Event Streaming]

        F1 --> F2
        F2 --> F3
        F3 --> F4
        F4 --> F5
        F5 --> F6
        F6 --> F7
        F7 --> F8
        F8 --> F9
        F8 --> F10
        F8 --> F11
        F4 --> F12

        style F1 fill:#e0f2f1
        style F2 fill:#b2dfdb
        style F3 fill:#80cbc4
        style F4 fill:#4db6ac
        style F5 fill:#26a69a
        style F6 fill:#26a69a
        style F7 fill:#26a69a
        style F8 fill:#009688
        style F9 fill:#00897b
        style F10 fill:#00897b
        style F11 fill:#00897b
        style F12 fill:#00796b
    end

    subgraph "6. GRAPH EXECUTION ENGINE"
        G1[Entry Point Detection]
        G2[Sequential BFS Traversal]
        G3[Connection Router]
        G4[Branch Handling]
        G5[Loop Detection]
        G6[Error Handling]

        G1 --> G2
        G2 --> G3
        G3 --> G4
        G3 --> G5
        G3 --> G6

        style G1 fill:#fff9c4
        style G2 fill:#fff59d
        style G3 fill:#fff176
        style G4 fill:#ffee58
        style G5 fill:#ffee58
        style G6 fill:#ffee58
    end

    subgraph "7. STATE MACHINE NAVIGATION"
        H1[State Discovery]
        H2[State Identification]
        H3[Transition Manager]
        H4[Outgoing Transitions]
        H5[Incoming Transitions]
        H6[Transition Workflows]
        H7[State Verification]
        H8[Path Planning]

        H1 --> H2
        H2 --> H3
        H3 --> H4
        H3 --> H5
        H4 --> H6
        H5 --> H6
        H6 --> H7
        H2 --> H8

        style H1 fill:#e1f5fe
        style H2 fill:#b3e5fc
        style H3 fill:#81d4fa
        style H4 fill:#4fc3f7
        style H5 fill:#4fc3f7
        style H6 fill:#29b6f6
        style H7 fill:#03a9f4
        style H8 fill:#039be5
    end

    subgraph "8. ACTION EXECUTION"
        I1[Action Config]
        I2[Target Resolution]
        I3[Pattern Matching]
        I4[Main Path]
        I5[Success Path]
        I6[Error Path]
        I7[Result Collection]
        I8[State Updates]

        I1 --> I2
        I2 --> I3
        I3 --> I4
        I4 --> I5
        I4 --> I6
        I5 --> I7
        I6 --> I7
        I7 --> I8

        style I1 fill:#f1f8e9
        style I2 fill:#dcedc8
        style I3 fill:#c5e1a5
        style I4 fill:#aed581
        style I5 fill:#9ccc65
        style I6 fill:#9ccc65
        style I7 fill:#8bc34a
        style I8 fill:#7cb342
    end

    %% Cross-subgraph connections - Workflow Building to Validation
    A3 --> B1
    A5 --> B4

    %% Validation to Layout
    B3 --> C1

    %% Layout to Export
    C4 --> D1

    %% Export to Mock Execution
    D8 --> E1

    %% Export to Runner Execution
    D8 --> F1

    %% Mock Execution to Graph Engine
    E3 --> G1

    %% Runner Execution to Graph Engine
    F6 --> G1

    %% Graph Engine to State Machine
    G3 --> H3

    %% State Machine to Action Execution
    H6 --> I1

    %% Action Execution back to Graph Engine
    I8 --> G2

    %% Action Execution to State Machine
    I8 --> H2

    %% Feedback loops
    E8 -.Mock Results.-> A2
    F12 -.Real-time Events.-> F1
    I7 -.Action Results.-> G3

    classDef building fill:#e3f2fd,stroke:#1976d2,stroke-width:2px
    classDef validation fill:#fff3e0,stroke:#f57c00,stroke-width:2px
    classDef layout fill:#f3e5f5,stroke:#7b1fa2,stroke-width:2px
    classDef export fill:#e8f5e9,stroke:#388e3c,stroke-width:2px
    classDef mock fill:#fce4ec,stroke:#c2185b,stroke-width:2px
    classDef runner fill:#e0f2f1,stroke:#00796b,stroke-width:2px
    classDef graph fill:#fff9c4,stroke:#f9a825,stroke-width:2px
    classDef state fill:#e1f5fe,stroke:#0277bd,stroke-width:2px
    classDef action fill:#f1f8e9,stroke:#689f38,stroke-width:2px
```

## Component Responsibilities

### 1. Workflow Building

**WorkflowCanvas Component** (`frontend/src/components/workflow-canvas/WorkflowCanvas.tsx`)
- Provides visual graph editor using @xyflow/react
- Manages nodes (actions) and edges (connections)
- Supports drag-and-drop from node palette
- Real-time validation and error highlighting
- Keyboard shortcuts (Ctrl+L for auto-layout, Delete for removal)

**Node Types Registry** (`frontend/src/components/workflow-canvas/nodes/`)
- DefaultNode: Generic action representation
- ControlFlowNodes: IF, LOOP, SWITCH, TRY_CATCH, BREAK, CONTINUE
- Each node type defines custom handles for branching

**Responsibilities:**
- User interaction and workflow design
- Visual feedback and UX
- Node positioning and connections
- Canvas state management

### 2. Graph Validation & Analysis

**Dependency Analyzer** (`frontend/src/services/workflow-dependency-analyzer.ts`)
- Builds dependency graph from workflow connections
- Detects circular dependencies using DFS
- Calculates in-degree and out-degree for each node
- Identifies root workflows (no dependencies) and leaf workflows (no dependents)
- Generates impact analysis for workflow changes

**Cycle Detection Algorithm:**
```typescript
// Depth-first search with recursion stack
function detectCycles(graph: DependencyGraph): string[][] {
  const visited = new Set();
  const recStack = new Set();
  const cycles = [];

  for (const node of graph.nodes) {
    if (!visited.has(node.id)) {
      dfs(node.id, visited, recStack, cycles);
    }
  }

  return cycles;
}
```

**Topological Sort:**
- Orders actions based on dependencies
- Ensures parent actions execute before children
- Used by GraphExecutor to determine execution order

**Responsibilities:**
- Ensure graph validity
- Detect impossible execution paths
- Provide dependency metrics
- Support visualization of dependencies

### 3. Layout & Visualization

**Dagre Layout Engine** (`frontend/src/lib/layout-utils.ts`)
- Hierarchical graph layout algorithm
- Positions nodes based on dependencies
- Minimizes edge crossings
- Supports TB (top-bottom), LR (left-right), BT, RL directions

**Layout Options:**
```typescript
interface LayoutOptions {
  direction: 'TB' | 'LR' | 'BT' | 'RL';
  nodeWidth: number;      // Default: 200
  nodeHeight: number;     // Default: 150
  nodeSep: number;        // Default: 50 (horizontal spacing)
  rankSep: number;        // Default: 100 (vertical spacing)
}
```

**Responsibilities:**
- Auto-arrange workflow nodes
- Calculate optimal positions
- Minimize visual clutter
- Support different layout directions

### 4. Config Export

**export-schema.ts** (`frontend/src/lib/export-schema.ts`)
- Defines TypeScript interfaces for JSON export format
- Version 2.0.0 schema with graph-based workflows
- Comprehensive action configuration options
- State, transition, and image asset definitions
- JSON Schema validation for runtime checking

**QontinuiConfig Structure:**
```typescript
interface QontinuiConfig {
  version: string;                    // "2.0.0"
  metadata: ConfigMetadata;           // Author, created, modified
  images: ImageAsset[];               // Base64-encoded images
  workflows: Workflow[];              // Graph-format workflows
  states: State[];                    // Application states
  transitions: Transition[];          // State transitions
  categories: string[];               // Workflow categories
  settings?: ConfigSettings;          // Execution settings
  schedules?: Schedule[];             // Automated schedules
}

interface Workflow {
  id: string;
  name: string;
  format: 'graph';                    // Always 'graph' in v2.0.0
  actions: Action[];                  // Workflow actions
  connections: WorkflowConnections;   // Graph connections
  metadata?: WorkflowMetadata;        // View mode, timestamps
}

interface WorkflowConnections {
  [actionId: string]: ActionOutputs;  // Connections from each action
}

interface ActionOutputs {
  main?: Connection[][];      // Default execution path
  success?: Connection[][];   // Success path
  error?: Connection[][];     // Error handling path
  true?: Connection[][];      // IF condition true
  false?: Connection[][];     // IF condition false
  [key: string]: Connection[][] | undefined;  // SWITCH cases
}

interface Connection {
  action: string;   // Target action ID
  type: string;     // Connection type
  index: number;    // Input index on target
}
```

**Responsibilities:**
- Define canonical config structure
- Ensure type safety with TypeScript
- Provide validation schemas
- Support backward compatibility via migration system

### 5A. Mock Execution Path

**useMockExecution Hook** (`frontend/src/hooks/useMockExecution.ts`)
- React hook for triggering mock execution
- Manages execution state (loading, result, error)
- Calls integration testing API

**Mock Executor** (`qontinui/src/qontinui/mock/mock_executor.py`)
- Simulates workflow execution using captured screenshots
- Pattern matching against recorded state images
- Deterministic state transitions
- No real mouse/keyboard interaction

**Mock Execution Flow:**
```
1. Load workflow config
2. Load captured screenshots from snapshot runs
3. For each action:
   a. Find current state screenshots
   b. Pattern match target image
   c. Simulate action (no real execution)
   d. Update state based on transition rules
   e. Capture results for visualization
4. Return execution visualization data
```

**Responsibilities:**
- Fast testing without real execution
- Validate workflows before deployment
- Generate execution visualizations
- Support integration testing

### 5B. qontinui-runner Execution Path

**qontinui-runner Desktop App** (`qontinui-runner/`)
- Tauri-based cross-platform desktop application
- Native file picker for loading configs
- Real-time execution monitoring
- Event streaming via WebSocket

**Rust Backend** (`qontinui-runner/src-tauri/`)
- File I/O and system integration
- Spawns Python subprocess
- IPC with React frontend
- Log aggregation

**Python Bridge** (`qontinui-runner/python-bridge/`)
- `qontinui_executor.py`: Entry point for execution
- Bridges Tauri <-> qontinui library
- Event translation (qontinui events -> Tauri events)
- Real-time progress reporting

**qontinui Library** (`qontinui/src/qontinui/`)
- Computer vision (OpenCV, YOLO, transformers)
- HAL for mouse/keyboard control
- State discovery and management
- Action execution

**Execution Flow:**
```
1. User selects config in qontinui-runner
2. Tauri loads JSON and validates
3. Spawns Python subprocess with qontinui_executor.py
4. ConfigParser parses JSON config
5. GraphExecutor initializes execution
6. GraphTraverser finds entry points
7. For each action in traversal order:
   a. Action executor resolves targets
   b. Computer vision finds patterns
   c. HAL performs mouse/keyboard actions
   d. State manager updates current state
   e. Event emitted to Tauri frontend
8. Return execution summary
```

**Responsibilities:**
- Real automation execution
- Computer vision and AI
- Hardware interaction
- Production workflow runs

### 6. Graph Execution Engine

**GraphExecutor** (`qontinui/src/qontinui/execution/graph_executor.py`)
- Orchestrates workflow execution
- Manages execution state (pending, executing, completed, failed, skipped)
- Delegates to GraphTraverser and ConnectionRouter
- Execution hooks for monitoring
- **Sequential execution model** (appropriate for GUI automation)

**GraphTraverser** (`qontinui/src/qontinui/execution/graph_traverser.py`)
- Finds entry points (actions with no incoming connections)
- Finds exit points (actions with no outgoing connections)
- Cycle detection using DFS
- Validates workflow structure
- Sequential BFS traversal (one action at a time)

**ConnectionRouter** (`qontinui/src/qontinui/execution/connection_router.py`)
- Routes execution based on action results
- Handles branching (IF, SWITCH)
- Manages success/error paths
- Sequential path routing for GUI automation

**Execution Order Determination:**
```
1. Find all entry points
2. Initialize execution queue with entry points
3. While queue not empty:
   a. Dequeue next action
   b. Check if ready to execute (all dependencies completed)
   c. Execute action sequentially
   d. Route to next actions based on result
   e. Add next actions to queue
4. Detect and break infinite loops
```

**Note:** All actions execute sequentially because GUI automation requires exclusive access to the mouse, keyboard, and screen. Only FIND actions can search for multiple patterns concurrently (using internal parallelism).

**Responsibilities:**
- Determine execution order
- Handle control flow
- Manage execution state
- Detect and prevent infinite loops

### 7. State Machine Navigation

**State Discovery** (`qontinui/src/qontinui/state_management/`)
- Automatic state detection from screenshots
- Pattern-based state identification
- State transition tracking

**Transition Manager** (`frontend/src/contexts/automation-context/transition-manager.ts`)
- Manages state transitions
- Executes transition workflows
- Validates transitions
- Supports both outgoing and incoming transitions

**Transition Types:**
- **OutgoingTransition**: From state A to state B
- **IncomingTransition**: Entry into state (triggered after outgoing transitions)

**State Verification:**
```python
def verify_state(expected_states: List[str]) -> bool:
    """Verify current state matches expected states."""
    current_states = get_active_states()
    return all(state in current_states for state in expected_states)
```

**Path Planning:**
- Finds shortest path between states using BFS
- Executes transition workflows in sequence
- Verifies each state after transition

**Responsibilities:**
- Model-based navigation
- State verification
- Transition execution
- Path planning

### 8. Action Execution

**Action Executor** (`qontinui/src/qontinui/action_executors/`)
- DelegatingActionExecutor: Routes to specialized executors
- FindActionExecutor: Pattern matching
- MouseActionExecutor: Click, drag, scroll
- KeyboardActionExecutor: Type, key press
- NavigationActionExecutor: GO_TO_STATE

**Target Resolution:**
```
1. Parse action config
2. Resolve target (image, text, coordinates, region)
3. If image target:
   a. Load image from assets
   b. Apply search regions
   c. Pattern match with similarity threshold
   d. Return match location
4. If text target:
   a. Run OCR on screen
   b. Find text matches
   c. Return text location
5. Apply match adjustments (offset, size)
```

**Pattern Matching:**
- Template matching (OpenCV)
- Feature detection (SIFT, SURF)
- AI-based detection (YOLO, transformers)
- OCR (EasyOCR, Tesseract)

**Connection Types:**
- **main**: Default execution path
- **success**: Taken when action succeeds
- **error**: Taken when action fails
- **parallel**: Execute multiple branches simultaneously
- **true/false**: Conditional branching (IF actions)
- **case_N**: Switch cases (SWITCH actions)

**Responsibilities:**
- Execute individual actions
- Resolve targets
- Perform computer vision
- Control hardware
- Return results

## Error Handling Strategy

### Validation Errors (Pre-execution)
- Circular dependencies detected → Block execution
- Missing workflows → Show error message
- Invalid connections → Highlight problematic edges
- Type mismatches → Display validation errors

### Runtime Errors (During execution)

**Error Paths:**
```typescript
// Action with error handling
action: {
  id: "action1",
  type: "FIND",
  config: { ... }
}

connections: {
  "action1": {
    success: [[{ action: "action2", type: "main", index: 0 }]],
    error: [[{ action: "error_handler", type: "error", index: 0 }]]
  }
}
```

**Error Handling Options:**
- **continueOnError**: Skip failed action, continue workflow
- **retryCount**: Retry action N times before failing
- **timeout**: Maximum execution time per action
- **error connections**: Route to error handler action

### Recovery Strategies
1. **Retry with exponential backoff**
2. **Fallback to alternative actions**
3. **Skip and log error**
4. **Abort workflow execution**
5. **User intervention (pause and wait)**

## Performance Optimizations

### Frontend
- React Flow viewport virtualization (only render visible nodes)
- Memoization with useMemo/useCallback
- Debounced auto-save
- Lazy loading of node details

### Backend
- Parallel action execution where possible
- Image asset caching
- Connection pooling for database
- Batch state updates

### Graph Execution
- Topological sort to minimize dependencies
- Early termination on critical failures
- Skip unnecessary validation in production
- Cache compiled action configurations

## Security Considerations

### Config Validation
- JSON Schema validation before execution
- Sanitize user inputs in action configs
- Validate image data is base64-encoded
- Check file paths for traversal attacks

### Execution Sandboxing
- qontinui-runner runs in isolated process
- Limited file system access
- No arbitrary code execution
- Validated action types only

### State Machine
- Verify transitions are valid
- Prevent state injection
- Authenticate transition triggers
- Audit state changes

## Monitoring & Observability

### Execution Events
```typescript
// Event types emitted during execution
- execution_started
- action_started
- action_completed
- action_failed
- workflow_started
- workflow_completed
- state_changed
- match_found
- screenshot_taken
- execution_completed
- error
```

### Metrics Collected
- Total execution time
- Actions completed/failed/skipped
- State transitions count
- Pattern match scores
- Error rates
- Dependency depth
- Graph complexity

### Logging
- Structured logs with context
- Action-level granularity
- State transition logs
- Error stack traces
- Performance metrics

## Future Enhancements

### Planned Features
1. **Conditional loops** - Loop until condition met (WHILE, DO-WHILE)
2. **Subworkflows** - Reusable workflow components
3. **Dynamic branching** - SWITCH with dynamic cases
4. **Workflow versioning** - Track and rollback changes
5. **Execution replay** - Debug by replaying past executions
6. **Cloud execution** - Execute workflows in cloud environment

**Note:** Parallel execution and distributed execution are intentionally excluded because GUI automation requires sequential control of mouse, keyboard, and screen. Only pattern matching (FIND actions) benefits from internal parallelism.

### Under Consideration
- Visual debugging with breakpoints
- Live variable inspection
- A/B testing for workflows
- Machine learning for pattern matching optimization
- Natural language workflow generation

## References

### Documentation
- [export-schema.ts](../../frontend/src/lib/export-schema.ts) - Config schema definition
- [WorkflowCanvas.tsx](../../frontend/src/components/workflow-canvas/WorkflowCanvas.tsx) - Visual editor
- [workflow-dependency-analyzer.ts](../../frontend/src/services/workflow-dependency-analyzer.ts) - Dependency analysis
- [graph_executor.py](../../../qontinui/src/qontinui/execution/graph_executor.py) - Execution engine
- [graph_traverser.py](../../../qontinui/src/qontinui/execution/graph_traverser.py) - Graph traversal
- [qontinui_executor.py](../../../qontinui-runner/python-bridge/qontinui_executor.py) - Runner integration

### External Libraries
- [@xyflow/react](https://reactflow.dev/) - Workflow visualization
- [Dagre](https://github.com/dagrejs/dagre) - Graph layout
- [Tauri](https://tauri.app/) - Desktop application framework
- [OpenCV](https://opencv.org/) - Computer vision
- [PyTorch](https://pytorch.org/) - Deep learning

## Changelog

### Version 2.0.0 (2025-11-18)
- Initial architecture document
- Complete workflow execution pipeline
- Mock and runner execution paths
- State machine navigation
- Error handling strategy
- Performance optimizations

---

**Maintained by:** Qontinui Development Team
**Questions?** See [main documentation](../README.md)
