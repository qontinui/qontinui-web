# Enhanced State Builder - Architecture

## Component Structure

```
┌─────────────────────────────────────────────────────────────────┐
│                    Enhanced State Builder                       │
│                                                                 │
│  ┌───────────────┬──────────────────────┬─────────────────┐   │
│  │               │                      │                 │   │
│  │   Navigator   │       Canvas         │   Properties    │   │
│  │   (300px)     │       (flex-1)       │     (350px)     │   │
│  │               │                      │                 │   │
│  ├───────────────┼──────────────────────┼─────────────────┤   │
│  │               │                      │                 │   │
│  │ • Search      │ • StateImages Grid   │ • Overview Tab  │   │
│  │ • Filters     │ • Regions Preview    │ • Images Tab    │   │
│  │ • State List  │ • Locations Preview  │ • Regions Tab   │   │
│  │ • Multi-Select│ • Zoom Controls      │ • Locations Tab │   │
│  │ • Groups      │ • Pan Controls       │ • Strings Tab   │   │
│  │               │                      │ • Transitions   │   │
│  │               │                      │                 │   │
│  └───────────────┴──────────────────────┴─────────────────┘   │
│                                                                 │
│  [Dialogs: Templates | Bulk Operations | Graph View]           │
└─────────────────────────────────────────────────────────────────┘
```

## Data Flow

```
┌──────────────────────────────────────────────────────────────┐
│                     Data Flow Diagram                        │
└──────────────────────────────────────────────────────────────┘

User Action
    │
    ▼
┌─────────────────────┐
│ Component Handler   │  (onClick, onChange, etc.)
└─────────────────────┘
    │
    ▼
┌─────────────────────┐
│ Local State Update  │  (useState, setXxx)
└─────────────────────┘
    │
    ▼
┌─────────────────────┐
│ Context Method      │  (addState, updateState, deleteState)
└─────────────────────┘
    │
    ▼
┌─────────────────────┐
│ IndexedDB Update    │  (projectDB.updateState)
└─────────────────────┘
    │
    ▼
┌─────────────────────┐
│ Context State       │  (states array updated)
└─────────────────────┘
    │
    ▼
┌─────────────────────┐
│ Component Re-render │  (React re-renders with new data)
└─────────────────────┘
    │
    ▼
┌─────────────────────┐
│ UI Updates          │  (User sees changes)
└─────────────────────┘
```

## State Management

```
┌────────────────────────────────────────────────────────────┐
│                    State Architecture                      │
└────────────────────────────────────────────────────────────┘

Global State (AutomationContext)
├─ states: State[]
├─ transitions: Transition[]
├─ workflows: Workflow[]
└─ images: ImageAsset[]

Component State (useState)
├─ UI State
│  ├─ selectedGroupId: string | null
│  ├─ selectedStateIds: Set<string>
│  ├─ currentStateId: string | null
│  ├─ searchQuery: string
│  ├─ filterTags: string[]
│  ├─ filterHasImages: boolean | null
│  ├─ filterHasTransitions: boolean | null
│  ├─ showTemplateDialog: boolean
│  ├─ showBulkDialog: boolean
│  ├─ showGraphDialog: boolean
│  └─ activeTab: string
│
├─ Canvas State
│  ├─ canvasZoom: number
│  ├─ canvasPan: { x: number; y: number }
│  ├─ selectedImageIndex: number | null
│  ├─ selectedRegionId: string | null
│  └─ selectedLocationId: string | null
│
└─ Data
   ├─ groups: StateGroup[]
   └─ templates: StateTemplate[]

Computed State (useMemo)
├─ currentState: State | null
├─ filteredStates: State[]
├─ allTags: string[]
└─ complexity scores (per state)
```

## Component Tree

