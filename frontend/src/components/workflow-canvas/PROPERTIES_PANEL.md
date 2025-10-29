# Properties Panel Integration

Complete documentation for the workflow canvas properties panel integration.

## Overview

The Properties Panel is a context-aware UI component that displays and edits properties for selected elements in the workflow canvas. It seamlessly integrates existing action property editors with the canvas workflow system.

## Architecture

### Core Components

```
CanvasPropertiesPanel (Main)
├── WorkflowProperties (No selection)
├── SingleNodeProperties (1 node selected)
│   ├── PropertyEditorWrapper (Adapter)
│   └── PropertyHistory (Change tracking)
├── MultiSelectProperties (Multiple nodes)
└── ConnectionProperties (Edge selected)
```

### State Management

**Properties Panel Store** (`properties-panel-store.ts`):
- Panel visibility and layout
- Collapsed sections
- Unsaved changes tracking
- Auto-save settings

**Canvas Store Integration**:
- Reads from canvas store for data
- Updates canvas store through actions
- Tracks selection state

### Property Adapter

The `property-adapter.tsx` bridges existing action property components with the canvas store:

```typescript
const { action, updateConfig, saveChanges } = usePropertyAdapter(actionId);

<ClickActionProperties
  action={action}
  updateConfig={updateConfig}
/>
```

## Usage

### Basic Usage

```tsx
import { CanvasPropertiesPanel } from './workflow-canvas/CanvasPropertiesPanel';

function WorkflowEditor() {
  return (
    <div className="editor-layout">
      <Canvas />
      <CanvasPropertiesPanel
        position="right"
        collapsible={true}
      />
    </div>
  );
}
```

### With Custom Position

```tsx
// Right panel (default)
<CanvasPropertiesPanel position="right" />

// Bottom panel
<CanvasPropertiesPanel position="bottom" />

// Floating panel
<CanvasPropertiesPanel position="floating" />
```

### Programmatic Control

```typescript
import { usePropertiesPanelStore } from '@/stores/properties-panel-store';

function MyComponent() {
  const { toggleOpen, setPosition } = usePropertiesPanelStore();

  return (
    <>
      <button onClick={toggleOpen}>Toggle Properties</button>
      <button onClick={() => setPosition('bottom')}>Move to Bottom</button>
    </>
  );
}
```

## Features

### Context-Aware Display

The panel automatically shows the appropriate editor based on selection:

1. **Single Node**: Full property editor + history
2. **Multiple Nodes**: Batch edit common properties
3. **Edge**: Connection properties
4. **No Selection**: Workflow metadata

### Auto-Save

Configure auto-save behavior:

```typescript
const { setAutoSave, setAutoSaveDelay } = usePropertiesPanelStore();

// Enable auto-save with 500ms delay
setAutoSave(true);
setAutoSaveDelay(500);
```

### Change Tracking

All property modifications are tracked:

```typescript
const { recordChange, getChangesForAction } = usePropertiesPanelStore();

// Changes are automatically recorded by the adapter
const changes = getChangesForAction('action-1');
// [{ property: 'config.target', oldValue: 'A', newValue: 'B', timestamp: ... }]
```

### Validation

Real-time validation with inline error messages:

```typescript
import { validateAction, validateProperty } from './property-validation';

// Validate entire action
const result = validateAction(action);
if (!result.valid) {
  console.log(result.errors);
}

// Validate single property
const error = validateProperty(action, 'config.target', newValue);
```

## Property Editor Integration

### Using Existing Property Components

Existing action property components work automatically:

```tsx
// Your existing component
export function ClickActionProperties({ action, updateConfig }) {
  return (
    <Input
      value={action.config.target}
      onChange={(e) => updateConfig('target', e.target.value)}
    />
  );
}

// No changes needed! The adapter handles integration:
<PropertyEditorWrapper
  actionId={nodeId}
  component={ClickActionProperties}
/>
```

### Creating New Property Editors

Follow the existing pattern:

```tsx
import { ActionPropertiesComponentProps } from '../types';

export function MyActionProperties({
  action,
  updateConfig
}: ActionPropertiesComponentProps) {
  return (
    <div className="space-y-4">
      <Input
        value={action.config.myProperty}
        onChange={(e) => updateConfig('myProperty', e.target.value)}
      />
    </div>
  );
}
```

Then register it:

```typescript
import { actionConfigRegistry } from '../ActionConfigRegistry';

actionConfigRegistry.register(
  'MY_ACTION',
  MyActionProperties,
  'My Action'
);
```

## Multi-Select Editing

When multiple nodes are selected:

### Common Properties

Only properties common to all selected nodes are shown:

