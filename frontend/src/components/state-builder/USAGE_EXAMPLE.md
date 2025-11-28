# Enhanced State Builder - Usage Examples

This document provides practical examples of using the Enhanced State Builder component.

## Basic Integration

### 1. Add to a Page

```tsx
// app/(app)/states/page.tsx
"use client";

import { EnhancedStateBuilder } from "@/components/state-builder";

export default function StatesPage() {
  return (
    <div className="h-screen">
      <EnhancedStateBuilder />
    </div>
  );
}
```

### 2. Use with Automation Context

The component automatically integrates with the AutomationContext:

```tsx
import { useAutomation } from "@/contexts/automation-context";
import { EnhancedStateBuilder } from "@/components/state-builder";

function MyComponent() {
  const { states, addState, updateState, deleteState } = useAutomation();

  // The EnhancedStateBuilder will use these automatically
  return <EnhancedStateBuilder />;
}
```

## Working with States

### Creating a New State

1. Click the "New State" button in the header
2. OR click the "+" icon in the navigator sidebar
3. OR use "From Template" to create from a template

```tsx
// Programmatic creation
const newState: State = {
  id: `state-${Date.now()}`,
  name: "My New State",
  description: "Description here",
  stateImages: [],
  regions: [],
  locations: [],
  strings: [],
  position: { x: 0, y: 0 },
};

addState(newState);
```

### Using Templates

Templates speed up state creation for common patterns:

```tsx
// Define a custom template
const loginTemplate: StateTemplate = {
  id: "login-template",
  name: "Login Screen",
  description: "Standard login form with username and password",
  template: {
    name: "Login State",
    description: "User login screen",
    stateImages: [],
    regions: [
      {
        id: "login-form-region",
        name: "Login Form",
        x: 100,
        y: 100,
        width: 400,
        height: 300,
      },
    ],
    locations: [
      {
        id: "username-field",
        name: "Username Field",
        x: 200,
        y: 150,
        fixed: false,
        anchor: false,
      },
      {
        id: "password-field",
        name: "Password Field",
        x: 200,
        y: 200,
        fixed: false,
        anchor: false,
      },
      {
        id: "login-button",
        name: "Login Button",
        x: 200,
        y: 250,
        fixed: false,
        anchor: false,
      },
    ],
    strings: [
      {
        id: "username-str",
        name: "username",
        value: "",
        inputText: true,
      },
      {
        id: "password-str",
        name: "password",
        value: "",
        inputText: true,
      },
    ],
  },
};
```

## Organizing States

### Search and Filter

```tsx
// Search by text
<Input
  placeholder="Search states..."
  value={searchQuery}
  onChange={(e) => setSearchQuery(e.target.value)}
/>;

// Filter by criteria
const filteredStates = states.filter((state) => {
  // Has images
  if (filterHasImages) {
    return state.stateImages && state.stateImages.length > 0;
  }

  // Has transitions
  if (filterHasTransitions) {
    return transitions.some(
      (t) =>
        (t.type === "OutgoingTransition" && t.fromState === state.id) ||
        (t.type === "IncomingTransition" && t.toState === state.id)
    );
  }

  // By complexity
  const complexity = calculateStateComplexity(state);
  if (minComplexity !== undefined && complexity < minComplexity) {
    return false;
  }

  return true;
});
```

### Multi-Select for Bulk Operations

```tsx
// Select multiple states
const [selectedStateIds, setSelectedStateIds] = useState<Set<string>>(
  new Set()
);

function handleToggleSelection(stateId: string) {
  setSelectedStateIds((prev) => {
    const next = new Set(prev);
    if (next.has(stateId)) {
      next.delete(stateId);
    } else {
      next.add(stateId);
    }
    return next;
  });
}

// Bulk delete
function handleBulkDelete() {
  if (confirm(`Delete ${selectedStateIds.size} states?`)) {
    selectedStateIds.forEach((id) => deleteState(id));
    setSelectedStateIds(new Set());
  }
}

// Bulk export
function handleBulkExport() {
  const exportData = states.filter((s) => selectedStateIds.has(s.id));
  const json = JSON.stringify(exportData, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `states-export-${Date.now()}.json`;
  a.click();
}
```

## Working with StateImages

### Adding StateImages