```
EnhancedStateBuilder
│
├─ Header
│  ├─ Title & Stats
│  └─ Action Buttons
│     ├─ View Graph Button
│     ├─ From Template Button
│     └─ New State Button
│
├─ Main Layout (Grid 3-column)
│  │
│  ├─ Navigator Panel (Card)
│  │  ├─ CardHeader
│  │  │  ├─ Title
│  │  │  └─ Quick Action Buttons
│  │  │
│  │  └─ CardContent
│  │     ├─ Search Input
│  │     ├─ Filter Dropdown
│  │     └─ ScrollArea
│  │        └─ State List
│  │           └─ State Item (map)
│  │              ├─ Checkbox
│  │              ├─ State Info
│  │              │  ├─ Name
│  │              │  ├─ Badges
│  │              │  └─ Complexity
│  │              └─ Dropdown Menu
│  │
│  ├─ Canvas Panel (Card)
│  │  ├─ CardHeader
│  │  │  ├─ State Name
│  │  │  └─ Zoom Controls
│  │  │
│  │  └─ CardContent
│  │     ├─ StateImages Grid
│  │     │  └─ Image Card (map)
│  │     │     ├─ Thumbnail
│  │     │     ├─ Name
│  │     │     └─ Pattern Badge
│  │     │
│  │     ├─ Regions Preview
│  │     │  └─ Region Card (map)
│  │     │
│  │     └─ Locations Preview
│  │        └─ Location Card (map)
│  │
│  └─ Properties Panel (Card)
│     ├─ CardHeader
│     │  └─ Title
│     │
│     └─ CardContent
│        └─ Tabs
│           ├─ TabsList
│           │  ├─ Overview
│           │  ├─ Images
│           │  ├─ Regions
│           │  └─ Locations
│           │
│           ├─ Overview Tab
│           │  ├─ Name Input
│           │  ├─ Description Textarea
│           │  ├─ Initial Checkbox
│           │  ├─ Complexity Badge
│           │  └─ Stats Grid
│           │
│           ├─ Images Tab
│           │  ├─ Add Button
│           │  └─ StateImage Cards (map)
│           │     ├─ Name
│           │     ├─ Pattern Count
│           │     ├─ Thumbnail
│           │     └─ Remove Button
│           │
│           ├─ Regions Tab
│           │  ├─ Add Button
│           │  └─ Region Cards (map)
│           │     ├─ Name
│           │     └─ Dimensions
│           │
│           └─ Locations Tab
│              ├─ Add Button
│              └─ Location Cards (map)
│                 ├─ Name
│                 ├─ Coordinates
│                 └─ Flags
│
├─ Template Dialog
│  ├─ DialogHeader
│  │  ├─ Title
│  │  └─ Description
│  │
│  └─ DialogContent
│     └─ Template Cards (map)
│        ├─ Name
│        └─ Description
│
├─ Bulk Operations Dialog
│  ├─ DialogHeader
│  │  ├─ Title
│  │  └─ Selection Count
│  │
│  └─ DialogContent
│     ├─ Duplicate Button
│     ├─ Export Button
│     └─ Delete Button
│
└─ Graph Dialog
   ├─ DialogHeader
   │  ├─ Title
   │  └─ Description
   │
   └─ DialogContent
      └─ Placeholder (Graph visualization would go here)
```

## Hook Usage

```typescript
// Context Hooks
const {
  states,
  transitions,
  workflows,
  images,
  addState,
  updateState,
  deleteState,
  getImageById,
  resolvePatternImage,
} = useAutomation();

// State Hooks
const [selectedGroupId, setSelectedGroupId] = useState<string | null>('root');
const [selectedStateIds, setSelectedStateIds] = useState<Set<string>>(new Set());
const [currentStateId, setCurrentStateId] = useState<string | null>(null);
// ... many more

// Memo Hooks
const currentState = useMemo(() => {
  return states.find((s) => s.id === currentStateId) || null;
}, [states, currentStateId]);

const filteredStates = useMemo(() => {
  // Complex filtering logic
}, [states, searchQuery, filters, ...]);

// Callback Hooks
const handleCreateState = useCallback(() => {
  // Create state logic
}, [addState]);

const handleUpdateCurrentState = useCallback((updates: Partial<State>) => {
  // Update logic
}, [currentState, updateState]);
```

## Utility Functions Architecture

```
state-utils.ts
│
├─ Complexity Analysis
│  ├─ calculateStateComplexity(state)
│  ├─ getComplexityLevel(score)
│  └─ getComplexityColor(level)
│
├─ State Validation
│  └─ validateState(state)
│     └─ Returns StateValidationIssue[]
│
├─ State Usage Analysis
│  └─ analyzeStateUsage(state, workflows, transitions)
│     └─ Returns StateUsageInfo
│
├─ State Analytics
│  └─ generateStateAnalytics(state, workflows, transitions)
│     └─ Returns StateAnalytics
│
├─ State Comparison
│  ├─ compareStates(state1, state2)
│  │  └─ Returns StateComparison
│  │
│  └─ findSimilarStates(targetState, allStates, minSimilarity)
│     └─ Returns Array<{ state, similarity }>
│
├─ State Export
│  ├─ exportStatesToJSON(states)
│  └─ exportStatesToYAML(states)
│
└─ State Statistics
   └─ generateStateStatistics(states)
      └─ Returns overall statistics
```

## Type System

```
types.ts
│
├─ Organization Types
│  ├─ StateGroup
│  └─ StateWithMetadata (extends State)
│
├─ Template Types
│  └─ StateTemplate
│
├─ Search & Filter Types
│  ├─ StateSearchFilter
│  └─ SavedStateFilter
│
├─ Operation Types
│  └─ BulkOperationPayload
│
├─ Analysis Types
│  ├─ StateComparison
│  ├─ StateValidationIssue
│  ├─ StateUsageInfo
│  └─ StateAnalytics
│
└─ Utility Types
   ├─ ComplexityLevel
   └─ Helper functions
```

