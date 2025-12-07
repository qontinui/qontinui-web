# Workflow Organization Components

A comprehensive folder tree UI component system for organizing workflows in qontinui-web.

## Components

### FolderTree

The main component for displaying and managing a hierarchical folder structure.

#### Features

- **Display**
  - Hierarchical tree view with unlimited nesting
  - Collapsible/expandable folders
  - Customizable folder icons and colors
  - Workflow count badges
  - Current selection highlighting
  - Visual indentation for nested levels
  - Root "All Workflows" node
  - Uncategorized workflows view

- **Interactions**
  - Click to select folder
  - Double-click to expand/collapse
  - Right-click context menu with actions:
    - New Subfolder
    - Rename Folder
    - Change Color
    - Change Icon
    - Delete Folder
    - Move Folder
  - Drag and drop support:
    - Drag workflows into folders
    - Drag folders to reorder/reparent
    - Visual drop indicators

- **Folder Management**
  - Inline folder creation
  - Folder name validation
  - Color picker with preset colors
  - Icon selector
  - Breadcrumb navigation

- **Search & Filter**
  - Search folders by name
  - Expand/collapse all buttons
  - Empty state handling

- **Accessibility**
  - Keyboard navigation (arrows, enter, delete)
  - ARIA labels and roles
  - Focus management
  - Screen reader support

#### Props

```typescript
interface FolderTreeProps {
  folders: WorkflowFolder[];
  workflows: Workflow[];
  selectedFolderId?: string | null;
  onSelectFolder: (folderId: string | null) => void;
  onCreateFolder: (name: string, parentId?: string | null) => void;
  onUpdateFolder: (id: string, updates: Partial<WorkflowFolder>) => void;
  onDeleteFolder: (id: string) => void;
  onMoveFolder: (folderId: string, newParentId: string | null) => void;
  onMoveWorkflow: (workflowId: string, folderId: string | null) => void;
  className?: string;
}
```

#### Example Usage

```tsx
import { FolderTree } from '@/components/workflow-organization';

function WorkflowBrowser() {
  const [folders, setFolders] = useState<WorkflowFolder[]>([]);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const workflows = [...]; // Your workflows

  return (
    <FolderTree
      folders={folders}
      workflows={workflows}
      selectedFolderId={selectedFolderId}
      onSelectFolder={setSelectedFolderId}
      onCreateFolder={(name, parentId) => {
        // Create folder logic
      }}
      onUpdateFolder={(id, updates) => {
        // Update folder logic
      }}
      onDeleteFolder={(id) => {
        // Delete folder logic
      }}
      onMoveFolder={(folderId, newParentId) => {
        // Move folder logic
      }}
      onMoveWorkflow={(workflowId, folderId) => {
        // Move workflow logic
      }}
    />
  );
}
```

## Hooks

### useFolderManager

Manages folder state and provides operations.

```typescript
const {
  folders,
  createNewFolder,
  updateFolder,
  deleteFolder,
  moveFolder,
  duplicateFolder,
  resetFolders,
  importFolders,
} = useFolderManager({
  initialFolders: [],
  onFoldersChange: (folders) => {
    // Save to backend/localStorage
  },
});
```

### useFolderExpansion

Manages folder expansion state.

```typescript
const {
  expandedIds,
  toggleFolder,
  expandFolder,
  collapseFolder,
  expandAll,
  collapseAll,
  isExpanded,
} = useFolderExpansion([]);
```

### useFolderSelection

Manages folder selection state.

```typescript
const { selectedFolderId, selectFolder, clearSelection, isSelected } =
  useFolderSelection();
```

## Utilities

### Folder Operations

```typescript
import {
  createFolder,
  generateFolderId,
  getDescendantIds,
  wouldCreateCycle,
  getFolderPath,
  getWorkflowsInFolder,
  validateFolderName,
  exportFolders,
  importFolders,
  getFolderStats,
} from "@/components/workflow-organization";
```

#### createFolder

Create a new folder object.

```typescript
const folder = createFolder("My Folder", parentId, {
  color: "#3b82f6",
  icon: "Folder",
  order: 0,
});
```