```tsx
function handleAddStateImage(state: State) {
  const newStateImage: StateImage = {
    id: `si-${Date.now()}`,
    name: "New Image",
    patterns: [],
    shared: false,
  };

  updateState({
    ...state,
    stateImages: [...(state.stateImages || []), newStateImage],
  });
}
```

### Adding Patterns to StateImages

```tsx
function handleAddPattern(
  state: State,
  stateImageIndex: number,
  imageId: string
) {
  const stateImages = [...(state.stateImages || [])];
  const stateImage = stateImages[stateImageIndex];

  const newPattern: Pattern = {
    id: `pattern-${Date.now()}`,
    name: "New Pattern",
    imageId: imageId,
    searchRegions: [],
    fixed: false,
    similarity: 0.8,
  };

  stateImage.patterns = [...(stateImage.patterns || []), newPattern];
  updateState({ ...state, stateImages });
}
```

## State Validation

### Validate a State

```tsx
import { validateState } from "@/components/state-builder/state-utils";

function MyComponent({ state }: { state: State }) {
  const issues = validateState(state);

  return (
    <div>
      {issues.length > 0 && (
        <Alert
          variant={
            issues.some((i) => i.type === "error") ? "destructive" : "default"
          }
        >
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Validation Issues</AlertTitle>
          <AlertDescription>
            <ul>
              {issues.map((issue, idx) => (
                <li key={idx}>
                  [{issue.type.toUpperCase()}] {issue.message}
                  {issue.suggestion && (
                    <div className="text-xs mt-1">
                      Suggestion: {issue.suggestion}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
```

## State Analytics

### Generate Analytics

```tsx
import {
  generateStateAnalytics,
  calculateStateComplexity,
  generateStateStatistics,
} from "@/components/state-builder/state-utils";

function StateAnalyticsDashboard({ states, workflows, transitions }) {
  const overallStats = generateStateStatistics(states);

  return (
    <div className="grid grid-cols-3 gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Total States</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-3xl font-bold">{overallStats.totalStates}</div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Avg Complexity</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-3xl font-bold">{overallStats.avgComplexity}</div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Total StateImages</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-3xl font-bold">
            {overallStats.totalStateImages}
          </div>
        </CardContent>
      </Card>

      {/* Complexity Distribution */}
      <Card className="col-span-3">
        <CardHeader>
          <CardTitle>Complexity Distribution</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-4 gap-2">
            <div className="text-center">
              <div className="text-2xl font-bold text-green-500">
                {overallStats.complexityDistribution.low}
              </div>
              <div className="text-sm text-muted-foreground">Low</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-yellow-500">
                {overallStats.complexityDistribution.medium}
              </div>
              <div className="text-sm text-muted-foreground">Medium</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-orange-500">
                {overallStats.complexityDistribution.high}
              </div>
              <div className="text-sm text-muted-foreground">High</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-red-500">
                {overallStats.complexityDistribution.veryHigh}
              </div>
              <div className="text-sm text-muted-foreground">Very High</div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
```

### Find Similar States

```tsx
import { findSimilarStates } from "@/components/state-builder/state-utils";

function SimilarStatesPanel({ targetState, allStates }) {
  const similarStates = findSimilarStates(targetState, allStates, 0.5);

  return (
    <div>
      <h3>Similar States</h3>
      <div className="space-y-2">
        {similarStates.map(({ state, similarity }) => (
          <Card key={state.id}>
            <CardContent className="p-3">
              <div className="flex items-center justify-between">
                <span>{state.name}</span>
                <Badge variant="outline">
                  {Math.round(similarity * 100)}% similar
                </Badge>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
```

## State Comparison

### Compare Two States

```tsx
import { compareStates } from "@/components/state-builder/state-utils";

function StateComparisonView({ state1, state2 }) {
  const comparison = compareStates(state1, state2);

  return (
    <div className="space-y-4">
      <div>
        <h3>Similarity: {Math.round(comparison.similarity * 100)}%</h3>
      </div>

      {comparison.differences.images && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">StateImage Differences</CardTitle>
          </CardHeader>
          <CardContent>
            {comparison.differences.images.only1.length > 0 && (
              <div>
                <p className="text-xs font-semibold">Only in {state1.name}:</p>
                <ul className="text-xs text-muted-foreground">
                  {comparison.differences.images.only1.map((id) => (
                    <li key={id}>{id}</li>
                  ))}
                </ul>
              </div>
            )}
            {comparison.differences.images.only2.length > 0 && (
              <div>
                <p className="text-xs font-semibold">Only in {state2.name}:</p>
                <ul className="text-xs text-muted-foreground">
                  {comparison.differences.images.only2.map((id) => (
                    <li key={id}>{id}</li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
```

