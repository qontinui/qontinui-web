# Transition Manager Architecture Diagram

## Component Hierarchy

```
TransitionManager (Orchestrator)
├── Custom Hooks (Business Logic)
│   ├── useTransitionValidation
│   │   └── Returns: TransitionValidation
│   ├── useTransitionFilters
│   │   └── Returns: Transition[]
│   └── useTransitionOperations
│       └── Returns: { handleBulkDelete, handleBulkCreate, handleExport, ... }
│
├── Top Toolbar
│   ├── BulkCreationWizard
│   ├── Export Button
│   └── Bulk Delete Button
│
├── Filters Section
│   └── TransitionFilters
│       ├── Search Input
│       ├── From State Dropdown
│       ├── To State Dropdown
│       └── Action Type Dropdown
│
├── View Mode Tabs
│   ├── List
│   ├── Matrix
│   ├── Graph
│   └── Statistics
│
├── Left Panel (70% width)
│   ├── ValidationPanel (conditional)
│   │   ├── Circular Transitions
│   │   ├── Broken References
│   │   ├── Unreachable States
│   │   └── Dead-end States
│   │
│   └── View Component (based on active tab)
│       ├── TransitionListView
│       │   ├── Sort Controls
│       │   ├── Group Controls
│       │   └── Transition Cards
│       │
│       ├── TransitionMatrixView
│       │   └── State-to-State Grid
│       │
│       ├── TransitionGraphView
│       │   ├── React Flow Canvas
│       │   ├── Background
│       │   ├── Controls
│       │   └── MiniMap
│       │
│       └── TransitionStatisticsView
│           ├── Summary Cards
│           ├── Pie Chart (Transition Types)
│           └── Bar Chart (Most Connected States)
│
└── Right Panel (30% width)
    └── TransitionDetailsPanel
        ├── Header (Type Badge)
        ├── State Selectors
        ├── Configuration
        │   ├── Timeout Input
        │   ├── Retry Count Input
        │   └── Workflow Manager
        └── Actions
            ├── Save Button
            └── Delete Button
```

## Data Flow

```
User Action
    ↓
Event Handler (TransitionManager)
    ↓
Hook / State Update
    ↓
├─→ useTransitionValidation ─→ validation result
├─→ useTransitionFilters ────→ filtered transitions
└─→ useTransitionOperations ─→ CRUD handlers
    ↓
Props passed to child components
    ↓
Component Re-render
```

## Responsibility Mapping

### TransitionManager.tsx
```
┌─────────────────────────────────────┐
│  Orchestration Layer                │
├─────────────────────────────────────┤
│ • State Management                  │
│   - viewMode                        │
│   - filters                         │
│   - selectedTransitions             │
│   - selectedTransition              │
│   - deleteDialogOpen                │
│                                     │
│ • Data Coordination                 │
│   - useAutomation() hook            │
│   - useTransitionValidation()       │
│   - useTransitionFilters()          │
│   - useTransitionOperations()       │
│                                     │
│ • Event Delegation                  │
│   - handleTransitionSelect()        │
│   - handleBulkDelete()              │
│   - handleMatrixCellClick()         │
│   - handleDeleteConfirm()           │
│   - handleIssueClick()              │
│                                     │
│ ✅ DO: Coordinate and delegate      │
│ ❌ DON'T: Implement business logic  │
│ ❌ DON'T: Render complex UI         │
└─────────────────────────────────────┘
```

### useTransitionValidation.ts
```
┌─────────────────────────────────────┐
│  Validation Logic                   │
├─────────────────────────────────────┤
│ Input:                              │
│   - transitions: Transition[]       │
│   - states: State[]                 │
│                                     │
│ Processing:                         │
│   • Detect circular transitions     │
│   • Find broken state references    │
│   • Identify unreachable states     │
│   • Find dead-end states            │
│                                     │
│ Output:                             │
│   TransitionValidation {            │
│     circular: string[]              │
│     brokenStateReferences: string[] │
│     missingWorkflows: string[]      │
│     unreachableStates: string[]     │
│     deadEndStates: string[]         │
│   }                                 │
│                                     │
│ ✅ DO: Pure data analysis           │
│ ❌ DON'T: Mutate input data         │
│ ❌ DON'T: Trigger side effects      │
└─────────────────────────────────────┘
```

