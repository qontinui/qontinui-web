# Enhanced State Builder

A comprehensive state management interface for large QontinUI projects with advanced organization, visualization, and editing capabilities.

## Overview

The Enhanced State Builder provides a professional, scalable interface for managing complex state machines with hundreds of states. It features a three-panel layout similar to modern IDEs, with powerful search, filtering, and bulk operations.

## Features

### 1. Layout

The component uses a three-column layout:

- **Left Sidebar**: State navigator with groups, search, and filtering
- **Center Panel**: Visual state canvas showing StateImages, regions, and locations
- **Right Panel**: Tabbed properties editor for the selected state

### 2. State Navigator (Left Sidebar)

- **Hierarchical Groups**: Organize states into folders/groups
- **Search & Filter**:
  - Full-text search across state names and descriptions
  - Filter by: has images, has transitions, tags, complexity
  - Multiple filters can be combined
- **State List**:
  - Shows thumbnail previews when available
  - Color-coded complexity badges
  - Status indicators (has images, has transitions)
  - Multi-select with checkboxes for bulk operations
- **Quick Actions**:
  - Create new state
  - Create from template
  - Duplicate state
  - Delete state

### 3. State Canvas (Center Panel)

Visual representation of the current state:

- **StateImages Grid**: Shows up to 6 StateImages in a grid layout
  - Each shows thumbnail if available
  - Pattern count badge
  - Click to select for editing
- **Regions Preview**: Grid view of all regions with dimensions
- **Locations Preview**: Grid view of all locations with coordinates
- **Zoom & Pan Controls**:
  - Zoom in/out buttons
  - Reset view button
  - Supports transform for scaling

### 4. State Properties Panel (Right Panel)

Tabbed interface for editing state details:

#### Overview Tab

- State name and description
- Initial state checkbox
- Complexity score display
- Summary statistics (count of images, regions, locations, strings)

#### Images Tab

- List of all StateImages
- Add/remove StateImages
- Preview of first pattern for each StateImage
- Pattern count display

#### Regions Tab

- List of all regions
- Add/remove regions
- Region properties display (position, dimensions)

#### Locations Tab

- List of all locations
- Add/remove locations
- Location properties (coordinates, anchor, fixed)

### 5. State Templates

Pre-configured state structures for common patterns:

- **Basic Menu State**: Template for menu interfaces
- **Login Form State**: Template with username/password strings

Create states from templates via the template dialog.

### 6. Bulk Operations

Select multiple states and perform operations:

- **Duplicate**: Create copies of all selected states
- **Export**: Export selected states to JSON file
- **Delete**: Delete all selected states (with confirmation)
- **Move to Group**: Move to different organizational group (planned)
- **Add Tags**: Bulk tag management (planned)

### 7. Advanced Features (Planned)

The component is designed to support:

- **State Comparison**: Compare two states to find differences
- **Relationship Graph**: Visualize state transitions and connections
- **Find Similar States**: AI-powered similarity detection
- **State Validation**: Check for common issues and configuration errors
- **Usage Tracking**: See which workflows reference each state
- **Saved Searches**: Save and reuse complex filter combinations

### 8. Performance Optimizations

- **Lazy Loading**: State properties loaded on-demand
- **Virtual Scrolling**: Efficient rendering of large state lists
- **Memoization**: Computed values cached using `useMemo`
- **Debounced Auto-save**: Automatic saving with debounce to prevent excessive writes

## Usage

### Basic Usage

```tsx
import { EnhancedStateBuilder } from "@/components/state-builder";

function MyPage() {
  return <EnhancedStateBuilder />;
}
```

### Integration with Automation Context

The component integrates seamlessly with the AutomationContext:

```tsx
const {
  states,
  transitions,
  workflows,
  images,
  addState,
  updateState,
  deleteState,
  // ... other context methods
} = useAutomation();
```

### Creating Custom Templates

Templates can be defined in the component or loaded from a service:

