# Code Execution Components

This directory contains components for Python code execution features, allowing users to browse and select Python files from their project directory for use in CODE_BLOCK actions.

## Components

### PythonFileBrowser

A file browser component that displays Python files in a tree view with search, filtering, and selection capabilities.

**Features:**

- Tree view of Python files organized by directory
- Search/filter by filename or path
- File metadata display (size, last modified)
- Loading and error states
- Keyboard navigation support
- Accessible design

**Usage:**

```tsx
import { PythonFileBrowser } from "@/components/code-execution";
import { useCodeExecutionFiles } from "@/hooks/useCodeExecutionFiles";

function MyComponent() {
  const { files, isLoading, error, refresh } = useCodeExecutionFiles({
    projectId: currentProject.id,
  });

  const [selectedPath, setSelectedPath] = useState<string>();

  return (
    <PythonFileBrowser
      selectedPath={selectedPath}
      onSelectFile={setSelectedPath}
      files={files}
      isLoading={isLoading}
      error={error}
      onRefresh={refresh}
      height="400px"
      showMetadata={true}
    />
  );
}
```

**Props:**

| Prop               | Type                     | Default   | Description                    |
| ------------------ | ------------------------ | --------- | ------------------------------ |
| `selectedPath`     | `string`                 | -         | Currently selected file path   |
| `onSelectFile`     | `(path: string) => void` | -         | Callback when file is selected |
| `files`            | `PythonFile[]`           | `[]`      | List of Python files           |
| `isLoading`        | `boolean`                | `false`   | Loading state                  |
| `error`            | `string \| null`         | `null`    | Error message                  |
| `onRefresh`        | `() => void`             | -         | Refresh callback               |
| `validateOnSelect` | `boolean`                | `false`   | Validate file on selection     |
| `height`           | `string`                 | `'400px'` | Component height               |
| `showMetadata`     | `boolean`                | `true`    | Show file size and date        |

## Hooks

### useCodeExecutionFiles

A hook for fetching and validating Python files from the backend.

**Usage:**

```tsx
import { useCodeExecutionFiles } from "@/hooks/useCodeExecutionFiles";

function MyComponent() {
  const {
    files,
    isLoading,
    error,
    projectRoot,
    fetchFiles,
    validateFile,
    refresh,
  } = useCodeExecutionFiles({
    projectId: 123,
    autoLoad: true,
    autoRefresh: 30000, // Refresh every 30 seconds
  });

  // Validate a file path
  const handleValidate = async () => {
    const result = await validateFile("scripts/my_script.py");
    if (result.valid) {
      console.log("File is valid");
    } else {
      console.error("File is invalid:", result.errors);
    }
  };

  return <div>{/* Use files, isLoading, error, etc. */}</div>;
}
```

**Options:**

| Option        | Type      | Default | Description                |
| ------------- | --------- | ------- | -------------------------- |
| `projectId`   | `number`  | -       | Project ID                 |
| `autoLoad`    | `boolean` | `true`  | Auto-load files on mount   |
| `autoRefresh` | `number`  | -       | Auto-refresh interval (ms) |

**Returns:**

| Property       | Type                                              | Description              |
| -------------- | ------------------------------------------------- | ------------------------ |
| `files`        | `PythonFile[]`                                    | List of Python files     |
| `isLoading`    | `boolean`                                         | Loading state            |
| `error`        | `string \| null`                                  | Error message            |
| `projectRoot`  | `string`                                          | Project root directory   |
| `fetchFiles`   | `() => Promise<void>`                             | Fetch files from backend |
| `validateFile` | `(path: string) => Promise<ValidateFileResponse>` | Validate file path       |
| `refresh`      | `() => void`                                      | Refresh file list        |

## Action Properties

### CodeBlockActionProperties

Configuration UI for CODE_BLOCK actions.

**Features:**

- Code source selection (inline vs. file)
- Monaco editor for inline code
- File browser for external Python files
- Function name input (optional)
- Input/output mapping configuration
- Advanced settings (timeout, debug mode, etc.)
- Collapsible advanced configuration

**Integration:**

The component is automatically registered in the action properties registry and will be displayed when editing a CODE_BLOCK action in the workflow canvas.

**Location in UI:**

1. Create or select a CODE_BLOCK action in the workflow canvas
2. The properties panel on the right will display the CodeBlockActionProperties component
3. Users can switch between inline code and external file sources
4. When "External File" is selected, the file browser appears

## Backend API Endpoints

The components integrate with the following backend endpoints:

### List Python Files

```
GET /api/v1/code-execution/files/list?project_id=123
```

**Response:**

```json
{
  "files": [
    {
      "path": "scripts/detector.py",
      "name": "detector.py",
      "size": 1024,
      "last_modified": "2025-11-22T10:30:00Z"
    }
  ],
  "project_root": "/path/to/project"
}
```

