# Transition Manager - Refactored Architecture

This directory contains the refactored Transition Manager component, restructured to follow the Single Responsibility Principle (SRP).

## Overview

The original `TransitionManager.tsx` (2,031 lines) has been split into **13 focused files** with clear, single responsibilities. The main component is now a thin orchestrator (292 lines) that delegates to specialized components and hooks.

## File Structure

```
transitions/
├── TransitionManager.tsx          (292 lines) - Main orchestrator component
├── types.ts                        (85 lines)  - Shared type definitions
├── index.ts                        (20 lines)  - Public API exports
│
├── hooks/                          - Business logic hooks
│   ├── useTransitionValidation.ts  (84 lines)  - Validation logic
│   ├── useTransitionFilters.ts     (94 lines)  - Filter logic
│   └── useTransitionOperations.ts  (83 lines)  - CRUD operations
│
├── View Components/                - Specialized view renderers
│   ├── TransitionMatrixView.tsx    (117 lines) - Matrix grid view
│   ├── TransitionListView.tsx      (255 lines) - List view with sorting/grouping
│   ├── TransitionGraphView.tsx     (103 lines) - React Flow graph visualization
│   └── TransitionStatisticsView.tsx(209 lines) - Charts and analytics
│
└── UI Components/                  - Reusable UI pieces
    ├── TransitionFilters.tsx       (90 lines)  - Filter controls
    ├── TransitionDetailsPanel.tsx  (274 lines) - Edit panel
    ├── ValidationPanel.tsx         (170 lines) - Validation issues
    └── BulkCreationWizard.tsx      (324 lines) - Multi-step wizard
```

**Total: 2,180 lines** (vs. original 2,031 lines)
- The slight increase is due to proper separation, type safety, and removal of duplication

## Architecture Principles

### 1. Single Responsibility Principle
Each file has ONE clear purpose:
- **View components**: Render specific UI layouts
- **Hooks**: Encapsulate reusable business logic
- **UI components**: Handle specific user interactions
- **Main component**: Orchestrates data flow only

### 2. Container/Presenter Pattern
```
TransitionManager (Container)
    ↓ (passes data via props)
View Components (Presenters)
```

### 3. Custom Hooks for Logic
Business logic is extracted into testable hooks:
- `useTransitionValidation` - Circular detection, broken references, etc.
- `useTransitionFilters` - Search, filtering, and data transformation
- `useTransitionOperations` - CRUD operations with side effects

## Component Responsibilities

### TransitionManager.tsx (Main Orchestrator)
**Responsibility**: Coordinate child components and manage application state
- State management (view mode, filters, selections)
- Event handler delegation
- Data flow orchestration
- NO complex business logic
- NO UI rendering (delegates to child components)

```typescript
// Example: Thin orchestrator
const validation = useTransitionValidation(transitions, states)
const filteredTransitions = useTransitionFilters(transitions, filters, states, validation)
const operations = useTransitionOperations({ addTransition, updateTransition, deleteTransition })

return (
  <TransitionListView
    transitions={filteredTransitions}
    onTransitionClick={setSelectedTransition}
  />
)
```

### View Components

#### TransitionMatrixView.tsx
**Responsibility**: Render transitions as a state-to-state grid
- Cell color coding based on transition count
- Circular transition highlighting
- Click handling for cell selection

#### TransitionListView.tsx
**Responsibility**: Render transitions as a sortable, groupable list
- Sort by: fromState, toState, type, modified
- Group by: fromState, toState, type, none
- Visual indicators for validation issues
- Bulk selection support

#### TransitionGraphView.tsx
**Responsibility**: Visualize transitions as a directed graph using React Flow
- Node positioning and styling
- Edge animation for workflows
- MiniMap and controls integration

#### TransitionStatisticsView.tsx
**Responsibility**: Display analytics and charts
- Summary statistics (total, avg, coverage, issues)
- Pie chart for transition types
- Bar chart for most connected states

### UI Components

#### TransitionFilters.tsx
**Responsibility**: Filter controls UI only
- Search input
- State dropdowns (from/to)
- Action type selector
- Receives filters via props, emits changes via callback

#### TransitionDetailsPanel.tsx
**Responsibility**: Edit single transition
- Form inputs for transition properties
- Workflow management
- Save/delete actions
- Empty state when no selection

#### ValidationPanel.tsx
**Responsibility**: Display validation issues
- Circular transitions
- Broken state references
- Unreachable states
- Dead-end states
- Clickable items to highlight issues

#### BulkCreationWizard.tsx
**Responsibility**: Multi-step transition creation
- Step 1: Select source states
- Step 2: Select target states
- Step 3: Configure properties
- Step 4: Preview and create

### Custom Hooks

#### useTransitionValidation.ts
**Responsibility**: Analyze transitions for issues
```typescript
interface TransitionValidation {
  circular: string[]              // IDs of circular transitions
  brokenStateReferences: string[] // Transitions with invalid state refs
  missingWorkflows: string[]      // Transitions with missing workflows
  unreachableStates: string[]     // States with no incoming transitions
  deadEndStates: string[]         // States with no outgoing transitions
}
```

**Logic**:
- Detects circular transition pairs (A→B, B→A)
- Validates state references exist
- Identifies orphaned states
- Finds dead-end states

#### useTransitionFilters.ts
**Responsibility**: Filter transitions based on criteria
- Search query (matches state names)
- From/To state filtering
- Action type (with/without workflows)
- Specific workflow filtering
- Show circular/broken only

