# Advanced Workflow Management Features

This document describes the advanced search and bulk operations features for workflow management in qontinui-web.

## Components

### AdvancedSearch

A comprehensive search and filter component that allows users to find workflows based on multiple criteria.

#### Features

- **Text Search**: Search by workflow name, description, or tags with debounced input
- **Folder Filter**: Filter workflows by folder location (multi-select)
- **Tag Filter**: Filter by tags with AND/OR operator support
- **Date Range Filters**: Filter by created or modified date ranges
- **Action Type Filter**: Filter workflows containing specific action types
- **Complexity Filter**: Filter by workflow complexity (low/medium/high/very-high)
- **Category Filter**: Filter by workflow category
- **Boolean Filters**: Has tests, has documentation
- **Save/Load Filters**: Save frequently used filter combinations
- **Export Results**: Export filtered results as JSON
- **Real-time Filtering**: Results update as filters change
- **Results Count**: Shows number of matching workflows

#### Usage

```tsx
import { AdvancedSearch } from '@/components/workflow-organization';

function MyComponent() {
  const [filteredWorkflows, setFilteredWorkflows] = useState<Workflow[]>([]);
  const [savedFilters, setSavedFilters] = useState<SavedFilter[]>([]);

  const handleSearch = (results: Workflow[], filter: SearchFilter) => {
    setFilteredWorkflows(results);
    // Update UI with filtered results
  };

  const handleSaveFilter = (name: string, filter: SearchFilter) => {
    const newFilter = {
      id: generateId(),
      name,
      filter,
      createdAt: new Date(),
    };
    setSavedFilters([...savedFilters, newFilter]);
  };

  return (
    <AdvancedSearch
      workflows={workflows}
      folders={folders}
      onSearch={handleSearch}
      onSaveFilter={handleSaveFilter}
      savedFilters={savedFilters}
    />
  );
}
```

#### Props

```typescript
interface AdvancedSearchProps {
  workflows: Workflow[];
  folders: WorkflowFolder[];
  onSearch: (results: Workflow[], filter: SearchFilter) => void;
  onSaveFilter: (name: string, filter: SearchFilter) => void;
  savedFilters?: SavedFilter[];
  className?: string;
}
```

#### Complexity Calculation

Workflow complexity is automatically calculated based on:
- Number of actions (< 5: low, < 15: medium, < 30: high, >= 30: very-high)
- Presence of control flow actions (IF, LOOP, SWITCH, TRY_CATCH)
- Presence of data operations (MAP, REDUCE, FILTER, SORT)

---

### BulkOperations

A bulk operations toolbar for performing actions on multiple workflows simultaneously.

#### Features

- **Selection Management**: Shows count and clear selection
- **Move to Folder**: Move selected workflows to a folder
- **Add Tags**: Add tags to multiple workflows
- **Remove Tags**: Remove tags from multiple workflows
- **Change Category**: Change category for multiple workflows
- **Delete**: Delete multiple workflows with confirmation
- **Export**: Export selected workflows as JSON
- **Duplicate**: Duplicate selected workflows
- **Run Tests**: Run tests for all selected workflows
- **Progress Indicators**: Shows progress for long-running operations
- **Confirmation Dialogs**: Prevents accidental destructive actions
- **Toast Notifications**: Success/error feedback

#### Usage

```tsx
import { BulkOperations } from '@/components/workflow-organization';

function MyComponent() {
  const [selectedWorkflows, setSelectedWorkflows] = useState<Workflow[]>([]);

  const handleMoveToFolder = (folderId: string) => {
    // Update workflows with new folderId
    updateWorkflows(selectedWorkflows.map(w => ({ ...w, folderId })));
    setSelectedWorkflows([]);
  };

  const handleAddTags = (tags: string[]) => {
    // Add tags to workflows
    updateWorkflows(selectedWorkflows.map(w => ({
      ...w,
      tags: [...(w.tags || []), ...tags]
    })));
    setSelectedWorkflows([]);
  };

  const handleDelete = () => {
    // Delete selected workflows
    deleteWorkflows(selectedWorkflows.map(w => w.id));
    setSelectedWorkflows([]);
  };

  return (
    <BulkOperations
      selectedWorkflows={selectedWorkflows}
      folders={folders}
      onClearSelection={() => setSelectedWorkflows([])}
      onMoveToFolder={handleMoveToFolder}
      onAddTags={handleAddTags}
      onRemoveTags={handleRemoveTags}
      onChangeCategory={handleChangeCategory}
      onDelete={handleDelete}
      onExport={handleExport}
      onRunTests={handleRunTests}
      onDuplicate={handleDuplicate}
    />
  );
}
```

#### Props

