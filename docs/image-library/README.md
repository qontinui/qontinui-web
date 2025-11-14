# Image Library

The Image Library is a centralized repository for managing all visual assets used in your automation project. It provides powerful organization, search, and tracking capabilities designed to handle projects with 100+ images efficiently.

## Table of Contents

- [Overview](#overview)
- [Key Features](#key-features)
- [Getting Started](#getting-started)
- [Image Sources](#image-sources)
- [Search and Filters](#search-and-filters)
- [Usage Tracking](#usage-tracking)
- [Storage and Performance](#storage-and-performance)
- [Best Practices](#best-practices)
- [Related Documentation](#related-documentation)

## Overview

The Image Library serves as the single source of truth for all images in your project. Images can be uploaded manually or created automatically through pattern optimization, image extraction, or state discovery features.

### Key Capabilities

- **Centralized Management**: All project images in one location
- **Automatic Tracking**: Track where each image is used across states and workflows
- **Smart Search**: Filter by name, source, usage, and date
- **Usage Analysis**: Identify unused or overused images
- **S3 Storage**: Scalable cloud storage with presigned URLs
- **Version Support**: Architecture ready for image versioning (coming soon)

## Key Features

### 1. Image Upload and Management

Upload images through multiple methods:

```typescript
// Manual upload via drag-and-drop or file selector
// Supports: PNG, JPG, GIF, WebP

// Programmatic upload
import { createImageAsset } from '@/lib/image-library-utils';

const imageAsset = createImageAsset(
  imageDataUrl,
  'button-hover-state',
  'pattern_optimization'
);
```

### 2. Automatic Image Creation

Images are automatically added to the library when created through:

- **Pattern Optimization**: Extracted patterns from screenshots
- **Image Extraction**: Cropped regions from screenshots
- **State Discovery**: Patterns identified during state creation
- **Manual Upload**: Direct file uploads

### 3. Usage Tracking

Every image tracks:

- **Usage Count**: Total number of references
- **Used In**: List of states and workflows using the image
- **Last Updated**: When usage was last modified

```typescript
interface ImageUsage {
  type: "state" | "process";
  id: string;
  name: string;
}

interface ImageAsset {
  id: string;
  name: string;
  usageCount: number;
  usage?: ImageUsage[];
  // ... other properties
}
```

### 4. Smart Deletion Protection

The Image Library prevents accidental deletion of used images:

- **Usage Detection**: Automatically detects all image references
- **Confirmation Dialog**: Shows where image is used before deletion
- **Safe Removal**: Option to remove references or cancel deletion
- **Cascade Updates**: Optionally removes image from all states/workflows

### 5. Source Tracking

Images are categorized by source:

- `uploaded`: Manually uploaded images
- `pattern_optimization`: From Pattern Optimization tool
- `image_extraction`: From Image Extraction feature
- `state_discovery`: From State Discovery workflow

Filter by source to find images from specific creation methods.

## Getting Started

### Uploading Images

**Via Drag and Drop:**
1. Navigate to the Images tab
2. Drag image files onto the upload area
3. Images are automatically uploaded and added to the library

**Via File Selector:**
1. Click the "Upload Images" button
2. Select one or more image files
3. Wait for upload completion

**Supported Formats:**
- PNG (recommended for UI elements)
- JPEG/JPG (for screenshots)
- GIF (for animated elements)
- WebP (for optimized images)

### Viewing Image Details

Click on any image to view:
- Image preview
- File size
- Creation date
- Source
- Usage count
- List of states/workflows using the image

### Renaming Images

1. Click the edit icon on an image card
2. Enter a new name (descriptive names recommended)
3. Changes are saved automatically

### Deleting Images

1. Click the delete icon on an image card
2. Review the usage dialog (if image is used)
3. Choose to:
   - Remove from all states/workflows and delete
   - Cancel deletion

**Warning**: Deleting an image removes it from all states and workflows that use it.

## Image Sources

### Uploaded Images

Manually uploaded images for general use:

```typescript
source: 'uploaded'
```

**Use cases:**
- Custom icons and buttons
- Reference images
- Test data images

### Pattern Optimization

Images extracted during pattern optimization:

```typescript
source: 'pattern_optimization'
```

**Use cases:**
- UI element patterns
- Button states (normal, hover, disabled)
- Icon variations

### Image Extraction

Images cropped from screenshots:

```typescript
source: 'image_extraction'
```

**Use cases:**
- Specific UI regions
- Text areas
- Complex patterns

### State Discovery

Images identified during automated state discovery:

```typescript
source: 'state_discovery'
```

**Use cases:**
- State indicators
- Navigation elements
- Screen identifiers

## Search and Filters

### Search by Name

Use the search bar to filter images by name:

```
// Find all button images
search: "button"

// Find hover states
search: "hover"

// Find login-related images
search: "login"
```

### Filter by Source

Click source badges to filter:

- **All**: Show all images (default)
- **Uploaded**: Manual uploads only
- **Pattern Optimization**: Pattern-extracted images
- **Image Extraction**: Cropped images
- **State Discovery**: Auto-discovered patterns

### Filter by Usage

Find images based on usage:

```typescript
// Unused images (candidates for cleanup)
images.filter(img => img.usageCount === 0)

// Heavily used images (consider optimizing)
images.filter(img => img.usageCount > 10)

// Images used in specific states
images.filter(img =>
  img.usage?.some(u => u.type === 'state' && u.id === stateId)
)
```

## Usage Tracking

### How Usage is Tracked

The Image Library automatically tracks usage when:

1. **Image Added to State**: Image used in StateImage pattern
2. **Image Added to Workflow**: Image used in Find actions
3. **Image Removed**: Reference removed from state/workflow
4. **State/Workflow Deleted**: All image references updated

### Usage Information

For each image, view:

- **Total usage count**
- **List of states** using the image
- **List of workflows** using the image
- **Usage type** (pattern, search region, etc.)

### Finding Unused Images

Identify images that can be safely removed:

1. Filter images with `usageCount: 0`
2. Review images to confirm they're not needed
3. Delete unused images to reduce project size

**Example:**
```typescript
// Find all unused images
const unusedImages = images.filter(img => img.usageCount === 0);

// Find images not used in last 30 days
const oldImages = images.filter(img => {
  const daysSinceCreation =
    (Date.now() - img.createdAt.getTime()) / (1000 * 60 * 60 * 24);
  return img.usageCount === 0 && daysSinceCreation > 30;
});
```

## Storage and Performance

### S3 Cloud Storage

All images are stored in Amazon S3 for scalability:

- **Presigned URLs**: Secure, temporary access URLs
- **Auto-refresh**: URLs automatically renewed before expiration
- **Fast Upload**: Parallel uploads for multiple images
- **Progress Tracking**: Real-time upload progress indicators

### Storage Best Practices

1. **Optimize Image Size**: Use compressed PNG/WebP formats
2. **Appropriate Dimensions**: Crop to minimum required size
3. **Remove Unused**: Regularly clean up unused images
4. **Descriptive Names**: Use clear, searchable names

### Performance Tips

For projects with 100+ images:

1. **Use Filters**: Filter by source or usage to reduce displayed images
2. **Search First**: Use search to find specific images quickly
3. **Lazy Loading**: Images load as you scroll (automatic)
4. **Cleanup Regularly**: Remove unused images monthly

## Best Practices

### Naming Conventions

Use descriptive, consistent names:

```
Good:
- login-button-normal
- login-button-hover
- dashboard-icon-active
- error-message-red

Bad:
- img1
- button
- screenshot
- temp
```

### Organization Strategies

**By Feature:**
```
login-*
dashboard-*
settings-*
checkout-*
```

**By Type:**
```
button-*
icon-*
message-*
background-*
```

**By State:**
```
*-normal
*-hover
*-active
*-disabled
*-error
```

### Image Quality Guidelines

1. **Resolution**: Match target screen resolution
2. **Format**:
   - PNG for UI elements with transparency
   - JPEG for large screenshots
   - WebP for best compression
3. **Color**: Ensure consistent color profiles
4. **Cropping**: Crop to minimum required area

### Maintenance

**Weekly:**
- Review newly added images
- Verify names are descriptive
- Check for duplicates

**Monthly:**
- Remove unused images (0 usage count)
- Optimize large images
- Archive old test images

**Quarterly:**
- Full usage audit
- Consolidate similar images
- Update documentation

## Advanced Features

### Image Masking (Optional)

Some images support masks for advanced pattern matching:

```typescript
interface ImageAsset {
  mask?: string; // Base64 encoded mask image
}
```

Use masks to:
- Ignore dynamic regions (timestamps, counters)
- Focus on specific parts of complex images
- Improve pattern matching accuracy

### Version History (Coming Soon)

Future support for image versioning:

```typescript
interface ImageAsset {
  version?: number;
  parentImageId?: string;
  versions?: string[];
}
```

This will enable:
- Track image changes over time
- Roll back to previous versions
- Compare versions visually
- Branch images for A/B testing

## Troubleshooting

### Upload Failures

**Problem**: Images fail to upload
**Solutions:**
- Check file size (max 10MB recommended)
- Verify file format is supported
- Check network connection
- Ensure project is selected

### Missing Images

**Problem**: Images don't appear in library
**Solutions:**
- Check source filter (may be filtered out)
- Verify upload completed successfully
- Refresh the page
- Check browser console for errors

### Deletion Issues

**Problem**: Can't delete image
**Solutions:**
- Check if image is used (see usage dialog)
- Remove image from states/workflows first
- Or use "Force Delete" to remove all references

### Performance Issues

**Problem**: Library slow with many images
**Solutions:**
- Use search/filters to reduce displayed images
- Clear browser cache
- Remove unused images
- Optimize large image files

## Related Documentation

- **[Image Organization Guide](./organization.md)** - Detailed organization strategies
- **[State Builder](../state-builder/README.md)** - Using images in states
- **[Pattern Optimization](../workflow-builder/components.md)** - Creating patterns from images
- **[Best Practices](../best-practices/large-projects.md)** - Large project management
- **[API Reference](../api-reference/resource-services.md)** - Image library API

## Quick Reference

### Common Tasks

**Upload Image:**
1. Click "Upload Images" or drag files
2. Wait for upload to complete
3. Rename if needed

**Find Unused Images:**
1. Sort by usage count
2. Filter images with 0 usage
3. Review and delete as needed

**Find Image Usage:**
1. Click image card
2. View "Used In" section
3. Click items to navigate to usage location

**Delete Image:**
1. Click delete icon
2. Review usage dialog
3. Confirm deletion (removes all references)

### Keyboard Shortcuts

- `Ctrl/Cmd + F`: Focus search box
- `Ctrl/Cmd + U`: Upload images
- `Escape`: Close image details
- `Delete`: Delete selected image (after confirmation)

---

**Next Steps:**
- Read the [Image Organization Guide](./organization.md) for advanced strategies
- Learn about [State Builder](../state-builder/README.md) to use images effectively
- Explore [Best Practices](../best-practices/large-projects.md) for large projects