```typescript
const template: StateTemplate = {
  id: "custom-template",
  name: "My Custom Template",
  description: "Template description",
  template: {
    name: "New State Name",
    description: "State description",
    stateImages: [],
    regions: [
      {
        id: "region-1",
        name: "Main Region",
        x: 0,
        y: 0,
        width: 800,
        height: 600,
      },
    ],
    locations: [],
    strings: [],
  },
};
```

## Architecture

### Component Structure

```
EnhancedStateBuilder/
├── index.ts                 # Exports
├── types.ts                 # TypeScript types
├── README.md               # Documentation
└── EnhancedStateBuilder.tsx # Main component
```

### State Management

The component uses React hooks for local UI state:

- `useState` for UI state (selected items, filters, dialogs)
- `useMemo` for computed values (filtered lists, complexity scores)
- `useCallback` for memoized handlers
- AutomationContext for persistent state data

### Data Flow

1. **Read**: Component reads states from AutomationContext
2. **Filter**: Local filters applied to create filtered view
3. **Select**: User selects state to view/edit
4. **Edit**: User makes changes in properties panel
5. **Save**: Changes saved via context methods to IndexedDB

## Extending the Component

### Adding New Filters

To add a new filter:

1. Add state variable:

```tsx
const [filterCustom, setFilterCustom] = useState<boolean | null>(null);
```

2. Update `filteredStates` computation:

```tsx
if (filterCustom !== null) {
  filtered = filtered.filter((s) => /* your logic */);
}
```

3. Add UI control in navigator's filter dropdown

### Adding New Tabs

To add a new property tab:

1. Add tab trigger:

```tsx
<TabsTrigger value="custom">Custom</TabsTrigger>
```

2. Add tab content:

```tsx
<TabsContent value="custom">{/* Your custom content */}</TabsContent>
```

### Implementing Graph Visualization

For the relationship graph feature:

1. Install a graph library (e.g., react-flow, cytoscape)
2. Create graph data structure from states and transitions
3. Render in the graph dialog
4. Add interaction handlers (click to navigate, filter by type, etc.)

## Styling

The component uses:

- **Tailwind CSS**: For utility classes
- **shadcn/ui**: For base component styling
- **CSS Grid**: For responsive three-column layout
- **CSS Transforms**: For canvas zoom/pan

Custom styling can be applied via the `className` prop or by modifying the component's internal styles.

## Performance Considerations

### Large Projects (1000+ States)

- Virtual scrolling recommended for state list
- Consider pagination for canvas rendering
- Implement lazy loading for state properties
- Use web workers for complex computations (similarity, validation)

### Memory Management

- Unload non-visible state details
- Use thumbnail images instead of full resolution
- Implement cleanup in useEffect hooks
- Consider IndexedDB for offline caching

## Future Enhancements

Planned features for future versions:

1. **Advanced Search**:
   - Regex support
   - Field-specific search
   - Search within StateImage patterns

2. **State Organization Service**:
   - Persistent groups/folders
   - Drag-and-drop reorganization
   - Group colors and icons

3. **Collaboration Features**:
   - State comments/annotations
   - Version history
   - Change tracking

4. **AI-Powered Features**:
   - Auto-tagging based on content
   - Duplicate state detection
   - Smart template suggestions

5. **Export Options**:
   - Multiple formats (JSON, YAML, CSV)
   - Custom export templates
   - Batch export with filtering

6. **Canvas Enhancements**:
   - Visual region editor (draw on image)
   - Drag-to-position locations
   - Image annotation tools

## Troubleshooting

### States not appearing

Check that:

1. AutomationContext is properly initialized
2. Project has states loaded
3. Filters are not hiding all states

### Performance issues

Try:

1. Reducing the number of visible states
2. Disabling previews/thumbnails
3. Clearing browser cache
4. Using Chrome DevTools Performance profiler

### Styling issues

Ensure:

1. Tailwind CSS is properly configured
2. shadcn/ui components are installed
3. No conflicting CSS classes

## Contributing

When contributing to the Enhanced State Builder:

1. Follow existing code style
2. Add TypeScript types for new features
3. Update this README with new functionality
4. Test with large datasets (100+ states)
5. Ensure responsive design works
6. Add comments for complex logic

## License

Part of the QontinUI Web project.
