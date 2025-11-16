# Workflow Organization - Quick Start Guide

This guide will help you quickly integrate the folder organization system into your workflow browser.

## 🚀 Basic Setup (5 minutes)

### 1. Install Dependencies

All dependencies are already installed:
- ✅ `@dnd-kit/core` - Drag and drop
- ✅ `lucide-react` - Icons
- ✅ `shadcn/ui` - UI components

### 2. Import Components

```tsx
import {
  FolderTree,
  useFolderManager,
} from '@/components/workflow-organization';
```

### 3. Basic Implementation

```tsx
function WorkflowBrowser() {
  // Initialize folder manager
  const { folders, createNewFolder, updateFolder, deleteFolder, moveFolder } =
    useFolderManager({
      initialFolders: [], // Load from your backend
      onFoldersChange: (folders) => {
        // Save to backend/localStorage
        localStorage.setItem('folders', JSON.stringify(folders));
      },
    });

  // Track selected folder
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);

  // Your workflows
  const workflows = [...]; // Your workflow data

  return (
    <div className="flex h-screen">
      {/* Left Sidebar - Folder Tree */}
      <div className="w-80 border-r">
        <FolderTree
          folders={folders}
          workflows={workflows}
          selectedFolderId={selectedFolderId}
          onSelectFolder={setSelectedFolderId}
          onCreateFolder={(name, parentId) => createNewFolder(name, parentId)}
          onUpdateFolder={updateFolder}
          onDeleteFolder={deleteFolder}
          onMoveFolder={moveFolder}
          onMoveWorkflow={(workflowId, folderId) => {
            // Update workflow's folderId
          }}
        />
      </div>

      {/* Main Content - Workflow List */}
      <div className="flex-1 p-6">
        {/* Your workflow list UI */}
      </div>
    </div>
  );
}
```

## 📚 Common Use Cases

### Filter Workflows by Selected Folder

```tsx
import { getWorkflowsInFolder } from '@/components/workflow-organization';

const filteredWorkflows = selectedFolderId
  ? getWorkflowsInFolder(selectedFolderId, workflows, folders, true)
  : workflows;
```

### Show Breadcrumb Navigation

```tsx
import { FolderBreadcrumb } from '@/components/workflow-organization';

<FolderBreadcrumb
  folderId={selectedFolderId}
  folders={folders}
  onNavigate={setSelectedFolderId}
/>
```

### Folder Selector in Dialogs

```tsx
import { FolderSelector } from '@/components/workflow-organization';

<FolderSelector
  folders={folders}
  selectedFolderId={workflowFolderId}
  onSelect={(folderId) => setWorkflowFolderId(folderId)}
  allowRoot={true}
/>
```

### Persist to localStorage

```tsx
// Save
useEffect(() => {
  localStorage.setItem('workflow-folders', JSON.stringify(folders));
}, [folders]);

// Load
const [folders, setFolders] = useState<WorkflowFolder[]>(() => {
  const saved = localStorage.getItem('workflow-folders');
  return saved ? JSON.parse(saved) : [];
});
```

### Persist to Backend API

```tsx
const { folders } = useFolderManager({
  initialFolders: [],
  onFoldersChange: async (folders) => {
    await fetch('/api/folders', {
      method: 'PUT',
      body: JSON.stringify(folders),
    });
  },
});
```

## 🎨 Customization

### Change Colors

```tsx
// In FolderTree.tsx, customize the FOLDER_COLORS array
const FOLDER_COLORS = [
  '#yourcolor1',
  '#yourcolor2',
  // ...
];
```

### Add Custom Icons

```tsx
// Import your icons from lucide-react
import { CustomIcon } from 'lucide-react';

// Add to FOLDER_ICONS array in FolderTree.tsx
```

### Style with Tailwind

```tsx
<FolderTree
  className="bg-gray-50 dark:bg-gray-900"
  // ...
/>
```

## 🔑 Key Features

### Drag and Drop

Users can:
- Drag workflows into folders to organize them
- Drag folders to reorder or move into other folders
- Visual feedback shows valid drop zones

### Keyboard Navigation

- `↑/↓` - Navigate folders
- `←/→` - Collapse/expand or move to parent
- `Enter` - Toggle expand/collapse
- `Delete` - Delete selected folder

### Context Menu

Right-click any folder to:
- Create subfolder
- Rename
- Change color/icon
- Move
- Delete

### Search

Type in the search box to filter folders by name. Matching folders and their ancestors are shown.

## 📊 Best Practices

### 1. Validation

Always validate before creating folders:

```tsx
import { validateFolderName } from '@/components/workflow-organization';

const { valid, error } = validateFolderName(name, folders, parentId);
if (!valid) {
  toast.error(error);
  return;
}
```

### 2. Prevent Cycles

Check before moving folders:

```tsx
import { wouldCreateCycle } from '@/components/workflow-organization';

if (wouldCreateCycle(folderId, newParentId, folders)) {
  toast.error('Cannot move folder into itself or its descendants');
  return;
}
```

### 3. Confirmation Dialogs

Show confirmation for destructive actions:

```tsx
onDeleteFolder={(id) => {
  const folder = folders.find(f => f.id === id);
  if (window.confirm(`Delete "${folder.name}" and all its contents?`)) {
    deleteFolder(id);
  }
}}
```

### 4. Loading States

Show loading indicators while fetching:

```tsx
const [loading, setLoading] = useState(true);

useEffect(() => {
  fetchFolders().then(data => {
    setFolders(data);
    setLoading(false);
  });
}, []);

if (loading) return <Skeleton />;
```

### 5. Error Handling

Wrap operations in try-catch:

```tsx
try {
  await createNewFolder(name, parentId);
  toast.success('Folder created');
} catch (error) {
  toast.error('Failed to create folder');
  console.error(error);
}
```

## 🐛 Troubleshooting

### Folders not appearing?

Check that your `WorkflowFolder` objects have all required fields:
- `id`, `name`, `parentId`, `createdAt`, `updatedAt`, `order`

### Drag and drop not working?

Ensure you have `@dnd-kit/core` installed and imported correctly.

### Workflows not filtering?

Make sure your workflow objects have a `folderId` property set when assigned to a folder.

### TypeScript errors?

Import types from the package:

```tsx
import type { WorkflowFolder } from '@/components/workflow-organization';
```

## 📖 Full Documentation

See [README.md](./README.md) for complete API documentation.

## 🎯 Next Steps

1. Implement folder persistence (localStorage or API)
2. Add undo/redo functionality
3. Implement bulk operations (move multiple workflows)
4. Add folder templates
5. Implement folder sharing/permissions

## 💡 Tips

- Start with localStorage for quick prototyping
- Add optimistic updates for better UX
- Implement keyboard shortcuts for power users
- Show folder statistics in tooltips
- Add folder export/import for backup

## 🔗 Related Components

- `WorkflowBrowser` - Main workflow browsing interface
- `WorkflowCanvas` - Workflow editor
- `WorkflowProperties` - Workflow metadata editor

## 📝 Example Code

See `FolderTree.example.tsx` for complete working examples:
- Basic integration
- With persistence
- Full workflow browser

---

Need help? Check the README or look at the example files!