```tsx
<MultiSelectProperties actionIds={['action-1', 'action-2']} />
```

### Mixed Values

Properties with different values show "(mixed)":

```tsx
const { getCommonValue, isMixedValue } = useMultiPropertyAdapter(actionIds);

if (isMixedValue('timeout')) {
  // Show "(mixed)" indicator
}
```

### Batch Updates

Update all selected nodes at once:

```tsx
const { updateCommonConfig } = useMultiPropertyAdapter(actionIds);

// Updates all selected actions
updateCommonConfig('enabled', true);
```

## Quick Edit Popover

Inline editing for common properties:

```tsx
import { QuickEditPopover } from './QuickEditPopover';

function NodeComponent({ nodeId }) {
  const [quickEditOpen, setQuickEditOpen] = useState(false);

  return (
    <div onDoubleClick={() => setQuickEditOpen(true)}>
      <QuickEditPopover
        actionId={nodeId}
        open={quickEditOpen}
        onOpenChange={setQuickEditOpen}
      />
    </div>
  );
}
```

## Validation System

### Built-in Validators

```typescript
import {
  required,
  numberRange,
  stringLength,
  pattern,
  enumValue
} from './property-validation';

// Required field
required('target', 'Target is required')

// Number in range
numberRange('timeout', 0, 10000, 'Timeout must be 0-10000ms')

// String length
stringLength('name', 1, 100)

// Regex pattern
pattern('variableName', /^[a-zA-Z_][a-zA-Z0-9_]*$/)

// Enum values
enumValue('mouseButton', ['LEFT', 'RIGHT', 'MIDDLE'])
```

### Custom Validators

```typescript
import { custom } from './property-validation';

const myValidator = custom(
  'myProperty',
  (value, config, action) => {
    return value > config.otherProperty;
  },
  'myProperty must be greater than otherProperty',
  'error'
);
```

### Register Validators

```typescript
import { registerValidator } from './property-validation';

registerValidator('MY_ACTION', myValidator);
```

## Styling

### CSS Classes

The panel uses BEM-style CSS classes:

```css
/* Panel container */
.properties-panel { }

/* Position variants */
.properties-panel.position-right { }
.properties-panel.position-bottom { }
.properties-panel.position-floating { }

/* Resize handle */
.resize-handle { }
.resize-handle.resizing { }

/* Sections */
.panel-section { }
.panel-section-title { }

/* Property inputs */
.property-input { }
.property-input.error { }
.property-label { }

/* Validation */
.validation-error { }
.validation-warning { }
.validation-info { }
```

### Custom Styling

```tsx
<CanvasPropertiesPanel
  className="my-custom-panel"
  position="right"
/>
```

## Keyboard Shortcuts

- **Enter**: Save changes (in quick edit)
- **Escape**: Cancel changes (in quick edit)
- **Tab**: Navigate between fields
- **Shift+Tab**: Navigate backwards

## Performance

### Auto-Save Optimization

Changes are debounced to avoid excessive updates:

```typescript
// Changes are batched and saved after delay
updateConfig('property', value);
// ... more changes within 500ms ...
// All changes saved together after delay
```

### Selective Re-renders

The panel uses fine-grained state management to minimize re-renders:

```typescript
// Only subscribes to specific state
const width = usePropertiesPanelStore((state) => state.width);
```

## Testing

### Component Tests

```typescript
import { render, screen } from '@testing-library/react';
import { CanvasPropertiesPanel } from './CanvasPropertiesPanel';

it('should show single node properties', () => {
  render(<CanvasPropertiesPanel />);
  expect(screen.getByText('Properties')).toBeInTheDocument();
});
```

### Integration Tests

```typescript
it('should update action through adapter', async () => {
  const { result } = renderHook(() => usePropertyAdapter('action-1'));

  act(() => {
    result.current.updateConfig('target', 'new-value');
  });

  await waitFor(() => {
    expect(result.current.action.config.target).toBe('new-value');
  });
});
```

## Troubleshooting

### Property Updates Not Saving

1. Check auto-save is enabled
2. Verify adapter is properly connected
3. Check console for validation errors

```typescript
const { autoSave, hasUnsavedChanges } = usePropertiesPanelStore();
console.log({ autoSave, hasUnsavedChanges });
```

### Panel Not Appearing

1. Check `isOpen` state
2. Verify proper CSS classes
3. Check z-index conflicts

```typescript
const { isOpen, toggleOpen } = usePropertiesPanelStore();
if (!isOpen) toggleOpen();
```

### Validation Not Working

1. Ensure validators are registered
2. Check action type matches
3. Verify validation is enabled

