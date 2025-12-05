# Expectations Components

This directory contains UI components for configuring workflow expectations and validation rules.

## Components

### ExpectationsPanel

Main wrapper component that provides a tabbed interface for all expectation editors.

**Usage:**
```tsx
import { ExpectationsPanel } from "@/components/expectations";

<ExpectationsPanel
  expectations={workflow.expectations}
  onChange={(expectations) => updateWorkflow({ ...workflow, expectations })}
  availableCheckpoints={checkpointNames}
  availableStates={stateNames}
/>
```

**Features:**
- Three tabs: Global, Success Criteria, Checkpoints
- Dark theme styling
- Integrates all sub-editors

---

### GlobalExpectationsEditor

Editor for workflow-level global expectations.

**Settings:**
- `no_console_errors` - Fail on console errors
- `no_network_errors` - Fail on network errors
- `max_action_duration_ms` - Maximum action duration
- `max_total_duration_ms` - Maximum workflow duration
- `allow_partial_matches` - Accept low-confidence matches
- `min_confidence_threshold` - Pattern matching confidence (0.0-1.0)

**Usage:**
```tsx
import { GlobalExpectationsEditor } from "@/components/expectations";

<GlobalExpectationsEditor
  expectations={workflowExpectations.global}
  onChange={(global) => updateExpectations({ ...expectations, global })}
/>
```

---

### SuccessCriteriaEditor

Editor for workflow success criteria.

**Criteria Types:**
- `all_actions_pass` - All actions must succeed
- `min_matches` - Minimum pattern matches required
- `max_failures` - Maximum failures allowed
- `checkpoint_passed` - Specific checkpoint must pass
- `required_states` - Required states must be visited
- `custom` - Custom Python expression

**Usage:**
```tsx
import { SuccessCriteriaEditor } from "@/components/expectations";

<SuccessCriteriaEditor
  criteria={workflowExpectations.success_criteria}
  onChange={(success_criteria) => updateExpectations({ ...expectations, success_criteria })}
  availableCheckpoints={["login", "dashboard"]}
  availableStates={["LoginScreen", "Dashboard"]}
/>
```

---

### CheckpointListEditor

Editor for workflow checkpoint definitions.

**Checkpoint Features:**
- Named checkpoints
- Screenshot capture
- OCR assertions (via OCRAssertionEditor)
- Claude review instructions
- Timing configuration

**Usage:**
```tsx
import { CheckpointListEditor } from "@/components/expectations";

<CheckpointListEditor
  checkpoints={workflowExpectations.checkpoints}
  onChange={(checkpoints) => updateExpectations({ ...expectations, checkpoints })}
/>
```

---

### ActionExpectationsEditor

Compact editor for per-action expectation settings.

**Settings:**
- `is_terminal_on_failure` - Stop workflow on failure
- `capture_checkpoint_on_failure` - Capture on failure
- `capture_checkpoint_after` - Capture after success
- `checkpoint_name` - Name for checkpoint
- `max_retries` - Retry attempts
- `retry_delay_ms` - Delay between retries
- `max_duration_ms` - Action timeout override
- `expected_state_after` - Expected state after action

**Usage:**
```tsx
import { ActionExpectationsEditor } from "@/components/expectations";

<ActionExpectationsEditor
  expectations={action.expectations}
  onChange={(expectations) => updateAction({ ...action, expectations })}
/>
```

**Recommended placement:** Action properties sidebar

---

## Type System

All components use types from `@/lib/expectations/types`:

- `WorkflowExpectations` - Complete expectations structure
- `GlobalExpectations` - Global workflow settings
- `SuccessCriteria` - Success validation rules
- `CheckpointDefinition` - Checkpoint configuration
- `ActionExpectations` - Per-action settings

## Design Patterns

### Dark Theme
All components use consistent dark theme styling:
- Background: `bg-[#27272A]` or `bg-[#27272A]/50`
- Borders: `border-gray-700` or `border-gray-800`
- Text: `text-gray-200/300/400/500` hierarchy
- Accent: `text-[#00D9FF]` (cyan)

### Component Structure
- Card-based sections for visual grouping
- Clear labels and descriptions
- Collapsible sections for complex settings
- Inline validation feedback

### Icons
From `lucide-react`:
- `Settings` - Global expectations
- `CheckCircle` - Success criteria
- `Flag` - Checkpoints
- `Camera` - Action expectations

## Integration Example

```tsx
// In AutomationBuilder or WorkflowEditor
import { ExpectationsPanel } from "@/components/expectations";

function WorkflowEditor({ workflow, onUpdate }) {
  const handleExpectationsChange = (expectations) => {
    onUpdate({
      ...workflow,
      expectations,
    });
  };

  return (
    <div className="flex h-full">
      {/* Workflow canvas */}
      <div className="flex-1">
        {/* ... */}
      </div>

      {/* Expectations panel */}
      <div className="w-96">
        <ExpectationsPanel
          expectations={workflow.expectations}
          onChange={handleExpectationsChange}
          availableCheckpoints={getCheckpointNames(workflow)}
          availableStates={getAllStateNames()}
        />
      </div>
    </div>
  );
}
```

## Notes

- All components are client-side (`"use client"`)
- Components follow existing qontinui-web patterns
- Full TypeScript type safety
- No backward compatibility concerns (active development)
