# Transition Management

Comprehensive guide for managing transitions between states in automation projects with 100+ transitions.

## Table of Contents

- [Overview](#overview)
- [Transition Types](#transition-types)
- [Creating Transitions](#creating-transitions)
- [Transition Properties](#transition-properties)
- [Workflows in Transitions](#workflows-in-transitions)
- [Validation](#validation)
- [Bulk Operations](#bulk-operations)
- [Best Practices](#best-practices)
- [Related Documentation](#related-documentation)

## Overview

Transitions define navigation between states and the workflows (actions) that execute during state changes. They are the connective tissue of your state machine.

### Key Capabilities

- **Two Transition Types**: Outgoing and Incoming transitions
- **Workflow Execution**: Run workflows during transitions
- **State Management**: Activate, deactivate, and check state visibility
- **Error Handling**: Timeout and retry configuration
- **Validation**: Detect circular dependencies and broken references
- **Visual Representation**: See transition flow on canvas
- **Bulk Operations**: Manage multiple transitions efficiently

## Transition Types

### Outgoing Transitions

Transitions **from** a specific state **to** another state:

```typescript
interface OutgoingTransition {
  id: string;
  type: "OutgoingTransition";
  fromState: string;          // Source state ID
  toState?: string;           // Target state ID (optional)
  activateStates: string[];   // States to activate
  staysVisible: boolean;      // Source state stays visible
  deactivateStates: string[]; // States to deactivate
  workflows: string[];        // Workflows to execute
  timeout: number;            // Max execution time (ms)
  retryCount: number;         // Number of retries
  position?: { x: number; y: number };  // Canvas position
}
```

**Use cases:**
- Navigate from Login to Dashboard
- Exit modal dialog
- Complete checkout flow step
- Handle user action transitions

**Example:**
```typescript
{
  id: "trans-login-to-dashboard",
  type: "OutgoingTransition",
  fromState: "auth-login",
  toState: "dashboard-home",
  activateStates: ["dashboard-home"],
  staysVisible: false,
  deactivateStates: ["auth-login"],
  workflows: ["workflow-submit-login"],
  timeout: 30000,
  retryCount: 3
}
```

### Incoming Transitions

Transitions **into** a specific state from any source:

```typescript
interface IncomingTransition {
  id: string;
  type: "IncomingTransition";
  toState: string;      // Target state ID
  workflows: string[];  // Workflows to execute
  timeout: number;
  retryCount: number;
  position?: { x: number; y: number };
}
```

**Use cases:**
- Initialize a state (check prerequisites)
- Load data when entering state
- Verify state preconditions
- Entry point from multiple sources

**Example:**
```typescript
{
  id: "trans-enter-dashboard",
  type: "IncomingTransition",
  toState: "dashboard-home",
  workflows: ["workflow-load-dashboard-data"],
  timeout: 10000,
  retryCount: 2
}
```

### Choosing Transition Type

**Use Outgoing Transition when:**
- You know both source and target states
- Transition is specific to one path
- You need to control state visibility
- Modeling user actions/navigation

**Use Incoming Transition when:**
- State can be reached from multiple sources
- You need to initialize state on entry
- Loading data regardless of source
- State preconditions/validation

## Creating Transitions

### Creating an Outgoing Transition

1. **Select Source State**
   - Click on the state node

2. **Open Transition Builder**
   - Click "Add Outgoing Transition" button

3. **Configure Transition**
   - **Target State**: Select destination state
   - **Activate States**: States to make active (usually target)
   - **Stays Visible**: Keep source state visible
   - **Deactivate States**: States to hide (usually source)
   - **Workflows**: Select workflows to execute
   - **Timeout**: Max execution time
   - **Retry Count**: Number of retry attempts

4. **Save Transition**
   - Transition appears as edge on canvas

### Creating an Incoming Transition

1. **Select Target State**
   - Click on the state node

2. **Add Incoming Transition**
   - Click "Add Incoming Transition" button

3. **Configure Transition**
   - **Workflows**: Select initialization workflows
   - **Timeout**: Max execution time
   - **Retry Count**: Number of retry attempts

4. **Save Transition**
   - Transition shows as special edge/node

### Visual Creation

On the canvas:

1. **Connect States**
   - Drag from source state handle to target state
   - Or use right-click menu

2. **Configure in Properties Panel**
   - Set transition properties
   - Add workflows
   - Configure state management

## Transition Properties

### State Management

**Activate States:**
```typescript
activateStates: ["dashboard-home", "sidebar-menu"]
```
States that should become active/visible when transition completes.

**Deactivate States:**
```typescript
deactivateStates: ["auth-login", "login-modal"]
```
States that should become inactive/hidden when transition completes.

**Stays Visible:**
```typescript
staysVisible: true  // Source state remains visible
staysVisible: false // Source state is hidden
```

**Example Scenarios:**

**Modal Dialog (stays visible):**
```typescript
{
  fromState: "dashboard",
  toState: "settings-modal",
  activateStates: ["settings-modal"],
  staysVisible: true,        // Dashboard stays visible
  deactivateStates: []       // Don't hide anything
}
```

**Page Navigation (doesn't stay visible):**
```typescript
{
  fromState: "products-list",
  toState: "product-detail",
  activateStates: ["product-detail"],
  staysVisible: false,       // Hide products list
  deactivateStates: ["products-list"]
}
```

### Timeout Configuration

Maximum time to wait for transition to complete:

```typescript
timeout: 30000  // 30 seconds
```

**Recommended values:**
- Fast transitions (click): 5000ms (5s)
- Page loads: 10000ms (10s)
- Data loading: 30000ms (30s)
- Complex operations: 60000ms (60s)

**Warning**: Too short = premature failures, too long = slow failure detection

### Retry Configuration

Number of times to retry failed transitions:

```typescript
retryCount: 3  // Retry up to 3 times
```

**Recommended values:**
- Network operations: 3-5 retries
- UI interactions: 2-3 retries
- Critical operations: 5+ retries
- Fast operations: 1-2 retries

**Best practice**: Combine with exponential backoff in workflows

## Workflows in Transitions

### Selecting Workflows

Transitions execute workflows (sequences of actions) during state changes:

```typescript
workflows: [
  "workflow-click-login-button",
  "workflow-wait-for-dashboard",
  "workflow-verify-login-success"
]
```

**Execution order**: Workflows execute in array order

### Common Workflow Patterns

**Navigation Pattern:**
```typescript
{
  fromState: "page-a",
  toState: "page-b",
  workflows: [
    "click-next-button",      // Click navigation element
    "wait-for-page-load",     // Wait for new page
    "verify-page-loaded"      // Verify correct page
  ]
}
```

**Form Submission Pattern:**
```typescript
{
  fromState: "form-state",
  toState: "success-state",
  workflows: [
    "fill-form-fields",       // Enter data
    "click-submit-button",    // Submit
    "wait-for-processing",    // Wait for response
    "verify-success-message"  // Check result
  ]
}
```

**Modal Pattern:**
```typescript
{
  fromState: "main-page",
  toState: "modal-dialog",
  workflows: [
    "click-open-modal-button",
    "wait-for-modal-appear",
    "verify-modal-content"
  ],
  staysVisible: true  // Main page stays visible
}
```

**Data Loading Pattern (Incoming):**
```typescript
{
  type: "IncomingTransition",
  toState: "dashboard",
  workflows: [
    "load-user-data",
    "load-analytics-data",
    "load-notifications",
    "verify-data-loaded"
  ]
}
```

### Workflow Composition

**Sequential Actions:**
```typescript
// Workflows execute one after another
workflows: ["step1", "step2", "step3"]
```

**Conditional Logic:**
```typescript
// Use conditional actions within workflows
workflow: {
  actions: [
    { type: "IF", condition: "loginFailed" },
    { type: "THEN", workflow: "retry-login" },
    { type: "ELSE", workflow: "proceed-to-dashboard" }
  ]
}
```

## Validation

### Validation Types

**Broken References:**
- Transitions pointing to non-existent states
- Workflows that don't exist
- Invalid state IDs in activate/deactivate lists

**Circular Dependencies:**
- State A → State B → State A
- Detected during state machine analysis

**Unreachable States:**
- States with no incoming transitions
- Not reachable from initial state

**Orphaned Transitions:**
- Transitions with deleted states
- Invalid workflow references

### Running Validation

```typescript
// Conceptual validation API
const validation = validateTransitions(transitions, states, workflows);

if (!validation.valid) {
  console.error('Validation errors:', validation.errors);
}
```

### Validation Errors

**Broken State Reference:**
```json
{
  "type": "BROKEN_STATE_REFERENCE",
  "transitionId": "trans-123",
  "field": "toState",
  "value": "non-existent-state",
  "message": "Target state 'non-existent-state' not found"
}
```

**Circular Dependency:**
```json
{
  "type": "CIRCULAR_DEPENDENCY",
  "cycle": ["login", "dashboard", "profile", "login"],
  "message": "Circular dependency detected: login → dashboard → profile → login"
}
```

**Missing Workflow:**
```json
{
  "type": "MISSING_WORKFLOW",
  "transitionId": "trans-456",
  "workflowId": "deleted-workflow",
  "message": "Workflow 'deleted-workflow' not found"
}
```

See [Validation Guide](./validation.md) for detailed information.

## Bulk Operations

### Conceptual Bulk Operations

For managing large numbers of transitions efficiently:

#### Bulk Update

Update multiple transitions:

```typescript
// Update timeout for all transitions
transitions.forEach(t => {
  if (t.timeout < 10000) {
    updateTransition(t.id, { timeout: 10000 });
  }
});

// Update retry count for specific group
transitions
  .filter(t => t.workflows.some(w => w.includes('network')))
  .forEach(t => {
    updateTransition(t.id, { retryCount: 5 });
  });
```

#### Bulk Delete

Remove multiple transitions:

```typescript
// Delete transitions to a specific state
const toDelete = transitions.filter(t =>
  t.type === 'OutgoingTransition' && t.toState === 'deleted-state'
);

toDelete.forEach(t => deleteTransition(t.id));
```

#### Bulk Validation

Validate all transitions:

```typescript
const errors = transitions.map(t => validateTransition(t))
  .flat()
  .filter(error => error !== null);

console.log(`Found ${errors.length} validation errors`);
```

## Best Practices

### Naming Transitions

**Good IDs:**
```
trans-login-to-dashboard
trans-checkout-to-payment
trans-modal-close
trans-error-retry
```

**Bad IDs:**
```
transition1
t1
temp
test
```

### Timeout Guidelines

**UI Interactions:**
```typescript
// Clicks, typing
timeout: 5000  // 5 seconds
```

**Page Loads:**
```typescript
// Simple pages
timeout: 10000  // 10 seconds

// Complex pages
timeout: 30000  // 30 seconds
```

**Network Operations:**
```typescript
// API calls
timeout: 15000  // 15 seconds

// File uploads
timeout: 60000  // 60 seconds
```

**Data Processing:**
```typescript
// Light processing
timeout: 10000  // 10 seconds

// Heavy processing
timeout: 120000  // 2 minutes
```

### Retry Guidelines

**Network-Dependent:**
```typescript
// API calls, page loads
retryCount: 3-5
```

**UI Interactions:**
```typescript
// Clicks, form interactions
retryCount: 2-3
```

**Critical Operations:**
```typescript
// Must succeed operations
retryCount: 5-10
```

**Fast Operations:**
```typescript
// Quick operations
retryCount: 1-2
```

### State Management Best Practices

**Keep It Simple:**
```typescript
// Good - clear and simple
{
  activateStates: ["next-state"],
  deactivateStates: ["current-state"],
  staysVisible: false
}

// Bad - overly complex
{
  activateStates: ["state1", "state2", "state3", "state4"],
  deactivateStates: ["state5", "state6", "state7"],
  staysVisible: true
}
```

**Explicit is Better:**
```typescript
// Good - explicit deactivation
{
  fromState: "login",
  toState: "dashboard",
  activateStates: ["dashboard"],
  deactivateStates: ["login"]
}

// Bad - assuming implicit behavior
{
  fromState: "login",
  toState: "dashboard",
  activateStates: ["dashboard"]
  // Forgot to deactivate login!
}
```

**Modals and Overlays:**
```typescript
// Good - keep background visible
{
  fromState: "main-page",
  toState: "settings-modal",
  activateStates: ["settings-modal"],
  staysVisible: true,       // Main page stays
  deactivateStates: []      // Don't hide anything
}
```

### Workflow Organization

**Logical Ordering:**
```typescript
// Good - logical sequence
workflows: [
  "click-submit",
  "wait-for-response",
  "verify-success"
]

// Bad - illogical order
workflows: [
  "verify-success",
  "click-submit",
  "wait-for-response"
]
```

**Single Responsibility:**
```typescript
// Good - focused workflows
workflows: [
  "fill-username",
  "fill-password",
  "click-login"
]

// Bad - monolithic workflow
workflows: [
  "do-entire-login-process"  // Too much in one workflow
]
```

**Reusability:**
```typescript
// Good - reusable components
workflows: [
  "verify-page-loaded",     // Reusable
  "perform-specific-action",
  "verify-action-success"   // Reusable
]
```

## Troubleshooting

### Transition Fails to Execute

**Problem**: Transition doesn't execute
**Solutions:**
- Check timeout (may be too short)
- Verify workflows exist
- Check state IDs are correct
- Look for validation errors
- Review retry count

### Transition Executes But Fails

**Problem**: Transition runs but doesn't succeed
**Solutions:**
- Check workflow logic
- Increase timeout
- Add retry logic
- Verify target state conditions
- Check network/performance

### Wrong State Activated

**Problem**: Unexpected state becomes active
**Solutions:**
- Review activateStates list
- Check deactivateStates list
- Verify staysVisible setting
- Look for conflicting transitions

### Circular Dependencies

**Problem**: States loop endlessly
**Solutions:**
- Run validation to detect cycles
- Review transition flow
- Add exit conditions
- Restructure state machine

### Performance Issues

**Problem**: Too many transitions slow down execution
**Solutions:**
- Consolidate similar transitions
- Optimize workflows
- Reduce retry counts
- Use appropriate timeouts

## Advanced Features

### Multiple Target States

Activate multiple states simultaneously:

```typescript
{
  fromState: "search",
  toState: "results",
  activateStates: ["results", "filters", "pagination"],
  deactivateStates: ["search-form"]
}
```

### Conditional Transitions

Use workflow conditional logic:

```typescript
{
  workflows: [
    "check-login-status",
    // If logged in, go to dashboard
    // If not, go to login
  ]
}
```

### Transition Chaining

Create sequences of transitions:

```
Login → Dashboard → Profile → Settings
```

Each transition executes after the previous completes.

### Error Recovery

Handle transition failures:

```typescript
{
  workflows: [
    "attempt-operation",
    "on-error-retry",
    "on-final-error-notify"
  ],
  retryCount: 3
}
```

## Related Documentation

- **[Transition Templates](./templates.md)** - Template guide
- **[Transition Validation](./validation.md)** - Validation details
- **[State Builder](../state-builder/README.md)** - Managing states
- **[Best Practices](../best-practices/large-projects.md)** - Large project strategies

## Quick Reference

### Common Tasks

**Create Outgoing Transition:**
1. Select source state
2. Click "Add Outgoing Transition"
3. Select target state
4. Configure properties
5. Save

**Create Incoming Transition:**
1. Select target state
2. Click "Add Incoming Transition"
3. Add workflows
4. Configure timeout/retry
5. Save

**Edit Transition:**
1. Click transition edge/node
2. Modify properties in panel
3. Save changes

**Delete Transition:**
1. Select transition
2. Click delete button
3. Confirm deletion

### Validation Checklist

- [ ] All state references valid
- [ ] All workflows exist
- [ ] No circular dependencies
- [ ] All states reachable
- [ ] Timeouts appropriate
- [ ] Retry counts reasonable
- [ ] State management correct

---

**Next Steps:**
- Learn about [Transition Templates](./templates.md)
- Read [Validation Guide](./validation.md)
- Explore [State Builder](../state-builder/README.md)
- Review [Best Practices](../best-practices/large-projects.md)
