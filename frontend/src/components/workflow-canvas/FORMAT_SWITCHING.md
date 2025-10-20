## Format Switching Documentation

# Format Switching System for Workflow Editor

## Overview

This document describes the format switching system that allows users to convert between sequential (list) and graph views of workflows. The system provides safe, reversible conversions with clear communication about changes.

---

## Table of Contents

1. [When to Use Each Format](#when-to-use-each-format)
2. [Conversion Process](#conversion-process)
3. [Linearizability Explained](#linearizability-explained)
4. [Data Loss Scenarios](#data-loss-scenarios)
5. [Best Practices](#best-practices)
6. [Troubleshooting](#troubleshooting)
7. [API Reference](#api-reference)

---

## When to Use Each Format

### List View

**Best For:**
- Simple sequential workflows (fewer than 10 actions)
- Linear execution paths without complex branching
- Quick prototyping and testing
- Workflows with minimal control flow

**Pros:**
- Easy to understand and read
- Compact display
- Simple editing (inline text)
- Clear execution order

**Cons:**
- Hard to visualize complex branches
- Limited space for large workflows
- Difficult to see parallel paths

**Example Use Cases:**
```
1. CLICK "Login Button"
2. TYPE "username@example.com"
3. TYPE "password123"
4. CLICK "Submit"
5. WAIT 2000ms
6. SCREENSHOT
```

### Graph View

**Best For:**
- Complex workflows with branching (IF, LOOP, SWITCH)
- Workflows with parallel execution
- Visual representation of data flow
- Collaborative editing and review

**Pros:**
- Visual clarity for complex logic
- Easy to see parallel paths
- Supports merge points
- Drag-and-drop editing

**Cons:**
- Takes more screen space
- Can be overwhelming for simple workflows
- Requires understanding of graph concepts

**Example Use Cases:**
```
┌─────────────┐
│ CLICK Login │
└──────┬──────┘
       │
  ┌────▼────┐
  │ TYPE    │
  └────┬────┘
       │
  ┌────▼────┐
  │   IF    │
  └─┬───┬───┘
    │   │
 true│  │false
    │   │
┌───▼──┐│
│SUCCESS││
└──────┘│
      ┌─▼─────┐
      │ RETRY │
      └───────┘
```

---

## Conversion Process

### Sequential → Graph Conversion

**Always Possible:** ✅ Sequential workflows can always be converted to graph format.

**Process:**
1. Parse sequential action list
2. Create explicit connections between actions
3. Handle nested control flow (IF/LOOP branches)
4. Apply auto-layout to position nodes
5. Validate connection structure

**Configuration Options:**
```typescript
{
  layout: 'hierarchical' | 'horizontal' | 'tree' | 'force' | 'circular',
  preserveActionIds: boolean,
  autoLayout: boolean
}
```

**Example:**
```typescript
const result = await formatConverter.convertToGraph(workflow, {
  autoLayout: true,
  layoutStyle: 'hierarchical'
});
```

### Graph → Sequential Conversion

**Conditional:** ⚠️ Only possible if workflow is linearizable.

**Linearizability Requirements:**
- Single entry point
- No merge nodes (multiple paths converging)
- No complex parallel execution
- No cycles (except valid LOOP back-edges)

**Process:**
1. Check linearizability
2. Topological sort of actions
3. Rebuild nested control structures
4. Remove position data
5. Validate sequential structure

**Example:**
```typescript
// Check if conversion is possible
const canConvert = formatConverter.canConvertToSequential(workflow);

if (canConvert.linearizable) {
  const result = await formatConverter.convertToSequential(workflow);
}
```

---

## Linearizability Explained

### What is Linearizability?

A graph workflow is **linearizable** if it can be converted to a sequential list while preserving the same execution behavior. This means actions must execute in a single, deterministic order.

### Linearizable Examples

#### ✅ Simple Sequence
```
A → B → C → D
```
**Sequential:** [A, B, C, D]

#### ✅ IF with Branches
```
     A
     │
    IF
   ┌─┴─┐
  B│   │C
   │   │
   └─┬─┘
     D
```
**Sequential:**
```
A
IF (condition)
  then: B
  else: C
D
```

#### ✅ LOOP with Body
```
    A
    │
  LOOP
    │
    B
    │
   ┌─┘
   │
   C
```
**Sequential:**
```
A
LOOP (condition)
  actions: B
C
```

### Non-Linearizable Examples

#### ❌ Merge Node
```
   A
  ┌┴┐
  B C
  └┬┘
   D
```
**Problem:** D has two incoming paths. In sequential format, we can't represent that D should execute after both B and C complete.

#### ❌ Diamond Pattern
```
     A
   ┌─┴─┐
   B   C
   └─┬─┘
     D
```
**Problem:** Similar to merge node. Unclear if B and C execute in parallel or if one waits for the other.

#### ❌ Complex Cycles
```
A → B → C
↑       │
└───────┘
```
**Problem:** Cyclic dependency outside of a LOOP action. Sequential format can't represent arbitrary cycles.

### Detecting Non-Linearizability

The system checks for:

1. **Multiple Entry Points**
   - Only one action should have no incoming connections

2. **Merge Nodes**
   - Actions with more than one incoming connection

3. **Parallel Branches**
   - Multiple outputs from non-control-flow actions

4. **Invalid Cycles**
   - Cycles that aren't part of LOOP actions

---

## Data Loss Scenarios

### What's Preserved

✅ **Always Preserved:**
- Action IDs
- Action types
- Action configurations
- Execution order (in linearizable workflows)
- Control flow behavior (IF/LOOP/SWITCH)
- Variables
- Metadata

### What's Lost or Changed

⚠️ **Sequential → Graph:**
- **Nothing lost!** Conversion adds information (positions, explicit connections)

⚠️ **Graph → Sequential:**
- **Position data:** Node positions in graph are removed
- **Layout information:** Custom layouts are lost
- **Visual arrangement:** Spatial relationships are lost
- **Merge point behavior:** If workflow has merge nodes (non-linearizable)

### Warning Messages

You'll see warnings when converting graph → sequential if:

1. **Merge Nodes Detected**
   ```
   "Workflow has 3 merge nodes. Actions receive input from multiple paths.
   Sequential format cannot represent this structure."
   ```

2. **Parallel Branches Detected**
   ```
   "Action 'data-fetch' has parallel execution branches.
   These will be serialized in sequential format."
   ```

3. **Complex Control Flow**
   ```
   "SWITCH action has 5 cases. Ensure all branches are independent."
   ```

---

## Best Practices

### 1. Design for Your Target Format

If you plan to use list view:
- Keep workflows simple and linear
- Minimize branching depth
- Avoid complex merge patterns
- Use control flow actions (IF/LOOP) for branches

If you plan to use graph view:
- Embrace visual layout
- Use parallel execution when appropriate
- Leverage merge nodes for complex logic
- Take advantage of spatial organization

### 2. Convert Early and Often

- Convert after major structural changes
- Test execution in both formats (if linearizable)
- Use conversion preview to verify changes

### 3. Use Conversion Preview

Before converting:
```typescript
const preview = formatConverter.previewConversion(workflow, 'sequential');

if (preview.canConvert) {
  console.log(`Impact: ${preview.impact}`);
  console.log(`Recommendation: ${preview.recommendation}`);
  preview.warnings.forEach(w => console.warn(w.message));
}
```

### 4. Save Conversion History

The system automatically tracks conversions:
```typescript
const history = useConversionHistoryStore();
const lastConversion = history.getLastConversion(workflowId);

if (lastConversion && canUndoConversion(lastConversion)) {
  // Undo available
  workflow = lastConversion.beforeSnapshot;
}
```

### 5. Validate After Conversion

Always validate critical workflows:
```typescript
const validation = formatConverter.validateConversion(original, converted);

if (!validation.valid) {
  console.error('Conversion errors:', validation.errors);
}
```

---

## Troubleshooting

### Problem: "Workflow cannot be linearized"

**Cause:** Workflow has structural features that prevent sequential conversion.

**Solution:**
1. Check linearizability result: `formatConverter.canConvertToSequential(workflow)`
2. Review issues list to identify blockers
3. Options:
   - Restructure workflow to be linearizable
   - Stay in graph format
   - Manually convert problem areas

**Example:**
```typescript
const check = formatConverter.canConvertToSequential(workflow);
if (!check.linearizable) {
  console.log('Issues:', check.issues);
  // ["Merge nodes detected: action-123, action-456"]
}
```

### Problem: "Actions are missing after conversion"

**Cause:** Validation detected data loss during conversion.

**Solution:**
1. Check validation results
2. Look for nested actions in control flow
3. Verify all action IDs are unique
4. Review conversion history

### Problem: "Layout looks wrong after conversion"

**Cause:** Auto-layout may not match your preferred arrangement.

**Solution:**
1. Try different layout styles:
   ```typescript
   applyAutoLayoutOnConversion(workflow, LayoutStyle.HIERARCHICAL);
   applyAutoLayoutOnConversion(workflow, LayoutStyle.HORIZONTAL);
   applyAutoLayoutOnConversion(workflow, LayoutStyle.TREE);
   ```

2. Use layout comparison:
   ```typescript
   const comparisons = compareLayoutStyles(workflow);
   const best = comparisons[0]; // Highest quality
   ```

3. Manually adjust positions after auto-layout

### Problem: "Conversion is too slow"

**Cause:** Large workflows with many actions.

**Solution:**
1. Disable validation during conversion:
   ```typescript
   convertToGraph(workflow, { validate: false });
   ```

2. Disable auto-layout:
   ```typescript
   convertToGraph(workflow, { autoLayout: false });
   ```

3. Split large workflows into smaller sub-workflows

---

## API Reference

### FormatConverter

```typescript
class FormatConverter {
  // Convert to graph format
  async convertToGraph(
    workflow: Workflow,
    options?: ConversionOptions
  ): Promise<ConversionResult>;

  // Convert to sequential format
  async convertToSequential(
    workflow: Workflow,
    options?: ConversionOptions
  ): Promise<ConversionResult>;

  // Check if conversion is possible
  canConvertToSequential(workflow: Workflow): LinearizabilityResult;

  // Preview conversion
  previewConversion(
    workflow: Workflow,
    toFormat: 'sequential' | 'graph'
  ): ConversionPreview;

  // Validate conversion
  validateConversion(
    original: Workflow,
    converted: Workflow
  ): ConversionValidationResult;
}
```

### ConversionOptions

```typescript
interface ConversionOptions {
  validate?: boolean;           // Validate after conversion
  autoLayout?: boolean;          // Apply auto-layout (graph only)
  layoutStyle?: LayoutStyle;     // Layout algorithm
  preserveIds?: boolean;         // Keep action IDs
  preserveNames?: boolean;       // Keep action names
}
```

### ConversionResult

```typescript
interface ConversionResult {
  success: boolean;
  workflow?: Workflow;
  errors?: ConversionError[];
  warnings?: ConversionWarning[];
  statistics?: ConversionStatistics;
  validation?: ConversionValidationResult;
}
```

### LinearizabilityResult

```typescript
interface LinearizabilityResult {
  linearizable: boolean;
  issues: string[];
  details?: {
    entryPointCount: number;
    mergeNodeCount: number;
    parallelBranchCount: number;
    cycleCount: number;
  };
}
```

### Auto-Layout Functions

```typescript
// Apply auto-layout with specific style
applyAutoLayoutOnConversion(
  workflow: Workflow,
  style?: LayoutStyle,
  config?: LayoutConfig
): LayoutApplication;

// Get recommended layout style
getRecommendedLayoutStyle(workflow: Workflow): LayoutStyle;

// Compare multiple layouts
compareLayoutStyles(
  workflow: Workflow,
  styles?: LayoutStyle[]
): LayoutComparison[];

// Apply best layout automatically
applyBestLayout(workflow: Workflow): LayoutApplication;
```

---

## Keyboard Shortcuts

- **Ctrl+Shift+V** - Toggle between list and graph view
- **Ctrl+Shift+L** - Apply auto-layout (graph view only)
- **Ctrl+Z** - Undo conversion
- **Ctrl+Shift+Z** - Redo conversion

---

## Visual Examples

### Conversion Flow

```
┌───────────────┐
│ List View     │
│               │
│ 1. CLICK      │
│ 2. TYPE       │
│ 3. IF (...)   │
│    ├─ true:   │
│    │  └─ 4.   │
│    └─ false:  │
│       └─ 5.   │
│ 6. SUBMIT     │
└───────┬───────┘
        │
        │ Convert to Graph
        ▼
┌───────────────────┐
│ Graph View        │
│                   │
│  ┌────┐           │
│  │ 1  │           │
│  └─┬──┘           │
│    │              │
│  ┌─▼──┐           │
│  │ 2  │           │
│  └─┬──┘           │
│    │              │
│  ┌─▼──┐           │
│  │IF 3│           │
│  └┬──┬┘           │
│   │  │            │
│ ┌─▼┐ └─┐          │
│ │4 │  │5│         │
│ └─┬┘  └┬┘         │
│   └───┬┘          │
│     ┌─▼──┐        │
│     │ 6  │        │
│     └────┘        │
└───────────────────┘
```

---

## Conclusion

The format switching system provides a powerful way to work with workflows in the format that best suits your needs. By understanding linearizability and following best practices, you can seamlessly convert between formats while maintaining data integrity and execution behavior.

For questions or issues, please consult the troubleshooting section or refer to the API documentation.