## Export and Import

### Export States

```tsx
import { exportStatesToJSON } from "@/components/state-builder/state-utils";

function ExportButton({ selectedStateIds, allStates }) {
  function handleExport() {
    const statesToExport = allStates.filter((s) => selectedStateIds.has(s.id));
    const json = exportStatesToJSON(statesToExport);

    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `states-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Button onClick={handleExport}>
      <Download className="mr-2 h-4 w-4" />
      Export {selectedStateIds.size} State(s)
    </Button>
  );
}
```

### Import States

```tsx
function ImportButton({ onImport }) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    const text = await file.text();
    const data = JSON.parse(text);

    // Validate structure
    if (data.states && Array.isArray(data.states)) {
      data.states.forEach((state: State) => {
        // Assign new IDs to avoid conflicts
        const newState = {
          ...state,
          id: `state-${Date.now()}-${Math.random()}`,
        };
        onImport(newState);
      });

      toast.success(`Imported ${data.states.length} state(s)`);
    }
  }

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept=".json"
        className="hidden"
        onChange={handleFileChange}
      />
      <Button onClick={() => fileInputRef.current?.click()}>
        <Upload className="mr-2 h-4 w-4" />
        Import States
      </Button>
    </>
  );
}
```

## Custom Workflows

### Create Helper Workflow for State

```tsx
import { createFindAnyStateImageWorkflow } from "@/lib/workflow-helpers";

function CreateHelperWorkflowButton({ state, onWorkflowCreated }) {
  function handleCreate() {
    const helperWorkflow = createFindAnyStateImageWorkflow(state);
    onWorkflowCreated(helperWorkflow);
    toast.success("Helper workflow created");
  }

  return (
    <Button onClick={handleCreate} variant="outline">
      <Sparkles className="mr-2 h-4 w-4" />
      Create Helper Workflow
    </Button>
  );
}
```

## Best Practices

### 1. State Naming

```tsx
// Good - Descriptive and unique
{
  name: 'MainMenu_Highlighted',
  description: 'Main menu with Play button highlighted'
}

// Bad - Generic and vague
{
  name: 'State1',
  description: ''
}
```

### 2. Complexity Management

```tsx
// Monitor complexity and split when needed
const complexity = calculateStateComplexity(state);

if (complexity > 30) {
  // Consider splitting into multiple states
  console.warn(`State "${state.name}" has high complexity: ${complexity}`);
}
```

### 3. Validation Before Save

```tsx
function handleSaveState(state: State) {
  const issues = validateState(state);
  const errors = issues.filter((i) => i.type === "error");

  if (errors.length > 0) {
    toast.error(`Cannot save: ${errors.length} error(s) found`);
    return;
  }

  updateState(state);
  toast.success("State saved");
}
```

### 4. Batch Operations

```tsx
// Use batch updates for better performance
function handleBulkUpdate(stateIds: string[], updates: Partial<State>) {
  // Batch all updates together
  const updatedStates = states.map((state) =>
    stateIds.includes(state.id) ? { ...state, ...updates } : state
  );

  // Single update to context
  // (Would need batch update method in context)
  updatedStates.forEach((state) => updateState(state));
}
```

## Troubleshooting

### State Not Updating

```tsx
// Ensure you're creating new objects, not mutating
// Bad:
state.stateImages.push(newImage);
updateState(state);

// Good:
updateState({
  ...state,
  stateImages: [...state.stateImages, newImage],
});
```

### Performance with Many States

```tsx
// Use useMemo for filtered lists
const filteredStates = useMemo(() => {
  return states.filter(/* ... */);
}, [states, searchQuery, filters]);

// Use virtualized lists for large datasets
import { VirtualList } from "some-virtual-list-library";

<VirtualList
  items={filteredStates}
  renderItem={(state) => <StateListItem state={state} />}
  itemHeight={60}
/>;
```
