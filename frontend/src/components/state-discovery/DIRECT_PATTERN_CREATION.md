# Direct Pattern Creation (EXPERIMENTAL)

## Overview

Direct Pattern Creation is an experimental feature that allows users to extract UI patterns directly from snapshot runs without needing to upload screenshots separately. This provides a streamlined workflow for creating StateImages from captured test execution screenshots.

## Architecture

### Component Structure

```
DirectPatternCreation (Main Component)
├── SnapshotMultiSelector (Step 1: Snapshot Selection)
├── DirectPatternRegionSelector (Step 2: Region Drawing)
├── PatternPreviewCard (Step 2: Pattern Preview)
└── SavePatterns (Step 3: Save to Library)
```

### File Structure

```
/src/components/state-discovery/
  ├── DirectPatternCreation.tsx          # Main workflow component
  ├── DirectPatternRegionSelector.tsx    # Region selection on screenshots
  └── PatternPreviewCard.tsx             # Pattern preview with edit/delete

/src/types/
  └── direct-pattern-creation.ts         # TypeScript type definitions
```

## Features

### 1. Snapshot Selection
- **Component**: `SnapshotMultiSelector`
- **Functionality**:
  - Select one or more snapshot runs
  - View snapshot metadata (screenshots, actions, duration)
  - Multi-select with summary statistics
  - Auto-load all screenshots from selected snapshots

### 2. Pattern Extraction
- **Component**: `DirectPatternRegionSelector`
- **Functionality**:
  - Display full screenshot from snapshot
  - Draw regions using click-and-drag
  - Show previously extracted regions (gray overlay)
  - Navigate between screenshots
  - Auto-populate states from snapshot metadata

**Region Selector Features**:
- Canvas-based drawing with proper scaling
- Visual feedback during drawing
- Display existing extracted patterns
- Keyboard shortcuts (Select All, Clear)
- Region dimensions display

### 3. Pattern Preview & Editing
- **Component**: `PatternPreviewCard`
- **Functionality**:
  - Preview extracted pattern image
  - Edit pattern name inline
  - Edit/add/remove associated states
  - Delete pattern
  - View source information

**Preview Card Features**:
- Thumbnail preview
- Inline name editing
- State management (add/remove tags)
- Region coordinates display
- Source screenshot tracking

### 4. Save to Library
- **Functionality**:
  - Batch save all extracted patterns
  - Progress indicator
  - Error handling per pattern
  - Success/failure reporting
  - Integration with AutomationContext

## Data Flow

```
1. User selects snapshots
   └─> Load screenshots via API: /api/integration-testing/snapshots/:id/screenshots

2. User draws region on screenshot
   └─> Extract image data using Canvas API
   └─> Create ExtractedPattern object

3. User reviews/edits patterns
   └─> Update pattern metadata (name, states)

4. User saves patterns
   └─> Convert to StateImage objects
   └─> Dispatch to AutomationContext
   └─> Patterns available in image library
```

## Types

### ExtractedPattern
```typescript
interface ExtractedPattern {
  id: string;
  name: string;
  imageData: string; // Base64 data URL
  region: Region;
  sourceScreenshotIndex: number;
  sourceScreenshotUrl: string;
  sourceSnapshotId: string;
  states: string[];
  timestamp: string;
}
```

### Region
```typescript
interface Region {
  x: number;
  y: number;
  width: number;
  height: number;
}
```

### SnapshotScreenshot
```typescript
interface SnapshotScreenshot {
  id: string;
  url: string;
  path: string;
  snapshotRunId: string;
  snapshotName: string;
  active_states: string[];
  timestamp: string;
  width?: number;
  height?: number;
}
```

## API Integration

### Endpoints Used

1. **Load Screenshots**
   - `GET /api/integration-testing/snapshots/:id/screenshots`
   - Returns list of screenshots with metadata

2. **Serve Screenshot Images**
   - `GET /api/integration-testing/snapshots/:id/screenshot/:path`
   - Returns screenshot image

### Image Extraction

Uses HTML Canvas API to extract regions:
```typescript
const canvas = document.createElement('canvas');
canvas.width = region.width;
canvas.height = region.height;
ctx.drawImage(img, region.x, region.y, region.width, region.height, 0, 0, region.width, region.height);
const imageData = canvas.toDataURL('image/png');
```