**Returns**: Filtered transition array

#### useTransitionOperations.ts
**Responsibility**: CRUD operations with side effects
```typescript
{
  handleBulkDelete: (ids: Set<string>) => void
  handleBulkCreate: (transitions: Transition[]) => void
  handleExport: (transitions: Transition[]) => void
  handleUpdate: (transition: Transition, updates: Partial<Transition>) => void
  handleDelete: (id: string) => void
  findMatchingTransitions: (fromState: string, toState: string) => Transition[]
}
```

**Side effects**:
- Toast notifications
- File downloads (export)
- Context mutations (add/update/delete)

## Benefits of This Architecture

### 1. Testability
Each component/hook can be tested in isolation:
```typescript
// Test validation logic without UI
const validation = analyzeTransitions(mockTransitions, mockStates)
expect(validation.circular).toHaveLength(2)

// Test filtering logic
const filtered = useTransitionFilters(transitions, filters, states, validation)
expect(filtered).toHaveLength(5)

// Test matrix view rendering
render(<TransitionMatrixView transitions={...} />)
```

### 2. Reusability
Components can be used independently:
```typescript
// Use just the list view elsewhere
import { TransitionListView } from '@/components/transitions'

// Use validation logic in another feature
import { useTransitionValidation } from '@/components/transitions'
```

### 3. Maintainability
- **Find bugs faster**: Issue in matrix view? Check `TransitionMatrixView.tsx` only
- **Add features easily**: New view? Create `TransitionTimelineView.tsx`
- **Update logic safely**: Change validation? Modify one hook, tests verify no breakage

### 4. Developer Experience
- **Smaller files**: No scrolling through 2000+ lines
- **Clear boundaries**: Know exactly where to look
- **Type safety**: Props are explicitly typed
- **Self-documenting**: File names describe purpose

## Usage Examples

### Basic Usage
```typescript
import { TransitionManager } from '@/components/transitions'

function App() {
  return <TransitionManager />
}
```

### Using Individual Components
```typescript
import {
  TransitionListView,
  useTransitionValidation
} from '@/components/transitions'

function CustomTransitionView() {
  const { transitions, states } = useAutomation()
  const validation = useTransitionValidation(transitions, states)

  return (
    <TransitionListView
      transitions={transitions}
      states={states}
      validation={validation}
      onTransitionClick={handleClick}
    />
  )
}
```

### Using Hooks Independently
```typescript
import { useTransitionValidation } from '@/components/transitions'

function ValidationSummary() {
  const { transitions, states } = useAutomation()
  const validation = useTransitionValidation(transitions, states)

  return (
    <div>
      <p>Circular: {validation.circular.length}</p>
      <p>Broken: {validation.brokenStateReferences.length}</p>
    </div>
  )
}
```

## Migration Guide

### Before (2031-line monolith)
```typescript
// Everything in one file
function TransitionManager() {
  // 100+ lines of state
  // 200+ lines of validation logic
  // 300+ lines of filtering logic
  // 500+ lines of UI rendering
  // 900+ lines of sub-components
}
```

### After (Clean separation)
```typescript
// Main component: orchestration only
function TransitionManager() {
  const validation = useTransitionValidation(transitions, states)
  const filtered = useTransitionFilters(transitions, filters, states, validation)
  const operations = useTransitionOperations({ addTransition, updateTransition, deleteTransition })

  return <TransitionListView transitions={filtered} {...props} />
}
```

## Future Enhancements

With this architecture, adding features is straightforward:

### New View Type
```typescript
// Create TransitionTimelineView.tsx
export function TransitionTimelineView({ transitions, states }) {
  // Render timeline UI
}

// Add to TransitionManager.tsx
{viewMode === "timeline" && <TransitionTimelineView {...props} />}
```

### New Validation Rule
```typescript
// Add to useTransitionValidation.ts
validation.duplicateWorkflows = findDuplicateWorkflows(transitions)
```

### New Filter Type
```typescript
// Add to useTransitionFilters.ts
if (filters.hasTag && !t.tags?.includes(filters.hasTag)) {
  return false
}
```

## Performance Considerations

- **Memoization**: All hooks use `useMemo` to prevent unnecessary recalculations
- **Filtered data**: Only filtered transitions are passed to view components
- **Lazy rendering**: View components only render when their tab is active
- **Callback stability**: `useCallback` prevents child re-renders

## Type Safety

All components have explicit prop types:
```typescript
interface TransitionListViewProps {
  transitions: Transition[]
  states: State[]
  workflows: Workflow[]
  validation: TransitionValidation
  selectedTransitions: Set<string>
  onTransitionSelect: (id: string, selected: boolean) => void
  onTransitionClick: (transition: Transition) => void
  onTransitionDelete: (id: string) => void
}
```

## Conclusion

This refactoring transforms a 2000+ line monolith into a maintainable, testable, and extensible architecture. Each file has a single, clear responsibility, making the codebase easier to understand, modify, and test.

**Key Metrics**:
- **Original**: 1 file, 2,031 lines, 9+ responsibilities
- **Refactored**: 13 files, ~180 lines average, 1 responsibility each
- **Maintainability**: ⬆️⬆️⬆️
- **Testability**: ⬆️⬆️⬆️
- **Reusability**: ⬆️⬆️⬆️
