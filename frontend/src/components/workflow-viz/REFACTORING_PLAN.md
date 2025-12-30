# Transition Animation System - Refactoring Plan

## Executive Summary

Multiple agents analyzed the transition animation system and found **critical bugs preventing animations from appearing** along with significant **Single Responsibility Principle (SRP) violations**. This plan addresses both immediate fixes and architectural improvements.

---

## Critical Bugs Found

### 1. CRITICAL: Playback Speed Math Bug (Animations run at speed²)

**Location:** `TransitionAnimationController.ts` lines 936-964

**Problem:** Double compensation - elapsed time multiplied by speed AND duration divided by speed.

```typescript
// Current (BROKEN):
const elapsed = (currentTime - this.startTime) * this.state.playbackSpeed;
const phaseDuration = ANIMATION_DURATIONS.phase / this.state.playbackSpeed;
// Result: progress = (elapsed * speed) / (duration / speed) = elapsed * speed² / duration
```

**Fix:** Remove speed from elapsed calculation OR from duration, not both.

### 2. CRITICAL: Integration Disconnect

**Location:** `page.tsx`, `TransitionList.tsx`, `TransitionPlaybackControls.tsx`

**Problem:** The new animation components (TransitionList, TransitionPlaybackControls) are **not connected** to the page. The page uses a legacy playback system.

**Evidence:**

- `TransitionList.onTransitionSelect` callback has no subscribers
- `TransitionPlaybackControls` props don't connect to animation controller
- `page.tsx` uses direct state management instead of animation controller

### 3. CRITICAL: Missing Position Fallbacks

**Location:** `ActionAnimations.ts`

**Problem:** Several animation renderers have no fallback when position data is missing:

- `renderFindAnimation` (line 115): Returns early, no canvasCenter fallback
- `renderDragAnimation` (line 265): Returns early if positions missing
- `renderMouseMoveAnimation` (line 414): Returns early if positions missing

### 4. MAJOR: Incorrect Topological Sort

**Location:** `TransitionAnimationController.ts` lines 208-279

**Problem:** DFS adds nodes BEFORE visiting children (should be after for topological sort).

### 5. MAJOR: Silent Failures Throughout

**Problem:** No logging or error indicators when:

- Action sequence is empty (skips to transitioning-states)
- Position cannot be resolved
- Animation config creation fails

---

## SRP Violations Analysis

### TransitionAnimationController.ts (1170 lines)

**Current Responsibilities (TOO MANY):**

1. Animation state machine (phases, transitions)
2. Animation timing (requestAnimationFrame loop)
3. Playback controls (play, pause, step, speed)
4. Action sequencing (topological sort, branch handling)
5. Coordinate resolution (getStateImagePosition, getStateImageRegion)
6. Image ID resolution (findStateImageByImageAssetId, extractImageIdsFromTarget)
7. Action config building (actionToAnimationConfig)
8. State location lookup (getStateLocationPosition)

**SRP Recommendation:** Split into 5-6 focused modules.

### TransitionAnimationCanvas.tsx (650 lines)

**Current Responsibilities:**

1. Canvas setup and rendering
2. Image loading
3. State visualization
4. Action animation rendering
5. Coordinate transformation
6. Phase indicator display
7. User controls overlay

**SRP Recommendation:** Split into 3-4 focused modules.

### ActionAnimations.ts (827 lines)

**Current Responsibilities:**

1. Animation rendering for 10+ action types
2. Position validation
3. Color/style management
4. Helper functions (drawCornerMarkers, drawArrow)

**SRP Recommendation:** Split by animation category or create base class.

---

## Proposed Architecture

