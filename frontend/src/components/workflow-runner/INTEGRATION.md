# Integration Guide - Variable Monitor

This guide shows how to integrate the Variable Monitor component into existing workflow runner pages.

## Files Created

### Components
- `/src/components/workflow-runner/VariableMonitor.tsx` - Main variable monitoring component
- `/src/components/workflow-runner/VariableHistory.tsx` - Timeline view of variable changes
- `/src/components/workflow-runner/index.ts` - Exports for easy importing

### Hooks
- `/src/hooks/useWorkflowVariables.ts` - Custom hook for fetching and managing variables

### Types
- `/src/types/workflow-variables.ts` - TypeScript interfaces and types

### Documentation
- `/src/components/workflow-runner/README.md` - Full documentation
- `/src/components/workflow-runner/QUICK_START.md` - Quick start guide
- `/src/components/workflow-runner/VariableMonitor.example.tsx` - Usage examples

## Where to Integrate

Based on the existing codebase structure, here are the recommended integration points:

### Option 1: Create New Workflow Runner Page

If you don't have a dedicated workflow runner page yet:

```tsx
// Create: app/(app)/workflows/[id]/run/page.tsx

import { VariableMonitor } from '@/components/workflow-runner';

export default function WorkflowRunPage({
  params
}: {
  params: { id: string }
}) {
  const runId = params.id;

  return (
    <div className="min-h-screen bg-[#0F0F10] p-8">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-3xl font-bold text-white">Workflow Execution</h1>
          <p className="text-gray-400 mt-1">Run ID: {runId}</p>
        </div>

        {/* Main layout */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Execution status (left) */}
          <div className="lg:col-span-1">
            {/* Add execution controls here */}
          </div>

          {/* Variable monitor (right) */}
          <div className="lg:col-span-2">
            <VariableMonitor runId={runId} />
          </div>
        </div>
      </div>
    </div>
  );
}
```

### Option 2: Add to Existing Runner Components

If you have existing runner management (like `/src/components/runners/`):

```tsx
// Add to: components/runners/WorkflowExecutionPanel.tsx (create if needed)

import { VariableMonitor } from '@/components/workflow-runner';
import { ActiveConnectionsList } from './ActiveConnectionsList';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

export function WorkflowExecutionPanel({ runId }: { runId: string }) {
  return (
    <Tabs defaultValue="execution">
      <TabsList>
        <TabsTrigger value="execution">Execution</TabsTrigger>
        <TabsTrigger value="variables">Variables</TabsTrigger>
        <TabsTrigger value="connections">Connections</TabsTrigger>
      </TabsList>

      <TabsContent value="execution">
        {/* Your existing execution view */}
      </TabsContent>

      <TabsContent value="variables">
        <VariableMonitor runId={runId} />
      </TabsContent>

      <TabsContent value="connections">
        <ActiveConnectionsList />
      </TabsContent>
    </Tabs>
  );
}
```

### Option 3: Add to Workflow Canvas

If running workflows from the canvas (`/src/components/workflow-canvas/`):

```tsx
// Modify: components/workflow-canvas/WorkflowCanvas.tsx

import { VariableMonitor } from '@/components/workflow-runner';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

export function WorkflowCanvas() {
  const [showVariables, setShowVariables] = useState(false);
  const [currentRunId, setCurrentRunId] = useState<string | null>(null);

  // When workflow starts running
  const handleRunWorkflow = async () => {
    const runId = await startWorkflowExecution();
    setCurrentRunId(runId);
    setShowVariables(true);
  };

  return (
    <>
      {/* Existing canvas */}
      <ReactFlow>
        {/* ... */}
      </ReactFlow>

      {/* Variable monitor dialog */}
      <Dialog open={showVariables} onOpenChange={setShowVariables}>
        <DialogContent className="max-w-6xl max-h-[90vh]">
          <DialogHeader>
            <DialogTitle>Workflow Variables</DialogTitle>
          </DialogHeader>
          {currentRunId && <VariableMonitor runId={currentRunId} />}
        </DialogContent>
      </Dialog>
    </>
  );
}
```

### Option 4: Add to Automation Builder

If using the automation builder (`/src/components/automation-builder.tsx`):

```tsx
// Modify: components/automation-builder.tsx

import { VariableMonitor } from '@/components/workflow-runner';

export function AutomationBuilder() {
  const [isRunning, setIsRunning] = useState(false);
  const [runId, setRunId] = useState<string | null>(null);

  return (
    <div className="flex h-screen">
      {/* Left: Builder */}
      <div className="flex-1">
        {/* Existing builder UI */}
      </div>

      {/* Right: Variable monitor (when running) */}
      {isRunning && runId && (
        <div className="w-1/3 border-l border-gray-800 bg-[#1A1A1B] overflow-auto">
          <VariableMonitor
            runId={runId}
            refreshInterval={isRunning ? 1000 : 0}
          />
        </div>
      )}
    </div>
  );
}
```

## Backend API Implementation

The components expect these endpoints. Implement them in your FastAPI backend:

### 1. Get Current Variables