### Validate File Path

```
POST /api/v1/code-execution/files/validate
Content-Type: application/json

{
  "project_id": 123,
  "file_path": "scripts/detector.py"
}
```

**Response:**

```json
{
  "valid": true,
  "path": "scripts/detector.py",
  "exists": true,
  "is_python_file": true
}
```

## Type Definitions

### PythonFile

```typescript
interface PythonFile {
  path: string; // Relative path from project root
  name: string; // File name
  size: number; // File size in bytes
  lastModified: string; // ISO date string
  isValid: boolean; // Validation status
}
```

### FileTreeNode

```typescript
interface FileTreeNode {
  name: string;
  path: string;
  type: "file" | "directory";
  children?: FileTreeNode[];
  file?: PythonFile;
}
```

## Architecture

### Component Hierarchy

```
CodeBlockActionProperties
├── Code Source Selector (inline/file)
├── Inline Code Editor (Monaco)
│   └── Python syntax highlighting
├── File Browser
│   └── PythonFileBrowser
│       ├── Search bar
│       ├── Refresh button
│       ├── File tree
│       │   ├── Directory nodes
│       │   └── File nodes
│       └── Error/loading states
├── Function Name Input
├── Input Mappings (Advanced)
├── Output Variable (Advanced)
└── Other Settings (Advanced)
```

### Data Flow

1. User opens CODE_BLOCK action properties
2. Component loads Python files via `useCodeExecutionFiles` hook
3. Hook fetches files from backend API
4. Files are displayed in tree view via `PythonFileBrowser`
5. User selects a file
6. Selected file path is stored in action config
7. (Optional) File path is validated via backend API

## Design System

The components follow the existing Qontinui design system:

- **UI Components:** Radix UI primitives (shadcn/ui)
- **Styling:** Tailwind CSS with custom theme
- **Icons:** Lucide React
- **Code Editor:** Monaco Editor
- **Colors:** Dark theme with cyan accents
- **Spacing:** Consistent spacing using Tailwind utilities

## Accessibility

All components include:

- ARIA labels and roles
- Keyboard navigation
- Focus management
- Screen reader support
- Semantic HTML

## Testing

### Manual Testing Checklist

- [ ] File browser displays Python files correctly
- [ ] Search filters files by name and path
- [ ] File selection updates action config
- [ ] Refresh button reloads file list
- [ ] Error states display correctly
- [ ] Loading states show spinner
- [ ] Keyboard navigation works (Tab, Enter, Arrow keys)
- [ ] Tree expand/collapse works
- [ ] File metadata displays correctly
- [ ] Monaco editor syntax highlights Python code
- [ ] Switching between inline/file source works
- [ ] Advanced settings toggle correctly
- [ ] Input mappings can be added/removed

### Integration Testing

1. Create a CODE_BLOCK action in workflow canvas
2. Select "External File" as code source
3. Browse and select a Python file
4. Verify file path is saved in action config
5. Export workflow and verify file path is included
6. Import workflow and verify file path is loaded

## Future Enhancements

Potential improvements for future iterations:

1. **File Preview:** Show file contents in preview panel
2. **Syntax Validation:** Real-time Python syntax checking
3. **Auto-complete:** Suggest available functions from selected file
4. **File Upload:** Allow uploading new Python files
5. **Recent Files:** Show recently used files
6. **Favorites:** Pin frequently used files
7. **File Editing:** Edit Python files directly in browser
8. **Git Integration:** Show git status for files
9. **Multi-select:** Select multiple files for batch operations
10. **Drag & Drop:** Drag files from OS file explorer

## Troubleshooting

### Files Not Loading

**Problem:** File browser shows "No Python files found"

**Solutions:**

- Check that project has Python files in the directory
- Verify backend API is running (port 8000)
- Check browser console for API errors
- Verify project ID is correct

### File Validation Fails

**Problem:** Selected file shows invalid status

**Solutions:**

- Ensure file exists in project directory
- Check file has .py extension
- Verify file path doesn't use `../` (path traversal blocked)
- Check file permissions

### Monaco Editor Not Loading

**Problem:** Code editor doesn't appear

**Solutions:**

- Check that @monaco-editor/react is installed
- Verify component is wrapped in client boundary ("use client")
- Check browser console for loading errors
- Ensure adequate browser memory

## Contributing

When adding new features:

1. Follow existing component patterns
2. Use TypeScript for type safety
3. Add proper error handling
4. Include loading states
5. Support keyboard navigation
6. Add ARIA labels
7. Update this documentation

## Support

For issues or questions:

- Check backend logs for API errors
- Review browser console for frontend errors
- Verify network requests in DevTools
- Ensure all dependencies are installed
