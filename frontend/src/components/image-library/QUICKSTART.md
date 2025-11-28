# Enhanced Image Library - Quick Start Guide

Get started with the Enhanced Image Library in 5 minutes.

## Installation

The component is already part of qontinui-web. No installation needed!

## Basic Usage

### 1. Import the Component

```tsx
import { EnhancedImageLibrary } from "@/components/image-library";
```

### 2. Add to Your Page

```tsx
export default function ImagesPage() {
  return (
    <div className="h-screen">
      <EnhancedImageLibrary />
    </div>
  );
}
```

That's it! The component automatically connects to AutomationContext.

## Common Tasks

### Creating Folders

1. Click **Library** tab in left sidebar
2. Click **New Folder** button
3. Enter folder name
4. Press Enter or click checkmark
5. (Optional) Click folder menu → Change color

### Uploading Images

**Method 1: Drag & Drop**

1. Drag image files from your computer
2. Drop them anywhere in the grid
3. Watch the upload progress

**Method 2: Upload Button**

1. Click **Upload** button (top right)
2. Select image files
3. Images are added to library

**Pro Tip**: Select a folder first to auto-assign uploaded images to that folder.

### Organizing Images

**Move to Folder**

1. Select images (click checkbox on hover)
2. Click **Move to Folder** in bulk toolbar
3. Choose destination folder

**Add Tags**

1. Select images
2. Click **Add Tags**
3. Enter tag name
4. Press Enter

**Create Collection**

1. Click **Collections** tab
2. Click **New Collection**
3. Enter collection name
4. Add images via bulk operations

### Filtering Images

**Quick Filters**

1. Click **Filters** button (top right)
2. Click source badges to filter
3. Click usage filter (All/Used/Unused)

**Search**

1. Type in search box
2. Results filter in real-time

**Clear All**

- Click **Clear All** in filter panel

### Viewing Image Details

1. Click any image in grid
2. Right panel opens with details
3. View metadata, usage, and actions

### Editing Images

**Edit Mask**

1. Select image
2. Click **Edit Mask** button
3. Use mask editor
4. Save changes

**Delete Image**

1. Select image
2. Click **Delete** button
3. Confirm deletion (shows usage info)

## View Modes

Switch between different views:

- **Grid View**: Click grid icon (default)
  - Adjust size with slider
- **List View**: Click list icon
  - See all metadata in table
- **Slideshow**: Click play icon (coming soon)

## Keyboard Shortcuts (Coming Soon)

- `Cmd/Ctrl + A`: Select all
- `Cmd/Ctrl + F`: Focus search
- `Delete`: Delete selected
- `Escape`: Clear selection

## Tips & Tricks

### For Large Libraries (100+ images)

1. **Use Folders**: Organize into logical folders
2. **Use Filters**: Filter by source/usage to reduce visible images
3. **Use Collections**: Group related images
4. **Use List View**: More efficient for browsing many images

### For Team Projects

1. **Color-Code Folders**: Use colors to indicate ownership/status
   - Blue: Shared assets
   - Green: Approved
   - Amber: In review
   - Red: Deprecated

2. **Tag Consistently**: Use standard tags
   - `ui`, `background`, `icon`, `button`
   - `login`, `dashboard`, `settings`
   - `high-priority`, `needs-review`

3. **Use Collections**: Group by feature/screen
   - "Login Screen Assets"
   - "Dashboard Components"
   - "Onboarding Flow"

### For Cleanup

1. **Find Unused**: Filter by "Unused"
2. **Select All**: Select all unused images
3. **Review**: Check if really unused
4. **Delete**: Bulk delete if confirmed

### For Finding Images

1. **Search by Name**: Type partial filename
2. **Filter by Source**: Show only uploaded/extracted
3. **Filter by Usage**: Show only used images
4. **Browse Folders**: Navigate folder tree

## Common Workflows

### Workflow 1: Initial Organization

```
1. Upload all images
2. Create folder structure:
   - UI Components
     - Buttons
     - Icons
     - Backgrounds
   - Screenshots
   - Generated
3. Move images to appropriate folders
4. Add tags for cross-cutting concerns
5. Create collections for features
```

### Workflow 2: Adding New Images

```
1. Select target folder
2. Upload images (auto-assigned to folder)
3. Add relevant tags
4. Add to collection if needed
5. Use in workflow/state
```

### Workflow 3: Finding Image for Action

```
1. Search by name/description
2. Filter by source (e.g., only uploaded)
3. Filter by usage (e.g., unused)
4. Browse folder tree
5. Check details panel for context
6. Select image for action
```

### Workflow 4: Cleaning Up Library

```
1. Filter by "Unused"
2. Review unused images
3. Select images to delete
4. Bulk delete
5. Check "Used" images
6. Update tags/folders as needed
```

## Integration Examples

### In App Layout

```tsx
// app/(app)/images/page.tsx
export default function ImagesPage() {
  return <EnhancedImageLibrary />;
}
```

### In Modal/Dialog

```tsx
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { EnhancedImageLibrary } from "@/components/image-library";

function ImagePicker({ open, onClose }) {
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-6xl h-[80vh]">
        <EnhancedImageLibrary />
      </DialogContent>
    </Dialog>
  );
}
```

### In Tab Layout

```tsx
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EnhancedImageLibrary } from "@/components/image-library";

function ProjectAssets() {
  return (
    <Tabs defaultValue="images">
      <TabsList>
        <TabsTrigger value="images">Images</TabsTrigger>
        <TabsTrigger value="screenshots">Screenshots</TabsTrigger>
      </TabsList>
      <TabsContent value="images" className="h-[calc(100vh-8rem)]">
        <EnhancedImageLibrary />
      </TabsContent>
      {/* ... */}
    </Tabs>
  );
}
```

## Troubleshooting

### Images not showing?

- Check AutomationContext is available
- Verify project is loaded
- Check browser console for errors

### Upload failing?

- Ensure project ID is set
- Check file is valid image
- Check file size (max 10MB)
- Check network connection

### Slow performance?

- Use smaller grid size
- Switch to list view
- Apply filters to reduce images shown
- Check browser memory

### Can't find image?

- Clear all filters
- Check search query
- Select "All Images" folder
- Verify image exists in context

## Next Steps

- Read [README.md](./README.md) for complete documentation
- Check [EnhancedImageLibrary.example.tsx](./EnhancedImageLibrary.example.tsx) for code examples
- Review [types.ts](./types.ts) for TypeScript types
- Explore the component source code

## Getting Help

- Check the README for detailed documentation
- Review example usage files
- Check the existing images-manager.tsx for comparison
- Review AutomationContext integration

## Feature Requests

Future enhancements planned:

- Virtual scrolling for 1000+ images
- Slideshow mode
- Keyboard shortcuts
- Advanced search with regex
- Image versioning
- Duplicate detection
- AI-powered tagging
- Analytics dashboard

Enjoy organizing your image library! 🎨📁