```
src/components/workflow-viz/
├── animation/
│   ├── AnimationStateMachine.ts      # Phase management only
│   ├── AnimationLoop.ts              # requestAnimationFrame timing
│   ├── PlaybackController.ts         # play/pause/step/speed
│   └── types.ts                      # Animation-specific types
│
├── action-sequencing/
│   ├── TopologicalSort.ts            # Graph sorting algorithm
│   ├── ActionSequenceBuilder.ts      # Build animation configs
│   ├── BranchHandler.ts              # IF/SWITCH branch logic
│   └── types.ts
│
├── coordinate-resolution/
│   ├── StateImageResolver.ts         # Find StateImage positions
│   ├── StateLocationResolver.ts      # Find StateLocation positions
│   ├── CoordinateTransformer.ts      # Screen to canvas coords
│   └── MonitorMapper.ts              # Multi-monitor handling
│
├── renderers/
│   ├── BaseActionRenderer.ts         # Abstract base with fallback logic
│   ├── MouseActionRenderer.ts        # CLICK, DRAG, MOUSE_MOVE
│   ├── FindActionRenderer.ts         # FIND, VANISH, RAG_FIND
│   ├── KeyboardActionRenderer.ts     # TYPE, KEY_PRESS, HOTKEY
│   ├── ControlActionRenderer.ts      # GO_TO_STATE, branch indicators
│   ├── NonVisualRenderer.ts          # SET_VARIABLE, CODE_BLOCK, etc.
│   └── index.ts                      # Registry and routing
│
├── canvas/
│   ├── TransitionAnimationCanvas.tsx # Main canvas (thin)
│   ├── useImageLoader.ts             # Image loading hook
│   ├── useCanvasRenderer.ts          # Rendering logic hook
│   ├── StateDrawer.ts                # Draw states with opacity
│   └── PhaseIndicator.ts             # Phase overlay
│
├── controls/
│   ├── TransitionPlaybackControls.tsx
│   ├── TransitionList.tsx
│   └── TransitionDetailsOverlay.tsx
│
├── hooks/
│   ├── useTransitionAnimation.ts     # Main animation hook
│   └── useAnimationState.ts          # State subscription
│
└── index.ts                          # Public exports
```

---

## Implementation Plan

### Phase 1: Fix Critical Bugs (Immediate)

#### 1.1 Fix Playback Speed Math

```typescript
// In AnimationLoop.ts (to be created) or TransitionAnimationController.ts
// Option A: Remove speed from elapsed
const elapsed = currentTime - this.startTime;
const phaseDuration = this.getBasePhaseDuration() / this.state.playbackSpeed;

// OR Option B: Remove speed from duration
const elapsed = (currentTime - this.startTime) * this.state.playbackSpeed;
const phaseDuration = this.getBasePhaseDuration(); // No division
```

#### 1.2 Add Position Fallbacks to All Renderers

```typescript
// In each renderer, ensure canvasCenter fallback:
export function renderFindAnimation(
  ctx: CanvasRenderingContext2D,
  config: ActionAnimationConfig,
  progress: number,
  canvasCenter: { x: number; y: number } // ADD THIS PARAMETER
): void {
  // Use targetRegion if available, otherwise create default at canvasCenter
  const region = config.targetRegion || {
    x: canvasCenter.x - 50,
    y: canvasCenter.y - 25,
    width: 100,
    height: 50,
  };
  // ... rest of rendering
}
```

#### 1.3 Add Debug Logging

```typescript
// In TransitionAnimationCanvas.tsx rendering effect
if (state.phase === "executing-action") {
  const currentAction = animation.currentAction;
  if (!currentAction) {
    console.warn(
      "[TransitionAnimation] Phase is executing-action but no currentAction",
      {
        phase: state.phase,
        globalActionIndex: state.globalActionIndex,
        totalActions: state.totalActions,
        actionSequenceLength: animation.data?.actionSequence?.length,
      }
    );
  }
  // ...
}
```

### Phase 2: Extract Coordinate Resolution (1-2 hours)

Create `coordinate-resolution/StateImageResolver.ts`:

```typescript
export class StateImageResolver {
  constructor(private monitors: Monitor[]) {}

  getPosition(stateImageId: string, states: State[]): Position | undefined {
    // Move logic from TransitionAnimationController.getStateImagePosition
  }

  getRegion(stateImageId: string, states: State[]): Region | undefined {
    // Move logic from TransitionAnimationController.getStateImageRegion
  }

  findByImageAssetId(
    imageAssetId: string,
    states: State[]
  ): string | undefined {
    // Move logic from TransitionAnimationController.findStateImageByImageAssetId
  }
}
```

### Phase 3: Extract Action Sequencing (1-2 hours)

Create `action-sequencing/TopologicalSort.ts`:

```typescript
// FIX THE ALGORITHM: Post-order DFS
export function topologicalSort(
  actions: Action[],
  connections: Connection[]
): Action[] {
  const adjacency = buildAdjacencyList(connections);
  const sorted: Action[] = [];
  const visited = new Set<string>();
  const visiting = new Set<string>();

  function visit(actionId: string) {
    if (visited.has(actionId)) return;
    if (visiting.has(actionId)) return; // Cycle

    visiting.add(actionId);

    // Visit successors FIRST
    const successors = adjacency.get(actionId) || [];
    for (const successor of successors) {
      visit(successor);
    }

    // THEN add to sorted (post-order)
    const action = actions.find((a) => a.id === actionId);
    if (action) {
      sorted.push(action);
      visited.add(actionId);
    }

    visiting.delete(actionId);
  }

  // Find entry points and visit
  const entryIds = findEntryActions(actions, connections);
  for (const id of entryIds) {
    visit(id);
  }

  return sorted.reverse(); // Reverse for correct order
}
```

### Phase 4: Extract Renderers (2-3 hours)

Create base renderer with consistent fallback handling:

```typescript
// renderers/BaseActionRenderer.ts
export abstract class BaseActionRenderer {
  abstract canRender(config: ActionAnimationConfig): boolean;
  abstract render(
    ctx: CanvasRenderingContext2D,
    config: ActionAnimationConfig,
    progress: number,
    canvasCenter: Position
  ): void;

  protected getPositionWithFallback(
    config: ActionAnimationConfig,
    canvasCenter: Position
  ): Position {
    return config.endPosition || canvasCenter;
  }

  protected getRegionWithFallback(
    config: ActionAnimationConfig,
    canvasCenter: Position,
    defaultSize = { width: 100, height: 50 }
  ): Region {
    return (
      config.targetRegion || {
        x: canvasCenter.x - defaultSize.width / 2,
        y: canvasCenter.y - defaultSize.height / 2,
        ...defaultSize,
      }
    );
  }
}
```

### Phase 5: Extract Animation State Machine (2-3 hours)

Create focused state machine:

```typescript
// animation/AnimationStateMachine.ts
export type AnimationPhase =
  | "idle"
  | "showing-initial"
  | "executing-action"
  | "transitioning-states"
  | "showing-final"
  | "completed";

export class AnimationStateMachine {
  private phase: AnimationPhase = "idle";
  private actionIndex = 0;
  private totalActions = 0;

  constructor(private onPhaseChange: (phase: AnimationPhase) => void) {}

  start(totalActions: number): void {
    this.totalActions = totalActions;
    this.actionIndex = 0;
    this.transition("showing-initial");
  }

  advancePhase(): void {
    switch (this.phase) {
      case "showing-initial":
        this.transition(
          this.totalActions > 0 ? "executing-action" : "transitioning-states"
        );
        break;
      case "executing-action":
        if (this.actionIndex < this.totalActions - 1) {
          this.actionIndex++;
        } else {
          this.transition("transitioning-states");
        }
        break;
      case "transitioning-states":
        this.transition("showing-final");
        break;
      case "showing-final":
        this.transition("completed");
        break;
    }
  }

  private transition(newPhase: AnimationPhase): void {
    this.phase = newPhase;
    this.onPhaseChange(newPhase);
  }
}
```