```python
# backend/app/api/v1/endpoints/workflow_runs.py

from fastapi import APIRouter, Depends, HTTPException
from app.models import User
from app.api.deps import get_current_user

router = APIRouter()

@router.get("/workflow-runs/{run_id}/variables")
async def get_workflow_variables(
    run_id: str,
    current_user: User = Depends(get_current_user)
):
    """
    Get current variable snapshot for a workflow run
    """
    # Fetch from your database/state manager
    variables = await workflow_state_manager.get_variables(run_id)

    return {
        "run_id": run_id,
        "variables": {
            "timestamp": datetime.utcnow().isoformat() + "Z",
            "execution": variables.get("execution", {}),
            "workflow": variables.get("workflow", {}),
            "global": variables.get("global", {}),
        },
        "fetched_at": datetime.utcnow().isoformat() + "Z"
    }
```

### 2. Get Variable Change History

```python
@router.get("/workflow-runs/{run_id}/variable-changes")
async def get_variable_changes(
    run_id: str,
    limit: int = 100,
    cursor: Optional[str] = None,
    current_user: User = Depends(get_current_user)
):
    """
    Get variable change history for a workflow run
    """
    # Fetch from your change log/audit table
    changes = await workflow_change_log.get_changes(
        run_id=run_id,
        limit=limit,
        cursor=cursor
    )

    return {
        "run_id": run_id,
        "history": {
            "total": changes.total,
            "changes": [
                {
                    "id": change.id,
                    "variable_name": change.variable_name,
                    "scope": change.scope,
                    "old_value": change.old_value,
                    "new_value": change.new_value,
                    "timestamp": change.timestamp.isoformat() + "Z",
                    "action_id": change.action_id,
                    "action_name": change.action_name,
                    "change_type": change.change_type,
                }
                for change in changes.items
            ],
            "next_cursor": changes.next_cursor
        },
        "fetched_at": datetime.utcnow().isoformat() + "Z"
    }
```

### 3. Database Models (Example)

```python
# backend/app/models/workflow_variable_change.py

from sqlalchemy import Column, String, JSON, DateTime, Enum
from app.db.base_class import Base
import enum

class ChangeType(str, enum.Enum):
    CREATED = "created"
    UPDATED = "updated"
    DELETED = "deleted"

class VariableScope(str, enum.Enum):
    EXECUTION = "execution"
    WORKFLOW = "workflow"
    GLOBAL = "global"

class WorkflowVariableChange(Base):
    __tablename__ = "workflow_variable_changes"

    id = Column(String, primary_key=True)
    run_id = Column(String, nullable=False, index=True)
    variable_name = Column(String, nullable=False)
    scope = Column(Enum(VariableScope), nullable=False)
    old_value = Column(JSON, nullable=True)
    new_value = Column(JSON, nullable=True)
    change_type = Column(Enum(ChangeType), nullable=False)
    action_id = Column(String, nullable=True)
    action_name = Column(String, nullable=True)
    timestamp = Column(DateTime, nullable=False, index=True)
```

## Testing the Integration

### 1. Manual Testing

```bash
# Start your frontend
cd frontend
npm run dev

# Navigate to the page with VariableMonitor
# http://localhost:3000/workflows/your-run-id/run
```

### 2. Test API Endpoints

```bash
# Test variables endpoint
curl http://localhost:8000/api/v1/workflow-runs/test-run-123/variables \
  -H "Cookie: access_token=your-token"

# Test changes endpoint
curl http://localhost:8000/api/v1/workflow-runs/test-run-123/variable-changes \
  -H "Cookie: access_token=your-token"
```

### 3. Mock Data for Testing

```tsx
// Create: components/workflow-runner/VariableMonitor.mock.tsx

export function MockVariableMonitor() {
  // Override the hook with mock data
  return <VariableMonitor runId="mock-run-123" />;
}
```

## Common Integration Patterns

### Pattern 1: Side Panel

```tsx
<div className="flex h-screen">
  <div className="flex-1">{/* Main content */}</div>
  <div className="w-96 border-l">
    <VariableMonitor runId={runId} />
  </div>
</div>
```

### Pattern 2: Modal/Dialog

```tsx
<Dialog open={showVariables} onOpenChange={setShowVariables}>
  <DialogContent className="max-w-4xl">
    <VariableMonitor runId={runId} />
  </DialogContent>
</Dialog>
```

### Pattern 3: Tab in Dashboard

```tsx
<Tabs>
  <TabsList>
    <TabsTrigger value="overview">Overview</TabsTrigger>
    <TabsTrigger value="variables">Variables</TabsTrigger>
  </TabsList>
  <TabsContent value="variables">
    <VariableMonitor runId={runId} />
  </TabsContent>
</Tabs>
```

### Pattern 4: Collapsible Section

```tsx
<Collapsible>
  <CollapsibleTrigger>
    <Button>Show Variables</Button>
  </CollapsibleTrigger>
  <CollapsibleContent>
    <VariableMonitor runId={runId} />
  </CollapsibleContent>
</Collapsible>
```

## Next Steps

1. Choose an integration point from the options above
2. Implement the backend API endpoints
3. Add the VariableMonitor component to your page
4. Test with a running workflow
5. Customize styling and behavior as needed

## Support

If you encounter issues:
- Check browser console for errors
- Verify API endpoints are working
- Review TypeScript types match API responses
- See examples in `VariableMonitor.example.tsx`
- Check `README.md` for full documentation

## Additional Resources

- **Full Documentation**: `README.md`
- **Quick Start**: `QUICK_START.md`
- **Examples**: `VariableMonitor.example.tsx`
- **Type Definitions**: `/src/types/workflow-variables.ts`
- **Hook Implementation**: `/src/hooks/useWorkflowVariables.ts`