#### getDescendantIds

Get all descendant folder IDs (children, grandchildren, etc.).

```typescript
const descendants = getDescendantIds(folderId, folders);
```

#### wouldCreateCycle

Check if moving a folder would create a circular reference.

```typescript
const wouldCycle = wouldCreateCycle(folderId, newParentId, folders);
```

#### getFolderPath

Get breadcrumb path for a folder.

```typescript
const path = getFolderPath(folderId, folders);
// Returns: ['Parent Folder', 'Child Folder', 'Current Folder']
```

#### getWorkflowsInFolder

Get all workflows in a folder (optionally including subfolders).

```typescript
const workflows = getWorkflowsInFolder(
  folderId,
  allWorkflows,
  folders,
  includeSubfolders
);
```

#### validateFolderName

Validate a folder name.

```typescript
const { valid, error } = validateFolderName(
  name,
  existingFolders,
  parentId,
  excludeFolderId
);
```

#### exportFolders / importFolders

Export/import folders to/from JSON.

```typescript
const json = exportFolders(folders);
const folders = importFolders(json);
```

#### getFolderStats

Get statistics about folders.

```typescript
const stats = getFolderStats(folders, workflows);
// Returns: {
//   totalFolders: number,
//   maxDepth: number,
//   avgChildrenPerFolder: number,
//   emptyFolders: number,
//   foldersWithColor: number,
//   foldersWithIcon: number
// }
```

## Types

### WorkflowFolder

```typescript
interface WorkflowFolder {
  id: string;
  name: string;
  parentId: string | null;
  color?: string;
  icon?: string;
  createdAt: Date;
  updatedAt: Date;
  order: number;
  expanded?: boolean;
}
```

### FolderTreeNode

Extended folder type used internally by the tree component.

```typescript
interface FolderTreeNode extends WorkflowFolder {
  children: FolderTreeNode[];
  workflowCount: number;
  totalWorkflowCount: number;
  depth: number;
}
```

## Keyboard Navigation

| Key    | Action                                     |
| ------ | ------------------------------------------ |
| ↓      | Select next folder                         |
| ↑      | Select previous folder                     |
| →      | Expand selected folder                     |
| ←      | Collapse selected folder or select parent  |
| Enter  | Toggle expand/collapse                     |
| Delete | Delete selected folder (with confirmation) |

## Drag and Drop

- Drag folders to reorder or move to a different parent
- Drag workflows into folders to organize them
- Visual feedback shows valid drop targets
- Prevents circular references (can't drop folder into its own descendant)

## Customization

### Colors

Default colors are provided, but you can customize them:

```typescript
const CUSTOM_COLORS = [
  "#3b82f6", // blue
  "#10b981", // green
  // ... add your colors
];
```

### Icons

Icons use lucide-react. Available folder icons:

- Folder
- FolderOpen
- FolderPlus
- FolderTree
- Archive
- Bookmark
- Tag
- Star
- Heart
- Shield

## Styling

The component uses Tailwind CSS and shadcn/ui components. Customize with:

```tsx
<FolderTree
  className="your-custom-classes"
  // ...
/>
```

## Best Practices

1. **Validation**: Always validate folder names before creating/updating
2. **Cycle Prevention**: Check for cycles before moving folders
3. **Persistence**: Save folder changes to backend or localStorage
4. **Performance**: For large trees (1000+ folders), consider virtualization
5. **Error Handling**: Show user-friendly errors for failed operations
6. **Undo/Redo**: Implement undo functionality for better UX

## Integration Example

See `FolderTree.example.tsx` for complete integration examples:

- `WorkflowBrowserExample` - Full workflow browser with folders
- `SimpleFolderTreeExample` - Minimal integration
- `FolderTreeWithPersistence` - With localStorage persistence

## Dependencies

- React 19+
- TypeScript 5+
- shadcn/ui components
- lucide-react icons
- @dnd-kit for drag and drop
- Tailwind CSS

## Browser Support

- Chrome/Edge 90+
- Firefox 88+
- Safari 14+

## License

MIT