```typescript
import { getValidationRules } from './property-validation';
const rules = getValidationRules('MY_ACTION');
console.log(rules);
```

## Advanced Usage

### Custom Property Adapter

Create a custom adapter for specialized needs:

```typescript
export function useCustomPropertyAdapter(actionId: string) {
  const { action, updateConfig } = usePropertyAdapter(actionId);

  // Add custom logic
  const updateWithLogging = (key: string, value: any) => {
    console.log('Updating:', key, value);
    updateConfig(key, value);
  };

  return { action, updateConfig: updateWithLogging };
}
```

### Custom Validation Rules

```typescript
import { ValidatorFunction } from './property-validation';

const conditionalValidator: ValidatorFunction = (value, config, action) => {
  if (config.mode === 'advanced' && !value) {
    return {
      property: 'advancedValue',
      message: 'Required in advanced mode',
      severity: 'error',
    };
  }
  return null;
};
```

### Panel Position Persistence

Panel position and size are automatically persisted:

```typescript
// Position is saved to localStorage
// and restored on next session
const { position, width, height } = usePropertiesPanelStore();
```

## API Reference

### CanvasPropertiesPanel Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| position | 'right' \| 'bottom' \| 'floating' | 'right' | Panel position |
| collapsible | boolean | true | Allow collapsing |
| defaultCollapsed | boolean | false | Start collapsed |
| className | string | '' | Custom CSS class |

### Property Adapter Hooks

#### usePropertyAdapter

```typescript
function usePropertyAdapter(actionId: string): {
  action: Action | null;
  updateConfig: (key: string, value: any) => void;
  updateAction: (updates: Partial<Action>) => void;
  hasUnsavedChanges: boolean;
  saveChanges: () => void;
  discardChanges: () => void;
  canvasAction: Action | null;
}
```

#### useMultiPropertyAdapter

```typescript
function useMultiPropertyAdapter(actionIds: string[]): {
  actions: Action[];
  updateCommonConfig: (key: string, value: any) => void;
  getCommonValue: (key: string) => any | undefined;
  isMixedValue: (key: string) => boolean;
  saveAllChanges: () => void;
  discardAllChanges: () => void;
  canvasActions: Action[];
}
```

## Examples

### Complete Integration

```tsx
import { CanvasPropertiesPanel } from './workflow-canvas/CanvasPropertiesPanel';
import { usePropertiesPanelStore } from '@/stores/properties-panel-store';

function WorkflowEditor() {
  const { isOpen, toggleOpen } = usePropertiesPanelStore();

  return (
    <div className="h-screen flex">
      {/* Canvas */}
      <div className="flex-1">
        <WorkflowCanvas />
      </div>

      {/* Properties Panel */}
      <CanvasPropertiesPanel
        position="right"
        collapsible={true}
      />

      {/* Toolbar */}
      <div className="absolute top-4 right-4">
        <button onClick={toggleOpen}>
          {isOpen ? 'Hide' : 'Show'} Properties
        </button>
      </div>
    </div>
  );
}
```

### With Quick Edit

```tsx
function NodeComponent({ data }) {
  const [quickEditOpen, setQuickEditOpen] = useState(false);

  return (
    <>
      <div
        onDoubleClick={() => setQuickEditOpen(true)}
        className="node"
      >
        {data.label}
      </div>

      <QuickEditPopover
        actionId={data.id}
        open={quickEditOpen}
        onOpenChange={setQuickEditOpen}
      />
    </>
  );
}
```

## Migration Guide

### From Standalone Property Editors

If you have existing standalone property editors:

1. Keep your existing component unchanged
2. Register it with the action config registry
3. Use PropertyEditorWrapper to integrate

```typescript
// Before (standalone)
<ClickActionProperties
  action={action}
  onUpdate={handleUpdate}
/>

// After (integrated)
<PropertyEditorWrapper
  actionId={nodeId}
  component={ClickActionProperties}
/>
```

### From Other Property Systems

If migrating from a different property system:

1. Adapt your update handlers to use `updateConfig`
2. Convert action format using the adapter
3. Register validators for your action types

## Contributing

When adding new property editors:

1. Follow existing patterns
2. Add validation rules
3. Register with action config registry
4. Add tests
5. Update documentation

## Resources

- [Action Schema Documentation](../lib/action-schema/README.md)
- [Canvas Store Documentation](../../stores/canvas-store.ts)
- [Action Properties Components](../action-properties/README.md)
- [React Flow Documentation](https://reactflow.dev/)

## Support

For issues or questions:
1. Check this documentation
2. Review test files for examples
3. Check the troubleshooting section
4. Open an issue on GitHub
