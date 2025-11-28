# Enhanced Image Library - Component Structure

Visual guide to the component architecture and file organization.

## File Structure

```
frontend/src/components/image-library/
├── EnhancedImageLibrary.tsx         # Main component (800+ lines)
├── EnhancedImageLibrary.example.tsx # Usage examples
├── useImageOrganization.ts          # Organization hook
├── types.ts                         # TypeScript types
├── index.ts                         # Public exports
├── README.md                        # Full documentation
├── QUICKSTART.md                    # Quick start guide
└── COMPONENT_STRUCTURE.md           # This file
```

## Component Hierarchy

```
EnhancedImageLibrary
├── ImageUploadProgress                    (reused component)
├── Top Toolbar
│   ├── Title & Stats
│   ├── Search Input
│   ├── View Mode Buttons (Grid/List/Slideshow)
│   ├── Grid Size Slider
│   ├── Filters Button
│   └── Upload Button
├── FilterPanel (conditional)
│   ├── Source Filter Badges
│   ├── Usage Filter Badges
│   └── Clear All Button
├── Bulk Operations Toolbar (conditional)
│   ├── Selection Count
│   ├── Move to Folder Dropdown
│   ├── Add Tags Button
│   ├── Add to Collection Dropdown
│   ├── Download Button
│   ├── Delete Button
│   └── Clear Selection Button
├── Main Content Area
│   ├── Left Sidebar (w-64)
│   │   ├── Tabs (Library / Collections)
│   │   ├── Library Tab
│   │   │   └── FolderTreeSidebar
│   │   │       ├── New Folder Button
│   │   │       ├── All Images Item
│   │   │       └── FolderTreeNode (recursive)
│   │   │           ├── Expand/Collapse Button
│   │   │           ├── Folder Icon (colored)
│   │   │           ├── Folder Name (editable)
│   │   │           ├── Image Count Badge
│   │   │           ├── Menu Dropdown
│   │   │           └── Children Nodes
│   │   └── Collections Tab
│   │       └── CollectionsSidebar
│   │           ├── New Collection Button
│   │           └── Collection Cards
│   │               ├── Name
│   │               ├── Thumbnail Grid (4 images)
│   │               ├── Image Count
│   │               └── Menu Dropdown
│   ├── Center Area (flex-1)
│   │   ├── ImageGrid (grid view)
│   │   │   ├── Drag & Drop Zone
│   │   │   ├── Empty State
│   │   │   └── Image Cards (grid)
│   │   │       ├── Selection Checkbox
│   │   │       ├── Image Preview
│   │   │       ├── Hover Actions
│   │   │       │   ├── Edit Mask Button
│   │   │       │   └── Delete Button
│   │   │       └── Image Info
│   │   │           ├── Name
│   │   │           ├── File Size
│   │   │           ├── Usage Badge
│   │   │           └── Source Badge
│   │   └── ImageList (list view)
│   │       └── Table
│   │           ├── Headers
│   │           └── Rows
│   │               ├── Checkbox
│   │               ├── Thumbnail
│   │               ├── Name
│   │               ├── Source Badge
│   │               ├── Size
│   │               ├── Usage Badge
│   │               ├── Upload Date
│   │               └── Delete Button
│   └── Right Sidebar (w-80, conditional)
│       └── ImageDetailsPanel
│           ├── Header (title + close)
│           ├── Large Preview
│           ├── Image Name
│           ├── Metadata Section
│           │   ├── Size
│           │   ├── Upload Date
│           │   ├── Source Badge
│           │   └── Usage Count
│           ├── Separator
│           ├── Usage Details
│           │   └── Usage List Items
│           │       ├── State Usage
│           │       └── Workflow Usage
│           └── Actions Section
│               ├── Edit Mask Button
│               ├── Download Button
│               └── Delete Button
├── MaskEditor (conditional)              (reused component)
└── ImageDeletionDialog (conditional)     (reused component)
```

## State Management

### Component State (EnhancedImageLibrary)

```typescript
// View state
viewMode: 'grid' | 'list' | 'slideshow'
gridSize: 'small' | 'medium' | 'large'
showFilters: boolean
selectedFolderId: string | null
selectedImageId: string | null
activeTab: 'library' | 'collections'

// Upload state
dragActive: boolean
uploadingFiles: UploadingImage[]

// Edit state
showMaskEditor: boolean
editingImage: ImageAsset | null
showDeletionDialog: boolean
imageToDelete: ImageAsset | null
deletionUsageInfo: ImageUsageInfo
```

### Hook State (useImageOrganization)

```typescript
// Folders
folders: ImageFolder[]
expandedFolderIds: Set<string>

// Collections
collections: ImageCollection[]

// Filters
currentFilter: ImageFilter
savedFilters: SavedImageFilter[]

// Tags
availableTags: ImageTag[]

// Selection
selectedImageIds: Set<string>
```

### Context State (AutomationContext)

```typescript
images: ImageAsset[]
// + all image CRUD operations
```

## Data Flow

