

# Final React UI Components for qontinui Workflow Canvas

This document provides comprehensive documentation for the final React UI components implemented for qontinui's workflow canvas, covering format conversion, auto-layout, templates, and sequential workflow editing.

## Table of Contents

1. [Overview](#overview)
2. [Components](#components)
3. [Service Integration](#service-integration)
4. [Usage Examples](#usage-examples)
5. [Styling](#styling)
6. [Best Practices](#best-practices)
7. [Testing](#testing)

---

## Overview

This suite of components provides a complete UI layer for:

- **Format Conversion**: Switch between sequential and graph workflow formats
- **Auto-Layout**: Apply and customize layout algorithms
- **Templates**: Browse and use workflow templates
- **Sequential Editing**: Edit workflows in a list format
- **Layout Quality**: Detect and fix layout issues

### Component List

1. **FormatSwitcherDialog** - Format conversion dialog
2. **AutoLayoutPanel** - Layout configuration panel
3. **TemplateBrowser** - Template browser and manager
4. **LayoutPreview** - Visual layout preview component
5. **ConversionPreview** - Format conversion preview
6. **LayoutSuggestions** - Layout issue detection and fixes
7. **SequentialListView** - Sequential workflow list editor
8. **PresetManagerDialog** - Layout preset manager
9. **ConversionWizard** - Multi-step conversion wizard

---

## Components

### 1. FormatSwitcherDialog

Dialog for switching between sequential and graph workflow formats.

#### Props

```typescript
interface FormatSwitcherDialogProps {
  open: boolean;
  workflow: Workflow;
  currentFormat: 'sequential' | 'graph';
  onSwitch: (newWorkflow: Workflow, newFormat: 'sequential' | 'graph') => void;
  onClose: () => void;
}
```

#### Features

- View toggle (List View / Graph View)
- Format information cards
- Conversion preview with before/after comparison
- Linearizability check for graph → sequential
- Warning messages for potential data loss
- Layout selection for sequential → graph
- Progress indicator during conversion

#### Example Usage

```tsx
import { FormatSwitcherDialog } from '@/components/workflow-canvas/FormatSwitcherDialog';

function MyComponent() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [workflow, setWorkflow] = useState<Workflow>(...);

  const handleSwitch = (newWorkflow: Workflow, newFormat: 'sequential' | 'graph') => {
    setWorkflow(newWorkflow);
    setDialogOpen(false);
    // Update your application state
  };

  return (
    <>
      <button onClick={() => setDialogOpen(true)}>
        Switch Format
      </button>

      <FormatSwitcherDialog
        open={dialogOpen}
        workflow={workflow}
        currentFormat={workflow.format === 'graph' ? 'graph' : 'sequential'}
        onSwitch={handleSwitch}
        onClose={() => setDialogOpen(false)}
      />
    </>
  );
}
```

#### Visual States

- **Format Selection**: Choose target format with cards
- **Validation**: Check if conversion is possible (for graph → sequential)
- **Preview**: See before/after comparison
- **Converting**: Progress indicator during conversion
- **Error**: Display conversion errors

---

### 2. AutoLayoutPanel

Advanced panel for configuring and applying auto-layout algorithms.

#### Props

```typescript
interface AutoLayoutPanelProps {
  workflow: Workflow;
  onApplyLayout: (workflow: Workflow, animated: boolean) => void;
  onClose?: () => void;
}
```

#### Features

- 5 layout style buttons (Hierarchical, Horizontal, Tree, Force-Directed, Circular)
- 10 built-in presets (compact, balanced, spacious)
- Spacing controls with sliders
- Live preview with before/after comparison
- Statistics comparison
- Layout quality suggestions
- Animation toggle
- Save custom presets

#### Example Usage

```tsx
import { AutoLayoutPanel } from '@/components/workflow-canvas/AutoLayoutPanel';

function WorkflowEditor() {
  const [showPanel, setShowPanel] = useState(false);
  const [workflow, setWorkflow] = useState<Workflow>(...);

  const handleApplyLayout = (layoutedWorkflow: Workflow, animated: boolean) => {
    setWorkflow(layoutedWorkflow);
    // Optionally animate the transition
    if (animated) {
      // Trigger animation
    }
  };

  return (
    <>
      <button onClick={() => setShowPanel(true)}>
        Auto Layout
      </button>

      {showPanel && (
        <div className="panel-container">
          <AutoLayoutPanel
            workflow={workflow}
            onApplyLayout={handleApplyLayout}
            onClose={() => setShowPanel(false)}
          />
        </div>
      )}
    </>
  );
}
```

#### Layout Styles

1. **Hierarchical**: Top-to-bottom flow (best for branching)
2. **Horizontal**: Left-to-right flow (best for linear)
3. **Tree**: Compact tree structure (best for deep nesting)
4. **Force-Directed**: Physics-based organic layout (best for complex graphs)
5. **Circular**: Circular arrangement (best for small workflows with cycles)

#### Built-in Presets

- **Compact**: Dense layouts (150px horizontal, 100px vertical)
- **Balanced**: Standard layouts (200px horizontal, 120px vertical)
- **Spacious**: Roomy layouts (250px horizontal, 150px vertical)

---

### 3. TemplateBrowser

Browse, search, and select workflow templates.

#### Props

```typescript
interface TemplateBrowserProps {
  onSelectTemplate: (workflow: Workflow, template: WorkflowTemplate) => void;
  onClose?: () => void;
  currentWorkflow?: Workflow;
}
```

#### Features

- Category tabs (Basic, Control Flow, Data, Automation)
- Search bar with live filtering
- Grid of template cards with thumbnails
- Template preview on hover
- Template details dialog
- Save current workflow as template
- Import/Export templates
- Built-in and custom templates

#### Example Usage

```tsx
import { TemplateBrowser } from '@/components/workflow-canvas/TemplateBrowser';

function NewWorkflowDialog() {
  const [showBrowser, setShowBrowser] = useState(false);

  const handleSelectTemplate = (workflow: Workflow, template: WorkflowTemplate) => {
    // Create new workflow from template
    const newWorkflow = {
      ...workflow,
      id: generateNewId(),
      name: `New ${template.name}`
    };
    // Add to your workflow list
    setShowBrowser(false);
  };

  return (
    <>
      <button onClick={() => setShowBrowser(true)}>
        New from Template
      </button>

      {showBrowser && (
        <TemplateBrowser
          onSelectTemplate={handleSelectTemplate}
          onClose={() => setShowBrowser(false)}
          currentWorkflow={currentWorkflow}
        />
      )}
    </>
  );
}
```

#### Built-in Templates

1. **Empty Workflow**: Blank canvas
2. **Linear Workflow**: 3 sequential actions
3. **Conditional Logic**: IF/ELSE branching
4. **Loop Workflow**: FOR loop with actions
5. **Error Handling**: TRY/CATCH block
6. **Data Processing**: Filter/Map/Reduce pipeline
7. **Form Automation**: Form filling workflow
8. **Web Scraping**: Data extraction workflow

---

### 4. LayoutPreview

Miniature canvas for previewing layout changes.

#### Props

```typescript
interface LayoutPreviewProps {
  beforeWorkflow: Workflow;
  afterWorkflow: Workflow;
  comparison: LayoutComparison;
  mode?: 'side-by-side' | 'overlay' | 'before-only' | 'after-only';
  width?: number;
  height?: number;
  showStats?: boolean;
  showChangedNodes?: boolean;
  interactive?: boolean;
}
```

#### Features

- Side-by-side comparison
- Overlay mode with slider
- Zoom controls (zoom in, out, reset)
- Pan support (drag to move)
- Highlight changed nodes
- Statistics overlay
- Miniature canvas rendering

#### Example Usage

```tsx
import { LayoutPreview } from '@/components/workflow-canvas/LayoutPreview';
import { getLayoutService } from '@/services/layout-service';

function LayoutComparison() {
  const layoutService = getLayoutService();
  const previewResult = layoutService.previewLayout(
    workflow,
    LayoutStyle.HIERARCHICAL
  );

  return (
    <LayoutPreview
      beforeWorkflow={workflow}
      afterWorkflow={previewResult.workflow}
      comparison={previewResult.comparison}
      mode="side-by-side"
      showStats={true}
      showChangedNodes={true}
      interactive={true}
    />
  );
}
```

---

### 5. ConversionPreview

Preview format conversion changes.

#### Props

```typescript
interface ConversionPreviewProps {
  beforeWorkflow: Workflow;
  afterWorkflow: Workflow;
  conversionPreview: ConversionPreview;
  showWarnings?: boolean;
  showStatistics?: boolean;
}
```

#### Features

- Visual preview (before/after)
- Changes list (added/removed/modified actions)
- Warning messages
- Linearizability analysis
- Statistics comparison
- Connection changes visualization

#### Example Usage

```tsx
import { ConversionPreview } from '@/components/workflow-canvas/ConversionPreview';
import { getFormatConverter } from '@/services/format-converter';

function ConversionDialog() {
  const converter = getFormatConverter();
  const preview = converter.previewConversion(workflow, 'sequential');

  // Generate actual preview workflow
  const result = await converter.convertToSequential(workflow);

  return (
    <ConversionPreview
      beforeWorkflow={workflow}
      afterWorkflow={result.workflow!}
      conversionPreview={preview}
      showWarnings={true}
      showStatistics={true}
    />
  );
}
```

---

### 6. LayoutSuggestions

Detect and fix layout issues automatically.

#### Props

```typescript
interface LayoutSuggestionsProps {
  workflow: Workflow;
  layoutResult: LayoutPreviewResult;
  onApplySuggestion: (fixedWorkflow: Workflow) => void;
}
```

#### Features

- Detect overlapping nodes
- Detect unpositioned nodes
- Detect high edge crossings
- Detect poor compactness
- Detect unbalanced aspect ratio
- Detect disconnected nodes
- Quick-fix buttons for each issue
- Fix All button
- Dismiss functionality

#### Example Usage

```tsx
import { LayoutSuggestions } from '@/components/workflow-canvas/LayoutSuggestions';
import { getLayoutService } from '@/services/layout-service';

function LayoutQualityPanel() {
  const layoutService = getLayoutService();
  const layoutResult = layoutService.previewLayout(workflow, LayoutStyle.HIERARCHICAL);

  const handleApplySuggestion = (fixedWorkflow: Workflow) => {
    setWorkflow(fixedWorkflow);
  };

  return (
    <LayoutSuggestions
      workflow={workflow}
      layoutResult={layoutResult}
      onApplySuggestion={handleApplySuggestion}
    />
  );
}
```

---

### 7. SequentialListView

Edit workflows in a numbered list format.

#### Props

```typescript
interface SequentialListViewProps {
  workflow: Workflow;
  onActionClick?: (action: Action) => void;
  onActionEdit?: (action: Action) => void;
  onActionDelete?: (actionId: string) => void;
  onActionReorder?: (fromIndex: number, toIndex: number) => void;
  onAddAction?: (afterIndex: number) => void;
  selectedActionId?: string;
  editable?: boolean;
}
```

#### Features

- Numbered list of actions
- Indentation for nested actions (IF, LOOP, TRY_CATCH)
- Expand/collapse nested structures
- Drag-and-drop reordering
- Add action buttons between items
- Action summary display
- Quick edit inline
- Delete confirmation
- Visual connection lines

#### Example Usage

```tsx
import { SequentialListView } from '@/components/workflow-editor/SequentialListView';

function WorkflowEditor() {
  const [workflow, setWorkflow] = useState<Workflow>(...);
  const [selectedActionId, setSelectedActionId] = useState<string | null>(null);

  const handleActionClick = (action: Action) => {
    setSelectedActionId(action.id);
  };

  const handleActionDelete = (actionId: string) => {
    const updated = {
      ...workflow,
      actions: workflow.actions.filter(a => a.id !== actionId)
    };
    setWorkflow(updated);
  };

  return (
    <SequentialListView
      workflow={workflow}
      onActionClick={handleActionClick}
      onActionEdit={(action) => openEditDialog(action)}
      onActionDelete={handleActionDelete}
      onActionReorder={(from, to) => reorderActions(from, to)}
      onAddAction={(afterIndex) => openAddDialog(afterIndex)}
      selectedActionId={selectedActionId}
      editable={true}
    />
  );
}
```

#### Visual Example

```
1. [CLICK] Click "Login Button"
2. [TYPE] Type "user@example.com"
3. [IF] If login success
   ├─ true:
   │  └─ 4. [SCREENSHOT] Screenshot
   └─ false:
      └─ 5. [WAIT] Wait 2000ms
6. [CLICK] Click "Dashboard"
```

---

### 8. PresetManagerDialog

Manage layout presets (view, edit, import, export).

#### Props

```typescript
interface PresetManagerDialogProps {
  open: boolean;
  onClose: () => void;
  onSelectPreset: (preset: LayoutPreset) => void;
}
```

#### Features

- List all presets (built-in + custom)
- Category filter
- Search presets
- Preview preset settings
- Edit custom presets
- Delete custom presets
- Export preset to JSON
- Import preset from JSON
- Set as default

---

### 9. ConversionWizard

Multi-step wizard for format conversion.

#### Props

```typescript
interface ConversionWizardProps {
  open: boolean;
  workflow: Workflow;
  currentFormat: 'sequential' | 'graph';
  onComplete: (workflow: Workflow, format: 'sequential' | 'graph') => void;
  onCancel: () => void;
}
```

#### Steps

1. **Format Selection**: Choose target format (cards)
2. **Validation** (conditional): Linearizability check for graph → sequential
3. **Layout Selection** (conditional): Choose layout style for sequential → graph
4. **Preview**: Show before/after comparison
5. **Confirm**: Apply conversion with success message

#### Example Usage

```tsx
import { ConversionWizard } from '@/components/workflow-canvas/ConversionWizard';

function FormatConversionButton() {
  const [showWizard, setShowWizard] = useState(false);

  const handleComplete = (newWorkflow: Workflow, newFormat: 'sequential' | 'graph') => {
    setWorkflow(newWorkflow);
    setShowWizard(false);
    toast.success(`Converted to ${newFormat} format`);
  };

  return (
    <>
      <button onClick={() => setShowWizard(true)}>
        Convert Format (Wizard)
      </button>

      <ConversionWizard
        open={showWizard}
        workflow={workflow}
        currentFormat="graph"
        onComplete={handleComplete}
        onCancel={() => setShowWizard(false)}
      />
    </>
  );
}
```

---

## Service Integration

### Format Converter Service

```typescript
import { getFormatConverter } from '@/services/format-converter';

const converter = getFormatConverter();

// Preview conversion
const preview = converter.previewConversion(workflow, 'sequential');

// Convert to graph
const result = await converter.convertToGraph(workflow, {
  autoLayout: true,
  layoutStyle: LayoutStyle.HIERARCHICAL,
  validate: true
});

// Convert to sequential
const result = await converter.convertToSequential(workflow, {
  validate: true
});

// Check linearizability
const check = converter.canConvertToSequential(workflow);
```

### Layout Service

```typescript
import { getLayoutService } from '@/services/layout-service';

const layoutService = getLayoutService();

// Apply layout (mutates workflow)
layoutService.applyLayout(workflow, LayoutStyle.HIERARCHICAL, {
  horizontalSpacing: 200,
  verticalSpacing: 120
});

// Preview layout (non-mutating)
const preview = layoutService.previewLayout(workflow, LayoutStyle.HIERARCHICAL);

// Check if layout is needed
const needsLayout = layoutService.needsLayout(workflow);

// Get recommended layout
const recommendation = layoutService.getRecommendedLayout(workflow);
```

### Template Service

```typescript
import { workflowTemplates } from '@/services/workflow-templates';

// Get all templates
const allTemplates = workflowTemplates.getTemplates();

// Filter templates
const automationTemplates = workflowTemplates.getTemplates({
  category: 'automation'
});

// Create from template
const workflow = workflowTemplates.createFromTemplate('linear');

// Save as template
workflowTemplates.saveAsTemplate(
  workflow,
  'My Custom Template',
  'Description',
  'custom',
  ['tag1', 'tag2']
);
```

---

## Styling

All components use the provided CSS file: `final-components.css`

### CSS Variables

```css
:root {
  --primary-color: #3b82f6;
  --success-color: #10b981;
  --warning-color: #f59e0b;
  --error-color: #ef4444;
  --info-color: #8b5cf6;

  --bg-primary: #ffffff;
  --bg-secondary: #f9fafb;
  --bg-tertiary: #f3f4f6;

  --text-primary: #111827;
  --text-secondary: #6b7280;
  --text-tertiary: #9ca3af;

  --border-color: #e5e7eb;
  --border-radius: 8px;
  --spacing-unit: 4px;
}
```

### Customization

To customize styling, override CSS variables:

```css
.my-app {
  --primary-color: #6366f1;  /* Indigo */
  --border-radius: 12px;      /* Rounder corners */
  --spacing-unit: 8px;        /* More spacious */
}
```

### Dark Mode Support

All components support dark mode via CSS variables:

```css
.dark-mode {
  --bg-primary: #1f2937;
  --bg-secondary: #111827;
  --bg-tertiary: #0f172a;
  --text-primary: #f9fafb;
  --text-secondary: #d1d5db;
  --text-tertiary: #9ca3af;
  --border-color: #374151;
}
```

---

## Best Practices

### Performance

1. **Memoization**: Use `useMemo` for expensive computations
2. **Debouncing**: Debounce search inputs and preview generation
3. **Lazy Loading**: Load templates and presets on-demand
4. **Virtual Scrolling**: For large action lists, use virtual scrolling

### Accessibility

1. **Keyboard Navigation**: All dialogs support Esc to close, Tab to navigate
2. **ARIA Labels**: All interactive elements have aria-labels
3. **Focus Management**: Focus is trapped in dialogs
4. **Screen Readers**: Proper semantic HTML and ARIA attributes

### User Experience

1. **Loading States**: Show spinners during async operations
2. **Error Handling**: Display clear error messages
3. **Confirmation Dialogs**: Confirm destructive actions
4. **Undo/Redo**: Provide undo for layout changes
5. **Tooltips**: Add tooltips for icons and complex controls

---

## Testing

Run tests with:

```bash
npm test final-components.test.tsx
```

### Test Coverage

- Component rendering
- User interactions (clicks, inputs)
- State management
- Service integration
- Error handling
- Accessibility

### Example Test

```typescript
import { render, screen, fireEvent } from '@testing-library/react';
import { FormatSwitcherDialog } from './FormatSwitcherDialog';

test('calls onSwitch when convert button is clicked', async () => {
  const mockOnSwitch = vi.fn();

  render(
    <FormatSwitcherDialog
      open={true}
      workflow={mockWorkflow}
      currentFormat="graph"
      onSwitch={mockOnSwitch}
      onClose={() => {}}
    />
  );

  const convertButton = screen.getByText('Convert to Sequential Format');
  fireEvent.click(convertButton);

  await waitFor(() => {
    expect(mockOnSwitch).toHaveBeenCalled();
  });
});
```

---

## Summary

This component suite provides a complete UI layer for workflow format conversion, auto-layout, template management, and sequential editing. All components are:

- **Production-ready**: Fully implemented with error handling
- **Type-safe**: Full TypeScript support
- **Accessible**: WCAG 2.1 AA compliant
- **Responsive**: Mobile-friendly layouts
- **Performant**: Optimized rendering and updates
- **Tested**: Comprehensive test coverage

For questions or issues, refer to the individual component documentation or contact the development team.
