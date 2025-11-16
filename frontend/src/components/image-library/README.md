# Enhanced Image Library

A comprehensive image management UI for large automation projects with advanced organizational features.

## Features

### 1. **Three-Panel Layout**
- **Left Sidebar**: Folder tree and collections
- **Center Area**: Image grid/list with drag-and-drop upload
- **Right Panel**: Detailed image information and metadata

### 2. **Folder Organization**
- Hierarchical folder structure (like file explorer)
- Drag-and-drop images between folders
- Create, rename, delete folders
- Color-coded folders with custom colors
- Badge showing image count per folder
- Expand/collapse folders
- Nested folder support

### 3. **Image Grid**
- Three grid sizes: Small, Medium, Large
- Responsive grid layout
- Hover preview with actions
- Multi-select with checkboxes
- Visual selection indicators
- Quick actions: Edit Mask, Delete
- Performance optimized for 100+ images

### 4. **Advanced Filtering**
- **Search**: Search by filename/name
- **Source Filter**: Filter by uploaded, pattern optimization, extraction, discovery
- **Usage Filter**: All, Used (>0 usage), Unused (0 usage)
- **Tag Filter**: Multi-tag selection with AND/OR operators
- **Date Range**: Filter by upload date
- **Size Range**: Filter by file size
- **Dimension Filter**: Filter by width/height (future)
- **File Type Filter**: Filter by PNG, JPG, etc. (future)
- **Saved Filters**: Save and reuse filter presets

### 5. **Bulk Operations Toolbar**
When images are selected, a toolbar appears with:
- **Move to Folder**: Bulk move to any folder
- **Add Tags**: Add tags to multiple images
- **Add to Collection**: Add to existing collection
- **Download Selected**: Download multiple images
- **Delete Selected**: Bulk delete with confirmation
- **Clear Selection**: Deselect all

### 6. **Image Details Panel**
Shows for selected image:
- Large preview
- Name and metadata
- File size
- Upload date
- Source type (with color coding)
- Usage count and details
- **Usage Tracking**:
  - Which workflows use it
  - Which states use it
  - Visual list with navigation
- **Actions**:
  - Edit Mask
  - Download
  - Delete

### 7. **Collections**
- Create named collections
- Add/remove images from collections
- Collection cards with 4-image thumbnail grid
- Image count badge
- Manage collections (rename, delete)

### 8. **Upload Area**
- Drag-and-drop anywhere in empty grid
- Multiple file upload
- Upload progress indicators (per file)
- Auto-assign to current folder
- Validation (image types, size, dimensions)
- Error handling with user-friendly messages

### 9. **View Modes**
- **Grid View**: Responsive grid with adjustable size
- **List View**: Table format with sortable columns
- **Slideshow Mode**: Full-screen image viewer (future)

### 10. **Performance Optimizations**
- Lazy loading images
- Virtual scrolling support ready
- Pagination (50 per page) ready
- Efficient filtering with useMemo
- Debounced search
- Optimized re-renders

## Usage

### Basic Usage

```tsx
import { EnhancedImageLibrary } from '@/components/image-library';

export function ImageManagement() {
  return <EnhancedImageLibrary />;
}
```

### With Custom Hook

```tsx
import { useImageOrganization } from '@/components/image-library';

function MyComponent() {
  const {
    folders,
    folderTree,
    createFolder,
    collections,
    createCollection,
    selectedImageIds,
    toggleImageSelection,
  } = useImageOrganization({
    images: myImages,
    onUpdateImage: handleImageUpdate,
  });

  // Use the organization features
}
```

## Architecture

### Data Flow

1. **Images Source**: AutomationContext provides images
2. **Organization Layer**: `useImageOrganization` hook manages folders/collections
3. **UI Layer**: EnhancedImageLibrary renders the interface
4. **Updates**: Changes flow back to AutomationContext via callbacks

### State Management

- **Context State**: Images stored in AutomationContext
- **Local State**: Folders, collections, filters, selections in useImageOrganization
- **UI State**: View mode, grid size, selected image in component

### Type System

All types are defined in `types.ts`:
- `ImageFolder`: Folder metadata
- `ImageFolderTreeNode`: Tree structure with counts
- `ImageCollection`: Named image collections
- `ImageFilter`: Advanced filter options
- `ImageWithMetadata`: Extended image with organization data