### Phase 6: Fix Integration (1-2 hours)

Wire up TransitionList and TransitionPlaybackControls:

```typescript
// In page.tsx or parent component
const animation = useTransitionAnimation();

const handleTransitionSelect = useCallback((transition: Transition | null) => {
  setSelectedTransition(transition);
  if (transition) {
    animation.loadTransition(transition, states, workflows, monitors);
  } else {
    animation.cancel();
  }
}, [states, workflows, monitors, animation]);

return (
  <>
    <TransitionList
      transitions={transitions}
      selectedTransition={selectedTransition}
      onTransitionSelect={handleTransitionSelect}
    />
    <TransitionPlaybackControls
      animationState={animation.state}
      onPlay={animation.play}
      onPause={animation.pause}
      onStepForward={animation.stepForward}
      onStepBackward={animation.stepBackward}
      onSpeedChange={animation.setSpeed}
      onReset={animation.reset}
    />
    <TransitionAnimationCanvas
      animation={animation}
      states={states}
      workflows={workflows}
      monitors={monitors}
      images={images}
    />
  </>
);
```

---

## Testing Strategy

### Unit Tests Needed

1. `TopologicalSort` - various graph structures
2. `StateImageResolver` - position resolution with/without data
3. `AnimationStateMachine` - phase transitions
4. Each renderer - with and without position data

### Integration Tests

1. Select transition → load → play → complete cycle
2. Multi-monitor coordinate handling
3. Empty action sequence handling
4. Branch visualization

### Manual Testing

1. Test with real project data
2. Verify animations appear at correct positions
3. Test playback speed (should be linear, not quadratic)
4. Test pause/resume
5. Test step forward/backward

---

## Priority Order

| Priority | Task                                | Effort  | Impact                   |
| -------- | ----------------------------------- | ------- | ------------------------ |
| P0       | Fix playback speed math bug         | 15 min  | Fixes animation timing   |
| P0       | Add position fallbacks to renderers | 30 min  | Fixes missing animations |
| P0       | Add debug logging                   | 30 min  | Enables debugging        |
| P1       | Fix integration wiring              | 1 hour  | Makes feature work       |
| P1       | Fix topological sort                | 1 hour  | Fixes action order       |
| P2       | Extract coordinate resolution       | 2 hours | Improves maintainability |
| P2       | Extract action sequencing           | 2 hours | Improves maintainability |
| P3       | Extract renderers                   | 3 hours | Improves extensibility   |
| P3       | Extract state machine               | 2 hours | Improves testability     |

---

## Files to Modify/Create

### Modify (Bug Fixes)

- `TransitionAnimationController.ts` - Fix speed math, improve logging
- `ActionAnimations.ts` - Add canvasCenter fallback to all renderers
- `TransitionAnimationCanvas.tsx` - Add debug logging
- `page.tsx` - Wire up TransitionList and TransitionPlaybackControls

### Create (Refactoring)

- `animation/AnimationStateMachine.ts`
- `animation/AnimationLoop.ts`
- `animation/PlaybackController.ts`
- `action-sequencing/TopologicalSort.ts`
- `action-sequencing/ActionSequenceBuilder.ts`
- `coordinate-resolution/StateImageResolver.ts`
- `coordinate-resolution/CoordinateTransformer.ts`
- `renderers/BaseActionRenderer.ts`
- `renderers/MouseActionRenderer.ts`
- `renderers/FindActionRenderer.ts`
- `renderers/KeyboardActionRenderer.ts`
- `renderers/ControlActionRenderer.ts`

---

## Success Criteria

1. Animations appear at correct positions (not center, not missing)
2. Playback speed is linear (not quadratic)
3. All action types render with fallback when position missing
4. Debug logging helps identify issues
5. Each module has single responsibility
6. Unit tests pass for extracted modules
7. Integration between components works end-to-end
