# Verify Workflow States

This directory contains components for visualizing and verifying workflow state transitions.

## Purpose

The Verify Workflow States feature allows users to step through a workflow and visualize which states are active at each step. This helps with:

- Understanding state transitions in workflows
- Verifying that states are activated/deactivated correctly
- Debugging workflow state management
- Visualizing the composite UI at each workflow step

## Key Concept

**Multiple states can be active simultaneously.** The visualization shows ALL active states with their elements (images, regions, locations) at their fixed positions, potentially overlapping to demonstrate the complete UI state.

## Components

### WorkflowStepList

- Displays workflow steps (actions) in a scrollable list
- Highlights the currently selected step
- Shows action type icons and names
- Located in left sidebar

**Props:**

```typescript
interface WorkflowStepListProps {
  workflow: Workflow;
  currentStep: number;
  onStepSelect: (step: number) => void;
}
```

### ActiveStatesVisualizer

- Renders multiple active states on a canvas
- Shows state elements at fixed positions
- Supports zoom and pan for navigation
- Displays color-coded overlays for different states

**Props:**

```typescript
interface ActiveStatesVisualizerProps {
  activeStates: State[];
  canvasSize: { width: number; height: number };
  showStateLabels?: boolean;
}
```

**Features:**

- Canvas-based rendering with zoom/pan controls
- Grid background for position reference
- Color-coded states for easy identification
- Displays state images (as placeholders), regions, and locations
- Interactive legend showing all active states

### ActiveStatesChecklist

- Shows all states with checkboxes indicating active/inactive status
- Provides metadata for each state (image count, region count, etc.)
- Located in right sidebar

**Props:**

```typescript
interface ActiveStatesChecklistProps {
  allStates: State[];
  activeStateIds: string[];
}
```

## Pages

### Main Workflows Page

`/projects/[projectId]/verify/workflows/page.tsx`

- Lists all workflows in the project
- Groups workflows by category
- Search functionality
- Click to select a workflow for verification

### Workflow Visualization Page

`/projects/[projectId]/verify/workflows/[workflowId]/page.tsx`

- Three-column layout:
  - Left: Workflow steps list
  - Center: Active states visualization with navigation controls
  - Right: Active states checklist
- Step-by-step navigation with Previous/Next buttons
- Real-time state tracking as you step through the workflow

## Data Flow

1. **Workflow Selection**: User selects a workflow from the list
2. **Step Tracking**: Current step is tracked in local state
3. **State Calculation**: `getActiveStatesAtStep()` determines which states are active at the current step by analyzing:
   - `GO_TO_STATE` actions (activate target states)
   - `FIND_STATE_IMAGE` actions (imply state is active)
   - Transition definitions (activate/deactivate states)
4. **Visualization**: Active states are rendered on canvas at their fixed positions
5. **Checklist Update**: Checklist reflects which states are active

## State Activation Logic

The current implementation uses a simplified state tracking algorithm:

```typescript
function getActiveStatesAtStep(workflow, step, states) {
  // Scan all actions up to current step
  // Track state activations from GO_TO_STATE and FIND_STATE_IMAGE actions
  // Return array of active state IDs
}
```

### Future Enhancements

For production use, the state activation logic should be enhanced to:

1. **Track state deactivations** from transition definitions
2. **Handle conditional branches** (IF/LOOP actions)
3. **Support state persistence** (states that remain active across multiple steps)
4. **Integrate with transition `activateStates`/`deactivateStates`** arrays
5. **Consider `staysVisible` flag** on transitions

## Styling

Components follow the qontinui-web design system:

- Dark theme with `#0A0A0B` background
- Cyan accent color `#00D9FF`
- Gray scale for secondary elements
- Card-based layout with backdrop blur
- Consistent spacing and typography

## Usage Example

```typescript
import { ActiveStatesVisualizer } from '@/components/verify/ActiveStatesVisualizer'

// In your page component
const activeStates = states.filter(s => activeStateIds.includes(s.id))

<ActiveStatesVisualizer
  activeStates={activeStates}
  canvasSize={{ width: 1920, height: 1080 }}
  showStateLabels={true}
/>
```

## Navigation

Access the feature at:

```
/projects/[projectId]/verify/workflows
```

Then select a workflow to navigate to:

```
/projects/[projectId]/verify/workflows/[workflowId]
```

## Dependencies

- React 18+ with hooks
- Next.js 13+ (App Router)
- AutomationContext for workflow and state data
- shadcn/ui components (Card, Button, ScrollArea, Input)
- lucide-react for icons
- Canvas API for visualization

## Notes

- No historical execution data is needed - visualization is based purely on workflow definition and state structure
- Canvas rendering allows for high performance even with many states and elements
- Zoom and pan controls make it easy to navigate large state spaces
- Color coding helps distinguish overlapping states