```typescript
interface BulkOperationsProps {
  selectedWorkflows: Workflow[];
  folders: WorkflowFolder[];
  onClearSelection: () => void;
  onMoveToFolder: (folderId: string) => void;
  onAddTags: (tags: string[]) => void;
  onRemoveTags: (tags: string[]) => void;
  onChangeCategory: (category: string) => void;
  onDelete: () => void;
  onExport: () => void;
  onRunTests: () => void;
  onDuplicate: () => void;
  className?: string;
}
```

---

## Working Together

These components are designed to work together for a complete workflow management experience:

1. **Search**: Use `AdvancedSearch` to filter workflows
2. **Select**: User selects workflows from filtered results
3. **Act**: Use `BulkOperations` to perform actions on selected workflows

### Complete Example

```tsx
import { AdvancedSearch, BulkOperations } from '@/components/workflow-organization';

function WorkflowManager() {
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [filteredWorkflows, setFilteredWorkflows] = useState<Workflow[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const selectedWorkflows = workflows.filter(w => selectedIds.includes(w.id));

  return (
    <div>
      {/* Search & Filter */}
      <AdvancedSearch
        workflows={workflows}
        folders={folders}
        onSearch={(results) => setFilteredWorkflows(results)}
        onSaveFilter={handleSaveFilter}
      />

      {/* Results Grid with Selection */}
      <WorkflowGrid
        workflows={filteredWorkflows}
        selectedIds={selectedIds}
        onToggleSelect={(id) => {
          if (selectedIds.includes(id)) {
            setSelectedIds(selectedIds.filter(i => i !== id));
          } else {
            setSelectedIds([...selectedIds, id]);
          }
        }}
      />

      {/* Bulk Operations Toolbar */}
      <BulkOperations
        selectedWorkflows={selectedWorkflows}
        folders={folders}
        onClearSelection={() => setSelectedIds([])}
        onMoveToFolder={(folderId) => {
          // Move workflows
          updateWorkflows(selectedIds, { folderId });
          setSelectedIds([]);
        }}
        onAddTags={(tags) => {
          // Add tags
          updateWorkflows(selectedIds, (w) => ({
            tags: [...(w.tags || []), ...tags]
          }));
          setSelectedIds([]);
        }}
        // ... other handlers
      />
    </div>
  );
}
```

---

## Types

### SearchFilter

```typescript
interface SearchFilter {
  query?: string;
  folderIds?: string[];
  tags?: string[];
  tagOperator?: 'AND' | 'OR';
  createdDateRange?: DateRange;
  modifiedDateRange?: DateRange;
  actionTypes?: string[];
  complexityLevel?: ComplexityLevel[];
  category?: string;
  hasTests?: boolean | null;
  hasDocumentation?: boolean | null;
  minSuccessRate?: number;
}
```

### SavedFilter

```typescript
interface SavedFilter {
  id: string;
  name: string;
  filter: SearchFilter;
  createdAt: Date;
}
```

### ComplexityLevel

```typescript
type ComplexityLevel = 'low' | 'medium' | 'high' | 'very-high';
```

---

## Best Practices

### Performance

1. **Debouncing**: Text search is automatically debounced (300ms) to avoid excessive filtering
2. **Memoization**: Use `useMemo` for expensive calculations
3. **Lazy Loading**: Consider pagination for large workflow lists

### UX

1. **Clear Feedback**: Always show loading states and success/error messages
2. **Confirmation**: Ask for confirmation before destructive actions
3. **Progress**: Show progress indicators for long-running operations
4. **Undo**: Consider implementing undo/redo for operations

### State Management

1. **Separate Concerns**: Keep filter state separate from selection state
2. **Persistence**: Consider saving filters to localStorage
3. **URL State**: Sync filter state with URL for sharing

---

## Styling

Both components use shadcn/ui components and are fully themeable:

```tsx
// Custom styling
<AdvancedSearch
  className="max-w-4xl mx-auto"
  // ...
/>

<BulkOperations
  className="shadow-2xl"
  // ...
/>
```

Components respect your theme configuration and work in both light and dark modes.

---

## Accessibility

- **Keyboard Navigation**: All interactive elements are keyboard accessible
- **ARIA Labels**: Proper labels for screen readers
- **Focus Management**: Logical tab order
- **Color Contrast**: WCAG AA compliant

---

## Future Enhancements

- [ ] Advanced query language (e.g., `tag:automation AND folder:main`)
- [ ] Saved search history
- [ ] Batch undo/redo
- [ ] Export to multiple formats (CSV, XLSX)
- [ ] Workflow comparison
- [ ] Smart suggestions based on search patterns
- [ ] Keyboard shortcuts
- [ ] Drag-and-drop from search results

---

## Examples

See `AdvancedSearch.example.tsx` for a complete working example demonstrating:
- Search filtering
- Workflow selection
- Bulk operations
- State management
- Error handling