## State Management

### AutomationContext Integration

Patterns are saved using the existing state-image-creator library:

```typescript
const stateImage = createStateImage({
  name: pattern.name,
  image: pattern.imageData,
  source: 'direct-pattern-creation',
  fixed: false,
});

dispatch({
  type: 'ADD_STATE_IMAGE',
  payload: stateImage,
});
```

### Local State

The component manages:
- Selected snapshots
- Loaded screenshots
- Current screenshot index
- Selected region
- Extracted patterns
- Loading/saving states

## User Workflow

1. **Select Snapshots** (Step 1)
   - Choose one or more snapshot runs
   - System loads all screenshots
   - View total screenshot count

2. **Extract Patterns** (Step 2)
   - Navigate through screenshots
   - Draw regions on UI elements
   - Click "Extract This Region"
   - Pattern appears in sidebar
   - Continue extracting from other screenshots

3. **Review & Edit** (Step 2, continued)
   - View all extracted patterns
   - Edit pattern names
   - Modify state associations
   - Delete unwanted patterns

4. **Save** (Step 3)
   - Click "Save to Image Library"
   - Patterns added to StateImage library
   - Success confirmation
   - Ready to use in state definitions

## Error Handling

### Extraction Errors
- CORS issues with images
- Canvas context failures
- Invalid regions (too small)

### Save Errors
- Individual pattern save failures tracked
- Partial success reporting
- Detailed error messages per pattern

### UI Feedback
- Loading indicators for async operations
- Toast notifications for user actions
- Progress bar for batch operations
- Disabled states for invalid actions

## Responsive Design

- Grid layout: 2/3 for screenshot, 1/3 for patterns
- ScrollArea for pattern list
- Responsive region selector
- Mobile-friendly (though optimized for desktop)

## Performance Considerations

1. **Lazy Loading**: Screenshots loaded only when snapshots selected
2. **Image Scaling**: Proper scaling for display without quality loss
3. **Batch Processing**: Efficient pattern saving with progress updates
4. **Memory Management**: Canvas cleanup after extraction

## Future Enhancements

1. **Bulk Operations**
   - Select multiple regions per screenshot
   - Batch rename patterns
   - Bulk state assignment

2. **Advanced Features**
   - Pattern similarity detection
   - Auto-naming based on visual content
   - Pattern grouping by state
   - Export/import pattern sets

3. **UI Improvements**
   - Zoom/pan on screenshots
   - Keyboard shortcuts for navigation
   - Pattern search/filter
   - Undo/redo for extractions

4. **Integration**
   - Direct state creation from patterns
   - Pattern testing before save
   - Integration with pattern optimization

## Testing Considerations

### Manual Testing
1. Select snapshots with various screenshot counts
2. Extract patterns from different locations
3. Edit pattern metadata
4. Test navigation between screenshots
5. Verify save functionality
6. Check error handling

### Edge Cases
- Empty snapshots
- Single screenshot
- Very large/small regions
- Duplicate pattern names
- No states in snapshot

## Known Limitations

1. **CORS**: Screenshot images must be served with proper CORS headers
2. **Browser Support**: Requires modern browser with Canvas API
3. **Image Size**: Large screenshots may impact performance
4. **Memory**: Extracting many patterns uses client-side memory

## Usage Example

```typescript
import { DirectPatternCreation } from '@/components/state-discovery/DirectPatternCreation';

// In a tab or dialog
<DirectPatternCreation />
```

## Dependencies

- `@/components/ui/*` - shadcn/ui components
- `@/contexts/automation-context` - State management
- `@/lib/state-image-creator` - StateImage creation utilities
- `@/types/snapshots` - Snapshot type definitions
- `lucide-react` - Icons
- `sonner` - Toast notifications
- `date-fns` - Date formatting

## Experimental Status

This feature is marked as EXPERIMENTAL because:
1. New workflow not yet validated with users
2. API endpoints may change
3. UI/UX may need refinement
4. Performance optimization pending
5. Integration with other features incomplete

## License

Part of the qontinui-web project. See main project LICENSE.