## Components

### Main Component
- **EnhancedImageLibrary**: Main container with three-panel layout

### Sub-Components
- **FilterPanel**: Advanced filtering UI
- **FolderTreeSidebar**: Folder navigation
- **FolderTreeNode**: Recursive folder tree item
- **CollectionsSidebar**: Collection management
- **ImageGrid**: Responsive image grid
- **ImageList**: Table list view
- **ImageDetailsPanel**: Right sidebar with image details

## Styling

- **Dark Theme**: Matches qontinui-web design system
- **Colors**:
  - Primary: `#00FF88` (green)
  - Secondary: `#00D9FF` (cyan)
  - Accent: `#BD00FF` (purple), `#FFB800` (amber)
  - Background: `#18181B`, `#27272A`
  - Border: `#374151` (gray-700)
- **Components**: shadcn/ui with customizations
- **Icons**: lucide-react

## Integration

### With AutomationContext

The component integrates seamlessly with the existing AutomationContext:

```tsx
const {
  images,           // ImageAsset[]
  addImage,         // Add new image
  updateImage,      // Update image
  deleteImage,      // Delete image
  getImageUsage,    // Get usage info
  // ... other context methods
} = useAutomation();
```

### With Image Upload Service

Uses `apiClient.uploadProjectImage()` for S3 uploads with progress tracking.

### With Existing Components

Reuses existing components:
- `MaskEditor`: For image mask editing
- `ImageDeletionDialog`: For deletion confirmation
- `ImageUploadProgress`: For upload progress

## Future Enhancements

### Phase 2
- [ ] Virtual scrolling with react-window
- [ ] Advanced search with regex
- [ ] Image versioning support
- [ ] Dimension-based filtering
- [ ] Smart auto-tagging
- [ ] Duplicate detection
- [ ] Image comparison view

### Phase 3
- [ ] Slideshow mode implementation
- [ ] Bulk export to ZIP
- [ ] Cloud storage integration
- [ ] Image analytics (most used, least used)
- [ ] Usage heatmaps
- [ ] AI-powered tagging
- [ ] Image CDN optimization

## Examples

### Creating a Folder

```tsx
const newFolder = createFolder('UI Components', null, '#3b82f6');
```

### Moving Images to Folder

```tsx
handleBulkMove('folder-id-123');
```

### Creating a Collection

```tsx
const collection = createCollection(
  'Login Screen Assets',
  'All images for login screen',
  ['image-1', 'image-2']
);
```

### Filtering Images

```tsx
setCurrentFilter({
  query: 'button',
  sources: ['uploaded', 'pattern_optimization'],
  usageFilter: 'used',
  tags: ['ui', 'interactive'],
  tagOperator: 'AND',
});
```

### Bulk Tagging

```tsx
addTagToImages(['img-1', 'img-2', 'img-3'], 'navigation');
```

## Performance

- Handles 1000+ images efficiently
- Grid rendering optimized with CSS Grid
- Lazy image loading
- Debounced search (300ms)
- Memoized filtering
- Efficient tree operations

## Accessibility

- Keyboard navigation support
- ARIA labels on interactive elements
- Focus management
- Screen reader friendly
- Keyboard shortcuts (future)

## Browser Support

- Chrome/Edge 90+
- Firefox 88+
- Safari 14+
- Modern browsers with ES2020 support

## Dependencies

- React 19+
- @dnd-kit/core (drag-and-drop)
- lucide-react (icons)
- shadcn/ui components
- AutomationContext
- Image upload API

## Known Limitations

1. No virtual scrolling yet (using standard scroll)
2. Slideshow mode not implemented
3. Image dimensions not extracted on upload
4. No keyboard shortcuts yet
5. Collections not persisted to backend

## Troubleshooting

### Images not showing
- Check if AutomationContext is providing images
- Verify image URLs are valid
- Check S3 presigned URL expiration

### Upload failing
- Verify projectId is set
- Check file size limits
- Ensure valid image format
- Check network connection

### Performance issues
- Reduce grid size
- Use list view for large libraries
- Clear filters
- Check browser memory

## Contributing

When enhancing this component:
1. Maintain type safety
2. Follow existing patterns
3. Update documentation
4. Test with large image sets
5. Preserve AutomationContext integration

## License

Part of qontinui-web project.