```
┌─────────────────────────────────────────────────────────┐
│                   AutomationContext                      │
│  - images: ImageAsset[]                                 │
│  - addImage(image)                                      │
│  - updateImage(image)                                   │
│  - deleteImage(id)                                      │
│  - getImageUsage(id)                                    │
└─────────────────────┬───────────────────────────────────┘
                      │
                      │ provides images & operations
                      ▼
┌─────────────────────────────────────────────────────────┐
│              EnhancedImageLibrary                        │
│  - Manages view state                                   │
│  - Handles upload/edit/delete                           │
│  - Coordinates all sub-components                       │
└─────────────────────┬───────────────────────────────────┘
                      │
                      │ images + onUpdateImage
                      ▼
┌─────────────────────────────────────────────────────────┐
│              useImageOrganization                        │
│  - Manages folders/collections                          │
│  - Handles filtering                                    │
│  - Manages selection                                    │
│  - Returns organizational operations                    │
└─────────────────────┬───────────────────────────────────┘
                      │
                      │ organized data + operations
                      ▼
┌─────────────────────────────────────────────────────────┐
│              Sub-Components                              │
│  - FolderTreeSidebar                                    │
│  - CollectionsSidebar                                   │
│  - ImageGrid / ImageList                                │
│  - ImageDetailsPanel                                    │
│  - FilterPanel                                          │
└─────────────────────────────────────────────────────────┘
```

## Props Flow

### EnhancedImageLibrary → Sub-Components

```typescript
// FolderTreeSidebar
folders: ImageFolderTreeNode[]
selectedFolderId: string | null
onSelectFolder: (id: string | null) => void
onCreateFolder: (name, parentId) => void
onUpdateFolder: (id, updates) => void
onDeleteFolder: (id) => void
onToggleExpanded: (id) => void

// CollectionsSidebar
collections: ImageCollection[]
onCreateCollection: (name, desc?) => void
onUpdateCollection: (id, updates) => void
onDeleteCollection: (id) => void
images: ImageWithMetadata[]

// ImageGrid
images: ImageWithMetadata[]
gridSize: ImageGridSize
selectedImageIds: Set<string>
selectedImageId: string | null
onSelectImage: (id) => void
onToggleSelection: (id) => void
onDeleteImage: (id) => void
onEditMask: (image) => void
formatFileSize: (bytes) => string
getSourceLabel: (source) => string
getSourceColor: (source) => string
dragActive: boolean
onDrag: (e) => void
onDrop: (e) => void

// ImageDetailsPanel
image: ImageWithMetadata
usageDetails: Array<...>
onClose: () => void
onDelete: () => void
onEditMask: () => void
formatFileSize: (bytes) => string
getSourceLabel: (source) => string
getSourceColor: (source) => string
```

## Event Handlers

### Upload Flow

```
User drops files
    ↓
handleDrop() → handleFiles()
    ↓
For each file:
  1. Validate (type, size)
  2. apiClient.uploadProjectImage()
  3. Progress callback → update uploadingFiles
  4. Create ImageAsset
  5. addImage() → AutomationContext
  6. Remove from uploadingFiles
    ↓
Show success toast
```

### Delete Flow

```
User clicks delete
    ↓
handleDeleteImage(id)
    ↓
getImageUsage(id) → usage info
    ↓
Show ImageDeletionDialog
    ↓
User confirms
    ↓
confirmDelete()
    ↓
  1. removeImageFromStates()
  2. markImageAsRemovedInProcesses()
  3. deleteImage() → AutomationContext
  4. Show success toast
  5. Clear selection
```

### Filter Flow

```
User changes filter
    ↓
setCurrentFilter({ ...filter, ...changes })
    ↓
useMemo recalculates filteredImages
    ↓
Grid/List re-renders with filtered images
```

### Selection Flow

```
User clicks checkbox
    ↓
toggleImageSelection(id)
    ↓
selectedImageIds updated (Set)
    ↓
Bulk toolbar shows/hides
Grid cards show selection state
```

## Styling System

### Color Palette

```typescript
// Primary
'#00FF88' - Green (primary accent)
'#00D9FF' - Cyan (secondary)
'#BD00FF' - Purple (extraction)
'#FFB800' - Amber (discovery)

// Backgrounds
'#18181B' - Main background
'#27272A' - Card background
'#374151' - Border (gray-700)

// Source Colors
uploaded: '#00FF88'
pattern_optimization: '#00D9FF'
image_extraction: '#BD00FF'
state_discovery: '#FFB800'

// Folder Colors (user-selectable)
'#3b82f6' - Blue
'#10b981' - Green
'#f59e0b' - Amber
'#ef4444' - Red
'#8b5cf6' - Purple
'#ec4899' - Pink
'#06b6d4' - Cyan
'#84cc16' - Lime
'#f97316' - Orange
'#6366f1' - Indigo
```

### Grid Sizes