### useTransitionFilters.ts
```
┌─────────────────────────────────────┐
│  Filtering Logic                    │
├─────────────────────────────────────┤
│ Input:                              │
│   - transitions: Transition[]       │
│   - filters: TransitionFilters      │
│   - states: State[]                 │
│   - validation: TransitionValidation│
│                                     │
│ Processing:                         │
│   • Apply search query              │
│   • Filter by from/to state         │
│   • Filter by action type           │
│   • Filter by workflow              │
│   • Filter by validation issues     │
│                                     │
│ Output:                             │
│   Transition[] (filtered subset)    │
│                                     │
│ ✅ DO: Pure filtering logic         │
│ ❌ DON'T: Modify original array     │
└─────────────────────────────────────┘
```

### useTransitionOperations.ts
```
┌─────────────────────────────────────┐
│  CRUD Operations                    │
├─────────────────────────────────────┤
│ Input:                              │
│   - addTransition: function         │
│   - updateTransition: function      │
│   - deleteTransition: function      │
│                                     │
│ Methods:                            │
│   • handleBulkDelete()              │
│   • handleBulkCreate()              │
│   • handleExport()                  │
│   • handleUpdate()                  │
│   • handleDelete()                  │
│   • findMatchingTransitions()       │
│                                     │
│ Side Effects:                       │
│   • Toast notifications             │
│   • File downloads                  │
│   • Context mutations               │
│                                     │
│ ✅ DO: Encapsulate operations       │
│ ✅ DO: Show user feedback (toasts)  │
│ ❌ DON'T: Manage component state    │
└─────────────────────────────────────┘
```

### View Components
```
┌─────────────────────────────────────┐
│  TransitionMatrixView               │
│  TransitionListView                 │
│  TransitionGraphView                │
│  TransitionStatisticsView           │
├─────────────────────────────────────┤
│ Responsibilities:                   │
│   • Receive data via props          │
│   • Render specific UI layout       │
│   • Emit events via callbacks       │
│   • NO business logic               │
│   • NO direct state mutations       │
│                                     │
│ Pattern: Presenter Components       │
│   (Pure presentation, no logic)     │
│                                     │
│ ✅ DO: Render UI based on props     │
│ ✅ DO: Handle user interactions     │
│ ❌ DON'T: Fetch data                │
│ ❌ DON'T: Perform calculations      │
│ ❌ DON'T: Mutate props              │
└─────────────────────────────────────┘
```

## Before vs After Comparison

### Before (Monolith)
```
TransitionManager.tsx (2,031 lines)
├── Types (100 lines)
├── Constants (50 lines)
├── Utility Functions (150 lines)
│   ├── analyzeTransitions()
│   ├── getTransitionCellColor()
│   └── ... more utils
├── Sub-Components (900 lines)
│   ├── TransitionMatrix
│   ├── TransitionList
│   ├── TransitionEditor
│   ├── TransitionGraph
│   ├── StatisticsDashboard
│   ├── ValidationPanel
│   └── BulkCreationWizard
└── Main Component (831 lines)
    ├── State management
    ├── Validation logic
    ├── Filtering logic
    ├── CRUD operations
    ├── Export/import
    ├── Event handlers
    └── Rendering

Problems:
❌ Hard to find specific code
❌ Difficult to test in isolation
❌ High coupling between concerns
❌ Long file, heavy cognitive load
❌ Hard to reuse parts
```

### After (Modular)
```
transitions/
├── TransitionManager.tsx (292 lines)
│   └── Orchestrates everything
│
├── types.ts (85 lines)
│   └── Shared type definitions
│
├── hooks/ (261 lines total)
│   ├── useTransitionValidation.ts
│   ├── useTransitionFilters.ts
│   └── useTransitionOperations.ts
│
├── Views/ (684 lines total)
│   ├── TransitionMatrixView.tsx
│   ├── TransitionListView.tsx
│   ├── TransitionGraphView.tsx
│   └── TransitionStatisticsView.tsx
│
└── UI/ (858 lines total)
    ├── TransitionFilters.tsx
    ├── TransitionDetailsPanel.tsx
    ├── ValidationPanel.tsx
    └── BulkCreationWizard.tsx

Benefits:
✅ Easy to locate code by concern
✅ Each piece is independently testable
✅ Low coupling, high cohesion
✅ Small files, low cognitive load
✅ Components/hooks are reusable
```

