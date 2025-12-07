# Expectations Components - Usage Examples

## 1. ExpectationsPanel (Main Wrapper)

Use this in the workflow editor or automation builder to provide a complete expectations UI.

```tsx
import { ExpectationsPanel } from "@/components/expectations";
import { Workflow } from "@/lib/action-schema/action-types";

function WorkflowEditor() {
  const [workflow, setWorkflow] = useState<Workflow>(/* ... */);

  const handleExpectationsChange = (expectations: WorkflowExpectations) => {
    setWorkflow({
      ...workflow,
      expectations, // Add expectations to workflow
    });
  };

  return (
    <div className="flex h-screen">
      {/* Main workflow canvas */}
      <div className="flex-1">{/* Your workflow editor */}</div>

      {/* Expectations panel - right sidebar */}
      <div className="w-96 border-l border-gray-800">
        <ExpectationsPanel
          expectations={workflow.expectations}
          onChange={handleExpectationsChange}
          availableCheckpoints={getCheckpointNames(workflow)}
          availableStates={getAllStates().map((s) => s.name)}
        />
      </div>
    </div>
  );
}
```

---

## 2. GlobalExpectationsEditor (Standalone)

Use for a dedicated global settings section.

```tsx
import { GlobalExpectationsEditor } from "@/components/expectations";

function WorkflowSettings() {
  const [workflow, setWorkflow] = useState<Workflow>(/* ... */);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Global Expectations</CardTitle>
      </CardHeader>
      <CardContent>
        <GlobalExpectationsEditor
          expectations={workflow.expectations?.global}
          onChange={(global) => {
            setWorkflow({
              ...workflow,
              expectations: {
                ...workflow.expectations,
                global,
              },
            });
          }}
        />
      </CardContent>
    </Card>
  );
}
```

---

## 3. ActionExpectationsEditor (Action Properties)

Add to the action properties panel for per-action configuration.

```tsx
import { ActionExpectationsEditor } from "@/components/expectations";
import { Action } from "@/lib/action-schema/action-types";

function ActionPropertiesPanel({
  action,
  onUpdate,
}: {
  action: Action;
  onUpdate: (action: Action) => void;
}) {
  return (
    <div className="space-y-4">
      {/* Existing action properties */}
      <Card>
        <CardHeader>
          <CardTitle>Action Settings</CardTitle>
        </CardHeader>
        <CardContent>{/* Your action config fields */}</CardContent>
      </Card>

      {/* Action expectations */}
      <ActionExpectationsEditor
        expectations={action.expectations}
        onChange={(expectations) => {
          onUpdate({
            ...action,
            expectations,
          });
        }}
      />
    </div>
  );
}
```

---

## 4. CheckpointListEditor (Standalone)

Use for checkpoint management in a dedicated tab or modal.

```tsx
import { CheckpointListEditor } from "@/components/expectations";

function CheckpointManager() {
  const [workflow, setWorkflow] = useState<Workflow>(/* ... */);

  return (
    <div className="p-6">
      <h2 className="text-xl font-bold mb-4">Manage Checkpoints</h2>
      <CheckpointListEditor
        checkpoints={workflow.expectations?.checkpoints}
        onChange={(checkpoints) => {
          setWorkflow({
            ...workflow,
            expectations: {
              ...workflow.expectations,
              checkpoints,
            },
          });
        }}
      />
    </div>
  );
}
```

---

## 5. Adding Expectations to Workflow Type

If the Workflow type doesn't include expectations yet, extend it:

```tsx
// In your workflow types or action-types.ts
import type { WorkflowExpectations } from "@/lib/expectations/types";

export interface Workflow {
  id: string;
  name: string;
  version: string;
  format: "graph";
  actions: Action[];
  connections: Connections;

  // Add expectations field
  expectations?: WorkflowExpectations;

  // ... other fields
}
```

---

## 6. Integration with AutomationBuilder

Add expectations as a fourth panel or tab in the automation builder:

```tsx
import { ExpectationsPanel } from "@/components/expectations";

export function AutomationBuilder() {
  const [selectedWorkflow, setSelectedWorkflow] = useState<Workflow | null>(
    null
  );
  const [activeTab, setActiveTab] = useState<
    "editor" | "properties" | "expectations"
  >("editor");

  return (
    <div className="flex h-full">
      {/* Left: Library */}
      <div className="w-64">{/* Workflow library */}</div>

      {/* Center: Editor */}
      <div className="flex-1">{/* Workflow canvas */}</div>

      {/* Right: Properties/Expectations */}
      <div className="w-80">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="editor">Editor</TabsTrigger>
            <TabsTrigger value="properties">Properties</TabsTrigger>
            <TabsTrigger value="expectations">Expectations</TabsTrigger>
          </TabsList>

          <TabsContent value="editor">{/* Action properties */}</TabsContent>

          <TabsContent value="properties">
            {/* Workflow metadata */}
          </TabsContent>

          <TabsContent value="expectations">
            {selectedWorkflow && (
              <ExpectationsPanel
                expectations={selectedWorkflow.expectations}
                onChange={(expectations) => {
                  setSelectedWorkflow({
                    ...selectedWorkflow,
                    expectations,
                  });
                }}
                availableStates={states.map((s) => s.name)}
              />
            )}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
```

---

## 7. Persisting Expectations

Save expectations with the workflow to backend:

```tsx
async function saveWorkflow(workflow: Workflow) {
  const response = await fetch(`/api/workflows/${workflow.id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...workflow,
      expectations: workflow.expectations, // Include expectations
    }),
  });

  if (!response.ok) {
    throw new Error("Failed to save workflow");
  }

  return response.json();
}
```

---

## 8. Reading Expectations from Workflow

Extract and use expectations during workflow execution:

```tsx
function executeWorkflow(workflow: Workflow) {
  const expectations = workflow.expectations;

  // Global settings
  const maxDuration = expectations?.global?.max_total_duration_ms ?? 300000;
  const minConfidence = expectations?.global?.min_confidence_threshold ?? 0.8;

  // Success criteria
  const successCriteria = expectations?.success_criteria;

  // Checkpoints
  const checkpoints = expectations?.checkpoints ?? {};

  // Execute workflow with expectations
  return runWorkflow(workflow, {
    maxDuration,
    minConfidence,
    successCriteria,
    checkpoints,
  });
}
```

---

## Component Props Reference

### ExpectationsPanel

```tsx
interface ExpectationsPanelProps {
  expectations: WorkflowExpectations | undefined;
  onChange: (expectations: WorkflowExpectations) => void;
  availableCheckpoints?: string[]; // Optional checkpoint names
  availableStates?: string[]; // Optional state names
}
```

### GlobalExpectationsEditor

```tsx
interface GlobalExpectationsEditorProps {
  expectations: GlobalExpectations | undefined;
  onChange: (expectations: GlobalExpectations) => void;
}
```

### SuccessCriteriaEditor

```tsx
interface SuccessCriteriaEditorProps {
  criteria: SuccessCriteria | undefined;
  onChange: (criteria: SuccessCriteria) => void;
  availableCheckpoints?: string[];
  availableStates?: string[];
}
```

### CheckpointListEditor

```tsx
interface CheckpointListEditorProps {
  checkpoints: Record<string, CheckpointDefinition> | undefined;
  onChange: (checkpoints: Record<string, CheckpointDefinition>) => void;
}
```

### ActionExpectationsEditor

```tsx
interface ActionExpectationsEditorProps {
  expectations: ActionExpectations | undefined;
  onChange: (expectations: ActionExpectations) => void;
}
```

---

## Best Practices

1. **Always provide onChange handler** - Components are controlled, they don't manage their own state
2. **Pass available options** - Provide checkpoint names and state names for better UX
3. **Handle undefined gracefully** - All expectations fields are optional
4. **Persist changes** - Save to backend or local storage after changes
5. **Validate before execution** - Check expectations are valid before running workflows
6. **Use type guards** - Import type guards from `@/lib/expectations/types` for runtime checks

```tsx
import {
  isMinMatchesCriteria,
  isCheckpointPassedCriteria,
  // ... other type guards
} from "@/lib/expectations/types";

// Use in conditional logic
if (isMinMatchesCriteria(criteria)) {
  console.log("Minimum matches required:", criteria.min_matches);
}
```
