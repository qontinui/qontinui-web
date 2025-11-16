# Transition Validation

Comprehensive guide for validating transitions and detecting common issues in large automation projects.

## Table of Contents

- [Overview](#overview)
- [Validation Types](#validation-types)
- [Running Validation](#running-validation)
- [Broken References](#broken-references)
- [Circular Dependencies](#circular-dependencies)
- [Unreachable States](#unreachable-states)
- [Fixing Issues](#fixing-issues)

## Overview

Transition validation ensures your state machine is correct and executable. Critical for projects with 100+ transitions.

## Validation Types

### 1. Broken References

Detect invalid state or workflow references:

```typescript
// Broken state reference
{
  toState: "non-existent-state"  // State doesn't exist
}

// Broken workflow reference
{
  workflows: ["deleted-workflow"]  // Workflow doesn't exist
}
```

### 2. Circular Dependencies

Detect state loops:

```
login → dashboard → settings → login  // Circular!
```

### 3. Unreachable States

Find states with no path from initial state:

```typescript
// No transitions lead to this state
{
  id: "orphaned-state",
  initial: false,
  // No incoming transitions
}
```

### 4. Orphaned Transitions

Transitions referencing deleted states:

```typescript
{
  fromState: "deleted-state",  // State was deleted
  toState: "some-state"
}
```

## Running Validation

### Manual Validation

```typescript
// Conceptual validation API
const results = validateAllTransitions();

// Check results
if (!results.valid) {
  console.error('Validation errors:', results.errors);
  results.errors.forEach(error => {
    console.error(`${error.type}: ${error.message}`);
  });
}
```

### Automatic Validation

Validation runs automatically:
- On transition save
- On state delete
- On workflow delete
- Before execution

### Validation Report

```typescript
interface ValidationReport {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
  stats: {
    totalTransitions: number;
    validTransitions: number;
    brokenReferences: number;
    circularDependencies: number;
    unreachableStates: number;
  };
}
```

## Broken References

### Detecting Broken References

```typescript
function findBrokenReferences(
  transitions: Transition[],
  states: State[],
  workflows: Workflow[]
): BrokenReference[] {
  const stateIds = new Set(states.map(s => s.id));
  const workflowIds = new Set(workflows.map(w => w.id));
  const errors: BrokenReference[] = [];

  transitions.forEach(transition => {
    // Check toState
    if (transition.type === 'OutgoingTransition' &&
        transition.toState &&
        !stateIds.has(transition.toState)) {
      errors.push({
        type: 'BROKEN_STATE_REFERENCE',
        transitionId: transition.id,
        field: 'toState',
        value: transition.toState,
        message: `Target state '${transition.toState}' not found`
      });
    }

    // Check workflows
    transition.workflows.forEach(workflowId => {
      if (!workflowIds.has(workflowId)) {
        errors.push({
          type: 'BROKEN_WORKFLOW_REFERENCE',
          transitionId: transition.id,
          field: 'workflows',
          value: workflowId,
          message: `Workflow '${workflowId}' not found`
        });
      }
    });

    // Check activateStates
    if (transition.type === 'OutgoingTransition') {
      transition.activateStates.forEach(stateId => {
        if (!stateIds.has(stateId)) {
          errors.push({
            type: 'BROKEN_STATE_REFERENCE',
            transitionId: transition.id,
            field: 'activateStates',
            value: stateId,
            message: `State '${stateId}' in activateStates not found`
          });
        }
      });
    }
  });

  return errors;
}
```

### Fixing Broken References

**Option 1: Update Reference**
```typescript
// Update to correct state/workflow
updateTransition(transitionId, {
  toState: 'correct-state-id'
});
```

**Option 2: Remove Reference**
```typescript
// Remove broken workflow reference
const updatedWorkflows = transition.workflows.filter(
  id => workflowExists(id)
);
updateTransition(transitionId, { workflows: updatedWorkflows });
```

**Option 3: Delete Transition**
```typescript
// If transition is no longer valid
deleteTransition(transitionId);
```

## Circular Dependencies

### Detecting Cycles

```typescript
function findCircularDependencies(
  transitions: OutgoingTransition[],
  states: State[]
): string[][] {
  const cycles: string[][] = [];
  const graph = buildTransitionGraph(transitions);

  function dfs(
    stateId: string,
    visited: Set<string>,
    path: string[]
  ) {
    if (visited.has(stateId)) {
      // Found cycle
      const cycleStart = path.indexOf(stateId);
      if (cycleStart >= 0) {
        cycles.push(path.slice(cycleStart).concat(stateId));
      }
      return;
    }

    visited.add(stateId);
    path.push(stateId);

    const neighbors = graph.get(stateId) || [];
    neighbors.forEach(nextState => {
      dfs(nextState, new Set(visited), [...path]);
    });
  }

  states.forEach(state => {
    dfs(state.id, new Set(), []);
  });

  return cycles;
}
```

### Understanding Cycles

```
Example cycle:
login → dashboard → profile → settings → login

This means:
- From login, can reach dashboard
- From dashboard, can reach profile
- From profile, can reach settings
- From settings, can reach login (cycle!)
```

### Fixing Cycles

**Option 1: Remove Loop Transition**
```typescript
// Remove the transition that creates the loop
// e.g., settings → login
deleteTransition('trans-settings-to-login');
```

**Option 2: Add Exit Condition**
```typescript
// Add conditional logic in workflow
workflow: {
  actions: [
    { type: 'IF', condition: 'not-already-visited' },
    { type: 'THEN', action: 'proceed' },
    { type: 'ELSE', action: 'exit-loop' }
  ]
}
```

**Option 3: Redesign Flow**
```typescript
// Break cycle by adding intermediate state
login → dashboard → profile → settings → settings-confirm → logout
```

## Unreachable States

### Detecting Unreachable States

```typescript
function findUnreachableStates(
  states: State[],
  transitions: OutgoingTransition[]
): State[] {
  const initialState = states.find(s => s.initial);
  if (!initialState) return states; // All unreachable if no initial

  const reachable = new Set<string>();
  const queue = [initialState.id];

  while (queue.length > 0) {
    const currentId = queue.shift()!;
    reachable.add(currentId);

    // Find all states reachable from current
    const outgoing = transitions.filter(t => t.fromState === currentId);
    outgoing.forEach(transition => {
      if (transition.toState && !reachable.has(transition.toState)) {
        queue.push(transition.toState);
      }
      transition.activateStates.forEach(stateId => {
        if (!reachable.has(stateId)) {
          queue.push(stateId);
        }
      });
    });
  }

  return states.filter(state => !reachable.has(state.id));
}
```

### Fixing Unreachable States

**Option 1: Add Transition**
```typescript
// Create transition to reach the state
createTransition({
  fromState: 'existing-state',
  toState: 'unreachable-state',
  // ...
});
```

**Option 2: Mark as Initial**
```typescript
// If it's an entry point
updateState(stateId, { initial: true });
```

**Option 3: Delete State**
```typescript
// If state is no longer needed
deleteState(stateId);
```

## Fixing Issues

### Automated Fixes

```typescript
// Conceptual auto-fix
function autoFixValidationIssues(
  validationReport: ValidationReport
): FixReport {
  const fixes: Fix[] = [];

  validationReport.errors.forEach(error => {
    switch (error.type) {
      case 'BROKEN_WORKFLOW_REFERENCE':
        // Remove broken workflow reference
        const fixed = removeWorkflowFromTransition(
          error.transitionId,
          error.value
        );
        fixes.push({ type: 'REMOVED_WORKFLOW', ...fixed });
        break;

      case 'BROKEN_STATE_REFERENCE':
        // Offer to delete transition or update reference
        fixes.push({
          type: 'REQUIRES_MANUAL_FIX',
          error,
          suggestions: [
            'Update to correct state ID',
            'Delete transition'
          ]
        });
        break;
    }
  });

  return { fixes, requiresManualReview: true };
}
```

### Manual Review Workflow

1. **Run Validation**
   ```typescript
   const report = validateAllTransitions();
   ```

2. **Review Errors**
   ```typescript
   report.errors.forEach(error => {
     console.log(`${error.type}: ${error.message}`);
   });
   ```

3. **Fix One by One**
   - Start with broken references (easiest)
   - Then handle circular dependencies
   - Finally address unreachable states

4. **Re-validate**
   ```typescript
   const updatedReport = validateAllTransitions();
   ```

5. **Repeat Until Clean**

### Validation Best Practices

1. **Validate Regularly**: Weekly for large projects
2. **Before Major Changes**: Always validate first
3. **After Deletions**: Check for broken references
4. **Pre-Deployment**: Final validation check
5. **Document Exceptions**: If intentional cycles exist

## Validation Checklist

- [ ] No broken state references
- [ ] No broken workflow references
- [ ] No unintended circular dependencies
- [ ] All states reachable (or marked as entry points)
- [ ] All transitions have valid configurations
- [ ] Timeout values are reasonable
- [ ] Retry counts are appropriate
- [ ] State management is correct

## Related Documentation

- [Transition Management](./README.md)
- [Transition Templates](./templates.md)
- [State Builder](../state-builder/README.md)

---

**Key Takeaways:**
- Regular validation prevents runtime errors
- Fix broken references immediately
- Understand and handle circular dependencies
- Ensure all states are reachable
- Use validation before deployment