## Testing Strategy

```
Unit Tests
│
├── Hooks (Pure Logic)
│   ├── useTransitionValidation.test.ts
│   │   └── Test validation algorithms
│   ├── useTransitionFilters.test.ts
│   │   └── Test filtering logic
│   └── useTransitionOperations.test.ts
│       └── Test CRUD operations
│
├── Components (UI)
│   ├── TransitionMatrixView.test.tsx
│   │   └── Test rendering and interactions
│   ├── TransitionListView.test.tsx
│   │   └── Test sorting, grouping, display
│   ├── TransitionGraphView.test.tsx
│   │   └── Test graph rendering
│   └── TransitionStatisticsView.test.tsx
│       └── Test chart rendering
│
└── Integration Tests
    └── TransitionManager.test.tsx
        └── Test orchestration and data flow
```

## Performance Optimization

```
Memoization Strategy
│
├── Hooks
│   ├── useTransitionValidation
│   │   └── useMemo on [transitions, states]
│   └── useTransitionFilters
│       └── useMemo on [transitions, filters, states, validation]
│
├── Callbacks
│   ├── handleTransitionSelect
│   ├── handleBulkDelete
│   ├── handleMatrixCellClick
│   └── handleDeleteConfirm
│       └── All wrapped in useCallback
│
└── View Components
    └── Only re-render when props change
```

## Extension Points

### Adding a New View
```typescript
// 1. Create component
// TransitionCalendarView.tsx
export function TransitionCalendarView({ transitions, states }: Props) {
  // Render calendar UI
}

// 2. Add to types
type ViewMode = "matrix" | "list" | "graph" | "statistics" | "calendar"

// 3. Add to TransitionManager
{viewMode === "calendar" && (
  <TransitionCalendarView transitions={filteredTransitions} states={states} />
)}

// 4. Add tab
<TabsTrigger value="calendar">
  <Calendar className="w-4 h-4 mr-2" />
  Calendar
</TabsTrigger>
```

### Adding a New Validation Rule
```typescript
// In useTransitionValidation.ts
function analyzeTransitions(transitions, states) {
  const validation = {
    circular: [],
    brokenStateReferences: [],
    missingWorkflows: [],
    unreachableStates: [],
    deadEndStates: [],
    duplicateWorkflows: [], // NEW
  }

  // Add detection logic
  transitions.forEach(t => {
    if (hasDuplicateWorkflows(t)) {
      validation.duplicateWorkflows.push(t.id)
    }
  })

  return validation
}
```

### Adding a New Filter
```typescript
// 1. Update types
interface TransitionFilters {
  searchQuery: string
  fromState: string
  toState: string
  actionType: "all" | "with_workflow" | "without_workflow"
  hasWorkflow: string
  showCircular: boolean
  showBroken: boolean
  priority: "all" | "high" | "medium" | "low" // NEW
}

// 2. Add filter logic in useTransitionFilters
if (filters.priority !== "all" && t.priority !== filters.priority) {
  return false
}

// 3. Add UI in TransitionFilters
<Select value={filters.priority} onValueChange={...}>
  <SelectItem value="all">All Priorities</SelectItem>
  <SelectItem value="high">High Priority</SelectItem>
  <SelectItem value="medium">Medium Priority</SelectItem>
  <SelectItem value="low">Low Priority</SelectItem>
</Select>
```

## Key Takeaways

1. **Separation of Concerns**: Each file has exactly ONE job
2. **Testability**: Business logic in hooks can be tested without DOM
3. **Reusability**: Components and hooks can be used independently
4. **Maintainability**: Easy to find and modify specific functionality
5. **Scalability**: New features can be added without touching existing code
6. **Type Safety**: Explicit prop types catch errors at compile time
7. **Performance**: Memoization prevents unnecessary recalculations
8. **Developer Experience**: Small, focused files are easier to understand