## Performance Optimization Strategy

```
┌────────────────────────────────────────────────────────┐
│            Performance Optimizations                   │
└────────────────────────────────────────────────────────┘

1. Memoization
   ├─ useMemo for filtered lists
   ├─ useMemo for computed values
   └─ useCallback for handlers

2. Lazy Loading (Planned)
   ├─ Load state details on demand
   ├─ Lazy load images
   └─ Progressive image loading

3. Virtual Scrolling (Planned)
   ├─ Only render visible items
   └─ Efficient for 1000+ states

4. Debouncing
   ├─ Search input debounced
   ├─ Filter changes debounced
   └─ Auto-save debounced

5. Code Splitting
   ├─ Lazy load dialogs
   ├─ Lazy load heavy components
   └─ Dynamic imports for features

6. Caching
   ├─ Cache computed complexity scores
   ├─ Cache validation results
   └─ Cache image URLs
```

## Integration Architecture

```
┌────────────────────────────────────────────────────────┐
│           Integration Points                           │
└────────────────────────────────────────────────────────┘

EnhancedStateBuilder
         │
         ├──────────► AutomationContext
         │            ├─ states[]
         │            ├─ transitions[]
         │            ├─ workflows[]
         │            ├─ images[]
         │            └─ CRUD methods
         │
         ├──────────► shadcn/ui Components
         │            ├─ Button, Input, Card
         │            ├─ Tabs, Dialog, Alert
         │            └─ ScrollArea, Badge
         │
         ├──────────► lucide-react Icons
         │            └─ 30+ icons
         │
         ├──────────► Tailwind CSS
         │            └─ Utility classes
         │
         └──────────► Utility Libraries
                      ├─ cn() - Class merging
                      ├─ toast - Notifications
                      └─ state-utils - Helpers
```

## Security Considerations

```
1. Input Validation
   ├─ Sanitize state names
   ├─ Validate file uploads
   └─ Limit string lengths

2. XSS Prevention
   ├─ No dangerouslySetInnerHTML
   ├─ Escape user input
   └─ Use React's built-in escaping

3. Data Integrity
   ├─ Validate before save
   ├─ Check relationships
   └─ Prevent orphaned data

4. User Permissions
   ├─ Check write access
   ├─ Verify delete permissions
   └─ Audit bulk operations
```

## Error Handling

```
┌────────────────────────────────────────────────────────┐
│              Error Handling Strategy                   │
└────────────────────────────────────────────────────────┘

1. Try-Catch Blocks
   └─ Wrap async operations

2. Toast Notifications
   ├─ Success messages
   ├─ Error messages
   └─ Warning messages

3. Validation Errors
   ├─ Prevent invalid saves
   ├─ Show inline errors
   └─ Provide suggestions

4. Fallback UI
   ├─ Empty states
   ├─ Loading states
   └─ Error boundaries

5. Console Logging
   ├─ Development mode
   └─ Debug information
```

## Accessibility

```
1. Keyboard Navigation
   ├─ Tab order
   ├─ Focus management
   └─ Keyboard shortcuts (planned)

2. ARIA Labels
   ├─ Button labels
   ├─ Icon buttons
   └─ Form fields

3. Screen Reader Support
   ├─ Semantic HTML
   ├─ Alt text
   └─ ARIA attributes

4. Visual Feedback
   ├─ Focus indicators
   ├─ Hover states
   └─ Active states
```

## Testing Strategy

```
Unit Tests
├─ Utility functions
│  ├─ calculateStateComplexity()
│  ├─ validateState()
│  └─ compareStates()
│
├─ Hooks
│  └─ Custom logic in hooks
│
└─ Helper functions

Integration Tests
├─ Component rendering
├─ User interactions
├─ State updates
└─ Context integration

E2E Tests
├─ Full workflows
├─ Multi-step operations
└─ Edge cases
```

## Deployment Considerations

```
1. Build Optimization
   ├─ Tree shaking
   ├─ Code splitting
   └─ Minification

2. Bundle Size
   ├─ Monitor dependencies
   ├─ Lazy load features
   └─ Use bundle analyzer

3. Browser Support
   ├─ Modern browsers
   ├─ Polyfills if needed
   └─ Feature detection

4. Performance Monitoring
   ├─ Core Web Vitals
   ├─ Rendering metrics
   └─ User analytics
```

---

This architecture document provides a comprehensive overview of the Enhanced State Builder's structure, data flow, and technical design decisions.