```typescript
small: {
  grid: '8 cols → 12 → 16 → 20',
  card: 'w-16 h-16',
}

medium: {
  grid: '4 cols → 6 → 8 → 10',
  card: 'w-32 h-32',
}

large: {
  grid: '2 cols → 3 → 4 → 5',
  card: 'w-48 h-48',
}
```

### Layout Dimensions

```
Left Sidebar: 256px (w-64)
Right Sidebar: 320px (w-80)
Center: flex-1
Toolbar Height: auto
Filter Panel: auto
Bulk Toolbar: auto
```

## Performance Considerations

### Memoization

```typescript
// Expensive computations
filteredImages = useMemo(() => { ... }, [images, selectedFolderId, currentFilter])
selectedImage = useMemo(() => { ... }, [selectedImageId, images])
imageUsageDetails = useMemo(() => { ... }, [selectedImage, workflows, states])
folderTree = useMemo(() => { ... }, [folders, images, expandedFolderIds])
```

### Callbacks

```typescript
// Prevent unnecessary re-renders
handleFiles = useCallback(...)
handleDrag = useCallback(...)
handleDrop = useCallback(...)
handleDeleteImage = useCallback(...)
// ... all event handlers
```

### Virtual Scrolling (Future)

```typescript
// For 1000+ images, implement:
import { useVirtualizer } from "@tanstack/react-virtual";

const virtualizer = useVirtualizer({
  count: filteredImages.length,
  getScrollElement: () => scrollRef.current,
  estimateSize: () => cardSize,
});
```

## Type Safety

All components are fully typed with TypeScript:

- **Props**: All component props are typed
- **State**: All state variables are typed
- **Callbacks**: All callbacks have typed parameters
- **Context**: AutomationContext types imported
- **No `any`**: Minimal use of `any` type

## Extensibility Points

### Add New Filter Type

1. Add to `ImageFilter` type
2. Add UI in `FilterPanel`
3. Add filter logic in `filteredImages` useMemo

### Add New View Mode

1. Add to `ImageViewMode` type
2. Add button in toolbar
3. Create new view component
4. Add to view mode conditional

### Add New Bulk Operation

1. Create handler function
2. Add button to bulk toolbar
3. Wire up to selected images

### Add New Organization Feature

1. Add state to `useImageOrganization`
2. Add operations
3. Add UI components
4. Wire up callbacks

## Testing Strategy

### Unit Tests (Future)

```typescript
// useImageOrganization.test.ts
test("createFolder adds folder to state");
test("deleteFolder moves images to parent");
test("buildFolderTree creates correct hierarchy");

// filtering.test.ts
test("filters images by query");
test("filters images by source");
test("filters images by tags with AND");
```

### Integration Tests (Future)

```typescript
// EnhancedImageLibrary.test.tsx
test("renders all sections");
test("uploads image successfully");
test("creates folder and moves image");
test("deletes image with confirmation");
test("bulk operations work correctly");
```

### E2E Tests (Future)

```typescript
// e2e/image-library.spec.ts
test("user can organize images in folders");
test("user can create collections");
test("user can filter and search images");
test("user can bulk delete unused images");
```

## Accessibility

- **Keyboard Navigation**: Tab through all interactive elements
- **ARIA Labels**: All buttons and interactive elements labeled
- **Screen Reader**: All images have alt text
- **Focus Management**: Proper focus on modals/dialogs
- **Color Contrast**: Meets WCAG AA standards

## Browser Compatibility

- Chrome/Edge 90+
- Firefox 88+
- Safari 14+
- No IE support

## Dependencies

```json
{
  "react": "^19.1.0",
  "lucide-react": "^0.543.0",
  "@dnd-kit/core": "^6.3.1",
  "@radix-ui/*": "various",
  "sonner": "^2.0.7"
}
```

## Future Enhancements

### Phase 2 (Next 2-4 weeks)

- [ ] Virtual scrolling with @tanstack/react-virtual
- [ ] Keyboard shortcuts
- [ ] Advanced search (regex, operators)
- [ ] Image dimensions extraction
- [ ] Saved filter presets UI
- [ ] Drag-and-drop between folders

### Phase 3 (1-2 months)

- [ ] Slideshow mode
- [ ] Image versioning
- [ ] Duplicate detection
- [ ] Bulk export to ZIP
- [ ] Image comparison view
- [ ] Usage analytics

### Phase 4 (3+ months)

- [ ] AI-powered tagging
- [ ] Smart collections (auto-updating)
- [ ] Image CDN integration
- [ ] Advanced permissions
- [ ] Collaborative features
- [ ] Image processing pipeline

## Contributing

When modifying this component:

1. Maintain type safety
2. Follow existing patterns
3. Update documentation
4. Test with large datasets (100+ images)
5. Check performance
6. Preserve AutomationContext integration
7. Update COMPONENT_STRUCTURE.md

## Changelog

### v1.0.0 (2025-01-14)

- Initial release
- Folder organization
- Collections
- Advanced filtering
- Bulk operations
- Grid/List views
- Image details panel
- Drag-and-drop upload
- Integration with AutomationContext
